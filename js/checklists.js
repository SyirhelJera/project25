  /* ================= CHECKLISTS ================= */
  function resetKeyFor(freq, d){
    d = d || new Date();
    if(freq === 'daily') return localDateStr(d);
    if(freq === 'weekly'){ const day=(d.getDay()+6)%7; const monday=new Date(d); monday.setDate(d.getDate()-day); return localDateStr(monday); }
    if(freq === 'monthly') return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    if(freq === 'yearly') return String(d.getFullYear());
    return null;
  }
  function applyChecklistResets(){
    let changed = false;
    state.checklists.forEach(c=>{
      if(!c.resetFreq || c.resetFreq === 'none') return;
      const key = resetKeyFor(c.resetFreq);
      if(c.lastResetKey == null){
        // never synced before (freq just turned on, older saved data, etc.) — just record the
        // current period without wiping anything the user has already checked off. Previously
        // this fell through to the wipe branch below, which could clear a checklist's progress
        // even though its reset day/week/month hadn't actually arrived yet.
        c.lastResetKey = key;
        changed = true;
        return;
      }
      if(c.lastResetKey !== key){
        c.items.forEach(it=>{ it.done = false; });
        c.lastResetKey = key;
        changed = true;
      }
    });
    if(changed) save();
  }
  const FREQ_LABELS = {none:'No reset', daily:'Reset daily', weekly:'Reset weekly', monthly:'Reset monthly', yearly:'Reset yearly'};

  // if a checklist is linked to a habit and every item on it is checked, mark that habit done for today too
  function syncChecklistHabitLink(c){
    if(!c.linkedHabitId || !c.items.length) return;
    const allDone = c.items.every(it=>it.done);
    if(!allDone) return;
    const h = state.habits.find(x=>x.id===c.linkedHabitId);
    if(h){ if(!h.completions) h.completions={}; h.completions[localDateStr(new Date())] = true; }
  }

  /* drag-to-reorder checklists — registered once, delegated over #checklistList */
  let draggedChecklistId = null;
  let draggedChecklistItemId = null;
  const checklistListEl = el('checklistList');
  checklistListEl.addEventListener('dragstart', e=>{
    const handle = e.target.closest('.drag-handle');
    if(!handle) return;
    const card = handle.closest('.checklist-card');
    draggedChecklistId = card ? card.dataset.checklistId : null;
    e.dataTransfer.effectAllowed = 'move';
  });
  checklistListEl.addEventListener('dragover', e=>{
    if(!draggedChecklistId) return;
    e.preventDefault();
    const overCard = e.target.closest('.checklist-card');
    checklistListEl.querySelectorAll('.checklist-card.drag-over').forEach(c=>c.classList.remove('drag-over'));
    if(overCard && overCard.dataset.checklistId !== draggedChecklistId) overCard.classList.add('drag-over');
  });
  checklistListEl.addEventListener('drop', e=>{
    if(!draggedChecklistId) return;
    e.preventDefault();
    checklistListEl.querySelectorAll('.checklist-card.drag-over').forEach(c=>c.classList.remove('drag-over'));
    const overCard = e.target.closest('.checklist-card');
    const toId = overCard ? overCard.dataset.checklistId : null;
    const fromId = draggedChecklistId; draggedChecklistId = null;
    if(!toId || toId === fromId) return;
    const fromIdx = state.checklists.findIndex(x=>x.id===fromId);
    const toIdx = state.checklists.findIndex(x=>x.id===toId);
    if(fromIdx<0 || toIdx<0) return;
    const [moved] = state.checklists.splice(fromIdx,1);
    state.checklists.splice(toIdx,0,moved);
    save(); renderChecklists();
  });
  checklistListEl.addEventListener('dragend', ()=>{ draggedChecklistId = null; checklistListEl.querySelectorAll('.checklist-card.drag-over').forEach(c=>c.classList.remove('drag-over')); });

  /* collapse state for named checklist subgroups — not persisted, resets per page load, mirrors
     the pattern used for weight-log month groups */
  const checklistGroupCollapsed = {};

  function renderChecklists(){
    applyChecklistResets();
    const list = el('checklistList'); list.innerHTML = '';
    el('checklistEmpty').style.display = state.checklists.length===0 ? 'block' : 'none';

    // group checklists into subgroups (by c.group), preserving overall order; ungrouped items
    // (group === '') render without a header, above any named groups they appear alongside
    const groupOrder = [];
    const groupsMap = {};
    state.checklists.forEach(c=>{
      if(c.resetFreq === undefined) c.resetFreq = 'none';
      if(c.linkedHabitId === undefined) c.linkedHabitId = null;
      if(c.group === undefined) c.group = '';
      const gkey = c.group || '';
      if(!(gkey in groupsMap)){ groupsMap[gkey] = []; groupOrder.push(gkey); }
      groupsMap[gkey].push(c);
    });

    groupOrder.forEach(gkey=>{
      if(gkey){
        const collapsed = !!checklistGroupCollapsed[gkey];
        const lbl = document.createElement('div'); lbl.className='finance-group-lbl checklist-group-header';
        lbl.style.cursor = 'pointer';
        lbl.innerHTML = '<span class="wlg-chevron">'+(collapsed?'▶':'▼')+'</span> '+escapeHtml(gkey)+' <span style="font-weight:600;text-transform:none;letter-spacing:0;color:var(--faint);">('+groupsMap[gkey].length+')</span>';
        lbl.addEventListener('click', ()=>{ checklistGroupCollapsed[gkey] = !checklistGroupCollapsed[gkey]; renderChecklists(); });
        list.appendChild(lbl);
        if(collapsed) return; // skip rendering this subgroup's checklists while minimized
      }
      groupsMap[gkey].forEach(c=>{
      const card = document.createElement('div'); card.className='checklist-card';
      card.dataset.checklistId = c.id;

      const top = document.createElement('div'); top.className='checklist-top';
      const doneCt = c.items.filter(i=>i.done).length;
      const allItemsDone = c.items.length>0 && doneCt === c.items.length;
      if(allItemsDone) card.classList.add('done');
      top.innerHTML = '<span class="drag-handle" draggable="true" title="Drag to reorder">⠿</span>'
        + '<button class="habit-collapse-btn" data-act="collapse" title="'+(c.collapsed?'Expand':'Minimize')+'">'+(c.collapsed?'▶':'▼')+'</button>'
        + '<div class="checklist-name">'+escapeHtml(c.name)+'</div>'
        + '<button class="rename-btn" data-act="rename" title="Rename">✎</button>'
        + (allItemsDone ? '<span class="checklist-done-chip">✓ Checklist done</span>' : '')
        + '<span class="chip">'+doneCt+'/'+c.items.length+'</span>'
        + '<input type="text" class="mini-input checklist-group-input" placeholder="Subgroup…" maxlength="40" value="'+escapeHtml(c.group||'')+'" style="width:100px;flex:none;padding:5px 8px;font-size:11.5px;" title="Organize this checklist into a subgroup">'
        + '<select class="checklist-habit-link" title="Mark a habit done when this checklist is fully completed">'
          + '<option value="">🔗 Link a habit…</option>'
          + state.habits.map(h=>'<option value="'+h.id+'" '+(c.linkedHabitId===h.id?'selected':'')+'>🔗 '+escapeHtml(h.name)+'</option>').join('')
        + '</select>'
        + '<select class="checklist-freq">' + Object.keys(FREQ_LABELS).map(f=>'<option value="'+f+'" '+(c.resetFreq===f?'selected':'')+'>'+FREQ_LABELS[f]+'</option>').join('') + '</select>'
        + '<button class="del-goal">Delete</button>';
      top.querySelector('.checklist-group-input').addEventListener('change', e=>{
        c.group = e.target.value.trim(); save(); renderChecklists();
      });
      top.querySelector('[data-act="collapse"]').addEventListener('click', ()=>{ c.collapsed = !c.collapsed; save(); renderChecklists(); });
      top.querySelector('[data-act="rename"]').addEventListener('click', ()=>{
        const nameEl = top.querySelector('.checklist-name');
        const input = document.createElement('input');
        input.type = 'text'; input.className = 'rename-input'; input.maxLength = 80; input.value = c.name;
        input.style.flex = '1'; input.style.minWidth = '120px';
        nameEl.replaceWith(input);
        input.focus(); input.select();
        const commit = () => {
          const v = input.value.trim();
          if(v) c.name = v;
          save(); renderChecklists();
        };
        input.addEventListener('keydown', e=>{ if(e.key==='Enter') commit(); if(e.key==='Escape') renderChecklists(); });
        input.addEventListener('blur', commit);
      });
      top.querySelector('.checklist-habit-link').addEventListener('change', e=>{
        c.linkedHabitId = e.target.value || null;
        syncChecklistHabitLink(c);
        save(); renderChecklists(); renderHabits();
      });
      top.querySelector('.checklist-freq').addEventListener('change', e=>{
        c.resetFreq = e.target.value;
        c.lastResetKey = resetKeyFor(c.resetFreq);
        save(); renderChecklists();
      });
      top.querySelector('.del-goal').addEventListener('click', ()=>{ state.checklists = state.checklists.filter(x=>x.id!==c.id); save(); renderChecklists(); });
      card.appendChild(top);

      if(!c.collapsed){
        const itemsWrap = document.createElement('div');
        c.items.forEach(it=>{
          const row = document.createElement('div'); row.className='sub-row'; row.dataset.itemId = it.id;
          row.innerHTML = '<span class="drag-handle sub-drag-handle" draggable="true" title="Drag to reorder">⠿</span>'
            + '<div class="sub-check '+(it.done?'checked':'')+'">'+(it.done?'✓':'')+'</div><div class="sub-title '+(it.done?'done':'')+'">'+escapeHtml(it.text)+'</div><button class="sub-del">✕</button>';
          row.querySelector('.sub-check').addEventListener('click', ()=>{
            if(it.done){ it.done = false; state.checklistExp = Math.max(0, (state.checklistExp||0) - CHECKLIST_ITEM_EXP); }
            else { it.done = true; state.checklistExp = (state.checklistExp||0) + CHECKLIST_ITEM_EXP; }
            syncChecklistHabitLink(c);
            save(); renderChecklists(); renderHabits(); updateExpUI();
          });
          row.querySelector('.sub-del').addEventListener('click', ()=>{
            if(it.done) state.checklistExp = Math.max(0, (state.checklistExp||0) - CHECKLIST_ITEM_EXP);
            c.items=c.items.filter(x=>x.id!==it.id); save(); renderChecklists(); updateExpUI();
          });
          itemsWrap.appendChild(row);
        });
        // drag-to-reorder items within this checklist — delegated over this checklist's itemsWrap
        itemsWrap.addEventListener('dragstart', e=>{
          const handle = e.target.closest('.sub-drag-handle');
          if(!handle) return;
          const row = handle.closest('.sub-row');
          draggedChecklistItemId = row ? row.dataset.itemId : null;
          e.dataTransfer.effectAllowed = 'move';
        });
        itemsWrap.addEventListener('dragover', e=>{
          if(!draggedChecklistItemId) return;
          e.preventDefault();
          const overRow = e.target.closest('.sub-row');
          itemsWrap.querySelectorAll('.sub-row.drag-over').forEach(r=>r.classList.remove('drag-over'));
          if(overRow && overRow.dataset.itemId !== draggedChecklistItemId) overRow.classList.add('drag-over');
        });
        itemsWrap.addEventListener('drop', e=>{
          if(!draggedChecklistItemId) return;
          e.preventDefault();
          itemsWrap.querySelectorAll('.sub-row.drag-over').forEach(r=>r.classList.remove('drag-over'));
          const overRow = e.target.closest('.sub-row');
          const toId = overRow ? overRow.dataset.itemId : null;
          const fromId = draggedChecklistItemId; draggedChecklistItemId = null;
          if(!toId || toId === fromId) return;
          const fromIdx = c.items.findIndex(x=>x.id===fromId);
          const toIdx = c.items.findIndex(x=>x.id===toId);
          if(fromIdx<0 || toIdx<0) return;
          const [moved] = c.items.splice(fromIdx,1);
          c.items.splice(toIdx,0,moved);
          save(); renderChecklists();
        });
        itemsWrap.addEventListener('dragend', ()=>{
          draggedChecklistItemId = null;
          itemsWrap.querySelectorAll('.sub-row.drag-over').forEach(r=>r.classList.remove('drag-over'));
        });
        card.appendChild(itemsWrap);

        const addRow = document.createElement('div'); addRow.className='add-sub-row';
        addRow.innerHTML = '<input type="text" class="mini-input" placeholder="Add an item..." maxlength="100"><button>+</button>';
        const itemInput = addRow.querySelector('input');
        const doAddItem = () => {
          const v=itemInput.value.trim(); if(!v) return;
          c.items.push({id:uid(), text:v, done:false});
          save(); renderChecklists();
          // renderChecklists() rebuilds the DOM, so re-find and re-focus this checklist's input
          // to let the user keep adding items just by pressing Enter
          const freshInput = list.querySelector('.checklist-card[data-checklist-id="'+c.id+'"] .mini-input');
          if(freshInput) freshInput.focus();
        };
        addRow.querySelector('button').addEventListener('click', doAddItem);
        itemInput.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); doAddItem(); } });
        card.appendChild(addRow);
      }

      list.appendChild(card);
      }); // end groupsMap[gkey].forEach
    }); // end groupOrder.forEach
  }
  function addChecklist(){
    const input = el('newChecklistInput'); const v = input.value.trim();
    if(!v) return;
    state.checklists.push({ id:uid(), name:v, resetFreq:'none', lastResetKey:null, group:'', items:[] });
    input.value=''; save(); renderChecklists();
  }
  el('addChecklistBtn').addEventListener('click', addChecklist);
  el('newChecklistInput').addEventListener('keydown', e=>{ if(e.key==='Enter') addChecklist(); });

