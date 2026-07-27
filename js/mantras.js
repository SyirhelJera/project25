  /* ================= MANTRAS ================= */
  function renderMantras(){
    const list = el('mantraList'); list.innerHTML='';
    el('mantraEmpty').style.display = state.mantras.length===0 ? 'block':'none';
    state.mantras.forEach(m => {
      const card = document.createElement('div'); card.className='mantra-card';
      card.innerHTML = '<div class="mantra-text">'+escapeHtml(m.text)+'</div><button class="del-goal">Delete</button>';
      card.querySelector('.del-goal').addEventListener('click', ()=>{ state.mantras = state.mantras.filter(x=>x.id!==m.id); save(); renderMantras(); renderMantra(); });
      list.appendChild(card);
    });
  }
  function addMantra(){
    const input = el('newMantraInput'); const v = input.value.trim();
    if(!v) return;
    state.mantras.unshift({ id:uid(), text:v });
    input.value=''; save(); renderMantras(); renderMantra();
  }
  el('addMantraBtn').addEventListener('click', addMantra);
  el('newMantraInput').addEventListener('keydown', e=>{ if(e.key==='Enter') addMantra(); });

