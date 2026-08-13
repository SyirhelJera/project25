  /* ================= COUNTDOWNS ================= */
  function daysLeft(dateStr){
    const now = new Date(); now.setHours(0,0,0,0);
    const target = new Date(dateStr); target.setHours(0,0,0,0);
    return Math.round((target-now)/(1000*3600*24));
  }
  const CD_MOSAIC_MAX_DOTS = 180;

  // calendar date-keys (localDateStr) each mosaic dot represents — a 1:1 mapping when
  // totalDays<=CD_MOSAIC_MAX_DOTS, otherwise several consecutive dates bucketed into one dot
  function mosaicDotDateKeys(start, totalDays, total){
    const keys = [];
    for(let i=0;i<total;i++){
      const from = Math.floor(i*totalDays/total);
      const to = Math.max(Math.floor((i+1)*totalDays/total), from+1); // exclusive, at least 1 day
      const bucket = [];
      for(let d=from; d<to; d++){
        const dt = new Date(start); dt.setDate(start.getDate()+d);
        bucket.push(localDateStr(dt));
      }
      keys.push(bucket);
    }
    return keys;
  }
  // fraction of that day's "dailies" completed, or null if there's no recorded data for it
  // (predates dailies tracking, or zero dailies items that day) — never a false 0% or 100%
  function dailyCompletionFraction(dateKey){
    const rec = state.dailyActivity && state.dailyActivity[dateKey];
    if(!rec || !rec.total) return null;
    return rec.done / rec.total;
  }
  // averages fraction across a bucket of dates, ignoring no-data dates rather than treating them as 0
  function bucketFraction(dateKeys){
    let sum = 0, n = 0;
    dateKeys.forEach(k=>{ const f = dailyCompletionFraction(k); if(f!==null){ sum+=f; n++; } });
    return n ? sum/n : null;
  }
  // dot-matrix data for a countdown's pinned widget: one dot per day from creation to target,
  // bucketed down to maxDots for long spans so the grid stays readable. Each elapsed dot also
  // gets a completion `pct` (0-100, null for untouched future days) reflecting that day's
  // "dailies" completion (see recomputeDailyActivity() in checklists.js) — rendered as a
  // bottom-to-top liquid fill rather than a flat intensity color, see mosaicDotsHtml() in
  // goals.js. Each dot also gets a `perfect` flag (true only when that dot's day(s) hit 100%)
  // used to render a distinct color/style instead of the fill — see the Settings → Countdown
  // Mosaic Colors "Highlight on/off" toggle. `protecteds[i]` carries the protected-day entry (or
  // null) covering that dot, so the heat map can ring vacation/sick/event days instead of showing
  // them as unfinished. Pass Infinity as maxDots to get one real, unbucketed dot per day (used by
  // the expanded mosaic overlay).
  function mosaicDots(c, maxDots){
    maxDots = maxDots || CD_MOSAIC_MAX_DOTS;
    const start = new Date(c.createdAt); start.setHours(0,0,0,0);
    const target = new Date(c.date); target.setHours(0,0,0,0);
    const totalDays = Math.max(1, Math.round((target-start)/(1000*3600*24)));
    const now = new Date(); now.setHours(0,0,0,0);
    const elapsedDays = Math.max(0, Math.min(totalDays, Math.round((now-start)/(1000*3600*24))));
    const total = Math.min(totalDays, maxDots);
    const filled = Math.round((elapsedDays/totalDays) * total);
    // the dot representing "today" — normally the first unfilled dot right after the filled
    // ones; clamped to the last dot for the edge case where the target date is today itself
    // (elapsedDays===totalDays, so every dot already reads as filled)
    const todayIdx = Math.min(filled, total-1);

    const todayKey = localDateStr(now);
    const dateKeys = mosaicDotDateKeys(start, totalDays, total);
    // per-dot completion fraction (null for untouched future days) — drives both the fill-height
    // percentage and whether that dot counts as a "perfect" (100%) day for the highlight effect
    const fracs = dateKeys.map((keys, i)=>{
      if(i === todayIdx) return dailyCompletionFraction(todayKey);
      if(i > filled) return null;
      // exclude today's date from a historical bucket's average so live in-progress data never
      // leaks into an already-elapsed, otherwise-frozen dot
      const pastKeys = keys.filter(k => k !== todayKey);
      return bucketFraction(pastKeys.length ? pastKeys : keys);
    });
    const pcts = fracs.map(f => f===null ? null : Math.max(0, Math.min(100, Math.round(f*100))));
    // a bucket only reads as perfect if every day inside it was 100% (a partial bucket's average
    // fraction can never reach 1 unless every component day did)
    const perfects = fracs.map(f => f !== null && f >= 1);
    // the protected-day entry (or null) covering each dot — for a bucketed dot, the first one found
    // across the days it spans. Unlike `perfects` this is computed for future dots too: an already
    // logged upcoming vacation should be previewed on the mosaic, not hidden until it arrives.
    const protecteds = dateKeys.map(keys => {
      for(const k of keys){ const p = protectedDayFor(k); if(p) return p; }
      return null;
    });
    return { total, filled, todayIdx, pcts, perfects, protecteds };
  }
  function renderCountdowns(){
    const list = el('cdList'); list.innerHTML='';
    el('cdEmpty').style.display = state.countdowns.length===0 ? 'block':'none';
    const sorted = state.countdowns.slice().sort((a,b)=> new Date(a.date) - new Date(b.date));
    sorted.forEach(c => {
      const diff = daysLeft(c.date);
      const target = new Date(c.date); target.setHours(0,0,0,0);
      const card = document.createElement('div'); card.className='cd-card';
      card.innerHTML = '<div class="cd-num '+(diff<0?'past':'')+'">'+(diff<0 ? 'past' : diff)+'</div>'
        + '<div class="cd-info"><div class="cd-name">'+escapeHtml(c.label)+'</div><div class="cd-date">'+fmtDate(target.getTime())+(diff>=0 ? ' · ' + diff + ' days left' : '')+'</div></div>'
        + '<button class="pin-cd-btn '+(c.pinned?'active':'')+'" title="'+(c.pinned?'Unpin from Goals page':'Pin to Goals page')+'">📌</button>'
        + '<button class="rename-btn" title="Rename">✎</button>'
        + '<button class="del-goal">Delete</button>';
      card.querySelector('.pin-cd-btn').addEventListener('click', ()=>{
        const wasPinned = c.pinned;
        state.countdowns.forEach(x=>x.pinned=false);
        c.pinned = !wasPinned;
        save(); renderCountdowns();
        if(typeof renderGoals === 'function') renderGoals();
      });
      card.querySelector('.del-goal').addEventListener('click', ()=>{ state.countdowns = state.countdowns.filter(x=>x.id!==c.id); save(); renderCountdowns(); if(typeof renderGoals==='function') renderGoals(); });
      card.querySelector('.rename-btn').addEventListener('click', ()=>{
        const nameEl = card.querySelector('.cd-name');
        const input = document.createElement('input');
        input.type = 'text'; input.className = 'rename-input'; input.maxLength = 60; input.value = c.label;
        nameEl.replaceWith(input);
        input.focus(); input.select();
        const commit = () => {
          const v = input.value.trim();
          if(v) c.label = v;
          save(); renderCountdowns();
          if(typeof renderGoals === 'function') renderGoals();
        };
        input.addEventListener('keydown', e=>{ if(e.key==='Enter') commit(); if(e.key==='Escape') renderCountdowns(); });
        input.addEventListener('blur', commit);
      });
      list.appendChild(card);
    });
    updateCountdownReminder();
  }

  /* ---- Nav badge on the Time tab (#cdSoonBadge) — same pattern as goalRiskBadge /
     habitRiskBadge: a count of countdowns landing within CD_SOON_DAYS days. "Past" ones are
     excluded (they're over, nothing to warn about) and today counts as due. Re-checked on a timer
     as well as on render, so it appears/clears across midnight on a page that's been left open —
     the badge is only useful if it's honest about what "3 days left" means right now. ---- */
  const CD_SOON_DAYS = 3;
  function countdownsDueSoon(){
    if(!state || !state.countdowns) return [];
    return state.countdowns.filter(c=>{ const d = daysLeft(c.date); return d>=0 && d<=CD_SOON_DAYS; })
      .sort((a,b)=> new Date(a.date) - new Date(b.date));
  }
  function updateCountdownReminder(){
    const soon = countdownsDueSoon();
    // set as a property, not interpolated markup — escapeHtml() doesn't escape double quotes
    const tip = soon.map(c=>{
      const d = daysLeft(c.date);
      return c.label + ' — ' + (d===0 ? 'today' : d===1 ? 'tomorrow' : 'in ' + d + ' days');
    }).join('\n');

    const badge = el('cdSoonBadge');
    if(badge){
      badge.style.display = soon.length ? 'inline-flex' : 'none';
      badge.textContent = soon.length || '';
      badge.title = tip;
    }
    // the nav badge only says "something in Time is due" — the red ring on the Countdowns toggle
    // says which of the tab's two panes it's about, which matters now that Clock is the default
    // pane and Countdowns isn't what you land on
    const tabBtn = document.querySelector('#view-time .finance-subnav-btn[data-timetab="countdowns"]');
    if(tabBtn){
      tabBtn.classList.toggle('subnav-alert', soon.length > 0);
      tabBtn.title = tip;
    }
  }
  setInterval(updateCountdownReminder, 60000);
  /* ---- Time tab toggle (Countdowns / Clock) — both panes live in #view-time; this swaps which
     one is showing. Kept here rather than in clock.js because countdowns.js owns the view. ---- */
  function showTimeSubTab(key){
    document.querySelectorAll('#view-time .finance-subnav-btn').forEach(b=>b.classList.toggle('active', b.dataset.timetab===key));
    document.querySelectorAll('.timetab').forEach(t=>t.style.display = (t.id==='timetab-'+key) ? '' : 'none');
    if(key==='countdowns') renderCountdowns();
    if(key==='clock') renderClock();
  }
  document.querySelectorAll('#view-time .finance-subnav-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> showTimeSubTab(btn.dataset.timetab));
  });

  el('addCdBtn').addEventListener('click', ()=>{
    const nameInput = el('newCdName'), dateInput = el('newCdDate');
    const name = nameInput.value.trim(), date = dateInput.value;
    if(!name || !date) return;
    state.countdowns.push({ id:uid(), label:name, date, pinned:false, createdAt:Date.now() });
    nameInput.value=''; dateInput.value=''; save(); renderCountdowns();
  });

