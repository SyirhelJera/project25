  /* ================= MOTIVATION ================= */
  let motivationActiveCatIdx = 0;
  let motivationSlideIdx = {};    // { [categoryId]: image index }, remembered per category
  let motivationTimer = null;
  let motivationUnlocked = false; // session-only — re-locks on every fresh page load
  let motivationUnlockedCats = {}; // { [categoryId]: true } — session-only per-category unlocks
  let motivationSuppressClick = false; // true briefly after a swipe, so it doesn't also fire as a tap-to-advance
  const MOTIVATION_INTERVAL_MS = 5000;

  function activeMotivationCategory(){
    return state.motivation.categories[motivationActiveCatIdx] || null;
  }

  function renderMotivation(animate){
    const locked = !!state.motivation.pin && !motivationUnlocked;
    el('motivationLock').style.display = locked ? 'block' : 'none';
    el('motivationContent').style.display = locked ? 'none' : 'block';
    if(locked){ stopMotivationSlideshow(); return; }

    el('motivationPinBtn').textContent = state.motivation.pin ? 'Change PIN' : 'Set PIN';
    el('motivationLockBtn').style.display = state.motivation.pin ? 'inline-flex' : 'none';

    const categories = state.motivation.categories;
    const hasCats = categories.length > 0;
    el('motivationEmpty').style.display = hasCats ? 'none' : 'block';
    el('motivationHead').style.display = hasCats ? 'flex' : 'none';
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
    el('motivationCatPinBtn').textContent = cat.pin ? 'Change category PIN' : 'Set category PIN';
    const isPinnedFirst = state.motivation.pinnedCategoryId === cat.id;
    el('motivationCatPinFirstBtn').textContent = isPinnedFirst ? '📌 Unpin as default' : '📌 Pin as default';
    el('motivationCatPinFirstBtn').classList.toggle('active', isPinnedFirst);

    const catLocked = !!cat.pin && !motivationUnlockedCats[cat.id];
    el('motivationCatLockNowBtn').style.display = (cat.pin && !catLocked) ? 'inline-flex' : 'none';
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
    cat.images.forEach((img, i)=>{
      // loading="lazy" matters here: without it, opening a category with many images would
      // immediately download every full-resolution image just to paint a 74px thumbnail —
      // this way only the ones scrolled into view actually fetch anything.
      const thumb = document.createElement('div'); thumb.className = 'motivation-thumb'; thumb.draggable = true; thumb.dataset.imageId = img.id;
      thumb.innerHTML = '<img src="'+img.url+'" loading="lazy" decoding="async"><button class="motivation-thumb-del" aria-label="Delete image">&times;</button>';
      thumb.querySelector('img').addEventListener('click', ()=> goToMotivationImage(i));
      thumb.querySelector('.motivation-thumb-del').addEventListener('click', e=>{ e.stopPropagation(); deleteMotivationImage(cat.id, img.id); });
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
    const url = cat.images[idx].url;

    const layerA = el('motivationLayerA'), layerB = el('motivationLayerB');
    const current = layerA.classList.contains('active') ? layerA : layerB;
    const next = current === layerA ? layerB : layerA;

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
    uploadCompressedImage(file, 1280, 0.85, 'motivation').then(url=>{
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
    delete motivationUnlockedCats[catId];
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
    save(); renderMotivation();
  }

  function promptMotivationCatUnlock(){
    const cat = activeMotivationCategory(); if(!cat) return;
    const entered = window.prompt('Enter PIN for "'+cat.name+'":');
    if(entered===null) return;
    if(entered === cat.pin){ motivationUnlockedCats[cat.id] = true; renderMotivation(); }
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
    save(); renderMotivation();
  }

  function promptMotivationUnlock(){
    const entered = window.prompt('Enter Motivation PIN:');
    if(entered===null) return;
    if(entered === state.motivation.pin){ motivationUnlocked = true; renderMotivation(); }
    else window.alert('Incorrect PIN.');
  }

  el('addMotivationCategoryBtn').addEventListener('click', addMotivationCategory);
  // Click the category name to cycle to the next one — the only way to switch categories on
  // desktop, since the swipe gesture only exists for touch. Renaming now has its own button.
  el('motivationActiveName').addEventListener('click', nextMotivationCategory);
  el('motivationRenameCatBtn').addEventListener('click', ()=>{ const cat = activeMotivationCategory(); if(cat) promptRenameMotivationCategory(cat.id); });
  el('motivationCatPinFirstBtn').addEventListener('click', toggleMotivationCategoryPinnedFirst);
  el('motivationCatPinBtn').addEventListener('click', promptSetMotivationCategoryPin);
  el('motivationCatLockNowBtn').addEventListener('click', ()=>{
    const cat = activeMotivationCategory(); if(!cat) return;
    delete motivationUnlockedCats[cat.id];
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
  el('motivationPinBtn').addEventListener('click', promptSetMotivationPin);
  el('motivationLockBtn').addEventListener('click', ()=>{ motivationUnlocked = false; renderMotivation(); });
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
