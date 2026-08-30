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
      to hate the gate. A lockout is the one thing kept in localStorage, so
      reloading can't be the way past the wrong-PIN delay.
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
  var MAX_TRIES  = 5;
  var LOCKOUT_MS = 30000;

  var gate   = document.getElementById('pinGate');
  var dotsEl = document.getElementById('pinDots');
  var msgEl  = document.getElementById('pinGateMsg');
  var padEl  = document.getElementById('pinPad');

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

  function unlock(role, silent){
    currentRole = role;
    open = false;
    entry = '';
    writeStored(ROLE_KEY, role, window.sessionStorage);
    dropStored(LOCK_KEY, window.localStorage);
    if(lockTimer){ clearInterval(lockTimer); lockTimer = null; }
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('focusin', onFocusIn, true);
    if(padEl) padEl.removeEventListener('click', onPadClick);
    applyRole();
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
    applyRole();
    renderDots();
    tickLockout();
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    if(padEl) padEl.addEventListener('click', onPadClick);
    /* Focus a keypad button rather than any text field: a real <input> would
       raise the soft keyboard over the keypad on a phone, and the keypad IS
       the input here. */
    setTimeout(function(){
      var first = gate ? gate.querySelector('.pin-key') : null;
      if(first) first.focus();
    }, 0);
  }

  var stored = readStored(ROLE_KEY, window.sessionStorage);
  if(stored === 'owner' || stored === 'guest') unlock(stored, true);
  else show();

  /* ---- the only things the rest of the app may call ---- */

  /* Resolves with the role once the door is open. An already-unlocked session
     resolves on the first microtask, so waiting on this costs a reload nothing. */
  window.p25GateReady = ready;
  window.p25Role    = function(){ return currentRole; };
  window.p25IsOwner = function(){ return currentRole === 'owner'; };
  window.p25IsGuest = function(){ return currentRole !== 'owner'; }; // unknown fails closed — rule 2
  /* Shuts the door again. A reload rather than merely re-showing the gate:
     by now every tab's data is in memory and in this page's DOM, and drawing a
     panel over all of it would leave it one DevTools pane away. */
  window.p25Lock = function(){
    dropStored(ROLE_KEY, window.sessionStorage);
    window.location.reload();
  };
})();
