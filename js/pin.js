/* ===========================================================================
   PIN GATE — the front door. Loaded FIRST, before core.js, and it is the only
   file in js/ that runs before `state` exists: it takes no dependency on el(),
   escapeHtml() or anything else, on purpose, so nothing about the boot order
   can leave the door open.

   Two PINs, two roles. The owner's opens everything; the guest's opens the
   dashboard minus the scratch page (js/scratch.js). The role is decided here
   and read everywhere else through p25IsGuest() / p25IsOwner().

   WHAT THIS IS NOT: authentication. Every byte of this file ships to the
   browser, the PIN space is a million wide, and the Supabase row behind the
   app stays unauthenticated no matter which PIN was typed (js/persistence.js) —
   so anyone who opens DevTools is already past it. It is a soft gate: it keeps
   the dashboard shut to whoever picks up an unlocked laptop, and it hands a
   guest a deliberately smaller version of the app. Treat it as exactly that
   much, and don't put anything behind it that would be a real problem to lose.

   Four rules hold it up.

   1. THE ROLE IS NEVER PASSED IN FROM OUTSIDE. There is no p25SetRole(), and
      unlock() is not exported — the only way to become the owner is to type the
      owner's PIN into this file's own handler. A "role" argument anywhere else
      in the app is a way for a bookmarklet to promote itself.

   2. UNKNOWN FAILS CLOSED. p25IsGuest() answers true for a role that hasn't
      been decided yet, so a caller that runs before the gate resolves gets the
      restricted answer rather than the permissive one. That is also why the
      boot in js/main.js *waits* on p25GateReady instead of racing it: a guest's
      browser must never fetch the scratch row at all, and load() is what would
      fetch it.

   3. THE PINS ARE STORED AS HASHES, and that buys exactly one thing — a casual
      `grep` of the source for the digits turns up nothing. It is not a security
      measure (see above); it is also why there is no "forgot your PIN?" hint
      here, since such a hint is worth more to a stranger than to the owner.

   4. THE ROLE LIVES IN sessionStorage, not localStorage. Closing the tab shuts
      the door again, which is the whole point of a door; a reload does not,
      because re-typing a PIN after an accidental refresh mid-edit teaches you
      to hate the gate. The lockout and the trust record are the two things kept
      in localStorage — the first so reloading can't be the way past the
      wrong-PIN delay, the second because being remembered IS what a trusted
      device is.

   5. A TRUSTED DEVICE IS A LOCALSTORAGE RECORD AND NOTHING MORE. Ticking "trust
      this device" on an owner unlock writes it; from then on that browser
      profile opens straight through. localStorage is already per-origin and
      per-profile, so it IS the device identity — nothing is fingerprinted and
      nothing is sent anywhere. Only an owner unlock ever writes one, the idle
      window slides on every visit rather than expiring on a fixed date, and
      Lock deletes it (or the reload would walk straight back in).

      Understand what this trades away: on a trusted device the gate no longer
      asks, so it is no longer any protection against whoever picks that device
      up. That is a deliberate choice — the owner's own machines shouldn't nag —
      and it leaves the gate guarding devices that AREN'T yours. Which is worth
      little by itself, since the data behind it is readable by anyone with the
      URL (see "WHAT THIS IS NOT"), and is exactly why the answer to "is my data
      safe" is still Supabase Auth + RLS rather than anything in this file.
   =========================================================================== */
