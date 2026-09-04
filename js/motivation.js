  /* ================= MOTIVATION ================= */
  // The active collection is tracked by id, not by position: the display order is derived
  // (see orderedMotivationCategories) and shifts under you whenever a collection is renamed,
  // pinned, or gains images — an index would then silently point at a different collection.
  let motivationActiveCatId = '';
  let motivationSlideIdx = {};    // { [categoryId]: image index }, remembered per category
  let motivationTimer = null;
  // Unlock state survives reloads (localStorage, so it's per-device and never rides along in the
  // shared blob). Nothing re-locks on its own — "Lock now" / 🔒 are the only way back, which is
  // the point: this is a privacy screen, not a security boundary.
  const MOTIVATION_UNLOCK_KEY = 'motivation-unlocks';
  let motivationUnlocked = false;  // tab-level; hydrated from storage below
  let motivationUnlockedCats = {}; // { [categoryId]: true }; hydrated from storage below
  (function loadMotivationUnlocks(){
    try{
      const saved = JSON.parse(localStorage.getItem(MOTIVATION_UNLOCK_KEY) || 'null');
      if(!saved || typeof saved !== 'object') return;
      motivationUnlocked = !!saved.tab;
      if(saved.cats && typeof saved.cats === 'object') motivationUnlockedCats = saved.cats;
    }catch(e){}
  })();
  function persistMotivationUnlocks(){
    try{ localStorage.setItem(MOTIVATION_UNLOCK_KEY, JSON.stringify({ tab: motivationUnlocked, cats: motivationUnlockedCats })); }catch(e){}
  }
  let motivationSuppressClick = false; // true briefly after a swipe, so it doesn't also fire as a tap-to-advance
  // Which pane of the tab is showing: 'slideshow' | 'videos'. A module-level variable rather than a
  // state key, like tftActiveSubtab — these are two views of one concern (the Finance/Time ruling,
  // not the Games one), so it RESETS to 'slideshow' on tab entry. That reset lives in js/nav.js and
  // must not move into renderMotivation(), which renderAll() runs after every save and would snap
  // you out of the Videos pane mid-edit.
  let motivationActiveSubtab = 'slideshow';
  const MOTIVATION_INTERVAL_MS = 5000;
  // A video slide runs until the clip ends; this is only the ceiling, so one long pin can't park
  // the slideshow on itself indefinitely.
  const MOTIVATION_VIDEO_MAX_MS = 30000;
  // Set once the browser refuses an autoplay (no user gesture yet, or data-saver). While it's set
  // every slide is treated as a still, which is why it's cleared on the next real tap — by then
  // we're inside a gesture and play() will be allowed.
  let motivationVideoBlocked = false;

  // A category with source==='pinterest' fills itself: PINTEREST_PICK_COUNT random pins from that
  // profile's public RSS feed, swapped for a fresh set the first time the app is opened on a new
  // day (cat.lastSync holds the day key). Nothing is uploaded to Storage — the images stay as
  // i.pinimg.com URLs, so a category costs nothing and a refresh leaves nothing behind.
  // The 📌 button on a thumbnail copies that pin into PINTEREST_SAVED_CAT_NAME, an ordinary
  // category the daily refresh never touches — that's how a good pin outlives its day.
  const PINTEREST_PICK_COUNT = 25;
  const PINTEREST_SAVED_CAT_NAME = 'Saved Pins';
  let pinterestSyncing = false; // one sync at a time — renderAll and the tab-open hook can both fire

  // How the collections are laid out for the swipe / click-the-name cycle. Purely a view over
  // state.motivation.categories — the stored array is never reordered, so switching back to
  // "Added" always returns to the order things were actually created in. Ids only: the labels
  // live on the chips in index.html (#motivationOrderChips), like every other button in this
  // tab's menu, so this list is just what setMotivationCatOrder() will accept.
  const MOTIVATION_ORDERS = ['added', 'name', 'nameDesc', 'images'];

  function orderedMotivationCategories(){
    const cats = state.motivation.categories.slice();
    const order = state.motivation.catOrder || 'added';
    // Array#sort is stable, so every comparator below falls back to added order on a tie.
    if(order === 'name') cats.sort((a,b)=> String(a.name).localeCompare(String(b.name), undefined, {sensitivity:'base'}));
    else if(order === 'nameDesc') cats.sort((a,b)=> String(b.name).localeCompare(String(a.name), undefined, {sensitivity:'base'}));
    else if(order === 'images') cats.sort((a,b)=> b.images.length - a.images.length);
    // The pinned collection is lifted to the front whatever the sort says — "pin as default" is
    // exactly the promise that it's the one you land on, and a sort that could bury it would
    // make the pin meaningless.
    const pinnedId = state.motivation.pinnedCategoryId;
    if(pinnedId){
      const i = cats.findIndex(c=>c.id===pinnedId);
      if(i > 0) cats.unshift(cats.splice(i,1)[0]);
    }
    return cats;
  }

  function activeMotivationCategory(){
    const cats = state.motivation.categories;
    // Falling back to the first in display order covers a stale/blank id (fresh load, or the
    // active collection was just deleted); renderMotivation() then adopts whatever it landed on.
    return cats.find(c=>c.id===motivationActiveCatId) || orderedMotivationCategories()[0] || null;
  }

  function setMotivationCatOrder(order){
    if(MOTIVATION_ORDERS.indexOf(order) < 0) return;
    state.motivation.catOrder = order;
    save(); renderMotivation();
  }

  function renderMotivationOrderChips(){
    const wrap = el('motivationOrderChips');
    if(!wrap) return;
    const active = state.motivation.catOrder || 'added';
    wrap.querySelectorAll('.motivation-order-chip').forEach(chip=>{
      chip.classList.toggle('active', chip.dataset.order === active);
    });
  }

  // Reshuffles every category's photos once per load (called from renderAll, i.e. after the
  // initial load and after a backup restore — not on every render, or the slideshow would
  // reorder itself under you mid-session). Image order is purely display order, so shuffling
  // the array in place is enough; a later save() persisting the shuffled order is harmless
  // since the next load reshuffles anyway. Drag-to-reorder still works within the session.
  function shuffleMotivationImages(){
    state.motivation.categories.forEach(cat=>{
      const imgs = cat.images;
      for(let i = imgs.length - 1; i > 0; i--){
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = imgs[i]; imgs[i] = imgs[j]; imgs[j] = tmp;
      }
      delete motivationSlideIdx[cat.id]; // a remembered index would now point at a different photo
    });
  }

  function renderMotivation(animate){
    const locked = !!state.motivation.pin && !motivationUnlocked;
    el('motivationLock').style.display = locked ? 'block' : 'none';
    el('motivationContent').style.display = locked ? 'none' : 'block';
    if(locked){ stopMotivationSlideshow(); stopMantraSpeech(); return; }

    // The Videos pane lives outside everything below (it doesn't need a collection to exist), so
    // it's refreshed here before any of the early returns. Skipped while something in it has focus:
    // renderMotivationVideos() rebuilds the rows, and doing that under a caret would drop it.
    if(motivationActiveSubtab === 'videos' && !el('motivationPaneVideos').contains(document.activeElement)) renderMotivationVideos();

    el('motivationPinBtn').textContent = state.motivation.pin ? 'Change PIN' : 'Set PIN';
    el('motivationLockBtn').style.display = state.motivation.pin ? '' : 'none';
    renderMotivationOrderChips();
    renderMantraSpeechControls();

    const categories = orderedMotivationCategories();
    const hasCats = categories.length > 0;
    el('motivationEmpty').style.display = hasCats ? 'none' : 'block';
    // The head itself always shows — the ⋯ inside it is the only route to "new collection", so
    // hiding it with no collections would leave no way to make the first one. Only the name goes.
    el('motivationActiveName').style.display = hasCats ? '' : 'none';
    el('motivationMenuCatGroup').style.display = hasCats ? '' : 'none';
    el('motivationUploadRow').style.display = hasCats ? 'flex' : 'none';

    if(!hasCats){
      el('motivationSlideshow').style.display = 'none';
      el('motivationCatEmpty').style.display = 'none';
      el('motivationCatLock').style.display = 'none';
      el('motivationThumbs').style.display = 'none';
      stopMotivationSlideshow();
      hideMotivationVideo();
      return;
    }

    const cat = activeMotivationCategory();
    motivationActiveCatId = cat.id; // adopt the fallback, so next/prev step on from what's shown
    el('motivationActiveName').textContent = cat.name;
    el('motivationMenuCatLabel').textContent = cat.name;
    el('motivationCatPinBtn').textContent = cat.pin ? 'Change collection PIN' : 'Set collection PIN';
    const isPinnedFirst = state.motivation.pinnedCategoryId === cat.id;
    el('motivationCatPinFirstBtn').textContent = isPinnedFirst ? '📌 Unpin as default' : '📌 Pin as default';
    el('motivationCatPinFirstBtn').classList.toggle('active', isPinnedFirst);

    const isPinterest = cat.source === 'pinterest';
    el('motivationSyncPinterestBtn').style.display = isPinterest ? '' : 'none';
    el('motivationPinterestUserBtn').style.display = isPinterest ? '' : 'none';
    // Uploading into a Pinterest category would look like it worked and then vanish at the next
    // daily refresh, which replaces the whole image list — so don't offer it there.
    el('motivationUploadRow').style.display = isPinterest ? 'none' : 'flex';

    const catLocked = !!cat.pin && !motivationUnlockedCats[cat.id];
    el('motivationCatLockNowBtn').style.display = (cat.pin && !catLocked) ? '' : 'none';
    el('motivationCatLock').style.display = catLocked ? 'flex' : 'none';
    if(catLocked){
      el('motivationSlideshow').style.display = 'none';
      el('motivationCatEmpty').style.display = 'none';
      el('motivationThumbs').style.display = 'none';
      stopMotivationSlideshow();
      stopMantraSpeech();
      hideMotivationVideo(); // a locked category must not keep playing its clip behind the lock
      return;
    }

    // A category with no images has nothing to show — hide the slideshow entirely rather than
    // leave the previous category's last-shown image sitting there (it's still the same <img>
    // elements, just untouched, since showMotivationSlide() has nothing to draw into them).
    const hasImages = cat.images.length > 0;
    el('motivationSlideshow').style.display = hasImages ? 'block' : 'none';
    el('motivationCatEmpty').style.display = hasImages ? 'none' : 'flex';
    el('motivationThumbs').style.display = hasImages ? 'flex' : 'none';

    if(hasImages){
      renderMotivationThumbsAndDots(cat);
      // On the Videos pane the thumbs are still painted (so switching back is instant) but nothing
      // is started: startMotivationSlideshow() would refuse anyway, and showMotivationSlide() is
      // what presses play on a video clip — a hidden slideshow playing audio is exactly what
      // switching pane has to stop.
      if(motivationActiveSubtab === 'slideshow'){
        showMotivationSlide(!!animate);
        startMotivationSlideshow();
      } else {
        stopMotivationSlideshow();
        hideMotivationVideo();
      }
    } else {
      // hideMotivationVideo() as well as stopping: showMotivationSlide() is what normally clears
      // the video, and it isn't reached here — without this a clip from the previous category
      // would stay parked on screen over the "no images" message, still playing.
      stopMotivationSlideshow();
      hideMotivationVideo();
    }
  }

  function renderMotivationThumbsAndDots(cat){
    const thumbs = el('motivationThumbs'); thumbs.innerHTML = '';
    const dots = el('motivationDots'); dots.innerHTML = '';
    const isPinterest = cat.source === 'pinterest';
    const savedUrls = isPinterest ? savedPinUrls() : null;
    cat.images.forEach((img, i)=>{
      // loading="lazy" matters here: without it, opening a category with many images would
      // immediately download every full-resolution image just to paint a 74px thumbnail —
      // this way only the ones scrolled into view actually fetch anything.
      const thumb = document.createElement('div'); thumb.className = 'motivation-thumb'; thumb.draggable = true; thumb.dataset.imageId = img.id;
      const alreadySaved = savedUrls ? savedUrls.has(img.url) : false;
      // The badge only — the thumbnail itself stays the pin's cover <img> even for a video, so
      // the strip costs the same to paint either way and never pulls a clip.
      thumb.innerHTML = '<img src="'+img.url+'" loading="lazy" decoding="async">'
        + (img.videoUrl ? '<span class="motivation-thumb-play" aria-hidden="true">▶</span>' : '')
        + (isPinterest ? '<button class="motivation-thumb-keep'+(alreadySaved?' saved':'')+'" aria-label="'+(alreadySaved?'Already in Saved Pins':'Keep this pin')+'" title="'+(alreadySaved?'Already in Saved Pins':'Keep in '+PINTEREST_SAVED_CAT_NAME)+'">'+(alreadySaved?'✓':'📌')+'</button>' : '')
        + '<button class="motivation-thumb-del" aria-label="Delete image">&times;</button>';
      const thumbImg = thumb.querySelector('img');
      thumbImg.addEventListener('click', ()=> goToMotivationImage(i));
      applyMotivationImageFallback(thumbImg, img);
      thumb.querySelector('.motivation-thumb-del').addEventListener('click', e=>{ e.stopPropagation(); deleteMotivationImage(cat.id, img.id); });
      const keepBtn = thumb.querySelector('.motivation-thumb-keep');
      if(keepBtn) keepBtn.addEventListener('click', e=>{ e.stopPropagation(); keepMotivationImage(cat.id, img.id); });
      thumbs.appendChild(thumb);

      const dot = document.createElement('div'); dot.className = 'motivation-dot';
      dot.addEventListener('click', ()=> goToMotivationImage(i));
      dots.appendChild(dot);
    });
    dots.style.display = cat.images.length > 1 ? 'flex' : 'none';
  }

  /* drag-to-reorder motivation images — the thumbnail itself is the drag handle (no separate
     button), delegated once over #motivationThumbs so it keeps working after every re-render */
  let draggedMotivationImageId = null;
  const motivationThumbsEl = el('motivationThumbs');
  motivationThumbsEl.addEventListener('dragstart', e=>{
    const thumb = e.target.closest('.motivation-thumb');
    draggedMotivationImageId = thumb ? thumb.dataset.imageId : null;
    if(thumb) e.dataTransfer.effectAllowed = 'move';
  });
  motivationThumbsEl.addEventListener('dragover', e=>{
    if(!draggedMotivationImageId) return;
    e.preventDefault();
    const overThumb = e.target.closest('.motivation-thumb');
    motivationThumbsEl.querySelectorAll('.motivation-thumb.drag-over').forEach(t=>t.classList.remove('drag-over'));
    if(overThumb && overThumb.dataset.imageId !== draggedMotivationImageId) overThumb.classList.add('drag-over');
  });
  motivationThumbsEl.addEventListener('drop', e=>{
    if(!draggedMotivationImageId) return;
    e.preventDefault();
    motivationThumbsEl.querySelectorAll('.motivation-thumb.drag-over').forEach(t=>t.classList.remove('drag-over'));
    const overThumb = e.target.closest('.motivation-thumb');
    const toId = overThumb ? overThumb.dataset.imageId : null;
    const fromId = draggedMotivationImageId; draggedMotivationImageId = null;
    if(!toId || toId === fromId) return;
    const cat = activeMotivationCategory(); if(!cat) return;
    const fromIdx = cat.images.findIndex(x=>x.id===fromId);
    const toIdx = cat.images.findIndex(x=>x.id===toId);
    if(fromIdx<0 || toIdx<0) return;
    const activeId = cat.images[motivationSlideIdx[cat.id] || 0] ? cat.images[motivationSlideIdx[cat.id] || 0].id : null;
    const [moved] = cat.images.splice(fromIdx,1);
    cat.images.splice(toIdx,0,moved);
    if(activeId) motivationSlideIdx[cat.id] = cat.images.findIndex(x=>x.id===activeId);
    save(); renderMotivation();
  });
  motivationThumbsEl.addEventListener('dragend', ()=>{
    draggedMotivationImageId = null;
    motivationThumbsEl.querySelectorAll('.motivation-thumb.drag-over').forEach(t=>t.classList.remove('drag-over'));
  });

  function showMotivationSlide(animate){
    const cat = activeMotivationCategory();
    if(!cat || cat.images.length===0) return;

    let idx = motivationSlideIdx[cat.id] || 0;
    idx = ((idx % cat.images.length) + cat.images.length) % cat.images.length;
    motivationSlideIdx[cat.id] = idx;
    const img = cat.images[idx];
    const url = img.url;

    const layerA = el('motivationLayerA'), layerB = el('motivationLayerB');
    const current = layerA.classList.contains('active') ? layerA : layerB;
    const next = current === layerA ? layerB : layerA;
    applyMotivationImageFallback(current, img);
    applyMotivationImageFallback(next, img);

    if(!animate){
      current.src = url;
      current.classList.add('active');
      next.classList.remove('active');
    } else if(current.src !== url){
      next.onload = () => { next.classList.add('active'); current.classList.remove('active'); };
      next.src = url;
    }

    el('motivationThumbs').querySelectorAll('.motivation-thumb').forEach((t, i)=> t.classList.toggle('active', i===idx));
    el('motivationDots').querySelectorAll('.motivation-dot').forEach((d, i)=> d.classList.toggle('active', i===idx));

    applyMotivationVideo(img);

    // Warm the browser cache for just the next image (not the whole category) so the following
    // auto-advance/tap crossfades in instantly instead of showing a load delay — bounded to one
    // image ahead at a time, so this doesn't turn into a bulk-preload traffic cost.
    // Deliberately the cover image even when the next pin is a video: prefetching the clip would
    // pull megabytes per rotation for a slide that may never be reached (a tap or swipe can move
    // somewhere else first), which is exactly the bulk-traffic case this line already avoids.
    if(cat.images.length > 1){
      const nextIdx = (idx + 1) % cat.images.length;
      new Image().src = cat.images[nextIdx].url;
    }
  }

  /* ---------- video pins ----------
     The clip streams straight from v1.pinimg.com into the <video>, exactly as the stills load
     from i.pinimg.com — nothing is proxied through the Edge Function and nothing is uploaded to
     Storage, so a video collection costs Supabase no more than an image one. */

  function hideMotivationVideo(){
    const v = el('motivationVideo');
    if(!v) return;
    v.pause();
    // Dropping the src (not just hiding the element) is what actually stops the download. A
    // hidden <video> with a src set keeps buffering the rest of the clip in the background.
    if(v.getAttribute('src')){ v.removeAttribute('src'); v.load(); }
    v.style.display = 'none';
  }

  // iOS only lets a media element be played from script if play() was once called on it inside a
  // user gesture — and it grants that per element, permanently, which is what makes the single
  // reused <video> workable. Without this nothing here ever qualifies: every play() below runs
  // from a slideshow timer, a render, or visibilitychange. On a phone that's decisive rather than
  // theoretical, because Low Power Mode switches muted autoplay off outright, so the clip is
  // refused and the pin silently degrades to its cover still.
  // Deliberately bound at the document rather than to the slideshow's own tap handler: that tap
  // advances to the *next* pin, which is usually a still, so the gesture would pass without a
  // play() call happening at all. Any tap anywhere — including the nav button that opens the tab —
  // primes it instead, so the first video slide is already allowed by the time it comes up.
  let motivationVideoPrimed = false;
  function primeMotivationVideo(){
    if(motivationVideoPrimed && !motivationVideoBlocked) return; // re-prime while still refused
    motivationVideoPrimed = true;
    const v = el('motivationVideo');
    if(!v) return;
    v.muted = true; v.playsInline = true;
    const p = v.play();
    if(p && p.catch) p.catch(()=>{});
    // On a still slide there's no src, so this plays nothing — the only thing that matters is
    // that WebKit has now seen a gesture-initiated play() on this element. Park it back.
    if(!v.getAttribute('src')){ try{ v.pause(); }catch(e){} }
  }
  document.addEventListener('click', primeMotivationVideo, true);
  document.addEventListener('touchend', primeMotivationVideo, {capture:true, passive:true});

  // Individual clips that turned out to be unplayable (Pinterest 404'd it, or the browser can't
  // decode it). Session-only and keyed by URL, so one dead pin degrades to its cover still without
  // costing the rest of the collection its video — unlike motivationVideoBlocked, which is the
  // whole-session autoplay verdict.
  const motivationDeadVideos = new Set();

  // Returns true if this slide is showing as a video. Callers care about that rather than about
  // the record, because a blocked autoplay makes a video pin behave as a still.
  function applyMotivationVideo(img){
    const v = el('motivationVideo');
    if(!v) return false;
    if(!motivationSlideIsVideo(img)){ hideMotivationVideo(); return false; }

    v.style.display = 'block';
    v.poster = img.url;
    // Assigned as a property, never interpolated into markup — same rule the rest of this file
    // follows for URLs, since escapeHtml() doesn't escape the quotes that would break an attribute.
    if(v.getAttribute('src') !== img.videoUrl){ v.src = img.videoUrl; }
    // Same clip again, already finished — rewind before playing. This is the single-video
    // collection: `ended` advances, the index wraps straight back to this same pin, and calling
    // play() on a video parked at its end would fire `ended` again instantly, spinning. Rewinding
    // turns that into what it should be, an ordinary loop.
    else if(v.ended) v.currentTime = 0;
    // Re-asserted as properties on every slide rather than trusted from the markup: WebKit reads
    // muted/inline at the instant play() is called, and the attribute-only form doesn't reliably
    // survive a src assigned after load. Both are preconditions for an unattended play() on iOS —
    // without playsInline it demands fullscreen, without muted it refuses outright.
    v.muted = true; v.playsInline = true;
    const played = v.play();
    if(played && played.catch){
      const attempted = img.videoUrl;
      played.catch(err=>{
        const name = err && err.name;
        // AbortError just means a newer slide replaced this one mid-play (tapping through the
        // collection does it constantly). Nothing failed — the newer slide owns the element now,
        // so touching it here would fight whatever it just set up.
        if(name === 'AbortError') return;
        // NotAllowedError is the autoplay refusal, and it's a property of the page, not the clip
        // — no point retrying it per slide until there's been a user gesture.
        if(name === 'NotAllowedError') motivationVideoBlocked = true;
        else motivationDeadVideos.add(attempted);
        // Either way the cover is already painted in the <img> layer underneath, so drop to the
        // still and re-arm the ordinary 5s beat — otherwise this slide would sit here for the
        // full 30s video ceiling with nothing playing.
        hideMotivationVideo();
        startMotivationSlideshow();
      });
    }
    return true;
  }

  // A clip that fails after playback starts (mid-stream network drop, bad transcode) rejects no
  // promise — this is the only signal for it.
  el('motivationVideo').addEventListener('error', ()=>{
    const src = el('motivationVideo').getAttribute('src');
    if(!src) return; // fires once more as removeAttribute('src') tears the element down
    motivationDeadVideos.add(src);
    hideMotivationVideo();
    startMotivationSlideshow();
  });

  function motivationSlideIsVideo(img){
    return !!(img && img.videoUrl && !motivationVideoBlocked && !motivationDeadVideos.has(img.videoUrl));
  }

  function isMotivationVideoSlide(){
    const cat = activeMotivationCategory();
    if(!cat || !cat.images.length) return false;
    const n = cat.images.length;
    const idx = (((motivationSlideIdx[cat.id] || 0) % n) + n) % n;
    return motivationSlideIsVideo(cat.images[idx]);
  }

  function nextMotivationImage(){
    const cat = activeMotivationCategory(); if(!cat) return;
    motivationSlideIdx[cat.id] = (motivationSlideIdx[cat.id] || 0) + 1;
    showMotivationSlide(true);
    startMotivationSlideshow();
  }
  function goToMotivationImage(idx){
    const cat = activeMotivationCategory(); if(!cat) return;
    motivationSlideIdx[cat.id] = idx;
    showMotivationSlide(true);
    startMotivationSlideshow();
  }

  function toggleMotivationCategoryPinnedFirst(){
    const cat = activeMotivationCategory(); if(!cat) return;
    state.motivation.pinnedCategoryId = (state.motivation.pinnedCategoryId === cat.id) ? '' : cat.id;
    save(); renderMotivation();
  }

  // Jumps to the pinned category, if one is set — call this when the Motivation tab is opened
  // (not on every render) so it doesn't yank you back after you've manually switched categories.
  function openToPinnedMotivationCategory(){
    if(!state.motivation.pinnedCategoryId) return;
    if(state.motivation.categories.some(c=>c.id===state.motivation.pinnedCategoryId)) motivationActiveCatId = state.motivation.pinnedCategoryId;
  }

  // Both step through the *display* order, so switching the sort also changes what "next" means.
  function stepMotivationCategory(delta){
    const cats = orderedMotivationCategories();
    if(cats.length < 2) return;
    const cur = activeMotivationCategory();
    const i = cats.findIndex(c=>c.id===(cur && cur.id));
    const from = i < 0 ? 0 : i;
    motivationActiveCatId = cats[(from + delta + cats.length) % cats.length].id;
    renderMotivation(true);
  }
  function nextMotivationCategory(){ stepMotivationCategory(1); }
  function prevMotivationCategory(){ stepMotivationCategory(-1); }

  // setTimeout rather than setInterval now that the delay varies per slide. Not a behaviour change
  // for images: nextMotivationImage() already ended by calling back in here, so the old interval
  // was being torn down and recreated on every tick anyway.
  //
  // Deliberately clears the timer inline instead of calling stopMotivationSlideshow() — that one
  // also pauses the video, and this runs immediately after showMotivationSlide() has started it.
  function startMotivationSlideshow(){
    clearTimeout(motivationTimer); motivationTimer = null;
    // The Videos pane is showing, so the slideshow isn't. Same clause tftActiveSubtab === 'lobby'
    // carries for the TFT lobby poll: switching pane inside a tab has to stop the timer as surely
    // as leaving the tab does, and this is the one chokepoint every caller goes through.
    if(motivationActiveSubtab !== 'slideshow') return;
    const cat = activeMotivationCategory();
    if(!cat || cat.images.length < 2) return;
    // On a video slide this is only the ceiling — the `ended` handler below normally advances
    // first, as soon as the clip actually finishes.
    const ms = isMotivationVideoSlide() ? MOTIVATION_VIDEO_MAX_MS : MOTIVATION_INTERVAL_MS;
    motivationTimer = setTimeout(nextMotivationImage, ms);
  }
  function stopMotivationSlideshow(){
    clearTimeout(motivationTimer); motivationTimer = null;
    // Pause but keep the src: the callers that stop the slideshow temporarily (tab hidden, page
    // backgrounded) resume this same slide, and re-fetching the clip to do that would be waste.
    // The callers that leave the slide entirely call hideMotivationVideo() instead.
    const v = el('motivationVideo');
    if(v && v.getAttribute('src')) v.pause();
  }

  function addMotivationImage(catId, file){
    const cat = state.motivation.categories.find(c=>c.id===catId);
    if(!cat) return;
    uploadCompressedImage(file, 960, 0.78, 'motivation').then(url=>{
      cat.images.push({ id: uid(), url, createdAt: Date.now() });
      save(); renderMotivation();
    }).catch(err=> window.alert(err.message));
  }

  function deleteMotivationImage(catId, imageId){
    const cat = state.motivation.categories.find(c=>c.id===catId);
    if(!cat) return;
    const img = cat.images.find(x=>x.id===imageId);
    if(!img) return;
    deleteStorageImage(img.url);
    cat.images = cat.images.filter(x=>x.id!==imageId);
    save(); renderMotivation();
  }

  function addMotivationCategory(){
    const cat = { id: uid(), name: 'New Category', images: [], pin: '' };
    state.motivation.categories.push(cat);
    motivationActiveCatId = cat.id;
    save(); renderMotivation();
    promptRenameMotivationCategory(cat.id);
  }

  /* ---------- Pinterest-backed categories ---------- */

  // Pinterest's RSS gives a 236px thumbnail URL; the Edge Function asks for the /736x/ render
  // instead, which exists for nearly every pin but not quite all. Fall back to the URL the feed
  // actually handed us rather than leaving a blank slide. `tried` stops a broken fallback looping.
  function applyMotivationImageFallback(imgEl, img){
    if(!img.fallbackUrl || img.fallbackUrl === img.url){ imgEl.onerror = null; return; }
    let tried = false;
    imgEl.onerror = ()=>{ if(tried) return; tried = true; imgEl.src = img.fallbackUrl; };
  }

  function savedPinsCategory(){
    return state.motivation.categories.find(c=>c.name === PINTEREST_SAVED_CAT_NAME) || null;
  }
  function savedPinUrls(){
    const cat = savedPinsCategory();
    return new Set(cat ? cat.images.map(i=>i.url) : []);
  }

  function addPinterestCategory(){
    const entered = window.prompt('Your Pinterest username (the part after pinterest.com/) — its public pins get pulled in:', '');
    if(entered===null) return;
    const user = normalizePinterestUser(entered);
    if(!user) return;
    const cat = { id: uid(), name: 'Pinterest', images: [], pin: '', source: 'pinterest', pinterestUser: user, lastSync: '' };
    state.motivation.categories.push(cat);
    motivationActiveCatId = cat.id;
    save(); renderMotivation();
    syncPinterestCategory(cat.id, true);
  }

  function promptPinterestUser(){
    const cat = activeMotivationCategory(); if(!cat || cat.source !== 'pinterest') return;
    const entered = window.prompt('Pinterest username:', cat.pinterestUser || '');
    if(entered===null) return;
    const user = normalizePinterestUser(entered);
    if(!user) return;
    if(user === cat.pinterestUser){ syncPinterestCategory(cat.id, true); return; }
    cat.pinterestUser = user;
    cat.lastSync = ''; // different account — today's images are no longer the right ones
    save(); renderMotivation();
    syncPinterestCategory(cat.id, true);
  }

  // Accepts a bare username or a pasted profile URL, and rejects anything the Edge Function
  // would refuse anyway (it validates again server-side — that check is the real guard).
  function normalizePinterestUser(raw){
    let v = String(raw||'').trim();
    const m = v.match(/pinterest\.[a-z.]+\/([^\/?#]+)/i);
    if(m) v = m[1];
    v = v.replace(/^@/, '').replace(/\/+$/, '');
    if(!/^[A-Za-z0-9_][A-Za-z0-9_-]{0,58}$/.test(v)){
      if(v) window.alert('That doesn’t look like a Pinterest username.');
      return '';
    }
    return v;
  }

  // Pulls the profile's public feed and keeps PINTEREST_PICK_COUNT random pins, replacing whatever
  // was showing. Any failure leaves the existing images alone — a Pinterest hiccup shouldn't empty
  // the collection — and only speaks up when the user asked for this (manual), not on the silent
  // once-a-day refresh.
  async function syncPinterestCategory(catId, manual){
    const cat = state.motivation.categories.find(c=>c.id===catId);
    if(!cat || cat.source !== 'pinterest' || !cat.pinterestUser) return;
    if(pinterestSyncing) return;
    if(!supa){
      if(manual) window.alert('Pinterest sync needs the Supabase connection — it isn’t available in this copy of the app.');
      return;
    }

    pinterestSyncing = true;
    const btn = el('motivationSyncPinterestBtn');
    const btnLabel = btn.textContent;
    btn.textContent = 'Refreshing…'; btn.disabled = true;

    try{
      const { data, error } = await supa.functions.invoke('pinterest-feed', { body: { username: cat.pinterestUser } });
      if(error){
        // A non-2xx from the function arrives as a generic "non-2xx status code" message; the
        // readable one is in the response body, same unwrapping as uploadJobResume() in jobs.js.
        let detail = '';
        if(error.context && typeof error.context.json === 'function'){
          try{ detail = (await error.context.json())?.error || ''; }catch(_){}
        }
        throw new Error(detail || error.message);
      }
      if(data && data.error) throw new Error(data.error);
      const pins = (data && data.pins) || [];
      if(!pins.length) throw new Error('That Pinterest profile has no public pins to show.');

      for(let i = pins.length - 1; i > 0; i--){
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = pins[i]; pins[i] = pins[j]; pins[j] = tmp;
      }
      const picked = pins.slice(0, PINTEREST_PICK_COUNT);

      // No-op for i.pinimg.com URLs (it only matches Storage paths), but it keeps the bucket
      // clean if a real upload ever ended up in here.
      cat.images.forEach(img=> deleteStorageImage(img.url));
      // videoUrl starts empty for every pin and is filled in afterwards by resolvePinterestVideos()
      // — the feed can't tell us which of these are videos.
      const created = picked.map(p=>({ id: uid(), url: p.url, fallbackUrl: p.fallbackUrl, link: p.link, videoUrl: '', createdAt: Date.now() }));
      cat.images = created;
      cat.lastSync = localDateStr(new Date());
      // Logged, not shown: the header stays clean, but this is how you check whether board
      // discovery actually found your boards (a pool in the hundreds) or fell back to the
      // profile feed's ~25 most recent saves. Only the 10 picked above are stored.
      console.info('Pinterest sync: picked ' + picked.length + ' of ' + pins.length + ' pins across ' + ((data && data.boards) || 0) + ' boards');
      delete motivationSlideIdx[cat.id]; // start the new set from the top
      save(); renderMotivation();
      resolvePinterestVideos(cat.id, created); // not awaited — see below
    }catch(err){
      console.error('Pinterest sync failed', err);
      if(manual) window.alert((err && err.message) || 'Could not refresh from Pinterest.');
    }finally{
      pinterestSyncing = false;
      btn.textContent = btnLabel; btn.disabled = false;
    }
  }

  // Second pass over the pins the sync just picked, asking which of them are videos. Deliberately
  // fire-and-forget, after the images are already on screen and saved: resolving means the Edge
  // Function fetches ~25 pin pages, which is slower than the feed read itself, and none of it is
  // needed for the collection to work. So a slow or failed resolve costs nothing visible — the
  // pins simply stay stills, exactly as they were before this existed. Only the picked pins are
  // resolved, not the whole 138-380 pin pool, which is what keeps it to one extra call a day.
  async function resolvePinterestVideos(catId, images){
    const links = images.map(i=>i.link).filter(Boolean);
    if(!links.length || !supa) return;

    let videos;
    try{
      const { data, error } = await supa.functions.invoke('pinterest-feed', { body: { resolve: links } });
      if(error || !data || !data.videos) return;
      videos = data.videos;
    }catch(err){
      console.error('Pinterest video resolve failed', err);
      return;
    }

    const cat = state.motivation.categories.find(c=>c.id===catId);
    if(!cat) return; // collection deleted while we were resolving

    let changed = 0;
    images.forEach(rec=>{
      const url = rec.link && videos[rec.link];
      if(!url) return;
      // Matched by record id, never by index: another sync (or a delete, or a drag-reorder) may
      // have rewritten cat.images while this was in flight, and patching by position would then
      // staple a video URL onto whatever unrelated pin now sits at that slot.
      const live = cat.images.find(x=>x.id===rec.id);
      if(!live) return;
      live.videoUrl = url; changed++;
    });
    if(!changed) return;

    console.info('Pinterest sync: ' + changed + ' of ' + links.length + ' picked pins are videos');
    save(); renderMotivation();
  }

  // Once per day, on the first app load (or first Motivation tab open) after the date rolls over.
  // The day-key comparison makes every other call a cheap no-op.
  function maybeSyncPinterestCategories(){
    const today = localDateStr(new Date());
    const due = state.motivation.categories.find(c=> c.source==='pinterest' && c.pinterestUser && c.lastSync !== today);
    if(due) syncPinterestCategory(due.id, false);
  }

  // Copies a pin into the "Saved Pins" category — an ordinary category, so the daily refresh
  // never touches it. The image URL is shared, not moved: the original stays in the Pinterest
  // category until that refresh replaces it.
  function keepMotivationImage(catId, imageId){
    const cat = state.motivation.categories.find(c=>c.id===catId); if(!cat) return;
    const img = cat.images.find(x=>x.id===imageId); if(!img) return;

    let saved = savedPinsCategory();
    if(!saved){
      saved = { id: uid(), name: PINTEREST_SAVED_CAT_NAME, images: [], pin: '', source: '', pinterestUser: '', lastSync: '' };
      state.motivation.categories.push(saved);
    }
    if(saved.images.some(x=>x.url === img.url)) return; // already kept — the ✓ already says so
    // videoUrl comes along too — without it, keeping a video pin would silently downgrade it to
    // its cover still, and Saved Pins is never re-synced so nothing would ever restore it.
    saved.images.push({ id: uid(), url: img.url, fallbackUrl: img.fallbackUrl, link: img.link, videoUrl: img.videoUrl || '', createdAt: Date.now() });
    save(); renderMotivation();
  }

  function promptRenameMotivationCategory(catId){
    const cat = state.motivation.categories.find(c=>c.id===catId); if(!cat) return;
    const entered = window.prompt('Rename category:', cat.name);
    if(entered===null) return;
    const v = entered.trim();
    if(!v) return;
    cat.name = v; save(); renderMotivation();
  }

  function deleteMotivationCategory(catId){
    const cat = state.motivation.categories.find(c=>c.id===catId);
    if(!cat) return;
    cat.images.forEach(img=> deleteStorageImage(img.url));
    state.motivation.categories = state.motivation.categories.filter(c=>c.id!==catId);
    delete motivationSlideIdx[catId];
    delete motivationUnlockedCats[catId]; persistMotivationUnlocks();
    if(state.motivation.pinnedCategoryId === catId) state.motivation.pinnedCategoryId = '';
    save(); renderMotivation();
  }

  function promptSetMotivationCategoryPin(){
    const cat = activeMotivationCategory(); if(!cat) return;
    const has = !!cat.pin;
    const entered = window.prompt(has ? 'Change PIN for "'+cat.name+'" (leave blank to remove the lock):' : 'Set a PIN to lock "'+cat.name+'" (leave blank to cancel):', '');
    if(entered===null) return;
    const v = entered.trim();
    if(!has && !v) return;
    cat.pin = v;
    if(v) motivationUnlockedCats[cat.id] = true; // you just proved you know it by setting it
    else delete motivationUnlockedCats[cat.id];
    persistMotivationUnlocks();
    save(); renderMotivation();
  }

  function promptMotivationCatUnlock(){
    const cat = activeMotivationCategory(); if(!cat) return;
    const entered = window.prompt('Enter PIN for "'+cat.name+'":');
    if(entered===null) return;
    if(entered === cat.pin){ motivationUnlockedCats[cat.id] = true; persistMotivationUnlocks(); renderMotivation(); }
    else window.alert('Incorrect PIN.');
  }

  function promptSetMotivationPin(){
    const has = !!state.motivation.pin;
    const entered = window.prompt(has ? 'Change PIN (leave blank to remove the lock):' : 'Set a PIN to lock this tab (leave blank to cancel):', '');
    if(entered===null) return;
    const v = entered.trim();
    if(!has && !v) return;
    state.motivation.pin = v;
    if(v) motivationUnlocked = true; // you just proved you know it by setting it — no need to re-enter immediately
    persistMotivationUnlocks();
    save(); renderMotivation();
  }

  function promptMotivationUnlock(){
    const entered = window.prompt('Enter Motivation PIN:');
    if(entered===null) return;
    if(entered === state.motivation.pin){ motivationUnlocked = true; persistMotivationUnlocks(); renderMotivation(); }
    else window.alert('Incorrect PIN.');
  }

  /* ---------- mantra text-to-speech ----------
     Two engines sit behind one speakMantra(): the browser's own Web Speech API (the default — no
     dependency, no network, nothing uploaded) and ElevenLabs (a real voice, at the cost of a paid
     API call per line). The 🔊 on the mantra overlay reads whatever mantra is currently shown;
     state.motivation.speakMantra makes it additionally read each *new* one, which means on the tap
     that rerolls it. Auto-advancing the slideshow deliberately doesn't reroll the mantra, so this
     never starts talking on its own.

     Everything the engines need is localStorage, never `state` — the browser voice list belongs to
     the device (a name picked on the phone would mean nothing on the desktop, the same reasoning as
     the unlocks above), and the ElevenLabs API key is *spendable*, so it must not ride the shared
     unauthenticated row the way state.valorant.apiKey does. Five rules hold the ElevenLabs half up:
       - It is spend, not data, so it goes through appCanWrite() like the AI suggestion call — a
         read-only guest gets the browser voice, never a request billed to somebody else's account.
       - Any failure falls back to the browser voice rather than going silent: the point of the
         button is that the mantra gets read, and a key that expired mid-week must not break it.
       - Rendered audio is memoized per key+voice+text for the session, so tapping the same mantra
         twice is free. Memory only, capped — an mp3 per mantra must never reach the shared blob.
       - One utterance at a time, across both engines: stopMantraSpeech() cancels the browser queue,
         pauses the <audio>, AND bumps mantraSpeakToken, which is what makes an in-flight fetch
         discard its own result instead of talking over the mantra you moved on to.
       - api.elevenlabs.io is called straight from the page (it sends permissive CORS, the
         api.metatft.com ruling) so there is no Edge Function here — which is exactly why its host
         must stay in sw.js's LIVE_DATA_HOSTS: the cross-origin branch is cache-FIRST, and a cached
         audio response would pin one mantra's recording over every later line. */
  const motivationTTS = ('speechSynthesis' in window) ? window.speechSynthesis : null;
  const MANTRA_VOICE_KEY = 'motivation-mantra-voice';
  const MANTRA_ENGINE_KEY = 'motivation-mantra-engine';
  const MANTRA_11_KEY_KEY = 'motivation-mantra-11-key';
  const MANTRA_11_VOICE_KEY = 'motivation-mantra-11-voice';
  const ELEVEN_API = 'https://api.elevenlabs.io/v1';
  const ELEVEN_MODEL = 'eleven_multilingual_v2'; // the quality model; a mantra is one short line, so latency isn't the constraint
  const ELEVEN_CACHE_CAP = 24;
  function mantraLS(k){ try{ return localStorage.getItem(k) || ''; }catch(e){ return ''; } }
  function mantraLSSet(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }

  let mantraVoiceURI = mantraLS(MANTRA_VOICE_KEY);
  let mantraEngine = mantraLS(MANTRA_ENGINE_KEY) === 'elevenlabs' ? 'elevenlabs' : 'browser';
  let elevenKey = mantraLS(MANTRA_11_KEY_KEY);
  let elevenVoiceId = mantraLS(MANTRA_11_VOICE_KEY);
  let elevenVoices = null;      // null = never loaded; [] = loaded and the account has none
  let elevenVoicesKey = '';     // which API key the loaded list belongs to
  let elevenLoading = false;
  let elevenNote = '';          // last error/status line shown under the picker
  const elevenAudioCache = new Map(); // 'key|voice|text' -> object URL (session only)
  let mantraAudio = null;
  let mantraSpeakToken = 0;

  function elevenReady(){ return mantraEngine === 'elevenlabs' && !!elevenKey && !!elevenVoiceId && appCanWrite(); }
  function mantraSpeechAvailable(){ return !!motivationTTS || (mantraEngine === 'elevenlabs' && !!elevenKey); }

  function mantraVoices(){
    if(!motivationTTS) return [];
    // Chrome populates this asynchronously — an empty list here means "not yet", which is what
    // the voiceschanged listener below re-renders for rather than an unsupported browser.
    let list = [];
    try{ list = motivationTTS.getVoices() || []; }catch(e){ return []; }
    return list.slice().sort((a,b)=> String(a.lang).localeCompare(String(b.lang)) || String(a.name).localeCompare(String(b.name)));
  }
  // null = leave utterance.voice unset and let the browser pick its own default, which is the
  // right behaviour both before the list has loaded and after a saved voice disappears.
  function pickMantraVoice(){
    return mantraVoices().find(v=>v.voiceURI === mantraVoiceURI) || null;
  }

  function stopMantraSpeech(){
    mantraSpeakToken++; // anything already in flight now belongs to a mantra nobody is looking at
    if(motivationTTS){ try{ motivationTTS.cancel(); }catch(e){} }
    if(mantraAudio){ try{ mantraAudio.pause(); }catch(e){} mantraAudio = null; }
  }

  function currentMantraText(){
    // Read from the element rather than state.mantras[mantraIdx]: what should be spoken is
    // definitionally the line on screen, whoever last wrote it there.
    const node = el('mantraText');
    return node ? (node.textContent || '').trim() : '';
  }

  function speakMantraBrowser(text){
    if(!motivationTTS) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.92; // a mantra read at the default rate sounds hurried
    const voice = pickMantraVoice();
    if(voice){ u.voice = voice; u.lang = voice.lang; }
    try{ motivationTTS.speak(u); }catch(e){}
  }

  function elevenAudioUrl(text){
    const cacheKey = elevenKey.slice(-6) + '|' + elevenVoiceId + '|' + text;
    const hit = elevenAudioCache.get(cacheKey);
    if(hit) return Promise.resolve(hit);
    return fetch(ELEVEN_API + '/text-to-speech/' + encodeURIComponent(elevenVoiceId), {
      method: 'POST',
      headers: { 'xi-api-key': elevenKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: ELEVEN_MODEL, voice_settings: { stability: 0.45, similarity_boost: 0.8 } })
    }).then(res=>{
      if(!res.ok) throw new Error(res.status === 401 ? 'ElevenLabs rejected the API key' : 'ElevenLabs error ' + res.status);
      return res.blob();
    }).then(blob=>{
      const url = URL.createObjectURL(blob);
      elevenAudioCache.set(cacheKey, url);
      if(elevenAudioCache.size > ELEVEN_CACHE_CAP){
        const oldest = elevenAudioCache.keys().next().value;
        const dead = elevenAudioCache.get(oldest);
        elevenAudioCache.delete(oldest);
        try{ URL.revokeObjectURL(dead); }catch(e){}
      }
      return url;
    });
  }

  function speakMantra(){
    if(!state.mantras.length) return;
    const text = currentMantraText();
    if(!text) return;
    // cancel() first, never queue — a second tap replaces what's being read. Queueing would let
    // tapping through a collection back up a minute of speech behind the image you're looking at.
    stopMantraSpeech();
    if(!elevenReady()){ speakMantraBrowser(text); return; }
    const token = mantraSpeakToken;
    elevenAudioUrl(text).then(url=>{
      if(token !== mantraSpeakToken) return; // superseded while the request was in flight
      const audio = new Audio(url);
      mantraAudio = audio;
      if(elevenNote){ elevenNote = ''; renderMantraSpeechControls(); }
      return audio.play();
    }).catch(err=>{
      if(token !== mantraSpeakToken) return;
      elevenNote = (err && err.message) ? err.message : 'ElevenLabs is unreachable';
      renderMantraSpeechControls();
      speakMantraBrowser(text); // the mantra still gets read
    });
  }

  // The tap on the slideshow both rerolls the mantra and, if enabled, reads the new one.
  function rerollAndSpeakMantra(){
    rerollMantra();
    if(state.motivation.speakMantra) speakMantra();
  }

  function loadElevenVoices(){
    if(elevenLoading || !elevenKey || !appCanWrite()) return;
    if(elevenVoices && elevenVoicesKey === elevenKey) return; // already have this account's list
    elevenLoading = true; elevenNote = 'Loading voices…'; renderMantraSpeechControls();
    fetch(ELEVEN_API + '/voices', { headers: { 'xi-api-key': elevenKey } })
      .then(res=>{ if(!res.ok) throw new Error(res.status === 401 ? 'ElevenLabs rejected the API key' : 'ElevenLabs error ' + res.status); return res.json(); })
      .then(data=>{
        elevenVoices = Array.isArray(data && data.voices) ? data.voices : [];
        elevenVoicesKey = elevenKey;
        elevenNote = elevenVoices.length ? '' : 'That account has no voices.';
        // A saved voice the account no longer has would 404 on every line, so adopt the first one
        // instead of leaving a dead id selected.
        if(!elevenVoices.some(v=>v.voice_id === elevenVoiceId)){
          elevenVoiceId = elevenVoices.length ? elevenVoices[0].voice_id : '';
          mantraLSSet(MANTRA_11_VOICE_KEY, elevenVoiceId);
        }
      })
      .catch(err=>{ elevenVoices = null; elevenNote = (err && err.message) ? err.message : 'Could not reach ElevenLabs'; })
      .then(()=>{ elevenLoading = false; renderMantraSpeechControls(); });
  }

  function renderMantraSpeechControls(){
    const supported = mantraSpeechAvailable();
    el('motivationSpeechGroup').style.display = supported ? '' : 'none';
    el('mantraSpeakBtn').style.display = supported ? '' : 'none';
    if(!supported) return;

    const on = !!state.motivation.speakMantra;
    const toggle = el('motivationSpeakMantraBtn');
    toggle.textContent = on ? '🔊 Read mantra aloud: On' : '🔇 Read mantra aloud: Off';
    toggle.classList.toggle('active', on);

    const usingEleven = mantraEngine === 'elevenlabs';
    el('mantraEngineSelect').value = mantraEngine;
    el('mantraVoiceSelect').style.display = usingEleven ? 'none' : '';
    el('mantraElevenGroup').style.display = usingEleven ? '' : 'none';

    const sel = el('mantraVoiceSelect');
    const voices = mantraVoices();
    // Rebuilt only when the list actually changed: this runs on every renderMotivation() (which
    // includes every menu open), and replacing the <option>s under an open dropdown would close it.
    const sig = voices.map(v=>v.voiceURI).join('|');
    if(sel.dataset.sig !== sig){
      sel.dataset.sig = sig;
      sel.innerHTML = '';
      const def = document.createElement('option');
      def.value = ''; def.textContent = voices.length ? 'Browser default voice' : 'No voices available';
      sel.appendChild(def);
      voices.forEach(v=>{
        const opt = document.createElement('option');
        opt.value = v.voiceURI;
        opt.textContent = v.name + ' (' + v.lang + ')'; // textContent — voice names are not ours to trust as markup
        sel.appendChild(opt);
      });
    }
    sel.value = voices.some(v=>v.voiceURI === mantraVoiceURI) ? mantraVoiceURI : '';

    // The key field is live, so never write into it while it holds the caret (the notes.js rule).
    const keyInput = el('mantraElevenKey');
    if(document.activeElement !== keyInput) keyInput.value = elevenKey;

    const vsel = el('mantraElevenVoice');
    const list = elevenVoices || [];
    const vsig = elevenVoicesKey + '::' + list.map(v=>v.voice_id).join('|');
    if(vsel.dataset.sig !== vsig){
      vsel.dataset.sig = vsig;
      vsel.innerHTML = '';
      if(!list.length){
        const def = document.createElement('option');
        def.value = ''; def.textContent = elevenKey ? 'No voices loaded' : 'Add an API key first';
        vsel.appendChild(def);
      }
      list.forEach(v=>{
        const opt = document.createElement('option');
        opt.value = v.voice_id;
        opt.textContent = v.name + (v.labels && v.labels.accent ? ' (' + v.labels.accent + ')' : ''); // textContent — voice names are not ours to trust as markup
        vsel.appendChild(opt);
      });
    }
    vsel.value = list.some(v=>v.voice_id === elevenVoiceId) ? elevenVoiceId : '';

    el('mantraElevenHint').textContent = elevenNote || (appCanWrite()
      ? 'Billed to your ElevenLabs account, one call per new line. The key stays on this device.'
      : 'This session is read-only — the browser voice is used instead.');
  }

  if(motivationTTS && motivationTTS.addEventListener) motivationTTS.addEventListener('voiceschanged', renderMantraSpeechControls);

  el('mantraSpeakBtn').addEventListener('click', e=>{
    // The overlay's own click minimizes it — asking to hear the mantra isn't asking to fold it,
    // and the wrapper underneath would otherwise also advance the slide.
    e.stopPropagation();
    speakMantra();
  });
  el('motivationSpeakMantraBtn').addEventListener('click', ()=>{
    state.motivation.speakMantra = !state.motivation.speakMantra;
    if(state.motivation.speakMantra) speakMantra(); // switching it on reads the current one, so "On" demonstrates itself
    else stopMantraSpeech();
    save(); renderMotivation();
  });
  el('mantraVoiceSelect').addEventListener('change', e=>{
    mantraVoiceURI = e.target.value;
    mantraLSSet(MANTRA_VOICE_KEY, mantraVoiceURI);
    speakMantra(); // sample the voice you just picked
  });
  el('mantraEngineSelect').addEventListener('change', e=>{
    mantraEngine = e.target.value === 'elevenlabs' ? 'elevenlabs' : 'browser';
    mantraLSSet(MANTRA_ENGINE_KEY, mantraEngine);
    stopMantraSpeech();
    elevenNote = '';
    if(mantraEngine === 'elevenlabs') loadElevenVoices();
    renderMantraSpeechControls();
  });
  // change, not input: a key is pasted or typed in full, and firing a voices fetch per keystroke
  // would spend the rate-limit budget on every prefix of it.
  el('mantraElevenKey').addEventListener('change', e=>{
    const next = e.target.value.trim();
    if(next === elevenKey) return;
    elevenKey = next;
    mantraLSSet(MANTRA_11_KEY_KEY, elevenKey);
    elevenVoices = null; elevenVoicesKey = ''; elevenNote = '';
    // The cache is keyed by the account that rendered it, so it can't outlive the key change.
    elevenAudioCache.forEach(url=>{ try{ URL.revokeObjectURL(url); }catch(err){} });
    elevenAudioCache.clear();
    loadElevenVoices();
    renderMantraSpeechControls();
  });
  el('mantraElevenVoice').addEventListener('change', e=>{
    elevenVoiceId = e.target.value;
    mantraLSSet(MANTRA_11_VOICE_KEY, elevenVoiceId);
    speakMantra(); // sample the voice you just picked
  });
  // The voice list is fetched once at boot when ElevenLabs is already the chosen engine, so the
  // first 🔊 doesn't have to wait for it — and so a revoked key is reported before it's needed.
  if(mantraEngine === 'elevenlabs' && elevenKey) loadElevenVoices();

  /* ================= VIDEO LINKS ================= */
  /* Saved links to motivational clips that live on YouTube, Instagram or TikTok. These are not
     files — there is nothing to point the slideshow's <video> at — so each one plays in a
     third-party <iframe>, which is why they get their own pane instead of joining a collection.

     Two rules hold the whole thing up:
       - An embed src is built ONLY from `videoId`, which parseMotivationVideoUrl() has already
         matched against a strict character class. The raw URL is never interpolated into markup,
         so an attribute can't be broken out of — the same discipline MD_SAFE_URL carries in
         js/notes.js, and it matters here because this rides the shared unauthenticated row.
       - Exactly one iframe is alive at a time, and closing the lightbox REMOVES it. An iframe
         merely hidden keeps playing: you'd close the video and still hear it.

     Instagram and TikTok embeds cannot be autoplayed or controlled from here — you press play in
     their own player. That's a property of their embeds, not something to fix; it's also half the
     reason every row carries an ↗ that opens the post where it actually lives. */

  const MOT_VIDEO_PLATFORMS = {
    youtube:   { label: 'YouTube',   badge: 'YT' },
    instagram: { label: 'Instagram', badge: 'IG' },
    tiktok:    { label: 'TikTok',    badge: 'TT' }
  };

  // YouTube refuses to embed into a file:// page outright (error 153, see js/music.js) because it
  // checks the framing origin, which is the string "null" there. Instagram and TikTok do NOT —
  // they render and play fine from disk — so this names YouTube rather than claiming no video
  // works, which would be plainly contradicted by the reel playing next to the message.
  const MOT_VIDEO_FILE_NOTE = 'Heads up: YouTube won’t play from a file:// page — run “node scripts/serve.mjs” and open http://localhost:8025 for those. Instagram and TikTok work either way.';

  /* Returns { platform, videoId, vertical, error }. Mirrors parsePlaylistUrl()'s shape in
     js/music.js, including its habit of returning a readable sentence instead of letting the
     failure happen invisibly inside the frame. */
  function parseMotivationVideoUrl(raw){
    const s = (raw||'').trim();
    const fail = msg => ({ platform:'', videoId:'', vertical:false, error: msg });
    if(!s) return fail('');
    let u;
    try{ u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); }
    catch(e){ return fail('That doesn’t look like a link. Paste the whole URL, starting with https://'); }
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const path = u.pathname;

    // ---- YouTube (incl. Shorts, youtu.be, and the m./music. hosts) ----
    if(/(^|\.)youtube\.com$/.test(host) || host === 'youtu.be' || /(^|\.)youtube-nocookie\.com$/.test(host)){
      let id = '', vertical = false;
      if(host === 'youtu.be') id = path.slice(1).split('/')[0];
      else {
        const m = path.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/);
        if(m){ id = m[2]; vertical = m[1] === 'shorts'; }
        else id = u.searchParams.get('v') || '';
      }
      // A YouTube id is exactly 11 of these characters; anything else is a channel//playlist/search
      // URL that has no single video in it, and guessing would embed the wrong thing.
      if(!/^[A-Za-z0-9_-]{11}$/.test(id)) return fail('No video id in that YouTube link. Use a link to one video — youtube.com/watch?v=…, youtu.be/… or youtube.com/shorts/…');
      return { platform:'youtube', videoId:id, vertical, error:'' };
    }

    // ---- Instagram (reels and ordinary posts) ----
    if(/(^|\.)instagram\.com$/.test(host)){
      // /reel/, /reels/, /p/ and /tv/ — and the same shortcodes also appear one level deeper as
      // /<user>/reel/<code>/, which is what the app's own share sheet hands you.
      const m = path.match(/\/(reel|reels|p|tv)\/([^/?#]+)/);
      if(!m) return fail('No post id in that Instagram link. Open the reel, tap ⋯ → Copy link, and paste that — it should have /reel/ or /p/ in it.');
      if(!/^[A-Za-z0-9_-]{5,}$/.test(m[2])) return fail('That Instagram link’s post id doesn’t look right — try copying it again.');
      // /reels/ is only ever a viewing route; the embed route is the singular one.
      return { platform:'instagram', videoId:m[2], vertical:true, error:'', igKind: m[1] === 'p' ? 'p' : 'reel' };
    }

    // ---- TikTok ----
    if(/(^|\.)tiktok\.com$/.test(host)){
      const m = path.match(/\/(?:@[^/]+\/video|v|embed\/v2|embed)\/(\d{6,})/);
      if(m) return { platform:'tiktok', videoId:m[1], vertical:true, error:'' };
      // vm./vt. short links and /t/ redirects carry no video id at all, and the redirect can't be
      // followed from a browser (TikTok sends no CORS headers), so there is nothing to resolve it
      // with client-side. Saying so is better than saving a link that could never play.
      if(/^(vm|vt)\./.test(u.hostname.toLowerCase()) || /^\/t\//.test(path))
        return fail('TikTok short links don’t contain the video id. Open it in TikTok, then Share → Copy link and paste the long one — it has /video/ in it.');
      return fail('No video id in that TikTok link. It should look like tiktok.com/@someone/video/1234567890.');
    }

    return fail('Only YouTube, Instagram and TikTok links can be played here.');
  }

  /* Built from the validated id alone — never from rec.url. */
  function motVideoEmbedSrc(rec){
    const id = encodeURIComponent(rec.videoId);
    if(rec.platform === 'youtube') return 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&playsinline=1';
    // The click that opened the lightbox is the user gesture, which is why autoplay above is
    // allowed. Neither of the two below honours an autoplay param at all.
    if(rec.platform === 'instagram') return 'https://www.instagram.com/' + (rec.igKind === 'p' ? 'p' : 'reel') + '/' + id + '/embed/';
    if(rec.platform === 'tiktok') return 'https://www.tiktok.com/embed/v2/' + id;
    return '';
  }

  /* Thumbnails, and why the three platforms differ.
       YouTube  — derivable from the id alone, no request at all. i.ytimg.com is already exempt in
                  sw.js, so it's a live fetch and never a stale cached frame.
       TikTok   — not derivable, but its oEmbed returns thumbnail_url and is CORS-open, and we're
                  already calling that endpoint for the title, so it costs nothing extra.
       Instagram— there is no keyless route. The legacy api.instagram.com/oembed now 302s to an
                  HTML page with no Access-Control-Allow-Origin, graph.facebook.com's
                  instagram_oembed requires an app token, and /p/<code>/media/ is 404. So those
                  rows keep the platform tile; don't add a scraper for it.

     The TikTok URL is deliberately NOT persisted. It's signed and expires, which is exactly the
     kind of volatile third-party value the rest of this app keeps out of the shared blob
     (state.valorant.live, calEvents) — a stored one would rot into a broken image, and it would
     be re-uploaded with every unrelated save until it did. Memory-only means it's simply fetched
     again next session. */
  const motVideoThumbCache = {};   // 'platform:id' -> url, this session only
  const motVideoMetaPending = {};  // same key -> true while a lookup is in flight

  function motVideoKey(rec){ return rec.platform + ':' + rec.videoId; }

  function motVideoThumbUrl(rec){
    if(rec.platform === 'youtube') return 'https://i.ytimg.com/vi/' + encodeURIComponent(rec.videoId) + '/hqdefault.jpg';
    return motVideoThumbCache[motVideoKey(rec)] || '';
  }

  // The one place ordering happens — favourites first, then newest. Anything else sorting its own
  // copy is how two views of one list start disagreeing (the tftSortedEntries() rule).
  function motVideosSorted(){
    return state.motivation.videos.slice().sort((a,b)=>{
      if(!!a.fav !== !!b.fav) return a.fav ? -1 : 1;
      return (b.createdAt||0) - (a.createdAt||0);
    });
  }

  function setMotVideoHint(msg){
    const hint = el('motVideoHint');
    if(!hint) return;
    const text = msg || (location.protocol === 'file:' ? MOT_VIDEO_FILE_NOTE : '');
    hint.textContent = text;
    hint.style.display = text ? 'block' : 'none';
  }

  /* ---------- the list ---------- */
  function renderMotivationVideos(){
    const list = el('motVideoList');
    if(!list) return;
    const vids = motVideosSorted();
    el('motVideoEmpty').style.display = vids.length ? 'none' : 'block';
    list.innerHTML = '';
    vids.forEach(rec=>{
      const meta = MOT_VIDEO_PLATFORMS[rec.platform] || { label:'Link', badge:'?' };
      const row = document.createElement('div');
      row.className = 'mot-video-row';
      row.dataset.videoId = rec.id;

      // Thumb — the click target for playback. A button so it's reachable by keyboard.
      const thumb = document.createElement('button');
      thumb.type = 'button';
      thumb.className = 'mot-video-thumb pf-' + (rec.platform || 'other');
      thumb.dataset.act = 'play';
      thumb.title = 'Play';
      thumb.setAttribute('aria-label', 'Play ' + (rec.title || meta.label + ' video'));
      const badge = document.createElement('span');
      badge.className = 'mot-video-badge';
      badge.textContent = meta.badge;
      thumb.appendChild(badge);
      const thumbUrl = motVideoThumbUrl(rec);
      if(thumbUrl){
        const im = document.createElement('img');
        im.loading = 'lazy'; im.alt = '';
        // Falls back to the bare platform tile the badge is already sitting on, rather than
        // leaving a broken-image frame where the picture should be.
        im.addEventListener('error', ()=> im.remove());
        im.src = thumbUrl;
        thumb.appendChild(im);
      }
      row.appendChild(thumb);

      const body = document.createElement('div');
      body.className = 'mot-video-body';
      // .value, never a value="…" attribute: escapeHtml() does not escape double quotes, so a
      // title containing one would break out of the attribute (js/music.js carries the same note).
      const title = document.createElement('input');
      title.className = 'mot-video-title'; title.dataset.act = 'title';
      title.value = rec.title || '';
      title.placeholder = meta.label + ' video';
      title.setAttribute('aria-label', 'Video title');
      const note = document.createElement('input');
      note.className = 'mot-video-note'; note.dataset.act = 'note';
      note.value = rec.note || '';
      note.placeholder = 'Add a note…';
      note.setAttribute('aria-label', 'Note');
      body.appendChild(title); body.appendChild(note);
      row.appendChild(body);

      const acts = document.createElement('div');
      acts.className = 'mot-video-acts';
      const fav = document.createElement('button');
      fav.type = 'button'; fav.className = 'mot-video-act' + (rec.fav ? ' is-fav' : '');
      fav.dataset.act = 'fav'; fav.textContent = rec.fav ? '★' : '☆';
      fav.title = rec.fav ? 'Unpin from the top' : 'Pin to the top';
      fav.setAttribute('aria-label', fav.title);
      const open = document.createElement('a');
      open.className = 'mot-video-act'; open.dataset.act = 'open';
      open.target = '_blank'; open.rel = 'noopener noreferrer';
      open.textContent = '↗';
      open.title = 'Open in ' + meta.label;
      open.setAttribute('aria-label', open.title);
      open.href = rec.url || '#'; // .href, not an interpolated attribute — same reason as .value above
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'mot-video-act danger';
      del.dataset.act = 'del'; del.textContent = '🗑';
      del.title = 'Remove'; del.setAttribute('aria-label', 'Remove');
      acts.appendChild(fav); acts.appendChild(open); acts.appendChild(del);
      row.appendChild(acts);

      list.appendChild(row);
    });
  }

  /* ---------- add / mutate ---------- */
  function motVideoById(id){ return state.motivation.videos.find(v=>v.id===id) || null; }

  function addMotivationVideo(){
    const input = el('motVideoUrl');
    const raw = input.value.trim();
    if(!raw){ setMotVideoHint(''); return; }
    const parsed = parseMotivationVideoUrl(raw);
    if(parsed.error || !parsed.videoId){ setMotVideoHint(parsed.error || 'Couldn’t read that link.'); return; }
    // Dedupe on platform + id rather than on the URL string: the same reel has half a dozen link
    // forms (share link, /reels/ vs /reel/, tracking params), and they're all the same video.
    if(state.motivation.videos.some(v=>v.platform===parsed.platform && v.videoId===parsed.videoId)){
      setMotVideoHint('That one’s already saved.');
      input.select();
      return;
    }
    const rec = {
      id: uid(),
      platform: parsed.platform,
      videoId: parsed.videoId,
      url: raw,
      title: '',
      note: '',
      fav: false,
      vertical: !!parsed.vertical,
      createdAt: Date.now()
    };
    if(parsed.igKind) rec.igKind = parsed.igKind;
    state.motivation.videos.push(rec);
    input.value = '';
    setMotVideoHint('');
    save();
    renderMotivationVideos();
    fetchMotVideoMeta(rec.id);
  }

  function deleteMotivationVideo(id){
    const rec = motVideoById(id);
    if(!rec) return;
    if(!confirm('Remove "' + (rec.title || rec.url) + '"?')) return;
    state.motivation.videos = state.motivation.videos.filter(v=>v.id!==id);
    save();
    renderMotivationVideos();
  }

  function toggleMotivationVideoFav(id){
    const rec = motVideoById(id);
    if(!rec) return;
    rec.fav = !rec.fav;
    save();
    renderMotivationVideos(); // re-sorts — the whole point of the star
  }

  /* One oEmbed lookup fills both the title and (for TikTok) the thumbnail. Fire-and-forget,
     modelled on resolvePinterestVideos(): the record is already saved and on screen before this
     runs, nothing depends on it, and a failure just leaves the placeholder tile and title.
     Patched back BY RECORD ID, never by index — a delete may have rewritten the list mid-flight.
     Instagram has no CORS-open oEmbed at all, so it never gets here. */
  function fetchMotVideoMeta(recId){
    const rec = motVideoById(recId);
    if(!rec) return;
    const key = motVideoKey(rec);
    if(motVideoMetaPending[key]) return;
    const wantTitle = !rec.title;
    // YouTube's thumbnail is derived, so a YouTube row with a title already has nothing to ask for.
    const wantThumb = rec.platform === 'tiktok' && !motVideoThumbCache[key];
    if(!wantTitle && !wantThumb) return;
    let endpoint = '';
    if(rec.platform === 'youtube') endpoint = 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + rec.videoId);
    else if(rec.platform === 'tiktok') endpoint = 'https://www.tiktok.com/oembed?url=' + encodeURIComponent('https://www.tiktok.com/@x/video/' + rec.videoId);
    if(!endpoint) return;
    motVideoMetaPending[key] = true;
    fetch(endpoint).then(r=> r.ok ? r.json() : null).then(j=>{
      if(!j) return;
      const live = motVideoById(recId); // re-read: it may have been deleted or renamed since
      if(!live) return;
      let changed = false;
      const t = typeof j.title === 'string' ? j.title.trim() : '';
      // Only if it's STILL untitled — you may have typed one while this was in flight.
      if(t && !live.title){ live.title = t.length > 120 ? t.slice(0,120) : t; save(); changed = true; }
      const th = typeof j.thumbnail_url === 'string' ? j.thumbnail_url : '';
      // Cache only, never save() — see the note on motVideoThumbCache above.
      if(th && /^https:\/\//.test(th) && !motVideoThumbCache[key]){ motVideoThumbCache[key] = th; changed = true; }
      if(changed && !el('motivationPaneVideos').contains(document.activeElement)) renderMotivationVideos();
    }).catch(()=>{}).then(()=>{ delete motVideoMetaPending[key]; });
  }

  /* Called when the pane is shown, so rows saved before this existed (or in an earlier session,
     since thumbnails aren't persisted) fill themselves in. fetchMotVideoMeta() no-ops for anything
     that already has what it needs, so this is cheap to call repeatedly. */
  function ensureMotVideoMeta(){
    state.motivation.videos.forEach(v=> fetchMotVideoMeta(v.id));
  }

  /* ---------- the lightbox ---------- */
  function openMotVideoPlayer(id){
    const rec = motVideoById(id);
    if(!rec) return;
    const src = motVideoEmbedSrc(rec);
    if(!src) return;
    const wrap = el('motVideoFrameWrap');
    const card = el('motVideoCard');
    wrap.innerHTML = ''; // never two players
    card.classList.toggle('is-tall', !!rec.vertical);
    // Drives the chrome-crop offsets in styles.css. Instagram and TikTok each wrap their player in
    // their own header/like/caption bar, and a cross-origin iframe can't be styled from here — the
    // only lever is to oversize the frame and clip theirs off, per platform.
    card.dataset.platform = rec.platform;
    const meta = MOT_VIDEO_PLATFORMS[rec.platform] || { label:'Video' };
    el('motVideoBarTitle').textContent = rec.title || meta.label + ' video';
    const openBtn = el('motVideoOpenBtn');
    openBtn.href = rec.url || '#';
    openBtn.title = 'Open in ' + meta.label;
    const f = document.createElement('iframe');
    f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
    f.setAttribute('allowfullscreen', '');
    f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    // Belt to the CSS's braces: the frames are sized past their own content so they never need to
    // scroll, but a cross-origin document's overflow can't be reached from here, so ask as well.
    f.setAttribute('scrolling', 'no');
    f.setAttribute('title', el('motVideoBarTitle').textContent);
    f.src = src;
    wrap.appendChild(f);
    el('motVideoOverlay').style.display = 'flex';
  }

  function closeMotVideoPlayer(){
    const overlay = el('motVideoOverlay');
    if(!overlay || overlay.style.display === 'none') return;
    overlay.style.display = 'none';
    // Removing the iframe, not just hiding the overlay: a hidden iframe carries on playing, so
    // closing the video would leave its audio running with nothing on screen to stop it.
    el('motVideoFrameWrap').innerHTML = '';
  }

  /* ---------- panes ---------- */
  function showMotivationSubTab(which){
    motivationActiveSubtab = (which === 'videos') ? 'videos' : 'slideshow';
    document.querySelectorAll('#motivationContent [data-motsub]').forEach(b=>{
      b.classList.toggle('active', b.dataset.motsub === motivationActiveSubtab);
    });
    const onVideos = motivationActiveSubtab === 'videos';
    el('motivationPaneSlideshow').style.display = onVideos ? 'none' : '';
    el('motivationPaneVideos').style.display = onVideos ? 'block' : 'none';
    if(onVideos){
      // Leaving the slideshow has to silence it as surely as leaving the tab does — and the menu
      // is a slideshow-pane control, so a menu left open would float over the video list.
      stopMotivationSlideshow();
      stopMantraSpeech();
      hideMotivationVideo();
      closeMotivationMenu();
      setMotVideoHint('');
      renderMotivationVideos();
      ensureMotVideoMeta();
    } else {
      closeMotVideoPlayer();
      renderMotivation();
    }
  }

  /* ---------- options menu ---------- */
  // Everything that used to be a row of buttons above the slideshow. renderMotivation() runs on
  // open so labels ("Set" vs "Change PIN") and the Pinterest-only items are current.
  function openMotivationMenu(){ renderMotivation(); el('motivationMenu').style.display = 'flex'; }
  function closeMotivationMenu(){ el('motivationMenu').style.display = 'none'; }
  el('motivationMenuBtn').addEventListener('click', openMotivationMenu);
  el('motivationMenuCloseBtn').addEventListener('click', closeMotivationMenu);
  el('motivationMenu').addEventListener('click', e=>{ if(e.target === el('motivationMenu')) closeMotivationMenu(); });
  document.addEventListener('keydown', e=>{ if(e.key === 'Escape' && el('motivationMenu').style.display === 'flex') closeMotivationMenu(); });
  // Capture phase on purpose: picking an item closes the menu *before* that item's own handler
  // runs, so the window.prompt several of them open isn't left sitting on top of an open modal.
  // data-keep-menu exempts the in-place toggles (read-aloud, collection order) — those show their
  // result *in* the menu, so closing it would hide the only feedback that the tap did anything.
  el('motivationMenu').addEventListener('click', e=>{
    const item = e.target.closest('.motivation-menu-item');
    if(item && !item.hasAttribute('data-keep-menu')) closeMotivationMenu();
  }, true);

  el('motivationOrderChips').addEventListener('click', e=>{
    const chip = e.target.closest('.motivation-order-chip');
    if(chip) setMotivationCatOrder(chip.dataset.order);
  });

  el('addMotivationCategoryBtn').addEventListener('click', addMotivationCategory);
  el('addPinterestCategoryBtn').addEventListener('click', addPinterestCategory);
  el('motivationSyncPinterestBtn').addEventListener('click', ()=>{ const cat = activeMotivationCategory(); if(cat) syncPinterestCategory(cat.id, true); });
  el('motivationPinterestUserBtn').addEventListener('click', promptPinterestUser);
  // Click the category name to cycle to the next one — the only way to switch categories on
  // desktop, since the swipe gesture only exists for touch. Renaming now has its own button.
  el('motivationActiveName').addEventListener('click', nextMotivationCategory);
  el('motivationRenameCatBtn').addEventListener('click', ()=>{ const cat = activeMotivationCategory(); if(cat) promptRenameMotivationCategory(cat.id); });
  el('motivationCatPinFirstBtn').addEventListener('click', toggleMotivationCategoryPinnedFirst);
  el('motivationCatPinBtn').addEventListener('click', promptSetMotivationCategoryPin);
  el('motivationCatLockNowBtn').addEventListener('click', ()=>{
    const cat = activeMotivationCategory(); if(!cat) return;
    delete motivationUnlockedCats[cat.id];
    persistMotivationUnlocks();
    renderMotivation();
  });
  el('motivationCatUnlockBtn').addEventListener('click', promptMotivationCatUnlock);
  el('motivationDelCatBtn').addEventListener('click', ()=>{ const cat = activeMotivationCategory(); if(cat) deleteMotivationCategory(cat.id); });
  el('motivationUploadInput').addEventListener('change', e=>{
    const file = e.target.files[0]; if(!file) return;
    const cat = activeMotivationCategory();
    if(cat) addMotivationImage(cat.id, file);
    e.target.value = '';
  });
  el('motivationGlowWrap').addEventListener('click', ()=>{
    if(motivationSuppressClick) return;
    // A tap is the user gesture browsers want before they'll allow autoplay, so retry video from
    // here — a collection that fell back to stills on load starts playing once you interact.
    // (primeMotivationVideo() has already run for this same tap, from the document listener.)
    const wasBlocked = motivationVideoBlocked;
    motivationVideoBlocked = false;
    // When autoplay had been refused, this tap belongs to the pin you're looking at: play its clip
    // rather than skipping past it. Advancing instead means each tap only ever re-lands on another
    // unplayed still, so you can tap through a whole collection without one video starting.
    if(wasBlocked && isMotivationVideoSlide()){
      showMotivationSlide(false);
      startMotivationSlideshow();
      rerollAndSpeakMantra();
      return;
    }
    nextMotivationImage();
    rerollAndSpeakMantra();
  });
  // What normally advances a video slide: the 30s ceiling in startMotivationSlideshow() is just
  // the backstop. Bound once here rather than per slide, since the element is reused.
  el('motivationVideo').addEventListener('ended', ()=>{
    const view = el('view-motivation');
    if(view && view.classList.contains('active') && !document.hidden) nextMotivationImage();
  });
  // Sits on top of the slideshow image (z-index above it) so this click never also reaches
  // motivationGlowWrap's reroll/advance handler underneath.
  el('mantraRow').addEventListener('click', ()=>{
    el('mantraRow').classList.toggle('minimized');
  });
  el('motivationPinBtn').addEventListener('click', promptSetMotivationPin);
  el('motivationLockBtn').addEventListener('click', ()=>{ motivationUnlocked = false; persistMotivationUnlocks(); renderMotivation(); });
  el('motivationUnlockBtn').addEventListener('click', promptMotivationUnlock);

  /* ---------- video links wiring ---------- */
  document.querySelectorAll('#motivationContent [data-motsub]').forEach(b=>{
    b.addEventListener('click', ()=> showMotivationSubTab(b.dataset.motsub));
  });
  el('motVideoAddBtn').addEventListener('click', addMotivationVideo);
  el('motVideoUrl').addEventListener('keydown', e=>{ if(e.key === 'Enter'){ e.preventDefault(); addMotivationVideo(); } });
  // Typing dismisses a stale "already saved" / parse error rather than leaving it contradicting
  // the box it's sitting under. Never re-renders — see the change-vs-input note below.
  el('motVideoUrl').addEventListener('input', ()=> setMotVideoHint(''));

  // Delegated from the list, which renderMotivationVideos() rebuilds wholesale on every change.
  el('motVideoList').addEventListener('click', e=>{
    const hit = e.target.closest('[data-act]');
    const row = e.target.closest('.mot-video-row');
    if(!hit || !row) return;
    const id = row.dataset.videoId;
    if(hit.dataset.act === 'play') openMotVideoPlayer(id);
    else if(hit.dataset.act === 'fav') toggleMotivationVideoFav(id);
    else if(hit.dataset.act === 'del') deleteMotivationVideo(id);
    // 'open' is a real <a href> — let it navigate.
  });
  // 'change' (i.e. on blur / Enter), deliberately NOT 'input'. Two reasons: these ride the shared
  // blob, which doSave() re-uploads in full, so a per-keystroke save would re-send every goal and
  // habit in the app on every letter; and per the notes.js rule a live field must never trigger a
  // re-render, which would rebuild the input mid-keystroke and drop the caret.
  el('motVideoList').addEventListener('change', e=>{
    const field = e.target.closest('[data-act="title"], [data-act="note"]');
    const row = e.target.closest('.mot-video-row');
    if(!field || !row) return;
    const rec = motVideoById(row.dataset.videoId);
    if(!rec) return;
    const val = field.value.trim();
    if(field.dataset.act === 'title'){ if(rec.title === val) return; rec.title = val; }
    else { if(rec.note === val) return; rec.note = val; }
    save(); // no re-render: the field already shows the value, and rebuilding it would fight focus
  });

  el('motVideoCloseBtn').addEventListener('click', closeMotVideoPlayer);
  el('motVideoOverlay').addEventListener('click', e=>{ if(e.target === el('motVideoOverlay')) closeMotVideoPlayer(); });
  document.addEventListener('keydown', e=>{ if(e.key === 'Escape') closeMotVideoPlayer(); });

  // Swiping switches between categories (not images — tap the image for that). Bound to the
  // always-visible wrapper, not #motivationSlideshow itself, since that's display:none whenever
  // the active category is locked or has no images — swiping still needs to work then too.
  (function(){
    const box = el('motivationSlideArea');
    let startX = 0, startY = 0, tracking = false;
    box.addEventListener('touchstart', e => {
      if(e.touches.length !== 1) return;
      startX = e.touches[0].clientX; startY = e.touches[0].clientY; tracking = true;
    }, {passive:true});
    box.addEventListener('touchend', e => {
      if(!tracking) return;
      tracking = false;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if(Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      motivationSuppressClick = true; setTimeout(()=> motivationSuppressClick = false, 300);
      dx < 0 ? nextMotivationCategory() : prevMotivationCategory();
    }, {passive:true});
  })();

  // Pause auto-advance while the page/tab isn't visible (backgrounded, minimized, screen off)
  // so it isn't silently cycling through images — and the images it'd be fetching — for no one
  // to see. Only resumes if the Motivation tab is still the one actually showing.
  document.addEventListener('visibilitychange', ()=>{
    if(document.hidden){ stopMotivationSlideshow(); stopMantraSpeech(); return; }
    const view = el('view-motivation');
    // showMotivationSlide() rather than only restarting the timer: stopMotivationSlideshow()
    // paused any video, and this is what presses play again. It's idempotent for a still, and
    // for a video it reuses the already-buffered src rather than re-fetching.
    if(view && view.classList.contains('active') && motivationActiveSubtab === 'slideshow'){ showMotivationSlide(false); startMotivationSlideshow(); }
  });
