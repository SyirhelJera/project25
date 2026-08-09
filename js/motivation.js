  /* ================= MOTIVATION ================= */
  let motivationActiveCatIdx = 0;
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
  const MOTIVATION_INTERVAL_MS = 5000;

  // A category with source==='pinterest' fills itself: PINTEREST_PICK_COUNT random pins from that
  // profile's public RSS feed, swapped for a fresh set the first time the app is opened on a new
  // day (cat.lastSync holds the day key). Nothing is uploaded to Storage — the images stay as
  // i.pinimg.com URLs, so a category costs nothing and a refresh leaves nothing behind.
  // The 📌 button on a thumbnail copies that pin into PINTEREST_SAVED_CAT_NAME, an ordinary
  // category the daily refresh never touches — that's how a good pin outlives its day.
  const PINTEREST_PICK_COUNT = 10;
  const PINTEREST_SAVED_CAT_NAME = 'Saved Pins';
  let pinterestSyncing = false; // one sync at a time — renderAll and the tab-open hook can both fire

  function activeMotivationCategory(){
    return state.motivation.categories[motivationActiveCatIdx] || null;
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
    if(locked){ stopMotivationSlideshow(); return; }

    el('motivationPinBtn').textContent = state.motivation.pin ? 'Change PIN' : 'Set PIN';
    el('motivationLockBtn').style.display = state.motivation.pin ? '' : 'none';

    const categories = state.motivation.categories;
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
      return;
    }
    if(motivationActiveCatIdx >= categories.length) motivationActiveCatIdx = categories.length - 1;
    if(motivationActiveCatIdx < 0) motivationActiveCatIdx = 0;

    const cat = categories[motivationActiveCatIdx];
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
      showMotivationSlide(!!animate);
      renderMotivationThumbsAndDots(cat);
      startMotivationSlideshow();
    } else {
      stopMotivationSlideshow();
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
      thumb.innerHTML = '<img src="'+img.url+'" loading="lazy" decoding="async">'
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

    // Warm the browser cache for just the next image (not the whole category) so the following
    // auto-advance/tap crossfades in instantly instead of showing a load delay — bounded to one
    // image ahead at a time, so this doesn't turn into a bulk-preload traffic cost.
    if(cat.images.length > 1){
      const nextIdx = (idx + 1) % cat.images.length;
      new Image().src = cat.images[nextIdx].url;
    }
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
    const idx = state.motivation.categories.findIndex(c=>c.id===state.motivation.pinnedCategoryId);
    if(idx >= 0) motivationActiveCatIdx = idx;
  }

  function nextMotivationCategory(){
    if(state.motivation.categories.length < 2) return;
    motivationActiveCatIdx = (motivationActiveCatIdx + 1) % state.motivation.categories.length;
    renderMotivation(true);
  }
  function prevMotivationCategory(){
    const n = state.motivation.categories.length;
    if(n < 2) return;
    motivationActiveCatIdx = (motivationActiveCatIdx - 1 + n) % n;
    renderMotivation(true);
  }

  function startMotivationSlideshow(){
    clearInterval(motivationTimer);
    const cat = activeMotivationCategory();
    motivationTimer = (cat && cat.images.length > 1) ? setInterval(nextMotivationImage, MOTIVATION_INTERVAL_MS) : null;
  }
  function stopMotivationSlideshow(){ clearInterval(motivationTimer); motivationTimer = null; }

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
    motivationActiveCatIdx = state.motivation.categories.length - 1;
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
    motivationActiveCatIdx = state.motivation.categories.length - 1;
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
      cat.images = picked.map(p=>({ id: uid(), url: p.url, fallbackUrl: p.fallbackUrl, link: p.link, createdAt: Date.now() }));
      cat.lastSync = localDateStr(new Date());
      // Logged, not shown: the header stays clean, but this is how you check whether board
      // discovery actually found your boards (a pool in the hundreds) or fell back to the
      // profile feed's ~25 most recent saves. Only the 10 picked above are stored.
      console.info('Pinterest sync: picked ' + picked.length + ' of ' + pins.length + ' pins across ' + ((data && data.boards) || 0) + ' boards');
      delete motivationSlideIdx[cat.id]; // start the new set from the top
      save(); renderMotivation();
    }catch(err){
      console.error('Pinterest sync failed', err);
      if(manual) window.alert((err && err.message) || 'Could not refresh from Pinterest.');
    }finally{
      pinterestSyncing = false;
      btn.textContent = btnLabel; btn.disabled = false;
    }
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
    saved.images.push({ id: uid(), url: img.url, fallbackUrl: img.fallbackUrl, link: img.link, createdAt: Date.now() });
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
  el('motivationMenu').addEventListener('click', e=>{ if(e.target.closest('.motivation-menu-item')) closeMotivationMenu(); }, true);

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
    nextMotivationImage();
    rerollMantra();
  });
  // Sits on top of the slideshow image (z-index above it) so this click never also reaches
  // motivationGlowWrap's reroll/advance handler underneath.
  el('mantraRow').addEventListener('click', ()=>{
    el('mantraRow').classList.toggle('minimized');
  });
  el('motivationPinBtn').addEventListener('click', promptSetMotivationPin);
  el('motivationLockBtn').addEventListener('click', ()=>{ motivationUnlocked = false; persistMotivationUnlocks(); renderMotivation(); });
  el('motivationUnlockBtn').addEventListener('click', promptMotivationUnlock);

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
    if(document.hidden){ stopMotivationSlideshow(); return; }
    const view = el('view-motivation');
    if(view && view.classList.contains('active')) startMotivationSlideshow();
  });
