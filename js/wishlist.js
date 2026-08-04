  /* ================= WISHLIST ================= */

  // shows amounts in whatever currency Settings → Net Worth Display Currency is set to (same field
  // the profile card's net worth figure uses) rather than a hardcoded currency
  function wishlistCcy(){ return (state.profile && state.profile.netWorthCurrency) || 'USD'; }
  // whole-number formatting (no cents) — matches the profile card's net-worth display convention
  function wishlistFmt(amount){ return ccySymbol(wishlistCcy()) + Math.round(parseFloat(amount)||0).toLocaleString(); }
  function wishlistSaved(w){
    return (w.contributions||[]).reduce((sum,c)=> sum + (parseFloat(c.amount)||0), 0);
  }

  // which card's detail modal is open, if any — not persisted, resets per page load
  let openWishlistId = null;
  // collapse state for the "Funded"/"Bought" sections at the bottom of the grid — not persisted,
  // mirrors the checklist-subgroup collapse pattern in checklists.js. Bought starts collapsed since
  // those items are done and out of the way; Funded starts open since it's still an action item
  // ("go buy it").
  let wishlistSectionCollapsed = { funded: false, bought: true };

  // funded = savings target reached; bought = actually purchased — distinct states. An item can be
  // funded without being bought yet, or bought without ever having been funded through this app
  // (paid for outright). Bought takes priority when both are true.
  function wishlistMetrics(w){
    if(!w.contributions) w.contributions = [];
    if(w.favorite===undefined) w.favorite = false;
    if(w.bought===undefined) w.bought = false;
    const cost = parseFloat(w.cost)||0;
    const saved = wishlistSaved(w);
    const pct = cost>0 ? Math.min(100, Math.round((saved/cost)*100)) : (saved>0 ? 100 : 0);
    const funded = cost>0 && saved>=cost;
    return { cost, saved, pct, funded, bought: !!w.bought };
  }

  function buildWishlistCard(w){
    const { cost, saved, pct, funded, bought } = wishlistMetrics(w);
    const status = bought ? 'bought' : (funded ? 'funded' : '');
    const card = document.createElement('div'); card.className='wishlist-card'+(status?' '+status:'');
    card.innerHTML = '<div class="wishlist-card-img">'
        + (w.imageUrl ? '<img src="'+w.imageUrl+'" alt="">' : '<span class="wishlist-card-placeholder">🎁</span>')
        + '<button class="star-btn wishlist-card-star'+(w.favorite?' active':'')+'" title="Favorite">'+(w.favorite?'★':'☆')+'</button>'
        + (bought ? '<span class="wishlist-bought-badge" title="Bought">🛍</span>' : funded ? '<span class="wishlist-funded-badge" title="Fully funded">✓</span>' : '')
      + '</div>'
      + '<div class="wishlist-card-body">'
      +   '<div class="wishlist-card-name">'+escapeHtml(w.name)+'</div>'
      +   '<div class="wishlist-card-cost">'+wishlistFmt(cost)+'</div>'
      +   '<div class="wishlist-card-progress-row"><div class="mini-track"><div class="mini-fill" style="width:'+pct+'%"></div></div><span class="progress-pct">'+pct+'%</span></div>'
      +   '<div class="wishlist-card-saved">'+wishlistFmt(saved)+' saved'+(bought?' <span class="wishlist-bought-tag">· Bought</span>':funded?' <span class="wishlist-funded-tag">· Funded</span>':'')+'</div>'
      + '</div>';
    card.querySelector('.wishlist-card-star').addEventListener('click', e=>{
      e.stopPropagation();
      w.favorite = !w.favorite;
      save(); renderWishlist();
    });
    card.addEventListener('click', ()=> openWishlistDetail(w.id));
    return card;
  }

  // favorited items float to the top, newest-first within each group
  function wishlistSortCompare(a,b){ return (b.favorite?1:0)-(a.favorite?1:0) || (b.createdAt||0)-(a.createdAt||0); }

  // appends a collapsible "Funded"/"Bought" section (header + grid) to the tab, sharing the same
  // chevron-toggle pattern as checklists.js's subgroups — a no-op if the section is empty
  function appendWishlistSection(list, key, icon, label, itemsArr){
    if(!itemsArr.length) return;
    const collapsed = !!wishlistSectionCollapsed[key];
    const header = document.createElement('div');
    header.className = 'finance-group-lbl wishlist-section-toggle';
    header.style.cursor = 'pointer';
    header.innerHTML = '<span class="wlg-chevron">'+(collapsed?'▶':'▼')+'</span> '+icon+' '+label+' '
      + '<span style="font-weight:600;text-transform:none;letter-spacing:0;color:var(--faint);">('+itemsArr.length+')</span>';
    header.addEventListener('click', ()=>{ wishlistSectionCollapsed[key] = !wishlistSectionCollapsed[key]; renderWishlist(); });
    list.appendChild(header);
    if(!collapsed){
      const grid = document.createElement('div'); grid.className = 'wishlist-grid wishlist-section-grid';
      itemsArr.sort(wishlistSortCompare).forEach(w=> grid.appendChild(buildWishlistCard(w)));
      list.appendChild(grid);
    }
  }

  function renderWishlist(){
    const list = el('wishlistList'); if(!list) return;
    list.innerHTML = '';
    const items = state.wishlist || [];
    el('wishlistEmpty').style.display = items.length===0 ? 'block' : 'none';
    el('newWishlistCost').placeholder = 'Cost ('+wishlistCcy()+')';

    const active = [], funded = [], bought = [];
    items.forEach(w=>{
      const m = wishlistMetrics(w);
      if(m.bought) bought.push(w);
      else if(m.funded) funded.push(w);
      else active.push(w);
    });

    active.sort(wishlistSortCompare).forEach(w=> list.appendChild(buildWishlistCard(w)));
    appendWishlistSection(list, 'funded', '✓', 'Funded', funded);
    appendWishlistSection(list, 'bought', '🛍', 'Bought', bought);

    // keep an already-open detail modal in sync with whatever just changed (currency setting,
    // another device's edit, etc.) instead of only refreshing it from its own event handlers
    if(openWishlistId) renderWishlistDetail();
  }

  function addWishlist(){
    const nameInput = el('newWishlistName'); const costInput = el('newWishlistCost');
    const name = nameInput.value.trim();
    if(!name) return;
    const cost = parseFloat(costInput.value) || 0;
    state.wishlist.push({ id:uid(), name, cost, contributions:[], imageUrl:'', favorite:false, bought:false, createdAt:Date.now() });
    nameInput.value = ''; costInput.value = '';
    save(); renderWishlist();
    nameInput.focus();
  }
  el('addWishlistBtn').addEventListener('click', addWishlist);
  el('newWishlistName').addEventListener('keydown', e=>{ if(e.key==='Enter') addWishlist(); });
  el('newWishlistCost').addEventListener('keydown', e=>{ if(e.key==='Enter') addWishlist(); });

  /* ---------- detail modal — opened by clicking a card; image upload, rename, cost edit, and
     funds history all live here rather than cluttering the compact grid card ---------- */
  function openWishlistDetail(id){
    openWishlistId = id;
    renderWishlistDetail();
    el('wishlistDetailOverlay').style.display = 'flex';
  }
  function closeWishlistDetail(){
    openWishlistId = null;
    el('wishlistDetailOverlay').style.display = 'none';
  }
  el('wishlistDetailOverlay').addEventListener('click', e=>{ if(e.target === el('wishlistDetailOverlay')) closeWishlistDetail(); });

  function renderWishlistDetail(){
    const body = el('wishlistDetailBody');
    const w = (state.wishlist||[]).find(x=>x.id===openWishlistId);
    if(!w){ closeWishlistDetail(); return; }
    const { cost, saved, pct, funded, bought } = wishlistMetrics(w);
    const cur = wishlistCcy();
    const contribs = w.contributions.slice().sort((a,b)=>b.createdAt-a.createdAt);

    body.innerHTML = '<div class="wishlist-hero">'
        +   '<div class="wishlist-hero-photo" title="Click to change picture">'+(w.imageUrl?'<img src="'+w.imageUrl+'" alt="">':'<span class="wishlist-hero-placeholder">🎁</span>')+'</div>'
        +   '<input type="file" accept="image/*" class="wishlist-hero-file" style="display:none;">'
        +   '<button class="wishlist-hero-close" type="button" title="Close">✕</button>'
        + '</div>'
        + '<div class="wishlist-detail-body">'
        +   '<input type="text" class="wishlist-hero-name-input" maxlength="80" value="'+escapeHtml(w.name)+'">'
        +   '<div class="wishlist-hero-amount-row"><span class="wishlist-hero-symbol">'+ccySymbol(cur)+'</span><input type="number" min="0" step="0.01" class="wishlist-hero-amount-input" value="'+cost+'"></div>'
        +   '<div class="wishlist-hero-meta">'
        +     '<span>'+wishlistFmt(saved)+' / '+Math.round(cost).toLocaleString()+'</span>'
        +     '<span>'+pct+'%'+(bought?' · Bought':funded?' · Funded':'')+'</span>'
        +   '</div>'
        +   '<div class="mini-track wishlist-hero-track"><div class="mini-fill" style="width:'+pct+'%"></div></div>'
        +   '<div class="wishlist-bought-row">'
        +     '<button class="btn '+(bought?'btn-ghost':'btn-primary')+' btn-sm" type="button" id="wishlistDetailBoughtBtn">'+(bought?'↺ Mark as not bought':'🛍 Mark as Bought')+'</button>'
        +   '</div>'
        +   '<div class="section-lbl">Add Funds</div>'
        +   '<div class="add-tx-row">'
        +     '<input type="number" min="0" step="0.01" class="wishlist-detail-funds-input" placeholder="Amount">'
        +     '<button class="btn btn-primary" type="button" id="wishlistDetailFundsBtn">+ Add</button>'
        +   '</div>'
        +   '<div class="section-lbl" style="margin-top:16px;">Contribution History</div>'
        +   (contribs.length ? '<div class="wishlist-contrib-grid" id="wishlistContribGrid"></div>' : '<div style="font-size:12px;color:var(--faint);padding:2px 0;">No funds added yet.</div>')
        +   '<div class="goal-footer"><button class="del-goal" id="wishlistDetailDeleteBtn">Delete item</button></div>'
        + '</div>';

    const grid = body.querySelector('#wishlistContribGrid');
    if(grid){
      contribs.forEach(c=>{
        const cell = document.createElement('div'); cell.className='wishlist-contrib-cell';
        cell.innerHTML = '<button class="wishlist-contrib-del" title="Remove">✕</button>'
          + '<div class="wishlist-contrib-amt">'+wishlistFmt(c.amount)+'</div>'
          + '<div class="wishlist-contrib-date">'+fmtDate(c.createdAt)+'</div>';
        cell.querySelector('.wishlist-contrib-del').addEventListener('click', ()=>{
          w.contributions = w.contributions.filter(x=>x.id!==c.id);
          save(); renderWishlist();
        });
        grid.appendChild(cell);
      });
    }

    body.querySelector('.wishlist-hero-close').addEventListener('click', closeWishlistDetail);

    const nameInput = body.querySelector('.wishlist-hero-name-input');
    nameInput.addEventListener('change', ()=>{
      const v = nameInput.value.trim();
      if(v) w.name = v; else nameInput.value = w.name;
      save(); renderWishlist();
    });

    const costInput = body.querySelector('.wishlist-hero-amount-input');
    costInput.addEventListener('change', ()=>{
      w.cost = parseFloat(costInput.value)||0;
      save(); renderWishlist();
    });

    const photoWrap = body.querySelector('.wishlist-hero-photo');
    const fileInput = body.querySelector('.wishlist-hero-file');
    photoWrap.addEventListener('click', ()=> fileInput.click());
    fileInput.addEventListener('change', e=>{
      const file = e.target.files[0]; if(!file) return;
      const prevUrl = w.imageUrl;
      uploadCompressedImage(file, 360, 0.7, 'wishlist').then(url=>{
        w.imageUrl = url; save(); renderWishlist();
        deleteStorageImage(prevUrl);
      }).catch(err=> window.alert(err.message));
    });

    body.querySelector('#wishlistDetailBoughtBtn').addEventListener('click', ()=>{
      w.bought = !w.bought;
      save(); renderWishlist();
    });

    const fundsInput = body.querySelector('.wishlist-detail-funds-input');
    const addFunds = () => {
      const amt = parseFloat(fundsInput.value);
      if(!amt || amt<=0) return;
      w.contributions.push({ id:uid(), amount:amt, createdAt:Date.now() });
      save(); renderWishlist();
    };
    body.querySelector('#wishlistDetailFundsBtn').addEventListener('click', addFunds);
    fundsInput.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); addFunds(); } });

    body.querySelector('#wishlistDetailDeleteBtn').addEventListener('click', ()=>{
      if(!window.confirm('Delete "'+w.name+'" from your wishlist?')) return;
      deleteStorageImage(w.imageUrl);
      state.wishlist = state.wishlist.filter(x=>x.id!==w.id);
      save();
      closeWishlistDetail();
      renderWishlist();
    });
  }