(function(){
  'use strict';

  /* FNV-1a/32 over 'p25.gate.v1:' + pin. Deliberately a plain synchronous hash
     rather than crypto.subtle: this file has to answer before the first paint,
     SubtleCrypto is async and is absent outside a secure context, and the app
     is opened straight off the filesystem often enough (README, "No build
     step") that "works everywhere, instantly" is worth more here than a
     stronger digest would be — a six-digit space falls to brute force either
     way. Verified to collide with nothing across all million 6-digit PINs. */
  var PIN_ROLES = { '893ecce6':'owner', 'c43588d7':'guest' };
  var PIN_LEN = 6;

  var ROLE_KEY   = 'p25-gate-role';   // sessionStorage — cleared when the tab closes
  var LOCK_KEY   = 'p25-gate-lock';   // localStorage — survives the reload it exists to defeat
  var TRUST_KEY  = 'p25-gate-trust';  // localStorage — the trusted-device record, see below
  var MAX_TRIES  = 5;
  var LOCKOUT_MS = 30000;
  /* A trusted device stops being trusted after this long WITHOUT A VISIT, not this long since it
     was trusted: every open slides the window forward, so a device in daily use is never asked
     again, while a laptop that dropped out of the rotation for three months asks once. That's the
     property worth having — a fixed expiry would interrupt the devices you actually use, which is
     the thing this feature exists to stop. */
  var TRUST_MAX_IDLE_MS = 90 * 24 * 60 * 60 * 1000;

  var gate    = document.getElementById('pinGate');
  var dotsEl  = document.getElementById('pinDots');
  var msgEl   = document.getElementById('pinGateMsg');
  var padEl   = document.getElementById('pinPad');
  var trustEl = document.getElementById('pinTrust');

  var entry = '';
  var tries = 0;
  var currentRole = null;
  var open = false;
  var lockTimer = null;

  var resolveReady;
  var ready = new Promise(function(res){ resolveReady = res; });

  function pinHash(pin){
    var h = 0x811c9dc5, s = 'p25.gate.v1:' + pin, i;
    for(i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16);
  }

  /* Storage can throw outright in a locked-down browser (private mode, site
     data blocked). A gate that crashes is a gate nobody can walk through, so
     every access is wrapped and the failure mode is simply "asks again". */
  function readStored(key, store){
    try{ return store.getItem(key); }catch(e){ return null; }
  }
  function writeStored(key, val, store){
    try{ store.setItem(key, val); }catch(e){}
  }
  function dropStored(key, store){
    try{ store.removeItem(key); }catch(e){}
  }

  function lockedUntil(){
    var raw = readStored(LOCK_KEY, window.localStorage);
    var t = raw ? parseInt(raw, 10) : 0;
    if(!t || isNaN(t) || t <= Date.now()){ if(raw) dropStored(LOCK_KEY, window.localStorage); return 0; }
    return t;
  }

  /* ---------- trusted devices ----------
     A record here means "an owner PIN was typed into THIS browser profile, and asked not to be
     asked again". localStorage is itself the device identity — it is already per-origin and
     per-profile — so nothing is fingerprinted, nothing is sent anywhere, and no two devices can
     be confused for one another.
     Validated field by field on the way in, like the stored role: a record that isn't the exact
     shape written by writeTrust() is treated as no record at all, so a half-written or
     hand-edited value asks for the PIN rather than throwing on boot. */
  function readTrust(){
    var raw = readStored(TRUST_KEY, window.localStorage);
    if(!raw) return null;
    var rec = null;
    try{ rec = JSON.parse(raw); }catch(e){ rec = null; }
    if(!rec || rec.role !== 'owner' || typeof rec.at !== 'number' || typeof rec.seen !== 'number'){
      dropTrust();
      return null;
    }
    /* Idle expiry, checked on read so it applies wherever the record is consulted. A `seen` in the
       FUTURE is treated as expired too: that means the clock moved backwards or the value was
       edited, and a record that can never go stale is worse than one asked about once. */
    var idle = Date.now() - rec.seen;
    if(idle > TRUST_MAX_IDLE_MS || idle < -TRUST_MAX_IDLE_MS){ dropTrust(); return null; }
    return rec;
  }
  function writeTrust(rec){
    writeStored(TRUST_KEY, JSON.stringify(rec), window.localStorage);
  }
  function dropTrust(){
    dropStored(TRUST_KEY, window.localStorage);
  }
  /* Slides the idle window forward on every visit that trust let in. `at` is left alone — it is
     the "trusted since" the Settings card shows, and it should keep saying when the decision was
     made, not when the app was last opened. */
  function touchTrust(rec){
    writeTrust({ role:'owner', at: rec.at, seen: Date.now() });
  }
  /* Default ON when the checkbox is missing: the markup could be an older cached index.html, and
     the setting the user asked for is "stop asking me on my own devices". */
  function trustWanted(){
    return !trustEl || trustEl.checked !== false;
  }

  function setMsg(text, kind){
    if(!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.className = 'pin-gate-msg' + (kind ? ' is-' + kind : '');
  }

  function renderDots(){
    if(!dotsEl) return;
    var kids = dotsEl.children, i;
    for(i = 0; i < kids.length; i++) kids[i].classList.toggle('is-filled', i < entry.length);
  }

  /* Re-derived from the deadline on every tick rather than counted down in a
     variable: a backgrounded tab throttles setInterval to about once a minute,
     so the stored timestamp is the only honest source of what's left. */
  function tickLockout(){
    var until = lockedUntil();
    if(!until){
      if(lockTimer){ clearInterval(lockTimer); lockTimer = null; }
      tries = 0;
      if(padEl) padEl.classList.remove('is-disabled');
      setMsg('');
      return;
    }
    if(padEl) padEl.classList.add('is-disabled');
    setMsg('Too many attempts. Try again in ' + Math.ceil((until - Date.now()) / 1000) + 's.', 'bad');
    if(!lockTimer) lockTimer = setInterval(tickLockout, 1000);
  }

  function reject(){
    entry = '';
    renderDots();
    tries++;
    var card = gate ? gate.querySelector('.pin-gate-card') : null;
    if(card){
      /* Restart the shake by removing the class and forcing a reflow — adding
         it again to an element that already carries it replays nothing. */
      card.classList.remove('is-wrong');
      void card.offsetWidth;
      card.classList.add('is-wrong');
    }
    if(tries >= MAX_TRIES){
      writeStored(LOCK_KEY, String(Date.now() + LOCKOUT_MS), window.localStorage);
      tickLockout();
    } else {
      setMsg('Incorrect PIN.', 'bad');
    }
  }

  function submit(){
    var role = PIN_ROLES[pinHash(entry)];
    if(role) unlock(role, false);
    else reject();
  }

  function press(key){
    if(!open || lockedUntil()) return;
    if(key === 'del'){
      entry = entry.slice(0, -1);
      renderDots();
      setMsg('');
      return;
    }
    if(!/^[0-9]$/.test(key) || entry.length >= PIN_LEN) return;
    setMsg('');
    entry += key;
    renderDots();
    /* Auto-submits on the last digit: with a fixed-length PIN an OK button
       would only ever be pressed immediately after the sixth key. The check is
       deferred a beat so the sixth dot is painted before a wrong PIN wipes it. */
    if(entry.length === PIN_LEN) setTimeout(submit, 90);
  }

  function onKeyDown(e){
    if(!open) return;
    if(e.key === 'Backspace'){ e.preventDefault(); press('del'); return; }
    if(e.key === 'Enter'){ e.preventDefault(); return; } // the sixth digit already submitted
    if(e.key.length === 1 && e.key >= '0' && e.key <= '9'){ e.preventDefault(); press(e.key); }
  }

  /* The gate covers the app, but the app is still in the DOM behind it — so Tab
     would otherwise walk focus into a page the user hasn't been let into yet,
     and a focused control there can be operated by keyboard even though it
     can't be seen or clicked. Pulling focus back is cheaper and steadier than
     inert-ing every sibling of the gate. */
  function onFocusIn(e){
    if(!open || !gate || gate.contains(e.target)) return;
    var first = gate.querySelector('.pin-key');
    if(first) first.focus();
  }

  function onPadClick(e){
    var b = e.target && e.target.closest ? e.target.closest('[data-pin-key]') : null;
    if(b) press(b.getAttribute('data-pin-key'));
  }

  /* Handing the page back once the door is out of the way.

     The mobile navbar is `position:sticky; top:0` (styles.css, the max-width:760px block), and a
     sticky element is re-pinned only by the scroll machinery — so if anything scrolled the document
     while the gate was covering it, the bar stays parked at its static position off the top of the
     screen and doesn't reappear until the next swipe. That was the "invisible navbar" bug, and
     focusing a keypad button on a phone was enough to cause the scroll.

     Three lines, three different jobs: give back the scroll the gate took, put the page at the top
     where the bar lives, and fire the scroll/resize pair nav.js listens on so onScroll() and
     measureNav() re-run — the latter is what publishes --nav-h, which the goal sheets reserve
     space against, so getting it right on the first paint rather than the second matters too.

     Only ever called on the interactive path. On the already-unlocked path the gate was never
     shown, nothing was locked, and forcing scrollTo(0,0) there would throw away the browser's own
     scroll restoration on every reload. */
  function releasePage(){
    document.documentElement.classList.remove('pin-gate-locked');
    window.scrollTo(0, 0);
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
  }

  function unlock(role, silent){
    currentRole = role;
    open = false;
    entry = '';
    writeStored(ROLE_KEY, role, window.sessionStorage);
    /* Trust is established ONLY here: on the interactive path, for the owner, with the box ticked.
       Three conditions, each load-bearing.
       `!silent` — the silent path is a session or a trust record being *replayed*, and letting it
       write would refresh `at` on every reload, so "trusted since" would always read as today.
       `role === 'owner'` — a guest PIN never trusts a device, however the box is set. A guest
       session is meant to end with the tab, and a device that silently came back as a guest would
       be a second, quieter way in that nobody chose. It is also why the box needs no guest-specific
       UI: the guest path simply ignores it.
       `trustWanted()` — an unticked box is the "I'm on someone else's computer" case. */
    if(!silent && role === 'owner' && trustWanted()) writeTrust({ role:'owner', at: Date.now(), seen: Date.now() });
    dropStored(LOCK_KEY, window.localStorage);
    if(lockTimer){ clearInterval(lockTimer); lockTimer = null; }
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('focusin', onFocusIn, true);
    if(padEl) padEl.removeEventListener('click', onPadClick);
    applyRole();
    /* Outside the `if(gate)` below and BEFORE it: the page has to be handed back even in the
       degenerate case where the markup is missing, or show() would have frozen a document with
       nothing left to unfreeze it. Before, rather than after the fade, because the gate is already
       pointer-events:none by then — re-pinning the navbar behind a fading overlay means the app is
       whole the moment it becomes visible. */
    if(!silent) releasePage();
    if(gate){
      if(silent){
        /* No transition on the already-unlocked path: this runs during parse,
           before the first paint, and fading out something that was never on
           screen would only put a flash of the gate on every reload. */
        gate.style.display = 'none';
      } else {
        gate.classList.add('pin-gate-hidden');
        setTimeout(function(){ gate.style.display = 'none'; }, 280);
      }
    }
    resolveReady(role);
  }

  /* data-role on <body> is the CSS half of the answer p25IsGuest() gives JS —
     it's what lets the stylesheet hide an owner-only control without every such
     control needing a line of script of its own. */
  function applyRole(){
    var val = currentRole || 'locked';
    if(document.body) document.body.setAttribute('data-role', val);
    else document.addEventListener('DOMContentLoaded', function(){ document.body.setAttribute('data-role', val); });
  }

  function show(){
    open = true;
    if(gate){
      gate.style.display = '';
      gate.classList.remove('pin-gate-hidden');
    }
    /* Holds the document still underneath. Not cosmetic: a document that scrolls while a fixed
       overlay covers it is what strands the sticky navbar off-screen (see releasePage). The gate
       scrolls internally instead, so a short phone can still reach the whole keypad. */
    document.documentElement.classList.add('pin-gate-locked');
    applyRole();
    renderDots();
    tickLockout();
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    if(padEl) padEl.addEventListener('click', onPadClick);
    /* Focus a keypad button rather than any text field: a real <input> would
       raise the soft keyboard over the keypad on a phone, and the keypad IS
       the input here.
       Fine pointers only, the same rule as scratch.js's scratchWantsAutoFocus():
       on a touch screen focusing a key gains nothing (the next thing that
       happens is a tap) and costs something real — the browser scrolls the
       focused element into view, which is one of the ways the document ends up
       scrolled under the gate. See releasePage() for why that mattered. */
    if(window.matchMedia && window.matchMedia('(pointer: fine)').matches){
      setTimeout(function(){
        var first = gate ? gate.querySelector('.pin-key') : null;
        if(first) first.focus();
      }, 0);
    }
  }

  /* Boot, in priority order.
     1. A role already decided in THIS tab wins outright. It is the more specific answer, and it is
        what lets a guest session survive a reload on a device that is itself trusted — otherwise
        handing someone the laptop in guest mode would silently come back as the owner the first
        time they refreshed.
     2. Otherwise a trusted device opens straight through as the owner, sliding its idle window.
     3. Otherwise ask. */
  var stored = readStored(ROLE_KEY, window.sessionStorage);
  var trust = stored ? null : readTrust();
  if(stored === 'owner' || stored === 'guest') unlock(stored, true);
  else if(trust){ touchTrust(trust); unlock('owner', true); }
  else show();

  /* ---- the only things the rest of the app may call ---- */

  /* Resolves with the role once the door is open. An already-unlocked session
     resolves on the first microtask, so waiting on this costs a reload nothing. */
  window.p25GateReady = ready;
  window.p25Role    = function(){ return currentRole; };
  window.p25IsOwner = function(){ return currentRole === 'owner'; };
  window.p25IsGuest = function(){ return currentRole !== 'owner'; }; // unknown fails closed — rule 2
  /* THE READ-ONLY POLICY, and the single definition of it. A guest may read everything (bar the
     scratch page) and change nothing: no save to any of the four storage resources, no upload to
     Storage, no Edge Function that writes or spends, no command to the local helper. It happens to
     equal p25IsOwner() today, and it is still a separate name on purpose — the ~20 write paths
     that call it are asking "may this session write?", not "who is this?", so the rule has one
     place to change and one thing to grep for. Every caller phrases it as `!appCanWrite()` off the
     wrapper in core.js, which is false when pin.js is missing entirely: fails closed, rule 2. */
  window.p25CanWrite = function(){ return currentRole === 'owner'; };
  /* Shuts the door again. A reload rather than merely re-showing the gate:
     by now every tab's data is in memory and in this page's DOM, and drawing a
     panel over all of it would leave it one DevTools pane away.
     It drops the device's trust as well as the session, and it has to — with the record left in
     place the reload would walk straight back in and the button would do nothing at all. So Lock
     means exactly one thing, "ask me for the PIN again", and re-trusting is one ticked box away on
     the screen it takes you to. It is also how to hand the device over untrusted: Lock, then let
     them in with the guest PIN. */
  window.p25Lock = function(){
    dropStored(ROLE_KEY, window.sessionStorage);
    dropTrust();
    window.location.reload();
  };
  /* For the Settings card only — whether this device is trusted, and since when. Returns a copy,
     never the record itself: a caller must not be able to extend its own trust by editing it. */
  window.p25TrustInfo = function(){
    var rec = readTrust();
    return rec ? { trusted:true, since:rec.at, lastSeen:rec.seen } : { trusted:false, since:null, lastSeen:null };
  };
})();
