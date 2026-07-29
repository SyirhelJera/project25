  /* ================= INSIGHTS ================= */
  function computedVarHex(varName){
    const v = getComputedStyle(document.body).getPropertyValue(varName).trim();
    return v || '#000000';
  }
  // color inputs need a concrete hex to display even when uncustomized — shows the current
  // theme's actual color in that case, without writing anything to state.mosaicColors
  function renderMosaicColorInputs(){
    if(!state.mosaicColors) state.mosaicColors = { filled:'', today:'', empty:'' };
    const mc = state.mosaicColors;
    el('mcFilledInput').value = mc.filled || computedVarHex('--violet');
    el('mcTodayInput').value = mc.today || computedVarHex('--gold');
    el('mcEmptyInput').value = mc.empty || computedVarHex('--border');
  }

  function renderSettings(){
    applyTheme();
    const sel = el('settingsNetWorthCurrency');
    if(!sel.options.length){
      sel.innerHTML = CURRENCIES.map(c=>'<option value="'+c+'">'+c+' ('+ccySymbol(c)+')</option>').join('');
      sel.addEventListener('change', ()=>{
        state.profile.netWorthCurrency = sel.value;
        save(); renderGoals();
      });
    }
    sel.value = state.profile.netWorthCurrency || 'USD';

    const avatarVisToggle = el('avatarVisToggle');
    if(avatarVisToggle && !avatarVisToggle.dataset.wired){
      avatarVisToggle.dataset.wired = '1';
      avatarVisToggle.addEventListener('click', e=>{
        const btn = e.target.closest('[data-vis]');
        if(!btn) return;
        state.profile.hideAvatar = btn.dataset.vis === 'hide';
        save(); renderSettings(); updateAvatar();
      });
    }
    document.querySelectorAll('#avatarVisToggle [data-vis]').forEach(b=>{
      b.classList.toggle('active', (b.dataset.vis === 'hide') === !!state.profile.hideAvatar);
    });

    renderMosaicColorInputs();
    const mcFields = el('mosaicColorFields');
    if(mcFields && !mcFields.dataset.wired){
      mcFields.dataset.wired = '1';
      el('mcFilledInput').addEventListener('input', ()=>{ state.mosaicColors.filled = el('mcFilledInput').value; applyMosaicColors(); debouncedSave(); });
      el('mcTodayInput').addEventListener('input', ()=>{ state.mosaicColors.today = el('mcTodayInput').value; applyMosaicColors(); debouncedSave(); });
      el('mcEmptyInput').addEventListener('input', ()=>{ state.mosaicColors.empty = el('mcEmptyInput').value; applyMosaicColors(); debouncedSave(); });
      el('mosaicColorResetBtn').addEventListener('click', ()=>{
        state.mosaicColors = { filled:'', today:'', empty:'' };
        applyMosaicColors(); save(); renderMosaicColorInputs();
      });
    }
  }

