  /* ================= HABITS ================= */
  const DAY_LABELS = ['M','T','W','T','F','S','S'];
  // tracks which month each habit's calendar is currently showing (0 = current month, negative = past); not persisted
  const habitMonthOffset = {};

  function calcStreak(h){
    let streak = 0;
    let cur = new Date(); cur.setHours(0,0,0,0);
    if(!h.completions[localDateStr(cur)]) cur.setDate(cur.getDate()-1);
    while(h.completions[localDateStr(cur)]){ streak++; cur.setDate(cur.getDate()-1); }
    return streak;
  }

  // habits with an active streak that haven't been checked off yet today — doing them today keeps the streak alive
  function habitsAtRisk(){
    const todayStr = localDateStr(new Date());
    return state.habits.filter(h => h.completions && !h.completions[todayStr] && calcStreak(h) > 0);
  }
  function updateHabitReminder(){
    const atRisk = habitsAtRisk();
    const badge = el('habitRiskBadge');
    if(atRisk.length){ badge.style.display = 'inline-flex'; badge.textContent = atRisk.length; }
    else { badge.style.display = 'none'; }
    // habits at risk are now shown via an outline directly on their card (see renderHabits)
    // instead of a separate text banner listing them out.
    const banner = el('habitReminderBanner');
    if(banner){ banner.style.display = 'none'; banner.innerHTML = ''; }
  }

  function monthKey(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
  // maps a streak length to a badge color tier — climbs from a muted "just started" tone up to
  // a shimmering gradient once a streak has been kept alive for 300+ days
  function streakTierClass(streak){
    if(streak>=300) return 'streak-t6';
    if(streak>=200) return 'streak-t5';
    if(streak>=100) return 'streak-t4';
    if(streak>=30) return 'streak-t3';
    if(streak>=7) return 'streak-t2';
    if(streak>=3) return 'streak-t1';
    return 'streak-t0';
  }
  function restoresUsedThisMonth(h){
    if(!h.streakRestores) h.streakRestores = {};
    return h.streakRestores[monthKey(new Date())] || 0;
  }
  // Returns the date string of the single missed day that most recently broke an active streak,
  // or null if there's nothing to restore (streak currently alive, or no prior streak existed).
  function habitBrokenGapDate(h){
    const today = new Date(); today.setHours(0,0,0,0);
    if(h.completions[localDateStr(today)]) return null; // today already done, nothing broken
    const yesterday = new Date(today); yesterday.setDate(today.getDate()-1);
    const yStr = localDateStr(yesterday);
    if(h.completions[yStr]) return null; // yesterday done — streak is still alive as of today
    let cur = new Date(yesterday); cur.setDate(cur.getDate()-1);
    let priorStreak = 0;
    while(h.completions[localDateStr(cur)]){ priorStreak++; cur.setDate(cur.getDate()-1); }
    return priorStreak > 0 ? yStr : null;
  }

  /* drag-to-reorder habits — registered once, delegated over #habitList */
  let draggedHabitId = null;
  const habitListEl = el('habitList');
  habitListEl.addEventListener('dragstart', e=>{
    const handle = e.target.closest('.drag-handle');
    if(!handle) return;
    const card = handle.closest('.habit-card');
    draggedHabitId = card ? card.dataset.habitId : null;
    e.dataTransfer.effectAllowed = 'move';
  });
  habitListEl.addEventListener('dragover', e=>{
    if(!draggedHabitId) return;
    e.preventDefault();
    const overCard = e.target.closest('.habit-card');
    habitListEl.querySelectorAll('.habit-card.drag-over').forEach(c=>c.classList.remove('drag-over'));
    if(overCard && overCard.dataset.habitId !== draggedHabitId) overCard.classList.add('drag-over');
  });
  habitListEl.addEventListener('drop', e=>{
    if(!draggedHabitId) return;
    e.preventDefault();
    habitListEl.querySelectorAll('.habit-card.drag-over').forEach(c=>c.classList.remove('drag-over'));
    const overCard = e.target.closest('.habit-card');
    const toId = overCard ? overCard.dataset.habitId : null;
    const fromId = draggedHabitId; draggedHabitId = null;
    if(!toId || toId === fromId) return;
    const fromIdx = state.habits.findIndex(x=>x.id===fromId);
    const toIdx = state.habits.findIndex(x=>x.id===toId);
    if(fromIdx<0 || toIdx<0) return;
    const [moved] = state.habits.splice(fromIdx,1);
    state.habits.splice(toIdx,0,moved);
    save(); renderHabits();
  });
  habitListEl.addEventListener('dragend', ()=>{ draggedHabitId = null; habitListEl.querySelectorAll('.habit-card.drag-over').forEach(c=>c.classList.remove('drag-over')); });

  function renderHabits(){
    const list = el('habitList'); list.innerHTML = '';
    el('habitEmpty').style.display = state.habits.length===0 ? 'block':'none';
    updateHabitReminder();

    const today = new Date(); today.setHours(0,0,0,0);
    const weekStart = new Date(today); const wd=(weekStart.getDay()+6)%7; weekStart.setDate(weekStart.getDate()-wd);

    state.habits.forEach(h => {
      if(!h.completions) h.completions = {};
      if(!h.streakRestores) h.streakRestores = {};
      const weekDates = [];
      for(let i=0;i<7;i++){ const d = new Date(weekStart); d.setDate(d.getDate()+i); weekDates.push(d); }
      const doneCount = weekDates.filter(d=>h.completions[localDateStr(d)]).length;
      const streak = calcStreak(h);
      const gapDate = habitBrokenGapDate(h);
      const restoresLeft = 3 - restoresUsedThisMonth(h);
      const linkedChecklists = state.checklists.filter(c=>c.linkedHabitId===h.id);
      const doneToday = !!h.completions[localDateStr(today)];

      const card = document.createElement('div'); card.className='habit-card'+(doneToday?'':' habit-pending');
      card.dataset.habitId = h.id;
      const top = document.createElement('div'); top.className='habit-top';
      top.innerHTML = '<span class="drag-handle" draggable="true" title="Drag to reorder">⠿</span>'
        + '<button class="habit-collapse-btn" data-act="collapse" title="'+(h.collapsed?'Expand':'Minimize')+'">'+(h.collapsed?'▶':'▼')+'</button>'
        + (doneToday ? '<span class="habit-status-mark done" title="Completed today">✓</span>' : '')
        + '<div class="habit-name">'+escapeHtml(h.name)+'</div>'
        + (streak>=2 ? '<div class="habit-badge habit-streak '+streakTierClass(streak)+'">🔥 '+streak+' day streak</div>' : '')
        + '<div class="habit-badge habit-recap">'+doneCount+'/7 week</div>'
        + '<div class="habit-badge habit-restores'+(restoresLeft<=0?' habit-restores-empty':'')+'" title="'+(restoresLeft<=0?'No streak restores left this month — missing a day now will break your streak.':'Streak restores let you retroactively fill in one missed day to keep a streak alive. Resets monthly.')+'">'+(restoresLeft<=0?'⚠️':'🔧')+' '+restoresLeft+'/3 restores left</div>'
        + (linkedChecklists.length ? linkedChecklists.map(c=>'<button class="habit-link-btn" data-checklist-id="'+c.id+'" title="Open linked checklist: '+escapeHtml(c.name)+'">🔗</button>').join('') : '')
        + (gapDate && restoresLeft>0 ? '<button class="habit-restore-btn" data-act="restore" title="Retroactively mark the missed day done to restore your streak">🔧 Restore streak ('+restoresLeft+' left)</button>' : '')
        + '<button class="del-goal" data-act="delete" style="margin-left:4px;">Delete</button>';
      top.querySelector('[data-act="collapse"]').addEventListener('click', ()=>{ h.collapsed = !h.collapsed; save(); renderHabits(); });
      top.querySelector('[data-act="delete"]').addEventListener('click', ()=>{
        if(!window.confirm('Delete habit "'+h.name+'"? This can\'t be undone.')) return;
        state.habits = state.habits.filter(x=>x.id!==h.id); save(); renderHabits();
      });
      const restoreBtn = top.querySelector('[data-act="restore"]');
      if(restoreBtn){
        restoreBtn.addEventListener('click', ()=>{
          const gd = habitBrokenGapDate(h);
          if(!gd) return;
          if(restoresUsedThisMonth(h) >= 3) return;
          h.completions[gd] = true;
          const key = monthKey(new Date());
          h.streakRestores[key] = (h.streakRestores[key]||0) + 1;
          save(); renderHabits();
        });
      }
      top.querySelectorAll('.habit-link-btn').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          const targetId = btn.dataset.checklistId;
          // expand the target checklist and minimize every other one, so the user lands
          // straight on it without having to hunt through a wall of open checklists
          state.checklists.forEach(c=>{ c.collapsed = (c.id !== targetId); });
          save(); renderChecklists();
          document.querySelector('.nav-item[data-tab="checklists"]').click();
          setTimeout(()=>{
            const targetCard = document.querySelector('.checklist-card[data-checklist-id="'+targetId+'"]');
            if(targetCard){
              targetCard.scrollIntoView({behavior:'smooth', block:'center'});
              targetCard.classList.add('checklist-flash');
              setTimeout(()=>targetCard.classList.remove('checklist-flash'), 1600);
            }
          }, 60);
        });
      });
      card.addEventListener('click', e=>{
        if(e.target.closest('button, input, select, a, .drag-handle, .day-box, .month-cell')) return;
        h.collapsed = !h.collapsed; save(); renderHabits();
      });
      card.appendChild(top);

      if(!h.collapsed){
        const wgrid = document.createElement('div'); wgrid.className='week-grid';
        weekDates.forEach((d,i)=>{
          const ds = localDateStr(d);
          const checked = !!h.completions[ds];
          const cell = document.createElement('div'); cell.className='day-cell';
          cell.innerHTML = '<div class="dlabel">'+DAY_LABELS[i]+'</div><div class="day-box '+(checked?'checked':'')+'">'+(checked?'✓':'')+'</div>';
          cell.querySelector('.day-box').addEventListener('click', ()=>{
            if(h.completions[ds]) delete h.completions[ds]; else h.completions[ds] = true;
            save(); renderHabits();
          });
          wgrid.appendChild(cell);
        });
        card.appendChild(wgrid);

        const mlblRow = document.createElement('div'); mlblRow.className='month-lbl-row';
        const offset = habitMonthOffset[h.id] || 0;
        const viewDate = new Date(today.getFullYear(), today.getMonth()+offset, 1);
        mlblRow.innerHTML = '<button class="month-nav" data-dir="-1" title="Previous month">‹</button>'
          + '<span class="month-lbl-text">'+viewDate.toLocaleDateString(undefined,{month:'long',year:'numeric'})+'</span>'
          + '<button class="month-nav" data-dir="1" title="Next month" '+(offset>=0?'disabled':'')+'>›</button>';
        mlblRow.querySelectorAll('.month-nav').forEach(btn=>{
          btn.addEventListener('click', ()=>{
            const dir = parseInt(btn.dataset.dir, 10);
            const next = offset + dir;
            if(next > 0) return; // never navigate past the current month
            habitMonthOffset[h.id] = next;
            renderHabits();
          });
        });
        card.appendChild(mlblRow);
        const mgrid = document.createElement('div'); mgrid.className='month-grid';
        const y = viewDate.getFullYear(), m = viewDate.getMonth();
        const daysInMonth = new Date(y, m+1, 0).getDate();
        const firstDow = (new Date(y, m, 1).getDay()+6)%7;
        for(let i=0;i<firstDow;i++){ const blank = document.createElement('div'); mgrid.appendChild(blank); }
        for(let day=1; day<=daysInMonth; day++){
          const d = new Date(y, m, day);
          const ds = localDateStr(d);
          const checked = !!h.completions[ds];
          const isToday = ds === localDateStr(today);
          const cell = document.createElement('div');
          cell.className = 'month-cell' + (checked?' checked':'') + (isToday?' today':'');
          cell.textContent = day;
          cell.addEventListener('click', ()=>{
            if(h.completions[ds]) delete h.completions[ds]; else h.completions[ds] = true;
            save(); renderHabits();
          });
          mgrid.appendChild(cell);
        }
        card.appendChild(mgrid);
      }
      list.appendChild(card);
    });
  }
  function addHabit(){
    const input = el('newHabitInput'); const v = input.value.trim();
    if(!v) return;
    state.habits.unshift({ id:uid(), name:v, completions:{}, streakRestores:{} });
    input.value=''; save(); renderHabits();
  }
  el('addHabitBtn').addEventListener('click', addHabit);
  el('newHabitInput').addEventListener('keydown', e=>{ if(e.key==='Enter') addHabit(); });

