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
      if(t.dataset.tab==='finance'){ showFinanceSubTab('moneygoals'); renderFinance(); }
      if(t.dataset.tab==='fitness') renderFitness();
      if(t.dataset.tab==='valorant') renderValorant();
      if(t.dataset.tab==='aboutme') renderAboutMe();
    });
  });

