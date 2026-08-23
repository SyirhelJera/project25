  /* ================= SCRATCH — the napkin =================
     A small stack of free-form pages. No files, no tree, no typed titles. The Notes tab is the
     organized outliner; this is deliberately its opposite, for the thought you want out of your
     head in two seconds and don't want to file anywhere.

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
     a real obligation — see the sanitizer below. Content is HTML, held per page in state.scratch.pages.

     Storage: its OWN resource (row id 'scratch'), the same split Jobs and Notes have, for the
     sharper version of their reason — the pages debounce-save per keystroke,
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
  // the whole page stack as it stood when a conflict was detected, so "load theirs" is recoverable
  let scratchPreConflictSnap = null;

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

  /* ---------- pages ----------
     The napkin is a small stack of pages, not one endless sheet. They're a FLAT array and the
     current one is addressed by ID rather than index, so a page deleted from another tab can't
     silently leave you standing on a different page's contents. There is always at least one page:
     deleting the last one clears it rather than leaving nothing to write on. */
  function makeScratchPage(html){
    return { id: uid(), html: html || '', updatedAt: Date.now() };
  }
  function scratchPagesArr(){ return (state.scratch && state.scratch.pages) || []; }
  function scratchActiveIndex(){
    const pages = scratchPagesArr();
    if(!pages.length) return 0;
    let i = -1;
    for(let k=0; k<pages.length; k++) if(pages[k].id === state.scratch.activeId){ i = k; break; }
    return i < 0 ? 0 : i;
  }
  function scratchActivePage(){ ensureScratchPages(); return state.scratch.pages[scratchActiveIndex()]; }
  // The one invariant enforcer: a pages array that exists, holds at least one page, and whose
  // activeId points at a page that's actually in it. Cheap and idempotent, so it's safe to call
  // from anywhere that might have just changed the array.
  function ensureScratchPages(){
    if(!state.scratch || typeof state.scratch !== 'object') state.scratch = { pages:[], activeId:'', updatedAt:0 };
    if(!Array.isArray(state.scratch.pages)) state.scratch.pages = [];
    if(!state.scratch.pages.length) state.scratch.pages.push(makeScratchPage());
    let found = false;
    for(let i=0; i<state.scratch.pages.length; i++) if(state.scratch.pages[i].id === state.scratch.activeId){ found = true; break; }
    if(!found) state.scratch.activeId = state.scratch.pages[0].id;
  }

  function scratchHtmlToText(html){
    const doc = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
    return doc.body.textContent || '';
  }

  /* A page's name is just its first line, derived on read — the same trick noteTags() uses, and for
     the same reason: nothing to maintain and nothing that can go stale when the text changes.
     It has to walk the top-level children rather than split textContent on "\n", because
     textContent concatenates block elements with no separator ("<div>a</div><div>b</div>" is "ab"). */
  function scratchPageTitle(p){
    const doc = new DOMParser().parseFromString('<body>' + ((p && p.html) || '') + '</body>', 'text/html');
    const kids = doc.body.childNodes;
    for(let i=0; i<kids.length; i++){
      const t = (kids[i].textContent || '').replace(/\s+/g, ' ').trim();
      if(t) return t.length > 40 ? t.slice(0, 40) + '…' : t;
    }
    if(/<img\b/i.test((p && p.html) || '')) return 'Image';
    return 'Empty page';
  }

  function scratchPageIsEmpty(p){
    if(!p) return true;
    const h = p.html || '';
    if(/<(img|input)\b/i.test(h)) return false; // a page holding only a photo or a tick isn't blank
    return !scratchHtmlToText(h).trim(); // JS trim() already treats &nbsp; as whitespace
  }

  // Hydration + lazy field defaults. New fields on the scratch page go HERE, not in
  // persistence.js:applyLoadedState() — same exception to the usual convention that Jobs and
  // Notes have. Also the inbound sanitizer boundary, and where both older shapes are upgraded.
  function applyLoadedScratchState(parsed){
    const raw = parsed && parsed.scratch;
    let pages = [], activeId = '', at = 0;
    if(typeof raw === 'string'){
      pages = [ { id: uid(), html: scratchPlainToHtml(raw), updatedAt: 0 } ];
    } else if(raw && typeof raw === 'object'){
      at = raw.updatedAt || 0;
      if(Array.isArray(raw.pages)){
        for(let i=0; i<raw.pages.length; i++){
          const p = raw.pages[i];
          if(!p || typeof p !== 'object') continue;
          pages.push({ id: p.id || uid(), html: sanitizeScratchHtml(typeof p.html === 'string' ? p.html : ''), updatedAt: p.updatedAt || at });
        }
        activeId = raw.activeId || '';
      } else if(typeof raw.html === 'string'){
        // the single-page build: one page's worth of HTML sitting at the top level
        pages = [ { id: uid(), html: sanitizeScratchHtml(raw.html), updatedAt: at } ];
      } else if(typeof raw.text === 'string'){
        // the original plain-<textarea> build: a bare string, no markup at all
        pages = [ { id: uid(), html: scratchPlainToHtml(raw.text), updatedAt: at } ];
      }
    }
    // mute rides the row rather than localStorage so the preference follows you between devices,
    // the same as which page you had open
    state.scratch = { pages: pages, activeId: activeId, updatedAt: at, mute: !!(raw && raw.mute) };
    ensureScratchPages();
    // Re-baseline rather than diff: arriving at a different set of pages (first load, or a
    // conflict-reload of someone else's newer copy) is not this session deleting anything.
    noteScratchImages();
    syncScratchSurface(true);
    renderScratchPages();
    updateScratchFooter();
  }

  function scratchPlainToHtml(t){
    return String(t || '').split(/\r?\n/).map(line => '<div>' + (escapeHtml(line) || '<br>') + '</div>').join('');
  }

  /* The wire format. No omit-defaults compaction, unlike serializeNotes(): that function's ~45%
     win comes from per-record key overhead across many small records, and a handful of pages is
     nowhere near that scale. This exists to honour the same rule — nothing else may serialize
     state.scratch, always go through here — and to be the outbound sanitizer boundary.
     activeId rides along so reopening lands you back on the page you left. */
  function serializeScratch(){
    ensureScratchPages();
    const pages = state.scratch.pages.map(p => ({ id: p.id, html: sanitizeScratchHtml(p.html || ''), updatedAt: p.updatedAt || 0 }));
    return { pages: pages, activeId: state.scratch.activeId, updatedAt: state.scratch.updatedAt || 0, mute: !!state.scratch.mute };
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
    // the WHOLE stack, not one page: "load theirs" replaces every page, so the snapshot must too
    scratchPreConflictSnap = JSON.parse(JSON.stringify(serializeScratch()));
    b.style.display = 'flex';
    b.innerHTML = '<span>Another tab or device saved a newer version of this page after this one loaded its copy. What you just typed was <b>not saved</b>, to avoid overwriting it.</span>'
      + '<button class="btn btn-sm btn-ghost" id="scratchConflictReloadBtn">Load theirs (discards what’s on screen)</button>'
      + '<button class="btn btn-sm btn-primary" id="scratchConflictForceBtn">Keep mine (overwrite theirs)</button>';
    el('scratchConflictReloadBtn').addEventListener('click', async ()=>{
      const mine = scratchPreConflictSnap;
      await loadScratchData();
      hideScratchConflictBanner();
      // nothing is lost — offer the discarded draft back, quietly
      showScratchOfflineBanner('Loaded the newer version. <button class="btn btn-sm btn-ghost" id="scratchRestoreMineBtn">Put mine back</button>');
      const restore = el('scratchRestoreMineBtn');
      if(restore) restore.addEventListener('click', ()=>{
        applyLoadedScratchState({ scratch: mine });
        state.scratch.updatedAt = Date.now();
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
  // A soft ceiling, per page. Images are Storage URLs rather than bytes (see insertScratchImage),
  // so this is really a guard against a runaway paste — but the whole stack is re-uploaded on every
  // debounce fire, so an unbounded page would turn every typing pause into a multi-megabyte write.
  const SCRATCH_MAX_CHARS = 300000;
  /* Match on the input TYPE, not on our own class. The sanitizer rebuilds every tickbox through
     makeScratchTick() so the class is always there in practice — but the footer's count and the
     click-to-toggle must not be the two places that quietly disagree if it ever isn't. */
  const SCRATCH_TICK_SEL = 'input[type="checkbox"]';
  let scratchOpen = false;
  let scratchReturnFocus = null;
  let scratchStatusKind = '';
  let scratchCountTimer = null;
  let scratchTickAt = 0;
  const scratchBrandEl = document.querySelector('.brand');

  /* Whether the app may take focus on its own. On a touch device the answer is no: a soft keyboard
     is a huge animated slab over half the screen, and raising it before you have even read the page
     — then again on every swipe — is the opposite of what opening a notebook should feel like. The
     writing area is contenteditable, so TAPPING it focuses natively and raises the keyboard exactly
     when you mean to write, which is the only time it should appear.
     With a hardware keyboard none of that applies and being able to type straight away is the whole
     point, so focus is taken as before. matchMedia is held rather than re-queried because .matches
     is live, so this follows a device that changes its primary pointer. */
  const scratchCoarsePointer = (function(){
    try{ return window.matchMedia('(pointer: coarse)'); }catch(e){ return null; }
  })();
  function scratchWantsAutoFocus(){ return !(scratchCoarsePointer && scratchCoarsePointer.matches); }

  function setScratchStatus(kind){
    scratchStatusKind = kind;
    const n = el('scratchStatus');
    if(n) n.textContent = SCRATCH_STATUS[kind] || '';
  }

  /* The ONLY place the surface's innerHTML is assigned. No-ops when it already matches, so it can
     never fight the caret — same rule as the Notes title input: the field is live, and rewriting it
     mid-keystroke would collapse the selection and throw the cursor to the end. `force` is for the
     paths that deliberately replace what's on screen: a page switch, a load, conflict recovery. */
  function syncScratchSurface(force){
    const surf = el('scratchText');
    if(!surf) return;
    ensureScratchPages();
    const next = scratchActivePage().html || '';
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
    return scratchHtmlToText(scratchActivePage().html);
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

  // Throttled together because both read the whole page: the word/tick count and the dots' hover
  // titles, which are derived from each page's first line and so change as you type.
  function scheduleScratchCount(){
    if(scratchCountTimer) return;
    scratchCountTimer = setTimeout(()=>{ scratchCountTimer = null; updateScratchFooter(); renderScratchPages(); }, 120);
  }

  // Every edit path funnels through here: read the live DOM into the ACTIVE page, mark it dirty,
  // debounce. Never writes back to the surface — see syncScratchSurface().
  function onScratchInput(){
    const surf = el('scratchText');
    if(!surf) return;
    let html = surf.innerHTML;
    if(html.length > SCRATCH_MAX_CHARS){
      surf.innerHTML = sanitizeScratchHtml(html.slice(0, SCRATCH_MAX_CHARS)); // truncation can cut mid-tag; re-parse to close it
      html = surf.innerHTML;
    }
    const page = scratchActivePage();
    page.html = html;
    page.updatedAt = Date.now();
    state.scratch.updatedAt = page.updatedAt;
    setScratchStatus('dirty');
    markScratchEmpty();
    scheduleScratchCount();
    debouncedSaveScratch();
  }

  /* ---------- moving between pages ---------- */

  // The surface is the live copy of whatever page is showing; anything that changes which page that
  // is has to fold it back into the array FIRST, or the edit is lost on switch.
  function commitScratchSurface(){
    const surf = el('scratchText');
    if(!surf || !scratchOpen) return;
    scratchActivePage().html = surf.innerHTML;
  }

  /* A page-turn tick, voiced as a creamy keyboard switch — a thock, not a click.

     The distinction is entirely about where the energy sits. A bright, clacky switch is high and
     sizzly; a creamy one is LOW and damped, its body around 150-250Hz with everything above ~1kHz
     rolled off, and a softly rounded attack rather than a razor transient. Two earlier attempts got
     this wrong in the same direction: a square-wave harmonic at ~1.4kHz (a chiptune), then
     bandpassed noise at 2.7kHz (a sharp UI tick). Both were far too bright to feel like a key.

     So the voice is a low sine "thock" carrying the weight, a quieter mid sine giving it roundness,
     and a LOWPASSED noise burst for the impact of the keycap landing. Lowpass, not bandpass: it is
     the removal of the highs that makes this creamy rather than clacky, and any hiss left up top
     undoes the whole effect. Each part sweeps downward in pitch, which is what makes a sound read
     as something coming to rest instead of a note being played.

     Built from raw nodes rather than checklists.js's sfxTone(): that helper opens over a 15ms
     linear ramp and offers only bare oscillators, so it can make neither the shaped attack nor the
     pitch sweeps this needs. The AudioContext is still very much shared via sfxOutput() — the rule
     recorded in js/goals.js is about never opening a SECOND context, and this opens none.

     Direction is a mere 15% on the fundamental, not a musical interval. Real keys don't change
     pitch by which way you're going, and anything wider turns paging back and forth into a tune.

     The noise buffer is built once and reused: a hard scroll fires these ~30ms apart and a fresh
     float array per tick would churn the heap for nothing. */
  let scratchTickBuf = null;
  function scratchTickNoise(ctx){
    if(scratchTickBuf && scratchTickBuf.sampleRate === ctx.sampleRate) return scratchTickBuf;
    const len = Math.floor(ctx.sampleRate * 0.022);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // squared fade, not cubic: still front-loaded, but with enough shoulder to sound like a keycap
    // being caught by the pad under it rather than a stick being snapped
    for(let i=0; i<len; i++){
      const fade = 1 - i / len;
      data[i] = (Math.random() * 2 - 1) * fade * fade;
    }
    scratchTickBuf = buf;
    return buf;
  }

  function playScratchPageTick(dir){
    if(state.scratch && state.scratch.mute) return;
    if(typeof sfxOutput !== 'function') return;
    const now = Date.now();
    if(now - scratchTickAt < 25) return;
    scratchTickAt = now;
    const out = sfxOutput();
    if(!out) return; // Web Audio blocked or unavailable — the slide still carries the move
    try{
      const ctx = sfxCtx;
      const t = ctx.currentTime;
      const f0 = dir > 0 ? 205 : 178; // the thock itself

      // --- impact: the keycap bottoming out. Lowpassed hard so none of it reads as hiss.
      const src = ctx.createBufferSource();
      src.buffer = scratchTickNoise(ctx);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(820, t);
      lp.frequency.exponentialRampToValueAtTime(380, t + 0.03); // the highs die first, as they do in a damped case
      lp.Q.setValueAtTime(0.7, t);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.exponentialRampToValueAtTime(0.075, t + 0.003); // ~3ms: rounded, not a razor edge
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      src.connect(lp); lp.connect(ng); ng.connect(out);
      src.start(t); src.stop(t + 0.055);

      // --- body: the low thock that carries the weight
      const low = ctx.createOscillator();
      low.type = 'sine';
      low.frequency.setValueAtTime(f0, t);
      low.frequency.exponentialRampToValueAtTime(f0 * 0.62, t + 0.055);
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(0.0001, t);
      lg.gain.exponentialRampToValueAtTime(0.15, t + 0.004);
      lg.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
      low.connect(lg); lg.connect(out);
      low.start(t); low.stop(t + 0.085);

      // --- cream: a quiet mid partial. Without it the thock is a dull thud; too much and it clacks.
      const mid = ctx.createOscillator();
      mid.type = 'sine';
      mid.frequency.setValueAtTime(f0 * 2.4, t);
      mid.frequency.exponentialRampToValueAtTime(f0 * 1.5, t + 0.04);
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(0.0001, t);
      mg.gain.exponentialRampToValueAtTime(0.045, t + 0.003);
      mg.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
      mid.connect(mg); mg.connect(out);
      mid.start(t); mid.stop(t + 0.055);
    }catch(e){ /* a page turn is never worth throwing over */ }
  }

  function scratchGoTo(i){
    ensureScratchPages();
    // read BEFORE the innerHTML swap below, so "were you already typing?" is answered about the
    // page you were on rather than the one you land on
    const wasWriting = document.activeElement === el('scratchText');
    const pages = state.scratch.pages;
    const from = scratchActiveIndex();
    const to = Math.max(0, Math.min(pages.length - 1, i));
    if(to === from) return; // no click when there's nowhere to go — silence IS the end-of-stack cue
    commitScratchSurface();
    state.scratch.activeId = pages[to].id;
    syncScratchSurface(true);
    renderScratchPages();
    updateScratchFooter();
    animateScratchPage(to > from ? 1 : -1);
    playScratchPageTick(to > from ? 1 : -1);
    /* Take focus only if we already had it — keeping a keyboard that's already up, and keeping the
       caret valid after the innerHTML swap — or if there's no soft keyboard to summon in the first
       place. Flipping between pages must never be the thing that raises it. */
    const surf = el('scratchText');
    if(surf && (wasWriting || scratchWantsAutoFocus())){
      surf.focus({ preventScroll:true });
      placeScratchCaretAtEnd(surf);
    }
    // which page you're on is persisted, so reopening lands where you left off — that's a real
    // state change and is saved like any other
    setScratchStatus('dirty');
    debouncedSaveScratch();
  }
  function scratchStep(delta){ scratchGoTo(scratchActiveIndex() + delta); }

  // Called after the dot row rebuilds itself and destroys the button that was clicked. On a
  // hardware keyboard that would otherwise strand focus on <body>; on touch there is nothing to
  // strand and grabbing focus would only raise the keyboard for a tidy-up action nobody typed into.
  function focusScratchSurface(){
    const surf = el('scratchText');
    if(surf && (scratchWantsAutoFocus() || document.activeElement === surf)) surf.focus({ preventScroll:true });
  }

  function animateScratchPage(dir){
    const surf = el('scratchText');
    if(!surf) return;
    surf.classList.remove('slide-l', 'slide-r');
    void surf.offsetWidth; // force a reflow so the animation restarts on a rapid second switch
    surf.classList.add(dir > 0 ? 'slide-r' : 'slide-l');
  }

  function addScratchPage(){
    ensureScratchPages();
    commitScratchSurface();
    const page = makeScratchPage();
    state.scratch.pages.push(page);
    state.scratch.activeId = page.id;
    state.scratch.updatedAt = Date.now();
    syncScratchSurface(true);
    renderScratchPages();
    updateScratchFooter();
    animateScratchPage(1);
    playScratchPageTick(1);
    setScratchStatus('dirty');
    // Deliberately unconditional, unlike every other focus in this file: asking for a BLANK page is
    // an explicit "I want to write something", so raising the keyboard is the expected answer even
    // on touch. Navigating to a page you already have is not the same act.
    const surf = el('scratchText');
    if(surf) surf.focus({ preventScroll:true });
    debouncedSaveScratch();
  }

  function deleteScratchPage(){
    ensureScratchPages();
    const pages = state.scratch.pages;
    if(pages.length < 2) return; // there is always a page to write on
    commitScratchSurface();
    const i = scratchActiveIndex();
    // Only ask when there's something to lose. A blank page is swept without ceremony.
    if(!scratchPageIsEmpty(pages[i]) && !window.confirm('Delete this page? What’s on it will be gone.')) return;
    pages.splice(i, 1);
    state.scratch.activeId = pages[Math.min(i, pages.length - 1)].id;
    state.scratch.updatedAt = Date.now();
    syncScratchSurface(true);
    renderScratchPages();
    updateScratchFooter();
    sweepDeletedScratchImages(); // a deleted page is confirmed and unundoable — reclaim now
    focusScratchSurface(); // the - button that was clicked no longer exists; don't strand focus
    setScratchStatus('dirty');
    debouncedSaveScratch();
  }

  /* Blank pages at the END of the stack are swept on the way out, so idly paging past the last one
     doesn't leave a pile of empties behind. Only TRAILING ones, and never the final remaining page:
     a blank page in the MIDDLE was put there deliberately and is left alone. If you're standing on
     one when you close, the cursor steps back a page rather than the sweep skipping it. */
  function sweepTrailingEmptyScratchPages(){
    ensureScratchPages();
    const pages = state.scratch.pages;
    let changed = false;
    while(pages.length > 1 && scratchPageIsEmpty(pages[pages.length - 1])){
      if(pages[pages.length - 1].id === state.scratch.activeId) state.scratch.activeId = pages[pages.length - 2].id;
      pages.pop();
      changed = true;
    }
    if(changed) ensureScratchPages();
    return changed;
  }

  function renderScratchPages(){
    const row = el('scratchPages');
    if(!row) return;
    ensureScratchPages();
    const pages = state.scratch.pages;
    const active = scratchActiveIndex();
    let h = '';
    for(let i=0; i<pages.length; i++){
      const label = scratchPageTitle(pages[i]);
      h += '<button type="button" class="scratch-dot' + (i === active ? ' is-active' : '') + (pages[i].id === scratchDragId ? ' is-dragging' : '') + '" data-i="' + i + '"'
         + ' title="' + escapeHtml(label) + '"'
         + ' aria-label="Page ' + (i + 1) + ' of ' + pages.length + ': ' + escapeHtml(label) + '"'
         + (i === active ? ' aria-current="true"' : '') + '></button>';
    }
    // + and − rather than a word: they pair obviously, and the page's own name lives on its dot
    h += '<button type="button" class="scratch-pagebtn" id="scratchAddPage" title="New page" aria-label="New page">+</button>';
    if(pages.length > 1) h += '<button type="button" class="scratch-pagebtn" id="scratchDelPage" title="Delete this page" aria-label="Delete this page">−</button>';
    // A page-turn sound you can't silence would be a menace in a room with other people, so it gets
    // a switch — here rather than in Settings, which would give the easter egg a visible entry.
    const muted = !!state.scratch.mute;
    h += '<button type="button" class="scratch-pagebtn scratch-mute' + (muted ? ' is-off' : '') + '" id="scratchMuteBtn"'
       + ' title="' + (muted ? 'Page-turn sound off' : 'Page-turn sound on') + '"'
       + ' aria-pressed="' + (muted ? 'true' : 'false') + '" aria-label="Toggle page-turn sound">♪</button>';
    row.innerHTML = h;
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
    const surf = el('scratchText');
    if(!surf) return;
    /* execCommand inserts at the current selection — but only when that selection is genuinely
       inside THIS editable. When it isn't, browsers quietly append at the end of the element
       instead, which is how a tick ends up beside the last line rather than the one you're on.
       Put the caret somewhere real before asking. */
    const sel0 = window.getSelection();
    if(!(sel0 && sel0.rangeCount && surf.contains(sel0.getRangeAt(0).commonAncestorContainer))){
      surf.focus({ preventScroll:true });
      placeScratchCaretAtEnd(surf);
    }
    const marker = 'sc' + uid();
    scratchExec('insertHTML', '<span id="' + marker + '"></span>');
    const slot = document.getElementById(marker);
    if(!slot) return;
    const box = makeScratchTick(done);
    // a non-breaking space: a plain trailing space collapses at the end of a line, leaving the
    // caret jammed against the box with no gap to type into
    const sp = document.createTextNode('\u00A0');
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
    const before = node.nodeValue.slice(0, off);
    const m = /\[( |x|X)?\]$/.exec(before);
    if(!m) return false;
    // Only at the start of a line: nothing but whitespace between the line break and the bracket,
    // so "see [x]" mid-sentence is left alone.
    if(!/(?:^|\n)[ \t]*$/.test(before.slice(0, before.length - m[0].length))) return false;
    /* The bracket token is SELECTED and left in place for execCommand to replace, rather than
       being deleted first. Deleting it emptied the line's own text node, the browser then dropped
       that empty node, and the range was left pointing at something detached — so the selection
       was no longer inside the editable and execCommand fell back to appending at the very end of
       the page. That was the "tick lands next to the last line instead of the line I'm on" bug.
       Starting at the bracket rather than the line break also preserves any indentation. */
    const rr = document.createRange();
    rr.setStart(node, off - m[0].length);
    rr.setEnd(node, off);
    sel.removeAllRanges();
    sel.addRange(rr);
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
     base64. Two reasons, both hard rules here: CLAUDE.md's image convention, and the fact that the
     whole stack is re-uploaded on every debounce fire, so an inlined photo would be re-sent every
     1.5 seconds for as long as you kept typing.
     Note the deliberate gap: removing an image from a page does NOT delete it from Storage. In
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
      scratchKnownImages.add(url); // so pasting then deleting in one sitting still reclaims the file
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

  /* ---------- reclaiming deleted images ----------
     An image removed from a page gets its file removed from Storage too, so the bucket doesn't fill
     with things nothing points at any more.

     Free-form HTML gives no "this was removed" event, so this works by DIFFING: the set of image
     URLs across every page is captured when the pad loads, and on the way out anything that has
     since disappeared is deleted. Three details make that safe, and each is load-bearing:

       Across ALL pages, never per page. Cutting an image from one page and pasting it on another
       must not read as a deletion, and an image copied onto two pages must survive losing one.

       On CLOSE, not on edit. Deleting the instant an <img> vanishes would destroy the file on any
       Ctrl+Z, and on the gap between cutting and pasting. Waiting until the pad is closed means
       the state is re-checked once the dust has settled, and an undo inside the session simply
       puts the URL back before anything is compared.

       Newly uploaded URLs join the known set immediately, or pasting an image and then deleting it
       in the same sitting would leave the file behind: it was never in the baseline, so the diff
       would see nothing go missing.

     deleteStorageImage() (js/core.js) is already best-effort and already no-ops on anything that
     isn't a Storage URL, so data: fallbacks and foreign links pass straight through.

     Two limits worth knowing. An image cut, then closed, then pasted back on a later visit is gone
     — the clipboard is not readable, so nothing here can know it is still spoken for. And a backup
     restored from before a deletion will reference a file that no longer exists; the HTML comes
     back, the bytes do not. */
  let scratchKnownImages = new Set();

  function scratchImageUrls(){
    const set = new Set();
    const pages = (state.scratch && state.scratch.pages) || [];
    for(let i=0; i<pages.length; i++){
      const doc = new DOMParser().parseFromString('<body>' + (pages[i].html || '') + '</body>', 'text/html');
      const imgs = doc.querySelectorAll('img[src]');
      for(let k=0; k<imgs.length; k++) set.add(imgs[k].getAttribute('src'));
    }
    return set;
  }

  function noteScratchImages(){ scratchKnownImages = scratchImageUrls(); }

  function sweepDeletedScratchImages(){
    if(typeof deleteStorageImage !== 'function') return;
    const live = scratchImageUrls();
    const gone = [];
    scratchKnownImages.forEach(url => { if(!live.has(url)) gone.push(url); });
    scratchKnownImages = live; // the new baseline, so nothing is ever offered for deletion twice
    for(let i=0; i<gone.length; i++) deleteStorageImage(gone[i]);
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
       sidebar is still laid out underneath, merely covered — so it lands exactly over the real one
       at both breakpoints, with nothing hardcoded. The icon's own box and the name's font-size are
       copied too, because the mobile bar shrinks both on scroll (.sidebar.scrolled) and the copy
       has no such ancestor to inherit from. Must be read BEFORE lockPageScroll(), which sets
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
    syncScratchSurface(true);
    renderScratchPages();
    updateScratchFooter();
    lockPageScroll(); // js/goals.js — counted, iOS-safe; without it a swipe past the surface's own
                      // scroll end moves the page behind and you exit somewhere else entirely
    /* Touch devices are deliberately left unfocused — see scratchWantsAutoFocus(). Tap the writing
       area to start typing.
       Where focus IS taken it stays synchronous inside the click handler's call stack: awaiting
       anything, or deferring focus() into a setTimeout, drops out of the user-gesture window and
       the focus is refused. */
    const surf = el('scratchText');
    if(scratchWantsAutoFocus()){
      surf.focus({ preventScroll:true });
      placeScratchCaretAtEnd(surf);
    }
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
    commitScratchSurface();               // while scratchOpen is still true
    const swept = sweepTrailingEmptyScratchPages();
    sweepDeletedScratchImages();          // after the commit, so the last edit counts
    scratchOpen = false;
    scratchTabHeld = false; scratchTabUsed = false; scratchWheelAcc = 0; scratchWheelDir = 0; scratchWheelStepAt = 0;
    if(swept){
      // the sweep is a real edit, and there may be no pending timer to carry it
      state.scratch.updatedAt = Date.now();
      if(scratchSaveDebounceTimer){ clearTimeout(scratchSaveDebounceTimer); scratchSaveDebounceTimer = null; }
      saveScratch();
    } else {
      flushPendingScratchSave();
    }
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

  /* ---------- reordering ----------
     Drag a dot to move its page. The dots ARE the pages, so they're the honest handle; there is no
     separate list to open and nothing new on screen when you aren't reordering.

     Pointer events rather than HTML5 drag-and-drop (which notes.js uses): that API doesn't fire on
     touch at all, and this page is used on a phone. Pointer events cover mouse, touch and pen from
     one path.

     The subtle part is WHERE the pointer is captured. Capture goes on the ROW, not on the dot being
     dragged, because reordering re-renders the row's innerHTML on every crossing — capturing the
     dot would release the moment that node was replaced and the drag would die after one step. The
     row element itself survives every re-render, so the gesture doesn't. */
  let scratchDragId = null, scratchDragFrom = -1, scratchDragX = 0, scratchDragging = false;
  let scratchSuppressDotClick = false;

  function moveScratchPage(from, to){
    ensureScratchPages();
    const pages = state.scratch.pages;
    if(from === to || from < 0 || to < 0 || from >= pages.length || to >= pages.length) return false;
    pages.splice(to, 0, pages.splice(from, 1)[0]);
    // activeId is an id, not an index, so whichever page you were on is still the page you're on —
    // it simply sits somewhere else in the row now
    state.scratch.updatedAt = Date.now();
    return true;
  }

  // which slot the pointer is currently over, by dot centres in their CURRENT on-screen order
  function scratchDotIndexAt(x){
    const dots = el('scratchPages').querySelectorAll('.scratch-dot');
    for(let i=0; i<dots.length; i++){
      const r = dots[i].getBoundingClientRect();
      if(x < r.left + r.width / 2) return i;
    }
    return dots.length - 1;
  }

  el('scratchPages').addEventListener('pointerdown', e=>{
    const dot = e.target && e.target.closest && e.target.closest('.scratch-dot');
    if(!dot || state.scratch.pages.length < 2) return;
    scratchDragFrom = parseInt(dot.getAttribute('data-i'), 10);
    if(isNaN(scratchDragFrom)) return;
    scratchDragId = state.scratch.pages[scratchDragFrom].id;
    scratchDragX = e.clientX;
    scratchDragging = false; // not a drag until it actually travels — a tap must still select
    try{ el('scratchPages').setPointerCapture(e.pointerId); }catch(err){}
  });

  el('scratchPages').addEventListener('pointermove', e=>{
    if(!scratchDragId) return;
    // 6px of travel before this counts as a drag, so a slightly imprecise tap still just switches
    if(!scratchDragging && Math.abs(e.clientX - scratchDragX) < 6) return;
    if(!scratchDragging){
      scratchDragging = true;
      el('scratchPages').classList.add('is-reordering');
      renderScratchPages(); // paint the lifted dot
    }
    const to = scratchDotIndexAt(e.clientX);
    if(to !== scratchDragFrom && moveScratchPage(scratchDragFrom, to)){
      scratchDragFrom = to;
      renderScratchPages();
      playScratchPageTick(1); // one thock per slot crossed — the whole point is that it feels physical
    }
  });

  /* Both tapping a dot and finishing a drag are resolved HERE, on pointerup, rather than being
     left to the click event — because once a pointer is captured, a dot's click cannot be trusted
     to arrive at all:
       - capture retargets the follow-up click to the CAPTURING element (the row), so a handler
         looking for e.target.closest('.scratch-dot') finds nothing; and
       - a reorder re-renders the row, so the dot node that was pressed no longer exists by the
         time a click would be dispatched against it.
     Keyboard activation has no pointer sequence at all, so it never sets the suppress flag and
     still reaches the click handler below — which is what keeps the dots usable by keyboard. */
  function endScratchDrag(){
    if(!scratchDragId) return;
    const wasDragging = scratchDragging;
    const landedOn = scratchDragFrom;
    scratchDragId = null; scratchDragFrom = -1; scratchDragging = false;
    el('scratchPages').classList.remove('is-reordering');
    scratchSuppressDotClick = true; // stop any retargeted click from acting a second time
    setTimeout(()=>{ scratchSuppressDotClick = false; }, 0);
    if(wasDragging){
      renderScratchPages();
      focusScratchSurface();
      setScratchStatus('dirty');
      debouncedSaveScratch();
    } else {
      scratchGoTo(landedOn); // a tap, not a drag: just go to that page (it re-renders itself)
    }
  }
  el('scratchPages').addEventListener('pointerup', endScratchDrag);
  el('scratchPages').addEventListener('pointercancel', endScratchDrag);

  el('scratchPages').addEventListener('click', e=>{
    if(scratchSuppressDotClick) return; // that click was the tail of a reorder, not a choice
    const t = e.target;
    if(!t || !t.closest) return;
    if(t.closest('#scratchAddPage')){ addScratchPage(); return; }
    if(t.closest('#scratchDelPage')){ deleteScratchPage(); return; }
    if(t.closest('#scratchMuteBtn')){
      state.scratch.mute = !state.scratch.mute;
      renderScratchPages();
      if(!state.scratch.mute) playScratchPageTick(1); // let you hear what you just switched back on
      // renderScratchPages() just replaced the button that was clicked, so focus would otherwise
      // fall to <body> and the next thing typed would go nowhere
      focusScratchSurface();
      setScratchStatus('dirty');
      debouncedSaveScratch();
      return;
    }
    // Reached only by keyboard (Enter/Space on a focused dot). Pointer taps are handled in
    // endScratchDrag() above and suppressed here — see the note on that function.
    const dot = t.closest('.scratch-dot');
    if(dot) scratchGoTo(parseInt(dot.getAttribute('data-i'), 10) || 0);
  });

  /* ---------- surface wiring ---------- */

  const scratchSurface = el('scratchText');

  scratchSurface.addEventListener('input', onScratchInput);

  // The single place a tickbox's attribute is brought back in line with its live checkedness.
  function syncScratchTick(box){
    if(box.checked) box.setAttribute('checked', ''); else box.removeAttribute('checked');
    onScratchInput();
  }
  /* Belt and braces alongside the click handler below: 'change' fires once checkedness has
     settled, and covers any route to a toggle that isn't a plain click (a keyboard space on a
     focused box, or a browser that resolves activation later than the click event). Running both
     is harmless — syncScratchTick is idempotent and the save behind it is debounced. */
  scratchSurface.addEventListener('change', e=>{
    const box = e.target && e.target.closest && e.target.closest(SCRATCH_TICK_SEL);
    if(box) syncScratchTick(box);
  });

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
      /* Let the browser's own activation do the toggling, and mirror the result into the
         ATTRIBUTE — which is the only half of a checkbox that innerHTML serializes, so without
         this the tick would look right until the next reload and then come back empty.

         Deliberately NOT preventDefault(): checkedness is set by the pre-click activation steps
         BEFORE this event is dispatched, and cancelling the event makes the browser REVERT it once
         the handler returns. That undid the visible tick while leaving the attribute set, which is
         why a click appeared to do nothing until you changed page and it re-rendered from state. */
      syncScratchTick(box);
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

  /* ---------- swipe (touch) ----------
     Deliberately strict: a horizontal run of 60px that is also more than twice the vertical drift,
     from a single finger, ending with nothing selected. The surface is an editable, scrollable
     field, so a loose threshold would turn an ordinary scroll — or a drag to select a word — into a
     page change, and losing your place mid-sentence is a far worse failure than a swipe not taking.
     Listeners are passive and never preventDefault, so normal vertical scrolling is untouched. */
  let scratchTouchX = 0, scratchTouchY = 0, scratchTouchOn = false;
  scratchSurface.addEventListener('touchstart', e=>{
    if(!e.touches || e.touches.length !== 1){ scratchTouchOn = false; return; }
    scratchTouchOn = true;
    scratchTouchX = e.touches[0].clientX;
    scratchTouchY = e.touches[0].clientY;
  }, { passive:true });
  scratchSurface.addEventListener('touchend', e=>{
    if(!scratchTouchOn) return;
    scratchTouchOn = false;
    const t = e.changedTouches && e.changedTouches[0];
    if(!t) return;
    const dx = t.clientX - scratchTouchX, dy = t.clientY - scratchTouchY;
    if(Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2) return;
    const sel = window.getSelection();
    if(sel && !sel.isCollapsed) return; // that was a selection drag, not a swipe
    scratchStep(dx < 0 ? 1 : -1);       // swipe left = forward, like every pager
  }, { passive:true });

  /* ---------- Tab + scroll (desktop) ----------
     Hold Tab and scroll: up for the previous page, down for the next. Tab is normally a focus key,
     so it's swallowed while this page is open and only performs its usual focus move when RELEASED
     without having been used as a modifier — that way the chord exists without costing keyboard
     users the ability to reach the dots, which are real buttons and can be tabbed to and pressed.
     e.repeat is ignored so held-Tab autorepeat doesn't re-arm it every frame, and window blur
     clears the flag, or an alt-tab away would swallow the keyup and leave the modifier stuck down
     for good. */
  let scratchTabHeld = false, scratchTabUsed = false;
  let scratchWheelAt = 0, scratchWheelAcc = 0, scratchWheelDir = 0, scratchWheelStepAt = 0;

  el('scratchOverlay').addEventListener('keydown', e=>{
    if(e.key !== 'Tab') return;
    e.preventDefault();
    if(!e.repeat){ scratchTabHeld = true; scratchTabUsed = false; }
  });

  /* passive:false because this has to preventDefault — otherwise the surface scrolls under you
     while you're paging.

     THREE rules, because a wheel is asked three different questions and no single rule answers
     them all. Each was learned by getting it wrong:
       1. Any scroll at all turns one page IMMEDIATELY (`fresh`) — a small nudge has to feel alive.
       2. Past that, distance accumulates and every SCRATCH_WHEEL_STEP worth turns another, so a
          hard flick covers proportionally more ground.
       3. While the wheel is still moving, never go longer than SCRATCH_WHEEL_CADENCE without
          turning a page — a slow CONTINUOUS scroll satisfies neither 1 (the gesture never ends)
          nor 2 (it never covers the distance), and without this it goes dead mid-scroll.
     The history, so nobody collapses these back into one: a fixed cooldown after each step made a
     hard scroll move exactly one page, because everything in the next 220ms was thrown away. A pure
     distance threshold fixed that and killed gentle scrolls, which never reached it. Adding rule 1
     fixed single nudges but not sustained slow ones. Rule 3 is a FLOOR — it can only add a step
     that distance didn't already earn, never suppress one — which is exactly how it differs from
     the cooldown that started all this.
     deltaMode is normalised first: Firefox reports LINES, so a notch there is deltaY 3 rather than
     Chrome's 100, and a pixel assumption would make it take ~33 notches to move one page. A
     direction change or a pause resets the accumulator, so a new gesture never inherits leftovers
     from the last one and a flick back the other way responds on its first event. */
  const SCRATCH_WHEEL_STEP = 100;   // one mouse notch, in pixel mode
  const SCRATCH_WHEEL_GAP = 400;      // ms of stillness that ends a gesture
  const SCRATCH_WHEEL_CADENCE = 150;  // while scrolling continues, never go longer than this without moving
  el('scratchOverlay').addEventListener('wheel', e=>{
    if(!scratchTabHeld || !e.deltaY) return;
    e.preventDefault();
    scratchTabUsed = true;
    let d = e.deltaY;
    if(e.deltaMode === 1) d *= 40;        // lines -> px (Firefox sends 3 lines per notch)
    else if(e.deltaMode === 2) d *= 400;  // pages -> px
    const dir = d < 0 ? -1 : 1;           // up = back, down = forward
    const now = Date.now();
    /* The FIRST event of a gesture always moves exactly one page, however small it was. Gating the
       start behind a distance threshold is what made gentle scrolling feel dead — a short trackpad
       nudge never reached 100px and so did nothing at all. Responsiveness belongs at the START of
       a gesture; proportionality belongs to whatever follows it, which is what the accumulator
       below is for. */
    const fresh = (now - scratchWheelAt > SCRATCH_WHEEL_GAP) || dir !== scratchWheelDir;
    scratchWheelAt = now;
    scratchWheelDir = dir;
    let steps = 0;
    if(fresh){
      steps = 1;
      scratchWheelAcc = 0; // this event's distance is spent on that first page
    } else {
      scratchWheelAcc += Math.abs(d);
      // capped per EVENT only, so a sustained scroll keeps going across events — it just can't
      // teleport on one absurd delta from an accelerated wheel
      while(scratchWheelAcc >= SCRATCH_WHEEL_STEP && steps < 3){
        scratchWheelAcc -= SCRATCH_WHEEL_STEP;
        steps++;
      }
      /* Cadence floor. A slow, CONTINUOUS scroll never ends its gesture (events keep arriving
         inside the gap) and never covers much distance either, so both rules above sit silent and
         the page stops responding while your finger is still moving. This guarantees it keeps
         turning at a steady rate whenever the wheel is genuinely still in motion.
         Note this is a FLOOR, not the ceiling that the very first version used: it can only ADD a
         step that distance didn't already earn, never suppress one. A ceiling is what made hard
         scrolling dead; a floor is what keeps gentle scrolling alive. */
      if(!steps && now - scratchWheelStepAt >= SCRATCH_WHEEL_CADENCE){
        steps = 1;
        scratchWheelAcc = 0;
      }
    }
    if(steps) scratchWheelStepAt = now;
    // one jump rather than N, so a flick doesn't re-render every page it passes through
    if(steps) scratchGoTo(scratchActiveIndex() + dir * steps);
  }, { passive:false });

  el('scratchOverlay').addEventListener('keyup', e=>{
    if(e.key !== 'Tab') return;
    const used = scratchTabUsed;
    scratchTabHeld = false;
    scratchTabUsed = false;
    if(!used) moveScratchFocus(e.shiftKey); // nothing was scrolled: a plain Tab press, after all
  });

  window.addEventListener('blur', ()=>{ scratchTabHeld = false; scratchTabUsed = false; });

  // Wraps rather than escaping, so focus stays inside the takeover instead of walking into the
  // invisible tab behind it.
  function moveScratchFocus(back){
    const items = el('scratchOverlay').querySelectorAll('[contenteditable="true"], button, #scratchBrand');
    if(!items.length) return;
    let i = -1;
    for(let k=0; k<items.length; k++) if(items[k] === document.activeElement){ i = k; break; }
    const n = items.length;
    items[i < 0 ? 0 : ((i + (back ? -1 : 1)) + n) % n].focus();
  }
