  /* ---------- nav ----------
     A tab switch is split in two, and the split is the whole reason switching feels immediate.

     Synchronous, in the clicked frame: the .active swap, and every TEARDOWN. A Live Match poll or
     a voice reading a mantra from the tab you just left has to stop now — deferring a teardown by
     a frame would let it run against a tab that is already gone.

     Deferred to after the browser has painted that swap: everything that FILLS the tab you are
     entering. Each render*() below rebuilds a section's innerHTML from state, and .view{display:none}
     means revealing one also costs a full layout of that subtree — with both in front of the first
     paint, the old tab stayed on screen for the sum of the two, which is what read as lag. Nothing
     is torn down on exit, so the frame that paints first shows the pane's existing content, which
     is current: renderAll() drew every tab at load and each tab re-renders itself after its own
     mutations. The only things that visibly land a frame late are the deliberate resets below
     (Goals' filter, the Jobs search), which is a frame nobody can see.

     Two frames rather than one: the first commits the class swap, the second runs after it has
     actually been painted. And navGen guards a fast double-switch — only the newest click's setup
     may run, or a queued setup for a tab you abandoned would render over the one you asked for
     (and, on Games, save() a game choice you never made). */
  let navGen = 0;
  /* Also the hook every deep link into a tab uses (insGoTo(), the calendar bubble, the habit ->
     checklist jump). Those apply a sub-tab AFTER item.click(), because the ladder below resets
     Finance to accounts and Time to clock — and now that the ladder's setup is itself queued here,
     a sub-tab applied synchronously after the click would be overwritten a frame later. Queueing
     it through the same function is what keeps "after the click" true: callbacks fire in the order
     they were queued, so the ladder's setup still runs first. */
  function afterNavPaint(fn){
    requestAnimationFrame(()=> requestAnimationFrame(fn));
  }
  document.querySelectorAll('.nav-item').forEach(t => {
    t.addEventListener('click', () => {
      const tab = t.dataset.tab;
      const wasAlreadyOpen = t.classList.contains('active');
      document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));
      document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      el('view-' + tab).classList.add('active');

      /* ---- teardown: synchronous ---- */
      // stopMantraSpeech() too: a voice still reading a mantra from a tab you've left has nothing
      // on screen to explain where it's coming from.
      if(tab!=='motivation'){ stopMotivationSlideshow(); stopMantraSpeech(); closeMotVideoPlayer(); }
      // same idea for the Live Match poll loop: a timer hitting Riot every few seconds from a tab
      // you've navigated away from has nothing on screen to justify the traffic.
      if(tab!=='games'){ stopValLivePolling(); stopTftLobbyPolling(); }

      /* ---- setup: once the swap is on screen ---- */
      const gen = ++navGen;
      afterNavPaint(()=>{ if(gen === navGen) enterTab(tab, wasAlreadyOpen); });
    });
  });

  function enterTab(tab, wasAlreadyOpen){
      if(tab==='goals'){ goalFilter = 'working'; renderGoals(); }
      // Settings always opens on Appearance. Its five categories are five views of one concern
      // (like Finance and Board below, unlike the Games tab's persisted game choice), so there's
      // nothing to remember and no new state key to default.
      if(tab==='settings'){ showSettingsSubTab('appearance'); renderSettings(); renderValLocalPanel(); renderProtectedDays(); }
      // Time holds both Clock and Countdowns — always land on Clock; showTimeSubTab() renders
      // whichever pane it reveals, and flipping the toggle renders the other one then
      if(tab==='time') showTimeSubTab('clock');
      if(tab==='habits') renderHabits();
      if(tab==='mantras') renderMantras();
      // maybeSyncPinterestCategories() here (not just at load) catches an app left open past
      // midnight — it's date-gated, so on any other open it does nothing.
      // showMotivationSubTab('slideshow') BEFORE renderMotivation(), the same order showGameSubTab()
      // uses for showTftSubTab('rank') — the pane reset is also what stops the Videos pane counting
      // as visible from the last visit, and it renders whichever pane it reveals.
      if(tab==='motivation'){ if(!wasAlreadyOpen) openToPinnedMotivationCategory(); showMotivationSubTab('slideshow'); renderMotivation(); maybeSyncPinterestCategories(); }
      if(tab==='checklists') renderChecklists();
      if(tab==='notes') renderNotes();
      // Board always opens on Ask. Unlike the Games tab's persisted choice, its three panes are
      // three views of one job — composing a consult — so the roster and history are places you
      // visit and come back from, not a mode you'd want the tab to remember.
      if(tab==='board') showBoardSubTab('ask');
      // showFinanceSubTab() BEFORE the renders, and the two renders rather than renderFinance():
      // that helper draws all six panes, five of which the sub-tab reset has just hidden, and each
      // of those panes already re-renders itself when its own sub-tab is revealed. Only the
      // accounts pane and the chart above it are actually on screen on entry.
      if(tab==='finance'){ showFinanceSubTab('accounts'); renderNetWorthChart(); renderFinanceAccounts(); }
      // Fitness always lands on Weight — the trend is what the tab is for, and the pane choice is
      // deliberately not persisted. showFitnessSubTab() also redraws that pane's chart now that it
      // has a real width to measure.
      if(tab==='fitness'){ renderFitness(); showFitnessSubTab('weight'); }
      // Games holds both Valorant and TFT. Unlike Time above it does NOT reset to the first pane —
      // showGameSubTab() reads the persisted choice and renders whichever game it reveals.
      if(tab==='games') showGameSubTab(state.games.active);
      // Jobs always opens on Prospect with a clean search — that's the pile that only moves if you
      // act on it (and what the nav badge counts). Mirrors Goals resetting to 'working' above.
      if(tab==='jobs'){ resetJobsView(); renderJobs(); }
      // force=true: renderInsights() no-ops unless the view is active, since renderAll() calls it
      // too and recomputing every tracker's aggregates after each unrelated save would be waste.
      if(tab==='insights') renderInsights(true);
  }

  /* ---------- mobile: sticky header shrink-on-scroll ---------- */
  (function(){
    const mq = window.matchMedia('(max-width:760px)');
    const sidebar = document.querySelector('.sidebar');
    if(!sidebar) return;
    function onScroll(){
      if(!mq.matches){ sidebar.classList.remove('scrolled'); return; }
      const y = window.scrollY;
      if(y > 32) sidebar.classList.add('scrolled');
      else if(y < 12) sidebar.classList.remove('scrolled');
    }
    window.addEventListener('scroll', onScroll, {passive:true});
    mq.addEventListener('change', onScroll);

    /* The goal sheets are position:fixed;inset:0 — they start above this bar, at the physical top
       of the screen. Publishing the bar's real height lets styles.css reserve exactly that much and
       no more, so a tall sheet stops short of the nav instead of covering it. It has to be measured
       rather than assumed: it shrinks on scroll (.scrolled), and its top padding grows by
       env(safe-area-inset-top) once installed as a PWA, which is the whole reason a hardcoded 6vh
       gap worked in a browser tab and failed in the installed app. */
    function measureNav(){
      document.documentElement.style.setProperty('--nav-h', (mq.matches ? sidebar.offsetHeight : 0) + 'px');
    }
    // ResizeObserver rather than a resize/transitionend pair: it also catches the shrink-on-scroll
    // padding transition frame by frame, so the reserved gap never lags the bar it's reserving for.
    if(window.ResizeObserver) new ResizeObserver(measureNav).observe(sidebar);
    else window.addEventListener('resize', measureNav);
    mq.addEventListener('change', measureNav);
    measureNav();
  })();

  /* The mobile tab switcher — a bottom-right FAB you held and slid from to pick a tab — used to
     live here, and its markup and CSS went with it. It was a second way to do what the navbar
     already does, and it occupied the one screen position that is reachable with a thumb from
     every tab. That position is now js/quickactions.js's, which puts things there that can be
     done from nowhere else. Tabs are changed from the navbar only. */

  /* Swiping the view left/right to walk to the next tab used to live here. It's gone: tabs are
     changed from the navbar or the hold-and-drag switcher (above) only. Several places in the app
     had to opt out of it one by one — the carousels, the slideshow, the horizontally scrolling
     sub-navs, the net-worth chart's scrub — because a horizontal drag aimed at any of those also
     read as "leave this tab". Anything horizontal added from here on no longer has to think about
     it. The .view.swipe-in-* entry animations went with it. */

