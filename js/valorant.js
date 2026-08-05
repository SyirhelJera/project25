  /* ================= VALORANT ================= */
  const HENRIK_BASE = 'https://api.henrikdev.xyz/valorant';
  const VAL_REGION_LABELS = { na:'NA', eu:'EU', ap:'APAC', kr:'KR', latam:'LATAM', br:'BR' };
  const VALORANT_API_BASE = 'https://valorant-api.com/v1';

  // Rank tier icons (id -> {name, small, large}), fetched once from the public valorant-api.com
  // reference API (no key required) and cached for the session.
  let valTierIconCache = null;
  let valTierIconPromise = null;
  function ensureValTierIcons(){
    if(valTierIconCache) return Promise.resolve(valTierIconCache);
    if(valTierIconPromise) return valTierIconPromise;
    valTierIconPromise = fetch(VALORANT_API_BASE+'/competitivetiers')
      .then(r=>r.json())
      .then(json=>{
        const episodes = (json && Array.isArray(json.data)) ? json.data : [];
        const latest = episodes[episodes.length-1];
        const map = {};
        if(latest && Array.isArray(latest.tiers)){
          latest.tiers.forEach(t=>{
            map[t.tier] = { name: t.tierName, small: t.smallIcon, large: t.largeIcon };
          });
        }
        valTierIconCache = map;
        renderValorant();
        return map;
      })
      .catch(()=>{ valTierIconCache = {}; return valTierIconCache; });
    return valTierIconPromise;
  }
  ensureValTierIcons();

  // Agent reference art (name lowercased -> {name, icon, background}), used to paint a faint
  // watermark of the last-played agent behind an account's card. Same no-key public API as tiers.
  let valAgentCache = null;
  let valAgentPromise = null;
  function ensureValAgentIcons(){
    if(valAgentCache) return Promise.resolve(valAgentCache);
    if(valAgentPromise) return valAgentPromise;
    valAgentPromise = fetch(VALORANT_API_BASE+'/agents?isPlayableCharacter=true')
      .then(r=>r.json())
      .then(json=>{
        const map = {};
        (json && Array.isArray(json.data) ? json.data : []).forEach(a=>{
          if(!a.displayName) return;
          map[a.displayName.toLowerCase()] = { name: a.displayName, icon: a.displayIcon, background: a.fullPortrait || a.background };
        });
        valAgentCache = map;
        renderValorant();
        return map;
      })
      .catch(()=>{ valAgentCache = {}; return valAgentCache; });
    return valAgentPromise;
  }
  ensureValAgentIcons();

  // Weapon skin database (uuid/name/icon), used to power the wishlist's search-as-you-type
  // picker so users pick a real skin (with its actual thumbnail) instead of typing a name from
  // memory. Same no-key public reference API as tiers/agents above. Entries with no
  // contentTierUuid are the weapon's own default "Standard" skin (and the "Random Favorite Skin"
  // selector) — neither is ever sold in the daily store, so they're filtered out here.
  let valSkinDbCache = null;
  let valSkinDbPromise = null;
  function ensureValSkinDb(){
    if(valSkinDbCache) return Promise.resolve(valSkinDbCache);
    if(valSkinDbPromise) return valSkinDbPromise;
    valSkinDbPromise = fetch(VALORANT_API_BASE+'/weapons/skins?language=en-US')
      .then(r=>r.json())
      .then(json=>{
        const skins = (json && Array.isArray(json.data)) ? json.data : [];
        valSkinDbCache = skins
          .filter(s=> s.contentTierUuid && s.displayName)
          .map(s=>({
            uuid: s.uuid,
            name: s.displayName,
            icon: s.displayIcon
              || (s.chromas && s.chromas[0] && (s.chromas[0].displayIcon || s.chromas[0].fullRender))
              || (s.levels && s.levels[0] && s.levels[0].displayIcon)
              || ''
          }));
        return valSkinDbCache;
      })
      .catch(()=>{ valSkinDbCache = []; return valSkinDbCache; });
    return valSkinDbPromise;
  }
  ensureValSkinDb();

  function valTierColor(tierName){
    if(!tierName) return '#8B92A8';
    const t = tierName.toLowerCase();
    if(t.includes('iron')) return '#6B7280';
    if(t.includes('bronze')) return '#A9714B';
    if(t.includes('silver')) return '#9CA6AF';
    if(t.includes('gold')) return '#E8B94B';
    if(t.includes('platinum')) return '#2FB6B0';
    if(t.includes('diamond')) return '#B084F0';
    if(t.includes('ascendant')) return '#2FBE7A';
    if(t.includes('immortal')) return '#C33E6B';
    if(t.includes('radiant')) return '#E9DE8E';
    return '#6366F1';
  }
  function hexToRgba(hex, alpha){
    const h = hex.replace('#','');
    const r = parseInt(h.substring(0,2),16), g = parseInt(h.substring(2,4),16), b = parseInt(h.substring(4,6),16);
    return 'rgba('+r+','+g+','+b+','+alpha+')';
  }

  async function fetchValorantAccount(accId){
    const acc = state.valorant.accounts.find(a=>a.id===accId);
    if(!acc) return;
    acc.loading = true; acc.error = '';
    renderValorant();
    try{
      const enc = s => encodeURIComponent(s);
      const headers = { 'Accept':'application/json' };
      if(state.valorant.apiKey) headers['Authorization'] = state.valorant.apiKey;

      const mmrUrl = HENRIK_BASE+'/v3/mmr/'+acc.region+'/'+acc.platform+'/'+enc(acc.name)+'/'+enc(acc.tag);
      const mmrRes = await fetch(mmrUrl, { headers });
      const mmrJson = await mmrRes.json().catch(()=>null);
      if(!mmrRes.ok || !mmrJson || !mmrJson.data || !mmrJson.data.current){
        const apiMsg = mmrJson && mmrJson.errors && mmrJson.errors[0] && mmrJson.errors[0].message;
        throw new Error(apiMsg || ('Could not fetch rank (HTTP '+mmrRes.status+'). Check the Riot ID, region, and API key.'));
      }
      acc.current = {
        tierName: mmrJson.data.current.tier ? mmrJson.data.current.tier.name : 'Unranked',
        tierId: (mmrJson.data.current.tier && typeof mmrJson.data.current.tier.id === 'number') ? mmrJson.data.current.tier.id : null,
        rr: typeof mmrJson.data.current.rr === 'number' ? mmrJson.data.current.rr : 0,
        lastChange: mmrJson.data.current.last_change || 0,
        elo: mmrJson.data.current.elo || 0,
        peakTierName: (mmrJson.data.peak && mmrJson.data.peak.tier) ? mmrJson.data.peak.tier.name : ''
      };
      ensureValTierIcons();

      try{
        const histUrl = HENRIK_BASE+'/v2/mmr-history/'+acc.region+'/'+acc.platform+'/'+enc(acc.name)+'/'+enc(acc.tag);
        const histRes = await fetch(histUrl, { headers });
        const histJson = await histRes.json().catch(()=>null);
        if(histRes.ok && histJson && histJson.data && Array.isArray(histJson.data.history)){
          acc.history = histJson.data.history
            .map(h=>({ date: h.date, tier: h.tier ? h.tier.name : '', tierId: (h.tier && typeof h.tier.id === 'number') ? h.tier.id : null, rr: h.rr, lastChange: h.last_change }))
            .filter(h=>h.date)
            .sort((a,b)=> new Date(a.date) - new Date(b.date));
        }
      }catch(histErr){ /* current rank still succeeded even if history fails — keep whatever we already had */ }

      try{
        // last-played agent, used only to paint a faint background watermark on the card —
        // best-effort, so any failure here is silently ignored rather than surfaced as an error
        const matchUrl = HENRIK_BASE+'/v3/matches/'+acc.region+'/'+enc(acc.name)+'/'+enc(acc.tag)+'?size=1';
        const matchRes = await fetch(matchUrl, { headers });
        const matchJson = await matchRes.json().catch(()=>null);
        if(matchRes.ok && matchJson && Array.isArray(matchJson.data) && matchJson.data.length){
          const players = (matchJson.data[0].players && matchJson.data[0].players.all_players) || [];
          const me = players.find(p => p.name && p.tag
            && p.name.toLowerCase()===acc.name.toLowerCase() && p.tag.toLowerCase()===acc.tag.toLowerCase());
          if(me && me.character) acc.lastAgent = me.character;
        }
        ensureValAgentIcons();
      }catch(agentErr){ /* background art is a nice-to-have — skip it if this endpoint fails */ }

      acc.lastFetched = Date.now();
    }catch(e){
      acc.error = (e && e.message) || 'Failed to fetch. Check your Riot ID, region, and API key.';
    }
    acc.loading = false;
    save();
    renderValorant();
  }

  // Higher tierId = higher rank (per valorant-api competitivetiers ordering). Accounts with no
  // fetched rank yet sort to the bottom regardless of sort mode.
  function valRankSortValue(acc){
    if(!acc.current) return -1;
    const tierId = typeof acc.current.tierId === 'number' ? acc.current.tierId : 0;
    return tierId * 1000 + (acc.current.rr||0);
  }
  // "Recent activity": the account's last fetched match changed RR — up or down — so the card
  // gets a colored accent to draw the eye without the user having to open every account.
  function valRecentActivityClass(acc){
    if(!acc.current || !acc.current.lastChange) return '';
    return acc.current.lastChange > 0 ? 'val-recent-up' : 'val-recent-down';
  }
  // Timestamp of the account's most recent competitive match, taken from its RR history (not
  // from when the app last refreshed the data) — so "played July 24" always outranks "played
  // July 23," regardless of which one was refreshed more recently in the app.
  function valLastMatchTime(acc){
    const hist = acc.history || [];
    if(!hist.length) return 0;
    const last = hist[hist.length-1]; // history is stored sorted ascending by date
    const t = last && last.date ? new Date(last.date).getTime() : 0;
    return isNaN(t) ? 0 : t;
  }
  // human-readable "how long ago" for a timestamp, e.g. "30 mins ago", "2 hrs ago", "1 day ago"
  function valTimeAgo(ts){
    if(!ts) return '';
    const diff = Date.now() - ts;
    if(diff < 60000) return 'just now';
    const mins = Math.floor(diff/60000);
    if(mins < 60) return mins+' min'+(mins===1?'':'s')+' ago';
    const hrs = Math.floor(mins/60);
    if(hrs < 24) return hrs+' hr'+(hrs===1?'':'s')+' ago';
    const days = Math.floor(hrs/24);
    if(days < 30) return days+' day'+(days===1?'':'s')+' ago';
    const months = Math.floor(days/30);
    if(months < 12) return months+' month'+(months===1?'':'s')+' ago';
    const years = Math.floor(months/12);
    return years+' year'+(years===1?'':'s')+' ago';
  }
  function sortedValorantAccounts(){
    const accounts = state.valorant.accounts.slice();
    if(state.valorant.sortMode === 'rank'){
      accounts.sort((a,b)=> valRankSortValue(b) - valRankSortValue(a));
    } else if(state.valorant.sortMode === 'name'){
      accounts.sort((a,b)=> a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    } else if(state.valorant.sortMode === 'recent'){
      // whoever played their last match most recently (e.g. Jul 24) shows before someone whose
      // last match was earlier (e.g. Jul 23); accounts with no match history sink to the bottom
      accounts.sort((a,b)=> valLastMatchTime(b) - valLastMatchTime(a));
    }
    return accounts;
  }

  // subgroup collapse state — session-only, like the checklist subgroup headers
  const valGroupCollapsed = {};

  /* drag-to-reorder valorant accounts — only active while sort mode is "manual" */
  let draggedValAccId = null;
  const valAccountListEl = el('valAccountList');
  valAccountListEl.addEventListener('dragstart', e=>{
    const handle = e.target.closest('.val-drag-handle');
    if(!handle || state.valorant.sortMode !== 'manual') return;
    const card = handle.closest('.val-account-card');
    draggedValAccId = card ? card.dataset.accId : null;
    e.dataTransfer.effectAllowed = 'move';
  });
  valAccountListEl.addEventListener('dragover', e=>{
    if(!draggedValAccId) return;
    e.preventDefault();
    const overCard = e.target.closest('.val-account-card');
    valAccountListEl.querySelectorAll('.val-account-card.drag-over').forEach(c=>c.classList.remove('drag-over'));
    if(overCard && overCard.dataset.accId !== draggedValAccId) overCard.classList.add('drag-over');
  });
  valAccountListEl.addEventListener('drop', e=>{
    if(!draggedValAccId) return;
    e.preventDefault();
    valAccountListEl.querySelectorAll('.val-account-card.drag-over').forEach(c=>c.classList.remove('drag-over'));
    const overCard = e.target.closest('.val-account-card');
    const toId = overCard ? overCard.dataset.accId : null;
    const fromId = draggedValAccId; draggedValAccId = null;
    if(!toId || toId === fromId) return;
    const fromIdx = state.valorant.accounts.findIndex(x=>x.id===fromId);
    const toIdx = state.valorant.accounts.findIndex(x=>x.id===toId);
    if(fromIdx<0 || toIdx<0) return;
    const [moved] = state.valorant.accounts.splice(fromIdx,1);
    state.valorant.accounts.splice(toIdx,0,moved);
    save(); renderValorant();
  });
  valAccountListEl.addEventListener('dragend', ()=>{ draggedValAccId = null; valAccountListEl.querySelectorAll('.val-account-card.drag-over').forEach(c=>c.classList.remove('drag-over')); });

  el('valSortMode').addEventListener('change', e=>{
    state.valorant.sortMode = e.target.value;
    save(); renderValorant();
  });
  el('valRefreshAllBtn').addEventListener('click', ()=>{
    state.valorant.accounts.forEach(acc=> fetchValorantAccount(acc.id));
  });

  /* ---- RR Tracker / Shop Tracker sub-tabs: the Valorant view got crowded once the store +
     wishlist card was added alongside rank tracking, so the two are now split into switchable
     panels instead of one long scroll. ---- */
  function renderValSubtabs(){
    const active = state.valorant.activeSubtab === 'shop' ? 'shop' : 'rr';
    el('valSubtabBtnRR').classList.toggle('active', active === 'rr');
    el('valSubtabBtnShop').classList.toggle('active', active === 'shop');
    el('valSubtabRR').style.display = active === 'rr' ? 'block' : 'none';
    el('valSubtabShop').style.display = active === 'shop' ? 'block' : 'none';
  }
  el('valSubtabToggle').addEventListener('click', e=>{
    const btn = e.target.closest('[data-subtab]');
    if(!btn) return;
    state.valorant.activeSubtab = btn.dataset.subtab;
    save(); renderValSubtabs();
  });
  renderValSubtabs();

  /* ---- daily store: written by scripts/valorant-check-store.mjs, run locally on the app
     owner's machine (see README.md — Riot's bot detection blocks this reauth flow from cloud
     infrastructure) into state.valorant.dailyStores, keyed by the label chosen when running
     scripts/valorant-login.mjs (e.g. "main", "smurf") — this client only ever reads/displays it,
     never fetches or authenticates to Riot itself. One or more accounts render as separate
     labeled sections so multiple Riot accounts' stores can be checked at a glance. ---- */
  /* ---- wishlist: gun/skin names the user wants a heads-up about when they rotate into the
     daily store — one list per tracked account label (state.valorant.wishlist[label]), so a skin
     wishlisted on one account doesn't tick for another. Matching is a simple case-insensitive
     substring check in either direction, so a wishlist entry of "Vandal" matches a store item
     named "Reaver Vandal", and a full skin name pasted in ("Reaver Vandal") still matches itself
     exactly. The account switcher above the store (same selectedStoreLabel used to filter which
     account's store shows) also picks which account's wishlist is being viewed/edited here. ---- */
  function valWishlistMatchesForItem(itemName, label){
    if(!itemName || !label) return [];
    const lower = itemName.toLowerCase();
    return (state.valorant.wishlist[label]||[]).filter(w=>{
      const wl = (w.name||'').toLowerCase().trim();
      return wl && (lower.includes(wl) || wl.includes(lower));
    });
  }
  // every {wishlist item, store item} pairing currently sitting in any tracked account's own daily
  // store — drives both the red nav tick and the "matched" styling on wishlist chips
  function valCurrentWishlistMatches(){
    const stores = state.valorant.dailyStores || {};
    const matches = [];
    Object.keys(stores).forEach(label=>{
      const ds = stores[label];
      if(!ds || !Array.isArray(ds.items)) return;
      ds.items.forEach(it=>{
        valWishlistMatchesForItem(it.name, label).forEach(w=>{
          matches.push({ wishlistId: w.id, itemName: it.name, label });
        });
      });
    });
    return matches;
  }
  function updateValWishlistBadge(){
    const badge = el('valWishlistBadge');
    if(!badge) return;
    badge.style.display = valCurrentWishlistMatches().length ? 'inline-flex' : 'none';
  }

  function renderValWishlist(){
    const listEl = el('valWishlistList');
    if(!listEl) return;
    const label = state.valorant.selectedStoreLabel;
    const bodyEl = el('valWishlistBody');
    const noAccEl = el('valWishlistNoAccount');
    if(!label){
      // "All accounts" is selected in the switcher above — wishlists are per-account, so there's
      // no single list to show or add to until one specific account is picked
      bodyEl.style.display = 'none';
      if(noAccEl) noAccEl.style.display = 'block';
      el('valWishlistCount').textContent = '';
      updateValWishlistBadge();
      return;
    }
    if(noAccEl) noAccEl.style.display = 'none';
    const wishlist = state.valorant.wishlist[label] || (state.valorant.wishlist[label] = []);
    const collapsed = !!state.valorant.wishlistCollapsed;
    bodyEl.style.display = collapsed ? 'none' : 'block';
    el('valWishlistChevron').textContent = collapsed ? '▶' : '▼';
    el('valWishlistCount').textContent = wishlist.length ? '('+wishlist.length+')' : '';
    el('valWishlistEmpty').style.display = wishlist.length ? 'none' : 'block';
    const matches = valCurrentWishlistMatches();
    // fixed-size rows (not variable-width pills) so a long skin name doesn't blow up its own
    // chip while a short one sits tiny next to it — name truncates with an ellipsis instead
    listEl.innerHTML = wishlist.map(w=>{
      const hit = matches.find(m=>m.wishlistId===w.id);
      return '<div class="val-wishlist-row'+(hit?' matched':'')+'" data-wish-id="'+w.id+'">'
        + (w.imageUrl ? '<img class="val-wishlist-row-img" src="'+escapeHtml(w.imageUrl)+'" alt="">' : '<span class="val-wishlist-row-img"></span>')
        + '<span class="val-wishlist-row-name" title="'+escapeHtml(w.name)+'">'+escapeHtml(w.name)+'</span>'
        + (hit ? '<span class="val-wishlist-row-hit" title="In today\'s store">✓</span>' : '')
        + '<button class="val-icon-btn" data-wish-del="'+w.id+'" title="Remove from wishlist">✕</button>'
        + '</div>';
    }).join('');
    listEl.querySelectorAll('[data-wish-del]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        state.valorant.wishlist[label] = (state.valorant.wishlist[label]||[]).filter(w=>w.id!==btn.dataset.wishDel);
        save(); renderValWishlist();
      });
    });
    updateValWishlistBadge();
  }

  el('valWishlistToggle').addEventListener('click', ()=>{
    state.valorant.wishlistCollapsed = !state.valorant.wishlistCollapsed;
    save(); renderValWishlist();
  });

  // shared by the freeform "+ Add to Wishlist" button and by clicking a search suggestion below —
  // imageUrl/skinUuid are only known when the entry came from the skin database picker; adds to
  // whichever account is currently picked in the switcher above the store
  function addValWishlistEntry(name, imageUrl, skinUuid){
    const label = state.valorant.selectedStoreLabel;
    if(!label) return;
    name = (name||'').trim();
    if(!name) return;
    const list = state.valorant.wishlist[label] || (state.valorant.wishlist[label] = []);
    if(list.some(w=>w.name.toLowerCase()===name.toLowerCase())) return;
    list.push({ id: uid(), name, imageUrl: imageUrl||'', skinUuid: skinUuid||'', createdAt: Date.now() });
    save(); renderValWishlist();
  }

  function hideValWishlistSuggest(){
    const box = el('valWishlistSuggest');
    if(box){ box.style.display = 'none'; box.innerHTML = ''; }
  }

  // search-as-you-type dropdown of real skins (name + thumbnail) pulled from ensureValSkinDb() —
  // picking one adds it straight to the wishlist with its actual image
  function renderValWishlistSuggest(query){
    const box = el('valWishlistSuggest');
    if(!box) return;
    const q = (query||'').trim().toLowerCase();
    const db = valSkinDbCache || [];
    if(!q || !db.length){ hideValWishlistSuggest(); return; }
    const results = db.filter(s=>s.name.toLowerCase().includes(q)).slice(0,8);
    if(!results.length){ hideValWishlistSuggest(); return; }
    box.innerHTML = results.map(s=>
      '<div class="val-wishlist-suggest-item" data-skin-uuid="'+escapeHtml(s.uuid)+'">'
      + (s.icon ? '<img src="'+escapeHtml(s.icon)+'" alt="">' : '<span class="val-wishlist-suggest-noimg"></span>')
      + '<span>'+escapeHtml(s.name)+'</span>'
      + '</div>'
    ).join('');
    box.style.display = 'block';
    box.querySelectorAll('[data-skin-uuid]').forEach(item=>{
      // mousedown (not click) fires before the input's blur handler, so the suggestion is still
      // in the DOM to be clicked instead of getting hidden out from under the pointer first
      item.addEventListener('mousedown', (e)=>{
        e.preventDefault();
        const skin = db.find(s=>s.uuid===item.dataset.skinUuid);
        if(!skin) return;
        addValWishlistEntry(skin.name, skin.icon, skin.uuid);
        el('valWishlistInput').value = '';
        hideValWishlistSuggest();
      });
    });
  }

  el('valWishlistInput').addEventListener('input', e=> renderValWishlistSuggest(e.target.value));
  el('valWishlistInput').addEventListener('focus', e=> renderValWishlistSuggest(e.target.value));
  el('valWishlistInput').addEventListener('blur', ()=> setTimeout(hideValWishlistSuggest, 150));

  el('valWishlistAddBtn').addEventListener('click', ()=>{
    const input = el('valWishlistInput');
    addValWishlistEntry(input.value);
    input.value = '';
    hideValWishlistSuggest();
  });
  el('valWishlistInput').addEventListener('keydown', e=>{ if(e.key==='Enter') el('valWishlistAddBtn').click(); });

  // Valorant's own store editions are priced in fixed VP bands (Select/Deluxe/Premium/Exclusive/
  // Ultra), so a skin's price alone is a reliable stand-in for its edition color — the per-item
  // fetch in valorant-lib.mjs never resolves contentTier, but this gets the same visual language
  // (the colored corner flash under each skin in-game) without touching the check-store pipeline.
  function valSkinRarityInfo(price){
    const p = parseInt(price,10)||0;
    if(p >= 2900) return { name:'Ultra', color:'#F0D449' };
    if(p >= 2100) return { name:'Exclusive', color:'#F0954B' };
    if(p >= 1600) return { name:'Premium', color:'#E058CF' };
    if(p >= 1000) return { name:'Deluxe', color:'#2FBE7A' };
    return { name:'Select', color:'#4B9EF0' };
  }
  function valStoreHeader(label, ds){
    const checkedHtml = ds.checkedAt
      ? '<span class="val-store-checked" title="'+escapeHtml(fmtDate(ds.checkedAt))+'">🕒 '+escapeHtml(valTimeAgo(ds.checkedAt))+'</span>'
      : '';
    return '<div class="val-store-account-hdr"><span class="val-store-account-name">'+escapeHtml(label)+'</span>'+checkedHtml+'</div>';
  }

  function renderValorantStore(){
    const wrap = el('valStoreCard'); if(!wrap) return;
    const unavailable = usingClaudeStorage || !supabaseConfigured;
    el('valStoreUnavailable').style.display = unavailable ? 'block' : 'none';
    if(unavailable){ wrap.innerHTML = ''; return; }

    const stores = state.valorant.dailyStores || {};
    const allLabels = Object.keys(stores);
    if(!allLabels.length){
      wrap.innerHTML = '<div class="empty val-store-empty">🛒 No store data yet — run <code>scripts/valorant-login.mjs</code> then <code>scripts/valorant-check-store.mjs</code> locally (see README.md "Setup").</div>';
      return;
    }
    // the account switcher under the store doubles as a filter here — pick one account to show
    // just its store, or "All accounts" (empty selection) to show every tracked account stacked.
    const selected = state.valorant.selectedStoreLabel;
    const labels = (selected && allLabels.includes(selected)) ? [selected] : allLabels.slice();

    // in the "All accounts" view, surface whichever account currently has a wishlisted skin in
    // its store first, so a hit isn't buried below accounts you have no particular interest in —
    // stable sort keeps everything else in its existing order.
    if(labels.length > 1){
      const hasWishMatch = label => {
        const ds = stores[label];
        return !!(ds && Array.isArray(ds.items) && ds.items.some(it => valWishlistMatchesForItem(it.name, label).length > 0));
      };
      labels.sort((a,b) => (hasWishMatch(b)?1:0) - (hasWishMatch(a)?1:0));
    }

    wrap.innerHTML = labels.map(label=>{
      const ds = stores[label] || {};
      const hdrHtml = valStoreHeader(label, ds);
      if(ds.error){
        return '<div class="val-store-account val-store-account-error">'+hdrHtml+'<div class="val-err">⚠️ '+escapeHtml(ds.error)+'</div></div>';
      }
      if(!ds.checkedAt){
        return '<div class="val-store-account val-store-account-empty">'+hdrHtml+'<div class="val-peak-note">No store data yet — run scripts/valorant-check-store.mjs locally (see README.md "Setup").</div></div>';
      }
      const items = ds.items || [];
      let html = '<div class="val-store-grid">';
      items.forEach(it=>{
        const isWish = valWishlistMatchesForItem(it.name, label).length > 0;
        const rarity = valSkinRarityInfo(it.price);
        html += '<div class="val-store-item'+(isWish?' wishlist-match':'')+'" style="--rarity-color:'+rarity.color+';" title="'+escapeHtml(rarity.name)+' Edition">'
          + (isWish ? '<span class="val-store-item-wish-badge" title="On your wishlist">★</span>' : '')
          + '<div class="val-store-item-img">'+(it.imageUrl ? '<img src="'+escapeHtml(it.imageUrl)+'" alt="'+escapeHtml(it.name)+'">' : '')+'</div>'
          + '<div class="val-store-item-footer">'
          + '<span class="val-store-item-name" title="'+escapeHtml(it.name)+'">'+escapeHtml(it.name)+'</span>'
          + '<span class="val-store-item-price">'+(parseInt(it.price,10)||0).toLocaleString()+'</span>'
          + '</div></div>';
      });
      html += '</div>';
      return '<div class="val-store-account">'+hdrHtml+html+'</div>';
    }).join('');
  }

  // Same tier -> color mapping the store already uses for its price-band rarity flash
  // (valSkinRarityInfo above), just keyed by the real tier name coming back from
  // checkAccountOwnedSkins() instead of guessed from a price (owned skins aren't for sale, so
  // there's no price to guess from). Matched by substring, case-insensitive, highest tier first —
  // same "don't trust the exact shape" posture as resolveTierRank() in valorant-lib.mjs, in case
  // Riot's actual tier name has extra decoration text (e.g. "Deluxe Edition") around the word.
  const VAL_TIER_COLOR_ORDER = ['Select','Deluxe','Premium','Exclusive','Ultra'];
  const VAL_TIER_COLORS = { Ultra:'#F0D449', Exclusive:'#F0954B', Premium:'#E058CF', Deluxe:'#2FBE7A', Select:'#4B9EF0' };
  function valSkinTierColor(tierName){
    const s = (tierName||'').toLowerCase();
    for(let i=VAL_TIER_COLOR_ORDER.length-1;i>=0;i--){
      if(s.includes(VAL_TIER_COLOR_ORDER[i].toLowerCase())) return VAL_TIER_COLORS[VAL_TIER_COLOR_ORDER[i]];
    }
    return '#9CA6AF';
  }
  // Riot's actual tier name comes back as e.g. "Ultra Edition", not just "Ultra" — fine for the
  // substring match above, but "Ultra Edition" as a badge/label reads noisy and crowds out the
  // skin name in the card footer. Strips it for anywhere the tier name is shown to the user.
  function tierDisplayName(tierName){
    return (tierName||'').replace(/\s*edition\s*$/i, '').trim() || 'Unknown';
  }

  // Default weapon-type grouping/sort order, per user preference — not the in-game buy-menu
  // order. Anything valorant-api.com returns that isn't in this list (shouldn't happen, but the
  // category string is reverse engineered like everything else Riot-side here) sorts after all
  // of these, alphabetically.
  const VAL_WEAPON_TYPE_ORDER = ['Melee','Rifle','Sniper','SMG','Sidearm','Shotgun','Heavy'];
  function weaponTypeRank(weaponType){
    const i = VAL_WEAPON_TYPE_ORDER.indexOf(weaponType);
    return i === -1 ? VAL_WEAPON_TYPE_ORDER.length : i;
  }
  // Ascending price/rarity order, used only to order the tier filter chips — sort itself uses
  // each skin's own tierRank from checkAccountOwnedSkins().
  const VAL_TIER_ORDER = ['Standard','Select','Deluxe','Premium','Exclusive','Ultra'];
  function tierOrderRank(tierName){
    const i = VAL_TIER_ORDER.indexOf(tierName);
    return i === -1 ? VAL_TIER_ORDER.length : i;
  }

  /* ---- owned skins: written by the "🎨 Check Owned Skins" local-helper action (see
     checkAccountOwnedSkins() in scripts/valorant-lib.mjs) into state.valorant.ownedSkins, keyed
     by account label same as dailyStores — every weapon skin the account owns, with its content
     tier and weapon type. Rendered as its own account-style section (same header/grid look as
     the store above), collapsible, filterable by tier/weapon type, and follows the same
     account-switcher selection; shows nothing useful for "All accounts" since there's no single
     list to render, same as the wishlist. ---- */
  let valOwnedSkinsSort = 'tier-desc'; // not persisted — resets to a sensible default each page load
  let valOwnedSkinsTierExclude = new Set(); // tier names currently hidden — not persisted
  let valOwnedSkinsTypeExclude = new Set(); // weapon types currently hidden — not persisted

  el('valOwnedSkinsSortSelect').addEventListener('change', ()=>{
    valOwnedSkinsSort = el('valOwnedSkinsSortSelect').value;
    renderValOwnedSkins();
  });
  el('valOwnedSkinsToggle').addEventListener('click', ()=>{
    state.valorant.ownedSkinsCollapsed = !state.valorant.ownedSkinsCollapsed;
    save();
    renderValOwnedSkins();
  });
  // Delegated (chips are regenerated on every render, so binding to each one directly wouldn't
  // survive a re-render) — toggles that one value's membership in the relevant exclude set.
  el('valOwnedSkinsTierFilters').addEventListener('click', e=>{
    const btn = e.target.closest('[data-tier]'); if(!btn) return;
    const t = btn.dataset.tier;
    if(valOwnedSkinsTierExclude.has(t)) valOwnedSkinsTierExclude.delete(t); else valOwnedSkinsTierExclude.add(t);
    renderValOwnedSkins();
  });
  el('valOwnedSkinsTypeFilters').addEventListener('click', e=>{
    const btn = e.target.closest('[data-weapon-type]'); if(!btn) return;
    const t = btn.dataset.weaponType;
    if(valOwnedSkinsTypeExclude.has(t)) valOwnedSkinsTypeExclude.delete(t); else valOwnedSkinsTypeExclude.add(t);
    renderValOwnedSkins();
  });

  // Builds one filter-chip row: a small uppercase label plus one toggle chip per distinct value
  // present in `values` (in `order` order) — a chip reads as "on" (shown) unless its value is in
  // `excludeSet`. Hides the whole row (returns '') if there's nothing to usefully filter by.
  function ownedSkinsFilterRowHtml(label, values, order, excludeSet, dataAttr){
    const present = [...new Set(values)].sort((a,b)=> order(a) - order(b));
    if(present.length < 2) return '';
    return '<span class="val-owned-skins-filter-label">'+escapeHtml(label)+'</span>'
      + present.map(v=> '<button type="button" class="chart-zoom-btn'+(excludeSet.has(v)?'':' active')+'" data-'+dataAttr+'="'+escapeHtml(v)+'">'+escapeHtml(v)+'</button>').join('');
  }

  function renderValOwnedSkins(){
    const card = el('valOwnedSkinsCard'); if(!card) return;
    const unavailable = usingClaudeStorage || !supabaseConfigured;
    if(unavailable){ card.style.display = 'none'; return; }
    card.style.display = 'block';

    const collapsed = !!state.valorant.ownedSkinsCollapsed;
    el('valOwnedSkinsChevron').textContent = collapsed ? '▶' : '▼';
    const bodyEl = el('valOwnedSkinsBody');
    bodyEl.style.display = collapsed ? 'none' : 'block';
    if(collapsed) return; // nothing below the header needs updating while hidden

    const label = state.valorant.selectedStoreLabel;
    const noAccEl = el('valOwnedSkinsNoAccount');
    const errEl = el('valOwnedSkinsErr');
    const infoEl = el('valOwnedSkinsInfo');
    const toolbarEl = el('valOwnedSkinsToolbar');
    const tierFiltersEl = el('valOwnedSkinsTierFilters');
    const typeFiltersEl = el('valOwnedSkinsTypeFilters');
    const filteredEmptyEl = el('valOwnedSkinsFilteredEmpty');
    const listEl = el('valOwnedSkinsList');
    el('valOwnedSkinsSortSelect').value = valOwnedSkinsSort;

    function showOnly(which){
      noAccEl.style.display = which==='noacc' ? 'block' : 'none';
      errEl.style.display = which==='err' ? 'block' : 'none';
      infoEl.style.display = which==='info' ? 'block' : 'none';
      toolbarEl.style.display = which==='list' ? 'flex' : 'none';
      if(which !== 'list'){ tierFiltersEl.style.display = 'none'; typeFiltersEl.style.display = 'none'; filteredEmptyEl.style.display = 'none'; }
      listEl.style.display = which==='list' ? '' : 'none';
    }

    if(!label){
      showOnly('noacc');
      el('valOwnedSkinsChecked').style.display = 'none';
      el('valOwnedSkinsCount').textContent = '';
      return;
    }

    const os = (state.valorant.ownedSkins||{})[label];
    const checkedEl = el('valOwnedSkinsChecked');
    if(!os || (!os.checkedAt && !os.error)){
      showOnly('info');
      infoEl.textContent = 'No owned-skins data yet — click "🎨 Check Owned Skins" in Settings → Valorant Local Helper.';
      checkedEl.style.display = 'none';
      el('valOwnedSkinsCount').textContent = '';
      return;
    }
    if(os.error){
      showOnly('err');
      errEl.innerHTML = '⚠️ '+escapeHtml(os.error);
      checkedEl.style.display = 'none';
      el('valOwnedSkinsCount').textContent = '';
      return;
    }

    checkedEl.style.display = os.checkedAt ? 'inline' : 'none';
    if(os.checkedAt) checkedEl.innerHTML = '🕒 '+escapeHtml(valTimeAgo(os.checkedAt));
    if(os.checkedAt) checkedEl.title = escapeHtml(fmtDate(os.checkedAt));

    const allSkins = os.skins || [];
    if(!allSkins.length){
      showOnly('info');
      infoEl.textContent = 'No skins found for this account.';
      el('valOwnedSkinsCount').textContent = '';
      return;
    }

    showOnly('list');
    tierFiltersEl.innerHTML = ownedSkinsFilterRowHtml('Tier', allSkins.map(s=>tierDisplayName(s.tierName)), tierOrderRank, valOwnedSkinsTierExclude, 'tier');
    tierFiltersEl.style.display = tierFiltersEl.innerHTML ? 'flex' : 'none';
    typeFiltersEl.innerHTML = ownedSkinsFilterRowHtml('Weapon', allSkins.map(s=>s.weaponType||'Other'), weaponTypeRank, valOwnedSkinsTypeExclude, 'weapon-type');
    typeFiltersEl.style.display = typeFiltersEl.innerHTML ? 'flex' : 'none';

    const skins = allSkins.filter(s=> !valOwnedSkinsTierExclude.has(tierDisplayName(s.tierName)) && !valOwnedSkinsTypeExclude.has(s.weaponType||'Other'));
    if(valOwnedSkinsSort === 'name') skins.sort((a,b)=> a.name.localeCompare(b.name));
    else if(valOwnedSkinsSort === 'weapon') skins.sort((a,b)=> weaponTypeRank(a.weaponType) - weaponTypeRank(b.weaponType) || (b.tierRank??-1) - (a.tierRank??-1) || a.name.localeCompare(b.name));
    else if(valOwnedSkinsSort === 'tier-asc') skins.sort((a,b)=> (a.tierRank??-1) - (b.tierRank??-1) || a.name.localeCompare(b.name));
    else skins.sort((a,b)=> (b.tierRank??-1) - (a.tierRank??-1) || a.name.localeCompare(b.name));

    el('valOwnedSkinsCount').textContent = String(skins.length)+(skins.length!==allSkins.length ? ' / '+allSkins.length : '');
    filteredEmptyEl.style.display = skins.length ? 'none' : 'block';
    listEl.style.display = skins.length ? '' : 'none';
    listEl.innerHTML = skins.map(s=>{
      const color = valSkinTierColor(s.tierName);
      const sub = [s.weaponType, tierDisplayName(s.tierName)].filter(Boolean).join(' — ');
      return '<div class="val-store-item" style="--rarity-color:'+color+';" title="'+escapeHtml(s.name)+(sub?' — '+escapeHtml(sub):'')+'">'
        + '<div class="val-store-item-img">'+(s.imageUrl ? '<img src="'+escapeHtml(s.imageUrl)+'" alt="'+escapeHtml(s.name)+'">' : '')+'</div>'
        + '<div class="val-store-item-footer">'
        + '<span class="val-store-item-name" title="'+escapeHtml(s.name)+'">'+escapeHtml(s.name)+'</span>'
        + '</div></div>';
    }).join('');
  }

  /* ---- Local Helper: talks to scripts/valorant-local-server.mjs running on this machine, so
     the "Check Store Now" / "+ Add Account" buttons below can trigger the same store check /
     session-cookie save that valorant-check-store.mjs / valorant-login.mjs do from a terminal —
     see README.md for why logging in itself still has to happen in your own normal browser
     first (Riot's bot detection rejects automation-driven login attempts). Connection state
     (valLocalStatus) is intentionally not persisted: it only describes whatever's listening on
     *this* browser's localhost right now. ---- */
  const VAL_LOCAL_DEFAULT_URL = 'http://127.0.0.1:8787';
  let valLocalStatus = { connected:false, accounts:[], busy:false, busyMsg:'' };

  function valLocalUrl(){
    return (state.valorant.localServerUrl || VAL_LOCAL_DEFAULT_URL).replace(/\/+$/,'');
  }
  function showValLocalErr(msg, targetId){
    const e2 = el(targetId || 'valSettingsLocalErr');
    if(!e2) return;
    e2.textContent = msg;
    e2.style.display = 'block';
  }

  async function pollValLocalStatus(){
    try{
      const res = await fetch(valLocalUrl()+'/status');
      if(!res.ok) throw new Error('bad status');
      const json = await res.json();
      valLocalStatus.connected = true;
      valLocalStatus.accounts = Array.isArray(json.accounts) ? json.accounts : [];
    }catch(e){
      valLocalStatus.connected = false;
      valLocalStatus.accounts = [];
    }
    renderValLocalPanel();
  }

  function renderValLocalPanel(){
    const wrap = el('valLocalPanel'); if(!wrap) return;
    const credsWrap = el('valLocalCredsPanel');
    const unavailable = usingClaudeStorage || !supabaseConfigured;
    wrap.style.display = unavailable ? 'none' : 'block';
    if(credsWrap) credsWrap.style.display = unavailable ? 'none' : 'block';
    if(unavailable) return;

    let statusHtml;
    if(valLocalStatus.connected){
      const n = valLocalStatus.accounts.length;
      statusHtml = '<span class="val-local-dot on"></span> Local helper connected'
        + (n ? ' · '+n+' account'+(n===1?'':'s')+' saved' : ' · no accounts logged in yet — add one in Settings');
    } else {
      statusHtml = '<span class="val-local-dot off"></span> Local helper not running — run <code>node scripts/valorant-local-server.mjs</code> on this machine (see README.md)';
    }
    // shown in two places — a status-only note on the Valorant tab (account switcher lives there
    // too, since it just filters already-fetched data and works with or without the local helper)
    // and next to the actual Check Store Now / Delete / Add Account controls in Settings, since
    // those genuinely need the local helper running
    el('valLocalStatusTxt').innerHTML = statusHtml;
    const settingsStatusEl = el('valSettingsLocalStatusTxt');
    if(settingsStatusEl) settingsStatusEl.innerHTML = statusHtml;

    // union of accounts the local server has a saved session for, and accounts that already
    // have store data — so a device without the local server running (or an account it doesn't
    // know about yet) can still pick from and view whatever's already been checked
    const dropdownLabels = Array.from(new Set([...valLocalStatus.accounts, ...Object.keys(state.valorant.dailyStores||{}), ...Object.keys(state.valorant.ownedSkins||{})]));
    const sel = el('valLocalAccountSelect');
    sel.innerHTML = '<option value="">All accounts</option>'
      + dropdownLabels.map(a=>'<option value="'+escapeHtml(a)+'">'+escapeHtml(a)+'</option>').join('');
    sel.value = dropdownLabels.includes(state.valorant.selectedStoreLabel) ? state.valorant.selectedStoreLabel : '';

    const disabled = !valLocalStatus.connected || valLocalStatus.busy;
    el('valLocalCheckBtn').disabled = disabled || !valLocalStatus.accounts.length;
    el('valLocalCheckBtn').textContent = (valLocalStatus.busy && valLocalStatus.busyMsg==='check') ? 'Checking…' : 'Check Store Now';
    el('valLocalCheckInventoryBtn').disabled = disabled || !valLocalStatus.accounts.length;
    el('valLocalCheckInventoryBtn').textContent = (valLocalStatus.busy && valLocalStatus.busyMsg==='check-inventory') ? 'Checking…' : '🎨 Check Owned Skins';
    el('valLocalAddAccountBtn').disabled = disabled;
    el('valLocalAddAccountBtn').textContent = (valLocalStatus.busy && valLocalStatus.busyMsg==='login') ? 'Saving…' : '+ Add Account';
    // deleting removes the saved *session* (if any) and always clears any leftover
    // dailyStores/ownedSkins data for the label — so it's available for "stale" labels too
    // (a dailyStores-only entry left over after a session was already removed), just not for
    // "All accounts"
    el('valLocalDeleteBtn').disabled = disabled || !sel.value;
    el('valLocalDeleteBtn').textContent = (valLocalStatus.busy && valLocalStatus.busyMsg==='delete') ? 'Deleting…' : '🗑 Delete';
  }

  el('valLocalSaveTokenBtn').addEventListener('click', ()=>{
    state.valorant.localServerToken = el('valLocalToken').value.trim();
    save();
    pollValLocalStatus();
  });

  el('valLocalAccountSelect').addEventListener('change', ()=>{
    state.valorant.selectedStoreLabel = el('valLocalAccountSelect').value;
    save();
    renderValorantStore();
    renderValWishlist(); // wishlist is per-account, so it needs to follow the same switcher
    renderValOwnedSkins(); // ditto — owned skins are per account too
  });

  el('valLocalCheckBtn').addEventListener('click', async ()=>{
    el('valSettingsLocalErr').style.display = 'none';
    const label = el('valLocalAccountSelect').value;
    valLocalStatus.busy = true; valLocalStatus.busyMsg = 'check'; renderValLocalPanel();
    try{
      const res = await fetch(valLocalUrl()+'/check', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ token: state.valorant.localServerToken, label: label || undefined })
      });
      const json = await res.json().catch(()=>null);
      if(!res.ok || !json || json.ok===false){
        const detail = json && json.results && Object.values(json.results).map(r=>r.error).filter(Boolean)[0];
        throw new Error((json && json.error) || detail || ('Check failed (HTTP '+res.status+').'));
      }
      await load(); // pulls the dailyStores the local server just wrote to Supabase and re-renders
    }catch(e){
      showValLocalErr((e && e.message) || 'Could not reach the local helper.');
    }
    valLocalStatus.busy = false; valLocalStatus.busyMsg = ''; renderValLocalPanel();
  });

  el('valLocalCheckInventoryBtn').addEventListener('click', async ()=>{
    el('valSettingsLocalErr').style.display = 'none';
    const label = el('valLocalAccountSelect').value;
    valLocalStatus.busy = true; valLocalStatus.busyMsg = 'check-inventory'; renderValLocalPanel();
    try{
      const res = await fetch(valLocalUrl()+'/check-inventory', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ token: state.valorant.localServerToken, label: label || undefined })
      });
      const json = await res.json().catch(()=>null);
      if(!res.ok || !json || json.ok===false){
        const detail = json && json.results && Object.values(json.results).map(r=>r.error).filter(Boolean)[0];
        throw new Error((json && json.error) || detail || ('Check failed (HTTP '+res.status+').'));
      }
      await load(); // pulls the ownedSkins the local server just wrote to Supabase and re-renders
    }catch(e){
      showValLocalErr((e && e.message) || 'Could not reach the local helper.');
    }
    valLocalStatus.busy = false; valLocalStatus.busyMsg = ''; renderValLocalPanel();
  });

  el('valLocalDeleteBtn').addEventListener('click', async ()=>{
    el('valSettingsLocalErr').style.display = 'none';
    const label = el('valLocalAccountSelect').value;
    if(!label) return; // button is disabled in this case, but guard anyway
    const hasSession = valLocalStatus.accounts.includes(label);
    const confirmMsg = hasSession
      ? 'Delete the saved session for "'+label+'"? You\'ll need to log in again and paste a fresh cookie to re-add it. This can\'t be undone.'
      : 'Remove "'+label+'" from the account list? It has no active local session — this just clears its leftover store/inventory data. This can\'t be undone.';
    if(!window.confirm(confirmMsg)) return;
    valLocalStatus.busy = true; valLocalStatus.busyMsg = 'delete'; renderValLocalPanel();
    try{
      const res = await fetch(valLocalUrl()+'/delete-account', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ token: state.valorant.localServerToken, label })
      });
      const json = await res.json().catch(()=>null);
      if(!res.ok || !json || json.ok===false) throw new Error((json && json.error) || ('Delete failed (HTTP '+res.status+').'));
      if(state.valorant.selectedStoreLabel === label){ state.valorant.selectedStoreLabel = ''; save(); }
      await load(); // drops the deleted account's dailyStores entry and re-renders
    }catch(e){
      showValLocalErr((e && e.message) || 'Could not reach the local helper.');
    }
    valLocalStatus.busy = false; valLocalStatus.busyMsg = '';
    await pollValLocalStatus();
  });

  el('valLocalAddAccountBtn').addEventListener('click', async ()=>{
    el('valSettingsLocalErr').style.display = 'none';
    const label = el('valLocalNewLabel').value.trim();
    const ssid = el('valLocalNewSsid').value.trim();
    if(!label){ showValLocalErr('Enter a label for this account, e.g. "main".', 'valSettingsLocalErr'); return; }
    if(!ssid){ showValLocalErr('Paste the ssid cookie value (see the note below) — log into playvalorant.com in your own browser first, then copy it from DevTools.', 'valSettingsLocalErr'); return; }
    valLocalStatus.busy = true; valLocalStatus.busyMsg = 'login'; renderValLocalPanel();
    try{
      const res = await fetch(valLocalUrl()+'/login', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ token: state.valorant.localServerToken, label, ssid })
      });
      const json = await res.json().catch(()=>null);
      if(!res.ok || !json || json.ok===false) throw new Error((json && json.error) || ('Login failed (HTTP '+res.status+').'));
      el('valLocalNewLabel').value = '';
      el('valLocalNewSsid').value = '';
    }catch(e){
      showValLocalErr((e && e.message) || 'Could not reach the local helper.', 'valSettingsLocalErr');
    }
    valLocalStatus.busy = false; valLocalStatus.busyMsg = '';
    await pollValLocalStatus();
  });

  if(!(usingClaudeStorage || !supabaseConfigured)){
    pollValLocalStatus();
    setInterval(pollValLocalStatus, 15000);
  }

  function renderValorant(){
    renderValSubtabs();
    renderValWishlist();
    renderValorantStore();
    renderValOwnedSkins();
    renderValLocalPanel();
    el('valApiBanner').style.display = state.valorant.apiKey ? 'none' : 'block';
    const listEl = el('valAccountList');
    const accounts = state.valorant.accounts;
    el('valAccountsEmpty').style.display = accounts.length ? 'none' : 'block';
    el('valToolbar').style.display = accounts.length > 1 ? 'flex' : 'none';
    el('valSortMode').value = state.valorant.sortMode;
    listEl.innerHTML = '';

    const manualOrder = state.valorant.sortMode === 'manual';

    // group accounts into subgroups (by acc.group), preserving the active sort order within each
    // group and the order groups were first seen; ungrouped accounts render with no header at all
    const groupsMap = {}; const groupOrder = [];
    sortedValorantAccounts().forEach(acc=>{
      if(acc.group===undefined) acc.group = '';
      const gkey = acc.group || '';
      if(!(gkey in groupsMap)){ groupsMap[gkey] = []; groupOrder.push(gkey); }
      groupsMap[gkey].push(acc);
    });

    groupOrder.forEach(gkey=>{
      if(gkey){
        const collapsed = !!valGroupCollapsed[gkey];
        const lbl = document.createElement('div'); lbl.className='finance-group-lbl checklist-group-header val-group-header';
        lbl.style.cursor = 'pointer';
        lbl.innerHTML = '<span class="wlg-chevron">'+(collapsed?'▶':'▼')+'</span> '+escapeHtml(gkey)+' <span style="font-weight:600;text-transform:none;letter-spacing:0;color:var(--faint);">('+groupsMap[gkey].length+')</span>';
        lbl.addEventListener('click', ()=>{ valGroupCollapsed[gkey] = !valGroupCollapsed[gkey]; renderValorant(); });
        listEl.appendChild(lbl);
        if(collapsed) return; // skip rendering this subgroup's accounts while minimized
      }
      groupsMap[gkey].forEach(acc=>{
      const card = document.createElement('div');
      card.className = 'val-account-card'
        + (state.valorant.selectedAccountId===acc.id ? ' selected' : '')
        + (' '+valRecentActivityClass(acc));
      card.dataset.accId = acc.id;
      const cur = acc.current;
      const updatedTxt = acc.lastFetched ? ('Updated '+valTimeAgo(acc.lastFetched)) : '';
      let bodyHtml = '';
      if(acc.error){
        bodyHtml = '<div class="val-err">'+escapeHtml(acc.error)+'</div>';
      } else if(cur){
        const color = valTierColor(cur.tierName);
        const rrPct = Math.max(0, Math.min(100, cur.rr));
        const changeCls = cur.lastChange > 0 ? 'up' : (cur.lastChange < 0 ? 'down' : '');
        const changeTxt = cur.lastChange > 0 ? ('+'+cur.lastChange) : String(cur.lastChange||0);
        const iconInfo = (valTierIconCache && cur.tierId!=null) ? valTierIconCache[cur.tierId] : null;
        const iconHtml = (iconInfo && iconInfo.large) ? '<img class="val-rank-icon" src="'+iconInfo.large+'" alt="'+escapeHtml(cur.tierName||'')+'">' : '';
        const recentCls = valRecentActivityClass(acc);
        const recentChip = recentCls ? '<span class="val-recent-chip '+(recentCls==='val-recent-up'?'up':'down')+'" title="RR changed on the last refreshed match">'+(recentCls==='val-recent-up'?'▲ Recent gain':'▼ Recent loss')+'</span>' : '';
        // if RR changed on the last refreshed match, start the fill bar at its pre-change width and
        // animate it up to the current width (plus a brief color pulse) instead of jumping straight there
        const prevPct = recentCls ? Math.max(0, Math.min(100, cur.rr - (cur.lastChange||0))) : rrPct;
        const fillAnimCls = recentCls ? (recentCls==='val-recent-up' ? ' val-rr-anim-up' : ' val-rr-anim-down') : '';
        const lastMatchTxt = valTimeAgo(valLastMatchTime(acc));
        bodyHtml = '<div class="val-account-body">'
          + '<span class="val-rank-cluster">' + iconHtml
          + '<span class="val-rank-badge" style="background:'+color+';">'+escapeHtml(cur.tierName||'Unranked')+'</span></span>'
          + recentChip
          + '<div class="val-rr-wrap"><div class="val-rr-top"><span>RR</span><b>'+cur.rr+' / 100</b></div>'
          + '<div class="val-rr-track"><div class="val-rr-fill'+fillAnimCls+'" style="width:'+prevPct+'%;background:'+color+';" data-target-pct="'+rrPct+'"></div></div></div>'
          + '<div class="val-card-stats">'
          + '<div class="val-stat-mini"><div class="num '+changeCls+'">'+changeTxt+'</div><div class="lbl">Last Game</div></div>'
          + '<div class="val-stat-mini"><div class="num">'+cur.elo+'</div><div class="lbl">Elo</div></div>'
          + '</div>'
          + '</div>'
          + ((lastMatchTxt || cur.peakTierName) ? '<div class="val-peak-note">'
              + (lastMatchTxt ? 'Last match '+escapeHtml(lastMatchTxt) : '')
              + (lastMatchTxt && cur.peakTierName ? ' · ' : '')
              + (cur.peakTierName ? 'Peak this act: '+escapeHtml(cur.peakTierName) : '')
              + '</div>' : '');
      } else {
        bodyHtml = '<div class="val-peak-note">Not fetched yet — click refresh to pull current rank.</div>';
      }
      const agentInfo = (acc.lastAgent && valAgentCache) ? valAgentCache[acc.lastAgent.toLowerCase()] : null;
      const agentBgHtml = (agentInfo && agentInfo.background)
        ? '<div class="val-agent-bg" style="background-image:url(\''+agentInfo.background+'\');" title="Last played: '+escapeHtml(agentInfo.name)+'"></div>' : '';
      card.innerHTML = agentBgHtml + '<div class="val-account-top">'
        + '<span class="val-drag-handle'+(manualOrder?' active':'')+'" draggable="'+manualOrder+'" title="Drag to reorder">⠿</span>'
        + '<div class="val-card-id">'
        + '<span class="val-riotid" title="'+escapeHtml(acc.name)+'#'+escapeHtml(acc.tag)+'">'+escapeHtml(acc.name)+'<span class="val-tag">#'+escapeHtml(acc.tag)+'</span></span>'
        + '<span class="val-region-chip">'+escapeHtml(VAL_REGION_LABELS[acc.region]||acc.region)+' · '+escapeHtml(acc.platform)+(updatedTxt?' · '+escapeHtml(updatedTxt):'')+'</span>'
        + '<span class="val-group-field"><input type="text" class="mini-input val-group-input" placeholder="Subgroup…" maxlength="40" value="'+escapeHtml(acc.group||'')+'" title="Organize this account into a subgroup"></span>'
        + '</div>'
        + '<span class="val-acc-actions">'
        + '<button class="val-icon-btn'+(acc.loading?' spinning':'')+'" data-refresh="'+acc.id+'" title="Refresh rank">⟳</button>'
        + '<button class="val-icon-btn" data-del="'+acc.id+'" title="Remove account">✕</button>'
        + '</span></div>' + bodyHtml;
      listEl.appendChild(card);
      }); // end groupsMap[gkey].forEach
    }); // end groupOrder.forEach

    // trigger the RR fill bars to animate from their pre-change width to the current width —
    // double rAF so the browser paints the starting width first before the transition kicks in
    requestAnimationFrame(()=>{
      requestAnimationFrame(()=>{
        listEl.querySelectorAll('.val-rr-fill[data-target-pct]').forEach(fillEl=>{
          fillEl.style.width = fillEl.dataset.targetPct+'%';
        });
      });
    });

    // clicking anywhere on the card (outside the drag handle / action buttons) selects that
    // account and scrolls the RR History graph above into view for it
    listEl.querySelectorAll('.val-account-card').forEach(card=>{
      card.addEventListener('click', (e)=>{
        if(e.target.closest('.val-acc-actions') || e.target.closest('.val-drag-handle') || e.target.closest('.val-group-field')) return;
        state.valorant.selectedAccountId = card.dataset.accId;
        save(); renderValorant();
        const chartCard = el('valChartCard');
        if(chartCard && chartCard.style.display !== 'none') chartCard.scrollIntoView({behavior:'smooth', block:'start'});
      });
    });
    listEl.querySelectorAll('[data-refresh]').forEach(x=>{
      x.addEventListener('click', (e)=>{ e.stopPropagation(); fetchValorantAccount(x.dataset.refresh); });
    });
    listEl.querySelectorAll('[data-del]').forEach(x=>{
      x.addEventListener('click', (e)=>{
        e.stopPropagation();
        const id = x.dataset.del;
        state.valorant.accounts = state.valorant.accounts.filter(a=>a.id!==id);
        if(state.valorant.selectedAccountId===id){
          state.valorant.selectedAccountId = state.valorant.accounts.length ? state.valorant.accounts[0].id : null;
        }
        save(); renderValorant();
      });
    });
    listEl.querySelectorAll('.val-group-input').forEach(inp=>{
      inp.addEventListener('click', e=> e.stopPropagation());
      inp.addEventListener('change', ()=>{
        const id = inp.closest('.val-account-card').dataset.accId;
        const acc2 = state.valorant.accounts.find(x=>x.id===id);
        if(acc2){ acc2.group = inp.value.trim(); save(); renderValorant(); }
      });
    });

    renderValorantChartSelector();
    renderValorantChart();
  }

  function renderValorantChartSelector(){
    const row = el('valChartAccountRow');
    const accounts = state.valorant.accounts;
    if(!accounts.length){
      row.style.display = 'none';
      el('valChartLbl').style.display = 'none';
      el('valChartCard').style.display = 'none';
      return;
    }
    if(!state.valorant.selectedAccountId || !accounts.find(a=>a.id===state.valorant.selectedAccountId)){
      state.valorant.selectedAccountId = accounts[0].id;
    }
    el('valChartLbl').style.display = 'block';
    el('valChartCard').style.display = 'block';
    row.style.display = accounts.length > 1 ? 'flex' : 'none';
    row.innerHTML = accounts.map(a=>
      '<button class="chart-zoom-btn'+(state.valorant.selectedAccountId===a.id?' active':'')+'" data-acc="'+a.id+'">'+escapeHtml(a.name)+'#'+escapeHtml(a.tag)+'</button>'
    ).join('');
    row.querySelectorAll('[data-acc]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        state.valorant.selectedAccountId = btn.dataset.acc;
        save(); renderValorant();
      });
    });
  }

  // RR history is per-match, not per-day, so "zoom" narrows to the N most recent matches
  // rather than a calendar range — more useful when matches are played in bursts.
  const VAL_CHART_ZOOMS = [
    {key:'10', label:'Last 10', count:10},
    {key:'25', label:'Last 25', count:25},
    {key:'50', label:'Last 50', count:50},
    {key:'all', label:'All', count:null}
  ];
  let valChartZoom = 'all'; // not persisted — resets to a sensible default each page load

  function renderValorantChart(){
    const wrap = el('valChartWrap');
    const accounts = state.valorant.accounts;
    const zoomRow = el('valChartZoomRow');
    const legendEl = el('valChartLegend');
    if(!accounts.length){ wrap.innerHTML=''; zoomRow.style.display='none'; return; }
    const acc = accounts.find(a=>a.id===state.valorant.selectedAccountId) || accounts[0];
    const fullHist = (acc.history||[]).filter(h=> typeof h.rr === 'number');
    if(fullHist.length < 2){
      wrap.innerHTML = '<div class="empty" style="border:none;padding:28px 10px;">Not enough match history yet for '+escapeHtml(acc.name)+' — refresh after a competitive match to build the graph.</div>';
      zoomRow.style.display = 'none';
      return;
    }

    zoomRow.style.display = 'flex';
    zoomRow.innerHTML = VAL_CHART_ZOOMS.map(z=>
      '<button class="chart-zoom-btn'+(valChartZoom===z.key?' active':'')+'" data-vzoom="'+z.key+'">'+z.label+'</button>'
    ).join('');
    zoomRow.querySelectorAll('[data-vzoom]').forEach(btn=>{
      btn.addEventListener('click', ()=>{ valChartZoom = btn.dataset.vzoom; renderValorantChart(); });
    });

    const zoomOpt = VAL_CHART_ZOOMS.find(z=>z.key===valChartZoom) || VAL_CHART_ZOOMS[3];
    const hist = zoomOpt.count ? fullHist.slice(-zoomOpt.count) : fullHist;
    if(hist.length < 2){
      wrap.innerHTML = '<div class="empty" style="border:none;padding:28px 10px;">Not enough matches in this range — try a wider zoom.</div>';
      return;
    }

    // Raw RR resets to a low number every time a tier is gained (e.g. Platinum 2 @ 88 RR ->
    // Platinum 3 @ 10 RR), which made rank-ups look like drops on the old chart. Riot's tier IDs
    // increase by exactly 1 per sub-tier, so combining tierId*100 + RR gives one continuous,
    // monotonic "rank power" scale: a promotion always moves the line up, a demotion always
    // moves it down, matching what actually happened to the player's rank.
    const tierIdOf = h => (typeof h.tierId === 'number' ? h.tierId : null);
    let lastKnownTierId = 0;
    const valOf = h => {
      const tid = tierIdOf(h);
      if(tid != null) lastKnownTierId = tid;
      return lastKnownTierId * 100 + (typeof h.rr === 'number' ? h.rr : 0);
    };
    // map tierId -> tier name, used to label the y-axis in rank terms instead of a raw number
    const tierIdToName = {};
    hist.forEach(h=>{ const tid = tierIdOf(h); if(tid != null && h.tier) tierIdToName[tid] = h.tier; });
    if(acc.current && typeof acc.current.tierId === 'number' && acc.current.tierName) tierIdToName[acc.current.tierId] = acc.current.tierName;

    const W = 780, H = 250, padL = 46, padR = 14, padT = 26, padB = 26;
    const vals = hist.map(valOf);
    // Y-axis is dynamic rather than hard-clamped to 0-100: Radiant accounts can carry RR well
    // past 100 (Riot's "combined rating" used to separate Radiant players), so capping at 100
    // used to flatten/crop those graphs. We still never go below 0.
    let minV = Math.max(0, Math.min(...vals) - 5);
    let maxV = Math.max(...vals) + 5;
    if(minV >= maxV){ minV = 0; maxV = 100; }
    const xOf = i => padL + (hist.length===1 ? 0 : (i/(hist.length-1)) * (W-padL-padR));
    const yOf = v => padT + (1-(v-minV)/(maxV-minV)) * (H-padT-padB);

    // background bands: one colored strip per 100-unit tier segment on the y-axis, tinted with
    // that tier's color, so it's immediately obvious which rank band each part of the line sits
    // in — not just from the on-line labels, but as a constant visual backdrop.
    function valTierBandsSvg(){
      const tidLo = Math.floor(minV/100);
      const tidHi = Math.floor((maxV - 0.0001)/100);
      let svg = '';
      for(let tid=tidLo; tid<=tidHi; tid++){
        const bandLo = Math.max(minV, tid*100);
        const bandHi = Math.min(maxV, (tid+1)*100);
        if(bandHi <= bandLo) continue;
        const name = tierIdToName[tid];
        if(!name) continue; // unknown tier in this range — leave it as plain background rather than guessing
        const yTop = yOf(bandHi), yBot = yOf(bandLo);
        svg += '<rect x="'+padL+'" y="'+yTop.toFixed(1)+'" width="'+(W-padL-padR)+'" height="'+(yBot-yTop).toFixed(1)+'" fill="'+hexToRgba(valTierColor(name), 0.13)+'"/>';
      }
      return svg;
    }
    const bandsSvg = valTierBandsSvg();

    // Color each line segment by the rank tier of its destination point, so the line visually
    // tracks rank changes (e.g. a climb into Diamond turns the line diamond-blue) instead of a flat color.
    let lineSvg = '';
    for(let i=1;i<hist.length;i++){
      const segColor = valTierColor(hist[i].tier || hist[i-1].tier);
      lineSvg += '<line x1="'+xOf(i-1).toFixed(1)+'" y1="'+yOf(vals[i-1]).toFixed(1)+'" x2="'+xOf(i).toFixed(1)+'" y2="'+yOf(vals[i]).toFixed(1)+'" stroke="'+segColor+'" stroke-width="2.5" stroke-linecap="round"/>';
    }
    const dotsSvg = hist.map((h,i)=>
      '<circle cx="'+xOf(i).toFixed(1)+'" cy="'+yOf(vals[i]).toFixed(1)+'" r="3.5" fill="'+valTierColor(h.tier)+'" stroke="var(--surface)" stroke-width="1"><title>'+escapeHtml(h.tier||'')+' — '+h.rr+' RR</title></circle>'
    ).join('');

    // Visible tier labels: rather than relying on hover-only tooltips, show the rank icon
    // directly on the chart at the first point and at every point where the tier actually
    // changes from the previous one (e.g. climbing from "Gold 2" into "Gold 3"). Falls back to
    // the tier name as text if the icon hasn't been fetched/cached yet.
    let tierLabelSvg = '';
    const tierLabelSize = 20;
    hist.forEach((h,i)=>{
      const isFirst = i===0;
      const changed = i>0 && h.tier && h.tier !== hist[i-1].tier;
      if((isFirst && h.tier) || changed){
        const y = yOf(vals[i]);
        const above = y > padT + 14;
        const iconInfo = (valTierIconCache && h.tierId!=null) ? valTierIconCache[h.tierId] : null;
        const iconUrl = iconInfo && (iconInfo.small || iconInfo.large);
        if(iconUrl){
          const iy = above ? y - 9 - tierLabelSize : y + 8;
          const ix = xOf(i) - tierLabelSize/2;
          tierLabelSvg += '<image href="'+iconUrl+'" x="'+ix.toFixed(1)+'" y="'+iy.toFixed(1)+'" width="'+tierLabelSize+'" height="'+tierLabelSize+'"><title>'+escapeHtml(h.tier||'')+'</title></image>';
        } else {
          const ly = above ? y - 9 : y + 16;
          tierLabelSvg += '<text class="val-tier-label" x="'+xOf(i).toFixed(1)+'" y="'+ly.toFixed(1)+'" text-anchor="middle" fill="'+valTierColor(h.tier)+'">'+escapeHtml(h.tier)+'</text>';
        }
      }
    });

    // y-axis gridline labels: express each line in "tier name + RR-in-tier" terms rather than a
    // raw combined number, since the combined value itself has no meaning to the player.
    function combinedLabel(v){
      const tid = Math.floor(v/100);
      const rrPart = Math.max(0, Math.min(99, Math.round(v - tid*100)));
      const name = tierIdToName[tid];
      return name ? (name+' · '+rrPart) : String(Math.round(v));
    }
    let gridSvg = '';
    const steps = 4;
    for(let i=0;i<=steps;i++){
      const v = minV + (maxV-minV)*(i/steps);
      const y = yOf(v);
      gridSvg += '<line x1="'+padL+'" y1="'+y.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+y.toFixed(1)+'" stroke="var(--border)" stroke-width="1"/>';
      gridSvg += '<text x="'+(padL-8)+'" y="'+(y+3).toFixed(1)+'" font-size="9.5" fill="var(--muted)" text-anchor="end">'+escapeHtml(combinedLabel(v))+'</text>';
    }
    const labelIdxs = [0, Math.floor((hist.length-1)/2), hist.length-1];
    let xLabelSvg = '';
    labelIdxs.forEach(i=>{
      xLabelSvg += '<text x="'+xOf(i).toFixed(1)+'" y="'+(H-6)+'" font-size="10" fill="var(--muted)" text-anchor="middle">'+escapeHtml(fmtDate(new Date(hist[i].date).getTime()))+'</text>';
    });

    wrap.innerHTML = '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto;display:block;">'
      + bandsSvg
      + gridSvg + xLabelSvg
      + lineSvg
      + dotsSvg
      + tierLabelSvg
      + '</svg>';

    // legend: one chip per distinct rank tier that appears in the currently zoomed range
    const seenTiers = [];
    hist.forEach(h=>{ if(h.tier && !seenTiers.includes(h.tier)) seenTiers.push(h.tier); });
    legendEl.innerHTML = '<span><span class="dot" style="background:var(--violet);"></span>RR at match end (rank-adjusted)</span>'
      + seenTiers.map(t=>'<span><span class="dot" style="background:'+valTierColor(t)+';"></span>'+escapeHtml(t)+'</span>').join('');
  }

  function showValAddErr(msg){
    const e2 = el('valAddErr');
    e2.textContent = msg;
    e2.style.display = 'block';
  }

  el('valSaveKeyBtn').addEventListener('click', ()=>{
    state.valorant.apiKey = el('valApiKey').value.trim();
    save(); renderValorant();
  });

  el('valAddAccountBtn').addEventListener('click', ()=>{
    el('valAddErr').style.display = 'none';
    const raw = el('valNewRiotId').value.trim();
    const region = el('valNewRegion').value;
    const platform = el('valNewPlatform').value;
    if(!raw.includes('#')){ showValAddErr('Enter a Riot ID in the form Name#Tag, e.g. "Henrik3#VALO".'); return; }
    const hashIdx = raw.indexOf('#');
    const name = raw.slice(0, hashIdx).trim();
    const tag = raw.slice(hashIdx+1).trim();
    if(!name || !tag){ showValAddErr('Enter a Riot ID in the form Name#Tag, e.g. "Henrik3#VALO".'); return; }
    if(state.valorant.accounts.some(a=> a.name.toLowerCase()===name.toLowerCase() && a.tag.toLowerCase()===tag.toLowerCase() && a.region===region)){
      showValAddErr('That account is already being tracked.'); return;
    }
    const acc = { id: uid(), name, tag, region, platform, history: [], current: null, error: '', lastFetched: null, loading: false, group: '', lastAgent: '' };
    state.valorant.accounts.push(acc);
    state.valorant.selectedAccountId = acc.id;
    el('valNewRiotId').value = '';
    save(); renderValorant();
    fetchValorantAccount(acc.id);
  });
  el('valNewRiotId').addEventListener('keydown', e=>{ if(e.key==='Enter') el('valAddAccountBtn').click(); });

