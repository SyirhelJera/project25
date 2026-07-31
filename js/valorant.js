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

  /* ---- daily store: written by scripts/valorant-check-store.mjs, run locally on the app
     owner's machine (see README.md — Riot's bot detection blocks this reauth flow from cloud
     infrastructure) into state.valorant.dailyStore/dailyStoreError — this client only ever
     reads/displays it, never fetches or authenticates to Riot itself. ---- */
  function renderValorantStore(){
    const wrap = el('valStoreCard'); if(!wrap) return;
    const unavailable = usingClaudeStorage || !supabaseConfigured;
    el('valStoreUnavailable').style.display = unavailable ? 'block' : 'none';
    if(unavailable){ wrap.innerHTML = ''; return; }

    const err = state.valorant.dailyStoreError;
    if(err){
      wrap.innerHTML = '<div class="val-err">⚠️ '+escapeHtml(err)+'</div>';
      return;
    }
    const ds = state.valorant.dailyStore;
    if(!ds){
      wrap.innerHTML = '<div class="val-peak-note">No store data yet — run scripts/valorant-check-store.mjs locally (see README.md "Setup").</div>';
      return;
    }
    const items = ds.items || [];
    let html = '<div class="val-store-grid">';
    items.forEach(it=>{
      html += '<div class="val-store-item">'
        + (it.imageUrl ? '<img src="'+escapeHtml(it.imageUrl)+'" alt="'+escapeHtml(it.name)+'">' : '')
        + '<div class="val-store-item-name">'+escapeHtml(it.name)+'</div>'
        + '<div class="val-store-item-price">'+(parseInt(it.price,10)||0).toLocaleString()+' VP</div>'
        + '</div>';
    });
    html += '</div>';
    if(ds.bundle){
      html += '<div class="val-store-bundle">'
        + (ds.bundle.imageUrl ? '<img src="'+escapeHtml(ds.bundle.imageUrl)+'" alt="'+escapeHtml(ds.bundle.name)+'">' : '')
        + '<div><div class="val-store-item-name">'+escapeHtml(ds.bundle.name)+' <span class="chip">Featured Bundle</span></div>'
        + '<div class="val-store-item-price">'+(parseInt(ds.bundle.price,10)||0).toLocaleString()+' VP</div></div>'
        + '</div>';
    }
    html += '<div class="today-sub" style="margin-top:8px;">Checked '+fmtDate(ds.checkedAt)+'</div>';
    wrap.innerHTML = html;
  }

  function renderValorant(){
    renderValorantStore();
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

