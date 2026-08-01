  /* ================= PROTECTED DAYS (vacation/sick/event) ================= */
  // Global exemption list (Settings tab) — a day covered by any entry here doesn't count against
  // habit streaks (js/habits.js) or checklist miss-streaks (js/checklists.js). See README.md.
  const PROTECTED_TYPE_LABELS = { vacation:'Vacation', sick:'Sick', event:'Event' };
  const PROTECTED_TYPE_ICONS  = { vacation:'🏖️', sick:'🤒', event:'📅' };

  // true if the closed range [startStr,endStr] shares at least one day with any protected entry.
  // Plain string comparison is safe here — every date is already a zero-padded YYYY-MM-DD
  // (localDateStr's own output, or a raw <input type="date"> value), so lexicographic order
  // matches chronological order with no Date parsing needed.
  function dateRangeOverlapsProtected(startStr, endStr){
    return state.protectedDays.some(p => startStr <= p.endDate && endStr >= p.startDate);
  }
  function isDateProtected(dateStr){ return dateRangeOverlapsProtected(dateStr, dateStr); }

  function renderProtectedDays(){
    const listEl = el('protectedDayList'), emptyEl = el('protectedDayEmpty');
    listEl.innerHTML = '';
    emptyEl.style.display = state.protectedDays.length===0 ? 'block' : 'none';

    const note = el('protectedDayTodayNote');
    const todayProtected = isDateProtected(localDateStr(new Date()));
    note.style.display = todayProtected ? 'block' : 'none';
    if(todayProtected) note.textContent = '✓ Today is currently a protected day — streaks and miss-streaks are excused.';

    state.protectedDays.slice().sort((a,b)=> a.startDate < b.startDate ? 1 : -1).forEach(p=>{
      const range = p.startDate === p.endDate
        ? fmtDate(parseLocalDateStr(p.startDate).getTime())
        : fmtDate(parseLocalDateStr(p.startDate).getTime()) + ' – ' + fmtDate(parseLocalDateStr(p.endDate).getTime());
      const card = document.createElement('div'); card.className = 'cd-card';
      card.innerHTML = '<div class="cd-num" style="font-size:22px;">'+(PROTECTED_TYPE_ICONS[p.type]||'📅')+'</div>'
        + '<div class="cd-info"><div class="cd-name">'+escapeHtml(PROTECTED_TYPE_LABELS[p.type]||'Event')+(p.label?' · '+escapeHtml(p.label):'')+'</div><div class="cd-date">'+range+'</div></div>'
        + '<button class="del-goal">Delete</button>';
      card.querySelector('.del-goal').addEventListener('click', ()=>{
        if(!window.confirm('Delete this protected day entry?')) return;
        state.protectedDays = state.protectedDays.filter(x=>x.id!==p.id);
        save(); renderProtectedDays(); renderHabits(); renderChecklists();
      });
      listEl.appendChild(card);
    });
  }

  function addProtectedDay(){
    const startDate = el('pdStart').value;
    if(!startDate) return;
    let endDate = el('pdEnd').value || startDate;
    if(endDate < startDate) endDate = startDate;
    state.protectedDays.push({ id:uid(), type: el('pdType').value, label: el('pdLabel').value.trim(), startDate, endDate, createdAt: Date.now() });
    el('pdStart').value=''; el('pdEnd').value=''; el('pdLabel').value='';
    save(); renderProtectedDays(); renderHabits(); renderChecklists();
  }
  el('addProtectedDayBtn').addEventListener('click', addProtectedDay);
