  /* ================= COUNTDOWNS ================= */
  function daysLeft(dateStr){
    const now = new Date(); now.setHours(0,0,0,0);
    const target = new Date(dateStr); target.setHours(0,0,0,0);
    return Math.round((target-now)/(1000*3600*24));
  }
  const CD_MOSAIC_MAX_DOTS = 180;
  // dot-matrix data for a countdown's pinned widget: one dot per day from creation to target,
  // bucketed down to CD_MOSAIC_MAX_DOTS for long spans so the grid stays readable
  function mosaicDots(c){
    const start = new Date(c.createdAt); start.setHours(0,0,0,0);
    const target = new Date(c.date); target.setHours(0,0,0,0);
    const totalDays = Math.max(1, Math.round((target-start)/(1000*3600*24)));
    const now = new Date(); now.setHours(0,0,0,0);
    const elapsedDays = Math.max(0, Math.min(totalDays, Math.round((now-start)/(1000*3600*24))));
    const total = Math.min(totalDays, CD_MOSAIC_MAX_DOTS);
    const filled = Math.round((elapsedDays/totalDays) * total);
    // the dot representing "today" — normally the first unfilled dot right after the filled
    // ones; clamped to the last dot for the edge case where the target date is today itself
    // (elapsedDays===totalDays, so every dot already reads as filled)
    const todayIdx = Math.min(filled, total-1);
    return { total, filled, todayIdx };
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

