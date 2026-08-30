  /* ================= INSIGHTS ================= */
  function computedVarHex(varName){
    const v = getComputedStyle(document.body).getPropertyValue(varName).trim();
    return v || '#000000';
  }
  // color inputs need a concrete hex to display even when uncustomized — shows the current
  // theme's actual color in that case, without writing anything to state.mosaicColors
  function renderMosaicColorInputs(){
    if(!state.mosaicColors) state.mosaicColors = { filled:'', today:'', empty:'', perfect:'', perfectGlow:true, perfectStyle:'color', perfectEmoji:'⭐' };
    const mc = state.mosaicColors;
    el('mcFilledInput').value = mc.filled || computedVarHex('--violet');
    el('mcTodayInput').value = mc.today || computedVarHex('--gold');
    el('mcEmptyInput').value = mc.empty || computedVarHex('--border');
    el('mcPerfectInput').value = mc.perfect || computedVarHex('--gold');
    document.querySelectorAll('#perfectGlowToggle [data-glow]').forEach(b=>{
      b.classList.toggle('active', (b.dataset.glow === 'on') === (mc.perfectGlow !== false));
    });
    const style = mc.perfectStyle || 'color';
    el('perfectStyleSelect').value = style;
    el('perfectColorField').style.display = (style === 'color' || style === 'outline') ? '' : 'none';
    el('perfectEmojiField').style.display = style === 'emoji' ? '' : 'none';
    el('perfectEmojiPresets').style.display = style === 'emoji' ? '' : 'none';
    el('perfectEmojiInput').value = mc.perfectEmoji || '⭐';
    document.querySelectorAll('#perfectEmojiPresets .emoji-swatch').forEach(b=>{
      b.classList.toggle('selected', b.dataset.emoji === (mc.perfectEmoji || '⭐'));
    });
  }

  // moves each .nav-item into state.tabOrder's order (tabs missing from a stale saved order —
  // e.g. added after the order was last saved — fall in at the end, keeping their relative order)
  function applyTabOrder(){
    const nav = el('navList'); if(!nav) return;
    const order = state.tabOrder;
    if(!order || !order.length) return;
    const items = Array.from(nav.querySelectorAll('.nav-item'));
    const byKey = {}; items.forEach(it=>{ byKey[it.dataset.tab] = it; });
    order.forEach(key=>{ if(byKey[key]) nav.appendChild(byKey[key]); });
    items.forEach(it=>{ if(!order.includes(it.dataset.tab)) nav.appendChild(it); });
  }

  // Settings > Tab Icons. Just a body class the nav CSS keys off (styles.css, .nav-item svg and its
  // mobile override), so flipping it never has to rebuild the nav or re-render a tab.
  function applyTabIcons(){
    document.body.classList.toggle('hide-tab-icons', !!state.hideTabIcons);
  }

  /* ---------------- Settings > Navigation > Navbar tabs > ✎ (rename / icon / colour) ----------------
     Three sparse maps on state (tabNames / tabIcons / tabIconColors, defaulted in core.js and
     hydrated in persistence.js) let any tab be renamed and re-iconed without touching index.html.
     The defaults they fall back to are snapshotted from the DOM RIGHT HERE, at load, before
     applyTabLooks() can ever run: the sidebar stops being the record of what a tab is called the
     moment it does, so "reset to default" would have nothing to restore from otherwise. That is
     also why the maps are sparse — resetting deletes a key rather than storing a copy of the
     default, so a later change to the markup or to a theme colour still reaches an untouched tab. */
  const NAV_TAB_DEFAULTS = (function(){
    const defs = {};
    document.querySelectorAll('#navList .nav-item').forEach(it=>{
      const svg = it.querySelector('svg'), lab = it.querySelector('.nav-label');
      defs[it.dataset.tab] = { label: lab ? lab.textContent : it.dataset.tab, icon: svg ? svg.innerHTML : '' };
    });
    return defs;
  })();

  /* Icon presets. Each value is the *inside* of a 24×24 <svg> — the wrapper (viewBox, fill:none,
     stroke:currentColor, stroke-width:2) is written by tabIconSvgFor() so every icon is stamped
     identically and `currentColor` keeps carrying the per-tab colour. Anything drawn with a solid
     fill has to say so itself (fill="currentColor" stroke="none"), same as the nav icons already
     sitting in index.html. */
  const TAB_ICON_PRESETS = {
    star:     { name:'Star',      svg:'<path d="M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.9-5.4 2.9 1-6L3.2 9.4l6.1-.9z"/>' },
    heart:    { name:'Heart',     svg:'<path d="M20.8 8.6c0 4.2-8.8 10.4-8.8 10.4S3.2 12.8 3.2 8.6a4.6 4.6 0 018.8-1.8 4.6 4.6 0 018.8 1.8z"/>' },
    home:     { name:'Home',      svg:'<path d="M3 10.5L12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>' },
    book:     { name:'Book',      svg:'<path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>' },
    music:    { name:'Music',     svg:'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>' },
    camera:   { name:'Camera',    svg:'<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2h3l2-3h6l2 3h3a2 2 0 012 2z"/><circle cx="12" cy="13" r="3.6"/>' },
    flag:     { name:'Flag',      svg:'<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>' },
    rocket:   { name:'Rocket',    svg:'<path d="M5 16c-1.5 1.5-2 5-2 5s3.5-.5 5-2a2.2 2.2 0 00-3-3z"/><path d="M18.5 3.5C15 3 11 5 8.5 9.5l6 6C19 13 21 9 20.5 5.5z"/><circle cx="15" cy="9" r="1.5"/>' },
    bell:     { name:'Bell',      svg:'<path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/>' },
    bars:     { name:'Bar chart', svg:'<line x1="6" y1="20" x2="6" y2="12"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="18" y1="20" x2="18" y2="15"/>' },
    pie:      { name:'Pie chart', svg:'<path d="M12 3a9 9 0 109 9h-9z"/><path d="M15 3.5A9 9 0 0120.5 9H15z"/>' },
    folder:   { name:'Folder',    svg:'<path d="M3 7a2 2 0 012-2h4l2 2.5h8a2 2 0 012 2V18a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>' },
    tag:      { name:'Tag',       svg:'<path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0l-7-7A2 2 0 013 12.2V5a2 2 0 012-2h7.2a2 2 0 011.4.6l7 7a2 2 0 010 2.8z"/><circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none"/>' },
    lock:     { name:'Lock',      svg:'<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 118 0v3"/>' },
    globe:    { name:'Globe',     svg:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 010 18 14 14 0 010-18z"/>' },
    cloud:    { name:'Cloud',     svg:'<path d="M17.5 19H7a4.5 4.5 0 01-.6-8.96A6 6 0 0118 9.5a4.75 4.75 0 01-.5 9.5z"/>' },
    sun:      { name:'Sun',       svg:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>' },
    moon:     { name:'Moon',      svg:'<path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/>' },
    trophy:   { name:'Trophy',    svg:'<path d="M7 4h10v5a5 5 0 01-10 0z"/><path d="M7 5H4v1a4 4 0 004 4M17 5h3v1a4 4 0 01-4 4"/><path d="M12 14v3"/><path d="M8.5 20h7l-.8-3h-5.4z"/>' },
    brain:    { name:'Brain',     svg:'<path d="M9.5 3.6A2.5 2.5 0 007 6a2.5 2.5 0 00-1.5 4.5A2.5 2.5 0 006 15a2.5 2.5 0 003.5 2.3V21"/><path d="M14.5 3.6A2.5 2.5 0 0117 6a2.5 2.5 0 011.5 4.5A2.5 2.5 0 0118 15a2.5 2.5 0 01-3.5 2.3V21"/><path d="M9.5 3.6A2.6 2.6 0 0112 2a2.6 2.6 0 012.5 1.6"/>' },
    coffee:   { name:'Coffee',    svg:'<path d="M4 8h13v5a5 5 0 01-5 5H9a5 5 0 01-5-5z"/><path d="M17 9h1.5a2.5 2.5 0 010 5H17"/><path d="M4 21h13"/>' },
    pin:      { name:'Map pin',   svg:'<path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>' },
    shield:   { name:'Shield',    svg:'<path d="M12 3l8 3v5.5c0 5-3.4 8.6-8 10.5-4.6-1.9-8-5.5-8-10.5V6z"/>' },
    pencil:   { name:'Pencil',    svg:'<path d="M4 20h4l10-10a2.8 2.8 0 10-4-4L4 16z"/><path d="M14 6l4 4"/>' },
    search:   { name:'Search',    svg:'<circle cx="11" cy="11" r="7"/><line x1="16" y1="16" x2="21" y2="21"/>' },
    palette:  { name:'Palette',   svg:'<path d="M12 3a9 9 0 000 18c1.4 0 2-1 2-2 0-1.5-1.5-1.5-1.5-3 0-1 .8-1.5 2-1.5H17a4 4 0 004-4c0-4.1-4-7.5-9-7.5z"/><circle cx="7.5" cy="11" r="1.1" fill="currentColor" stroke="none"/><circle cx="10" cy="7.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="7.5" r="1.1" fill="currentColor" stroke="none"/>' },
    plane:    { name:'Plane',     svg:'<path d="M10.2 2.6a1.8 1.8 0 013.6 0V9l7.2 4.2v2.4L13.8 13v4.6l2.4 1.8v1.8L12 20l-4.2 1.2v-1.8l2.4-1.8V13L3 15.6v-2.4L10.2 9z"/>' },
    car:      { name:'Car',       svg:'<path d="M5 17H3v-4l2-5h14l2 5v4h-2"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/><path d="M9.5 17h5"/>' },
    gift:     { name:'Gift',      svg:'<rect x="3" y="9" width="18" height="12" rx="2"/><path d="M3 13.5h18M12 9v12"/><path d="M12 9S10.5 3 8 3a2.5 2.5 0 000 5M12 9s1.5-6 4-6a2.5 2.5 0 010 5"/>' },
    key:      { name:'Key',       svg:'<circle cx="7.5" cy="15.5" r="4"/><path d="M10.5 12.5L20 3M17 6l2.5 2.5M14.5 9l2 2"/>' },
    link:     { name:'Link',      svg:'<path d="M10 13a5 5 0 007.5.5l2-2A5 5 0 1012.5 4.5l-1 1"/><path d="M14 11a5 5 0 00-7.5-.5l-2 2A5 5 0 1011.5 19.5l1-1"/>' },
    mail:     { name:'Mail',      svg:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5L12 13l8.5-6.5"/>' },
    phone:    { name:'Phone',     svg:'<path d="M21 16.9v2.5a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 011.1 3.6 2 2 0 013.1 1.4h2.5a2 2 0 012 1.7c.1 1 .4 1.9.7 2.8a2 2 0 01-.5 2.1L6.7 9.3a16 16 0 006 6l1.3-1.1a2 2 0 012.1-.5c.9.3 1.8.6 2.8.7a2 2 0 011.7 2z"/>' },
    target:   { name:'Target',    svg:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>' },
    wallet:   { name:'Wallet',    svg:'<rect x="3" y="6" width="18" height="14" rx="2.5"/><path d="M3 10h18"/><circle cx="17" cy="15" r="1.3" fill="currentColor" stroke="none"/>' },
    droplet:  { name:'Droplet',   svg:'<path d="M12 3s6 6.3 6 10.2A6 6 0 016 13.2C6 9.3 12 3 12 3z"/>' },
    leaf:     { name:'Leaf',      svg:'<path d="M4 20c0-8 5-14 16-15 1 10-4 15-11 15a5 5 0 01-5-5z"/><path d="M9 15c2-3 5-5 8-6"/>' },
    film:     { name:'Film',      svg:'<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M7 5v14M17 5v14M2.5 9.5h4.5M2.5 14.5h4.5M17 9.5h4.5M17 14.5h4.5"/>' },
    cart:     { name:'Cart',      svg:'<circle cx="9.5" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2.5 3h2.6l2.4 12h11l2-8H6"/>' },
    bookmark: { name:'Bookmark',  svg:'<path d="M6 3h12v18l-6-4.5L6 21z"/>' },
    crown:    { name:'Crown',     svg:'<path d="M3 7l4 4 5-7 5 7 4-4-1.6 11H4.6z"/><path d="M4.6 18h14.8"/>' },
    eye:      { name:'Eye',       svg:'<path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>' },
    compass:  { name:'Compass',   svg:'<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>' },
    list:     { name:'List',      svg:'<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.3" fill="currentColor" stroke="none"/>' },
    grid:     { name:'Grid',      svg:'<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>' }
  };

  const TAB_EMOJI_PRESETS = ['⭐','🔥','💪','💰','🎯','📚','🎮','🎵','🧠','☀️','🌙','🌱','❤️','⏰','📝','🏆','🚀','🌈'];
  // '' is "whatever colour the theme already gives this tab" and is offered as its own swatch
  const TAB_COLOR_SWATCHES = ['#8b5cf6','#3b82f6','#06b6d4','#10b981','#84cc16','#eab308','#f97316','#ef4444','#ec4899','#64748b'];

  function tabLabelFor(key){
    const custom = (state.tabNames || {})[key];
    if(typeof custom === 'string' && custom.trim()) return custom.trim();
    return (NAV_TAB_DEFAULTS[key] || {}).label || key;
  }

  /* Every tab icon is the same shape — a 24×24 <svg> — whatever it was drawn from, INCLUDING an
     emoji, which goes in as <text> rather than as a <span>. That's what keeps `.nav-item svg`
     addressing the icon everywhere it already does, with no second selector to add anywhere: the
     hide-icons body class, the 16px sizing rule, the wish-glow filter, the mobile switcher's
     icon.outerHTML clone and the Settings list's own copy all keep working untouched.
     stroke="none" on the <text> is required — the wrapper's stroke-width:2 would outline the glyph. */
  function tabIconInnerFor(key){
    const ic = (state.tabIcons || {})[key];
    if(ic && ic.type === 'emoji' && ic.value){
      return '<text x="12" y="12" text-anchor="middle" dominant-baseline="central" font-size="19"'
        + ' stroke="none" fill="currentColor">' + escapeHtml(String(ic.value).slice(0,4)) + '</text>';
    }
    if(ic && ic.type === 'preset' && TAB_ICON_PRESETS[ic.value]) return TAB_ICON_PRESETS[ic.value].svg;
    return (NAV_TAB_DEFAULTS[key] || {}).icon || '';
  }
  // '' means "the icon baked into index.html"; see applyTabLooks() for what this is compared against
  function tabIconSigFor(key){
    const ic = (state.tabIcons || {})[key];
    if(ic && ic.type === 'emoji' && ic.value) return 'e:' + ic.value;
    if(ic && ic.type === 'preset' && TAB_ICON_PRESETS[ic.value]) return 'p:' + ic.value;
    return '';
  }
  // standalone copy of a tab's icon for anywhere outside the sidebar (the customise sheet's preview)
  function tabIconSvgFor(key, colorOverride){
    const col = colorOverride !== undefined ? colorOverride : ((state.tabIconColors || {})[key] || '');
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
      + (col ? ' style="color:' + escapeHtml(col) + '"' : '') + '>' + tabIconInnerFor(key) + '</svg>';
  }

  /* Pushes all three overrides onto the live sidebar. Called from renderAll() beside the other
     three apply*() functions, and again after every edit. It rewrites the existing <svg>'s
     innerHTML and inline colour rather than replacing the element, so nothing holding a reference
     to it is disturbed (the wish-glow animation on the Games icon, most of all). The inline colour
     is what beats the per-tab rules in styles.css; clearing it hands the tab back to the theme,
     which is why an uncustomised tab must store nothing rather than store its own default. */
  function applyTabLooks(){
    const nav = el('navList'); if(!nav) return;
    nav.querySelectorAll('.nav-item').forEach(it=>{
      const key = it.dataset.tab;
      const lab = it.querySelector('.nav-label');
      if(lab){ const t = tabLabelFor(key); if(lab.textContent !== t) lab.textContent = t; }
      const svg = it.querySelector('svg');
      if(svg){
        /* Compared by signature, not by markup: reading innerHTML back off an SVG re-serialises it
           (<path/> comes back as <path></path>), so a string compare never matches and would
           rewrite every custom icon on every render. */
        const sig = tabIconSigFor(key);
        if(svg.dataset.iconSig !== sig){ svg.innerHTML = tabIconInnerFor(key); svg.dataset.iconSig = sig; }
        svg.style.color = (state.tabIconColors || {})[key] || '';
      }
    });
  }

  /* Settings > Show Tabs. Hiding is presentation only — the view and its data stay put, the tab is
     just marked .nav-hidden so it drops out of the sidebar and the mobile switcher sheet (which
     reads visibleNavItems()). Settings can never be hidden; it's the only way back to this
     control. */
  function applyTabVisibility(){
    const nav = el('navList'); if(!nav) return;
    const hidden = Array.isArray(state.hiddenTabs) ? state.hiddenTabs : [];
    const items = Array.from(nav.querySelectorAll('.nav-item'));
    items.forEach(it=>{
      it.classList.toggle('nav-hidden', it.dataset.tab !== 'settings' && hidden.includes(it.dataset.tab));
    });
    // hiding the tab you're standing on would leave the main pane blank — move to the first
    // surviving tab instead (its own nav click handler does the rendering)
    const active = items.find(it=>it.classList.contains('active'));
    if(active && active.classList.contains('nav-hidden')){
      const first = items.find(it=>!it.classList.contains('nav-hidden'));
      if(first) first.click();
    }
  }

  // the nav as the user actually sees it — hidden tabs are skipped by everything that walks it
  function visibleNavItems(){
    return Array.from(document.querySelectorAll('#navList .nav-item:not(.nav-hidden)'));
  }

  function setTabHidden(key, hide){
    if(key === 'settings') return;
    const hidden = (Array.isArray(state.hiddenTabs) ? state.hiddenTabs : []).filter(k=>k!==key);
    if(hide) hidden.push(key);
    state.hiddenTabs = hidden;
    save();
    applyTabVisibility();
    renderTabOrderSettings();
  }

  // commits a new tab key order — used by both the drag-drop handler (desktop) and the up/down
  // move buttons (mobile, where .drag-handle is hidden since HTML5 drag events don't fire on touch)
  function commitTabOrder(order){
    state.tabOrder = order;
    save();
    applyTabOrder();
    renderTabOrderSettings();
  }

  /* drag-to-reorder navbar tabs (Settings page) — same delegated dragstart/dragover/drop/dragend
     pattern as finance accounts / checklists, but reorders the live sidebar nav too, not just a
     data array, since the sidebar's DOM order *is* the source of truth for tab order. Also offers
     ▲▼ move buttons alongside the handle, since drag-and-drop doesn't work on touch (see the
     .drag-handle{display:none} mobile override) and this is the one reorder list in the app that
     needs a touch-friendly fallback. */
  let draggedTabKey = null;
  function renderTabOrderSettings(){
    const list = el('tabOrderList'); if(!list) return;
    const navItems = Array.from(document.querySelectorAll('#navList .nav-item'));
    list.innerHTML = navItems.map((item, idx)=>{
      const key = item.dataset.tab;
      const label = item.querySelector('.nav-label').textContent;
      const iconHtml = item.querySelector('svg').outerHTML;
      const isHidden = item.classList.contains('nav-hidden');
      const locked = key === 'settings'; // can't hide the way back to this screen
      return '<div class="tab-order-row'+(isHidden?' is-hidden':'')+'" data-tab-key="'+key+'">'
        + '<span class="drag-handle" draggable="true" title="Drag to reorder">⠿</span>'
        + '<span class="tab-order-icon">'+iconHtml+'</span>'
        + '<span class="tab-order-label">'+escapeHtml(label)+'</span>'
        + '<button class="tab-order-edit-btn" type="button" data-edit-tab="'+key+'" title="Rename, change the icon or its colour">✎</button>'
        + '<button class="tab-vis-btn'+(isHidden?' off':'')+'" type="button" data-vis-tab="'+key+'"'
        +   (locked?' disabled title="Settings always stays in the navbar"':' title="'+(isHidden?'Show in navbar':'Hide from navbar')+'"')+'>'
        +   (isHidden?'Hidden':'Shown')
        + '</button>'
        + '<div class="tab-order-move-btns">'
        +   '<button class="tab-order-move-btn" type="button" data-dir="up" title="Move up"'+(idx===0?' disabled':'')+'>▲</button>'
        +   '<button class="tab-order-move-btn" type="button" data-dir="down" title="Move down"'+(idx===navItems.length-1?' disabled':'')+'>▼</button>'
        + '</div>'
        + '</div>';
    }).join('');
    if(!list.dataset.wired){
      list.dataset.wired = '1';
      list.addEventListener('click', e=>{
        const editBtn = e.target.closest('.tab-order-edit-btn');
        if(editBtn){ openTabCustomize(editBtn.dataset.editTab); return; }
        const visBtn = e.target.closest('.tab-vis-btn');
        if(visBtn){
          if(!visBtn.disabled) setTabHidden(visBtn.dataset.visTab, !visBtn.classList.contains('off'));
          return;
        }
        const btn = e.target.closest('.tab-order-move-btn');
        if(!btn || btn.disabled) return;
        const row = btn.closest('.tab-order-row');
        const order = Array.from(list.querySelectorAll('.tab-order-row')).map(r=>r.dataset.tabKey);
        const idx = order.indexOf(row.dataset.tabKey);
        const swapIdx = btn.dataset.dir === 'up' ? idx-1 : idx+1;
        if(swapIdx<0 || swapIdx>=order.length) return;
        [order[idx], order[swapIdx]] = [order[swapIdx], order[idx]];
        commitTabOrder(order);
      });
      list.addEventListener('dragstart', e=>{
        const handle = e.target.closest('.drag-handle');
        if(!handle) return;
        const row = handle.closest('.tab-order-row');
        draggedTabKey = row ? row.dataset.tabKey : null;
        e.dataTransfer.effectAllowed = 'move';
      });
      list.addEventListener('dragover', e=>{
        if(!draggedTabKey) return;
        e.preventDefault();
        const overRow = e.target.closest('.tab-order-row');
        list.querySelectorAll('.tab-order-row.drag-over').forEach(r=>r.classList.remove('drag-over'));
        if(overRow && overRow.dataset.tabKey !== draggedTabKey) overRow.classList.add('drag-over');
      });
      list.addEventListener('drop', e=>{
        if(!draggedTabKey) return;
        e.preventDefault();
        list.querySelectorAll('.tab-order-row.drag-over').forEach(r=>r.classList.remove('drag-over'));
        const overRow = e.target.closest('.tab-order-row');
        const toKey = overRow ? overRow.dataset.tabKey : null;
        const fromKey = draggedTabKey; draggedTabKey = null;
        if(!toKey || toKey === fromKey) return;
        const order = Array.from(list.querySelectorAll('.tab-order-row')).map(r=>r.dataset.tabKey);
        const fromIdx = order.indexOf(fromKey), toIdx = order.indexOf(toKey);
        if(fromIdx<0 || toIdx<0) return;
        order.splice(toIdx, 0, order.splice(fromIdx,1)[0]);
        commitTabOrder(order);
      });
      list.addEventListener('dragend', ()=>{ draggedTabKey = null; list.querySelectorAll('.tab-order-row.drag-over').forEach(r=>r.classList.remove('drag-over')); });
    }
  }

  /* ---- the customise sheet itself (#tabCustomizeOverlay) ----
     Rides the app's shared .struggle-overlay modal shell. Everything in it applies LIVE — there is
     no OK/Cancel pair, matching the rest of Settings, and the sidebar behind the sheet is the
     preview that matters. Two things it is careful about:
       · the name and emoji fields are live inputs, so their handlers must never re-render the
         sheet body — that would rebuild the field mid-keystroke and drop the caret, the same rule
         the Notes title input has. refreshTabCustomize() therefore repaints only the preview and
         the selected-state rings, never the inputs.
       · typing debounces the write. save() re-serialises and re-uploads the whole shared blob, so
         a rename types straight into state and lets a timer do the upload; every other control
         here is a single click and saves immediately. */
  let tabCustomizeKey = null, tabCustomizeSaveTimer = null;

  function queueTabCustomizeSave(){
    clearTimeout(tabCustomizeSaveTimer);
    tabCustomizeSaveTimer = setTimeout(()=>{ tabCustomizeSaveTimer = null; save(); }, 600);
  }
  function flushTabCustomizeSave(){
    if(!tabCustomizeSaveTimer) return;
    clearTimeout(tabCustomizeSaveTimer); tabCustomizeSaveTimer = null;
    save();
  }

  /* Applies one or more of {name, icon, color} to a tab. A falsy value DELETES the key rather than
     storing a default — see NAV_TAB_DEFAULTS above for why that matters. `defer` is passed by the
     two typing paths so the write is debounced instead of firing per keystroke. */
  function setTabLook(key, patch, defer){
    if(!NAV_TAB_DEFAULTS[key]) return;
    if(!state.tabNames) state.tabNames = {};
    if(!state.tabIcons) state.tabIcons = {};
    if(!state.tabIconColors) state.tabIconColors = {};
    if('name' in patch){
      const v = (patch.name || '').trim();
      // typing the default name back in is a reset, not a customisation worth storing
      if(v && v !== NAV_TAB_DEFAULTS[key].label) state.tabNames[key] = v; else delete state.tabNames[key];
    }
    if('icon' in patch){
      if(patch.icon) state.tabIcons[key] = patch.icon; else delete state.tabIcons[key];
    }
    if('color' in patch){
      if(patch.color) state.tabIconColors[key] = patch.color; else delete state.tabIconColors[key];
    }
    // an immediate write also cancels any pending debounced one rather than flushing it — the
    // typed value is already in state, so the save about to run carries it
    if(defer) queueTabCustomizeSave();
    else { clearTimeout(tabCustomizeSaveTimer); tabCustomizeSaveTimer = null; save(); }
    applyTabLooks();
    renderTabOrderSettings();
    refreshTabCustomize();
  }

  function openTabCustomize(key){
    if(!NAV_TAB_DEFAULTS[key]) return;
    tabCustomizeKey = key;
    const ov = el('tabCustomizeOverlay'); if(!ov) return;
    ov.style.display = 'flex';
    renderTabCustomize();
  }
  function closeTabCustomize(){
    flushTabCustomizeSave(); // a rename typed and then closed within the debounce window must not be lost
    tabCustomizeKey = null;
    const ov = el('tabCustomizeOverlay'); if(ov) ov.style.display = 'none';
  }

  function renderTabCustomize(){
    const key = tabCustomizeKey, body = el('tabCustomizeBody');
    if(!key || !body) return;
    const def = NAV_TAB_DEFAULTS[key];
    el('tabCustomizeTitle').textContent = 'Customise \u201c' + def.label + '\u201d';
    body.innerHTML =
        '<div class="tabcust-preview" id="tabCustPreview"></div>'
      + '<div class="tabcust-field">'
      +   '<label for="tabCustName">Name</label>'
      +   '<input type="text" id="tabCustName" class="tabcust-name" maxlength="24" placeholder="' + escapeHtml(def.label) + '">'
      +   '<div class="tabcust-hint">Leave it empty to keep the original name.</div>'
      + '</div>'
      + '<div class="tabcust-field">'
      +   '<label>Icon</label>'
      +   '<div class="tabcust-icons" id="tabCustIcons">'
      +     '<button class="tabcust-ico" type="button" data-preset="" title="Original icon">'
      +       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + def.icon + '</svg>'
      +     '</button>'
      +     Object.keys(TAB_ICON_PRESETS).map(id =>
              '<button class="tabcust-ico" type="button" data-preset="' + id + '" title="' + escapeHtml(TAB_ICON_PRESETS[id].name) + '">'
              + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + TAB_ICON_PRESETS[id].svg + '</svg>'
              + '</button>').join('')
      +   '</div>'
      +   '<div class="tabcust-emoji-row">'
      +     '<span class="tabcust-sub">\u2026 or an emoji</span>'
      +     '<input type="text" id="tabCustEmoji" class="tabcust-emoji-input" maxlength="4" placeholder="\ud83d\udd25">'
      +     '<div class="tabcust-emoji-presets" id="tabCustEmojiPresets">'
      +       TAB_EMOJI_PRESETS.map(e => '<button class="emoji-swatch" type="button" data-emoji="' + e + '">' + e + '</button>').join('')
      +     '</div>'
      +   '</div>'
      + '</div>'
      + '<div class="tabcust-field">'
      +   '<label>Icon colour</label>'
      +   '<div class="tabcust-colors" id="tabCustColors">'
      +     '<button class="tabcust-swatch is-default" type="button" data-color="" title="Theme default"></button>'
      +     TAB_COLOR_SWATCHES.map(c => '<button class="tabcust-swatch" type="button" data-color="' + c + '" style="background:' + c + '" title="' + c + '"></button>').join('')
      +     '<label class="tabcust-swatch tabcust-swatch-any" title="Pick any colour">\u2026<input type="color" id="tabCustColor"></label>'
      +   '</div>'
      +   '<div class="tabcust-hint">Emoji icons keep their own colours \u2014 this tints the drawn ones.</div>'
      + '</div>'
      + '<div class="tabcust-actions">'
      +   '<button class="btn btn-ghost btn-sm" type="button" id="tabCustResetBtn">Reset this tab</button>'
      +   '<button class="btn btn-primary btn-sm" type="button" id="tabCustDoneBtn">Done</button>'
      + '</div>';

    // user text goes in by .value, never interpolated into a value="" attribute — escapeHtml()
    // doesn't escape double quotes (the notes.js rule)
    const ic = (state.tabIcons || {})[key] || {};
    el('tabCustName').value = (state.tabNames || {})[key] || '';
    el('tabCustEmoji').value = ic.type === 'emoji' ? (ic.value || '') : '';
    el('tabCustColor').value = (state.tabIconColors || {})[key] || '#8b5cf6';

    if(!body.dataset.wired){
      body.dataset.wired = '1';
      body.addEventListener('click', e=>{
        const key = tabCustomizeKey; if(!key) return;
        const preset = e.target.closest('[data-preset]');
        if(preset){ setTabLook(key, { icon: preset.dataset.preset ? { type:'preset', value:preset.dataset.preset } : null }); return; }
        const emoji = e.target.closest('[data-emoji]');
        if(emoji){
          setTabLook(key, { icon:{ type:'emoji', value:emoji.dataset.emoji } });
          const field = el('tabCustEmoji'); if(field) field.value = emoji.dataset.emoji;
          return;
        }
        const sw = e.target.closest('.tabcust-swatch[data-color]');
        if(sw){ setTabLook(key, { color: sw.dataset.color }); return; }
        if(e.target.closest('#tabCustResetBtn')){
          setTabLook(key, { name:'', icon:null, color:'' });
          renderTabCustomize(); // the only full rebuild: it has to clear the two live fields too
          return;
        }
        if(e.target.closest('#tabCustDoneBtn')) closeTabCustomize();
      });
      // one 'input' listener for all three fields — none of these branches may re-render the body
      body.addEventListener('input', e=>{
        const key = tabCustomizeKey; if(!key) return;
        if(e.target.id === 'tabCustName'){ setTabLook(key, { name: e.target.value }, true); return; }
        if(e.target.id === 'tabCustEmoji'){
          const v = e.target.value.trim();
          setTabLook(key, { icon: v ? { type:'emoji', value:v } : null }, true);
          return;
        }
        if(e.target.id === 'tabCustColor'){ setTabLook(key, { color: e.target.value }, true); return; }
      });
    }
    refreshTabCustomize();
  }

  // preview + selected rings only. Deliberately touches no <input>: two of them are live fields
  // and this runs on every keystroke.
  function refreshTabCustomize(){
    const key = tabCustomizeKey; if(!key) return;
    const prev = el('tabCustPreview');
    if(prev){
      prev.innerHTML = '<span class="tabcust-preview-chip">' + tabIconSvgFor(key)
        + '<span>' + escapeHtml(tabLabelFor(key)) + '</span></span>';
    }
    const ic = (state.tabIcons || {})[key] || {};
    const presetId = ic.type === 'preset' ? ic.value : '';
    document.querySelectorAll('#tabCustIcons .tabcust-ico').forEach(b=>{
      b.classList.toggle('selected', ic.type !== 'emoji' && b.dataset.preset === presetId);
    });
    document.querySelectorAll('#tabCustEmojiPresets .emoji-swatch').forEach(b=>{
      b.classList.toggle('selected', ic.type === 'emoji' && b.dataset.emoji === ic.value);
    });
    const col = (state.tabIconColors || {})[key] || '';
    document.querySelectorAll('#tabCustColors .tabcust-swatch[data-color]').forEach(b=>{
      b.classList.toggle('selected', b.dataset.color === col);
    });
  }

  (function(){
    const ov = el('tabCustomizeOverlay'); if(!ov) return;
    const closeBtn = el('tabCustomizeCloseBtn');
    if(closeBtn) closeBtn.addEventListener('click', ()=>closeTabCustomize());
    ov.addEventListener('click', e=>{ if(e.target === ov) closeTabCustomize(); });
    document.addEventListener('keydown', e=>{ if(e.key === 'Escape' && tabCustomizeKey) closeTabCustomize(); });
  })();

  /* ---- settings sub-nav (Appearance / Navigation / Tracking / Valorant / Data) ----
     The reset to Appearance lives in nav.js on tab entry, NOT in renderSettings() — two of the
     toggles below re-render the whole tab as their save step, and resetting here would throw you
     back to the first category every time you flipped one. Nothing here needs a render call the
     way showFinanceSubTab() does: renderSettings(), renderValLocalPanel() and renderProtectedDays()
     already fill all five panes on entry, and a hidden pane holds its values fine. */
  function showSettingsSubTab(key){
    document.querySelectorAll('#view-settings .finance-subnav-btn').forEach(b=>b.classList.toggle('active', b.dataset.settab===key));
    document.querySelectorAll('.settab').forEach(t=>t.style.display = (t.id==='settab-'+key) ? '' : 'none');
    // the Valorant category is several screens tall, so switching out of it from the bottom would
    // otherwise leave a short category scrolled past its own content
    if(window.scrollY > 0) window.scrollTo({top:0, behavior:'auto'});
  }
  document.querySelectorAll('#view-settings .finance-subnav-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> showSettingsSubTab(btn.dataset.settab));
  });

  function renderSettings(){
    applyTheme();
    renderTabOrderSettings();
    // Settings → Data → Access log (js/access.js). It owns its own wiring and rendering, the way
    // renderValLocalPanel() and renderProtectedDays() do — this is just the entry hook.
    initAccessSettings();
    renderAccessLog();

    const tabIconVisToggle = el('tabIconVisToggle');
    if(tabIconVisToggle && !tabIconVisToggle.dataset.wired){
      tabIconVisToggle.dataset.wired = '1';
      tabIconVisToggle.addEventListener('click', e=>{
        const btn = e.target.closest('[data-vis]');
        if(!btn) return;
        state.hideTabIcons = btn.dataset.vis === 'hide';
        save(); applyTabIcons(); renderSettings();
      });
    }
    document.querySelectorAll('#tabIconVisToggle [data-vis]').forEach(b=>{
      b.classList.toggle('active', (b.dataset.vis === 'hide') === !!state.hideTabIcons);
    });

    const sel = el('settingsNetWorthCurrency');
    if(!sel.options.length){
      sel.innerHTML = CURRENCIES.map(c=>'<option value="'+c+'">'+c+' ('+ccySymbol(c)+')</option>').join('');
      sel.addEventListener('change', ()=>{
        state.profile.netWorthCurrency = sel.value;
        save(); renderGoals();
      });
    }
    sel.value = state.profile.netWorthCurrency || 'USD';

    const avatarVisToggle = el('avatarVisToggle');
    if(avatarVisToggle && !avatarVisToggle.dataset.wired){
      avatarVisToggle.dataset.wired = '1';
      avatarVisToggle.addEventListener('click', e=>{
        const btn = e.target.closest('[data-vis]');
        if(!btn) return;
        state.profile.hideAvatar = btn.dataset.vis === 'hide';
        save(); renderSettings(); updateAvatar();
      });
    }
    document.querySelectorAll('#avatarVisToggle [data-vis]').forEach(b=>{
      b.classList.toggle('active', (b.dataset.vis === 'hide') === !!state.profile.hideAvatar);
    });

    // Trend Comparison — how far back the Net Worth / Fitness ▲▼ arrows measure (trendCutoffKey()
    // in core.js). Both trends redraw through the renders below.
    const trendWindowSelect = el('trendWindowSelect');
    if(trendWindowSelect){
      trendWindowSelect.value = state.trendWindow == null ? '0' : String(state.trendWindow);
      if(!trendWindowSelect.dataset.wired){
        trendWindowSelect.dataset.wired = '1';
        trendWindowSelect.addEventListener('change', ()=>{
          state.trendWindow = trendWindowSelect.value;
          save();
          renderGoals();                                                   // net worth arrow
          if(typeof updateFitnessLevelUI === 'function') updateFitnessLevelUI(); // fitness arrow
        });
      }
    }

    renderMosaicColorInputs();
    const mcFields = el('mosaicColorFields');
    if(mcFields && !mcFields.dataset.wired){
      mcFields.dataset.wired = '1';
      el('mcFilledInput').addEventListener('input', ()=>{ state.mosaicColors.filled = el('mcFilledInput').value; applyMosaicColors(); debouncedSave(); });
      el('mcTodayInput').addEventListener('input', ()=>{ state.mosaicColors.today = el('mcTodayInput').value; applyMosaicColors(); debouncedSave(); });
      el('mcEmptyInput').addEventListener('input', ()=>{ state.mosaicColors.empty = el('mcEmptyInput').value; applyMosaicColors(); debouncedSave(); });
      el('mcPerfectInput').addEventListener('input', ()=>{ state.mosaicColors.perfect = el('mcPerfectInput').value; applyMosaicColors(); debouncedSave(); });
      el('mosaicColorResetBtn').addEventListener('click', ()=>{
        // reset colors only — leaves the perfectGlow on/off toggle alone, that's a separate control
        state.mosaicColors.filled = ''; state.mosaicColors.today = ''; state.mosaicColors.empty = ''; state.mosaicColors.perfect = '';
        applyMosaicColors(); save(); renderMosaicColorInputs();
      });
    }

    // protected-day marker color (Settings → Protected Days). Only a CSS custom property changes,
    // so no re-render is needed — the habit cells and heat-map dots recolor in place.
    const pdColorInput = el('pdColorInput');
    if(pdColorInput){
      pdColorInput.value = state.protectedDayColor || computedVarHex('--violet');
      if(!pdColorInput.dataset.wired){
        pdColorInput.dataset.wired = '1';
        pdColorInput.addEventListener('input', ()=>{
          state.protectedDayColor = pdColorInput.value; applyProtectedDayColor(); debouncedSave();
        });
        el('pdColorResetBtn').addEventListener('click', ()=>{
          state.protectedDayColor = ''; applyProtectedDayColor(); save();
          pdColorInput.value = computedVarHex('--violet');
        });
      }
    }

    /* Settings > Tracking > Calendar reminder. Same wire-once/re-sync shape as the toggles above.
       Switching it off also hides a bubble that happens to be on screen right now — leaving one up
       after you just turned the feature off would read as the switch not having worked. */
    const calBubbleToggle = el('calBubbleToggle');
    if(calBubbleToggle && !calBubbleToggle.dataset.wired){
      calBubbleToggle.dataset.wired = '1';
      calBubbleToggle.addEventListener('click', e=>{
        const btn = e.target.closest('[data-calbubble]');
        if(!btn) return;
        state.calendar.bubbleEnabled = btn.dataset.calbubble === 'on';
        if(!state.calendar.bubbleEnabled && typeof hideCalBubbles === 'function') hideCalBubbles();
        save(); renderSettings();
      });
    }
    document.querySelectorAll('#calBubbleToggle [data-calbubble]').forEach(b=>{
      b.classList.toggle('active', (b.dataset.calbubble === 'on') === (state.calendar.bubbleEnabled !== false));
    });

    /* The three reminder options. All wired the same way — wire once, then re-sync the value on
       every render — and all hidden together while the reminder is off, the same
       show/hide-a-dependent-field pattern renderMosaicColorInputs() uses for the perfect-day
       options. Each writes state and saves; none needs a re-render, since the stack is only built
       at app open and will read the new value then. */
    [
      ['calBubbleCountSelect', v => { state.calendar.bubbleCount = parseInt(v,10) || 1; },
        () => String(state.calendar.bubbleCount || 1)],
      ['calBubbleDaysSelect', v => { state.calendar.bubbleDays = parseInt(v,10) || 7; },
        () => String(state.calendar.bubbleDays || 7)],
      ['calBubbleCountdownsSelect', v => { state.calendar.bubbleCountdowns = v === 'yes'; },
        () => state.calendar.bubbleCountdowns === false ? 'no' : 'yes']
    ].forEach(([id, write, read])=>{
      const sel = el(id); if(!sel) return;
      if(!sel.dataset.wired){
        sel.dataset.wired = '1';
        sel.addEventListener('change', ()=>{ write(sel.value); save(); });
      }
      sel.value = read();
    });
    const calBubbleOptions = el('calBubbleOptions');
    if(calBubbleOptions) calBubbleOptions.style.display = (state.calendar.bubbleEnabled !== false) ? '' : 'none';

    const perfectGlowToggle = el('perfectGlowToggle');
    if(perfectGlowToggle && !perfectGlowToggle.dataset.wired){
      perfectGlowToggle.dataset.wired = '1';
      perfectGlowToggle.addEventListener('click', e=>{
        const btn = e.target.closest('[data-glow]');
        if(!btn) return;
        state.mosaicColors.perfectGlow = btn.dataset.glow === 'on';
        save(); renderGoals(); renderMosaicColorInputs();
      });
    }
    const perfectStyleSelect = el('perfectStyleSelect');
    if(perfectStyleSelect && !perfectStyleSelect.dataset.wired){
      perfectStyleSelect.dataset.wired = '1';
      perfectStyleSelect.addEventListener('change', ()=>{
        state.mosaicColors.perfectStyle = perfectStyleSelect.value;
        save(); renderGoals(); renderMosaicColorInputs();
      });
    }
    const perfectEmojiInput = el('perfectEmojiInput');
    if(perfectEmojiInput && !perfectEmojiInput.dataset.wired){
      perfectEmojiInput.dataset.wired = '1';
      perfectEmojiInput.addEventListener('input', ()=>{
        state.mosaicColors.perfectEmoji = perfectEmojiInput.value.trim() || '⭐';
        renderGoals(); debouncedSave();
        document.querySelectorAll('#perfectEmojiPresets .emoji-swatch').forEach(b=>{
          b.classList.toggle('selected', b.dataset.emoji === state.mosaicColors.perfectEmoji);
        });
      });
    }
    const perfectEmojiPresets = el('perfectEmojiPresets');
    if(perfectEmojiPresets && !perfectEmojiPresets.dataset.wired){
      perfectEmojiPresets.dataset.wired = '1';
      perfectEmojiPresets.addEventListener('click', e=>{
        const btn = e.target.closest('.emoji-swatch');
        if(!btn) return;
        state.mosaicColors.perfectEmoji = btn.dataset.emoji;
        save(); renderGoals(); renderMosaicColorInputs();
      });
    }
  }


  /* ---------- lock screen (Settings > Data) ----------
     The PIN gate itself lives in js/pin.js and runs long before this file; all that's left here is
     the card that reports which PIN got in and offers the way back out. Wired at parse time rather
     than from a render function because this file loads after the markup and neither control ever
     changes for the life of the page — the role is fixed once the gate resolves, and locking is a
     reload. */
  const lockNowBtn = el('lockNowBtn');
  if(lockNowBtn) lockNowBtn.addEventListener('click', ()=>{ if(window.p25Lock) window.p25Lock(); });
  (window.p25GateReady || Promise.resolve(null)).then(role=>{
    const lbl = el('lockRoleLbl');
    if(lbl) lbl.textContent = role === 'owner' ? 'owner' : role === 'guest' ? 'guest' : 'unknown';
    /* Read AFTER the gate resolves, never before: an owner unlock writes the trust record as part
       of resolving, so asking any earlier would report "not trusted" on the very open that trusted
       it. fmtDate() is core.js's, rather than a second date format invented here. */
    const tl = el('lockTrustLbl');
    if(!tl) return;
    const t = (window.p25TrustInfo && window.p25TrustInfo()) || { trusted:false };
    if(t.trusted){
      tl.textContent = 'This device is trusted' + (t.since ? ', since ' + fmtDate(t.since) : '')
        + ' — the PIN isn’t asked here. Locking below removes that.';
    } else if(role === 'guest'){
      // said plainly, because the ticked box on the way in gave no sign it would be ignored
      tl.textContent = 'Guest sessions are never trusted — the PIN is asked again next time.';
    } else {
      tl.textContent = 'This device isn’t trusted — the PIN is asked each time the app is opened here.';
    }
  });
