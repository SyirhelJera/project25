  /* ---------- persistence ----------
     This app can run two ways:
     1) Inside Claude (claude.ai) — uses the built-in window.storage API automatically, no setup needed.
     2) Deployed elsewhere (e.g. GitHub Pages) — window.storage won't exist, so it falls back to Supabase.
        No login: every visitor reads/writes the same shared row (see SHARED_ROW_ID below).
        Anyone with the link can view and edit the data — there's no per-user separation.
        To enable that, create a free Supabase project, then:
          a) Table + policy (run in the Supabase SQL editor):
               create table app_data (
                 id text primary key,
                 data jsonb,
                 updated_at timestamptz default now()
               );
               alter table app_data enable row level security;
               create policy "Anyone can read and write" on app_data
                 for all using (true) with check (true);
          b) Paste your Project URL and anon public key below.
  ---------------------------------- */
  const SUPABASE_URL = 'https://gsmzeqybnacjtxtrpuil.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzbXplcXlibmFjanR4dHJwdWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NDI3OTIsImV4cCI6MjEwMDExODc5Mn0.99hVBDa3ZWFxj4rRQFfBW28MCgsaWHT7PTJFZJqca8I';

  const usingClaudeStorage = (typeof window.storage !== 'undefined' && window.storage && typeof window.storage.get === 'function');
  const supabaseConfigured = !SUPABASE_URL.includes('YOUR_SUPABASE') && !SUPABASE_ANON_KEY.includes('YOUR_SUPABASE');
  // No login: everyone who opens this page reads/writes the same row. Anyone with the
  // link can view and edit the data — there is no per-user separation.
  const SHARED_ROW_ID = 'shared';
  let supa = null;
  // Guards against clobbering remote data with the in-memory defaults: save() is a no-op until
  // a load has genuinely succeeded (either real data was applied, or we positively confirmed
  // there's nothing saved yet). A failed/ambiguous load must never be allowed to trigger a save.
  let loadedOk = false;
  // The row's updated_at as of our last successful load/save. save() uses this for optimistic
  // concurrency: if another tab/device saved after we last read, our updated_at is stale and the
  // conditional write below matches zero rows, so we stop instead of silently clobbering their edit.
  let lastKnownUpdatedAt = null;
  let conflictShown = false;

  function showConflictBanner(){
    if(conflictShown) return;
    conflictShown = true;
    const b = el('conflictBanner');
    b.style.display = 'block';
    b.innerHTML = 'Another tab or device saved newer changes to this data after this page loaded its copy. Your latest edit here was <b>not saved</b>, to avoid overwriting theirs.'
      + '<div class="conflict-actions">'
      + '<button class="btn btn-sm btn-primary" id="conflictReloadBtn">Reload to see their changes</button>'
      + '<button class="btn btn-sm btn-ghost" id="conflictForceBtn">Keep my changes (overwrite theirs)</button>'
      + '</div>';
    el('conflictReloadBtn').addEventListener('click', ()=> window.location.reload());
    el('conflictForceBtn').addEventListener('click', async ()=>{ await save(true); });
  }
  function hideConflictBanner(){
    if(!conflictShown) return;
    conflictShown = false;
    el('conflictBanner').style.display = 'none';
  }

  /* ---------- offline data cache ----------
     Mirrors the last known-good state into localStorage so the app has something
     to show when Supabase (or window.storage) can't be reached — e.g. no signal
     on the iPhone, or the desktop browser is offline. This is a read fallback,
     not a sync engine: save() still uses the existing optimistic-concurrency
     check (lastKnownUpdatedAt) once connectivity returns, so a stale offline
     copy can never silently clobber a newer save made elsewhere.
  ---------------------------------------- */
  const OFFLINE_CACHE_KEY = 'p25-offline-data';
  function cacheStateLocally(){
    // updatedAt travels with the snapshot so a fresh offline load can restore it into
    // lastKnownUpdatedAt below — without it, the first save() after reconnecting would
    // fall through to the unconditional upsert branch and could clobber a newer remote save.
    try{ localStorage.setItem(OFFLINE_CACHE_KEY, JSON.stringify({ data: state, cachedAt: Date.now(), updatedAt: lastKnownUpdatedAt })); }
    catch(e){ /* private browsing / storage quota — best effort only */ }
  }
  function loadLocalCache(){
    try{
      const raw = localStorage.getItem(OFFLINE_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    }catch(e){ return null; }
  }
  function showOfflineBanner(msg){
    const b = el('offlineBanner');
    if(!b) return;
    b.style.display = 'block';
    b.innerHTML = msg;
  }
  function hideOfflineBanner(){
    const b = el('offlineBanner');
    if(b) b.style.display = 'none';
  }
  // Falls back to the local mirror when a live load fails. Returns true if a cached
  // copy existed and was applied; the generic load-warning banner is shown otherwise.
  function fallbackToLocalCache(){
    const cached = loadLocalCache();
    if(cached && cached.data){
      applyLoadedState(cached.data);
      if(cached.updatedAt !== undefined) lastKnownUpdatedAt = cached.updatedAt;
      loadedOk = true;
      const when = cached.cachedAt ? new Date(cached.cachedAt).toLocaleString() : 'earlier';
      showOfflineBanner('You’re offline — showing your last synced copy (from ' + escapeHtml(when) + '). '
        + 'Anything you change here is saved on this device and will sync once you’re back online.');
      return true;
    }
    showLoadWarning();
    return false;
  }
  // Retry a pending write once connectivity returns. save() re-checks lastKnownUpdatedAt
  // itself, so this is safe even if nothing actually changed while offline.
  window.addEventListener('online', () => { if(loadedOk) save(); });

  function showSetupBanner(msg){
    const b = el('setupBanner');
    b.style.display = 'block';
    b.innerHTML = msg || 'This copy of Project 25 isn\u2019t connected to a database yet, so nothing will be saved between visits. Open <code>js/persistence.js</code> and fill in <code>SUPABASE_URL</code> / <code>SUPABASE_ANON_KEY</code> near the top (see the comment above them for the one-time Supabase setup steps).';
  }

  function initSupabaseIfNeeded(){
    if(usingClaudeStorage) return true;
    if(!supabaseConfigured){ showSetupBanner(); return false; }
    if(supa) return true;
    try{
      supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      return true;
    }catch(e){
      console.error('Supabase init failed', e);
      showSetupBanner('Could not connect to Supabase. Double-check your URL/key, then reload.');
      return false;
    }
  }

  function applyLoadedState(parsed){
    state.goals = parsed.goals || [];
    state.habits = parsed.habits || [];
    state.countdowns = parsed.countdowns || [];
    state.countdowns.forEach(c=>{ if(c.pinned===undefined) c.pinned=false; if(c.createdAt===undefined) c.createdAt=Date.now(); });
    state.mantras = parsed.mantras || [];
    state.checklists = parsed.checklists || [];
    if(parsed.checklistExp === undefined){
      // upgrading from before exp was tracked separately from item-checked state — seed with
      // whatever's currently checked so the exp bar doesn't jump backward on upgrade
      state.checklistExp = state.checklists.reduce((sum,c)=> sum + (c.items||[]).filter(i=>i.done).length, 0);
    } else {
      state.checklistExp = parsed.checklistExp;
    }
    state.finance = parsed.finance || { accounts: [], subscriptions: [], moneyGoals: [], rates: Object.assign({}, DEFAULT_RATES) };
    if(!state.finance.accounts) state.finance.accounts = [];
    if(!state.finance.subscriptions) state.finance.subscriptions = [];
    if(!state.finance.moneyGoals) state.finance.moneyGoals = [];
    if(!state.finance.rates) state.finance.rates = Object.assign({}, DEFAULT_RATES);
    if(!state.finance.netWorthHistory) state.finance.netWorthHistory = [];
    CURRENCIES.forEach(c=>{ if(state.finance.rates[c]===undefined) state.finance.rates[c] = DEFAULT_RATES[c]; });
    state.finance.accounts.forEach(a=>{
      if(a.currency===undefined) a.currency = 'USD';
      if(a.imageUrl===undefined) a.imageUrl = '';
      if(a.transactions===undefined) a.transactions = [];
      if(a.open===undefined) a.open = false;
      a.transactions.forEach(t=>{ if(t.category===undefined) t.category = ''; });
    });
    state.finance.subscriptions.forEach(s=>{
      if(s.currency===undefined) s.currency = 'USD';
      if(s.cycle===undefined) s.cycle = 'monthly';
      if(s.nextDate===undefined) s.nextDate = '';
      if(s.imageUrl===undefined) s.imageUrl = '';
    });
    state.finance.moneyGoals.forEach(m=>{
      if(m.currency===undefined) m.currency = 'USD';
      if(m.deadline===undefined) m.deadline = '';
      if(m.open===undefined) m.open = false;
      if(m.contributions===undefined){
        // upgrade from the old single "saved" number into an equivalent first contribution entry
        m.contributions = (m.saved && parseFloat(m.saved)>0) ? [{ id:uid(), amount:parseFloat(m.saved), note:'', createdAt:m.createdAt||Date.now() }] : [];
      }
    });
    state.fitness = parsed.fitness || { currentWeight:'', targetWeight:'', height:'', age:'', sex:'male', activity:'1.55', pace:'0.5', unit:'kg', weightLog:[] };
    if(!state.fitness.unit) state.fitness.unit = 'kg';
    if(!state.fitness.weightLog) state.fitness.weightLog = [];
    if(!state.fitness.progressPhotos) state.fitness.progressPhotos = [];
    state.valorant = parsed.valorant || { apiKey:'', accounts:[], selectedAccountId:null, sortMode:'manual', wishlist:[] };
    if(!state.valorant.apiKey) state.valorant.apiKey = '';
    if(!state.valorant.accounts) state.valorant.accounts = [];
    if(!state.valorant.sortMode) state.valorant.sortMode = 'manual';
    state.valorant.accounts.forEach(a=>{
      if(!a.platform) a.platform = 'pc';
      if(!a.history) a.history = [];
      if(a.current===undefined) a.current = null;
      if(a.error===undefined) a.error = '';
      if(a.group===undefined) a.group = '';
      if(a.lastAgent===undefined) a.lastAgent = '';
    });
    if(state.valorant.selectedAccountId===undefined) state.valorant.selectedAccountId = null;
    // per-Riot-account daily store snapshots, keyed by the label passed to
    // scripts/valorant-login.mjs (e.g. "main", "smurf") — written by scripts/valorant-check-store.mjs,
    // run locally by the app owner (see README.md), never set by this client, just read/displayed
    if(!state.valorant.dailyStores) state.valorant.dailyStores = {};
    if(state.valorant.dailyStore || state.valorant.dailyStoreError){
      // upgrade from the old single-account shape into one entry labeled "default"
      if(!state.valorant.dailyStores.default){
        state.valorant.dailyStores.default = Object.assign({}, state.valorant.dailyStore, { error: state.valorant.dailyStoreError||'' });
      }
    }
    delete state.valorant.dailyStore;
    delete state.valorant.dailyStoreError;
    // scripts/valorant-local-server.mjs connection — the URL is a sensible default so most users
    // never need to touch it; the token is pasted in once from that script's console output
    if(state.valorant.localServerUrl===undefined) state.valorant.localServerUrl = '';
    if(state.valorant.localServerToken===undefined) state.valorant.localServerToken = '';
    // which account's store the Valorant tab shows — '' means "all accounts" (stacked)
    if(state.valorant.selectedStoreLabel===undefined) state.valorant.selectedStoreLabel = '';
    // gun/skin names the user wants a heads-up about when they rotate into the daily store —
    // matched against dailyStores items in valWishlistMatchesForItem() (see valorant.js)
    if(!state.valorant.wishlist) state.valorant.wishlist = [];
    state.valorant.wishlist.forEach(w=>{
      if(w.imageUrl===undefined) w.imageUrl = '';
      if(w.skinUuid===undefined) w.skinUuid = '';
    });
    state.profile = parsed.profile || {name:'',age:'',netWorth:'',netWorthCurrency:'USD',race:'',skinTone:'',hairColor:'',hairStyle:'',eyeColor:'',clothing:'',background:''};
    if(!state.profile.netWorthCurrency) state.profile.netWorthCurrency = 'USD';
    // avatarImage/avatarGeneratedAt: dropped along with the AI avatar feature (used to embed a
    // large base64 image straight into this shared row, re-transferred on every load/save).
    // Deleting rather than just not-setting purges it from any row saved before this change —
    // the first save() after upgrading writes state.profile back out without the field at all.
    delete state.profile.avatarImage;
    delete state.profile.avatarGeneratedAt;
    ['race','skinTone','hairColor','hairStyle','eyeColor','clothing','background'].forEach(k=>{ if(!state.profile[k]) state.profile[k] = ''; });
    state.focus = parsed.focus || null;
    state.playSession = parsed.playSession || null;
    state.theme = parsed.theme || (parsed.darkMode ? 'dark' : 'light');
    state.mosaicColors = parsed.mosaicColors || { filled:'', today:'', empty:'' };
    ['filled','today','empty'].forEach(k=>{ if(state.mosaicColors[k]===undefined) state.mosaicColors[k] = ''; });
    state.dailyActivity = parsed.dailyActivity || {};
  }

  // Saves must run strictly one at a time: doSave() reads lastKnownUpdatedAt at the start and
  // only updates it at the end, so two overlapping calls (e.g. two clicks in quick succession,
  // or a debounced save landing mid-flight) would both read the same stale value — the second
  // to finish would then fail its own conditional update and falsely report a conflict with
  // "another device", when really it only raced itself. Chaining every call onto savePromise
  // guarantees each save sees the previous one's result before it starts.
  let savePromise = Promise.resolve();
  function save(force){
    recomputeDailyActivity();
    snapshotNetWorth();
    savePromise = savePromise.then(()=> doSave(force));
    return savePromise;
  }
  // force=true skips the conflict check and overwrites unconditionally — only used when the user
  // explicitly chooses to (the conflict banner's "keep my changes" button, or restoring a backup).
  async function doSave(force){
    if(!loadedOk) return; // never overwrite remote data before we've confirmed what it actually contains
    cacheStateLocally(); // mirror to this device first, so the edit survives even if the sync below fails
    try{
      if(usingClaudeStorage){ await setWithRetry('app-data', JSON.stringify(state)); hideOfflineBanner(); return; }
      if(!supa) return;
      const nowIso = new Date().toISOString();
      let data, error;
      if(lastKnownUpdatedAt && !force){
        ({ data, error } = await supa.from('app_data')
          .update({ data: state, updated_at: nowIso })
          .eq('id', SHARED_ROW_ID)
          .eq('updated_at', lastKnownUpdatedAt)
          .select('updated_at'));
        if(error) throw error;
        if(!data || data.length === 0){
          // The row's updated_at no longer matches what we last read — someone else saved in between.
          showConflictBanner();
          return;
        }
      } else {
        ({ data, error } = await supa.from('app_data')
          .upsert({ id: SHARED_ROW_ID, data: state, updated_at: nowIso })
          .select('updated_at'));
        if(error) throw error;
      }
      lastKnownUpdatedAt = (data && data[0] && data[0].updated_at) || nowIso;
      hideConflictBanner();
      hideOfflineBanner();
    }catch(e){
      console.error('save failed', e);
      showOfflineBanner('Couldn’t reach the server to save your latest change — it’s saved on this device '
        + 'and will sync automatically once you’re back online.');
    }
  }
  // Debounced save — collapses rapid-fire writes (e.g. typing in a number field) into a single
  // network/storage write after the user pauses, instead of one write per keystroke. This keeps
  // usage well within free-tier request limits (Supabase or otherwise) for fields that fire on
  // every 'input' event. Discrete actions (clicks, checkboxes, blur/change) still call save()
  // directly since those are already naturally infrequent.
  let saveDebounceTimer = null;
  function debouncedSave(delay){
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(save, delay || 700);
  }
  // best-effort flush of any pending debounced save when the user navigates away or hides the tab
  function flushPendingSave(){
    if(saveDebounceTimer){ clearTimeout(saveDebounceTimer); saveDebounceTimer = null; save(); }
  }
  window.addEventListener('beforeunload', flushPendingSave);
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'hidden') flushPendingSave(); });
  async function setWithRetry(key, value, attempts){
    attempts = attempts || 2;
    let lastErr = null;
    for(let i=0; i<attempts; i++){
      try{ return await window.storage.set(key, value, false); }
      catch(e){ lastErr = e; if(i < attempts-1) await new Promise(r=>setTimeout(r, 400)); }
    }
    throw lastErr;
  }
  async function load(){
    try{
      if(usingClaudeStorage){
        try{
          const res = await getWithRetry('app-data');
          if(res && res.value) applyLoadedState(JSON.parse(res.value));
          loadedOk = true;
          cacheStateLocally();
          hideOfflineBanner();
        }catch(e){
          // A missing key on first-ever run is expected and not a real error — only warn on genuine failures.
          const msg = (e && e.message) || String(e);
          if(/not found|no such key|does not exist/i.test(msg)){
            loadedOk = true;
          } else {
            console.error('load failed', e);
            fallbackToLocalCache();
          }
        }
      } else {
        const ready = await initSupabaseIfNeeded();
        if(ready){
          // maybeSingle() already returns { data: null, error: null } when the row simply doesn't
          // exist yet — it does NOT throw for that case. So any error here is a genuine failure
          // (network, permissions, missing table, ...) and must never be treated as "nothing saved yet".
          const { data, error } = await supa.from('app_data').select('data, updated_at').eq('id', SHARED_ROW_ID).maybeSingle();
          if(error){
            console.error('load failed', error);
            fallbackToLocalCache();
          } else {
            if(data && data.data) applyLoadedState(data.data);
            lastKnownUpdatedAt = data ? data.updated_at : null;
            loadedOk = true;
            cacheStateLocally();
            hideOfflineBanner();
          }
        }
      }
    }catch(e){
      console.error('load failed', e);
      fallbackToLocalCache();
    }
    el('pfName').value = state.profile.name || '';
    el('pfAge').value = state.profile.age || '';
    el('valApiKey').value = state.valorant.apiKey || '';
    el('valLocalToken').value = state.valorant.localServerToken || '';
    renderAboutMe();
    applyTheme();
    renderAll();
    resumePlaySessionIfAny();
    hideLoadScreen();
  }

  function hideLoadScreen(){
    const s = el('loadScreen');
    if(!s) return;
    s.classList.add('load-screen-hidden');
    setTimeout(()=>{ s.style.display = 'none'; }, 250);
  }

  function showLoadWarning(){
    const b = el('loadWarningBanner');
    b.style.display = 'block';
    b.innerHTML = 'Couldn\u2019t load your saved data just now, so this page may be showing an empty or out-of-date state. Your existing data likely hasn\u2019t been lost — '
      + '<button id="loadRetryBtn" style="background:none;border:none;text-decoration:underline;cursor:pointer;color:inherit;font:inherit;padding:0;">try reloading</button>.';
    const btn = document.getElementById('loadRetryBtn');
    if(btn) btn.addEventListener('click', ()=> window.location.reload());
  }

  // window.storage can occasionally fail transiently — retry once after a short delay before giving up
  async function getWithRetry(key, attempts){
    attempts = attempts || 2;
    let lastErr = null;
    for(let i=0; i<attempts; i++){
      try{ return await window.storage.get(key, false); }
      catch(e){ lastErr = e; if(i < attempts-1) await new Promise(r=>setTimeout(r, 400)); }
    }
    throw lastErr;
  }


  ['pfName','pfAge'].forEach(id=>{
    el(id).addEventListener('change', ()=>{
      state.profile.name = el('pfName').value;
      state.profile.age = el('pfAge').value;
      save();
      renderGoals();
    });
  });

