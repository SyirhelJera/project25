  function renderAll(){
    applyTabOrder();
    renderGoals(); renderHabits(); renderCountdowns(); renderMantras(); renderChecklists();
    renderFinance(); renderFitness(); renderValorant(); renderClock(); renderWishlist(); renderJobs();
    openToPinnedMotivationCategory(); renderMotivation();
  }

  function applyTheme(){
    document.body.setAttribute('data-theme', state.theme || 'light');
    document.querySelectorAll('#themePicker .theme-option').forEach(o=>{
      o.classList.toggle('selected', o.dataset.theme === (state.theme || 'light'));
    });
    applyMosaicColors();
  }

  // pushes the user's custom mosaic dot colors (if any) into CSS custom properties on <body>;
  // .cd-mosaic-dot's CSS falls back to the theme's default color (var(--violet) etc.) whenever
  // the matching property here is unset, so leaving a color uncustomized just tracks the theme
  const MOSAIC_COLOR_VARS = { filled:'--cd-dot-filled', today:'--cd-dot-today', empty:'--cd-dot-empty', perfect:'--cd-dot-perfect' };
  function applyMosaicColors(){
    const mc = state.mosaicColors || {};
    Object.keys(MOSAIC_COLOR_VARS).forEach(k=>{
      const cssVar = MOSAIC_COLOR_VARS[k];
      if(mc[k]) document.body.style.setProperty(cssVar, mc[k]);
      else document.body.style.removeProperty(cssVar);
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
