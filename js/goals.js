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

  // expanded mosaic overlay — one real, unbucketed dot per day. Opened by clicking the compact
  // mosaic; closed by clicking the backdrop outside the card (see the click listener below).
  function openMosaicOverlay(c){
    const data = mosaicDots(c, Infinity);
    el('mosaicOverlayTitle').textContent = c.label + ' — ' + data.total + ' days';
    el('mosaicOverlayGrid').innerHTML = mosaicDotsHtml(data);
    el('mosaicOverlay').style.display = 'flex';
  }
  function closeMosaicOverlay(){ el('mosaicOverlay').style.display = 'none'; }
  el('mosaicOverlay').addEventListener('click', e=>{ if(e.target === el('mosaicOverlay')) closeMosaicOverlay(); });

  function renderPinnedCountdown(){
    const slot = el('pinnedCdSlot');
    const c = state.countdowns.find(x=>x.pinned);
    if(!c){ slot.innerHTML = ''; return; }
    const diff = daysLeft(c.date);
    const numHtml = '<div class="pinned-cd-num-wrap">'
      + '<div class="pinned-cd-num '+(diff<0?'past':'')+'">'+(diff<0 ? 'past' : diff)+'</div>'
      + (diff>=0 ? '<div class="pinned-cd-sub">days left</div>' : '')
      + '</div>';
    let bodyHtml = numHtml;
    if(diff>=0){
      const dots = mosaicDotsHtml(mosaicDots(c));
      bodyHtml = '<div class="pinned-cd-row">'+numHtml+'<div class="cd-mosaic">'+dots+'</div></div>';
    }
    slot.innerHTML = '<div class="pinned-cd-card">'
      + '<div class="pinned-cd-name">'+escapeHtml(c.label)+'</div>'
      + bodyHtml
      + '<div class="pinned-cd-date">'+fmtDate(new Date(c.date).getTime())+'</div>'
      + '</div>';
    const mosaicEl = slot.querySelector('.cd-mosaic');
    if(mosaicEl) mosaicEl.addEventListener('click', ()=> openMosaicOverlay(c));
  }

  function renderCheckin(){
    const slot = el('checkinSlot');
    const stale = state.goals.find(g => goalProgress(g) < 100 && !isGoalLocked(g) && (!g.checkin || (Date.now() - g.checkin.at) > 3*24*3600*1000));
    if(!stale){ slot.innerHTML = ''; return; }
    slot.innerHTML = '<div class="checkin-banner"><div class="msg">How is <b>'+escapeHtml(stale.title)+'</b> going?</div><div class="checkin-opts">'
      + '<button class="btn btn-sm btn-ghost" data-status="Great">Great</button>'
      + '<button class="btn btn-sm btn-ghost" data-status="Slow">Slow going</button>'
      + '<button class="btn btn-sm btn-ghost" data-status="Stuck">Stuck</button></div></div>';
    slot.querySelectorAll('[data-status]').forEach(b=>{
      b.addEventListener('click', () => { stale.checkin = { status: b.dataset.status, at: Date.now() }; touchGoal(stale); save(); renderCheckin(); });
    });
  }

  // ids of "Working On" carousel cards currently expanded — UI-only, not persisted
  const workingCarouselExpanded = new Set();

  // Auto-scroll state for the "Working On" carousel — driven via scrollLeft (not CSS transform)
  // so real touch/wheel/drag scrolling shares the same axis and can naturally interrupt it.
  const WC_SPEED_PX_S = 32;
  const WC_RESUME_DELAY_MS = 3000;
  const wcReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let wcTrack = null;
  let wcPaused = false;
  let wcAnyExpanded = false;
  let wcResumeTimer = null;
  let wcProgrammatic = false;
  let wcLastTs = null;
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
    if(!wcTrack) return;
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
    if(wcPaused || wcAnyExpanded || wcReducedMotion){ wcScrollPos = viewport.scrollLeft; return; }
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
    viewport.addEventListener('pointerdown', wcOnUserActivity);
    viewport.addEventListener('wheel', wcOnUserActivity, {passive:true});
    viewport.addEventListener('scroll', () => {
      if(wcProgrammatic){ wcProgrammatic = false; return; }
      wcOnUserActivity();
      wcWrap(viewport);
      wcScrollPos = viewport.scrollLeft;
    });
  })();

  function buildWorkingCard(g){
    const pct = goalProgress(g);
    const expanded = workingCarouselExpanded.has(g.id);

    let metaHtml = '';
    const t = tierInfo(g.tier);
    if(t.value) metaHtml += '<span class="tier-chip '+t.cls+'">'+escapeHtml(t.label)+'</span>';
    if(g.subtasks.length) metaHtml += '<span class="chip">'+escapeHtml(g.subtasks.filter(s=>s.done).length + '/' + g.subtasks.length + ' subtasks')+'</span>';
    if(g.targetDate) metaHtml += '<span class="chip">'+escapeHtml('Due ' + fmtDate(new Date(g.targetDate).getTime()))+'</span>';

    const card = document.createElement('div');
    card.className = 'wc-card' + (expanded ? ' expanded' : '');
    card.dataset.goalId = g.id;
    if(g.color) card.style.borderLeftColor = g.color;
    card.innerHTML = '<div class="wc-card-img-wrap">'+(g.imageUrl ? '<img src="'+g.imageUrl+'">' : '')+'</div>'
      + '<div class="wc-card-body">'
      +   '<div class="wc-card-top">'
      +     '<div class="wc-card-title">'+escapeHtml(g.title)+'</div>'
      +     '<div class="wc-card-pct">'+pct+'%</div>'
      +   '</div>'
      +   '<div class="mini-track"><div class="mini-fill" style="width:'+pct+'%"></div></div>'
      +   '<div class="wc-card-meta">'+metaHtml+'</div>'
      +   '<div class="wc-card-foot"><button class="wc-expand-btn" type="button">'+(expanded?'Hide':'Details')+' <span class="chevron">▶</span></button></div>'
      +   '<div class="wc-expand"><div class="wc-expand-inner">'
      +     '<div class="wc-sub-list"></div>'
      +     (g.subtasks.length ? '' : '<div class="wc-empty-subs">No subtasks yet.</div>')
      +     '<button class="wc-open-link" type="button" data-wc-open>Open full goal ▸</button>'
      +   '</div></div>'
      + '</div>';

    const subListEl = card.querySelector('.wc-sub-list');
    g.subtasks.forEach(s=>{
      const prereq = s.requiresId ? g.subtasks.find(x=>x.id===s.requiresId) : null;
      const blocked = !s.done && prereq && !prereq.done;
      const row = document.createElement('div'); row.className = 'sub-row';
      row.innerHTML = '<div class="sub-check '+(s.done?'checked':'')+'" title="'+(blocked?'Locked until prerequisite is done':'')+'">'+(s.done?'✓':(blocked?'🔒':''))+'</div>'
        + '<div class="sub-title '+(s.done?'done':'')+'">'+escapeHtml(s.title)+'</div>';
      row.querySelector('.sub-check').addEventListener('click', e=>{
        e.stopPropagation();
        if(!s.done && s.requiresId){
          const req = g.subtasks.find(x=>x.id===s.requiresId);
          if(req && !req.done) return; // prerequisite subtask not done yet
        }
        s.done = !s.done; touchGoal(g); save(); renderGoals();
      });
      subListEl.appendChild(row);
    });

    card.addEventListener('click', e=>{
      if(e.target.closest('[data-wc-open]')){
        e.stopPropagation();
        goalFilter = 'working';
        openGoalExclusive(g);
        renderGoals();
        requestAnimationFrame(()=>{
          const target = document.querySelector('#goalList .goal[data-goal-id="'+g.id+'"]');
          if(target) target.scrollIntoView({behavior:'smooth', block:'center'});
        });
        return;
      }
      if(e.target.closest('.sub-check')) return;
      if(workingCarouselExpanded.has(g.id)) workingCarouselExpanded.delete(g.id);
      else workingCarouselExpanded.add(g.id);
      renderWorkingCarousel();
    });

    return card;
  }

  function renderWorkingCarousel(){
    const wrap = el('workingCarouselWrap');
    const viewport = el('workingCarousel');
    if(!wrap || !viewport) return;
    const working = state.goals.filter(g=>g.workingOn && goalProgress(g)<100 && !isGoalLocked(g));
    if(!working.length){ wrap.style.display='none'; viewport.innerHTML=''; wcTrack = null; return; }
    wrap.style.display='block';

    // preserve the current scroll position (as a fraction of one set's width) across re-renders,
    // so routine state updates elsewhere don't yank the carousel back to the start
    const prevSetWidth = wcTrack ? wcTrack.scrollWidth / 2 : 0;
    const prevFraction = prevSetWidth > 0 ? (viewport.scrollLeft % prevSetWidth) / prevSetWidth : 0;

    viewport.innerHTML='';
    const track = document.createElement('div');
    track.className = 'wc-track';
    working.forEach(g => track.appendChild(buildWorkingCard(g)));
    // duplicate the set so scrollLeft can wrap seamlessly once it passes one full set's width
    working.forEach(g => {
      const clone = buildWorkingCard(g);
      clone.classList.add('wc-clone');
      clone.setAttribute('aria-hidden', 'true');
      clone.setAttribute('tabindex', '-1');
      track.appendChild(clone);
    });
    viewport.appendChild(track);

    wcTrack = track;
    wcAnyExpanded = working.some(g => workingCarouselExpanded.has(g.id));
    wcLastTs = null;
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

      let metaHtml = '';
      const t = tierInfo(g.tier);
      if(t.value) metaHtml += '<span class="tier-chip '+t.cls+'">'+escapeHtml(t.label)+'</span>';
      if(g.workingOn && pct<100 && !locked) metaHtml += '<span class="chip working-chip">▶ Working on</span>';
      if(locked) metaHtml += '<span class="lock-badge">🔒 Needs $'+Number(g.requiredNetWorth).toLocaleString()+' net worth</span>';
      if(g.subtasks.length) metaHtml += '<span class="chip subtask-chip">'+escapeHtml(g.subtasks.filter(s=>s.done).length + '/' + g.subtasks.length + ' subtasks')+'</span>';
      metaHtml += '<span class="chip">'+escapeHtml(timeSpentStr(g))+'</span>';
      if(g.targetDate) metaHtml += '<span class="chip">'+escapeHtml('Due ' + fmtDate(new Date(g.targetDate).getTime()))+'</span>';
      if(g.checkin) metaHtml += '<span class="chip">'+escapeHtml('Check-in: ' + g.checkin.status)+'</span>';
      if(g.updatedAt) metaHtml += '<span class="chip">'+escapeHtml('Updated ' + fmtDate(g.updatedAt))+'</span>';

      const head = document.createElement('div');
      head.className = 'goal-head';
      head.innerHTML = '<div class="goal-head-top">'
        +   '<span class="drag-handle" draggable="true" title="Drag to reorder">⠿</span>'
        +   '<div class="goal-check ' + (pct===100?'checked':'') + '" data-act="check" title="'+(locked?'Locked until net worth requirement is met':'')+'">' + (locked ? '🔒' : (pct===100?'✓':'')) + '</div>'
        +   (g.imageUrl ? '<img class="goal-thumb" src="'+g.imageUrl+'">' : '')
        +   '<div class="goal-title-wrap"><div class="goal-title">' + escapeHtml(g.title) + '</div></div>'
        +   '<div class="chevron">▶</div>'
        + '</div>'
        + '<div class="goal-meta">' + metaHtml + '</div>'
        + '<div class="goal-foot-row">'
        +   '<div class="mini-track"><div class="mini-fill" style="width:'+pct+'%"></div></div>'
        +   '<span class="progress-pct">'+pct+'%</span>'
        +   '<div class="goal-actions">'
        +     '<button class="rename-btn" data-act="rename" title="Rename">✎</button>'
        +     '<button class="star-btn ' + (g.starred?'active':'') + '" data-act="star" title="Star">' + (g.starred?'★':'☆') + '</button>'
        +     (pct<100 && !locked ? '<button class="working-btn ' + (g.workingOn?'active':'') + '" data-act="working" title="Mark as actively working on this">' + (g.workingOn?'▶ Working on':'Work on this') + '</button>' : '')
        +   '</div>'
        + '</div>';
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
      const inner = document.createElement('div');
      inner.className = 'goal-detail-inner';

      const subLbl = document.createElement('div'); subLbl.className='section-lbl'; subLbl.textContent='Subtasks'; inner.appendChild(subLbl);
      const subListEl = document.createElement('div'); subListEl.className='sub-list'; inner.appendChild(subListEl);

      // refresh the head UI (progress bar, check state, subtask-count chip) without a full goal-list rerender
      function refreshHeadUI(){
        updateCompletionMeta(g);
        const pct2 = goalProgress(g);
        card.className = 'goal' + (pct2===100 ? ' done' : '') + (g.open ? ' open' : '') + (goalNeedsAttention(g) ? ' needs-attention' : '');
        if(g.color) card.style.borderLeftColor = g.color;
        const checkEl = head.querySelector('[data-act="check"]');
        if(checkEl){ checkEl.className = 'goal-check ' + (pct2===100?'checked':''); checkEl.textContent = pct2===100?'✓':''; }
        const fillEl = head.querySelector('.mini-fill');
        if(fillEl) fillEl.style.width = pct2+'%';
        const pctEl = head.querySelector('.progress-pct');
        if(pctEl) pctEl.textContent = pct2+'%';
        let subChip = head.querySelector('.subtask-chip');
        const chipText = g.subtasks.filter(s=>s.done).length + '/' + g.subtasks.length + ' subtasks';
        if(subChip){ subChip.textContent = chipText; }
        else if(g.subtasks.length){
          subChip = document.createElement('span'); subChip.className='chip subtask-chip'; subChip.textContent = chipText;
          const metaWrap = head.querySelector('.goal-meta'); if(metaWrap) metaWrap.prepend(subChip);
        }
      }

      // build one subtask row; reused for initial render, manual add, and AI suggestions so we never need a full rerender just to append a row
      function buildSubRow(s){
        const row = document.createElement('div'); row.className = 'sub-row'; row.dataset.subId = s.id;
        const idx = g.subtasks.findIndex(x=>x.id===s.id);
        const prereq = s.requiresId ? g.subtasks.find(x=>x.id===s.requiresId) : null;
        const blocked = !s.done && prereq && !prereq.done;
        row.innerHTML = '<div class="sub-move">'
          + '<button class="sub-move-btn" data-dir="up" '+(idx<=0?'disabled':'')+'>▲</button>'
          + '<button class="sub-move-btn" data-dir="down" '+(idx>=g.subtasks.length-1?'disabled':'')+'>▼</button>'
          + '</div>'
          + '<div class="sub-check '+(s.done?'checked':'')+'" title="'+(blocked?'Locked until prerequisite is done':'')+'">'+(s.done?'✓':(blocked?'🔒':''))+'</div>'
          + '<div class="sub-title '+(s.done?'done':'')+'">'+escapeHtml(s.title)+(blocked?' <span class="chip">🔒 needs: '+escapeHtml(prereq.title)+'</span>':'')+'</div>'
          + '<select class="sub-prereq" title="Requires this subtask to be done first">'
            + '<option value="">No prerequisite</option>'
            + g.subtasks.filter(x=>x.id!==s.id).map(x=>'<option value="'+x.id+'" '+(s.requiresId===x.id?'selected':'')+'>Needs: '+escapeHtml(x.title.slice(0,22))+'</option>').join('')
          + '</select>'
          + '<button class="sub-del">✕</button>';
        row.querySelector('.sub-check').addEventListener('click', ()=>{
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

      const dLbl = document.createElement('div'); dLbl.className='section-lbl'; dLbl.textContent='Target Date'; inner.appendChild(dLbl);
      const dRow = document.createElement('div'); dRow.className='inline-fields';
      dRow.innerHTML = '<input type="date" value="'+(g.targetDate||'')+'">';
      dRow.querySelector('input').addEventListener('change', e=>{ g.targetDate = e.target.value; touchGoal(g); save(); renderGoals(); });
      inner.appendChild(dRow);

      if(pct === 100){
        const compLbl = document.createElement('div'); compLbl.className='section-lbl'; compLbl.textContent='Completion Date'; inner.appendChild(compLbl);
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
        inner.appendChild(compRow);
      }

      const fLbl = document.createElement('div'); fLbl.className='section-lbl'; fLbl.textContent='Finance / Budget'; inner.appendChild(fLbl);
      const fRow = document.createElement('div'); fRow.className='inline-fields';
      fRow.innerHTML = '<span>Target $</span><input type="number" min="0" value="'+(g.financeTarget??'')+'" placeholder="e.g. 500"><span>Saved $</span><input type="number" min="0" value="'+(g.financeSaved||0)+'" style="width:90px;">';
      const finInputs = fRow.querySelectorAll('input');
      finInputs[0].addEventListener('change', ()=>{ g.financeTarget = finInputs[0].value===''?null:parseFloat(finInputs[0].value); touchGoal(g); save(); renderGoals(); });
      finInputs[1].addEventListener('change', ()=>{ g.financeSaved = parseFloat(finInputs[1].value)||0; touchGoal(g); save(); renderGoals(); });
      inner.appendChild(fRow);
      if(g.financeTarget){
        const fbar = document.createElement('div'); fbar.className='finance-bar';
        const finPct = Math.min(100, Math.round((g.financeSaved / g.financeTarget)*100));
        fbar.innerHTML = '<div class="finance-fill" style="width:'+finPct+'%"></div>';
        inner.appendChild(fbar);
        const fnote = document.createElement('div'); fnote.style.cssText='font-size:11px;color:var(--muted);margin-top:4px;';
        fnote.textContent = '$'+g.financeSaved+' of $'+g.financeTarget+' saved ('+finPct+'%)';
        inner.appendChild(fnote);
      }

      const tierLbl = document.createElement('div'); tierLbl.className='section-lbl'; tierLbl.textContent='Tier Ranking'; inner.appendChild(tierLbl);
      const tierRow = document.createElement('div'); tierRow.className='inline-fields';
      const tierSel = document.createElement('select'); tierSel.className='tier-select';
      tierSel.innerHTML = TIERS.map(t=>'<option value="'+t.value+'" '+(g.tier===t.value?'selected':'')+'>'+t.label+'</option>').join('');
      tierSel.addEventListener('change', ()=>{ g.tier = tierSel.value; touchGoal(g); save(); renderGoals(); });
      tierRow.appendChild(tierSel);
      inner.appendChild(tierRow);

      const unlockLbl = document.createElement('div'); unlockLbl.className='section-lbl'; unlockLbl.textContent='Unlock Requirement'; inner.appendChild(unlockLbl);
      const unlockRow = document.createElement('div'); unlockRow.className='inline-fields';
      unlockRow.innerHTML = '<span>Required net worth $</span><input type="number" min="0" value="'+(g.requiredNetWorth??'')+'" placeholder="e.g. 10000">';
      const unlockInput = unlockRow.querySelector('input');
      unlockInput.addEventListener('change', ()=>{ g.requiredNetWorth = unlockInput.value===''?null:parseFloat(unlockInput.value); touchGoal(g); save(); renderGoals(); });
      inner.appendChild(unlockRow);
      if(g.requiredNetWorth != null && g.requiredNetWorth !== ''){
        const unote = document.createElement('div');
        const stillLocked = isGoalLocked(g);
        unote.className = 'unlock-note' + (stillLocked ? '' : ' met');
        unote.textContent = stillLocked
          ? 'Locked — current net worth is $'+getNetWorthNum().toLocaleString()+', needs $'+Number(g.requiredNetWorth).toLocaleString()+'.'
          : 'Unlocked — net worth requirement met.';
        inner.appendChild(unote);
      }

      const cLbl = document.createElement('div'); cLbl.className='section-lbl'; cLbl.textContent='Color & Image'; inner.appendChild(cLbl);
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
      inner.appendChild(cRow);

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
      inner.appendChild(imgRow);

      const footer = document.createElement('div'); footer.className='goal-footer';
      footer.innerHTML = '<span class="completed-tag">'+(pct===100 ? '✦ Completed ' + fmtDate(g.completedAt) : '')+'</span><button class="del-goal">Delete goal</button>';
      footer.querySelector('.del-goal').addEventListener('click', ()=>{ state.goals = state.goals.filter(x=>x.id!==g.id); save(); renderGoals(); });
      inner.appendChild(footer);

      detail.appendChild(inner);
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

    document.querySelectorAll('.stat').forEach(s=>s.classList.remove('active-filter'));
    if(goalFilter !== 'all'){
      const match = document.querySelector('.stat[data-filter="'+goalFilter+'"]');
      if(match) match.classList.add('active-filter');
    }

    renderCheckin();
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

