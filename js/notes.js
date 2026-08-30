  /* ================= NOTES ================= */
  /* A Workflowy-style outliner: every note is one row, children indent under their parent.
     state.notes is a FLAT array (see js/core.js) — nesting is parentId, sibling order is the
     array's own order. That means a subtree move only ever relocates ONE record: its children
     keep pointing at it, so they follow automatically and never need to be adjacent in the array.

     The one thing to be careful about in here: the title is a live <input>, not a span that
     becomes one. Its 'input' handler must never re-render, or every keystroke would rebuild the
     field and throw the caret to the end. Re-render only on structural changes.

     Notes has its OWN storage resource, not the shared app-data blob — see the persistence block
     below for why. */

  let notesSearch = '';
  let notesTagFilter = ''; // '' = no tag filter; otherwise a lowercase tag name
  const notesBodyOpen = new Set(); // note ids whose body textarea is expanded (per page load)
  let draggedNoteId = null;
  // Browsers don't fire click after a completed drag, but a cancelled one can still land a stray
  // click on the row — which would silently collapse the note you just finished moving. Set on
  // dragend, cleared on the next tick, checked by the row's click-to-expand handler.
  let notesSuppressClick = false;

  const NOTE_DEPTH_CAP = 12;   // visual indent cap only — the data itself nests without limit
  const NOTE_MAX_DEPTH = 200;  // upward-walk iteration guard, so a cycle can't hang the render

  /* ---------- notes persistence ----------
     Notes has its own storage resource, decoupled from the shared app-data blob every other tab
     shares — the same split Jobs got, for a sharper version of the same reason. That blob is
     re-serialized and re-uploaded IN FULL on every save from ANY tab, and this tab is the app's
     worst case on both sides of that:
       - it's unbounded (free-text bodies, arbitrarily many notes), so leaving it in the blob would
         re-send the entire outline every time an unrelated habit got ticked; and
       - it debounce-saves on every keystroke, so writing one paragraph would repeatedly re-upload
         every goal, habit, finance record and Valorant store in the app.
     Split, a keystroke costs only the outline, and an unrelated edit costs nothing here at all.

     Supabase mode: a third row in the same app_data table, id='notes' — no schema or RLS change
     needed (the existing "anyone can read/write" policy covers any id, and the row is created by
     this file's own .upsert() on first save). Claude-storage mode: a third window.storage key.

     Mirrors persistence.js's save()/load() 1:1 rather than being a simplified "best effort"
     version, keeping the same safety properties: a loadedOk-style gate so a failed load can never
     trigger an overwrite, optimistic-concurrency conflict detection, an offline localStorage
     mirror, and a serialized save chain so overlapping saves can't race each other.
  ---------------------------------------- */
  const NOTES_STORAGE_KEY = 'app-data-notes';
  const NOTES_ROW_ID = 'notes';
  const OFFLINE_NOTES_CACHE_KEY = 'p25-offline-data-notes';
  let notesLoadedOk = false;
  let lastKnownNotesUpdatedAt = null;
  let notesConflictShown = false;

  // Hydration + lazy field defaults for note records. New fields on a note go HERE, not in
  // persistence.js:applyLoadedState() — same exception to the usual convention that Jobs has.
  function applyLoadedNotesState(parsed){
    state.notes = (parsed && parsed.notes) || [];
    state.notes.forEach(n=>{
      if(n.title === undefined) n.title = '';
      if(n.body === undefined) n.body = '';
      if(n.parentId === undefined) n.parentId = null;
      if(n.collapsed === undefined) n.collapsed = false;
      if(n.pinned === undefined) n.pinned = false;
      if(n.task === undefined) n.task = false;   // rendered as a checkbox instead of a bullet
      if(n.done === undefined) n.done = false;   // only meaningful while task is true
      if(n.createdAt === undefined) n.createdAt = Date.now();
      if(n.updatedAt === undefined) n.updatedAt = n.createdAt;
    });
    repairNoteTree();
  }

  /* The wire format drops every field that's sitting at its default, because applyLoadedNotesState
     above puts it straight back on the way in. An outliner is mostly short titles, so the fixed
     per-record key overhead is the bulk of the payload otherwise:
       {"id":"m4x2a","title":"Groceries","createdAt":1770000000000}                        ~60 B
       vs. the full record with body/parentId/collapsed/pinned/updatedAt spelled out      ~140 B
     Better than 2x off every upload AND every download, for one function. Nothing else may
     serialize state.notes — always go through this. */
  function serializeNotes(){
    return state.notes.map(n=>{
      const o = { id:n.id, createdAt:n.createdAt };
      if(n.title) o.title = n.title;
      if(n.body) o.body = n.body;
      if(n.parentId) o.parentId = n.parentId;
      if(n.collapsed) o.collapsed = true;
      if(n.pinned) o.pinned = true;
      if(n.task) o.task = true;
      if(n.done) o.done = true;
      if(n.updatedAt && n.updatedAt !== n.createdAt) o.updatedAt = n.updatedAt;
      return o;
    });
  }

  function cacheNotesStateLocally(){
    try{ localStorage.setItem(OFFLINE_NOTES_CACHE_KEY, JSON.stringify({ data: { notes: serializeNotes() }, cachedAt: Date.now(), updatedAt: lastKnownNotesUpdatedAt })); }
    catch(e){ /* private browsing / storage quota — best effort only */ }
  }
  function loadLocalNotesCache(){
    try{
      const raw = localStorage.getItem(OFFLINE_NOTES_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    }catch(e){ return null; }
  }
  // Deliberately leaves notesLoadedOk false when nothing is found, so saves stay blocked rather
  // than risking an empty overwrite of real remote data.
  function fallbackToLocalNotesCache(){
    const cached = loadLocalNotesCache();
    if(cached && cached.data){
      applyLoadedNotesState(cached.data);
      if(cached.updatedAt !== undefined) lastKnownNotesUpdatedAt = cached.updatedAt;
      notesLoadedOk = true;
      const when = cached.cachedAt ? new Date(cached.cachedAt).toLocaleString() : 'earlier';
      showNotesOfflineBanner('You’re offline — showing your last synced copy of your notes (from ' + escapeHtml(when) + '). '
        + 'Anything you change here is saved on this device and will sync once you’re back online.');
      return true;
    }
    showNotesOfflineBanner('Couldn’t load your notes just now, so this tab may be showing an empty or out-of-date outline. '
      + 'Your existing notes likely haven’t been lost — try reloading.');
    return false;
  }
  window.addEventListener('online', () => { if(notesLoadedOk) saveNotes(); });

  /* Notes-scoped banners, for the same reason Jobs has its own: the global #conflictBanner /
     #offlineBanner are wired to whole-page-reload semantics for the shared blob, which is the
     wrong response to a Notes-only conflict now that the two save independently. */
  function showNotesConflictBanner(){
    if(notesConflictShown) return;
    notesConflictShown = true;
    const b = el('notesConflictBanner');
    if(!b) return;
    b.style.display = 'flex';
    b.innerHTML = '<span>Another tab or device saved newer changes to your notes after this page loaded its copy. Your latest edit here was <b>not saved</b>, to avoid overwriting theirs.</span>'
      + '<button class="btn btn-sm btn-primary" id="notesConflictReloadBtn">Reload notes</button>'
      + '<button class="btn btn-sm btn-ghost" id="notesConflictForceBtn">Keep my changes (overwrite theirs)</button>';
    // An in-place re-fetch is enough (unlike the global banner's full page reload) precisely
    // because Notes is self-contained — nothing else on the page reads state.notes.
    el('notesConflictReloadBtn').addEventListener('click', async ()=>{
      await loadNotesData(null);
      hideNotesConflictBanner();
      renderNotes();
    });
    el('notesConflictForceBtn').addEventListener('click', async ()=>{ await saveNotes(true); });
  }
  function hideNotesConflictBanner(){
    if(!notesConflictShown) return;
    notesConflictShown = false;
    const b = el('notesConflictBanner');
    if(b) b.style.display = 'none';
  }
  function showNotesOfflineBanner(msg){
    const b = el('notesOfflineBanner');
    if(!b) return;
    b.style.display = 'flex';
    b.innerHTML = '<span>' + msg + '</span>';
  }
  function hideNotesOfflineBanner(){
    const b = el('notesOfflineBanner');
    if(b) b.style.display = 'none';
  }

  // Serialized like the shared save() for the same reason: two overlapping saves would both read
  // the same stale lastKnownNotesUpdatedAt and the second would falsely report a conflict.
  let notesSavePromise = Promise.resolve();
  function saveNotes(force){
    notesSavePromise = notesSavePromise.then(()=> doSaveNotes(force));
    return notesSavePromise;
  }
  async function doSaveNotes(force){
    // read-only session (js/pin.js) — see doSave() in js/persistence.js
    if(!appCanWrite()){ noteBlockedWrite(); return; }
    if(!notesLoadedOk) return; // never overwrite remote data before we've confirmed what it contains
    cacheNotesStateLocally();
    try{
      const payload = { notes: serializeNotes() };
      if(usingClaudeStorage){ await setWithRetry(NOTES_STORAGE_KEY, JSON.stringify(payload)); hideNotesOfflineBanner(); return; }
      if(!supa) return;
      const nowIso = new Date().toISOString();
      let data, error;
      if(lastKnownNotesUpdatedAt && !force){
        ({ data, error } = await supa.from('app_data')
          .update({ data: payload, updated_at: nowIso })
          .eq('id', NOTES_ROW_ID)
          .eq('updated_at', lastKnownNotesUpdatedAt)
          .select('updated_at'));
        if(error) throw error;
        if(!data || data.length === 0){ showNotesConflictBanner(); return; }
      } else {
        ({ data, error } = await supa.from('app_data')
          .upsert({ id: NOTES_ROW_ID, data: payload, updated_at: nowIso })
          .select('updated_at'));
        if(error) throw error;
      }
      lastKnownNotesUpdatedAt = (data && data[0] && data[0].updated_at) || nowIso;
      hideNotesConflictBanner();
      hideNotesOfflineBanner();
    }catch(e){
      console.error('notes save failed', e);
      showNotesOfflineBanner('Couldn’t reach the server to save your latest change — it’s saved on this device '
        + 'and will sync automatically once you’re back online.');
    }
  }

  /* Typing debounce. Longer than persistence.js's 700ms on purpose: that one covers short numeric
     fields, whereas a note body is written in continuous prose, and every fired timer is a full
     re-upload of the outline. 1.5s still feels instant (nothing in the UI waits on the write) and
     roughly halves the writes over a paragraph. Flushed on hide/unload so nothing is ever lost. */
  let notesSaveDebounceTimer = null;
  function debouncedSaveNotes(delay){
    clearTimeout(notesSaveDebounceTimer);
    notesSaveDebounceTimer = setTimeout(saveNotes, delay || 1500);
  }
  function flushPendingNotesSave(){
    if(notesSaveDebounceTimer){ clearTimeout(notesSaveDebounceTimer); notesSaveDebounceTimer = null; saveNotes(); }
  }
  window.addEventListener('beforeunload', flushPendingNotesSave);
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'hidden') flushPendingNotesSave(); });

  /* Loads the dedicated Notes resource.

     parsedMainState is the payload persistence.js:load() already parsed from the shared row this
     same boot (or null) — used only to recover a state.notes that an intermediate build wrote into
     the shared blob before this split existed. Notes shipped with the split, so for virtually
     everyone that array is absent and this is a plain "create it empty on first use". It's kept
     because doSave()'s destructure now strips `notes` from the shared row, and a jsonb write
     REPLACES the column — so any such copy is destroyed by the next save from any tab, and this is
     the only chance to rescue it. Same ordering guarantee as Jobs: persistence.js awaits this
     before setting loadedOk = true, i.e. before that first stripping save can happen. */
  async function loadNotesData(parsedMainState){
    const legacyNotes = (parsedMainState && Array.isArray(parsedMainState.notes)) ? parsedMainState.notes : null;
    try{
      if(usingClaudeStorage){
        try{
          const res = await getWithRetry(NOTES_STORAGE_KEY);
          if(res && res.value){
            applyLoadedNotesState(JSON.parse(res.value));
            notesLoadedOk = true;
          } else {
            await seedOrInitNotesState(legacyNotes);
          }
          cacheNotesStateLocally();
          hideNotesOfflineBanner();
        }catch(e){
          const msg = (e && e.message) || String(e);
          if(/not found|no such key|does not exist/i.test(msg)){
            await seedOrInitNotesState(legacyNotes);
            cacheNotesStateLocally();
            hideNotesOfflineBanner();
          } else {
            console.error('notes load failed', e);
            fallbackToLocalNotesCache();
          }
        }
      } else {
        if(!supa) return; // Supabase unconfigured — persistence.js already surfaced the setup banner
        const { data, error } = await supa.from('app_data').select('data, updated_at').eq('id', NOTES_ROW_ID).maybeSingle();
        if(error){
          console.error('notes load failed', error);
          fallbackToLocalNotesCache();
        } else if(data){
          // The resource EXISTS (even if it holds an empty list) — it is the sole source of truth
          // from here on. Never re-seed over it from a legacy copy: that would resurrect notes the
          // user has since deleted.
          applyLoadedNotesState(data.data);
          lastKnownNotesUpdatedAt = data.updated_at;
          notesLoadedOk = true;
          cacheNotesStateLocally();
          hideNotesOfflineBanner();
        } else {
          await seedOrInitNotesState(legacyNotes);
          cacheNotesStateLocally();
          hideNotesOfflineBanner();
        }
      }
    }catch(e){
      // A Notes-only failure must never propagate into persistence.js:load() and abort the whole
      // app's boot, which would strand every other tab behind the load screen.
      console.error('notes load failed (unexpected)', e);
      fallbackToLocalNotesCache();
    }
  }

  // Only reached once the dedicated resource is positively confirmed absent.
  async function seedOrInitNotesState(legacyNotes){
    applyLoadedNotesState({ notes: legacyNotes && legacyNotes.length ? legacyNotes : [] });
    // Unlocking the save gate here is correct and required: we've just positively established what
    // the remote holds (nothing), which is exactly what this flag means — same reasoning as the
    // shared blob's "key not found on first run => loadedOk = true" path. Without it the seed write
    // below would silently no-op and leave the rescued data unpersisted.
    notesLoadedOk = true;
    if(!(legacyNotes && legacyNotes.length)) return; // nothing to protect yet; the row is created on first edit
    // force=true => unconditional upsert, for the same reason Jobs does it here.
    await saveNotes(true);
  }

  /* ---------- tree helpers ---------- */

  const findNote = id => state.notes.find(n => n.id === id);
  const childrenOf = parentId => state.notes.filter(n => n.parentId === parentId);

  // "Nothing was entered" — a note with no title, no body and no children. Such a note is never
  // kept: it's discarded as soon as focus leaves it (see the blur handler in renderNotes), and
  // Enter refuses to spawn a second one below it. Children and a body both count as content on
  // purpose, so an empty *heading* holding a subtree is never swept away with its notes inside it.
  const noteIsEmpty = n => !n.title.trim() && !n.body.trim() && childrenOf(n.id).length === 0;

  // every id below `id`. Iterative worklist rather than recursion — the tree is user-built and
  // uncapped, and this same function is what guards against cycles, so it can't assume a shape.
  function descendantIds(id){
    const out = new Set();
    const stack = childrenOf(id).map(c => c.id);
    while(stack.length){
      const cur = stack.pop();
      if(out.has(cur)) continue; // already-seen guard: a repaired tree has no cycles, but a
      out.add(cur);              // mid-drag call shouldn't be able to spin forever regardless
      childrenOf(cur).forEach(c => stack.push(c.id));
    }
    return out;
  }

  function noteDepth(n){
    let d = 0, cur = n;
    while(cur && cur.parentId && d < NOTE_MAX_DEPTH){ cur = findNote(cur.parentId); d++; }
    return d;
  }

  // Re-roots any note whose parentId dangles (target deleted by older code, a bad restore) or
  // sits in a cycle. Without this a single bad parentId makes those notes unreachable by the
  // render walk — they'd still be in state and still be saved, just invisible forever.
  // Cheap and idempotent, so renderNotes() calls it every time rather than relying on load order.
  function repairNoteTree(){
    if(!Array.isArray(state.notes)) state.notes = [];
    const ids = new Set(state.notes.map(n => n.id));
    state.notes.forEach(n=>{
      if(n.parentId && !ids.has(n.parentId)) n.parentId = null;
    });
    state.notes.forEach(n=>{
      let cur = n, steps = 0;
      while(cur && cur.parentId){
        cur = findNote(cur.parentId);
        if(++steps > NOTE_MAX_DEPTH){ n.parentId = null; break; } // never reached a root => cycle
      }
    });
  }

  // The render list, in display order: an iterative depth-first walk over an explicit stack
  // (deep trees can't blow the JS call stack this way). Children of a collapsed note are skipped.
  function visibleNotes(){
    const out = [];
    const stack = childrenOf(null).slice().reverse().map(n => ({note:n, depth:0}));
    while(stack.length){
      const cur = stack.pop();
      out.push(cur);
      if(cur.note.collapsed) continue;
      const kids = childrenOf(cur.note.id);
      for(let i = kids.length - 1; i >= 0; i--) stack.push({note:kids[i], depth:cur.depth + 1});
    }
    return out;
  }

  // Titles carry their #tags inline, so this already matches on tag text too — typing "#work"
  // in the search box finds the same notes the #work tag button does.
  const noteMatchesSearch = (n, q) =>
    n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q);

  // Filtered result set = the matches PLUS every ancestor of a match, so a deep hit still renders
  // with the path that leads to it instead of floating context-free. Collapse flags are ignored
  // while filtering (a match inside a collapsed branch must still be reachable), and ancestors
  // that didn't match themselves are dimmed via .notes-row-ctx.
  // `pred` is what makes this serve both the search box and the tag bar — and both at once, since
  // renderNotes() ANDs them together before calling.
  function filterVisibleNotes(pred){
    const keep = new Set(), matched = new Set();
    state.notes.forEach(n=>{
      if(!pred(n)) return;
      matched.add(n.id);
      let cur = n, steps = 0;
      while(cur && steps++ < NOTE_MAX_DEPTH){ keep.add(cur.id); cur = cur.parentId ? findNote(cur.parentId) : null; }
    });
    const out = [];
    const stack = childrenOf(null).slice().reverse().map(n => ({note:n, depth:0}));
    while(stack.length){
      const cur = stack.pop();
      if(keep.has(cur.note.id)) out.push({note:cur.note, depth:cur.depth, ctx:!matched.has(cur.note.id)});
      const kids = childrenOf(cur.note.id);
      for(let i = kids.length - 1; i >= 0; i--) stack.push({note:kids[i], depth:cur.depth + 1});
    }
    return out;
  }

  // Wraps every occurrence of the query in <mark>. Splits the RAW string first and escapes each
  // fragment separately — escaping first and then searching would mangle titles containing & or <.
  function highlightNoteMatch(text, q){
    if(!q) return escapeHtml(text);
    const lower = text.toLowerCase();
    let out = '', from = 0, at = lower.indexOf(q);
    while(at !== -1){
      out += escapeHtml(text.slice(from, at)) + '<mark>' + escapeHtml(text.slice(at, at + q.length)) + '</mark>';
      from = at + q.length;
      at = lower.indexOf(q, from);
    }
    return out + escapeHtml(text.slice(from));
  }

  // The display form of a title: #tags become chips, the search term stays highlighted. Built by
  // splitting on tag positions and running the plain segments through highlightNoteMatch(), so
  // every fragment is still escaped exactly once and the two decorations can't corrupt each other.
  function decorateNoteTitle(text, q){
    let out = '', last = 0, m;
    NOTE_TAG_RE.lastIndex = 0;
    while((m = NOTE_TAG_RE.exec(text)) !== null){
      const tagStart = m.index + m[1].length; // skip the leading space the regex had to capture
      out += highlightNoteMatch(text.slice(last, tagStart), q);
      out += '<span class="notes-tag" data-tag="' + escapeHtml(m[2].toLowerCase()) + '">#' + escapeHtml(m[2]) + '</span>';
      last = tagStart + m[2].length + 1;
    }
    return out + highlightNoteMatch(text.slice(last), q);
  }

  /* ---------- checkbox tasks ---------- */

  // done/total across a note's DIRECT task children. Returns null when it has none, so a plain
  // outline never sprouts progress chips it didn't ask for.
  function taskProgress(id){
    const tasks = childrenOf(id).filter(c => c.task);
    if(!tasks.length) return null;
    return { done: tasks.filter(c => c.done).length, total: tasks.length };
  }

  /* ---------- mutations ----------
     One implementation each, shared by the keyboard handler, the mobile move buttons and
     drag-and-drop, so the three input paths can't drift apart. */

  // Inserts a new note after `afterId` among its siblings, or last if afterId is null. Array
  // position IS sibling order, so "after X" is literally indexOf(X)+1 — records belonging to
  // other parents may sit in between, but childrenOf() filters them out so order still holds.
  function addNote(parentId, afterId){
    const now = Date.now();
    const n = { id:uid(), title:'', body:'', parentId:parentId || null, collapsed:false, pinned:false, task:false, done:false, createdAt:now, updatedAt:now };
    const at = afterId ? state.notes.findIndex(x => x.id === afterId) : -1;
    if(at === -1) state.notes.push(n);
    else state.notes.splice(at + 1, 0, n);
    return n.id;
  }

  // The single move primitive. mode: 'before' | 'after' | 'child'.
  // Returns false (changing nothing) when the move would put a note inside its own subtree.
  function moveNote(id, mode, targetId){
    const n = findNote(id);
    if(!n) return false;
    const target = targetId ? findNote(targetId) : null;
    const newParentId = mode === 'child' ? (target ? target.id : null) : (target ? target.parentId : null);
    if(newParentId === id) return false;
    if(newParentId && descendantIds(id).has(newParentId)) return false; // cycle guard
    const from = state.notes.indexOf(n);
    if(from === -1) return false;
    state.notes.splice(from, 1);
    n.parentId = newParentId;
    n.updatedAt = Date.now();
    if(mode === 'child' || !target){
      state.notes.push(n); // last child of the new parent
      if(target) target.collapsed = false; // don't drop it into a closed branch
    } else {
      const at = state.notes.indexOf(target);
      state.notes.splice(mode === 'before' ? at : at + 1, 0, n);
    }
    return true;
  }

  // previous sibling becomes the new parent. First-of-its-level is a deliberate no-op, not an
  // error — Tab on the top row of a level should just do nothing.
  function indentNote(id){
    const n = findNote(id); if(!n) return false;
    const sibs = childrenOf(n.parentId);
    const i = sibs.findIndex(x => x.id === id);
    if(i <= 0) return false;
    const prev = sibs[i - 1];
    prev.collapsed = false;
    return moveNote(id, 'child', prev.id);
  }

  function outdentNote(id){
    const n = findNote(id); if(!n || !n.parentId) return false;
    return moveNote(id, 'after', n.parentId);
  }

  function moveNoteVert(id, dir){
    const n = findNote(id); if(!n) return false;
    const sibs = childrenOf(n.parentId);
    const i = sibs.findIndex(x => x.id === id);
    const j = i + dir;
    if(i === -1 || j < 0 || j >= sibs.length) return false;
    return moveNote(id, dir < 0 ? 'before' : 'after', sibs[j].id);
  }

  function deleteNote(id, skipConfirm){
    const n = findNote(id); if(!n) return;
    const desc = descendantIds(id);
    if(!skipConfirm){
      const label = n.title.trim() || 'this untitled note';
      const msg = desc.size
        ? 'Delete "' + label + '"? This also deletes its ' + desc.size + ' sub-note' + (desc.size === 1 ? '' : 's') + '. This can\'t be undone.'
        : 'Delete "' + label + '"? This can\'t be undone.';
      if(!window.confirm(msg)) return;
    }
    state.notes = state.notes.filter(x => x.id !== id && !desc.has(x.id));
    desc.forEach(d => notesBodyOpen.delete(d));
    notesBodyOpen.delete(id);
    saveNotes(); renderNotes();
  }

  // Opens/closes a note's body editor, focusing it with the caret at the end when it opens.
  // Shared by the ✎ button, the body preview line and the row click below, so all three behave
  // identically. Body-open state is per page load, not persisted, so there's nothing to save.
  function toggleNoteBody(id, forceOpen){
    if(!forceOpen && notesBodyOpen.has(id)) notesBodyOpen.delete(id);
    else notesBodyOpen.add(id);
    renderNotes();
    if(!notesBodyOpen.has(id)) return;
    const ta = el('notesTree').querySelector('.notes-row-body[data-note-id="' + id + '"] .notes-body');
    if(ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }

  // Collapsing hides a note's children AND its body — those are the two things a note can contain,
  // so one fold controls both. That also gives a childless note with a body something to collapse,
  // which is why clicking a row never needs to fall back to opening the editor.
  const noteCanCollapse = n => childrenOf(n.id).length > 0 || !!n.body.trim();

  // Clicking a row expands/collapses it. It must NEVER open the text editor as a side effect —
  // clicking the row is how you fold the outline, and only the title field itself (or the ✎ button)
  // means "I want to type here".
  function toggleNoteCollapsed(id){
    const n = findNote(id);
    if(!n || !noteCanCollapse(n)) return; // nothing to fold — do nothing rather than something surprising
    n.collapsed = !n.collapsed;
    if(n.collapsed) notesBodyOpen.delete(id); // folding away a body you were editing shouldn't leave it "open"
    saveNotes(); renderNotes();
  }

  /* ---------- tags ----------
     Tags are written inline as #tag in a note's title — no separate tag field, no tag-entry UI to
     learn, and nothing to keep in sync when a note is renamed. They're derived on read, which also
     means a tag disappears the moment its last use is edited away. */

  // Unicode-aware so #café and #日本語 work. The leading (^|\s) stops it matching a '#' mid-word
  // (a URL fragment, "C#") — the capture group is what gets used, not the whole match.
  const NOTE_TAG_RE = /(^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;

  function noteTags(n){
    const out = [];
    let m;
    NOTE_TAG_RE.lastIndex = 0; // shared /g regex — reset or a previous scan's index leaks in
    while((m = NOTE_TAG_RE.exec(n.title)) !== null){
      const t = m[2].toLowerCase();
      if(!out.includes(t)) out.push(t);
    }
    return out;
  }

  // Every distinct tag with a usage count, most-used first then alphabetical.
  function allNoteTags(){
    const counts = {};
    state.notes.forEach(n => noteTags(n).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b))
      .map(t => ({ tag: t, count: counts[t] }));
  }

  /* ---------- markdown ----------
     A deliberately small renderer for note bodies — the repo had none, and pulling one in would
     mean a bundler this project doesn't have. Covers what gets used in notes: headings, bold,
     italic, strikethrough, inline code, fenced code, links, bullet/numbered lists, quotes, rules.

     SECURITY: escapeHtml() runs FIRST, on the whole source, so nothing downstream can inject
     markup — every rule below operates on already-escaped text and emits only its own tags. Link
     hrefs are the one place user input reaches an attribute, so they're both quote-stripped and
     scheme-checked (a javascript: URL in [x](...) would otherwise be a live XSS). */
  const MD_SAFE_URL = /^(https?:\/\/|mailto:|\/|#)/i;

  function mdInline(s){
    return s
      .replace(/`([^`]+)`/g, (m, code) => '<code>' + code + '</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
        const clean = url.replace(/["'<>]/g, '');
        if(!MD_SAFE_URL.test(clean)) return m; // unknown scheme: leave it as literal text, don't link it
        return '<a href="' + clean + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
      });
  }

  function renderMarkdown(src){
    const lines = escapeHtml(src).split('\n');
    let out = '', inCode = false, listType = '', para = [];
    const closeList = () => { if(listType){ out += '</' + listType + '>'; listType = ''; } };
    const flushPara = () => { if(para.length){ out += '<p>' + mdInline(para.join('<br>')) + '</p>'; para = []; } };
    lines.forEach(raw=>{
      const line = raw.replace(/\s+$/, '');
      if(/^```/.test(line.trim())){
        flushPara(); closeList();
        out += inCode ? '</code></pre>' : '<pre><code>';
        inCode = !inCode;
        return;
      }
      if(inCode){ out += line + '\n'; return; }
      if(!line.trim()){ flushPara(); closeList(); return; }
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if(h){ flushPara(); closeList(); const lv = h[1].length + 2; out += '<h' + lv + '>' + mdInline(h[2]) + '</h' + lv + '>'; return; }
      if(/^(---+|\*\*\*+)$/.test(line.trim())){ flushPara(); closeList(); out += '<hr>'; return; }
      const q = line.match(/^&gt;\s?(.*)$/); // '>' was escaped to &gt; above
      if(q){ flushPara(); closeList(); out += '<blockquote>' + mdInline(q[1]) + '</blockquote>'; return; }
      const ul = line.match(/^\s*[-*+]\s+(.*)$/);
      const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if(ul || ol){
        flushPara();
        const want = ul ? 'ul' : 'ol';
        if(listType !== want){ closeList(); listType = want; out += '<' + want + '>'; }
        out += '<li>' + mdInline((ul || ol)[1]) + '</li>';
        return;
      }
      para.push(line);
    });
    flushPara(); closeList();
    if(inCode) out += '</code></pre>'; // unterminated fence — close it rather than emit broken HTML
    return out;
  }

  // The one-line summary shown next to a collapsed note: markdown stripped back to bare text.
  function mdPlain(src){
    return src.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_~`\-]+/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
  }

  /* ---------- render ---------- */

  // Structural changes rebuild the whole tree, which throws away whatever input had focus.
  // Same fix as the checklist add-item row: re-find the row by id afterwards and refocus it.
  function focusNoteTitle(id, toEnd){
    const fresh = el('notesTree').querySelector('.notes-row[data-note-id="' + id + '"] .notes-title-input');
    if(!fresh) return;
    fresh.focus();
    if(toEnd) fresh.setSelectionRange(fresh.value.length, fresh.value.length);
  }

  function renderNotesPinned(){
    const wrap = el('notesPinned');
    const pinned = state.notes.filter(n => n.pinned);
    if(!pinned.length){ wrap.style.display = 'none'; wrap.innerHTML = ''; return; }
    wrap.style.display = 'flex';
    wrap.innerHTML = '<span class="notes-pinned-lbl">Pinned</span>' + pinned.map(n =>
      '<span class="notes-pin-chip" data-note-id="' + n.id + '">'
      + '<span class="notes-pin-chip-text">' + escapeHtml(n.title.trim() || 'Untitled') + '</span>'
      + '<button class="notes-pin-chip-x" type="button" title="Unpin">×</button>'
      + '</span>').join('');
  }

  // The strip of every #tag in use. Hidden entirely when nobody has tagged anything, so an
  // untagged outline never pays for a feature it isn't using.
  function renderNoteTagBar(){
    const bar = el('notesTagBar');
    const tags = allNoteTags();
    // The ACTIVE tag is always listed, even when nothing carries it any more — retag or delete the
    // last note using a tag while filtered by it and the bar would otherwise drop the only control
    // that can switch the filter back off, leaving a permanently blank outline with no way out.
    if(notesTagFilter && !tags.some(t => t.tag === notesTagFilter)) tags.push({ tag: notesTagFilter, count: 0 });
    if(!tags.length){ bar.style.display = 'none'; bar.innerHTML = ''; return; }
    bar.style.display = 'flex';
    bar.innerHTML = '<span class="notes-pinned-lbl">Tags</span>' + tags.map(t =>
      '<button class="notes-tag-btn' + (notesTagFilter === t.tag ? ' active' : '') + (t.count ? '' : ' empty') + '" type="button" data-tag="' + escapeHtml(t.tag) + '" title="' + (t.count ? 'Filter by this tag' : 'No notes use this tag any more — click to clear') + '">'
      + '#' + escapeHtml(t.tag) + '<span class="notes-tag-count">' + t.count + '</span></button>').join('');
  }

  // The one control that always gets you back to the whole outline, whatever combination of search
  // and tag filter got you to an empty screen.
  function clearNoteFilters(){
    notesSearch = '';
    notesTagFilter = '';
    el('notesSearchInput').value = '';
    el('notesSearchClear').style.display = 'none';
    renderNotes();
  }

  function setNoteTagFilter(tag){
    notesTagFilter = tag || '';
    renderNotes();
  }

  function renderNotes(){
    repairNoteTree();
    const tree = el('notesTree');
    if(!tree) return;
    const q = notesSearch.trim().toLowerCase();
    const tag = notesTagFilter;
    const filtering = !!(q || tag);
    const rows = filtering
      ? filterVisibleNotes(n => (!q || noteMatchesSearch(n, q)) && (!tag || noteTags(n).includes(tag)))
      : visibleNotes();

    renderNotesPinned();
    renderNoteTagBar();
    el('notesCount').textContent = state.notes.length + (state.notes.length === 1 ? ' note' : ' notes');
    el('notesEmpty').style.display = state.notes.length === 0 ? 'block' : 'none';
    el('notesNoMatch').style.display = (state.notes.length > 0 && rows.length === 0) ? 'block' : 'none';

    tree.innerHTML = '';
    rows.forEach(({note:n, depth, ctx})=>{
      const kids = childrenOf(n.id);
      const sibs = childrenOf(n.parentId);
      const sibIdx = sibs.findIndex(x => x.id === n.id);
      const row = document.createElement('div');
      row.className = 'notes-row' + (ctx ? ' notes-row-ctx' : '');
      row.dataset.noteId = n.id;
      row.style.setProperty('--depth', Math.min(depth, NOTE_DEPTH_CAP));
      // The row IS the drag source — no handle. Everything except the text field and the buttons
      // is a grab zone (the bullet, the chevron, the indent gutter, the row's own padding), and
      // draggable="false" on the input below is what keeps click-and-drag inside it selecting text
      // instead of picking the row up: the browser walks UP from the event target looking for the
      // nearest draggable="true", and an explicit false stops that walk. The dragstart handler
      // guards the same boundary again for the buttons.
      row.draggable = true;
      const bodyOpen = notesBodyOpen.has(n.id);
      const canFold = noteCanCollapse(n);
      const prog = taskProgress(n.id);
      if(n.task) row.classList.add('is-task');
      if(n.task && n.done) row.classList.add('is-done');
      row.innerHTML =
          (canFold
            ? '<button class="notes-chevron" type="button" data-act="collapse" title="' + (n.collapsed ? 'Expand' : 'Collapse') + '">' + (n.collapsed ? '▶' : '▼') + '</button>'
            : '<span class="notes-chevron-spacer"></span>')
        + (n.task
            ? '<input class="notes-check" type="checkbox" draggable="false"' + (n.done ? ' checked' : '') + ' title="Done">'
            : '<span class="notes-bullet">•</span>')
        + '<span class="notes-title-wrap">'
        +   '<input class="notes-title-input" type="text" maxlength="200" draggable="false" placeholder="Untitled note">'
        // The overlay is what renders #tags as chips and highlights search hits. It sits on top of
        // the real input and is swapped out the moment the row is focused for editing, so the raw
        // text is always what you type into — see the .editing rules in styles.css.
        // one inner span on purpose: the outer is a flex box only to vertically centre, and giving
        // it a single child keeps the decorated text in a normal inline context — text nodes sitting
        // directly in a flex container become anonymous flex items, which mangles the spacing
        +   '<span class="notes-title-hl"><span class="notes-title-hl-in">' + decorateNoteTitle(n.title, q) + '</span></span>'
        + '</span>'
        + (kids.length && n.collapsed ? '<span class="chip notes-kid-chip">' + kids.length + '</span>' : '')
        + (prog ? '<span class="chip notes-prog-chip' + (prog.done === prog.total ? ' all-done' : '') + '">' + prog.done + '/' + prog.total + '</span>' : '')
        + '<span class="notes-actions">'
        +   '<div class="notes-move-btns">'
        +     '<button class="notes-move-btn" type="button" data-act="outdent" title="Outdent"' + (n.parentId ? '' : ' disabled') + '>◀</button>'
        +     '<button class="notes-move-btn" type="button" data-act="indent" title="Indent"' + (sibIdx > 0 ? '' : ' disabled') + '>▶</button>'
        +     '<button class="notes-move-btn" type="button" data-act="up" title="Move up"' + (sibIdx > 0 ? '' : ' disabled') + '>▲</button>'
        +     '<button class="notes-move-btn" type="button" data-act="down" title="Move down"' + (sibIdx < sibs.length - 1 ? '' : ' disabled') + '>▼</button>'
        +   '</div>'
        +   '<button class="notes-act-btn' + (n.task ? ' is-task' : '') + '" type="button" data-act="task" title="' + (n.task ? 'Back to a plain note' : 'Turn into a checkbox') + '">☑</button>'
        +   '<button class="notes-act-btn' + (n.body.trim() ? ' has-body' : '') + '" type="button" data-act="body" title="Note body — markdown (Shift+Enter)">✎</button>'
        +   '<button class="notes-act-btn" type="button" data-act="addchild" title="Add sub-note">+</button>'
        +   '<button class="notes-act-btn' + (n.pinned ? ' pinned' : '') + '" type="button" data-act="pin" title="' + (n.pinned ? 'Unpin' : 'Pin') + '">' + (n.pinned ? '★' : '☆') + '</button>'
        +   '<button class="notes-act-btn danger" type="button" data-act="del" title="Delete">✕</button>'
        + '</span>';

      const titleInput = row.querySelector('.notes-title-input');
      // Set as a PROPERTY, never interpolated into a value="…" attribute: escapeHtml() is a
      // textContent→innerHTML round-trip, which escapes & < > but NOT a double quote — a title
      // containing one would break straight out of the attribute. A property assignment needs no
      // escaping at all, and it also stops "&" rendering as "&amp;".
      titleInput.value = n.title;
      // NO renderNotes() in here — see the file header. Only the pinned strip needs refreshing,
      // and only when this note is actually in it.
      titleInput.addEventListener('input', ()=>{
        n.title = titleInput.value;
        n.updatedAt = Date.now();
        if(n.pinned) renderNotesPinned();
        debouncedSaveNotes();
      });
      titleInput.addEventListener('keydown', e => onNoteTitleKey(e, n, titleInput, rows));
      // Leaving a note you never typed anything into discards it, so an abandoned row never becomes
      // a permanent blank line. Deferred a tick because blur fires BEFORE the click that caused it:
      // clicking this row's own "+" or ✎ would otherwise delete the note out from under the handler
      // about to run. By the time this fires the click has been processed, so the re-checks below
      // see the real outcome — the note now has a child, or is already gone, or focus stayed here.
      titleInput.addEventListener('blur', ()=>{
        setTimeout(()=>{
          const still = findNote(n.id);
          if(!still || !noteIsEmpty(still)) return;
          const active = document.activeElement;
          if(active && active.closest && active.closest('.notes-row[data-note-id="' + n.id + '"]')) return;
          state.notes = state.notes.filter(x => x.id !== n.id);
          notesBodyOpen.delete(n.id);
          saveNotes(); renderNotes();
        }, 0);
      });
      // The row normally shows the decorated overlay (tag chips, search highlight); focusing swaps
      // it out for the raw input so what you edit is always the literal text, "#tag" markup and all.
      titleInput.addEventListener('focus', ()=> row.classList.add('editing'));
      titleInput.addEventListener('blur', ()=> row.classList.remove('editing'));

      const chev = row.querySelector('[data-act="collapse"]');
      if(chev) chev.addEventListener('click', ()=> toggleNoteCollapsed(n.id));

      const check = row.querySelector('.notes-check');
      if(check) check.addEventListener('change', ()=>{
        n.done = check.checked;
        n.updatedAt = Date.now();
        saveNotes(); renderNotes();
      });
      row.querySelector('[data-act="task"]').addEventListener('click', ()=>{
        n.task = !n.task;
        if(!n.task) n.done = false; // a plain note can't be "done" — don't leave the flag set to resurface later
        n.updatedAt = Date.now();
        saveNotes(); renderNotes();
      });
      // Clicking a #tag chip filters the outline to that tag. stopPropagation keeps it from also
      // reaching the row's collapse handler underneath.
      row.querySelectorAll('.notes-tag').forEach(chip=>{
        chip.addEventListener('click', e=>{
          // A chip sits inside the row, so it's a legitimate place to grab the row and drag from —
          // which means it inherits the stray-click-after-a-drag problem the row handler already
          // guards. Without this, moving a tagged note would silently switch the tag filter on and
          // the outline would appear to empty itself.
          if(notesSuppressClick) return;
          e.stopPropagation();
          setNoteTagFilter(notesTagFilter === chip.dataset.tag ? '' : chip.dataset.tag);
        });
      });

      row.querySelector('[data-act="body"]').addEventListener('click', ()=> toggleNoteBody(n.id));
      row.querySelector('[data-act="addchild"]').addEventListener('click', ()=>{
        n.collapsed = false;
        const kidsNow = childrenOf(n.id);
        const newId = addNote(n.id, kidsNow.length ? kidsNow[kidsNow.length - 1].id : n.id);
        saveNotes(); renderNotes(); focusNoteTitle(newId);
      });
      row.querySelector('[data-act="pin"]').addEventListener('click', ()=>{ n.pinned = !n.pinned; n.updatedAt = Date.now(); saveNotes(); renderNotes(); });
      row.querySelector('[data-act="del"]').addEventListener('click', ()=> deleteNote(n.id));
      row.querySelectorAll('.notes-move-btn').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          if(btn.disabled) return;
          const act = btn.dataset.act;
          const ok = act === 'indent' ? indentNote(n.id)
                   : act === 'outdent' ? outdentNote(n.id)
                   : moveNoteVert(n.id, act === 'up' ? -1 : 1);
          if(!ok) return;
          saveNotes(); renderNotes(); focusNoteTitle(n.id, true);
        });
      });

      // Click anywhere on the row that isn't the title text and it expands/collapses — and ONLY
      // that. It must never open the body editor as a fallback: clicking the row is how you fold
      // the outline, so having it sometimes drop you into a text field instead would mean the same
      // gesture does two unrelated things depending on whether the note happens to have children.
      // Typing is reached deliberately, via the title itself or the ✎ button.
      row.addEventListener('click', e=>{
        if(notesSuppressClick) return;
        if(e.target.closest('input, textarea, button, .notes-tag')) return;
        toggleNoteCollapsed(n.id);
      });

      tree.appendChild(row);

      // A body has two states: the raw textarea while you're writing, and rendered markdown the
      // rest of the time. Collapsing the note hides both — a fold covers everything the note
      // contains, children and body alike, which is what gives a childless note something to fold.
      if(bodyOpen && !n.collapsed){
        const bodyWrap = document.createElement('div');
        bodyWrap.className = 'notes-row-body';
        bodyWrap.dataset.noteId = n.id;
        bodyWrap.style.setProperty('--depth', Math.min(depth, NOTE_DEPTH_CAP));
        bodyWrap.innerHTML = '<textarea class="notes-body" rows="3" maxlength="5000" placeholder="Write something… **bold**, `code`, - lists, # headings"></textarea>'
          + '<div class="notes-body-hint">Markdown · Esc to finish</div>';
        const ta = bodyWrap.querySelector('.notes-body');
        ta.value = n.body;
        // same no-re-render rule as the title, plus grow-to-fit so long bodies don't need scrolling
        const autoGrow = ()=>{ ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
        ta.addEventListener('input', ()=>{ n.body = ta.value; n.updatedAt = Date.now(); autoGrow(); debouncedSaveNotes(); });
        ta.addEventListener('keydown', e=>{
          if(e.key === 'Escape'){ e.stopPropagation(); notesBodyOpen.delete(n.id); saveNotes(); renderNotes(); focusNoteTitle(n.id, true); }
        });
        tree.appendChild(bodyWrap);
        autoGrow();
      } else if(n.body.trim() && !n.collapsed){
        const md = document.createElement('div');
        md.className = 'notes-body-md';
        md.style.setProperty('--depth', Math.min(depth, NOTE_DEPTH_CAP));
        md.innerHTML = renderMarkdown(n.body);
        md.title = 'Click to edit';
        md.addEventListener('click', e=>{
          if(e.target.closest('a')) return; // following a link shouldn't drop you into the editor
          toggleNoteBody(n.id, true);
        });
        tree.appendChild(md);
      } else if(n.body.trim() && n.collapsed){
        // folded away, but say so — otherwise a collapsed note with only a body looks empty
        const prev = document.createElement('div');
        prev.className = 'notes-body-preview';
        prev.style.setProperty('--depth', Math.min(depth, NOTE_DEPTH_CAP));
        prev.textContent = mdPlain(n.body);
        prev.addEventListener('click', ()=> toggleNoteCollapsed(n.id));
        tree.appendChild(prev);
      }
    });
  }

  /* ---------- keyboard ---------- */

  function onNoteTitleKey(e, n, input, rows){
    if(e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      // Holding Enter on a blank row would otherwise stack up empty notes faster than the blur
      // cleanup can catch them (only the last one ever gets a blur). Refusing at the source means
      // there is never more than one empty note alive at a time.
      if(noteIsEmpty(n)) return;
      // a new sibling right below, even when this note has children — predictable, and Tab is
      // right there if the intent was a child
      const newId = addNote(n.parentId, n.id);
      saveNotes(); renderNotes(); focusNoteTitle(newId);
      return;
    }
    if(e.key === 'Enter' && e.shiftKey){
      e.preventDefault();
      toggleNoteBody(n.id, true); // forceOpen: Shift+Enter means "go write", never "close it again"
      return;
    }
    if(e.key === 'Tab'){
      e.preventDefault(); // even on a no-op — Tab must never jump focus out of the outliner
      const ok = e.shiftKey ? outdentNote(n.id) : indentNote(n.id);
      if(!ok) return;
      saveNotes(); renderNotes(); focusNoteTitle(n.id, true);
      return;
    }
    if(e.key === 'Backspace' && input.value === '' && !childrenOf(n.id).length){
      e.preventDefault();
      const idx = rows.findIndex(r => r.note.id === n.id);
      const prevId = idx > 0 ? rows[idx - 1].note.id : null;
      deleteNote(n.id, true); // no confirm: empty title, no children, nothing to lose
      if(prevId) focusNoteTitle(prevId, true);
      return;
    }
    if(e.key === 'ArrowUp' || e.key === 'ArrowDown'){
      const idx = rows.findIndex(r => r.note.id === n.id);
      const next = rows[idx + (e.key === 'ArrowUp' ? -1 : 1)];
      if(!next) return;
      e.preventDefault();
      focusNoteTitle(next.note.id, true);
      return;
    }
    if(e.key === 'Escape') input.blur();
  }

  /* ---------- drag to reorder + reparent (desktop) ----------
     Delegated on the stable #notesTree container rather than per-row, since every render throws
     the rows away — same pattern as checklists/finance/nav-tab reordering. Where in the row you
     drop decides what happens: top third = sibling before, bottom third = sibling after, middle =
     become a child. Dropping onto yourself or your own descendant is refused at hover time, so
     an illegal move is never even offered (moveNote()'s guard is the backstop). */

  function clearNoteDropMarks(){
    el('notesTree').querySelectorAll('.drop-before,.drop-after,.drop-into')
      .forEach(r => r.classList.remove('drop-before','drop-after','drop-into'));
  }

  function noteDropMode(row, clientY){
    const r = row.getBoundingClientRect();
    const rel = (clientY - r.top) / r.height;
    return rel < 0.3 ? 'before' : rel > 0.7 ? 'after' : 'child';
  }

  function wireNotesDrag(){
    const tree = el('notesTree');
    tree.addEventListener('dragstart', e=>{
      const row = e.target.closest('.notes-row');
      if(!row) return;
      // Never hijack a drag that began inside the text field or on a button — selecting a title
      // by dragging across it, and click-dragging off a button to cancel it, both have to keep
      // working. draggable="false" on the input already covers the common path; this is the
      // backstop, and the only thing covering the buttons.
      if(e.target.closest('input, textarea, button')){ e.preventDefault(); return; }
      draggedNoteId = row.dataset.noteId;
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    tree.addEventListener('dragover', e=>{
      if(!draggedNoteId) return;
      const row = e.target.closest('.notes-row');
      clearNoteDropMarks();
      if(!row) return;
      const overId = row.dataset.noteId;
      if(overId === draggedNoteId) return;
      if(descendantIds(draggedNoteId).has(overId)) return; // can't move a note into its own subtree
      e.preventDefault();
      row.classList.add('drop-' + noteDropMode(row, e.clientY));
    });
    tree.addEventListener('drop', e=>{
      if(!draggedNoteId) return;
      const row = e.target.closest('.notes-row');
      clearNoteDropMarks();
      const id = draggedNoteId; draggedNoteId = null;
      if(!row) return;
      e.preventDefault();
      const overId = row.dataset.noteId;
      if(overId === id || descendantIds(id).has(overId)) return;
      if(!moveNote(id, noteDropMode(row, e.clientY), overId)) return;
      saveNotes(); renderNotes();
    });
    tree.addEventListener('dragend', ()=>{
      draggedNoteId = null;
      notesSuppressClick = true;
      setTimeout(()=>{ notesSuppressClick = false; }, 0);
      clearNoteDropMarks();
      tree.querySelectorAll('.dragging').forEach(r => r.classList.remove('dragging'));
    });
  }

  /* ---------- top-level wiring ---------- */

  function addRootNote(){
    const input = el('newNoteInput');
    const v = input.value.trim();
    if(!v) return; // nothing typed, nothing created — same as every other add box in the app
    const newId = addNote(null, null);
    findNote(newId).title = v;
    input.value = '';
    saveNotes(); renderNotes(); focusNoteTitle(newId, true);
  }

  el('addNoteBtn').addEventListener('click', addRootNote);
  el('newNoteInput').addEventListener('keydown', e=>{ if(e.key === 'Enter') addRootNote(); });
  el('notesSearchInput').addEventListener('input', ()=>{
    notesSearch = el('notesSearchInput').value;
    el('notesSearchClear').style.display = notesSearch ? 'block' : 'none';
    renderNotes();
  });
  el('notesTagBar').addEventListener('click', e=>{
    const btn = e.target.closest('.notes-tag-btn');
    if(!btn) return;
    setNoteTagFilter(notesTagFilter === btn.dataset.tag ? '' : btn.dataset.tag); // click the active one to clear
  });
  el('notesClearFiltersBtn').addEventListener('click', clearNoteFilters);
  el('notesSearchClear').addEventListener('click', ()=>{
    notesSearch = '';
    el('notesSearchInput').value = '';
    el('notesSearchClear').style.display = 'none';
    renderNotes();
    el('notesSearchInput').focus();
  });
  el('notesExpandAllBtn').addEventListener('click', ()=>{
    const anyOpen = state.notes.some(n => !n.collapsed && childrenOf(n.id).length);
    state.notes.forEach(n=>{ if(childrenOf(n.id).length) n.collapsed = anyOpen; });
    saveNotes(); renderNotes();
  });
  el('notesPinned').addEventListener('click', e=>{
    const chip = e.target.closest('.notes-pin-chip');
    if(!chip) return;
    const n = findNote(chip.dataset.noteId);
    if(!n) return;
    if(e.target.closest('.notes-pin-chip-x')){ n.pinned = false; saveNotes(); renderNotes(); return; }
    // jumping to a pinned note is useless if an ancestor is collapsed or a search is hiding it
    if(notesSearch){ notesSearch = ''; el('notesSearchInput').value = ''; el('notesSearchClear').style.display = 'none'; }
    let cur = n, steps = 0;
    while(cur && cur.parentId && steps++ < NOTE_MAX_DEPTH){ cur = findNote(cur.parentId); if(cur) cur.collapsed = false; }
    saveNotes(); renderNotes();
    const row = el('notesTree').querySelector('.notes-row[data-note-id="' + n.id + '"]');
    if(row){
      row.scrollIntoView({behavior:'smooth', block:'center'});
      row.classList.add('flash');
      setTimeout(()=> row.classList.remove('flash'), 1200);
    }
  });
  wireNotesDrag();
