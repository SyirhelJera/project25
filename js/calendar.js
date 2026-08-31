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
     PREFERENCES ONLY (which calendars, how far ahead, the bubble's horizon, how many cards),
     which is small enough to ride in the shared blob like every other setting.

     The cost of that, stated plainly rather than worked around: there is no offline agenda. Open
     with no network and the pane shows its error line, and no bubble appears.
  ------------------------------------------------------ */

  const CAL_LOOKAHEAD_MAX_DAYS = 60;   // the Edge Function clamps to this too; kept in step by hand
  const CAL_REFETCH_AFTER_MS = 5*60*1000; // entering the pane inside this window reuses what we have
  const CAL_BUBBLE_AUTOHIDE_MS = 12000;
  const CAL_BUBBLE_DEFAULT_DAYS = 7;
  const CAL_BUBBLE_MAX_COUNT = 5;

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
  // renderComparePhotos() in fitness.js and renderValorantStore() in valorant.js.
  function calUnavailable(){ return usingClaudeStorage || !supabaseConfigured; }

  function calLookaheadDays(){
    const n = Math.floor(state.calendar.lookaheadDays);
    if(!isFinite(n) || n < 1) return 14;
    return Math.min(n, CAL_LOOKAHEAD_MAX_DAYS);
  }
  // How far the agenda actually fetches. It has to cover the BUBBLE's horizon as well as the pane's
  // own preference, or picking "next 30 days" in Settings would quietly show countdowns that far out
  // (they're local) while calendar events stopped at day 14 (they're all that was fetched).
  function calAgendaDays(){
    return Math.min(Math.max(calLookaheadDays(), calBubbleDays()), CAL_LOOKAHEAD_MAX_DAYS);
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
      const to = new Date(from.getTime() + calAgendaDays()*86400000);
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

  // "9:00 AM" for a moment in time, using clock.js's formatter so the Calendar pane and the Clock
  // pane one button away never disagree about how a time is written.
  function calFmtClock(ms){
    const d = new Date(ms);
    return fmtTime12(String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'));
  }
  function calEventTime(ev){
    if(ev.allDay) return 'all-day';
    return calFmtClock(ev.startMs);
  }

  // When an event finishes. The Edge Function passes endIso straight through and derives no
  // millisecond twin for it the way it does for the start, so the parsing happens here — with the
  // same 'T00:00:00' appended for an all-day date, since a bare "2026-08-25" parses as UTC and
  // lands on the wrong local day either side of Greenwich. Anything unparseable, or an end that
  // isn't after the start, falls back to the start: a zero-length event is a thing that has already
  // finished, which is exactly how the callers below then treat it, whereas NaN would leak into
  // every comparison it touched.
  function calEventEndMs(ev){
    if(!ev) return 0;
    const ms = Date.parse(ev.allDay ? String(ev.endIso || '') + 'T00:00:00' : String(ev.endIso || ''));
    return (isFinite(ms) && ms > ev.startMs) ? ms : ev.startMs;
  }

  // "now" / "in 25m" / "in 2h 10m" / "tomorrow" / "in 5 days". Anything inside today is a duration,
  // because that's the number you act on; past that a duration stops being readable ("in 168h") and
  // a day count is what you actually want.
  //
  // Days come from countdowns.js's daysLeft(), so they're CALENDAR days rather than 24h chunks —
  // an 8am meeting is "tomorrow" whether it's now 9pm or 2am, which is the whole difference between
  // this reading right and reading nonsense late at night. The one exception is an event inside the
  // next 12 hours that happens to fall after midnight: "in 3h 20m" beats "tomorrow" there.
  function calRelative(ms){
    const mins = Math.round((ms - Date.now())/60000);
    if(mins <= 0) return 'now';
    const days = daysLeft(new Date(ms));
    if(days <= 0) return 'in ' + fmtDurationMinutes(mins);      // still today, however far off
    if(days === 1 && mins < 12*60) return 'in ' + fmtDurationMinutes(mins);
    if(days === 1) return 'tomorrow';
    return 'in ' + days + ' days';
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
    else if(calFetchedAt) status.textContent = 'Last checked ' + new Date(calFetchedAt).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}) + ' · next ' + calAgendaDays() + ' days';
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
        // The row's spine takes the colour of the calendar the event is on, the same value and the
        // same idea as the bubble's — the picker above colour-codes the calendars, and this is the
        // list it filters, so it is the one place those colours are worth anything. Raw accent, not
        // the corrected ink: a 3px band is a shape rather than text, and fidelity to the real colour
        // is exactly what makes two calendars tell apart in a merged agenda.
        if(ev.color){
          const a = calAccentFor(ev.color);
          if(a) row.style.setProperty('--cal-ink', a.accent);
        }
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
      // A toggle, so it has to SAY it is a toggle. .active is a class a screen reader cannot see,
      // and without this you hear "Work, button" whether that calendar is on the agenda or not.
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      // the dot is an element rather than markup because the label beside it is arbitrary user text
      // out of Google, and escapeHtml() does not escape double quotes — same rule as calBubbleCard()
      const dot = document.createElement('span');
      dot.className = 'cal-chip-dot';
      dot.setAttribute('aria-hidden', 'true');
      const lbl = document.createElement('span');
      lbl.textContent = c.summary || c.id;
      btn.appendChild(dot); btn.appendChild(lbl);
      /* Two variables, the same split the bubble makes and for the same reason. --cal-ink is the
         calendar's colour UNTOUCHED, and drives the dot and the chip's border and wash — shapes,
         where fidelity to the real colour is what makes two calendars tell apart. --cal-ink-text is
         that colour dragged to WCAG AA against the card, and is used only where it becomes words.
         The selected chip used to be `background:--cal-ink; color:#fff` with no correction at all:
         white on Google's "Banana" (#fbd75b) is about 1.6:1, which is the exact bug calAccentFor()
         was written for on the bubble and which this strip simply never got. */
      if(c.backgroundColor){
        const a = calAccentFor(c.backgroundColor);
        btn.style.setProperty('--cal-ink', a ? a.accent : c.backgroundColor);
        if(a) btn.style.setProperty('--cal-ink-text', a.ink);
      }
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
     Fires once per page load, from renderAll(), stacking the next bubbleCount events that fall
     within bubbleDays — plus, ahead of them, a "now until" card for the event you are currently in
     (calNowEvent()). It is a body-level sibling of .main (never inside a .view) so it can show from any tab — the same
     reason #valItemPreviewOverlay and #scratchOverlay sit outside theirs.
  --------------------------------------------- */

  /* ✕ dismisses a card for THIS APP OPEN only, and there is deliberately no record of it anywhere.
     Dismissals used to persist as {id,startMs} in state until the event started, which made sense
     while this only looked an hour ahead — waving off "Dentist in 40 minutes" shouldn't have it
     return on every reload for the rest of the hour. Over a seven-day horizon that same rule
     silenced an event for a WEEK, and since ✕ is the obvious way to clear a card off the screen,
     tidying up quietly burned the next few days of reminders with no way back short of the console.

     Nothing replaces it, because nothing needs to: the stack is built once per page load
     (calBubbleShownThisSession) and auto-hides after CAL_BUBBLE_AUTOHIDE_MS, so removing the card
     IS "gone for this session". A session-scoped dismissal list would have been state that no
     second reader ever consults. That also retires a bug it carried — the prune dropped any entry
     whose startMs was past, and an all-day event's startMs is midnight, so dismissing today's
     all-day event never stuck in the first place. */

  // Horizon in days, clamped to the window actually fetched — asking the bubble to look 30 days out
  // while the agenda only pulls 14 would just mean it silently sees nothing past day 14.
  function calBubbleDays(){
    const n = Math.floor(state.calendar.bubbleDays);
    const want = (!isFinite(n) || n < 1) ? CAL_BUBBLE_DEFAULT_DAYS : n;
    return Math.min(want, CAL_LOOKAHEAD_MAX_DAYS);
  }

  /* Countdowns as bubble candidates. A countdown is already shaped like an all-day event — a label
     and a date — so it's mapped onto the same record the rest of this file consumes rather than
     given a parallel code path through the card builder, the sorting and the wording.

     `T00:00:00` for the same reason the Edge Function appends it to an all-day start.date: parsing
     the bare "2026-12-25" reads as UTC and lands on the wrong local day either side of Greenwich.
     `source` is what makes the card show ⏳ instead of 📅 and deep-link to Countdowns rather than
     Calendar; the id is prefixed so it can never collide with a Google event id. */
  function countdownBubbleEvents(){
    if(state.calendar.bubbleCountdowns === false) return [];
    return (state.countdowns || []).map(c=>{
      const startMs = Date.parse(String(c.date || '') + 'T00:00:00');
      if(!isFinite(startMs)) return null;
      return { id:'cd:'+c.id, summary:c.label || '(untitled)', startMs, allDay:true,
               location:'', htmlLink:'', color:'', source:'countdown' };
    }).filter(Boolean);
  }

  // Both sources in one start-ordered list, which is what lets nextCalBubbleEvents() stay a simple
  // walk from the front and lets a countdown and a meeting interleave by date rather than by origin.
  function calBubbleCandidates(){
    return calEvents.concat(countdownBubbleEvents()).sort((a,b)=> a.startMs - b.startMs);
  }

  // How many cards to stack, 1..CAL_BUBBLE_MAX_COUNT (Settings → Tracking → Calendar reminder).
  function calBubbleCount(){
    const n = Math.floor(state.calendar.bubbleCount);
    if(!isFinite(n) || n < 1) return 1;
    return Math.min(n, CAL_BUBBLE_MAX_COUNT);
  }

  /* ---- the "now until" card ----
     The thing you are IN, rather than the thing coming up. Without it the stack goes quiet during
     the one window where it has the most to say: open the app twenty minutes into a two-hour
     meeting and the next thing on the calendar is whatever follows it, so the card reads "in 1h
     40m" and says nothing at all about the block you are actually sitting in — or worse, on an
     empty afternoon, nothing shows at all.

     TIMED EVENTS ONLY. An all-day event is "in progress" from local midnight to local midnight,
     so a "now until" for one would read "now until Tomorrow 12:00 AM", which is noise dressed up
     as urgency — and today's all-day event is already carried by the ordinary card, whose
     calRelative() renders its midnight start as plain "now". Countdowns are excluded for the same
     reason by construction: countdownBubbleEvents() marks them allDay, and they carry no end.

     At most ONE, and it is the one ending SOONEST. Overlapping meetings are real and nothing here
     can tell which of them you are actually in, so the choice is between spending the whole stack
     on that ambiguity or answering the question the card exists to answer — when are you free.
     The earliest end is that answer.

     calEvents arrives start-ordered from the Edge Function, so the walk can BREAK once a start is
     in the future: nothing after it has begun either. */
  function calNowEvent(){
    const now = Date.now();
    let best = null, bestEnd = 0;
    for(const ev of calEvents){
      if(ev.startMs > now) break;
      if(ev.allDay) continue;
      const end = calEventEndMs(ev);
      if(end <= now) continue;
      if(!best || end < bestEnd){ best = ev; bestEnd = end; }
    }
    // A copy, never the record itself: calEvents is the fetched agenda the pane renders from, and
    // stamping source:'now' onto it would follow the event into the agenda rows and the next
    // nextCalBubbleEvents() walk. 'now' is also what keeps it clear of the isCd branch in
    // calBubbleCard(), which tests for source === 'countdown'.
    return best ? Object.assign({}, best, { source:'now' }) : null;
  }

  // "now until 3:00 PM · 25m left". The day is named only when the event doesn't end today, which
  // is rare (a timed event running past midnight) and unreadable without it. fmtDurationMinutes()
  // is clock.js's, so "25m left" is worded exactly as the fasting and time-block counters are.
  function calNowUntilText(ev){
    const end = calEventEndMs(ev);
    const label = calDayLabel(localDateStr(new Date(end)));
    const until = ['now until', label === 'Today' ? '' : label, calFmtClock(end)].filter(Boolean).join(' ');
    const left = Math.round((end - Date.now())/60000);
    return left > 0 ? until + ' · ' + fmtDurationMinutes(left) + ' left' : until;
  }

  // The next N things coming up — calendar events and, if enabled, countdowns — however far off,
  // as long as they land inside the horizon. calBubbleCandidates() hands them over start-ordered,
  // so this is a walk from the front, and the horizon test can BREAK rather than continue since
  // nothing later could qualify either.
  //
  // All-day events count. They were excluded when this only looked an hour ahead — "starts at local
  // midnight" is not something to warn about 40 minutes in advance — but over a week's horizon a
  // holiday or a birthday is exactly the kind of thing "what's next" means, and "in 3 days" reads
  // just as well for one. Today's all-day event is still current rather than past, so it's matched
  // on its DAY rather than on startMs, which sits at midnight and would otherwise test as gone.
  function nextCalBubbleEvents(){
    const now = Date.now();
    const horizon = calBubbleDays();
    const want = calBubbleCount();
    const out = [];
    // What you're in goes first, and deliberately does NOT spend one of the bubbleCount slots:
    // that preference means "how many things coming up to show me", and silently answering it with
    // the meeting you are already sitting in would displace the card it was asked for. It also
    // needs no horizon test — something happening now is inside every horizon.
    const nowEv = calNowEvent();
    if(nowEv) out.push(nowEv);
    const upcoming = [];
    for(const ev of calBubbleCandidates()){
      if(upcoming.length >= want) break;
      // Calendar days, not now+N*24h — the same unit calRelative() speaks in, and the only reading
      // that matches "7 days away". A millisecond horizon cuts off partway through the seventh day,
      // so a 10am meeting a week out was excluded at 08:24 and included at 11:00, while the bubble
      // would have called it "in 7 days" either way.
      const days = daysLeft(new Date(ev.startMs));
      if(days > horizon) break;
      // startMs >= now is also what keeps the in-progress event from appearing twice: the card
      // above is built from exactly the events this test drops.
      if(ev.allDay ? days >= 0 : ev.startMs >= now) upcoming.push(ev);
    }
    return out.concat(upcoming);
  }

  // Called from renderAll(), beside maybeSyncPinterestCategories() — the function already there
  // whose contract is "no-op unless conditions are met". renderAll() runs at the end of load(),
  // which is exactly "when I first open the app". The session flag keeps it to once per page load,
  // so a Backups restore (which calls renderAll() again) can't re-pop it.
  function maybeShowCalendarBubble(){
    if(calBubbleShownThisSession) return;
    if(!state.calendar.bubbleEnabled) return;
    calBubbleShownThisSession = true;
    // No calendar to read (Claude storage, or no Supabase configured) doesn't mean nothing to show:
    // countdowns are local, so the stack still works in those modes when they're switched on.
    if(calUnavailable()){ showCalBubbles(nextCalBubbleEvents()); return; }
    // Async on purpose: the bubbles appear when the function returns, never blocking first paint
    // or hideLoadScreen(). Errors are already captured into calError for the pane to show.
    fetchCalendarAgenda(false).then(()=> showCalBubbles(nextCalBubbleEvents()));
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
        const stack = el('calBubbleStack');
        if(stack && stack.children.length && sfxOutput() && sfxCtx.state === 'running') emit();
      };
      window.addEventListener('pointerdown', armed, { once:true });
      window.addEventListener('keydown', armed, { once:true });
      return;
    }
    emit();
  }

  /* The three marks a card can wear, and they are the same three the Time tab's sub-nav wears —
     a clock, an hourglass and a calendar mean one thing each wherever they appear, so the icon on
     a bubble already tells you which pane its card will take you to.

     Inline SVG in the app's 24x24 currentColor idiom, not the ⏱ ⏳ 📅 these used to be. Two reasons
     an emoji cannot do this job: it is drawn by the platform in its own colours, so it could take
     neither the chip's contrast-corrected ink nor the theme's, and it sat on a chip filled with the
     RAW calendar colour — a multicoloured glyph on pale yellow, which is the same failure
     calAccentFor() exists to prevent one screen over.

     These are constants with no interpolation, which is the only reason innerHTML is allowed near
     this file at all — everything carrying event text below is still built as elements. */
  const CAL_ICONS = {
    calendar: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">'
      + '<rect x="3.3" y="5.3" width="17.4" height="15.4" rx="2.6" stroke="currentColor" stroke-width="1.9"/>'
      + '<path d="M3.3 10.1h17.4" stroke="currentColor" stroke-width="1.9"/>'
      + '<path d="M8.3 3.3v3.6M15.7 3.3v3.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    countdown: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">'
      + '<path d="M6.4 3.4h11.2M6.4 20.6h11.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'
      + '<path d="M7.8 3.4c0 4.2 4.2 5.4 4.2 8.6 0 3.2-4.2 4.4-4.2 8.6" stroke="currentColor" stroke-width="1.9"/>'
      + '<path d="M16.2 3.4c0 4.2-4.2 5.4-4.2 8.6 0 3.2 4.2 4.4 4.2 8.6" stroke="currentColor" stroke-width="1.9"/></svg>',
    now: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">'
      + '<circle cx="12" cy="12" r="8.6" stroke="currentColor" stroke-width="1.9"/>'
      + '<path d="M12 7.2V12l3.2 2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  // One card per event. Built as elements with textContent rather than interpolated markup: the
  // summary comes from Google and is arbitrary user text, and escapeHtml() does not escape double
  // quotes, so it must never reach an attribute.
  function calBubbleCard(ev, index){
    const box = document.createElement('div');
    // A countdown deep-links to the Countdowns pane, not the Calendar one — sending you to an
    // agenda that doesn't contain the thing you just clicked would be a dead end.
    const isCd = ev.source === 'countdown';
    // The event you are currently in. It stays a Calendar card in every mechanical sense — same
    // colour, same deep link, same handlers — and differs only in what its second line says and
    // how loudly the card says it, which is why this is one class rather than a second builder.
    const isNow = ev.source === 'now';
    box.className = 'cal-bubble' + (isNow ? ' is-now' : '');
    box.tabIndex = 0;
    box.dataset.subtab = isCd ? 'countdowns' : 'calendar';
    box.title = isCd ? 'Open the Countdowns tab' : 'Open the Calendar tab';
    // Staggered entry, so a stack of three reads as arriving rather than as one block appearing.
    // The CSS pairs this with animation-fill-mode:both — without it a delayed card would sit at its
    // FINAL state through the delay and then jump back to the start.
    box.style.animationDelay = (index * 0.07) + 's';
    // A countdown has no Google calendar behind it to take a colour from, so it gets the app's own
    // accent — which also makes the two kinds of card tell apart at a glance, alongside the icon.
    // var(--violet) rather than a resolved hex: it is already a themed token the app uses for body
    // text elsewhere, so it needs none of applyCalBubbleAccent()'s contrast correction.
    if(isCd){
      box.style.setProperty('--cal-accent', 'var(--violet)');
      box.style.setProperty('--cal-accent-ink', 'var(--violet)');
    } else {
      applyCalBubbleAccent(box, ev.color);
    }

    // The card has TWO targets: the glyph opens the event in Google Calendar, everything else still
    // deep-links into the Time tab. A real <a>, mirroring the agenda row's own ↗ rather than a
    // click handler — it costs nothing and buys middle-click, "open in new tab" and Enter for free.
    // A countdown is local and carries htmlLink:'', so it keeps the plain div and the whole card
    // stays one target exactly as before; the https test is what stops a malformed link becoming a
    // javascript: href, the same rule renderMarkdown() applies in notes.js.
    const iconHref = (!isCd && typeof ev.htmlLink === 'string' && /^https:\/\//i.test(ev.htmlLink))
      ? ev.htmlLink : '';
    const icon = document.createElement(iconHref ? 'a' : 'div');
    icon.className = 'cal-bubble-icon' + (iconHref ? ' is-link' : '');
    if(iconHref){
      icon.href = iconHref;
      icon.target = '_blank'; icon.rel = 'noopener noreferrer';
      // Focusable, so it must NOT be aria-hidden — an aria-hidden node in the tab order is one a
      // screen reader is required to skip and then asked to focus. The label is to the icon what
      // the card's title attribute is to the body.
      icon.setAttribute('aria-label', 'Open in Google Calendar');
      icon.title = 'Open in Google Calendar';
    } else {
      icon.setAttribute('aria-hidden', 'true');
    }
    icon.innerHTML = isNow ? CAL_ICONS.now : (isCd ? CAL_ICONS.countdown : CAL_ICONS.calendar);

    const body = document.createElement('div');
    body.className = 'cal-bubble-body';
    const title = document.createElement('div');
    title.className = 'cal-bubble-title';
    title.textContent = ev.summary || '(no title)';
    const when = document.createElement('div');
    when.className = 'cal-bubble-when';
    if(isNow){
      // The END is the useful number for something already under way. calRelative() would render
      // this event's start as a bare "now" followed by a start time that has already gone by,
      // which reads as a card that arrived late rather than as one describing what you're in.
      when.textContent = calNowUntilText(ev);
    } else {
      // The date is only spelled out when the relative phrase doesn't already imply it: "in 25m ·
      // 9:00 AM" and "tomorrow · 9:00 AM" need no date, but "in 5 days · 9:00 AM" is useless without
      // one. calDayLabel() is reused so the bubble names a day exactly as the agenda behind it does.
      const label = calDayLabel(localDateStr(new Date(ev.startMs)));
      const dated = (label === 'Today' || label === 'Tomorrow') ? '' : label;
      // A countdown gets no time at all. It is stored as a date with no clock time, so calEventTime()
      // would render the literal word "all-day" — true of the underlying record, and meaningless as a
      // thing to read on a card counting down to a birthday.
      const timePart = isCd ? '' : calEventTime(ev);
      when.textContent = [calRelative(ev.startMs), [dated, timePart].filter(Boolean).join(' ')]
        .filter(Boolean).join(' · ');
    }
    body.appendChild(title); body.appendChild(when);

    const close = document.createElement('button');
    close.className = 'cal-bubble-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';

    box.appendChild(icon); box.appendChild(body); box.appendChild(close);
    return box;
  }

  function showCalBubbles(events){
    const stack = el('calBubbleStack'); if(!stack) return;
    // Reset through clearCalBubbles() rather than just blanking the stack, so a previous batch's
    // auto-hide timer and outside-click listener go with it — including on the empty early return
    // below, which would otherwise leave the listener registered against nothing.
    clearCalBubbles();
    if(!events || !events.length) return;
    events.forEach((ev, i)=> stack.appendChild(calBubbleCard(ev, i)));
    // Once for the batch, not once per card — three dings on top of each other is a noise, not a
    // notification.
    playCalBubbleDing();
    clearTimeout(calBubbleTimer);
    calBubbleTimer = setTimeout(hideCalBubbles, CAL_BUBBLE_AUTOHIDE_MS);
    // Registered only while the stack is actually up, and removed again by hideCalBubbles(), rather
    // than left sitting on the document for the whole session doing nothing.
    document.addEventListener('click', onCalOutsideClick, true);
  }
  // Everything that ends a stack's life goes through here first: the auto-hide timer, an outside
  // click, and navigating away from a card. Detaching the listener and killing the timer happen
  // immediately; only the cards themselves wait for their animation.
  function hideCalBubbles(){
    const stack = el('calBubbleStack');
    clearTimeout(calBubbleTimer);
    document.removeEventListener('click', onCalOutsideClick, true);
    if(!stack) return;
    Array.from(stack.children).forEach((card, i)=> leaveCalCard(card, i*0.04));
  }

  // The synchronous version, for showCalBubbles()'s reset. It can't animate: the next batch of
  // cards is appended on the very next line, and cards on their way out would still be in the
  // stack, so a refresh would briefly show both.
  function clearCalBubbles(){
    const stack = el('calBubbleStack');
    clearTimeout(calBubbleTimer);
    document.removeEventListener('click', onCalOutsideClick, true);
    if(stack) stack.innerHTML = '';
  }

  /* Plays a card out and then detaches it. A timer rather than an `animationend` listener, because
     the animation is switched off under prefers-reduced-motion and that event would then never
     fire, leaving the card on screen forever — the removal must not depend on the decoration
     happening. For the same reason the reduced-motion case detaches straight away instead of
     sitting through a delay that animates nothing. */
  const CAL_BUBBLE_OUT_MS = 220;
  function calReducedMotion(){
    try{ return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(_){ return false; }
  }
  function leaveCalCard(card, delaySec){
    if(!card || card.classList.contains('is-leaving')) return;
    if(calReducedMotion()){ card.remove(); return; }
    const delay = delaySec || 0;
    card.style.animationDelay = delay + 's';
    card.classList.add('is-leaving');
    setTimeout(()=> card.remove(), CAL_BUBBLE_OUT_MS + delay*1000);
  }

  /* Getting on with anything else takes the stack down — it's a notification, not something to
     dismiss card by card before you can carry on.
     CAPTURE phase, deliberately. In the bubble phase this runs after the stack's own handler, and
     that handler REMOVES the card when ✕ is hit — so by the time the event reached here the button
     would already be detached from the document, closest('#calBubbleStack') would find nothing, and
     dismissing one card would read as a click outside and take the whole stack with it. Capture
     runs before any of that, while the target is still where it was clicked. */
  function onCalOutsideClick(e){
    if(e.target && e.target.closest && e.target.closest('#calBubbleStack')) return;
    hideCalBubbles();
  }

  function openCalBubbleTarget(subtab){
    hideCalBubbles();
    // Reuses nav.js's own click ladder rather than reimplementing it, exactly as insGoTo() does —
    // the ladder runs every tab's teardown (stopping the Live Match poll, resetting goalFilter, …).
    // The sub-tab is applied AFTER that click, never instead of it: the ladder itself calls
    // showTimeSubTab('clock'), so anything set first is immediately overwritten.
    const item = document.querySelector('.nav-item[data-tab="time"]');
    if(item) item.click();
    showTimeSubTab(subtab === 'countdowns' ? 'countdowns' : 'calendar');
    window.scrollTo({ top:0 });
  }

  /* Delegated from the stack, because the cards are rebuilt on every show — per-card listeners
     would have to be re-attached each time, and the old ones would leak. */
  el('calBubbleStack').addEventListener('click', e=>{
    const card = e.target.closest('.cal-bubble');
    if(!card) return;
    // The ✕ sits INSIDE the card, and the card itself is the click target, so dismissing has to
    // stop here or it would also navigate — the exact opposite of what ✕ means. Nothing is recorded
    // and nothing is saved: see the note above nextCalBubbleEvents() for why ✕ is session-only.
    if(e.target.closest('.cal-bubble-close')){
      leaveCalCard(card);
      // Counts the cards NOT already on their way out — the dismissed one lingers in the DOM for
      // the length of its animation, so children.length would still include it and the last card
      // dismissed would never clear the timer.
      if(!el('calBubbleStack').querySelector('.cal-bubble:not(.is-leaving)')){
        clearTimeout(calBubbleTimer);
        document.removeEventListener('click', onCalOutsideClick, true);
      }
      return;
    }
    // The icon is an <a>, so the browser is already opening Google Calendar — this only has to stop
    // the card's own in-app navigation firing as well and yanking the Time tab up behind the new
    // one. Taking the stack down is DEFERRED a tick on purpose: hideCalBubbles() detaches the cards
    // synchronously under prefers-reduced-motion, and removing the anchor the browser is mid-way
    // through following can cancel the navigation outright.
    if(e.target.closest('.cal-bubble-icon.is-link')){
      setTimeout(hideCalBubbles, 0);
      return;
    }
    openCalBubbleTarget(card.dataset.subtab);
  });
  // The cards are divs, so they get none of a button's keyboard behaviour for free. Space is
  // preventDefault'd alongside Enter, or activating one also scrolls the page behind.
  el('calBubbleStack').addEventListener('keydown', e=>{
    if(e.key !== 'Enter' && e.key !== ' ') return;
    if(!e.target.closest('.cal-bubble')) return;
    // The icon link is a real anchor and Enter already activates it — intercepting here would
    // replace "open the event" with "open the tab", which is the opposite of what it was focused
    // for. Left alone so the browser's own behaviour runs, preventDefault() included.
    if(e.target.closest('.cal-bubble-icon.is-link')) return;
    e.preventDefault();
    if(e.target.closest('.cal-bubble-close')) e.target.click();
    else openCalBubbleTarget(e.target.closest('.cal-bubble').dataset.subtab);
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
