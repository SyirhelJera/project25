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
  // GitHub-style 0-4 intensity level from a completion fraction
  function fracToLevel(frac){
    if(frac===null || frac<=0) return 0;
    if(frac<=0.25) return 1;
    if(frac<=0.5) return 2;
    if(frac<=0.75) return 3;
    return 4;
  }

  // dot-matrix data for a countdown's pinned widget: one dot per day from creation to target,
  // bucketed down to maxDots for long spans so the grid stays readable. Each elapsed dot also
  // gets a GitHub-style intensity `level` (0-4) reflecting that day's "dailies" completion (see
  // recomputeDailyActivity() in checklists.js); future dots get level=null. Pass Infinity as
  // maxDots to get one real, unbucketed dot per day (used by the expanded mosaic overlay).
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
    const levels = dateKeys.map((keys, i)=>{
      if(i === todayIdx) return fracToLevel(dailyCompletionFraction(todayKey));
      if(i > filled) return null;
      // exclude today's date from a historical bucket's average so live in-progress data never
      // leaks into an already-elapsed, otherwise-frozen dot
      const pastKeys = keys.filter(k => k !== todayKey);
      return fracToLevel(bucketFraction(pastKeys.length ? pastKeys : keys));
    });
    return { total, filled, todayIdx, levels };
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
  }
  el('addCdBtn').addEventListener('click', ()=>{
    const nameInput = el('newCdName'), dateInput = el('newCdDate');
    const name = nameInput.value.trim(), date = dateInput.value;
    if(!name || !date) return;
    state.countdowns.push({ id:uid(), label:name, date, pinned:false, createdAt:Date.now() });
    nameInput.value=''; dateInput.value=''; save(); renderCountdowns();
  });

