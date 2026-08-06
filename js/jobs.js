  /* ================= JOBS ================= */

  const JOB_STATUS_LABELS = { prospect:'Prospect', applied:'Applied', interviewing:'Interviewing', offer:'Offer', rejected:'Rejected', ghosted:'Ghosted (No Response)' };
  const JOB_STATUS_ORDER = { prospect:0, applied:1, interviewing:2, offer:3, rejected:4, ghosted:5 };
  const JOB_SOURCE_LABELS = { linkedin:'LinkedIn', indeed:'Indeed', 'company-site':'Company Site', referral:'Referral / Networking', other:'Other' };
  const JOB_WORK_MODEL_LABELS = { remote:'Remote', hybrid:'Hybrid', onsite:'On-site' };
  // no news after this many days since applying auto-flips 'applied' -> 'ghosted' (see autoMarkGhostedJobs
  // below). Scoped to 'applied' only — not 'interviewing' — since appliedDate is the only date we track,
  // and using it to judge a stalled interview would be wrong (the interview itself could've been recent).
  const JOB_GHOST_AFTER_DAYS = 30;

  // which job's detail overlay is open, if any — not persisted, resets per page load
  let openJobId = null;
  let jobFilter = 'prospect'; // Jobs opens on Prospect; nav.js resets it back to this on every tab click
  let jobSearch = '';
  let jobSortMode = 'none';
  let jobSortDir = 'desc';
  // which saved passwords are currently shown in plaintext (id -> true) — not persisted, resets per page load
  let jobAccountRevealed = {};

  /* ---------- jobs persistence ----------
     Jobs has its own storage resource, fully decoupled from the shared app-data blob that every
     other tab shares (see js/persistence.js's top comment). Reason: that blob is re-serialized and
     re-uploaded in full on EVERY save from ANY tab, so a growing list of job applications would be
     re-sent every time an unrelated habit got ticked, and vice versa.

     Supabase mode: a second row in the same app_data table, id='jobs' — no schema or RLS change
     needed (the existing "anyone can read/write" policy covers any id, and the row is created by
     this file's own .upsert() on first save). Claude-storage mode: a second window.storage key.

     This deliberately mirrors persistence.js's save()/load() 1:1 rather than being a simplified
     "best effort" version — it keeps the same safety properties: a loadedOk-style gate so a failed
     load can never trigger an overwrite, optimistic-concurrency conflict detection, an offline
     localStorage mirror, and a serialized save chain so overlapping saves can't race each other.

     Note state.jobSiteAccounts is NOT part of this split — it's a small bounded list of site logins,
     not a growth driver, and stays in the shared blob (hydrated by persistence.js as before).
  ---------------------------------------- */
  const JOBS_STORAGE_KEY = 'app-data-jobs';
  const JOBS_ROW_ID = 'jobs';
  const OFFLINE_JOBS_CACHE_KEY = 'p25-offline-data-jobs';
  let jobsLoadedOk = false;
  let lastKnownJobsUpdatedAt = null;
  let jobsConflictShown = false;

  // Hydration + lazy field defaults for job records — moved verbatim out of
  // persistence.js:applyLoadedState() when Jobs got its own storage resource. New fields on a job
  // record get their default added HERE rather than there (the one exception to the convention
  // documented in CLAUDE.md).
  function applyLoadedJobsState(parsed){
    state.jobs = (parsed && parsed.jobs) || [];
    state.jobs.forEach(j=>{
      if(j.group===undefined) j.group = '';
      if(j.logoUrl===undefined) j.logoUrl = '';
      if(j.workModel===undefined) j.workModel = '';
      if(j.hqLocation===undefined) j.hqLocation = '';
      if(j.companySiteUrl===undefined) j.companySiteUrl = '';
      if(j.postingUrl===undefined) j.postingUrl = '';
      if(j.salaryRange===undefined) j.salaryRange = '';
      if(j.resumeVersion===undefined) j.resumeVersion = '';
      if(j.resumeFileId===undefined) j.resumeFileId = '';
      if(j.resumeFileName===undefined) j.resumeFileName = '';
      if(j.resumeViewLink===undefined) j.resumeViewLink = '';
      if(j.coverLetterVersion===undefined) j.coverLetterVersion = '';
      if(j.portfolioLinks===undefined) j.portfolioLinks = '';
      if(j.source===undefined) j.source = '';
      if(j.sourceOther===undefined) j.sourceOther = '';
      if(j.status===undefined) j.status = 'applied';
      if(j.appliedDate===undefined) j.appliedDate = localDateStr(new Date(j.createdAt||Date.now()));
      if(!Array.isArray(j.contacts)) j.contacts = [];
      if(j.updatedAt===undefined) j.updatedAt = j.createdAt||Date.now();
    });
  }

  function cacheJobsStateLocally(){
    try{ localStorage.setItem(OFFLINE_JOBS_CACHE_KEY, JSON.stringify({ data: { jobs: state.jobs }, cachedAt: Date.now(), updatedAt: lastKnownJobsUpdatedAt })); }
    catch(e){ /* private browsing / storage quota — best effort only */ }
  }
  function loadLocalJobsCache(){
    try{
      const raw = localStorage.getItem(OFFLINE_JOBS_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    }catch(e){ return null; }
  }
  // Falls back to the local mirror when a live load fails. Also checks the shared blob's older
  // full-state cache as a second chance: on the first offline boot after Jobs got its own resource,
  // only that legacy cache exists yet, and it still holds a jobs array worth recovering.
  // Deliberately leaves jobsLoadedOk false when nothing is found, so saves stay blocked rather than
  // risking an empty overwrite of real remote data.
  function fallbackToLocalJobsCache(){
    let cached = loadLocalJobsCache();
    if(!(cached && cached.data)){
      try{
        const legacyRaw = localStorage.getItem(OFFLINE_CACHE_KEY);
        const legacy = legacyRaw ? JSON.parse(legacyRaw) : null;
        if(legacy && legacy.data && Array.isArray(legacy.data.jobs) && legacy.data.jobs.length){
          cached = { data: { jobs: legacy.data.jobs }, cachedAt: legacy.cachedAt, updatedAt: undefined };
        }
      }catch(e){ /* best effort only */ }
    }
    if(cached && cached.data){
      applyLoadedJobsState(cached.data);
      if(cached.updatedAt !== undefined) lastKnownJobsUpdatedAt = cached.updatedAt;
      jobsLoadedOk = true;
      const when = cached.cachedAt ? new Date(cached.cachedAt).toLocaleString() : 'earlier';
      showJobsOfflineBanner('You’re offline — showing your last synced copy of your applications (from ' + escapeHtml(when) + '). '
        + 'Anything you change here is saved on this device and will sync once you’re back online.');
      return true;
    }
    showJobsOfflineBanner('Couldn’t load your saved applications just now, so this tab may be showing an empty or out-of-date list. '
      + 'Your existing data likely hasn’t been lost — try reloading.');
    return false;
  }
  // Retry a pending write once connectivity returns, same as the shared blob's own handler.
  window.addEventListener('online', () => { if(jobsLoadedOk) saveJobs(); });

  /* Jobs-scoped conflict/offline banners. Deliberately NOT the global #conflictBanner/#offlineBanner:
     those are wired to whole-page-reload semantics for the shared blob, which would be the wrong
     (and confusing) response to a Jobs-only conflict now that the two save independently. */
  function showJobsConflictBanner(){
    if(jobsConflictShown) return;
    jobsConflictShown = true;
    const b = el('jobConflictBanner');
    if(!b) return;
    b.style.display = 'flex';
    b.innerHTML = '<span>Another tab or device saved newer changes to your applications after this page loaded its copy. Your latest edit here was <b>not saved</b>, to avoid overwriting theirs.</span>'
      + '<button class="btn btn-sm btn-primary" id="jobConflictReloadBtn">Reload applications</button>'
      + '<button class="btn btn-sm btn-ghost" id="jobConflictForceBtn">Keep my changes (overwrite theirs)</button>';
    // An in-place re-fetch is enough here (unlike the global banner's full page reload) precisely
    // because Jobs is self-contained now — nothing else on the page depends on this data, so there's
    // no reason to throw away whatever the user has in progress on another tab.
    el('jobConflictReloadBtn').addEventListener('click', async ()=>{
      await loadJobsData(null);
      hideJobsConflictBanner();
      renderJobs();
    });
    el('jobConflictForceBtn').addEventListener('click', async ()=>{ await saveJobs(true); });
  }
  function hideJobsConflictBanner(){
    if(!jobsConflictShown) return;
    jobsConflictShown = false;
    const b = el('jobConflictBanner');
    if(b) b.style.display = 'none';
  }
  function showJobsOfflineBanner(msg){
    const b = el('jobOfflineBanner');
    if(!b) return;
    b.style.display = 'flex';
    b.innerHTML = '<span>' + msg + '</span>';
  }
  function hideJobsOfflineBanner(){
    const b = el('jobOfflineBanner');
    if(b) b.style.display = 'none';
  }

  // Serialized like the shared save() for the same reason: two overlapping saves would both read the
  // same stale lastKnownJobsUpdatedAt and the second would falsely report a conflict against itself.
  let jobsSavePromise = Promise.resolve();
  function saveJobs(force){
    jobsSavePromise = jobsSavePromise.then(()=> doSaveJobs(force));
    return jobsSavePromise;
  }
  async function doSaveJobs(force){
    if(!jobsLoadedOk) return; // never overwrite remote data before we've confirmed what it contains
    cacheJobsStateLocally();
    try{
      if(usingClaudeStorage){ await setWithRetry(JOBS_STORAGE_KEY, JSON.stringify({ jobs: state.jobs })); hideJobsOfflineBanner(); return; }
      if(!supa) return;
      const nowIso = new Date().toISOString();
      let data, error;
      if(lastKnownJobsUpdatedAt && !force){
        ({ data, error } = await supa.from('app_data')
          .update({ data: { jobs: state.jobs }, updated_at: nowIso })
          .eq('id', JOBS_ROW_ID)
          .eq('updated_at', lastKnownJobsUpdatedAt)
          .select('updated_at'));
        if(error) throw error;
        if(!data || data.length === 0){ showJobsConflictBanner(); return; }
      } else {
        ({ data, error } = await supa.from('app_data')
          .upsert({ id: JOBS_ROW_ID, data: { jobs: state.jobs }, updated_at: nowIso })
          .select('updated_at'));
        if(error) throw error;
      }
      lastKnownJobsUpdatedAt = (data && data[0] && data[0].updated_at) || nowIso;
      hideJobsConflictBanner();
      hideJobsOfflineBanner();
    }catch(e){
      console.error('jobs save failed', e);
      showJobsOfflineBanner('Couldn’t reach the server to save your latest change — it’s saved on this device '
        + 'and will sync automatically once you’re back online.');
    }
  }

  /* Loads the dedicated Jobs resource, seeding it from the shared blob's legacy embedded copy the
     first time this code runs against data saved before the split.

     parsedMainState is the raw payload persistence.js:load() already parsed from the shared row/key
     this same boot (or null if it didn't exist / that load failed) — reused here purely to look for
     a pre-split state.jobs to migrate from, never re-fetched.

     ORDERING MATTERS: persistence.js awaits this before setting loadedOk = true, i.e. before the
     first shared-blob save becomes possible. That save no longer includes `jobs`, and a Supabase
     jsonb write REPLACES the column rather than merging, so it permanently strips the legacy copy
     out of the shared row. Seeding the new resource first — and awaiting it — is what guarantees
     there's never a window where the old copy is gone and the new one isn't durably written. */
  async function loadJobsData(parsedMainState){
    const legacyJobs = (parsedMainState && Array.isArray(parsedMainState.jobs)) ? parsedMainState.jobs : null;
    try{
      if(usingClaudeStorage){
        try{
          const res = await getWithRetry(JOBS_STORAGE_KEY);
          if(res && res.value){
            applyLoadedJobsState(JSON.parse(res.value));
            jobsLoadedOk = true;
          } else {
            await seedOrInitJobsState(legacyJobs);
          }
          cacheJobsStateLocally();
          hideJobsOfflineBanner();
        }catch(e){
          const msg = (e && e.message) || String(e);
          if(/not found|no such key|does not exist/i.test(msg)){
            await seedOrInitJobsState(legacyJobs);
            cacheJobsStateLocally();
            hideJobsOfflineBanner();
          } else {
            console.error('jobs load failed', e);
            fallbackToLocalJobsCache();
          }
        }
      } else {
        if(!supa) return; // Supabase unconfigured — persistence.js already surfaced the setup banner
        const { data, error } = await supa.from('app_data').select('data, updated_at').eq('id', JOBS_ROW_ID).maybeSingle();
        if(error){
          console.error('jobs load failed', error);
          fallbackToLocalJobsCache();
        } else if(data){
          // The resource EXISTS (even if it holds an empty list) — it is the sole source of truth
          // from here on. Never re-seed over it from the legacy copy: doing so would resurrect
          // applications the user has since deleted.
          applyLoadedJobsState(data.data);
          lastKnownJobsUpdatedAt = data.updated_at;
          jobsLoadedOk = true;
          cacheJobsStateLocally();
          hideJobsOfflineBanner();
        } else {
          await seedOrInitJobsState(legacyJobs);
          cacheJobsStateLocally();
          hideJobsOfflineBanner();
        }
      }
    }catch(e){
      // A Jobs-only failure must never propagate into persistence.js:load() and abort the whole
      // app's boot, which would strand every other tab behind the load screen.
      console.error('jobs load failed (unexpected)', e);
      fallbackToLocalJobsCache();
    }
  }

  // Only reached once the dedicated resource is positively confirmed absent. If the shared blob still
  // carries a pre-split jobs array, adopt it and persist it immediately as the new source of truth.
  async function seedOrInitJobsState(legacyJobs){
    applyLoadedJobsState({ jobs: legacyJobs && legacyJobs.length ? legacyJobs : [] });
    // Unlocking the save gate here is correct and required: we've just positively established what
    // the remote holds (nothing), which is exactly what this flag means — same reasoning as the
    // shared blob's own "key not found on first run => loadedOk = true" path. Without it the seed
    // write below would silently no-op, leaving the migrated data unpersisted.
    jobsLoadedOk = true;
    if(!(legacyJobs && legacyJobs.length)) return; // nothing to protect yet; the row gets created on first edit
    // force=true => unconditional upsert. If two devices hit this "first encounter" concurrently they
    // both write equivalent data and the last one wins, which is harmless; a conditional update could
    // fail one of them and leave the seed unwritten, which is not.
    await saveJobs(true);
  }

  /* ---------- subcategory pills ----------
     A job's subcategory is just free text on the record (j.group); its pill color is looked up by
     name in state.jobCategoryColors, so every application in a subcategory shares one color and
     recoloring one recolors them all. That map lives in the SHARED row, not the jobs row (see
     core.js) — so color edits save with save(), while j.group edits save with saveJobs(). */
  const JOB_GROUP_DEFAULT_COLOR = '#6366F1';
  // only ever emit a validated hex into an inline style attribute
  function jobGroupColor(name){
    const key = (name||'').trim();
    const raw = key ? ((state.jobCategoryColors||{})[key] || '') : '';
    return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : JOB_GROUP_DEFAULT_COLOR;
  }
  // dark text on light pills, white on dark ones — perceived-luminance split so any custom color stays readable
  function jobPillTextColor(hex){
    const n = parseInt(hex.slice(1), 16);
    const lum = 0.299*((n>>16)&255) + 0.587*((n>>8)&255) + 0.114*(n&255);
    return lum > 155 ? '#1F2937' : '#FFFFFF';
  }
  function jobGroupPillHtml(name){
    const key = (name||'').trim();
    if(!key) return '';
    const c = jobGroupColor(key);
    return '<span class="job-group-pill" style="background:'+c+';color:'+jobPillTextColor(c)+';">'+escapeHtml(key)+'</span>';
  }

  function jobSourceLabel(j){
    if(j.source === 'other') return j.sourceOther ? j.sourceOther : 'Other';
    return JOB_SOURCE_LABELS[j.source] || '';
  }

  function sortJobsBy(arr, mode, dir){
    const factor = dir === 'asc' ? 1 : -1;
    return arr.slice().sort((a,b)=>{
      let av, bv;
      if(mode === 'company'){ av = (a.company||'').toLowerCase(); bv = (b.company||'').toLowerCase(); }
      else if(mode === 'appliedDate'){ av = a.appliedDate||''; bv = b.appliedDate||''; }
      else if(mode === 'status'){ av = JOB_STATUS_ORDER[a.status]||0; bv = JOB_STATUS_ORDER[b.status]||0; }
      else if(mode === 'salary'){ av = (a.salaryRange||'').toLowerCase(); bv = (b.salaryRange||'').toLowerCase(); }
      else if(mode === 'group'){
        const ag = (a.group||'').trim(), bg = (b.group||'').trim();
        // '' isn't a category — unlabelled applications sink to the bottom either way, rather than
        // piling up on top in ascending order. Direction only reorders the named subcategories.
        if(!ag !== !bg) return ag ? -1 : 1;
        av = ag.toLowerCase(); bv = bg.toLowerCase();
      }
      else { av = 0; bv = 0; }
      if(av < bv) return -1*factor;
      if(av > bv) return 1*factor;
      // inside one subcategory, fall back to company so the block has a stable, readable order
      if(mode === 'group'){
        const ac = (a.company||'').toLowerCase(), bc = (b.company||'').toLowerCase();
        if(ac < bc) return -1*factor;
        if(ac > bc) return 1*factor;
      }
      return 0;
    });
  }

  /* Free-text search across the fields you'd actually remember an application by: company, job
     title, HQ location, where it came from, and any key contact (name, their title, their email).
     Whitespace-separated terms are ANDed, so "google recruiter" finds the Google row whose contact
     is a recruiter — each term may match a different field. */
  function jobSearchHaystack(j){
    return [
      j.company, j.title, j.hqLocation, jobSourceLabel(j),
      (j.contacts||[]).map(c=> c.name + ' ' + (c.title||'') + ' ' + (c.email||'')).join(' ')
    ].join(' ').toLowerCase();
  }
  function jobMatchesSearch(j, terms){
    if(!terms.length) return true;
    const hay = jobSearchHaystack(j);
    return terms.every(t=> hay.indexOf(t) !== -1);
  }
  function jobSearchTerms(){ return jobSearch.trim().toLowerCase().split(/\s+/).filter(Boolean); }
  // nav.js calls this on every Jobs tab click — open on the Prospect pile with an empty search box
  function resetJobsView(){
    jobFilter = 'prospect';
    jobSearch = '';
    const s = el('jobSearch'); if(s) s.value = '';
  }

  function visibleJobs(){
    let arr = state.jobs.slice();
    const terms = jobSearchTerms();
    /* A search always spans every status, ignoring the active chip. The tab opens on Prospect, so
       scoping matches to the current pile would hide the very row you're looking for — and you
       generally search because you don't remember which pile it's in. The chips take over again
       the moment the box is empty (and clicking one clears the search — see the chip handler). */
    if(terms.length){
      arr = arr.filter(j=> jobMatchesSearch(j, terms));
    } else if(jobFilter === 'prospect' || jobFilter === 'applied' || jobFilter === 'interviewing' || jobFilter === 'offer'){
      arr = arr.filter(j=>j.status===jobFilter);
    } else if(jobFilter === 'rejected-ghosted'){
      arr = arr.filter(j=>j.status==='rejected' || j.status==='ghosted');
    }
    if(jobSortMode !== 'none') return sortJobsBy(arr, jobSortMode, jobSortDir);
    return arr.sort((a,b)=> (b.createdAt||0) - (a.createdAt||0));
  }

  function touchJob(j){ j.updatedAt = Date.now(); }

  // silently flips stale 'applied' entries to 'ghosted' — runs on every renderJobs() call (cheap array
  // scan) so it self-corrects as soon as the tab is opened/re-rendered, with no separate scheduler needed
  function autoMarkGhostedJobs(){
    const cutoff = Date.now() - JOB_GHOST_AFTER_DAYS*24*60*60*1000;
    let changed = false;
    (state.jobs||[]).forEach(j=>{
      if(j.status === 'applied' && j.appliedDate && parseLocalDateStr(j.appliedDate).getTime() <= cutoff){
        j.status = 'ghosted';
        touchJob(j);
        changed = true;
      }
    });
    if(changed) saveJobs();
  }

  /* ---------- resume PDF attachment — uploaded straight to a Google Drive folder named
     "Uploaded Resumes" via the upload-resume Edge Function, same pattern as Fitness progress
     photos (js/fitness.js): only the Drive file id/link are kept in state, never the PDF bytes. ---------- */
  function jobResumeAttachmentHtml(j){
    if(usingClaudeStorage || !supabaseConfigured){
      return '<div class="field-row"><label>Resume PDF</label><div style="font-size:11.5px;color:var(--faint);">PDF attachment isn’t available in this mode.</div></div>';
    }
    const hasFile = !!j.resumeFileId;
    return '<div class="field-row"><label>Resume PDF</label>'
      + '<div class="job-resume-attach">'
      +   (hasFile
            ? '<span class="job-resume-filename">📎 '+escapeHtml(j.resumeFileName||'resume.pdf')+'</span>'
              + (j.resumeViewLink ? '<a href="'+escapeHtml(j.resumeViewLink)+'" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm">View in Drive ↗</a>' : '')
              + '<button type="button" class="btn btn-ghost btn-sm" id="jdResumeRemoveBtn">Remove</button>'
            : '<span style="font-size:11.5px;color:var(--faint);">No PDF attached yet.</span>')
      +   '<button type="button" class="btn btn-ghost btn-sm" id="jdResumeAttachBtn">'+(hasFile?'Replace PDF':'📎 Attach PDF')+'</button>'
      +   '<input type="file" accept="application/pdf" id="jdResumeFileInput" style="display:none;">'
      +   '<span id="jdResumeStatus" class="job-resume-status"></span>'
      + '</div></div>';
  }

  async function uploadJobResume(j, file){
    const statusEl = el('jdResumeStatus');
    if(usingClaudeStorage || !supabaseConfigured){
      if(statusEl) statusEl.textContent = 'Not available in this mode.';
      return;
    }
    if(file.type !== 'application/pdf'){
      if(statusEl) statusEl.textContent = 'Only PDF files are supported.';
      return;
    }
    if(!initSupabaseIfNeeded()) return;
    if(statusEl) statusEl.textContent = 'Uploading…';
    try{
      const dataUrl = await new Promise((resolve, reject)=>{
        const reader = new FileReader();
        reader.onload = ev => resolve(ev.target.result);
        reader.onerror = () => reject(new Error('Could not read the selected file.'));
        reader.readAsDataURL(file);
      });
      const commaIdx = dataUrl.indexOf(',');
      const fileBase64 = commaIdx>=0 ? dataUrl.slice(commaIdx+1) : dataUrl;
      const { data, error } = await supa.functions.invoke('upload-resume', {
        body: { fileBase64, filename: file.name, mimeType: 'application/pdf' }
      });
      if(error){
        let detail = '';
        if(error.context && typeof error.context.json === 'function'){
          try{ detail = (await error.context.json())?.error || ''; }catch(_){}
        }
        throw new Error(detail || error.message);
      }
      if(data && data.error) throw new Error(data.error);
      if(!data || !data.fileId) throw new Error('Upload didn’t return a file, try again.');
      j.resumeFileId = data.fileId;
      j.resumeFileName = file.name;
      j.resumeViewLink = data.webViewLink || '';
      touchJob(j);
      saveJobs();
      renderJobs();
    }catch(e){
      if(statusEl) statusEl.textContent = (e && e.message) ? e.message : 'Upload failed, try again.';
    }
  }

  function buildJobCard(j){
    const card = document.createElement('div'); card.className = 'job-card';
    const metaParts = [];
    if(j.workModel) metaParts.push(JOB_WORK_MODEL_LABELS[j.workModel] || j.workModel);
    if(j.appliedDate) metaParts.push('Applied ' + j.appliedDate);
    const srcLabel = jobSourceLabel(j);
    if(srcLabel) metaParts.push('via ' + escapeHtml(srcLabel));
    // one single-line row per application — the whole card is deliberately kept to ~32px tall so a
    // list of 100+ stays scannable; the full record is one click away in the detail overlay.
    // The logo slot always renders (initial-letter placeholder when there's no photo) so company
    // names stay vertically aligned down the whole list.
    card.innerHTML = (j.logoUrl
            ? '<img class="job-card-logo" src="'+escapeHtml(j.logoUrl)+'" alt="">'
            : '<span class="job-card-logo job-card-logo-ph">'+escapeHtml((j.company||'?').trim().charAt(0).toUpperCase())+'</span>')
        + '<div class="job-card-headtext">'
        +   '<span class="job-card-company">'+escapeHtml(j.company)+'</span>'
        +   '<span class="job-card-title">'+escapeHtml(j.title)+'</span>'
        + '</div>'
        + (metaParts.length ? '<div class="job-card-meta">'+metaParts.join(' · ')+'</div>' : '')
        + '<div class="job-card-badges">'
        +   jobGroupPillHtml(j.group)
        +   '<span class="job-status-badge job-status-'+j.status+'">'+JOB_STATUS_LABELS[j.status]+'</span>'
        + '</div>';
    card.addEventListener('click', ()=> openJobDetail(j.id));
    return card;
  }

  // red count bubble on the Jobs nav icon — same .nav-badge pattern as the Goals/Habits reminders.
  // Prospects are the only status that needs a nudge: nothing has been sent yet, so it's the one
  // pile that only moves if you act on it.
  function updateJobReminder(){
    const badge = el('jobProspectBadge');
    if(!badge) return;
    const n = (state.jobs||[]).filter(j=>j.status==='prospect').length;
    if(n){ badge.style.display = 'inline-flex'; badge.textContent = n; }
    else { badge.style.display = 'none'; }
  }

  function renderJobs(){
    autoMarkGhostedJobs();
    updateJobReminder();
    const list = el('jobList'); if(!list) return;
    list.innerHTML = '';
    const items = state.jobs || [];
    // Flat list — subcategories are surfaced by the colored pill on each card (jobGroupPillHtml),
    // not by collapsible section headers, so filtering/sorting stays the only thing reordering cards.
    const shown = visibleJobs();
    shown.forEach(j=> list.appendChild(buildJobCard(j)));

    // Empty state tracks the FILTERED view, not just the total: the tab opens on Prospect, so
    // "50 applications, none of them prospects" would otherwise render a blank page with no message.
    const empty = el('jobEmpty');
    empty.style.display = shown.length===0 ? 'block' : 'none';
    const q = jobSearch.trim();
    if(items.length === 0){
      empty.innerHTML = 'No applications tracked yet. <b>Add one above</b> to start.';
    } else if(q){
      empty.innerHTML = 'No applications match “'+escapeHtml(q)+'”.';
    } else {
      empty.innerHTML = 'Nothing in this filter — pick another above.';
    }

    el('jobStatTotal').textContent = items.length;
    el('jobStatProspect').textContent = items.filter(j=>j.status==='prospect').length;
    el('jobStatApplied').textContent = items.filter(j=>j.status==='applied').length;
    el('jobStatInterviewing').textContent = items.filter(j=>j.status==='interviewing').length;
    el('jobStatOffer').textContent = items.filter(j=>j.status==='offer').length;
    el('jobStatRejGhost').textContent = items.filter(j=>j.status==='rejected' || j.status==='ghosted').length;

    // while searching, no chip is highlighted — the filter genuinely isn't in effect, so showing one
    // as active would claim the results are scoped to it
    document.querySelectorAll('.job-filter-chip').forEach(c=>c.classList.remove('active-filter'));
    if(jobFilter !== 'all' && !jobSearch.trim()){
      const match = document.querySelector('.job-filter-chip[data-status="'+jobFilter+'"]');
      if(match) match.classList.add('active-filter');
    }

    if(openJobId) renderJobDetail();
    if(el('jobAccountsOverlay').style.display !== 'none') renderJobAccounts();
  }

  function addJob(){
    const companyInput = el('newJobCompany'); const titleInput = el('newJobTitle');
    const company = companyInput.value.trim(); const title = titleInput.value.trim();
    if(!company || !title) return;
    const now = Date.now();
    state.jobs.push({
      id: uid(), createdAt: now, updatedAt: now,
      company, group:'', logoUrl:'', workModel:'', hqLocation:'', companySiteUrl:'',
      title, postingUrl:'', salaryRange:'',
      resumeVersion:'', resumeFileId:'', resumeFileName:'', resumeViewLink:'',
      coverLetterVersion:'', portfolioLinks:'',
      source:'', sourceOther:'',
      status:'prospect', appliedDate: localDateStr(new Date()),
      contacts: []
    });
    companyInput.value = ''; titleInput.value = '';
    saveJobs(); renderJobs();
    companyInput.focus();
  }
  el('addJobBtn').addEventListener('click', addJob);
  el('newJobCompany').addEventListener('keydown', e=>{ if(e.key==='Enter') addJob(); });
  el('newJobTitle').addEventListener('keydown', e=>{ if(e.key==='Enter') addJob(); });

  document.querySelectorAll('.job-filter-chip').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      const f = chip.dataset.status;
      // picking a pile clears the search, since a search deliberately overrides the chips — otherwise
      // the click would appear to do nothing at all
      jobSearch = ''; el('jobSearch').value = '';
      jobFilter = (jobFilter === f && f !== 'all') ? 'all' : f;
      renderJobs();
    });
  });
  // the search box lives in static markup, not in the re-rendered list, so typing keeps focus
  el('jobSearch').addEventListener('input', e=>{ jobSearch = e.target.value; renderJobs(); });
  el('jobSortSelect').addEventListener('change', e=>{ jobSortMode = e.target.value; renderJobs(); });
  el('jobSortDirBtn').addEventListener('click', ()=>{
    jobSortDir = jobSortDir === 'asc' ? 'desc' : 'asc';
    el('jobSortDirBtn').textContent = jobSortDir === 'asc' ? '↑' : '↓';
    renderJobs();
  });

  /* ---------- detail overlay — opened by clicking a card; every other field lives here ---------- */
  function openJobDetail(id){
    openJobId = id;
    renderJobDetail();
    el('jobDetailOverlay').style.display = 'flex';
  }
  function closeJobDetail(){
    openJobId = null;
    el('jobDetailOverlay').style.display = 'none';
  }
  el('jobDetailOverlay').addEventListener('click', e=>{ if(e.target === el('jobDetailOverlay')) closeJobDetail(); });

  function deleteJob(j){
    if(!window.confirm('Delete the application to "'+j.company+'" ('+j.title+')?')) return;
    deleteStorageImage(j.logoUrl);
    state.jobs = state.jobs.filter(x=>x.id!==j.id);
    saveJobs();
    closeJobDetail();
    renderJobs();
  }

  function addJobContact(j){
    const body = el('jobDetailBody');
    const name = body.querySelector('.job-new-contact-name').value.trim();
    const title = body.querySelector('.job-new-contact-title').value.trim();
    const email = body.querySelector('.job-new-contact-email').value.trim();
    if(!name) return;
    j.contacts.push({ id:uid(), name, title, email });
    touchJob(j);
    saveJobs(); renderJobs();
  }

  function deleteJobContact(j, contactId){
    j.contacts = j.contacts.filter(c=>c.id!==contactId);
    touchJob(j);
    saveJobs(); renderJobs();
  }

  function renderJobDetail(){
    const body = el('jobDetailBody');
    const j = (state.jobs||[]).find(x=>x.id===openJobId);
    if(!j){ closeJobDetail(); return; }

    const statusButtons = Object.keys(JOB_STATUS_LABELS).map(s=>
      '<button type="button" class="btn btn-sm '+(j.status===s?'btn-primary':'btn-ghost')+' job-status-set-btn" data-status="'+s+'">'+JOB_STATUS_LABELS[s]+'</button>'
    ).join('');

    // existing subcategory names, offered as suggestions so related applications land in the same one
    const groupOptions = Array.from(new Set((state.jobs||[]).map(x=>(x.group||'').trim()).filter(Boolean)))
      .sort((a,b)=>a.localeCompare(b))
      .map(g=>'<option value="'+escapeHtml(g)+'"></option>').join('');
    const curGroup = (j.group||'').trim();
    const curGroupColor = jobGroupColor(curGroup);

    // Name + role on one line, email on its own below — three equal columns cramped every field and
    // let a long unbroken email widen the whole overlay (grid items don't shrink past their content).
    const contactRows = j.contacts.map(c=>
      '<div class="job-contact-row" data-contact-id="'+c.id+'">'
      +   '<div class="job-contact-fields">'
      +     '<div class="job-contact-line">'
      +       '<span class="job-contact-name">'+escapeHtml(c.name)+'</span>'
      +       (c.title ? '<span class="job-contact-title">'+escapeHtml(c.title)+'</span>' : '')
      +     '</div>'
      +     (c.email ? '<div class="job-contact-email">'+escapeHtml(c.email)+'</div>' : '')
      +   '</div>'
      +   '<button type="button" class="job-contact-del" title="Remove">✕</button>'
      + '</div>'
    ).join('');

    body.innerHTML = '<div class="struggle-overlay-head">'
        +   '<div class="struggle-overlay-title" style="color:var(--text);">'+escapeHtml(j.company || 'New Application')+'</div>'
        +   '<button class="wishlist-hero-close" type="button" id="jobDetailCloseBtn" style="position:static;background:none;color:var(--faint);">✕</button>'
        + '</div>'

        + '<div class="job-status-select-row">'+statusButtons+'</div>'

        + '<div class="field-row"><label>Subcategory</label>'
        +   '<input type="text" id="jdGroup" maxlength="40" list="jdGroupList" placeholder="e.g. Dream companies — leave blank for none" value="'+escapeHtml(j.group||'')+'">'
        +   '<datalist id="jdGroupList">'+groupOptions+'</datalist>'
        +   (curGroup
                ? '<div class="swatches jd-group-swatches">'
                  +   SWATCHES.map(c=>'<div class="swatch '+(curGroupColor.toLowerCase()===c.toLowerCase()?'selected':'')+'" style="background:'+c+';" data-color="'+c+'"></div>').join('')
                  +   '<input type="color" class="swatch-custom" id="jdGroupColor" value="'+curGroupColor+'">'
                  + '</div>'
                  + '<div class="job-group-color-note">Pill color for '+jobGroupPillHtml(curGroup)+' — shared by every application in this subcategory.</div>'
                : '<div class="job-group-color-note">Name a subcategory to color-code it and show it as a pill on the card.</div>')
        + '</div>'

        + '<div class="section-lbl">Company Profile</div>'
        + '<div class="field-row"><label>Company Name</label><input type="text" id="jdCompany" maxlength="100" value="'+escapeHtml(j.company)+'"></div>'
        + '<div class="field-row"><label>Company Photo</label>'
        +   '<div class="img-row" id="jdLogoRow">'
        +     (j.logoUrl ? '<img class="job-logo-thumb" src="'+escapeHtml(j.logoUrl)+'" alt="">' : '')
        +     '<label>Upload image<input type="file" accept="image/*" style="display:none;"></label>'
        +     (j.logoUrl ? '<button class="del-goal" style="margin-left:4px;">Remove image</button>' : '')
        +   '</div>'
        + '</div>'
        + '<div class="field-2col">'
        +   '<div class="field-row"><label>Work Model</label><select id="jdWorkModel">'
        +     '<option value=""'+(j.workModel===''?' selected':'')+'>— Select —</option>'
        +     '<option value="remote"'+(j.workModel==='remote'?' selected':'')+'>Remote</option>'
        +     '<option value="hybrid"'+(j.workModel==='hybrid'?' selected':'')+'>Hybrid</option>'
        +     '<option value="onsite"'+(j.workModel==='onsite'?' selected':'')+'>On-site</option>'
        +   '</select></div>'
        +   '<div class="field-row"><label>HQ Location</label><input type="text" id="jdHqLocation" maxlength="120" value="'+escapeHtml(j.hqLocation)+'"></div>'
        + '</div>'
        + '<div class="field-row"><label>Company Site Link'+(j.source==='company-site'?' (registered account here)':'')+'</label><div class="job-link-row">'
        +   '<input type="text" id="jdCompanySiteUrl" placeholder="https://..." value="'+escapeHtml(j.companySiteUrl)+'">'
        +   '<a href="'+escapeHtml(j.companySiteUrl||'')+'" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm job-link-open-btn"'+(j.companySiteUrl?'':' style="pointer-events:none;opacity:.4;" tabindex="-1"')+'>Open ↗</a>'
        + '</div></div>'

        + '<div class="section-lbl">Role Details</div>'
        + '<div class="field-row"><label>Job Title</label><input type="text" id="jdTitle" maxlength="120" value="'+escapeHtml(j.title)+'"></div>'
        + '<div class="field-row"><label>Posting Link</label><div class="job-link-row">'
        +   '<input type="text" id="jdPostingUrl" placeholder="https://..." value="'+escapeHtml(j.postingUrl)+'">'
        +   '<a href="'+escapeHtml(j.postingUrl||'')+'" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm job-link-open-btn"'+(j.postingUrl?'':' style="pointer-events:none;opacity:.4;" tabindex="-1"')+'>Open ↗</a>'
        + '</div></div>'
        + '<div class="field-2col">'
        +   '<div class="field-row"><label>Salary Range</label><input type="text" id="jdSalaryRange" placeholder="e.g. $120k-140k or DOE" value="'+escapeHtml(j.salaryRange)+'"></div>'
        +   '<div class="field-row"><label>Date Applied</label><input type="date" id="jdAppliedDate" value="'+escapeHtml(j.appliedDate)+'"></div>'
        + '</div>'

        + '<div class="section-lbl">Asset Tracking</div>'
        + '<div class="field-2col">'
        +   '<div class="field-row"><label>Resume Version</label><input type="text" id="jdResumeVersion" placeholder="e.g. Resume_v3_SWE.pdf" value="'+escapeHtml(j.resumeVersion)+'"></div>'
        +   '<div class="field-row"><label>Cover Letter Version</label><input type="text" id="jdCoverLetterVersion" value="'+escapeHtml(j.coverLetterVersion)+'"></div>'
        + '</div>'
        + jobResumeAttachmentHtml(j)
        + '<div class="field-row"><label>Portfolio Link(s) — one per line</label><textarea id="jdPortfolioLinks" rows="3">'+escapeHtml(j.portfolioLinks)+'</textarea></div>'

        + '<div class="section-lbl">Application Source</div>'
        + '<div class="field-2col">'
        +   '<div class="field-row"><label>Source</label><select id="jdSource">'
        +     '<option value=""'+(j.source===''?' selected':'')+'>— Select —</option>'
        +     '<option value="linkedin"'+(j.source==='linkedin'?' selected':'')+'>LinkedIn</option>'
        +     '<option value="indeed"'+(j.source==='indeed'?' selected':'')+'>Indeed</option>'
        +     '<option value="company-site"'+(j.source==='company-site'?' selected':'')+'>Company Site</option>'
        +     '<option value="referral"'+(j.source==='referral'?' selected':'')+'>Referral / Networking</option>'
        +     '<option value="other"'+(j.source==='other'?' selected':'')+'>Other</option>'
        +   '</select></div>'
        +   '<div class="field-row" id="jdSourceOtherField" style="'+(j.source==='other'?'':'display:none;')+'"><label>Specify</label><input type="text" id="jdSourceOther" value="'+escapeHtml(j.sourceOther)+'"></div>'
        + '</div>'

        + '<div class="section-lbl">Key Contacts</div>'
        + (contactRows ? contactRows : '<div style="font-size:12px;color:var(--faint);padding:2px 0;">No contacts added yet.</div>')
        + '<div class="add-tx-row">'
        +   '<input type="text" class="job-new-contact-name" placeholder="Name">'
        +   '<input type="text" class="job-new-contact-title" placeholder="Title">'
        +   '<input type="text" class="job-new-contact-email" placeholder="Email">'
        +   '<button class="btn btn-primary btn-sm" type="button" id="jobAddContactBtn">+ Add</button>'
        + '</div>'

        + '<div class="goal-footer"><button class="del-goal" id="jobDetailDeleteBtn">Delete application</button></div>';

    body.querySelector('#jobDetailCloseBtn').addEventListener('click', closeJobDetail);

    body.querySelectorAll('.job-status-set-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        j.status = btn.dataset.status;
        touchJob(j); saveJobs(); renderJobs();
      });
    });

    const bindField = (id, field, transform) => {
      const inp = body.querySelector('#'+id);
      inp.addEventListener('change', ()=>{
        j[field] = transform ? transform(inp.value) : inp.value.trim();
        touchJob(j); saveJobs(); renderJobs();
      });
    };
    bindField('jdCompany', 'company', v=>{ const t=v.trim(); return t || j.company; });
    bindField('jdGroup', 'group');

    // Subcategory color is keyed by NAME in the shared row, so it saves with save(), not saveJobs().
    const setGroupColor = c => {
      if(!curGroup) return;
      if(!state.jobCategoryColors) state.jobCategoryColors = {};
      state.jobCategoryColors[curGroup] = c;
      save(); renderJobs();
    };
    body.querySelectorAll('.jd-group-swatches .swatch').forEach(sw=>{
      sw.addEventListener('click', ()=> setGroupColor(sw.dataset.color));
    });
    const groupColorInput = body.querySelector('#jdGroupColor');
    if(groupColorInput) groupColorInput.addEventListener('change', e=> setGroupColor(e.target.value));

    const logoRow = body.querySelector('#jdLogoRow');
    logoRow.querySelector('input[type=file]').addEventListener('change', e=>{
      const file = e.target.files[0]; if(!file) return;
      const prevUrl = j.logoUrl;
      uploadCompressedImage(file, 320, 0.78, 'jobs').then(url=>{
        j.logoUrl = url; touchJob(j); saveJobs(); renderJobs();
        deleteStorageImage(prevUrl);
      }).catch(err=> window.alert(err.message));
    });
    const logoRmBtn = logoRow.querySelector('.del-goal');
    if(logoRmBtn) logoRmBtn.addEventListener('click', ()=>{
      deleteStorageImage(j.logoUrl);
      j.logoUrl = ''; touchJob(j); saveJobs(); renderJobs();
    });
    bindField('jdWorkModel', 'workModel');
    bindField('jdHqLocation', 'hqLocation');
    bindField('jdCompanySiteUrl', 'companySiteUrl');
    bindField('jdTitle', 'title', v=>{ const t=v.trim(); return t || j.title; });
    bindField('jdPostingUrl', 'postingUrl');
    bindField('jdSalaryRange', 'salaryRange');
    bindField('jdAppliedDate', 'appliedDate');
    bindField('jdResumeVersion', 'resumeVersion');
    bindField('jdCoverLetterVersion', 'coverLetterVersion');
    bindField('jdPortfolioLinks', 'portfolioLinks', v=>v);
    bindField('jdSourceOther', 'sourceOther');

    const resumeAttachBtn = body.querySelector('#jdResumeAttachBtn');
    if(resumeAttachBtn){
      const resumeFileInput = body.querySelector('#jdResumeFileInput');
      resumeAttachBtn.addEventListener('click', ()=> resumeFileInput.click());
      resumeFileInput.addEventListener('change', e=>{
        const file = e.target.files[0];
        e.target.value = '';
        if(file) uploadJobResume(j, file);
      });
    }
    const resumeRemoveBtn = body.querySelector('#jdResumeRemoveBtn');
    if(resumeRemoveBtn){
      resumeRemoveBtn.addEventListener('click', ()=>{
        j.resumeFileId = ''; j.resumeFileName = ''; j.resumeViewLink = '';
        touchJob(j); saveJobs(); renderJobs();
      });
    }

    const sourceSelect = body.querySelector('#jdSource');
    sourceSelect.addEventListener('change', ()=>{
      j.source = sourceSelect.value;
      body.querySelector('#jdSourceOtherField').style.display = j.source==='other' ? '' : 'none';
      touchJob(j); saveJobs(); renderJobs();
    });

    body.querySelectorAll('.job-contact-del').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const contactId = btn.closest('.job-contact-row').dataset.contactId;
        deleteJobContact(j, contactId);
      });
    });
    body.querySelector('#jobAddContactBtn').addEventListener('click', ()=> addJobContact(j));

    body.querySelector('#jobDetailDeleteBtn').addEventListener('click', ()=> deleteJob(j));
  }

  /* ---------- site accounts — login credentials for job-search sites (LinkedIn, Indeed, ...).
     Stored in plaintext in state.jobSiteAccounts (see the note next to it in core.js); passwords
     are just masked in the UI by default with a per-row show/hide toggle, not actually encrypted. ---------- */
  function jobAccountCopy(text, btn){
    if(!text || !navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(()=>{
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(()=>{ btn.textContent = orig; }, 1200);
    }).catch(()=>{});
  }

  function buildJobAccountRow(a){
    const row = document.createElement('div'); row.className = 'job-account-row'; row.dataset.acctId = a.id;
    const revealed = !!jobAccountRevealed[a.id];
    // the site photo doubles as the upload control — clicking it (image or empty placeholder) picks a file
    row.innerHTML = '<label class="job-account-logo'+(a.imageUrl?'':' empty')+'" title="'+(a.imageUrl?'Change site photo':'Add a site photo')+'">'
        +   (a.imageUrl ? '<img src="'+escapeHtml(a.imageUrl)+'" alt="">' : '<span>＋</span>')
        +   '<input type="file" accept="image/*" style="display:none;">'
        + '</label>'
        + '<div class="job-account-main">'
        +   '<div class="job-account-site">'+escapeHtml(a.site)
        +     (a.loginUrl ? ' <a href="'+escapeHtml(a.loginUrl)+'" target="_blank" rel="noopener noreferrer">Open ↗</a>' : '')
        +   '</div>'
        +   '<div class="job-account-creds">'
        +     '<span>👤 '+escapeHtml(a.username||'—')+' <button type="button" class="job-account-mini-btn job-account-copy-btn" data-copy="username">Copy</button></span>'
        +     '<span>🔒 '+(revealed ? escapeHtml(a.password||'') : '••••••••')
        +       ' <button type="button" class="job-account-mini-btn job-account-toggle-btn">'+(revealed?'Hide':'Show')+'</button>'
        +       ' <button type="button" class="job-account-mini-btn job-account-copy-btn" data-copy="password">Copy</button></span>'
        +     (a.imageUrl ? '<span><button type="button" class="job-account-mini-btn job-account-img-del">Remove photo</button></span>' : '')
        +   '</div>'
        + '</div>'
        + '<button type="button" class="job-contact-del job-account-del" title="Delete">✕</button>';

    row.querySelector('.job-account-logo input[type=file]').addEventListener('change', e=>{
      const file = e.target.files[0];
      e.target.value = '';
      if(!file) return;
      const prevUrl = a.imageUrl;
      uploadCompressedImage(file, 200, 0.75, 'jobs').then(url=>{
        a.imageUrl = url; save(); renderJobAccounts();
        deleteStorageImage(prevUrl);
      }).catch(err=> window.alert(err.message));
    });
    const imgDelBtn = row.querySelector('.job-account-img-del');
    if(imgDelBtn) imgDelBtn.addEventListener('click', ()=>{
      deleteStorageImage(a.imageUrl);
      a.imageUrl = ''; save(); renderJobAccounts();
    });

    row.querySelector('.job-account-toggle-btn').addEventListener('click', ()=>{
      jobAccountRevealed[a.id] = !jobAccountRevealed[a.id];
      renderJobAccounts();
    });
    row.querySelectorAll('.job-account-copy-btn').forEach(btn=>{
      btn.addEventListener('click', ()=> jobAccountCopy(btn.dataset.copy==='username' ? a.username : a.password, btn));
    });
    row.querySelector('.job-account-del').addEventListener('click', ()=>{
      if(!window.confirm('Delete the saved login for "'+a.site+'"?')) return;
      deleteStorageImage(a.imageUrl);
      state.jobSiteAccounts = state.jobSiteAccounts.filter(x=>x.id!==a.id);
      delete jobAccountRevealed[a.id];
      save(); renderJobAccounts();
    });
    return row;
  }

  function renderJobAccounts(){
    const list = el('jobAccountList'); if(!list) return;
    list.innerHTML = '';
    const items = state.jobSiteAccounts || [];
    el('jobAccountsEmpty').style.display = items.length===0 ? 'block' : 'none';
    items.slice().sort((a,b)=> (a.site||'').localeCompare(b.site||'')).forEach(a=> list.appendChild(buildJobAccountRow(a)));
  }

  function addJobAccount(){
    const siteInput = el('newJobAcctSite'); const urlInput = el('newJobAcctUrl');
    const userInput = el('newJobAcctUsername'); const passInput = el('newJobAcctPassword');
    const site = siteInput.value.trim();
    const username = userInput.value.trim();
    if(!site || !username) return;
    state.jobSiteAccounts.push({ id:uid(), site, loginUrl:urlInput.value.trim(), username, password:passInput.value, imageUrl:'', createdAt:Date.now() });
    siteInput.value=''; urlInput.value=''; userInput.value=''; passInput.value='';
    save(); renderJobAccounts();
    siteInput.focus();
  }
  el('addJobAcctBtn').addEventListener('click', addJobAccount);
  ['newJobAcctSite','newJobAcctUrl','newJobAcctUsername','newJobAcctPassword'].forEach(id=>{
    el(id).addEventListener('keydown', e=>{ if(e.key==='Enter') addJobAccount(); });
  });

  function openJobAccounts(){
    renderJobAccounts();
    el('jobAccountsOverlay').style.display = 'flex';
  }
  function closeJobAccounts(){
    el('jobAccountsOverlay').style.display = 'none';
  }
  el('jobAccountsBtn').addEventListener('click', openJobAccounts);
  el('jobAccountsCloseBtn').addEventListener('click', closeJobAccounts);
  el('jobAccountsOverlay').addEventListener('click', e=>{ if(e.target === el('jobAccountsOverlay')) closeJobAccounts(); });
