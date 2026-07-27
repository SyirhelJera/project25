  /* ================= COUNTDOWNS ================= */
  function renderCountdowns(){
    const list = el('cdList'); list.innerHTML='';
    el('cdEmpty').style.display = state.countdowns.length===0 ? 'block':'none';
    const sorted = state.countdowns.slice().sort((a,b)=> new Date(a.date) - new Date(b.date));
    const now = new Date(); now.setHours(0,0,0,0);
    sorted.forEach(c => {
      const target = new Date(c.date); target.setHours(0,0,0,0);
      const diff = Math.round((target-now)/(1000*3600*24));
      const card = document.createElement('div'); card.className='cd-card';
      card.innerHTML = '<div class="cd-num '+(diff<0?'past':'')+'">'+(diff<0 ? 'past' : diff)+'</div>'
        + '<div class="cd-info"><div class="cd-name">'+escapeHtml(c.label)+'</div><div class="cd-date">'+fmtDate(target.getTime())+(diff>=0 ? ' · ' + diff + ' days left' : '')+'</div></div>'
        + '<button class="rename-btn" title="Rename">✎</button>'
        + '<button class="del-goal">Delete</button>';
      card.querySelector('.del-goal').addEventListener('click', ()=>{ state.countdowns = state.countdowns.filter(x=>x.id!==c.id); save(); renderCountdowns(); });
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
    state.countdowns.push({ id:uid(), label:name, date });
    nameInput.value=''; dateInput.value=''; save(); renderCountdowns();
  });

