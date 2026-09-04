  /* ================= HABITS ================= */
  const DAY_LABELS = ['M','T','W','T','F','S','S'];
  // tracks which month each habit's calendar is currently showing (0 = current month, negative = past); not persisted
  const habitMonthOffset = {};
  // how many days of per-day task snapshots are kept - these ride the shared blob (the
  // ACCESS_LOG_CAP reasoning), so the log is trimmed rather than grown forever
  const HABIT_DAY_LOG_CAP = 180;

  /* ---- per-day task log ---------------------------------------------------------------------
     Clicking a day opens a read-out of which linked-checklist tasks were done that day, and the
     only moment that is knowable for a day is while it is still today - a checklist's items are
     wiped by its own reset (applyChecklistResets, js/checklists.js), so nothing about yesterday
     can be reconstructed afterwards. Hence a snapshot, written from save() alongside
     recomputeDailyActivity() and, exactly like it, only ever under *today's* key: past days are
     structurally frozen. Habits with no linked checklist record nothing, so the log stays small.
     Tasks are stored by their text, not their id, because the panel is a record of what that day
     looked like - renaming a task later must not rewrite history. */
  function habitLinkedTasks(h){
    const out = [];
    state.checklists.filter(c=>c.linkedHabitId===h.id).forEach(c=>{
      c.items.forEach(it=>out.push({ t: it.text, d: it.done ? 1 : 0 }));
    });
    return out;
  }
  function recordHabitDayTasks(){
    if(!state.habitDayTasks) state.habitDayTasks = {};
    const ds = localDateStr(new Date());
    const day = {};
    state.habits.forEach(h=>{
      const tasks = habitLinkedTasks(h);
      if(tasks.length) day[h.id] = tasks;
    });
    if(Object.keys(day).length) state.habitDayTasks[ds] = day;
    else delete state.habitDayTasks[ds];
    const keys = Object.keys(state.habitDayTasks).sort();
    if(keys.length > HABIT_DAY_LOG_CAP) keys.slice(0, keys.length - HABIT_DAY_LOG_CAP).forEach(k=>{ delete state.habitDayTasks[k]; });
  }
  // Today reads from the live checklists rather than the snapshot - the snapshot is only as fresh
  // as the last save(), and a tick made a moment ago should show here immediately.
  function habitDayTasksFor(h, ds){
    if(ds === localDateStr(new Date())) return habitLinkedTasks(h);
    const day = (state.habitDayTasks || {})[ds];
    return (day && day[h.id]) || null;
  }

  // Walks backward from `startDate` (inclusive): a real completion counts and continues; a
  // protected-but-uncompleted day (js/protecteddays.js) is skipped — doesn't count, doesn't break
  // the walk; anything else stops it. Read-only — never mutates h.completions.
  function countBackwardStreak(h, startDate){
    let streak = 0;
    let cur = new Date(startDate);
    while(true){
      const ds = localDateStr(cur);
      if(h.completions[ds]) streak++;
      else if(!isDateProtected(ds)) break;
      cur.setDate(cur.getDate()-1);
    }
    return streak;
  }

  function calcStreak(h){
    let cur = new Date(); cur.setHours(0,0,0,0);
    if(!h.completions[localDateStr(cur)]) cur.setDate(cur.getDate()-1);
    return countBackwardStreak(h, cur);
  }

  // "Unresolved" (drives the red pending outline + habitRiskBadge count) means there's still
  // something genuinely unmarked today — not simply "not checked off". A habit linked to a
  // checklist stays unresolved only while at least one linked item is neither done nor
  // Failed/locked (isItemLocked, js/checklists.js) — a Failed item can't be redone today, so it
  // shouldn't keep nagging, even though failing isn't a success and must not mark the habit done.
  function habitIsUnresolved(h){
    if(!h.completions) h.completions = {};
    if(h.completions[localDateStr(new Date())]) return false;
    const linked = state.checklists.filter(c=>c.linkedHabitId===h.id);
    if(!linked.length) return true;
    return linked.some(c=>c.items.some(it=>!it.done && !isItemLocked(it)));
  }
  // habits still unresolved today, regardless of streak status
  function habitsUndone(){
    return state.habits.filter(h => habitIsUnresolved(h));
  }
  function updateHabitReminder(){
    const undone = habitsUndone();
    const badge = el('habitRiskBadge');
    if(undone.length){ badge.style.display = 'inline-flex'; badge.textContent = undone.length; }
    else { badge.style.display = 'none'; }
    // habits at risk are now shown via a red tint directly on their card (see renderHabits)
    // instead of a separate text banner listing them out.
    const banner = el('habitReminderBanner');
    if(banner){ banner.style.display = 'none'; banner.innerHTML = ''; }
  }

  function monthKey(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
  // maps a streak length to a badge color tier — climbs from a muted "just started" tone up
  // through a glowing violet gradient at the 30-day mark, to a shimmering gradient once a streak
  // has been kept alive for 300+ days
  function streakTierClass(streak){
    if(streak>=300) return 'streak-t8';
    if(streak>=150) return 'streak-t7';
    if(streak>=100) return 'streak-t6';
    if(streak>=50) return 'streak-t5';
    if(streak>=30) return 'streak-t4';
    if(streak>=15) return 'streak-t3';
    if(streak>=7) return 'streak-t2';
    if(streak>=3) return 'streak-t1';
    return 'streak-t0';
  }
  function restoresUsedThisMonth(h){
    if(!h.streakRestores) h.streakRestores = {};
    return h.streakRestores[monthKey(new Date())] || 0;
  }
  // Returns the date string of the single missed day that most recently broke an active streak,
  // or null if there's nothing to restore (streak currently alive, protected, or no prior streak
  // existed).
  function habitBrokenGapDate(h){
    const today = new Date(); today.setHours(0,0,0,0);
    if(h.completions[localDateStr(today)]) return null; // today already done, nothing broken
    const yesterday = new Date(today); yesterday.setDate(today.getDate()-1);
    const yStr = localDateStr(yesterday);
    if(h.completions[yStr] || isDateProtected(yStr)) return null; // done or excused — streak alive
    const dayBefore = new Date(yesterday); dayBefore.setDate(yesterday.getDate()-1);
    const priorStreak = countBackwardStreak(h, dayBefore);
    return priorStreak > 0 ? yStr : null;
  }

  /* ---- card stats -------------------------------------------------------------------------
     Everything the expanded card's stats strip shows is derived here rather than inline in
     renderHabits(), so anything else reading these numbers (Insights) calls the same helper
     instead of re-deriving them. All of them count *completions*, never streaks: a day marked
     done counts forever, even once the streak it belonged to has been broken. */
  function habitDoneDates(h){
    const c = h.completions || {};
    return Object.keys(c).filter(ds=>c[ds]).sort();
  }
  // completions in [fromStr,toStr] inclusive — plain string compare, safe because localDateStr()
  // is zero-padded ISO
  function habitDoneBetween(h, fromStr, toStr){
    return habitDoneDates(h).filter(ds => ds>=fromStr && ds<=toStr).length;
  }
  // Longest run ever recorded. A gap made up entirely of protected days is bridged, exactly as
  // countBackwardStreak() does for the live streak — otherwise a holiday would retroactively
  // split a run the current-streak maths still considers whole. The walk terminates on the first
  // unprotected day, so a multi-year gap costs one check, not one per day.
  function habitBestStreak(h){
    const dates = habitDoneDates(h);
    let best = 0, run = 0, prev = null;
    dates.forEach(ds => {
      if(prev){
        const cur = new Date(prev+'T00:00:00');
        cur.setDate(cur.getDate()+1);
        let bridged = true;
        while(localDateStr(cur) < ds){
          if(!isDateProtected(localDateStr(cur))){ bridged = false; break; }
          cur.setDate(cur.getDate()+1);
        }
        run = bridged ? run+1 : 1;
      } else run = 1;
      if(run > best) best = run;
      prev = ds;
    });
    return best;
  }
  // Share of eligible days completed since the habit's first ever completion, or null if it has
  // never been done. Uncompleted protected days are left out of the denominator — they're excused,
  // not missed, which is the same reading streaks give them.
  function habitConsistency(h){
    const dates = habitDoneDates(h);
    if(!dates.length) return null;
    const today = new Date(); today.setHours(0,0,0,0);
    const todayStr = localDateStr(today);
    if(dates[0] > todayStr) return null; // only ever marked ahead of today
    let eligible = 0;
    const cur = new Date(dates[0]+'T00:00:00');
    while(localDateStr(cur) <= todayStr){
      const ds = localDateStr(cur);
      if(h.completions[ds] || !isDateProtected(ds)) eligible++;
      cur.setDate(cur.getDate()+1);
    }
    if(!eligible) return null;
    // days marked ahead of today are excluded, or the rate could read over 100%
    return Math.min(100, Math.round(habitDoneBetween(h, dates[0], todayStr) / eligible * 100));
  }
  const habitShortDate = ds => new Date(ds+'T00:00:00').toLocaleDateString(undefined,{day:'numeric',month:'short'});

  /* ---- sorting ------------------------------------------------------------------------------
     A sort is a *view* over state.habits and never rewrites it — the array's own order stays the
     manual drag order, so switching back to Manual restores exactly what was arranged. That's also
     why dragging is switched off while a sort is active: a drop reorders the underlying array by a
     card's position in a list that isn't showing that array's order, landing the habit somewhere
     other than where it was aimed. Every key comes from a helper above, so a sorted list and the
     stats strip on the card can't disagree about the same number. */
  const HABIT_SORT_KEYS = {
    streak:      x => calcStreak(x),
    best:        x => habitBestStreak(x),
    consistency: x => { const c = habitConsistency(x); return c===null ? -1 : c; },
    total:       x => habitDoneDates(x).length,
    month:       x => { const t = habitToday(); return habitDoneBetween(x, localDateStr(new Date(t.getFullYear(), t.getMonth(), 1)), localDateStr(t)); },
    last:        x => { const last = habitDoneDates(x).filter(ds => ds <= localDateStr(habitToday())).pop(); return last ? new Date(last+'T00:00:00').getTime() : 0; },
    pending:     x => habitIsUnresolved(x) ? 1 : 0,
    name:        x => (x.name || '').toLowerCase()
  };
  // Name reads backwards under the shared 'desc' default, so a mode may name the direction to land
  // on when it is picked; the arrow button flips it from there as usual.
  const HABIT_SORT_DEFAULT_DIR = { name:'asc' };
  function habitToday(){ const d = new Date(); d.setHours(0,0,0,0); return d; }
  function habitSortActive(){ return !!HABIT_SORT_KEYS[state.habitSort.mode]; }
  function sortedHabits(){
    const keyOf = HABIT_SORT_KEYS[state.habitSort.mode];
    if(!keyOf) return state.habits;
    const factor = state.habitSort.dir === 'asc' ? 1 : -1;
    // decorate–sort–undecorate: habitBestStreak()/habitConsistency() walk every day since a habit's
    // first completion, so each key is computed once per habit rather than once per comparison
    return state.habits.map(x => ({ x, k: keyOf(x) }))
      // Array#sort is stable, so equal keys fall back to the manual order on their own
      .sort((a,b) => (typeof a.k === 'string' ? a.k.localeCompare(b.k) : a.k - b.k) * factor)
      .map(d => d.x);
  }
  function renderHabitSortBar(){
    el('habitToolbar').style.display = state.habits.length ? '' : 'none';
    el('habitSortSelect').value = state.habitSort.mode;
    const dirBtn = el('habitSortDirBtn');
    dirBtn.textContent = state.habitSort.dir === 'asc' ? '↑' : '↓';
    dirBtn.disabled = !habitSortActive();
  }

  /* drag-to-reorder habits — registered once, delegated over #habitList */
  let draggedHabitId = null;
  const habitListEl = el('habitList');
  habitListEl.addEventListener('dragstart', e=>{
    if(habitSortActive()) return; // the list on screen isn't state.habits' own order — see sortedHabits()
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

  // Expanding centers the card on screen (scrollCardIntoCenter, js/core.js). renderHabits() throws
  // away every card node, so the element has to be re-queried by id — rAF lets the new layout
  // settle before it's measured. Collapsing never scrolls.
  function setHabitCollapsed(h, collapsed){
    // only one habit stays open at a time — expanding one minimizes the rest
    if(collapsed) h.collapsed = true;
    else state.habits.forEach(x=>{ x.collapsed = (x.id !== h.id); });
    save(); renderHabits();
    if(collapsed) return;
    requestAnimationFrame(()=> scrollCardIntoCenter(habitListEl.querySelector('.habit-card[data-habit-id="'+h.id+'"]')));
  }

  /* ---- day detail modal ---------------------------------------------------------------------
     Clicking a day opens this rather than toggling the day, and rather than growing the card:
     the card is already a wall of stats and calendars, and the read-out is a detour, not part of
     the card. It rides the shared .struggle-overlay modal shell (1000 tier) and is built at body
     level, so renderHabits() rebuilding every card underneath can't take it down with them --
     which is why the overlay is refreshed by renderHabitDayModal() rather than re-created.

     Tasks are editable for any day, and the two directions are not the same write. TODAY goes
     through checklists.js's setItemDone(), so ticking here carries the same XP, gate and
     habit-link side effects as ticking on the Checklists tab -- there is no second definition of
     what checking a box means. A PAST day has no live item to tick (its checklist was wiped by
     its own reset long ago), so it writes the snapshot in state.habitDayTasks, which is the only
     record that day has. Filling in a past day therefore never touches today's checklist. */
  let habitDayModal = null;      // {habitId, ds} while open

  // The unified row list the modal renders. For today the rows carry live {c,it} refs; for a past
  // day they carry the snapshot index instead, and `live` says which write path applies.
  function habitDayRows(h, ds){
    if(ds === localDateStr(new Date())){
      const rows = [];
      state.checklists.filter(c=>c.linkedHabitId===h.id).forEach(c=>{
        c.items.forEach(it=>rows.push({ text: it.text, done: !!it.done, c, it, live:true }));
      });
      return rows;
    }
    const log = ((state.habitDayTasks || {})[ds] || {})[h.id];
    if(!log) return null;
    return log.map((t,i)=>({ text: t.t, done: !!t.d, idx:i, live:false }));
  }
  // Seeds a past day's record from the habit's linked checklist as it stands now, so a day that
  // predates the log (or one whose checklist gained tasks since) can still be filled in by hand.
  // Everything starts unticked -- this creates a record to edit, it never claims a day was done.
  function seedHabitDayTasks(h, ds){
    const items = [];
    state.checklists.filter(c=>c.linkedHabitId===h.id).forEach(c=>{ c.items.forEach(it=>items.push({ t: it.text, d: 0 })); });
    if(!items.length) return false;
    if(!state.habitDayTasks) state.habitDayTasks = {};
    if(!state.habitDayTasks[ds]) state.habitDayTasks[ds] = {};
    state.habitDayTasks[ds][h.id] = items;
    return true;
  }

  function openHabitDayModal(h, ds){
    habitDayModal = { habitId: h.id, ds };
    if(!el('habitDayOverlay')){
      const ov = document.createElement('div');
      ov.id = 'habitDayOverlay'; ov.className = 'struggle-overlay';
      ov.innerHTML = '<div class="struggle-overlay-card habit-day-card"></div>';
      // backdrop click closes; clicks inside the card must not
      ov.addEventListener('click', e=>{ if(e.target === ov) closeHabitDayModal(); });
      document.body.appendChild(ov);
    }
    renderHabitDayModal();
  }
  function closeHabitDayModal(){
    habitDayModal = null;
    const ov = el('habitDayOverlay');
    if(ov) ov.remove();
    document.removeEventListener('keydown', habitDayKeydown);
  }
  function habitDayKeydown(e){ if(e.key === 'Escape') closeHabitDayModal(); }

  function renderHabitDayModal(){
    const ov = el('habitDayOverlay');
    if(!ov || !habitDayModal) return;
    const h = state.habits.find(x=>x.id === habitDayModal.habitId);
    if(!h){ closeHabitDayModal(); return; }   // habit deleted underneath the modal
    const ds = habitDayModal.ds;
    const todayStr = localDateStr(new Date());
    if(!h.completions) h.completions = {};
    const done = !!h.completions[ds];
    const pd = done ? null : protectedDayFor(ds);
    const rows = habitDayRows(h, ds);
    const hasLink = state.checklists.some(c=>c.linkedHabitId===h.id);
    const dateLbl = new Date(ds+'T00:00:00').toLocaleDateString(undefined,{weekday:'long', day:'numeric', month:'long', year:'numeric'});

    let body;
    if(rows && rows.length){
      const doneCt = rows.filter(r=>r.done).length;
      body = '<div class="habit-day-count">'+doneCt+' of '+rows.length+' tasks done'+(ds===todayStr?'':' \u00b7 tap a task to change it')+'</div>'
        + '<ul class="habit-day-tasks">'
        + rows.map((r,i)=>'<li class="'+(r.done?'is-done':'is-undone')+'"><button class="habit-day-task" data-act="task" data-i="'+i+'">'
            + '<span class="habit-day-mark">'+(r.done?'\u2713':'\u2717')+'</span><span class="habit-day-text">'+escapeHtml(r.text)+'</span></button></li>').join('')
        + '</ul>';
    } else if(rows){
      body = '<div class="habit-day-empty">The linked checklist has no tasks.</div>';
    } else {
      body = '<div class="habit-day-empty">'+(hasLink
        ? 'No task record for this day \u2014 per-day history only goes back as far as the first save after this was added. You can start one from the habit\'s current checklist and tick it in by hand.'
        : 'No checklist is linked to this habit, so there are no tasks to show. Link one from the Checklists tab.')+'</div>'
        + (hasLink ? '<div class="habit-day-actions"><button class="btn habit-day-toggle" data-act="seed">Start a record for this day</button></div>' : '');
    }

    ov.querySelector('.habit-day-card').innerHTML =
        '<div class="struggle-overlay-head">'
        + '<div class="struggle-overlay-title is-neutral">'+escapeHtml(h.name)+'</div>'
        + '<button class="g-icon-btn" data-act="close" title="Close">\u2715</button>'
      + '</div>'
      + '<div class="habit-day-head">'
        + '<div class="habit-day-date">'+dateLbl+(ds===todayStr?' \u00b7 today':'')+'</div>'
        + '<span class="habit-day-status '+(done?'is-done':(pd?'is-protected':'is-missed'))+'">'+(done?'\u2713 Marked done':(pd?'\u2022 Protected day':'\u2717 Not marked done'))+'</span>'
      + '</div>'
      + (pd ? '<div class="habit-day-note"></div>' : '')
      + body
      + '<div class="habit-day-actions"><button class="btn habit-day-toggle" data-act="toggle">'+(done?'Unmark this day':'Mark this day done')+'</button></div>';

    // set, not interpolated - a protected day's note is free user text and escapeHtml() leaves
    // double quotes alone
    if(pd) ov.querySelector('.habit-day-note').textContent = 'Protected day \u2014 ' + protectedDayLabel(pd);

    const card = ov.querySelector('.habit-day-card');
    card.querySelector('[data-act="close"]').addEventListener('click', closeHabitDayModal);
    const toggleBtn = card.querySelector('[data-act="toggle"]');
    if(toggleBtn) toggleBtn.addEventListener('click', ()=>{
      if(h.completions[ds]) delete h.completions[ds]; else h.completions[ds] = true;
      save(); renderHabits(); renderHabitDayModal();
    });
    const seedBtn = card.querySelector('[data-act="seed"]');
    if(seedBtn) seedBtn.addEventListener('click', ()=>{
      if(seedHabitDayTasks(h, ds)){ save(); renderHabitDayModal(); }
    });
    card.querySelectorAll('[data-act="task"]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const r = rows[parseInt(btn.dataset.i, 10)];
        if(!r) return;
        if(r.live){
          // gated items can refuse the tick (getGateItem, js/checklists.js) - setItemDone() saves
          // and syncs the habit link itself, so nothing else to do but repaint
          setItemDone(r.c, r.it, !r.done);
          if(typeof renderChecklists === 'function') renderChecklists();
        } else {
          const log = ((state.habitDayTasks || {})[ds] || {})[h.id];
          if(!log || !log[r.idx]) return;
          log[r.idx].d = log[r.idx].d ? 0 : 1;
          save();
        }
        renderHabits(); renderHabitDayModal();
      });
    });
    document.removeEventListener('keydown', habitDayKeydown);
    document.addEventListener('keydown', habitDayKeydown);
  }

  function renderHabits(){
    const list = el('habitList'); list.innerHTML = '';
    el('habitEmpty').style.display = state.habits.length===0 ? 'block':'none';
    updateHabitReminder();
    renderHabitSortBar();

    const dailiesUndoneCt = buildDailiesQueue().length;
    const playDailiesBtn = el('playDailiesBtn');
    playDailiesBtn.style.display = dailiesUndoneCt ? '' : 'none';

    const today = new Date(); today.setHours(0,0,0,0);
    const weekStart = new Date(today); const wd=(weekStart.getDay()+6)%7; weekStart.setDate(weekStart.getDate()-wd);

    sortedHabits().forEach(h => {
      if(!h.completions) h.completions = {};
      if(!h.streakRestores) h.streakRestores = {};
      const weekDates = [];
      for(let i=0;i<7;i++){ const d = new Date(weekStart); d.setDate(d.getDate()+i); weekDates.push(d); }
      const streak = calcStreak(h);
      const gapDate = habitBrokenGapDate(h);
      const restoresLeft = 3 - restoresUsedThisMonth(h);
      const linkedChecklists = state.checklists.filter(c=>c.linkedHabitId===h.id);
      const doneToday = !!h.completions[localDateStr(today)];
      const unresolved = habitIsUnresolved(h);

      // Unresolved *and* out of restores for the month is the one state where missing today costs
      // the streak outright, so the card gets a caution sign next to the streak — deliberately the
      // only difference, the card wears the same red tint as any other pending habit. Shown
      // collapsed too, since that's where the restores badge isn't rendered.
      const critical = unresolved && restoresLeft<=0;

      const card = document.createElement('div'); card.className='habit-card'+(unresolved?' habit-pending':'')+(h.collapsed?' habit-collapsed':'');
      card.dataset.habitId = h.id;
      // A collapsed card stays status-only — done mark, name, streak. The restores badge, checklist
      // links, streak restore, rename and delete are rendered solely when the card is expanded.
      const top = document.createElement('div'); top.className='habit-top';
      const sorted = habitSortActive();
      top.innerHTML = '<span class="drag-handle'+(sorted?' drag-disabled':'')+'" draggable="'+(sorted?'false':'true')+'" title="'+(sorted?'Switch to Manual order to drag habits':'Drag to reorder')+'">⠿</span>'
        + '<button class="habit-collapse-btn" data-act="collapse" title="'+(h.collapsed?'Expand':'Minimize')+'">'+(h.collapsed?'▶':'▼')+'</button>'
        + (doneToday ? '<span class="habit-status-mark done" title="Completed today">✓</span>' : '')
        + '<div class="habit-name">'+escapeHtml(h.name)+'</div>'
        + (critical ? '<span class="habit-critical-mark" title="Not done today and no streak restores left this month — missing today breaks the streak.">⚠️</span>' : '')
        + (streak>=2 ? '<div class="habit-badge habit-streak '+streakTierClass(streak)+'">🔥 '+streak+' day streak</div>' : '')
        + (h.collapsed ? '' :
            '<div class="habit-badge habit-restores'+(restoresLeft<=0?' habit-restores-empty':'')+'" title="'+(restoresLeft<=0?'No streak restores left this month — missing a day now will break your streak.':'Streak restores let you retroactively fill in one missed day to keep a streak alive. Resets monthly.')+'">'+(restoresLeft<=0?'⚠️':'🔧')+' '+restoresLeft+'/3 restores left</div>'
          + linkedChecklists.map(c=>'<button class="habit-link-btn" data-checklist-id="'+c.id+'" title="Open linked checklist: '+escapeHtml(c.name)+'">🔗</button>').join('')
          + (gapDate && restoresLeft>0 ? '<button class="habit-restore-btn" data-act="restore" title="Retroactively mark the missed day done to restore your streak">🔧 Restore streak ('+restoresLeft+' left)</button>' : '')
          + '<button class="rename-btn" data-act="rename" title="Rename">✎</button>'
          + '<button class="del-goal" data-act="delete" style="margin-left:4px;">Delete</button>');
      top.querySelector('[data-act="collapse"]').addEventListener('click', ()=>{ setHabitCollapsed(h, !h.collapsed); });
      const renameBtn = top.querySelector('[data-act="rename"]');
      if(renameBtn) renameBtn.addEventListener('click', ()=>{
        const nameEl = top.querySelector('.habit-name');
        const input = document.createElement('input');
        input.type = 'text'; input.className = 'rename-input'; input.maxLength = 80; input.value = h.name;
        input.style.flex = '1'; input.style.minWidth = '120px';
        nameEl.replaceWith(input);
        input.focus(); input.select();
        const commit = () => {
          const v = input.value.trim();
          if(v) h.name = v;
          save(); renderHabits();
          // habit names appear in the checklist link dropdowns, so keep those in sync
          if(typeof renderChecklists === 'function') renderChecklists();
        };
        input.addEventListener('keydown', e=>{ if(e.key==='Enter') commit(); if(e.key==='Escape') renderHabits(); });
        input.addEventListener('blur', commit);
      });
      const delBtn = top.querySelector('[data-act="delete"]');
      if(delBtn) delBtn.addEventListener('click', ()=>{
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
          // afterNavPaint() rather than a 60ms guess: the ladder's renderChecklists() is queued
          // there, and the card this scrolls to doesn't exist until it has run.
          afterNavPaint(()=>{
            const targetCard = document.querySelector('.checklist-card[data-checklist-id="'+targetId+'"]');
            if(targetCard){
              targetCard.scrollIntoView({behavior:'smooth', block:'center'});
              targetCard.classList.add('checklist-flash');
              setTimeout(()=>targetCard.classList.remove('checklist-flash'), 1600);
            }
          });
        });
      });
      card.addEventListener('click', e=>{
        if(e.target.closest('button, input, select, a, .drag-handle, .day-box, .month-cell')) return;
        setHabitCollapsed(h, !h.collapsed);
      });
      card.appendChild(top);

      if(!h.collapsed){
        // Stats strip — total days done and the rest of the counts, shown only on an expanded card
        // (the collapsed row stays status-only). These are deliberately independent of the streak
        // badge above: breaking a streak resets that, never these.
        const todayStr = localDateStr(today);
        const doneDates = habitDoneDates(h);
        const monthDone = habitDoneBetween(h, localDateStr(new Date(today.getFullYear(), today.getMonth(), 1)), todayStr);
        const weekDone = habitDoneBetween(h, localDateStr(weekStart), todayStr);
        const weekElapsed = Math.min(7, Math.round((today - weekStart)/86400000) + 1);
        const best = habitBestStreak(h);
        const consistency = habitConsistency(h);
        const lastDone = doneDates.filter(ds=>ds<=todayStr).pop() || null;
        let lastVal = '—', lastSub = 'never';
        if(lastDone){
          const ago = Math.round((today - new Date(lastDone+'T00:00:00'))/86400000);
          lastVal = ago===0 ? 'Today' : ago===1 ? 'Yesterday' : ago+'d ago';
          lastSub = habitShortDate(lastDone);
        }
        const statTile = (val, sub, lbl, title) =>
          '<div class="habit-stat" title="'+title+'">'
          + '<div class="habit-stat-val">'+val+'</div>'
          + '<div class="habit-stat-sub">'+(sub || '&nbsp;')+'</div>'
          + '<div class="habit-stat-lbl">'+lbl+'</div></div>';
        const stats = document.createElement('div'); stats.className='habit-stats';
        stats.innerHTML =
            statTile(doneDates.length, 'all time', 'days done', 'Every day ever marked done, whether or not the streak it belonged to survived.')
          + statTile(monthDone, 'of '+today.getDate(), 'this month', 'Days done so far this calendar month, out of the days elapsed.')
          + statTile(weekDone, 'of '+weekElapsed, 'this week', 'Days done since Monday, out of the days elapsed this week.')
          + statTile(best || '—', (best && best===streak) ? 'at your best' : (best ? 'in a row' : ''), 'best streak', 'Longest run ever recorded. Protected days bridge a gap, just as they do for the current streak.')
          + statTile(consistency===null ? '—' : consistency+'%', doneDates.length ? 'since '+habitShortDate(doneDates[0]) : 'no data', 'consistency', 'Share of days completed since the first one. Protected days you skipped are excused, so they are left out of the maths.')
          + statTile(lastVal, lastSub, 'last done', 'The most recent day marked done.');
        card.appendChild(stats);

        const wgrid = document.createElement('div'); wgrid.className='week-grid';
        weekDates.forEach((d,i)=>{
          const ds = localDateStr(d);
          const checked = !!h.completions[ds];
          const pd = checked ? null : protectedDayFor(ds);
          const cls = checked ? 'checked' : (pd ? 'protected' : '');
          const cell = document.createElement('div'); cell.className='day-cell';
          cell.innerHTML = '<div class="dlabel">'+DAY_LABELS[i]+'</div><div class="day-box '+cls+'">'+(checked?'✓':(pd?'•':''))+'</div>';
          // set, not interpolated — the protected day's note is free user text and escapeHtml()
          // leaves double quotes alone
          if(pd) cell.querySelector('.day-box').title = 'Protected day — ' + protectedDayLabel(pd);
          // clicking a day opens its detail panel - marking the day done/undone moved into that
          // panel's own button, so a stray tap on the calendar can't silently rewrite a streak
          cell.querySelector('.day-box').addEventListener('click', ()=> openHabitDayModal(h, ds));
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
          const pd = checked ? null : protectedDayFor(ds);
          const cell = document.createElement('div');
          cell.className = 'month-cell' + (checked?' checked':(pd?' protected':'')) + (isToday?' today':'');
          if(pd) cell.title = 'Protected day — ' + protectedDayLabel(pd);
          cell.textContent = day;
          cell.addEventListener('click', ()=> openHabitDayModal(h, ds));
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
  el('playDailiesBtn').addEventListener('click', ()=> startDailiesPlaySession());

  el('habitSortSelect').addEventListener('change', e=>{
    state.habitSort.mode = e.target.value;
    state.habitSort.dir = HABIT_SORT_DEFAULT_DIR[state.habitSort.mode] || 'desc';
    save(); renderHabits();
  });
  el('habitSortDirBtn').addEventListener('click', ()=>{
    if(!habitSortActive()) return;
    state.habitSort.dir = state.habitSort.dir === 'asc' ? 'desc' : 'asc';
    save(); renderHabits();
  });

  el('habitTierLegendToggle').addEventListener('click', ()=>{
    const body = el('habitTierLegendBody');
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'flex';
    el('habitTierLegendArrow').textContent = open ? '▾' : '▴';
  });

