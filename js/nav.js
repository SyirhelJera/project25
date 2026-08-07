  /* ---------- nav ---------- */
  document.querySelectorAll('.nav-item').forEach(t => {
    t.addEventListener('click', () => {
      const wasAlreadyOpen = t.classList.contains('active');
      document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));
      document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      el('view-' + t.dataset.tab).classList.add('active');
      if(t.dataset.tab!=='motivation') stopMotivationSlideshow();
      if(t.dataset.tab==='goals'){ goalFilter = 'working'; renderGoals(); }
      if(t.dataset.tab==='settings'){ renderSettings(); renderValLocalPanel(); renderProtectedDays(); }
      // Time holds both Clock and Countdowns — always land on Clock; showTimeSubTab() renders
      // whichever pane it reveals, and flipping the toggle renders the other one then
      if(t.dataset.tab==='time') showTimeSubTab('clock');
      if(t.dataset.tab==='habits') renderHabits();
      if(t.dataset.tab==='mantras') renderMantras();
      if(t.dataset.tab==='motivation'){ if(!wasAlreadyOpen) openToPinnedMotivationCategory(); renderMotivation(); }
      if(t.dataset.tab==='checklists') renderChecklists();
      if(t.dataset.tab==='notes') renderNotes();
      if(t.dataset.tab==='finance'){ showFinanceSubTab('accounts'); renderFinance(); }
      if(t.dataset.tab==='fitness') renderFitness();
      if(t.dataset.tab==='valorant') renderValorant();
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
    function buildSheet(){
      sheet.innerHTML = '';
      document.querySelectorAll('.nav-item').forEach(nav=>{
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

  /* ---------- swipe left/right to switch tabs ---------- */
  (function(){
    const main = document.querySelector('.main');
    if(!main) return;
    let startX = 0, startY = 0, tracking = false;
    main.addEventListener('touchstart', e => {
      if(e.touches.length !== 1) return;
      if(e.target.closest('.photo-carousel') || e.target.closest('.working-carousel') || e.target.closest('.motivation-slide-area') || e.target.closest('.motivation-thumbs')) return; // let the carousel/slideshow handle its own horizontal drag
      // the Finance / Time sub-navs and the Checklists subgroup nav scroll horizontally when their
      // buttons don't fit — swiping one sideways is aimed at that strip, not at leaving the tab,
      // so it must not also switch views
      if(e.target.closest('.finance-subnav') || e.target.closest('.checklist-group-nav')) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    }, {passive:true});
    main.addEventListener('touchend', e => {
      if(!tracking) return;
      tracking = false;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if(Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const items = Array.from(document.querySelectorAll('.nav-item'));
      const curIdx = items.findIndex(t => t.classList.contains('active'));
      if(curIdx === -1) return;
      const nextIdx = dx < 0 ? curIdx + 1 : curIdx - 1;
      if(nextIdx < 0 || nextIdx >= items.length) return;
      items[nextIdx].click();
      const newView = document.querySelector('.view.active');
      if(newView){
        const cls = dx < 0 ? 'swipe-in-right' : 'swipe-in-left';
        newView.classList.remove('swipe-in-right','swipe-in-left');
        void newView.offsetWidth;
        newView.classList.add(cls);
        newView.addEventListener('animationend', () => newView.classList.remove(cls), {once:true});
      }
    }, {passive:true});
  })();

