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
      + '<div style="margin-top:8px;display:flex;gap:8px;">'
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
    CURRENCIES.forEach(c=>{ if(state.finance.rates[c]===undefined) state.finance.rates[c] = DEFAULT_RATES[c]; });
    state.finance.accounts.forEach(a=>{
      if(a.currency===undefined) a.currency = 'USD';
      if(a.imageUrl===undefined) a.imageUrl = '';
      if(a.transactions===undefined) a.transactions = [];
      if(a.open===undefined) a.open = false;
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
    state.valorant = parsed.valorant || { apiKey:'', accounts:[], selectedAccountId:null, sortMode:'manual' };
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
    state.profile = parsed.profile || {name:'',age:'',netWorth:'',netWorthCurrency:'USD',avatarImage:'',avatarGeneratedAt:null,race:'',skinTone:'',hairColor:'',hairStyle:'',eyeColor:'',clothing:'',background:''};
    if(!state.profile.netWorthCurrency) state.profile.netWorthCurrency = 'USD';
    if(!state.profile.avatarImage) state.profile.avatarImage = '';
    if(state.profile.avatarGeneratedAt === undefined) state.profile.avatarGeneratedAt = null;
    ['race','skinTone','hairColor','hairStyle','eyeColor','clothing','background'].forEach(k=>{ if(!state.profile[k]) state.profile[k] = ''; });
    state.focus = parsed.focus || null;
    state.darkMode = !!parsed.darkMode;
  }

  // force=true skips the conflict check and overwrites unconditionally — only used when the user
  // explicitly chooses to (the conflict banner's "keep my changes" button, or restoring a backup).
  async function save(force){
    try{
      if(!loadedOk) return; // never overwrite remote data before we've confirmed what it actually contains
      if(usingClaudeStorage){ await setWithRetry('app-data', JSON.stringify(state)); return; }
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
    }catch(e){ console.error('save failed', e); }
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
        }catch(e){
          // A missing key on first-ever run is expected and not a real error — only warn on genuine failures.
          const msg = (e && e.message) || String(e);
          if(/not found|no such key|does not exist/i.test(msg)){
            loadedOk = true;
          } else {
            console.error('load failed', e);
            showLoadWarning();
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
            showLoadWarning();
          } else {
            if(data && data.data) applyLoadedState(data.data);
            lastKnownUpdatedAt = data ? data.updated_at : null;
            loadedOk = true;
          }
        }
      }
    }catch(e){
      console.error('load failed', e);
      showLoadWarning();
    }
    el('pfName').value = state.profile.name || '';
    el('pfAge').value = state.profile.age || '';
    el('valApiKey').value = state.valorant.apiKey || '';
    renderAboutMe();
    applyDarkMode();
    renderAll();
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

