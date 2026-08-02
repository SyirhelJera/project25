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

  // moves each .nav-item into state.tabOrder's order (tabs missing from a stale saved order —
  // e.g. added after the order was last saved — fall in at the end, keeping their relative order)
  function applyTabOrder(){
    const nav = el('navList'); if(!nav) return;
    const order = state.tabOrder;
    if(!order || !order.length) return;
    const items = Array.from(nav.querySelectorAll('.nav-item'));
    const byKey = {}; items.forEach(it=>{ byKey[it.dataset.tab] = it; });
    order.forEach(key=>{ if(byKey[key]) nav.appendChild(byKey[key]); });
    items.forEach(it=>{ if(!order.includes(it.dataset.tab)) nav.appendChild(it); });
  }

  // commits a new tab key order — used by both the drag-drop handler (desktop) and the up/down
  // move buttons (mobile, where .drag-handle is hidden since HTML5 drag events don't fire on touch)
  function commitTabOrder(order){
    state.tabOrder = order;
    save();
    applyTabOrder();
    renderTabOrderSettings();
  }

  /* drag-to-reorder navbar tabs (Settings page) — same delegated dragstart/dragover/drop/dragend
     pattern as finance accounts / checklists, but reorders the live sidebar nav too, not just a
     data array, since the sidebar's DOM order *is* the source of truth for tab order. Also offers
     ▲▼ move buttons alongside the handle, since drag-and-drop doesn't work on touch (see the
     .drag-handle{display:none} mobile override) and this is the one reorder list in the app that
     needs a touch-friendly fallback. */
  let draggedTabKey = null;
  function renderTabOrderSettings(){
    const list = el('tabOrderList'); if(!list) return;
    const navItems = Array.from(document.querySelectorAll('#navList .nav-item'));
    list.innerHTML = navItems.map((item, idx)=>{
      const key = item.dataset.tab;
      const label = item.querySelector('.nav-label').textContent;
      const iconHtml = item.querySelector('svg').outerHTML;
      return '<div class="tab-order-row" data-tab-key="'+key+'">'
        + '<span class="drag-handle" draggable="true" title="Drag to reorder">⠿</span>'
        + '<span class="tab-order-icon">'+iconHtml+'</span>'
        + '<span class="tab-order-label">'+escapeHtml(label)+'</span>'
        + '<div class="tab-order-move-btns">'
        +   '<button class="tab-order-move-btn" type="button" data-dir="up" title="Move up"'+(idx===0?' disabled':'')+'>▲</button>'
        +   '<button class="tab-order-move-btn" type="button" data-dir="down" title="Move down"'+(idx===navItems.length-1?' disabled':'')+'>▼</button>'
        + '</div>'
        + '</div>';
    }).join('');
    if(!list.dataset.wired){
      list.dataset.wired = '1';
      list.addEventListener('click', e=>{
        const btn = e.target.closest('.tab-order-move-btn');
        if(!btn || btn.disabled) return;
        const row = btn.closest('.tab-order-row');
        const order = Array.from(list.querySelectorAll('.tab-order-row')).map(r=>r.dataset.tabKey);
        const idx = order.indexOf(row.dataset.tabKey);
        const swapIdx = btn.dataset.dir === 'up' ? idx-1 : idx+1;
        if(swapIdx<0 || swapIdx>=order.length) return;
        [order[idx], order[swapIdx]] = [order[swapIdx], order[idx]];
        commitTabOrder(order);
      });
      list.addEventListener('dragstart', e=>{
        const handle = e.target.closest('.drag-handle');
        if(!handle) return;
        const row = handle.closest('.tab-order-row');
        draggedTabKey = row ? row.dataset.tabKey : null;
        e.dataTransfer.effectAllowed = 'move';
      });
      list.addEventListener('dragover', e=>{
        if(!draggedTabKey) return;
        e.preventDefault();
        const overRow = e.target.closest('.tab-order-row');
        list.querySelectorAll('.tab-order-row.drag-over').forEach(r=>r.classList.remove('drag-over'));
        if(overRow && overRow.dataset.tabKey !== draggedTabKey) overRow.classList.add('drag-over');
      });
      list.addEventListener('drop', e=>{
        if(!draggedTabKey) return;
        e.preventDefault();
        list.querySelectorAll('.tab-order-row.drag-over').forEach(r=>r.classList.remove('drag-over'));
        const overRow = e.target.closest('.tab-order-row');
        const toKey = overRow ? overRow.dataset.tabKey : null;
        const fromKey = draggedTabKey; draggedTabKey = null;
        if(!toKey || toKey === fromKey) return;
        const order = Array.from(list.querySelectorAll('.tab-order-row')).map(r=>r.dataset.tabKey);
        const fromIdx = order.indexOf(fromKey), toIdx = order.indexOf(toKey);
        if(fromIdx<0 || toIdx<0) return;
        order.splice(toIdx, 0, order.splice(fromIdx,1)[0]);
        commitTabOrder(order);
      });
      list.addEventListener('dragend', ()=>{ draggedTabKey = null; list.querySelectorAll('.tab-order-row.drag-over').forEach(r=>r.classList.remove('drag-over')); });
    }
  }

  function renderSettings(){
    applyTheme();
    renderTabOrderSettings();
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

