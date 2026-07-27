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
    const file = pendingRestore;
    el('restoreSlot').innerHTML = '<div class="confirm-banner"><span>Restoring…</span></div>';
    try{
      const { data, error } = await supa.functions.invoke('manage-backups', { body: { action: 'restore', file } });
      if(error) throw error;
      if(data && data.error) throw new Error(data.error);
      applyLoadedState(data.data);
      pendingRestore = null;
      await save(true); // force: restoring is a deliberate, user-confirmed overwrite
      el('restoreSlot').innerHTML = '<div class="confirm-banner"><span>Restored '+escapeHtml(file.replace(/\.json$/,''))+'.</span></div>';
      renderAll();
    }catch(e){
      console.error('restore failed', e);
      el('restoreSlot').innerHTML = '<div class="confirm-banner"><span>Restore failed. Nothing was changed.</span></div>';
    }
  }

  el('loadBackupsBtn').addEventListener('click', loadBackupsList);

