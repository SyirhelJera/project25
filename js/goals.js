  /* ================= GOALS ================= */
  function goalProgress(g){
    if(g.subtasks.length === 0) return g.manualDone ? 100 : 0;
    const done = g.subtasks.filter(s=>s.done).length;
    return Math.round((done / g.subtasks.length) * 100);
  }
  function updateCompletionMeta(g){
    const done = goalProgress(g) === 100;
    if(done && !g.completedAt) g.completedAt = Date.now();
    if(!done) g.completedAt = null;
  }
  // marks the moment the goal was flipped to "working on" — the clock timeSpentStr() runs from.
  // Toggling on always restarts it; toggling off leaves it alone so a finished goal keeps showing
  // how long the work itself took rather than falling back to the creation date.
  function markWorkingOn(g, on){
    g.workingOn = on;
    if(on) g.workingOnAt = Date.now();
  }
  function timeSpentStr(g){
    // goals never marked as worked on have no better anchor than their creation date
    const start = g.workingOnAt || g.createdAt;
    const end = g.completedAt || Date.now();
    const ms = Math.max(0, end - start);
    const days = Math.floor(ms/(1000*3600*24));
    if(days >= 1) return days + (g.completedAt ? ' days to finish' : ' days so far');
    const hrs = Math.floor(ms/(1000*3600));
    return hrs + (g.completedAt ? 'h to finish' : 'h so far');
  }

  // parses the free-text Net Worth profile field ("$ 12,000" etc.) into a plain number
  function manualNetWorthNum(){
    const raw = (state.profile && state.profile.netWorth) || '';
    const n = parseFloat(String(raw).replace(/[^0-9.\-]/g,''));
    return isNaN(n) ? 0 : n;
  }
  // ---- currency helpers (rates are "units per 1 USD", user-editable in the converter tab) ----
  function rateFor(ccy){ return (state.finance.rates && state.finance.rates[ccy]) || DEFAULT_RATES[ccy] || 1; }
  function convertAmt(amount, from, to){
    const usd = (parseFloat(amount)||0) / rateFor(from||'USD');
    return usd * rateFor(to||'USD');
  }
  /* A net-worth history point holds a USD figure that was converted with the rates in effect on
     the day it was written (snapshotNetWorth() in finance.js), so re-expressing it with TODAY's
     rate multiplies one vintage by another. That was a real bug: fetching rates rewrites only
     today's point — save() calls snapshotNetWorth() — while the whole back-history keeps the old
     rate, so the chart stepped up several percent with not a cent moved. Converting with the
     point's OWN rates makes the two cancel, which is what keeps a single-currency portfolio a flat
     line in its own currency, and leaves a USD view showing FX drift as the gradual thing it is
     (rateFor('USD') is always 1, so a USD read returns the stored figure untouched).
     Points written before snapshots carried rates have no vintage to honour and fall back to the
     current ones — the old behaviour, rather than retroactively rewriting history that was never
     recorded. Anything reading netWorthHistory for display must go through this, or that tab will
     disagree with the chart about the same day. */
  function histRateFor(entry, ccy){
    const r = entry && entry.rates && entry.rates[ccy || 'USD'];
    return (typeof r === 'number' && r > 0) ? r : rateFor(ccy || 'USD');
  }
  function convertHistValue(entry, to){
    return (parseFloat(entry && entry.value)||0) * histRateFor(entry, to || 'USD');
  }
  function ccySymbol(ccy){ return CURRENCY_SYMBOLS[ccy] || (ccy+' '); }
  function fmtMoney(amount, ccy){
    const sym = ccySymbol(ccy||'USD');
    return sym + (parseFloat(amount)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  }

  // sums Finance-section accounts: savings/lent/custom-asset are assets, credit/custom-liability are liabilities
  // each account's balance is converted from its own currency into USD before summing
  function isLiabilityAccount(a){ return a.type==='credit' || a.type==='custom-liability'; }
  // a liability balance is a *magnitude* of debt, not a signed figure — the account card renders it
  // with a hard-coded "-" for the same reason. So it's always subtracted: naively multiplying by -1
  // turned a balance the user typed (or paid) below zero into an asset, pushing net worth *up*.
  // debts (Finance > Debts) are folded in the same way — what's still owed to you is an asset,
  // what you still owe is a liability. debtsNetWorth() lives in finance.js, which loads after this
  // file but well before anything calls net worth.
  function financeNetWorth(){
    const accountsUsd = (state.finance.accounts||[]).reduce((sum,a)=>{
      const usdBal = convertAmt(a.balance, a.currency||'USD', 'USD');
      return sum + (isLiabilityAccount(a) ? -Math.abs(usdBal) : usdBal);
    }, 0);
    return accountsUsd + debtsNetWorth();
  }
  // overall net worth = manually entered profile figure + everything tracked in the Finance section
  function getNetWorthNum(){
    return manualNetWorthNum() + financeNetWorth();
  }
  // a goal is locked when it has a required net worth set and the profile's net worth hasn't reached it yet
  function isGoalLocked(g){
    return g.requiredNetWorth != null && g.requiredNetWorth !== '' && getNetWorthNum() < g.requiredNetWorth;
  }

  // tier ranking used for the Tier sort option — higher index = higher tier
  const TIER_ORDER = {'':0,'F':1,'B':2,'A':3,'S':4,'S+':5,'Mythical':6};
  function sortGoalsBy(arr, mode, dir){
    const factor = dir === 'asc' ? 1 : -1;
    return arr.slice().sort((a,b)=>{
      let av, bv;
      if(mode === 'tier'){ av = TIER_ORDER[a.tier||'']||0; bv = TIER_ORDER[b.tier||'']||0; }
      else if(mode === 'progress'){ av = goalProgress(a); bv = goalProgress(b); }
      else if(mode === 'created'){ av = a.createdAt||0; bv = b.createdAt||0; }
      else if(mode === 'updated'){ av = a.updatedAt||a.createdAt||0; bv = b.updatedAt||b.createdAt||0; }
      else { av = 0; bv = 0; }
      return (av-bv)*factor;
    });
  }

  function visibleGoals(){
    let arr = state.goals.slice();

    if(goalFilter === 'working'){
      // goals the user has explicitly marked as actively working on — never includes completed or locked goals
      const working = arr.filter(g=>g.workingOn && goalProgress(g)<100 && !isGoalLocked(g));
      if(sortMode !== 'none') return sortGoalsBy(working, sortMode, sortDir);
      if(starredFirst) working.sort((a,b)=> (b.starred?1:0) - (a.starred?1:0));
      return working;
    }
    if(goalFilter === 'completed'){
      arr = arr.filter(g=>goalProgress(g)===100);
      return sortMode !== 'none' ? sortGoalsBy(arr, sortMode, sortDir) : arr.sort((a,b)=> (b.completedAt||0) - (a.completedAt||0));
    }
    if(goalFilter === 'unfinished'){
      // locked goals are excluded from the Unfinished list — they aren't actionable yet — and so are
      // "working on" goals: those have their own filter/carousel, so Unfinished is what's left untouched
      const unfinished = arr.filter(g=>goalProgress(g)<100 && !isGoalLocked(g) && !g.workingOn);
      if(sortMode !== 'none') return sortGoalsBy(unfinished, sortMode, sortDir);
      if(starredFirst) unfinished.sort((a,b)=> (b.starred?1:0) - (a.starred?1:0));
      return unfinished;
    }
    if(goalFilter === 'locked'){
      arr = arr.filter(g=>goalProgress(g)<100 && isGoalLocked(g));
      return sortMode !== 'none' ? sortGoalsBy(arr, sortMode, sortDir) : arr;
    }

    // 'all' with an explicit sort chosen: flat sort across everything, ignoring the default grouping
    if(sortMode !== 'none') return sortGoalsBy(arr, sortMode, sortDir);

    // 'all' default: unlocked-and-open goals on top, then locked goals, then completed goals at the bottom
    // (completed sorted by completion date, most recent first)
    const openUnlocked = arr.filter(g=>goalProgress(g)<100 && !isGoalLocked(g));
    const openLocked = arr.filter(g=>goalProgress(g)<100 && isGoalLocked(g));
    const completed = arr.filter(g=>goalProgress(g)===100).sort((a,b)=> (b.completedAt||0) - (a.completedAt||0));
    if(starredFirst) openUnlocked.sort((a,b)=> (b.starred?1:0) - (a.starred?1:0));
    return openUnlocked.concat(openLocked, completed);
  }

  // marks a goal as edited "now" so the "Last Updated" sort reflects it
  function touchGoal(g){ g.updatedAt = Date.now(); }

  // opens exactly one goal at a time — expanding a goal collapses any other currently-open goal
  function openGoalExclusive(g){
    state.goals.forEach(x=>{ if(x.id!==g.id) x.open = false; });
    g.open = true;
  }

  /* Snaps a just-expanded goal so its head sits directly under the sheet's sticky title bar.
     Two things this deliberately does *not* do: it never centers a tall card (a card taller than
     the space left would have to push its own head up behind the bar to be centered — the head is
     what you need on screen, so it stays put and the rest is scrolled to), and it never scrolls
     past the card, so the head can't end up above the bar either way. Scrolls the sheet body,
     #goalListBody, not the window — the page behind an open sheet is frozen (lockPageScroll).
     renderGoals() rebuilds every card node, so the element has to be re-queried by goal id. */
  function scrollGoalUnderBar(goalId){
    const body = el('goalListBody');
    const card = body && body.querySelector('.goal[data-goal-id="'+goalId+'"]');
    if(!card) return;
    const bar = body.querySelector('.goal-list-bar');
    const barH = bar ? bar.getBoundingClientRect().height : 0;
    const cardTop = card.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
    body.scrollTo({ top: Math.max(0, cardTop - barH - 8), behavior: wcReducedMotion ? 'auto' : 'smooth' });
  }

  const TIER_EXP = {'':5,'F':10,'B':20,'A':40,'S':70,'S+':120,'Mythical':200};
  // Checklist items give a small trickle of exp — enough to feel rewarding day-to-day, but far
  // less than actually finishing a goal, which is the real accomplishment. This is tracked as a
  // running total (state.checklistExp) rather than recomputed from which items are *currently*
  // checked, because daily/weekly/etc. resets clear item.done for the next period — that reset
  // shouldn't erase exp the user already earned by completing the checklist.
  const CHECKLIST_ITEM_EXP = 1;
  function totalExp(){
    const goalExp = state.goals.filter(g=>goalProgress(g)===100).reduce((sum,g)=> sum + (TIER_EXP[g.tier||'']||5), 0);
    return goalExp + (state.checklistExp||0);
  }
  function levelInfo(exp){
    let level = 1, need = 100, floor = 0;
    while(exp >= floor + need){ floor += need; level++; need = Math.round(need*1.25); }
    return { level, into: exp-floor, need };
  }

  /* Level tiers — the bronze/silver/gold/platinum/diamond progression the profile avatar's chest
     pin already used. Owned here now, with names attached, because the level-up popup says the
     tier out loud: avatarLevelColor() in fitness.js reads its colour off this, so a tier can't
     mean one colour on the card and another in the popup. Highest threshold first — levelTier()
     takes the first match. */
  const LEVEL_TIERS = [
    { at:30, label:'Diamond',  color:'#EC4899' },
    { at:20, label:'Platinum', color:'#3B82F6' },
    { at:10, label:'Gold',     color:'#F5A524' },
    { at:5,  label:'Silver',   color:'#B7C0CC' },
    { at:0,  label:'Bronze',   color:'#CD7F32' }
  ];
  function levelTier(level){
    return LEVEL_TIERS.find(t=> level >= t.at) || LEVEL_TIERS[LEVEL_TIERS.length-1];
  }

  function updateExpUI(){
    const exp = totalExp();
    const { level, into, need } = levelInfo(exp);
    el('pfLevel').textContent = 'Lv. ' + level;
    el('pfExpNum').textContent = into + ' / ' + need + ' XP';
    el('pfExpFill').style.width = Math.round((into/need)*100) + '%';
    syncBoardStats();
    noteLevelChange(level, into, need);
  }

  /* ---------- level-up celebration ----------
     Exp comes from two places (finishing a goal, ticking a checklist item) and both already funnel
     through updateExpUI(), so the crossing is detected here rather than at either call site — a
     third exp source would light this up for free.

     state.lastLevelSeen is what makes it fire exactly once. It has to be persisted, because level
     is derived from exp on every load: with no remembered mark, every reload after a level-up
     would replay the popup. The first updateExpUI() of a session only *records* the level
     (levelSeenPrimed) — at that point the number came out of storage rather than out of anything
     the user just did, and levelling up on another device shouldn't ambush this one on open. A
     level going DOWN (a finished goal reopened, a goal deleted) re-marks silently, so climbing
     back over the same line celebrates again. */
  let levelSeenPrimed = false;
  // Called by applyLoadedState(). A backup restore (js/backups.js) re-applies a whole saved blob
  // and re-renders WITHOUT a page reload, so the level can jump several steps in one go without
  // anything having been earned — re-priming makes that land silently, same as a fresh load.
  function resetLevelSeenPrime(){ levelSeenPrimed = false; }
  function noteLevelChange(level, into, need){
    const seen = state.lastLevelSeen;
    if(!levelSeenPrimed || typeof seen !== 'number'){
      levelSeenPrimed = true;
      state.lastLevelSeen = level;
      return;  // deliberately not saved: nothing changed for the user, the next real save carries it
    }
    if(level === seen) return;
    state.lastLevelSeen = level;
    save();  // before the popup, so closing the tab mid-celebration can't replay it on the next load
    if(level > seen) showLevelUp(seen, level, into, need);
  }

  /* Confetti and the AudioContext both live in js/checklists.js (the checklist-completion
     celebration) and are reused rather than copied — a second AudioContext means a second output
     bus, which is exactly what the compressor over there exists to avoid. That file loads AFTER
     this one, hence the typeof guards: the helpers are always defined by the time a level can
     actually change, but not while this file is still executing. */
  let levelUpOpen = false, levelUpHideTimer = null, levelUpReturnFocus = null;
  function showLevelUp(from, to, into, need){
    const overlay = el('levelUpOverlay'), card = el('levelUpCard');
    if(!overlay || !card) return;  // stale cached index.html (see SHELL_ASSETS in sw.js) — skip, don't throw
    const tier = levelTier(to);
    card.style.setProperty('--lvl-color', tier.color);
    el('levelUpNum').textContent = to;
    el('levelUpHeading').textContent = 'You reached Level ' + to;
    const jumped = to - from;
    // finishing a Mythical goal is worth 200 exp, so more than one level at a time is possible
    el('levelUpJump').textContent = 'Lv. ' + from + '  →  Lv. ' + to + (jumped > 1 ? '   (+' + jumped + ' levels)' : '');
    // a tier only changes on the level that crosses into it — worth calling out, it's the rarer event
    const tierChanged = levelTier(from).label !== tier.label;
    const tierEl = el('levelUpTier');
    tierEl.textContent = tierChanged ? 'New tier — ' + tier.label : tier.label + ' tier';
    tierEl.classList.toggle('is-new', tierChanged);
    el('levelUpNext').textContent = (need - into) + ' XP to Level ' + (to + 1);

    clearTimeout(levelUpHideTimer);  // reopening mid-close must not get hidden by the old timer
    if(!levelUpOpen){ levelUpReturnFocus = document.activeElement; lockPageScroll(); }
    levelUpOpen = true;
    overlay.style.display = 'flex';
    // two frames, same reason as createSheet(): in one frame the browser coalesces the class change
    // with display:flex and skips the transition entirely, so the card would just appear
    requestAnimationFrame(()=> requestAnimationFrame(()=> overlay.classList.add('is-open')));
    el('levelUpClose').focus({preventScroll:true});

    if(typeof fireConfettiBurst === 'function'){
      fireConfettiBurst();
      // a second wave — a level outranks a checklist, and one burst is over in about a second
      if(!wcReducedMotion) setTimeout(fireConfettiBurst, 420);
    }
    playLevelUpFanfare();
  }

  /* Settings → "Preview the celebration". Shows the popup for the level actually being worked
     toward next, so the tier, the colour and the XP line are all the real ones rather than a
     made-up sample. It goes through showLevelUp() like any other — which writes nothing to state
     — so a preview can never consume the real celebration or move state.lastLevelSeen. */
  function previewLevelUp(){
    const current = levelInfo(totalExp()).level;
    const next = current + 1;
    // levelInfo() of the exp total the next level STARTS at: into = 0, need = that level's bar
    const at = levelInfo(levelFloorExp(next));
    showLevelUp(current, next, at.into, at.need);
  }
  // The exp total a level begins at — the inverse of levelInfo()'s loop, and the only other place
  // the 100 / x1.25 curve is written down. Keep the two in step.
  function levelFloorExp(level){
    let exp = 0, need = 100;
    for(let l = 1; l < level; l++){ exp += need; need = Math.round(need*1.25); }
    return exp;
  }

  function closeLevelUp(){
    if(!levelUpOpen) return;
    levelUpOpen = false;
    const overlay = el('levelUpOverlay');
    overlay.classList.remove('is-open');
    // released now rather than after the fade: the restore is a synchronous scrollTo, so doing it
    // while the backdrop is still up keeps it invisible
    unlockPageScroll();
    if(levelUpReturnFocus && document.contains(levelUpReturnFocus)) levelUpReturnFocus.focus({preventScroll:true});
    levelUpReturnFocus = null;
    levelUpHideTimer = setTimeout(()=>{ overlay.style.display = 'none'; }, 260);  // after the fade out
  }

  /* A bigger sound than the checklist chime on purpose: a rising C-E-G-C run, then the whole triad
     struck together underneath it. Same duck-aware split as playCelebrateChime() — when the in-app
     player can be dipped it stays modest, and when the music is playing in YouTube Music's own tab
     (nothing on this page can turn that down) it plays loud, with an octave doubling on top, since
     a bright partial cuts through a dense mix better than raw volume does. */
  function playLevelUpFanfare(){
    if(typeof sfxOutput !== 'function' || !sfxOutput()) return;
    const ducked = (typeof duckSessionMusic === 'function') ? duckSessionMusic(1700) : false;
    const now = sfxCtx.currentTime;
    const peak = ducked ? 0.20 : 0.36;
    const notes = [523.25, 659.25, 783.99, 1046.5];  // C5 E5 G5 C6
    notes.forEach((freq, i)=> sfxTone(freq, now + i*0.105, peak, 0.4));
    const chord = now + 0.46;  // the run lands on the chord rather than just stopping
    notes.forEach(freq=>{
      sfxTone(freq, chord, peak*0.8, 1.2);
      if(!ducked) sfxTone(freq*2, chord, peak*0.26, 0.9, 'triangle');
    });
  }

  // Guarded as a block: with a stale cached index.html these elements are absent, and an
  // addEventListener on null here would take the whole rest of goals.js down with it.
  const levelUpOverlayEl = el('levelUpOverlay'), levelUpCloseEl = el('levelUpClose');
  if(levelUpOverlayEl && levelUpCloseEl){
    levelUpCloseEl.addEventListener('click', closeLevelUp);
    levelUpOverlayEl.addEventListener('click', e=>{ if(e.target === levelUpOverlayEl) closeLevelUp(); });
    // Capture phase + stopPropagation: the popup can be sitting on top of an open goal sheet, and
    // one Escape should dismiss the popup only, not tear down the sheet underneath it too.
    document.addEventListener('keydown', e=>{
      if(e.key === 'Escape' && levelUpOpen){ e.stopPropagation(); closeLevelUp(); }
    }, true);
  }
  const levelUpPreviewBtn = el('levelUpPreviewBtn');
  if(levelUpPreviewBtn) levelUpPreviewBtn.addEventListener('click', previewLevelUp);

  /* The sidebar profile card is hidden below 760px, so level / net worth / fitness are mirrored
     onto the Goals board for phones. Copied from that card's own elements rather than recomputed:
     one source per figure, and no second copy of the maths to drift. Called from updateExpUI()
     (which renderGoals runs after it has written the net worth) and from fitness.js when the
     fitness tier changes. */
  function syncBoardStats(){
    const copy = (dstId, srcId, withColor) => {
      const dst = el(dstId), src = el(srcId);
      if(!dst || !src) return;
      dst.textContent = src.textContent;
      // the fitness tier says as much in its colour as in its word — carry it across
      if(withColor) dst.style.color = src.style.color;
    };
    // the trend markers are already-built <span class="pf-trend-mark good|bad">▲/▼</span> (see
    // trendMarker() in core.js), so they come across as markup — arrow, colour, tooltip and all
    const copyHtml = (dstId, srcId) => {
      const dst = el(dstId), src = el(srcId);
      if(dst && src) dst.innerHTML = src.innerHTML;
    };
    copy('meLevel', 'pfLevel');
    copy('meNetWorth', 'pfNetWorthCalc');
    copy('meFitness', 'pfFitnessLevel', true);
    copyHtml('meNetWorthTrend', 'pfNetWorthTrend');
    copyHtml('meFitnessTrend', 'pfFitnessTrend');
    if(openBoardNote) showBoardNote(openBoardNote); // keep an open note in step with the figures
  }

  /* The ▲▼ detail ("Up $340 since 3 Aug") is a title tooltip, which on a phone nothing can reach —
     hover doesn't exist. Tapping a figure spells it out in the line under the strip instead, and
     tapping the same one again puts it away. The sentence is read back out of the marker's own
     title so there is still only one place that composes it. */
  let openBoardNote = null;
  function boardNoteText(which){
    if(which === 'level'){
      const exp = el('pfExpNum');
      return exp ? exp.textContent + ' toward the next level' : '';
    }
    const trendId = which === 'networth' ? 'meNetWorthTrend' : 'meFitnessTrend';
    const mark = el(trendId) && el(trendId).querySelector('.pf-trend-mark');
    if(mark && mark.title) return mark.title;
    return which === 'networth'
      ? 'No change to compare against yet — net worth is recorded once a day.'
      : 'No change to compare against yet — log a weight to start the comparison.';
  }
  function showBoardNote(which){
    const note = el('meNote');
    if(!note) return;
    openBoardNote = which;
    note.textContent = boardNoteText(which);
    note.style.display = 'block';
    document.querySelectorAll('.g-me-item').forEach(b=>{
      b.classList.toggle('is-open', b.dataset.me === which);
      b.setAttribute('aria-expanded', b.dataset.me === which ? 'true' : 'false');
    });
  }
  function hideBoardNote(){
    openBoardNote = null;
    const note = el('meNote');
    if(note) note.style.display = 'none';
    document.querySelectorAll('.g-me-item').forEach(b=>{
      b.classList.remove('is-open');
      b.setAttribute('aria-expanded', 'false');
    });
  }
  document.querySelectorAll('.g-me-item').forEach(b=>{
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', ()=>{
      if(openBoardNote === b.dataset.me) hideBoardNote();
      else showBoardNote(b.dataset.me);
    });
  });

  /* "Today’s focus" — the daily suggested-subtask line — has been removed from the tab, and
     with it pickFocusTask()/renderFocus(). state.focus is still read on load (persistence.js) so
     old saved data keeps loading cleanly; nothing writes it any more. */

  // a "Working on" goal that hasn't been touched (touchGoal) today — same "falling behind"
  // signal as habitsAtRisk() in habits.js, but keyed off updatedAt instead of a streak. Exposed
  // per-goal so both the nav badge count and individual goal cards can use the same condition.
  function goalNeedsAttention(g){
    const todayStr = localDateStr(new Date());
    return g.workingOn && goalProgress(g) < 100 && !isGoalLocked(g)
      && localDateStr(new Date(g.updatedAt || g.createdAt)) !== todayStr;
  }
  function goalsNeedingAttention(){
    return state.goals.filter(goalNeedsAttention);
  }
  function updateGoalReminder(){
    const atRisk = goalsNeedingAttention();
    const badge = el('goalRiskBadge');
    if(!badge) return;
    if(atRisk.length){ badge.style.display = 'inline-flex'; badge.textContent = atRisk.length; }
    else { badge.style.display = 'none'; }
  }

  function renderMantra(){
    if(!state.mantras.length){ el('mantraRow').style.display='none'; return; }
    el('mantraRow').style.display='flex';
    if(mantraIdx < 0 || mantraIdx >= state.mantras.length) mantraIdx = Math.floor(Math.random()*state.mantras.length);
    el('mantraText').textContent = state.mantras[mantraIdx].text;
  }
  // rerolled by clicking the motivation slideshow image (see motivation.js's motivationGlowWrap
  // click handler) rather than a dedicated button
  function rerollMantra(){
    const n = state.mantras.length;
    if(!n) return;
    const curText = (mantraIdx >= 0 && mantraIdx < n) ? state.mantras[mantraIdx].text : null;
    // Never land on the line already showing: an unconstrained pick repeats it roughly once
    // every n taps, which reads as the tap having done nothing at all. Excluded by text rather
    // than by index, so two identically-worded mantras can't defeat it — and it also covers the
    // case where mantraIdx is stale (-1 on first load, or past the end after a delete), since
    // curText is then null and nothing matches. Falls back to the whole list when there's only
    // one mantra, or every one reads the same, because then there is nothing else to show.
    let pool = [];
    for(let i = 0; i < n; i++){ if(state.mantras[i].text !== curText) pool.push(i); }
    if(!pool.length) pool = state.mantras.map((_, i) => i);
    mantraIdx = pool[Math.floor(Math.random() * pool.length)];
    renderMantra();
  }

  // builds the dot <div>s for a {total,filled,todayIdx,pcts,perfects} mosaicDots() result —
  // shared by the compact pinned-countdown mosaic and the expanded overlay (which just passes an
  // uncapped maxDots so `total` is the real day count instead of the CD_MOSAIC_MAX_DOTS-bucketed one)
  function mosaicDotsHtml({ total, filled, todayIdx, pcts, perfects, protecteds }){
    // user-editable in Settings → Countdown Mosaic Colors → "Highlight off" disables this entirely
    const mc = state.mosaicColors || {};
    const highlightOn = mc.perfectGlow !== false;
    const style = mc.perfectStyle || 'color';
    const emoji = mc.perfectEmoji || '⭐';
    // escapeHtml() deliberately leaves double quotes alone, and a protected day's note is free
    // user text — so anything headed for an attribute needs the quotes escaped as well
    const attrText = s => escapeHtml(s).replace(/"/g,'&quot;');
    let dots = '';
    for(let i=0;i<total;i++){
      let cls = 'cd-mosaic-dot';
      const isToday = i===todayIdx, isPast = i<filled;
      let attrs = '';
      // a dot can be both perfect and protected, so the tooltip is collected and emitted once —
      // two title= attributes on one element would be invalid
      const titles = [];
      if(isToday) cls += ' today';
      if(isToday || isPast){
        // liquid bottom-to-top fill instead of a flat intensity color, driven by a CSS custom
        // property so one gradient rule (see .cd-mosaic-dot.has-fill in styles.css) handles every %
        cls += ' has-fill';
        attrs += ' style="--fill-pct:'+(pcts[i]||0)+'%"';
      }
      if(highlightOn && perfects && perfects[i] && (isToday || isPast)){
        cls += ' perfect perfect-'+style;
        titles.push('Perfect day!');
        if(style === 'emoji') attrs += ' data-emoji="'+attrText(emoji)+'"';
      }
      // not gated on isToday||isPast, unlike the perfect highlight: a vacation still ahead of you
      // is worth seeing on the map
      if(protecteds && protecteds[i]){
        cls += ' pd-protected';
        titles.push('Protected day — ' + protectedDayLabel(protecteds[i]));
      }
      if(titles.length) attrs += ' title="'+attrText(titles.join(' · '))+'"';
      dots += '<div class="'+cls+'"'+attrs+'></div>';
    }
    return dots;
  }

  // The key is built from the same dots it explains, so it can never drift from them — including
  // when the user recolors the mosaic in Settings.
  function mosaicLegendHtml(){
    const dot = p => '<div class="cd-mosaic-dot has-fill" style="--fill-pct:'+p+'%"></div>';
    let html = '<span>Less</span>' + dot(6) + dot(35) + dot(70) + dot(100) + '<span>More</span>';
    // only worth the space once there's actually a ringed dot on the map to explain
    if(state.protectedDays && state.protectedDays.length)
      html += '<div class="cd-mosaic-dot pd-protected"></div><span>Protected</span>';
    return html;
  }

  // expanded mosaic overlay — one real, unbucketed dot per day. Opened from the heat map grid;
  // closed by the ✕, the backdrop, or Escape.
  let mosaicReturnFocus = null;
  function openMosaicOverlay(c){
    const data = mosaicDots(c, Infinity);
    mosaicReturnFocus = document.activeElement;
    el('mosaicOverlayTitle').textContent = c.label + ' — ' + data.total + ' days';
    el('mosaicOverlayGrid').innerHTML = mosaicDotsHtml(data);
    el('mosaicOverlayLegend').innerHTML = mosaicLegendHtml();
    el('mosaicOverlay').style.display = 'flex';
    el('mosaicOverlayClose').focus();
  }
  function closeMosaicOverlay(){
    el('mosaicOverlay').style.display = 'none';
    if(mosaicReturnFocus && document.contains(mosaicReturnFocus)) mosaicReturnFocus.focus();
    mosaicReturnFocus = null;
  }
  el('mosaicOverlay').addEventListener('click', e=>{ if(e.target === el('mosaicOverlay')) closeMosaicOverlay(); });
  el('mosaicOverlayClose').addEventListener('click', closeMosaicOverlay);
  document.addEventListener('keydown', e=>{
    if(e.key === 'Escape' && el('mosaicOverlay').style.display === 'flex') closeMosaicOverlay();
  });

  /* ---------- heat map — every day between now and the pinned countdown, each dot filled by how
     much of that day's dailies got done. Second in the tab's order, under the carousel: the grid
     is the content and the day count is its caption, which is why the figure here is smaller than
     the hero cards it sits below. ---------- */
  function renderPinnedCountdown(){
    const slot = el('pinnedCdSlot');
    const c = state.countdowns.find(x=>x.pinned);
    // an empty slot used to render as nothing at all — in the tab's second position that just
    // looked like a layout gap, and never explained what the space was for
    if(!c){
      slot.innerHTML = '<section class="g-heat is-empty" aria-labelledby="gHeatLabel">'
        + '<div class="g-heat-head"><h2 class="g-heat-label" id="gHeatLabel">Daily streak map</h2></div>'
        + '<p class="g-heat-empty-msg">Pin a countdown under <b>Time</b> — every day between now and it lands here, each dot filled by how much of that day’s checklist you finished.</p>'
        + '</section>';
      return;
    }
    const diff = daysLeft(c.date);
    const past = diff < 0;
    let html = '<section class="g-heat" aria-labelledby="gHeatLabel">'
      + '<div class="g-heat-head">'
      +   '<h2 class="g-heat-label" id="gHeatLabel">'+escapeHtml(c.label)+'</h2>'
      +   '<span class="g-heat-date">'+fmtDate(new Date(c.date).getTime())+'</span>'
      + '</div>'
      + '<div class="g-heat-fig">'
      +   '<span class="g-heat-num'+(past?' past':'')+'">'+(past ? 'Passed' : diff)+'</span>'
      +   (past ? '' : '<span class="g-heat-unit">'+(diff===1?'day left':'days left')+'</span>')
      + '</div>';
    if(!past){
      // a div rather than a <button>: the dots are block children, and a grid-display button is
      // still shaky on older engines. role + tabindex + the keydown below make it operable anyway.
      html += '<div class="cd-mosaic g-heat-grid" role="button" tabindex="0">'+mosaicDotsHtml(mosaicDots(c))+'</div>'
        + '<div class="g-heat-foot">'
        +   '<div class="g-heat-legend">'+mosaicLegendHtml()+'</div>'
        +   '<span class="g-heat-hint">Tap for every day</span>'
        + '</div>';
    }
    slot.innerHTML = html + '</section>';
    const grid = slot.querySelector('.g-heat-grid');
    if(grid){
      // set rather than interpolated: escapeHtml() leaves double quotes alone, and the label is user text
      grid.setAttribute('aria-label', 'Daily completion for ' + c.label + ' — open the full day-by-day view');
      grid.addEventListener('click', ()=> openMosaicOverlay(c));
      grid.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); openMosaicOverlay(c); } });
    }
  }

  // The "How is <goal> going? Great / Slow going / Stuck" banner used to live here. It's gone —
  // goal.checkin is left on saved records (nothing reads it, and dropping it would only create a
  // second record shape); goalNeedsAttention() already answers the same question from updatedAt
  // without asking the user anything.

  // Auto-scroll state for the "Working On" carousel — driven via scrollLeft (not CSS transform)
  // so real touch/wheel/drag scrolling shares the same axis and can naturally interrupt it.
  const WC_SPEED_PX_S = 32;
  const WC_RESUME_DELAY_MS = 3000;
  // a pointer that travelled further than this since pointerdown was a swipe, not a tap — the
  // click it still fires at the end must not open the goal modal
  const WC_DRAG_SLOP_PX = 8;
  const wcReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let wcTrack = null;
  let wcPaused = false;
  let wcModalOpen = false;
  // set when one full set of cards already fits the viewport — nothing to scroll, so no clone
  // set is built and the marquee stays parked
  let wcStatic = true;
  let wcResumeTimer = null;
  let wcProgrammatic = false;
  let wcLastTs = null;
  let wcPointerStart = null;
  let wcDragMoved = false;
  // float accumulator for scroll position — viewport.scrollLeft rounds to whole pixels on
  // most displays, so reading it back every frame and adding a sub-pixel delta would round
  // the movement away to nothing; this tracks true position and only writes rounded pixels out
  let wcScrollPos = 0;

  function wcScheduleResume(){
    clearTimeout(wcResumeTimer);
    wcResumeTimer = setTimeout(() => { wcPaused = false; }, WC_RESUME_DELAY_MS);
  }
  function wcOnUserActivity(){
    wcPaused = true;
    wcScheduleResume();
  }
  function wcWrap(viewport){
    if(!wcTrack || wcStatic) return;
    const setWidth = wcTrack.scrollWidth / 2;
    if(setWidth <= 0) return;
    if(viewport.scrollLeft >= setWidth){
      wcProgrammatic = true;
      viewport.scrollLeft -= setWidth;
    } else if(viewport.scrollLeft < 0){
      wcProgrammatic = true;
      viewport.scrollLeft += setWidth;
    }
  }
  function wcTick(ts){
    requestAnimationFrame(wcTick);
    const viewport = el('workingCarousel');
    if(!viewport || !wcTrack) { wcLastTs = null; return; }
    if(wcLastTs == null){ wcLastTs = ts; wcScrollPos = viewport.scrollLeft; return; }
    const dt = Math.min(ts - wcLastTs, 100) / 1000;
    wcLastTs = ts;
    if(wcPaused || wcModalOpen || wcStatic || wcReducedMotion){ wcScrollPos = viewport.scrollLeft; return; }
    const setWidth = wcTrack.scrollWidth / 2;
    if(setWidth <= 0) return;
    wcScrollPos += WC_SPEED_PX_S * dt;
    if(wcScrollPos >= setWidth) wcScrollPos -= setWidth;
    wcProgrammatic = true;
    viewport.scrollLeft = wcScrollPos;
  }
  requestAnimationFrame(wcTick);
  (function wcSetupInteractionListeners(){
    const viewport = el('workingCarousel');
    if(!viewport) return;
    viewport.addEventListener('touchstart', wcOnUserActivity, {passive:true});
    viewport.addEventListener('pointerdown', e=>{
      wcPointerStart = {x:e.clientX, y:e.clientY};
      wcDragMoved = false;
      wcOnUserActivity();
    });
    viewport.addEventListener('pointermove', e=>{
      if(!wcPointerStart || wcDragMoved) return;
      if(Math.abs(e.clientX-wcPointerStart.x) > WC_DRAG_SLOP_PX || Math.abs(e.clientY-wcPointerStart.y) > WC_DRAG_SLOP_PX) wcDragMoved = true;
    }, {passive:true});
    viewport.addEventListener('wheel', wcOnUserActivity, {passive:true});
    viewport.addEventListener('scroll', () => {
      if(wcProgrammatic){ wcProgrammatic = false; return; }
      wcOnUserActivity();
      wcWrap(viewport);
      wcScrollPos = viewport.scrollLeft;
    });
  })();

  /* A hero card is a teaser and a single tap target — it opens the goal in the modal rather than
     expanding in place, because a 250px card can't hold the whole goal and an expanding one
     reflowed the strip around it.

     Anatomy, top to bottom: photo (or the goal's initial in its own colour) carrying the tier
     badge and the one large figure, the title, at most one chip, a subtask count paired with the
     open affordance, and a full-bleed progress rule along the bottom edge. Everything that used
     to compete for the eye — a second percentage, three chips, a bordered progress track — is
     either gone or has moved into the modal. */
  function buildWorkingCard(g){
    const pct = goalProgress(g);
    const doneSubs = g.subtasks.filter(s=>s.done).length;
    const t = tierInfo(g.tier);
    const initial = (g.title || '?').trim().charAt(0).toUpperCase();

    // one chip, not three: whether this goal is slipping outranks anything else it could say
    let metaHtml = '';
    if(goalNeedsAttention(g)) metaHtml = '<span class="chip attention-chip">Nothing logged today</span>';
    else if(g.targetDate) metaHtml = '<span class="chip">'+escapeHtml('Due ' + fmtDate(new Date(g.targetDate).getTime()))+'</span>';

    const card = document.createElement('div');
    card.className = 'wc-card' + (pct===100 ? ' is-done' : '');
    card.dataset.goalId = g.id;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', g.title + ' — ' + pct + '% done. Open goal.');
    if(g.color) card.style.setProperty('--wc-accent', g.color);
    card.innerHTML = '<div class="wc-media">'
      +   (g.imageUrl
            ? '<img src="'+g.imageUrl+'" alt="">'
            : '<span class="wc-media-fallback" aria-hidden="true">'+escapeHtml(initial)+'</span>')
      +   (t.value ? '<span class="tier-chip wc-tier '+t.cls+'">'+escapeHtml(t.value)+'</span>' : '')
      +   '<span class="wc-pct">'+pct+'%</span>'
      + '</div>'
      + '<div class="wc-card-body">'
      +   '<div class="wc-card-title">'+escapeHtml(g.title)+'</div>'
      +   (metaHtml ? '<div class="wc-card-meta">'+metaHtml+'</div>' : '')
      +   '<div class="wc-card-foot">'
      +     '<span class="wc-subs">'+(g.subtasks.length ? doneSubs+' of '+g.subtasks.length+' subtasks' : 'No subtasks yet')+'</span>'
      +     '<span class="wc-open">Open ▸</span>'
      +   '</div>'
      + '</div>'
      + '<div class="wc-bar"><div class="wc-bar-fill" style="width:'+pct+'%"></div></div>';

    card.addEventListener('click', ()=>{
      if(wcDragMoved) return; // the tap was really a swipe of the strip
      openGoalModal(g);
    });
    card.addEventListener('keydown', e=>{
      if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openGoalModal(g); }
    });

    return card;
  }

  function renderWorkingCarousel(){
    const wrap = el('workingCarouselWrap');
    const viewport = el('workingCarousel');
    const emptyEl = el('workingCarouselEmpty');
    const countEl = el('workingCount');
    if(!wrap || !viewport) return;
    const working = state.goals.filter(g=>g.workingOn && goalProgress(g)<100 && !isGoalLocked(g));
    if(countEl) countEl.textContent = working.length ? working.length + (working.length===1 ? ' goal' : ' goals') : '';
    if(!working.length){
      wrap.style.display='none';
      if(emptyEl) emptyEl.style.display='block';
      viewport.innerHTML=''; wcTrack = null; wcStatic = true;
      return;
    }
    wrap.style.display='block';
    if(emptyEl) emptyEl.style.display='none';

    // preserve the current scroll position (as a fraction of one set's width) across re-renders,
    // so routine state updates elsewhere don't yank the carousel back to the start
    const prevSetWidth = (wcTrack && !wcStatic) ? wcTrack.scrollWidth / 2 : 0;
    const prevFraction = prevSetWidth > 0 ? (viewport.scrollLeft % prevSetWidth) / prevSetWidth : 0;

    viewport.innerHTML='';
    const track = document.createElement('div');
    track.className = 'wc-track';
    working.forEach(g => track.appendChild(buildWorkingCard(g)));
    viewport.appendChild(track);

    // A strip that already fits its viewport has nothing to scroll: cloning it there would leave
    // a visible gap and the marquee would jump across it. This is what kept the carousel
    // phone-only before — it now just goes static instead of being hidden on a wide screen.
    // scrollWidth carries the last card's trailing 12px margin, and clientWidth carries the
    // viewport's own 10px of side padding — both come off before the comparison
    wcStatic = (track.scrollWidth - 12) <= (viewport.clientWidth - 10);
    if(!wcStatic){
      // duplicate the set so scrollLeft can wrap seamlessly once it passes one full set's width
      working.forEach(g => {
        const clone = buildWorkingCard(g);
        clone.classList.add('wc-clone');
        clone.setAttribute('aria-hidden', 'true');
        clone.setAttribute('tabindex', '-1');
        track.appendChild(clone);
      });
    }

    wcTrack = track;
    wcLastTs = null;
    if(wcStatic){ wcScrollPos = 0; return; }
    requestAnimationFrame(() => {
      const setWidth = track.scrollWidth / 2;
      wcProgrammatic = true;
      viewport.scrollLeft = prevFraction * setWidth;
      wcScrollPos = viewport.scrollLeft;
    });
  }

  const SWATCHES = ['#6366F1','#16A34A','#EF4444','#F5A524','#3B82F6','#EC4899','#6B7280'];
  // goal tier rankings — 'value' is what's stored on the goal, 'cls' maps to the tier-chip CSS class
  const TIERS = [
    { value:'', label:'No tier' },
    { value:'F', label:'F Tier', cls:'tier-F' },
    { value:'B', label:'B Tier', cls:'tier-B' },
    { value:'A', label:'A Tier', cls:'tier-A' },
    { value:'S', label:'S Tier', cls:'tier-S' },
    { value:'S+', label:'S+ Tier', cls:'tier-Splus' },
    { value:'Mythical', label:'Mythical Tier', cls:'tier-Mythical' }
  ];
  function tierInfo(v){ return TIERS.find(t=>t.value===v) || TIERS[0]; }

  /* drag-to-reorder goals — registered once, delegated over #goalList */
  let draggedGoalId = null;
  const goalListEl = el('goalList');
  goalListEl.addEventListener('dragstart', e=>{
    const handle = e.target.closest('.drag-handle');
    if(!handle) return;
    const card = handle.closest('.goal');
    draggedGoalId = card ? card.dataset.goalId : null;
    e.dataTransfer.effectAllowed = 'move';
  });
  goalListEl.addEventListener('dragover', e=>{
    if(!draggedGoalId) return;
    e.preventDefault();
    const overCard = e.target.closest('.goal');
    goalListEl.querySelectorAll('.goal.drag-over').forEach(c=>c.classList.remove('drag-over'));
    if(overCard && overCard.dataset.goalId !== draggedGoalId) overCard.classList.add('drag-over');
  });
  goalListEl.addEventListener('drop', e=>{
    if(!draggedGoalId) return;
    e.preventDefault();
    goalListEl.querySelectorAll('.goal.drag-over').forEach(c=>c.classList.remove('drag-over'));
    const overCard = e.target.closest('.goal');
    const toId = overCard ? overCard.dataset.goalId : null;
    const fromId = draggedGoalId; draggedGoalId = null;
    if(!toId || toId === fromId) return;
    const fromIdx = state.goals.findIndex(x=>x.id===fromId);
    const toIdx = state.goals.findIndex(x=>x.id===toId);
    if(fromIdx<0 || toIdx<0) return;
    const [moved] = state.goals.splice(fromIdx,1);
    state.goals.splice(toIdx,0,moved);
    save(); renderGoals();
  });
  goalListEl.addEventListener('dragend', ()=>{ draggedGoalId = null; goalListEl.querySelectorAll('.goal.drag-over').forEach(c=>c.classList.remove('drag-over')); });

  // goals whose "Goal settings" disclosure is open — UI-only, never persisted, but it has to
  // outlive the rerender that every subtask toggle triggers
  const goalMoreOpen = new Set();

  /* Builds a goal’s full detail body — subtasks (+AI suggestions), target/completion date,
     finance, tier, unlock requirement, color & image, delete. Shared by the goal list and the
     "Working on" carousel’s goal modal (renderGoalModal) so the two can never drift apart.
     `refreshHeadUI` is called after edits that only move progress, so each caller can update
     its own header in place instead of forcing a full rerender. */
  function buildGoalDetailInner(g, refreshHeadUI){
    const pct = goalProgress(g);
    const inner = document.createElement('div');
    inner.className = 'goal-detail-inner';

    // the dates the collapsed card used to wear as chips. One quiet line, read once on opening,
    // instead of four boxes competing with the goal's title on every card in the list.
    const timeline = document.createElement('div');
    timeline.className = 'g-timeline';
    timeline.innerHTML = '<span>Started <b>'+fmtDate(g.createdAt)+'</b></span>'
      + (g.updatedAt ? '<span>Updated <b>'+fmtDate(g.updatedAt)+'</b></span>' : '')
      + '<span><b>'+escapeHtml(timeSpentStr(g))+'</b></span>'
      + (pct===100 && g.completedAt ? '<span class="g-timeline-done">✦ Completed <b>'+fmtDate(g.completedAt)+'</b></span>' : '');
    inner.appendChild(timeline);

    const subLbl = document.createElement('div'); subLbl.className='section-lbl';
    subLbl.textContent = g.subtasks.length ? 'Subtasks · ' + g.subtasks.filter(s=>s.done).length + '/' + g.subtasks.length : 'Subtasks';
    inner.appendChild(subLbl);
    const subListEl = document.createElement('div'); subListEl.className='sub-list'; inner.appendChild(subListEl);

    // build one subtask row; reused for initial render, manual add, and AI suggestions so we never need a full rerender just to append a row
    function buildSubRow(s){
      const row = document.createElement('div'); row.className = 'sub-row'; row.dataset.subId = s.id;
      const idx = g.subtasks.findIndex(x=>x.id===s.id);
      const prereq = s.requiresId ? g.subtasks.find(x=>x.id===s.requiresId) : null;
      const blocked = !s.done && prereq && !prereq.done;
      // A full prerequisite dropdown on every row was the single busiest thing in here — a 110px
      // <select> per subtask, for a setting most subtasks never use. It now lives behind the ⛓
      // toggle and drops to its own line, and it opens automatically for rows that do have one,
      // so nothing in use is hidden.
      if(s.requiresId) row.classList.add('show-prereq');
      row.innerHTML = '<div class="sub-move">'
        + '<button class="sub-move-btn" type="button" data-dir="up" aria-label="Move up" '+(idx<=0?'disabled':'')+'>▲</button>'
        + '<button class="sub-move-btn" type="button" data-dir="down" aria-label="Move down" '+(idx>=g.subtasks.length-1?'disabled':'')+'>▼</button>'
        + '</div>'
        + '<div class="sub-check '+(s.done?'checked':'')+'" role="checkbox" tabindex="0" aria-checked="'+(s.done?'true':'false')+'" title="'+(blocked?'Locked until prerequisite is done':'')+'">'+(s.done?'✓':(blocked?'🔒':''))+'</div>'
        + '<div class="sub-title '+(s.done?'done':'')+'">'+escapeHtml(s.title)+(blocked?' <span class="chip">🔒 needs: '+escapeHtml(prereq.title)+'</span>':'')+'</div>'
        // ↳ rather than a chain/link emoji: it stays monochrome on every platform, next to the
        // ▲▼✕ glyphs already in this row
        + '<button class="sub-link" type="button" title="Set a prerequisite" aria-label="Set a prerequisite subtask" aria-expanded="'+(s.requiresId?'true':'false')+'">↳</button>'
        + '<button class="sub-del" type="button" aria-label="Delete subtask">✕</button>'
        + '<select class="sub-prereq" title="Requires this subtask to be done first" aria-label="Prerequisite subtask">'
          + '<option value="">No prerequisite</option>'
          + g.subtasks.filter(x=>x.id!==s.id).map(x=>'<option value="'+x.id+'" '+(s.requiresId===x.id?'selected':'')+'>Needs: '+escapeHtml(x.title.slice(0,22))+'</option>').join('')
        + '</select>';
      const linkBtn = row.querySelector('.sub-link');
      linkBtn.addEventListener('click', ()=>{
        const on = row.classList.toggle('show-prereq');
        linkBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
        if(on) row.querySelector('.sub-prereq').focus();
      });
      const checkEl = row.querySelector('.sub-check');
      checkEl.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); checkEl.click(); } });
      checkEl.addEventListener('click', ()=>{
        if(!s.done && isGoalLocked(g)) return; // locked goal — can uncheck, but can't check off subtasks toward completion
        if(!s.done && s.requiresId){
          const req = g.subtasks.find(x=>x.id===s.requiresId);
          if(req && !req.done) return; // prerequisite subtask not done yet
        }
        s.done=!s.done; touchGoal(g); save(); renderGoals();
      });
      row.querySelector('.sub-prereq').addEventListener('change', e=>{
        s.requiresId = e.target.value || null; touchGoal(g); save(); renderGoals();
      });
      row.querySelector('.sub-del').addEventListener('click', ()=>{
        g.subtasks=g.subtasks.filter(x=>x.id!==s.id);
        g.subtasks.forEach(x=>{ if(x.requiresId===s.id) x.requiresId=null; }); // clear dangling prerequisite refs
        touchGoal(g); save(); renderGoals();
      });
      row.querySelectorAll('.sub-move-btn').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          const i = g.subtasks.findIndex(x=>x.id===s.id);
          const dir = btn.dataset.dir==='up' ? -1 : 1;
          const j = i+dir;
          if(i<0 || j<0 || j>=g.subtasks.length) return;
          const tmp = g.subtasks[i]; g.subtasks[i]=g.subtasks[j]; g.subtasks[j]=tmp;
          touchGoal(g); save(); renderGoals();
        });
      });
      return row;
    }
    g.subtasks.forEach(s => { subListEl.appendChild(buildSubRow(s)); });

    const addSubRow = document.createElement('div'); addSubRow.className='add-sub-row';
    addSubRow.innerHTML = '<input type="text" class="mini-input" placeholder="Add a subtask..." maxlength="100"><button>+</button>';
    const subInput = addSubRow.querySelector('input');
    const doAddSub = () => {
      const v=subInput.value.trim(); if(!v) return;
      const ns = {id:uid(),title:v,done:false,requiresId:null};
      g.subtasks.push(ns); touchGoal(g); save();
      subListEl.appendChild(buildSubRow(ns));
      subInput.value='';
      refreshHeadUI();
    };
    addSubRow.querySelector('button').addEventListener('click', doAddSub);
    subInput.addEventListener('keydown', e=>{ if(e.key==='Enter') doAddSub(); });
    inner.appendChild(addSubRow);

    const aiWrap = document.createElement('div'); aiWrap.style.marginTop='10px';
    aiWrap.innerHTML = '<button class="ai-btn" data-ai>✦ Suggest subtasks with AI</button><div class="ai-sugg" style="display:none;"></div>';
    const aiBtn = aiWrap.querySelector('[data-ai]');
    const aiSuggDiv = aiWrap.querySelector('.ai-sugg');
    aiBtn.addEventListener('click', async () => {
      aiBtn.textContent = '✦ Thinking...'; aiBtn.disabled = true;
      try{
        const existing = g.subtasks.map(s=>s.title);
        const contextLine = existing.length
          ? 'Subtasks already added for this goal: ' + existing.join('; ') + '. Suggest 3-5 concise, actionable NEW subtasks (each under 8 words) that are not duplicates or rephrasings of the ones already added, and that logically build on what\'s already there to help finish this goal. Be brief.'
          : 'Break this goal into 5-8 concise, actionable subtasks (each under 8 words), ordered so they build on each other. Make the very first one absurdly small and easy — a near-zero-effort action that takes under 2 minutes, so easy it\'s hard to say no to — to create quick momentum. Be brief, no explanations.';
        // Calls our Supabase Edge Function instead of Anthropic directly — the API key
        // lives only as a server-side secret there, never in this browser code.
        const { data, error } = await supa.functions.invoke('suggest-subtasks', {
          body: { goalTitle: g.title, contextLine }
        });
        if(error) throw error;
        if(data && data.error) throw new Error(data.error);
        const suggestions = data.suggestions;
        aiSuggDiv.style.display = 'flex'; aiSuggDiv.innerHTML = '';
        suggestions.forEach(s => {
          const row = document.createElement('div'); row.className='ai-sugg-row';
          row.innerHTML = '<span>'+escapeHtml(s)+'</span><button>Add</button>';
          // adding a suggestion no longer wipes out the rest of the batch — we append the
          // subtask directly and just mark this row as added, instead of calling renderGoals()
          row.querySelector('button').addEventListener('click', ()=>{
            const ns = {id:uid(), title:s, done:false, requiresId:null};
            g.subtasks.push(ns); touchGoal(g); save();
            subListEl.appendChild(buildSubRow(ns));
            refreshHeadUI();
            row.classList.add('added');
            const btn = row.querySelector('button');
            btn.textContent = 'Added ✓'; btn.disabled = true;
          });
          aiSuggDiv.appendChild(row);
        });
      }catch(e){
        aiSuggDiv.style.display='flex';
        const msg = (e && e.message) ? e.message : 'Could not reach the AI right now, try again shortly.';
        aiSuggDiv.innerHTML = '<div class="ai-sugg-row"><span>'+escapeHtml(msg)+'</span></div>';
      }
      aiBtn.textContent = '✦ Suggest subtasks with AI'; aiBtn.disabled = false;
    });
    inner.appendChild(aiWrap);

    /* Everything from here down is configuration, not the work: dates, budget, tier, the unlock
       threshold, colour/image and delete. Six stacked sections turned an opened goal into a
       settings page with its subtasks stranded at the top, so they fold into one disclosure row.
       Open state is per goal and deliberately not persisted — it's a view, not data — but it does
       survive the rerender that fires on every subtask toggle. */
    const more = document.createElement('details');
    more.className = 'g-more';
    more.open = goalMoreOpen.has(g.id);
    more.innerHTML = '<summary class="g-more-summary">'
      + '<span class="g-more-title">Goal settings</span>'
      + '<span class="g-more-hint">Dates · Budget · Tier · Colour</span>'
      + '</summary>';
    more.addEventListener('toggle', ()=>{
      if(more.open) goalMoreOpen.add(g.id); else goalMoreOpen.delete(g.id);
    });
    const moreBody = document.createElement('div');
    moreBody.className = 'g-more-body';
    more.appendChild(moreBody);
    inner.appendChild(more);

    const dLbl = document.createElement('div'); dLbl.className='section-lbl'; dLbl.textContent='Target Date'; moreBody.appendChild(dLbl);
    const dRow = document.createElement('div'); dRow.className='inline-fields';
    dRow.innerHTML = '<input type="date" value="'+(g.targetDate||'')+'">';
    dRow.querySelector('input').addEventListener('change', e=>{ g.targetDate = e.target.value; touchGoal(g); save(); renderGoals(); });
    moreBody.appendChild(dRow);

    if(pct === 100){
      const compLbl = document.createElement('div'); compLbl.className='section-lbl'; compLbl.textContent='Completion Date'; moreBody.appendChild(compLbl);
      const compRow = document.createElement('div'); compRow.className='inline-fields';
      const compDateVal = g.completedAt ? localDateStr(new Date(g.completedAt)) : '';
      compRow.innerHTML = '<input type="date" value="'+compDateVal+'">';
      compRow.querySelector('input').addEventListener('change', e=>{
        if(!e.target.value) return;
        const [y,m,d] = e.target.value.split('-').map(Number);
        const existing = g.completedAt ? new Date(g.completedAt) : new Date();
        g.completedAt = new Date(y, m-1, d, existing.getHours(), existing.getMinutes(), existing.getSeconds()).getTime();
        save(); renderGoals();
      });
      moreBody.appendChild(compRow);
    }

    const fLbl = document.createElement('div'); fLbl.className='section-lbl'; fLbl.textContent='Finance / Budget'; moreBody.appendChild(fLbl);
    const fRow = document.createElement('div'); fRow.className='inline-fields';
    fRow.innerHTML = '<span>Target $</span><input type="number" min="0" value="'+(g.financeTarget??'')+'" placeholder="e.g. 500"><span>Saved $</span><input type="number" min="0" value="'+(g.financeSaved||0)+'" style="width:90px;">';
    const finInputs = fRow.querySelectorAll('input');
    finInputs[0].addEventListener('change', ()=>{ g.financeTarget = finInputs[0].value===''?null:parseFloat(finInputs[0].value); touchGoal(g); save(); renderGoals(); });
    finInputs[1].addEventListener('change', ()=>{ g.financeSaved = parseFloat(finInputs[1].value)||0; touchGoal(g); save(); renderGoals(); });
    moreBody.appendChild(fRow);
    if(g.financeTarget){
      const fbar = document.createElement('div'); fbar.className='finance-bar';
      const finPct = Math.min(100, Math.round((g.financeSaved / g.financeTarget)*100));
      fbar.innerHTML = '<div class="finance-fill" style="width:'+finPct+'%"></div>';
      moreBody.appendChild(fbar);
      const fnote = document.createElement('div'); fnote.style.cssText='font-size:11px;color:var(--muted);margin-top:4px;';
      fnote.textContent = '$'+g.financeSaved+' of $'+g.financeTarget+' saved ('+finPct+'%)';
      moreBody.appendChild(fnote);
    }

    const tierLbl = document.createElement('div'); tierLbl.className='section-lbl'; tierLbl.textContent='Tier Ranking'; moreBody.appendChild(tierLbl);
    const tierRow = document.createElement('div'); tierRow.className='inline-fields';
    const tierSel = document.createElement('select'); tierSel.className='tier-select';
    tierSel.innerHTML = TIERS.map(t=>'<option value="'+t.value+'" '+(g.tier===t.value?'selected':'')+'>'+t.label+'</option>').join('');
    tierSel.addEventListener('change', ()=>{ g.tier = tierSel.value; touchGoal(g); save(); renderGoals(); });
    tierRow.appendChild(tierSel);
    moreBody.appendChild(tierRow);

    const unlockLbl = document.createElement('div'); unlockLbl.className='section-lbl'; unlockLbl.textContent='Unlock Requirement'; moreBody.appendChild(unlockLbl);
    const unlockRow = document.createElement('div'); unlockRow.className='inline-fields';
    unlockRow.innerHTML = '<span>Required net worth $</span><input type="number" min="0" value="'+(g.requiredNetWorth??'')+'" placeholder="e.g. 10000">';
    const unlockInput = unlockRow.querySelector('input');
    unlockInput.addEventListener('change', ()=>{ g.requiredNetWorth = unlockInput.value===''?null:parseFloat(unlockInput.value); touchGoal(g); save(); renderGoals(); });
    moreBody.appendChild(unlockRow);
    if(g.requiredNetWorth != null && g.requiredNetWorth !== ''){
      const unote = document.createElement('div');
      const stillLocked = isGoalLocked(g);
      unote.className = 'unlock-note' + (stillLocked ? '' : ' met');
      unote.textContent = stillLocked
        ? 'Locked — current net worth is $'+getNetWorthNum().toLocaleString()+', needs $'+Number(g.requiredNetWorth).toLocaleString()+'.'
        : 'Unlocked — net worth requirement met.';
      moreBody.appendChild(unote);
    }

    const cLbl = document.createElement('div'); cLbl.className='section-lbl'; cLbl.textContent='Color & Image'; moreBody.appendChild(cLbl);
    const cRow = document.createElement('div'); cRow.className='swatches';
    cRow.innerHTML = '<div class="swatch-none '+(g.color?'':'selected')+'" title="No color"></div>'
      + SWATCHES.map(c=>'<div class="swatch '+(g.color===c?'selected':'')+'" style="background:'+c+';" data-color="'+c+'"></div>').join('')
      + '<input type="color" class="swatch-custom" value="'+(g.color||'#6366F1')+'">';
    cRow.querySelector('.swatch-none').addEventListener('click', ()=>{ g.color = ''; touchGoal(g); save(); renderGoals(); });
    cRow.querySelectorAll('.swatch').forEach(sw=>{
      // clicking the already-selected color clears it, so a color can always be unset from the swatches themselves
      sw.addEventListener('click', ()=>{ g.color = (g.color === sw.dataset.color) ? '' : sw.dataset.color; touchGoal(g); save(); renderGoals(); });
    });
    cRow.querySelector('.swatch-custom').addEventListener('change', e=>{ g.color = e.target.value; touchGoal(g); save(); renderGoals(); });
    moreBody.appendChild(cRow);

    const imgRow = document.createElement('div'); imgRow.className='img-row'; imgRow.style.marginTop='9px';
    imgRow.innerHTML = (g.imageUrl ? '<img class="goal-thumb" src="'+g.imageUrl+'">' : '')
      + '<label>Upload image<input type="file" accept="image/*" style="display:none;"></label>'
      + (g.imageUrl ? '<button class="del-goal" style="margin-left:4px;">Remove image</button>' : '');
    imgRow.querySelector('input[type=file]').addEventListener('change', (e)=>{
      const file = e.target.files[0]; if(!file) return;
      const prevUrl = g.imageUrl;
      uploadCompressedImage(file, 640, 0.78, 'goals').then(url=>{
        g.imageUrl = url; touchGoal(g); save(); renderGoals();
        deleteStorageImage(prevUrl);
      }).catch(err=> window.alert(err.message));
    });
    const rmBtn = imgRow.querySelector('.del-goal');
    if(rmBtn) rmBtn.addEventListener('click', ()=>{ deleteStorageImage(g.imageUrl); g.imageUrl = ''; touchGoal(g); save(); renderGoals(); });
    moreBody.appendChild(imgRow);

    // the completed date moved up to the timeline line, so the footer is just its one action now
    const footer = document.createElement('div'); footer.className='goal-footer';
    footer.innerHTML = '<span class="completed-tag"></span><button class="del-goal" type="button">Delete goal</button>';
    footer.querySelector('.del-goal').addEventListener('click', ()=>{ state.goals = state.goals.filter(x=>x.id!==g.id); save(); renderGoals(); });
    moreBody.appendChild(footer);

    return inner;
  }

  /* ==================== SHEETS ====================
     Two on this tab — the goal detail (opened from a carousel card) and the goal list (opened from
     the board's counters). createSheet() owns everything that makes one a sheet: the enter/exit
     transition, freezing the page behind it, backdrop/Escape dismissal, the focus trap and the
     swipe-down gesture. Callers only supply what goes inside and when to open it. */

  const SHEET_ANIM_MS = 320;       // must outlast the exit transition — see .g-sheet-card in styles
  const SHEET_DISMISS_PX = 80;
  const SHEET_DISMISS_VEL = 0.35;  // px per ms over the last few moves — a short flick counts
  const SHEET_CANCELLED_PX = 32;   // an interrupted swipe that had clearly committed
  const SHEET_DRAG_SLOP = 5;       // downward pull at the top before the sheet takes over
  const SHEET_FADE_OVER = 320;     // drag distance across which the backdrop fades out

  /* Scroll priority: while a sheet is open the page behind it is frozen, so every swipe belongs to
     the card. Without this, a touch that lands on the backdrop — or one that runs past the end of
     the card's own scroll — moves the goals tab underneath instead, which reads as the sheet
     ignoring you. Counted, because two sheets share it. */
  let pageScrollLockY = 0, pageScrollLocks = 0;
  function lockPageScroll(){
    if(pageScrollLocks++ > 0) return;
    pageScrollLockY = window.scrollY || document.documentElement.scrollTop || 0;
    // the offset is what keeps the frozen page looking untouched: body goes fixed, and pulling it
    // up by the current scroll position leaves the same content under the backdrop
    document.body.style.top = (-pageScrollLockY) + 'px';
    document.body.classList.add('goal-modal-open');
  }
  function unlockPageScroll(){
    if(pageScrollLocks === 0 || --pageScrollLocks > 0) return;
    document.body.classList.remove('goal-modal-open');
    document.body.style.top = '';
    window.scrollTo(0, pageScrollLockY);
  }

  function createSheet(overlayId, cardId, opts){
    opts = opts || {};
    const overlay = el(overlayId);
    const card = el(cardId);
    let shown = false, hideTimer = null, returnFocus = null;

    function open(focusSelector){
      clearTimeout(hideTimer); // reopening mid-close must not get torn down by the old timer
      if(!shown){ returnFocus = document.activeElement; lockPageScroll(); }
      shown = true;
      card.style.transform = '';
      card.style.overflowY = ''; // in case a drag was still in flight when this ran
      overlay.style.removeProperty('--backdrop-o');
      overlay.classList.remove('is-dragging');
      overlay.style.display = 'flex';
      // Two frames: the first commits display:flex with the card still in its pre-open state, the
      // second flips the class. In one frame the browser coalesces both and the transition is
      // skipped entirely, so the sheet would just appear.
      requestAnimationFrame(()=> requestAnimationFrame(()=> overlay.classList.add('is-open')));
      // preventScroll because the card is still off-screen at this point on a phone
      const target = focusSelector ? card.querySelector(focusSelector) : null;
      if(target) target.focus({preventScroll:true});
    }

    function close(){
      if(!shown) return;
      shown = false;
      // first, so a renderGoals() triggered anywhere below doesn't rebuild a sheet on its way out
      if(opts.onClose) opts.onClose();
      overlay.classList.remove('is-open', 'is-dragging');
      // dropping the drag's inline transform lets the class rule take over — the transition runs
      // from wherever the finger left the card down to its closed position
      card.style.transform = '';
      card.style.overflowY = ''; // a drag freezes it; closing any other way must not leave it frozen
      overlay.style.removeProperty('--backdrop-o');
      // released now, not after the exit animation: the restore is a synchronous scrollTo, so doing
      // it while the backdrop is still up keeps it invisible
      unlockPageScroll();
      // preventScroll: the page is already back exactly where it was, and focusing a carousel card
      // would otherwise scroll it into view and undo that
      if(returnFocus && document.contains(returnFocus)) returnFocus.focus({preventScroll:true});
      returnFocus = null;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(()=>{
        overlay.style.display = 'none';
        card.scrollTop = 0;
        if(opts.onHidden) opts.onHidden();
      }, wcReducedMotion ? 0 : SHEET_ANIM_MS);
    }

    overlay.addEventListener('click', e=>{ if(e.target === overlay) close(); });
    document.addEventListener('keydown', e=>{ if(e.key === 'Escape' && shown) close(); });
    // aria-modal only describes the intent; without this, Tab walks straight out of the dialog and
    // into the page behind it
    overlay.addEventListener('keydown', e=>{
      if(e.key !== 'Tab') return;
      const focusables = card.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
      if(!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length-1];
      if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    });

    /* Swipe down to dismiss — one continuous gesture with scrolling, not a separate one.

       Scrolling a long sheet and then dismissing it used to take two swipes: the first scrolled the
       content to the top, and only a second one, started at the top, could grab the sheet. That's a
       limitation of pointer events, which the browser *cancels* the moment it decides a touch
       belongs to a scroller — so the drag could never be picked up mid-gesture.

       Touch events don't get cancelled that way: touchmove keeps firing all the way through a
       native scroll. So the browser keeps doing the scrolling (momentum and all — nothing here
       fights it), and this watches the finger. The instant the card is pinned at its top and the
       finger is still travelling down, the sheet takes over from exactly that point, and the pull
       continues into the drag without a seam.

       `overscroll-behavior:none` on the card is what makes that moment clean: at the top there is
       no rubber-band of its own to compound with the transform. */
    let tracking = false, dragging = false, justDragged = false;
    let lastY = 0, originY = 0, pull = 0, dy = 0;
    // the last handful of positions, so a flick is measured over the moment it happened rather
    // than averaged across the whole gesture — a fast 60px swipe that begins slowly averages out
    // to nothing, which is one way a real dismissal used to fall under the threshold
    let samples = [];
    function recentVelocity(){
      if(samples.length < 2) return 0;
      const a = samples[0], b = samples[samples.length-1];
      return b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0;
    }

    card.addEventListener('touchstart', e=>{
      justDragged = false;
      dragging = false; pull = 0; dy = 0;
      // pinch/two-finger gestures aren't ours
      if(e.touches.length !== 1){ tracking = false; return; }
      // nor is a drag inside a field — that's the caret and text selection, and nothing here
      // preventDefaults, so the two would both answer the same finger. Same for a sideways-
      // scrolling strip: a thumb swiping the filter row drifts down enough to trip the handoff.
      if(e.target.closest('input, select, textarea, .goal-filters')){ tracking = false; return; }
      tracking = true;
      lastY = e.touches[0].clientY;
      samples = [{y:lastY, t:e.timeStamp}];
    }, {passive:true});

    card.addEventListener('touchmove', e=>{
      if(!tracking) return;
      if(e.touches.length !== 1){ tracking = false; return; }
      const y = e.touches[0].clientY;
      const step = y - lastY;
      lastY = y;
      samples.push({y, t:e.timeStamp});
      if(samples.length > 5) samples.shift();

      if(!dragging){
        // The handoff. Only counts while the content has nothing left to scroll, and resets the
        // moment the finger goes back up, so an ordinary scroll never trips it.
        if(card.scrollTop <= 0 && step > 0){
          pull += step;
          if(pull > SHEET_DRAG_SLOP){
            dragging = true;
            originY = y - pull;  // carry the pull already made, so the sheet doesn't jump
            overlay.classList.add('is-dragging');
            // the browser is mid-gesture on this scroller; freezing it stops the two from both
            // answering the same finger once the sheet starts moving
            card.style.overflowY = 'hidden';
          }
        } else if(step < 0){
          pull = 0;
        }
        if(!dragging) return;
      }

      dy = Math.max(0, y - originY);
      card.style.transform = 'translateY(' + dy + 'px)';
      overlay.style.setProperty('--backdrop-o', String(Math.max(0, 1 - dy / SHEET_FADE_OVER)));
    }, {passive:true});

    const endDrag = (e, cancelled) => {
      if(!tracking) return;
      const wasDragging = dragging;
      tracking = false; dragging = false; pull = 0;
      overlay.classList.remove('is-dragging');
      card.style.overflowY = '';
      if(!wasDragging) return;
      justDragged = true;
      // A cancelled gesture never gets to finish, so it can't be judged by where it stopped — if
      // it was already well on its way down, honour the swipe rather than snapping back at the
      // user. Dismissing costs nothing: every edit in here has already saved.
      const dismiss = dy > SHEET_DISMISS_PX
        || recentVelocity() > SHEET_DISMISS_VEL
        || (cancelled && dy > SHEET_CANCELLED_PX);
      if(dismiss){ close(); return; }
      // under the threshold: clearing the inline transform springs it back, since removing
      // .is-dragging has already restored the transition
      card.style.transform = '';
      overlay.style.removeProperty('--backdrop-o');
    };
    card.addEventListener('touchend', e=> endDrag(e, false), {passive:true});
    card.addEventListener('touchcancel', e=> endDrag(e, true), {passive:true});
    // a drag that happens to end over a button would otherwise fire it; the flag is cleared on the
    // next touchstart, so a genuine tap is never swallowed
    card.addEventListener('click', e=>{
      if(!justDragged) return;
      justDragged = false;
      e.stopPropagation();
      e.preventDefault();
    }, true);

    return { open, close, card, isOpen: ()=> shown };
  }

  /* ---------- goal detail sheet — tapping a "Working on" carousel card opens the whole goal here.
     The body is buildGoalDetailInner(), i.e. exactly what the list shows when a goal is expanded,
     so every edit behaves the same in both places. ---------- */
  let openGoalModalId = null;
  const goalSheet = createSheet('goalModalOverlay', 'goalModalBody', {
    onClose: ()=>{
      openGoalModalId = null;
      wcModalOpen = false;
    },
    onHidden: ()=>{ el('goalModalBody').innerHTML = ''; }
  });
  function openGoalModal(g){
    openGoalModalId = g.id;
    wcModalOpen = true; // the strip keeps auto-scrolling behind the backdrop otherwise
    // before the render, which preserves whatever scroll position it finds: reopening within the
    // exit animation skips the teardown that would otherwise have reset it
    goalSheet.card.scrollTop = 0;
    renderGoalModal();
    // focus only on open — renderGoalModal() also runs on every later rerender, and moving focus
    // there would yank it out of whatever field the user is typing in
    goalSheet.open('.goal-modal-close');
  }
  function closeGoalModal(){ goalSheet.close(); }

  /* ---------- goal list sheet — the list, its filters, sorting and the add field. Opened by the
     counters on the board. The list DOM is only built while this is open (see renderGoals), so the
     dashboard doesn't pay to render a list nobody is looking at. ---------- */
  let goalListOpen = false;
  const goalListSheet = createSheet('goalListOverlay', 'goalListBody', {
    onClose: ()=>{ goalListOpen = false; }
  });
  function openGoalList(filter){
    if(filter) goalFilter = filter;
    goalListOpen = true;
    renderGoals();                        // builds the list now that something will look at it
    goalListSheet.open('#goalListCloseBtn');
  }
  el('goalListCloseBtn').addEventListener('click', ()=> goalListSheet.close());
  el('goalFilters').addEventListener('click', e=>{
    const btn = e.target.closest('[data-filter]');
    if(!btn) return;
    goalFilter = btn.dataset.filter;
    renderGoals();
    el('goalListBody').scrollTop = 0;     // a new filter is a new list; start it at the top
  });

  // filter pill labels double as the sheet's title, so the two can't disagree
  const GOAL_FILTER_TITLES = { working:'Working on', unfinished:'Unfinished', completed:'Completed', locked:'Locked', all:'All goals' };
  function renderGoalListChrome(counts){
    el('goalListTitle').textContent = GOAL_FILTER_TITLES[goalFilter] || 'Goals';
    el('flWorking').textContent = counts.working;
    el('flOpen').textContent = counts.unfinished;
    el('flDone').textContent = counts.completed;
    el('flLocked').textContent = counts.locked;
    el('flTotal').textContent = counts.all;
    el('goalFilters').querySelectorAll('[data-filter]').forEach(b=>{
      b.classList.toggle('active', b.dataset.filter === goalFilter);
    });
  }

  function renderGoalModal(){
    const body = el('goalModalBody');
    const g = state.goals.find(x=>x.id===openGoalModalId);
    // covers deleting the goal from inside the modal — the delete handler just calls renderGoals()
    if(!g){ closeGoalModal(); return; }
    const prevScroll = body.scrollTop;
    const pct = goalProgress(g);
    const locked = isGoalLocked(g);

    // same trimmed set as the list card — the dates live in the detail's timeline line below
    let metaHtml = '';
    const t = tierInfo(g.tier);
    if(t.value) metaHtml += '<span class="tier-chip '+t.cls+'">'+escapeHtml(t.label)+'</span>';
    if(goalNeedsAttention(g)) metaHtml += '<span class="chip attention-chip">Nothing logged today</span>';
    if(locked) metaHtml += '<span class="lock-badge">🔒 Needs $'+Number(g.requiredNetWorth).toLocaleString()+' net worth</span>';
    if(g.subtasks.length) metaHtml += '<span class="chip subtask-chip">'+escapeHtml(g.subtasks.filter(s=>s.done).length + '/' + g.subtasks.length + ' subtasks')+'</span>';
    if(g.targetDate) metaHtml += '<span class="chip">'+escapeHtml('Due ' + fmtDate(new Date(g.targetDate).getTime()))+'</span>';

    body.innerHTML = '<div class="goal-modal-banner'+(g.imageUrl?'':' empty')+'">'
      +   (g.imageUrl ? '<img src="'+g.imageUrl+'" alt="">' : '')
      // the grab bar is CSS-hidden above the sheet breakpoint, where there's no swipe to advertise
      +   '<span class="goal-sheet-grip" aria-hidden="true"></span>'
      +   '<button class="goal-modal-close" type="button" title="Close" aria-label="Close goal">✕</button>'
      + '</div>'
      // Title row is the title and nothing else. The rename and star buttons used to flank it,
      // which on a 340px sheet left the title about eleven characters before it wrapped; they sit
      // with "Work on this" now, in one row of real controls.
      + '<div class="goal-modal-head">'
      +   '<div class="goal-modal-title-row">'
      +     '<div class="goal-check '+(pct===100?'checked':'')+'" data-act="check" role="checkbox" tabindex="0" aria-checked="'+(pct===100?'true':'false')+'" aria-label="'+(locked?'Locked until the net worth requirement is met':'Mark goal complete')+'" title="'+(locked?'Locked until net worth requirement is met':'Mark complete')+'">'+(locked ? '🔒' : (pct===100?'✓':''))+'</div>'
      +     '<div class="goal-modal-title" id="goalModalTitle">'+escapeHtml(g.title)+'</div>'
      +   '</div>'
      +   (metaHtml ? '<div class="goal-meta goal-modal-meta">'+metaHtml+'</div>' : '')
      +   '<div class="goal-modal-prog">'
      +     '<div class="mini-track"><div class="mini-fill" style="width:'+pct+'%"></div></div>'
      +     '<span class="progress-pct">'+pct+'%</span>'
      +   '</div>'
      +   '<div class="goal-modal-actions">'
      +     (pct<100 && !locked
              ? '<button class="working-btn '+(g.workingOn?'active':'')+'" type="button" data-act="working" aria-pressed="'+(g.workingOn?'true':'false')+'">'+(g.workingOn?'▶ Working on':'Work on this')+'</button>'
              : '')
      +     '<button class="star-btn '+(g.starred?'active':'')+'" type="button" data-act="star" title="Star" aria-label="Star goal" aria-pressed="'+(g.starred?'true':'false')+'">'+(g.starred?'★':'☆')+'</button>'
      +     '<button class="rename-btn" type="button" data-act="rename" title="Rename" aria-label="Rename goal">✎</button>'
      +   '</div>'
      + '</div>';

    // same in-place head refresh the goal list does, so adding a subtask doesn't rebuild the
    // modal out from under the input the user is typing in
    function refreshModalHead(){
      updateCompletionMeta(g);
      const pct2 = goalProgress(g);
      const checkEl = body.querySelector('[data-act="check"]');
      if(checkEl && !isGoalLocked(g)){
        checkEl.className = 'goal-check ' + (pct2===100?'checked':'');
        checkEl.textContent = pct2===100?'✓':'';
        checkEl.setAttribute('aria-checked', pct2===100 ? 'true' : 'false');
      }
      const fillEl = body.querySelector('.goal-modal-prog .mini-fill');
      if(fillEl) fillEl.style.width = pct2+'%';
      const pctEl = body.querySelector('.goal-modal-prog .progress-pct');
      if(pctEl) pctEl.textContent = pct2+'%';
      let subChip = body.querySelector('.goal-modal-meta .subtask-chip');
      const chipText = g.subtasks.filter(s=>s.done).length + '/' + g.subtasks.length + ' subtasks';
      if(subChip){ subChip.textContent = chipText; }
      else if(g.subtasks.length){
        subChip = document.createElement('span'); subChip.className='chip subtask-chip'; subChip.textContent = chipText;
        // a goal with no chips at all renders no meta row, so the first subtask brings it along
        let metaWrap = body.querySelector('.goal-modal-meta');
        if(!metaWrap){
          metaWrap = document.createElement('div'); metaWrap.className = 'goal-meta goal-modal-meta';
          body.querySelector('.goal-modal-title-row').after(metaWrap);
        }
        metaWrap.prepend(subChip);
      }
      renderWorkingCarousel(); // the card behind the modal shows the same numbers
    }

    body.appendChild(buildGoalDetailInner(g, refreshModalHead));

    // set as a property, not interpolated into the markup — escapeHtml() leaves double quotes alone
    if(g.color) body.querySelector('.goal-modal-banner').style.setProperty('--goal-accent', g.color);

    body.querySelector('.goal-modal-close').addEventListener('click', closeGoalModal);
    body.querySelector('[data-act="star"]').addEventListener('click', ()=>{ g.starred = !g.starred; touchGoal(g); save(); renderGoals(); });
    const workingBtn = body.querySelector('[data-act="working"]');
    if(workingBtn) workingBtn.addEventListener('click', ()=>{ markWorkingOn(g, !g.workingOn); touchGoal(g); save(); renderGoals(); });
    const checkEl = body.querySelector('[data-act="check"]');
    checkEl.addEventListener('click', ()=>{
      if(isGoalLocked(g)) return; // locked goals can't be marked done until the net worth requirement is met
      if(g.subtasks.length === 0){ g.manualDone = !g.manualDone; }
      else { const allDone = g.subtasks.every(s=>s.done); g.subtasks.forEach(s => s.done = !allDone); }
      touchGoal(g); save(); renderGoals();
    });
    checkEl.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); checkEl.click(); } });
    body.querySelector('[data-act="rename"]').addEventListener('click', ()=>{
      const titleEl = body.querySelector('.goal-modal-title');
      const input = document.createElement('input');
      input.type = 'text'; input.className = 'rename-input goal-modal-title'; input.maxLength = 80; input.value = g.title;
      input.id = 'goalModalTitle'; // keeps the dialog's aria-labelledby target alive while renaming
      input.setAttribute('aria-label', 'Goal title');
      titleEl.replaceWith(input);
      input.focus(); input.select();
      let settled = false;
      const finish = (apply) => {
        if(settled) return; settled = true; // blur fires again once the rerender pulls the input
        if(apply){ const v = input.value.trim(); if(v && v !== g.title){ g.title = v; touchGoal(g); save(); } }
        renderGoals();
      };
      // Escape must not reach the document-level handler, or cancelling the rename closes the modal
      input.addEventListener('keydown', e=>{ e.stopPropagation(); if(e.key==='Enter') finish(true); if(e.key==='Escape') finish(false); });
      input.addEventListener('blur', ()=> finish(true));
    });

    body.scrollTop = prevScroll;
  }

  function renderGoals(){
    renderMantra();
    renderPinnedCountdown();
    updateGoalReminder();
    renderWorkingCarousel();

    const list = el('goalList');
    const empty = el('emptyState');

    let totalPct = 0, completedCount = 0;
    state.goals.forEach(g => {
      // field defaults for goals saved before each was added — this used to run over the visible
      // list only, which no longer runs at all while the list sheet is closed
      if(g.financeTarget === undefined) g.financeTarget = null;
      if(g.financeSaved === undefined) g.financeSaved = 0;
      if(g.targetDate === undefined) g.targetDate = '';
      if(g.color === undefined) g.color = '';
      if(g.imageUrl === undefined) g.imageUrl = '';
      if(g.tier === undefined) g.tier = '';
      if(g.requiredNetWorth === undefined) g.requiredNetWorth = null;
      if(g.updatedAt === undefined) g.updatedAt = g.createdAt;
      if(g.workingOn === undefined) g.workingOn = false;
      // old records predate the field; they keep counting from createdAt until next marked
      if(g.workingOnAt === undefined) g.workingOnAt = null;
      g.subtasks.forEach(s=>{ if(s.requiresId === undefined) s.requiresId = null; });
      updateCompletionMeta(g);
      totalPct += goalProgress(g);
      if(goalProgress(g)===100) completedCount++;
    });

    // the list lives in a sheet now; while it's shut there is nothing to build. Everything below
    // this block — the counters, the carousel, the heat map, exp — still runs every time.
    const visible = goalListOpen ? visibleGoals() : [];
    if(goalListOpen){
      if(state.goals.length === 0){
        empty.style.display = 'block';
        empty.innerHTML = 'No goals yet. <b>Add your first goal above</b> to get started.';
      } else if(visible.length === 0 && goalFilter === 'working'){
        empty.style.display = 'block';
        empty.innerHTML = 'Nothing marked as <b>working on</b> yet. Open any goal and tap <b>▶ Work on this</b>, or switch to <b>All</b>.';
      } else if(visible.length === 0){
        empty.style.display = 'block';
        empty.innerHTML = 'Nothing here under this filter.';
      } else {
        empty.style.display = 'none';
      }
    }
    list.innerHTML = '';

    visible.forEach(g => {
      const pct = goalProgress(g);
      const locked = isGoalLocked(g);

      const card = document.createElement('div');
      card.className = 'goal' + (pct===100 ? ' done' : '') + (g.open ? ' open' : '') + (locked ? ' locked' : '') + (goalNeedsAttention(g) ? ' needs-attention' : '');
      card.dataset.goalId = g.id;
      if(g.color) card.style.borderLeftColor = g.color;

      /* A collapsed row is for scanning, so it holds only what you scan by: done state, picture,
         title, rank, one status mark and the percentage — one line, ~45px, so a dozen goals fit a
         phone screen at once. Everything else (the rest of the chips, the edit buttons) is in the
         card but CSS-hidden until it's expanded; the progress bar became a 3px full-bleed rule
         along the bottom edge, which costs no row of its own. */
      const t = tierInfo(g.tier);
      // exactly one, in order of what would make you act: blocked, then slipping, then in flight
      let markHtml = '';
      if(locked) markHtml = '<span class="goal-mark is-locked" title="Locked" aria-label="Locked">🔒</span>';
      else if(goalNeedsAttention(g)) markHtml = '<span class="goal-mark is-risk" title="Nothing logged today" aria-label="Nothing logged today">●</span>';
      else if(g.workingOn && pct<100) markHtml = '<span class="goal-mark is-working" title="Working on" aria-label="Working on">▶</span>';

      let metaHtml = '';
      if(g.workingOn && pct<100 && !locked) metaHtml += '<span class="chip working-chip">▶ Working on</span>';
      if(goalNeedsAttention(g)) metaHtml += '<span class="chip attention-chip">Nothing logged today</span>';
      if(locked) metaHtml += '<span class="lock-badge">🔒 Needs $'+Number(g.requiredNetWorth).toLocaleString()+' net worth</span>';
      if(g.subtasks.length) metaHtml += '<span class="chip subtask-chip">'+escapeHtml(g.subtasks.filter(s=>s.done).length + '/' + g.subtasks.length + ' subtasks')+'</span>';
      if(g.targetDate) metaHtml += '<span class="chip">'+escapeHtml('Due ' + fmtDate(new Date(g.targetDate).getTime()))+'</span>';

      const head = document.createElement('div');
      head.className = 'goal-head';
      // the head is the expand control, so it announces itself as one and answers the keyboard —
      // it was a bare <div onclick> that only a pointer could reach
      head.setAttribute('role', 'button');
      head.setAttribute('tabindex', '0');
      head.setAttribute('aria-expanded', g.open ? 'true' : 'false');
      head.innerHTML = '<div class="goal-head-top">'
        +   '<span class="drag-handle" draggable="true" title="Drag to reorder" aria-hidden="true">⠿</span>'
        +   '<div class="goal-check ' + (pct===100?'checked':'') + '" data-act="check" role="checkbox" tabindex="0" aria-checked="'+(pct===100?'true':'false')+'" aria-label="'+(locked?'Locked until the net worth requirement is met':'Mark goal complete')+'" title="'+(locked?'Locked until net worth requirement is met':'Mark complete')+'">' + (locked ? '🔒' : (pct===100?'✓':'')) + '</div>'
        +   (g.imageUrl ? '<img class="goal-thumb" src="'+g.imageUrl+'" alt="">' : '')
        +   '<div class="goal-title-wrap"><div class="goal-title">' + escapeHtml(g.title) + '</div></div>'
        // "Mythical" down to M, so the one long tier can't eat the title's width; its gold makes it
        // unmistakable anyway, and the full label is on the expanded card
        +   (t.value ? '<span class="tier-chip goal-tier '+t.cls+'" title="'+escapeHtml(t.label)+'">'+escapeHtml(t.value === 'Mythical' ? 'M' : t.value)+'</span>' : '')
        +   markHtml
        +   '<span class="progress-pct">'+pct+'%</span>'
        +   '<div class="chevron" aria-hidden="true">▶</div>'
        + '</div>'
        + (metaHtml ? '<div class="goal-meta">' + metaHtml + '</div>' : '')
        + '<div class="goal-foot-row">'
        +   '<div class="goal-actions">'
        +     '<button class="rename-btn" type="button" data-act="rename" title="Rename" aria-label="Rename goal">✎</button>'
        +     '<button class="star-btn ' + (g.starred?'active':'') + '" type="button" data-act="star" title="Star" aria-label="Star goal" aria-pressed="'+(g.starred?'true':'false')+'">' + (g.starred?'★':'☆') + '</button>'
        +     (pct<100 && !locked ? '<button class="working-btn ' + (g.workingOn?'active':'') + '" type="button" data-act="working" title="Mark as actively working on this" aria-pressed="'+(g.workingOn?'true':'false')+'">' + (g.workingOn?'▶ Working on':'Work on this') + '</button>' : '')
        +   '</div>'
        + '</div>'
        // full-bleed under the row: progress without a row of its own
        + '<div class="goal-bar"><div class="mini-fill" style="width:'+pct+'%"></div></div>';
      head.addEventListener('keydown', e=>{
        if(e.key !== 'Enter' && e.key !== ' ') return;
        // real <button>s answer these keys themselves; this covers only the head's own surface
        // and the checkbox-role div inside it
        if(e.target.closest('button, .drag-handle')) return;
        e.preventDefault();
        (e.target.closest('[data-act="check"]') || head).click();
      });
      head.addEventListener('click', (e) => {
        if(e.target.closest('.drag-handle')) return;
        const act = e.target.closest('[data-act]');
        if(act && act.dataset.act === 'rename'){
          e.stopPropagation();
          const titleEl = head.querySelector('.goal-title');
          const input = document.createElement('input');
          input.type = 'text'; input.className = 'rename-input'; input.maxLength = 80; input.value = g.title;
          input.style.width = '100%';
          titleEl.replaceWith(input);
          input.focus(); input.select();
          const commit = () => {
            const v = input.value.trim();
            if(v) g.title = v;
            touchGoal(g); save(); renderGoals();
          };
          input.addEventListener('click', e2 => e2.stopPropagation());
          input.addEventListener('keydown', e2 => { if(e2.key==='Enter') commit(); if(e2.key==='Escape') renderGoals(); });
          input.addEventListener('blur', commit);
          return;
        }
        if(act && act.dataset.act === 'star'){ e.stopPropagation(); g.starred = !g.starred; touchGoal(g); save(); renderGoals(); return; }
        if(act && act.dataset.act === 'working'){ e.stopPropagation(); markWorkingOn(g, !g.workingOn); touchGoal(g); save(); renderGoals(); return; }
        if(act && act.dataset.act === 'check'){
          e.stopPropagation();
          if(isGoalLocked(g)) return; // locked goals can't be marked done until the net worth requirement is met
          if(g.subtasks.length === 0){ g.manualDone = !g.manualDone; }
          else { const allDone = g.subtasks.every(s=>s.done); g.subtasks.forEach(s => s.done = !allDone); }
          touchGoal(g); save(); renderGoals(); return;
        }
        if(g.open) g.open = false;
        else openGoalExclusive(g);
        renderGoals();
        // rAF so the rebuilt list has been laid out before the card is measured. Collapsing never
        // scrolls — the row you just closed is already where you're looking.
        if(g.open) requestAnimationFrame(()=> scrollGoalUnderBar(g.id));
      });

      const detail = document.createElement('div');
      detail.className = 'goal-detail';

      // refresh the head UI (progress bar, check state, subtask-count chip) without a full goal-list rerender
      function refreshHeadUI(){
        updateCompletionMeta(g);
        const pct2 = goalProgress(g);
        card.className = 'goal' + (pct2===100 ? ' done' : '') + (g.open ? ' open' : '') + (isGoalLocked(g) ? ' locked' : '') + (goalNeedsAttention(g) ? ' needs-attention' : '');
        if(g.color) card.style.borderLeftColor = g.color;
        const checkEl = head.querySelector('[data-act="check"]');
        if(checkEl){
          checkEl.className = 'goal-check ' + (pct2===100?'checked':'');
          checkEl.textContent = pct2===100?'✓':'';
          checkEl.setAttribute('aria-checked', pct2===100 ? 'true' : 'false');
        }
        const fillEl = head.querySelector('.mini-fill');
        if(fillEl) fillEl.style.width = pct2+'%';
        const pctEl = head.querySelector('.progress-pct');
        if(pctEl) pctEl.textContent = pct2+'%';
        let subChip = head.querySelector('.subtask-chip');
        const chipText = g.subtasks.filter(s=>s.done).length + '/' + g.subtasks.length + ' subtasks';
        if(subChip){ subChip.textContent = chipText; }
        else if(g.subtasks.length){
          subChip = document.createElement('span'); subChip.className='chip subtask-chip'; subChip.textContent = chipText;
          // a chipless card renders no .goal-meta at all (an empty one would still cost a row
          // gap), so the first subtask has to bring the row with it
          let metaWrap = head.querySelector('.goal-meta');
          if(!metaWrap){
            metaWrap = document.createElement('div'); metaWrap.className = 'goal-meta';
            head.querySelector('.goal-head-top').after(metaWrap);
          }
          metaWrap.prepend(subChip);
        }
      }

      detail.appendChild(buildGoalDetailInner(g, refreshHeadUI));
      card.appendChild(head);
      card.appendChild(detail);
      list.appendChild(card);
    });

    const total = state.goals.length;
    const overall = total ? Math.round(totalPct/total) : 0;
    const lockedCount = state.goals.filter(g=>goalProgress(g)<100 && isGoalLocked(g)).length;
    const workingCount = state.goals.filter(g=>g.workingOn && goalProgress(g)<100 && !isGoalLocked(g)).length;
    // "Unfinished" excludes locked goals — they aren't actionable until their net worth requirement is met —
    // and "working on" goals, which are counted under Working instead (the three sets are disjoint)
    const counts = { all: total, completed: completedCount, locked: lockedCount, working: workingCount,
                     unfinished: total - completedCount - lockedCount - workingCount };
    el('overallPct').textContent = overall+'%';
    el('manaFill').style.width = overall+'%';
    el('statTotal').textContent = counts.all;
    el('statDone').textContent = counts.completed;
    el('statOpen').textContent = counts.unfinished;
    el('statLocked').textContent = counts.locked;
    el('statWorking').textContent = counts.working;
    renderGoalListChrome(counts); // the sheet's own filter row carries the same five numbers
    el('pfGoalsCompleted').textContent = completedCount;
    {
      const nwCcy = state.profile.netWorthCurrency || 'USD';
      const nwNow = getNetWorthNum();
      const nwConverted = convertAmt(nwNow, 'USD', nwCcy);
      el('pfNetWorthCalc').textContent = ccySymbol(nwCcy)+Math.round(nwConverted).toLocaleString();
      const trendEl = el('pfNetWorthTrend');
      if(trendEl){
        const hist = state.finance.netWorthHistory || [];
        // With a window set (Settings -> Trend Comparison), the newest snapshot on or before it.
        // Without one, the newest from any *earlier* day — save() rewrites today's point in place
        // (snapshotNetWorth()), so the last entry is usually today's own value.
        const cutoff = trendCutoffKey();
        const limit = cutoff || localDateStr(new Date());
        let prev = null;
        for(let i=hist.length-1; i>=0; i--){
          if(cutoff ? hist[i].date <= limit : hist[i].date < limit){ prev = hist[i]; break; }
        }
        // a window reaching further back than the history still compares against something
        if(!prev && cutoff && hist.length) prev = hist[0];
        // converted separately, then subtracted: nwNow is live so it takes today's rate, while the
        // stored point takes its own (convertHistValue) — subtracting first would put both on one
        // rate and reintroduce the step a rate fetch used to produce here
        const deltaDisp = prev ? convertAmt(nwNow, 'USD', nwCcy) - convertHistValue(prev, nwCcy) : 0;
        trendEl.innerHTML = (prev && Math.abs(deltaDisp) >= 1)
          ? trendMarker(deltaDisp > 0 ? 1 : -1, deltaDisp > 0,
              (deltaDisp > 0 ? 'Up ' : 'Down ') + ccySymbol(nwCcy) + Math.abs(Math.round(deltaDisp)).toLocaleString()
              + ' since ' + fmtDate(parseLocalDateStr(prev.date)))
          : '';
      }
    }
    updateExpUI();
    updateAvatar();

    // the detail sheet shows the same goal as the list, so any rerender has to reach it too
    if(openGoalModalId) renderGoalModal();
  }

  // The board's counters are the way into the list. They used to toggle a filter over a list
  // already on the page; now each one opens the sheet at its own filter, which is why they no
  // longer carry a pressed state — the active filter is shown inside the sheet, on its pill row.
  document.querySelectorAll('#view-goals .stat').forEach(s=>{
    s.addEventListener('click', ()=> openGoalList(s.dataset.filter));
  });
  el('starredFirstBtn').addEventListener('click', ()=>{
    starredFirst = !starredFirst;
    el('starredFirstBtn').classList.toggle('btn-primary', starredFirst);
    el('starredFirstBtn').classList.toggle('btn-ghost', !starredFirst);
    renderGoals();
  });
  /* ---------- export the visible goal titles as a .txt ----------
     Titles only, one per line, in the order the list is currently showing them — plain enough to
     paste anywhere. It reads visibleGoals(), so the filter and sort you can see are the ones you
     get; the filter name goes in the file name so two exports can't be confused for each other.
     CRLF because this most often lands in Notepad, which is the one reader that still ignores a
     bare newline. Nothing is written to state, so no save() here. */
  function exportGoalTitles(){
    const titles = visibleGoals().map(g => (g.title || '').trim()).filter(Boolean);
    if(!titles.length) return;
    const name = 'goals-' + goalFilter + '-' + localDateStr(new Date()) + '.txt';
    // BOM so Notepad reads the file as UTF-8 rather than the system codepage — goal titles carry
    // emoji and accents often enough that it would otherwise mangle them.
    const blob = new Blob(['\ufeff' + titles.join('\r\n') + '\r\n'], { type:'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // the click is synchronous but the fetch of the blob isn't, so give it a tick before revoking
    setTimeout(()=> URL.revokeObjectURL(url), 1000);
  }
  el('exportGoalsBtn').addEventListener('click', exportGoalTitles);

  el('goalSortSelect').addEventListener('change', e=>{ sortMode = e.target.value; renderGoals(); });
  el('goalSortDirBtn').addEventListener('click', ()=>{
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    el('goalSortDirBtn').textContent = sortDir === 'asc' ? '↑' : '↓';
    renderGoals();
  });

  function addGoal(){
    const input = el('newGoalInput');
    const v = input.value.trim();
    if(!v) return;
    const newGoal = { id:uid(), title:v, starred:false, workingOn:false, workingOnAt:null, manualDone:false, subtasks:[], open:true, createdAt:Date.now(), updatedAt:Date.now(), completedAt:null, targetDate:'', financeTarget:null, financeSaved:0, checkin:null, color:'', imageUrl:'', tier:'', requiredNetWorth:null };
    state.goals.unshift(newGoal);
    openGoalExclusive(newGoal);
    // a brand-new goal is unfinished, unstarted and unlocked, so it's invisible under three of the
    // five filters — adding one from there would look like nothing happened
    if(goalFilter !== 'all' && goalFilter !== 'unfinished') goalFilter = 'all';
    input.value=''; save(); renderGoals(); input.focus();
    el('goalListBody').scrollTop = 0;  // the new goal goes on top; show it
  }
  el('addGoalBtn').addEventListener('click', addGoal);
  el('newGoalInput').addEventListener('keydown', e=>{ if(e.key==='Enter') addGoal(); });

