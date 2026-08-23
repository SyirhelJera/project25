  /* ================= GAMES: TEAMFIGHT TACTICS =================
     Manual entry only. There is no API path here: the HenrikDev key the Valorant panels use is
     Valorant-only, and Riot's official TFT API needs a personal key that expires every 24 hours.

     One record type. A game *is* a rank checkpoint that happens to carry a placement, so the LP
     chart, the LP-per-game average and the placement stats all fall out of one array and one add
     form. `placement: null` is a plain rank check (setting a starting rank, or recording decay /
     a soft reset) — it still plots and still moves LP, but it isn't a game you played, so it's
     excluded from the placement stats and from the LP-per-game average.

     Loads after valorant.js so showGameSubTab() can call renderValorant() and syncValLivePolling().
  ============================================================= */

  /* TFT's ladder, hard-coded — with no API, this table IS the source of truth. Iron..Diamond carry
     four divisions (IV lowest .. I highest); Master, Grandmaster and Challenger have none. The
     colors echo valTierColor()'s palette so both games in this tab speak one rank-color vocabulary,
     but this is deliberately its own table: valTierColor() is fed Riot's *Valorant* tier names and
     would answer '#6366F1' for Emerald and for Master. Don't merge them. */
  const TFT_TIERS = [
    { key:'iron',        name:'Iron',        color:'#6B7280', divisions:4 },
    { key:'bronze',      name:'Bronze',      color:'#A9714B', divisions:4 },
    { key:'silver',      name:'Silver',      color:'#9CA6AF', divisions:4 },
    { key:'gold',        name:'Gold',        color:'#E8B94B', divisions:4 },
    { key:'platinum',    name:'Platinum',    color:'#2FB6B0', divisions:4 },
    { key:'emerald',     name:'Emerald',     color:'#2FBE7A', divisions:4 },
    { key:'diamond',     name:'Diamond',     color:'#B084F0', divisions:4 },
    { key:'master',      name:'Master',      color:'#C33E6B', divisions:0 },
    { key:'grandmaster', name:'Grandmaster', color:'#E4572E', divisions:0 },
    { key:'challenger',  name:'Challenger',  color:'#E9DE8E', divisions:0 }
  ];
  const TFT_TIER_INDEX = {};
  TFT_TIERS.forEach((t,i)=>{ TFT_TIER_INDEX[t.key] = i; });
  const TFT_ROMAN = { 4:'IV', 3:'III', 2:'II', 1:'I' };

  const TFT_MAX_ENTRIES = 500; // ~50KB in the shared row at the ceiling — see the save note below
  const TFT_LP_WINDOW = 20;    // games behind the LP-per-game average
  const TFT_LP_MIN = 5;        // fewer than this and no estimate is offered at all
  const TFT_PACE_DAYS = 14;    // rolling window behind the actual-pace figure

  function tftTierColor(tierKey){
    const t = TFT_TIERS[TFT_TIER_INDEX[tierKey]];
    return t ? t.color : '#8B92A8';
  }

  /* Rank crests, straight off Community Dragon. Unlike the Valorant tier icons — which need
     ensureValTierIcons() to fetch a JSON index just to map Riot's numeric tierId to an image URL —
     these sit at a predictable path per tier name, so there's no fetch, no cache layer and nothing
     async here. The mini-crest SVGs are ~2KB each; the full ranked-emblem PNGs at the same origin
     run 80-230KB, far too heavy for a 46px card icon.

     Offline: sw.js doesn't list this host in LIVE_DATA_HOSTS, so the crests fall through to its
     cacheFirst(RUNTIME_CACHE) branch and keep working after the first load. Deliberately NOT added
     to SHELL_ASSETS — cache.addAll() rejects as a unit, so a CDN blip during install would leave
     the app with no offline shell at all, which is a far worse trade than a missing icon. */
  const TFT_CREST_BASE = 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests';
  function tftTierIcon(tierKey){
    const t = TFT_TIERS[TFT_TIER_INDEX[tierKey]];
    return t ? (TFT_CREST_BASE + '/' + t.key + '.svg') : '';
  }
  // alt="" on purpose: the rank name is always rendered as text right beside the crest, so an alt
  // would just make a screen reader say it twice
  function tftCrestHtml(tierKey, extraCls){
    const url = tftTierIcon(tierKey);
    if(!url) return '';
    return '<img class="tft-crest'+(extraCls ? ' '+extraCls : '')+'" src="'+url+'" alt="">';
  }
  // hidden rather than removed when the fetch fails, so a first-run offline load doesn't reflow the
  // card out from under the text. Checks .complete too: an already-failed (cached-failure) image
  // never fires `error` again once the listener is attached after innerHTML.
  function tftGuardCrests(root){
    root.querySelectorAll('.tft-crest').forEach(img=>{
      const hide = ()=>{ img.style.visibility = 'hidden'; };
      if(img.complete && img.naturalWidth === 0) hide();
      img.addEventListener('error', hide);
    });
  }

  /* Rank power — the same trick as valOf() in valorant.js (tierId*100 + rr): one continuous number,
     so a promotion always moves the chart up instead of looking like a crash back to 0 LP, and
     "how far to the target" is one subtraction. Iron IV = 0 .. Diamond I = 27, then ONE step for
     everything above.

     Master, Grandmaster and Challenger deliberately share step 28. In TFT they are not separate LP
     pools — you keep climbing the same LP counter past Master, and GM/Challenger are *ladder
     cutoffs* (roughly top 250 / top 100), not LP thresholds. Giving them steps 29 and 30 would rank
     "Master 400 LP" above "Challenger 0 LP", which is backwards, and would invent a 100-LP gap
     between Master and GM that doesn't exist. Collapsing them keeps the scale monotonic and honest:
     above Master, position on the ladder is LP and nothing else. The cost is that a GM/Challenger
     target needs the current *cutoff* LP typed in — the app can't know it, and says so in the UI
     rather than guessing. */
  const TFT_APEX_STEP = 28;
  const TFT_APEX_VALUE = TFT_APEX_STEP * 100; // 2800 — also exactly Master's tier boundary (7*400)

  function tftStep(tierKey, division){
    const idx = TFT_TIER_INDEX[tierKey];
    if(idx === undefined) return null;
    if(TFT_TIERS[idx].divisions === 0) return TFT_APEX_STEP;
    const d = Math.min(4, Math.max(1, Number(division) || 4));
    return idx*4 + (4 - d);
  }
  function tftValue(tierKey, division, lp){
    const step = tftStep(tierKey, division);
    if(step === null) return null;
    const n = Math.max(0, Number(lp) || 0);
    // inside a division LP runs 0-99 (100 promotes); above Master it's unbounded
    return step*100 + (step === TFT_APEX_STEP ? n : Math.min(99, n));
  }
  function tftEntryValue(e){ return tftValue(e.tier, e.division, e.lp); }

  // display name for a rank the user actually picked — uses the record's own tier, so a Challenger
  // entry says "Challenger" even though it shares a step with Master
  function tftRankLabel(tierKey, division){
    const t = TFT_TIERS[TFT_TIER_INDEX[tierKey]];
    if(!t) return '—';
    if(!t.divisions) return t.name;
    return t.name + ' ' + TFT_ROMAN[Math.min(4, Math.max(1, Number(division) || 4))];
  }
  function tftEntryLabel(e){ return tftRankLabel(e.tier, e.division) + ' · ' + e.lp + ' LP'; }
  // inverse, for interpolated chart values where the apex tier isn't recoverable from the number
  function tftLabelForValue(v){
    if(v >= TFT_APEX_VALUE) return 'Master+ · ' + Math.round(v - TFT_APEX_VALUE) + ' LP';
    const step = Math.floor(v/100);
    const idx = Math.floor(step/4);
    const div = 4 - (step % 4);
    const t = TFT_TIERS[idx];
    if(!t) return String(Math.round(v));
    return t.name + ' ' + TFT_ROMAN[div] + ' · ' + Math.round(v - step*100) + ' LP';
  }
  function tftIsApex(tierKey){
    const t = TFT_TIERS[TFT_TIER_INDEX[tierKey]];
    return !!t && !t.divisions;
  }

  /* The one ordering rule, used by everything: date ascending with createdAt as the same-day
     tiebreak — several TFT games happen per day, and without the tiebreak the chart and the LP
     deltas can disagree about which game came first. Also drops records whose tier isn't in the
     ladder: tftEntryValue() returns null for those, and one bad record would otherwise turn every
     chart coordinate into NaN and blank the whole plot. Filtered here rather than in
     applyLoadedState() so it also covers anything hand-edited after load. */
  function tftSortedEntries(){
    return (state.tft.entries || [])
      .filter(e=> TFT_TIER_INDEX[e.tier] !== undefined)
      .slice()
      .sort((a,b)=> a.date.localeCompare(b.date) || (a.createdAt||0) - (b.createdAt||0));
  }
  function tftCurrentEntry(){
    const s = tftSortedEntries();
    return s.length ? s[s.length-1] : null;
  }
  function tftTargetValue(){
    const t = state.tft.target;
    return t.tier ? tftValue(t.tier, t.division, t.lp) : null;
  }

  /* The climb toward the target as one record — the same anchor, span and percentage the progress
     bar on this tab draws. It lives here rather than in the renderer because Insights states the
     figure too, and a second derivation is how two screens start disagreeing about one number.
     Null when there is no target or no history: those are the two cases with no climb to measure,
     and each gets its own wording in renderTftTarget().

     `anchor` is where the climb started, not Iron IV — otherwise setting a Diamond target from
     Platinum shows 85% done before a single game. It comes from target.startValue (stamped when
     the target was set) and falls back to the oldest entry for targets set before any history
     existed. */
  function tftTargetProgress(){
    const t = state.tft.target;
    const targetVal = tftTargetValue();
    const cur = tftCurrentEntry();
    if(targetVal == null || !cur) return null;
    const curVal = tftEntryValue(cur);
    const sorted = tftSortedEntries();
    const anchor = t.startValue != null ? t.startValue : (sorted.length ? tftEntryValue(sorted[0]) : 0);
    const span = targetVal - anchor;
    return {
      cur, curVal, targetVal, anchor, span,
      remaining: Math.max(0, targetVal - curVal),
      // span <= 0 means the target sits at or below where the climb began — already there
      pct: span <= 0 ? 100 : Math.max(0, Math.min(100, Math.round(((curVal - anchor)/span)*100))),
      label: tftRankLabel(t.tier, t.division)
    };
  }

  /* ================= MetaTFT auto-sync =================
     MetaTFT's public API answers with a permissive CORS header (it reflects the request Origin),
     so the browser can call it straight out of the page. That's why there's no local helper and no
     Edge Function here, unlike the Valorant store/live tooling — nothing about this touches Riot's
     own auth endpoints, it's a third-party site serving its own indexed copy of public profiles.

     Two endpoints do the work:
       profile/lookup_by_riotid/{region}/{name}/{tag}   current rank + the last 40 matches
       profile/rating_changes/{region}/{name}/{tag}     one LP point per ranked game, per set

     rating_changes carries an LP value with no placement; matches carry a placement with no LP.
     They're paired on time — a rating point lands about a minute after the game it came from
     (measured median 1.3 min across a full 40-match page) — which recovers exactly the one record
     per game this tab is built around. Unpaired rating points still import, just without a
     placement, so the LP chart is complete even past the 40-match window.

     This is an UNDOCUMENTED API. It can change shape or start demanding a key with no notice,
     which is why manual entry stays: a failed sync writes a message and changes nothing else. */
  const METATFT_API = 'https://api.metatft.com/public';
  const TFT_RANKED_QUEUE = 1100;   // ranked standard. 1160 is ranked Double Up — different ladder,
                                   // 4 teams not 8, so it must never be mixed into these stats.
  const TFT_SYNC_COOLDOWN_MS = 5 * 60 * 1000; // auto-sync on tab open at most this often
  const TFT_PAIR_WINDOW_MS = 45 * 60 * 1000;  // how far from a match a rating point may sit
  // platform codes, not the routing regions MetaTFT shows in its own URLs — a /player/sea/ profile
  // is indexed under sg2, and asking for 'sea' returns "Summoner Not found" rather than an error
  // that would tell you why
  const TFT_REGIONS = [
    {v:'sg2',  l:'SEA / Singapore'}, {v:'ph2', l:'Philippines'}, {v:'th2', l:'Thailand'},
    {v:'vn2',  l:'Vietnam'},         {v:'tw2', l:'Taiwan'},      {v:'oc1', l:'Oceania'},
    {v:'na1',  l:'North America'},   {v:'euw1',l:'EU West'},     {v:'eun1',l:'EU Nordic & East'},
    {v:'kr',   l:'Korea'},           {v:'jp1', l:'Japan'},       {v:'br1', l:'Brazil'},
    {v:'la1',  l:'LAN'},             {v:'la2', l:'LAS'},         {v:'tr1', l:'Turkey'},
    {v:'ru',   l:'Russia'}
  ];

  /* Parse MetaTFT's rating_text ("EMERALD IV 80 LP") rather than inverting their rating_numeric.
     The numbers are identical to tftValue()'s scale — verified across the ladder, e.g. GOLD I 4 LP
     is 1504 in both — but the number alone can't say whether 3664 is Master, Grandmaster or
     Challenger, since all three share one LP pool. The text can. */
  const TFT_ROMAN_VAL = { I:1, II:2, III:3, IV:4 };
  function tftParseRatingText(txt){
    if(typeof txt !== 'string') return null;
    const m = txt.trim().match(/^([A-Za-z]+)\s+([IV]+)\s+(-?\d+)\s*LP$/i);
    if(!m) return null;
    const key = m[1].toLowerCase();
    if(TFT_TIER_INDEX[key] === undefined) return null;
    const div = TFT_ROMAN_VAL[m[2].toUpperCase()] || 4;
    return { tier: key, division: tftIsApex(key) ? 4 : div, lp: Math.max(0, parseInt(m[3], 10) || 0) };
  }

  // "TFTSet17" -> "Set 17". Riot's own naming in the API payloads, not something the user typed.
  function tftSetLabel(raw){
    const m = String(raw || '').match(/^TFTSet(\d+)$/i);
    return m ? ('Set ' + m[1]) : String(raw || '');
  }

  /* The line under the season-end field. Its job is to make a hand-typed date safe: it says which
     set the date belongs to, warns when the set has rolled over (the sync detects that), and counts
     down so a date that has quietly passed is visible rather than silently skewing the pace line. */
  function renderTftSeasonNote(){
    const noteEl = el('tftSeasonNote');
    const s = state.tft.season;
    noteEl.classList.remove('warn');
    if(!s.endDate){
      noteEl.textContent = s.set
        ? (tftSetLabel(s.set) + ' detected from your synced games. Riot only announces the end date in patch notes — no API publishes it — so enter it once and the pace line races it.')
        : 'Rank resets when the set ends, so that date is the deadline. Sync or log a game to detect which set you\'re in.';
      return;
    }
    const today = new Date(); today.setHours(0,0,0,0);
    const days = Math.ceil((parseLocalDateStr(s.endDate).getTime() - today.getTime()) / 86400000);
    if(days < 0){
      noteEl.classList.add('warn');
      noteEl.textContent = (s.set ? tftSetLabel(s.set) : 'The set') + ' was set to end '
        + fmtDate(parseLocalDateStr(s.endDate).getTime()) + '. Sync to pick up the new set, then enter its end date.';
    } else {
      noteEl.textContent = days + ' day' + (days===1?'':'s') + ' left'
        + (s.set ? ' in ' + tftSetLabel(s.set) : '') + '.';
    }
  }

  function tftSplitRiotId(raw){
    const s = String(raw || '').trim();
    const i = s.lastIndexOf('#');
    if(i < 1 || i === s.length-1) return null;
    return { name: s.slice(0, i), tag: s.slice(i+1) };
  }

  let tftSyncInFlight = false;
  let tftSyncNote = ''; // last sync's outcome line; session-only, not worth persisting
  async function tftSync(){
    const cfg = state.tft.sync;
    const id = tftSplitRiotId(cfg.riotId);
    if(!id){
      cfg.lastError = 'Enter your Riot ID as Name#TAG.';
      save(); renderTft(); return;
    }
    if(tftSyncInFlight) return;
    tftSyncInFlight = true;
    renderTftSyncPanel();

    // encodeURIComponent on each part: Riot IDs carry spaces and non-ASCII (ツ) routinely
    const base = METATFT_API + '/profile/'
      + '%s/' + encodeURIComponent(cfg.region) + '/'
      + encodeURIComponent(id.name) + '/' + encodeURIComponent(id.tag);
    try {
      const [profRes, rcRes] = await Promise.all([
        fetch(base.replace('%s','lookup_by_riotid')),
        fetch(base.replace('%s','rating_changes') + '?queue=' + TFT_RANKED_QUEUE)
      ]);

      if(profRes.status === 404){
        // MetaTFT answers a miss with a queued crawl rather than a bare 404 — say so, because
        // trying again shortly is genuinely the fix
        let queued = false;
        try { queued = ((await profRes.clone().json()).refresh || {}).status === 'queued'; } catch(e){}
        cfg.lastError = queued
          ? "MetaTFT hasn't indexed this account yet — it just queued a lookup, try again in a minute."
          : 'No such account on ' + cfg.region + '. Check the Riot ID and region.';
        cfg.lastSyncedAt = null;
        return;
      }
      if(!profRes.ok) throw new Error('profile lookup failed (' + profRes.status + ')');
      const prof = await profRes.json();
      const rc = rcRes.ok ? ((await rcRes.json()).rating_changes || []) : [];

      const added = tftMergeSynced(prof, rc);
      cfg.lastSyncedAt = Date.now();
      cfg.lastError = '';
      tftSyncNote = added > 0
        ? ('Synced — ' + added + ' new ' + (added===1?'game':'games') + ' imported.')
        : 'Synced — already up to date.';
    } catch(err){
      // A CORS rejection and an offline browser both surface as TypeError with no useful detail,
      // so don't pretend to distinguish them.
      cfg.lastError = 'Couldn’t reach MetaTFT. ' + (err && err.message ? err.message : '');
    } finally {
      tftSyncInFlight = false;
      save();
      renderTft();
    }
    tftFetchCutoffs(); // best-effort, never blocks or fails the sync
  }

  /* Merge a fetched profile into state.tft.entries. Idempotent: every imported row carries the
     rating point's own timestamp as srcKey, and anything already present is skipped, so re-syncing
     adds only what's new. Hand-typed rows have no srcKey and are never touched, moved or removed. */
  function tftMergeSynced(prof, ratingChanges){
    const seen = {};
    state.tft.entries.forEach(e=>{ if(e.srcKey) seen[e.srcKey] = true; });

    // Only the current set. LP resets between sets, so importing older ones would put a cliff of
    // several hundred LP in the middle of the chart that never happened as a real loss.
    const points = (ratingChanges || []).filter(p=> p.queue_id === TFT_RANKED_QUEUE && p.rating_text);
    if(!points.length) return 0;
    const newestSet = points
      .slice()
      .sort((a,b)=> String(a.created_timestamp).localeCompare(String(b.created_timestamp)))
      .pop().tft_set_name;

    /* A set rollover invalidates the typed season-end date — and it's the one moment the user needs
       telling, since a stale deadline would silently keep computing pace against a date in the past.
       Detected here rather than guessed, because the synced records carry the set name. */
    if(newestSet && state.tft.season.set !== newestSet){
      if(state.tft.season.set) state.tft.season.endDate = ''; // rolled over; the old date is meaningless
      state.tft.season.set = newestSet;
    }

    // the stored timestamps have no zone marker but are UTC — Date.parse would read them as local
    const tsOf = p => Date.parse(String(p.created_timestamp).replace(/Z?$/, 'Z'));
    const cur = points
      .filter(p=> p.tft_set_name === newestSet)
      .map(p=> ({ t: tsOf(p), raw: p }))
      .filter(p=> Number.isFinite(p.t))
      .sort((a,b)=> a.t - b.t);

    // placements come off the match list; pair each to the rating point that follows it
    const matches = (prof.matches || [])
      .filter(m=> m.queue_id === TFT_RANKED_QUEUE && typeof m.placement === 'number')
      .sort((a,b)=> a.match_timestamp - b.match_timestamp);
    const placementFor = {};
    matches.forEach(m=>{
      let best = null, bestGap = Infinity;
      for(const p of cur){
        const gap = p.t - m.match_timestamp;
        if(gap < -60000) continue;             // rating point predates the game
        if(gap > TFT_PAIR_WINDOW_MS) break;    // sorted, so nothing later can be closer
        if(gap < bestGap){ bestGap = gap; best = p; }
      }
      if(best && placementFor[best.raw.created_timestamp] === undefined){
        placementFor[best.raw.created_timestamp] = m.placement;
      }
    });

    let added = 0;
    cur.forEach(p=>{
      const key = 'metatft:' + p.raw.created_timestamp;
      if(seen[key]) return;
      const parsed = tftParseRatingText(p.raw.rating_text);
      if(!parsed) return;
      const when = new Date(p.t);
      const pl = placementFor[p.raw.created_timestamp];
      state.tft.entries.push({
        id: uid(),
        date: localDateStr(when),
        createdAt: p.t,
        tier: parsed.tier,
        division: parsed.division,
        lp: parsed.lp,
        // no paired match means the game is older than the 40-match window MetaTFT returns — the
        // LP is still real, so it plots; it just can't count toward the placement stats
        placement: pl === undefined ? null : pl,
        src: 'metatft',
        srcKey: key
      });
      seen[key] = true;
      added++;
    });

    if(state.tft.entries.length > TFT_MAX_ENTRIES){
      state.tft.entries = tftSortedEntries().slice(-TFT_MAX_ENTRIES);
    }
    // a target set before any history existed anchors to the oldest imported point, not to the
    // newest — otherwise the bar would read 100% the moment the backfill lands
    if(state.tft.target.tier && state.tft.target.startValue == null){
      const sorted = tftSortedEntries();
      if(sorted.length) state.tft.target.startValue = tftEntryValue(sorted[0]);
    }
    return added;
  }

  /* Live Grandmaster/Challenger LP cutoffs. Above Master those aren't LP thresholds at all, they're
     ladder positions (roughly top 250 / top 100), so an apex target otherwise has to be typed in by
     hand off the leaderboard. Best-effort: a failure here leaves the manual field exactly as it was. */
  async function tftFetchCutoffs(){
    try {
      const res = await fetch(METATFT_API + '/promotion_thresholds/latest');
      if(!res.ok) return;
      const rows = await res.json();
      const row = (Array.isArray(rows) ? rows : []).find(r=> r.region === state.tft.sync.region);
      if(!row) return;
      state.tft.sync.cutoffs = {
        grandmaster: row.grandmaster_threshold,
        challenger: row.challenger_threshold,
        at: Date.now()
      };
      save();
      renderTftTarget();
    } catch(e){ /* cutoffs are a nicety, never worth surfacing an error for */ }
  }

  /* ---------- Games sub-nav (Valorant | TFT) ----------
     Same shape as showTimeSubTab()/showFinanceSubTab(): the strip owns which pane is visible and
     renders whichever one it reveals. Unlike those two it persists — see the comment on #view-games
     in index.html. */
  const GAME_SUBTABS = ['valorant','tft'];
  function showGameSubTab(key){
    if(!GAME_SUBTABS.includes(key)) key = 'valorant';
    state.games.active = key;
    document.querySelectorAll('#view-games .finance-subnav-btn').forEach(b=>{
      b.classList.toggle('active', b.dataset.gametab === key);
    });
    document.querySelectorAll('#view-games .gametab').forEach(t=>{
      t.style.display = (t.id === 'gametab-'+key) ? '' : 'none';
    });
    // Valorant always lands on Shop Tracker, the way the Time tab always lands on Clock — it's the
    // pane you open the game for daily (the store rotates every day; Live Match only matters while
    // you happen to be in a game). Reset here rather than dropping state.valorant.activeSubtab
    // entirely, since flipping between the three panels within a visit still reads it. It also
    // means entering the tab can never start the Live Match poll on its own — syncValLivePolling()
    // below sees 'shop' and stays stopped until you actually ask for that panel.
    if(key === 'valorant'){ state.valorant.activeSubtab = 'shop'; renderValSubtabs(); renderValorant(); }
    if(key === 'tft'){ renderTft(); maybeAutoSyncTft(); }
    // Switching to TFT hides the Live Match panel just as surely as leaving the tab does, and a
    // loop hitting Riot every few seconds from a panel nobody can see is exactly what that feature
    // must not do. syncValLivePolling() is the single choke point and now reads state.games.active,
    // so this one call covers both directions — switching back restarts it.
    syncValLivePolling();
  }
  document.querySelectorAll('#view-games .finance-subnav-btn').forEach(btn=>{
    // save() lives here, not in showGameSubTab(), so nav.js's call on tab entry and renderAll()'s
    // call on load don't write
    btn.addEventListener('click', ()=>{ showGameSubTab(btn.dataset.gametab); save(); });
  });

  /* ---------- select population ---------- */
  function tftFillTierSelect(sel, includeBlank){
    sel.innerHTML = (includeBlank ? '<option value="">No target</option>' : '')
      + TFT_TIERS.map(t=>'<option value="'+t.key+'">'+t.name+'</option>').join('');
  }
  function tftFillDivSelect(sel){
    sel.innerHTML = [4,3,2,1].map(d=>'<option value="'+d+'">'+TFT_ROMAN[d]+'</option>').join('');
  }
  tftFillTierSelect(el('tftAddTier'), false);
  tftFillTierSelect(el('tftTargetTier'), true);
  tftFillDivSelect(el('tftAddDiv'));
  tftFillDivSelect(el('tftTargetDiv'));
  el('tftAddTier').value = 'gold';
  el('tftAddDate').value = localDateStr(new Date());

  // the division picker is meaningless above Master — hide it rather than leaving a control that
  // silently does nothing
  function tftSyncDivVisibility(){
    // hide the whole field, label included — hiding only the select would strand a "Division"
    // label above nothing
    el('tftAddDivField').style.display = tftIsApex(el('tftAddTier').value) ? 'none' : '';
    el('tftTargetDivField').style.display = tftIsApex(el('tftTargetTier').value) ? 'none' : '';
  }

  /* ---------- the two halves of the summary card ----------
     One side each, facing across an arrow. Both are deliberately three short lines — label, rank,
     one number — because the card's job is the comparison, and anything longer on either side
     stops the pair reading as a single "here → there" statement. */
  function tftDuoSide(label, tierKey, nameHtml, subHtml){
    return '<div class="tft-duo-lbl">'+label+'</div>'
      + '<div class="tft-duo-body">'
      +   (tierKey ? tftCrestHtml(tierKey, 'md') : '<span class="tft-crest md tft-crest-blank"></span>')
      +   '<div class="tft-duo-text">'
      +     '<div class="tft-rank-name">'+nameHtml+'</div>'
      +     '<div class="tft-rank-lp">'+subHtml+'</div>'
      +   '</div>'
      + '</div>';
  }

  function renderTftCurrentCard(){
    const side = el('tftCurrentCard');
    const meta = el('tftSummaryMeta');
    const cur = tftCurrentEntry();
    if(!cur){
      side.style.removeProperty('--tier');
      side.innerHTML = tftDuoSide('Current', '', 'Not logged', 'No games yet');
      meta.textContent = 'Sync your MetaTFT profile above, or log a game to start the chart.';
      return;
    }
    const sorted = tftSortedEntries();
    const prev = sorted.length > 1 ? sorted[sorted.length-2] : null;
    const delta = prev ? (tftEntryValue(cur) - tftEntryValue(prev)) : null;
    const played = sorted.filter(e=> e.placement != null).length;
    let deltaHtml = '';
    if(delta != null && delta !== 0){
      deltaHtml = ' <span class="tft-delta '+(delta>0?'up':'down')+'">'+(delta>0?'▲+':'▼')+delta+'</span>';
    }
    side.style.setProperty('--tier', tftTierColor(cur.tier));
    side.innerHTML = tftDuoSide('Current', cur.tier,
      escapeHtml(tftRankLabel(cur.tier, cur.division)),
      cur.lp + ' LP' + deltaHtml);
    tftGuardCrests(side);

    // the long-form detail lives on one faint line across the card, not inside either half
    meta.textContent = played + ' game' + (played===1?'':'s') + ' logged'
      + (sorted.length > played ? ' · ' + (sorted.length-played) + ' rank check' + ((sorted.length-played)===1?'':'s') : '')
      + ' · updated ' + fmtDate(parseLocalDateStr(cur.date).getTime());
  }

  /* ---------- target: LP remaining, games needed, pace ---------- */
  function renderTftTarget(){
    const t = state.tft.target;
    const cur = tftCurrentEntry();
    const curVal = cur ? tftEntryValue(cur) : null;
    const targetVal = tftTargetValue();

    // keep the four inputs showing what's stored (they're also the edit surface)
    el('tftTargetTier').value = t.tier;
    el('tftTargetDiv').value = String(t.division);
    el('tftTargetLp').value = t.tier ? t.lp : '';
    el('tftSeasonEnd').value = state.tft.season.endDate;
    el('tftSeasonEndLbl').textContent = state.tft.season.set
      ? (tftSetLabel(state.tft.season.set) + ' ends')
      : 'Season ends';
    renderTftSeasonNote();
    tftSyncDivVisibility();
    // Apex note. When a cutoff has been fetched, offer the live number and a one-click fill instead
    // of telling the user to go read the leaderboard themselves.
    const cutNote = el('tftTargetCutoffNote');
    const cuts = state.tft.sync.cutoffs;
    const cutLp = cuts && (t.tier === 'challenger' ? cuts.challenger : (t.tier === 'grandmaster' ? cuts.grandmaster : null));
    if(!tftIsApex(t.tier)){
      cutNote.style.display = 'none';
    } else if(t.tier === 'master'){
      cutNote.style.display = 'block';
      cutNote.textContent = 'Master has no cutoff — reaching it is 0 LP in the shared Master+ pool.';
    } else if(cutLp){
      cutNote.style.display = 'block';
      cutNote.innerHTML = escapeHtml(tftRankLabel(t.tier, 4)) + ' is currently around <b>' + cutLp
        + ' LP</b> on ' + escapeHtml(state.tft.sync.region)
        + ' — it\'s a ladder cutoff, not a fixed threshold, so it moves. '
        + '<button type="button" class="btn btn-sm" id="tftUseCutoffBtn">Use ' + cutLp + ' LP</button>';
      el('tftUseCutoffBtn').addEventListener('click', ()=>{
        state.tft.target.lp = cutLp;
        state.tft.target.setAt = Date.now();
        save(); renderTft();
      });
    } else {
      cutNote.style.display = 'block';
      cutNote.textContent = 'Grandmaster and Challenger are ladder cutoffs, not LP totals — put the current cutoff LP from the leaderboard in the LP field to get a real estimate.';
    }

    /* The target half of the summary card. Its sub-line is the LP still to go rather than the
       target's own LP — the target rank is already named right above it, so repeating its LP would
       spend the card's most valuable line on something the reader can already see. */
    const side = el('tftTargetSide');
    const curNow = tftCurrentEntry();
    const tVal = tftTargetValue();
    if(!t.tier){
      side.style.removeProperty('--tier');
      side.innerHTML = tftDuoSide('Target', '', 'None set', 'Edit below');
    } else {
      const gap = (curNow && tVal != null) ? Math.max(0, tVal - tftEntryValue(curNow)) : null;
      side.style.setProperty('--tier', tftTierColor(t.tier));
      side.innerHTML = tftDuoSide('Target', t.tier,
        escapeHtml(tftRankLabel(t.tier, t.division)),
        gap == null ? '—' : (gap === 0 ? '<span class="tft-delta up">reached</span>' : gap + ' LP to go'));
      tftGuardCrests(side);
    }

    const bar = el('tftTargetBar'), note = el('tftTargetNote');
    const needEl = el('tftGamesNeeded'), paceEl = el('tftPaceNote');
    needEl.style.display = 'none'; paceEl.style.display = 'none';

    if(targetVal == null){
      bar.style.display = 'none';
      note.textContent = 'Set a target under "Edit target & season" to measure the climb against it.';
      return;
    }
    if(curVal == null){
      bar.style.display = 'none';
      note.textContent = 'Log a game or sync, and the progress bar fills in.';
      return;
    }

    // the anchor/percentage maths lives in tftTargetProgress() so Insights can state the same
    // figure without re-deriving it
    const prog = tftTargetProgress();
    const remaining = prog.remaining, anchor = prog.anchor, pct = prog.pct;
    const sorted = tftSortedEntries();

    bar.style.display = 'block';
    el('tftTargetFill').style.width = pct + '%';

    // the ranks and the LP gap are already stated in the duo above, so this line only adds what
    // isn't up there: how far through the climb the bar is, and from where it's measured
    if(remaining === 0){
      note.textContent = 'Target reached — hit on ' + fmtDate(parseLocalDateStr(cur.date).getTime()) + '.';
      return;
    }
    // measured from `anchor`, which is where the target was set — not necessarily the oldest entry
    note.textContent = pct + '% of the climb from ' + tftLabelForValue(anchor)
      + (tftIsApex(t.tier) && t.lp ? ' · target uses a ' + t.lp + ' LP cutoff' : '');

    /* Games needed. Deltas between consecutive entries where the NEWER one is a game played — a
       decay correction or a soft reset isn't a game, so it's excluded from the numerator and the
       denominator both. Window is the last 20: TFT LP swings ±50 a game, so 5 is noise and
       all-time spans different patches and sets. The sample size is always printed beside the
       figure, same rule the Live Match win rates follow. */
    const deltas = [];
    for(let i=1;i<sorted.length;i++){
      if(sorted[i].placement == null) continue;
      deltas.push(tftEntryValue(sorted[i]) - tftEntryValue(sorted[i-1]));
    }
    const recent = deltas.slice(-TFT_LP_WINDOW);
    needEl.style.display = 'block';
    needEl.classList.remove('on-track','behind');
    if(recent.length < TFT_LP_MIN){
      needEl.textContent = 'Log ' + TFT_LP_MIN + ' games to estimate how many more it takes ('
        + recent.length + ' so far).';
    } else {
      const avgLp = recent.reduce((a,b)=>a+b, 0) / recent.length;
      if(avgLp <= 0){
        needEl.textContent = "You're down " + Math.abs(avgLp).toFixed(1) + ' LP per game over your last '
          + recent.length + ' — no estimate while the average is negative.';
      } else {
        needEl.textContent = '≈ ' + Math.ceil(remaining/avgLp) + ' more games at +' + avgLp.toFixed(1)
          + ' LP/game (last ' + recent.length + ').';
      }
    }

    /* Pace against the set ending. That's the deadline that actually matters — rank resets when the
       set rolls over, so LP not earned by then is LP you have to earn again. */
    const seasonEnd = state.tft.season.endDate;
    if(!seasonEnd) return;
    const setName = state.tft.season.set ? tftSetLabel(state.tft.season.set) : 'the season';
    paceEl.style.display = 'block';
    paceEl.classList.remove('on-track','behind');
    const today = new Date(); today.setHours(0,0,0,0);
    const targetDay = parseLocalDateStr(seasonEnd);
    const daysLeft = Math.ceil((targetDay.getTime() - today.getTime()) / 86400000);
    if(daysLeft < 0){
      paceEl.classList.add('behind');
      paceEl.textContent = setName + ' ended ' + fmtDate(targetDay.getTime()) + ' — ' + remaining
        + ' LP short. Sync to pick up the new set, then set its end date.';
      return;
    }
    const needPerDay = remaining / Math.max(1, daysLeft);
    // actual pace: rank power gained per elapsed day over the last fortnight, falling back to the
    // whole log when the recent window is too thin to say anything
    const cutoff = localDateStr(new Date(today.getTime() - TFT_PACE_DAYS*86400000));
    let win = sorted.filter(e=> e.date >= cutoff);
    let winLabel = 'last ' + TFT_PACE_DAYS + ' days';
    if(win.length < 2){ win = sorted; winLabel = 'all time'; }
    if(win.length < 2){
      paceEl.textContent = 'Not enough history yet to judge pace against the end of ' + setName + '.';
      return;
    }
    const spanDays = Math.max(1, Math.round(
      (parseLocalDateStr(win[win.length-1].date).getTime() - parseLocalDateStr(win[0].date).getTime()) / 86400000
    ));
    const actualPerDay = (tftEntryValue(win[win.length-1]) - tftEntryValue(win[0])) / spanDays;
    const left = daysLeft + ' day' + (daysLeft===1?'':'s') + ' left in ' + setName;
    if(actualPerDay >= needPerDay){
      paceEl.classList.add('on-track');
      paceEl.textContent = 'On track — ' + left + '. You need ' + needPerDay.toFixed(1)
        + " LP/day and you're averaging " + actualPerDay.toFixed(1) + ' (' + winLabel + ').';
    } else if(actualPerDay > 0){
      paceEl.classList.add('behind');
      const projected = new Date(today.getTime() + Math.ceil(remaining/actualPerDay)*86400000);
      const makesIt = projected.getTime() <= targetDay.getTime();
      paceEl.textContent = 'Behind — ' + left + '. ' + needPerDay.toFixed(1) + ' LP/day needed, averaging '
        + actualPerDay.toFixed(1) + ' (' + winLabel + '). At this pace you’d get there around '
        + fmtDate(projected.getTime()) + (makesIt ? '.' : ', after the set ends.');
    } else {
      paceEl.classList.add('behind');
      paceEl.textContent = 'Behind — ' + left + '. ' + needPerDay.toFixed(1)
        + ' LP/day needed, but you’re not gaining LP over the ' + winLabel + '.';
    }
  }

  /* ---------- placement log ---------- */
  const tftLogGroupCollapsed = {}; // month key -> collapsed; session-only, same as the weight log
  function renderTftLog(){
    const listEl = el('tftLogList');
    // newest first for reading, unlike the ascending order everything computed uses
    const log = tftSortedEntries().slice().reverse();
    el('tftLogEmpty').style.display = log.length ? 'none' : 'block';
    listEl.style.display = log.length ? 'block' : 'none';
    listEl.innerHTML = '';
    if(!log.length) return;

    const groups = [], groupMap = {};
    log.forEach(entry=>{
      const key = entry.date.slice(0,7);
      if(!groupMap[key]){
        groupMap[key] = { key, label: parseLocalDateStr(entry.date).toLocaleDateString(undefined,{month:'long',year:'numeric'}), entries: [] };
        groups.push(groupMap[key]);
      }
      groupMap[key].entries.push(entry);
    });

    groups.forEach((grp, gi)=>{
      if(!(grp.key in tftLogGroupCollapsed)) tftLogGroupCollapsed[grp.key] = gi !== 0; // newest month open
      const collapsed = tftLogGroupCollapsed[grp.key];
      const header = document.createElement('div');
      header.className = 'weight-log-group-header';
      header.innerHTML = '<span class="wlg-chevron">'+(collapsed?'▶':'▼')+'</span>'
        + '<span class="wlg-label">'+escapeHtml(grp.label)+'</span>'
        + '<span class="wlg-count">'+grp.entries.length+' '+(grp.entries.length===1?'entry':'entries')+'</span>';
      header.addEventListener('click', ()=>{ tftLogGroupCollapsed[grp.key] = !collapsed; renderTftLog(); });
      listEl.appendChild(header);
      if(collapsed) return;

      grp.entries.forEach(entry=>{
        // delta against the next-older entry across the whole log, not just this month, so the
        // first row of a month still shows a change
        const idxAll = log.indexOf(entry);
        const older = log[idxAll+1] || null;
        const delta = older ? (tftEntryValue(entry) - tftEntryValue(older)) : null;
        let deltaHtml = '';
        if(delta != null && delta !== 0){
          deltaHtml = '<span class="wl-delta '+(delta<0?'down':'up')+'">'+(delta>0?'+':'')+delta+'</span>';
        }
        const p = entry.placement;
        const placeCls = p == null ? 'check' : (p === 1 ? 'win' : (p <= 4 ? 'top4' : ''));
        const placeTxt = p == null ? '—' : String(p);
        const placeTitle = p == null ? 'Rank check, not a game' : ('Placed ' + p + (p===1?'st':(p===2?'nd':(p===3?'rd':'th'))));

        const row = document.createElement('div');
        row.className = 'weight-log-item';
        row.innerHTML = '<span class="tft-place '+placeCls+'" title="'+placeTitle+'">'+placeTxt+'</span>'
          + '<span class="wl-date">'+escapeHtml(fmtDate(parseLocalDateStr(entry.date).getTime()))+'</span>'
          + '<span class="wl-weight" style="color:'+tftTierColor(entry.tier)+'">'+escapeHtml(tftEntryLabel(entry))+'</span>'
          + (entry.src === 'metatft' ? '<span class="tft-src" title="Imported from MetaTFT">sync</span>' : '')
          + deltaHtml
          + '<button class="wl-del" type="button" aria-label="Delete entry">✕</button>';
        row.querySelector('.wl-del').addEventListener('click', ()=>{
          state.tft.entries = state.tft.entries.filter(e=> e.id !== entry.id);
          save(); renderTft();
        });
        listEl.appendChild(row);
      });
    });
  }

  /* ---------- LP history chart ----------
     Same construction as renderValorantChart() in valorant.js — measured-pixel viewBox, per-segment
     coloring, dots only where something happened, hover crosshair with an arrow-key equivalent. */
  const TFT_CHART_ZOOMS = [
    {key:'10', label:'Last 10', count:10},
    {key:'25', label:'Last 25', count:25},
    {key:'50', label:'Last 50', count:50},
    {key:'all', label:'All', count:null}
  ];
  let tftChartZoom = '25'; // not persisted — resets to a sensible default each page load
  // its own counter, deliberately NOT valorant.js's chartGradId: both charts are always in the DOM
  // (only display differs) and SVG gradient ids are document-global
  let tftGradId = 0;

  function renderTftChart(){
    const wrap = el('tftChartWrap');
    const zoomRow = el('tftChartZoomRow');
    const statsEl = el('tftStatsStrip');
    const full = tftSortedEntries();

    if(full.length < 2){
      wrap.innerHTML = '<div class="val-chart-empty">Not enough history yet — log a second entry to start the graph.</div>';
      zoomRow.style.display = 'none';
      statsEl.innerHTML = '';
      return;
    }

    zoomRow.style.display = 'flex';
    zoomRow.innerHTML = TFT_CHART_ZOOMS.map(z=>
      '<button type="button" class="chart-zoom-btn'+(tftChartZoom===z.key?' active':'')+'"'
      + (tftChartZoom===z.key?' aria-pressed="true"':'')+' data-tzoom="'+z.key+'">'+z.label+'</button>'
    ).join('');
    zoomRow.querySelectorAll('[data-tzoom]').forEach(btn=>{
      btn.addEventListener('click', ()=>{ tftChartZoom = btn.dataset.tzoom; renderTftChart(); });
    });

    const zoomOpt = TFT_CHART_ZOOMS.find(z=>z.key===tftChartZoom) || TFT_CHART_ZOOMS[3];
    const hist = zoomOpt.count ? full.slice(-zoomOpt.count) : full;
    if(hist.length < 2){
      wrap.innerHTML = '<div class="val-chart-empty">Only one entry in this range — try a wider zoom.</div>';
      statsEl.innerHTML = '';
      return;
    }

    const W = Math.max(300, Math.round(wrap.clientWidth) || 720);
    const narrow = W < 520;
    const H = Math.round(Math.max(190, Math.min(300, W * 0.26)));
    const padL = 12, padR = 14, padT = 26, padB = 26;
    const vals = hist.map(tftEntryValue);

    /* Peak is measured across the WHOLE log, never the zoomed slice — a peak that moved when you
       changed zoom wouldn't be a peak. Derived from the entries rather than read off MetaTFT's
       ranked.peak_rating_numeric so it stays consistent with what's actually plotted (and so it
       still works for a hand-typed log with no sync). Ties go to the earliest entry: the peak was
       first reached then, and later visits back to the same value aren't new peaks. */
    const allVals = full.map(tftEntryValue);
    const peakVal = Math.max(...allVals);
    const peakEntry = full[allVals.indexOf(peakVal)];

    /* Fold the peak into the y-domain so the line is always on screen. A reference line that
       silently vanishes whenever you're well below it is worse than none — that's exactly when it
       has something to say. The cost is that a big peak-to-current gap compresses the recent
       detail, which is the honest picture of that gap. */
    const domain = vals.concat([peakVal]);

    /* The target gets folded in too, but conditionally — unlike the peak it's aspirational and can
       sit arbitrarily far above the data. Zooming out to fit a Challenger goal from Emerald would
       flatten a whole set's climb into a line at the bottom of the card. So: free if it already
       falls inside the plotted range, otherwise only if reaching it doesn't more than roughly
       double the visible span. When it doesn't fit, the marker pins to the top edge instead, so the
       LP-to-go number is still on screen even though the line can't be. */
    const TFT_TARGET_ZOOMOUT_MAX = 2.5;
    const tgtVal = tftTargetValue();
    const dMin = Math.min(...domain), dMax = Math.max(...domain);
    const tgtFits = tgtVal != null
      && (tgtVal <= dMax || (tgtVal - dMin) <= Math.max(dMax - dMin, 60) * TFT_TARGET_ZOOMOUT_MAX);
    if(tgtFits) domain.push(tgtVal);

    const rawSpan = Math.max(60, Math.max(...domain) - Math.min(...domain));
    let minV = Math.max(0, Math.min(...domain) - rawSpan*0.14);
    let maxV = Math.max(...domain) + rawSpan*0.14;
    if(minV >= maxV){ minV = 0; maxV = 400; }
    const xOf = i => padL + (hist.length===1 ? 0 : (i/(hist.length-1)) * (W-padL-padR));
    const yOf = v => padT + (1-(v-minV)/(maxV-minV)) * (H-padT-padB);
    const plotBottom = H - padB;

    /* Gridlines at TIER boundaries only — one per 400 (four divisions × 100). Ruling every
       sub-tier would put 28 dashed lines on the plot. Master's floor is 7*400 = 2800, which the
       same rule catches for free; there is nothing above it to rule, because Grandmaster and
       Challenger share Master's step. */
    let gridSvg = '';
    let boundaries = 0;
    const firstTierIdx = Math.ceil(minV/400);
    const lastTierIdx = Math.min(TFT_APEX_STEP/4, Math.floor(maxV/400));
    for(let idx=firstTierIdx; idx<=lastTierIdx; idx++){
      const t = TFT_TIERS[idx];
      if(!t) continue;
      const y = yOf(idx*400);
      const c = t.color;
      gridSvg += '<line x1="'+padL+'" y1="'+y.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+y.toFixed(1)+'" stroke="'+hexToRgba(c,0.5)+'" stroke-width="1" stroke-dasharray="3 4"/>';
      gridSvg += '<text class="val-chart-tierlbl" x="'+(padL+3)+'" y="'+(y-5).toFixed(1)+'" fill="'+c+'">'+escapeHtml(t.name)+'</text>';
      boundaries++;
    }
    // the whole range can sit inside one tier, leaving no horizontal reference at all — fall back
    // to two neutral rules labelled in rank terms
    if(boundaries < 1){
      [1/3, 2/3].forEach(f=>{
        const v = minV + (maxV-minV)*f;
        const y = yOf(v);
        gridSvg += '<line x1="'+padL+'" y1="'+y.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+y.toFixed(1)+'" stroke="var(--border)" stroke-width="1" stroke-dasharray="3 4"/>';
        gridSvg += '<text class="val-chart-tierlbl" x="'+(padL+3)+'" y="'+(y-5).toFixed(1)+'" fill="var(--muted)">'+escapeHtml(tftLabelForValue(v))+'</text>';
      });
    }

    let linePath = '';
    hist.forEach((h,i)=>{ linePath += (i?'L':'M') + xOf(i).toFixed(1)+' '+yOf(vals[i]).toFixed(1)+' '; });
    const endColor = tftTierColor(hist[hist.length-1].tier);
    const areaSvg = '<path d="'+linePath+'L'+xOf(hist.length-1).toFixed(1)+' '+plotBottom+' L'+xOf(0).toFixed(1)+' '+plotBottom+' Z" fill="url(#tftArea'+tftGradId+')"/>';
    const defsSvg = '<defs><linearGradient id="tftArea'+tftGradId+'" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0%" stop-color="'+endColor+'" stop-opacity="0.28"/>'
      + '<stop offset="100%" stop-color="'+endColor+'" stop-opacity="0"/></linearGradient></defs>';

    // each segment keeps its destination tier's color, so a climb into Diamond visibly turns purple
    let lineSvg = '';
    for(let i=1;i<hist.length;i++){
      const segColor = tftTierColor(hist[i].tier || hist[i-1].tier);
      lineSvg += '<line x1="'+xOf(i-1).toFixed(1)+'" y1="'+yOf(vals[i-1]).toFixed(1)+'" x2="'+xOf(i).toFixed(1)+'" y2="'+yOf(vals[i]).toFixed(1)+'" stroke="'+segColor+'" stroke-width="2" stroke-linecap="round"/>';
    }

    // dots only at tier changes — one per entry turns an "All" zoom into a bead chain, and the
    // hover readout covers reading any individual game
    const changeIdx = [];
    hist.forEach((h,i)=>{ if(i>0 && h.tier !== hist[i-1].tier) changeIdx.push(i); });
    let dotsSvg = '';
    new Set([0].concat(changeIdx)).forEach(i=>{
      dotsSvg += '<circle cx="'+xOf(i).toFixed(1)+'" cy="'+yOf(vals[i]).toFixed(1)+'" r="3" fill="'+tftTierColor(hist[i].tier)+'" stroke="var(--surface)" stroke-width="1.5"/>';
    });
    const lastX = xOf(hist.length-1), lastY = yOf(vals[hist.length-1]);
    dotsSvg += '<circle cx="'+lastX.toFixed(1)+'" cy="'+lastY.toFixed(1)+'" r="7" fill="'+hexToRgba(endColor,0.22)+'"/>'
      + '<circle cx="'+lastX.toFixed(1)+'" cy="'+lastY.toFixed(1)+'" r="3.8" fill="'+endColor+'" stroke="var(--surface)" stroke-width="1.5"/>';

    /* Peak line + star. Gold and dashed so it can't be mistaken for a tier boundary (those are
       dashed in their own tier's colour) or for the data line itself. The star sits in the right
       margin at the line's height, so it tracks upward on its own the moment a new peak lands —
       nothing has to be stored or updated for that, since peakVal is recomputed every render. */
    const peakY = yOf(peakVal);
    const peakLineEnd = W - padR - 13;
    const atPeakNow = peakVal === vals[vals.length-1];
    let peakSvg = '<line x1="'+padL+'" y1="'+peakY.toFixed(1)+'" x2="'+peakLineEnd+'" y2="'+peakY.toFixed(1)+'"'
      + ' stroke="var(--gold)" stroke-width="1.5" stroke-dasharray="5 3" opacity="0.85"/>'
      + '<text class="tft-peak-star" x="'+(W-padR-4)+'" y="'+peakY.toFixed(1)+'" text-anchor="middle" dominant-baseline="central">★</text>';
    // the label is the first thing to go at phone widths, where it would collide with the line
    if(!narrow){
      peakSvg += '<text class="tft-peak-lbl" x="'+(peakLineEnd-5)+'" y="'+(peakY-7).toFixed(1)+'" text-anchor="end">'
        + (atPeakNow ? 'At peak · ' : 'Peak · ')
        + escapeHtml(tftRankLabel(peakEntry.tier, peakEntry.division) + ' ' + peakEntry.lp + ' LP')
        + '</text>';
    }

    /* How far under the peak you are, hanging off the star. This one survives narrow widths where
       the text label above doesn't — it's the number being asked for, and it's readable in a few
       characters. The connector is drawn before the dots, so the current-value ring paints over its
       lower end and it reads as terminating at where you stand now. */
    const lastVal = vals[vals.length-1];
    const lastValY = yOf(lastVal);
    const peakGap = peakVal - lastVal; // peak is a global max, so this can never go negative
    const gapX = W - padR - 4;
    if(peakGap > 0){
      peakSvg += '<line x1="'+gapX+'" y1="'+(peakY+8).toFixed(1)+'" x2="'+gapX+'" y2="'+lastValY.toFixed(1)+'"'
        + ' stroke="var(--gold)" stroke-width="1" stroke-dasharray="2 3" opacity="0.7"/>';
    }
    // centre the number on the connector, but never let it ride up into the peak line when the gap
    // is only a few pixels tall, and never past the bottom into the date labels
    const gapY = Math.min(
      Math.max(peakY + 14, (peakY + lastValY) / 2),
      plotBottom - 3
    );
    peakSvg += '<text class="tft-peak-gap'+(peakGap === 0 ? ' at-peak' : '')+'" x="'+(gapX-6)+'" y="'+gapY.toFixed(1)+'" text-anchor="end">'
      + (peakGap > 0 ? ('−' + peakGap + ' LP') : 'on peak') + '</text>';

    /* Target line — the peak marker's counterpart, in violet against the peak's gold so the two
       reference lines can never be confused with each other or with a tier boundary. The LP-to-go
       number is the point of it, so that renders at every width; the rank name is the part that
       drops on a phone. */
    if(tgtVal != null){
      const toGo = tgtVal - lastVal;
      const reached = toGo <= 0;
      if(tgtFits){
        const ty = yOf(tgtVal);
        peakSvg += '<line x1="'+padL+'" y1="'+ty.toFixed(1)+'" x2="'+peakLineEnd+'" y2="'+ty.toFixed(1)+'"'
          + ' stroke="var(--violet)" stroke-width="1.5" stroke-dasharray="4 4" opacity="0.85"/>'
          + '<text class="tft-tgt-mark" x="'+(W-padR-4)+'" y="'+ty.toFixed(1)+'" text-anchor="middle" dominant-baseline="central">◆</text>';
        if(!narrow){
          peakSvg += '<text class="tft-tgt-lbl" x="'+(peakLineEnd-5)+'" y="'+(ty-7).toFixed(1)+'" text-anchor="end">Target · '
            + escapeHtml(tftRankLabel(state.tft.target.tier, state.tft.target.division)) + '</text>';
        }
        // sits just under its own line, mirroring how the peak gap hangs under the star
        peakSvg += '<text class="tft-tgt-gap'+(reached ? ' reached' : '')+'" x="'+(peakLineEnd-5)+'" y="'+(ty+13).toFixed(1)+'" text-anchor="end">'
          + (reached ? 'target reached' : ('+' + toGo + ' LP to go')) + '</text>';
      } else {
        // off the top of the scale — pin it to the ceiling so the number survives even though the
        // line would have squashed the data
        peakSvg += '<text class="tft-tgt-gap" x="'+(W-padR-4)+'" y="'+(padT-8).toFixed(1)+'" text-anchor="end">◆ +'
          + toGo + ' LP to ' + escapeHtml(tftRankLabel(state.tft.target.tier, state.tft.target.division)) + ' ↑</text>';
      }
    }

    const labelIdxs = narrow ? [0, hist.length-1] : [0, Math.floor((hist.length-1)/2), hist.length-1];
    let xLabelSvg = '';
    [...new Set(labelIdxs)].forEach(i=>{
      const anchor = i===0 ? 'start' : (i===hist.length-1 ? 'end' : 'middle');
      const x = i===0 ? padL : (i===hist.length-1 ? W-padR : xOf(i));
      xLabelSvg += '<text class="val-chart-axlbl" x="'+x.toFixed(1)+'" y="'+(H-7)+'" text-anchor="'+anchor+'">'+escapeHtml(fmtDate(parseLocalDateStr(hist[i].date).getTime()))+'</text>';
    });

    const net = vals[vals.length-1] - vals[0];
    const summary = 'TFT LP history, '+hist.length+' entries, from '+tftEntryLabel(hist[0])
      + ' to '+tftEntryLabel(hist[hist.length-1])+', net '+(net>0?'plus ':'')+net+' LP.'
      + ' Peak '+tftEntryLabel(peakEntry)
      + (atPeakNow ? ', which is where you are now.' : ', '+(peakVal - vals[vals.length-1])+' LP above where you are now.')
      + (tgtVal == null ? '' : (tgtVal - vals[vals.length-1] <= 0
          ? ' Target reached.'
          : ' Target ' + tftRankLabel(state.tft.target.tier, state.tft.target.division)
            + ', ' + (tgtVal - vals[vals.length-1]) + ' LP to go.'));

    wrap.innerHTML = '<svg class="val-chart-svg" viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" role="img" tabindex="0">'
      + defsSvg + gridSvg + areaSvg + lineSvg + peakSvg + dotsSvg + xLabelSvg
      + '<line class="val-chart-cursor" x1="0" y1="'+padT+'" x2="0" y2="'+plotBottom+'"/>'
      + '<circle class="val-chart-hoverdot" cx="0" cy="0" r="5" stroke="var(--surface)" stroke-width="2"/>'
      + '</svg>'
      + '<div class="val-chart-tip" hidden>'
      + '<div class="val-chart-tip-date"></div>'
      + '<div class="val-chart-tip-rank"></div>'
      + '<div class="val-chart-tip-rr"><span class="val-chart-tip-rrval"></span><span class="val-chart-tip-delta"></span></div>'
      + '</div>';
    tftGradId++;
    // .hovering lives on the container, which survives the innerHTML above — without this a
    // re-render leaves the previous hover state on, stranding the crosshair at the new SVG's 0,0
    wrap.classList.remove('hovering');

    renderTftStats(hist);

    const svgEl = wrap.querySelector('svg');
    svgEl.setAttribute('aria-label', summary); // set as a property — rank names reach it unescaped
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
      const c = tftTierColor(h.tier);
      cursorEl.setAttribute('x1', x.toFixed(1)); cursorEl.setAttribute('x2', x.toFixed(1));
      hoverDotEl.setAttribute('cx', x.toFixed(1)); hoverDotEl.setAttribute('cy', y.toFixed(1));
      hoverDotEl.setAttribute('fill', c);
      wrap.classList.add('hovering');
      tipEl.hidden = false;
      tipEl.style.setProperty('--tier', c);
      tipEl.querySelector('.val-chart-tip-date').textContent = fmtDate(parseLocalDateStr(h.date).getTime())
        + (h.placement != null ? ('  ·  ' + h.placement + (h.placement===1?'st':(h.placement===2?'nd':(h.placement===3?'rd':'th')))) : '  ·  rank check');
      tipEl.querySelector('.val-chart-tip-rank').textContent = tftRankLabel(h.tier, h.division);
      tipEl.querySelector('.val-chart-tip-rrval').textContent = h.lp + ' LP';
      const d = i > 0 ? (vals[i] - vals[i-1]) : 0;
      const deltaEl = tipEl.querySelector('.val-chart-tip-delta');
      deltaEl.textContent = d > 0 ? ('▲ +'+d) : (d < 0 ? ('▼ '+d) : '–');
      deltaEl.className = 'val-chart-tip-delta ' + (d > 0 ? 'up' : (d < 0 ? 'down' : 'flat'));
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
    svgEl.addEventListener('keydown', e=>{
      if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
        e.preventDefault();
        showHoverAt((hoverIdx < 0 ? hist.length-1 : hoverIdx) + (e.key === 'ArrowRight' ? 1 : -1));
      } else if(e.key === 'Home'){ e.preventDefault(); showHoverAt(0); }
      else if(e.key === 'End'){ e.preventDefault(); showHoverAt(hist.length-1); }
      else if(e.key === 'Escape'){ hideHover(); }
    });
  }

  /* Stats strip, scoped to the chart's current zoom range so there's one control and one set of
     numbers — same arrangement as the RR chart's. Rates carry their sample size in the label
     rather than standing alone as a bare percentage. */
  function renderTftStats(hist){
    const statsEl = el('tftStatsStrip');
    const played = hist.filter(e=> e.placement != null);
    const n = played.length;
    const net = tftEntryValue(hist[hist.length-1]) - tftEntryValue(hist[0]);
    const netCls = net > 0 ? 'up' : (net < 0 ? 'down' : 'flat');
    const netGlyph = net > 0 ? '▲' : (net < 0 ? '▼' : '–');

    const avgPlace = n ? (played.reduce((a,e)=>a+e.placement, 0)/n).toFixed(2) : '—';
    const top4 = n ? Math.round(played.filter(e=>e.placement <= 4).length/n*100) + '%' : '—';
    const wins = n ? Math.round(played.filter(e=>e.placement === 1).length/n*100) + '%' : '—';
    const lpPerGame = n ? ((net/n >= 0 ? '+' : '') + (net/n).toFixed(1)) : '—';

    function tile(num, lbl, cls){
      return '<div class="val-chart-stat"><div class="val-chart-stat-num'+(cls?' '+cls:'')+'">'+num+'</div>'
        + '<div class="val-chart-stat-lbl">'+lbl+'</div></div>';
    }
    statsEl.innerHTML =
        tile('<span aria-hidden="true">'+netGlyph+'</span> '+(net>0?'+':'')+net, 'Net LP this range', netCls)
      + tile(n, 'Games', '')
      + tile(avgPlace, n ? 'Avg place · '+n+' games' : 'Avg place', '')
      + tile(top4, n ? 'Top 4 · '+n+' games' : 'Top 4', '')
      + tile(wins, n ? '1st · '+n+' games' : '1st', '')
      + tile(lpPerGame, 'LP / game', '');
  }

  function renderTftSyncPanel(){
    const cfg = state.tft.sync;
    el('tftSyncRegion').value = cfg.region;
    if(document.activeElement !== el('tftSyncRiotId')) el('tftSyncRiotId').value = cfg.riotId;
    el('tftSyncAuto').checked = !!cfg.auto;
    const btn = el('tftSyncBtn');
    btn.disabled = tftSyncInFlight;
    btn.textContent = tftSyncInFlight ? 'Syncing…' : '↻ Sync now';

    const statusEl = el('tftSyncStatus');
    statusEl.classList.remove('err','ok');
    if(tftSyncInFlight){
      statusEl.textContent = 'Fetching from MetaTFT…';
    } else if(cfg.lastError){
      statusEl.classList.add('err');
      statusEl.textContent = cfg.lastError;
    } else if(cfg.lastSyncedAt){
      statusEl.classList.add('ok');
      const mins = Math.round((Date.now() - cfg.lastSyncedAt)/60000);
      statusEl.textContent = (tftSyncNote || 'Synced.') + ' Last checked '
        + (mins < 1 ? 'just now' : mins + ' min ago') + '.';
    } else {
      statusEl.textContent = 'Not synced yet — LP and placements are pulled from your MetaTFT profile.';
    }
  }

  function renderTft(){
    renderTftSyncPanel();
    renderTftCurrentCard();
    renderTftTarget();
    renderTftChart();
    renderTftLog();
  }

  /* ---------- sync panel wiring ---------- */
  // code first: the select is narrow on a phone, and the platform code is the part that has to stay
  // readable when the label clips — it's the value that actually decides whether a lookup resolves
  el('tftSyncRegion').innerHTML = TFT_REGIONS.map(r=>
    '<option value="'+r.v+'">'+escapeHtml(r.v.toUpperCase()+' · '+r.l)+'</option>').join('');
  el('tftSyncRegion').addEventListener('change', ()=>{
    state.tft.sync.region = el('tftSyncRegion').value;
    state.tft.sync.lastError = '';
    save(); renderTftSyncPanel();
  });
  el('tftSyncRiotId').addEventListener('change', ()=>{
    state.tft.sync.riotId = el('tftSyncRiotId').value.trim();
    state.tft.sync.lastError = '';
    save(); renderTftSyncPanel();
  });
  el('tftSyncAuto').addEventListener('change', ()=>{
    state.tft.sync.auto = el('tftSyncAuto').checked;
    save();
  });
  /* Auto-sync fires on entering the TFT panel, not on a timer: the data only changes when you play,
     and a poll would keep hitting someone else's API from a tab sitting open in the background.
     The cooldown makes flipping between the two games cheap. */
  function maybeAutoSyncTft(){
    const cfg = state.tft.sync;
    if(!cfg.auto || !cfg.riotId || tftSyncInFlight) return;
    if(cfg.lastSyncedAt && (Date.now() - cfg.lastSyncedAt) < TFT_SYNC_COOLDOWN_MS) return;
    tftSync();
  }

  el('tftSyncBtn').addEventListener('click', ()=>{
    // commit whatever is in the field first, so pressing Sync straight after typing works without
    // having to blur the input
    state.tft.sync.riotId = el('tftSyncRiotId').value.trim();
    tftSync();
  });

  /* ---------- add / edit handlers ---------- */
  function showTftAddErr(msg){
    const e = el('tftAddErr');
    e.textContent = msg;
    e.style.display = msg ? 'block' : 'none';
  }

  function addTftEntry(){
    const tier = el('tftAddTier').value;
    const division = parseInt(el('tftAddDiv').value, 10) || 4;
    const lpRaw = el('tftAddLp').value.trim();
    const placementRaw = el('tftAddPlacement').value;
    const date = el('tftAddDate').value || localDateStr(new Date());

    if(!TFT_TIERS[TFT_TIER_INDEX[tier]]){ showTftAddErr('Pick a tier.'); return; }
    if(lpRaw === ''){ showTftAddErr('Enter your LP.'); return; }
    const lp = Number(lpRaw);
    if(!Number.isFinite(lp) || lp < 0 || Math.floor(lp) !== lp){ showTftAddErr('LP has to be a whole number, 0 or more.'); return; }
    // above Master LP is unbounded, but inside a division 100 promotes you — a "Gold II 150 LP"
    // record would sit past the division above it on the scale and quietly distort every delta
    if(!tftIsApex(tier) && lp > 99){ showTftAddErr('LP inside a division runs 0–99 — pick the next division up.'); return; }
    showTftAddErr('');

    state.tft.entries.push({
      id: uid(),
      date,
      createdAt: Date.now(),
      tier,
      division: tftIsApex(tier) ? 4 : division,
      lp,
      placement: placementRaw === '' ? null : parseInt(placementRaw, 10)
    });
    // capped because this rides in the SHARED app_data row, which is re-serialized and re-uploaded
    // in full on every save from any tab (see CLAUDE.md, "Data safety")
    if(state.tft.entries.length > TFT_MAX_ENTRIES){
      state.tft.entries = tftSortedEntries().slice(-TFT_MAX_ENTRIES);
    }
    // first entry anchors an already-set target, so the bar measures from where the climb started
    if(state.tft.target.tier && state.tft.target.startValue == null){
      state.tft.target.startValue = tftValue(tier, division, lp);
    }
    save();
    closeTftLogModal();
    renderTft();
  }

  /* ---------- log-a-game modal ----------
     Hand-rolled like every other modal in this app (there's no shared helper — see the finance
     add-account overlay for the same shape). The form used to sit inline under the chart, but with
     sync doing the logging it's a rare action, and a permanent six-control row read as the primary
     way in when it isn't. */
  let tftLogReturnFocus = null;
  function openTftLogModal(){
    showTftAddErr('');
    // start from where you actually are — you're logging a game played from the current rank, so
    // tier and division are nearly always right. LP is left blank: it's the thing that changed.
    const cur = tftCurrentEntry();
    if(cur){ el('tftAddTier').value = cur.tier; el('tftAddDiv').value = String(cur.division); }
    el('tftAddLp').value = '';
    el('tftAddPlacement').value = '';
    el('tftAddDate').value = localDateStr(new Date());
    tftSyncDivVisibility();
    tftLogReturnFocus = document.activeElement;
    el('tftLogOverlay').style.display = 'flex';
    el('tftAddLp').focus();
  }
  function closeTftLogModal(){
    el('tftLogOverlay').style.display = 'none';
    // hand focus back to whatever opened it, so keyboard users aren't dropped at the top of the page
    if(tftLogReturnFocus && tftLogReturnFocus.focus) tftLogReturnFocus.focus();
    tftLogReturnFocus = null;
  }
  el('tftOpenLogBtn').addEventListener('click', openTftLogModal);
  el('tftLogCloseBtn').addEventListener('click', closeTftLogModal);
  el('tftLogOverlay').addEventListener('click', e=>{ if(e.target === el('tftLogOverlay')) closeTftLogModal(); });
  document.addEventListener('keydown', e=>{
    if(e.key === 'Escape' && el('tftLogOverlay').style.display === 'flex') closeTftLogModal();
  });

  el('tftAddBtn').addEventListener('click', addTftEntry);
  el('tftAddLp').addEventListener('keydown', e=>{ if(e.key === 'Enter') addTftEntry(); });
  el('tftAddTier').addEventListener('change', tftSyncDivVisibility);

  // Target edits commit on `change`, never on `input`: every commit is a full re-upload of the
  // shared row, so a per-keystroke save would re-send every goal, habit and finance record in the
  // app once per digit typed.
  function commitTftTarget(){
    const tier = el('tftTargetTier').value;
    const t = state.tft.target;
    const wasKey = t.tier + '|' + t.division + '|' + t.lp;
    t.tier = tier;
    t.division = parseInt(el('tftTargetDiv').value, 10) || 4;
    const lpRaw = el('tftTargetLp').value.trim();
    t.lp = lpRaw === '' ? 0 : Math.max(0, Math.floor(Number(lpRaw)) || 0);
    // re-anchor only when the target itself moved — editing the deadline shouldn't reset progress
    if(tier && (t.tier + '|' + t.division + '|' + t.lp) !== wasKey){
      const cur = tftCurrentEntry();
      t.startValue = cur ? tftEntryValue(cur) : null;
      t.setAt = Date.now();
    }
    if(!tier){ t.startValue = null; t.setAt = null; }
    save();
    renderTft();
  }
  ['tftTargetTier','tftTargetDiv','tftTargetLp'].forEach(id=>{
    el(id).addEventListener('change', commitTftTarget);
  });
  // the season end is app-wide, not part of a target — changing it must not re-anchor progress
  el('tftSeasonEnd').addEventListener('change', ()=>{
    state.tft.season.endDate = el('tftSeasonEnd').value || '';
    save(); renderTft();
  });

  // the chart is drawn at the container's real pixel width, so a resize has to redraw it — same
  // reason valorant.js observes its own chart wrap
  if(window.ResizeObserver){
    let tftLastW = 0;
    new ResizeObserver(entries=>{
      const w = Math.round(entries[0].contentRect.width);
      if(!w || Math.abs(w - tftLastW) < 8) return;
      tftLastW = w;
      if(state.games.active === 'tft') renderTftChart();
    }).observe(el('tftChartWrap'));
  }
