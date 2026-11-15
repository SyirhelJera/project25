  /* ================= SUB-TAB ORDER — drag a sub-tab along its own strip =================
     Every sub-tab strip in index.html that carries data-subtab-sort="<attr>" can be rearranged
     where it stands: drag a button with the mouse, or press and hold it on a touch screen until
     it lifts and then slide. Alt+Shift+←/→ moves a focused one from the keyboard. Settings ->
     Navigation has the one way back (Reset).

     The attribute's VALUE names the data attribute that strip's buttons are already keyed by
     (data-subtab-sort="fintab" on the Finance strip, whose buttons are data-fintab="accounts"…),
     so one attribute is both the opt-in and the key the order is saved under. Every strip's
     show*SubTab() keys off those same attributes and none of them cares where a button sits,
     which is the only reason reordering costs nothing anywhere else. Renaming a strip's data
     attribute orphans its saved order — harmlessly: it falls back to the markup order.

     The rules that hold it up:

     - SPARSE and REPAIRED ON READ. state.subtabOrder only holds strips that differ from the
       markup (dragging one back to its original order deletes the entry), and subtabOrderFor()
       repairs each list against the buttons that actually exist — strangers and duplicates
       dropped, a sub-tab added to the markup later slotted in at its own default position. The
       avStackOrder() ruling: rejecting a list wholesale would throw away an order set by hand the
       day a strip gains a button. SUBTAB_DEFAULTS is snapshotted from the DOM at load, before
       anything can reorder it, the NAV_TAB_DEFAULTS reason.

     - POINTER EVENTS, NOT HTML5 drag-and-drop, which never fires on touch — the scratch dot-row
       ruling. And capture goes on the STRIP, never the button: a touch press implicitly captures
       to the button, and moving that node on drop would release it.

     - NOTHING MOVES IN THE DOM UNTIL DROP. During the gesture the lifted tab follows the pointer
       and its neighbours slide aside, all by transform against slots measured once at pick-up,
       so no mid-drag reflow can shift the targets being aimed at; the button is reinserted once,
       on release, which is also the only save.

     - TOUCH NEEDS A HOLD, the mouse does not. These strips scroll sideways on a phone, so a
       horizontal swipe has to stay a scroll; only a press that stays still for
       SUBTAB_LONGPRESS_MS picks the tab up, and from then on a non-passive touchmove listener
       stops the browser panning under the drag. That listener has to be there from the start —
       Chrome decides whether a touch sequence is cancellable at touchstart, so one added at
       pick-up would be too late. The mouse drags straight away, which is why js/finance.js's
       mouse drag-to-scroll steps aside when a press lands on a tab of a sortable strip.

     - A DRAG NEVER SWITCHES TAB. The click that follows a drop (or a long-press dropped in place)
       is eaten, from a window capture listener so it is gone before any tab's own handler. */

  const SUBTAB_LONGPRESS_MS = 380;    // touch/pen: how long a press must hold still to lift a tab
  const SUBTAB_TOUCH_SLOP_PX = 8;     // touch/pen: moving further than this during the hold = scrolling
  const SUBTAB_MOUSE_SLOP_PX = 6;     // mouse: horizontal travel before a press becomes a drag
  const SUBTAB_EDGE_PX = 28;          // auto-scroll band at each end of a strip that overflows
  const SUBTAB_SETTLE_MS = 160;       // the slide neighbours (and the dropped tab) take
  const SUBTAB_CLICK_EAT_MS = 450;    // how long after a drop the trailing click is still eaten

  function subtabStrips(){ return Array.from(document.querySelectorAll('[data-subtab-sort]')); }
  function subtabAttr(strip){ return 'data-' + strip.getAttribute('data-subtab-sort'); }
  function subtabButtons(strip){
    const attr = subtabAttr(strip);
    return Array.from(strip.children).filter(c=> c.hasAttribute(attr));
  }
  function subtabKey(strip, btn){ return btn.getAttribute(subtabAttr(strip)); }
  // a sub-tab can be hidden (display:none) by its own tab's logic; it keeps its place in the
  // saved order but takes no part in a drag, which only ever moves between what's on screen
  function subtabVisibleButtons(strip){ return subtabButtons(strip).filter(b=> b.getClientRects().length > 0); }
  function subtabSameOrder(a, b){ return a.length === b.length && a.every((k, i)=> k === b[i]); }
  function subtabReducedMotion(){
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  const SUBTAB_DEFAULTS = {};
  subtabStrips().forEach(strip=>{
    SUBTAB_DEFAULTS[strip.getAttribute('data-subtab-sort')] = subtabButtons(strip).map(b=> subtabKey(strip, b));
  });

  /* The order a strip should show: the saved list, repaired against the markup's keys. */
  function subtabOrderFor(stripKey){
    const def = SUBTAB_DEFAULTS[stripKey] || [];
    const saved = (state.subtabOrder && Array.isArray(state.subtabOrder[stripKey])) ? state.subtabOrder[stripKey] : [];
    const out = [];
    saved.forEach(k=>{ if(def.includes(k) && !out.includes(k)) out.push(k); });
    def.forEach((k, i)=>{
      if(out.includes(k)) return;
      // a key the saved list doesn't know goes straight after its nearest default-order
      // predecessor that IS placed, so a new sub-tab lands beside the one it was written next to
      let at = 0;
      for(let j = i - 1; j >= 0; j--){ const p = out.indexOf(def[j]); if(p >= 0){ at = p + 1; break; } }
      out.splice(at, 0, k);
    });
    return out;
  }

  /* Put a strip's buttons into `order` without disturbing anything else the strip holds:
     placeholders keep the slots the buttons occupied, then each slot takes its new button. */
  function placeSubtabButtons(strip, order){
    const btns = subtabButtons(strip);
    const byKey = {};
    btns.forEach(b=>{ byKey[subtabKey(strip, b)] = b; });
    if(order.length !== btns.length || order.some(k=> !byKey[k])) return;
    const focused = btns.includes(document.activeElement) ? document.activeElement : null;
    const marks = btns.map(b=>{ const m = document.createComment(''); b.replaceWith(m); return m; });
    marks.forEach((m, i)=> m.replaceWith(byKey[order[i]]));
    // detaching a node drops its focus; give it back so a keyboard user isn't thrown to <body>
    if(focused && document.activeElement !== focused) focused.focus({ preventScroll:true });
  }

  /* Called from renderAll(), next to applyTabOrder(). A no-op for any strip already in order,
     so it costs nothing on the renders where nothing changed — and it never touches a strip
     that is mid-drag, which a sync landing during the gesture would otherwise rearrange under
     the pointer. */
  function applySubtabOrder(){
    subtabStrips().forEach(strip=>{
      if(subtabDrag && subtabDrag.strip === strip) return;
      const order = subtabOrderFor(strip.getAttribute('data-subtab-sort'));
      const now = subtabButtons(strip).map(b=> subtabKey(strip, b));
      if(!subtabSameOrder(now, order)) placeSubtabButtons(strip, order);
    });
    renderSubtabOrderReset();
  }

  function subtabCustomisedCount(){
    return Object.keys(SUBTAB_DEFAULTS).filter(k=> !subtabSameOrder(subtabOrderFor(k), SUBTAB_DEFAULTS[k])).length;
  }

  /* The strip's DOM order IS the new order; store it, or delete the entry if it's the default. */
  function commitSubtabOrder(strip){
    const key = strip.getAttribute('data-subtab-sort');
    const now = subtabButtons(strip).map(b=> subtabKey(strip, b));
    if(!state.subtabOrder || typeof state.subtabOrder !== 'object' || Array.isArray(state.subtabOrder)) state.subtabOrder = {};
    if(subtabSameOrder(now, SUBTAB_DEFAULTS[key] || [])) delete state.subtabOrder[key];
    else state.subtabOrder[key] = now;
    save();
    renderSubtabOrderReset();
  }

  /* ---- Settings -> Navigation -> Sub-tab order ---- */
  function renderSubtabOrderReset(){
    const btn = el('subtabOrderResetBtn');
    if(!btn) return;
    const n = subtabCustomisedCount();
    btn.disabled = n === 0;
    const note = el('subtabOrderNote');
    if(note) note.textContent = n === 0
      ? 'Every strip is in its original order.'
      : (n === 1 ? '1 strip rearranged.' : n + ' strips rearranged.');
  }
  (function(){
    const btn = el('subtabOrderResetBtn');
    if(!btn) return;
    btn.addEventListener('click', ()=>{
      state.subtabOrder = {};
      applySubtabOrder();
      save();
    });
  })();

  /* ---------------- the drag ---------------- */
  let subtabDrag = null;
  let subtabEatClickUntil = 0;

  function onSubtabPointerDown(e){
    if(subtabDrag) return;   // a second finger mid-gesture is ignored, not a second drag
    if(e.pointerType === 'mouse' && e.button !== 0) return;
    const strip = e.currentTarget;
    const btn = subtabButtons(strip).find(b=> b.contains(e.target));
    if(!btn || btn.disabled) return;
    if(subtabVisibleButtons(strip).length < 2) return;
    subtabDrag = {
      strip, btn, pointerId: e.pointerId,
      touchy: e.pointerType !== 'mouse',
      phase: 'armed',
      startX: e.clientX, startY: e.clientY, lastX: e.clientX,
      timer: 0, raf: 0,
    };
    if(subtabDrag.touchy) subtabDrag.timer = setTimeout(beginSubtabDrag, SUBTAB_LONGPRESS_MS);
    window.addEventListener('pointermove', onSubtabPointerMove);
    window.addEventListener('pointerup', onSubtabPointerUp);
    window.addEventListener('pointercancel', onSubtabPointerCancel);
    window.addEventListener('keydown', onSubtabDragKey, true);
    window.addEventListener('blur', onSubtabPointerCancel);
  }

  function onSubtabPointerMove(e){
    const d = subtabDrag;
    if(!d || e.pointerId !== d.pointerId) return;
    d.lastX = e.clientX;
    if(d.phase === 'armed'){
      const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
      if(d.touchy){
        // moved before the hold completed: that's a scroll (or a swipe), so let it be one
        if(Math.hypot(dx, dy) > SUBTAB_TOUCH_SLOP_PX) endSubtabDrag(false);
        return;
      }
      if(Math.abs(dx) <= SUBTAB_MOUSE_SLOP_PX) return;
      beginSubtabDrag();
      return;
    }
    scheduleSubtabFrame();
  }
  function onSubtabPointerUp(e){
    if(subtabDrag && e.pointerId === subtabDrag.pointerId) endSubtabDrag(true);
  }
  function onSubtabPointerCancel(e){
    if(!subtabDrag) return;
    if(e && e.pointerId != null && e.pointerId !== subtabDrag.pointerId) return;
    endSubtabDrag(false);
  }
  function onSubtabDragKey(e){
    if(e.key !== 'Escape' || !subtabDrag) return;
    e.preventDefault(); e.stopPropagation();
    endSubtabDrag(false);
  }

  function beginSubtabDrag(){
    const d = subtabDrag;
    if(!d || d.phase !== 'armed') return;
    clearTimeout(d.timer);
    const strip = d.strip;
    d.items = subtabVisibleButtons(strip);
    d.from = d.items.indexOf(d.btn);
    if(d.items.length < 2 || d.from < 0){ endSubtabDrag(false); return; }
    // slots in the strip's CONTENT coordinates (scroll included), so auto-scrolling mid-drag
    // moves the pointer through them instead of invalidating them
    const sr = strip.getBoundingClientRect();
    d.slots = d.items.map(b=>{ const r = b.getBoundingClientRect(); return { x: r.left - sr.left + strip.scrollLeft, w: r.width }; });
    d.gap = parseFloat(getComputedStyle(strip).columnGap) || 0;
    d.grab = d.startX - d.items[d.from].getBoundingClientRect().left;   // where on the tab it was taken hold of
    d.to = d.from;
    d.phase = 'dragging';
    try{ strip.setPointerCapture(d.pointerId); }catch(err){}
    strip.classList.add('subtab-sorting');
    d.btn.classList.add('subtab-lifted');
    const slide = subtabReducedMotion() ? 'none' : 'transform ' + SUBTAB_SETTLE_MS + 'ms ease';
    d.items.forEach(b=>{ b.style.transition = b === d.btn ? 'none' : slide; });
    if(d.touchy && navigator.vibrate){ try{ navigator.vibrate(8); }catch(err){} }
    scheduleSubtabFrame();
  }

  function scheduleSubtabFrame(){
    const d = subtabDrag;
    if(d && d.phase === 'dragging' && !d.raf) d.raf = requestAnimationFrame(subtabFrame);
  }

  function subtabFrame(){
    const d = subtabDrag;
    if(!d || d.phase !== 'dragging') return;
    d.raf = 0;
    const strip = d.strip, sr = strip.getBoundingClientRect();

    // held near an end of a strip that overflows: scroll it, faster the further in you push
    const max = strip.scrollWidth - strip.clientWidth;
    let step = 0;
    if(max > 0){
      if(d.lastX < sr.left + SUBTAB_EDGE_PX && strip.scrollLeft > 0) step = -Math.ceil((sr.left + SUBTAB_EDGE_PX - d.lastX) / 3);
      else if(d.lastX > sr.right - SUBTAB_EDGE_PX && strip.scrollLeft < max) step = Math.ceil((d.lastX - (sr.right - SUBTAB_EDGE_PX)) / 3);
      if(step) strip.scrollLeft = Math.max(0, Math.min(max, strip.scrollLeft + step));
    }

    // the lifted tab follows the pointer, clamped to the run of tabs it can land among
    const me = d.slots[d.from];
    const first = d.slots[0], last = d.slots[d.slots.length - 1];
    const px = d.lastX - sr.left + strip.scrollLeft;
    const left = Math.max(first.x, Math.min(last.x + last.w - me.w, px - d.grab));
    d.btn.style.transform = 'translateX(' + (left - me.x) + 'px)';

    // its new index is how many of the OTHER tabs have their centre left of its own
    const centre = left + me.w / 2;
    let to = 0;
    d.slots.forEach((s, i)=>{ if(i !== d.from && s.x + s.w / 2 < centre) to++; });
    if(to !== d.to){
      d.to = to;
      const shift = me.w + d.gap;
      d.items.forEach((b, i)=>{
        if(i === d.from) return;
        let t = 0;
        if(i > d.from && i <= to) t = -shift;        // was after it, now before: slides left
        else if(i < d.from && i >= to) t = shift;    // was before it, now after: slides right
        b.style.transform = t ? 'translateX(' + t + 'px)' : '';
      });
    }
    if(step) scheduleSubtabFrame();   // keep scrolling while the pointer is parked at the edge
  }

  function endSubtabDrag(commit){
    const d = subtabDrag;
    if(!d) return;
    subtabDrag = null;
    clearTimeout(d.timer);
    if(d.raf) cancelAnimationFrame(d.raf);
    window.removeEventListener('pointermove', onSubtabPointerMove);
    window.removeEventListener('pointerup', onSubtabPointerUp);
    window.removeEventListener('pointercancel', onSubtabPointerCancel);
    window.removeEventListener('keydown', onSubtabDragKey, true);
    window.removeEventListener('blur', onSubtabPointerCancel);
    if(d.phase !== 'dragging') return;   // never lifted: the press stays an ordinary click

    subtabEatClickUntil = Date.now() + SUBTAB_CLICK_EAT_MS;
    const strip = d.strip;
    try{ strip.releasePointerCapture(d.pointerId); }catch(err){}
    const wasFocused = document.activeElement === d.btn;
    const before = d.btn.getBoundingClientRect().left;   // where it is on screen at release

    // The neighbours are already drawn where the reinsert will put them, so their transforms
    // are dropped with no transition: the layout catches up to the picture in the same frame.
    d.items.forEach(b=>{ b.style.transition = 'none'; b.style.transform = ''; });
    strip.classList.remove('subtab-sorting');
    d.btn.classList.remove('subtab-lifted');

    const moved = commit && d.to !== d.from;
    if(moved){
      const others = d.items.filter(b=> b !== d.btn);
      if(d.to < others.length) strip.insertBefore(d.btn, others[d.to]);
      else others[others.length - 1].after(d.btn);
      if(wasFocused) d.btn.focus({ preventScroll:true });
    }

    // and the dropped tab glides the last few pixels from the pointer into its slot
    const dx = before - d.btn.getBoundingClientRect().left;
    if(dx && !subtabReducedMotion()){
      d.btn.style.transform = 'translateX(' + dx + 'px)';
      d.btn.getBoundingClientRect();   // commit that frame before transitioning out of it
      d.btn.style.transition = 'transform ' + SUBTAB_SETTLE_MS + 'ms ease';
      d.btn.style.transform = '';
    }
    setTimeout(()=>{
      if(subtabDrag && subtabDrag.strip === strip) return;   // a new drag on this strip owns them now
      d.items.forEach(b=>{ b.style.transition = ''; });
    }, SUBTAB_SETTLE_MS + 40);

    if(moved) commitSubtabOrder(strip);
  }

  subtabStrips().forEach(strip=>{
    strip.addEventListener('pointerdown', onSubtabPointerDown);
    // Non-passive, and attached for good rather than at pick-up: see the header — this is what
    // keeps the browser from panning the strip (or the page) under a touch drag.
    strip.addEventListener('touchmove', e=>{
      if(subtabDrag && subtabDrag.strip === strip && subtabDrag.phase === 'dragging' && e.cancelable) e.preventDefault();
    }, { passive:false });
    // Android raises a context menu on a long press; the long press is ours here
    strip.addEventListener('contextmenu', e=>{
      if(subtabDrag && subtabDrag.strip === strip) e.preventDefault();
    });
    // capture taken away by the browser rather than released by us: treat it as a cancel
    strip.addEventListener('lostpointercapture', e=>{
      if(subtabDrag && subtabDrag.strip === strip && subtabDrag.phase === 'dragging' && e.pointerId === subtabDrag.pointerId) endSubtabDrag(false);
    });
  });

  window.addEventListener('click', e=>{
    if(!subtabEatClickUntil) return;
    const live = Date.now() < subtabEatClickUntil;
    subtabEatClickUntil = 0;   // one click at most, and never a stale one
    if(live){ e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  // Not every drop is followed by a click (a release off the strip often isn't), and an eater
  // left armed would swallow the NEXT deliberate tap if it came within the window. A drag's own
  // trailing click always arrives before the next press, so any new press disarms it.
  window.addEventListener('pointerdown', ()=>{ subtabEatClickUntil = 0; }, true);

  /* Keyboard: Alt+Shift+←/→ on a focused sub-tab moves it one place among the visible ones.
     Alt+← alone would be the browser's Back. */
  document.addEventListener('keydown', e=>{
    if(!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
    if(e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const btn = e.target, strip = btn && btn.parentElement;
    if(!strip || !strip.hasAttribute('data-subtab-sort') || subtabDrag) return;
    const vis = subtabVisibleButtons(strip);
    const i = vis.indexOf(btn);
    if(i < 0) return;
    e.preventDefault();
    const j = i + (e.key === 'ArrowLeft' ? -1 : 1);
    if(j < 0 || j >= vis.length) return;
    if(j < i) strip.insertBefore(btn, vis[j]);
    else vis[j].after(btn);
    btn.focus();   // the move detached it; focusing again also scrolls it into view in a long strip
    commitSubtabOrder(strip);
  });
