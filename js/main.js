  function renderAll(){
    renderGoals(); renderHabits(); renderCountdowns(); renderMantras(); renderChecklists();
    renderFinance(); renderFitness(); renderValorant();
  }

  function applyTheme(){
    document.body.setAttribute('data-theme', state.theme || 'light');
    document.querySelectorAll('#themePicker .theme-option').forEach(o=>{
      o.classList.toggle('selected', o.dataset.theme === (state.theme || 'light'));
    });
  }
  el('themePicker').addEventListener('click', (e)=>{
    const opt = e.target.closest('.theme-option');
    if(!opt) return;
    state.theme = opt.dataset.theme;
    applyTheme();
    save();
  });

  load();
