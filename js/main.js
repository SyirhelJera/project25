  function renderAll(){
    renderGoals(); renderHabits(); renderCountdowns(); renderMantras(); renderChecklists();
    renderFinance(); renderFitness(); renderValorant();
  }

  function applyDarkMode(){
    document.body.classList.toggle('dark-mode', !!state.darkMode);
    el('darkModeToggle').textContent = state.darkMode ? '☀️' : '🌙';
  }
  el('darkModeToggle').addEventListener('click', ()=>{
    state.darkMode = !state.darkMode;
    applyDarkMode();
    save();
  });

  load();
