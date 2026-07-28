  /* ================= INSIGHTS ================= */
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
  }

