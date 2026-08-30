  function renderAll(){
    applyTabOrder();
    applyTabIcons();
    applyTabVisibility();
    applyTabLooks(); // per-tab name / icon / icon-colour overrides (Settings > Navigation)
    renderGoals(); renderHabits(); renderCountdowns(); renderMantras(); renderChecklists();
    renderFinance(); renderFitness(); renderValorant(); renderTft(); renderClock(); renderWishlist(); renderJobs(); renderNotes(); renderBoard();
    // re-renders whichever game the Games tab is showing — one code path decides which pane is
    // visible, same as nav.js's showTimeSubTab('clock') on the Time tab. Cheap, and it means the
    // pane's visibility can't drift from state.games.active.
    showGameSubTab(state.games.active);
    shuffleMotivationImages(); openToPinnedMotivationCategory(); renderMotivation();
    maybeSyncPinterestCategories(); // no-op unless a Pinterest category hasn't refreshed today yet
    // no-op unless something starts within the lead time; fires once per page load, and its fetch
    // is async so it never delays first paint or hideLoadScreen()
    maybeShowCalendarBubble();
    // logs this visit's device and (asynchronously) its rough location — see js/access.js. Same
    // fires-once-per-page-load slot as the bubble above: its own guard makes the second call a
    // no-op, so a backup restore re-rendering everything can't log the same session twice.
    recordAppAccess();
    renderInsights(); // no-op unless the Insights tab is the one on screen (see its guard)
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
