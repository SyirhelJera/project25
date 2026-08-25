  /* ================= GOOGLE CALENDAR =================
     Read-only agenda, third pane of the Time tab (#timetab-calendar). Everything it shows comes
     from the google-calendar Edge Function, which holds the Google credentials server-side — see
     supabase/functions/google-calendar/index.ts for why the OAuth isn't done in the browser.

     THE FETCHED EVENTS DELIBERATELY NEVER TOUCH `state`. They live in the module-level calEvents
     below, the same ruling as the Live Match panel in valorant.js: doSave()'s rest-destructure
     carries any top-level state key into the shared blob, and that blob is re-serialized and
     re-uploaded IN FULL on every save from every tab. A fortnight of events re-sent on every
     unrelated habit tick is exactly what the Jobs/Notes/Scratch split exists to prevent — for data
     that is stale within the hour and one refresh away. `state.calendar` therefore holds
     PREFERENCES ONLY (which calendars, how far ahead, the bubble's lead time, what you dismissed),
     which is small enough to ride in the shared blob like every other setting.

     The cost of that, stated plainly rather than worked around: there is no offline agenda. Open
     with no network and the pane shows its error line, and no bubble appears.
  ------------------------------------------------------ */

  const CAL_LOOKAHEAD_MAX_DAYS = 60;   // the Edge Function clamps to this too; kept in step by hand
  const CAL_REFETCH_AFTER_MS = 5*60*1000; // entering the pane inside this window reuses what we have
  const CAL_BUBBLE_AUTOHIDE_MS = 12000;
  const CAL_DISMISSED_MAX = 50;

  // Memory only — see the header above. calFetchedAt doubles as "have we ever fetched".
  let calEvents = [];
  let calCalendars = [];
  let calFetchedAt = 0;
  let calError = '';
  let calFetching = false;
  let calBubbleShownThisSession = false;
  let calBubbleTimer = null;

  // Edge Functions don't exist inside Claude.ai (window.storage mode) or when Supabase isn't
  // configured at all, so the pane has nothing to call. Same gate and same wording as
  // renderProgressPhotos() in fitness.js and renderValorantStore() in valorant.js.
  function calUnavailable(){ return usingClaudeStorage || !supabaseConfigured; }

  function calLookaheadDays(){
    const n = Math.floor(state.calendar.lookaheadDays);
    if(!isFinite(n) || n < 1) return 14;
    return Math.min(n, CAL_LOOKAHEAD_MAX_DAYS);
  }

  /* ---------- fetching ---------- */

  // Shared error unwrapping: a non-2xx from an Edge Function arrives through supabase-js as a
  // generic "non-2xx status code" message, and the readable one is in the response body — same
  // unwrapping as refreshPinterestCategory() in motivation.js and uploadJobResume() in jobs.js.
  async function calInvoke(body){
    if(!initSupabaseIfNeeded() || !supa) throw new Error('The Supabase connection isn’t available in this copy of the app.');
    const { data, error } = await supa.functions.invoke('google-calendar', { body });
    if(error){
      let detail = '';
      if(error.context && typeof error.context.json === 'function'){
        try{ detail = (await error.context.json())?.error || ''; }catch(_){}
      }
      throw new Error(detail || error.message);
    }
    if(data && data.error) throw new Error(data.error);
    return data || {};
  }

  // force=true is the Refresh button; without it a fetch inside CAL_REFETCH_AFTER_MS is skipped, so
  // flipping between the Time tab's three sub-navs doesn't re-hit the function every time.
  async function fetchCalendarAgenda(force){
    if(calUnavailable() || calFetching) return;
    if(!force && calFetchedAt && (Date.now() - calFetchedAt) < CAL_REFETCH_AFTER_MS) return;
    calFetching = true;
    calError = '';
    renderCalendar();
    try{
      const now = new Date();
      // From local midnight, not from now: an event that started an hour ago is still the thing
      // you're in, and dropping it mid-morning would make today's agenda look wrong.
      const from = new Date(now); from.setHours(0,0,0,0);
      const to = new Date(from.getTime() + calLookaheadDays()*86400000);
      const data = await calInvoke({
        action: 'events',
        calendarIds: state.calendar.calendarIds,
        timeMinIso: from.toISOString(),
        timeMaxIso: to.toISOString()
      });
      calEvents = Array.isArray(data.events) ? data.events : [];
      calFetchedAt = Date.now();
      // A partial read is worth saying out loud — the agenda looks complete either way.
      if(Array.isArray(data.failed) && data.failed.length){
        calError = 'Couldn’t read ' + data.failed.length + ' of your calendars; the rest are shown.';
      }
    }catch(err){
      calError = (err && err.message) || String(err);
    }finally{
      calFetching = false;
      renderCalendar();
    }
  }

  async function fetchCalendarList(){
    if(calUnavailable()) return;
    try{
      const data = await calInvoke({ action: 'calendars' });
      calCalendars = Array.isArray(data.calendars) ? data.calendars : [];
    }catch(err){
      calError = (err && err.message) || String(err);
    }
    renderCalendar();
  }

  /* ---------- shaping ---------- */

  // Groups the flat, start-sorted event list into [{ key, label, events }] by local calendar day.
  // Events already arrive sorted by startMs from the function; all-day ones are floated to the top
  // of their own day because "what day is this" is the only thing they answer.
  function calGroupByDay(events){
    const groups = [];
    const byKey = {};
    events.forEach(ev=>{
      const key = localDateStr(new Date(ev.startMs));
      if(!byKey[key]){ byKey[key] = { key, label: calDayLabel(key), events: [] }; groups.push(byKey[key]); }
      byKey[key].events.push(ev);
    });
    groups.forEach(g=> g.events.sort((a,b)=> (b.allDay?1:0) - (a.allDay?1:0) || a.startMs - b.startMs));
    return groups;
  }

  function calDayLabel(dateKey){
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today.getTime() + 86400000);
    if(dateKey === localDateStr(today)) return 'Today';
    if(dateKey === localDateStr(tomorrow)) return 'Tomorrow';
    // Local midnight, matching how the function derived startMs for an all-day date — parsing the
    // bare "2026-08-25" would read as UTC and could name the wrong weekday.
    const d = new Date(dateKey + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' });
  }

  // "9:00 AM" for a timed event, using clock.js's formatter so the Calendar pane and the Clock
  // pane one button away never disagree about how a time is written.
  function calEventTime(ev){
    if(ev.allDay) return 'all-day';
    const d = new Date(ev.startMs);
    return fmtTime12(String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'));
  }

  // "in 25m" / "in 2h 10m" / "now" — reuses clock.js's fmtDurationMinutes() for the units, so the
  // bubble counts down in the same words the Clock pane one button away uses.
  function calRelative(ms){
    const mins = Math.round((ms - Date.now())/60000);
    if(mins <= 0) return 'now';
    return 'in ' + fmtDurationMinutes(mins);
  }

  /* ---------- the pane ---------- */

  function renderCalendar(){
    const pane = el('timetab-calendar'); if(!pane) return;
    const unavailable = calUnavailable();
    el('calUnavailable').style.display = unavailable ? 'block' : 'none';
    el('calControls').style.display = unavailable ? 'none' : 'flex';
    if(unavailable){ el('calAgenda').innerHTML = ''; el('calStatus').textContent = ''; el('calEmpty').style.display = 'none'; return; }

    renderCalPicker();

    const btn = el('calRefreshBtn');
    btn.disabled = calFetching;
    btn.textContent = calFetching ? 'Refreshing…' : '↻ Refresh';

    const status = el('calStatus');
    if(calError) status.textContent = calError;
    else if(calFetching) status.textContent = 'Reading your calendar…';
    else if(calFetchedAt) status.textContent = 'Last checked ' + new Date(calFetchedAt).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}) + ' · next ' + calLookaheadDays() + ' days';
    else status.textContent = '';
    status.classList.toggle('cal-status-error', !!calError);

    const list = el('calAgenda');
    list.innerHTML = '';
    const groups = calGroupByDay(calEvents);
    el('calEmpty').style.display = (!calFetching && !groups.length) ? 'block' : 'none';

    groups.forEach(g=>{
      const day = document.createElement('div');
      day.className = 'cal-day';
      const head = document.createElement('div');
      head.className = 'cal-day-head' + (g.label === 'Today' ? ' is-today' : '');
      head.textContent = g.label;
      day.appendChild(head);

      g.events.forEach(ev=>{
        const row = document.createElement('div');
        row.className = 'cal-row' + (ev.allDay ? ' is-allday' : '') + (ev.startMs < Date.now() ? ' is-past' : '');
        // Built as elements with textContent rather than interpolated markup: these strings come
        // from Google and are arbitrary user text, and escapeHtml() does not escape double quotes
        // (the same reason updateCountdownReminder() sets its tooltip as a property).
        const time = document.createElement('div');
        time.className = 'cal-row-time';
        time.textContent = calEventTime(ev);
        const main = document.createElement('div');
        main.className = 'cal-row-main';
        const title = document.createElement('div');
        title.className = 'cal-row-title';
        title.textContent = ev.summary || '(no title)';
        main.appendChild(title);
        if(ev.location){
          const loc = document.createElement('div');
          loc.className = 'cal-row-loc';
          loc.textContent = ev.location;
          main.appendChild(loc);
        }
        row.appendChild(time); row.appendChild(main);
        if(ev.htmlLink){
          const open = document.createElement('a');
          open.className = 'cal-row-open';
          open.href = ev.htmlLink;
          open.target = '_blank'; open.rel = 'noopener noreferrer';
          open.textContent = '↗';
          open.title = 'Open in Google Calendar';
          row.appendChild(open);
        }
        day.appendChild(row);
      });
      list.appendChild(day);
    });
  }

  // Which calendars to merge. An empty selection means "just the account's own calendar", which is
  // what the function defaults to as well — so this works before you have ever opened the picker.
  function renderCalPicker(){
    const wrap = el('calPicker'); if(!wrap) return;
    wrap.innerHTML = '';
    if(!calCalendars.length){ wrap.style.display = 'none'; return; }
    wrap.style.display = 'flex';
    const chosen = state.calendar.calendarIds;
    calCalendars.forEach(c=>{
      const on = chosen.length ? chosen.indexOf(c.id) >= 0 : !!c.primary;
      const btn = document.createElement('button');
      btn.type = 'button';
      // .cal-chip and not .finance-subnav-btn: showTimeSubTab() clears .active on every
      // '#view-time .finance-subnav-btn', which would blank these on each sub-tab switch.
      btn.className = 'cal-chip' + (on ? ' active' : '');
      btn.textContent = c.summary || c.id;
      if(c.backgroundColor) btn.style.setProperty('--cal-ink', c.backgroundColor);
      btn.addEventListener('click', ()=>{
        // First click materialises the implicit "primary only" default into a real list, so
        // turning primary OFF is expressible rather than silently reverting to it.
        let ids = chosen.length ? chosen.slice() : calCalendars.filter(x=>x.primary).map(x=>x.id);
        const i = ids.indexOf(c.id);
        if(i >= 0) ids.splice(i,1); else ids.push(c.id);
        state.calendar.calendarIds = ids;
        save();
        fetchCalendarAgenda(true);
      });
      wrap.appendChild(btn);
    });
  }

  /* ---------- the "coming up" bubble ----------
     Fires once per page load, from renderAll(), when something starts within bubbleMinutes. It is a
     body-level sibling of .main (never inside a .view) so it can show from any tab — the same
     reason #valItemPreviewOverlay and #scratchOverlay sit outside theirs.
  --------------------------------------------- */

  // Drops dismissals for events that have already started — they can never fire again, so keeping
  // them would grow a list that rides in the shared blob forever.
  function pruneCalDismissed(){
    const now = Date.now();
    state.calendar.dismissed = (state.calendar.dismissed || [])
      .filter(d => d && typeof d.startMs === 'number' && d.startMs > now)
      .slice(-CAL_DISMISSED_MAX);
  }
  function calIsDismissed(ev){
    return (state.calendar.dismissed || []).some(d => d.id === ev.id && d.startMs === ev.startMs);
  }

  // The soonest timed event starting inside the lead time and not already dismissed. All-day events
  // are skipped: "starts at local midnight" is not a thing to be warned about minutes ahead of.
  function nextCalBubbleEvent(){
    const now = Date.now();
    const until = now + Math.max(1, Math.floor(state.calendar.bubbleMinutes || 60))*60000;
    return calEvents.find(ev => !ev.allDay && ev.startMs >= now && ev.startMs <= until && !calIsDismissed(ev)) || null;
  }

  // Called from renderAll(), beside maybeSyncPinterestCategories() — the function already there
  // whose contract is "no-op unless conditions are met". renderAll() runs at the end of load(),
  // which is exactly "when I first open the app". The session flag keeps it to once per page load,
  // so a Backups restore (which calls renderAll() again) can't re-pop it.
  function maybeShowCalendarBubble(){
    if(calBubbleShownThisSession) return;
    if(calUnavailable() || !state.calendar.bubbleEnabled) return;
    calBubbleShownThisSession = true;
    pruneCalDismissed();
    // Async on purpose: the bubble appears when the function returns, never blocking first paint
    // or hideLoadScreen(). Errors are already captured into calError for the pane to show.
    fetchCalendarAgenda(false).then(()=>{
      const ev = nextCalBubbleEvent();
      if(ev) showCalBubble(ev);
    });
  }

  /* ---- the bubble's colour comes from the calendar the event is on ----
     Google's palette is chosen to look good as small blocks on a white grid, so plenty of it is
     pale — and this bubble uses the accent for a border, a filled chip, body text AND a button
     label. Dropped in raw, "Banana" (#fbd75b) gives white-on-pale-yellow on the View button and
     near-invisible text on the card. So the colour is nudged toward the current theme's contrast
     direction until it reads, and the ink that sits ON it is then picked from its final luminance.
     Nudged rather than replaced: two calendars that differ only in shade must still look different,
     which is the whole point of colouring it. ---- */
  const CAL_HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
  function calParseHex(hex){
    const m = CAL_HEX_RE.exec(String(hex || '').trim());
    if(!m) return null;
    let h = m[1];
    if(h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  }
  // WCAG relative luminance — the perceptual "how light is this", not the naive (r+g+b)/3, which
  // would call pure blue and pure yellow equally light and get every decision below backwards.
  function calLuminance(r,g,b){
    const f = c => { c = c/255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
    return 0.2126*f(r) + 0.7152*f(g) + 0.0722*f(b);
  }
  function calRgbHex(r,g,b){
    const h = n => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2,'0');
    return '#' + h(r) + h(g) + h(b);
  }
  const CAL_MIN_CONTRAST = 4.5; // WCAG AA for normal-size text
  function calContrast(lumA, lumB){
    const hi = Math.max(lumA, lumB), lo = Math.min(lumA, lumB);
    return (hi + 0.05) / (lo + 0.05);
  }
  // The card's own background, read live off the DOM rather than hardcoded per theme — the four
  // themes each define --surface, and reading it means this keeps working if one is ever retuned.
  function calSurfaceLum(){
    try{
      const v = getComputedStyle(document.body).getPropertyValue('--surface');
      const rgb = calParseHex(v);
      if(rgb) return calLuminance(rgb[0], rgb[1], rgb[2]);
    }catch(_){}
    return /dark/.test(state.theme || 'light') ? 0.015 : 1;
  }

  // Returns { accent, ink } or null when there's no usable colour, in which case the caller leaves
  // the CSS default (--success) in place rather than inventing one.
  //
  // Two values, because one hex can't do both jobs. `accent` is the calendar's colour UNTOUCHED —
  // it paints the border, the rings and the icon chip, which are decorative shapes where fidelity
  // to the real colour matters more than contrast, and which is what makes two calendars actually
  // distinguishable. `ink` is that same colour dragged toward the theme until it clears WCAG AA
  // against the card, and is used only for the countdown TEXT. Correcting one shared value for
  // both instead would crush Google's "Banana" to a dark olive just so eleven words of 11.5px
  // text could sit on white.
  function calAccentFor(hex){
    const rgb = calParseHex(hex);
    if(!rgb) return null;
    const accent = calRgbHex(rgb[0], rgb[1], rgb[2]);

    // --- ink: nudge toward readable against the card, in whichever direction the theme needs
    const surfLum = calSurfaceLum();
    const lighten = surfLum < 0.5;
    let [r,g,b] = rgb;
    // The test rounds first, because calRgbHex() is what actually gets emitted and rounding to
    // whole channels can shave the ratio just under the target — which is the difference between
    // 4.50 and a 4.49 that fails the very check this loop exists to satisfy.
    const ratioNow = () => calContrast(calLuminance(Math.round(r), Math.round(g), Math.round(b)), surfLum);
    // Capped so this can't spin on a colour that never reaches the target (a mid grey on a mid
    // background); it then simply returns the closest it got, which still beats the raw value.
    for(let i=0; i<20 && ratioNow() < CAL_MIN_CONTRAST; i++){
      if(lighten){ r += (255-r)*0.16; g += (255-g)*0.16; b += (255-b)*0.16; }
      else { r *= 0.86; g *= 0.86; b *= 0.86; }
    }

    return { accent, ink: calRgbHex(r,g,b) };
  }
  function applyCalBubbleAccent(box, hex){
    const a = calAccentFor(hex);
    if(a){
      box.style.setProperty('--cal-accent', a.accent);
      box.style.setProperty('--cal-accent-ink', a.ink);
    } else {
      // removeProperty, not a hardcoded green: the stylesheet's var(--success) is themed, and
      // re-stating it here would freeze one theme's value onto the element.
      box.style.removeProperty('--cal-accent');
      box.style.removeProperty('--cal-accent-ink');
    }
  }

  /* A small two-note ding on arrival (A5 → E6, plus a quiet octave partial for shimmer).
     It goes through js/checklists.js's sfxTone()/sfxOutput() and MUST keep doing so — never open a
     second AudioContext for it. That rule is recorded in js/goals.js: a second context means a
     second output bus, which is exactly what the compressor on the shared one exists to prevent. */
  function playCalBubbleDing(){
    if(state.calendar.bubbleSound === false) return;
    if(typeof sfxOutput !== 'function' || typeof sfxTone !== 'function') return;
    if(!sfxOutput()) return; // Web Audio blocked or unavailable — the slide-in still carries the arrival

    const emit = ()=>{
      const t = sfxCtx.currentTime;
      sfxTone(880, t, 0.10, 0.30);                          // A5
      sfxTone(1318.51, t + 0.085, 0.13, 0.55);              // E6
      sfxTone(2637.02, t + 0.085, 0.035, 0.34, 'triangle'); // its octave, just for air
    };

    // Every other sound in this app is triggered from inside a click, so its context is already
    // running. This one isn't: the bubble fires on load, and a browser refuses to start an
    // AudioContext before the page has been interacted with at all. Scheduling into that frozen
    // timeline anyway would stack the notes at currentTime 0 and fire them all at once on the next
    // click, minutes later. So wait for that first gesture instead — and ding only if the bubble
    // is still up, so a click that arrives after it auto-hid stays silent.
    if(sfxCtx.state !== 'running'){
      const armed = ()=>{
        window.removeEventListener('pointerdown', armed);
        window.removeEventListener('keydown', armed);
        const box = el('calBubble');
        if(box && box.style.display !== 'none' && sfxOutput() && sfxCtx.state === 'running') emit();
      };
      window.addEventListener('pointerdown', armed, { once:true });
      window.addEventListener('keydown', armed, { once:true });
      return;
    }
    emit();
  }

  function showCalBubble(ev){
    const box = el('calBubble'); if(!box) return;
    el('calBubbleTitle').textContent = ev.summary || '(no title)';
    el('calBubbleWhen').textContent = calRelative(ev.startMs) + ' · ' + calEventTime(ev);
    applyCalBubbleAccent(box, ev.color);
    box.style.display = 'flex';
    box.dataset.eventId = ev.id;
    box.dataset.startMs = String(ev.startMs);
    playCalBubbleDing();
    clearTimeout(calBubbleTimer);
    calBubbleTimer = setTimeout(hideCalBubble, CAL_BUBBLE_AUTOHIDE_MS);
  }
  function hideCalBubble(){
    const box = el('calBubble'); if(!box) return;
    clearTimeout(calBubbleTimer);
    box.style.display = 'none';
  }

  // stopPropagation: the whole card is the click target now, so without this, dismissing would
  // also navigate to the Calendar pane — the exact opposite of what ✕ means.
  el('calBubbleClose').addEventListener('click', e=>{
    e.stopPropagation();
    const box = el('calBubble');
    const id = box.dataset.eventId, startMs = Number(box.dataset.startMs);
    if(id && isFinite(startMs)){
      state.calendar.dismissed.push({ id, startMs });
      pruneCalDismissed();
      save();
    }
    hideCalBubble();
  });

  function openCalBubbleTarget(){
    hideCalBubble();
    // Reuses nav.js's own click ladder rather than reimplementing it, exactly as insGoTo() does —
    // the ladder runs every tab's teardown (stopping the Live Match poll, resetting goalFilter, …).
    // The sub-tab is applied AFTER that click, never instead of it: the ladder itself calls
    // showTimeSubTab('clock'), so anything set first is immediately overwritten.
    const item = document.querySelector('.nav-item[data-tab="time"]');
    if(item) item.click();
    showTimeSubTab('calendar');
    window.scrollTo({ top:0 });
  }
  el('calBubble').addEventListener('click', openCalBubbleTarget);
  // The card is a div, so it gets none of a button's keyboard behaviour for free. Space is
  // preventDefault'd as well as Enter, or activating it also scrolls the page behind.
  el('calBubble').addEventListener('keydown', e=>{
    if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openCalBubbleTarget(); }
  });

  // What showTimeSubTab('calendar') calls. Both fetches are self-limiting — the agenda one skips
  // anything inside CAL_REFETCH_AFTER_MS, and the list is only ever read once per page load — so
  // flipping between the Time tab's three sub-navs costs nothing after the first visit.
  function enterCalendarPane(){
    renderCalendar();
    if(calUnavailable()) return;
    if(!calCalendars.length) fetchCalendarList();
    fetchCalendarAgenda(false);
  }

  el('calRefreshBtn').addEventListener('click', ()=>{
    // The list is refreshed alongside the events: a calendar added in Google since this page loaded
    // should appear in the picker without a reload.
    fetchCalendarList();
    fetchCalendarAgenda(true);
  });
