  /* ================= INSIGHTS ================= */
  function renderSettings(){
    const sel = el('settingsNetWorthCurrency');
    if(!sel.options.length){
      sel.innerHTML = CURRENCIES.map(c=>'<option value="'+c+'">'+c+' ('+ccySymbol(c)+')</option>').join('');
      sel.addEventListener('change', ()=>{
        state.profile.netWorthCurrency = sel.value;
        save(); renderGoals();
      });
    }
    sel.value = state.profile.netWorthCurrency || 'USD';
  }

