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
          const entry = {
            name: a.displayName,
            icon: a.displayIcon,
            portrait: a.displayIconSmall || a.displayIcon,
            role: (a.role && a.role.displayName) || '',
            background: a.fullPortrait || a.background,
          };
          map[a.displayName.toLowerCase()] = entry;
          // Riot's live-match endpoints identify agents by CharacterID (a uuid), not by name, so
          // the same entries are keyed both ways off this one fetch — see valAgentByUuid().
          if(a.uuid) map[a.uuid.toLowerCase()] = entry;
        });
        valAgentCache = map;
        renderValorant();
        return map;
      })
      .catch(()=>{ valAgentCache = {}; return valAgentCache; });
    return valAgentPromise;
  }
  ensureValAgentIcons();
  function valAgentByUuid(uuid){
    return (uuid && valAgentCache) ? (valAgentCache[String(uuid).toLowerCase()] || null) : null;
  }

  // Map reference data (mapUrl -> {name, splash, icon}), for the Live Match panel's header. The
  // MapID the live-match endpoints return IS the mapUrl string, so it keys directly. Same
  // lazy-once-per-session shape as the tier/agent caches above.
  let valMapCache = null;
  let valMapPromise = null;
  function ensureValMapDb(){
    if(valMapCache) return Promise.resolve(valMapCache);
    if(valMapPromise) return valMapPromise;
    valMapPromise = fetch(VALORANT_API_BASE+'/maps')
      .then(r=>r.json())
      .then(json=>{
        const map = {};
        (json && Array.isArray(json.data) ? json.data : []).forEach(m=>{
          if(!m.mapUrl) return;
          map[m.mapUrl.toLowerCase()] = { name: m.displayName || '', splash: m.splash || '', icon: m.listViewIcon || '' };
        });
        valMapCache = map;
        renderValLive();
        return map;
      })
      .catch(()=>{ valMapCache = {}; return valMapCache; });
    return valMapPromise;
  }

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

  /* ---- Live Match / Shop Tracker / RR Tracker sub-tabs: the Valorant view got crowded once the
     store + wishlist card was added alongside rank tracking, so they're split into switchable
     panels instead of one long scroll. Live Match reads first because it's the only one that's
     time-sensitive — the others are just as useful five minutes from now. ---- */
  const VAL_SUBTABS = ['live','shop','rr'];
  function renderValSubtabs(){
    const active = VAL_SUBTABS.includes(state.valorant.activeSubtab) ? state.valorant.activeSubtab : 'shop';
    VAL_SUBTABS.forEach(key=>{
      const id = key === 'rr' ? 'RR' : (key.charAt(0).toUpperCase() + key.slice(1));
      el('valSubtabBtn'+id).classList.toggle('active', active === key);
      el('valSubtab'+id).style.display = active === key ? 'block' : 'none';
    });
  }
  el('valSubtabToggle').addEventListener('click', e=>{
    const btn = e.target.closest('[data-subtab]');
    if(!btn) return;
    state.valorant.activeSubtab = btn.dataset.subtab;
    save();
    renderValSubtabs();
    // the live poll loop only runs while its own panel is the one on screen; renderValLive()
    // ends by re-evaluating that (this is deliberately not called from renderValSubtabs(),
    // which runs once during load before the Live Match block below has initialized)
    renderValLive();
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
  // accounts whose last store check failed because the saved Riot session went stale — their store
  // is unknown rather than empty, so "no wishlist hits" would be misleading without a separate tick
  function valExpiredSessionLabels(){
    const stores = state.valorant.dailyStores || {};
    return Object.keys(stores).filter(label=>{
      const err = stores[label] && stores[label].error;
      return !!err && /expired/i.test(err);
    });
  }
  function updateValWishlistBadge(){
    // one wishlist entry can match two store items, so count wishlisted skins, not pairings
    const matches = valCurrentWishlistMatches();
    const hits = new Set(matches.map(m=>m.label+'::'+m.wishlistId)).size;
    const badge = el('valWishlistBadge');
    if(badge){
      badge.style.display = hits ? 'inline-flex' : 'none';
      badge.textContent = hits ? String(hits) : '';
      badge.title = hits===1 ? 'A wishlisted skin is in today\'s store'
                             : hits+' wishlisted skins are in today\'s store';
    }
    const stale = valExpiredSessionLabels();
    const warn = el('valStoreStaleBadge');
    if(warn){
      warn.style.display = stale.length ? 'inline-flex' : 'none';
      warn.title = 'Session expired — couldn\'t check today\'s store for: '+stale.join(', ');
    }
    // glow the nav shield too — the badge is tiny and shrinks into the icon in the collapsed nav
    const navItem = document.querySelector('.nav-item[data-tab="valorant"]');
    if(navItem) navItem.classList.toggle('wish-glow', hits>0);
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
      el('valWishlistToggle').setAttribute('aria-expanded', 'false');
      if(noAccEl) noAccEl.style.display = 'block';
      el('valWishlistCount').textContent = '';
      updateValWishlistBadge();
      return;
    }
    if(noAccEl) noAccEl.style.display = 'none';
    const wishlist = state.valorant.wishlist[label] || (state.valorant.wishlist[label] = []);
    const collapsed = !!state.valorant.wishlistCollapsed;
    bodyEl.style.display = collapsed ? 'none' : 'block';
    el('valWishlistToggle').setAttribute('aria-expanded', String(!collapsed));
    el('valWishlistChevron').textContent = collapsed ? '▶' : '▼';
    el('valWishlistCount').textContent = wishlist.length ? '('+wishlist.length+')' : '';
    el('valWishlistEmpty').style.display = wishlist.length ? 'none' : 'block';
    const matches = valCurrentWishlistMatches();
    // fixed-size rows (not variable-width pills) so a long skin name doesn't blow up its own
    // chip while a short one sits tiny next to it — name truncates with an ellipsis instead
    listEl.innerHTML = wishlist.map(w=>{
      const hit = matches.find(m=>m.wishlistId===w.id);
      return '<div class="val-wishlist-row'+(hit?' matched':'')+'" data-wish-id="'+w.id+'">'
        + (w.imageUrl ? '<img class="val-wishlist-row-img" alt="" data-img-src="'+escapeHtml(w.imageUrl)+'">' : '<span class="val-wishlist-row-img"></span>')
        + '<span class="val-wishlist-row-name" data-tile-title="'+escapeHtml(w.name)+'">'+escapeHtml(w.name)+'</span>'
        + (hit ? '<span class="val-wishlist-row-hit" title="In today\'s store"><span aria-hidden="true">✓</span></span>' : '')
        + '<button type="button" class="val-icon-btn" data-wish-del="'+w.id+'" data-tile-title="Remove '+escapeHtml(w.name)+' from wishlist"><span aria-hidden="true">✕</span></button>'
        + '</div>';
    }).join('');
    applyValTileTitles(listEl);
    listEl.querySelectorAll('[data-img-src]').forEach(img=>{ img.src = img.dataset.imgSrc; });
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
  // Accessory-shop tiles have no VP price band to infer a rarity color from (Kingdom Credit
  // offers aren't tiered), so they're colored by item type instead — enough to tell a spray from
  // a buddy at a glance without pretending the color means rarity.
  const VAL_ACCESSORY_TYPE_COLORS = { 'Spray':'#4BC6F0', 'Gun Buddy':'#F0954B', 'Player Card':'#8B7BF0', 'Player Title':'#2FBE7A', 'Skin':'#E058CF' };
  function valAccessoryTypeColor(type){ return VAL_ACCESSORY_TYPE_COLORS[type] || '#8B92A8'; }

  // The accessory shop rotates weekly, and `accessoriesRemainingSeconds` is a snapshot taken at
  // checkedAt — so the elapsed time since the check has to be subtracted, or a store checked two
  // days ago would still claim a week left. Returns '' when there's nothing meaningful to show.
  function valAccessoryTimeLeft(checkedAt, remainingSeconds){
    if(!remainingSeconds || !checkedAt) return '';
    const left = remainingSeconds - Math.floor((Date.now() - checkedAt)/1000);
    if(left <= 0) return 'rotated — re-check';
    const days = Math.floor(left/86400), hrs = Math.floor((left%86400)/3600), mins = Math.floor((left%3600)/60);
    if(days) return days+'d '+hrs+'h left';
    if(hrs) return hrs+'h '+mins+'m left';
    return mins+'m left';
  }

  function valStoreHeader(label, ds){
    const checkedHtml = ds.checkedAt
      ? '<span class="val-store-checked" title="'+escapeHtml(fmtDate(ds.checkedAt))+'">Checked '+escapeHtml(valTimeAgo(ds.checkedAt))+'</span>'
      : '';
    return '<div class="val-store-account-hdr"><span class="val-store-account-name">'+escapeHtml(label)+'</span>'+checkedHtml+'</div>';
  }
  // sub-header inside one account's section, separating the daily skins grid from the accessory
  // grid below it — smaller/lighter than the account header above so the account stays the
  // dominant heading
  function valStoreSectionHdr(name, note){
    return '<div class="val-store-section-hdr"><span class="val-store-section-name">'+escapeHtml(name)+'</span>'
      + (note ? '<span class="val-store-section-note">'+escapeHtml(note)+'</span>' : '')
      + '</div>';
  }

  /* ---- item preview modal: clicking any store / accessory / owned-skin tile opens that item's
     art at full size. The grid tiles cap art at 80px, which is enough to recognize a skin but not
     to actually look at one. Player cards get all three of valorant-api.com's crops side by side
     rather than one blown-up image — the tile only shows the wide banner, but the vertical art is
     what renders on your in-game profile, and neither crop can be derived from the other. ---- */
  function valPreviewVariantHtml(caption, url, cls){
    if(!url) return '';
    return '<figure class="val-preview-variant '+cls+'">'
      + '<div class="val-preview-variant-img"><img src="'+escapeHtml(url)+'" alt="'+escapeHtml(caption)+'"></div>'
      + '<figcaption>'+escapeHtml(caption)+'</figcaption>'
      + '</figure>';
  }

  // `view` is a normalized { name, subtitle, color, imageUrl, text, art } — daily skins, accessory
  // offers, and owned skins all carry different fields, so each click handler below maps its own
  // item into this shape rather than this function having to know which list it came from.
  let valPreviewReturnFocus = null; // element to hand focus back to when the preview closes
  function openValItemPreview(view){
    const body = el('valItemPreviewBody');
    const art = view.art || null;
    let artHtml;
    if(art && (art.wide || art.large || art.small)){
      artHtml = '<div class="val-preview-variants">'
        + valPreviewVariantHtml('Horizontal', art.wide, 'wide')
        + valPreviewVariantHtml('Vertical', art.large, 'tall')
        + valPreviewVariantHtml('Square', art.small, 'square')
        + '</div>';
    } else if(view.imageUrl){
      artHtml = '<div class="val-preview-hero"><img src="'+escapeHtml(view.imageUrl)+'" alt="'+escapeHtml(view.name)+'"></div>';
    } else {
      // player titles have no art of any kind — the tag text itself is the whole item
      artHtml = '<div class="val-preview-hero val-preview-hero-text">'+escapeHtml(view.text || view.name)+'</div>';
    }
    body.innerHTML = '<div class="val-preview-head">'
      + '<div class="val-preview-titles">'
      + '<div class="val-preview-name">'+escapeHtml(view.name)+'</div>'
      + (view.subtitle ? '<div class="val-preview-sub">'+escapeHtml(view.subtitle)+'</div>' : '')
      + '</div>'
      + '<button class="val-preview-close" type="button" title="Close">✕</button>'
      + '</div>'
      + artHtml;
    body.style.setProperty('--rarity-color', view.color || '#8B92A8');
    body.querySelector('.val-preview-close').addEventListener('click', closeValItemPreview);
    el('valItemPreviewOverlay').style.display = 'flex';
    // remember where focus came from so closing puts it back on the tile — otherwise a keyboard
    // user lands at the top of the document and has to tab all the way back into the grid
    valPreviewReturnFocus = document.activeElement;
    body.querySelector('.val-preview-close').focus();
  }
  function closeValItemPreview(){
    el('valItemPreviewOverlay').style.display = 'none';
    if(valPreviewReturnFocus && document.contains(valPreviewReturnFocus)) valPreviewReturnFocus.focus();
    valPreviewReturnFocus = null;
  }
  el('valItemPreviewOverlay').addEventListener('click', e=>{
    if(e.target === el('valItemPreviewOverlay')) closeValItemPreview();
  });
  document.addEventListener('keydown', e=>{
    if(e.key === 'Escape' && el('valItemPreviewOverlay').style.display === 'flex') closeValItemPreview();
  });

  // Tiles are rebuilt wholesale by innerHTML on every render, so the click handlers are delegated
  // to the (never-replaced) container elements and look their item back up by uuid — binding per
  // tile wouldn't survive a re-render.
  el('valStoreCard').addEventListener('click', e=>{
    const tile = e.target.closest('[data-preview-kind]');
    if(!tile) return;
    const ds = (state.valorant.dailyStores||{})[tile.dataset.previewLabel] || {};
    const uuid = tile.dataset.previewUuid;
    if(tile.dataset.previewKind === 'skin'){
      const it = (ds.items||[]).find(x=>x.uuid===uuid);
      if(!it) return;
      const rarity = valSkinRarityInfo(it.price);
      openValItemPreview({
        name: it.name,
        subtitle: rarity.name+' Edition · '+(parseInt(it.price,10)||0).toLocaleString()+' VP',
        color: rarity.color,
        imageUrl: it.imageUrl,
      });
    } else {
      const ac = (ds.accessories||[]).find(x=>x.uuid===uuid);
      if(!ac) return;
      openValItemPreview({
        name: ac.name,
        subtitle: (ac.type||'Accessory')+' · '+(parseInt(ac.price,10)||0).toLocaleString()+' KC',
        color: valAccessoryTypeColor(ac.type),
        imageUrl: ac.imageUrl,
        text: ac.text,
        art: ac.art,
      });
    }
  });
  el('valOwnedSkinsList').addEventListener('click', e=>{
    const tile = e.target.closest('[data-preview-kind]');
    if(!tile) return;
    const os = (state.valorant.ownedSkins||{})[tile.dataset.previewLabel] || {};
    const s = (os.skins||[]).find(x=>x.uuid===tile.dataset.previewUuid);
    if(!s) return;
    openValItemPreview({
      name: s.name,
      subtitle: [s.weaponType, tierDisplayName(s.tierName)].filter(Boolean).join(' · '),
      color: valSkinTierColor(s.tierName),
      imageUrl: s.imageUrl,
    });
  });

  // Skins / Accessories switch above the store — the two shops are separate rotations (daily VP
  // vs weekly Kingdom Credits) and rendering both at once made the store column crowded, so only
  // the selected one is built. Persisted, so the tab reopens on whichever shop you last looked at.
  function renderValStoreModeToggle(){
    const accessories = state.valorant.storeMode === 'accessories';
    el('valStoreModeBtnSkins').classList.toggle('active', !accessories);
    el('valStoreModeBtnAccessories').classList.toggle('active', accessories);
  }
  el('valStoreModeToggle').addEventListener('click', e=>{
    const btn = e.target.closest('[data-storemode]');
    if(!btn) return;
    state.valorant.storeMode = btn.dataset.storemode;
    save(); renderValStoreModeToggle(); renderValorantStore();
  });

  function renderValorantStore(){
    const wrap = el('valStoreCard'); if(!wrap) return;
    const unavailable = usingClaudeStorage || !supabaseConfigured;
    el('valStoreUnavailable').style.display = unavailable ? 'block' : 'none';
    if(unavailable){ wrap.innerHTML = ''; el('valStoreModeToggle').style.display = 'none'; return; }
    renderValStoreModeToggle();
    const showAccessories = state.valorant.storeMode === 'accessories';

    const stores = state.valorant.dailyStores || {};
    const allLabels = Object.keys(stores);
    // nothing to switch between until at least one account has been checked
    el('valStoreModeToggle').style.display = allLabels.length ? 'inline-flex' : 'none';
    if(!allLabels.length){
      wrap.innerHTML = '<div class="empty val-store-empty">No store data yet — run <code>scripts/valorant-login.mjs</code> then <code>scripts/valorant-check-store.mjs</code> locally (see README.md "Setup").</div>';
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
        return '<div class="val-store-account val-store-account-error">'+hdrHtml+'<div class="val-err"><span aria-hidden="true">⚠</span> '+escapeHtml(ds.error)+'</div></div>';
      }
      if(!ds.checkedAt){
        return '<div class="val-store-account val-store-account-empty">'+hdrHtml+'<div class="val-peak-note">No store data yet — run scripts/valorant-check-store.mjs locally (see README.md "Setup").</div></div>';
      }
      // Only one of the two shops is on screen at a time (see the Skins/Accessories toggle above
      // the store) — stacking both grids per account made the column too crowded to scan.
      let html;
      if(showAccessories){
        // accessory shop (Kingdom Credits — sprays/buddies/cards/titles, weekly rotation). Absent
        // from stores checked before this was added, so an older dailyStores entry has nothing to
        // show here until its next check fills this in.
        const accessories = ds.accessories || [];
        if(!accessories.length){
          html = '<div class="val-peak-note">No accessory offers in this store check — re-run scripts/valorant-check-store.mjs locally (checks from before accessory support don\'t include them).</div>';
        } else {
          // the section header is where the weekly rotation countdown lives, so it stays even
          // though the toggle above already names the shop
          html = valStoreSectionHdr('Accessories', valAccessoryTimeLeft(ds.checkedAt, ds.accessoriesRemainingSeconds));
          html += '<div class="val-store-grid val-accessory-grid">';
          accessories.forEach(ac=>{
            const color = valAccessoryTypeColor(ac.type);
            const title = ac.name + (ac.type ? ' — ' + ac.type : '') + ' — click to enlarge';
            html += '<button type="button" class="val-store-item val-accessory-item" style="--rarity-color:'+color+';"'
              + ' data-preview-kind="accessory" data-preview-label="'+escapeHtml(label)+'" data-preview-uuid="'+escapeHtml(ac.uuid||'')+'"'
              + ' data-tile-title="'+escapeHtml(title)+'">'
              + '<span class="val-accessory-type" style="background:'+color+';">'+escapeHtml(ac.type||'Accessory')+'</span>'
              + '<span class="val-store-item-img">'
              + (ac.imageUrl
                  ? '<img src="'+escapeHtml(ac.imageUrl)+'" alt="'+escapeHtml(ac.name)+'">'
                  // player titles have no art at all — show the actual in-game tag text instead
                  : '<span class="val-accessory-text">'+escapeHtml(ac.text || ac.name)+'</span>')
              + '</span>'
              + '<span class="val-store-item-footer">'
              + '<span class="val-store-item-name">'+escapeHtml(ac.name)+'</span>'
              + '<span class="val-store-item-price kc" title="Kingdom Credits">'+(parseInt(ac.price,10)||0).toLocaleString()+'</span>'
              + '</div></button>';
          });
          html += '</div>';
        }
      } else {
        const items = ds.items || [];
        html = '<div class="val-store-grid">';
        items.forEach(it=>{
          const isWish = valWishlistMatchesForItem(it.name, label).length > 0;
          const rarity = valSkinRarityInfo(it.price);
          html += '<button type="button" class="val-store-item'+(isWish?' wishlist-match':'')+'" style="--rarity-color:'+rarity.color+';"'
            + ' data-preview-kind="skin" data-preview-label="'+escapeHtml(label)+'" data-preview-uuid="'+escapeHtml(it.uuid||'')+'"'
            + ' data-tile-title="'+escapeHtml(it.name+' — '+rarity.name+' Edition — click to enlarge')+'">'
            + (isWish ? '<span class="val-store-item-wish-badge" title="On your wishlist"><span aria-hidden="true">★</span></span>' : '')
            + '<span class="val-store-item-img">'+(it.imageUrl ? '<img src="'+escapeHtml(it.imageUrl)+'" alt="">' : '')+'</span>'
            + '<span class="val-store-item-footer">'
            + '<span class="val-store-item-name">'+escapeHtml(it.name)+'</span>'
            + '<span class="val-store-item-price" title="Valorant Points">'+(parseInt(it.price,10)||0).toLocaleString()+'</span>'
            + '</span></button>';
        });
        html += '</div>';
      }
      return '<div class="val-store-account">'+hdrHtml+html+'</div>';
    }).join('');
    applyValTileTitles(wrap);
  }

  // Tooltip text is carried as data-tile-title and applied as a property here rather than being
  // interpolated into a title="…" attribute above: escapeHtml() intentionally leaves double quotes
  // alone, so a skin name containing one would otherwise escape its own attribute.
  function applyValTileTitles(root){
    root.querySelectorAll('[data-tile-title]').forEach(tileEl=>{
      tileEl.title = tileEl.dataset.tileTitle;
      // only buttons get an accessible name from this — aria-label on a plain <span> is ignored
      if(tileEl.tagName === 'BUTTON') tileEl.setAttribute('aria-label', tileEl.dataset.tileTitle);
    });
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
    el('valOwnedSkinsToggle').setAttribute('aria-expanded', String(!collapsed));
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
      errEl.innerHTML = '<span aria-hidden="true">⚠</span> '+escapeHtml(os.error);
      checkedEl.style.display = 'none';
      el('valOwnedSkinsCount').textContent = '';
      return;
    }

    checkedEl.style.display = os.checkedAt ? 'inline' : 'none';
    if(os.checkedAt) checkedEl.innerHTML = 'Checked '+escapeHtml(valTimeAgo(os.checkedAt));
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
      return '<button type="button" class="val-store-item" style="--rarity-color:'+color+';"'
        + ' data-preview-kind="owned" data-preview-label="'+escapeHtml(label)+'" data-preview-uuid="'+escapeHtml(s.uuid||'')+'"'
        + ' data-tile-title="'+escapeHtml(s.name+(sub?' — '+sub:'')+' — click to enlarge')+'">'
        + '<span class="val-store-item-img">'+(s.imageUrl ? '<img src="'+escapeHtml(s.imageUrl)+'" alt="">' : '')+'</span>'
        + '<span class="val-store-item-footer">'
        + '<span class="val-store-item-name">'+escapeHtml(s.name)+'</span>'
        + '</span></button>';
    }).join('');
    applyValTileTitles(listEl);
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
    // the helper appearing/disappearing is what starts or stops the live poll loop
    renderValLive();
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

  /* ================= LIVE MATCH =================
     The lobby you're in right now: who's on your team, who you're against, their ranks, who
     queued together, and — in competitive — whether they're on an agent they actually play.

     Read from scripts/valorant-local-server.mjs's POST /live on this machine. NOTHING here is
     persisted: state.valorant.live holds preferences only, and the lobby itself lives in that
     server's memory (see README.md, "Live Match"). Don't add a save() of the roster — it would
     re-upload the whole shared blob every few seconds to store data that's wrong by then.

     All display strings and art come from the valorant-api.com caches above, keyed by the bare
     uuids the server sends. That's deliberate: escapeHtml() doesn't escape double quotes, and
     these Riot IDs are attacker-controlled text typed by strangers, so no server-supplied string
     is ever interpolated into an attribute — tooltips go through data-tile-title and
     applyValTileTitles(), and rows are addressed by an index we generate. ---- */

  let valLiveState = {
    status: 'idle',   // idle | offline | searching | in-match | error | stopped
    data: null, err: '', code: '',
    timer: null, epoch: 0, backoff: 0, inFlight: false,
  };
  const VAL_LIVE_BACKOFF = [8000, 15000, 30000, 60000];

  const VAL_COMFORT_META = {
    main:        { glyph:'★', label:'Main',        cls:'main' },
    comfort:     { glyph:'●', label:'Comfort',     cls:'comfort' },
    situational: { glyph:'○', label:'Situational', cls:'situational' },
    'off-agent': { glyph:'▲', label:'Off-agent',   cls:'off-agent' },
    unknown:     { glyph:'?', label:'Unknown',     cls:'unknown' },
  };

  function valLiveUnavailable(){ return usingClaudeStorage || !supabaseConfigured; }

  // Which saved session to watch. '' means auto — the server works out which account is actually
  // in a game (see getLiveMatchAuto() in valorant-live.mjs) rather than asking you to remember
  // which one you logged into, which is the whole point of the panel. Deliberately does NOT
  // follow the Shop Tracker's account switcher: that one picks which store you're *browsing*,
  // which has nothing to do with which account is playing right now.
  function valLiveLabel(){
    const accounts = valLocalStatus.accounts || [];
    const pref = state.valorant.live.label;
    return (pref && accounts.includes(pref)) ? pref : '';
  }

  function valTierInfo(tier){
    return (valTierIconCache && tier != null) ? (valTierIconCache[tier] || null) : null;
  }
  function valTierLabel(tier){
    if(tier == null) return 'Unknown';
    if(!tier) return 'Unranked';
    const info = valTierInfo(tier);
    return (info && info.name) ? info.name : ('Tier ' + tier);
  }

  /* ---- polling ----------------------------------------------------------------
     setTimeout rather than setInterval because the right cadence depends on what's on screen:
     hunting for a match is cheap and slow, agent select changes every few seconds, and a settled
     live roster needs almost nothing (the server memoizes it against the match id, so a poll
     costs one small presence request to Riot). */
  function valLiveInterval(){
    if(valLiveState.err) return VAL_LIVE_BACKOFF[Math.min(valLiveState.backoff, VAL_LIVE_BACKOFF.length-1)];
    const d = valLiveState.data;
    if(!d || d.phase === 'none') return 8000;
    if(d.phase === 'pregame') return 4000;
    // a finished match is just being kept on screen — the only reason to keep asking is to
    // notice the next game, except while Riot still hasn't published the scoreboard
    if(d.phase === 'ended') return (d.final && d.final.state === 'pending') ? 5000 : 10000;
    const s = d.stages || {};
    const loading = s.ranks === 'loading' || s.stats === 'loading' || s.parties === 'loading';
    return loading ? 3000 : 15000;
  }

  function stopValLivePolling(){
    if(valLiveState.timer){ clearTimeout(valLiveState.timer); valLiveState.timer = null; }
    valLiveState.epoch++;   // any reply still in flight is from a previous state; discard it
  }

  // The single choke point. Everything that could change whether polling should be running calls
  // this rather than starting/stopping timers itself.
  function syncValLivePolling(){
    const shouldRun = !valLiveUnavailable()
      && state.valorant.live.enabled
      && state.valorant.activeSubtab === 'live'
      && !document.hidden
      && valLocalStatus.connected
      && !!state.valorant.localServerToken
      && valLiveState.status !== 'stopped';
    if(shouldRun){
      if(!valLiveState.timer && !valLiveState.inFlight) valLiveTick();
    } else if(valLiveState.timer){
      stopValLivePolling();
    }
  }

  async function valLiveTick(){
    if(valLiveState.inFlight) return;
    const epoch = valLiveState.epoch;
    valLiveState.inFlight = true;
    if(valLiveState.timer){ clearTimeout(valLiveState.timer); valLiveState.timer = null; }
    try{
      const res = await fetch(valLocalUrl()+'/live', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          token: state.valorant.localServerToken,
          label: valLiveLabel() || undefined,
          region: state.valorant.live.regionOverride || undefined,
          depth: state.valorant.live.historyDepth,
          enemyStats: state.valorant.live.showEnemyStats,
        })
      });
      const json = await res.json().catch(()=>null);
      if(epoch !== valLiveState.epoch) return;   // state changed under us; this reply is stale

      if(res.status === 401){
        valLiveState.status = 'stopped';
        valLiveState.err = 'The local helper rejected the token. Paste the one it printed into Settings → Valorant Local Helper.';
        valLiveState.code = 'bad_token';
      } else if(!json){
        throw new Error('The local helper sent something unreadable.');
      } else if(json.ok === false){
        valLiveState.code = json.code || '';
        valLiveState.err = json.error || 'The local helper could not read the lobby.';
        // a dead session or a missing account won't fix itself — retrying every few seconds
        // would just be pointless Riot traffic
        valLiveState.status = (json.code === 'session_expired' || json.code === 'no_session') ? 'stopped' : 'error';
        if(valLiveState.status === 'error') valLiveState.backoff++;
      } else {
        valLiveState.data = json;
        valLiveState.err = ''; valLiveState.code = ''; valLiveState.backoff = 0;
        valLiveState.status = json.phase === 'none' ? 'searching' : 'in-match';
        if(json.map && json.map.id) ensureValMapDb();
      }
    }catch(e){
      if(epoch !== valLiveState.epoch) return;
      valLiveState.status = 'error';
      valLiveState.err = (e && e.message) || 'Could not reach the local helper.';
      valLiveState.backoff++;
    }finally{
      valLiveState.inFlight = false;
    }
    if(epoch !== valLiveState.epoch) return;
    // schedule BEFORE repainting: renderValLive() ends in syncValLivePolling(), which starts a
    // tick whenever it sees no timer and nothing in flight — repainting first would therefore
    // fire the next request immediately and spin. Painting second also lets that same sync call
    // cancel the timer if the panel stopped being visible while this request was out.
    if(valLiveState.status !== 'stopped') valLiveState.timer = setTimeout(valLiveTick, valLiveInterval());
    renderValLive();
  }

  // Polling is pointless while the browser tab is in the background, and a loop hitting Riot from
  // a page nobody is looking at is exactly what this feature shouldn't do.
  document.addEventListener('visibilitychange', ()=>{
    if(document.hidden) stopValLivePolling(); else syncValLivePolling();
  });

  /* ---- render ---------------------------------------------------------------- */

  function valOrdinal(n){
    const s = ['th','st','nd','rd'], v = n % 100;
    return n + (s[(v-20)%10] || s[v] || s[0]);
  }

  function valLiveEloOf(p){
    const tier = p.tier || p.peakTier || 0;
    return tier * 1000 + Math.min(Math.max(p.rr || 0, 0), 999);
  }

  // Skeleton rather than a spinner: the roster paints in well under a second and the slow parts
  // fill in beside it, so the panel is readable the whole time instead of blank then complete.
  function valLiveSkel(w){ return '<span class="val-live-skel" style="width:'+w+'px;" aria-hidden="true"></span>'; }

  function valLiveRankCellHtml(p, stagesRanks){
    if(p.tier == null){
      if(stagesRanks === 'loading') return '<span class="val-live-rank">'+valLiveSkel(74)+'</span>';
      return '<span class="val-live-rank val-live-dim">—</span>';
    }
    const name = valTierLabel(p.tier);
    const info = valTierInfo(p.tier);
    const icon = (info && info.small) ? '<img class="val-live-rank-icon" src="'+info.small+'" alt="">' : '';
    return '<span class="val-live-rank">'+icon
      + '<span class="val-live-rank-txt"><b>'+escapeHtml(name)+'</b>'
      + (p.tier ? '<span class="val-live-rr">'+(p.rr||0)+' RR</span>' : '')
      + '</span></span>';
  }

  // Once a match is over the scoreboard replaces the comfort/elo column: what they *did* is
  // strictly more interesting than what they were likely to do, and it's the same slot so
  // nothing shifts when the result lands.
  function valLiveScoreCellHtml(row, final){
    if(!row){
      if(final && final.state === 'pending') return '<span class="val-live-comfort-cell">'+valLiveSkel(70)+'</span>';
      return '<span class="val-live-comfort-cell val-live-dim">—</span>';
    }
    const kd = row.deaths ? (row.kills / row.deaths) : row.kills;
    return '<span class="val-live-comfort-cell">'
      + '<span class="val-live-kda"><b>'+row.kills+'</b>/<b>'+row.deaths+'</b>/<b>'+row.assists+'</b></span>'
      + '<span class="val-live-kd '+(kd>=1?'up':'down')+'">'+kd.toFixed(2)+' K/D</span>'
      + '</span>';
  }

  function valLiveComfortCellHtml(p, stagesStats){
    if(!p.agentStats){
      if(stagesStats === 'loading') return '<span class="val-live-comfort-cell">'+valLiveSkel(96)+'</span>';
      return '<span class="val-live-comfort-cell val-live-dim">—</span>';
    }
    const s = p.agentStats;
    const meta = VAL_COMFORT_META[(p.comfort && p.comfort.label) || 'unknown'] || VAL_COMFORT_META.unknown;
    // colour is never the only signal — every chip carries its own glyph too
    let html = '<span class="val-live-comfort '+meta.cls+'"><span aria-hidden="true">'+meta.glyph+'</span>'+meta.label+'</span>';
    if(s.error){
      html += '<span class="val-live-wr val-live-dim">—</span>';
    } else if(!s.gamesOnAgent){
      html += '<span class="val-live-wr val-live-dim">0 of '+s.totalGames+'</span>';
    } else {
      const losses = s.gamesOnAgent - s.winsOnAgent;
      // a 1-0 rendered as "100%" is a lie the eye believes, so the percentage only appears once
      // there are enough games behind it to mean something
      let txt = s.winsOnAgent+'-'+losses;
      if(s.gamesOnAgent >= 3) txt += ' · ' + Math.round(s.winsOnAgent / s.gamesOnAgent * 100) + '%';
      html += '<span class="val-live-wr">'+txt+'</span>';
      // "62% on Jett" only means something next to "48% overall"
      if(s.totalGames >= 6 && s.gamesOnAgent >= 3){
        const agentPct = Math.round(s.winsOnAgent / s.gamesOnAgent * 100);
        const overallPct = Math.round(s.overallWins / s.totalGames * 100);
        const delta = agentPct - overallPct;
        if(delta !== 0){
          html += '<span class="val-live-delta '+(delta>0?'up':'down')+'">'
            + '<span aria-hidden="true">'+(delta>0?'▲':'▼')+'</span>'+Math.abs(delta)+'%</span>';
        }
      }
    }
    return '<span class="val-live-comfort-cell">'+html+'</span>';
  }

  function valLivePlayerRowHtml(p, idx, snap){
    const agent = valAgentByUuid(p.agentUuid);
    const stages = snap.stages || {};
    const tierColor = valTierColor(valTierLabel(p.tier));

    const agentHtml = p.agentUuid && agent
      ? '<img class="val-live-agent" src="'+(agent.portrait || agent.icon)+'" alt="">'
      : '<span class="val-live-agent val-live-agent-empty" aria-hidden="true">'+(p.agentLocked ? '' : '…')+'</span>';

    // incognito is a deliberate choice by that player; the rank and agent are shown either way,
    // and revealing the name is opt-in under Settings
    const showName = !p.incognito || state.valorant.live.showIncognito;
    const who = showName && p.name
      ? '<b>'+escapeHtml(p.name)+'</b><span class="val-live-tag">#'+escapeHtml(p.tag||'')+'</span>'
      : (p.incognito ? '<b class="val-live-dim">Incognito</b>' : '<b class="val-live-dim">'+(agent ? escapeHtml(agent.name) : 'Unknown')+'</b>');

    const partyHtml = p.party
      ? '<span class="val-live-stack'+(p.party.inferred?' inferred':'')+'" data-tile-title="'
        + escapeHtml(p.party.inferred
            ? 'Likely a '+p.party.size+'-stack — these players keep showing up in each other’s recent matches'
            : 'Queued together — party of '+p.party.size)
        + '">'+(p.party.inferred?'~':'')+escapeHtml(p.party.group)+p.party.size+'</span>'
      : '';

    const levelHtml = p.level ? '<span class="val-live-level">Lv '+p.level+'</span>' : '';
    const peakHtml = p.peakTier
      ? '<span class="val-live-peak">Peak '+escapeHtml(valTierLabel(p.peakTier))+(p.peakLegacy?'<span class="val-live-dagger" aria-hidden="true">†</span>':'')+'</span>'
      : '<span class="val-live-peak val-live-dim">—</span>';

    const ended = snap.phase === 'ended';
    const final = ended ? snap.final : null;
    const scoreRow = (final && final.rows) ? final.rows.find(r=> r.puuid === p.puuid) : null;

    let lastCell;
    if(ended) lastCell = valLiveScoreCellHtml(scoreRow, final);
    else if(snap.mode.teamBased) lastCell = valLiveComfortCellHtml(p, stages.stats);
    else lastCell = '<span class="val-live-comfort-cell"><span class="val-live-elo">'+(p.tier ? (p.tier*100 + Math.min(p.rr||0, 99)).toLocaleString() : '—')+'</span></span>';

    // the crown marks the highest *rank* in a live lobby; once the game is over the thing worth
    // marking is who actually finished on top, which is not usually the same player
    const isTop = !snap.mode.teamBased && (ended
      ? !!(scoreRow && scoreRow.place === 1)
      : !!(snap.lobby.highest && snap.lobby.highest.puuid === p.puuid));
    const placeHtml = (ended && scoreRow && scoreRow.place)
      ? '<span class="val-live-place'+(scoreRow.place<=3?' podium':'')+'">'+valOrdinal(scoreRow.place)+'</span>' : '';
    const detail = valLiveDetailHtml(p);

    return '<div class="val-live-player'+(p.isSelf?' is-self':'')+(isTop?' val-live-top':'')+(detail?' expandable':'')+'"'
      + ' style="--tier:'+tierColor+';" data-live-idx="'+idx+'">'
      + (isTop ? '<span class="val-live-crown" data-tile-title="'+escapeHtml(ended?'Finished top of the lobby':'Highest rank in this lobby')+'" aria-hidden="true">♛</span>' : '')
      + placeHtml
      + agentHtml
      + '<span class="val-live-ident">'+who+partyHtml+levelHtml+'</span>'
      + valLiveRankCellHtml(p, stages.ranks)
      + lastCell
      + peakHtml
      + detail
      + '</div>';
  }

  // The row-expand. The single most actionable thing about an off-agent player is what they
  // normally play, so their top agents in the same window sit one click away — along with the
  // season record the rank alone doesn't tell you. Returns '' when there'd be nothing to show,
  // which is also what makes the row expandable or not.
  function valLiveDetailHtml(p){
    const bits = [];
    const s = p.agentStats;
    if(s && !s.error && s.topAgents && s.topAgents.length){
      bits.push('<div class="val-live-detail-agents">'
        + s.topAgents.map(a=>{
            const info = valAgentByUuid(a.agentUuid);
            const wr = a.games >= 3 ? Math.round(a.wins / a.games * 100) + '%' : (a.wins + '-' + (a.games - a.wins));
            return '<span class="val-live-detail-agent'+(a.agentUuid === p.agentUuid ? ' current' : '')+'"'
              + ' data-tile-title="'+escapeHtml((info ? info.name : 'Unknown agent') + ' — ' + a.wins + ' of ' + a.games + ' won')+'">'
              + (info ? '<img src="'+(info.portrait || info.icon)+'" alt="">' : '')
              + '<span class="val-live-detail-agent-txt"><b>'+escapeHtml(info ? info.name : '?')+'</b>'
              + '<span>'+a.games+'g · '+wr+'</span></span></span>';
          }).join('')
        + '</div>');
    }
    const meta = [];
    if(p.seasonGames) meta.push('This act: '+p.seasonWins+'W of '+p.seasonGames+' games');
    if(p.leaderboardRank) meta.push('Leaderboard #'+p.leaderboardRank);
    if(s && s.partial) meta.push('Partial sample — not every recent match could be read');
    if(p.rankError === 'forbidden') meta.push('Riot wouldn’t share this player’s rank');
    if(meta.length) bits.push('<div class="val-live-detail-meta">'+escapeHtml(meta.join(' · '))+'</div>');
    return bits.length ? '<div class="val-live-detail">'+bits.join('')+'</div>' : '';
  }

  function valLiveTierTileHtml(title, floorTier, rr, sub){
    const info = valTierInfo(floorTier);
    const icon = (info && info.small) ? '<img class="val-live-stat-icon" src="'+info.small+'" alt="">' : '';
    const pct = Math.max(0, Math.min(100, rr));
    const color = valTierColor(valTierLabel(floorTier));
    return '<div class="val-live-stat" style="--tier:'+color+';">'
      + '<div class="val-live-stat-lbl">'+escapeHtml(title)+'</div>'
      + '<div class="val-live-stat-main">'+icon+'<b>'+escapeHtml(valTierLabel(floorTier))+'</b><span class="val-live-rr">'+rr+' RR</span></div>'
      + '<div class="val-live-stat-bar"><div class="val-live-stat-fill" style="width:'+pct+'%;"></div></div>'
      + '<div class="val-live-stat-sub">'+escapeHtml(sub)+'</div>'
      + '</div>';
  }

  function valLiveTeamHtml(snap, players, cls, title, teamAgg, finalTeam){
    const stacks = (snap.lobby.stacks||[]).filter(s=> players.some(p=> s.puuids.includes(p.puuid)));
    let sub = '';
    // rounds won leads the header once the game is over — the average rank mattered going in
    if(finalTeam) sub += finalTeam.roundsWon + (finalTeam.won ? ' · won' : '');
    if(teamAgg) sub += (sub?' · ':'') + valTierLabel(teamAgg.avgTierFloor) + ' avg';
    if(stacks.length){
      const bits = stacks.map(s=> (s.inferred?'likely ':'') + s.size + '-stack');
      const solo = players.length - stacks.reduce((n,s)=> n + s.size, 0);
      sub += (sub?' · ':'') + bits.join(' + ') + (solo>0 ? ' + '+solo+' solo' : '');
    }
    return '<div class="val-live-team '+cls+'">'
      + '<div class="val-live-team-hdr"><span>'+escapeHtml(title)+'</span>'
      + (sub ? '<span class="val-live-team-sub">'+escapeHtml(sub)+'</span>' : '')
      + '</div>'
      + players.map(p=> valLivePlayerRowHtml(p, snap.players.indexOf(p), snap)).join('')
      + '</div>';
  }

  // Every path that repaints the panel also re-decides whether the poll loop should be running —
  // the panel becoming visible (or the helper coming back) is exactly when it should start, and
  // there's no other place that reliably sees all of those transitions.
  function renderValLive(){
    renderValLiveBody();
    syncValLivePolling();
  }

  function renderValLiveBody(){
    const wrap = el('valLiveBody'); if(!wrap) return;
    const unavailable = valLiveUnavailable();
    el('valLiveUnavailable').style.display = unavailable ? 'block' : 'none';
    el('valLiveCard').style.display = unavailable ? 'none' : 'block';
    if(unavailable) return;

    el('valLiveAutoToggle').checked = !!state.valorant.live.enabled;

    // account picker only earns its space once there's more than one session to choose between,
    // and even then Auto is the default — pinning one is for when you want to watch a specific
    // account rather than whichever you happen to be playing
    const accounts = valLocalStatus.accounts || [];
    const sel = el('valLiveAccountSelect');
    sel.style.display = accounts.length > 1 ? '' : 'none';
    if(accounts.length > 1){
      sel.innerHTML = '<option value="">Auto — whichever is playing</option>'
        + accounts.map(a=> '<option value="'+escapeHtml(a)+'">'+escapeHtml(a)+'</option>').join('');
      sel.value = valLiveLabel();
    }

    const snap = valLiveState.data;
    const statusEl = el('valLiveStatusTxt');
    const errEl = el('valLiveErr');
    errEl.style.display = valLiveState.err ? 'block' : 'none';
    if(valLiveState.err) errEl.textContent = valLiveState.err;

    if(!valLocalStatus.connected){
      statusEl.innerHTML = '<span class="val-local-dot off"></span> Local helper not running — run <code>node scripts/valorant-local-server.mjs</code> on this machine';
      wrap.innerHTML = '<div class="val-live-empty">The live match panel reads your lobby from the local helper on this machine. Start it, then come back — see README.md.</div>';
      return;
    }
    if(!state.valorant.localServerToken){
      statusEl.innerHTML = '<span class="val-local-dot off"></span> No local helper token saved';
      wrap.innerHTML = '<div class="val-live-empty">Paste the token the local helper printed into <b>Settings → Valorant Local Helper</b> to let this page read your lobby.</div>';
      return;
    }

    const dot = (snap && (snap.phase === 'pregame' || snap.phase === 'coregame')) ? 'on'
      : (valLiveState.status === 'error' || valLiveState.status === 'stopped' ? 'off' : 'on');
    let statusTxt;
    if(valLiveState.status === 'stopped') statusTxt = 'Live tracking paused';
    else if(!state.valorant.live.enabled) statusTxt = 'Auto-refresh off';
    else if(snap && snap.phase === 'pregame') statusTxt = 'Agent Select';
    else if(snap && snap.phase === 'coregame') statusTxt = 'In Game';
    else if(snap && snap.phase === 'ended') statusTxt = 'Last match' + (snap.endedAt ? ' · ended '+valTimeAgo(snap.endedAt) : '');
    else if(snap && snap.auto && snap.auto.accounts.length > 1) statusTxt = 'Watching '+snap.auto.accounts.length+' accounts for a match…';
    else statusTxt = 'Watching for a match…';
    // when auto-detect picked the account, say which one — otherwise a lobby full of strangers
    // gives you no way to tell whether it found the right login
    const shownLabel = snap && snap.phase !== 'none' && snap.label ? snap.label : '';
    statusEl.innerHTML = '<span class="val-local-dot '+dot+'"></span> '+escapeHtml(statusTxt)
      + (shownLabel ? ' <span class="val-live-dim">· '+escapeHtml(shownLabel)+'</span>' : '')
      + (snap && snap.session && snap.session.region ? ' <span class="val-live-dim">· '+escapeHtml(String(snap.session.region).toUpperCase())+'</span>' : '');

    if(!snap || snap.phase === 'none'){
      wrap.innerHTML = '<div class="val-live-empty">'
        + (valLiveState.status === 'stopped'
            ? 'Fix the problem above, then hit ⟳ to start watching again.'
            : 'Not in a match. Start one and this fills in on its own — agent select included.')
        + '</div>';
      applyValTileTitles(wrap);
      return;
    }

    ensureValMapDb();
    const mapInfo = (valMapCache && snap.map && snap.map.id) ? valMapCache[String(snap.map.id).toLowerCase()] : null;
    const mapName = (mapInfo && mapInfo.name) || (String(snap.map.id||'').split('/').pop() || 'Unknown map');

    const stages = snap.stages || {};
    const lobby = snap.lobby || {};
    const ended = snap.phase === 'ended';
    const final = ended && snap.final && snap.final.state === 'done' ? snap.final : null;
    let html = '';

    // ---- summary strip
    html += '<div class="val-live-summary">';
    // the result leads once there is one — it's the thing you came back to the screen for
    if(ended){
      let main, sub, cls = '';
      if(final && snap.mode.teamBased){
        const scores = Object.keys(final.teams).map(k=> final.teams[k].roundsWon || 0).sort((a,b)=> b-a);
        main = final.myTeamWon == null ? 'Match over' : (final.myTeamWon ? 'Victory' : 'Defeat');
        cls = final.myTeamWon == null ? '' : (final.myTeamWon ? ' win' : ' loss');
        sub = scores.length >= 2 ? scores[0]+'–'+scores[1] : 'Final score unavailable';
      } else if(final && final.place){
        main = valOrdinal(final.place)+' of '+final.rows.length;
        cls = final.place === 1 ? ' win' : '';
        sub = 'Final placing';
      } else if(snap.final && snap.final.state === 'pending'){
        main = 'Match over'; sub = 'Waiting for Riot to publish the scoreboard…';
      } else {
        main = 'Match over'; sub = (snap.final && snap.final.note) || 'Scoreboard unavailable';
      }
      html += '<div class="val-live-stat val-live-result'+cls+'">'
        + '<div class="val-live-stat-lbl">Result</div>'
        + '<div class="val-live-stat-main"><b>'+escapeHtml(main)+'</b></div>'
        + '<div class="val-live-stat-sub">'+escapeHtml(sub)+'</div>'
        + '</div>';
    }
    if(lobby.rankedCount){
      const sub = lobby.rankedCount + ' of ' + snap.players.length + ' ranked'
        + (lobby.peakDerivedCount ? ' · ' + lobby.peakDerivedCount + ' from peak' : '');
      html += valLiveTierTileHtml('Lobby average', lobby.avgTierFloor, lobby.avgTierRr, sub);
      if(lobby.highest){
        const hi = snap.players.find(p=> p.puuid === lobby.highest.puuid);
        const hiName = hi && (!hi.incognito || state.valorant.live.showIncognito) && hi.name ? hi.name : 'Incognito';
        html += '<div class="val-live-stat" style="--tier:'+valTierColor(valTierLabel(lobby.highest.tier))+';">'
          + '<div class="val-live-stat-lbl">Highest rank</div>'
          + '<div class="val-live-stat-main"><span class="val-live-crown" aria-hidden="true">♛</span><b>'+escapeHtml(valTierLabel(lobby.highest.tier))+'</b><span class="val-live-rr">'+lobby.highest.rr+' RR</span></div>'
          + '<div class="val-live-stat-sub">'+escapeHtml(hiName)+(lobby.highest.fromPeak?' (peak)':'')+'</div>'
          + '</div>';
      }
    } else if(stages.ranks === 'loading'){
      html += '<div class="val-live-stat">'+valLiveSkel(150)+'</div>';
    }
    const phaseTxt = snap.phase === 'pregame' ? 'Agent Select' : (ended ? 'Finished '+valTimeAgo(snap.endedAt) : 'In Game');
    html += '<div class="val-live-stat">'
      + '<div class="val-live-stat-lbl">Match</div>'
      + '<div class="val-live-stat-main"><b>'+escapeHtml(snap.mode.label)+'</b></div>'
      + '<div class="val-live-stat-sub">'+escapeHtml(mapName + ' · ' + phaseTxt)+'</div>'
      + '</div>';
    html += '</div>';

    if(ended){
      html += '<div class="val-live-progress">Showing the match you just played — this stays until your next game starts.</div>';
    }

    if(stages.stats === 'loading' && stages.statsTotal){
      html += '<div class="val-live-progress">Reading recent matches — '+stages.statsDone+' of '+stages.statsTotal+' players done…</div>';
    } else if(stages.statsNote){
      html += '<div class="val-live-progress">'+escapeHtml(stages.statsNote)+'</div>';
    }

    // ---- roster. Sorting waits until the ranks land, otherwise rows jump under the pointer
    // halfway through a load.
    const sortable = stages.ranks !== 'loading' || !!final;
    // once there's a scoreboard it decides the order — that's what a standing is. Before that,
    // rank is the only thing worth ordering by.
    const finalBy = new Map((final ? final.rows : []).map(r=> [r.puuid, r]));
    const byRank = final
      ? (a,b)=>{
          const ra = finalBy.get(a.puuid), rb = finalBy.get(b.puuid);
          if(!snap.mode.teamBased) return (ra ? ra.place : 99) - (rb ? rb.place : 99);
          return (rb ? rb.score : -1) - (ra ? ra.score : -1);
        }
      : (a,b)=> valLiveEloOf(b) - valLiveEloOf(a);

    if(!snap.mode.teamBased){
      // deathmatch and friends: one leaderboard, highest rank first — the whole question here is
      // "who in this lobby is going to be a problem"
      const rows = sortable ? snap.players.slice().sort(byRank) : snap.players.slice();
      html += '<div class="val-live-teams">' + valLiveTeamHtml(snap, rows, 'flat', snap.mode.label + ' lobby', null) + '</div>';
    } else {
      const allies = snap.players.filter(p=> p.teamId === snap.me.teamId);
      const enemies = snap.players.filter(p=> p.teamId !== snap.me.teamId);
      if(sortable){ allies.sort(byRank); enemies.sort(byRank); }
      const ft = final ? final.teams : null;
      html += '<div class="val-live-teams">';
      html += valLiveTeamHtml(snap, allies, 'ally', 'Your team', lobby.teams && lobby.teams[snap.me.teamId], ft && ft[snap.me.teamId]);
      if(enemies.length){
        const enemyTeamId = enemies[0].teamId;
        html += valLiveTeamHtml(snap, enemies, 'enemy', 'Enemies', lobby.teams && lobby.teams[enemyTeamId], ft && ft[enemyTeamId]);
      } else if(snap.phase === 'pregame'){
        html += '<div class="val-live-team enemy"><div class="val-live-team-hdr"><span>Enemies</span></div>'
          + '<div class="val-live-empty">Riot doesn’t reveal the enemy team during agent select — they appear the moment the match starts.</div></div>';
      }
      html += '</div>';
    }

    wrap.innerHTML = html;
    applyValTileTitles(wrap);
  }

  /* ---- listeners: delegated to #valSubtabLive, which renderValLive() never replaces ---- */
  el('valSubtabLive').addEventListener('click', e=>{
    const row = e.target.closest('.val-live-player.expandable');
    if(row && el('valLiveBody').contains(row)) row.classList.toggle('expanded');
  });

  el('valLiveRefreshBtn').addEventListener('click', ()=>{
    valLiveState.status = 'idle'; valLiveState.err = ''; valLiveState.code = ''; valLiveState.backoff = 0;
    stopValLivePolling();
    renderValLive();
    syncValLivePolling();
  });

  el('valLiveAutoToggle').addEventListener('change', ()=>{
    state.valorant.live.enabled = el('valLiveAutoToggle').checked;
    save();
    if(state.valorant.live.enabled){ valLiveState.status = 'idle'; valLiveState.err = ''; valLiveState.backoff = 0; }
    stopValLivePolling();
    renderValLive();
    syncValLivePolling();
  });

  el('valLiveAccountSelect').addEventListener('change', ()=>{
    state.valorant.live.label = el('valLiveAccountSelect').value;
    save();
    valLiveState.data = null; valLiveState.status = 'idle'; valLiveState.err = ''; valLiveState.backoff = 0;
    stopValLivePolling();
    renderValLive();
    syncValLivePolling();
  });

  /* ---- Settings controls ---- */
  el('valLiveRegionSelect').addEventListener('change', ()=>{
    state.valorant.live.regionOverride = el('valLiveRegionSelect').value;
    save();
    valLiveState.data = null; valLiveState.status = 'idle'; valLiveState.err = ''; valLiveState.backoff = 0;
    stopValLivePolling(); syncValLivePolling();
  });
  el('valLiveDepthSelect').addEventListener('change', ()=>{
    state.valorant.live.historyDepth = parseInt(el('valLiveDepthSelect').value, 10) || 10;
    save();
  });
  el('valLiveEnemyStats').addEventListener('change', ()=>{
    state.valorant.live.showEnemyStats = el('valLiveEnemyStats').checked;
    save();
  });
  el('valLiveShowIncognito').addEventListener('change', ()=>{
    state.valorant.live.showIncognito = el('valLiveShowIncognito').checked;
    save();
    renderValLive();
  });

  /* The add form is always on screen, so Escape can't close it any more — it clears the field and
     whatever validation error is showing instead, which is the only thing left to undo. */
  el('valNewRiotId').addEventListener('keydown', e=>{
    if(e.key !== 'Escape') return;
    el('valNewRiotId').value = '';
    el('valAddErr').style.display = 'none';
  });

  function renderValorant(){
    renderValSubtabs();
    renderValWishlist();
    renderValorantStore();
    renderValOwnedSkins();
    renderValLocalPanel();
    renderValLive();
    // Live Match settings live over in the Settings view, so they're synced here rather than in
    // renderValLive() (which only owns the panel on the Valorant tab)
    el('valLiveRegionSelect').value = state.valorant.live.regionOverride || '';
    el('valLiveDepthSelect').value = String(state.valorant.live.historyDepth || 10);
    el('valLiveEnemyStats').checked = !!state.valorant.live.showEnemyStats;
    el('valLiveShowIncognito').checked = !!state.valorant.live.showIncognito;
    el('valApiBanner').style.display = state.valorant.apiKey ? 'none' : 'block';
    const keyStateEl = el('valApiKeyState');
    if(keyStateEl){
      keyStateEl.textContent = state.valorant.apiKey ? 'Key saved' : 'No key set — rank lookups will fail';
      keyStateEl.className = 'val-key-state' + (state.valorant.apiKey ? ' ok' : ' warn');
    }
    const listEl = el('valAccountList');
    const accounts = state.valorant.accounts;
    el('valAccountsEmpty').style.display = accounts.length ? 'none' : 'block';
    // Both toolbar controls act on the list, so neither means anything without accounts (and sort
    // needs more than one) — with both gone the strip itself would be an empty 12px gap.
    el('valSortGroup').style.display = accounts.length > 1 ? 'inline-flex' : 'none';
    el('valRefreshAllBtn').style.display = accounts.length ? '' : 'none';
    el('valToolbar').style.display = accounts.length ? 'flex' : 'none';
    el('valSortMode').value = state.valorant.sortMode;
    // rescue the chart panel before the wipe below — while a card is selected it lives inside the
    // grid, and innerHTML='' would destroy the element along with its zoom-button listeners
    el('valChartHome').appendChild(el('valChartCard'));
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
        const lbl = document.createElement('button');
        lbl.type = 'button';
        lbl.className='finance-group-lbl checklist-group-header val-group-header';
        lbl.setAttribute('aria-expanded', String(!collapsed));
        lbl.innerHTML = '<span class="wlg-chevron" aria-hidden="true">'+(collapsed?'▶':'▼')+'</span> '+escapeHtml(gkey)
          + ' <span class="val-group-count">('+groupsMap[gkey].length+')</span>';
        lbl.addEventListener('click', ()=>{ valGroupCollapsed[gkey] = !valGroupCollapsed[gkey]; renderValorant(); });
        listEl.appendChild(lbl);
        if(collapsed) return; // skip rendering this subgroup's accounts while minimized
      }
      groupsMap[gkey].forEach(acc=>{
      const card = document.createElement('div');
      const selected = state.valorant.selectedAccountId===acc.id;
      const recentCls = valRecentActivityClass(acc);
      // "expanded" is the same card, grown to the full grid width and holding the RR chart in
      // place of its own summary — there is no second card for the graph
      card.className = 'val-account-card'
        + (selected ? ' selected expanded' : '')
        + (recentCls ? ' '+recentCls : '');
      card.dataset.accId = acc.id;
      const cur = acc.current;
      const riotId = acc.name+'#'+acc.tag;
      const updatedTxt = acc.lastFetched ? ('updated '+valTimeAgo(acc.lastFetched)) : '';

      /* The collapsed card is one line of identity over one line of rank, ~57px tall, so a dozen
         accounts fit on a screen without scrolling. Everything that isn't "who is this and where
         are they now" — region, elo, peak, timestamps, the subgroup field — moves into the
         expanded state rather than costing height on every card. */
      let iconHtml = '<span class="val-rank-icon val-rank-icon-empty" aria-hidden="true"></span>';
      let statusHtml, metaHtml = '', barHtml = '', deltaHtml = '';
      if(acc.error){
        statusHtml = '<div class="val-card-status"><span class="val-card-err" role="alert">'
          + '<span aria-hidden="true">⚠</span> '+escapeHtml(acc.error)+'</span></div>';
      } else if(cur){
        // the tier color drives the whole card via one custom property — CSS derives a readable
        // text shade from it per theme (--tier-ink), so nothing paints a raw tier color onto text
        card.style.setProperty('--tier', valTierColor(cur.tierName));
        const rrPct = Math.max(0, Math.min(100, cur.rr));
        const changeCls = cur.lastChange > 0 ? 'up' : (cur.lastChange < 0 ? 'down' : 'flat');
        const changeTxt = cur.lastChange > 0 ? ('+'+cur.lastChange) : String(cur.lastChange||0);
        // never color alone: the arrow carries the same up/down meaning as the green/red
        const changeGlyph = cur.lastChange > 0 ? '▲' : (cur.lastChange < 0 ? '▼' : '–');
        const iconInfo = (valTierIconCache && cur.tierId!=null) ? valTierIconCache[cur.tierId] : null;
        // alt is empty on purpose — the tier name sits right beside the icon, so a label here
        // would just be read out twice
        if(iconInfo && iconInfo.large) iconHtml = '<img class="val-rank-icon" src="'+iconInfo.large+'" alt="">';
        // if RR changed on the last refreshed match, start the fill bar at its pre-change width and
        // animate it up to the current width (plus a brief color pulse) instead of jumping straight there
        const prevPct = recentCls ? Math.max(0, Math.min(100, cur.rr - (cur.lastChange||0))) : rrPct;
        const fillAnimCls = recentCls ? (recentCls==='val-recent-up' ? ' val-rr-anim-up' : ' val-rr-anim-down') : '';

        // the delta rides the name line, not the rank line: sharing a ~150px row with it forced
        // the tier name to truncate to "Immort…", and the tier name is the thing being monitored
        deltaHtml = '<span class="val-delta '+changeCls+'" data-delta-label="Last match: '+changeTxt+' RR">'
          + '<span aria-hidden="true">'+changeGlyph+'</span>'+escapeHtml(changeTxt)+'</span>';
        // Elo, not RR, is the figure on a collapsed card: RR resets to near zero on every
        // promotion, so across a list of accounts it doesn't rank or compare — elo is continuous.
        // RR is still one line away in the expanded meta, on the bar below, and in the tooltip.
        // Falls back to RR when elo is missing (unranked, or the API didn't return one).
        const figureHtml = cur.elo
          ? '<span class="val-card-figure"><b>'+cur.elo.toLocaleString()+'</b> elo</span>'
          : '<span class="val-card-figure"><b>'+cur.rr+'</b> RR</span>';
        statusHtml = '<div class="val-card-status">'
          + '<span class="val-tier-name">'+escapeHtml(cur.tierName||'Unranked')+'</span>'
          + figureHtml
          + '</div>';
        // hairline along the card's bottom edge rather than a row of its own — no height cost
        barHtml = '<div class="val-rr-track" role="img" data-rr-label="'+cur.rr+' of 100 RR">'
          + '<div class="val-rr-fill'+fillAnimCls+'" style="width:'+prevPct+'%;" data-target-pct="'+rrPct+'"></div></div>';

        if(selected){
          const metaBits = [ (VAL_REGION_LABELS[acc.region]||acc.region) + ' · ' + String(acc.platform||'').toUpperCase() ];
          // RR lives here now that elo has taken the collapsed card's figure slot — unless elo was
          // missing, in which case the line above is already showing RR
          if(cur.elo) metaBits.push(cur.rr+' RR');
          if(cur.peakTierName) metaBits.push('Peak '+cur.peakTierName);
          const lastMatchTxt = valTimeAgo(valLastMatchTime(acc));
          if(lastMatchTxt) metaBits.push('last match '+lastMatchTxt);
          if(updatedTxt) metaBits.push(updatedTxt);
          metaHtml = '<div class="val-meta">'+escapeHtml(metaBits.join(' · '))+'</div>';
        }
      } else {
        statusHtml = '<div class="val-card-status"><span class="val-card-idle">Not fetched yet — hit ⟳</span></div>';
      }
      const agentInfo = (acc.lastAgent && valAgentCache) ? valAgentCache[acc.lastAgent.toLowerCase()] : null;
      const agentBgHtml = (agentInfo && agentInfo.background)
        ? '<div class="val-agent-bg" data-agent-name="'+escapeHtml(agentInfo.name)+'" aria-hidden="true"></div>' : '';
      card.innerHTML = agentBgHtml + '<div class="val-account-top">'
        + '<span class="val-drag-handle'+(manualOrder?' active':'')+'" draggable="'+manualOrder+'" title="Drag to reorder" aria-hidden="true">⠿</span>'
        + iconHtml
        + '<div class="val-card-id">'
        + '<div class="val-card-name-row">'
        // a real button so the expand/collapse this card drives is reachable by keyboard; the
        // click still bubbles to the card handler below
        + '<button type="button" class="val-riotid" data-select="'+acc.id+'" aria-expanded="'+selected+'">'
        + escapeHtml(acc.name)+'<span class="val-tag">#'+escapeHtml(acc.tag)+'</span></button>'
        + deltaHtml
        + '</div>'
        + statusHtml
        + '</div>'
        + '<span class="val-acc-actions">'
        + '<button type="button" class="val-icon-btn'+(acc.loading?' spinning':'')+'" data-refresh="'+acc.id+'">'
        + '<span aria-hidden="true">⟳</span></button>'
        + '<button type="button" class="val-icon-btn val-icon-btn-danger" data-del="'+acc.id+'">'
        + '<span aria-hidden="true">✕</span></button>'
        + '</span></div>'
        + barHtml
        + (selected
            ? metaHtml
              + '<div class="val-card-chart"></div>'
              + '<div class="val-group-field"><input type="text" class="mini-input val-group-input" placeholder="Subgroup…" maxlength="40"></div>'
            : '');

      // Everything user-supplied (Riot IDs, agent names, subgroups) is assigned as a property
      // rather than interpolated into an attribute above — escapeHtml() deliberately leaves double
      // quotes alone, so a name containing one would otherwise break out of its attribute.
      const nameBtn = card.querySelector('.val-riotid');
      nameBtn.title = selected ? riotId+' — collapse RR history' : riotId+' — show RR history';
      // a collapsed card carries no subgroup field; the full detail only exists when expanded
      const groupInput = card.querySelector('.val-group-input');
      if(groupInput){
        groupInput.value = acc.group||'';
        groupInput.title = 'Organize this account into a subgroup';
        groupInput.setAttribute('aria-label', 'Subgroup for '+riotId);
      }
      // the collapsed card truncates its status line, so the full text lives on the card itself
      card.title = acc.error ? riotId+' — '+acc.error
        : (cur ? riotId+' — '+(cur.tierName||'Unranked')+', '+cur.rr+' RR'
                 + (cur.elo ? ', '+cur.elo.toLocaleString()+' elo' : '')
          : riotId+' — not fetched yet');
      card.querySelector('[data-refresh]').setAttribute('aria-label', 'Refresh rank for '+riotId);
      card.querySelector('[data-refresh]').title = 'Refresh rank';
      card.querySelector('[data-del]').setAttribute('aria-label', 'Remove '+riotId);
      card.querySelector('[data-del]').title = 'Remove account';
      const agentEl = card.querySelector('.val-agent-bg');
      if(agentEl && agentInfo){
        agentEl.style.backgroundImage = 'url("'+agentInfo.background.replace(/"/g,'%22')+'")';
        agentEl.title = 'Last played: '+agentInfo.name;
      }
      const deltaEl = card.querySelector('.val-delta');
      if(deltaEl){
        deltaEl.setAttribute('aria-label', deltaEl.dataset.deltaLabel);
        deltaEl.title = deltaEl.dataset.deltaLabel;
      }
      const trackEl = card.querySelector('.val-rr-track');
      if(trackEl) trackEl.setAttribute('aria-label', trackEl.dataset.rrLabel);

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

    // Clicking a card turns it into its own RR history; clicking it again turns it back.
    // The chart now lives *inside* the card, so .val-chart-panel has to be excluded too —
    // otherwise picking a zoom range or dragging across the plot would collapse the card
    // out from under the pointer.
    listEl.querySelectorAll('.val-account-card').forEach(card=>{
      card.addEventListener('click', (e)=>{
        if(e.target.closest('.val-acc-actions') || e.target.closest('.val-drag-handle')
           || e.target.closest('.val-group-field') || e.target.closest('.val-chart-panel')) return;
        state.valorant.selectedAccountId =
          (state.valorant.selectedAccountId === card.dataset.accId) ? null : card.dataset.accId;
        save(); renderValorant();
      });
    });
    listEl.querySelectorAll('[data-refresh]').forEach(x=>{
      x.addEventListener('click', (e)=>{ e.stopPropagation(); fetchValorantAccount(x.dataset.refresh); });
    });
    listEl.querySelectorAll('[data-del]').forEach(x=>{
      x.addEventListener('click', (e)=>{
        e.stopPropagation();
        const id = x.dataset.del;
        // the slim card puts a 26px delete button next to a 26px refresh button, so a mis-tap is
        // cheap to make and impossible to undo — the tracked history for that account is gone
        const victim = state.valorant.accounts.find(a=>a.id===id);
        if(victim && !window.confirm('Stop tracking '+victim.name+'#'+victim.tag+'? Its stored RR history will be lost.')) return;
        state.valorant.accounts = state.valorant.accounts.filter(a=>a.id!==id);
        // close the panel rather than sliding it onto an unrelated account
        if(state.valorant.selectedAccountId===id) state.valorant.selectedAccountId = null;
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

    mountValChartPanel(listEl);
    renderValorantChart();
  }

  // How many columns the account grid is currently showing. A laid-out grid reports its used
  // track sizes here ("228px 228px …"); a grid inside a display:none view instead reports the
  // authored repeat(auto-fill, …) string, which is the signal that no measurement is possible yet
  // — the ResizeObserver below re-runs this once the view is actually shown.
  function valGridColumnCount(listEl){
    const tpl = getComputedStyle(listEl).gridTemplateColumns;
    if(!tpl || tpl === 'none' || /[a-z]+\(/i.test(tpl)) return 1;
    return Math.max(1, tpl.trim().split(/\s+/).length);
  }

  /* The selected card *becomes* the chart: it spans the full grid width and holds the RR history
     in place of its own summary. Because a full-width item can't share a row with the cards around
     it, the browser would otherwise push it onto the next row and leave a hole in the one above —
     so the card is first moved to sit just past the last complete row of its neighbours.

     Grouped cards are handled per subgroup, since a subgroup header spans every column and so
     always starts a fresh row. */
  function mountValChartPanel(listEl){
    const panel = el('valChartCard');
    const selId = state.valorant.selectedAccountId;
    const card = selId
      ? Array.from(listEl.querySelectorAll('.val-account-card')).find(c=>c.dataset.accId===selId)
      : null;
    if(!card){
      panel.style.display = 'none';
      el('valChartHome').appendChild(panel);
      return;
    }

    const cols = valGridColumnCount(listEl);
    const segments = []; let cur = [];
    Array.from(listEl.children).forEach(ch=>{
      if(ch.classList.contains('val-group-header')){ if(cur.length) segments.push(cur); cur = []; }
      else if(ch.classList.contains('val-account-card')) cur.push(ch);
    });
    if(cur.length) segments.push(cur);
    const seg = segments.find(s=> s.indexOf(card) >= 0);
    if(seg && seg.length > 1){
      const k = seg.indexOf(card);
      const rest = seg.filter(c=> c !== card);
      const segEnd = seg[seg.length-1].nextSibling; // captured before the move
      // round up to a whole number of rows, so the cards before it always fill their rows exactly
      const at = Math.min(rest.length, Math.ceil(k/cols)*cols);
      const ref = at < rest.length ? rest[at] : segEnd;
      if(ref !== card) listEl.insertBefore(card, ref);
    }

    card.querySelector('.val-card-chart').appendChild(panel);
    panel.style.display = 'block';
  }

  el('valChartCloseBtn').addEventListener('click', ()=>{
    state.valorant.selectedAccountId = null;
    save(); renderValorant();
  });

  /* The chart now sits inside the account card, whose click handler toggles the card shut — so no
     click inside the chart may reach it. Testing e.target against .val-chart-panel in that handler
     is not enough on its own: a zoom button rebuilds the zoom row from its own click handler, so by
     the time the event bubbles up, e.target has been detached from the document and closest() walks
     a parentless node. Stopping at the panel is independent of what the target did to itself.
     The panel element itself is never replaced, so this binds once. */
  el('valChartCard').addEventListener('click', e=> e.stopPropagation());

  /* Both the panel's row position and the chart's geometry depend on the grid's rendered width,
     and neither is knowable while the tab is hidden — every offsetTop reads 0 in a display:none
     view, which would park the panel at the end of the list instead of under its card. Watching
     the list itself covers all three cases that matter: the window resizing, the nav collapsing,
     and this view being shown for the first time.

     Width only: inserting the panel changes the list's *height*, so reacting to height as well
     would have the observer retrigger itself. */
  let valLastListWidth = 0;
  let valResizeTimer = null;
  if(typeof ResizeObserver === 'function'){
    new ResizeObserver(entries=>{
      const w = Math.round(entries[0].contentRect.width);
      if(!w || w === valLastListWidth) return;
      valLastListWidth = w;
      if(!state.valorant || !state.valorant.selectedAccountId) return;
      clearTimeout(valResizeTimer);
      valResizeTimer = setTimeout(()=>{
        const listEl2 = el('valAccountList');
        if(!listEl2.querySelector('.val-account-card')) return;
        mountValChartPanel(listEl2);
        renderValorantChart();
      }, 120);
    }).observe(valAccountListEl);
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
  let chartGradId = 0; // keeps each render's area-gradient id unique rather than reusing one name

  function renderValorantChart(){
    const wrap = el('valChartWrap');
    const accounts = state.valorant.accounts;
    const zoomRow = el('valChartZoomRow');
    const statsEl = el('valChartStats');
    const acc = accounts.find(a=>a.id===state.valorant.selectedAccountId);
    if(!acc){ wrap.innerHTML=''; zoomRow.style.display='none'; statsEl.innerHTML=''; return; }
    const fullHist = (acc.history||[]).filter(h=> typeof h.rr === 'number');
    if(fullHist.length < 2){
      wrap.innerHTML = '<div class="val-chart-empty">Not enough match history yet — refresh after a competitive match to start building the graph.</div>';
      zoomRow.style.display = 'none';
      statsEl.innerHTML = '';
      return;
    }

    zoomRow.style.display = 'flex';
    zoomRow.innerHTML = VAL_CHART_ZOOMS.map(z=>
      '<button type="button" class="chart-zoom-btn'+(valChartZoom===z.key?' active':'')+'"'
      + (valChartZoom===z.key?' aria-pressed="true"':'')+' data-vzoom="'+z.key+'">'+z.label+'</button>'
    ).join('');
    zoomRow.querySelectorAll('[data-vzoom]').forEach(btn=>{
      btn.addEventListener('click', ()=>{ valChartZoom = btn.dataset.vzoom; renderValorantChart(); });
    });

    const zoomOpt = VAL_CHART_ZOOMS.find(z=>z.key===valChartZoom) || VAL_CHART_ZOOMS[3];
    const hist = zoomOpt.count ? fullHist.slice(-zoomOpt.count) : fullHist;
    if(hist.length < 2){
      wrap.innerHTML = '<div class="val-chart-empty">Only one match in this range — try a wider zoom.</div>';
      statsEl.innerHTML = '';
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

    // Drawn at the container's real pixel width so one viewBox unit is one CSS pixel. The old
    // fixed 780-unit viewBox was scaled to fit, which shrank every label along with it — on a
    // phone the axis text was rendering around 5px.
    const W = Math.max(300, Math.round(wrap.clientWidth) || 720);
    const narrow = W < 520;
    // height tracks width so a full-width card doesn't get a 1200×250 letterbox that flattens
    // every RR swing into a near-horizontal line
    const H = Math.round(Math.max(190, Math.min(300, W * 0.26)));
    const padL = 12, padR = 14, padT = 26, padB = 26;
    const vals = hist.map(valOf);
    // Y-axis is dynamic rather than hard-clamped to 0-100: Radiant accounts can carry RR well
    // past 100 (Riot's "combined rating" used to separate Radiant players), so capping at 100
    // used to flatten/crop those graphs. We still never go below 0.
    const rawSpan = Math.max(20, Math.max(...vals) - Math.min(...vals));
    let minV = Math.max(0, Math.min(...vals) - rawSpan*0.14);
    let maxV = Math.max(...vals) + rawSpan*0.14;
    if(minV >= maxV){ minV = 0; maxV = 100; }
    const xOf = i => padL + (hist.length===1 ? 0 : (i/(hist.length-1)) * (W-padL-padR));
    const yOf = v => padT + (1-(v-minV)/(maxV-minV)) * (H-padT-padB);
    const plotBottom = H - padB;

    // express a combined value in "tier name + RR-in-tier" terms — the combined number itself
    // means nothing to a player
    function combinedLabel(v){
      const tid = Math.floor(v/100);
      const rrPart = Math.max(0, Math.min(99, Math.round(v - tid*100)));
      const name = tierIdToName[tid];
      return name ? (name+' · '+rrPart) : String(Math.round(v));
    }

    /* Y axis is the tier boundaries themselves — a dashed rule wherever a tier begins, labelled
       with the tier it opens. The old chart filled every band with a translucent tint, which meant
       tier color was being said five ways at once (bands + line + dots + icons + legend) and the
       line had to fight its own background. One thin rule carries the same information. */
    let gridSvg = '';
    let boundaries = 0;
    for(let tid=Math.ceil(minV/100); tid<=Math.floor(maxV/100); tid++){
      const name = tierIdToName[tid];
      if(!name) continue; // unknown tier — don't guess a label for it
      const y = yOf(tid*100);
      const c = valTierColor(name);
      gridSvg += '<line x1="'+padL+'" y1="'+y.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+y.toFixed(1)+'" stroke="'+hexToRgba(c,0.5)+'" stroke-width="1" stroke-dasharray="3 4"/>';
      gridSvg += '<text class="val-chart-tierlbl" x="'+(padL+3)+'" y="'+(y-5).toFixed(1)+'" fill="'+c+'">'+escapeHtml(name)+'</text>';
      boundaries++;
    }
    // the whole range can sit inside one tier (no boundary crossed), which would leave the plot
    // with no horizontal reference at all — fall back to two neutral rules labelled in RR
    if(boundaries < 1){
      [1/3, 2/3].forEach(f=>{
        const v = minV + (maxV-minV)*f;
        const y = yOf(v);
        gridSvg += '<line x1="'+padL+'" y1="'+y.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+y.toFixed(1)+'" stroke="var(--border)" stroke-width="1" stroke-dasharray="3 4"/>';
        gridSvg += '<text class="val-chart-tierlbl" x="'+(padL+3)+'" y="'+(y-5).toFixed(1)+'" fill="var(--muted)">'+escapeHtml(combinedLabel(v))+'</text>';
      });
    }

    // the line as one path, plus a soft area beneath it tinted with the tier the account ended the
    // range in — gives the line weight without another layer of color competing with it
    let linePath = '';
    hist.forEach((h,i)=>{ linePath += (i?'L':'M') + xOf(i).toFixed(1)+' '+yOf(vals[i]).toFixed(1)+' '; });
    const endColor = valTierColor(hist[hist.length-1].tier || (acc.current && acc.current.tierName));
    const areaSvg = '<path d="'+linePath+'L'+xOf(hist.length-1).toFixed(1)+' '+plotBottom+' L'+xOf(0).toFixed(1)+' '+plotBottom+' Z" fill="url(#valArea'+chartGradId+')"/>';
    const defsSvg = '<defs><linearGradient id="valArea'+chartGradId+'" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0%" stop-color="'+endColor+'" stop-opacity="0.28"/>'
      + '<stop offset="100%" stop-color="'+endColor+'" stop-opacity="0"/></linearGradient></defs>';

    // Each segment keeps its destination tier's color, so a climb into Diamond visibly turns
    // diamond-blue. Drawn as one polyline per segment with round joins so it reads as a line
    // rather than a chain of sticks.
    let lineSvg = '';
    for(let i=1;i<hist.length;i++){
      const segColor = valTierColor(hist[i].tier || hist[i-1].tier);
      lineSvg += '<line x1="'+xOf(i-1).toFixed(1)+'" y1="'+yOf(vals[i-1]).toFixed(1)+'" x2="'+xOf(i).toFixed(1)+'" y2="'+yOf(vals[i]).toFixed(1)+'" stroke="'+segColor+'" stroke-width="2" stroke-linecap="round"/>';
    }

    /* Dots only where something happened. The old chart drew one at every match, which at "All"
       zoom on an active account turned the line into a solid bead chain; the hover cursor covers
       reading any individual match now. */
    const changeIdx = [];
    hist.forEach((h,i)=>{ if(i>0 && h.tier && h.tier !== hist[i-1].tier) changeIdx.push(i); });
    const keyIdx = new Set([0].concat(changeIdx));
    let dotsSvg = '';
    keyIdx.forEach(i=>{
      dotsSvg += '<circle cx="'+xOf(i).toFixed(1)+'" cy="'+yOf(vals[i]).toFixed(1)+'" r="3" fill="'+valTierColor(hist[i].tier)+'" stroke="var(--surface)" stroke-width="1.5"/>';
    });
    // where the account stands now gets a ring, so the eye lands on the current value first
    const lastX = xOf(hist.length-1), lastY = yOf(vals[hist.length-1]);
    dotsSvg += '<circle cx="'+lastX.toFixed(1)+'" cy="'+lastY.toFixed(1)+'" r="7" fill="'+hexToRgba(endColor,0.22)+'"/>'
      + '<circle cx="'+lastX.toFixed(1)+'" cy="'+lastY.toFixed(1)+'" r="3.8" fill="'+endColor+'" stroke="var(--surface)" stroke-width="1.5"/>';

    // rank icons at promotions/demotions only, and only when there's room for them — past a
    // handful they collide with each other and with the line
    let tierLabelSvg = '';
    if(!narrow && changeIdx.length && changeIdx.length <= 6){
      const size = 18;
      changeIdx.forEach(i=>{
        const iconInfo = (valTierIconCache && hist[i].tierId!=null) ? valTierIconCache[hist[i].tierId] : null;
        const iconUrl = iconInfo && (iconInfo.small || iconInfo.large);
        if(!iconUrl) return;
        const y = yOf(vals[i]);
        const above = y > padT + size + 4;
        tierLabelSvg += '<image href="'+iconUrl+'" x="'+(xOf(i)-size/2).toFixed(1)+'" y="'+((above ? y-8-size : y+8)).toFixed(1)+'" width="'+size+'" height="'+size+'"/>';
      });
    }

    const labelIdxs = narrow ? [0, hist.length-1] : [0, Math.floor((hist.length-1)/2), hist.length-1];
    let xLabelSvg = '';
    [...new Set(labelIdxs)].forEach(i=>{
      const anchor = i===0 ? 'start' : (i===hist.length-1 ? 'end' : 'middle');
      const x = i===0 ? padL : (i===hist.length-1 ? W-padR : xOf(i));
      xLabelSvg += '<text class="val-chart-axlbl" x="'+x.toFixed(1)+'" y="'+(H-7)+'" text-anchor="'+anchor+'">'+escapeHtml(fmtDate(new Date(hist[i].date).getTime()))+'</text>';
    });

    const net = vals[vals.length-1] - vals[0];
    const first = hist[0], last = hist[hist.length-1];
    const summary = 'RR history, '+hist.length+' matches, from '+(first.tier||'unranked')+' at '+first.rr
      + ' RR to '+(last.tier||'unranked')+' at '+last.rr+' RR, net '+(net>0?'plus ':'')+net+' RR.';

    wrap.innerHTML = '<svg class="val-chart-svg" viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'"'
      + ' role="img" tabindex="0">'
      + defsSvg + gridSvg + areaSvg + lineSvg + dotsSvg + tierLabelSvg + xLabelSvg
      + '<line class="val-chart-cursor" x1="0" y1="'+padT+'" x2="0" y2="'+plotBottom+'"/>'
      + '<circle class="val-chart-hoverdot" cx="0" cy="0" r="5" stroke="var(--surface)" stroke-width="2"/>'
      + '</svg>'
      + '<div class="val-chart-tip" hidden>'
      + '<div class="val-chart-tip-date"></div>'
      + '<div class="val-chart-tip-rank"></div>'
      + '<div class="val-chart-tip-rr"><span class="val-chart-tip-rrval"></span><span class="val-chart-tip-delta"></span></div>'
      + '</div>';
    chartGradId++;
    // .hovering lives on the container, which survives the innerHTML above — without this, a
    // re-render (zoom change, resize) leaves the previous hover state on, stranding the crosshair
    // and dot at the fresh SVG's default 0,0
    wrap.classList.remove('hovering');

    // stats strip: the headline the chart is making, stated in words above it — and the only form
    // of the chart's content that a screen reader or a reduced-motion/no-hover user can read
    const ups = hist.filter(h=> (h.lastChange||0) > 0).length;
    const downs = hist.filter(h=> (h.lastChange||0) < 0).length;
    const netCls = net > 0 ? 'up' : (net < 0 ? 'down' : 'flat');
    const netGlyph = net > 0 ? '▲' : (net < 0 ? '▼' : '–');
    statsEl.innerHTML =
        '<div class="val-chart-stat"><div class="val-chart-stat-num '+netCls+'">'
      + '<span aria-hidden="true">'+netGlyph+'</span> '+(net>0?'+':'')+net+'</div>'
      + '<div class="val-chart-stat-lbl">Net RR this range</div></div>'
      + '<div class="val-chart-stat"><div class="val-chart-stat-num">'+hist.length+'</div>'
      + '<div class="val-chart-stat-lbl">Matches</div></div>'
      + '<div class="val-chart-stat"><div class="val-chart-stat-num">'+ups+' <span class="val-chart-stat-sep">/</span> '+downs+'</div>'
      + '<div class="val-chart-stat-lbl">RR gained / lost</div></div>';

    /* Hover readout. Replaces the old per-dot <title> tooltips, which needed a pixel-accurate hit
       on a 3.5px circle and then waited on the OS tooltip delay. This snaps to the nearest match
       anywhere in the plot and reads instantly. */
    const svgEl = wrap.querySelector('svg');
    svgEl.setAttribute('aria-label', summary); // set as a property — tier names reach it unescaped
    const tipEl = wrap.querySelector('.val-chart-tip');
    const cursorEl = wrap.querySelector('.val-chart-cursor');
    const hoverDotEl = wrap.querySelector('.val-chart-hoverdot');
    const step = hist.length > 1 ? (W-padL-padR)/(hist.length-1) : 1;
    let hoverIdx = -1;

    function showHoverAt(i){
      i = Math.max(0, Math.min(hist.length-1, i));
      if(i === hoverIdx) return;
      hoverIdx = i;
      const h = hist[i], x = xOf(i), y = yOf(vals[i]);
      const c = valTierColor(h.tier);
      cursorEl.setAttribute('x1', x.toFixed(1)); cursorEl.setAttribute('x2', x.toFixed(1));
      hoverDotEl.setAttribute('cx', x.toFixed(1)); hoverDotEl.setAttribute('cy', y.toFixed(1));
      hoverDotEl.setAttribute('fill', c);
      wrap.classList.add('hovering');
      tipEl.hidden = false;
      // the tier color goes in as a custom property so CSS can derive a readable text shade for
      // the active theme, same as the account cards do
      tipEl.style.setProperty('--tier', c);
      tipEl.querySelector('.val-chart-tip-date').textContent = fmtDate(new Date(h.date).getTime());
      tipEl.querySelector('.val-chart-tip-rank').textContent = h.tier || 'Unranked';
      tipEl.querySelector('.val-chart-tip-rrval').textContent = h.rr + ' RR';
      const d = h.lastChange || 0;
      const deltaEl2 = tipEl.querySelector('.val-chart-tip-delta');
      deltaEl2.textContent = d > 0 ? ('▲ +'+d) : (d < 0 ? ('▼ '+d) : '–');
      deltaEl2.className = 'val-chart-tip-delta ' + (d > 0 ? 'up' : (d < 0 ? 'down' : 'flat'));
      // clamp inside the plot so the tooltip never hangs off either edge
      const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
      tipEl.style.left = Math.max(2, Math.min(W - tw - 2, x - tw/2)).toFixed(1) + 'px';
      tipEl.style.top  = Math.max(2, y - th - 14).toFixed(1) + 'px';
    }
    function hideHover(){ hoverIdx = -1; wrap.classList.remove('hovering'); tipEl.hidden = true; }
    function idxFromEvent(e){
      const rect = svgEl.getBoundingClientRect();
      if(!rect.width) return 0;
      return Math.round(((e.clientX - rect.left) * (W / rect.width) - padL) / step);
    }
    svgEl.addEventListener('pointermove', e=> showHoverAt(idxFromEvent(e)));
    svgEl.addEventListener('pointerdown', e=> showHoverAt(idxFromEvent(e)));
    svgEl.addEventListener('pointerleave', hideHover);
    svgEl.addEventListener('pointercancel', hideHover);
    svgEl.addEventListener('blur', hideHover);
    // arrow keys walk the same readout, so the per-match detail isn't pointer-only
    svgEl.addEventListener('keydown', e=>{
      if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
        e.preventDefault();
        showHoverAt((hoverIdx < 0 ? hist.length-1 : hoverIdx) + (e.key === 'ArrowRight' ? 1 : -1));
      } else if(e.key === 'Home'){ e.preventDefault(); showHoverAt(0); }
      else if(e.key === 'End'){ e.preventDefault(); showHoverAt(hist.length-1); }
      else if(e.key === 'Escape'){ hideHover(); }
    });
    // clicking a card re-renders this whole panel, so nothing here needs teardown — the listeners
    // die with the elements they're bound to
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

