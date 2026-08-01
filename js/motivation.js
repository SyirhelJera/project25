  /* ================= MOTIVATION ================= */
  let motivationSlideIdx = 0;
  let motivationTimer = null;
  const MOTIVATION_INTERVAL_MS = 5000;

  function renderMotivation(){
    const images = state.motivation.images;
    el('motivationEmpty').style.display = images.length===0 ? 'block' : 'none';
    el('motivationSlideshow').style.display = images.length===0 ? 'none' : 'block';

    const thumbs = el('motivationThumbs'); thumbs.innerHTML = '';
    images.forEach((img, i)=>{
      const thumb = document.createElement('div'); thumb.className = 'motivation-thumb';
      thumb.innerHTML = '<img src="'+img.url+'"><button class="motivation-thumb-del" aria-label="Delete image">&times;</button>';
      thumb.querySelector('img').addEventListener('click', ()=> goToMotivationSlide(i));
      thumb.querySelector('.motivation-thumb-del').addEventListener('click', e=>{ e.stopPropagation(); deleteMotivationImage(img.id); });
      thumbs.appendChild(thumb);
    });

    const dots = el('motivationDots'); dots.innerHTML = '';
    images.forEach((img, i)=>{
      const dot = document.createElement('div'); dot.className = 'motivation-dot';
      dot.addEventListener('click', ()=> goToMotivationSlide(i));
      dots.appendChild(dot);
    });

    const showControls = images.length > 1;
    el('motivationPrevBtn').style.display = showControls ? 'flex' : 'none';
    el('motivationNextBtn').style.display = showControls ? 'flex' : 'none';
    dots.style.display = showControls ? 'flex' : 'none';

    if(images.length===0){ motivationSlideIdx = 0; stopMotivationSlideshow(); return; }
    if(motivationSlideIdx >= images.length) motivationSlideIdx = images.length - 1;
    showMotivationSlide(motivationSlideIdx, false);
    startMotivationSlideshow();
  }

  function showMotivationSlide(idx, animate){
    if(animate === undefined) animate = true;
    const images = state.motivation.images;
    if(images.length===0) return;
    motivationSlideIdx = ((idx % images.length) + images.length) % images.length;
    const url = images[motivationSlideIdx].url;

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

    el('motivationThumbs').querySelectorAll('.motivation-thumb').forEach((t, i)=> t.classList.toggle('active', i===motivationSlideIdx));
    el('motivationDots').querySelectorAll('.motivation-dot').forEach((d, i)=> d.classList.toggle('active', i===motivationSlideIdx));
  }

  function nextMotivationSlide(){ showMotivationSlide(motivationSlideIdx + 1); startMotivationSlideshow(); }
  function prevMotivationSlide(){ showMotivationSlide(motivationSlideIdx - 1); startMotivationSlideshow(); }
  function goToMotivationSlide(idx){ showMotivationSlide(idx); startMotivationSlideshow(); }

  function startMotivationSlideshow(){
    clearInterval(motivationTimer);
    motivationTimer = state.motivation.images.length > 1 ? setInterval(nextMotivationSlide, MOTIVATION_INTERVAL_MS) : null;
  }
  function stopMotivationSlideshow(){ clearInterval(motivationTimer); motivationTimer = null; }

  function addMotivationImage(file){
    uploadCompressedImage(file, 1280, 0.85, 'motivation').then(url=>{
      state.motivation.images.push({ id: uid(), url, createdAt: Date.now() });
      save(); renderMotivation();
    }).catch(err=> window.alert(err.message));
  }

  function deleteMotivationImage(id){
    const img = state.motivation.images.find(x=>x.id===id);
    if(!img) return;
    deleteStorageImage(img.url);
    state.motivation.images = state.motivation.images.filter(x=>x.id!==id);
    save(); renderMotivation();
  }

  el('motivationUploadInput').addEventListener('change', e=>{
    const file = e.target.files[0]; if(!file) return;
    addMotivationImage(file);
    e.target.value = '';
  });
  el('motivationPrevBtn').addEventListener('click', prevMotivationSlide);
  el('motivationNextBtn').addEventListener('click', nextMotivationSlide);

  (function(){
    const box = el('motivationSlideshow');
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
      dx < 0 ? nextMotivationSlide() : prevMotivationSlide();
    }, {passive:true});
  })();
