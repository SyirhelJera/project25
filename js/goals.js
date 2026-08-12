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
  function timeSpentStr(g){
    const start = g.createdAt;
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
      // locked goals are excluded from the Unfinished list — they aren't actionable yet
      const unfinished = arr.filter(g=>goalProgress(g)<100 && !isGoalLocked(g));
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
  function updateExpUI(){
    const exp = totalExp();
    const { level, into, need } = levelInfo(exp);
    el('pfLevel').textContent = 'Lv. ' + level;
    el('pfExpNum').textContent = into + ' / ' + need + ' XP';
    el('pfExpFill').style.width = Math.round((into/need)*100) + '%';
  }

  function pickFocusTask(force){
    const today = localDateStr(new Date());
    if(!force && state.focus && state.focus.date === today) return;
    const openGoals = state.goals.filter(g=>goalProgress(g)<100 && !isGoalLocked(g));
    const starredOpen = openGoals.filter(g=>g.starred);
    // prefer starred goals; if none are starred, fall back to the whole open-goal pool
    const pool = starredOpen.length ? starredOpen : openGoals;

    let pick = null;
    if(pool.length){
      let candidates = [];
      pool.forEach(g=>{
        g.subtasks.forEach(s=>{
          if(s.done) return;
          if(s.requiresId){
            const req = g.subtasks.find(x=>x.id===s.requiresId);
            if(req && !req.done) return; // prerequisite not met yet — don't recommend this one
          }
          candidates.push({label:s.title, goalTitle:g.title, hasPrereq: !!s.requiresId});
        });
      });
      if(candidates.length){
        // subtasks with no prerequisite at all are always favored over ones that merely have
        // their prerequisite already satisfied
        const noPrereq = candidates.filter(c=>!c.hasPrereq);
        const pickPool = noPrereq.length ? noPrereq : candidates;
        pick = pickPool[Math.floor(Math.random()*pickPool.length)];
      } else {
        const g = pool[Math.floor(Math.random()*pool.length)];
        pick = { label:'No subtask available', goalTitle: g.title };
      }
    }
    state.focus = { date: today, pick };
    save();
  }

  function renderFocus(){
    const f = state.focus && state.focus.pick;
    el('focusText').innerHTML = f
      ? '<b>Today\u2019s focus:</b> ' + escapeHtml(f.label) + (f.goalTitle ? ' <span style="color:var(--muted);">(' + escapeHtml(f.goalTitle) + ')</span>' : '')
      : '<b>Today\u2019s focus:</b> add a goal to get a suggestion';
  }
  el('focusReroll').addEventListener('click', ()=>{ pickFocusTask(true); renderFocus(); });

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
  function mosaicDotsHtml({ total, filled, todayIdx, pcts, perfects }){
    // user-editable in Settings → Countdown Mosaic Colors → "Highlight off" disables this entirely
    const mc = state.mosaicColors || {};
    const highlightOn = mc.perfectGlow !== false;
    const style = mc.perfectStyle || 'color';
    const emoji = mc.perfectEmoji || '⭐';
    let dots = '';
    for(let i=0;i<total;i++){
      let cls = 'cd-mosaic-dot';
      const isToday = i===todayIdx, isPast = i<filled;
      let attrs = '';
      if(isToday) cls += ' today';
      if(isToday || isPast){
        // liquid bottom-to-top fill instead of a flat intensity color, driven by a CSS custom
        // property so one gradient rule (see .cd-mosaic-dot.has-fill in styles.css) handles every %
        cls += ' has-fill';
        attrs += ' style="--fill-pct:'+(pcts[i]||0)+'%"';
      }
      if(highlightOn && perfects && perfects[i] && (isToday || isPast)){
        cls += ' perfect perfect-'+style;
        attrs += ' title="Perfect day!"' + (style === 'emoji' ? ' data-emoji="'+escapeHtml(emoji)+'"' : '');
      }
      dots += '<div class="'+cls+'"'+attrs+'></div>';
    }
    return dots;
  }

  // The key is built from the same dots it explains, so it can never drift from them — including
  // when the user recolors the mosaic in Settings.
  function mosaicLegendHtml(){
    const dot = p => '<div class="cd-mosaic-dot has-fill" style="--fill-pct:'+p+'%"></div>';
    return '<span>Less</span>' + dot(6) + dot(35) + dot(70) + dot(100) + '<span>More</span>';
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

  /* ---------- goal modal — tapping a "Working on" carousel card opens the whole goal here.
     The body is buildGoalDetailInner(), i.e. exactly what the goal list shows when a goal is
     expanded, so every edit behaves the same in both places. Closed by the backdrop, the ✕, or
     Escape (same pattern as the wishlist detail modal). ---------- */
  let openGoalModalId = null;
  let goalModalReturnFocus = null;
  // must outlast the exit transition — the overlay stays displayed until it finishes
  const GOAL_MODAL_ANIM_MS = 260;
  let goalModalCloseTimer = null;

  /* Scroll priority: while the sheet is open the page behind it is frozen, so every swipe belongs
     to the card. Without this, a touch that lands on the backdrop — or one that runs past the end
     of the card's own scroll — moves the goals tab underneath instead, which reads as the sheet
     ignoring you. Paired with overscroll-behavior:contain on the card, which stops a scroll that
     reaches the card's end from chaining outward. */
  let pageScrollLockY = 0;
  function lockPageScroll(){
    if(document.body.classList.contains('goal-modal-open')) return;
    pageScrollLockY = window.scrollY || document.documentElement.scrollTop || 0;
    // the offset is what keeps the frozen page looking untouched: body goes fixed, and pulling it
    // up by the current scroll position leaves the same content under the backdrop
    document.body.style.top = (-pageScrollLockY) + 'px';
    document.body.classList.add('goal-modal-open');
  }
  function unlockPageScroll(){
    if(!document.body.classList.contains('goal-modal-open')) return;
    document.body.classList.remove('goal-modal-open');
    document.body.style.top = '';
    window.scrollTo(0, pageScrollLockY);
  }

  function openGoalModal(g){
    const overlay = el('goalModalOverlay');
    const card = el('goalModalBody');
    clearTimeout(goalModalCloseTimer); // reopening mid-close must not get torn down by the old timer
    openGoalModalId = g.id;
    wcModalOpen = true; // the strip keeps auto-scrolling behind the backdrop otherwise
    goalModalReturnFocus = document.activeElement;
    // before the render, which preserves whatever scroll position it finds: reopening within the
    // exit animation skips the timer that would otherwise have reset it
    card.scrollTop = 0;
    renderGoalModal();
    card.style.transform = '';
    overlay.style.opacity = '';
    overlay.classList.remove('is-dragging');
    lockPageScroll();
    overlay.style.display = 'flex';
    // Two frames: the first commits display:flex with the card still in its pre-open state, the
    // second flips the class. In one frame the browser coalesces both and the transition is
    // skipped entirely, so the sheet would just appear.
    requestAnimationFrame(()=> requestAnimationFrame(()=> overlay.classList.add('is-open')));
    // only on open — renderGoalModal() also runs on every later rerender, and moving focus there
    // would yank it out of whatever field the user is typing in. preventScroll because the card is
    // still off-screen at this point on a phone.
    const closeBtn = card.querySelector('.goal-modal-close');
    if(closeBtn) closeBtn.focus({preventScroll:true});
  }
  function closeGoalModal(){
    const overlay = el('goalModalOverlay');
    const card = el('goalModalBody');
    if(overlay.style.display !== 'flex') return;
    // cleared first: renderGoals() can fire during the exit, and it must not rebuild a modal that
    // is on its way out
    openGoalModalId = null;
    wcModalOpen = false;
    overlay.classList.remove('is-open', 'is-dragging');
    // dropping the drag's inline transform lets the class rule take over — the transition runs
    // from wherever the finger left the card down to its closed position
    card.style.transform = '';
    overlay.style.opacity = '';
    // released now, not after the exit animation: the restore is a synchronous scrollTo, so doing
    // it while the backdrop is still up keeps it invisible
    unlockPageScroll();
    // preventScroll: the page is already back exactly where it was, and focusing a carousel card
    // would otherwise scroll it into view and undo that
    if(goalModalReturnFocus && document.contains(goalModalReturnFocus)) goalModalReturnFocus.focus({preventScroll:true});
    goalModalReturnFocus = null;
    clearTimeout(goalModalCloseTimer);
    goalModalCloseTimer = setTimeout(()=>{
      overlay.style.display = 'none';
      card.innerHTML = '';
      card.scrollTop = 0;
    }, wcReducedMotion ? 0 : GOAL_MODAL_ANIM_MS);
  }

  /* Swipe down to dismiss. Only armed when the card is scrolled to its top, so the same downward
     drag scrolls the content everywhere else, and only for non-mouse pointers — a mouse has the
     ✕, Escape and the backdrop, and would otherwise dismiss the dialog on a stray drag.
     `overscroll-behavior:contain` on the card keeps the gesture from rubber-banding the page. */
  const SHEET_DISMISS_PX = 80;
  const SHEET_DISMISS_VEL = 0.35;  // px per ms over the last few moves — a short flick counts
  const SHEET_CANCELLED_PX = 32;   // an interrupted swipe that had clearly committed
  const SHEET_DRAG_SLOP = 5;
  const SHEET_FADE_OVER = 320;     // drag distance across which the backdrop fades out
  (function goalSheetDrag(){
    const card = el('goalModalBody');
    const overlay = el('goalModalOverlay');
    let startY = 0, dy = 0, armed = false, dragging = false, justDragged = false;
    // the last handful of positions, so a flick is measured over the moment it happened rather
    // than averaged across the whole gesture — a fast 60px swipe that begins slowly averages out
    // to nothing, which is one way a real dismissal used to fall under the threshold
    let samples = [];
    function recentVelocity(){
      if(samples.length < 2) return 0;
      const a = samples[0], b = samples[samples.length-1];
      return b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0;
    }

    card.addEventListener('pointerdown', e=>{
      justDragged = false;
      if(e.pointerType === 'mouse') return;
      if(e.target.closest('input, select, textarea')) return; // native controls own their own touches
      if(card.scrollTop > 0) return;
      armed = true; dragging = false;
      startY = e.clientY; dy = 0;
      samples = [{y:e.clientY, t:e.timeStamp}];
    });
    card.addEventListener('pointermove', e=>{
      if(!armed) return;
      const raw = e.clientY - startY;
      samples.push({y:e.clientY, t:e.timeStamp});
      if(samples.length > 5) samples.shift();
      if(!dragging){
        if(raw < -2){ armed = false; return; } // they're reaching upward, i.e. scrolling
        if(raw < SHEET_DRAG_SLOP) return;
        dragging = true;
        overlay.classList.add('is-dragging');
        try{ card.setPointerCapture(e.pointerId); }catch(_){}
      }
      dy = Math.max(0, raw);
      card.style.transform = 'translateY(' + dy + 'px)';
      overlay.style.opacity = String(Math.max(0, 1 - dy / SHEET_FADE_OVER));
    });
    const endDrag = (e, cancelled) => {
      if(!armed) return;
      const wasDragging = dragging;
      armed = false; dragging = false;
      overlay.classList.remove('is-dragging');
      if(!wasDragging) return;
      justDragged = true;
      // A cancelled gesture never gets to finish, so it can't be judged by where it stopped — if
      // it was already well on its way down, honour the swipe rather than snapping back at the
      // user. Dismissing costs nothing: every edit in here has already saved.
      const dismiss = dy > SHEET_DISMISS_PX
        || recentVelocity() > SHEET_DISMISS_VEL
        || (cancelled && dy > SHEET_CANCELLED_PX);
      if(dismiss){ closeGoalModal(); return; }
      // under the threshold: clearing the inline transform springs it back, since removing
      // .is-dragging has already restored the transition
      card.style.transform = '';
      overlay.style.opacity = '';
    };
    card.addEventListener('pointerup', e=> endDrag(e, false));
    card.addEventListener('pointercancel', e=> endDrag(e, true));
    // a drag that happens to end over a button would otherwise fire it; the flag is cleared on the
    // next pointerdown, so a genuine tap is never swallowed
    card.addEventListener('click', e=>{
      if(!justDragged) return;
      justDragged = false;
      e.stopPropagation();
      e.preventDefault();
    }, true);
  })();
  el('goalModalOverlay').addEventListener('click', e=>{ if(e.target === el('goalModalOverlay')) closeGoalModal(); });
  document.addEventListener('keydown', e=>{ if(e.key === 'Escape' && openGoalModalId) closeGoalModal(); });
  // aria-modal only describes the intent; without this, Tab walks straight out of the dialog and
  // into the page behind it
  el('goalModalOverlay').addEventListener('keydown', e=>{
    if(e.key !== 'Tab') return;
    const focusables = el('goalModalBody').querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
    if(!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length-1];
    if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  });

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
    if(workingBtn) workingBtn.addEventListener('click', ()=>{ g.workingOn = !g.workingOn; touchGoal(g); save(); renderGoals(); });
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
    pickFocusTask(false);
    renderFocus();
    renderMantra();
    renderPinnedCountdown();
    updateGoalReminder();
    renderWorkingCarousel();

    const list = el('goalList');
    const empty = el('emptyState');

    let totalPct = 0, completedCount = 0;
    state.goals.forEach(g => { updateCompletionMeta(g); totalPct += goalProgress(g); if(goalProgress(g)===100) completedCount++; });

    const visible = visibleGoals();
    if(state.goals.length === 0){
      empty.style.display = 'block';
      empty.innerHTML = 'No goals yet. <b>Add your first goal above</b> to get started.';
    } else if(visible.length === 0 && goalFilter === 'working'){
      empty.style.display = 'block';
      empty.innerHTML = 'Nothing marked as <b>working on</b> yet. Open a goal below and tap <b>▶ Work on this</b>, or check <b>All Goals</b>.';
    } else {
      empty.style.display = 'none';
    }
    list.innerHTML = '';

    visible.forEach(g => {
      if(g.financeTarget === undefined) g.financeTarget = null;
      if(g.financeSaved === undefined) g.financeSaved = 0;
      if(g.targetDate === undefined) g.targetDate = '';
      if(g.color === undefined) g.color = '';
      if(g.imageUrl === undefined) g.imageUrl = '';
      if(g.tier === undefined) g.tier = '';
      if(g.requiredNetWorth === undefined) g.requiredNetWorth = null;
      if(g.updatedAt === undefined) g.updatedAt = g.createdAt;
      if(g.workingOn === undefined) g.workingOn = false;
      g.subtasks.forEach(s=>{ if(s.requiresId === undefined) s.requiresId = null; });
      const pct = goalProgress(g);
      const locked = isGoalLocked(g);

      const card = document.createElement('div');
      card.className = 'goal' + (pct===100 ? ' done' : '') + (g.open ? ' open' : '') + (locked ? ' locked' : '') + (goalNeedsAttention(g) ? ' needs-attention' : '');
      card.dataset.goalId = g.id;
      if(g.color) card.style.borderLeftColor = g.color;

      // A collapsed card used to carry up to eight chips — tier, working, lock, subtasks, time
      // spent, due, check-in and updated — which is the same as carrying none, because nothing
      // stood out. What's left is state you'd act on; the dates moved into the detail's timeline
      // line, where they're read once rather than scanned past on every card.
      let metaHtml = '';
      const t = tierInfo(g.tier);
      if(t.value) metaHtml += '<span class="tier-chip '+t.cls+'">'+escapeHtml(t.label)+'</span>';
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
        +   '<div class="chevron" aria-hidden="true">▶</div>'
        + '</div>'
        + (metaHtml ? '<div class="goal-meta">' + metaHtml + '</div>' : '')
        + '<div class="goal-foot-row">'
        +   '<div class="mini-track"><div class="mini-fill" style="width:'+pct+'%"></div></div>'
        +   '<span class="progress-pct">'+pct+'%</span>'
        +   '<div class="goal-actions">'
        +     '<button class="rename-btn" type="button" data-act="rename" title="Rename" aria-label="Rename goal">✎</button>'
        +     '<button class="star-btn ' + (g.starred?'active':'') + '" type="button" data-act="star" title="Star" aria-label="Star goal" aria-pressed="'+(g.starred?'true':'false')+'">' + (g.starred?'★':'☆') + '</button>'
        +     (pct<100 && !locked ? '<button class="working-btn ' + (g.workingOn?'active':'') + '" type="button" data-act="working" title="Mark as actively working on this" aria-pressed="'+(g.workingOn?'true':'false')+'">' + (g.workingOn?'▶ Working on':'Work on this') + '</button>' : '')
        +   '</div>'
        + '</div>';
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
        if(act && act.dataset.act === 'working'){ e.stopPropagation(); g.workingOn = !g.workingOn; touchGoal(g); save(); renderGoals(); return; }
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
    el('overallPct').textContent = overall+'%';
    el('manaFill').style.width = overall+'%';
    el('statTotal').textContent = total;
    el('statDone').textContent = completedCount;
    // "Unfinished" excludes locked goals — they aren't actionable until their net worth requirement is met
    el('statOpen').textContent = total-completedCount-lockedCount;
    el('statLocked').textContent = lockedCount;
    el('statWorking').textContent = workingCount;
    el('pfGoalsCompleted').textContent = completedCount;
    {
      const nwCcy = state.profile.netWorthCurrency || 'USD';
      const nwNow = getNetWorthNum();
      const nwConverted = convertAmt(nwNow, 'USD', nwCcy);
      el('pfNetWorthCalc').textContent = ccySymbol(nwCcy)+Math.round(nwConverted).toLocaleString();
      // Compare against the newest netWorthHistory point from an *earlier* day — save() rewrites
      // today's point in place (snapshotNetWorth()), so the last entry is usually today's own value.
      const trendEl = el('pfNetWorthTrend');
      if(trendEl){
        const hist = state.finance.netWorthHistory || [];
        const today = localDateStr(new Date());
        let prev = null;
        for(let i=hist.length-1; i>=0; i--){ if(hist[i].date < today){ prev = hist[i]; break; } }
        const deltaDisp = prev ? convertAmt(nwNow - prev.value, 'USD', nwCcy) : 0;
        trendEl.innerHTML = (prev && Math.abs(deltaDisp) >= 1)
          ? trendMarker(deltaDisp > 0 ? 1 : -1, deltaDisp > 0,
              (deltaDisp > 0 ? 'Up ' : 'Down ') + ccySymbol(nwCcy) + Math.abs(Math.round(deltaDisp)).toLocaleString()
              + ' since ' + fmtDate(parseLocalDateStr(prev.date)))
          : '';
      }
    }
    updateExpUI();
    updateAvatar();

    // "All" now highlights like any other filter — it is one, and leaving it unlit made the row
    // look like nothing was selected
    document.querySelectorAll('#view-goals .stat').forEach(s=>{
      const on = s.dataset.filter === goalFilter;
      s.classList.toggle('active-filter', on);
      s.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    // the modal shows the same goal as the list, so any rerender has to reach it too
    if(openGoalModalId) renderGoalModal();
  }

  document.querySelectorAll('.stat').forEach(s=>{
    s.addEventListener('click', ()=>{
      const f = s.dataset.filter;
      goalFilter = (goalFilter === f && f !== 'all') ? 'all' : f;
      renderGoals();
    });
  });
  el('starredFirstBtn').addEventListener('click', ()=>{
    starredFirst = !starredFirst;
    el('starredFirstBtn').classList.toggle('btn-primary', starredFirst);
    el('starredFirstBtn').classList.toggle('btn-ghost', !starredFirst);
    renderGoals();
  });
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
    const newGoal = { id:uid(), title:v, starred:false, workingOn:false, manualDone:false, subtasks:[], open:true, createdAt:Date.now(), updatedAt:Date.now(), completedAt:null, targetDate:'', financeTarget:null, financeSaved:0, checkin:null, color:'', imageUrl:'', tier:'', requiredNetWorth:null };
    state.goals.unshift(newGoal);
    openGoalExclusive(newGoal);
    input.value=''; save(); renderGoals(); input.focus();
  }
  el('addGoalBtn').addEventListener('click', addGoal);
  el('newGoalInput').addEventListener('keydown', e=>{ if(e.key==='Enter') addGoal(); });

