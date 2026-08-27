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
    B:1, STRONG:1, I:1, EM:1, U:1, S:1, STRIKE:1, DEL:1, CODE:1, SPAN:1, MARK:1, FONT:1,
    H1:1, H2:1, H3:1, A:1, IMG:1, INPUT:1
  };
  /* ---------- the style allowlist (what the format bar emits) ----------
     The format bar can colour, size and re-face text, so a style attribute and a <font> tag now
     have to survive the round trip — a real widening of what used to be "keep the tag, drop every
     attribute". It stays honest the same way everything else here does: nothing is FILTERED, it is
     REBUILT. safeScratchStyle() walks the parsed CSSOM declaration (already normalised, and
     already stripped of anything malformed, by the inert DOMParser document), keeps only the
     properties named below, and re-emits each one only if its value matches that property's own
     regex. Anything else — an unlisted property, a value with a stray character, a url(), an
     absurd font-size — is simply never written out.
     Every regex below is deliberately narrow enough that no value passing it can carry a "(", a
     ";" or a ":", which is what makes reassembling them into a style string safe. */
  const SCRATCH_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%\/]{1,40}\)|hsla?\([\d\s.,%\/a-z]{1,40}\)|[a-z]{3,20})$/i;
  const SCRATCH_FACE = /^[a-z0-9 ,'"\-]{1,80}$/i;
  const SCRATCH_STYLE_OK = {
    'color': SCRATCH_COLOR,
    'background-color': SCRATCH_COLOR,
    'font-family': SCRATCH_FACE,
    'font-size': /^(\d{1,3}(\.\d+)?px|xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|-webkit-xxx-large)$/i,
    'font-weight': /^(bold|bolder|normal|lighter|[1-9]00)$/i,
    'font-style': /^(italic|oblique|normal)$/i,
    'text-decoration': /^(none|((underline|line-through|overline)\s*){1,3})$/i,
    'text-decoration-line': /^(none|((underline|line-through|overline)\s*){1,3})$/i
  };
  // px sizes are CLAMPED as well as validated: a pasted 400px heading would blow the 70ch column
  // apart, and the format bar's own scale tops out well below this.
  const SCRATCH_MAX_PX = 72;
  /* A resized image stores its width as the <img width> ATTRIBUTE, not as inline CSS — the same
     call as <font size> over in the format bar, and for the same reason: one integer with one tiny
     regex beats trusting a CSS parser. Height is never written, because styles.css keeps
     height:auto on these, which is what preserves the aspect ratio for free. max-width:100% still
     clamps the DISPLAY on a narrow screen, so a width wider than the column is remembered rather
     than lost — resize on a laptop, open on a phone, and it is still right when you go back. */
  const SCRATCH_IMG_MIN = 40;
  const SCRATCH_IMG_MAX = 2000;
  /* ---------- free-floating images ----------
     A photo can be lifted OUT of the text flow and dropped anywhere on the sheet, overlapping the
     writing and overlapping other photos. That position rides on the image as three data
     attributes, for exactly the reason the width does: three small integers with three tiny
     regexes, checked here, beat widening the style allowlist with `position`/`left`/`top` — which
     would let anything arriving from the shared row absolutely position itself over the page.
     The attributes are the truth; the inline left/top/z-index the browser actually lays out from
     are written by layoutScratchFloats() and are deliberately NOT in SCRATCH_STYLE_OK, so they are
     stripped on the way out and re-derived on the way in. Presence of data-x IS what makes an
     image a float (the CSS selector is img[data-x]), so the two X/Y attributes are kept or dropped
     together — half a coordinate pair is not a position.

     x is a PERCENTAGE of the sheet's width and y is PIXELS from the top of the content, which is
     the same asymmetry the width attribute already commits to: the column is 70ch and reflows
     between a laptop and a phone, so a horizontal position has to scale with it, while the
     vertical one has to stay pinned to the paragraph it was put beside. */
  const SCRATCH_FLOAT_X = /^\d{1,3}(\.\d{1,2})?$/;   // 0–100, percent of the sheet width
  const SCRATCH_FLOAT_Y = /^\d{1,6}$/;                // px down the sheet
  const SCRATCH_FLOAT_Z = /^\d{1,3}$/;                // stacking order among the floats
  const SCRATCH_FLOAT_ZMAX = 999;

  function safeScratchStyle(node){
    const src = node.style;
    if(!src || !src.length) return '';
    const out = [];
    for(let i=0; i<src.length; i++){
      const prop = src[i];
      const re = SCRATCH_STYLE_OK[prop];
      if(!re) continue;
      const v = (src.getPropertyValue(prop) || '').trim();
      if(!v || v.length > 80 || !re.test(v)) continue;
      if(prop === 'font-size' && /px$/i.test(v)){
        const n = parseFloat(v);
        if(!(n >= 6) || n > SCRATCH_MAX_PX) continue;
      }
      out.push(prop + ':' + v);
    }
    return out.join(';');
  }
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

  // one rebuild path, two callers: the storage boundaries take the string, paste takes the
  // container so it can normalise whitespace before serialising (see below)
  function rebuildScratchHtml(html){
    const doc = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
    const out = document.createElement('div');
    cleanScratchInto(doc.body, out);
    return out;
  }

  function sanitizeScratchHtml(html){
    return rebuildScratchHtml(html).innerHTML;
  }

  /* PASTE ONLY, and the distinction is the whole point.

     .scratch-text is white-space:pre-wrap, because a napkin has to keep the runs of spaces and the
     blank lines you deliberately typed. The sanitizer re-creates every text node verbatim — it has
     to, that's what makes it a faithful rebuild — so pasted markup arrives carrying the newlines
     and indentation the source document was pretty-printed with. Normal HTML collapses that to
     nothing; pre-wrap renders every character of it. That is where a paste's "why is this pushed
     in from the edges" comes from: it isn't a margin, it is literal source indentation.

     So the collapsing browsers would have done anyway is applied HERE, on the way in, and nowhere
     else. Doing it inside sanitizeScratchHtml() would be a disaster: that runs on every load and
     every save, and it would quietly eat the user's OWN spacing on the round trip.

     Two things are deliberately left alone: <pre>, where whitespace is the content, and &nbsp;,
     which is a chosen character rather than formatting — which is also why insertScratchTick()
     writes one. */
  const SCRATCH_WS_BLOCK = /^(DIV|P|LI|UL|OL|BLOCKQUOTE|PRE|H1|H2|H3|BR|IMG)$/;

  function sanitizePastedScratchHtml(html){
    const out = rebuildScratchHtml(html);
    const walk = document.createTreeWalker(out, NodeFilter.SHOW_TEXT, null);
    const doomed = [];
    let n;
    while((n = walk.nextNode())){
      // inside <pre> the whitespace IS the content
      if(n.parentNode && n.parentNode.closest && n.parentNode.closest('pre')) continue;
      // note the character class: tab/newline/return/space, NOT \s — \s also matches U+00A0, and a
      // non-breaking space is a character somebody meant rather than layout to be tidied away
      let v = (n.nodeValue || '').replace(/[\t\n\r ]+/g, ' ');
      /* Whether this run sits against a LINE BOUNDARY, which is exactly where HTML drops a space
         and pre-wrap instead paints it as a one-character indent (or a trailing gap).
         The no-sibling case has to consult the PARENT rather than assume a boundary: the first text
         node of a <p> is at the start of a line, but the first text node of a <b> in the middle of
         a sentence is not, and eating that space would run two words together. */
      const prev = n.previousSibling, next = n.nextSibling, up = n.parentNode;
      const upBlock = !!(up && up.nodeType === 1 && SCRATCH_WS_BLOCK.test(up.tagName));
      const atStart = prev ? (prev.nodeType === 1 && SCRATCH_WS_BLOCK.test(prev.tagName)) : upBlock;
      const atEnd   = next ? (next.nodeType === 1 && SCRATCH_WS_BLOCK.test(next.tagName)) : upBlock;
      if(atStart) v = v.replace(/^ /, '');
      if(atEnd) v = v.replace(/ $/, '');
      if(v !== n.nodeValue) n.nodeValue = v;
      // all that was left of a run that was nothing but the pretty-printer's line break
      if(!v) doomed.push(n);
    }
    for(let i = 0; i < doomed.length; i++) if(doomed[i].parentNode) doomed[i].parentNode.removeChild(doomed[i]);
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
      /* <font> is the format bar's own output: styleWithCSS is held OFF (see the format bar
         section below), so size/face/colour arrive as these three attributes rather than as inline
         CSS. Each is re-validated on its own terms — size against the seven legacy buckets that
         styles.css restyles to this page's scale, face against the same charset a font-family
         value gets, colour against the shared colour regex. Nothing else on the element survives. */
      if(tag === 'FONT'){
        const fnt = document.createElement('font');
        const size = (node.getAttribute('size') || '').trim();
        if(/^[1-7]$/.test(size)) fnt.setAttribute('size', size);
        const col = (node.getAttribute('color') || '').trim();
        if(SCRATCH_COLOR.test(col)) fnt.setAttribute('color', col);
        const face = (node.getAttribute('face') || '').trim();
        if(SCRATCH_FACE.test(face)) fnt.setAttribute('face', face);
        const fcss = safeScratchStyle(node);
        if(fcss) fnt.setAttribute('style', fcss);
        cleanScratchInto(node, fnt);
        dest.appendChild(fnt);
        continue;
      }
      if(tag === 'IMG'){
        const src2 = (node.getAttribute('src') || '').replace(/[\s"']/g, '');
        if(!SCRATCH_SAFE_IMG.test(src2)) continue;
        const img = document.createElement('img');
        img.setAttribute('src', src2);
        const alt = node.getAttribute('alt');
        if(alt) img.setAttribute('alt', alt);
        const w = (node.getAttribute('width') || '').trim();
        if(/^\d{1,4}$/.test(w)){
          const n = parseInt(w, 10);
          if(n >= SCRATCH_IMG_MIN && n <= SCRATCH_IMG_MAX) img.setAttribute('width', String(n));
        }
        /* The float position. Both coordinates or neither: data-x alone is what the CSS keys off,
           so letting a valid x through beside a malformed y would take the image out of the flow
           and then pin it to the top of the sheet, which is worse than leaving it in the text. */
        const fx = (node.getAttribute('data-x') || '').trim();
        const fy = (node.getAttribute('data-y') || '').trim();
        if(SCRATCH_FLOAT_X.test(fx) && parseFloat(fx) <= 100 && SCRATCH_FLOAT_Y.test(fy)){
          img.setAttribute('data-x', fx);
          img.setAttribute('data-y', fy);
          const fz = (node.getAttribute('data-z') || '').trim();
          // z is optional and merely an ordering, so a bad one falls back to the bottom of the
          // stack rather than disqualifying the position
          if(SCRATCH_FLOAT_Z.test(fz) && parseInt(fz, 10) <= SCRATCH_FLOAT_ZMAX) img.setAttribute('data-z', fz);
        }
        dest.appendChild(img);
        continue;
      }
      /* Everything else: the tag is kept, and the ONLY attribute that can survive is a style
         rebuilt property-by-property by safeScratchStyle() — class, id, every event handler and
         every other attribute are still dropped outright. That narrow opening is what lets the
         format bar's highlight round-trip (a <span style="background-color">, the one command with
         no <font> form), and it costs nothing else: a pasted stylesheet's worth of class/id junk
         still doesn't come through, and the handful of properties that do are re-emitted from a
         validated table rather than copied across. */
      const clone = document.createElement(tag.toLowerCase());
      const css = safeScratchStyle(node);
      if(css) clone.setAttribute('style', css);
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

  /* The stack always ends in a blank page, the way a notebook always has a next sheet: a new note
     is reached by swiping or scrolling past the last one, not by hunting for a button.

     Deliberately NOT folded into ensureScratchPages(), despite being the same kind of invariant.
     That one is called from READ paths too — scratchActivePage(), serializeScratch(), the search
     index — and a read that silently grew the array would leave the dot row describing a stack that
     no longer exists, or append a page in the middle of serialising one. This is called only from
     the places that just changed the pages or are about to redraw them. Cheap and idempotent all
     the same, so calling it twice costs one emptiness check. */
  function ensureTrailingBlankScratchPage(){
    ensureScratchPages();
    const pages = state.scratch.pages;
    if(scratchPageIsEmpty(pages[pages.length - 1])) return false;
    pages.push(makeScratchPage());
    return true;
  }

  /* ---------- derived-page cache ----------
     Everything in here is a pure function of ONE page's exact html string, so a mismatch on that
     string is the only invalidation needed and an entry cannot go quietly stale.

     It exists for a measured reason. A Tab+scroll flick turns pages several times a second, and
     each turn ran renderScratchPages() (a DOMParser parse per page, for the dot tooltips) and armed
     a save whose serializeScratch() does a parse-and-rebuild per page for the outbound sanitiser.
     On a seven-page stack that is well over a dozen full HTML parses per page turn, every one of
     them recomputing an answer that had not changed — and the typing path was no better, since
     scheduleScratchCount() re-renders the same row every 120ms.
     Note what is NOT cached: the ACTIVE page's text for search, which is read from the live surface
     precisely because it may differ from the stored string. */
  const scratchPageCache = new Map();

  function scratchCacheFor(p){
    const html = (p && p.html) || '';
    let c = scratchPageCache.get(p.id);
    if(!c || c.html !== html){ c = { html: html }; scratchPageCache.set(p.id, c); }
    return c;
  }

  // pages come and go; without this the map keeps every id the stack has ever held
  function pruneScratchPageCache(){
    if(scratchPageCache.size < 64) return;
    const live = new Set();
    const pages = (state.scratch && state.scratch.pages) || [];
    for(let i=0; i<pages.length; i++) live.add(pages[i].id);
    scratchPageCache.forEach((v, k)=>{ if(!live.has(k)) scratchPageCache.delete(k); });
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
    if(p && p.id){
      const c = scratchCacheFor(p);
      if(c.title === undefined) c.title = computeScratchPageTitle(p);
      return c.title;
    }
    return computeScratchPageTitle(p);
  }

  function computeScratchPageTitle(p){
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
    /* mute and fmt ride the row rather than localStorage so the preferences follow you between
       devices, the same as which page you had open. Both default to the QUIET value when the key
       is absent — an older saved row, or a first ever load — so nothing about opening the napkin
       for the first time is louder than it was before either feature existed. */
    state.scratch = { pages: pages, activeId: activeId, updatedAt: at, mute: !!(raw && raw.mute), fmt: !!(raw && raw.fmt) };
    ensureScratchPages();
    // Deliberately does NOT mark dirty or save: merely loading the app shouldn't write. The sheet
    // exists in memory now, and the next genuine edit persists it along with whatever it changed.
    ensureTrailingBlankScratchPage();
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
    pruneScratchPageCache();
    /* Still every page through sanitizeScratchHtml() — this is the outbound boundary and skipping a
       page would be a hole in it. The cache only skips re-deriving output for a page whose html is
       byte-identical to the one that produced the output already held, which is the overwhelmingly
       common case: one page was edited, the other six were not. */
    const pages = state.scratch.pages.map(p => {
      const c = scratchCacheFor(p);
      if(c.out === undefined) c.out = sanitizeScratchHtml(c.html);
      return { id: p.id, html: c.out, updatedAt: p.updatedAt || 0 };
    });
    return { pages: pages, activeId: state.scratch.activeId, updatedAt: state.scratch.updatedAt || 0, mute: !!state.scratch.mute, fmt: !!state.scratch.fmt };
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
    /* Free-floating images carry their position as data-x/data-y percentages+pixels, never as the
       inline left/top the browser lays out from (that pair is stripped by the sanitizer on the way
       out, deliberately). So every replacement of the sheet has to turn the attributes back into
       geometry, or a page switch would drop every photo to the top-left corner. */
    layoutScratchFloats();
  }

  // contenteditable has no ::placeholder, and it's almost never truly :empty (browsers leave a <br>
  // or an empty <div> behind), so the empty state is a class we set ourselves.
  /* Blankness read from the LIVE surface instead of by re-parsing the stored HTML. Both callers
     sit on the keystroke path, and scratchPageIsEmpty() spins up a DOMParser every time it is
     asked — fine for the handful of pages a sweep looks at, wasteful once per character typed. */
  function scratchSurfaceIsBlank(surf){
    return !surf.textContent.trim() && !surf.querySelector('img, input, a');
  }

  function markScratchEmpty(){
    const surf = el('scratchText');
    if(!surf) return;
    const blank = scratchSurfaceIsBlank(surf);
    surf.classList.toggle('is-empty', blank);
    /* The same fact, mirrored onto the overlay so the FOOTER can see it. On a phone the tip line
       wrapped to three lines of text that a returning user has long since read, which was most of
       the clutter down there — so it now behaves like onboarding: shown while the page is blank
       (exactly when someone needs to know that "[]" makes a tickbox), gone the moment there is
       anything to read instead. Desktop keeps them always, where there is room. */
    const ov = el('scratchOverlay');
    if(ov) ov.classList.toggle('scratch-blank', blank);
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
      // the only path here that rewrites the surface, so the only one that has to put the floats
      // back: the sanitizer keeps data-x/data-y and drops the geometry they are turned into
      layoutScratchFloats();
      html = surf.innerHTML;
    }
    const page = scratchActivePage();
    page.html = html;
    page.updatedAt = Date.now();
    state.scratch.updatedAt = page.updatedAt;
    setScratchStatus('dirty');
    markScratchEmpty();
    /* The moment you write on the LAST page, another blank appears behind it — that is what makes
       "start a new note" a swipe rather than a button press. Gated on the cheap surface test first,
       so the DOMParser inside ensureTrailingBlankScratchPage() runs once per new sheet rather than
       once per keystroke: after it appends, the active page is no longer the last and the gate
       stops matching. */
    if(!scratchSurfaceIsBlank(surf) && scratchActiveIndex() === state.scratch.pages.length - 1){
      if(ensureTrailingBlankScratchPage()) renderScratchPages();
    }
    scheduleScratchCount();
    // an edit moves every offset after it, so the open hit list is re-run rather than left stale
    if(scratchFindOn){ scratchClearHitPaint(); scheduleScratchFind(); }
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

  /* opts.keepFocus is for the find panel: stepping to a hit on another page must not pull the
     caret out of the query box you are still typing in. Every other caller omits it and gets the
     focus behaviour described below unchanged. */
  function scratchGoTo(i, opts){
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
    // Throttled, not immediate: updateScratchFooter() walks the whole page's textContent for the
    // word count, and during a flick that ran once per turn. scheduleScratchCount() coalesces it
    // onto the same 120ms tick typing already uses — the dots above are what needs to move now.
    scheduleScratchCount();
    animateScratchPage(to > from ? 1 : -1);
    playScratchPageTick(to > from ? 1 : -1);
    /* Take focus only if we already had it — keeping a keyboard that's already up, and keeping the
       caret valid after the innerHTML swap — or if there's no soft keyboard to summon in the first
       place. Flipping between pages must never be the thing that raises it. */
    const surf = el('scratchText');
    if(surf && !(opts && opts.keepFocus) && (wasWriting || scratchWantsAutoFocus())){
      surf.focus({ preventScroll:true });
      placeScratchCaretAtEnd(surf);
    }
    // the remembered Range points into the page that was just swapped out — withScratchSelection()
    // would reject it anyway, but leaving a detached node hanging around serves nothing
    scratchSavedRange = null;
    hideScratchImgBox();   // it was drawn around an image on the page that just left
    updateScratchFormatState();
    // the hits on screen belong to the page that just left; repaint against the one that arrived
    if(scratchFindOn) scheduleScratchFind();
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
    /* The stack already ends in a blank sheet, so "+" now usually means "take me to it" rather than
       "make another" — appending a second empty page would only leave a duplicate dot for the sweep
       to clear on the way out. It genuinely adds one only when the last page has something on it,
       which is the case where the invariant hasn't caught up yet. Either way you end up on a blank
       page with the caret in it, which is all the button ever promised. */
    const pages0 = state.scratch.pages;
    const lastIdx = pages0.length - 1;
    if(scratchPageIsEmpty(pages0[lastIdx])){
      if(scratchActiveIndex() !== lastIdx) scratchGoTo(lastIdx);
      const waiting = el('scratchText');
      if(waiting) waiting.focus({ preventScroll:true });
      return;
    }
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
    // deleting the trailing blank regrows it, so "-" on the fresh sheet reads as "close this one"
    // and steps you back to what you wrote, rather than as a page that refuses to go
    ensureTrailingBlankScratchPage();
    state.scratch.updatedAt = Date.now();
    syncScratchSurface(true);
    renderScratchPages();
    updateScratchFooter();
    sweepDeletedScratchImages(); // a deleted page is confirmed and unundoable — reclaim now
    focusScratchSurface(); // the - button that was clicked no longer exists; don't strand focus
    setScratchStatus('dirty');
    debouncedSaveScratch();
  }

  /* Blank pages at the END are swept on the way out so idly paging past the last one doesn't leave
     a pile of empties behind — but EXACTLY ONE is kept now, because the stack is supposed to end in
     a fresh sheet (see ensureTrailingBlankScratchPage). Hence the two-at-a-time test: pop the last
     blank only while the one before it is blank too, which halts with a single trailing empty.
     A blank page in the MIDDLE was still put there deliberately and is still left alone.
     Extra blanks are only cleared HERE, on the way out, never while you type: the dot row shifting
     under a gesture you're in the middle of is worse than a spare dot for the rest of a session. */
  function sweepTrailingEmptyScratchPages(){
    ensureScratchPages();
    const pages = state.scratch.pages;
    let changed = false;
    while(pages.length > 1
          && scratchPageIsEmpty(pages[pages.length - 1])
          && scratchPageIsEmpty(pages[pages.length - 2])){
      if(pages[pages.length - 1].id === state.scratch.activeId) state.scratch.activeId = pages[pages.length - 2].id;
      pages.pop();
      changed = true;
    }
    /* Reopening should land on something you wrote rather than on the fresh sheet — the same intent
       the old sweep had when it simply deleted the page you were idling on. */
    if(pages.length > 1 && pages[pages.length - 1].id === state.scratch.activeId
       && scratchPageIsEmpty(pages[pages.length - 1])){
      state.scratch.activeId = pages[pages.length - 2].id;
      changed = true;
    }
    if(ensureTrailingBlankScratchPage()) changed = true;  // and it must still END in one
    if(changed) ensureScratchPages();
    return changed;
  }

  /* The dots and the tools were one row, and on a phone that row was doing two unrelated jobs at
     once: it is the page INDICATOR and it was also the toolbar. With eight pages the dots alone are
     ~185px and the five buttons another ~160px, which overflows a 360px screen — so the row wrapped
     and the bottom of the napkin turned into a block of scattered circles and glyphs.
     They are separated now. #scratchPages holds nothing but dots, so it reads as one clean line of
     position at any page count, and the tools sit in the footer strip that already existed next to
     the word count. Same structure at both breakpoints: the desktop layout was quietly crowded too,
     and one arrangement is far easier to keep honest than two.
     The reorder drag is unaffected — its handlers live on #scratchPages and only ever cared about
     .scratch-dot, which now has that container to itself. */
  /* ---------- the page row ----------
     A pager — "‹ 4 / 23 ›" — at every page count, and the counter opens the named list.

     This used to be a row of dots. They were charming at five pages and actively unhelpful past
     about twelve: identical circles tell you nothing about WHICH page each one is, the tooltip that
     did needs a hover a phone hasn't got, the row wrapped into a block, and a thumb couldn't hit
     one reliably. Keeping both and switching at a threshold meant two navigators, two reorder
     mechanisms and two sets of edge cases for one job — so the dots are gone rather than demoted.
     What replaced them is strictly more capable at every size: the counter always fits on one line,
     the list behind it shows page NAMES, and reordering happens there on rows you can read instead
     of on circles you can't tell apart. */
  function renderScratchPages(){
    const row = el('scratchPages');
    if(!row) return;
    ensureScratchPages();
    const pages = state.scratch.pages;
    const active = scratchActiveIndex();
    row.innerHTML =
        '<button type="button" class="scratch-pagenav" id="scratchPrevPage" title="Previous page" aria-label="Previous page">&lsaquo;</button>'
      + '<button type="button" class="scratch-pagecount" id="scratchPageListBtn" aria-haspopup="true"'
      + ' aria-expanded="' + (scratchSheetOn ? 'true' : 'false') + '" title="All pages">'
      + (active + 1) + ' <span>/</span> ' + pages.length + '</button>'
      + '<button type="button" class="scratch-pagenav" id="scratchNextPage" title="Next page" aria-label="Next page">&rsaquo;</button>';
    renderScratchPageSheet();
    renderScratchTools(pages);
  }

  function renderScratchTools(pages){
    const bar = el('scratchTools');
    if(!bar) return;
    let h = '';
    // + and − rather than a word: they pair obviously, and the page's own name lives in the list
    h += '<button type="button" class="scratch-pagebtn" id="scratchAddPage" title="New page" aria-label="New page">+</button>';
    if(pages.length > 1) h += '<button type="button" class="scratch-pagebtn" id="scratchDelPage" title="Delete this page" aria-label="Delete this page">−</button>';
    /* The format bar's switch. It lives HERE, in a row that already exists, rather than in a strip
       of its own — which is what makes "collapsed" cost literally nothing on screen. Same reason
       the mute switch is here and not in Settings: this page is an easter egg, and every control
       it grows has to earn its pixels twice. */
    /* Find's switch. Unlike Aa next to it this reflects no stored preference — a query is not a
       setting — so it's a plain button that opens the panel, and Escape or × closes it. It exists
       at all because Ctrl+F is not reachable on a phone. */
    h += '<button type="button" class="scratch-pagebtn scratch-findbtn" id="scratchFindBtn"'
       + ' title="Find on all pages (Ctrl+F)" aria-label="Find on all pages">&#9906;</button>';
    const fmtOn = !!state.scratch.fmt;
    h += '<button type="button" class="scratch-pagebtn scratch-fmtbtn" id="scratchFmtBtn"'
       + ' title="' + (fmtOn ? 'Hide formatting' : 'Formatting') + '"'
       + ' aria-pressed="' + (fmtOn ? 'true' : 'false') + '" aria-label="Toggle the format bar">Aa</button>';
    // A page-turn sound you can't silence would be a menace in a room with other people, so it gets
    // a switch — here rather than in Settings, which would give the easter egg a visible entry.
    const muted = !!state.scratch.mute;
    h += '<button type="button" class="scratch-pagebtn scratch-mute' + (muted ? ' is-off' : '') + '" id="scratchMuteBtn"'
       + ' title="' + (muted ? 'Page-turn sound off' : 'Page-turn sound on') + '"'
       + ' aria-pressed="' + (muted ? 'true' : 'false') + '" aria-label="Toggle page-turn sound">♪</button>';
    // last in the row, where a help affordance belongs, and the only one of these that opens
    // something purely informational
    h += '<button type="button" class="scratch-pagebtn scratch-helpbtn" id="scratchHelpBtn" aria-haspopup="true"'
       + ' aria-expanded="' + (scratchHelpOn ? 'true' : 'false') + '" title="Shortcuts" aria-label="Shortcuts">?</button>';
    bar.innerHTML = h;
  }

  /* ---------- the shortcuts panel ----------
     One table rather than one sentence. The footer used to carry every hint as a single run-on
     line, which cost a permanent strip of unreadable micro-type on every screen and still could
     not fit the whole truth — and being prose, it drifted out of date silently the moment the
     dots stopped being the reorder handle.

     Rows are tagged so the same table serves both input models: a `key` row is dropped on a touch
     layout and a `touch` row on a pointer one, which is the same swap the old .scratch-tip-key /
     .scratch-tip-touch pair did, moved onto whole rows so the two columns stay aligned. The
     untagged rows are true either way. Nothing here is derived from state and nothing is
     user-typed, so it is a static table; keep it that way, because the value of the panel is that
     there is exactly one place to correct when a gesture changes. */
  const SCRATCH_HELP_ROWS = [
    ['',      'type <b>[]</b> then space',       'a tickbox'],
    ['key',   '<kbd>ctrl</kbd> + <kbd>K</kbd>',  'link the selection'],
    ['key',   '<kbd>tab</kbd> <kbd>tab</kbd>',   'find on every page'],
    ['key',   'hold <kbd>tab</kbd> + scroll',    'turn the page'],
    ['touch', 'swipe left or right',             'turn the page'],
    ['key',   'drag an image',                   'lift it out of the text'],
    ['touch', 'press and hold an image',         'lift it out of the text'],
    ['',      'drag an image’s corner',          'resize it'],
    ['',      'click an image',                  'crop it, or cut its background out'],
    ['',      'click the page count',            'every page, drag to reorder']
    // no `esc` row: the footer says "esc to exit" permanently, and only on the same screens where
    // these keyboard rows are shown at all
  ];

  function renderScratchHelp(){
    const panel = el('scratchHelp');
    if(!panel) return;
    if(!scratchHelpOn){ panel.style.display = 'none'; panel.innerHTML = ''; return; }
    let h = '<div class="scratch-help-t">Shortcuts</div>';
    for(let i = 0; i < SCRATCH_HELP_ROWS.length; i++){
      const r = SCRATCH_HELP_ROWS[i];
      h += '<div class="scratch-help-row' + (r[0] ? ' is-' + r[0] : '') + '">'
         + '<span class="scratch-help-k">' + r[1] + '</span>'
         + '<span class="scratch-help-d">' + r[2] + '</span></div>';
    }
    panel.innerHTML = h;
    panel.style.display = 'grid';
  }

  /* Only one panel may be up at a time. All three grow upward from the same corner of the footer,
     so a second one opening behind the first would simply be invisible. */
  function openScratchHelp(){
    closeScratchFind(true);   // silent: focus belongs to the ? that was just pressed, not the sheet
    closeScratchPageSheet();
    scratchHelpOn = true;
    renderScratchHelp();
    const btn = el('scratchHelpBtn');
    if(btn) btn.setAttribute('aria-expanded', 'true');
  }

  function closeScratchHelp(){
    if(!scratchHelpOn) return;
    scratchHelpOn = false;
    renderScratchHelp();
    const btn = el('scratchHelpBtn');
    if(btn) btn.setAttribute('aria-expanded', 'false');
  }

  /* ---------- the page list ----------
     Same visual language as the find results panel deliberately: it is the same kind of object (a
     scrollable list of pages you can jump to), it grows upward over the writing for the same reason,
     and reusing the pattern is most of why this costs so little.
     Reordering lives here in pager mode, on a per-row GRIP rather than the row itself. That is not
     decoration: the sheet scrolls vertically and the drag is vertical, so touch-action:none on the
     whole row would make the list unscrollable by thumb — the same collision the dot row has with
     horizontal scrolling, resolved the way a list can afford to resolve it. */
  let scratchSheetOn = false;
  let scratchSheetDragId = null, scratchSheetFrom = -1, scratchSheetMoved = false;
  // like scratchFindOn, and for the same reason: which panel is up is not a setting, so it is
  // session state and never reaches state.scratch
  let scratchHelpOn = false;

  function renderScratchPageSheet(){
    const sheet = el('scratchPageSheet');
    if(!sheet) return;
    if(!scratchSheetOn){ sheet.style.display = 'none'; sheet.innerHTML = ''; return; }
    ensureScratchPages();
    const pages = state.scratch.pages, active = scratchActiveIndex();
    let h = '';
    for(let i=0; i<pages.length; i++){
      // titles come from the per-page cache, so this is a string lookup rather than a parse per row
      const label = scratchPageTitle(pages[i]);
      h += '<div class="scratch-sheet-row' + (i === active ? ' is-on' : '')
         + (pages[i].id === scratchSheetDragId ? ' is-dragging' : '') + '" data-i="' + i + '">'
         + '<span class="scratch-sheet-grip" title="Drag to reorder" aria-hidden="true"></span>'
         + '<button type="button" class="scratch-sheet-go" data-i="' + i + '"'
         + (i === active ? ' aria-current="true"' : '') + '>'
         + '<span class="scratch-sheet-n">' + (i + 1) + '</span>'
         + '<span class="scratch-sheet-t">' + escapeHtml(label) + '</span></button></div>';
    }
    sheet.innerHTML = h;
    sheet.style.display = 'block';
    /* Only when NOT dragging. Every crossing re-renders this list, and scrolling back to the
       CURRENT page each time would drag the list out from under the row you are holding. */
    if(scratchSheetDragId) return;
    const on = sheet.querySelector('.scratch-sheet-row.is-on');
    if(on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  }

  function openScratchPageSheet(){
    closeScratchHelp();   // one panel at a time; they share the same corner of the footer
    scratchSheetOn = true;
    renderScratchPageSheet();
    const btn = el('scratchPageListBtn');
    if(btn) btn.setAttribute('aria-expanded', 'true');
  }

  function closeScratchPageSheet(){
    scratchSheetOn = false;
    scratchSheetDragId = null; scratchSheetFrom = -1; scratchSheetMoved = false;
    const sheet = el('scratchPageSheet');
    if(sheet){ sheet.style.display = 'none'; sheet.innerHTML = ''; }
    const btn = el('scratchPageListBtn');
    if(btn) btn.setAttribute('aria-expanded', 'false');
  }

  /* ---------- tickboxes, links, images ----------
     document.execCommand is deprecated but is still the only cross-browser way to insert into a
     contenteditable while keeping the browser's own undo stack intact — and this repo has no
     bundler to reach for an editor library. Hand-rolled Range surgery would work but would silently
     break Ctrl+Z, which on a napkin matters more than the deprecation notice does. */

  function scratchExec(cmd, value){
    try{ document.execCommand(cmd, false, value); }catch(e){ /* nothing sensible to do */ }
  }

  /* ---------- images: resize, and open full ----------
     Two gestures on one element, so they are deliberately given separate triggers rather than
     being made to share a click:
       - CLICK opens the image full-size in a lightbox. That is the common act, so it gets the
         common gesture.
       - The RESIZE grip appears on hover (fine pointer) or after a long press (touch), and is
         dragged. It is never on screen except while you are pointing at that image.

     The hard rule, same as everywhere else on this page: none of this may write UI into the
     content. The surface's innerHTML IS the saved document, so there is no selection class on the
     image and no handle element inside the editable. The outline and its grip are ONE element that
     lives in the overlay, outside .scratch-text entirely, positioned over the image from its
     bounding rect. The only thing a resize ever changes in the document is the image's own width
     attribute — which is exactly what we want persisted. */

  let scratchImgFor = null;        // the <img> the box is currently drawn around
  let scratchImgDrag = null;
  let scratchImgHideTimer = null;
  let scratchImgViewOn = false;
  let scratchImgPressTimer = null;
  let scratchImgPressAt = 0;       // when a long press last fired, so its tap can be swallowed
  const scratchImgFinePointer = (function(){
    try{ return window.matchMedia('(pointer: fine)'); }catch(e){ return null; }
  })();
  function scratchImgHoverable(){ return !!(scratchImgFinePointer && scratchImgFinePointer.matches); }

  function placeScratchImgBox(){
    const box = el('scratchImgBox'), surf = el('scratchText'), ov = el('scratchOverlay');
    if(!box || !surf || !ov) return;
    // the image may have been typed away, or the page switched out from under it
    if(!scratchImgFor || !surf.contains(scratchImgFor)){ hideScratchImgBox(); return; }
    const r = scratchImgFor.getBoundingClientRect();
    const sr = surf.getBoundingClientRect();
    // scrolled out of the writing area: don't float a grip over the footer or the format bar
    if(r.bottom <= sr.top + 6 || r.top >= sr.bottom - 6){ box.style.display = 'none'; return; }
    const or = ov.getBoundingClientRect();
    /* Compared before assigning. This runs every frame while an image is hovered (see
       trackScratchImgBox), and an unconditional write invalidates style even when the value is
       identical — which is most frames, including all of the ones during a page-turn animation
       where the extra work is least affordable. */
    const st = box.style;
    const left = (r.left - or.left) + 'px', top = (r.top - or.top) + 'px';
    const w = r.width + 'px', h = r.height + 'px';
    if(st.display !== 'block') st.display = 'block';
    if(st.left !== left) st.left = left;
    if(st.top !== top) st.top = top;
    if(st.width !== w) st.width = w;
    if(st.height !== h) st.height = h;
  }

  /* The box FOLLOWS its image every frame while it's up, rather than being repositioned on a list
     of events. Discrete hooks are the wrong shape for this and got it wrong in a way that stuck:
     animateScratchPage() runs a 180ms translateX on .scratch-text for a page turn, so an image's
     bounding rect mid-slide is 20px away from where it will finally sit. Hover onto an image
     while that animation is running — which is exactly what happens when you page with Tab+scroll
     and the cursor is already sitting where the incoming image lands — and the outline was drawn
     at the transformed position, then STAYED there, because a CSS animation ending fires no scroll
     and no resize. Nothing corrected it short of moving the mouse off and back.
     A frame loop covers that, inertial and smooth scrolling (where the compositor keeps moving
     after the scroll event), and any reflow, with one mechanism and no event list to keep complete.
     It only runs while an image is actually hovered, and stops itself the moment the box goes. */
  let scratchImgFrame = 0;

  function trackScratchImgBox(){
    if(scratchImgFrame) return;
    const tick = ()=>{
      scratchImgFrame = 0;
      if(!scratchImgFor) return;
      placeScratchImgBox();
      // re-checked AFTER placing: placeScratchImgBox() hides the box outright if the image has been
      // typed away, and that clears scratchImgFor from under us
      if(scratchImgFor) scratchImgFrame = requestAnimationFrame(tick);
    };
    scratchImgFrame = requestAnimationFrame(tick);
  }

  function showScratchImgBox(img){
    if(scratchImgHideTimer){ clearTimeout(scratchImgHideTimer); scratchImgHideTimer = null; }
    scratchImgFor = img;
    placeScratchImgBox();
    trackScratchImgBox();
    syncScratchImgBoxButtons();
  }

  function hideScratchImgBox(){
    if(scratchImgHideTimer){ clearTimeout(scratchImgHideTimer); scratchImgHideTimer = null; }
    if(scratchImgFrame){ cancelAnimationFrame(scratchImgFrame); scratchImgFrame = 0; }
    scratchImgFor = null;
    const box = el('scratchImgBox');
    if(box) box.style.display = 'none';
  }

  /* Leaving the image doesn't hide the box immediately: the grip sits OUTSIDE .scratch-text (it has
     to — see above), so the pointer necessarily leaves the image to reach it. A short grace period
     is simpler and steadier than trying to reason about relatedTarget across two element trees. */
  function hideScratchImgBoxSoon(){
    // …and neither gesture may lose its own outline: a move drags the pointer clean off the image
    if(scratchImgDrag || scratchImgMove) return;
    if(scratchImgHideTimer) clearTimeout(scratchImgHideTimer);
    scratchImgHideTimer = setTimeout(()=>{ scratchImgHideTimer = null; hideScratchImgBox(); }, 140);
  }

  function scratchImgWidthNow(img){
    const attr = parseInt(img.getAttribute('width') || '', 10);
    if(attr >= SCRATCH_IMG_MIN) return attr;
    return Math.round(img.getBoundingClientRect().width) || SCRATCH_IMG_MIN;
  }

  /* The ceiling is the natural width where we know it, so an image can't be dragged past its own
     resolution into a blurry mess; SCRATCH_IMG_MAX is the backstop for one that hasn't loaded yet.
     The floor keeps a photo from being dragged down to an unclickable speck it can't come back from. */
  function setScratchImgWidth(img, w){
    const cap = Math.min(SCRATCH_IMG_MAX, img.naturalWidth || SCRATCH_IMG_MAX);
    const n = Math.round(Math.max(SCRATCH_IMG_MIN, Math.min(cap, w)));
    img.setAttribute('width', String(n));
    placeScratchImgBox();
    return n;
  }

  function endScratchImgDrag(){
    if(!scratchImgDrag) return;
    scratchImgDrag = null;
    // ONE save for the whole gesture rather than one per pixel — the width is already in the live
    // DOM, this is what folds it into state and debounces the write
    onScratchInput();
    placeScratchImgBox();
  }

  /* ---------- free-floating images ----------
     An image normally sits IN the writing, as a block in the flow. Lifted, it comes out of the
     flow and sits ON the sheet instead: it can be dragged anywhere, it can overlap the text, and
     it can overlap other images — which is the whole point, and is why the CSS gives a float no
     background and no corner rounding. A cut-out PNG has to composite against whatever is
     underneath it, not against a rectangle of page colour, and a border-radius would clip the
     corners of artwork that was never rectangular to begin with. (The other half of that promise
     is upstream, in core.js: an upload only stays a JPEG if it has no transparency to lose.)

     Three rules hold this together.

     The POSITION LIVES IN THE ATTRIBUTES, never in the inline style. data-x/data-y/data-z are what
     the sanitizer validates and what round-trips through storage; the left/top/z-index the browser
     lays out from are written here and are deliberately absent from SCRATCH_STYLE_OK, so they are
     stripped on the way out and re-derived by layoutScratchFloats() on the way back in. That is
     what keeps `position:absolute` out of the style allowlist — an opening wide enough for
     anything arriving from the shared unauthenticated row to cover the page with itself.

     A float is a CHILD OF THE SURFACE, not of the paragraph it was lifted from. Its coordinates
     don't change when it moves (`.scratch-text` is the containing block either way), but its fate
     does: left inside a line, deleting that line would take the photo with it, and a picture you
     positioned by hand should not be collateral damage of editing a sentence.

     And LIFTING PINS THE WIDTH. In the flow an unsized image is clamped by the column's
     max-width; out of it that clamp still applies, but the number it was being seen at is now a
     thing you can drag, so it is written down at the moment of the lift rather than left implicit. */

  function scratchImgIsFloat(img){ return !!(img && img.hasAttribute && img.hasAttribute('data-x')); }

  function scratchFloats(surf){ return surf ? surf.querySelectorAll('img[data-x]') : []; }

  function scratchFloatZ(img){ return parseInt(img.getAttribute('data-z') || '0', 10) || 0; }

  function scratchTopZ(surf){
    const list = scratchFloats(surf);
    let top = 0;
    for(let i = 0; i < list.length; i++){ const z = scratchFloatZ(list[i]); if(z > top) top = z; }
    return top;
  }

  /* Squashes the stack back down to 1..n in its current order. Only ever needed because data-z is
     capped at three digits by the sanitizer's own regex — bumping to the front is otherwise free,
     and after a thousand of them the ceiling would silently turn "bring to front" into a no-op. */
  function renumberScratchFloats(surf){
    const list = Array.prototype.slice.call(scratchFloats(surf));
    list.sort((a, b)=> scratchFloatZ(a) - scratchFloatZ(b));
    for(let i = 0; i < list.length; i++) list[i].setAttribute('data-z', String(Math.min(SCRATCH_FLOAT_ZMAX, i + 1)));
  }

  /* No-ops when nothing is above it already, which matters more than it sounds: every drag calls
     this, and a bump that changed nothing visible would still rewrite data-z, which is a diff, a
     dirty page and a save on a gesture that only moved a photo two pixels. */
  function bringScratchImgFront(img){
    const surf = el('scratchText');
    if(!surf || !scratchImgIsFloat(img)) return;
    const list = scratchFloats(surf), mine = scratchFloatZ(img);
    let top = 0, buried = false;
    for(let i = 0; i < list.length; i++){
      const z = scratchFloatZ(list[i]);
      if(z > top) top = z;
      // >= rather than >: a tie is decided by document order, so an equal z is still "above me"
      if(list[i] !== img && z >= mine) buried = true;
    }
    if(!buried) return;
    if(top >= SCRATCH_FLOAT_ZMAX){ renumberScratchFloats(surf); top = scratchTopZ(surf); }
    img.setAttribute('data-z', String(Math.min(SCRATCH_FLOAT_ZMAX, top + 1)));
    layoutScratchFloats();
  }

  /* Renumbering FIRST is what makes zero mean the bottom: everything else is then 1..n, so a second
     "send to back" on a different image can't tie with the first. */
  function sendScratchImgBack(img){
    const surf = el('scratchText');
    if(!surf || !scratchImgIsFloat(img)) return;
    renumberScratchFloats(surf);
    img.setAttribute('data-z', '0');
    layoutScratchFloats();
  }

  // the one writer of the inline geometry, so the attribute-to-style direction exists in one place
  function applyScratchFloat(img, left, top){
    const st = img.style;
    const l = Math.round(left) + 'px', t = Math.round(top) + 'px', z = String(scratchFloatZ(img));
    if(st.left !== l) st.left = l;
    if(st.top !== t) st.top = t;
    if(st.zIndex !== z) st.zIndex = z;
  }

  /* Horizontal is clamped so a float can never stick out past the sheet: `.scratch-text` scrolls
     vertically, which makes its overflow-x compute to auto, so one image nudged off the right edge
     would give the whole page a horizontal scrollbar. Vertical is only floored — dragging a photo
     below the last line is a legitimate thing to want, and an absolutely positioned child of the
     scroll container extends its scrollable area, so the sheet simply gets longer. */
  function setScratchFloatAt(img, left, top){
    const surf = el('scratchText');
    if(!surf) return;
    const w = surf.clientWidth || 1;
    const l = Math.max(0, Math.min(left, Math.max(0, w - (img.offsetWidth || 0))));
    const t = Math.max(0, top);
    img.setAttribute('data-x', String(Math.round((l / w) * 10000) / 100));
    img.setAttribute('data-y', String(Math.round(t)));
    applyScratchFloat(img, l, t);
  }

  /* Attributes back into layout. Runs after anything that replaces or re-measures the sheet — a
     page switch, a load, a window resize, an image finishing its download — because data-x is a
     PERCENTAGE and the pixel it lands on depends on how wide the column currently is. Idempotent
     and comparison-guarded, so calling it more often than strictly necessary costs nothing. */
  function layoutScratchFloats(){
    const surf = el('scratchText');
    if(!surf) return;
    const w = surf.clientWidth || 1;
    const list = scratchFloats(surf);
    for(let i = 0; i < list.length; i++){
      const img = list[i];
      const pct = parseFloat(img.getAttribute('data-x')), y = parseFloat(img.getAttribute('data-y'));
      if(!isFinite(pct) || !isFinite(y)) continue;
      const room = Math.max(0, w - (img.offsetWidth || 0));
      applyScratchFloat(img, Math.max(0, Math.min((pct / 100) * w, room)), Math.max(0, y));
    }
  }

  /* Out of the flow, staying exactly where it visually is. `at` is for a file dropped at a point,
     where there is no "where it already was" to preserve. */
  function liftScratchImg(img, at){
    const surf = el('scratchText');
    if(!surf || !img || scratchImgIsFloat(img)) return;
    let left, top;
    if(at){
      left = at.left; top = at.top;
    } else {
      const r = img.getBoundingClientRect(), sr = surf.getBoundingClientRect();
      left = r.left - sr.left + surf.scrollLeft;
      top = r.top - sr.top + surf.scrollTop;
      if(!img.getAttribute('width') && r.width) setScratchImgWidth(img, Math.round(r.width));
    }
    img.setAttribute('data-z', String(Math.min(SCRATCH_FLOAT_ZMAX, scratchTopZ(surf) + 1)));
    setScratchFloatAt(img, left, top);
    // onto the sheet itself; see the "child of the surface" rule above
    if(img.parentNode !== surf) surf.appendChild(img);
  }

  /* Back into the writing. It re-enters wherever it currently sits in the DOM, which for anything
     that has been floated is the end of the sheet — there is no record of the paragraph it came
     out of, and inventing one would be guessing. */
  function dropScratchImg(img){
    if(!scratchImgIsFloat(img)) return;
    img.removeAttribute('data-x');
    img.removeAttribute('data-y');
    img.removeAttribute('data-z');
    img.style.left = img.style.top = img.style.zIndex = '';
    if(!img.getAttribute('style')) img.removeAttribute('style');
  }

  function toggleScratchImgFloat(img){
    if(!img) return;
    if(scratchImgIsFloat(img)) dropScratchImg(img); else liftScratchImg(img);
    syncScratchImgBoxButtons();
    placeScratchImgBox();
    onScratchInput();
  }

  // the lift button is a toggle, so it has to say which way round it currently is
  function syncScratchImgBoxButtons(){
    const lift = el('scratchImgLift');
    if(!lift) return;
    const on = scratchImgIsFloat(scratchImgFor);
    lift.setAttribute('aria-pressed', on ? 'true' : 'false');
    lift.classList.toggle('is-on', on);
    lift.title = on ? 'Back into the text · arrow keys to move · [ and ] for layer'
                    : 'Float this image · then drag it anywhere';
    lift.setAttribute('aria-label', on ? 'Return image to the text' : 'Free-float this image');
  }

  /* ---- dragging one around ----
     Deliberately the SAME gesture whether the image is already floating or not: a drag on an
     inline image lifts it first and then moves it, so "put this photo over there" is one motion
     rather than a mode switch followed by a motion. The lift button exists for discoverability and
     for the way back, not as a prerequisite.
     `live` is the slop gate. Until the pointer has actually travelled, nothing has happened and the
     gesture is still free to turn out to be a plain click — which on an image opens the lightbox. */
  let scratchImgMove = null;
  let scratchImgMoveAt = 0;     // when a move last ENDED, so the click trailing it can be swallowed
  const SCRATCH_MOVE_SLOP = 4;

  function beginScratchImgMove(m, cx, cy){
    const surf = el('scratchText');
    if(!surf) return;
    m.live = true;
    /* Grabbed by the point you actually took hold of, measured BEFORE the lift so the photo does
       not jump under the cursor at the moment it leaves the flow. */
    const r = m.img.getBoundingClientRect();
    m.gx = cx - r.left;
    m.gy = cy - r.top;
    liftScratchImg(m.img);
    bringScratchImgFront(m.img);
    /* Capture is taken HERE rather than on pointerdown, and that timing is the whole reason a
       plain click still works. Explicit capture retargets the compatibility mouse events to the
       capturing element, so `click` would then be dispatched at the surface instead of at the
       image — and the click handler finds the image with closest('img'). Capturing only once the
       gesture has committed to being a drag leaves the click path untouched. */
    try{ surf.setPointerCapture(m.id); }catch(e){}
    const ov = el('scratchOverlay');
    if(ov) ov.classList.add('img-moving');
    showScratchImgBox(m.img);
    syncScratchImgBoxButtons();
  }

  function scratchImgMoveTo(m, cx, cy){
    const surf = el('scratchText');
    if(!surf) return;
    const sr = surf.getBoundingClientRect();
    setScratchFloatAt(m.img, cx - m.gx - sr.left + surf.scrollLeft, cy - m.gy - sr.top + surf.scrollTop);
  }

  function endScratchImgMove(){
    const m = scratchImgMove;
    if(!m) return;
    scratchImgMove = null;
    const surf = el('scratchText');
    try{ if(surf) surf.releasePointerCapture(m.id); }catch(e){}
    const ov = el('scratchOverlay');
    if(ov) ov.classList.remove('img-moving');
    if(!m.live) return;   // it was a click after all; leave it to the click handler
    scratchImgMoveAt = Date.now();
    // one save for the whole gesture, exactly like endScratchImgDrag()
    onScratchInput();
    placeScratchImgBox();
  }

  // shared by both buttons on the box, so the layer keys work from whichever one has focus
  function scratchImgLayerKey(e){
    if(!scratchImgFor || !scratchImgIsFloat(scratchImgFor)) return false;
    if(e.key === ']'){ e.preventDefault(); bringScratchImgFront(scratchImgFor); onScratchInput(); return true; }
    if(e.key === '['){ e.preventDefault(); sendScratchImgBack(scratchImgFor); onScratchInput(); return true; }
    return false;
  }

  /* ---- the studio: look, crop, cut out ----------------------------------------------------
     Clicking a photo on the sheet opens it here. It began as a plain lightbox and is still one at
     rest — "let me see that bigger" is the common act and it stays one click — but the two things
     you actually want to DO to a picture you have just pasted onto a napkin are both here now:
     trim it, and lift the subject off its background.

     Nothing is destructive until Save, and Save UPLOADS A NEW FILE rather than overwriting the old
     one. uploadCompressedImage() gives every image its own uid() path, so the edit costs one new
     object and leaves the original URL referenced by no page at all — which hands it straight to
     the reclaim sweep already running on close (sweepDeletedScratchImages). No special case, and
     the edit is undoable with Ctrl+Z right up until the pad is shut, exactly like every other one.

     The picture is drawn into a CANVAS, not into the <img>. The Edge slider recomputes the whole
     cut-out on every tick, and going back through an encode and an object URL per tick just to
     feed an <img> would cost more than the cut-out itself. The <img> survives for exactly one
     case: a picture whose bytes cannot be read back at all. Drawing a foreign image into a canvas
     taints it, and a tainted canvas refuses getImageData — so a photo from a host that sends no
     CORS header gets shown with its tools hidden, rather than being offered edits that would throw
     the moment they ran.

     THE STATE MODEL is three layers and the order between them is the whole design. `orig` is the
     decoded source and never changes, which is what Reset returns to. `base` is what crops have
     made of it. `key` is the cut-out, and it is a LIVE recomputation over `base` — never written
     into it — so the Edge slider and every picked colour stay adjustable for as long as the studio
     is open. Only a crop bakes, because only a crop has to (see applyScratchCrop). */

  const SCRATCH_STUDIO_MINCROP = 0.05;  // fraction of the picture — a floor the crop can't collapse below
  const SCRATCH_STUDIO_MAXPX = 2000;    // working resolution ceiling; the flood fill is per-pixel work

  let studio = null;      // null whenever the studio is closed
  let studioRaf = 0;

  const scratchClamp01 = v => Math.max(0, Math.min(1, v));

  /* Copied into a canvas at a bounded size rather than used at whatever the source happens to be:
     every pass below is O(pixels), and a 12-megapixel phone photo would turn the Edge slider into
     a slideshow. Scratch images are already capped at 1400 on upload, so this only ever bites on
     something linked in from elsewhere. */
  function scratchStudioCanvas(src){
    const nw = src.naturalWidth || src.width, nh = src.naturalHeight || src.height;
    const k = Math.min(1, SCRATCH_STUDIO_MAXPX / Math.max(nw, nh, 1));
    const w = Math.max(1, Math.round(nw * k)), h = Math.max(1, Math.round(nh * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(src, 0, 0, w, h);
    return c;
  }

  /* ---- the cut-out ----
     A flood fill inwards from the edges of the picture, which is the honest version of what can be
     done here: it lifts a subject off a PLAIN background — a screenshot, a product shot, a logo, a
     photo against a wall — and it will not segment a person out of a street scene. No model ships
     in a repo with no build step, and pretending otherwise would only mean a button that fails.

     A flood rather than a global "delete every pixel of this colour" for one specific reason: a
     white shirt in front of a white wall keeps its shirt, because the shirt is not connected to
     the border. That connectivity is the only thing standing in for an understanding of the image.

     Every pixel is compared against the colour of the SEED ITS REGION GREW FROM, never against the
     neighbour it was reached through. Comparing against the neighbour lets a fill walk a gradient
     clean across the subject one imperceptible step at a time, which is how a sky-blue background
     ends up eating a blue jacket. Each border pixel is its own seed, so a background that shades
     from one corner to the other is still handled — it simply grows from several references.

     And a rejected pixel is deliberately NOT marked visited, so a pixel the border ring could not
     claim can still be claimed later by a colour picked by hand. Each pixel being tested at most
     four times is what that costs. */
  function scratchCutout(base, tol, seeds){
    const w = base.width, h = base.height, n = w * h;
    const d = base.getContext('2d').getImageData(0, 0, w, h).data;
    /* Squared distance throughout — the comparison never needs the root, and skipping it takes the
       one operation that would otherwise run millions of times off the hot path. The weights are
       the usual cheap stand-in for how much each channel actually matters to the eye. */
    const max = tol * tol;
    const mark = new Uint8Array(n);    // 1 = background
    const ref = new Int32Array(n);     // which seed's colour this pixel was judged against
    const q = new Int32Array(n);       // a typed queue, not a JS array: this holds up to n entries
    let head = 0, tail = 0;
    const near = (i, r) => {
      const a = i << 2, b = r << 2;
      const dr = d[a] - d[b], dg = d[a + 1] - d[b + 1], db = d[a + 2] - d[b + 2];
      return 2 * dr * dr + 4 * dg * dg + 3 * db * db <= max;
    };
    const push = (i, r) => {
      if(mark[i]) return;
      // already transparent — background by definition, and it carries the seed's colour onwards
      // so the fill flows straight through a hole a previous cut-out left behind
      if(d[(i << 2) + 3] === 0 || near(i, r)){ mark[i] = 1; ref[i] = r; q[tail++] = i; }
    };
    for(let x = 0; x < w; x++){ push(x, x); push((h - 1) * w + x, (h - 1) * w + x); }
    for(let y = 0; y < h; y++){ push(y * w, y * w); push(y * w + w - 1, y * w + w - 1); }
    for(let s = 0; s < seeds.length; s++){
      const sx = seeds[s][0], sy = seeds[s][1];
      if(sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const i = sy * w + sx;
      if(!mark[i]) push(i, i);   // a hand-picked point is its own reference, whatever it is
    }
    while(head < tail){
      const i = q[head++], r = ref[i], x = i % w;
      if(x > 0) push(i - 1, r);
      if(x < w - 1) push(i + 1, r);
      if(i >= w) push(i - w, r);
      if(i < n - w) push(i + w, r);
    }
    /* THE EDGE is what separates a cut-out from a bad cut-out. A hard mask leaves a one-pixel
       fringe of the old background all the way round the subject — the pixels the lens, or the
       JPEG, already blended half and half — and that bright halo is exactly what makes a pasted
       photo look pasted. So every kept pixel that touches a removed one is given a partial alpha
       from how far its colour still is from the background beside it, and is then un-blended
       against that background (the standard c = (c - bg(1 - a)) / a). Hair lit against a white
       wall comes back as hair rather than as white.
       Uint8ClampedArray is doing real work in that division: an un-blend can overshoot both ends,
       and the array clamps each channel on assignment instead of needing three Math.min calls. */
    const out = new Uint8ClampedArray(d);
    const soft = Math.max(1, max * 1.9);   // the squared-distance band the fringe fades across
    for(let i = 0; i < n; i++){
      if(mark[i]){ out[(i << 2) + 3] = 0; continue; }
      const x = i % w;
      let r = -1;
      if(x > 0 && mark[i - 1]) r = ref[i - 1];
      else if(x < w - 1 && mark[i + 1]) r = ref[i + 1];
      else if(i >= w && mark[i - w]) r = ref[i - w];
      else if(i < n - w && mark[i + w]) r = ref[i + w];
      if(r < 0) continue;                  // interior: nothing to feather against
      const a4 = i << 2, b4 = r << 2;
      const dr = d[a4] - d[b4], dg = d[a4 + 1] - d[b4 + 1], db = d[a4 + 2] - d[b4 + 2];
      const dist = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if(dist >= max + soft) continue;     // far enough from the background to stay fully solid
      const a = scratchClamp01((dist - max) / soft);
      out[a4 + 3] = Math.round(d[a4 + 3] * a);
      // below this the pixel is mostly background anyway, and the division amplifies its noise
      if(a > 0.15){
        out[a4]     = (d[a4]     - d[b4]     * (1 - a)) / a;
        out[a4 + 1] = (d[a4 + 1] - d[b4 + 1] * (1 - a)) / a;
        out[a4 + 2] = (d[a4 + 2] - d[b4 + 2] * (1 - a)) / a;
      }
    }
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0);
    return cv;
  }

  /* ---- what is on screen ---- */

  // The Edge slider is 2–100 and this is the only place that turns it into a distance. The metric
  // above tops out at 255 × 3, so a root of 260 is already most of the way to "take everything".
  function scratchStudioTol(){ return (studio ? studio.key.tol : 22) * 2.6; }

  /* The cut-out is recomputed lazily and cached on `out`, which every mutation clears. That single
     rule is what keeps the live model honest: nothing has to remember to re-run the fill, it only
     has to remember to forget the answer. */
  function studioResult(){
    if(!studio || !studio.base) return null;
    if(!studio.key.on) return studio.base;
    if(!studio.out) studio.out = scratchCutout(studio.base, scratchStudioTol(), studio.key.seeds);
    return studio.out;
  }

  function scratchStudioDirty(){
    return !!(studio && studio.editable && (studio.base !== studio.orig || studio.key.on));
  }

  function renderScratchStudio(){
    if(!studio) return;
    const cv = el('scratchImgCanvas'), frame = el('scratchImgFrame'), ov = el('scratchImgOverlay');
    const src = studio.editable ? studioResult() : null;
    if(src && cv){
      if(cv.width !== src.width || cv.height !== src.height){ cv.width = src.width; cv.height = src.height; }
      const c = cv.getContext('2d');
      c.clearRect(0, 0, cv.width, cv.height);   // or a cut-out's holes would show the previous frame
      c.drawImage(src, 0, 0);
    }
    if(frame) frame.classList.toggle('is-alpha', !!(src && studio.key.on));
    if(ov) ov.classList.toggle('is-picking', !!(src && studio.key.on && studio.mode === 'view'));
    renderScratchStudioCrop();
    renderScratchStudioBar();
  }

  function renderScratchStudioCrop(){
    const layer = el('scratchImgCropLayer'), rect = el('scratchImgCropRect');
    if(!layer || !rect) return;
    if(!studio || studio.mode !== 'crop' || !studio.crop){ layer.style.display = 'none'; return; }
    layer.style.display = 'block';
    const c = studio.crop;
    // percentages of the frame, which IS the picture — see .scratch-imgview-frame in styles.css
    rect.style.left = (c.x * 100) + '%';
    rect.style.top = (c.y * 100) + '%';
    rect.style.width = (c.w * 100) + '%';
    rect.style.height = (c.h * 100) + '%';
  }

  const SCRATCH_STUDIO_HINTS = {
    view:  'Crop it, or lift the subject off a plain background.',
    key:   'Click any colour in the picture to take that out as well · Edge tunes how much goes.',
    crop:  'Drag the box or its handles · drag anywhere else on the picture to start a new one.',
    plain: 'This picture is hosted somewhere that won’t let it be edited here — you can still look at it.'
  };

  function renderScratchStudioBar(){
    const cropBtn = el('scratchImgCropBtn'), cutBtn = el('scratchImgCutBtn'), tol = el('scratchImgTolWrap'),
          ok = el('scratchImgCropOkBtn'), no = el('scratchImgCropNoBtn'),
          reset = el('scratchImgResetBtn'), save = el('scratchImgSaveBtn'), hint = el('scratchImgHint');
    if(!cropBtn || !hint) return;
    const on = !!(studio && studio.editable), cropping = !!(on && studio.mode === 'crop');
    const show = (node, yes) => { if(node) node.style.display = yes ? '' : 'none'; };
    show(cropBtn, on && !cropping);
    show(cutBtn, on && !cropping);
    show(tol, on && !cropping && studio.key.on);
    show(ok, cropping);
    show(no, cropping);
    show(reset, on);
    show(save, on);
    if(on){
      const dirty = scratchStudioDirty();
      cutBtn.classList.toggle('is-on', !!studio.key.on);
      reset.disabled = !dirty || studio.busy;
      save.disabled = !dirty || studio.busy;
    }
    /* Nothing at all until the readable copy has been tried: `plain` is a verdict, and announcing
       "this can't be edited" during the fetch that decides whether it can would be a lie half the
       time — one that then corrects itself, which is worse than the empty line it replaced. */
    hint.textContent = (studio && studio.msg) || (!on ? (studio && studio.probed ? SCRATCH_STUDIO_HINTS.plain : '')
      : cropping ? SCRATCH_STUDIO_HINTS.crop
      : studio.key.on ? SCRATCH_STUDIO_HINTS.key
      : SCRATCH_STUDIO_HINTS.view);
  }

  /* ---- open and close ---- */

  function openScratchImgView(img){
    const ov = el('scratchImgOverlay'), big = el('scratchImgViewImg'), cv = el('scratchImgCanvas');
    if(!ov || !big || !img) return;
    hideScratchImgBox();
    const url = img.getAttribute('src') || '';
    studio = { target: img, url: url, editable: false, busy: false, mode: 'view', msg: '',
               probed: false, orig: null, base: null, out: null, crop: null,
               key: { on: false, tol: 22, seeds: [] } };
    // shown from the <img> first and swapped to the canvas once the readable copy lands: the photo
    // is usually already in the browser's cache, so this puts it on screen with no wait at all
    big.src = url;
    big.alt = img.getAttribute('alt') || '';
    big.style.display = '';
    if(cv) cv.style.display = 'none';
    const tol = el('scratchImgTol');
    if(tol) tol.value = String(studio.key.tol);
    ov.style.display = 'flex';
    ov.classList.remove('is-busy');
    scratchImgViewOn = true;
    renderScratchStudio();
    /* Fetched a SECOND time with crossOrigin set, because the fetch above had no such flag and a
       canvas that has had a non-CORS image drawn into it can never be read back — the taint is on
       the canvas, not on the request, so there is no way to test for it after the fact except to
       try. Supabase Storage answers with a wildcard header, so this is free for anything this app
       uploaded; anything else falls through to view-only rather than to a broken button. */
    const probe = new Image();
    probe.crossOrigin = 'anonymous';
    probe.onload = ()=>{
      if(!studio || studio.url !== url) return;   // closed, or another picture opened meanwhile
      studio.probed = true;
      let base;
      try{
        base = scratchStudioCanvas(probe);
        base.getContext('2d').getImageData(0, 0, 1, 1);   // the taint check, and the only one that counts
      }catch(e){ renderScratchStudio(); return; }
      studio.orig = studio.base = base;
      studio.editable = true;
      big.style.display = 'none';
      if(cv) cv.style.display = '';
      renderScratchStudio();
    };
    probe.onerror = ()=>{ if(studio && studio.url === url){ studio.probed = true; renderScratchStudio(); } };
    probe.src = url;
    const close = el('scratchImgViewClose');
    if(close) close.focus({ preventScroll: true });
  }

  /* `force` is for the one caller that cannot be refused: closeScratch() is already tearing the pad
     down, and a prompt there would leave the studio on screen over a page that had gone. */
  function closeScratchImgView(force){
    const ov = el('scratchImgOverlay'), big = el('scratchImgViewImg'), cv = el('scratchImgCanvas');
    if(!ov) return;
    if(!force){
      if(studio && studio.busy) return;   // an upload is in flight; it closes itself when it lands
      if(scratchStudioDirty() && !window.confirm('Discard the changes to this picture?')) return;
    }
    ov.style.display = 'none';
    ov.classList.remove('is-picking', 'is-busy');
    scratchImgViewOn = false;
    scratchCropDrag = null;
    if(studioRaf){ cancelAnimationFrame(studioRaf); studioRaf = 0; }
    studio = null;
    /* Drop every decoded bitmap rather than leaving a full-resolution photo — plus a cut-out of it,
       plus the canvas holding the result — alive behind a display:none. These come from Storage and
       are several megabytes each once decoded. */
    if(big) big.removeAttribute('src');
    if(cv){ cv.width = cv.height = 1; }
    focusScratchSurface();
  }

  /* ---- the edits ---- */

  function toggleScratchCutout(){
    if(!studio || !studio.editable || studio.busy) return;
    studio.key.on = !studio.key.on;
    studio.key.seeds = [];   // turning it off and on again is a fresh start, not a resumed one
    studio.out = null;
    studio.msg = '';
    renderScratchStudio();
  }

  function beginScratchCrop(){
    if(!studio || !studio.editable || studio.busy) return;
    studio.mode = 'crop';
    // an inset default rather than the whole picture: a box with margin around it says "drag me",
    // and one flush to the edges has no dim surround to show what cropping even means
    if(!studio.crop) studio.crop = { x: 0.08, y: 0.08, w: 0.84, h: 0.84 };
    studio.msg = '';
    renderScratchStudio();
  }

  function cancelScratchCrop(){
    if(!studio) return;
    studio.mode = 'view';
    studio.crop = null;
    renderScratchStudio();
  }

  function applyScratchCrop(){
    if(!studio || studio.mode !== 'crop' || !studio.crop) return;
    /* Cropping BAKES what is on screen, cut-out included, and then clears the key. It is the one
       operation that has to, because a live cut-out's seeds are the OLD border ring and the crop
       has just thrown that border away — carrying them across would be carrying a reference to
       pixels that no longer exist. Baking keeps exactly the picture you were looking at, and
       leaves the button free to run again on the new edges: a pixel that is already transparent
       seeds the next fill for free (see push() above), so a second run picks up where this one
       left off rather than starting blind. */
    const src = studioResult(), c = studio.crop;
    if(!src) return;
    const sx = Math.round(c.x * src.width), sy = Math.round(c.y * src.height);
    const sw = Math.max(1, Math.round(c.w * src.width)), sh = Math.max(1, Math.round(c.h * src.height));
    const cv = document.createElement('canvas');
    cv.width = sw; cv.height = sh;
    cv.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    studio.base = cv;
    studio.key.on = false; studio.key.seeds = []; studio.out = null;
    studio.crop = null; studio.mode = 'view'; studio.msg = '';
    renderScratchStudio();
  }

  function resetScratchStudio(){
    if(!studio || !studio.editable || studio.busy) return;
    studio.base = studio.orig;   // never a copy: orig is only ever drawn FROM, never drawn into
    studio.out = null; studio.crop = null; studio.mode = 'view'; studio.msg = '';
    studio.key = { on: false, tol: studio.key.tol, seeds: [] };
    renderScratchStudio();
  }

  function failScratchStudio(msg){
    setScratchStatus('dirty');
    if(!studio) return;
    studio.busy = false;
    studio.msg = msg;
    const ov = el('scratchImgOverlay');
    if(ov) ov.classList.remove('is-busy');
    renderScratchStudioBar();
  }

  function saveScratchStudio(){
    if(!studio || !studio.editable || studio.busy || !scratchStudioDirty()) return;
    const img = studio.target, surf = el('scratchText'), src = studioResult();
    if(!src) return;
    // it can only have gone if the pad was torn down under us, but the upload below writes to this
    // node, and a write into a detached image is an edit that silently never happened
    if(!surf || !surf.contains(img)){ closeScratchImgView(true); return; }
    /* The width ATTRIBUTE is scaled by how much of the picture survived, never left alone: a crop
       down to half the pixels, still carrying the width the whole photo had, would blow the
       remaining half up to the size the original used to be. Measured against studio.orig rather
       than against naturalWidth, so it stays right even where scratchStudioCanvas() downscaled the
       working copy. Nothing is written where there was no width to begin with — that image is
       being laid out by the column, and should go on being laid out by the column. */
    const attr = parseInt(img.getAttribute('width') || '', 10);
    const ratio = studio.orig && studio.orig.width ? src.width / studio.orig.width : 1;
    studio.busy = true;
    studio.msg = 'Saving…';
    const ov = el('scratchImgOverlay');
    if(ov) ov.classList.add('is-busy');
    renderScratchStudioBar();
    setScratchStatus('uploading');
    /* PNG on the way out, always — and uploadCompressedImage() is what decides what actually gets
       stored: it re-encodes a fully opaque result as JPEG and keeps PNG only where some pixel is
       genuinely transparent (js/core.js). So a crop is stored as a photo-sized JPEG and a cut-out
       keeps its alpha, with no format argument passed from here at all. */
    src.toBlob(blob=>{
      if(!blob){ failScratchStudio('Couldn’t read that picture back.'); return; }
      uploadCompressedImage(blob, 1400, 0.86, 'scratch').then(url=>{
        if(!scratchOpen || !surf.contains(img)) return;   // the pad went while this was in flight
        img.setAttribute('src', url);
        if(attr) setScratchImgWidth(img, Math.round(attr * ratio));
        // the URL it replaced now belongs to no page, so the sweep on close reclaims its file —
        // and this one has to be known immediately, or that same sweep would reclaim the new one
        scratchKnownImages.add(url);
        setScratchStatus('dirty');
        onScratchInput();
        if(studio) studio.busy = false;
        closeScratchImgView(true);
      }).catch(err=> failScratchStudio((err && err.message) || 'Couldn’t save that picture.'));
    }, 'image/png');
  }

  /* ---- the crop gesture ----
     One pointer handler for the whole layer, and which of the three gestures it is comes from what
     was under the finger: a handle resizes the edges it names, the rect itself moves, and the dim
     surround starts a fresh selection. Pointer capture goes on the LAYER, never on a handle — the
     same rule the scratch dot row follows, for a related reason: the layer is the node that is
     certainly still there at the end of the gesture, whatever happens to the rest.
     Everything is in fractions of the picture, so the numbers that come out of a drag are already
     the numbers applyScratchCrop() needs — no screen-to-source conversion anywhere. */
  let scratchCropDrag = null;

  function scratchCropPoint(e){
    const frame = el('scratchImgFrame');
    if(!frame) return { x: 0, y: 0 };
    const r = frame.getBoundingClientRect();
    return { x: r.width ? (e.clientX - r.left) / r.width : 0, y: r.height ? (e.clientY - r.top) / r.height : 0 };
  }

  function onScratchCropDown(e){
    if(!studio || studio.mode !== 'crop' || !studio.crop) return;
    const layer = el('scratchImgCropLayer');
    const t = e.target, h = t && t.getAttribute ? t.getAttribute('data-h') : null;
    const p = scratchCropPoint(e);
    e.preventDefault();
    if(h) scratchCropDrag = { kind: 'edge', h: h };
    else if(t && t.closest && t.closest('#scratchImgCropRect')) scratchCropDrag = { kind: 'move', px: p.x, py: p.y, c: studio.crop };
    else {
      scratchCropDrag = { kind: 'new', ax: scratchClamp01(p.x), ay: scratchClamp01(p.y) };
      studio.crop = { x: scratchCropDrag.ax, y: scratchCropDrag.ay, w: 0, h: 0 };
      renderScratchStudioCrop();
    }
    scratchCropDrag.id = e.pointerId;
    try{ layer.setPointerCapture(e.pointerId); }catch(err){}
  }

  function onScratchCropMove(e){
    const g = scratchCropDrag;
    if(!g || !studio || !studio.crop || e.pointerId !== g.id) return;
    const p = scratchCropPoint(e), MIN = SCRATCH_STUDIO_MINCROP;
    if(g.kind === 'new'){
      const x = scratchClamp01(p.x), y = scratchClamp01(p.y);
      studio.crop = { x: Math.min(g.ax, x), y: Math.min(g.ay, y), w: Math.abs(x - g.ax), h: Math.abs(y - g.ay) };
    } else if(g.kind === 'move'){
      // the whole rect stays inside the picture, so a move can never carry the crop past an edge
      studio.crop = { x: Math.max(0, Math.min(1 - g.c.w, g.c.x + (p.x - g.px))),
                      y: Math.max(0, Math.min(1 - g.c.h, g.c.y + (p.y - g.py))), w: g.c.w, h: g.c.h };
    } else {
      const c = studio.crop;
      let l = c.x, t2 = c.y, r = c.x + c.w, b = c.y + c.h;
      // 'nw' names both of its edges, so testing for each letter handles corners and sides alike;
      // each moving edge is clamped against the opposite one so the rect can't turn inside out
      if(g.h.indexOf('w') >= 0) l = Math.max(0, Math.min(scratchClamp01(p.x), r - MIN));
      if(g.h.indexOf('e') >= 0) r = Math.min(1, Math.max(scratchClamp01(p.x), l + MIN));
      if(g.h.indexOf('n') >= 0) t2 = Math.max(0, Math.min(scratchClamp01(p.y), b - MIN));
      if(g.h.indexOf('s') >= 0) b = Math.min(1, Math.max(scratchClamp01(p.y), t2 + MIN));
      studio.crop = { x: l, y: t2, w: r - l, h: b - t2 };
    }
    renderScratchStudioCrop();
  }

  function endScratchCropDrag(){
    const g = scratchCropDrag;
    if(!g) return;
    scratchCropDrag = null;
    const layer = el('scratchImgCropLayer');
    try{ if(layer) layer.releasePointerCapture(g.id); }catch(err){}
    /* A tap on the dim surround, or a drag of three pixels, leaves a rect too small to grab again —
       so the floor is enforced here rather than during the drag, where it would make the box stop
       following the finger. Grown around where it was drawn, then pushed back inside the picture. */
    const MIN = SCRATCH_STUDIO_MINCROP, c = studio && studio.crop;
    if(c){
      if(c.w < MIN){ c.w = MIN; c.x = Math.max(0, Math.min(1 - MIN, c.x - MIN / 2)); }
      if(c.h < MIN){ c.h = MIN; c.y = Math.max(0, Math.min(1 - MIN, c.y - MIN / 2)); }
    }
    renderScratchStudioCrop();
  }

  /* Picking a colour to remove is a click on the picture itself, which is why the canvas takes a
     crosshair while a cut-out is showing. The click maps back to a source pixel through the
     canvas's own rect — the same fraction-of-the-picture arithmetic the crop uses. */
  function onScratchStudioPick(e){
    if(!studio || !studio.editable || !studio.key.on || studio.mode !== 'view' || studio.busy) return;
    const cv = el('scratchImgCanvas');
    if(!cv) return;
    const r = cv.getBoundingClientRect();
    if(!r.width || !r.height) return;
    const x = Math.floor((e.clientX - r.left) / r.width * cv.width);
    const y = Math.floor((e.clientY - r.top) / r.height * cv.height);
    if(x < 0 || y < 0 || x >= cv.width || y >= cv.height) return;
    studio.key.seeds.push([x, y]);
    studio.out = null;
    renderScratchStudio();
  }

  /* ---------- find across pages ----------
     The browser's own Ctrl+F can only see the DOM, and six of your seven pages are not IN the DOM
     — they are HTML strings in state.scratch.pages. So the native find is not merely worse here,
     it is wrong: it reports "no results" for text that is demonstrably in your napkin. That is the
     whole reason this exists and the reason Ctrl+F is taken over rather than left alone.

     The hard constraint is that search must not write anything, ever. The surface's innerHTML IS
     the saved state — onScratchInput() reads it straight into the page and debounces a save — so
     wrapping hits in <mark> would persist the search UI into the document the moment any save
     fired, which is the same trap the "uploading…" marker is deliberately kept out of state for.
     Nothing below mutates the surface. Matches are tinted with the CSS Custom Highlight API
     (ranges handed to the renderer, no nodes touched) and, where that isn't supported, the current
     hit is merely SELECTED — which needs no DOM either. Search degrades to "jump to it", never to
     "corrupt the page".

     It is also not persisted: which page you are on is a preference, but a half-typed query is not,
     so unlike the format bar this leaves no key in state.scratch. */

  const SCRATCH_FIND_MAX = 400;      // total hits tracked; a query of "e" shouldn't build an essay
  const SCRATCH_FIND_ROWS = 50;      // rows drawn in the panel; the rest are counted, not listed
  // Elements that put a line break between their text and the next. Used to keep the flattened
  // string honest — without it "<div>a</div><div>b</div>" reads as "ab" and matches "ab".
  const SCRATCH_FIND_BLOCK = /^(DIV|P|LI|UL|OL|BLOCKQUOTE|PRE|H1|H2|H3)$/;

  /* Is the Custom Highlight API here? Chrome 105+, Safari 17.2+, Firefox 140+. Feature-detected
     rather than version-sniffed, and every use is wrapped, because the fallback is genuinely fine. */
  const SCRATCH_HAS_HL = (function(){
    try{ return typeof Highlight === 'function' && !!(window.CSS && CSS.highlights); }
    catch(e){ return false; }
  })();

  let scratchFindOn = false;
  let scratchHits = [];
  let scratchHitAt = -1;          // -1 = nothing stepped to yet; the panel is a list, not a cursor
  let scratchFindTimer = null;

  /* ONE flattener for both sides of the search: the live surface (where a hit has to become a real
     Range) and a stored page's HTML (where only the text matters). Using the same walk for both is
     what guarantees the Nth hit found in a stored page is the Nth hit in the DOM once you switch to
     it — two different text extractions would drift apart the moment a match sat across a <b>.
     The map is only built when asked for: the cached stored pages keep strings, not nodes. */
  function scratchFlatten(root, wantMap){
    const parts = [], map = wantMap ? [] : null;
    let len = 0;
    (function walk(n){
      for(let c = n.firstChild; c; c = c.nextSibling){
        if(c.nodeType === 3){
          const v = c.nodeValue || '';
          if(!v) continue;
          if(map) map.push({ node: c, at: len });
          parts.push(v); len += v.length;
        } else if(c.nodeType === 1){
          if(c.tagName === 'BR'){ parts.push('\n'); len += 1; continue; }
          const block = SCRATCH_FIND_BLOCK.test(c.tagName);
          if(block && len && parts[parts.length - 1] !== '\n'){ parts.push('\n'); len += 1; }
          walk(c);
          if(block){ parts.push('\n'); len += 1; }
        }
      }
    })(root);
    return { text: parts.join(''), map: map };
  }

  function scratchStoredText(p){
    const c = scratchCacheFor(p);
    if(c.text === undefined){
      const doc = new DOMParser().parseFromString('<body>' + c.html + '</body>', 'text/html');
      c.text = scratchFlatten(doc.body, false).text;
    }
    return c.text;
  }

  /* Plain substring, case-insensitive, non-overlapping — not a regex. A napkin search box is a
     place people type "(" and "?" without meaning anything by it.
     The length guard is not paranoia: toLowerCase() is length-preserving for almost everything but
     not quite all of Unicode (Turkish dotted I becomes two code units), and a single shifted offset
     would land every subsequent jump on the wrong character. When folding changes the length at
     all, fall back to an exact-case search, which is always aligned. */
  function scratchFindAll(text, q){
    const out = [];
    if(!q) return out;
    let hay = text.toLowerCase(), needle = q.toLowerCase();
    if(hay.length !== text.length){ hay = text; needle = q; }
    let i = hay.indexOf(needle);
    while(i >= 0 && out.length < SCRATCH_FIND_MAX){
      out.push(i);
      i = hay.indexOf(needle, i + needle.length);
    }
    return out;
  }

  function scratchSnippet(text, start, end){
    const lead = 34, trail = 52;
    const from = Math.max(0, start - lead);
    return {
      before: (from > 0 ? '…' : '') + text.slice(from, start).replace(/\s+/g, ' '),
      hit: text.slice(start, end).replace(/\s+/g, ' '),
      after: text.slice(end, end + trail).replace(/\s+/g, ' ') + (end + trail < text.length ? '…' : '')
    };
  }

  // Every hit in the whole stack, in page order. The ACTIVE page is read from the LIVE surface, not
  // from state, so what you typed ten seconds ago and haven't saved yet is searchable too.
  function scratchCollectHits(q){
    ensureScratchPages();
    const pages = state.scratch.pages, active = scratchActiveIndex(), surf = el('scratchText');
    const hits = [];
    for(let i = 0; i < pages.length && hits.length < SCRATCH_FIND_MAX; i++){
      const text = (i === active && surf) ? scratchFlatten(surf, false).text : scratchStoredText(pages[i]);
      const at = scratchFindAll(text, q);
      const title = scratchPageTitle(pages[i]);
      for(let k = 0; k < at.length && hits.length < SCRATCH_FIND_MAX; k++){
        hits.push({ page: i, title: title, start: at[k], end: at[k] + q.length, snip: scratchSnippet(text, at[k], at[k] + q.length) });
      }
    }
    return hits;
  }

  /* A flat offset pair becomes a Range. Both ends are resolved separately because a match can span
     two text nodes with nothing between them — "he<b>llo</b>" is one word to a reader and to this
     flattener, but two nodes to the DOM. A hit can never span one of the "\n" separators, since
     those aren't in any node and a single-line query can't contain one. */
  function scratchRangeFor(map, start, end){
    let s = null, e = null;
    for(let i = 0; i < map.length; i++){
      const node = map[i].node, a = map[i].at, b = a + (node.nodeValue || '').length;
      if(!s && start >= a && start < b) s = { node: node, offset: start - a };
      if(!e && end > a && end <= b) e = { node: node, offset: end - a };
      if(s && e) break;
    }
    if(!s || !e) return null;
    try{
      const r = document.createRange();
      r.setStart(s.node, s.offset);
      r.setEnd(e.node, e.offset);
      return r;
    }catch(err){ return null; }
  }

  function scratchClearHitPaint(){
    if(!SCRATCH_HAS_HL) return;
    try{ CSS.highlights.delete('scratch-find'); CSS.highlights.delete('scratch-find-on'); }catch(e){}
  }

  /* Tint every hit on the page you're looking at, and the stepped-to one more strongly. Ranges
     only — nothing here touches a node, which is the whole reason this feature is allowed to exist
     over a surface whose innerHTML is the saved document. */
  function scratchPaintHits(){
    const surf = el('scratchText');
    if(!surf || !scratchFindOn){ scratchClearHitPaint(); return; }
    const active = scratchActiveIndex();
    const flat = scratchFlatten(surf, true);
    const current = scratchHits[scratchHitAt];
    let currentRange = null;
    if(!SCRATCH_HAS_HL){
      // No Highlight API: the best that can be done without touching the DOM is to select the
      // stepped-to hit. Selecting is not focusing, so the query box keeps the caret.
      if(current && current.page === active){
        const r = scratchRangeFor(flat.map, current.start, current.end);
        if(r){ const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); currentRange = r; }
      }
      return currentRange;
    }
    const all = [], one = [];
    for(let i = 0; i < scratchHits.length; i++){
      if(scratchHits[i].page !== active) continue;
      const r = scratchRangeFor(flat.map, scratchHits[i].start, scratchHits[i].end);
      if(!r) continue;
      if(i === scratchHitAt){ one.push(r); currentRange = r; } else all.push(r);
    }
    try{
      CSS.highlights.set('scratch-find', new Highlight(...all));
      CSS.highlights.set('scratch-find-on', new Highlight(...one));
    }catch(e){ /* an engine that has the names but not the constructor shape — tinting is optional */ }
    return currentRange;
  }

  // Scrolls the stepped-to hit into the middle of the surface WITHOUT focusing it: focus belongs to
  // the query box you are still typing in.
  /* instant: skip the smooth animation. Used straight after a page change, where the surface's
     scrollTop was just reset to 0 by the innerHTML swap — smoothly travelling that whole distance
     while the page-turn animation plays on top reads as a lurch, and the two fight each other. */
  function scratchScrollToHit(range, instant){
    const surf = el('scratchText');
    if(!surf || !range) return;
    const sr = surf.getBoundingClientRect(), rr = range.getBoundingClientRect();
    if(!rr.height && !rr.width) return;
    let smooth = !instant;
    try{ if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) smooth = false; }catch(e){}
    const top = surf.scrollTop + (rr.top - sr.top) - (sr.height / 2) + (rr.height / 2);
    try{ surf.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' }); }
    catch(e){ surf.scrollTop = Math.max(0, top); }
  }

  /* Puts the caret AT the match, collapsed to its start rather than selecting it. Selecting would
     be the conventional find-bar behaviour, but this is a results list you clicked to be taken
     somewhere: focus has just moved into the writing, and a selected match means the next character
     typed REPLACES the thing you went looking for. The match stays obvious either way, because
     scratchPaintHits() tints it.
     Touch is left unfocused, the same rule the rest of this file follows — "take me there" is a
     reading action and must not throw up the keyboard over the thing you asked to see. */
  function placeScratchCaretAtHit(range){
    const surf = el('scratchText');
    if(!surf || !range || !scratchWantsAutoFocus()) return;
    try{
      const caret = range.cloneRange();
      caret.collapse(true);
      surf.focus({ preventScroll: true });   // preventScroll: the reveal above already positioned it
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(caret);
    }catch(e){ /* a range that no longer resolves — the scroll already did the useful part */ }
  }

  /* Step to hit n, switching pages if it lives on another one. Deliberately NOT called while you
     type: auto-jumping would flip the page under you on every keystroke of a query, and each flip
     is a real state change that saves. Typing narrows the list; Enter, the arrows and a click on a
     row are what move you.
     opts.focus is the difference between the two ways of getting here. Enter and the arrows STEP
     through matches, so focus stays in the query box you are still typing in. Clicking a row is
     "take me there", so the caret lands at the match and the writing takes focus. */
  function scratchFindGo(n, opts){
    if(!scratchHits.length) return;
    const i = ((n % scratchHits.length) + scratchHits.length) % scratchHits.length;
    scratchHitAt = i;
    const hit = scratchHits[i];
    const moved = hit.page !== scratchActiveIndex();
    // keepFocus: jumping to a hit must not pull the caret out of the query box
    if(moved) scratchGoTo(hit.page, { keepFocus: true });
    const land = ()=>{
      const range = scratchPaintHits();
      scratchScrollToHit(range, moved);
      if(opts && opts.focus) placeScratchCaretAtHit(range);
      renderScratchFindPanel();
    };
    /* After a page change the reveal waits one frame. scratchGoTo() has just replaced the surface's
       innerHTML — which resets scrollTop to 0 — and started the 180ms page-turn animation, in this
       same tick. Measuring and scrolling before the browser has settled that layout is why landing
       on a match on ANOTHER page sometimes didn't move at all: the scroll was computed against a
       stale box and then overrun by the animation. One frame later everything is real. */
    if(moved) requestAnimationFrame(land); else land();
  }

  function renderScratchFindPanel(){
    const panel = el('scratchSearchResults'), count = el('scratchSearchCount');
    if(!panel || !count) return;
    if(!scratchHits.length){
      const q = (el('scratchSearchInput') || {}).value || '';
      count.textContent = q ? 'no matches' : '';
      panel.innerHTML = '';
      panel.style.display = 'none';
      return;
    }
    count.textContent = (scratchHitAt >= 0 ? (scratchHitAt + 1) + ' of ' : '') + scratchHits.length;
    let h = '';
    const shown = Math.min(scratchHits.length, SCRATCH_FIND_ROWS);
    for(let i = 0; i < shown; i++){
      const hit = scratchHits[i];
      h += '<button type="button" class="scratch-sr' + (i === scratchHitAt ? ' is-on' : '') + '" data-hit="' + i + '">'
         + '<span class="scratch-sr-page">' + escapeHtml(hit.title) + '</span>'
         + '<span class="scratch-sr-text">' + escapeHtml(hit.snip.before)
         + '<b>' + escapeHtml(hit.snip.hit) + '</b>'
         + escapeHtml(hit.snip.after) + '</span></button>';
    }
    if(scratchHits.length > shown) h += '<div class="scratch-sr-more">…and ' + (scratchHits.length - shown) + ' more</div>';
    panel.innerHTML = h;
    panel.style.display = 'block';
    const on = panel.querySelector('.scratch-sr.is-on');
    if(on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  }

  // The find-as-you-type step: rebuild the hit list, repaint the current page, redraw the panel.
  // Keeps the stepped-to position only while it still points at something.
  function runScratchFind(){
    if(!scratchFindOn) return;
    const box = el('scratchSearchInput');
    const q = box ? box.value : '';
    scratchHits = q ? scratchCollectHits(q) : [];
    if(scratchHitAt >= scratchHits.length) scratchHitAt = scratchHits.length ? 0 : -1;
    scratchPaintHits();
    renderScratchFindPanel();
  }

  // Edits to the page while the panel is open move every offset after them, so the list is re-run
  // rather than left to point at stale positions. Throttled because it re-reads the whole stack.
  function scheduleScratchFind(){
    if(scratchFindTimer) return;
    scratchFindTimer = setTimeout(()=>{ scratchFindTimer = null; runScratchFind(); }, 200);
  }

  function openScratchFind(){
    const wrap = el('scratchSearch'), box = el('scratchSearchInput');
    if(!wrap || !box) return;
    closeScratchHelp();   // one panel at a time; they share the same corner of the footer
    scratchFindOn = true;
    wrap.style.display = 'block';
    box.focus();
    box.select();          // a second Ctrl+F re-queries rather than appending to the last query
    runScratchFind();
  }

  /* silent: closing the whole napkin shouldn't hand focus back to a surface that is about to be
     hidden anyway. Everything else about the teardown is the same either way — no state to save,
     because a query was never state. */
  function closeScratchFind(silent){
    const wrap = el('scratchSearch');
    scratchFindOn = false;
    scratchHits = [];
    scratchHitAt = -1;
    if(scratchFindTimer){ clearTimeout(scratchFindTimer); scratchFindTimer = null; }
    scratchClearHitPaint();
    if(wrap) wrap.style.display = 'none';
    const panel = el('scratchSearchResults');
    if(panel){ panel.innerHTML = ''; panel.style.display = 'none'; }
    if(!silent) focusScratchSurface();
  }

  /* ---------- the format bar ----------
     Bold / italic / underline / strike, font, size, colour and highlight. The napkin has almost no
     chrome on purpose, so this row is held at the same --faint weight as the dots and the footer,
     sits BELOW the writing (never over it, unlike a selection popover — which would also fight the
     native text-selection callout on a phone), and scrolls sideways rather than wrapping, because a
     second row would shove the writing area up every time the soft keyboard opened.

     Everything here goes through execCommand, for the reason the section above already records:
     it is the only way to edit a contenteditable that keeps the browser's own undo stack intact.

     The non-obvious decision is that styleWithCSS is deliberately held OFF, so the commands emit
     the LEGACY <font size|face|color> form rather than inline CSS. Three things that buys:
       - The size scale is OURS. <font size> is seven named buckets, restyled in styles.css to this
         page's own px scale, so "L" is a value this page chose rather than the browser's idea of
         what "x-large" means.
       - The sanitizer's job stays small: three attributes with three tight regexes, instead of
         having to trust a CSS parser for the common case.
       - It round-trips identically everywhere. With styleWithCSS ON, Chrome writes
         "-webkit-xxx-large" where Firefox writes "xx-large" for the very same command, so a page
         written on one browser would come out a different size on the other.
     Highlight is the one exception — there is no <font> form of a background — so the flag is
     flipped on for exactly that one call and straight back off; safeScratchStyle() is what covers
     the <span style="background-color"> it leaves behind. */

  // Font faces are unquoted on purpose: the value goes into a face="" attribute, and the charset
  // SCRATCH_FACE allows has no quotes to balance and no way out of the attribute.
  const SCRATCH_FONTS = [
    { label: 'Sans',  face: 'Inter, sans-serif' },
    { label: 'Serif', face: 'Georgia, Times New Roman, serif' },
    { label: 'Mono',  face: 'ui-monospace, Consolas, Menlo, monospace' },
    { label: 'Wide',  face: 'Trebuchet MS, Segoe UI, sans-serif' },
    { label: 'Hand',  face: 'Segoe Script, Bradley Hand, cursive' }
  ];
  // The legacy buckets, minus 4 — 3 and 4 are a hair apart and a picker wants distinguishable
  // steps more than it wants completeness. All seven are still styled, so a pasted 4 renders.
  const SCRATCH_SIZES = [
    { label: 'XS', v: '1' }, { label: 'S', v: '2' }, { label: 'M', v: '3' },
    { label: 'L', v: '5' }, { label: 'XL', v: '6' }, { label: 'XXL', v: '7' }
  ];
  /* An ACTION menu, not a setting: it snaps back to reading "Highlight" after each use rather than
     reflecting what's under the caret. Reading it back would mean mapping a computed rgb() — and
     the "no highlight" case, which is rgba(0,0,0,0) in one engine and "transparent" in another —
     onto this list, for a control whose whole job is one-shot. Font and size DO reflect the caret,
     because queryCommandValue answers those exactly. */
  /* TRANSLUCENT, not the flat pastels a highlighter usually is, and that is the whole point: the
     app has four themes and the ink under a highlight stays whatever --text currently is. A solid
     #FDE68A reads perfectly on the light themes and puts near-white text on near-white yellow on
     the dark ones. At these alphas the swatch composites against whatever is behind it, so it
     comes out pale on a light page and a deep muted tint on a dark one, with the text legible on
     both — and no CSS rule has to reach in and override the foreground colour the user picked. */
  const SCRATCH_HILITES = [
    { label: 'Highlight', v: '' },
    { label: 'Yellow', v: 'rgba(250, 204, 21, 0.42)' },
    { label: 'Green',  v: 'rgba(74, 222, 128, 0.38)' },
    { label: 'Blue',   v: 'rgba(96, 165, 250, 0.38)' },
    { label: 'Pink',   v: 'rgba(244, 114, 182, 0.35)' },
    { label: 'Orange', v: 'rgba(251, 146, 60, 0.38)' },
    { label: 'Grey',   v: 'rgba(148, 163, 184, 0.35)' },
    { label: 'None',   v: 'transparent' }
  ];

  /* execCommand only acts on a selection that is genuinely inside THIS editable — the same trap
     insertScratchTick() documents, where the browser quietly appends at the end instead. Pressing
     a toolbar control moves focus out of it, so every control goes through withScratchSelection().
     The buttons cancel their own mousedown, so focus never leaves and there is nothing to restore;
     the <select>s and the colour well CANNOT do that without breaking the native picker, so the
     last in-surface Range is remembered on selectionchange and put back before the command runs. */
  let scratchSavedRange = null;

  function rememberScratchRange(){
    const surf = el('scratchText');
    const sel = window.getSelection();
    if(!surf || !sel || !sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    if(surf.contains(r.commonAncestorContainer)) scratchSavedRange = r.cloneRange();
  }

  function withScratchSelection(fn){
    const surf = el('scratchText');
    if(!surf) return;
    const sel = window.getSelection();
    const inside = sel && sel.rangeCount && surf.contains(sel.getRangeAt(0).commonAncestorContainer);
    if(!inside){
      surf.focus({ preventScroll: true });
      if(scratchSavedRange && surf.contains(scratchSavedRange.commonAncestorContainer)){
        const s2 = window.getSelection();
        s2.removeAllRanges();
        s2.addRange(scratchSavedRange);
      } else {
        // nothing was ever selected here: put the caret somewhere real so the command isn't
        // silently applied to the end of the page
        placeScratchCaretAtEnd(surf);
      }
    }
    fn();
    rememberScratchRange();
    onScratchInput();          // execCommand fires 'input' too, but not on every path in every
                               // engine, and onScratchInput is idempotent
    updateScratchFormatState();
  }

  /* Re-asserted immediately before each command rather than trusted from openScratch(): it is a
     DOCUMENT-wide flag, so anything that ever ran execCommand elsewhere on the page could have
     moved it, and the whole <font> design above depends on it being off. One boolean; not worth
     being clever about. */
  function scratchLegacyMode(){ scratchExec('styleWithCSS', 'false'); }

  /* Collapsed is the DEFAULT, and that is the point. The napkin's whole design is a page with
     nothing on it; a permanent row of controls under every blank page is precisely the chrome this
     thing exists in order not to have. Hiding it costs a mouse user one click on the Aa switch and
     a keyboard user nothing at all — Ctrl+B / Ctrl+I / Ctrl+U are the browser's own and keep
     working whether the bar is up or not.
     Nothing is destroyed on collapse: the bar keeps its listeners and its filled <select>s, so
     this is one style property rather than a teardown, and the state it shows is refreshed on the
     way back up rather than tracked while it's invisible. */
  function applyScratchFormatBar(){
    const bar = el('scratchFormat');
    if(!bar) return;
    const on = !!(state.scratch && state.scratch.fmt);
    bar.style.display = on ? 'flex' : 'none';
    if(on) updateScratchFormatState();
  }

  function scratchFmtCmd(cmd){ withScratchSelection(()=>{ scratchLegacyMode(); scratchExec(cmd); }); }
  function applyScratchFont(face){ withScratchSelection(()=>{ scratchLegacyMode(); scratchExec('fontName', face); }); }
  function applyScratchSize(v){ withScratchSelection(()=>{ scratchLegacyMode(); scratchExec('fontSize', v); }); }
  function applyScratchColor(c){ withScratchSelection(()=>{ scratchLegacyMode(); scratchExec('foreColor', c); }); }

  // The only command with no <font> form, so it's also the only one that needs CSS mode. backColor
  // is Firefox's spelling of the same thing (hiliteColor returns false there); trying one and
  // falling back is cheaper and more durable than sniffing the engine. The flag goes straight back
  // off so nothing else starts emitting inline CSS behind our backs.
  function applyScratchHilite(c){
    withScratchSelection(()=>{
      scratchExec('styleWithCSS', 'true');
      let ok = false;
      try{ ok = document.execCommand('hiliteColor', false, c); }catch(e){ ok = false; }
      if(!ok) scratchExec('backColor', c);
      scratchLegacyMode();
    });
  }

  /* Clear formatting. removeFormat handles the tags and the <font> attributes, but leaves a
     background behind in several engines — it treats it as a property of the span rather than
     formatting — so the highlight is explicitly cleared afterwards. Deliberately does NOT unlink:
     a link is content here, not styling. */
  function clearScratchFormat(){
    withScratchSelection(()=>{
      scratchLegacyMode();
      scratchExec('removeFormat');
      scratchExec('styleWithCSS', 'true');
      let ok = false;
      try{ ok = document.execCommand('hiliteColor', false, 'transparent'); }catch(e){ ok = false; }
      if(!ok) scratchExec('backColor', 'transparent');
      scratchLegacyMode();
    });
  }

  /* What the bar shows about the caret. Cheap, but selectionchange fires on every arrow key, so
     it's coalesced onto a frame. queryCommandState/Value throw in some engines when there is no
     editable context at all (nothing focused yet), hence the try/catch around each. */
  let scratchFmtFrame = 0;
  function scheduleScratchFormatState(){
    if(scratchFmtFrame) return;
    scratchFmtFrame = requestAnimationFrame(()=>{ scratchFmtFrame = 0; updateScratchFormatState(); });
  }

  function updateScratchFormatState(){
    const bar = el('scratchFormat');
    // nothing to update while it's collapsed, and selectionchange fires on every arrow key
    if(!bar || !scratchOpen || !(state.scratch && state.scratch.fmt)) return;
    const btns = bar.querySelectorAll('.scratch-fmt[data-cmd]');
    for(let i=0; i<btns.length; i++){
      let on = false;
      try{ on = document.queryCommandState(btns[i].getAttribute('data-cmd')); }catch(e){ on = false; }
      btns[i].classList.toggle('is-on', !!on);
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    const at = scratchFontAtCaret();
    const sizeSel = el('scratchSizeSel');
    if(sizeSel){
      let idx = -1;
      for(let i=0; i<SCRATCH_SIZES.length; i++) if(SCRATCH_SIZES[i].v === at.size){ idx = i; break; }
      sizeSel.selectedIndex = idx < 0 ? 2 : idx; // unset, or a bucket we don't offer: show M
    }
    const fontSel = el('scratchFontSel');
    if(fontSel){
      // match on the FIRST family only: that is what identifies a stack, and it survives a page
      // written before a stack in the list was edited
      const first = at.face.replace(/["']/g, '').split(',')[0].trim().toLowerCase();
      let idx = 0;
      for(let i=0; i<SCRATCH_FONTS.length; i++){
        if(SCRATCH_FONTS[i].face.split(',')[0].trim().toLowerCase() === first){ idx = i; break; }
      }
      fontSel.selectedIndex = idx;
    }
  }

  /* Size and face are read out of the MARKUP, not from queryCommandValue — the one place the two
     selects differ from the on/off buttons above, which queryCommandState answers correctly.
     queryCommandValue('fontSize') does not report the size attribute that is actually there: it
     reports whichever legacy bucket the browser's own px table puts the COMPUTED size in. Since
     styles.css deliberately restyles those buckets to this page's scale (that being the whole
     point of the <font> design), the two tables disagree — a 26px "XL" came back as "L", and the
     select would silently drift one step every time you looked at it. The attribute is exact and
     is right there.
     Size and face are collected independently on the way up because execCommand nests one <font>
     inside another, so a run that is both Serif and XL has them on two different elements. */
  function scratchFontAtCaret(){
    const out = { size: '', face: '' };
    const surf = el('scratchText');
    const sel = window.getSelection();
    if(!surf || !sel || !sel.rangeCount) return out;
    const r = sel.getRangeAt(0);
    if(!surf.contains(r.startContainer)) return out;
    /* Resolve the range's START POINT to a real leaf. A collapsed caret already sits in a text
       node, but a range covering whole elements has an ELEMENT container plus an offset — and
       walking up from that element would step straight past the <font> the selection is made of,
       since it sits below the boundary rather than above it. So descend to the first leaf first. */
    let n = r.startContainer;
    if(n.nodeType === 1) n = n.childNodes[r.startOffset] || n;
    while(n && n.nodeType === 1 && n.firstChild) n = n.firstChild;
    if(n && n.nodeType === 3) n = n.parentNode;
    while(n && n !== surf && n.nodeType === 1){
      if(n.tagName === 'FONT'){
        if(!out.size && n.hasAttribute('size')) out.size = n.getAttribute('size');
        if(!out.face && n.hasAttribute('face')) out.face = n.getAttribute('face');
      }
      n = n.parentNode;
    }
    return out;
  }

  // Options live in the arrays above, never in index.html, so the labels and the values they apply
  // can't drift apart. Called once at load; the bar is static markup after that.
  function initScratchFormatBar(){
    const opts = (list, i) => '<option value="' + i + '">' + escapeHtml(list[i].label) + '</option>';
    const fill = (node, list) => {
      if(!node) return;
      let h = '';
      for(let i=0; i<list.length; i++) h += opts(list, i);
      node.innerHTML = h;
    };
    fill(el('scratchFontSel'), SCRATCH_FONTS);
    fill(el('scratchSizeSel'), SCRATCH_SIZES);
    fill(el('scratchHiliteSel'), SCRATCH_HILITES);
    const sizeSel = el('scratchSizeSel');
    if(sizeSel) sizeSel.selectedIndex = 2; // M
    const colorIn = el('scratchColorInput');
    const swatch = el('scratchColorSwatch');
    if(colorIn && swatch) swatch.style.background = colorIn.value;

    const bar = el('scratchFormat');
    if(!bar) return;
    /* Cancelling mousedown is what keeps the caret where it is: without it the press focuses the
       button, the surface loses its selection, and the command lands on nothing. Scoped to the
       buttons — cancelling it on a <select> or the colour well would stop the native picker from
       opening at all, which is why those two restore the remembered Range instead. */
    bar.addEventListener('mousedown', e=>{
      if(e.target && e.target.closest && e.target.closest('.scratch-fmt')) e.preventDefault();
    });
    bar.addEventListener('click', e=>{
      const b = e.target && e.target.closest && e.target.closest('.scratch-fmt');
      if(!b) return;
      if(b.getAttribute('data-act') === 'clear'){ clearScratchFormat(); return; }
      const cmd = b.getAttribute('data-cmd');
      if(cmd) scratchFmtCmd(cmd);
    });
    if(el('scratchFontSel')) el('scratchFontSel').addEventListener('change', e=>{
      const item = SCRATCH_FONTS[e.target.selectedIndex];
      if(item) applyScratchFont(item.face);
    });
    if(sizeSel) sizeSel.addEventListener('change', e=>{
      const item = SCRATCH_SIZES[e.target.selectedIndex];
      if(item) applyScratchSize(item.v);
    });
    if(el('scratchHiliteSel')) el('scratchHiliteSel').addEventListener('change', e=>{
      const item = SCRATCH_HILITES[e.target.selectedIndex];
      e.target.selectedIndex = 0;            // an action menu — back to reading "Highlight"
      if(item && item.v) applyScratchHilite(item.v);
    });
    // 'change', not 'input': Chrome streams 'input' for every pixel dragged inside the picker,
    // which would put a hundred undo entries on the stack for one colour choice.
    if(colorIn) colorIn.addEventListener('change', e=>{
      if(swatch) swatch.style.background = e.target.value;
      applyScratchColor(e.target.value);
    });
  }

  /* selectionchange is document-wide and fires constantly, so it bails immediately unless this page
     is open. It does two jobs: keeping scratchSavedRange fresh for the controls that lose focus,
     and keeping the bar's own on/off state honest as the caret moves. */
  document.addEventListener('selectionchange', ()=>{
    if(!scratchOpen) return;
    rememberScratchRange();
    scheduleScratchFormatState();
  });

  initScratchFormatBar();

  /* ---------- images: wiring ---------- */
  (function(){
    const surf = el('scratchText'), box = el('scratchImgBox'), grip = el('scratchImgGrip');
    const lift = el('scratchImgLift');
    if(!surf || !box || !grip) return;

    // hover reveals the grip on a fine pointer; there is no hover on touch, hence the long press
    surf.addEventListener('mouseover', e=>{
      // mid-gesture the box belongs to the image being worked on, not to whatever the pointer
      // happens to be passing over — a move in particular sweeps the cursor across the whole sheet
      if(!scratchImgHoverable() || scratchImgDrag || scratchImgMove) return;
      const im = e.target && e.target.closest && e.target.closest('img');
      if(im) showScratchImgBox(im);
    });
    surf.addEventListener('mouseout', e=>{
      if(!scratchImgHoverable()) return;
      const im = e.target && e.target.closest && e.target.closest('img');
      if(im) hideScratchImgBoxSoon();
    });
    box.addEventListener('mouseenter', ()=>{
      if(scratchImgHideTimer){ clearTimeout(scratchImgHideTimer); scratchImgHideTimer = null; }
    });
    box.addEventListener('mouseleave', hideScratchImgBoxSoon);

    /* Mouse: pressing an image arms a move. Nothing has happened yet — the slop gate in
       beginScratchImgMove's caller is what decides whether this turns into a drag or stays a
       click — but the press is claimed here so the browser can't act on it first.
       preventDefault does two jobs: it stops the native HTML5 image drag (which would otherwise
       hand this same surface a `drop` carrying no file and fight us for the gesture), and it
       stops the caret being placed, which a press on a photo never wanted anyway.

       Touch: press and hold an image to bring up the grip AND pick it up, which is the same
       "long-press then move" every phone uses for rearranging things. The tap that armed it must
       NOT also open the lightbox, so the moment is remembered and the click that follows is
       swallowed. */
    surf.addEventListener('pointerdown', e=>{
      const im = e.target && e.target.closest && e.target.closest('img');
      if(!im) return;
      if(e.pointerType === 'mouse'){
        if(e.button !== 0) return;
        e.preventDefault();
        scratchImgMove = { img: im, id: e.pointerId, sx: e.clientX, sy: e.clientY, live: false };
        showScratchImgBox(im);
        return;
      }
      if(scratchImgPressTimer) clearTimeout(scratchImgPressTimer);
      const id = e.pointerId, sx = e.clientX, sy = e.clientY;
      scratchImgPressTimer = setTimeout(()=>{
        scratchImgPressTimer = null;
        scratchImgPressAt = Date.now();
        showScratchImgBox(im);
        // armed, not live: the finger still has to travel before anything is lifted, so a
        // long-press that ends without moving leaves the image exactly where it was
        scratchImgMove = { img: im, id: id, sx: sx, sy: sy, live: false };
      }, 500);
    });
    const cancelPress = ()=>{ if(scratchImgPressTimer){ clearTimeout(scratchImgPressTimer); scratchImgPressTimer = null; } };
    surf.addEventListener('pointerup', cancelPress);
    surf.addEventListener('pointercancel', cancelPress);
    surf.addEventListener('pointermove', e=>{
      if(scratchImgPressTimer && e.pointerType !== 'mouse') cancelPress();
      const m = scratchImgMove;
      if(!m || e.pointerId !== m.id) return;
      if(!m.live){
        if(Math.abs(e.clientX - m.sx) < SCRATCH_MOVE_SLOP && Math.abs(e.clientY - m.sy) < SCRATCH_MOVE_SLOP) return;
        beginScratchImgMove(m, e.clientX, e.clientY);
      }
      scratchImgMoveTo(m, e.clientX, e.clientY);
    });
    /* On touch the pointer stream alone isn't enough to stop the sheet scrolling under the finger,
       so the touch gesture is cancelled outright for as long as a move is armed. Non-passive on
       purpose — a passive listener may not preventDefault, which is the entire job here. It only
       ever fires after a 500ms stationary press, so an ordinary scroll or page-swipe that started
       on a photo is never touched. */
    surf.addEventListener('touchmove', e=>{ if(scratchImgMove) e.preventDefault(); }, { passive:false });
    // the capture taken in beginScratchImgMove routes these back here even off the surface, and
    // the window pair catches the armed-but-never-captured case that ends somewhere else
    surf.addEventListener('pointerup', endScratchImgMove);
    surf.addEventListener('pointercancel', endScratchImgMove);
    window.addEventListener('pointerup', endScratchImgMove);
    window.addEventListener('pointercancel', endScratchImgMove);
    // belt and braces against the native image drag, for the browsers that start one anyway
    surf.addEventListener('dragstart', e=>{
      if(e.target && e.target.tagName === 'IMG') e.preventDefault();
    });
    /* data-x is a PERCENTAGE of the sheet's width, so every float has to be re-placed when that
       width changes — a window resize, a phone rotating, or the mobile browser's URL bar
       collapsing. Cheap, idempotent and comparison-guarded, hence no debounce. */
    window.addEventListener('resize', ()=>{ if(scratchOpen) layoutScratchFloats(); });
    /* An image that hasn't downloaded yet measures zero wide, so its horizontal clamp is computed
       against nothing. `load` doesn't bubble, hence the capture phase. */
    surf.addEventListener('load', e=>{
      if(e.target && e.target.tagName === 'IMG') layoutScratchFloats();
    }, true);
    /* Only while a long press has just fired. Suppressing it always would take right-click "save
       image" away from desktop, which this feature has no business doing. */
    surf.addEventListener('contextmenu', e=>{
      if(Date.now() - scratchImgPressAt < 900 && e.target && e.target.closest && e.target.closest('img')) e.preventDefault();
    });

    /* Pointer capture on the GRIP here, unlike the page dots where it must go on the row. The rule
       there exists because reordering re-renders the row's innerHTML on every crossing, so the
       captured node is destroyed mid-gesture. Nothing re-renders during an image drag — only the
       image's width attribute changes — so the grip survives its own drag. */
    grip.addEventListener('pointerdown', e=>{
      if(!scratchImgFor) return;
      e.preventDefault();
      e.stopPropagation();
      scratchImgDrag = { x: e.clientX, w: scratchImgWidthNow(scratchImgFor) };
      try{ grip.setPointerCapture(e.pointerId); }catch(err){}
    });
    grip.addEventListener('pointermove', e=>{
      if(!scratchImgDrag || !scratchImgFor) return;
      setScratchImgWidth(scratchImgFor, scratchImgDrag.w + (e.clientX - scratchImgDrag.x));
    });
    grip.addEventListener('pointerup', endScratchImgDrag);
    grip.addEventListener('pointercancel', endScratchImgDrag);
    // the grip is a real button, so the whole thing is reachable without a pointer at all
    grip.addEventListener('keydown', e=>{
      if(!scratchImgFor) return;
      if(scratchImgLayerKey(e)) return;
      const step = e.shiftKey ? 4 : 24;
      if(e.key === 'ArrowRight' || e.key === 'ArrowUp'){ e.preventDefault(); setScratchImgWidth(scratchImgFor, scratchImgWidthNow(scratchImgFor) + step); onScratchInput(); }
      else if(e.key === 'ArrowLeft' || e.key === 'ArrowDown'){ e.preventDefault(); setScratchImgWidth(scratchImgFor, scratchImgWidthNow(scratchImgFor) - step); onScratchInput(); }
      else if(e.key === 'Escape'){ hideScratchImgBox(); focusScratchSurface(); }
    });

    /* The lift toggle. It is the discoverable way in and the only way back: dragging an inline
       image floats it, but nothing about dragging says "and this is how you undo that". */
    if(lift){
      // the box is pointer-events:none so it can sit over the writing; both its buttons opt back in
      lift.addEventListener('pointerdown', e=>{ e.preventDefault(); e.stopPropagation(); });
      lift.addEventListener('click', e=>{
        e.preventDefault();
        e.stopPropagation();
        if(scratchImgFor) toggleScratchImgFloat(scratchImgFor);
      });
      /* Arrow keys MOVE here, where they RESIZE on the grip — one button per verb, so neither
         needs a modifier. Only meaningful once the image is a float, which is also the only state
         in which the layer keys do anything. */
      lift.addEventListener('keydown', e=>{
        if(!scratchImgFor) return;
        if(scratchImgLayerKey(e)) return;
        if(e.key === 'Escape'){ hideScratchImgBox(); focusScratchSurface(); return; }
        if(!scratchImgIsFloat(scratchImgFor)) return;
        const d = { ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1] }[e.key];
        if(!d) return;
        e.preventDefault();
        const step = e.shiftKey ? 1 : 8;
        const w = surf.clientWidth || 1;
        const left = (parseFloat(scratchImgFor.getAttribute('data-x')) || 0) / 100 * w;
        const top = parseFloat(scratchImgFor.getAttribute('data-y')) || 0;
        setScratchFloatAt(scratchImgFor, left + d[0] * step, top + d[1] * step);
        placeScratchImgBox();
        onScratchInput();
      });
    }

    // no scroll/resize hooks here: trackScratchImgBox() already re-reads the rect every frame,
    // which covers those two and the cases they missed

    /* ---- the studio ----
       Every control is bound once here, and every one of them is a thin call into the functions
       above — the studio keeps its whole model in `studio` and re-renders from it, so nothing in
       this block reads the DOM to find out what state it is in. */
    const ov = el('scratchImgOverlay');
    if(ov) ov.addEventListener('click', e=>{
      /* The backdrop closes. The picture and the controls do not — and that has to be a test on
         the two containers rather than on one <img>, now that the thing being clicked might be the
         canvas, a crop handle, or the Edge slider. */
      const t = e.target;
      if(t && t.closest && t.closest('.scratch-imgview-stage, .scratch-imgview-panel')) return;
      closeScratchImgView();
    });

    const cutBtn = el('scratchImgCutBtn');
    if(cutBtn) cutBtn.addEventListener('click', toggleScratchCutout);
    const cropBtn = el('scratchImgCropBtn');
    if(cropBtn) cropBtn.addEventListener('click', beginScratchCrop);
    const cropOk = el('scratchImgCropOkBtn');
    if(cropOk) cropOk.addEventListener('click', applyScratchCrop);
    const cropNo = el('scratchImgCropNoBtn');
    if(cropNo) cropNo.addEventListener('click', cancelScratchCrop);
    const resetBtn = el('scratchImgResetBtn');
    if(resetBtn) resetBtn.addEventListener('click', resetScratchStudio);
    const saveBtn = el('scratchImgSaveBtn');
    if(saveBtn) saveBtn.addEventListener('click', saveScratchStudio);

    const tolInput = el('scratchImgTol');
    if(tolInput) tolInput.addEventListener('input', ()=>{
      if(!studio) return;
      studio.key.tol = parseInt(tolInput.value, 10) || 22;
      studio.out = null;
      /* One recompute per frame at most. Dragging a range input fires `input` far faster than a
         two-megapixel flood fill can finish, and every superseded run is work thrown away — the
         slider would lag a second behind the finger. The value is read again inside the frame, so
         what gets computed is always the position the slider is at by then, never a stale one. */
      if(studioRaf) return;
      studioRaf = requestAnimationFrame(()=>{ studioRaf = 0; renderScratchStudio(); });
    });

    const cropLayer = el('scratchImgCropLayer');
    if(cropLayer){
      cropLayer.addEventListener('pointerdown', onScratchCropDown);
      cropLayer.addEventListener('pointermove', onScratchCropMove);
      cropLayer.addEventListener('pointerup', endScratchCropDrag);
      cropLayer.addEventListener('pointercancel', endScratchCropDrag);
    }
    const studioCanvas = el('scratchImgCanvas');
    if(studioCanvas) studioCanvas.addEventListener('click', onScratchStudioPick);
  })();

  /* ---------- find: wiring ---------- */
  (function(){
    const box = el('scratchSearchInput'), wrap = el('scratchSearch');
    if(!box || !wrap) return;
    box.addEventListener('input', runScratchFind);
    box.addEventListener('keydown', e=>{
      if(e.key === 'Enter'){ e.preventDefault(); scratchFindGo(scratchHitAt + (e.shiftKey ? -1 : 1)); return; }
      if(e.key === 'ArrowDown'){ e.preventDefault(); scratchFindGo(scratchHitAt + 1); return; }
      if(e.key === 'ArrowUp'){ e.preventDefault(); scratchFindGo(scratchHitAt - 1); return; }
      // Escape is handled by the document-level capture guard, so it peels off exactly one layer
    });
    wrap.addEventListener('click', e=>{
      const t = e.target;
      if(!t || !t.closest) return;
      if(t.closest('#scratchSearchNext')){ scratchFindGo(scratchHitAt + 1); return; }
      if(t.closest('#scratchSearchPrev')){ scratchFindGo(scratchHitAt - 1); return; }
      if(t.closest('#scratchSearchClose')){ closeScratchFind(); return; }
      const row = t.closest('.scratch-sr');
      // a click on a row is "take me there", so unlike the arrows it lands the caret in the writing
      if(row) scratchFindGo(parseInt(row.getAttribute('data-hit'), 10) || 0, { focus: true });
    });
    /* Ctrl+F is TAKEN OVER, at capture, document-level. Not a landgrab: the browser's find can only
       search the DOM, and every page except the one on screen is a string in state — so the native
       one confidently reports "no results" for text that is plainly in your napkin. Document-level
       rather than on the overlay because on touch nothing inside it may be focused at all. */
    document.addEventListener('keydown', e=>{
      if(!scratchOpen || e.altKey) return;
      if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f'){
        e.preventDefault();
        e.stopPropagation();
        openScratchFind();
      }
    }, true);
  })();

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
  /* `at` (sheet coordinates) turns the arrival into a free-floating image dropped exactly where
     you let go of it, which is what a file dragged onto the page obviously meant. A PASTE has no
     such point — the clipboard says nothing about where — so it still lands inline at the caret,
     and you drag it out afterwards if that is what you wanted. */
  function insertScratchImage(file, at){
    const marker = 'sc' + uid();
    scratchExec('insertHTML', '<span id="' + marker + '" class="scratch-uploading">uploading image…</span>');
    setScratchStatus('uploading');
    uploadCompressedImage(file, 1400, 0.82, 'scratch').then(url=>{
      const slot = document.getElementById(marker);
      const img = document.createElement('img');
      img.src = url;
      if(slot) slot.replaceWith(img);
      else el('scratchText').appendChild(img);
      // it has no width yet — the file hasn't been fetched back — so this lands the top-left
      // corner and the surface's own load listener re-clamps it against the sheet once it can
      if(at) liftScratchImg(img, at);
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
    /* Pin the legacy output mode for this session. It's a document-wide flag and nothing else in
       the app touches it (js/board.js only ever runs 'copy'), but a browser's default differs by
       engine and version — and if it were ever left ON, fontSize would start writing
       "-webkit-xxx-large" spans instead of the <font size> buckets styles.css restyles. */
    scratchExec('styleWithCSS', 'false');
    /* Firefox turns on its own image resize handles inside a contenteditable by default, which
       would sit on top of ours and fight the same drag. Ours is the one that writes a validated
       width attribute the sanitizer keeps, so theirs is the one that goes. */
    scratchExec('enableObjectResizing', 'false');
    ensureTrailingBlankScratchPage();   // covers a stack that arrived from anywhere but a load
    syncScratchSurface(true);
    renderScratchPages();
    updateScratchFooter();
    applyScratchFormatBar();
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
    if(scratchImgViewOn) closeScratchImgView(true);   // force: the pad is going, a prompt can't stand in the way
    if(scratchSheetOn) closeScratchPageSheet();
    closeScratchHelp();   // a panel left up would be waiting there on the next open
    hideScratchImgBox();
    if(scratchFindOn) closeScratchFind(true); // silent: don't focus a surface that's about to hide
    commitScratchSurface();               // while scratchOpen is still true
    const swept = sweepTrailingEmptyScratchPages();
    sweepDeletedScratchImages();          // after the commit, so the last edit counts
    scratchOpen = false;
    scratchTabHeld = false; scratchTabUsed = false; scratchTabTapAt = 0;
    scratchWheelAcc = 0; scratchWheelDir = 0; scratchWheelStepAt = 0;
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
    // Find is a layer INSIDE the page, so Escape peels that off first and the napkin stays open —
    // the same one-layer-per-press rule this capture guard exists to enforce against the app's
    // other overlays.
    // innermost layer first: the lightbox, then find, then the page itself
    if(scratchImgViewOn){ closeScratchImgView(); return; }
    if(scratchHelpOn){ closeScratchHelp(); focusScratchSurface(); return; }
    if(scratchSheetOn){ closeScratchPageSheet(); focusScratchSurface(); return; }
    if(scratchFindOn){ closeScratchFind(); return; }
    closeScratch();
  }, true);

  /* Anywhere else dismisses the shortcuts panel. It carries no controls and nothing to lose, so a
     click that clearly wasn't meant for it should put it away rather than leave it covering the
     writing — the page list and the find panel both hold state and so are deliberately not treated
     this way. Bubble phase and scoped to the overlay, so it can't interfere with anything outside
     the pad, and the ? itself is excluded or the toggle would fire twice and cancel itself out. */
  el('scratchOverlay').addEventListener('click', e=>{
    if(!scratchHelpOn) return;
    const t = e.target;
    if(t && t.closest && (t.closest('#scratchHelp') || t.closest('#scratchHelpBtn'))) return;
    closeScratchHelp();
  });

  el('scratchCloseBtn').addEventListener('click', closeScratch);

  // the redrawn logo IS the close button now
  const scratchBrandBtn = el('scratchBrand');
  scratchBrandBtn.addEventListener('click', closeScratch);
  scratchBrandBtn.addEventListener('keydown', e=>{
    if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); closeScratch(); }
  });

  /* ---------- reordering ----------
     Lives entirely in the page list now (see "the page list" below): drag a row by its grip. The
     dots used to be the handle, on the reasoning that they WERE the pages and so needed nothing new
     on screen — but that only held while you could tell one from another, and it stopped holding
     somewhere around a dozen pages.
     moveScratchPage() is the shared primitive and is unchanged; only the thing you grab moved. */

  function moveScratchPage(from, to){
    ensureScratchPages();
    const pages = state.scratch.pages;
    if(from === to || from < 0 || to < 0 || from >= pages.length || to >= pages.length) return false;
    pages.splice(to, 0, pages.splice(from, 1)[0]);
    // activeId is an id, not an index, so whichever page you were on is still the page you're on —
    // it simply sits somewhere else in the list now
    state.scratch.updatedAt = Date.now();
    return true;
  }

  /* Shared by the page row and the tool bar: it only cares about which control was hit, and both
     rows hold controls, so one listener is bound to each rather than duplicating the ladder. */
  function onScratchRowClick(e){
    const t = e.target;
    if(!t || !t.closest) return;
    if(t.closest('#scratchPrevPage')){ scratchStep(-1); return; }
    if(t.closest('#scratchNextPage')){ scratchStep(1); return; }
    if(t.closest('#scratchPageListBtn')){
      if(scratchSheetOn) closeScratchPageSheet(); else openScratchPageSheet();
      return;
    }
    if(t.closest('#scratchAddPage')){ addScratchPage(); return; }
    if(t.closest('#scratchDelPage')){ deleteScratchPage(); return; }
    if(t.closest('#scratchFindBtn')){
      if(scratchFindOn) closeScratchFind(); else openScratchFind();
      return;
    }
    if(t.closest('#scratchHelpBtn')){
      // renderScratchTools() does NOT run here, so the pressed button survives the toggle and keeps
      // focus — unlike Aa and ♪ below, which repaint themselves and have to hand focus back
      if(scratchHelpOn) closeScratchHelp(); else openScratchHelp();
      return;
    }
    if(t.closest('#scratchFmtBtn')){
      state.scratch.fmt = !state.scratch.fmt;
      renderScratchPages();
      applyScratchFormatBar();
      // renderScratchPages() just replaced the button that was clicked — and on touch,
      // focusScratchSurface() deliberately declines, so showing the bar never raises the keyboard
      focusScratchSurface();
      setScratchStatus('dirty');
      debouncedSaveScratch();
      return;
    }
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
  }
  el('scratchPages').addEventListener('click', onScratchRowClick);
  el('scratchTools').addEventListener('click', onScratchRowClick);

  /* ---------- the page list: pick and reorder ---------- */
  (function(){
    const sheet = el('scratchPageSheet');
    if(!sheet) return;

    sheet.addEventListener('click', e=>{
      if(scratchSheetMoved) return;           // that click was the tail of a drag, not a choice
      const go = e.target && e.target.closest && e.target.closest('.scratch-sheet-go');
      if(!go) return;
      const i = parseInt(go.getAttribute('data-i'), 10);
      closeScratchPageSheet();
      if(!isNaN(i)) scratchGoTo(i);
    });

    // which slot the pointer is over, by row centres — the vertical twin of scratchDotIndexAt()
    function sheetIndexAt(y){
      const rows = sheet.querySelectorAll('.scratch-sheet-row');
      for(let i=0; i<rows.length; i++){
        const r = rows[i].getBoundingClientRect();
        if(y < r.top + r.height / 2) return i;
      }
      return rows.length - 1;
    }

    /* Capture on the SHEET, never on the grip — the same rule the dot row records, and for the same
       reason: every crossing re-renders the list's innerHTML, so a captured grip would be destroyed
       mid-gesture and the drag would die after one step. The sheet element survives every render. */
    sheet.addEventListener('pointerdown', e=>{
      const grip = e.target && e.target.closest && e.target.closest('.scratch-sheet-grip');
      if(!grip) return;
      const row = grip.closest('.scratch-sheet-row');
      if(!row || state.scratch.pages.length < 2) return;
      e.preventDefault();
      scratchSheetFrom = parseInt(row.getAttribute('data-i'), 10);
      if(isNaN(scratchSheetFrom)){ scratchSheetFrom = -1; return; }
      scratchSheetDragId = state.scratch.pages[scratchSheetFrom].id;
      scratchSheetMoved = false;
      try{ sheet.setPointerCapture(e.pointerId); }catch(err){}
      renderScratchPageSheet();
    });

    sheet.addEventListener('pointermove', e=>{
      if(!scratchSheetDragId) return;
      const to = sheetIndexAt(e.clientY);
      if(to !== scratchSheetFrom && moveScratchPage(scratchSheetFrom, to)){
        scratchSheetFrom = to;
        scratchSheetMoved = true;
        // renderScratchPages() redraws the sheet too in pager mode, and moves the "4 / 23" counter
        // along with the page you're holding — calling both would render the list twice per crossing
        renderScratchPages();
        playScratchPageTick(1);
      }
    });

    function endSheetDrag(){
      if(!scratchSheetDragId) return;
      const moved = scratchSheetMoved;
      scratchSheetDragId = null; scratchSheetFrom = -1;
      // a written page dragged to the end must not become the last sheet
      if(moved) ensureTrailingBlankScratchPage();
      renderScratchPages();
      if(moved){
        setScratchStatus('dirty');
        debouncedSaveScratch();
        // a click is dispatched after pointerup; swallow the one that ends a drag
        setTimeout(()=>{ scratchSheetMoved = false; }, 0);
      } else {
        scratchSheetMoved = false;
      }
    }
    sheet.addEventListener('pointerup', endSheetDrag);
    sheet.addEventListener('pointercancel', endSheetDrag);
  })();


  /* ---------- surface wiring ---------- */

  const scratchSurface = el('scratchText');

  scratchSurface.addEventListener('input', onScratchInput);

  /* The slide class is otherwise left on until the NEXT page turn removes it, which would leave the
     will-change hint (styles.css) permanently promoting a large scrolling element long after there
     was anything to promote. Removing it on completion keeps the hint scoped to the 180ms it is
     actually for. animateScratchPage() still removes both classes and forces a reflow before
     re-adding, so a rapid second turn restarts the animation exactly as before. */
  scratchSurface.addEventListener('animationend', e=>{
    if(e.target === scratchSurface) scratchSurface.classList.remove('slide-l', 'slide-r');
  });

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
    /* Clicking into the writing puts find away. Reaching for the page is how you say you are done
       searching — the panel has already done its job by the time you go to type, and leaving it up
       means it sits over the very text you just jumped to.
       Silent, because the click is itself the focus: closeScratchFind()'s own focusScratchSurface()
       would be a redundant second focus in the middle of the browser's own caret placement. Placed
       above every branch below so it happens whatever was clicked — the panel is just as much in
       the way when the thing you reached for was an image or a tickbox. */
    if(scratchFindOn) closeScratchFind(true);
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
    const im = t.closest('img');
    if(im){
      // the tap that raised the resize grip must not also open the lightbox
      if(Date.now() - scratchImgPressAt < 900){ scratchImgPressAt = 0; return; }
      // …and neither must the click that trails the end of a drag-to-move
      if(Date.now() - scratchImgMoveAt < 400) return;
      e.preventDefault();
      openScratchImgView(im);
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
      scratchExec('insertHTML', sanitizePastedScratchHtml(html));
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
    // where you let go of it, in the sheet's own coordinates rather than the viewport's
    const sr = scratchSurface.getBoundingClientRect();
    insertScratchImage(img, {
      left: e.clientX - sr.left + scratchSurface.scrollLeft,
      top: e.clientY - sr.top + scratchSurface.scrollTop
    });
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
    /* Dragging a photo across the sheet clears every threshold below — it is a long horizontal
       run of a single finger ending with nothing selected — so without this a move to the left
       would also turn the page out from under the image you just placed. pointerup fires before
       touchend, so by now the move is over and only its timestamp is left to check. */
    if(scratchImgMove || Date.now() - scratchImgMoveAt < 500) return;
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
  /* Tab, tab -> find. This is Tab's THIRD job on this page (focus move, scroll modifier, and now
     this), so the arming rule is what keeps the three from tripping over each other: a tap only
     arms the gesture when it was pressed while the WRITING had focus. Once you have tabbed into
     the dots, every further Tab is a plain focus move again and can never open the panel — so the
     keyboard route to the dots survives, apart from the one case the gesture is defined as.
     The honest cost, since there is no way to have both: two FAST taps starting from the writing
     now open find instead of stepping focus twice. A second tap after the window still steps.
     Deliberately not solved by delaying the first tap's focus move until the window expires — that
     buys the collision back at the price of making every Tab feel broken. */
  const SCRATCH_TAB_DOUBLE = 450;   // ms; a double-CLICK is ~500, and this is the same gesture
  let scratchTabTapAt = 0, scratchTabFromSurface = false;
  let scratchWheelAt = 0, scratchWheelAcc = 0, scratchWheelDir = 0, scratchWheelStepAt = 0;

  el('scratchOverlay').addEventListener('keydown', e=>{
    if(e.key !== 'Tab') return;
    e.preventDefault();
    if(!e.repeat){
      scratchTabHeld = true;
      scratchTabUsed = false;
      // read on the way DOWN: by keyup the focus has already moved, so this is the only moment
      // that can answer "did this tap start in the writing?"
      scratchTabFromSurface = (document.activeElement === el('scratchText'));
    }
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
    const fromSurface = scratchTabFromSurface;
    scratchTabHeld = false;
    scratchTabUsed = false;
    // that Tab was the scroll modifier, not a tap — it must not count towards a double
    if(used){ scratchTabTapAt = 0; return; }
    const now = Date.now();
    if(scratchTabTapAt && now - scratchTabTapAt <= SCRATCH_TAB_DOUBLE){
      scratchTabTapAt = 0;
      // and NOT another focus move: the second tap is the gesture, not a step
      openScratchFind();
      return;
    }
    // only a tap that started in the writing arms the gesture — see SCRATCH_TAB_DOUBLE above
    scratchTabTapAt = fromSurface ? now : 0;
    moveScratchFocus(e.shiftKey);           // nothing was scrolled: a plain Tab press, after all
  });

  window.addEventListener('blur', ()=>{
    scratchTabHeld = false; scratchTabUsed = false; scratchTabTapAt = 0;
  });

  // Wraps rather than escaping, so focus stays inside the takeover instead of walking into the
  // invisible tab behind it.
  function moveScratchFocus(back){
    /* HIDDEN controls have to be filtered out, not merely collected and skipped by luck. Two of the
       things this selector matches are hidden most of the time — the format bar is collapsed by
       default, and the find row only exists while you're searching — and .focus() on a display:none
       element is a silent no-op that leaves activeElement on <body>. The cycle would then appear to
       swallow a Tab and restart from the top on the next one.
       getClientRects().length is the "is this actually rendered" test rather than offsetParent,
       which has its own rules about positioned ancestors and would need to know that
       .scratch-overlay is position:fixed to be read correctly. */
    const all = el('scratchOverlay').querySelectorAll('[contenteditable="true"], button, select, input[type="color"], .scratch-search-input, #scratchBrand');
    const items = [];
    for(let k=0; k<all.length; k++) if(all[k].getClientRects().length) items.push(all[k]);
    if(!items.length) return;
    let i = -1;
    for(let k=0; k<items.length; k++) if(items[k] === document.activeElement){ i = k; break; }
    const n = items.length;
    items[i < 0 ? 0 : ((i + (back ? -1 : 1)) + n) % n].focus();
  }
