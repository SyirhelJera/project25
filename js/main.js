  function renderAll(){
    applyTabOrder();
    applyTabIcons();
    applyTabVisibility();
    renderGoals(); renderHabits(); renderCountdowns(); renderMantras(); renderChecklists();
    renderFinance(); renderFitness(); renderValorant(); renderClock(); renderWishlist(); renderJobs(); renderNotes();
    shuffleMotivationImages(); openToPinnedMotivationCategory(); renderMotivation();
    maybeSyncPinterestCategories(); // no-op unless a Pinterest category hasn't refreshed today yet
  }

  function applyTheme(){
    document.body.setAttribute('data-theme', state.theme || 'light');
    document.querySelectorAll('#themePicker .theme-option').forEach(o=>{
      o.classList.toggle('selected', o.dataset.theme === (state.theme || 'light'));
    });
    applyMosaicColors();
    applyProtectedDayColor();
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

  // same idea for the protected-day marker color (Settings → Protected Days), but it's a single
  // app-wide property rather than a mosaic-only one: the habit week/month calendars and the goals
  // heat-map dots both read var(--protected-day, var(--violet)), so leaving it unset tracks the theme.
  function applyProtectedDayColor(){
    if(state.protectedDayColor) document.body.style.setProperty('--protected-day', state.protectedDayColor);
    else document.body.style.removeProperty('--protected-day');
  }
  el('themePicker').addEventListener('click', (e)=>{
    const opt = e.target.closest('.theme-option');
    if(!opt) return;
    state.theme = opt.dataset.theme;
    applyTheme();
    save();
  });

  load();
