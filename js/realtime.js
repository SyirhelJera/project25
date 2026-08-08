  /* ================= LIVE SYNC =================
     Makes a change on one device show up on the others within about a second, without a reload.

     Before this file, load() ran exactly once (main.js) and nothing ever re-read the row. Ticking
     a checklist item on the desktop left the phone showing a stale copy indefinitely — and worse,
     the phone's lastKnownUpdatedAt was now stale too, so its *next* save failed the optimistic
     concurrency check in doSave() and raised the conflict banner. The failure mode wasn't just
     staleness, it was blocked writes.

     Scope: the shared row (id='shared') only. Jobs and Notes keep their own rows and their own
     save-and-banner model — nothing in here reads or writes state.jobs / state.notes.
     Requires supabase/setup-realtime.sql to have been run once. If it hasn't, this file degrades
     to doing nothing (one console warning) and the app behaves exactly as it did before.

     Two things make this more than "re-fetch on change":

     1. THREE-WAY MERGE AT TOP-LEVEL-KEY GRANULARITY. Replacing state wholesale would throw away
        whatever the receiving device had edited but not yet saved. Instead we keep a snapshot of
        both sides as of the last time we were in sync, and per top-level key of `state` decide:
        only remote moved -> take theirs; only we moved -> keep ours and push it; both moved ->
        take theirs (that's the value actually committed) and offer a one-click undo. Since the
        tabs are independent, a Finance edit here and a Goals edit there simply both survive, and
        the conflict banner stops appearing for anything but a genuine same-tab collision.

     2. TWO BASE SNAPSHOTS, NOT ONE. applyLoadedState() fills in defaults on the way in, so the
        hydrated local object is legitimately not byte-equal to the raw payload the server holds
        (a finance account with no `currency` comes back hydrated to 'USD'). Comparing hydrated
        local against a raw remote base would flag every key as changed forever. So syncBaseLocal
        holds the hydrated view and syncBaseRemote the raw one, both captured at the same instant,
        and each side is only ever compared against its own kind.

     Ordering note: applying a remote change is chained onto persistence.js's savePromise, the
     same queue doSave() uses. That's what stops a merge from landing in the middle of an in-flight
     save and moving lastKnownUpdatedAt out from under it (which would surface as a phantom
     "another device saved" conflict against ourselves).
  ---------------------------------------------- */

  // state.jobs / state.notes live in their own rows and are not part of this blob — same
  // exclusion as doSave()'s `const { jobs, notes, ...mainState } = state`.
  const SYNC_EXCLUDED_KEYS = ['jobs', 'notes'];

  /* jsonb does not preserve key order: what Postgres hands back is sorted by its own rules, not
     the order we wrote. Plain JSON.stringify would therefore report a difference on every single
     key on the first event after load. Sorting keys on both sides makes the two comparable. */
  function stableStringify(v){
    if(v === undefined) return undefined;
    return JSON.stringify(v, (key, val)=>{
      if(val && typeof val === 'object' && !Array.isArray(val)){
        const sorted = {};
        Object.keys(val).sort().forEach(k=>{ sorted[k] = val[k]; });
        return sorted;
      }
      return val;
    });
  }

  // The two views of "what both sides looked like when we were last in agreement". Null until the
  // first capture, which is what makes every function below a no-op before load() has finished.
  let syncBaseLocal = null;   // hydrated: stableStringify(state[k]) after applyLoadedState()
  let syncBaseRemote = null;  // raw: stableStringify(payload[k]) exactly as the row holds it

  /* MUST run before applyLoadedState() touches the payload. That function fills in its defaults
     *in place* (state.finance and parsed.finance end up the same object), so a snapshot taken
     afterwards would be the hydrated view wearing the raw view's name — and every subsequent
     comparison would be against the wrong thing. Returns a map to hand to captureSyncBase(). */
  function captureRemoteBase(payload){
    const out = {};
    if(payload && typeof payload === 'object'){
      Object.keys(payload).forEach(k=>{
        if(SYNC_EXCLUDED_KEYS.includes(k)) return;
        out[k] = stableStringify(payload[k]);
      });
    }
    return out;
  }

  /* Runs after hydration. remoteBase comes from captureRemoteBase(); omit it after a successful
     save, when we've just written our own hydrated state to the row and the two views coincide. */
  function captureSyncBase(remoteBase){
    // Nothing below this line can run without a Supabase connection, and both snapshots are a
    // full stringify of the blob — not worth paying on every save inside Claude, where there's no
    // realtime transport to use them. Leaving the bases null also keeps mergeRemote() inert.
    if(usingClaudeStorage || !supa) return;
    syncBaseLocal = {};
    Object.keys(state).forEach(k=>{
      if(SYNC_EXCLUDED_KEYS.includes(k)) return;
      syncBaseLocal[k] = stableStringify(state[k]);
    });
    syncBaseRemote = remoteBase || Object.assign({}, syncBaseLocal);
  }

  /* ---------- echo suppression ----------
     doSave() mints updated_at itself and only assigns lastKnownUpdatedAt once the round trip
     returns, so the Realtime event for our own write can (and often does) arrive first. Stamps go
     into this set before the request and are forgotten well after, so a write is recognisable as
     ours during that window. Compared by instant rather than by string: Postgres' wire format for
     a timestamptz isn't guaranteed byte-identical to the ISO string PostgREST echoes back.
  --------------------------------------- */
  const pendingWriteStamps = new Set();
  function noteOwnWrite(stamp){
    if(!stamp) return;
    pendingWriteStamps.add(stamp);
    setTimeout(()=> pendingWriteStamps.delete(stamp), 30000);
  }
  function sameStamp(a, b){
    if(!a || !b) return false;
    const ta = Date.parse(a), tb = Date.parse(b);
    return !isNaN(ta) && ta === tb;
  }
  function isOwnWrite(stamp){
    // lastKnownUpdatedAt counts too: an event carrying the stamp we already hold is, by
    // definition, not news — whoever wrote it, we're already showing that version.
    if(sameStamp(stamp, lastKnownUpdatedAt)) return true;
    for(const s of pendingWriteStamps){ if(sameStamp(s, stamp)) return true; }
    return false;
  }

  /* ---------- which sections a changed key affects ----------
     renderAll() rebuilds all twelve tabs, which is both far more work than needed and visibly
     destructive: it resets the goals working-carousel's scroll position and reshuffles nothing
     back into place. Mapping key -> renderers keeps a remote checklist tick from disturbing the
     tab you're actually looking at. A key with no entry here falls through to renderAll(), so a
     top-level state key added later can never silently stop syncing.
  --------------------------------------------------------- */
  /* Renderers are addressed by id and wrapped in thunks so that (a) several changed keys asking
     for the same redraw collapse to one call, and (b) the identifier is resolved when the merge
     runs rather than when this object is built — renderAll/applyTheme/applyMosaicColors live in
     main.js, which loads *after* this file. */
  const SYNC_RENDER_FNS = {
    goals:            ()=> renderGoals(),
    checkin:          ()=> renderCheckin(),
    focus:            ()=> renderFocus(),
    habits:           ()=> renderHabits(),
    checklists:       ()=> renderChecklists(),
    exp:              ()=> updateExpUI(),
    play:             ()=> renderPlayOverlay(),
    countdowns:       ()=> renderCountdowns(),
    pinnedCountdown:  ()=> renderPinnedCountdown(),
    mantras:          ()=> renderMantras(),
    mantra:           ()=> renderMantra(),
    // deliberately not shuffleMotivationImages(): that's a once-per-load action (see the comment
    // on it in motivation.js) and reshuffling here would make the slideshow jump every time an
    // unrelated device saved.
    motivation:       ()=> renderMotivation(),
    finance:          ()=> renderFinance(),
    fitness:          ()=> renderFitness(),
    valorant:         ()=> renderValorant(),
    clock:            ()=> renderClock(),
    wishlist:         ()=> renderWishlist(),
    jobAccounts:      ()=> renderJobAccounts(),
    jobs:             ()=> renderJobs(),
    protectedDays:    ()=> renderProtectedDays(),
    mosaicColors:     ()=> applyMosaicColors(),
    mosaicInputs:     ()=> renderMosaicColorInputs(),
    theme:            ()=> applyTheme(),
    tabOrder:         ()=> applyTabOrder(),
    tabOrderSettings: ()=> renderTabOrderSettings(),
    all:              ()=> renderAll()
  };

  // renderGoals() already fans out to renderFocus / renderMantra / renderPinnedCountdown /
  // renderWorkingCarousel, and renderChecklists() to renderStrugglingTasks — only the siblings
  // they *don't* reach are listed alongside them.
  const SYNC_RENDERERS = {
    goals:            ['goals', 'checkin'],
    profile:          ['goals', 'finance'],
    focus:            ['focus'],
    habits:           ['habits', 'goals'],
    checklists:       ['checklists', 'habits', 'exp'],
    checklistExp:     ['exp'],
    playSession:      ['play'],
    countdowns:       ['countdowns', 'pinnedCountdown'],
    mantras:          ['mantras', 'mantra'],
    motivation:       ['motivation'],
    finance:          ['finance', 'goals'],
    fitness:          ['fitness'],
    valorant:         ['valorant'],
    clock:            ['clock'],
    wishlist:         ['wishlist'],
    jobSiteAccounts:  ['jobAccounts'],
    jobCategoryColors:['jobs'],
    protectedDays:    ['protectedDays', 'habits', 'checklists'],
    dailyActivity:    ['pinnedCountdown'],
    mosaicColors:     ['mosaicColors', 'mosaicInputs', 'pinnedCountdown'],
    theme:            ['theme'],
    tabOrder:         ['tabOrder', 'tabOrderSettings']
  };

  function runRenderer(id){
    try{ SYNC_RENDER_FNS[id](); }
    catch(e){ console.error('live sync: renderer "' + id + '" failed', e); }
  }
  function renderSyncedKeys(keys){
    if(!keys.length) return;
    // An unmapped key means a top-level state key was added without being wired up here. Falling
    // back to the full redraw keeps it syncing correctly rather than silently going stale.
    if(keys.some(k=> !SYNC_RENDERERS[k])){ runRenderer('all'); return; }
    const ids = new Set();
    keys.forEach(k=> SYNC_RENDERERS[k].forEach(id=> ids.add(id)));
    ids.forEach(runRenderer);
  }

  /* ---------- deferred rendering ----------
     The merge itself always runs immediately — data and timestamps must stay correct, or the next
     local save conflicts for no reason. Only the *re-render* waits, and only while a field has
     focus, because every render*() in this app rebuilds its section's innerHTML and would throw
     away the caret (several tabs already re-focus inputs after rendering for exactly this reason).
     Waiting for focusout is also what makes half-typed text safe: a text input that only commits
     on 'change' fires that on blur, i.e. before the queued render reads state back out.
  ---------------------------------------- */
  let pendingRenderKeys = new Set();
  let pendingRenderTimer = null;
  function isEditableFocused(){
    const ae = document.activeElement;
    if(!ae || ae === document.body) return false;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) || ae.isContentEditable === true;
  }
  function scheduleSyncRender(keys){
    if(!keys.length) return;
    if(!isEditableFocused() && !pendingRenderKeys.size){ renderSyncedKeys(keys); return; }
    keys.forEach(k=> pendingRenderKeys.add(k));
    // Ceiling so a field left focused (a phone with the keyboard up, a stuck modal) can't wedge
    // the UI as permanently stale.
    if(!pendingRenderTimer) pendingRenderTimer = setTimeout(drainSyncRender, 5000);
  }
  function drainSyncRender(){
    clearTimeout(pendingRenderTimer);
    pendingRenderTimer = null;
    if(!pendingRenderKeys.size) return;
    const keys = Array.from(pendingRenderKeys);
    pendingRenderKeys = new Set();
    renderSyncedKeys(keys);
  }
  // focusout fires before the next element takes focus, so re-check on the following tick —
  // tabbing between two inputs must not count as "done editing".
  document.addEventListener('focusout', ()=>{
    setTimeout(()=>{ if(!isEditableFocused()) drainSyncRender(); }, 0);
  });

  /* ---------- collision banner ----------
     Reuses #conflictBanner rather than adding markup, and shares persistence.js's conflictShown
     flag so the two can't fight over the element. Different wording though: doSave()'s version
     means "your edit was rejected", this one means "your edit was replaced, here's it back".
  --------------------------------------- */
  const SYNC_KEY_LABELS = {
    goals:'Goals', profile:'your profile', focus:'the focus card', habits:'Habits',
    checklists:'Checklists', checklistExp:'checklist XP', playSession:'the play session',
    countdowns:'Countdowns', mantras:'Mantras', motivation:'Motivation', finance:'Finance',
    fitness:'Fitness', valorant:'Valorant', clock:'the Clock', wishlist:'the Wishlist',
    jobSiteAccounts:'Site Accounts', jobCategoryColors:'job category colors',
    protectedDays:'Protected Days', dailyActivity:'daily activity', mosaicColors:'mosaic colors',
    theme:'the theme', tabOrder:'tab order'
  };
  function syncKeyLabel(k){ return SYNC_KEY_LABELS[k] || k; }

  function showSyncCollisionBanner(keys, stashedLocal){
    const b = el('conflictBanner');
    if(!b) return;
    conflictShown = true; // declared in persistence.js — shared so hideConflictBanner() still works
    const names = keys.map(syncKeyLabel);
    const list = names.length === 1 ? names[0]
      : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
    b.style.display = 'block';
    b.innerHTML = 'Another device changed ' + escapeHtml(list) + ' at the same time as you did. '
      + 'Their version is what’s shown now, since it’s the one that actually saved.'
      + '<div class="conflict-actions">'
      + '<button class="btn btn-sm btn-primary" id="syncKeepMineBtn">Keep my version instead</button>'
      + '<button class="btn btn-sm btn-ghost" id="syncDismissBtn">Keep theirs</button>'
      + '</div>';
    el('syncKeepMineBtn').addEventListener('click', ()=>{
      Object.keys(stashedLocal).forEach(k=>{ state[k] = stashedLocal[k]; });
      hideConflictBanner();
      renderSyncedKeys(Object.keys(stashedLocal));
      save(true); // force: we're deliberately overwriting the version we just received
    });
    el('syncDismissBtn').addEventListener('click', hideConflictBanner);
  }

  /* ---------- the merge ---------- */

  // Merge-triggered saves are rate limited purely as a circuit breaker. The merge is designed to
  // converge (see the note on derived state below), but two devices ping-ponging saves at each
  // other is the one failure mode here that would burn quota unattended, so it gets a floor.
  let lastMergeSaveAt = 0;
  const MERGE_SAVE_MIN_GAP_MS = 2000;

  function mergeRemote(parsed, remoteUpdatedAt){
    if(!loadedOk || !syncBaseLocal || !syncBaseRemote) return;
    if(!parsed || typeof parsed !== 'object') return;

    // Normalize derived state before comparing, so a stale dailyActivity/netWorthHistory doesn't
    // read as a deliberate local edit. Both are pure functions of checklists/finance keyed by
    // today's date, so once the two devices agree on those they agree on these.
    recomputeDailyActivity();
    snapshotNetWorth();

    const keys = new Set(Object.keys(syncBaseLocal).concat(Object.keys(parsed)));
    SYNC_EXCLUDED_KEYS.forEach(k=> keys.delete(k));

    const merged = {};
    const changed = [];        // taken from remote -> needs a re-render
    const collided = [];       // both sides moved
    const stashedLocal = {};   // our value for collided keys, so the banner can hand it back
    // Built here rather than from `parsed` afterwards, because applyLoadedState() below hydrates
    // the payload in place — by the time it has run, `parsed` is no longer the raw remote view.
    const nextBaseRemote = {};
    let hasLocalOnly = false;

    keys.forEach(k=>{
      const remoteStr = stableStringify(parsed[k]);
      const localStr = stableStringify(state[k]);
      nextBaseRemote[k] = remoteStr;
      const remoteChanged = remoteStr !== syncBaseRemote[k];
      const localChanged = localStr !== syncBaseLocal[k];

      if(remoteChanged && !localChanged){
        merged[k] = parsed[k];
        changed.push(k);
      } else if(remoteChanged && localChanged){
        stashedLocal[k] = state[k];
        merged[k] = parsed[k]; // remote wins: it's the value that actually reached the server
        changed.push(k);
        collided.push(k);
      } else {
        // Only we moved, or neither did. Keeping the local object is what makes an unsaved edit
        // on this device survive someone else's save on a different tab.
        merged[k] = state[k];
        if(localChanged) hasLocalOnly = true;
      }
    });

    // Assign first so keys applyLoadedState() doesn't know about (tabOrder) are carried, then
    // hydrate so the merged result gets the same field defaults a fresh load would produce.
    Object.assign(state, merged);
    applyLoadedState(merged);

    lastKnownUpdatedAt = remoteUpdatedAt || lastKnownUpdatedAt;

    // Re-derive after the merge, then snapshot. Capturing the base *after* this means a
    // derived-only difference never triggers a push of its own — which is precisely what
    // guarantees the two devices stop talking instead of trading saves forever. The corrected
    // values ride along on the next ordinary save; neither is worth a round trip on its own.
    recomputeDailyActivity();
    snapshotNetWorth();
    captureSyncBase(nextBaseRemote);
    cacheStateLocally();

    scheduleSyncRender(changed);
    if(collided.length) showSyncCollisionBanner(collided, stashedLocal);
    else hideConflictBanner();

    // Push the keys only we moved, so the other device gets them too. lastKnownUpdatedAt is now
    // the stamp we just received, so this passes doSave()'s conditional update rather than
    // tripping it.
    if(hasLocalOnly && Date.now() - lastMergeSaveAt > MERGE_SAVE_MIN_GAP_MS){
      lastMergeSaveAt = Date.now();
      save();
    }
  }

  // Every path into the merge goes through here, so it can never overlap an in-flight doSave().
  function queueRemoteApply(parsed, remoteUpdatedAt){
    savePromise = savePromise.then(()=>{
      try{ mergeRemote(parsed, remoteUpdatedAt); }
      catch(e){ console.error('live sync: merge failed', e); }
    });
    return savePromise;
  }

  /* ---------- catch-up fetch ----------
     Realtime only delivers what happens while the socket is up. A phone that went in your pocket,
     a laptop that slept, or simply the gap between load() and SUBSCRIBED all leave holes. This
     re-reads the row and merges if it moved — it's the difference between "usually works" and
     "works".
  ------------------------------------- */
  let catchUpInFlight = false;
  let lastCatchUpAt = 0;
  const CATCH_UP_MIN_GAP_MS = 5000;
  async function catchUpFetch(force){
    if(!supa || !loadedOk || catchUpInFlight) return;
    // Alt-tabbing fires the focus/visibility hooks constantly; without a floor this would be a
    // request per switch. SUBSCRIBED and the conflict banner pass force, since those are the two
    // moments we genuinely can't afford to skip.
    if(!force && Date.now() - lastCatchUpAt < CATCH_UP_MIN_GAP_MS) return;
    catchUpInFlight = true;
    lastCatchUpAt = Date.now();
    try{
      // Two steps on purpose. The overwhelmingly common answer is "nothing changed", and asking
      // for `data` up front would pull the entire blob down on every tab switch — the same egress
      // trap the Valorant RPCs in supabase/setup-egress-fix.sql exist to avoid. `updated_at`
      // alone is a couple of hundred bytes.
      const probe = await supa.from('app_data')
        .select('updated_at').eq('id', SHARED_ROW_ID).maybeSingle();
      if(probe.error) throw probe.error;
      if(!probe.data) return; // row not created yet — nothing to catch up to
      if(sameStamp(probe.data.updated_at, lastKnownUpdatedAt)) return;

      const { data, error } = await supa.from('app_data')
        .select('data, updated_at').eq('id', SHARED_ROW_ID).maybeSingle();
      if(error) throw error;
      if(!data || sameStamp(data.updated_at, lastKnownUpdatedAt)) return;
      await queueRemoteApply(data.data || {}, data.updated_at);
    }catch(e){
      // Offline or unreachable: persistence.js's own offline handling already covers the user
      // -visible side of this, and the 'online' listener below retries. Nothing to announce.
      console.warn('live sync: catch-up fetch failed', e);
    }finally{
      catchUpInFlight = false;
    }
  }

  /* ---------- channel lifecycle ---------- */

  let realtimeChannel = null;
  let realtimeRetryDelay = 1000;
  let realtimeRetryTimer = null;
  let realtimeFailures = 0;
  let realtimeStarted = false;
  const REALTIME_MAX_RETRY_DELAY = 30000;

  function onRealtimeRowChange(payload){
    const row = payload && payload.new;
    // DELETE carries no `new`, and an oversized record (Realtime drops anything past
    // max_record_bytes, ~1MB) arrives as payload.errors with `new` empty. Both degrade to a
    // re-read rather than to silence — the second case is the one that matters, since a growing
    // blob would otherwise stop syncing with no symptom.
    if(!row || !row.data){
      if(payload && payload.errors) catchUpFetch(true);
      return;
    }
    if(row.id !== SHARED_ROW_ID) return;
    if(isOwnWrite(row.updated_at)) return;
    queueRemoteApply(row.data, row.updated_at);
  }

  function onRealtimeStatus(status){
    if(status === 'SUBSCRIBED'){
      realtimeFailures = 0;
      realtimeRetryDelay = 1000;
      catchUpFetch(true); // close the gap between load() and the socket coming up
      return;
    }
    if(status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED'){
      realtimeFailures++;
      // The overwhelmingly likely cause of a persistent CHANNEL_ERROR is the one-time SQL step
      // never having been run, and that's invisible from the browser otherwise.
      if(realtimeFailures === 3){
        console.warn('live sync: could not subscribe to app_data changes. If this keeps happening, '
          + 'run supabase/setup-realtime.sql once in the Supabase SQL editor — the table has to be '
          + 'in the supabase_realtime publication. The app works fine without it, just without '
          + 'live cross-device updates.');
      }
      scheduleRealtimeReconnect();
    }
  }

  function scheduleRealtimeReconnect(){
    if(realtimeRetryTimer) return;
    realtimeRetryTimer = setTimeout(()=>{
      realtimeRetryTimer = null;
      realtimeRetryDelay = Math.min(realtimeRetryDelay * 2, REALTIME_MAX_RETRY_DELAY);
      openRealtimeChannel();
    }, realtimeRetryDelay);
  }

  function openRealtimeChannel(){
    if(!supa) return;
    if(realtimeChannel){
      try{ supa.removeChannel(realtimeChannel); }catch(e){ /* already gone */ }
      realtimeChannel = null;
    }
    realtimeChannel = supa.channel('app-data-shared')
      // The filter matters: without it this client would receive the full Notes row on every
      // keystroke typed on another device, for data it doesn't even sync.
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'app_data', filter: 'id=eq.' + SHARED_ROW_ID },
        onRealtimeRowChange)
      .subscribe(onRealtimeStatus);
  }

  /* Called at the end of persistence.js:load(). No-ops inside Claude (window.storage has no
     realtime transport) and whenever the load didn't genuinely succeed — a merge must never run
     against a base we aren't sure of. */
  function initRealtime(){
    if(realtimeStarted) return;
    if(usingClaudeStorage || !supa || !loadedOk) return;
    realtimeStarted = true;
    openRealtimeChannel();

    // A suspended tab's websocket is usually dead without ever reporting an error, so coming back
    // to the foreground always re-reads rather than trusting the socket. Registered separately
    // from persistence.js's visibilitychange handler, which flushes pending saves on 'hidden'.
    document.addEventListener('visibilitychange', ()=>{
      if(document.visibilityState === 'visible') catchUpFetch();
    });
    window.addEventListener('online', ()=>{ catchUpFetch(); openRealtimeChannel(); });
    window.addEventListener('focus', catchUpFetch);
  }
