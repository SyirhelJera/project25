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
            // kept for the wishlist total: valorant-api publishes no prices, but a skin's content
            // tier implies its standard one (see VAL_TIER_STD_PRICE)
            tier: s.contentTierUuid,
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

  /* Content tiers (Select/Deluxe/Premium/Exclusive/Ultra), fetched once from the same keyless
     reference API. Resolved by uuid -> devName rather than hardcoding the five tier uuids: they're
     stable, but they're reverse-engineered constants and a wrong one here would silently misprice
     a whole tier. Riot prices skins by tier, so the tier is the only price signal available for a
     skin that isn't currently in anyone's store — valorant-api publishes no prices at all. These
     are the standard figures and are *estimates*: Exclusive and Ultra in particular vary per skin,
     so anything derived from them is labelled as approximate wherever it's shown. */
  const VAL_TIER_STD_PRICE = { Select:875, Deluxe:1275, Premium:1775, Exclusive:2175, Ultra:2475 };

  /* Melee is the exception that breaks tier-based pricing, so it's excluded from it entirely.
     Two separate problems, either one fatal: melee skins are priced on a different scale from
     guns (1,750-5,950 rather than 875-2,475), and Riot tags essentially every melee skin
     "Exclusive" regardless of what it costs — Recon Balisong (1,750) and Elderflame Dagger
     (5,950) carry the identical content-tier uuid. So no melee price can be inferred from a tier,
     and pretending otherwise is how Soulstrife Scythe (3,550) came out as 2,175. A melee skin
     gets a price only from somewhere real: today's store, a price seen in a past check, or one
     typed in by hand. The Melee "weapon" in valorant-api owns every melee skin, which is how
     they're identified. */
  let valMeleeCache = null;
  let valMeleePromise = null;
  function ensureValMeleeSkins(){
    if(valMeleeCache) return Promise.resolve(valMeleeCache);
    if(valMeleePromise) return valMeleePromise;
    valMeleePromise = fetch(VALORANT_API_BASE+'/weapons?language=en-US')
      .then(r=>r.json())
      .then(json=>{
        const melee = ((json && json.data) || []).find(w=>/melee/i.test(w.displayName||''));
        const uuids = new Set(), names = new Set();
        ((melee && melee.skins) || []).forEach(s=>{
          if(s.uuid) uuids.add(s.uuid);
          if(s.displayName) names.add(s.displayName.toLowerCase());
        });
        valMeleeCache = { uuids, names };
        return valMeleeCache;
      })
      // an empty set fails *open* — melee then falls back to the tier estimate, which is the old
      // (wrong) behaviour but only when the lookup itself is unavailable
      .catch(()=>{ valMeleeCache = { uuids:new Set(), names:new Set() }; return valMeleeCache; });
    return valMeleePromise;
  }
  ensureValMeleeSkins();
  function valIsMeleeSkin(skinUuid, name){
    if(!valMeleeCache) return false;
    if(skinUuid && valMeleeCache.uuids.has(skinUuid)) return true;
    return !!(name && valMeleeCache.names.has(name.trim().toLowerCase()));
  }
  let valContentTierCache = null;
  let valContentTierPromise = null;
  function ensureValContentTiers(){
    if(valContentTierCache) return Promise.resolve(valContentTierCache);
    if(valContentTierPromise) return valContentTierPromise;
    valContentTierPromise = fetch(VALORANT_API_BASE+'/contenttiers')
      .then(r=>r.json())
      .then(json=>{
        const map = {};
        ((json && json.data) || []).forEach(t=>{
          const dev = (t.devName||t.displayName||'');
          // substring match, highest tier last — same "don't trust the exact string" posture as
          // resolveTierRank() in valorant-lib.mjs
          const key = Object.keys(VAL_TIER_STD_PRICE).find(k=> dev.toLowerCase().includes(k.toLowerCase()));
          if(t.uuid && key) map[t.uuid] = key;
        });
        valContentTierCache = map;
        return map;
      })
      .catch(()=>{ valContentTierCache = {}; return valContentTierCache; });
    return valContentTierPromise;
  }
  ensureValContentTiers();

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

  /* ---- Shop Tracker / RR Tracker / Live Match sub-tabs: the Valorant view got crowded once the
     store + wishlist card was added alongside rank tracking, so they're split into switchable
     panels instead of one long scroll. Ordered by how often they're opened, not by urgency — the
     store is the daily reason to come here (and the pane the tab now always lands on, see
     showGameSubTab() in tft.js), while Live Match only has anything to show during a match. ---- */
  const VAL_SUBTABS = ['shop','rr','live'];
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
    // asking for the Live Match panel is asking to look at it, so let it re-centre on the way in
    // (centreValLiveCard() is otherwise once-per-lobby — see the comment on valLiveCentredFor)
    if(state.valorant.activeSubtab === 'live') valLiveCentredFor = '';
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
  // Everything one account has for sale right now, flattened across all four panels and tagged
  // with which one it came from. The wishlist is matched against all of it — a skin you're waiting
  // for arrives in the featured bundle or the night market just as often as in the four daily
  // offers, and matching only `items` (which is all this used to do) stayed silent through both.
  // Mirrors collectOfferedItems() in scripts/valorant-lib.mjs, which does the same for the push.
  function valOfferedItems(ds){
    if(!ds) return [];
    return [].concat(
      (ds.items||[]).map(it=>({ name:it.name, source:'daily' })),
      ((ds.nightMarket && ds.nightMarket.offers)||[]).map(it=>({ name:it.name, source:'night' })),
      ((ds.bundle && ds.bundle.items)||[]).map(it=>({ name:it.name, source:'bundle' })),
      (ds.accessories||[]).map(it=>({ name:it.name, source:'accessory' })),
    );
  }
  /* ---- what a wishlist entry would cost ---------------------------------------------------
     Two sources, in this order:
       1. the store itself, when the item is on sale for this account right now — an exact number,
          and the discounted one where a discount applies (night market, bundle);
       2. the skin's content tier, which is what Riot prices by. An estimate, and flagged as one
          everywhere it surfaces.
     A free-text entry like "Vandal" names a gun rather than a skin and resolves to neither, so it
     counts as unpriced rather than being guessed at. Accessories are deliberately not a source:
     they're Kingdom Credits, and adding them to a VP total would produce a number in no currency
     at all. ---- */
  // what each price cell's tooltip says about where its number came from
  const VAL_PRICE_SOURCE_HINT = {
    manual: 'Price you entered — clear the field to go back to the automatic one',
    store:  'Price in this account\'s store right now',
    seen:   'Real price, from a past store check',
    tier:   'Estimated from the skin\'s tier — type the real price to correct it',
    melee:  'Melee skins can\'t be estimated (Riot tags them all one tier, from 1,750 to 5,950 VP) — type the real price',
    '':     'No price known — type it in to include this in the total',
  };
  function valOfferedPricedItems(ds){
    if(!ds) return [];
    const vpOf = it => parseInt(it.discountPrice,10) || parseInt(it.price,10) || 0;
    return [].concat(
      (ds.items||[]).map(it=>({ name: it.name, vp: parseInt(it.price,10)||0 })),
      ((ds.nightMarket && ds.nightMarket.offers)||[]).map(it=>({ name: it.name, vp: vpOf(it) })),
      ((ds.bundle && ds.bundle.items)||[]).map(it=>({ name: it.name, vp: vpOf(it) })),
    ).filter(x=>x.vp > 0);
  }
  /* Prices actually seen. Every store check reports real VP prices for whatever was on sale, and
     those numbers are worth keeping long after that rotation ends: a skin seen once is priced
     exactly, forever, with no API that publishes prices and no estimate involved. This is the only
     way melee ever gets a real price without typing one in. Recorded from the *undiscounted*
     figure — a night-market or bundle discount is a property of that offer, not of the skin. */
  function valLearnStorePrices(){
    const seen = state.valorant.skinPrices || (state.valorant.skinPrices = {});
    let changed = false;
    const put = (name, vp) => {
      const k = (name||'').trim().toLowerCase();
      if(!k || !vp || seen[k] === vp) return;
      seen[k] = vp; changed = true;
    };
    Object.values(state.valorant.dailyStores || {}).forEach(ds=>{
      if(!ds) return;
      (ds.items||[]).forEach(it=> put(it.name, parseInt(it.price,10)||0));
      ((ds.nightMarket && ds.nightMarket.offers)||[]).forEach(it=> put(it.name, parseInt(it.price,10)||0));
      ((ds.bundle && ds.bundle.items)||[]).forEach(it=> put(it.name, parseInt(it.price,10)||0));
    });
    if(changed) save(); // only when something new was actually learned — this runs on every render
  }

  // Exact name match here, not the loose substring match the wishlist uses for *alerting*: "is
  // some Vandal skin in my store" is a useful notification and a useless price.
  function valSkinStdPrice(skinUuid, name){
    if(!valSkinDbCache || !valContentTierCache) return 0;
    if(valIsMeleeSkin(skinUuid, name)) return 0; // see ensureValMeleeSkins() — tier says nothing here
    let rec = skinUuid ? valSkinDbCache.find(s=>s.uuid === skinUuid) : null;
    if(!rec && name){
      const n = name.trim().toLowerCase();
      rec = valSkinDbCache.find(s=>(s.name||'').toLowerCase() === n);
    }
    return rec ? (VAL_TIER_STD_PRICE[valContentTierCache[rec.tier]] || 0) : 0;
  }
  // Sources in falling order of authority: what you typed, what it costs right now, what it cost
  // when it was last seen, what its tier implies. Only the last one is a guess.
  function valWishlistItemPrice(w, label){
    const nm = (w.name||'').trim().toLowerCase();
    if(!nm) return { vp:0, source:'' };
    const manual = parseInt(w.price,10)||0;
    if(manual) return { vp: manual, source:'manual' };
    const live = valOfferedPricedItems((state.valorant.dailyStores||{})[label]).find(x=>(x.name||'').toLowerCase() === nm);
    if(live) return { vp: live.vp, source:'store' };
    const seen = parseInt((state.valorant.skinPrices||{})[nm],10)||0;
    if(seen) return { vp: seen, source:'seen' };
    const est = valSkinStdPrice(w.skinUuid, w.name);
    if(est) return { vp: est, source:'tier' };
    return { vp:0, source: valIsMeleeSkin(w.skinUuid, w.name) ? 'melee' : '' };
  }

  // every {wishlist item, offer} pairing currently sitting in any tracked account's store —
  // drives both the red nav tick and the "matched" styling on wishlist chips
  function valCurrentWishlistMatches(){
    const stores = state.valorant.dailyStores || {};
    const matches = [];
    Object.keys(stores).forEach(label=>{
      valOfferedItems(stores[label]).forEach(it=>{
        valWishlistMatchesForItem(it.name, label).forEach(w=>{
          matches.push({ wishlistId: w.id, itemName: it.name, label, source: it.source });
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
      // "incomplete" is the pre-clid saved session: not expired, but fixed the same way
      return !!err && /expired|incomplete/i.test(err);
    });
  }
  function updateValWishlistBadge(){
    // the per-account ★ on the switcher chips is the same signal, so it refreshes here too
    renderValAcctSwitcher();
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
    const navItem = document.querySelector('.nav-item[data-tab="games"]');
    if(navItem) navItem.classList.toggle('wish-glow', hits>0);
    // and the icon that opens the wishlist modal: with the list no longer sitting open beside the
    // store, this is the only place a hit shows while you're actually looking at the store. The
    // icon has no visible label, so the same sentence has to be its accessible name, not just a
    // hover tooltip — title alone leaves a screen reader with a bare star.
    const openBtn = el('valWishlistOpenBtn');
    if(openBtn){
      openBtn.classList.toggle('has-hit', hits>0);
      const txt = hits ? (hits===1 ? 'Wishlist — a wishlisted skin is in today\'s store'
                                   : 'Wishlist — '+hits+' wishlisted skins are in today\'s store')
                       : 'Wishlist — skins to watch for in the daily store';
      openBtn.title = txt;
      openBtn.setAttribute('aria-label', txt);
    }
  }

  /* Every wishlist edit has to redraw the *store*, not just the list: the red tile border, the ★
     badge on a tile and the "account with a match sorts first" ordering are all derived from the
     wishlist at render time, so a list that changed while the store kept its old HTML leaves a
     removed entry still flagged in today's offers (and a newly added one unflagged until something
     unrelated triggers a redraw). Both mutation sites go through here so neither can forget. */
  function commitValWishlistChange(){
    save();
    renderValWishlist();
    renderValorantStore();
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
    bodyEl.style.display = 'block';
    // the count rides as a badge on the icon that opens the modal, so the list's size is readable
    // without opening it — bare number, the pill is the parenthesis
    el('valWishlistCount').textContent = wishlist.length ? String(wishlist.length) : '';
    el('valWishlistEmpty').style.display = wishlist.length ? 'none' : 'block';
    const matches = valCurrentWishlistMatches();
    // fixed-size rows (not variable-width pills) so a long skin name doesn't blow up its own
    // chip while a short one sits tiny next to it — name truncates with an ellipsis instead
    valLearnStorePrices();
    const prices = wishlist.map(w=>valWishlistItemPrice(w, label));
    listEl.innerHTML = wishlist.map((w,i)=>{
      const hit = matches.find(m=>m.wishlistId===w.id);
      const p = prices[i];
      // The price cell is an input, always: every source below "you typed it" can be wrong or
      // missing, and the fix has to be one click away rather than a settings trip. What's resolved
      // automatically shows as the placeholder; typing over it pins that number for good.
      const auto = p.source === 'manual' ? 0 : p.vp;
      const hint = VAL_PRICE_SOURCE_HINT[p.source] || VAL_PRICE_SOURCE_HINT[''];
      const priceHtml = '<input type="number" class="val-wishlist-row-price'+(p.source==='tier'?' is-est':'')+'"'
        + ' min="0" step="25" inputmode="numeric" data-wish-price="'+w.id+'"'
        + ' aria-label="VP price for '+escapeHtml(w.name)+'" title="'+escapeHtml(hint)+'"'
        + ' placeholder="'+(auto ? (p.source==='tier'?'~':'')+auto.toLocaleString() : '—')+'"'
        + (p.source === 'manual' ? ' value="'+p.vp+'"' : '') + '>';
      return '<div class="val-wishlist-row'+(hit?' matched':'')+'" data-wish-id="'+w.id+'">'
        + (w.imageUrl ? '<img class="val-wishlist-row-img" alt="" data-img-src="'+escapeHtml(w.imageUrl)+'">' : '<span class="val-wishlist-row-img"></span>')
        + '<span class="val-wishlist-row-name" data-tile-title="'+escapeHtml(w.name)+'">'+escapeHtml(w.name)+'</span>'
        + priceHtml
        + (hit ? '<span class="val-wishlist-row-hit" title="In today\'s store"><span aria-hidden="true">✓</span></span>' : '')
        + '<button type="button" class="val-icon-btn" data-wish-del="'+w.id+'" data-tile-title="Remove '+escapeHtml(w.name)+' from wishlist"><span aria-hidden="true">✕</span></button>'
        + '</div>';
    }).join('');
    applyValTileTitles(listEl);
    // committed on change (not on every keystroke): re-rendering mid-type would take the caret,
    // and the total is only meaningful once a whole number has been entered
    listEl.querySelectorAll('[data-wish-price]').forEach(inp=>{
      inp.addEventListener('change', ()=>{
        const entry = (state.valorant.wishlist[label]||[]).find(x=>x.id === inp.dataset.wishPrice);
        if(!entry) return;
        const v = Math.max(0, parseInt(inp.value,10)||0);
        if(v) entry.price = v; else delete entry.price; // cleared -> back to the automatic price
        save(); renderValWishlist();
      });
    });
    renderValWishlistTotal(wishlist, prices, label);
    listEl.querySelectorAll('[data-img-src]').forEach(img=>{ img.src = img.dataset.imgSrc; });
    listEl.querySelectorAll('[data-wish-del]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        state.valorant.wishlist[label] = (state.valorant.wishlist[label]||[]).filter(w=>w.id!==btn.dataset.wishDel);
        commitValWishlistChange();
      });
    });
    updateValWishlistBadge();
  }

  /* What the whole list would cost, and what it'd take to afford it — the same top-up planner the
     item preview uses, pointed at the sum instead of one price. The counts above it are the point
     as much as the total is: a wishlist half-full of free-text entries ("Vandal") produces a
     number that's missing items, and a total that doesn't say so is worse than no total. */
  function renderValWishlistTotal(wishlist, prices, label){
    const wrap = el('valWishlistTotal'); if(!wrap) return;
    if(!wishlist.length){ wrap.innerHTML = ''; wrap.style.display = 'none'; return; }
    wrap.style.display = 'block';
    const totalVp = prices.reduce((s,p)=>s + p.vp, 0);
    const estimated = prices.filter(p=>p.source === 'tier').length;
    const melee = prices.filter(p=>p.source === 'melee').length;
    const unpriced = prices.filter(p=>!p.vp && p.source !== 'melee').length;
    if(!totalVp){
      wrap.innerHTML = '<div class="val-vp-calc-note">No prices known for these entries yet. Type one into any row to count it, or wait until the item turns up in a store check — real prices are remembered from then on.</div>';
      return;
    }
    const notes = [];
    if(estimated) notes.push(estimated+' price'+(estimated===1?'':'s')+' estimated from tier');
    // melee is called out separately from "no specific skin": one is unknowable from the API and
    // fixed by typing a number, the other means the entry doesn't name a single skin at all
    if(melee) notes.push(melee+' melee skin'+(melee===1?'':'s')+' need a price typed in');
    if(unpriced) notes.push(unpriced+' entr'+(unpriced===1?'y':'ies')+' not counted (no specific skin)');
    wrap.innerHTML = valVpCalcHtml(totalVp, label, {
      title: 'Buying the whole list',
      priceLabel: (estimated || unpriced) ? 'Total (approx)' : 'Total',
      note: notes.join(' · '),
    });
  }

  /* ---- wishlist modal: the list used to be a column beside the store, which cost the store a
     third of its width permanently for something read a few seconds a day. Same open/close
     grammar as the item preview above — backdrop click, Escape, and focus handed back to the
     button that opened it. Nothing about which account it edits changes: it still follows the
     account dropdown in the switcher row. ---- */
  let valWishlistReturnFocus = null;
  function openValWishlist(){
    renderValWishlist(); // the store may have been re-checked since it was last open
    // Pricing the list needs the skin catalogue and the tier table. Both are fetched once at load,
    // so this is normally already resolved and re-renders immediately; it only matters on a cold
    // open with a slow network. Kicked off from here rather than from renderValWishlist(), which
    // it calls back into — the other way round is a render loop.
    Promise.all([ensureValSkinDb(), ensureValContentTiers(), ensureValMeleeSkins()]).then(()=>{
      if(el('valWishlistOverlay').style.display === 'flex') renderValWishlist();
    });
    el('valWishlistOverlay').style.display = 'flex';
    valWishlistReturnFocus = document.activeElement;
    // the input is the point of opening this — unless no account is picked, in which case there's
    // nothing to type into and the close button is the only control.
    // Never on touch: focusing a field there throws up the keyboard and iOS scroll-zooms onto it,
    // so opening the list to *read* it starts by fighting the keyboard back down. A tap on the
    // field is one gesture away; on a mouse+keyboard the autofocus saves a click and costs nothing.
    const input = el('valWishlistInput');
    const autoFocus = !window.matchMedia || window.matchMedia('(hover:hover) and (pointer:fine)').matches;
    if(state.valorant.selectedStoreLabel && autoFocus) input.focus();
    else el('valWishlistCloseBtn').focus();
  }
  function closeValWishlist(){
    el('valWishlistOverlay').style.display = 'none';
    hideValWishlistSuggest();
    if(valWishlistReturnFocus && document.contains(valWishlistReturnFocus)) valWishlistReturnFocus.focus();
    valWishlistReturnFocus = null;
  }
  el('valWishlistOpenBtn').addEventListener('click', openValWishlist);
  el('valWishlistCloseBtn').addEventListener('click', closeValWishlist);
  el('valWishlistOverlay').addEventListener('click', e=>{
    if(e.target === el('valWishlistOverlay')) closeValWishlist();
  });
  document.addEventListener('keydown', e=>{
    if(e.key !== 'Escape' || el('valWishlistOverlay').style.display !== 'flex') return;
    // Escape with the suggestion list open dismisses just the suggestions — the modal itself is
    // the second press, same as any search field inside a dialog
    if(el('valWishlistSuggest').style.display === 'block'){ hideValWishlistSuggest(); return; }
    closeValWishlist();
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
    commitValWishlistChange();
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
  // The night market's own accent. Its tiles deliberately don't take a price-band rarity color the
  // way daily offers do: the discount is what you're reading there, and two color scales on one
  // tile (rarity edge + discount flag) fight each other.
  const VAL_NIGHT_COLOR = '#7B61FF';
  function valAccessoryTypeColor(type){ return VAL_ACCESSORY_TYPE_COLORS[type] || '#8B92A8'; }

  // Every rotation timer the store check records (weekly accessories, the featured bundle) is a
  // snapshot taken at checkedAt — so the elapsed time since the check has to be subtracted, or a
  // store checked two days ago would still claim a week left. Returns '' when there's nothing
  // meaningful to show.
  function valStoreTimeLeft(checkedAt, remainingSeconds){
    if(!remainingSeconds || !checkedAt) return '';
    const left = remainingSeconds - Math.floor((Date.now() - checkedAt)/1000);
    if(left <= 0) return 'rotated — re-check';
    const days = Math.floor(left/86400), hrs = Math.floor((left%86400)/3600), mins = Math.floor((left%3600)/60);
    if(days) return days+'d '+hrs+'h left';
    if(hrs) return hrs+'h '+mins+'m left';
    return mins+'m left';
  }

  // Account label plus the player card equipped on that account (written by fetchEquippedIdentity()
  // in valorant-lib.mjs). The avatar is what makes several tracked accounts tellable apart without
  // reading their labels, so it leads the header — but it's absent from stores checked before this
  // was added, and from any check whose loadout lookup failed, so the header must read fine
  // without it.
  function valStoreHeader(label, ds){
    const checkedHtml = ds.checkedAt
      ? '<span class="val-store-checked" title="'+escapeHtml(fmtDate(ds.checkedAt))+'">Checked '+escapeHtml(valTimeAgo(ds.checkedAt))+'</span>'
      : '';
    const id = ds.identity || null;
    const avatarHtml = (id && id.cardSmall)
      // a real <button> for the same reason the store tiles are: the three card crops are only
      // viewable through the preview modal, and clicking art that enlarges everywhere else in
      // this tab should enlarge here too
      ? '<button type="button" class="val-store-account-card"'
        + ' data-preview-kind="identity" data-preview-label="'+escapeHtml(label)+'"'
        + ' data-tile-title="'+escapeHtml(id.cardName + (id.level ? ' — Level '+id.level : '') + ' — click to enlarge')+'">'
        + '<img src="'+escapeHtml(id.cardSmall)+'" alt="">'
        + '</button>'
      : '';
    const levelHtml = (id && id.level) ? '<span class="val-store-account-level">Lv '+escapeHtml(String(id.level))+'</span>' : '';
    // What this account can actually afford, in the currencies the shops below price in — the
    // whole point of a store list is deciding, and that decision needs the balance next to the
    // price. Same currency icons as the tiles, so 2,150 in the header and 1,775 on a tile are
    // obviously the same unit. Absent on stores checked before the wallet lookup existed.
    // Radianite buys nothing in either shop — it upgrades skins already owned — but it's the
    // third balance fetchWallet() in scripts/valorant-lib.mjs has always returned, and it's the
    // figure you need when a store offer is a skin line you'd want to level up. Riot's own wallet
    // order (VP, RP, KC) is kept so the row reads the way the client does.
    const w = ds.wallet || null;
    const walletHtml = w
      ? '<span class="val-store-wallet">'
        + '<span class="val-store-item-price" title="Valorant Points">'+(w.vp||0).toLocaleString()+'</span>'
        + '<span class="val-store-item-price rad" title="Radianite Points">'+(w.rad||0).toLocaleString()+'</span>'
        + '<span class="val-store-item-price kc" title="Kingdom Credits">'+(w.kc||0).toLocaleString()+'</span>'
        + '</span>'
      : '';
    return '<div class="val-store-account-hdr">'+avatarHtml
      + '<span class="val-store-account-name">'+escapeHtml(label)+'</span>'
      + levelHtml + walletHtml + checkedHtml + '</div>';
  }
  // Sub-header inside one account's section, separating the daily skins grid from the accessory
  // grid below it — smaller/lighter than the account header above so the account stays the
  // dominant heading. `primary` marks the section that leads its account (Daily Offers), which
  // holds the column's three-step hierarchy up: featured bundle, then daily offers, then
  // accessories, each visibly a rung below the last.
  function valStoreSectionHdr(name, note, primary){
    return '<div class="val-store-section-hdr'+(primary?' val-store-section-hdr-primary':'')+'"><span class="val-store-section-name">'+escapeHtml(name)+'</span>'
      + (note ? '<span class="val-store-section-note">'+escapeHtml(note)+'</span>' : '')
      + '</div>';
  }

  /* ---- featured bundle: Riot runs one featured bundle for everybody, so it's rendered once at
     the top of the store column rather than repeated inside every tracked account's section —
     seeing the same banner three times only made the accounts harder to scan. The freshest check
     wins (rather than, say, the first account): all accounts report the same bundle, so the only
     thing that differs between their copies is how stale the countdown is. Returns '' when no
     account has recorded one — either nothing is featured, or every store here predates bundle
     support. `label` is carried on the tile so the preview click handler can find it again. ---- */
  function valFeaturedBundleLabel(stores, labels){
    let best = '', bestAt = 0;
    labels.forEach(label=>{
      const ds = stores[label] || {};
      if(ds.bundle && ds.bundle.name && (ds.checkedAt||0) > bestAt){ best = label; bestAt = ds.checkedAt||0; }
    });
    return best;
  }
  function valFeaturedBundleHtml(stores, labels){
    const label = valFeaturedBundleLabel(stores, labels);
    if(!label) return '';
    const ds = stores[label];
    const b = ds.bundle;
    const price = parseInt(b.price,10)||0;
    const timeLeft = valStoreTimeLeft(ds.checkedAt, b.remainingSeconds);
    // a bundle is a bag of items, so a wishlist hit inside one is invisible from the banner unless
    // it's called out — the names go in the tooltip, since the banner has room for a count only
    const wishHits = (b.items||[]).filter(it => valWishlistMatchesForItem(it.name, label).length);
    const wishHtml = wishHits.length
      ? '<span class="val-bundle-wish"><span aria-hidden="true">★</span> '
        + wishHits.length + ' wishlisted</span>'
      : '';
    const title = b.name + ' — Featured Bundle'
      + (wishHits.length ? ' — on your wishlist: ' + wishHits.map(it=>it.name).join(', ') : '')
      + ' — click for contents';
    return '<button type="button" class="val-bundle'+(wishHits.length?' wishlist-match':'')+'" data-preview-kind="bundle" data-preview-label="'+escapeHtml(label)+'"'
      + ' data-tile-title="'+escapeHtml(title)+'">'
      + (b.imageUrl ? '<span class="val-bundle-art"><img src="'+escapeHtml(b.imageUrl)+'" alt=""></span>' : '')
      + '<span class="val-bundle-body">'
      + '<span class="val-bundle-kicker">Featured Bundle</span>'
      + '<span class="val-bundle-name">'+escapeHtml(b.name)+'</span>'
      + '<span class="val-bundle-meta">'
      + (price ? '<span class="val-store-item-price" title="Valorant Points">'+price.toLocaleString()+'</span>' : '')
      + (timeLeft ? '<span class="val-bundle-time">'+escapeHtml(timeLeft)+'</span>' : '')
      + wishHtml
      + '</span></span></button>';
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

  /* ---- VP purchase calculator ------------------------------------------------------------
     Clicking a VP-priced item answers "so what do I actually buy?": the balance the last store
     check read, the shortfall, and which top-up packages cover it.

     "Optimal" needs a definition, and which one applies depends on what's been filled in:
       - prices known → cheapest total spend. This is why it searches *past* the shortfall rather
         than stopping at the first combination that covers it: VP gets cheaper per point in bulk,
         so one 2,050 pack routinely costs less than 1,000 + 475 + 475 even though it buys more.
       - no prices → least VP bought (so the least stranded in the wallet afterwards), then the
         fewest packages. Without prices there's nothing else to be optimal about, and it's the
         right answer anyway whenever the tiers aren't discounted.
     Tiers with no price are excluded outright once *any* price exists: a blank there means "not
     sold in my region", and suggesting a package you can't buy is worse than suggesting none.

     Third-party sellers (a discounted top-up shop) are just more (VP, price) rows in the same
     pool — nothing about the search changes, they simply undercut the official tier at the same
     VP amount. They're kept in their own list because they're *optional*: one checkbox drops them
     out of consideration, and when they're in, the calculator also reports what the official-only
     answer would have cost, so "cheapest" is never a number you have to take on trust. ---- */
  function valVpPackages(){
    return ((state.valorant.vp && state.valorant.vp.packages) || [])
      .map(p=>({ vp: parseInt(p.vp,10)||0, price: Number(p.price)||0, src:'' }))
      .filter(p=>p.vp > 0)
      .sort((a,b)=>a.vp-b.vp);
  }
  // A third-party offer with no price is meaningless — the price *is* the offer — so unlike the
  // official tiers, an unpriced row is dropped rather than treated as "sold, cost unknown".
  function valVpOffers(){
    return ((state.valorant.vp && state.valorant.vp.offers) || [])
      // `on === false` is a seller switched off in Settings — categorising them is only useful if
      // a whole category can be taken out of the running
      .filter(o=>o.on !== false)
      .map(o=>({ vp: parseInt(o.vp,10)||0, price: Number(o.price)||0, src: (o.name||'Third party').trim() || 'Third party', id:o.id }))
      .filter(o=>o.vp > 0 && o.price > 0);
  }
  // offers grouped by seller, which is what the Settings list edits: a discounted shop sells every
  // tier, so its rows belong together under one name that can be renamed or switched off once
  function valVpOfferGroups(){
    const groups = new Map();
    ((state.valorant.vp && state.valorant.vp.offers) || []).forEach(o=>{
      const name = (o.name||'Third party').trim() || 'Third party';
      if(!groups.has(name)) groups.set(name, { name, on: o.on !== false, rows: [] });
      const g = groups.get(name);
      g.rows.push(o);
      // a group reads as on unless every row in it is off — a half-off group would otherwise
      // render as a checked box that isn't wholly true
      if(o.on !== false) g.on = true;
    });
    return [...groups.values()].map(g=>({ ...g, rows: g.rows.slice().sort((a,b)=>(parseInt(a.vp,10)||0)-(parseInt(b.vp,10)||0)) }));
  }
  function valVpUseOffers(){
    return state.valorant.vp && state.valorant.vp.useOffers !== false;
  }

  // Unbounded coin-change over the tiers. `deficit` is at most one bundle (~11k VP) and there are
  // six tiers, so the table is a few tens of thousands of steps — small enough to just run on
  // every render rather than caching anything.
  function valVpPlan(deficit, includeOffers){
    deficit = Math.max(0, Math.ceil(deficit));
    const official = valVpPackages();
    const all = official.concat(includeOffers ? valVpOffers() : []);
    if(!deficit || !all.length) return null;
    const priced = all.filter(p=>p.price > 0);
    const usingCost = priced.length > 0;
    const pool = (usingCost ? priced : all).slice().sort((a,b)=>a.vp-b.vp);
    const max = pool[pool.length-1].vp;
    // never worth overshooting by more than one of the largest packs — anything beyond that is
    // strictly the same combination plus a wholly wasted package
    const cap = deficit + max;
    // Two objectives, compared lexicographically: money first, then number of purchases. The
    // second one matters more than it looks — with evenly-priced tiers, four 475 packs cost
    // exactly what one 2,050 pack does, and "buy four of them" is a worse answer to the same
    // question. In the unpriced case every cost is 0, so the comparison falls through to the
    // package count on its own, which is exactly what's wanted there.
    const EPS = 1e-9;
    const cost = new Array(cap+1).fill(Infinity);
    const cnt  = new Array(cap+1).fill(Infinity);
    const from = new Array(cap+1).fill(-1);         // which pack closed that total, for readback
    cost[0] = 0; cnt[0] = 0;
    for(let v=1; v<=cap; v++){
      for(let i=0;i<pool.length;i++){
        const p = pool[i];
        if(p.vp > v) continue;
        if(cost[v-p.vp] === Infinity) continue;
        const c = cost[v-p.vp] + (usingCost ? p.price : 0);
        const k = cnt[v-p.vp] + 1;
        if(c < cost[v]-EPS || (c < cost[v]+EPS && k < cnt[v])){ cost[v] = c; cnt[v] = k; from[v] = i; }
      }
    }
    let pick = -1;
    for(let v=deficit; v<=cap; v++){
      if(cost[v] === Infinity) continue;
      if(!usingCost){ pick = v; break; }   // no prices: least overshoot wins outright
      // cheapest anywhere at or above the shortfall, then fewest purchases, then — when even that
      // ties — the one that leaves more VP in the wallet, since it cost the same either way
      if(pick < 0
        || cost[v] < cost[pick]-EPS
        || (cost[v] < cost[pick]+EPS && (cnt[v] < cnt[pick] || (cnt[v] === cnt[pick] && v > pick)))){
        pick = v;
      }
    }
    if(pick < 0) return null;
    // counted by pool index, not by VP amount: a third-party 1,000 and the official 1,000 are the
    // same size and different offers, and merging them would misreport both the seller and the cost
    const counts = new Map();
    for(let v=pick; v>0; ){
      const i = from[v];
      counts.set(i, (counts.get(i)||0) + 1);
      v -= pool[i].vp;
    }
    const packs = [...counts.entries()]
      .map(([i,qty])=>({ vp: pool[i].vp, qty, price: pool[i].price, src: pool[i].src }))
      .sort((a,b)=>b.vp-a.vp);
    return {
      packs,
      totalVp: pick,
      totalCost: usingCost ? packs.reduce((s,p)=>s + p.price*p.qty, 0) : 0,
      priced: usingCost,
      count: packs.reduce((s,p)=>s + p.qty, 0),
    };
  }

  function valFmtMoney(n){
    const cur = ((state.valorant.vp && state.valorant.vp.currency) || '').trim();
    const num = Math.round(n*100)/100;
    const txt = num.toLocaleString(undefined, { minimumFractionDigits: num % 1 ? 2 : 0, maximumFractionDigits: 2 });
    return cur ? cur+' '+txt : txt;
  }
  function valVpRow(lbl, vp, cls){
    return '<div class="val-vp-calc-row'+(cls?' '+cls:'')+'"><span>'+escapeHtml(lbl)+'</span>'
      + '<span class="val-store-item-price">'+vp.toLocaleString()+'</span></div>';
  }

  // Rendered into the item preview for anything priced in VP, and into the wishlist modal for the
  // sum of a whole list. `label` is the account whose wallet and store the figure came from — the
  // balance is per account, so the calculator has to be too. `opts` only relabels things: the
  // arithmetic is identical whether the number is one skin or twelve.
  function valVpCalcHtml(vpCost, label, opts){
    vpCost = parseInt(vpCost,10)||0;
    if(!vpCost) return '';
    opts = opts || {};
    const ds = (state.valorant.dailyStores||{})[label] || {};
    // rawDeficit: the number *is* the shortfall (the calculator's "I need this much more" mode),
    // so there's no balance to subtract and none to report
    const wallet = opts.rawDeficit ? null : (ds.wallet || null);
    const have = wallet ? (parseInt(wallet.vp,10)||0) : 0;
    const deficit = opts.rawDeficit ? vpCost : Math.max(0, vpCost - have);

    let html = '<div class="val-vp-calc"><div class="val-vp-calc-hdr">'+escapeHtml(opts.title || 'Buying this')+'</div>'
      + (opts.note ? '<div class="val-vp-calc-note val-vp-calc-note-top">'+escapeHtml(opts.note)+'</div>' : '')
      + valVpRow(opts.priceLabel || 'Price', vpCost);
    if(wallet) html += valVpRow('Your balance', have);
    if(wallet && !deficit){
      return html
        + '<div class="val-vp-calc-ok"><span aria-hidden="true">✓</span> You can afford this — '
        + (have-vpCost).toLocaleString()+' VP left over.</div></div>';
    }
    // in rawDeficit mode the number was already the shortfall, so restating it as a second row
    // would just be the same figure twice
    if(!opts.rawDeficit) html += valVpRow(wallet ? 'Short by' : 'You need', deficit, 'is-short');
    if(!wallet && !opts.rawDeficit){
      html += '<div class="val-vp-calc-note">This account\'s balance is unknown — run a store check to read the wallet, and this becomes what you\'re actually short.</div>';
    }

    const useOffers = valVpUseOffers() && valVpOffers().length > 0;
    const plan = valVpPlan(deficit, useOffers);
    if(!plan){
      html += '<div class="val-vp-calc-note">No VP packages configured — add them in Settings → Valorant Points Prices.</div>';
      return html + '</div>';
    }
    const leftover = have + plan.totalVp - vpCost;
    html += '<div class="val-vp-plan">'
      + '<div class="val-vp-plan-hdr">'+(plan.priced ? 'Cheapest top-up' : 'Smallest top-up')+'</div>'
      + plan.packs.map(p=>'<div class="val-vp-plan-pack">'
          + '<span class="val-vp-plan-qty">'+p.qty+'×</span>'
          + '<span class="val-store-item-price">'+p.vp.toLocaleString()+'</span>'
          + (p.src ? '<span class="val-vp-plan-src" title="Third-party seller">'+escapeHtml(p.src)+'</span>' : '')
          + (p.price ? '<span class="val-vp-plan-cost">'+escapeHtml(valFmtMoney(p.price*p.qty))+'</span>' : '')
          + '</div>').join('')
      // the total's money sits in the same right-hand column as the per-pack costs above it, so the
      // figure you actually pay reads down one edge instead of being buried mid-sentence
      + '<div class="val-vp-plan-total">'
        + '<span>'+plan.totalVp.toLocaleString()+' VP</span>'
        + (plan.priced ? '<b class="val-vp-plan-cost">'+escapeHtml(valFmtMoney(plan.totalCost))+'</b>' : '')
      + '</div>'
      + '<div class="val-vp-plan-left">'+leftover.toLocaleString()+' VP left after buying</div>';

    // When a third-party seller wins, say what it's beating. A "cheapest" that quietly assumes
    // you'll use a reseller is a different decision from the official one, and it's yours to make.
    if(useOffers && plan.priced && plan.packs.some(p=>p.src)){
      const official = valVpPlan(deficit, false);
      if(official && official.priced){
        const saved = official.totalCost - plan.totalCost;
        html += '<div class="val-vp-plan-alt">Official only: '+escapeHtml(valFmtMoney(official.totalCost))
          + ' (' + official.totalVp.toLocaleString() + ' VP)'
          + (saved > 0 ? ' — third party saves '+escapeHtml(valFmtMoney(saved)) : '')
          + '</div>';
      }
    }
    html += (plan.priced ? '' : '<div class="val-vp-calc-note">Add your local prices in Settings → Valorant Points Prices and this picks the cheapest combination instead of the smallest.</div>')
      + '</div>';
    return html + '</div>';
  }

  /* ---- VP package prices, in Settings. Rows are keyed by their VP amount rather than by array
     index, so a reordered or partially-filled list can't write a price onto the wrong tier. ---- */
  function renderValVpSettings(){
    const wrap = el('valVpPriceRows'); if(!wrap) return;
    el('valVpCurrency').value = (state.valorant.vp && state.valorant.vp.currency) || '';
    wrap.innerHTML = valVpPackages().map(p=>
      '<div class="val-vp-price-row">'
      + '<span class="val-store-item-price">'+p.vp.toLocaleString()+'</span>'
      + '<input type="number" min="0" step="0.01" inputmode="decimal" data-vp-price="'+p.vp+'"'
        + ' aria-label="Price of the '+p.vp+' VP package" placeholder="—"'
        + (p.price ? ' value="'+p.price+'"' : '') + '>'
      + '</div>').join('');
    renderValVpOffers();
  }
  /* Every field here is editable in place. Prices move — a shop's discount this month isn't next
     month's — and re-typing a row from scratch to change one number is the kind of friction that
     ends with a stale price quietly steering the calculator. Grouped by seller: renaming the group
     renames its rows (that *is* the categorising operation), and its checkbox takes the whole
     seller out of consideration without deleting anything you'd have to re-enter later. */
  /* Which sellers are expanded. Not persisted (same call as the owned-skins sort) and default
     *collapsed*: a shop with six tiers is six rows of inputs you only look at when a price
     changes, and several shops stacked open is the crowding this fixes. The header stays
     readable while folded — name, count, cheapest rate — so collapsed isn't blind. */
  const valVpOfferOpen = new Set();

  function renderValVpOffers(){
    const wrap = el('valVpOfferRows'); if(!wrap) return;
    const groups = valVpOfferGroups();
    el('valVpUseOffers').checked = valVpUseOffers();
    el('valVpUseOffers').disabled = !groups.length;
    el('valVpSellerList').innerHTML = groups.map(g=>'<option value="'+escapeHtml(g.name)+'"></option>').join('');
    if(!groups.length){
      wrap.innerHTML = '<div class="val-peak-note">No third-party offers saved. Add one above — say a top-up shop selling 1,000 VP cheaper than Riot does — and it gets weighed against the official tiers.</div>';
      return;
    }
    wrap.innerHTML = groups.map(g=>{
      const open = valVpOfferOpen.has(g.name);
      return '<div class="val-vp-offer-group'+(g.on?'':' is-off')+'">'
      + '<div class="val-vp-offer-group-hdr">'
        + '<button type="button" class="val-vp-offer-fold" data-vp-seller-fold="'+escapeHtml(g.name)+'"'
          + ' aria-expanded="'+(open?'true':'false')+'" aria-label="'+(open?'Collapse ':'Expand ')+escapeHtml(g.name)+'">'
          + '<span class="wlg-chevron">'+(open?'▼':'▶')+'</span></button>'
        + '<label class="val-vp-offer-toggle" title="Use this seller\'s offers in the calculator">'
          + '<input type="checkbox" data-vp-seller-on="'+escapeHtml(g.name)+'"'+(g.on?' checked':'')+'>'
        + '</label>'
        + '<input type="text" class="val-vp-offer-name" value="'+escapeHtml(g.name)+'" maxlength="30"'
          + ' data-vp-seller-name="'+escapeHtml(g.name)+'" aria-label="Seller name">'
        // collapsed, the summary is all you get, so it carries the cheapest rate rather than only
        // a count — enough to tell whether this seller is worth opening
        + '<button type="button" class="val-vp-offer-group-count" data-vp-seller-fold="'+escapeHtml(g.name)+'" tabindex="-1">'
          + g.rows.length+' offer'+(g.rows.length===1?'':'s')
          + (open ? '' : escapeHtml(valVpGroupSummary(g)))
        + '</button>'
      + '</div>'
      + '<div class="val-vp-offer-group-body"'+(open?'':' style="display:none;"')+'>'
      + g.rows.map(o=>
          '<div class="val-vp-offer-row">'
          + '<input type="number" class="val-vp-offer-vp" min="1" step="25" inputmode="numeric"'
            + ' value="'+(parseInt(o.vp,10)||0)+'" data-vp-offer-vp="'+escapeHtml(o.id)+'" aria-label="VP amount">'
          + '<span class="val-vp-offer-sep">for</span>'
          + '<input type="number" class="val-vp-offer-price" min="0" step="0.01" inputmode="decimal"'
            + ' value="'+(Number(o.price)||0)+'" data-vp-offer-price="'+escapeHtml(o.id)+'" aria-label="Price">'
          // per-VP is the number that actually decides whether an offer is good, and it's the one
          // nobody wants to work out in their head across six rows
          + '<span class="val-vp-offer-rate">'+escapeHtml(valVpRateText(o))+'</span>'
          + '<button type="button" class="val-icon-btn" data-vp-offer-del="'+escapeHtml(o.id)+'"'
            + ' data-tile-title="Remove this offer"><span aria-hidden="true">✕</span></button>'
          + '</div>').join('')
      + '</div></div>';
    }).join('');
    applyValTileTitles(wrap);
  }
  // best per-VP rate in a group, for the collapsed header
  function valVpGroupSummary(g){
    const rates = g.rows.map(o=>({ vp:parseInt(o.vp,10)||0, price:Number(o.price)||0 }))
      .filter(o=>o.vp && o.price)
      .map(o=>o.price/o.vp);
    if(!rates.length) return '';
    return ' · from '+valFmtMoney(Math.round(Math.min(...rates)*10000)/10000)+'/VP';
  }
  // "₱0.38/VP · 22% off" — the second half only when the same VP amount is sold officially, since
  // that's the only honest comparison
  function valVpRateText(o){
    const vp = parseInt(o.vp,10)||0, price = Number(o.price)||0;
    if(!vp || !price) return '';
    const per = valFmtMoney(Math.round((price/vp)*10000)/10000)+'/VP';
    const official = valVpPackages().find(p=>p.vp === vp && p.price > 0);
    if(!official) return per;
    const off = Math.round((1 - price/official.price) * 100);
    return per + (off > 0 ? ' · '+off+'% off' : (off < 0 ? ' · '+(-off)+'% dearer' : ''));
  }
  el('valVpOfferAddBtn').addEventListener('click', ()=>{
    const vp = parseInt(el('valVpOfferVp').value, 10) || 0;
    const price = Number(el('valVpOfferPrice').value) || 0;
    // both halves are the offer — a VP amount with no price can't be compared against anything,
    // and a price with no VP amount buys nothing
    if(vp <= 0 || price <= 0) return;
    state.valorant.vp.offers = state.valorant.vp.offers || [];
    const name = el('valVpOfferName').value.trim() || 'Third party';
    state.valorant.vp.offers.push({ id: uid(), name, vp, price });
    // open the group it landed in — adding a row to a collapsed group would otherwise look like
    // nothing happened
    valVpOfferOpen.add(name);
    el('valVpOfferName').value = ''; el('valVpOfferVp').value = ''; el('valVpOfferPrice').value = '';
    save(); renderValVpOffers();
  });
  el('valVpOfferRows').addEventListener('click', e=>{
    const fold = e.target.closest('[data-vp-seller-fold]');
    if(fold){
      const name = fold.dataset.vpSellerFold;
      if(valVpOfferOpen.has(name)) valVpOfferOpen.delete(name); else valVpOfferOpen.add(name);
      renderValVpOffers(); // view-only, nothing to save
      return;
    }
    const btn = e.target.closest('[data-vp-offer-del]'); if(!btn) return;
    state.valorant.vp.offers = (state.valorant.vp.offers||[]).filter(o=>o.id !== btn.dataset.vpOfferDel);
    save(); renderValVpOffers();
  });
  // `change`, not `input`: every one of these re-renders (a rename regroups the list, a price
  // changes the per-VP figure beside it), and re-rendering mid-keystroke would take the caret
  el('valVpOfferRows').addEventListener('change', e=>{
    const t = e.target;
    const offers = state.valorant.vp.offers || [];
    const byId = id => offers.find(o=>o.id === id);
    if(t.dataset.vpOfferVp){
      const o = byId(t.dataset.vpOfferVp); if(!o) return;
      o.vp = Math.max(0, parseInt(t.value,10)||0);
    } else if(t.dataset.vpOfferPrice){
      const o = byId(t.dataset.vpOfferPrice); if(!o) return;
      o.price = Math.max(0, Number(t.value)||0);
    } else if(t.dataset.vpSellerName){
      // renaming the group renames its rows — merging into an existing name is a legitimate way
      // to fold two lists together, so it isn't guarded against
      const from = t.dataset.vpSellerName;
      const to = t.value.trim() || 'Third party';
      offers.forEach(o=>{ if(((o.name||'Third party').trim() || 'Third party') === from) o.name = to; });
      // carry the fold state across the rename, or editing a name would collapse the group you're
      // in the middle of working on
      if(valVpOfferOpen.delete(from)) valVpOfferOpen.add(to);
    } else if(t.dataset.vpSellerOn){
      const seller = t.dataset.vpSellerOn;
      offers.forEach(o=>{ if(((o.name||'Third party').trim() || 'Third party') === seller) o.on = t.checked; });
    } else return;
    save(); renderValVpOffers();
  });
  el('valVpUseOffers').addEventListener('change', ()=>{
    state.valorant.vp.useOffers = el('valVpUseOffers').checked;
    save();
  });
  el('valVpPriceRows').addEventListener('input', e=>{
    const input = e.target.closest('[data-vp-price]'); if(!input) return;
    const vp = parseInt(input.dataset.vpPrice,10);
    const pkg = (state.valorant.vp.packages||[]).find(p=>(parseInt(p.vp,10)||0) === vp);
    if(!pkg) return;
    pkg.price = Math.max(0, Number(input.value) || 0);
    save(); // no re-render: rewriting the rows mid-keystroke would take the caret with it
  });
  el('valVpCurrency').addEventListener('input', ()=>{
    state.valorant.vp.currency = el('valVpCurrency').value.trim();
    save();
  });

  // One row of a bundle's contents list. A bundle's items are the only thing in the store you
  // can't see from its tile — the banner is one piece of promo art for a bag of five or six
  // things — so the preview is where "what am I actually buying" gets answered, wishlist hits
  // included.
  function valPreviewItemRowHtml(it, wished){
    const price = parseInt(it.discountPrice,10) || parseInt(it.price,10) || 0;
    return '<div class="val-preview-item'+(wished?' wishlist-match':'')+'">'
      + (it.imageUrl
          ? '<img class="val-preview-item-img" src="'+escapeHtml(it.imageUrl)+'" alt="">'
          : '<span class="val-preview-item-img"></span>')
      + '<span class="val-preview-item-name">'+escapeHtml(it.name||'Unknown item')
        + (wished ? ' <span class="val-preview-item-wish" title="On your wishlist">★</span>' : '')
      + '</span>'
      + (it.type ? '<span class="val-preview-item-type">'+escapeHtml(it.type)+'</span>' : '')
      + (price ? '<span class="val-store-item-price">'+price.toLocaleString()+'</span>' : '')
      + '</div>';
  }

  // `view` is a normalized { name, subtitle, color, imageUrl, text, art, items } — daily skins,
  // accessory offers, bundles and owned skins all carry different fields, so each click handler
  // below maps its own item into this shape rather than this function having to know which list it
  // came from. `items` is the bundle's contents list and is absent for everything else.
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
      + artHtml
      + ((view.items && view.items.length)
          ? '<div class="val-preview-items">'
            + '<div class="val-preview-items-hdr">In this bundle</div>'
            + view.items.map(it => valPreviewItemRowHtml(it, it._wished)).join('')
            + '</div>'
          : '')
      // anything priced in VP gets the top-up calculator; Kingdom Credit offers and the equipped
      // card pass no vpCost and so get nothing
      + valVpCalcHtml(view.vpCost, view.accountLabel);
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
        vpCost: it.price,
        accountLabel: tile.dataset.previewLabel,
      });
    } else if(tile.dataset.previewKind === 'bundle'){
      const b = ds.bundle;
      if(!b) return;
      const price = parseInt(b.price,10)||0;
      const label = tile.dataset.previewLabel;
      openValItemPreview({
        name: b.name,
        subtitle: ['Featured Bundle', price ? price.toLocaleString()+' VP' : '', valStoreTimeLeft(ds.checkedAt, b.remainingSeconds)].filter(Boolean).join(' · '),
        color: '#F0D449',
        imageUrl: b.imageUrl,
        // the wishlist flag is resolved here rather than inside the preview, which has no idea
        // which account's list applies
        items: (b.items||[]).map(it => ({ ...it, _wished: valWishlistMatchesForItem(it.name, label).length > 0 })),
        vpCost: price,
        accountLabel: label,
      });
    } else if(tile.dataset.previewKind === 'night'){
      const it = ((ds.nightMarket && ds.nightMarket.offers)||[]).find(x=>x.uuid===uuid);
      if(!it) return;
      const was = parseInt(it.price,10)||0, now = parseInt(it.discountPrice,10)||0;
      openValItemPreview({
        name: it.name,
        subtitle: ['Night Market', it.discountPercent ? '-'+it.discountPercent+'%' : '',
                   now ? now.toLocaleString()+' VP' : '', was ? 'was '+was.toLocaleString() : '']
                  .filter(Boolean).join(' · '),
        color: VAL_NIGHT_COLOR,
        imageUrl: it.imageUrl,
        // what you'd actually pay, not the pre-discount price
        vpCost: now || was,
        accountLabel: tile.dataset.previewLabel,
      });
    } else if(tile.dataset.previewKind === 'identity'){
      // the equipped player card — same three crops as a player card bought from the accessory
      // shop, so it reuses the same `art` shape and gets the same side-by-side layout
      const id = ds.identity;
      if(!id) return;
      openValItemPreview({
        name: id.cardName,
        subtitle: ['Equipped Player Card', id.level ? 'Level '+id.level : ''].filter(Boolean).join(' · '),
        color: VAL_ACCESSORY_TYPE_COLORS['Player Card'],
        imageUrl: id.cardSmall,
        art: { wide: id.cardWide, large: id.cardLarge, small: id.cardSmall },
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

  /* ---- Store / Owned Skins switch above the store. The two shops (daily VP skins, weekly Kingdom
     Credit accessories) are one purchase decision and now stack in the same column under their own
     section headers; what's worth flipping between is that whole store and the collection you
     already own, which is the other thing keyed to the account switcher. Persisted, so the tab
     reopens on whichever pane you last looked at. Each pane's render function owns its own card's
     visibility — renderValorantStore() the store card, renderValOwnedSkins() the owned-skins card
     — so nothing here has to know which elements belong to which. ---- */
  // Owned mode is conditional on there being *some* local-helper data, because with none the
  // toggle is hidden — a persisted 'owned' would then strand a first-time user on an empty card
  // with no control to get back to the store's "run these scripts" setup message.
  function valStoreHasAnyData(){
    return !!(Object.keys(state.valorant.dailyStores||{}).length || Object.keys(state.valorant.ownedSkins||{}).length);
  }
  function valStoreOwnedMode(){ return state.valorant.storeMode === 'owned' && valStoreHasAnyData(); }
  function renderValStoreModeToggle(){
    const owned = valStoreOwnedMode();
    el('valStoreModeBtnStore').classList.toggle('active', !owned);
    el('valStoreModeBtnOwned').classList.toggle('active', owned);
  }
  el('valStoreModeToggle').addEventListener('click', e=>{
    const btn = e.target.closest('[data-storemode]');
    if(!btn) return;
    state.valorant.storeMode = btn.dataset.storemode;
    save(); renderValStoreModeToggle(); renderValorantStore(); renderValOwnedSkins();
  });

  function renderValorantStore(){
    const wrap = el('valStoreCard'); if(!wrap) return;
    const unavailable = usingClaudeStorage || !supabaseConfigured;
    el('valStoreUnavailable').style.display = unavailable ? 'block' : 'none';
    // the pane stays visible here even with no store to show: the wishlist column lives inside it
    // and is editable in this mode, which is how it behaved before the toggle picked panes
    if(unavailable){ wrap.innerHTML = ''; el('valStoreModeToggle').style.display = 'none'; el('valStorePane').style.display = ''; return; }
    renderValStoreModeToggle();
    // the store card carries the wishlist column beside it, so the whole card is the "Store" pane
    el('valStorePane').style.display = valStoreOwnedMode() ? 'none' : '';

    const stores = state.valorant.dailyStores || {};
    const allLabels = Object.keys(stores);
    // The toggle also reaches Owned Skins, so owned data alone is enough to justify showing it —
    // gating purely on store data would strand the owned-skins pane behind a hidden control.
    el('valStoreModeToggle').style.display = valStoreHasAnyData() ? 'inline-flex' : 'none';
    if(valStoreOwnedMode()) return; // pane is hidden; nothing below would be seen
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
      const hasWishMatch = label =>
        valOfferedItems(stores[label]).some(it => valWishlistMatchesForItem(it.name, label).length > 0);
      labels.sort((a,b) => (hasWishMatch(b)?1:0) - (hasWishMatch(a)?1:0));
    }

    // Built from allLabels, not `labels`: it's the same bundle for every account, so filtering the
    // view down to one account shouldn't be able to hide it.
    const bundleHtml = valFeaturedBundleHtml(stores, allLabels);

    wrap.innerHTML = bundleHtml + labels.map(label=>{
      const ds = stores[label] || {};
      const hdrHtml = valStoreHeader(label, ds);
      if(ds.error){
        // an expired session is the one store error you can actually fix from here, so the button
        // is offered for that case only — a Riot outage shouldn't invite a pointless re-login.
        // escapeHtml() round-trips through textContent and so leaves double quotes alone; an
        // account label going into an attribute needs them handled here.
        const canRelogin = /expired|invalid|incomplete/i.test(ds.error);
        const reloginBtn = canRelogin
          ? '<button class="btn btn-ghost btn-sm val-relogin-btn" data-val-relogin="'+escapeHtml(label).replace(/"/g,'&quot;')+'">🔑 Re-login</button>'
          : '';
        return '<div class="val-store-account val-store-account-error">'+hdrHtml+'<div class="val-err"><span aria-hidden="true">⚠</span> '+escapeHtml(ds.error)+reloginBtn+'</div></div>';
      }
      if(!ds.checkedAt){
        return '<div class="val-store-account val-store-account-empty">'+hdrHtml+'<div class="val-peak-note">No store data yet — run scripts/valorant-check-store.mjs locally (see README.md "Setup").</div></div>';
      }
      // Every shop this account has open, stacked, each under its own header carrying its own
      // countdown — they refresh on completely different clocks (daily VP, weekly Kingdom Credits,
      // and a night market that runs for a couple of weeks an act), which is exactly what a reader
      // needs side by side to decide what to spend on. `lead` hands the brighter header to
      // whichever section is first: the night market outranks the daily offers when it's open,
      // because it's the one that won't be there next month.
      let lead = true;
      let html = '';

      const nm = ds.nightMarket;
      if(nm && (nm.offers||[]).length){
        html += valStoreSectionHdr('Night Market', valStoreTimeLeft(ds.checkedAt, nm.remainingSeconds), lead);
        lead = false;
        html += '<div class="val-store-grid">';
        nm.offers.forEach(o=>{
          const isWish = valWishlistMatchesForItem(o.name, label).length > 0;
          const was = parseInt(o.price,10)||0, now = parseInt(o.discountPrice,10)||0;
          const off = parseInt(o.discountPercent,10)||0;
          html += '<button type="button" class="val-store-item val-night-item'+(isWish?' wishlist-match':'')+'" style="--rarity-color:'+VAL_NIGHT_COLOR+';"'
            + ' data-preview-kind="night" data-preview-label="'+escapeHtml(label)+'" data-preview-uuid="'+escapeHtml(o.uuid||'')+'"'
            + ' data-tile-title="'+escapeHtml(o.name+' — Night Market'+(off?' −'+off+'%':'')+(was?' — was '+was.toLocaleString()+' VP':'')+' — click to enlarge')+'">'
            + (off ? '<span class="val-night-discount">−'+off+'%</span>' : '')
            + (isWish ? '<span class="val-store-item-wish-badge" title="On your wishlist"><span aria-hidden="true">★</span></span>' : '')
            + '<span class="val-store-item-img">'+(o.imageUrl ? '<img src="'+escapeHtml(o.imageUrl)+'" alt="">' : '')+'</span>'
            + '<span class="val-store-item-footer">'
            + '<span class="val-store-item-name">'+escapeHtml(o.name)+'</span>'
            + '<span class="val-store-item-price" title="Valorant Points">'+(now||was).toLocaleString()+'</span>'
            + '</span></button>';
        });
        html += '</div>';
      }

      const items = ds.items || [];
      html += valStoreSectionHdr('Daily Offers', valStoreTimeLeft(ds.checkedAt, ds.itemsRemainingSeconds), lead);
      lead = false;
      html += '<div class="val-store-grid">';
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

      // accessory shop (Kingdom Credits — sprays/buddies/cards/titles, weekly rotation). Absent
      // from stores checked before this was added, so an older dailyStores entry shows the
      // re-check note under the header until its next check fills this in.
      const accessories = ds.accessories || [];
      html += valStoreSectionHdr('Accessories', valStoreTimeLeft(ds.checkedAt, ds.accessoriesRemainingSeconds));
      if(!accessories.length){
        html += '<div class="val-peak-note">No accessory offers in this store check — re-run scripts/valorant-check-store.mjs locally (checks from before accessory support don\'t include them).</div>';
      } else {
        html += '<div class="val-store-grid val-accessory-grid">';
        accessories.forEach(ac=>{
          const color = valAccessoryTypeColor(ac.type);
          const isWish = valWishlistMatchesForItem(ac.name, label).length > 0;
          const title = ac.name + (ac.type ? ' — ' + ac.type : '') + (isWish ? ' — on your wishlist' : '') + ' — click to enlarge';
          html += '<button type="button" class="val-store-item val-accessory-item'+(isWish?' wishlist-match':'')+'" style="--rarity-color:'+color+';"'
            + ' data-preview-kind="accessory" data-preview-label="'+escapeHtml(label)+'" data-preview-uuid="'+escapeHtml(ac.uuid||'')+'"'
            + ' data-tile-title="'+escapeHtml(title)+'">'
            + (isWish ? '<span class="val-store-item-wish-badge" title="On your wishlist"><span aria-hidden="true">★</span></span>' : '')
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
            // </span>, not </div>: a stray </div> here closed the grid container itself (a <button>
            // isn't a scoping element for a div end tag), so every tile after the first was parsed
            // as a sibling of the grid instead of a cell in it — which is why the accessory shop
            // rendered as a column of full-width cards no matter what the grid rules said
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
    // the second pane of the Store / Owned Skins toggle — hidden whenever the store is showing
    if(unavailable || !valStoreOwnedMode()){ card.style.display = 'none'; return; }
    card.style.display = 'block';

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
      // A login window belongs to the machine, not to this page — reloading mid-sign-in, or
      // opening the tab in a second window, must find the one that's already open rather than
      // offer a button that would only be refused.
      adoptValLoginWindow(json.loginWindow);
    }catch(e){
      valLocalStatus.connected = false;
      valLocalStatus.accounts = [];
    }
    renderValLocalPanel();
    // the helper appearing/disappearing is what starts or stops the live poll loop
    renderValLive();
    // ...and the TFT lobby card, which polls the same helper through POST /tft-live. Called from
    // here rather than left to renderTft() because nothing else re-renders that tab while you sit
    // on it, so starting the helper would otherwise leave the card saying "not running" until you
    // navigated away and back. Guarded because valorant.js parses before tft.js defines it.
    if(typeof renderTftLobby === 'function') renderTftLobby();
  }

  /* ---- Account switcher: chips, not a dropdown.
     The set is the union of accounts the helper has a session for and accounts that already have
     store or inventory data, so a device without the helper running still shows everything it can
     read. "All" only appears when there's more than one account to combine.
     valSelectedLabel() is the single reader of the current choice — the <select> used to be the
     source of truth for Settings' buttons too, and state was only a mirror of it. ---- */
  function valAccountLabels(){
    return Array.from(new Set([
      ...valLocalStatus.accounts,
      ...Object.keys(state.valorant.dailyStores||{}),
      ...Object.keys(state.valorant.ownedSkins||{}),
    ]));
  }
  // "" means All. A label that has since been deleted falls back to All rather than filtering the
  // store down to an account that no longer exists.
  function valSelectedLabel(){
    const labels = valAccountLabels();
    return labels.includes(state.valorant.selectedStoreLabel) ? state.valorant.selectedStoreLabel : '';
  }

  let valAcctRenaming = '';   // label being renamed, '' when not renaming — not persisted

  function fitValAcctChips(wrap){
    // Only the selected account stays expanded. Every other account is a compact circular
    // player-card button, which keeps the switcher predictable regardless of label length.
    const chips = Array.from(wrap.querySelectorAll('.val-acct-chip:not(.is-all)'));
    chips.forEach(chip=>chip.classList.remove('is-icon-only'));
    chips.forEach(chip=>{
      if(!chip.classList.contains('active')) chip.classList.add('is-icon-only');
    });
  }

  function captureValAcctChipRects(wrap){
    const rects = new Map();
    wrap.querySelectorAll('[data-acct]').forEach(chip=>{
      rects.set(chip.getAttribute('data-acct'), chip.getBoundingClientRect());
    });
    return rects;
  }

  function animateValAcctChipLayout(wrap, before){
    // FLIP animation: render the new selection immediately, then visually move each new chip
    // from its old bounds. It animates the expand/minimize change without delaying the UI state.
    requestAnimationFrame(()=>{
      wrap.querySelectorAll('[data-acct]').forEach(chip=>{
        const oldRect = before.get(chip.getAttribute('data-acct'));
        const newRect = chip.getBoundingClientRect();
        if(!oldRect || !newRect.width || !newRect.height) return;
        const dx = oldRect.left - newRect.left;
        const dy = oldRect.top - newRect.top;
        const sizeChanged = Math.abs(oldRect.width-newRect.width) > .5 || Math.abs(oldRect.height-newRect.height) > .5;
        if(Math.abs(dx) < .5 && Math.abs(dy) < .5 && !sizeChanged) return;
        const timing = { duration:340, easing:'cubic-bezier(.22,1.12,.36,1)' };
        chip.animate([
          { opacity:.82, transform:'translate('+dx+'px,'+dy+'px)' },
          { opacity:1, transform:'translate(0,0)' }
        ], timing);
        // Expansion is revealed from the avatar side instead of scaling the whole chip. That
        // leaves the circular player-card artwork at its natural size throughout.
        if(chip.classList.contains('active') && sizeChanged){
          chip.animate([
            { clipPath:'inset(0 calc(100% - 40px) 0 0 round 999px)' },
            { clipPath:'inset(0 0 0 0 round 999px)' }
          ], timing);
        }
      });
    });
  }

  function renderValAcctSwitcher(){
    const wrap = el('valAcctSwitcher'); if(!wrap) return;
    const renameWrap = el('valAcctRename');
    if(valAcctRenaming){
      wrap.style.display = 'none';
      if(renameWrap) renameWrap.style.display = 'flex';
      return;
    }
    wrap.style.display = 'flex';
    if(renameWrap) renameWrap.style.display = 'none';

    const labels = valAccountLabels();
    const selected = valSelectedLabel();
    const stores = state.valorant.dailyStores || {};
    const stale = valExpiredSessionLabels();
    // counted once for the row: one wishlist entry can match two store items, so count skins
    const wishHits = {};
    valCurrentWishlistMatches().forEach(m=>{
      (wishHits[m.label] || (wishHits[m.label] = new Set())).add(m.wishlistId);
    });

    let html = '';
    if(labels.length > 1){
      html += '<button type="button" role="tab" class="val-acct-chip is-all'+(selected===''?' active':'')+'"'
        + ' aria-selected="'+(selected===''?'true':'false')+'" data-acct="">All</button>';
    }
    html += labels.map(label=>{
      const ds = stores[label] || {};
      // the equipped player card, already fetched by the store check — an account is easier to
      // recognise by its card than by whatever it got called
      const img = ds.identity && (ds.identity.cardSmall || ds.identity.cardWide);
      const hits = wishHits[label] ? wishHits[label].size : 0;
      const isStale = stale.includes(label);
      const active = selected === label;
      // escapeHtml() leaves double quotes alone, so anything going into an attribute needs them
      const attr = escapeHtml(label).replace(/"/g,'&quot;');
      return '<button type="button" role="tab" class="val-acct-chip'+(active?' active':'')+'"'
        + ' aria-selected="'+(active?'true':'false')+'" aria-label="'+attr+'" data-acct="'+attr+'" title="'+attr+'">'
        + (img ? '<img class="val-acct-chip-img" src="'+escapeHtml(img).replace(/"/g,'&quot;')+'" alt="">' : '')
        + '<span class="val-acct-chip-name">'+escapeHtml(label)+'</span>'
        + (hits ? '<span class="val-acct-chip-mark is-wish" aria-hidden="true" title="Wishlisted skin in today\'s store">★</span>' : '')
        + (isStale ? '<span class="val-acct-chip-mark is-stale" aria-hidden="true" title="Session needs re-login">⚠</span>' : '')
        + '</button>';
    }).join('');
    if(selected){
      html += '<button type="button" class="val-acct-edit" id="valAcctEditBtn"'
        + ' title="Rename this account" aria-label="Rename this account"><span aria-hidden="true">✎</span></button>';
    }
    wrap.innerHTML = html;
    requestAnimationFrame(()=>fitValAcctChips(wrap));
  }

  function startValAcctRename(){
    const label = valSelectedLabel(); if(!label) return;
    valAcctRenaming = label;
    renderValAcctSwitcher();
    const input = el('valAcctRenameInput');
    input.value = label;
    input.focus();
    input.select();
  }
  function cancelValAcctRename(){
    valAcctRenaming = '';
    renderValAcctSwitcher();
  }

  // The label is the key in five places: the helper's session file, the widget's snapshot file,
  // and dailyStores / ownedSkins / wishlist in the shared row (plus live.label, which pins an
  // account for Live Match). The helper owns the two files; everything else moves here and rides
  // out on the next save().
  async function commitValAcctRename(){
    const from = valAcctRenaming;
    const to = el('valAcctRenameInput').value.trim();
    if(!from) return;
    if(!to){ showValLocalErr('Give the account a name.', 'valSettingsLocalErr'); return; }
    if(to === from){ cancelValAcctRename(); return; }
    if(valAccountLabels().includes(to)){ showValLocalErr('"'+to+'" is already a tracked account.', 'valSettingsLocalErr'); return; }
    if(!valLocalStatus.connected){
      showValLocalErr('Renaming needs the local helper running — it holds the saved session under that name.', 'valSettingsLocalErr');
      return;
    }

    const saveBtn = el('valAcctRenameSaveBtn');
    saveBtn.disabled = true; saveBtn.textContent = 'Renaming…';
    try{
      const res = await fetch(valLocalUrl()+'/rename-account', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ token: state.valorant.localServerToken, from, to })
      });
      const json = await res.json().catch(()=>null);
      if(!res.ok || !json || json.ok===false) throw new Error((json && json.error) || ('Rename failed (HTTP '+res.status+').'));

      // move every per-account bucket. Done after the helper agreed, so a failure there leaves the
      // page's data and the session file agreeing on the old name rather than disagreeing.
      ['dailyStores','ownedSkins','wishlist'].forEach(key=>{
        const bag = state.valorant[key];
        if(bag && Object.prototype.hasOwnProperty.call(bag, from)){
          bag[to] = bag[from];
          delete bag[from];
        }
      });
      if(state.valorant.selectedStoreLabel === from) state.valorant.selectedStoreLabel = to;
      if(state.valorant.live && state.valorant.live.label === from) state.valorant.live.label = to;
      save();

      valAcctRenaming = '';
      await pollValLocalStatus();
      renderValorantStore();
      renderValWishlist();
      renderValOwnedSkins();
    }catch(e){
      showValLocalErr((e && e.message) || 'Could not reach the local helper.', 'valSettingsLocalErr');
    }
    saveBtn.disabled = false; saveBtn.textContent = 'Save';
    renderValAcctSwitcher();
  }

  function renderValLocalPanel(){
    const chip = el('valLocalStatusBtn'); if(!chip) return;
    const credsWrap = el('valLocalCredsPanel');
    const unavailable = usingClaudeStorage || !supabaseConfigured;
    chip.style.display = unavailable ? 'none' : 'inline-flex';
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
    // shown in two places — inside the Shop Tracker's ⓘ modal (the tab itself only needs the dot,
    // since the account switcher there just filters already-fetched data and works with or without
    // the helper) and next to the actual Check Store Now / Delete / Add Account controls in
    // Settings, since those genuinely need the local helper running
    el('valLocalStatusTxt').innerHTML = statusHtml;
    const settingsStatusEl = el('valSettingsLocalStatusTxt');
    if(settingsStatusEl) settingsStatusEl.innerHTML = statusHtml;
    const addAcctStatusEl = el('valAddAccountHelperTxt');
    if(addAcctStatusEl) addAcctStatusEl.innerHTML = statusHtml;

    // the chip is the whole status on this tab: dot for the state, and an accessible name that
    // says it rather than leaving a screen reader with "Helper ⓘ"
    const n = valLocalStatus.accounts.length;
    el('valLocalDot').className = 'val-local-dot ' + (valLocalStatus.connected ? 'on' : 'off');
    chip.classList.toggle('is-on', !!valLocalStatus.connected);
    const chipTxt = valLocalStatus.connected
      ? 'Local helper connected' + (n ? ' · '+n+' account'+(n===1?'':'s')+' saved' : '')
      : 'Local helper not running';
    chip.title = chipTxt + ' — click for details';
    chip.setAttribute('aria-label', chipTxt + ' — details');

    // union of accounts the local server has a saved session for, and accounts that already
    // have store data — so a device without the local server running (or an account it doesn't
    // know about yet) can still pick from and view whatever's already been checked
    renderValAcctSwitcher();

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
    el('valLocalDeleteBtn').disabled = disabled || !valSelectedLabel();
    el('valLocalDeleteBtn').textContent = (valLocalStatus.busy && valLocalStatus.busyMsg==='delete') ? 'Deleting…' : '🗑 Delete';
    renderValLoginWinUi();
  }

  /* ---- standalone VP calculator: the same planner, pointed at a number you type instead of a
     skin you clicked — for the case where the thing you're saving for isn't in a store you can
     click (a battlepass, a bundle you've seen elsewhere, next month's plan). Mode matters: "it
     costs this much" subtracts the picked account's balance, "I need this much more" takes the
     number as the shortfall already. ---- */
  let valVpCalcMode = 'price';           // not persisted — resets to the commoner question
  let valVpCalcReturnFocus = null;
  function renderValVpCalcModal(){
    el('valVpCalcModeBtnPrice').classList.toggle('active', valVpCalcMode === 'price');
    el('valVpCalcModeBtnNeed').classList.toggle('active', valVpCalcMode === 'need');
    const amount = Math.max(0, parseInt(el('valVpCalcInput').value,10)||0);
    const out = el('valVpCalcOut');
    if(!amount){ out.innerHTML = ''; return; }
    const label = state.valorant.selectedStoreLabel;
    out.innerHTML = valVpCalcHtml(amount, label, {
      title: valVpCalcMode === 'need' ? 'Topping up' : 'Buying it',
      priceLabel: valVpCalcMode === 'need' ? 'You need' : 'Price',
      rawDeficit: valVpCalcMode === 'need',
      // the balance is per account, so say whose is being used — the switcher behind this modal
      // is easy to forget about
      note: (valVpCalcMode === 'price' && label) ? 'Against '+label+'’s balance' : '',
    });
  }
  function openValVpCalc(){
    el('valVpCalcOverlay').style.display = 'flex';
    valVpCalcReturnFocus = document.activeElement;
    renderValVpCalcModal();
    el('valVpCalcInput').focus();
    el('valVpCalcInput').select();
  }
  function closeValVpCalc(){
    el('valVpCalcOverlay').style.display = 'none';
    if(valVpCalcReturnFocus && document.contains(valVpCalcReturnFocus)) valVpCalcReturnFocus.focus();
    valVpCalcReturnFocus = null;
  }
  el('valVpCalcBtn').addEventListener('click', openValVpCalc);
  el('valVpCalcCloseBtn').addEventListener('click', closeValVpCalc);
  // on `input`, not `change`: the whole point is watching the plan change as the number does, and
  // nothing here is persisted, so there's no save to debounce
  el('valVpCalcInput').addEventListener('input', renderValVpCalcModal);
  el('valVpCalcModeToggle').addEventListener('click', e=>{
    const btn = e.target.closest('[data-vpmode]'); if(!btn) return;
    valVpCalcMode = btn.dataset.vpmode;
    renderValVpCalcModal();
  });
  el('valVpCalcOverlay').addEventListener('click', e=>{
    if(e.target === el('valVpCalcOverlay')) closeValVpCalc();
  });
  document.addEventListener('keydown', e=>{
    if(e.key === 'Escape' && el('valVpCalcOverlay').style.display === 'flex') closeValVpCalc();
  });

  /* ---- local helper ⓘ: same open/close grammar as the wishlist and preview modals. Nothing in
     here is actionable — it's the explanation the old standing card carried, kept one click away
     instead of permanently on screen. ---- */
  let valLocalInfoReturnFocus = null;
  function openValLocalInfo(){
    renderValLocalPanel(); // the helper may have gone up or down since the last poll painted
    el('valLocalInfoOverlay').style.display = 'flex';
    valLocalInfoReturnFocus = document.activeElement;
    el('valLocalInfoCloseBtn').focus();
  }
  function closeValLocalInfo(){
    el('valLocalInfoOverlay').style.display = 'none';
    if(valLocalInfoReturnFocus && document.contains(valLocalInfoReturnFocus)) valLocalInfoReturnFocus.focus();
    valLocalInfoReturnFocus = null;
  }
  el('valLocalStatusBtn').addEventListener('click', openValLocalInfo);
  el('valLocalInfoCloseBtn').addEventListener('click', closeValLocalInfo);
  el('valLocalInfoOverlay').addEventListener('click', e=>{
    if(e.target === el('valLocalInfoOverlay')) closeValLocalInfo();
  });
  document.addEventListener('keydown', e=>{
    if(e.key === 'Escape' && el('valLocalInfoOverlay').style.display === 'flex') closeValLocalInfo();
  });

  el('valLocalSaveTokenBtn').addEventListener('click', ()=>{
    state.valorant.localServerToken = el('valLocalToken').value.trim();
    save();
    pollValLocalStatus();
  });

  // delegated: the chips are rebuilt by every renderValAcctSwitcher()
  el('valAcctSwitcher').addEventListener('click', e=>{
    const edit = e.target.closest && e.target.closest('#valAcctEditBtn');
    if(edit){ startValAcctRename(); return; }
    const chip = e.target.closest && e.target.closest('[data-acct]');
    if(!chip) return;
    const switcher = el('valAcctSwitcher');
    const before = captureValAcctChipRects(switcher);
    state.valorant.selectedStoreLabel = chip.getAttribute('data-acct');
    save();
    renderValAcctSwitcher();
    animateValAcctChipLayout(switcher, before);
    renderValorantStore();
    renderValWishlist(); // wishlist is per-account, so it needs to follow the same switcher
    renderValOwnedSkins(); // ditto — owned skins are per account too
  });
  el('valAcctRenameSaveBtn').addEventListener('click', commitValAcctRename);
  el('valAcctRenameCancelBtn').addEventListener('click', cancelValAcctRename);
  el('valAcctRenameInput').addEventListener('keydown', e=>{
    if(e.key === 'Enter') commitValAcctRename();
    else if(e.key === 'Escape'){ e.stopPropagation(); cancelValAcctRename(); }
  });

  // Shared by the Check Store Now button and by a successful re-login (which chains straight into
  // a check — the whole reason you re-logged in is that the last one couldn't run). Pass no label
  // to check every saved account.
  async function runValStoreCheck(label, errTarget){
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
      showValLocalErr((e && e.message) || 'Could not reach the local helper.', errTarget);
    }
    valLocalStatus.busy = false; valLocalStatus.busyMsg = ''; renderValLocalPanel();
  }

  el('valLocalCheckBtn').addEventListener('click', async ()=>{
    el('valSettingsLocalErr').style.display = 'none';
    await runValStoreCheck(valSelectedLabel());
  });

  el('valLocalCheckInventoryBtn').addEventListener('click', async ()=>{
    el('valSettingsLocalErr').style.display = 'none';
    const label = valSelectedLabel();
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
    const label = valSelectedLabel();
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
    const clid = el('valLocalNewClid').value.trim();
    if(!label){ showValLocalErr('Enter a label for this account, e.g. "main".', 'valSettingsLocalErr'); return; }
    if(!ssid){ showValLocalErr('Paste the ssid cookie value (see the note below) — log into playvalorant.com in your own browser first, then copy it from DevTools.', 'valSettingsLocalErr'); return; }
    // not optional: Riot refuses an ssid-only reauth in a way that reads as "session expired",
    // so accepting one here would just save a session that silently never works
    if(!clid){ showValLocalErr('Paste the clid cookie value too — it sits next to ssid under auth.riotgames.com, and Riot rejects the session without it.', 'valSettingsLocalErr'); return; }
    valLocalStatus.busy = true; valLocalStatus.busyMsg = 'login'; renderValLocalPanel();
    try{
      const res = await fetch(valLocalUrl()+'/login', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ token: state.valorant.localServerToken, label, ssid, clid })
      });
      const json = await res.json().catch(()=>null);
      if(!res.ok || !json || json.ok===false) throw new Error((json && json.error) || ('Login failed (HTTP '+res.status+').'));
      el('valLocalNewLabel').value = '';
      el('valLocalNewSsid').value = '';
      el('valLocalNewClid').value = '';
    }catch(e){
      showValLocalErr((e && e.message) || 'Could not reach the local helper.', 'valSettingsLocalErr');
    }
    valLocalStatus.busy = false; valLocalStatus.busyMsg = '';
    await pollValLocalStatus();
  });

  /* ---- "Log in with browser": the fix for an expired session, without the DevTools trip.
     The page itself can never read this cookie — it belongs to auth.riotgames.com and is
     HttpOnly, so no amount of JavaScript here gets near it. What this does is ask the local
     helper to open a small, empty browser window on Riot's own login page; you sign in there by
     hand (nothing is typed for you, and nothing pretends to Riot that the window is anything
     other than what it is — see the header of scripts/valorant-login-window.mjs), and the helper
     lifts the resulting ssid straight out of that window and saves it under the label. The
     manual paste below stays: if Riot ever refuses this window, that's the way through, not a
     more convincing disguise.

     Signing in takes minutes, not milliseconds, so the helper runs it as a job and this polls —
     one login window at a time, machine-wide, which is why this state is a single object rather
     than one per button. ---- */
  let valLoginWin = { active:false, status:'', label:'', msg:'', timer:null };

  function renderValLoginWinUi(){
    const busy = valLoginWin.active;
    const btn = el('valLocalLoginWindowBtn');
    if(btn){
      btn.disabled = !valLocalStatus.connected || valLocalStatus.busy || busy;
      btn.textContent = busy ? 'Waiting for sign-in…' : '🌐 Log in with browser';
    }
    const cancelBtn = el('valLocalLoginWindowCancelBtn');
    if(cancelBtn) cancelBtn.style.display = busy ? 'inline-flex' : 'none';
    // the Add-account modal carries its own pair of these; one job, two places showing it
    const mBtn = el('valAddAccountWindowBtn');
    if(mBtn){
      mBtn.disabled = !valLocalStatus.connected || valLocalStatus.busy || busy;
      mBtn.textContent = busy ? 'Waiting for sign-in…' : '🌐 Log in with browser';
    }
    const mCancel = el('valAddAccountWindowCancelBtn');
    if(mCancel) mCancel.style.display = busy ? 'inline-flex' : 'none';
    [el('valLoginWindowStatus'), el('valAddAccountWindowStatus')].forEach(st=>{
      if(!st) return;
      st.textContent = valLoginWin.msg || '';
      st.style.display = valLoginWin.msg ? 'block' : 'none';
    });
    // the same job seen from the other end: the Re-login buttons sitting in the store's
    // expired-session banners. They're rebuilt by every store render, so they're addressed by
    // query rather than held onto.
    // only the account a window is actually open for — the button opens a paste dialog now, so
    // blocking every other account's while one sign-in is in flight would just be in the way
    document.querySelectorAll('[data-val-relogin]').forEach(b=>{
      const mine = busy && b.getAttribute('data-val-relogin') === valLoginWin.label;
      b.disabled = mine;
      b.textContent = mine ? 'Waiting for sign-in…' : '🔑 Re-login';
    });
  }

  async function valLoginWindowPost(pathname, extra){
    const res = await fetch(valLocalUrl()+pathname, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(Object.assign({ token: state.valorant.localServerToken }, extra||{}))
    });
    const json = await res.json().catch(()=>null);
    if(!res.ok || !json || json.ok===false) throw new Error((json && json.error) || ('Request failed (HTTP '+res.status+').'));
    return json;
  }

  function pollValLoginWindow(errTarget, autoCheck){
    valLoginWin.timer = setTimeout(async ()=>{
      let json;
      try{ json = await valLoginWindowPost('/login-window-status'); }
      catch(e){
        valLoginWin.active = false; valLoginWin.msg = ''; renderValLoginWinUi();
        showValLocalErr((e && e.message) || 'Lost contact with the local helper.', errTarget);
        return;
      }
      valLoginWin.status = json.status;
      if(json.status === 'opening' || json.status === 'waiting'){
        valLoginWin.msg = json.status === 'opening'
          ? 'Opening a login window on the machine running the local helper…'
          : 'Waiting for you to sign in — a small browser window is open on the machine running the local helper. Once you\'re through, the session saves itself.';
        renderValLoginWinUi();
        pollValLoginWindow(errTarget, autoCheck);
        return;
      }
      const label = valLoginWin.label;
      valLoginWin.active = false;
      if(json.status === 'done'){
        valLoginWin.msg = 'Saved a fresh session for "'+label+'".';
        if(el('valLocalNewLabel')) el('valLocalNewLabel').value = '';
        if(el('valLocalNewSsid')) el('valLocalNewSsid').value = '';
        if(el('valLocalNewClid')) el('valLocalNewClid').value = '';
        if(el('valAddAccountSsid')) el('valAddAccountSsid').value = '';
        if(el('valAddAccountClid')) el('valAddAccountClid').value = '';
        if(el('valAddAccountOverlay') && el('valAddAccountOverlay').style.display === 'flex') closeValAddAccount();
        renderValLoginWinUi();
        await pollValLocalStatus();
        // an expired session is the reason this button exists, and that account's store is stale
        // by definition — so finish the job rather than leaving the old error on screen
        if(autoCheck) await runValStoreCheck(label, errTarget);
        renderValLoginWinUi(); // the store re-render above rebuilt the Re-login buttons
      } else {
        valLoginWin.msg = '';
        renderValLoginWinUi();
        showValLocalErr(json.error || 'The login window closed before the sign-in finished.', errTarget);
      }
    }, 1500);
  }

  async function startValLoginWindow(label, opts){
    const errTarget = (opts && opts.errTarget) || 'valSettingsLocalErr';
    const errEl = el(errTarget); if(errEl) errEl.style.display = 'none';
    if(valLoginWin.active) return;
    if(!label){ showValLocalErr('Enter a label for this account first, e.g. "main".', errTarget); return; }
    if(!valLocalStatus.connected){ showValLocalErr('The local helper isn\'t running — start it with `node scripts/valorant-local-server.mjs` on this machine.', errTarget); return; }
    valLoginWin = { active:true, status:'opening', label:label, msg:'Opening a login window on the machine running the local helper…', timer:null };
    renderValLoginWinUi();
    try{
      await valLoginWindowPost('/login-window', { label });
    }catch(e){
      valLoginWin.active = false; valLoginWin.msg = ''; renderValLoginWinUi();
      showValLocalErr((e && e.message) || 'Could not reach the local helper.', errTarget);
      return;
    }
    pollValLoginWindow(errTarget, !!(opts && opts.autoCheck));
  }

  function adoptValLoginWindow(lw){
    if(valLoginWin.active) return;
    if(!lw || (lw.status !== 'opening' && lw.status !== 'waiting')) return;
    // the status poll below needs the token; without one, adopting would only produce a repeating
    // "Invalid token" on a page that never asked for any of this
    if(!state.valorant.localServerToken) return;
    valLoginWin = { active:true, status:lw.status, label:lw.label || '', msg:'Waiting for a sign-in already in progress on this machine…', timer:null };
    renderValLoginWinUi();
    pollValLoginWindow('valSettingsLocalErr', false);
  }

  if(el('valLocalLoginWindowBtn')){
    el('valLocalLoginWindowBtn').addEventListener('click', ()=>{
      startValLoginWindow(el('valLocalNewLabel').value.trim(), { errTarget:'valSettingsLocalErr' });
    });
  }
  if(el('valLocalLoginWindowCancelBtn')){
    el('valLocalLoginWindowCancelBtn').addEventListener('click', async ()=>{
      // closes the window on the helper's side; the poll above then sees 'cancelled' and clears up
      try{ await valLoginWindowPost('/login-window-cancel'); }catch(e){ /* the poll reports it */ }
    });
  }

  // Delegated, because these buttons live inside markup renderValorantStore() rebuilds wholesale.
  // Opens the paste dialog rather than launching a browser window: re-logging in is usually a
  // copy of two cookies you already have open in DevTools, and a window that opens itself is a
  // worse default than one you can still choose from inside the dialog.
  document.addEventListener('click', e=>{
    const btn = e.target && e.target.closest && e.target.closest('[data-val-relogin]');
    if(!btn) return;
    openValAddAccount({ label: btn.getAttribute('data-val-relogin') });
  });

  /* ---- Add account, from the Shop Tracker itself rather than from Settings. Two ways in, both
     ending at the same POST /login: the browser window (which captures the whole cookie jar), or
     a pasted ssid.

     clid is deliberately a second, optional field rather than a required one. Riot validates it —
     only the account's own cluster code is accepted — but a session that lives on the *default*
     cluster reauths with no clid at all, which is why some accounts need it and some don't. So
     the ssid is tried on its own first and Riot gets to say whether that's enough; the field is
     there, labelled, for when the answer is no. Guessing cluster codes here would be traffic
     spent on something the user can read off the same DevTools screen. ---- */
  let valAddAccountReturnFocus = null;

  function showValAddAccountErr(msg){
    const e2 = el('valAddAccountErr');
    if(!e2) return;
    e2.textContent = msg;
    e2.style.display = msg ? 'block' : 'none';
  }

  // opts.label switches the dialog into "refresh this account's session" mode: same fields, same
  // POST /login, but the name is fixed — saving under the existing label replaces its cookies and
  // leaves its wishlist, store history and owned-skin list attached.
  function openValAddAccount(opts){
    const ov = el('valAddAccountOverlay'); if(!ov) return;
    const relogin = (opts && opts.label) || '';
    showValAddAccountErr('');
    el('valAddAccountSsid').value = '';
    el('valAddAccountClid').value = '';
    el('valAddAccountLabel').value = relogin;
    el('valAddAccountLabel').readOnly = !!relogin;
    el('valAddAccountModalTitle').textContent = relogin ? 'Re-login' : 'Add account';
    el('valAddAccountReloginNote').style.display = relogin ? 'block' : 'none';
    el('valAddAccountSaveBtn').textContent = relogin ? 'Save session' : 'Add account';
    ov.style.display = 'flex';
    valAddAccountReturnFocus = document.activeElement;
    renderValLocalPanel();   // syncs the helper line and the window buttons inside the modal
    // same rule as the wishlist modal: never steal focus into a field on touch, where it throws
    // the keyboard up before you've read anything
    const autoFocus = !window.matchMedia || window.matchMedia('(hover:hover) and (pointer:fine)').matches;
    if(!autoFocus) el('valAddAccountCloseBtn').focus();
    else if(relogin) el('valAddAccountSsid').focus();   // the name is already known
    else el('valAddAccountLabel').focus();
  }
  function closeValAddAccount(){
    const ov = el('valAddAccountOverlay'); if(!ov) return;
    ov.style.display = 'none';
    if(valAddAccountReturnFocus && document.contains(valAddAccountReturnFocus)) valAddAccountReturnFocus.focus();
    valAddAccountReturnFocus = null;
  }

  if(el('valAddAccountModalBtn')){
    el('valAddAccountModalBtn').addEventListener('click', ()=>openValAddAccount());
    el('valAddAccountCloseBtn').addEventListener('click', closeValAddAccount);
    el('valAddAccountOverlay').addEventListener('click', e=>{
      if(e.target === el('valAddAccountOverlay')) closeValAddAccount();
    });
    document.addEventListener('keydown', e=>{
      if(e.key !== 'Escape') return;
      if(el('valAddAccountOverlay').style.display !== 'flex') return;
      // a sign-in window is a job on another machine; Escape shouldn't silently orphan it
      if(valLoginWin.active) return;
      closeValAddAccount();
    });

    el('valAddAccountWindowBtn').addEventListener('click', ()=>{
      startValLoginWindow(el('valAddAccountLabel').value.trim(), { errTarget:'valAddAccountErr', autoCheck:true });
    });
    el('valAddAccountWindowCancelBtn').addEventListener('click', async ()=>{
      try{ await valLoginWindowPost('/login-window-cancel'); }catch(e){ /* the poll reports it */ }
    });

    el('valAddAccountSaveBtn').addEventListener('click', async ()=>{
      showValAddAccountErr('');
      const label = el('valAddAccountLabel').value.trim();
      const ssid = el('valAddAccountSsid').value.trim();
      const clid = el('valAddAccountClid').value.trim();
      if(!label){ showValAddAccountErr('Give this account a name, e.g. "main".'); return; }
      if(!ssid){ showValAddAccountErr('Paste the ssid cookie value, or use "Log in with browser" above.'); return; }
      if(!valLocalStatus.connected){ showValAddAccountErr('The local helper isn\'t running — start it with `node scripts/valorant-local-server.mjs` on this machine.'); return; }

      const btn = el('valAddAccountSaveBtn');
      const wasLabel = btn.textContent;
      btn.disabled = true; btn.textContent = 'Checking…';
      try{
        const res = await fetch(valLocalUrl()+'/login', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ token: state.valorant.localServerToken, label, ssid, clid: clid || undefined })
        });
        const json = await res.json().catch(()=>null);
        if(!res.ok || !json || json.ok===false) throw new Error((json && json.error) || ('Could not save the account (HTTP '+res.status+').'));
        el('valAddAccountSsid').value = '';
        el('valAddAccountClid').value = '';
        closeValAddAccount();
        await pollValLocalStatus();
        // a just-added account has no store yet, and fetching it is the whole reason it was added
        await runValStoreCheck(label, 'valSettingsLocalErr');
      }catch(e){
        showValAddAccountErr((e && e.message) || 'Could not reach the local helper.');
      }
      btn.disabled = false; btn.textContent = wasLabel;
    });

    ['valAddAccountLabel','valAddAccountSsid','valAddAccountClid'].forEach(id=>{
      el(id).addEventListener('keydown', e=>{ if(e.key==='Enter') el('valAddAccountSaveBtn').click(); });
    });
  }

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

  /* ---- bring the panel into view when a lobby appears --------------------------
     The Live Match card sits below the sub-tab strip on a long page, so on most screens a match
     starting happens off-screen. This centres it — but only when there is something new to look
     at, which is the whole trick: the panel repolls every 3-15 seconds, and re-centring on each
     of those would drag the page out from under you while you were reading the enemy team.
     Keyed by phase *and* match id, so it fires once per lobby and once more when the barrier
     drops — a match keeps one id from agent select to the final round, so the id alone wouldn't
     notice the enemy half of the roster arriving, which is the second moment worth looking at.
     Reset on the way into the sub-tab as well, since clicking Live *is* a request to look at it. */
  let valLiveCentredFor = '';
  function centreValLiveCard(){
    const snap = valLiveState.data;
    const live = snap && (snap.phase === 'pregame' || snap.phase === 'coregame');
    const id = live ? (snap.phase + ':' + (snap.matchId || '')) : '';
    if(!id || id === valLiveCentredFor) return;
    // offsetParent is null while any ancestor is display:none, which covers both "another tab is
    // open" and "another Valorant sub-tab is open" in one check
    const panel = el('valSubtabLive');
    if(document.hidden || !panel || panel.offsetParent === null) return;
    valLiveCentredFor = id;
    // after the paint that added the roster, so the card is measured at its final height
    requestAnimationFrame(()=> scrollCardIntoCenter(el('valLiveCard')));
  }

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
      // the Games tab can be showing TFT instead — the Live panel is just as hidden then as it is
      // when you leave the tab entirely, and this is the clause that covers switching between games
      && state.games.active === 'valorant'
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
    // 'badge' means this tier came off the roster Riot hands out with the match — the badge drawn
    // under the player's name in game. It's the right rank but carries no RR, so the RR slot says
    // where it came from rather than printing a "0 RR" that isn't true. See badgeOf() server-side.
    const fromBadge = p.rankSource === 'badge';
    const rrHtml = !p.tier ? ''
      : (fromBadge
          ? '<span class="val-live-rr val-live-dim">in-game badge</span>'
          : '<span class="val-live-rr">'+(p.rr||0)+' RR</span>');
    return '<span class="val-live-rank'+(fromBadge?' val-live-rank-badge':'')+'"'
      + (fromBadge ? ' data-tile-title="'+escapeHtml('Rank badge from the match itself — Riot hasn’t returned this player’s exact RR yet')+'"' : '')
      + '>'+icon
      + '<span class="val-live-rank-txt"><b>'+escapeHtml(name)+'</b>'
      + rrHtml
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
    else if(p.rankError === 'ratelimited') meta.push('Riot rate-limited this rank lookup — retrying');
    else if(p.rankError === 'timeout') meta.push('Rank lookup timed out — retrying');
    if(p.party) meta.push(p.party.inferred
      ? 'Likely queued with '+(p.party.size-1)+' other'+(p.party.size===2?'':'s')+' (party '+p.party.group+')'
      : 'Queued as a party of '+p.party.size+' (party '+p.party.group+')');
    if(meta.length) bits.push('<div class="val-live-detail-meta">'+escapeHtml(meta.join(' · '))+'</div>');
    return bits.length ? '<div class="val-live-detail">'+bits.join('')+'</div>' : '';
  }

  // "Who queued with who" is the one thing on this panel that isn't self-explanatory: the answer
  // is the A2/B3 chip next to a name, and a chip nobody can decode may as well not be there. So
  // the roster is followed by a line that says what the chips mean — or, when there aren't any,
  // why not, since "no stacks" and "couldn't tell" look identical otherwise.
  function valLivePartyLegendHtml(snap){
    const stacks = snap.lobby && snap.lobby.stacks ? snap.lobby.stacks : [];
    const stages = snap.stages || {};
    const bits = [];

    if(stacks.length){
      const confirmed = stacks.filter(s=> !s.inferred).length;
      const likely = stacks.length - confirmed;
      if(confirmed) bits.push('<span class="val-live-stack">A2</span> queued together — confirmed by Riot');
      if(likely) bits.push('<span class="val-live-stack inferred">~A2</span> likely a stack — these players keep turning up in each other’s recent competitive matches');
      bits.push('the letter is the party, the number its size; solo players get no chip');
    } else if(stages.stats === 'loading' || stages.parties === 'loading'){
      bits.push('Working out who queued together…');
    } else if(snap.mode.id !== 'competitive'){
      // the signal is built out of competitive match histories, so outside competitive there is
      // nothing to build it from — say that rather than implying everyone solo-queued
      bits.push('Stacks are only detected in competitive — Riot only shares party ids for your own party.');
    } else {
      bits.push('No stacks detected. Riot only confirms your own party, so the rest is inferred from how often these players appear in each other’s recent competitive matches.');
    }
    return '<div class="val-live-legend">'+bits.join(' · ')+'</div>';
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
    centreValLiveCard();
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

    // a rank lookup Riot squeezed out is retried on later polls rather than left as a dash — say
    // so, otherwise a row showing the in-game badge looks like the panel gave up on it
    if(stages.ranksRetrying && stages.ranksPending){
      html += '<div class="val-live-progress">Riot didn’t answer '+stages.ranksPending
        + (stages.ranksPending === 1 ? ' rank lookup' : ' rank lookups')
        + ' — retrying. Ranks shown meanwhile come from the in-game badge (no RR).</div>';
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

    html += valLivePartyLegendHtml(snap);

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
