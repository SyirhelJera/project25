  /* ================= QUICK ACTIONS =============================================================
     The bottom-right bar (#quickActions), which replaced the mobile tab-switcher FAB. It holds the
     things that have to be doable from whatever tab you happen to be on, at the moment they need
     doing — which today is one thing: the sleep toggle.

     Why a toggle at all, when the Sleep pane already has bed/wake fields. Because those fields are
     a form you fill in afterwards, from memory, and the two times they ask for are exactly the two
     you are least able to type: you press "going to sleep" with the lights already off, and "awake"
     before you are properly awake. So the toggle stamps both ends off the clock, and the pane's
     fields stay for corrections and for backfilling a night the toggle missed.

     Four things hold it up.
       · The pending night is ONE timestamp in state (state.fitness.sleepPending), not a running
         timer — the app is closed for the whole of the thing being measured, so anything held in
         memory would be gone by morning. Elapsed is always (now − that stamp), which is also why a
         phone that slept, a reload, and a different device all agree.
       · It writes through fitness.js's own recordSleepLog(), never straight into state.fitness
         .sleepLog — the record shape (and the rule that a session is filed under the WAKE date)
         has one owner, and a second writer is how the two would drift apart. recordSleepLog()
         always APPENDS: a nap tapped off at 4pm and a full night tapped off at 7am the same day
         both survive as their own record, rather than the second overwriting the first — which is
         also why the toggle never needs to ask "log this as a nap or a night", there is no
         difference in the storage, only in how many sessions a day happens to have.
       · Both ends confirm before writing an implausible night rather than silently recording one:
         a stray tap and a toggle you forgot to end are the two failure modes this control actually
         has, and both produce a number that would quietly poison every average in the pane.
       · The bar is hidden outright for a read-only guest. Guest edits normally *look* applied until
         reload (the standing cost documented in CLAUDE.md), but this control's whole state is one
         write — a toggle that flips, counts up all night and then loses the night is worse than a
         control that was never offered. */

  function sleepPending(){
    const p = state.fitness && state.fitness.sleepPending;
    return (p && p.at) ? p : null;
  }
  // ms since the toggle was pressed, or null. Clamped at zero: a device whose clock was corrected
  // backwards mid-sleep would otherwise render a negative duration in the pill.
  function sleepPendingElapsed(){
    const p = sleepPending(); if(!p) return null;
    const t = Date.parse(p.at);
    if(isNaN(t)) return null;
    return Math.max(0, Date.now() - t);
  }
  // 'HH:MM', the shape sleepLog records store — local, and zero-padded, because clockMins() in
  // fitness.js parses it back with a regex rather than with Date
  function hhmm(d){
    return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }
  function qaElapsedText(ms){
    const mins = Math.floor(ms/60000);
    return Math.floor(mins/60) + 'h ' + String(mins%60).padStart(2,'0') + 'm';
  }

  /* The one-line receipt under the bar. Session-only and never persisted — it says what the tap
     just did, and by morning that is not news. Cleared on a timer rather than on an animation end,
     the .cal-bubble rule: under prefers-reduced-motion the animation never runs and the event
     would never fire. */
  let qaToastTimer = null;
  function qaToast(html){
    const bar = el('quickActions'); if(!bar) return;
    let box = bar.querySelector('.qa-toast');
    if(!box){
      box = document.createElement('div');
      box.className = 'qa-toast';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      bar.insertBefore(box, bar.firstChild);
    }
    box.innerHTML = html;
    if(qaToastTimer) clearTimeout(qaToastTimer);
    qaToastTimer = setTimeout(()=>{ if(box.parentNode) box.parentNode.removeChild(box); qaToastTimer = null; }, 6000);
  }

  function startSleep(){
    const now = new Date();
    state.fitness.sleepPending = { at: now.toISOString() };
    sleepViewDismissed = false;   // a fresh night always gets the cover, even if the last one was set aside
    save();
    renderQuickActions();
    // the Sleep pane's battery starts charging the moment this is pressed, so it has to be told —
    // renderSleep() no-ops when its fields aren't on the page
    if(typeof renderSleep === 'function') renderSleep();
    qaToast('Sleeping since <b>' + escapeHtml(fmtClock(now.getHours()*60 + now.getMinutes()))
      + '</b>. Tap again when you wake up.');
  }

  /* Ending is where the judgement is. Two implausible cases, each confirmed rather than refused —
     both really happen (a nap logged on purpose; a toggle left running through a whole day) and
     only the person pressing it knows which. Cancelling DISCARDS the timer rather than leaving it
     running, because the alternative is a pill that stays stuck on a number you have already
     declined once, with no other way to clear it. */
  const SLEEP_FLOOR_MS = 10 * 60000;    // under this it is not a sleep at all — never recorded
  const SLEEP_MIN_MS = 20 * 60000;      // under this and it reads as a mis-tap
  const SLEEP_MAX_MS = 16 * 3600000;    // over this and the toggle was almost certainly forgotten

  function endSleep(){
    const ms = sleepPendingElapsed();
    if(ms == null){ state.fitness.sleepPending = null; renderQuickActions(); return; }
    const bedAt = new Date(Date.parse(sleepPending().at));
    const wokeAt = new Date();
    const txt = qaElapsedText(ms);
    /* Under ten minutes is not a short night, it is a mis-tap — so it is discarded outright rather
       than confirmed. Asking would be offering to record something the tracker has decided it does
       not hold: sleepDayAgg() sums a date's sessions, so a stray two-minute record doesn't merely
       sit there, it drags that day's average and its goal-hit down. Above the floor and below
       SLEEP_MIN_MS the confirm still stands — a 15-minute doze is a real thing someone might mean. */
    if(ms < SLEEP_FLOOR_MS){
      state.fitness.sleepPending = null;
      save(); renderQuickActions();
      qaToast('Only <b>' + escapeHtml(txt) + '</b> — too short to log, so nothing was recorded.');
      return;
    }
    if(ms < SLEEP_MIN_MS || ms > SLEEP_MAX_MS){
      const why = ms < SLEEP_MIN_MS
        ? 'Only ' + txt + ' since you tapped Sleep.'
        : 'That timer has been running for ' + txt + '.';
      if(!confirm(why + '\n\nOK records it as a night. Cancel discards the timer without logging.')){
        state.fitness.sleepPending = null;
        save(); renderQuickActions();
        qaToast('Timer discarded — nothing logged.');
        return;
      }
    }
    // Filed under the date you WOKE on, which is the rule the whole sleep log is keyed by — so a
    // night crossing midnight lands on one date and a nap ending the same afternoon lands on that
    // day. recordSleepLog() always appends a new record, so a second sleep the same day (a nap,
    // then the real thing) can never overwrite the first one's data.
    const date = localDateStr(wokeAt);
    const mins = Math.round(ms / 60000);
    recordSleepLog(date, { bed: hhmm(bedAt), wake: hhmm(wokeAt), mins });
    state.fitness.sleepPending = null;
    save();
    // the pane is very likely not the visible tab, and renderSleep() no-ops when its fields are
    // absent — calling it keeps the hero and the chart true if you do walk over there
    if(typeof renderSleep === 'function') renderSleep();
    renderQuickActions();
    const goalMins = (typeof sleepGoalHours === 'function' ? sleepGoalHours() : 8) * 60;
    qaToast('Logged <b>' + escapeHtml(fmtDuration(mins)) + '</b> · '
      + escapeHtml(fmtClock(clockMins(hhmm(bedAt))) + ' → ' + fmtClock(clockMins(hhmm(wokeAt))))
      + (mins >= goalMins - 15 ? ' · goal met' : ''));
  }

  function renderQuickActions(){
    const bar = el('quickActions'); if(!bar) return;
    // a guest can't write, so the control is not offered — see the header note
    if(typeof appCanWrite === 'function' && !appCanWrite()){ bar.innerHTML = ''; renderSleepView(); return; }

    const ms = sleepPendingElapsed();
    const running = ms != null;
    const btn = bar.querySelector('[data-qa="sleep"]');
    const html = running
      ? '<span class="qa-live-dot" aria-hidden="true"></span>'
        + '<span class="qa-ico" aria-hidden="true">☀️</span>'
        + '<span class="qa-lbl">Awake</span>'
        + '<span class="qa-sub">' + escapeHtml(qaElapsedText(ms)) + '</span>'
      : '<span class="qa-ico" aria-hidden="true">🌙</span><span class="qa-lbl">Sleep</span>';
    const label = running
      ? 'Wake up — ' + qaElapsedText(ms) + ' asleep so far. Logs the night.'
      : 'Going to sleep — starts the night';

    // The button is reused rather than rebuilt while it is only its contents changing: this
    // re-renders once a minute all night, and replacing the node would drop focus and restart the
    // dot's animation on every tick.
    if(btn){
      btn.className = 'qa-btn' + (running ? ' is-running' : '');
      btn.innerHTML = html;
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
    } else {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.qa = 'sleep';
      b.className = 'qa-btn' + (running ? ' is-running' : '');
      b.innerHTML = html;
      b.setAttribute('aria-label', label);
      b.setAttribute('title', label);
      bar.appendChild(b);
    }
    renderSleepView();
    syncQaTicker();
  }

  /* The pill counts up, so it has to redraw without anything happening. Once a minute is the whole
     of what the display can show, and the interval exists only while a night is actually running —
     a permanent timer on every page in the app to serve a state that is false most of the day is
     the kind of thing that shows up in a battery report. */
  let qaTicker = null;
  function syncQaTicker(){
    const want = sleepPendingElapsed() != null && !document.hidden;
    if(want && !qaTicker) qaTicker = setInterval(renderQuickActions, 60000);
    else if(!want && qaTicker){ clearInterval(qaTicker); qaTicker = null; }
  }
  // A backgrounded tab's interval is throttled or stopped outright, so the elapsed figure is stale
  // by however long the phone was in a pocket — redraw on the way back rather than waiting a minute
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) renderQuickActions(); else syncQaTicker(); });

  /* ================= SLEEP VIEW ================================================================
     The whole screen while a night is running (#sleepOverlay). The reasoning behind covering the
     app rather than adding another pill:

       · There is nothing to do in an app you are asleep in. The one thing worth showing at 3am is
         the time, and the one thing worth pressing is "awake".
       · It is driven by state.fitness.sleepPending and by NOTHING else — no per-device flag, no
         local mirror. That single shared timestamp is what makes this cross-device for free: start
         a night on a phone, open the desktop, and the desktop loads the same stamp and covers
         itself. It is also why the elapsed figure agrees everywhere, since it is always
         (now − that stamp) rather than a timer anyone is running.
       · It is a MODE, not a tab and not a modal, the #scratchOverlay ruling: it never touches
         .nav-item.active / .view.active, so the tab underneath stays rendered and comes back
         untouched on wake, and it sits at body level because a .view would hide it whenever its
         host tab was not the active one.
       · The dismissal is SESSION-ONLY (a module variable, never state) — "use the app anyway"
         means this page load, not this night, or a single late-night lookup would silently uncover
         every device until morning. Reloading brings it back, which is the honest behaviour for a
         night that is genuinely still running.
       · The clock ticks once a SECOND and therefore never calls save() — the elapsed line and the
         clock are derived, so redrawing them costs a shared-row upload of nothing at all. Contrast
         renderQuickActions()'s minute ticker: the pill only shows minutes.

     Note the wake button carries data-qa="sleep" rather than a handler of its own — it is the same
     toggle as the pill, so it goes through the same delegate and gets endSleep()'s confirms and the
     ten-minute floor for free. */
  let sleepViewDismissed = false;
  let sleepViewTicker = null;

  function sleepViewWanted(){
    if(sleepViewDismissed) return false;
    if(typeof appCanWrite === 'function' && !appCanWrite()) return false;  // a guest can't end it
    return sleepPendingElapsed() != null;
  }

  function renderSleepView(){
    const ov = el('sleepOverlay'); if(!ov) return;
    if(!sleepViewWanted()){
      if(ov.style.display !== 'none'){
        ov.style.display = 'none';
        document.documentElement.classList.remove('sleep-locked');
      }
      syncSleepViewTicker();
      return;
    }
    const now = new Date();
    const ms = sleepPendingElapsed();
    const bedAt = new Date(Date.parse(sleepPending().at));
    const clock = el('sleepClock'), date = el('sleepDate'),
          elapsed = el('sleepElapsed'), since = el('sleepSince');
    if(clock) clock.textContent = now.toLocaleTimeString(undefined, {hour:'numeric', minute:'2-digit'});
    if(date) date.textContent = now.toLocaleDateString(undefined, {weekday:'long', day:'numeric', month:'long'});
    if(elapsed) elapsed.textContent = qaElapsedText(ms) + ' asleep';
    if(since) since.textContent = 'Since ' + fmtClock(bedAt.getHours()*60 + bedAt.getMinutes());
    const first = ov.style.display === 'none';
    if(first){
      ov.style.display = '';
      document.documentElement.classList.add('sleep-locked');
      // focus the way out, not the page underneath — but only on a fine pointer: focusing on touch
      // scrolls the element into view, the scratchWantsAutoFocus() rule
      const fine = !window.matchMedia || !window.matchMedia('(pointer:coarse)').matches;
      const wake = ov.querySelector('.sleep-wake');
      if(fine && wake) try{ wake.focus(); }catch(_){}
    }
    syncSleepViewTicker();
  }

  function syncSleepViewTicker(){
    const want = sleepViewWanted() && !document.hidden;
    if(want && !sleepViewTicker) sleepViewTicker = setInterval(renderSleepView, 1000);
    else if(!want && sleepViewTicker){ clearInterval(sleepViewTicker); sleepViewTicker = null; }
  }

  document.addEventListener('click', e=>{
    const t = e.target;
    if(t && t.closest && t.closest('#sleepDismissBtn')){
      sleepViewDismissed = true;
      renderSleepView();
      qaToast('Still counting — the sleep view comes back when you reload.');
    }
  });

  document.addEventListener('click', e=>{
    const btn = e.target && e.target.closest ? e.target.closest('[data-qa="sleep"]') : null;
    if(!btn) return;
    if(sleepPending()) endSleep(); else startSleep();
  });
