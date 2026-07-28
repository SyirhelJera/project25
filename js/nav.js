  /* ---------- nav ---------- */
  document.querySelectorAll('.nav-item').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));
      document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      el('view-' + t.dataset.tab).classList.add('active');
      if(t.dataset.tab==='goals'){ goalFilter = 'working'; renderGoals(); }
      if(t.dataset.tab==='settings') renderSettings();
      if(t.dataset.tab==='countdowns') renderCountdowns();
      if(t.dataset.tab==='habits') renderHabits();
      if(t.dataset.tab==='mantras') renderMantras();
      if(t.dataset.tab==='checklists') renderChecklists();
      if(t.dataset.tab==='finance'){ showFinanceSubTab('accounts'); renderFinance(); }
      if(t.dataset.tab==='fitness') renderFitness();
      if(t.dataset.tab==='valorant') renderValorant();
      if(t.dataset.tab==='aboutme') renderAboutMe();
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

  /* ---------- swipe left/right to switch tabs ---------- */
  (function(){
    const main = document.querySelector('.main');
    if(!main) return;
    let startX = 0, startY = 0, tracking = false;
    main.addEventListener('touchstart', e => {
      if(e.touches.length !== 1) return;
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
    }, {passive:true});
  })();

