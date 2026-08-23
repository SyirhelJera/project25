  /* ================= SCRATCH — the napkin =================
     ONE free-form page. No files, no tree, no titles. The Notes tab is the organized outliner;
     this is deliberately its opposite, for the thought you want out of your head in two seconds
     and don't want to file anywhere.

     The way IN is an easter egg and is meant to stay one: the only door is a click on the sidebar
     logo, and `.brand` is left visually untouched — no cursor:pointer, no hover state, no title
     attribute, no nav item, no Settings entry, nothing in renderAll(). If you're here to "fix" the
     missing affordance: that absence is the feature. The way OUT is the opposite and should be
     obvious — the logo is redrawn in place on top of the takeover and closes it.

     It is a MODE, not a tab and not a modal. It never touches .nav-item.active or .view.active —
     the previously open tab stays rendered underneath the whole time and is simply revealed again
     on exit. Routing it through nav.js's click ladder instead would re-run every tab's
     teardown/setup (resetting goalFilter, snapping Finance to accounts, stopping the Live Match
     poll...), i.e. a napkin with side effects on nine other tabs.

     The surface is contenteditable rather than a <textarea>, because a textarea cannot hold the
     three things this page is for beyond plain text: tickboxes, links and pasted images. That buys
     a real obligation — see the sanitizer below. Content is stored as HTML in state.scratch.html.

     Storage: its OWN resource (row id 'scratch'), the same split Jobs and Notes have, for the
     sharper version of their reason — this is a single string that debounce-saves per keystroke,
     so in the shared blob every paragraph typed would re-upload every goal, habit, finance record
     and Valorant store in the app. See the persistence block below.
     ======================================================== */

  /* ---------- scratch persistence ----------
     Mirrors js/notes.js 1:1 rather than being a simplified "best effort" version, keeping the same
     safety properties: a loadedOk-style gate so a failed load can never trigger an overwrite,
     optimistic-concurrency conflict detection, an offline localStorage mirror, and a serialized
     save chain so overlapping saves can't race each other.

     Supabase mode: a fourth row in the same app_data table, id='scratch' — no schema or RLS change
     needed (the existing "anyone can read/write" policy covers any id, and the row is created by
     this file's own .upsert() on first edit). Claude-storage mode: a fourth window.storage key.
  ---------------------------------------- */
  const SCRATCH_STORAGE_KEY = 'app-data-scratch';
  const SCRATCH_ROW_ID = 'scratch';
  const OFFLINE_SCRATCH_CACHE_KEY = 'p25-offline-data-scratch';
  let scratchLoadedOk = false;
  let lastKnownScratchUpdatedAt = null;
  let scratchConflictShown = false;
  // wall-clock of the last CONFIRMED remote write. Deliberately NOT persisted and deliberately
  // distinct from state.scratch.updatedAt: that one is "last edited" (and survives a reload, so a
  // cold open can say "saved · 3h ago"), this one is "last synced" and resets with the page.
  let lastScratchSavedAt = 0;
  // the content on screen at the moment a conflict was detected, so "load theirs" is recoverable
  let scratchPreConflictHtml = null;

  /* ---------- the sanitizer ----------
     The page holds HTML now, and that HTML round-trips through an unauthenticated shared row, so
     it is untrusted on the way back in exactly like any other stored string. Everything is rebuilt
     against an allowlist rather than filtered: an unknown element is UNWRAPPED (its text survives,
     the tag doesn't) and no attribute is carried over unless it's named below and re-validated.
     That is what keeps a hostile `<img onerror>` or `<a href="javascript:">` from ever reaching the
     live DOM, and it's the same posture as notes.js:renderMarkdown() — that one escapes first and
     emits only its own tags; this one parses inertly and emits only its own tags.

     Parsing goes through DOMParser, NOT innerHTML on a detached div: DOMParser documents are inert,
     so nothing loads, nothing executes and no error handler fires while we're inspecting it.

     Applied at both boundaries and nowhere else: on the way in (applyLoadedScratchState) and on the
     way out (serializeScratch). Live typing writes raw innerHTML into state, which is safe because
     it IS the live DOM — sanitizing per keystroke would only cost time and fight the caret. */
  const SCRATCH_SAFE_URL = /^(https?:\/\/|mailto:|\/|#)/i;
  // data: is allowed for images ONLY because uploadCompressedImage() falls back to a data URL when
  // Supabase Storage isn't configured at all; the base64 form is restricted to real image types.
  const SCRATCH_SAFE_IMG = /^(https?:\/\/|data:image\/(png|jpeg|jpg|gif|webp);base64,)/i;
  const SCRATCH_TAGS = {
    DIV:1, P:1, BR:1, UL:1, OL:1, LI:1, BLOCKQUOTE:1, PRE:1,
    B:1, STRONG:1, I:1, EM:1, U:1, S:1, STRIKE:1, DEL:1, CODE:1, SPAN:1,
    H1:1, H2:1, H3:1, A:1, IMG:1, INPUT:1
  };
  /* Dropped SUBTREE AND ALL, rather than unwrapped. Unwrapping is right for a merely unknown tag
     (<marquee>hi</marquee> should leave you the word "hi"), but these hold source code or widget
     innards rather than prose: unwrapping <style> would paste a stylesheet's text into the page and
     unwrapping <script> would paste its JavaScript as literal words. Inert either way — every text
     node is re-created with createTextNode — but it isn't what anyone meant to paste. */
  const SCRATCH_DROP = {
    SCRIPT:1, STYLE:1, NOSCRIPT:1, TEMPLATE:1, TITLE:1, META:1, LINK:1, HEAD:1, BASE:1,
    IFRAME:1, OBJECT:1, EMBED:1, APPLET:1, CANVAS:1, AUDIO:1, VIDEO:1, SOURCE:1, TRACK:1,
    SVG:1, MATH:1, TEXTAREA:1, SELECT:1, OPTION:1, OPTGROUP:1, DATALIST:1
  };

  function sanitizeScratchHtml(html){
    const doc = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
    const out = document.createElement('div');
    cleanScratchInto(doc.body, out);
    return out.innerHTML;
  }

  function cleanScratchInto(src, dest){
    const kids = src.childNodes;
    for(let i=0; i<kids.length; i++){
      const node = kids[i];
      if(node.nodeType === 3){ dest.appendChild(document.createTextNode(node.nodeValue)); continue; }
      if(node.nodeType !== 1) continue; // comments, CDATA, everything else: gone
      const tag = node.tagName;
      if(SCRATCH_DROP[tag]) continue;                                   // drop the whole subtree
      if(!SCRATCH_TAGS[tag]){ cleanScratchInto(node, dest); continue; } // unwrap: keep the text, drop the tag
      if(tag === 'INPUT'){
        // the only <input> that survives is a tickbox
        if((node.getAttribute('type') || '').toLowerCase() !== 'checkbox') continue;
        dest.appendChild(makeScratchTick(node.hasAttribute('checked')));
        continue;
      }
      if(tag === 'SPAN'){
        // in-flight upload markers are UI, not content — never persist them
        const cls = node.getAttribute('class') || '';
        if(/scratch-uploading|scratch-uperr/.test(cls)){ continue; }
      }
      if(tag === 'A'){
        const href = (node.getAttribute('href') || '').replace(/[\s"']/g, '');
        if(!SCRATCH_SAFE_URL.test(href)){ cleanScratchInto(node, dest); continue; } // unknown scheme: keep the words, drop the link
        const a = document.createElement('a');
        a.setAttribute('href', href);
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
        cleanScratchInto(node, a);
        dest.appendChild(a);
        continue;
      }
      if(tag === 'IMG'){
        const src2 = (node.getAttribute('src') || '').replace(/[\s"']/g, '');
        if(!SCRATCH_SAFE_IMG.test(src2)) continue;
        const img = document.createElement('img');
        img.setAttribute('src', src2);
        const alt = node.getAttribute('alt');
        if(alt) img.setAttribute('alt', alt);
        dest.appendChild(img);
        continue;
      }
      // everything else: the tag is kept, every attribute is dropped. That's what strips pasted
      // style/class/id junk and keeps this a napkin rather than a copy of someone's stylesheet.
      const clone = document.createElement(tag.toLowerCase());
      cleanScratchInto(node, clone);
      dest.appendChild(clone);
    }
  }

  // The one constructor for a tickbox, so its shape can't drift between the sanitizer, the typing
  // shortcut and the ⌘/Ctrl+Shift+C insert. contenteditable="false" keeps the caret from landing
  // *inside* the widget; the `checked` ATTRIBUTE (not the .checked property) is what innerHTML
  // serializes, which is why toggling has to write both.
  function makeScratchTick(done){
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'scratch-tick';
    box.setAttribute('contenteditable', 'false');
    box.checked = !!done;
    if(done) box.setAttribute('checked', '');
    return box;
  }

  // Hydration + lazy field defaults. New fields on the scratch page go HERE, not in
  // persistence.js:applyLoadedState() — same exception to the usual convention that Jobs and
  // Notes have.
  function applyLoadedScratchState(parsed){
    const raw = parsed && parsed.scratch;
    let html = '', at = 0;
    if(typeof raw === 'string'){
      html = scratchPlainToHtml(raw);
    } else if(raw && typeof raw === 'object'){
      at = raw.updatedAt || 0;
      // `text` is the pre-rich-editor shape: the page shipped as a plain <textarea> first, so a row
      // written by that build holds a bare string. Converted here rather than by a migration script
      // — same in-place upgrade convention the rest of the app uses.
      if(typeof raw.html === 'string') html = sanitizeScratchHtml(raw.html);
      else if(typeof raw.text === 'string') html = scratchPlainToHtml(raw.text);
    }
    state.scratch = { html: html, updatedAt: at };
    syncScratchSurface();
    updateScratchFooter();
  }

  function scratchPlainToHtml(t){
    return String(t || '').split(/\r?\n/).map(line => '<div>' + (escapeHtml(line) || '<br>') + '</div>').join('');
  }

  /* The wire format. No omit-defaults compaction, unlike serializeNotes(): that function's ~45%
     win comes from per-record key overhead across many small records, which one string doesn't
     have. This exists to honour the same rule — nothing else may serialize state.scratch, always
     go through here — and to be the outbound sanitizer boundary. */
  function serializeScratch(){
    return { html: sanitizeScratchHtml((state.scratch && state.scratch.html) || ''), updatedAt: (state.scratch && state.scratch.updatedAt) || 0 };
  }

  function cacheScratchStateLocally(){
    try{ localStorage.setItem(OFFLINE_SCRATCH_CACHE_KEY, JSON.stringify({ data: { scratch: serializeScratch() }, cachedAt: Date.now(), updatedAt: lastKnownScratchUpdatedAt })); }
    catch(e){ /* private browsing / storage quota — best effort only */ }
  }
  function loadLocalScratchCache(){
    try{
      const raw = localStorage.getItem(OFFLINE_SCRATCH_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    }catch(e){ return null; }
  }
  // Deliberately leaves scratchLoadedOk false when nothing is found, so saves stay blocked rather
  // than risking an empty overwrite of a real remote page.
  function fallbackToLocalScratchCache(){
    const cached = loadLocalScratchCache();
    if(cached && cached.data){
      applyLoadedScratchState(cached.data);
      if(cached.updatedAt !== undefined) lastKnownScratchUpdatedAt = cached.updatedAt;
      scratchLoadedOk = true;
      const when = cached.cachedAt ? new Date(cached.cachedAt).toLocaleString() : 'earlier';
      showScratchOfflineBanner('You’re offline — showing your last synced copy of this page (from ' + escapeHtml(when) + '). '
        + 'Anything you type here is saved on this device and will sync once you’re back online.');
      return true;
    }
    showScratchOfflineBanner('Couldn’t load this page just now, so it may be showing empty or out of date. '
      + 'Whatever you wrote likely hasn’t been lost — try reloading.');
    return false;
  }
  window.addEventListener('online', () => { if(scratchLoadedOk) saveScratch(); });

  /* Scratch-scoped banners, for the same reason Jobs and Notes have their own: the global
     #conflictBanner / #offlineBanner are wired to whole-page-reload semantics for the shared blob,
     which is the wrong response to a conflict on a resource that saves independently. These render
     INSIDE the overlay, since that's the only place this page is ever visible. */
  function showScratchConflictBanner(){
    if(scratchConflictShown) return;
    scratchConflictShown = true;
    const b = el('scratchConflictBanner');
    if(!b) return;
    // Stash what's on screen BEFORE offering to replace it. Unlike the Notes equivalent, "load
    // theirs" here discards the entire page rather than one record's last few keystrokes — so the
    // discarded draft has to stay one click away.
    scratchPreConflictHtml = (state.scratch && state.scratch.html) || '';
    b.style.display = 'flex';
    b.innerHTML = '<span>Another tab or device saved a newer version of this page after this one loaded its copy. What you just typed was <b>not saved</b>, to avoid overwriting it.</span>'
      + '<button class="btn btn-sm btn-ghost" id="scratchConflictReloadBtn">Load theirs (discards what’s on screen)</button>'
      + '<button class="btn btn-sm btn-primary" id="scratchConflictForceBtn">Keep mine (overwrite theirs)</button>';
    el('scratchConflictReloadBtn').addEventListener('click', async ()=>{
      const mine = scratchPreConflictHtml;
      await loadScratchData();
      hideScratchConflictBanner();
      // nothing is lost — offer the discarded draft back, quietly
      showScratchOfflineBanner('Loaded the newer version. <button class="btn btn-sm btn-ghost" id="scratchRestoreMineBtn">Put mine back</button>');
      const restore = el('scratchRestoreMineBtn');
      if(restore) restore.addEventListener('click', ()=>{
        state.scratch.html = mine;
        state.scratch.updatedAt = Date.now();
        syncScratchSurface(true);
        hideScratchOfflineBanner();
        setScratchStatus('dirty');
        updateScratchFooter();
        saveScratch();
      });
    });
    el('scratchConflictForceBtn').addEventListener('click', async ()=>{ await saveScratch(true); });
  }
  function hideScratchConflictBanner(){
    if(!scratchConflictShown) return;
    scratchConflictShown = false;
    const b = el('scratchConflictBanner');
    if(b) b.style.display = 'none';
  }
  function showScratchOfflineBanner(msg){
    const b = el('scratchOfflineBanner');
    if(!b) return;
    b.style.display = 'flex';
    b.innerHTML = '<span>' + msg + '</span>';
  }
  function hideScratchOfflineBanner(){
    const b = el('scratchOfflineBanner');
    if(b) b.style.display = 'none';
  }

  // Serialized like the shared save() for the same reason: two overlapping saves would both read
  // the same stale lastKnownScratchUpdatedAt and the second would falsely report a conflict.
  let scratchSavePromise = Promise.resolve();
  function saveScratch(force){
    scratchSavePromise = scratchSavePromise.then(()=> doSaveScratch(force));
    return scratchSavePromise;
  }
  /* The footer's saved-indicator is written from in here, at the decision points themselves,
     rather than derived from this function's promise — it resolves identically whether the write
     landed, hit a conflict, or threw into the catch below, so the promise cannot tell the truth.
     Legitimate here in a way it wouldn't be in notes.js: that file separates a render layer from a
     save layer, whereas this one owns both halves of a single screen. */
  async function doSaveScratch(force){
    if(!scratchLoadedOk){ setScratchStatus('blocked'); return; } // never overwrite remote data before we've confirmed what it contains
    cacheScratchStateLocally();
    try{
      const payload = { scratch: serializeScratch() };
      if(usingClaudeStorage){
        await setWithRetry(SCRATCH_STORAGE_KEY, JSON.stringify(payload));
        lastScratchSavedAt = Date.now();
        setScratchStatus('saved');
        hideScratchOfflineBanner();
        return;
      }
      if(!supa) return;
      const nowIso = new Date().toISOString();
      let data, error;
      if(lastKnownScratchUpdatedAt && !force){
        ({ data, error } = await supa.from('app_data')
          .update({ data: payload, updated_at: nowIso })
          .eq('id', SCRATCH_ROW_ID)
          .eq('updated_at', lastKnownScratchUpdatedAt)
          .select('updated_at'));
        if(error) throw error;
        if(!data || data.length === 0){ setScratchStatus('conflict'); showScratchConflictBanner(); return; }
      } else {
        ({ data, error } = await supa.from('app_data')
          .upsert({ id: SCRATCH_ROW_ID, data: payload, updated_at: nowIso })
          .select('updated_at'));
        if(error) throw error;
      }
      lastKnownScratchUpdatedAt = (data && data[0] && data[0].updated_at) || nowIso;
      lastScratchSavedAt = Date.now();
      setScratchStatus('saved');
      hideScratchConflictBanner();
      hideScratchOfflineBanner();
    }catch(e){
      console.error('scratch save failed', e);
      setScratchStatus('offline');
      showScratchOfflineBanner('Couldn’t reach the server to save this — it’s saved on this device '
        + 'and will sync automatically once you’re back online.');
    }
  }

  // Same 1.5s as notes.js, and for the same reason: this is written in continuous prose and every
  // fired timer is a full re-upload of the page.
  let scratchSaveDebounceTimer = null;
  function debouncedSaveScratch(delay){
    clearTimeout(scratchSaveDebounceTimer);
    scratchSaveDebounceTimer = setTimeout(saveScratch, delay || 1500);
  }
  function flushPendingScratchSave(){
    if(scratchSaveDebounceTimer){ clearTimeout(scratchSaveDebounceTimer); scratchSaveDebounceTimer = null; saveScratch(); }
  }
  window.addEventListener('beforeunload', flushPendingScratchSave);
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'hidden') flushPendingScratchSave(); });

  /* Loads the dedicated scratch resource.

     NO parsedMainState parameter, unlike loadJobsData()/loadNotesData(). Theirs exists to rescue a
     pre-split copy that an earlier shipped build wrote into the shared blob — doSave()'s
     destructure now strips those keys, and a jsonb write REPLACES the column, so that copy is
     destroyed by the next save from any tab and load is the only chance to save it. state.scratch
     has never lived anywhere but its own row, in any build, so there is nothing to rescue. Don't
     add a migration branch here to "match the others": it could never fire, and CLAUDE.md's rule
     against removing those standing migrations would then keep the dead code alive forever. */
  async function loadScratchData(){
    try{
      if(usingClaudeStorage){
        try{
          const res = await getWithRetry(SCRATCH_STORAGE_KEY);
          if(res && res.value){
            applyLoadedScratchState(JSON.parse(res.value));
            scratchLoadedOk = true;
          } else {
            seedOrInitScratchState();
          }
          cacheScratchStateLocally();
          hideScratchOfflineBanner();
        }catch(e){
          const msg = (e && e.message) || String(e);
          if(/not found|no such key|does not exist/i.test(msg)){
            seedOrInitScratchState();
            cacheScratchStateLocally();
            hideScratchOfflineBanner();
          } else {
            console.error('scratch load failed', e);
            fallbackToLocalScratchCache();
          }
        }
      } else {
        if(!supa) return; // Supabase unconfigured — persistence.js already surfaced the setup banner
        const { data, error } = await supa.from('app_data').select('data, updated_at').eq('id', SCRATCH_ROW_ID).maybeSingle();
        if(error){
          console.error('scratch load failed', error);
          fallbackToLocalScratchCache();
        } else if(data){
          applyLoadedScratchState(data.data);
          lastKnownScratchUpdatedAt = data.updated_at;
          scratchLoadedOk = true;
          cacheScratchStateLocally();
          hideScratchOfflineBanner();
        } else {
          seedOrInitScratchState();
          cacheScratchStateLocally();
          hideScratchOfflineBanner();
        }
      }
    }catch(e){
      // A scratch-only failure must never propagate into persistence.js:load() and abort the whole
      // app's boot, which would strand every other tab behind the load screen.
      console.error('scratch load failed (unexpected)', e);
      fallbackToLocalScratchCache();
    }
  }

  /* Only reached once the dedicated resource is positively confirmed absent. Unlike
     seedOrInitNotesState() there is no seed write and this isn't async: with no rescued data to
     protect there is nothing to persist yet, and the row is created by the first real edit's
     unconditional upsert (lastKnownScratchUpdatedAt is still null, so that branch is taken).
     Unlocking the gate here is correct and required — we've just positively established what the
     remote holds (nothing), which is exactly what the flag means. */
  function seedOrInitScratchState(){
    applyLoadedScratchState(null);
    scratchLoadedOk = true;
  }

  /* ---------- the page itself ---------- */

  const SCRATCH_STATUS = { dirty:'unsaved', saved:'saved', offline:'not synced', conflict:'not saved', blocked:'not saved', uploading:'uploading image…' };
  // A soft ceiling. Images are Storage URLs rather than bytes (see insertScratchImage), so this is
  // really a guard against a runaway paste — but the page is ONE string re-uploaded whole on every
  // debounce fire, so an unbounded one would turn every typing pause into a multi-megabyte write.
  const SCRATCH_MAX_CHARS = 300000;
  /* Match on the input TYPE, not on our own class. The sanitizer rebuilds every tickbox through
     makeScratchTick() so the class is always there in practice — but the footer's count and the
     click-to-toggle must not be the two places that quietly disagree if it ever isn't. */
  const SCRATCH_TICK_SEL = 'input[type="checkbox"]';
  let scratchOpen = false;
  let scratchReturnFocus = null;
  let scratchStatusKind = '';
  let scratchCountTimer = null;
  const scratchBrandEl = document.querySelector('.brand');

  function setScratchStatus(kind){
    scratchStatusKind = kind;
    const n = el('scratchStatus');
    if(n) n.textContent = SCRATCH_STATUS[kind] || '';
  }

  /* The ONLY place the surface's innerHTML is assigned. No-ops when it already matches, so it can
     never fight the caret — same rule as the Notes title input: the field is live, and rewriting it
     mid-keystroke would collapse the selection and throw the cursor to the end. `force` is for the
     conflict-recovery path, which deliberately replaces what's on screen. */
  function syncScratchSurface(force){
    const surf = el('scratchText');
    if(!surf) return;
    const next = (state.scratch && state.scratch.html) || '';
    if(force || surf.innerHTML !== next) surf.innerHTML = next;
    markScratchEmpty();
  }

  // contenteditable has no ::placeholder, and it's almost never truly :empty (browsers leave a <br>
  // or an empty <div> behind), so the empty state is a class we set ourselves.
  function markScratchEmpty(){
    const surf = el('scratchText');
    if(!surf) return;
    const blank = !surf.textContent.trim() && !surf.querySelector('img, input, a');
    surf.classList.toggle('is-empty', blank);
  }

  function scratchPlainText(){
    const surf = el('scratchText');
    if(surf && scratchOpen) return surf.textContent || '';
    const doc = new DOMParser().parseFromString('<body>' + ((state.scratch && state.scratch.html) || '') + '</body>', 'text/html');
    return doc.body.textContent || '';
  }

  function scratchWordCount(s){
    // a non-allocating whitespace-transition count: s.match(/\S+/g) on a long page would build a
    // multi-thousand-element array on every keystroke
    let n = 0, inWord = false;
    for(let i=0; i<s.length; i++){
      const c = s.charCodeAt(i);
      const ws = (c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11 || c === 0xA0);
      if(ws){ inWord = false; } else if(!inWord){ inWord = true; n++; }
    }
    return n;
  }

  function updateScratchFooter(){
    const c = el('scratchCount');
    if(c){
      const n = scratchWordCount(scratchPlainText());
      const surf = el('scratchText');
      const ticks = surf ? surf.querySelectorAll(SCRATCH_TICK_SEL) : [];
      let bits = n + (n === 1 ? ' word' : ' words');
      if(ticks.length){
        let done = 0;
        for(let i=0; i<ticks.length; i++) if(ticks[i].checked) done++;
        bits += ' · ' + done + '/' + ticks.length + ' ticked';
      }
      c.textContent = bits;
    }
    // Idle (nothing typed since the last confirmed write): say when it was last edited, so a cold
    // open isn't blank. Falls back to the plain word once there's no timestamp to show.
    if(!scratchStatusKind || scratchStatusKind === 'saved'){
      const n = el('scratchStatus');
      const at = (state.scratch && state.scratch.updatedAt) || 0;
      if(n) n.textContent = at ? ('saved · ' + scratchRelTime(at)) : (lastScratchSavedAt ? 'saved' : '');
    }
  }

  function scratchRelTime(ts){
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if(s < 45) return 'just now';
    const m = Math.round(s / 60);
    if(m < 60) return m + (m === 1 ? ' min ago' : ' mins ago');
    const h = Math.round(m / 60);
    if(h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    const d = Math.round(h / 24);
    return d + (d === 1 ? ' day ago' : ' days ago');
  }

  function scheduleScratchCount(){
    if(scratchCountTimer) return;
    scratchCountTimer = setTimeout(()=>{ scratchCountTimer = null; updateScratchFooter(); }, 120);
  }

  // Every edit path funnels through here: read the live DOM into state, mark it dirty, debounce.
  // Never writes back to the surface — see syncScratchSurface().
  function onScratchInput(){
    const surf = el('scratchText');
    if(!surf) return;
    let html = surf.innerHTML;
    if(html.length > SCRATCH_MAX_CHARS){
      html = html.slice(0, SCRATCH_MAX_CHARS);
      surf.innerHTML = sanitizeScratchHtml(html); // truncation can cut mid-tag; re-parse to close it
      html = surf.innerHTML;
    }
    state.scratch.html = html;
    state.scratch.updatedAt = Date.now();
    setScratchStatus('dirty');
    markScratchEmpty();
    scheduleScratchCount();
    debouncedSaveScratch();
  }

  /* ---------- tickboxes, links, images ----------
     document.execCommand is deprecated but is still the only cross-browser way to insert into a
     contenteditable while keeping the browser's own undo stack intact — and this repo has no
     bundler to reach for an editor library. Hand-rolled Range surgery would work but would silently
     break Ctrl+Z, which on a napkin matters more than the deprecation notice does. */

  function scratchExec(cmd, value){
    try{ document.execCommand(cmd, false, value); }catch(e){ /* nothing sensible to do */ }
  }

  function insertScratchTick(done){
    const marker = 'sc' + uid();
    scratchExec('insertHTML', '<span id="' + marker + '"></span>');
    const slot = document.getElementById(marker);
    if(!slot) return;
    const box = makeScratchTick(done);
    const sp = document.createTextNode(' ');
    slot.replaceWith(box, sp);
    const sel = window.getSelection();
    if(sel){
      const r = document.createRange();
      r.setStartAfter(sp); r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
    }
  }

  // "[] " / "[x] " at the start of a line becomes a tickbox — the same shorthand the Notes bodies
  // use for markdown, so there's nothing new to learn. Returns true if it consumed the keystroke.
  function maybeScratchTickShorthand(){
    const sel = window.getSelection();
    if(!sel || !sel.rangeCount) return false;
    const r = sel.getRangeAt(0);
    if(!r.collapsed || r.startContainer.nodeType !== 3) return false;
    const node = r.startContainer, off = r.startOffset;
    const m = /(?:^|\n)[ \t]*\[( |x|X)?\]$/.exec(node.nodeValue.slice(0, off));
    if(!m) return false;
    const lead = /^\n/.test(m[0]) ? 1 : 0;
    const rr = document.createRange();
    rr.setStart(node, off - (m[0].length - lead));
    rr.setEnd(node, off);
    rr.deleteContents();
    const sel2 = window.getSelection();
    sel2.removeAllRanges(); sel2.addRange(rr);
    insertScratchTick(/x/i.test(m[1] || ''));
    return true;
  }

  // A bare URL followed by a space or Enter becomes a link. Deliberately only http(s): anything
  // looser starts linkifying things that merely contain a dot.
  function maybeScratchAutolink(){
    const sel = window.getSelection();
    if(!sel || !sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    if(!r.collapsed || r.startContainer.nodeType !== 3) return;
    const node = r.startContainer, off = r.startOffset;
    if(node.parentNode && node.parentNode.closest && node.parentNode.closest('a')) return; // already linked
    const m = /(https?:\/\/[^\s]+)$/.exec(node.nodeValue.slice(0, off));
    if(!m) return;
    const url = m[1].replace(/[.,;:!?)]+$/, ''); // don't swallow sentence punctuation
    if(!SCRATCH_SAFE_URL.test(url)) return;
    const rr = document.createRange();
    rr.setStart(node, off - m[1].length);
    rr.setEnd(node, off - m[1].length + url.length);
    sel.removeAllRanges(); sel.addRange(rr);
    scratchExec('createLink', url);
    // put the caret back at the end, OUTSIDE the new link, so typing doesn't extend it
    const after = window.getSelection();
    if(after && after.rangeCount){
      const cr = after.getRangeAt(0).cloneRange();
      cr.collapse(false);
      after.removeAllRanges(); after.addRange(cr);
    }
  }

  function promptScratchLink(){
    const sel = window.getSelection();
    const hasSelection = sel && !sel.isCollapsed && el('scratchText').contains(sel.anchorNode);
    const raw = window.prompt('Link to…', 'https://');
    if(!raw) return;
    const url = raw.trim().replace(/[\s"']/g, '');
    if(!SCRATCH_SAFE_URL.test(url)) return; // unknown scheme: do nothing rather than insert something inert
    if(hasSelection) scratchExec('createLink', url);
    else scratchExec('insertHTML', '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(url) + '</a>&nbsp;');
    onScratchInput();
  }

  /* Pasted/dropped images go to Supabase Storage and only their URL lands in the page — never
     base64. Two reasons, both hard rules here: CLAUDE.md's image convention, and the fact that this
     page is re-uploaded WHOLE on every debounce fire, so an inlined photo would be re-sent every
     1.5 seconds for as long as you kept typing.
     Note the deliberate gap: removing an image from the page does NOT delete it from Storage. In
     free-form HTML there's no reliable "this was removed" signal, and an orphaned file is harmless
     (the repo already treats deleteStorageImage as best-effort elsewhere). */
  function insertScratchImage(file){
    const marker = 'sc' + uid();
    scratchExec('insertHTML', '<span id="' + marker + '" class="scratch-uploading">uploading image…</span>');
    setScratchStatus('uploading');
    uploadCompressedImage(file, 1400, 0.82, 'scratch').then(url=>{
      const slot = document.getElementById(marker);
      const img = document.createElement('img');
      img.src = url;
      if(slot) slot.replaceWith(img);
      else el('scratchText').appendChild(img);
      setScratchStatus('dirty');
      onScratchInput();
    }).catch(err=>{
      const slot = document.getElementById(marker);
      if(slot){
        slot.className = 'scratch-uperr';
        slot.textContent = (err && err.message) || 'Couldn’t upload that image.';
      }
      setScratchStatus('dirty');
      onScratchInput();
    });
  }

  function scratchImageFrom(dt){
    if(!dt) return null;
    const files = dt.files;
    if(files) for(let i=0; i<files.length; i++) if(/^image\//.test(files[i].type)) return files[i];
    const items = dt.items;
    if(items) for(let i=0; i<items.length; i++){
      if(items[i].kind === 'file' && /^image\//.test(items[i].type)){
        const f = items[i].getAsFile();
        if(f) return f;
      }
    }
    return null;
  }

  /* ---------- open / close ---------- */

  function openScratch(){
    if(scratchOpen) return;
    scratchReturnFocus = document.activeElement;
    /* Redraw the logo in place on top of the takeover. It's measured from .brand's live rect — the
       sidebar is still laid out underneath, merely covered — so it lands exactly where the real one
       is at both breakpoints, with nothing hardcoded. The icon's own box and the name's font-size
       are copied too, because the mobile bar shrinks both on scroll (.sidebar.scrolled) and the
       copy has no such ancestor to inherit from. Must be read BEFORE lockPageScroll(), which sets
       body{position:fixed} and moves the sticky bar's containing block out from under it. */
    const brandBox = el('scratchBrand');
    const overlay = el('scratchOverlay');
    if(brandBox && scratchBrandEl){
      const r = scratchBrandEl.getBoundingClientRect();
      brandBox.style.top = r.top + 'px';
      brandBox.style.left = r.left + 'px';
      brandBox.style.width = r.width + 'px';
      brandBox.style.height = r.height + 'px';
      const realIcon = scratchBrandEl.querySelector('.brand-icon');
      const copyIcon = brandBox.querySelector('.brand-icon');
      if(realIcon && copyIcon){
        const ir = realIcon.getBoundingClientRect();
        copyIcon.style.width = ir.width + 'px';
        copyIcon.style.height = ir.height + 'px';
      }
      const realName = scratchBrandEl.querySelector('.brand-name');
      const copyName = brandBox.querySelector('.brand-name');
      if(realName && copyName) copyName.style.fontSize = getComputedStyle(realName).fontSize;
      // and keep the writing clear of it, whatever the layout says the logo's height is
      if(overlay) overlay.style.paddingTop = Math.max(r.bottom + 14, 20) + 'px';
    }
    scratchOpen = true;
    overlay.style.display = 'flex';
    syncScratchSurface();
    updateScratchFooter();
    lockPageScroll(); // js/goals.js — counted, iOS-safe; without it a swipe past the surface's own
                      // scroll end moves the page behind and you exit somewhere else entirely
    /* Stays synchronous inside the click handler's call stack on purpose: awaiting anything, or
       deferring this focus() into a setTimeout, drops it out of the user-gesture window and iOS
       then refuses to open the software keyboard. */
    const surf = el('scratchText');
    surf.focus({ preventScroll:true });
    placeScratchCaretAtEnd(surf);
    surf.scrollTop = surf.scrollHeight;
  }

  function placeScratchCaretAtEnd(surf){
    try{
      const r = document.createRange();
      r.selectNodeContents(surf);
      r.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }catch(e){ /* an empty surface in some engines — focus alone is fine */ }
  }

  function closeScratch(){
    if(!scratchOpen) return;
    scratchOpen = false;
    flushPendingScratchSave();
    el('scratchOverlay').style.display = 'none';
    unlockPageScroll(); // also restores the exact scroll position of the tab underneath
    if(scratchReturnFocus && document.contains(scratchReturnFocus)) scratchReturnFocus.focus();
    scratchReturnFocus = null;
  }

  if(scratchBrandEl) scratchBrandEl.addEventListener('click', e=>{
    /* #navRightGroup holds the fasting/time-block chips and the ▶ Play button, and below 760px it
       sits absolutely positioned INSIDE .brand — so a Play tap bubbles up here and would otherwise
       drop a scratch page on top of the session it just started. */
    if(e.target && e.target.closest && e.target.closest('#navRightGroup')) return;
    /* A drag that selects "Project 25" also ends in a click. Don't turn text selection into a mode
       switch — cheaper and more invisible than user-select:none, which would be a real behaviour
       change to a piece of decoration. */
    const sel = window.getSelection();
    if(sel && !sel.isCollapsed && sel.anchorNode && scratchBrandEl.contains(sel.anchorNode)) return;
    if(scratchOpen) closeScratch(); else openScratch();
  });

  /* Capture phase + stopPropagation, the same technique as the level-up popup in js/goals.js.
     Every existing document-level Escape handler in the app is bubble-phase and guarded only on
     its OWN element's visibility, so none of them knows about this one; without capture+stop a
     single Escape could tear down two layers. In practice none of them can be open here (this page
     is only reachable from the sidebar, and all of them cover it), so it's belt-and-braces — but
     it's the pattern the repo already documents for the layered case and it costs one argument. */
  document.addEventListener('keydown', e=>{
    if(e.key !== 'Escape' || !scratchOpen) return;
    e.stopPropagation();
    closeScratch();
  }, true);

  el('scratchCloseBtn').addEventListener('click', closeScratch);

  // the redrawn logo IS the close button now
  const scratchBrandBtn = el('scratchBrand');
  scratchBrandBtn.addEventListener('click', closeScratch);
  scratchBrandBtn.addEventListener('keydown', e=>{
    if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); closeScratch(); }
  });

  /* ---------- surface wiring ---------- */

  const scratchSurface = el('scratchText');

  scratchSurface.addEventListener('input', onScratchInput);

  scratchSurface.addEventListener('keydown', e=>{
    if((e.ctrlKey || e.metaKey) && !e.altKey){
      const k = e.key.toLowerCase();
      if(k === 'k'){ e.preventDefault(); promptScratchLink(); return; }
      if(e.shiftKey && k === 'c'){ e.preventDefault(); insertScratchTick(false); onScratchInput(); return; }
    }
    if(e.key === ' '){
      if(maybeScratchTickShorthand()){ e.preventDefault(); onScratchInput(); return; }
      maybeScratchAutolink();
      return;
    }
    if(e.key === 'Enter') maybeScratchAutolink();
  });

  scratchSurface.addEventListener('click', e=>{
    const t = e.target;
    if(!t || !t.closest) return;
    const box = t.closest(SCRATCH_TICK_SEL);
    if(box){
      /* Toggle explicitly rather than letting the browser do it. Inside a contenteditable the
         native activation behaviour isn't reliable, and more importantly only the `checked`
         ATTRIBUTE survives innerHTML serialization — the .checked property alone would look right
         until the next reload and then come back unticked. */
      e.preventDefault();
      const next = !box.hasAttribute('checked');
      box.checked = next;
      if(next) box.setAttribute('checked', ''); else box.removeAttribute('checked');
      onScratchInput();
      return;
    }
    const a = t.closest('a');
    if(a && a.getAttribute('href')){
      // in a contenteditable a click normally just places the caret; make links actually open
      e.preventDefault();
      window.open(a.getAttribute('href'), '_blank', 'noopener,noreferrer');
    }
  });

  scratchSurface.addEventListener('paste', e=>{
    const dt = e.clipboardData;
    if(!dt) return;
    const img = scratchImageFrom(dt);
    if(img){ e.preventDefault(); insertScratchImage(img); return; }
    // Everything else is re-inserted by hand so it goes through the sanitizer on the way in —
    // otherwise a paste from a web page drops its whole stylesheet's worth of markup into the page.
    e.preventDefault();
    const html = dt.getData('text/html');
    const text = dt.getData('text/plain');
    if(html){
      scratchExec('insertHTML', sanitizeScratchHtml(html));
    } else if(text){
      const one = text.trim();
      const sel = window.getSelection();
      if(/^https?:\/\/\S+$/.test(one) && sel && !sel.isCollapsed){
        scratchExec('createLink', one);           // pasting a URL over selected words links them
      } else if(/^https?:\/\/\S+$/.test(one)){
        scratchExec('insertHTML', '<a href="' + escapeHtml(one) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(one) + '</a>&nbsp;');
      } else {
        scratchExec('insertText', text);
      }
    }
    onScratchInput();
  });

  scratchSurface.addEventListener('dragover', e=>{
    if(scratchImageFrom(e.dataTransfer)) e.preventDefault();
  });
  scratchSurface.addEventListener('drop', e=>{
    const img = scratchImageFrom(e.dataTransfer);
    if(!img) return;
    e.preventDefault();
    insertScratchImage(img);
  });

  // Tab stays inside the page rather than walking into the invisible tab behind it. No literal-tab
  // insertion: this is a napkin, not a code editor, and swallowing Tab entirely would strand
  // anyone navigating to the × by keyboard.
  el('scratchOverlay').addEventListener('keydown', e=>{
    if(e.key !== 'Tab') return;
    const focusables = el('scratchOverlay').querySelectorAll('[contenteditable="true"], button, #scratchBrand');
    if(!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  });
