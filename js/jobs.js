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
  let jobFilter = 'all';
  let jobSortMode = 'none';
  let jobSortDir = 'desc';
  // which saved passwords are currently shown in plaintext (id -> true) — not persisted, resets per page load
  let jobAccountRevealed = {};

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
      else { av = 0; bv = 0; }
      if(av < bv) return -1*factor;
      if(av > bv) return 1*factor;
      return 0;
    });
  }

  function visibleJobs(){
    let arr = state.jobs.slice();
    if(jobFilter === 'prospect' || jobFilter === 'applied' || jobFilter === 'interviewing' || jobFilter === 'offer'){
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
    if(changed) save();
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
      save();
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
    card.innerHTML = '<div class="job-card-head">'
        +   '<div><div class="job-card-company">'+escapeHtml(j.company)+'</div>'
        +   '<div class="job-card-title">'+escapeHtml(j.title)+'</div></div>'
        +   '<span class="job-status-badge job-status-'+j.status+'">'+JOB_STATUS_LABELS[j.status]+'</span>'
        + '</div>'
        + (metaParts.length ? '<div class="job-card-meta">'+metaParts.join(' · ')+'</div>' : '');
    card.addEventListener('click', ()=> openJobDetail(j.id));
    return card;
  }

  function renderJobs(){
    autoMarkGhostedJobs();
    const list = el('jobList'); if(!list) return;
    list.innerHTML = '';
    const items = state.jobs || [];
    el('jobEmpty').style.display = items.length===0 ? 'block' : 'none';

    visibleJobs().forEach(j=> list.appendChild(buildJobCard(j)));

    el('jobStatTotal').textContent = items.length;
    el('jobStatProspect').textContent = items.filter(j=>j.status==='prospect').length;
    el('jobStatApplied').textContent = items.filter(j=>j.status==='applied').length;
    el('jobStatInterviewing').textContent = items.filter(j=>j.status==='interviewing').length;
    el('jobStatOffer').textContent = items.filter(j=>j.status==='offer').length;
    el('jobStatRejGhost').textContent = items.filter(j=>j.status==='rejected' || j.status==='ghosted').length;

    document.querySelectorAll('.job-filter-chip').forEach(c=>c.classList.remove('active-filter'));
    if(jobFilter !== 'all'){
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
      company, workModel:'', hqLocation:'', companySiteUrl:'',
      title, postingUrl:'', salaryRange:'',
      resumeVersion:'', resumeFileId:'', resumeFileName:'', resumeViewLink:'',
      coverLetterVersion:'', portfolioLinks:'',
      source:'', sourceOther:'',
      status:'prospect', appliedDate: localDateStr(new Date()),
      contacts: []
    });
    companyInput.value = ''; titleInput.value = '';
    save(); renderJobs();
    companyInput.focus();
  }
  el('addJobBtn').addEventListener('click', addJob);
  el('newJobCompany').addEventListener('keydown', e=>{ if(e.key==='Enter') addJob(); });
  el('newJobTitle').addEventListener('keydown', e=>{ if(e.key==='Enter') addJob(); });

  document.querySelectorAll('.job-filter-chip').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      const f = chip.dataset.status;
      jobFilter = (jobFilter === f && f !== 'all') ? 'all' : f;
      renderJobs();
    });
  });
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
    state.jobs = state.jobs.filter(x=>x.id!==j.id);
    save();
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
    save(); renderJobs();
  }

  function deleteJobContact(j, contactId){
    j.contacts = j.contacts.filter(c=>c.id!==contactId);
    touchJob(j);
    save(); renderJobs();
  }

  function renderJobDetail(){
    const body = el('jobDetailBody');
    const j = (state.jobs||[]).find(x=>x.id===openJobId);
    if(!j){ closeJobDetail(); return; }

    const statusButtons = Object.keys(JOB_STATUS_LABELS).map(s=>
      '<button type="button" class="btn btn-sm '+(j.status===s?'btn-primary':'btn-ghost')+' job-status-set-btn" data-status="'+s+'">'+JOB_STATUS_LABELS[s]+'</button>'
    ).join('');

    const contactRows = j.contacts.map(c=>
      '<div class="job-contact-row" data-contact-id="'+c.id+'">'
      +   '<div class="job-contact-fields">'
      +     '<span>'+escapeHtml(c.name)+'</span>'
      +     '<span style="color:var(--muted);">'+escapeHtml(c.title||'')+'</span>'
      +     '<span style="color:var(--muted);">'+escapeHtml(c.email||'')+'</span>'
      +   '</div>'
      +   '<button type="button" class="job-contact-del" title="Remove">✕</button>'
      + '</div>'
    ).join('');

    body.innerHTML = '<div class="struggle-overlay-head">'
        +   '<div class="struggle-overlay-title" style="color:var(--text);">'+escapeHtml(j.company || 'New Application')+'</div>'
        +   '<button class="wishlist-hero-close" type="button" id="jobDetailCloseBtn" style="position:static;background:none;color:var(--faint);">✕</button>'
        + '</div>'

        + '<div class="job-status-select-row">'+statusButtons+'</div>'

        + '<div class="section-lbl">Company Profile</div>'
        + '<div class="field-row"><label>Company Name</label><input type="text" id="jdCompany" maxlength="100" value="'+escapeHtml(j.company)+'"></div>'
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
        touchJob(j); save(); renderJobs();
      });
    });

    const bindField = (id, field, transform) => {
      const inp = body.querySelector('#'+id);
      inp.addEventListener('change', ()=>{
        j[field] = transform ? transform(inp.value) : inp.value.trim();
        touchJob(j); save(); renderJobs();
      });
    };
    bindField('jdCompany', 'company', v=>{ const t=v.trim(); return t || j.company; });
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
        touchJob(j); save(); renderJobs();
      });
    }

    const sourceSelect = body.querySelector('#jdSource');
    sourceSelect.addEventListener('change', ()=>{
      j.source = sourceSelect.value;
      body.querySelector('#jdSourceOtherField').style.display = j.source==='other' ? '' : 'none';
      touchJob(j); save(); renderJobs();
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
    row.innerHTML = '<div>'
        +   '<div class="job-account-site">'+escapeHtml(a.site)
        +     (a.loginUrl ? ' <a href="'+escapeHtml(a.loginUrl)+'" target="_blank" rel="noopener noreferrer">Open ↗</a>' : '')
        +   '</div>'
        +   '<div class="job-account-creds">'
        +     '<span>👤 '+escapeHtml(a.username||'—')+' <button type="button" class="job-account-mini-btn job-account-copy-btn" data-copy="username">Copy</button></span>'
        +     '<span>🔒 '+(revealed ? escapeHtml(a.password||'') : '••••••••')
        +       ' <button type="button" class="job-account-mini-btn job-account-toggle-btn">'+(revealed?'Hide':'Show')+'</button>'
        +       ' <button type="button" class="job-account-mini-btn job-account-copy-btn" data-copy="password">Copy</button></span>'
        +   '</div>'
        + '</div>'
        + '<button type="button" class="job-contact-del job-account-del" title="Delete">✕</button>';

    row.querySelector('.job-account-toggle-btn').addEventListener('click', ()=>{
      jobAccountRevealed[a.id] = !jobAccountRevealed[a.id];
      renderJobAccounts();
    });
    row.querySelectorAll('.job-account-copy-btn').forEach(btn=>{
      btn.addEventListener('click', ()=> jobAccountCopy(btn.dataset.copy==='username' ? a.username : a.password, btn));
    });
    row.querySelector('.job-account-del').addEventListener('click', ()=>{
      if(!window.confirm('Delete the saved login for "'+a.site+'"?')) return;
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
    state.jobSiteAccounts.push({ id:uid(), site, loginUrl:urlInput.value.trim(), username, password:passInput.value, createdAt:Date.now() });
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
