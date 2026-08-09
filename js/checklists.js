  /* ================= CHECKLISTS ================= */

  /* ---------- completion celebration: confetti burst + chime ----------
     Fires the instant a checklist becomes fully checked off — whether that happens inside a Play
     session (showPlayComplete / showPlayCheckpoint) or by hand in the regular checklist list.
     Both effects are self-contained (canvas particles, a synthesized Web Audio tone) so there's
     no image/audio asset or external library dependency, and either can silently no-op if the
     browser blocks it (e.g. AudioContext before a user gesture) without breaking anything else. */
  let celebrateAudioCtx = null;
  function playCelebrateChime(){
    try{
      celebrateAudioCtx = celebrateAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const ctx = celebrateAudioCtx;
      if(ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      // three quick ascending notes (C5-E5-G5), each a short decaying sine — reads as a bright
      // "success" chime rather than a flat beep
      [523.25, 659.25, 783.99].forEach((freq, i)=>{
        const t = now + i*0.09;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.22, t+0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, t+0.35);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t); osc.stop(t+0.36);
      });
    }catch(e){ /* Web Audio unavailable/blocked — confetti still carries the celebration */ }
  }

  function fireConfettiBurst(){
    const canvas = document.createElement('canvas');
    canvas.className = 'confetti-canvas';
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const colors = ['#8B5CF6','#F97316','#22C55E','#EF4444','#F5A524','#38BDF8'];
    const originX = canvas.width/2, originY = canvas.height*0.35;
    const particles = Array.from({length:90}, ()=>{
      const angle = Math.random()*Math.PI*2;
      const speed = 4 + Math.random()*7;
      return {
        x: originX, y: originY,
        vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed - 3,
        size: 5 + Math.random()*5,
        color: colors[Math.floor(Math.random()*colors.length)],
        rotation: Math.random()*Math.PI*2,
        spin: (Math.random()-0.5)*0.3,
        life: 1
      };
    });
    const gravity = 0.18;
    let raf = null;
    function tick(){
      ctx.clearRect(0,0,canvas.width,canvas.height);
      let alive = false;
      particles.forEach(p=>{
        if(p.life <= 0) return;
        p.vy += gravity;
        p.x += p.vx; p.y += p.vy;
        p.rotation += p.spin;
        p.life -= 0.012;
        if(p.life > 0){
          alive = true;
          ctx.save();
          ctx.globalAlpha = Math.max(0, p.life);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size*0.6);
          ctx.restore();
        }
      });
      if(alive) raf = requestAnimationFrame(tick);
      else canvas.remove();
    }
    raf = requestAnimationFrame(tick);
    // hard stop as a backstop in case a particle's life value never quite reaches 0
    setTimeout(()=>{ if(raf) cancelAnimationFrame(raf); canvas.remove(); }, 2500);
  }

  function celebrateChecklistComplete(){
    fireConfettiBurst();
    playCelebrateChime();
  }

  function resetKeyFor(freq, d){
    d = d || new Date();
    if(freq === 'daily') return localDateStr(d);
    if(freq === 'weekly'){ const day=(d.getDay()+6)%7; const monday=new Date(d); monday.setDate(d.getDate()-day); return localDateStr(monday); }
    if(freq === 'monthly') return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    if(freq === 'yearly') return String(d.getFullYear());
    return null;
  }
  // Inverse of resetKeyFor(): maps a (freq, key) pair back to the concrete [start,end] YYYY-MM-DD
  // range it identifies, so an outgoing period can be checked against protected days
  // (js/protecteddays.js) before a miss is counted against it. Must stay in sync with
  // resetKeyFor()'s key formats.
  function resetPeriodRange(freq, key){
    if(freq === 'daily') return [key, key];
    if(freq === 'weekly'){
      const monday = parseLocalDateStr(key);
      const sunday = new Date(monday); sunday.setDate(monday.getDate()+6);
      return [key, localDateStr(sunday)];
    }
    if(freq === 'monthly'){
      const [y,m] = key.split('-').map(Number);
      return [key+'-01', localDateStr(new Date(y, m, 0))]; // day 0 of next month = last day of this one
    }
    if(freq === 'yearly') return [key+'-01-01', key+'-12-31'];
    return null;
  }
  function applyChecklistResets(){
    let changed = false;
    state.checklists.forEach(c=>{
      if(!c.resetFreq || c.resetFreq === 'none') return;
      const key = resetKeyFor(c.resetFreq);
      if(c.lastResetKey == null){
        // never synced before (freq just turned on, older saved data, etc.) — just record the
        // current period without wiping anything the user has already checked off. Previously
        // this fell through to the wipe branch below, which could clear a checklist's progress
        // even though its reset day/week/month hadn't actually arrived yet.
        c.lastResetKey = key;
        changed = true;
        return;
      }
      if(c.lastResetKey !== key){
        // record whether each item was completed by the end of the outgoing period before
        // wiping it — this is the only point where a "miss" for that period is knowable, and
        // feeds the struggling-tasks panel (see getStrugglingItems()). Skip the miss penalty
        // entirely when the outgoing period overlapped a protected day (js/protecteddays.js).
        const outgoingRange = resetPeriodRange(c.resetFreq, c.lastResetKey);
        const periodExcused = !!(outgoingRange && dateRangeOverlapsProtected(outgoingRange[0], outgoingRange[1]));
        c.items.forEach(it=>{
          if(it.done) it.missStreak = 0;
          else if(!periodExcused) it.missStreak = (it.missStreak||0) + 1;
          it.done = false;
          it.failed = false;
        });
        c.lastResetKey = key;
        changed = true;
      }
    });
    if(changed) save();
  }
  const FREQ_LABELS = {none:'No reset', daily:'Reset daily', weekly:'Reset weekly', monthly:'Reset monthly', yearly:'Reset yearly'};

  // Tallies today's "dailies"-group completion into state.dailyActivity, keyed by the current
  // calendar day only — called from save() so it's always fresh at persist time, and because it
  // only ever writes *today's* key, past days are structurally frozen once the date rolls over.
  // Feeds the pinned-countdown mosaic's GitHub-style intensity coloring (see mosaicDots()).
  function recomputeDailyActivity(){
    const todayKey = localDateStr(new Date());
    let done = 0, total = 0;
    state.checklists.forEach(c=>{
      if((c.group||'').trim().toLowerCase() !== 'dailies') return;
      total += c.items.length;
      done += c.items.filter(it=>it.done).length;
    });
    if(!state.dailyActivity) state.dailyActivity = {};
    state.dailyActivity[todayKey] = { done, total };
  }

  // if a checklist is linked to a habit and every item on it is checked, mark that habit done for today too
  function syncChecklistHabitLink(c){
    if(!c.linkedHabitId || !c.items.length) return;
    const allDone = c.items.every(it=>it.done);
    if(!allDone) return;
    const h = state.habits.find(x=>x.id===c.linkedHabitId);
    if(h){ if(!h.completions) h.completions={}; h.completions[localDateStr(new Date())] = true; }
  }

  /* drag-to-reorder checklists — registered once, delegated over #checklistList */
  let draggedChecklistId = null;
  let draggedChecklistItemId = null;
  const checklistListEl = el('checklistList');
  checklistListEl.addEventListener('dragstart', e=>{
    const handle = e.target.closest('.drag-handle');
    if(!handle) return;
    const card = handle.closest('.checklist-card');
    draggedChecklistId = card ? card.dataset.checklistId : null;
    e.dataTransfer.effectAllowed = 'move';
  });
  checklistListEl.addEventListener('dragover', e=>{
    if(!draggedChecklistId) return;
    e.preventDefault();
    const overCard = e.target.closest('.checklist-card');
    checklistListEl.querySelectorAll('.checklist-card.drag-over').forEach(c=>c.classList.remove('drag-over'));
    if(overCard && overCard.dataset.checklistId !== draggedChecklistId) overCard.classList.add('drag-over');
  });
  checklistListEl.addEventListener('drop', e=>{
    if(!draggedChecklistId) return;
    e.preventDefault();
    checklistListEl.querySelectorAll('.checklist-card.drag-over').forEach(c=>c.classList.remove('drag-over'));
    const overCard = e.target.closest('.checklist-card');
    const toId = overCard ? overCard.dataset.checklistId : null;
    const fromId = draggedChecklistId; draggedChecklistId = null;
    if(!toId || toId === fromId) return;
    const fromIdx = state.checklists.findIndex(x=>x.id===fromId);
    const toIdx = state.checklists.findIndex(x=>x.id===toId);
    if(fromIdx<0 || toIdx<0) return;
    const [moved] = state.checklists.splice(fromIdx,1);
    state.checklists.splice(toIdx,0,moved);
    save(); renderChecklists();
  });
  checklistListEl.addEventListener('dragend', ()=>{ draggedChecklistId = null; checklistListEl.querySelectorAll('.checklist-card.drag-over').forEach(c=>c.classList.remove('drag-over')); });

  /* which subgroup the sub-nav is filtered to — 'all', or a group key ('' being Ungrouped).
     Not persisted; resets to All on each page load. renderChecklists() falls back to 'all'
     whenever the selected group no longer exists (last checklist in it renamed or deleted). */
  let checklistGroupFilter = 'all';

  /* shared done/undone toggle so the normal checklist row and the Play overlay's ✓ button
     apply the same XP + habit-link side effects instead of duplicating them */
  function setItemDone(c, it, done){
    if(it.done === done) return;
    it.done = done;
    state.checklistExp = done
      ? (state.checklistExp||0) + CHECKLIST_ITEM_EXP
      : Math.max(0, (state.checklistExp||0) - CHECKLIST_ITEM_EXP);
    // Completing a task chips away at its struggle score, so the struggling-tasks panel doesn't
    // stay permanently crowded with old skips/fails once you start succeeding at it again —
    // missStreak already zeroes out at reset time (see applyChecklistResets()); this covers the
    // other two inputs to getStrugglingItems()'s score.
    if(done){
      if(it.skipCount) it.skipCount = Math.max(0, it.skipCount - 1);
      if(it.failCount) it.failCount = Math.max(0, it.failCount - 1);
    }
    syncChecklistHabitLink(c);
    save();
  }

  /* "Failed" (Play overlay only) — unlike Skip, a failed item locks as undone until the
     checklist's own reset (scheduled rollover or manual "Reset all items now") or, for
     checklists with no reset schedule, until the calendar day changes — whichever comes first.
     See applyChecklistResets(), the manual reset button handler, and clearExpiredFailedFlags()
     for where the lock gets cleared. */
  function isItemLocked(it){
    return !!it.failed && it.failedDate === localDateStr(new Date());
  }
  function setItemFailed(c, it){
    it.failed = true;
    it.failedDate = localDateStr(new Date());
    it.failCount = (it.failCount||0) + 1;
    save();
  }
  // failed locks are date-based, independent of any checklist reset schedule, so they need their
  // own daily sweep — applyChecklistResets() only fires for checklists with a resetFreq set
  function clearExpiredFailedFlags(){
    const todayStr = localDateStr(new Date());
    let changed = false;
    state.checklists.forEach(c=>{
      c.items.forEach(it=>{
        if(it.failed && it.failedDate !== todayStr){ it.failed = false; changed = true; }
      });
    });
    if(changed) save();
  }

  /* ---------- Play Checklist (pomodoro-style task runner) ----------
     The session itself (state.playSession = {checklistId, itemId, startedAt, durationSec})
     lives in the persisted state, not a local variable, so it survives reloads and shows up
     on any device that loads this data — remaining time is always derived from startedAt vs.
     Date.now() rather than decremented by the interval, so it reflects real elapsed time even
     if the tab/browser was closed for a while. Only the setInterval handle stays local. */
  let playTimerHandle = null;
  // Minimize is a local, non-persisted view preference — every fresh open/resume starts expanded
  // so the user always lands in full focus mode by default and opts into minimizing explicitly.
  let playMinimized = false;

  function setPlayMinimized(min){
    playMinimized = min;
    el('playOverlay').classList.toggle('minimized', min);
  }

  function resolvePlaySessionRefs(){
    if(!state.playSession) return null;
    const c = state.checklists.find(x=>x.id===state.playSession.checklistId);
    const it = c && c.items.find(x=>x.id===state.playSession.itemId);
    return (c && it) ? {c, it} : null;
  }

  // `fromGesture` is true when a click opened this session (the Play buttons) and false when it's
  // being restored on page load — session music can only start on its own in the first case, see
  // startSessionMusic() in js/music.js.
  function openPlayOverlay(fromGesture){
    if(playTimerHandle) clearInterval(playTimerHandle);
    setPlayMinimized(false);
    el('playBody').style.display = '';
    el('playComplete').style.display = 'none';
    el('playCheckpoint').style.display = 'none';
    el('playMusicSettings').style.display = 'none';
    el('playOverlay').style.display = 'flex';
    renderPlayOverlay();
    startSessionMusic(fromGesture);
    playTimerHandle = setInterval(tickPlayTimer, 1000);
  }

  function startPlaySession(c){
    const first = c.items.find(i=>!i.done && !isItemLocked(i));
    if(!first) return;
    state.playSession = { checklistId: c.id, itemId: first.id, startedAt: Date.now(), durationSec: (first.durationMin||5)*60, sessionStartedAt: Date.now(), log: [], skippedIds: [] };
    save();
    openPlayOverlay(true);
  }

  /* ---------- Combined "Dailies" Play Session (Habits tab) ----------
     Same overlay/timer/log mechanics as a single-checklist Play session above, but the queue
     spans every checklist tagged with the "Dailies" subgroup instead of one checklist's items.
     state.playSession gains `combined:true`, a `queue` of the remaining {checklistId,itemId}
     pairs, and a `totalCt` snapshot of the starting count (progress = log.length+1 of totalCt,
     since log grows by one entry per item handled regardless of check vs skip). */
  function buildDailiesQueue(){
    const queue = [];
    state.checklists.forEach(c=>{
      if((c.group||'').trim().toLowerCase() !== 'dailies') return;
      c.items.forEach(it=>{ if(!it.done && !isItemLocked(it)) queue.push({ checklistId: c.id, itemId: it.id }); });
    });
    return queue;
  }

  // live done/total across every "Dailies" checklist (not just this session's starting queue) —
  // so the combined Play overlay's overall bar reflects items that were already done before the
  // session started, not just what's been handled since pressing Play
  function dailiesOverallProgress(){
    let done = 0, total = 0;
    state.checklists.forEach(c=>{
      if((c.group||'').trim().toLowerCase() !== 'dailies') return;
      total += c.items.length;
      done += c.items.filter(i=>i.done).length;
    });
    return { done, total };
  }

  function startDailiesPlaySession(){
    const queue = buildDailiesQueue();
    if(!queue.length) return;
    const first = queue.shift();
    const c = state.checklists.find(x=>x.id===first.checklistId);
    const it = c && c.items.find(x=>x.id===first.itemId);
    if(!it) return;
    const now = Date.now();
    state.playSession = { combined: true, checklistId: c.id, itemId: it.id, startedAt: now, durationSec: (it.durationMin||5)*60, sessionStartedAt: now, checklistStartedAt: now, log: [], skippedIds: [], queue, totalCt: queue.length+1 };
    save();
    openPlayOverlay(true);
  }

  // pulls the next still-undone item off a combined session's queue, skipping over any entries
  // whose checklist/item vanished or got completed elsewhere (another device, direct checkbox
  // click) since the queue was built. Returns null once nothing valid remains.
  function advanceCombinedQueue(session){
    while(session.queue.length){
      const next = session.queue.shift();
      const c = state.checklists.find(x=>x.id===next.checklistId);
      const it = c && c.items.find(x=>x.id===next.itemId);
      if(c && it && !it.done && !isItemLocked(it)) return { c, it };
    }
    return null;
  }

  // "12m 34s" / "1h 05m" / "42s" — used for the completion screen's total + per-task times
  function fmtPlayDuration(sec){
    sec = Math.max(0, Math.round(sec||0));
    const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
    if(h>0) return h+'h '+String(m).padStart(2,'0')+'m';
    if(m>0) return m+'m '+String(s).padStart(2,'0')+'s';
    return s+'s';
  }

  function getRemainingSec(){
    if(!state.playSession) return 0;
    return Math.max(0, state.playSession.durationSec - Math.floor((Date.now()-state.playSession.startedAt)/1000));
  }

  function tickPlayTimer(){
    if(!resolvePlaySessionRefs()){ stopPlaySession(); return; }
    updatePlayTimerDisplay();
  }

  function updatePlayTimerDisplay(){
    const remainingSec = getRemainingSec();
    const m = Math.floor(remainingSec/60), s = remainingSec%60;
    const timerEl = el('playTimer');
    timerEl.textContent = String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
    timerEl.classList.toggle('play-timer-zero', remainingSec===0);
  }

  function renderPlayOverlay(){
    const refs = resolvePlaySessionRefs();
    if(!refs) return;
    const { c, it } = refs;
    const sourceEl = el('playTaskSource');
    const combined = !!state.playSession.combined;
    if(combined){
      el('playChecklistName').textContent = '📋 Dailies Backlog';
      el('playProgress').textContent = 'Task '+((state.playSession.log||[]).length+1)+' of '+state.playSession.totalCt;
      sourceEl.textContent = c.name;
      sourceEl.style.display = '';
    } else {
      const doneCt = c.items.filter(i=>i.done).length;
      el('playChecklistName').textContent = c.name;
      el('playProgress').textContent = 'Task '+(doneCt+1)+' of '+c.items.length;
      sourceEl.style.display = 'none';
    }
    el('playTaskText').textContent = it.text;

    // "checkpoint" bar — how far along the checklist the *current* task belongs to is, so a
    // combined Dailies session shows progress within that sub-checklist as you jump between them
    const clDoneCt = c.items.filter(i=>i.done).length;
    const clPct = c.items.length ? Math.round((clDoneCt/c.items.length)*100) : 0;
    el('playChecklistProgressFill').style.width = clPct+'%';
    el('playChecklistProgressPct').textContent = clPct+'%';

    // overall bar only means something distinct from the checklist bar in a combined session —
    // for a single-checklist Play session it would just duplicate the bar above. Counts every
    // Dailies item that's actually done right now, not just what's been handled this session, so
    // items finished before the session started (or checked off elsewhere mid-session) count too.
    el('playOverallProgressRow').style.display = combined ? 'flex' : 'none';
    if(combined){
      const { done, total } = dailiesOverallProgress();
      const pct = total ? Math.round((done/total)*100) : 0;
      el('playOverallProgressFill').style.width = pct+'%';
      el('playOverallProgressPct').textContent = pct+'%';
    }
    updatePlayTimerDisplay();
  }

  function handlePlayCheck(){
    const refs = resolvePlaySessionRefs();
    if(!refs) return;
    const { c, it } = refs;
    const elapsedSec = Math.round((Date.now() - state.playSession.startedAt)/1000);
    setItemDone(c, it, true);
    renderChecklists(); renderHabits(); updateExpUI();
    advancePlaySession(c, it, { text: it.text, elapsedSec, checklistId: c.id });
  }

  // "come back to this later" — leaves the item undone (no XP, no habit-link change) but
  // tallies it as a skip for the struggling-tasks panel, and moves on to the next task that
  // hasn't already been skipped this session (so skipping doesn't just re-show the same task).
  function handlePlaySkip(){
    const refs = resolvePlaySessionRefs();
    if(!refs) return;
    const { c, it } = refs;
    const elapsedSec = Math.round((Date.now() - state.playSession.startedAt)/1000);
    it.skipCount = (it.skipCount||0) + 1;
    save();
    renderChecklists();
    advancePlaySession(c, it, { text: it.text, elapsedSec, skipped: true, checklistId: c.id }, it.id);
  }

  // "attempted and not accomplished" — unlike Skip, this locks the item (see setItemFailed /
  // isItemLocked) so it can't be redone until the checklist resets or the day rolls over, then
  // advances the same way Skip does.
  function handlePlayFailed(){
    const refs = resolvePlaySessionRefs();
    if(!refs) return;
    const { c, it } = refs;
    const elapsedSec = Math.round((Date.now() - state.playSession.startedAt)/1000);
    setItemFailed(c, it);
    // failing changes what a linked habit shows (😞 mark, and it stops counting as unresolved),
    // so the habits tab has to be rebuilt too, not just the checklist
    renderChecklists(); renderHabits();
    advancePlaySession(c, it, { text: it.text, elapsedSec, failed: true, checklistId: c.id });
  }

  // shared tail of handlePlayCheck/Skip/Failed — appends the log entry, figures out what's next
  // (another task in the same checklist, the first task of a different checklist in a combined
  // session, or nothing left), and either ends the whole session, pauses on a per-checklist
  // checkpoint recap, or moves straight on to the next task. `skipId`, when given, is recorded in
  // skippedIds so a skipped task isn't immediately re-offered within the same checklist.
  function advancePlaySession(c, it, logEntry, skipId){
    const s = state.playSession;
    const combined = !!s.combined;
    const log = (s.log||[]).concat([logEntry]);
    const sessionStartedAt = s.sessionStartedAt || s.startedAt;
    const skippedIds = skipId ? (s.skippedIds||[]).concat([skipId]) : (s.skippedIds||[]);
    const queue = s.queue;
    const totalCt = s.totalCt;
    const next = combined
      ? advanceCombinedQueue({ queue })
      : c.items.find(i=>!i.done && !isItemLocked(i) && !skippedIds.includes(i.id));
    if(!next){
      const totalSec = Math.round((Date.now() - sessionStartedAt)/1000);
      state.playSession = null; save();
      showPlayComplete({ log, totalSec });
      return;
    }
    const nextC = combined ? next.c : c;
    const nextIt = combined ? next.it : next;
    const movingToNewChecklist = combined && nextC.id !== c.id;
    const checklistStartedAt = movingToNewChecklist ? Date.now() : (s.checklistStartedAt || sessionStartedAt);
    state.playSession = combined
      ? { combined: true, checklistId: nextC.id, itemId: nextIt.id, startedAt: Date.now(), durationSec: (nextIt.durationMin||5)*60, sessionStartedAt, checklistStartedAt, log, skippedIds, queue, totalCt }
      : { checklistId: c.id, itemId: nextIt.id, startedAt: Date.now(), durationSec: (nextIt.durationMin||5)*60, sessionStartedAt, log, skippedIds };
    save();
    if(movingToNewChecklist){
      // the "This checklist" mini-bar stays visible behind the checkpoint recap, but
      // renderPlayOverlay() (which recomputes it) isn't called again until Continue is
      // pressed — and by then playSession already points at the *next* checklist. Without
      // this, the bar sits at whatever % it was on before the just-finished item, so a
      // checklist that just hit 100% never visibly shows it until the following checklist
      // is already underway.
      const clDoneCt = c.items.filter(i=>i.done).length;
      const clPct = c.items.length ? Math.round((clDoneCt/c.items.length)*100) : 0;
      el('playChecklistProgressFill').style.width = clPct+'%';
      el('playChecklistProgressPct').textContent = clPct+'%';
      const finishedElapsedSec = Math.round((Date.now() - (s.checklistStartedAt || sessionStartedAt))/1000);
      showPlayCheckpoint(c, log, finishedElapsedSec);
    }
    else renderPlayOverlay();
  }

  function showPlayComplete(summary){
    if(playTimerHandle){ clearInterval(playTimerHandle); playTimerHandle = null; }
    el('playBody').style.display = 'none';
    el('playCheckpoint').style.display = 'none';
    el('playProgress').textContent = '';
    el('playComplete').style.display = 'block';
    celebrateChecklistComplete();
    const log = (summary && summary.log) || [];
    const totalSec = (summary && summary.totalSec) || 0;
    const insights = el('playCompleteInsights');
    if(!log.length){ insights.innerHTML = ''; return; }
    insights.innerHTML = '<div class="play-insight-total">Finished in '+fmtPlayDuration(totalSec)+'</div>'
      + '<div class="play-insight-list">'
      + log.map(entry=>'<div class="play-insight-row"><span class="play-insight-task">'+escapeHtml(entry.text)+'</span><span class="play-insight-time'+(entry.failed?' play-insight-failed':entry.skipped?' play-insight-skipped':'')+'">'+(entry.failed?'🚫 Failed':entry.skipped?'⏭ Skipped':fmtPlayDuration(entry.elapsedSec))+'</span></div>').join('')
      + '</div>';
  }

  // pit-stop recap between checklists in a combined Dailies session — pauses the timer/interval
  // just like showPlayComplete does, but only for the entries logged against the checklist that
  // just finished (matched via the checklistId stamped on each log entry in advancePlaySession)
  function showPlayCheckpoint(finishedChecklist, log, totalSec){
    if(playTimerHandle){ clearInterval(playTimerHandle); playTimerHandle = null; }
    el('playBody').style.display = 'none';
    el('playComplete').style.display = 'none';
    el('playCheckpoint').style.display = 'block';
    celebrateChecklistComplete();
    const entries = log.filter(e=>e.checklistId === finishedChecklist.id);
    const doneCt = entries.filter(e=>!e.skipped && !e.failed).length;
    el('playCheckpointMsg').textContent = '🎉 "'+finishedChecklist.name+'" done!';
    const insights = el('playCheckpointInsights');
    insights.innerHTML = '<div class="play-insight-total">'+doneCt+' of '+entries.length+' tasks done · '+fmtPlayDuration(totalSec||0)+'</div>'
      + '<div class="play-insight-list">'
      + entries.map(entry=>'<div class="play-insight-row"><span class="play-insight-task">'+escapeHtml(entry.text)+'</span><span class="play-insight-time'+(entry.failed?' play-insight-failed':entry.skipped?' play-insight-skipped':'')+'">'+(entry.failed?'🚫 Failed':entry.skipped?'⏭ Skipped':fmtPlayDuration(entry.elapsedSec))+'</span></div>').join('')
      + '</div>';
  }

  // give the next checklist's first task a fresh timer window starting now, rather than counting
  // down in the background while the checkpoint recap was on screen
  function continueFromPlayCheckpoint(){
    if(!state.playSession) return;
    el('playCheckpoint').style.display = 'none';
    el('playBody').style.display = '';
    const now = Date.now();
    state.playSession.startedAt = now;
    state.playSession.checklistStartedAt = now;
    save();
    renderPlayOverlay();
    if(playTimerHandle) clearInterval(playTimerHandle);
    playTimerHandle = setInterval(tickPlayTimer, 1000);
  }
  el('playCheckpointContinueBtn').addEventListener('click', continueFromPlayCheckpoint);
  el('playCheckpointExitBtn').addEventListener('click', stopPlaySession);

  function stopPlaySession(){
    if(playTimerHandle){ clearInterval(playTimerHandle); playTimerHandle = null; }
    state.playSession = null;
    save();
    setPlayMinimized(false);
    // the music belongs to the session, not the page — it must not outlive the overlay
    stopSessionMusic();
    el('playOverlay').style.display = 'none';
  }

  // On startup, reopen the overlay on whatever task was in progress when the app was last
  // closed — the timer picks up from real elapsed time via getRemainingSec(), not a fresh 05:00.
  function resumePlaySessionIfAny(){
    if(!state.playSession) return;
    let refs = resolvePlaySessionRefs();
    if(!refs){
      // checklist gone entirely, or the item was already completed/removed elsewhere (e.g.
      // another device) — fall through to the next undone item (queue, if combined; else the
      // same checklist) if any
      const sessionStartedAt = state.playSession.sessionStartedAt || state.playSession.startedAt;
      const log = state.playSession.log || [];
      if(state.playSession.combined){
        const next = advanceCombinedQueue({ queue: state.playSession.queue });
        if(!next){ state.playSession = null; save(); return; }
        const skippedIds = state.playSession.skippedIds || [];
        state.playSession = { combined: true, checklistId: next.c.id, itemId: next.it.id, startedAt: Date.now(), durationSec: (next.it.durationMin||5)*60, sessionStartedAt, log, skippedIds, queue: state.playSession.queue, totalCt: state.playSession.totalCt };
        save();
      } else {
        const c = state.checklists.find(x=>x.id===state.playSession.checklistId);
        if(!c){ state.playSession = null; save(); return; }
        const skippedIds = state.playSession.skippedIds || [];
        const next = c.items.find(i=>!i.done && !isItemLocked(i) && !skippedIds.includes(i.id));
        if(!next){ state.playSession = null; save(); return; }
        state.playSession = { checklistId: c.id, itemId: next.id, startedAt: Date.now(), durationSec: (next.durationMin||5)*60, sessionStartedAt, log, skippedIds };
        save();
      }
    }
    openPlayOverlay(false);
  }

  // Refresh the countdown the instant the tab regains focus, instead of waiting up to 1s for
  // the next interval tick — reinforces that the timer kept running while the tab was hidden.
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible' && state.playSession) updatePlayTimerDisplay(); });

  el('playXBtn').addEventListener('click', stopPlaySession);
  el('playSkipBtn').addEventListener('click', handlePlaySkip);
  el('playFailedBtn').addEventListener('click', handlePlayFailed);
  el('playCheckBtn').addEventListener('click', handlePlayCheck);
  el('playCompleteCloseBtn').addEventListener('click', stopPlaySession);
  el('playCard').addEventListener('click', ()=>{ if(playMinimized) setPlayMinimized(false); });
  // clicking the backdrop (outside the card) minimizes instead of doing nothing — only while a
  // session is actually in progress (not on the completion screen, where there's nothing to pin)
  el('playOverlay').addEventListener('click', e=>{
    if(e.target !== el('playOverlay')) return;
    if(!state.playSession || playMinimized) return;
    setPlayMinimized(true);
  });

  // top items across all checklists ranked by "struggle score" — how many times an item has been
  // marked failed in a Play Session (failCount). Skips deliberately don't count — "come back to
  // this later" isn't struggling, it's just deferring. Only items with a nonzero score are
  // included, so a freshly added item never shows up here just for existing.
  function getStrugglingItems(){
    const rows = [];
    state.checklists.forEach(c=>{
      c.items.forEach(it=>{
        const skipCount = it.skipCount||0, failCount = it.failCount||0;
        const score = failCount*2;
        if(score > 0) rows.push({ checklistName: c.name, text: it.text, skipCount, failCount, score });
      });
    });
    rows.sort((a,b)=> b.score - a.score);
    return rows;
  }

  function struggleRowsHtml(rows){
    return rows.map(r=>{
      const reasons = [];
      if(r.failCount>0) reasons.push('failed '+r.failCount+'×');
      return '<div class="struggle-row">'
        + '<span class="struggle-row-task">'+escapeHtml(r.text)+' <span class="struggle-row-checklist">— '+escapeHtml(r.checklistName)+'</span></span>'
        + '<span class="struggle-row-reason">'+escapeHtml(reasons.join(', '))+'</span>'
        + '</div>';
    }).join('');
  }

  function renderStrugglingTasks(){
    const panel = el('strugglingTasksPanel');
    const rows = getStrugglingItems();
    if(!rows.length){ panel.style.display = 'none'; closeStruggleOverlay(); return; }
    panel.style.display = 'flex';
    el('strugglingTasksCount').textContent = rows.length;
    el('strugglingTasksOverlayList').innerHTML = struggleRowsHtml(rows);
  }
  function openStruggleOverlay(){
    if(!getStrugglingItems().length) return;
    el('strugglingTasksOverlay').style.display = 'flex';
  }
  function closeStruggleOverlay(){ el('strugglingTasksOverlay').style.display = 'none'; }
  el('strugglingTasksPanel').addEventListener('click', openStruggleOverlay);
  el('strugglingTasksOverlay').addEventListener('click', e=>{ if(e.target === el('strugglingTasksOverlay')) closeStruggleOverlay(); });
  // clears every item's missStreak/skipCount/failCount — the only way to wipe struggle history
  // short of completing/reset-cycling each item individually
  el('struggleResetBtn').addEventListener('click', ()=>{
    if(!window.confirm('Clear struggle history for every task? This resets miss/skip/fail counts to zero.')) return;
    state.checklists.forEach(c=>{
      c.items.forEach(it=>{ it.missStreak = 0; it.skipCount = 0; it.failCount = 0; });
    });
    save(); renderChecklists();
  });

  // Expanding centers the card on screen (scrollCardIntoCenter, js/core.js). renderChecklists()
  // throws away every card node, so the element has to be re-queried by id — rAF lets the new
  // layout settle before it's measured. Collapsing never scrolls.
  function setChecklistCollapsed(c, collapsed){
    // only one checklist stays open at a time — expanding one minimizes the rest
    if(collapsed) c.collapsed = true;
    else state.checklists.forEach(x=>{ x.collapsed = (x.id !== c.id); });
    save(); renderChecklists();
    if(collapsed) return;
    requestAnimationFrame(()=> scrollCardIntoCenter(checklistListEl.querySelector('.checklist-card[data-checklist-id="'+c.id+'"]')));
  }

  function renderChecklists(){
    applyChecklistResets();
    clearExpiredFailedFlags();
    renderStrugglingTasks();
    const list = el('checklistList'); list.innerHTML = '';
    el('checklistEmpty').style.display = state.checklists.length===0 ? 'block' : 'none';

    // group checklists into subgroups (by c.group), preserving overall order; ungrouped items
    // (group === '') render without a header, above any named groups they appear alongside
    const groupOrder = [];
    const groupsMap = {};
    state.checklists.forEach(c=>{
      if(c.resetFreq === undefined) c.resetFreq = 'none';
      if(c.linkedHabitId === undefined) c.linkedHabitId = null;
      if(c.group === undefined) c.group = '';
      const gkey = c.group || '';
      if(!(gkey in groupsMap)){ groupsMap[gkey] = []; groupOrder.push(gkey); }
      groupsMap[gkey].push(c);
    });

    // sub-nav: All + one button per subgroup. Only worth showing once something is actually
    // grouped, so a single ungrouped bucket hides it entirely.
    const navEl = el('checklistGroupNav');
    const hasGroups = groupOrder.some(g=>g);
    if(checklistGroupFilter !== 'all' && !groupOrder.includes(checklistGroupFilter)) checklistGroupFilter = 'all';
    navEl.style.display = hasGroups ? 'flex' : 'none';
    navEl.innerHTML = '';
    if(hasGroups){
      const tabs = [{ key:'all', label:'All', count: state.checklists.length }]
        .concat(groupOrder.map(g=>({ key:g, label: g || 'Ungrouped', count: groupsMap[g].length })));
      tabs.forEach(t=>{
        const btn = document.createElement('button');
        btn.className = 'checklist-group-btn' + (checklistGroupFilter===t.key ? ' active' : '');
        btn.innerHTML = escapeHtml(t.label) + '<span class="checklist-group-btn-count">'+t.count+'</span>';
        btn.addEventListener('click', ()=>{ checklistGroupFilter = t.key; renderChecklists(); });
        navEl.appendChild(btn);
      });
    }

    const shownGroups = checklistGroupFilter === 'all' ? groupOrder : [checklistGroupFilter];
    shownGroups.forEach(gkey=>{
      // in All view the subgroup name still labels each run of cards; filtered views don't need
      // it, the active sub-nav button already says which group you're in
      if(gkey && checklistGroupFilter === 'all'){
        const lbl = document.createElement('div'); lbl.className='finance-group-lbl checklist-group-header';
        lbl.innerHTML = escapeHtml(gkey)+' <span style="font-weight:600;text-transform:none;letter-spacing:0;color:var(--faint);">('+groupsMap[gkey].length+')</span>';
        list.appendChild(lbl);
      }
      groupsMap[gkey].forEach(c=>{
      const card = document.createElement('div'); card.className='checklist-card'+(c.collapsed?' checklist-collapsed':'');
      card.dataset.checklistId = c.id;

      const top = document.createElement('div'); top.className='checklist-top';
      const doneCt = c.items.filter(i=>i.done).length;
      const allItemsDone = c.items.length>0 && doneCt === c.items.length;
      if(allItemsDone) card.classList.add('done');
      // A collapsed card stays status-only — name, progress, Play. Subgroup, habit link, reset
      // frequency, rename, reset and delete are rendered solely when the card is expanded.
      top.innerHTML = '<span class="drag-handle" draggable="true" title="Drag to reorder">⠿</span>'
        + '<button class="habit-collapse-btn" data-act="collapse" title="'+(c.collapsed?'Expand':'Minimize')+'">'+(c.collapsed?'▶':'▼')+'</button>'
        + '<div class="checklist-name">'+escapeHtml(c.name)+'</div>'
        + (allItemsDone ? '<span class="checklist-done-chip">✓ COMPLETED</span>' : '')
        + '<span class="checklist-count-chip">'+doneCt+'/'+c.items.length+'</span>'
        + (c.collapsed ? '' :
            '<input type="text" class="mini-input checklist-group-input" placeholder="Subgroup…" maxlength="40" value="'+escapeHtml(c.group||'')+'" style="width:100px;flex:none;padding:5px 8px;font-size:11.5px;" title="Organize this checklist into a subgroup">'
          + '<select class="checklist-habit-link" title="Mark a habit done when this checklist is fully completed">'
            + '<option value="">🔗 Link a habit…</option>'
            + state.habits.map(h=>'<option value="'+h.id+'" '+(c.linkedHabitId===h.id?'selected':'')+'>🔗 '+escapeHtml(h.name)+'</option>').join('')
          + '</select>'
          + '<select class="checklist-freq">' + Object.keys(FREQ_LABELS).map(f=>'<option value="'+f+'" '+(c.resetFreq===f?'selected':'')+'>'+FREQ_LABELS[f]+'</option>').join('') + '</select>'
          + '<button class="reset-chk-btn" data-act="reset" title="Reset all items now">↺</button>')
        + (c.items.some(i=>!i.done && !isItemLocked(i)) ? '<button class="btn btn-primary" data-act="play">▶ Play</button>' : '')
        + (c.collapsed ? '' :
            '<button class="rename-btn" data-act="rename" title="Rename">✎</button>'
          + '<button class="del-goal">Delete</button>');
      const groupInput = top.querySelector('.checklist-group-input');
      if(groupInput) groupInput.addEventListener('change', e=>{
        c.group = e.target.value.trim(); save(); renderChecklists();
      });
      top.querySelector('[data-act="collapse"]').addEventListener('click', ()=>{ setChecklistCollapsed(c, !c.collapsed); });
      const renameBtn = top.querySelector('[data-act="rename"]');
      if(renameBtn) renameBtn.addEventListener('click', ()=>{
        const nameEl = top.querySelector('.checklist-name');
        const input = document.createElement('input');
        input.type = 'text'; input.className = 'rename-input'; input.maxLength = 80; input.value = c.name;
        input.style.flex = '1'; input.style.minWidth = '120px';
        nameEl.replaceWith(input);
        input.focus(); input.select();
        const commit = () => {
          const v = input.value.trim();
          if(v) c.name = v;
          save(); renderChecklists();
        };
        input.addEventListener('keydown', e=>{ if(e.key==='Enter') commit(); if(e.key==='Escape') renderChecklists(); });
        input.addEventListener('blur', commit);
      });
      const habitLinkSel = top.querySelector('.checklist-habit-link');
      if(habitLinkSel) habitLinkSel.addEventListener('change', e=>{
        c.linkedHabitId = e.target.value || null;
        syncChecklistHabitLink(c);
        save(); renderChecklists(); renderHabits();
      });
      const freqSel = top.querySelector('.checklist-freq');
      if(freqSel) freqSel.addEventListener('change', e=>{
        c.resetFreq = e.target.value;
        c.lastResetKey = resetKeyFor(c.resetFreq);
        save(); renderChecklists();
      });
      const resetBtn = top.querySelector('[data-act="reset"]');
      if(resetBtn) resetBtn.addEventListener('click', ()=>{
        if(!window.confirm('Reset all items in "'+c.name+'"? This marks every item as not done.')) return;
        c.items.forEach(it=>{ it.done = false; it.failed = false; });
        save(); renderChecklists(); renderHabits(); updateExpUI();
      });
      const delBtn = top.querySelector('.del-goal');
      if(delBtn) delBtn.addEventListener('click', ()=>{
        if(!window.confirm('Delete checklist "'+c.name+'"? This can\'t be undone.')) return;
        state.checklists = state.checklists.filter(x=>x.id!==c.id); save(); renderChecklists();
      });
      const playBtn = top.querySelector('[data-act="play"]');
      if(playBtn) playBtn.addEventListener('click', ()=> startPlaySession(c));
      // clicking any non-interactive white space on the card (not a button/input/select/drag
      // handle/item-check) toggles minimize/maximize, same as the dedicated collapse button
      card.addEventListener('click', e=>{
        if(e.target.closest('button, input, select, .drag-handle, .sub-check')) return;
        setChecklistCollapsed(c, !c.collapsed);
      });
      card.appendChild(top);

      if(!c.collapsed){
        const itemsWrap = document.createElement('div');
        c.items.forEach(it=>{
          if(it.durationMin === undefined) it.durationMin = 5;
          const locked = isItemLocked(it);
          const row = document.createElement('div'); row.className='sub-row'; row.dataset.itemId = it.id;
          if(locked) row.title = 'Failed today — locked until this checklist resets, or day\'s end';
          row.innerHTML = '<span class="drag-handle sub-drag-handle" draggable="true" title="Drag to reorder">⠿</span>'
            + '<div class="sub-check '+(it.done?'checked':'')+(locked?' failed-locked':'')+'">'+(it.done?'✓':locked?'✗':'')+'</div><div class="sub-title '+(it.done?'done':'')+(locked?' failed-locked':'')+'">'+escapeHtml(it.text)+'</div>'
            + '<input type="number" class="mini-input sub-duration" min="1" max="180" value="'+it.durationMin+'" title="Minutes for Play timer">'
            + '<button class="sub-del">✕</button>';
          row.querySelector('.sub-check').addEventListener('click', ()=>{
            if(locked) return;
            const wasAllDone = c.items.length>0 && c.items.every(i=>i.done);
            setItemDone(c, it, !it.done);
            const isAllDoneNow = c.items.length>0 && c.items.every(i=>i.done);
            if(!wasAllDone && isAllDoneNow) celebrateChecklistComplete();
            renderChecklists(); renderHabits(); updateExpUI();
          });
          row.querySelector('.sub-duration').addEventListener('change', e=>{
            let v = parseInt(e.target.value, 10);
            if(!v || v<1) v = 1; if(v>180) v = 180;
            it.durationMin = v; e.target.value = v; save();
          });
          row.querySelector('.sub-del').addEventListener('click', ()=>{
            if(it.done) state.checklistExp = Math.max(0, (state.checklistExp||0) - CHECKLIST_ITEM_EXP);
            c.items=c.items.filter(x=>x.id!==it.id); save(); renderChecklists(); updateExpUI();
          });
          itemsWrap.appendChild(row);
        });
        // drag-to-reorder items within this checklist — delegated over this checklist's itemsWrap
        itemsWrap.addEventListener('dragstart', e=>{
          const handle = e.target.closest('.sub-drag-handle');
          if(!handle) return;
          const row = handle.closest('.sub-row');
          draggedChecklistItemId = row ? row.dataset.itemId : null;
          e.dataTransfer.effectAllowed = 'move';
        });
        itemsWrap.addEventListener('dragover', e=>{
          if(!draggedChecklistItemId) return;
          e.preventDefault();
          const overRow = e.target.closest('.sub-row');
          itemsWrap.querySelectorAll('.sub-row.drag-over').forEach(r=>r.classList.remove('drag-over'));
          if(overRow && overRow.dataset.itemId !== draggedChecklistItemId) overRow.classList.add('drag-over');
        });
        itemsWrap.addEventListener('drop', e=>{
          if(!draggedChecklistItemId) return;
          e.preventDefault();
          itemsWrap.querySelectorAll('.sub-row.drag-over').forEach(r=>r.classList.remove('drag-over'));
          const overRow = e.target.closest('.sub-row');
          const toId = overRow ? overRow.dataset.itemId : null;
          const fromId = draggedChecklistItemId; draggedChecklistItemId = null;
          if(!toId || toId === fromId) return;
          const fromIdx = c.items.findIndex(x=>x.id===fromId);
          const toIdx = c.items.findIndex(x=>x.id===toId);
          if(fromIdx<0 || toIdx<0) return;
          const [moved] = c.items.splice(fromIdx,1);
          c.items.splice(toIdx,0,moved);
          save(); renderChecklists();
        });
        itemsWrap.addEventListener('dragend', ()=>{
          draggedChecklistItemId = null;
          itemsWrap.querySelectorAll('.sub-row.drag-over').forEach(r=>r.classList.remove('drag-over'));
        });
        card.appendChild(itemsWrap);

        const addRow = document.createElement('div'); addRow.className='add-sub-row';
        addRow.innerHTML = '<input type="text" class="mini-input" placeholder="Add an item..." maxlength="100"><button>+</button>';
        const itemInput = addRow.querySelector('input');
        const doAddItem = () => {
          const v=itemInput.value.trim(); if(!v) return;
          c.items.push({id:uid(), text:v, done:false, durationMin:5});
          save(); renderChecklists();
          // renderChecklists() rebuilds the DOM, so re-find and re-focus this checklist's input
          // to let the user keep adding items just by pressing Enter
          const freshInput = list.querySelector('.checklist-card[data-checklist-id="'+c.id+'"] .mini-input');
          if(freshInput) freshInput.focus();
        };
        addRow.querySelector('button').addEventListener('click', doAddItem);
        itemInput.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); doAddItem(); } });
        card.appendChild(addRow);
      }

      // hairline progress bar pinned to the card's bottom edge — the one piece of detail a
      // minimized row keeps, so a glance down the list reads as progress rather than numbers
      const bar = document.createElement('div'); bar.className='checklist-progress';
      const pct = c.items.length ? Math.round((doneCt/c.items.length)*100) : 0;
      bar.innerHTML = '<span style="width:'+pct+'%"></span>';
      card.appendChild(bar);

      list.appendChild(card);
      }); // end groupsMap[gkey].forEach
    }); // end groupOrder.forEach
  }
  function addChecklist(){
    const input = el('newChecklistInput'); const v = input.value.trim();
    if(!v) return;
    state.checklists.push({ id:uid(), name:v, resetFreq:'none', lastResetKey:null, group:'', items:[] });
    input.value=''; save(); renderChecklists();
  }
  el('addChecklistBtn').addEventListener('click', addChecklist);
  el('newChecklistInput').addEventListener('keydown', e=>{ if(e.key==='Enter') addChecklist(); });

