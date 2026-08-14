  /* ---------- nav ---------- */
  document.querySelectorAll('.nav-item').forEach(t => {
    t.addEventListener('click', () => {
      const wasAlreadyOpen = t.classList.contains('active');
      document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));
      document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      el('view-' + t.dataset.tab).classList.add('active');
      // stopMantraSpeech() too: a voice still reading a mantra from a tab you've left has nothing
      // on screen to explain where it's coming from.
      if(t.dataset.tab!=='motivation'){ stopMotivationSlideshow(); stopMantraSpeech(); }
      // same idea for the Live Match poll loop: a timer hitting Riot every few seconds from a tab
      // you've navigated away from has nothing on screen to justify the traffic.
      if(t.dataset.tab!=='games') stopValLivePolling();
      if(t.dataset.tab==='goals'){ goalFilter = 'working'; renderGoals(); }
      if(t.dataset.tab==='settings'){ renderSettings(); renderValLocalPanel(); renderProtectedDays(); }
      // Time holds both Clock and Countdowns — always land on Clock; showTimeSubTab() renders
      // whichever pane it reveals, and flipping the toggle renders the other one then
      if(t.dataset.tab==='time') showTimeSubTab('clock');
      if(t.dataset.tab==='habits') renderHabits();
      if(t.dataset.tab==='mantras') renderMantras();
      // maybeSyncPinterestCategories() here (not just at load) catches an app left open past
      // midnight — it's date-gated, so on any other open it does nothing.
      if(t.dataset.tab==='motivation'){ if(!wasAlreadyOpen) openToPinnedMotivationCategory(); renderMotivation(); maybeSyncPinterestCategories(); }
      if(t.dataset.tab==='checklists') renderChecklists();
      if(t.dataset.tab==='notes') renderNotes();
      if(t.dataset.tab==='finance'){ showFinanceSubTab('accounts'); renderFinance(); }
      if(t.dataset.tab==='fitness') renderFitness();
      // Games holds both Valorant and TFT. Unlike Time above it does NOT reset to the first pane —
      // showGameSubTab() reads the persisted choice and renders whichever game it reveals.
      if(t.dataset.tab==='games') showGameSubTab(state.games.active);
      // Jobs always opens on Prospect with a clean search — that's the pile that only moves if you
      // act on it (and what the nav badge counts). Mirrors Goals resetting to 'working' above.
      if(t.dataset.tab==='jobs'){ resetJobsView(); renderJobs(); }
    });
  });

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

  /* ---------- mobile tab switcher: hold the button, slide to a tab, release ----------
     Two gestures on one control, both driven by the same pointer stream:
       · press and hold (HOLD_MS) → the sheet opens under your finger and tracks it; whatever
         tab you're over when you let go is the one that opens. Never leaves the sheet up.
       · quick tap → the same sheet opens and stays ("pinned"), so tabs can be tapped instead.
     Hit-testing goes through elementFromPoint rather than per-item pointer listeners, because
     the finger keeps pointer capture on the button for the whole gesture. */
  (function(){
    const fab = el('tabSwitcherFab'), overlay = el('tabSwitcherOverlay'), sheet = el('tabSwitcherSheet'), hint = el('tabSwitcherHint');
    if(!fab || !overlay || !sheet) return;
    const HOLD_MS = 220;
    let holdTimer = null, open = false, pinned = false, hovered = null, gestureId = null;

    const buzz = ms => { if(navigator.vibrate) try{ navigator.vibrate(ms); }catch(_){} };

    // rebuilt on every open so labels, the active tab and any visible nav badges are current
    // (visibleNavItems() drops tabs switched off in Settings > Navbar Tabs)
    function buildSheet(){
      sheet.innerHTML = '';
      visibleNavItems().forEach(nav=>{
        const btn = document.createElement('div');
        btn.className = 'tab-switcher-item' + (nav.classList.contains('active') ? ' active' : '');
        btn.dataset.tab = nav.dataset.tab;
        const icon = nav.querySelector('svg');
        const label = nav.querySelector('.nav-label');
        // a nav badge is only meaningful while it's actually showing (they're display:none by default)
        const badge = Array.from(nav.querySelectorAll('.nav-badge')).find(b=>b.style.display !== 'none');
        btn.innerHTML = (icon ? icon.outerHTML : '')
          + '<span class="tab-switcher-label">'+escapeHtml(label ? label.textContent : nav.dataset.tab)+'</span>'
          + (badge ? '<span class="tab-switcher-badge">'+escapeHtml(badge.textContent || '!')+'</span>' : '');
        btn.addEventListener('click', ()=>{ selectTab(btn.dataset.tab); closeSwitcher(); });
        sheet.appendChild(btn);
      });
    }
    function selectTab(tab){
      const nav = document.querySelector('.nav-item[data-tab="'+tab+'"]');
      if(nav && !nav.classList.contains('active')) nav.click();
      window.scrollTo({ top:0 });
    }
    function openSwitcher(isPinned){
      buildSheet();
      open = true; pinned = isPinned; hovered = null;
      overlay.style.display = 'flex';
      fab.classList.add('active');
      hint.textContent = isPinned ? 'Tap a tab' : 'Slide onto a tab, then let go';
      buzz(12);
    }
    function closeSwitcher(){
      open = false; pinned = false; hovered = null;
      overlay.style.display = 'none';
      fab.classList.remove('active');
    }
    function highlightAt(x, y){
      const target = document.elementFromPoint(x, y);
      const item = target && target.closest ? target.closest('.tab-switcher-item') : null;
      if(item === hovered) return;
      if(hovered) hovered.classList.remove('hover');
      hovered = item;
      if(hovered){ hovered.classList.add('hover'); buzz(8); }
    }

    fab.addEventListener('pointerdown', e=>{
      e.preventDefault();
      if(open && pinned){ closeSwitcher(); return; } // tapping the button again dismisses a pinned sheet
      gestureId = e.pointerId;
      try{ fab.setPointerCapture(e.pointerId); }catch(_){}
      holdTimer = setTimeout(()=>{ holdTimer = null; openSwitcher(false); }, HOLD_MS);
    });
    fab.addEventListener('pointermove', e=>{
      if(e.pointerId !== gestureId || !open || pinned) return;
      highlightAt(e.clientX, e.clientY);
    });
    fab.addEventListener('pointerup', e=>{
      if(e.pointerId !== gestureId) return;
      gestureId = null;
      try{ fab.releasePointerCapture(e.pointerId); }catch(_){}
      if(holdTimer){ // released before the hold registered → treat as a tap, leave the sheet up
        clearTimeout(holdTimer); holdTimer = null;
        openSwitcher(true);
        return;
      }
      if(!open || pinned) return;
      highlightAt(e.clientX, e.clientY);
      if(hovered) selectTab(hovered.dataset.tab);
      closeSwitcher();
    });
    fab.addEventListener('pointercancel', ()=>{
      if(holdTimer){ clearTimeout(holdTimer); holdTimer = null; }
      gestureId = null;
      if(open && !pinned) closeSwitcher();
    });
    // tapping the backdrop of a pinned sheet dismisses it
    overlay.addEventListener('click', e=>{ if(e.target === overlay) closeSwitcher(); });
  })();

  /* Swiping the view left/right to walk to the next tab used to live here. It's gone: tabs are
     changed from the navbar or the hold-and-drag switcher (above) only. Several places in the app
     had to opt out of it one by one — the carousels, the slideshow, the horizontally scrolling
     sub-navs, the net-worth chart's scrub — because a horizontal drag aimed at any of those also
     read as "leave this tab". Anything horizontal added from here on no longer has to think about
     it. The .view.swipe-in-* entry animations went with it. */

