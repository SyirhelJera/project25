  /* ---------- backups ---------- */
  let pendingRestore = null;

  async function loadBackupsList(){
    const list = el('backupList');
    el('restoreSlot').innerHTML = '';
    pendingRestore = null;
    if(usingClaudeStorage){
      list.innerHTML = '<div class="view-sub">Backups aren’t used in this mode — they only apply to the Supabase-hosted deployment.</div>';
      return;
    }
    if(!initSupabaseIfNeeded()) return;
    list.innerHTML = '<div class="view-sub">Loading backups…</div>';
    try{
      const { data, error } = await supa.functions.invoke('manage-backups', { body: { action: 'list' } });
      if(error) throw error;
      if(data && data.error) throw new Error(data.error);
      const files = (data && data.files) || [];
      if(!files.length){
        list.innerHTML = '<div class="view-sub">No backups found yet — the first one is created by the daily backup job.</div>';
        return;
      }
      list.innerHTML = files.map(f =>
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">'
        + '<span>'+escapeHtml(f.name.replace(/\.json$/,''))+'</span>'
        + '<button class="btn btn-ghost btn-sm" data-file="'+escapeHtml(f.name)+'">Restore</button>'
        + '</div>'
      ).join('');
      list.querySelectorAll('button[data-file]').forEach(btn=>{
        btn.addEventListener('click', ()=> requestRestore(btn.getAttribute('data-file')));
      });
    }catch(e){
      console.error('backup list failed', e);
      list.innerHTML = '<div class="view-sub">Couldn’t load the backup list. Try again in a moment.</div>';
    }
  }

  function requestRestore(file){
    pendingRestore = file;
    const label = file.replace(/\.json$/,'');
    el('restoreSlot').innerHTML = '<div class="confirm-banner"><span>Restoring will replace ALL current data with the backup from '+escapeHtml(label)+'. This can’t be undone unless you restore a newer backup afterward.</span><button class="btn btn-sm btn-primary" id="confirmRestore">Restore this backup</button><button class="btn btn-sm btn-ghost" id="cancelRestore">Cancel</button></div>';
    el('confirmRestore').addEventListener('click', doRestore);
    el('cancelRestore').addEventListener('click', ()=>{ pendingRestore = null; el('restoreSlot').innerHTML=''; });
  }

  async function doRestore(){
    if(!pendingRestore) return;
    /* Read-only session (js/pin.js). The most destructive button in the app — it replaces all four
       storage resources with an older snapshot — so it is refused before the Edge Function is even
       called, not merely left to fail at the four save() calls further down. Reported in the same
       slot the confirmation was asked in. */
    if(!appCanWrite()){
      el('restoreSlot').innerHTML = '<div class="confirm-banner"><span>This session is read-only — backups can’t be restored.</span></div>';
      pendingRestore = null;
      return;
    }
    const file = pendingRestore;
    el('restoreSlot').innerHTML = '<div class="confirm-banner"><span>Restoring…</span></div>';
    try{
      const { data, error } = await supa.functions.invoke('manage-backups', { body: { action: 'restore', file } });
      if(error) throw error;
      if(data && data.error) throw new Error(data.error);
      applyLoadedState(data.data); // every tab except Jobs, Notes and the scratch page, exactly as before
      // Jobs, Notes and the scratch page live in their own storage resources, so each has to be
      // restored alongside the shared blob rather than falling out of applyLoadedState(). Prefer the backup's
      // dedicated row; fall back to a copy still embedded in the shared blob for backups taken
      // before that tab was split out. Same precedence as the standing migrations in
      // jobs.js:loadJobsData() / notes.js:loadNotesData().
      const jobsSeed = (data.jobsData && Array.isArray(data.jobsData.jobs)) ? data.jobsData.jobs
                     : (data.data && Array.isArray(data.data.jobs)) ? data.data.jobs
                     : [];
      applyLoadedJobsState({ jobs: jobsSeed });
      const notesSeed = (data.notesData && Array.isArray(data.notesData.notes)) ? data.notesData.notes
                      : (data.data && Array.isArray(data.data.notes)) ? data.data.notes
                      : [];
      applyLoadedNotesState({ notes: notesSeed });
      // No fallback to a copy embedded in the shared blob, unlike jobsSeed/notesSeed above: the
      // scratch page has only ever lived in its own row, so a backup that lacks it simply predates
      // the feature and an empty page is the correct result — there is no older location to look in.
      // Reached by the owner only — the read-only guard at the top of this function turns a guest
      // away before any of it runs, so there is no second scratch-specific check to make here.
      applyLoadedScratchState(data.scratchData || null);
      pendingRestore = null;
      // force: restoring is a deliberate, user-confirmed overwrite of all four resources.
      // allSettled rather than all/sequential-await because save()/saveJobs()/saveNotes()/saveScratch() never
      // reject even on remote failure (they fall back to their own offline banner + retry-on-
      // reconnect) — so this can't meaningfully distinguish partial failure, and treating one as
      // fatal would wrongly report "Restore failed. Nothing was changed." when the data was in
      // fact applied and cached.
      await Promise.allSettled([ save(true), saveJobs(true), saveNotes(true), saveScratch(true) ]);
      el('restoreSlot').innerHTML = '<div class="confirm-banner"><span>Restored '+escapeHtml(file.replace(/\.json$/,''))+'.</span></div>';
      renderAll();
    }catch(e){
      console.error('restore failed', e);
      el('restoreSlot').innerHTML = '<div class="confirm-banner"><span>Restore failed. Nothing was changed.</span></div>';
    }
  }

  el('loadBackupsBtn').addEventListener('click', loadBackupsList);

