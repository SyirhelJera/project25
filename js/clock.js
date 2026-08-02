  /* ================= CLOCK ================= */
  // Default palette for time blocks that don't have a custom color yet — the eating window
  // itself is always gold (see renderClockFace), custom blocks cycle through this list by index.
  const CLOCK_PALETTE = ['#FBBF24','#60A5FA','#A78BFA','#34D399','#F472B6','#38BDF8','#FB923C','#F87171'];
  function clockBlockColor(b, idx){ return (b && b.color) || CLOCK_PALETTE[idx % CLOCK_PALETTE.length]; }
  // "🌙 Sleep" when an emoji is set, otherwise just the label — shared by the block list, the
  // now-blocks row under the dial, and the sidebar chip so all three stay in sync.
  function clockBlockLabelText(b){ return (b && b.emoji) ? (b.emoji+' '+b.label) : (b ? b.label : ''); }

  function timeStrToMinutes(t){
    if(!t) return 0;
    const parts = t.split(':');
    return (parseInt(parts[0],10)||0)*60 + (parseInt(parts[1],10)||0);
  }
  function fmtTime12(hhmm){
    if(!hhmm) return '';
    const [h,m] = hhmm.split(':').map(Number);
    const period = h>=12 ? 'PM' : 'AM';
    let h12 = h%12; if(h12===0) h12=12;
    return h12+':'+String(m).padStart(2,'0')+' '+period;
  }
  function fmtTimeRange12(startStr, endStr){ return fmtTime12(startStr)+' – '+fmtTime12(endStr); }
  function fmtDurationMinutes(mins){
    mins = Math.max(0, Math.round(mins));
    const h = Math.floor(mins/60), m = mins%60;
    if(h && m) return h+'h '+m+'m';
    if(h) return h+'h';
    return m+'m';
  }

  // Duration in minutes from startStr to endStr, treating endStr<=startStr as crossing midnight
  // (e.g. Sleep 23:00–07:00 = 8h) rather than a negative/zero span.
  function clockBlockDurationMinutes(startStr, endStr){
    const s = timeStrToMinutes(startStr), e = timeStrToMinutes(endStr);
    let dur = e - s; if(dur <= 0) dur += 1440;
    return dur;
  }

  // Returns the portion(s) of a daily-recurring [startStr,endStr) occurrence that fall within the
  // CURRENT 12-hour half [halfStart, halfStart+720) (minutes-since-midnight; halfStart is 0 for
  // today's AM half or 720 for today's PM half) — as {angleStart,sweep} pairs (degrees, 0 = 12
  // o'clock, clockwise) ready for the dial.
  //
  // This replaces an earlier always-fold-mod-12 approach, which put e.g. an 8am block and an 8pm
  // block on the exact same wedge — a real analog dial can't tell AM from PM, but a static fold
  // made unrelated blocks visually collide even though they never actually overlap in time. Since
  // the dial now only ever displays ONE concrete 12-hour half at a time (see renderClockFace /
  // tickClock's half-flip check), a wedge only appears when there's a genuine overlap with *this*
  // half, and two blocks only ever share a wedge if they truly overlap in real time.
  //
  // Checks both today's occurrence and "yesterday's" (base-1440) since an overnight block (e.g.
  // Sleep 23:00–07:00) starts in one half and is still running into the next — so it needs a
  // segment out of both halves, clipped to each.
  function clockHalfSegments(startStr, endStr, halfStart){
    if(!startStr || !endStr) return [];
    const dur = clockBlockDurationMinutes(startStr, endStr);
    const base = timeStrToMinutes(startStr);
    const halfEnd = halfStart + 720;
    const segments = [];
    [base, base-1440].forEach(instStart=>{
      const ovStart = Math.max(instStart, halfStart);
      const ovEnd = Math.min(instStart+dur, halfEnd);
      if(ovEnd - ovStart > 0.5){
        segments.push({
          angleStart: ((ovStart-halfStart)/720)*360,
          sweep: Math.min(((ovEnd-ovStart)/720)*360, 359.5)
        });
      }
    });
    return segments;
  }

  function clockPolar(cx, cy, r, angleDeg){
    const rad = angleDeg * Math.PI/180;
    return { x: cx + r*Math.sin(rad), y: cy - r*Math.cos(rad) };
  }
  function clockSectorPath(cx, cy, r, angleStart, sweep){
    sweep = Math.max(0.5, Math.min(sweep, 359.5));
    const p1 = clockPolar(cx,cy,r,angleStart);
    const p2 = clockPolar(cx,cy,r,angleStart+sweep);
    const largeArc = sweep > 180 ? 1 : 0;
    return 'M '+cx+' '+cy+' L '+p1.x.toFixed(2)+' '+p1.y.toFixed(2)+' A '+r+' '+r+' 0 '+largeArc+' 1 '+p2.x.toFixed(2)+' '+p2.y.toFixed(2)+' Z';
  }
  // Donut-slice (annulus sector) path, used for the fasting ring around the outer edge of the
  // dial — a filled wedge between rInner and rOuter, rather than a pie slice from the center.
  function clockRingSectorPath(cx, cy, rOuter, rInner, angleStart, sweep){
    sweep = Math.max(0.5, Math.min(sweep, 359.5));
    const a2 = angleStart + sweep;
    const po1 = clockPolar(cx,cy,rOuter,angleStart), po2 = clockPolar(cx,cy,rOuter,a2);
    const pi2 = clockPolar(cx,cy,rInner,a2), pi1 = clockPolar(cx,cy,rInner,angleStart);
    const largeArc = sweep > 180 ? 1 : 0;
    return 'M '+po1.x.toFixed(2)+' '+po1.y.toFixed(2)
      +' A '+rOuter+' '+rOuter+' 0 '+largeArc+' 1 '+po2.x.toFixed(2)+' '+po2.y.toFixed(2)
      +' L '+pi2.x.toFixed(2)+' '+pi2.y.toFixed(2)
      +' A '+rInner+' '+rInner+' 0 '+largeArc+' 0 '+pi1.x.toFixed(2)+' '+pi1.y.toFixed(2)+' Z';
  }

  // fasting.enabled + a valid window required; returns null (not "off") when nothing is configured
  function computeFastingStatus(nowDate){
    const f = state.clock.fasting;
    if(!f || !f.enabled || !f.eatingStart || !f.eatingEnd) return null;
    const nowMin = nowDate.getHours()*60 + nowDate.getMinutes() + nowDate.getSeconds()/60;
    const dur = clockBlockDurationMinutes(f.eatingStart, f.eatingEnd);
    const s = timeStrToMinutes(f.eatingStart);
    let rel = nowMin - s; if(rel < 0) rel += 1440;
    const eating = rel < dur;
    const minsLeft = eating ? (dur - rel) : (1440 - rel);
    return { eating, minsLeft, fastingMinutes: 1440 - dur, eatingMinutes: dur };
  }

  function blocksActiveAt(nowDate){
    const nowMin = nowDate.getHours()*60 + nowDate.getMinutes();
    return (state.clock.blocks||[]).filter(b=>{
      if(!b.start || !b.end) return false;
      const dur = clockBlockDurationMinutes(b.start, b.end);
      let rel = nowMin - timeStrToMinutes(b.start); if(rel < 0) rel += 1440;
      return rel < dur;
    });
  }

  // Which 12-hour half (today's AM or PM) the dial last rendered — checked by tickClock every
  // second so a live-open Clock tab automatically flips to the other half's schedule right at
  // noon/midnight, without waiting for a config change or tab re-visit to trigger a rebuild.
  let clockLastHalf = null;

  // Rebuilds the whole dial (ring + sectors + ticks + numerals + hands) for whichever 12-hour half
  // (AM/PM) is current right now — needed on config changes, and once per half-flip (see
  // tickClock); per-second updates otherwise go through updateClockHands instead, so a running
  // clock never re-parses/re-renders the sector paths every tick.
  //
  // The fasting eating/fasting cycle renders as a ring around the OUTSIDE edge of the dial
  // (radius 90–99), kept separate from custom time blocks, which stay as pie slices filling the
  // inner face (radius <=86) — this way the fasting ring never visually competes with (or gets
  // hidden by) a same-shaped time-block wedge, and reads at a glance like a standalone fasting
  // tracker sitting on the clock's rim.
  function renderClockFace(){
    const svg = el('clockSvg'); if(!svg) return;
    const cx=100, cy=100, r=86;
    const now = new Date();
    const halfStart = now.getHours() < 12 ? 0 : 720;
    clockLastHalf = halfStart === 0 ? 'am' : 'pm';

    let ring = '';
    if(state.clock.fasting && state.clock.fasting.enabled){
      const f = state.clock.fasting;
      clockHalfSegments(f.eatingStart, f.eatingEnd, halfStart).forEach(seg=>{
        ring += '<path d="'+clockRingSectorPath(cx,cy,99,90,seg.angleStart,seg.sweep)+'" fill="#FBBF24" fill-opacity="0.92" stroke="#10121C" stroke-width="1"></path>';
      });
      // complement (fasting) segment — same helper, start/end swapped so it covers
      // "eatingEnd until eatingStart" instead of "eatingStart until eatingEnd"
      clockHalfSegments(f.eatingEnd, f.eatingStart, halfStart).forEach(seg=>{
        ring += '<path d="'+clockRingSectorPath(cx,cy,99,90,seg.angleStart,seg.sweep)+'" fill="#3E4468" fill-opacity="0.92" stroke="#10121C" stroke-width="1"></path>';
      });
    }

    let sectors = '', blockEmojis = '';
    (state.clock.blocks||[]).forEach((b,i)=>{
      clockHalfSegments(b.start, b.end, halfStart).forEach(seg=>{
        sectors += '<path d="'+clockSectorPath(cx,cy,r,seg.angleStart,seg.sweep)+'" fill="'+clockBlockColor(b,i)+'" fill-opacity="0.85" stroke="#10121C" stroke-width="1"></path>';
        if(b.emoji){
          // sits partway out from the center, well clear of both the numerals ring (r=62) and
          // the hands, at the angular midpoint of this wedge
          const mid = clockPolar(cx,cy,46,seg.angleStart+seg.sweep/2);
          blockEmojis += '<text x="'+mid.x.toFixed(2)+'" y="'+mid.y.toFixed(2)+'" text-anchor="middle" dominant-baseline="central" font-size="15">'+escapeHtml(b.emoji)+'</text>';
        }
      });
    });

    let ticks = '';
    for(let i=0;i<12;i++){
      const angle = i*30, isMajor = i%3===0;
      const p1 = clockPolar(cx,cy, isMajor?73:79, angle);
      const p2 = clockPolar(cx,cy, r, angle);
      ticks += '<line x1="'+p1.x.toFixed(2)+'" y1="'+p1.y.toFixed(2)+'" x2="'+p2.x.toFixed(2)+'" y2="'+p2.y.toFixed(2)+'" stroke="rgba(255,255,255,'+(isMajor?0.55:0.28)+')" stroke-width="'+(isMajor?2.2:1.3)+'" stroke-linecap="round"></line>';
    }

    const numerals = [[0,'12'],[90,'3'],[180,'6'],[270,'9']].map(pair=>{
      const p = clockPolar(cx,cy,62,pair[0]);
      return '<text x="'+p.x.toFixed(2)+'" y="'+p.y.toFixed(2)+'" text-anchor="middle" dominant-baseline="central" font-size="12.5" font-weight="800" font-family="Manrope,sans-serif" fill="rgba(255,255,255,.82)">'+pair[1]+'</text>';
    }).join('');

    svg.innerHTML =
        '<circle cx="100" cy="100" r="'+r+'" fill="#171A28"></circle>'
      + sectors + blockEmojis + ticks + numerals
      // greyed-out "already past" overlay, one for the inner face and one for the outer fasting
      // ring — shape is filled in by updateClockPastOverlay (every tick, not just on rebuild) so
      // it keeps growing smoothly through the half instead of jumping only twice a day
      + '<path id="clockPastOverlayFace" fill="#05060C" fill-opacity="0.6"></path>'
      + '<circle cx="100" cy="100" r="88" fill="none" stroke="#2E3350" stroke-width="3"></circle>'
      + ring
      + '<path id="clockPastOverlayRing" fill="#05060C" fill-opacity="0.6"></path>'
      + '<line id="clockHourHand" x1="100" y1="100" x2="100" y2="60" stroke="#F5F7FF" stroke-width="5" stroke-linecap="round"></line>'
      + '<line id="clockMinuteHand" x1="100" y1="100" x2="100" y2="41" stroke="#F5F7FF" stroke-width="3.2" stroke-linecap="round"></line>'
      + '<line id="clockSecondHand" x1="100" y1="115" x2="100" y2="33" stroke="#FBBF24" stroke-width="1.4" stroke-linecap="round"></line>'
      + '<circle cx="100" cy="100" r="4.5" fill="#FBBF24" stroke="#171A28" stroke-width="1.5"></circle>';
    updateClockPastOverlay(now);
  }

  // Redraws just the two grey "already past" overlay wedges (face + ring) by rewriting their `d`
  // attribute — cheap enough to run every tick, unlike renderClockFace's full innerHTML rebuild.
  // Both wedges run from this half's start (12 o'clock) clockwise up to right now, so whatever's
  // already elapsed in the current AM/PM half reads as dimmed and what's still ahead stays vivid.
  function updateClockPastOverlay(now){
    const faceEl = el('clockPastOverlayFace'), ringEl = el('clockPastOverlayRing');
    if(!faceEl || !ringEl) return;
    const halfStart = now.getHours() < 12 ? 0 : 720;
    const nowMin = now.getHours()*60 + now.getMinutes() + now.getSeconds()/60;
    const sweepDeg = (Math.max(0, Math.min(nowMin - halfStart, 720)) / 720) * 360;
    faceEl.setAttribute('d', clockSectorPath(100,100,86,0,sweepDeg));
    ringEl.setAttribute('d', clockRingSectorPath(100,100,99,90,0,sweepDeg));
  }

  function updateClockHands(now){
    const h = now.getHours()%12, m = now.getMinutes(), s = now.getSeconds();
    const hourAngle = (h + m/60)/12*360;
    const minuteAngle = (m + s/60)/60*360;
    const secondAngle = s/60*360;
    const hourEl = el('clockHourHand'), minEl = el('clockMinuteHand'), secEl = el('clockSecondHand');
    if(hourEl) hourEl.setAttribute('transform','rotate('+hourAngle.toFixed(2)+' 100 100)');
    if(minEl) minEl.setAttribute('transform','rotate('+minuteAngle.toFixed(2)+' 100 100)');
    if(secEl) secEl.setAttribute('transform','rotate('+secondAngle.toFixed(2)+' 100 100)');
  }
  function updateClockDigital(now){
    const digital = el('clockDigital');
    if(digital) digital.textContent = now.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const dateEl = el('clockDateReadout');
    if(dateEl) dateEl.textContent = now.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
  }
  // Labels which concrete half the dial is currently showing — without this, there's no way to
  // tell at a glance whether a wedge at the "8" mark means 8am or 8pm.
  function updateClockHalfLabel(now){
    const labelEl = el('clockHalfLabel'); if(!labelEl) return;
    labelEl.textContent = now.getHours() < 12 ? 'Showing 12:00 AM – 12:00 PM' : 'Showing 12:00 PM – 12:00 AM';
  }
  function updateClockStatus(now){
    const phaseEl = el('clockStatusPhase'), cdEl = el('clockStatusCountdown'), subEl = el('clockStatusSub');
    if(!phaseEl) return;
    const fs = computeFastingStatus(now);
    if(!fs){
      phaseEl.textContent = '⏱️ Fasting tracking is off';
      cdEl.textContent = 'Enable it below to see a live countdown.';
      subEl.textContent = '';
    } else if(fs.eating){
      phaseEl.textContent = '🍽️ Eating window open';
      cdEl.textContent = fmtDurationMinutes(fs.minsLeft)+' left · fast starts at '+fmtTime12(state.clock.fasting.eatingEnd);
      subEl.textContent = 'Fast '+fmtDurationMinutes(fs.fastingMinutes)+' / Eat '+fmtDurationMinutes(fs.eatingMinutes)+' schedule';
    } else {
      phaseEl.textContent = '⏳ Fasting';
      cdEl.textContent = fmtDurationMinutes(fs.minsLeft)+' left · eating window opens at '+fmtTime12(state.clock.fasting.eatingStart);
      subEl.textContent = 'Fast '+fmtDurationMinutes(fs.fastingMinutes)+' / Eat '+fmtDurationMinutes(fs.eatingMinutes)+' schedule';
    }
  }
  function updateClockNowBlocks(now){
    const wrap = el('clockNowBlocks'); if(!wrap) return;
    const all = state.clock.blocks||[];
    wrap.innerHTML = blocksActiveAt(now).map(b=>{
      // the color dot is redundant once there's an emoji doing the same "identify this block at a
      // glance" job, so skip it rather than showing both
      const dot = b.emoji ? '' : '<span class="dot" style="background:'+clockBlockColor(b, all.indexOf(b))+';"></span>';
      return '<span class="clock-now-chip">'+dot+escapeHtml(clockBlockLabelText(b))+'</span>';
    }).join('');
  }

  function renderNavChip(wrap, dotColor, label, showDot){
    if(!wrap) return;
    if(!label){ wrap.style.display = 'none'; wrap.innerHTML = ''; return; }
    wrap.title = label;
    const dot = showDot===false ? '' : '<span class="nav-clock-dot" style="background:'+dotColor+';"></span>';
    wrap.innerHTML = dot+'<span class="nav-clock-label">'+escapeHtml(label)+'</span>';
    wrap.style.display = 'flex';
  }

  // Two independent sidebar chips, in the middle ground between the brand name and the mobile
  // Play button: #navClockStatus (fasting vs eating) and #navBlockStatus (whatever time block is
  // active right now). Kept as two separate chips rather than one combined "Eating · Sleep"
  // string — concatenating them made the label too long for the chip's width and it just
  // ellipsized down to unreadable "Fa…" garbage. Each stays hidden unless it has something to
  // say. Runs regardless of which tab is open, unlike the rest of tickClock.
  function updateNavClockStatus(now){
    if(!state.clock) return;
    const fs = computeFastingStatus(now);
    renderNavChip(el('navClockStatus'), fs ? (fs.eating ? 'var(--gold)' : 'var(--muted)') : '', fs ? (fs.eating ? 'Eating' : 'Fasting') : '');

    const active = blocksActiveAt(now);
    const block = active[0];
    const blockColor = block ? clockBlockColor(block, (state.clock.blocks||[]).indexOf(block)) : '';
    renderNavChip(el('navBlockStatus'), blockColor, block ? clockBlockLabelText(block) : '', !(block && block.emoji));
  }

  // Per-second refresh. The sidebar chip updates regardless of which tab is open; the rest (hands,
  // digital readout, on-page status card) is skipped whenever the Clock tab isn't the visible view.
  function tickClock(){
    const now = new Date();
    updateNavClockStatus(now);
    const view = el('view-clock');
    if(!view || !view.classList.contains('active')) return;
    if(!el('clockSvg')) return;
    // flips the dial to the other half's schedule right at noon/midnight, even if the tab has
    // been sitting open the whole time (renderClockFace keeps clockLastHalf in sync when called)
    const half = now.getHours() < 12 ? 'am' : 'pm';
    if(half !== clockLastHalf) renderClockFace();
    updateClockHands(now);
    updateClockPastOverlay(now);
    updateClockDigital(now);
    updateClockHalfLabel(now);
    updateClockStatus(now);
    updateClockNowBlocks(now);
  }
  setInterval(tickClock, 1000);

  // id of the block currently being edited in-place (js/clock.js only, not persisted — reloading
  // mid-edit should just show the normal list, not resume a stale edit form)
  let clockEditingBlockId = null;

  function renderClockBlockEditCard(b, idx){
    const card = document.createElement('div'); card.className = 'clock-block-edit-card';
    card.innerHTML =
        '<div class="fitness-fields">'
      +   '<div class="fitness-field"><label>Label</label><input type="text" class="ceLabel" maxlength="40" value="'+escapeHtml(b.label)+'"></div>'
      +   '<div class="fitness-field"><label>Emoji (optional)</label><input type="text" class="ceEmoji" maxlength="8" value="'+escapeHtml(b.emoji||'')+'" placeholder="🌙"></div>'
      +   '<div class="fitness-field"><label>Start</label><input type="time" class="ceStart" value="'+escapeHtml(b.start||'')+'"></div>'
      +   '<div class="fitness-field"><label>End</label><input type="time" class="ceEnd" value="'+escapeHtml(b.end||'')+'"></div>'
      +   '<div class="fitness-field"><label>Color</label><input type="color" class="ceColor" value="'+escapeHtml(clockBlockColor(b,idx))+'"></div>'
      + '</div>'
      + '<div class="clock-block-edit-actions">'
      +   '<button class="btn btn-primary btn-sm ceSave" type="button">Save</button>'
      +   '<button class="btn btn-ghost btn-sm ceCancel" type="button">Cancel</button>'
      + '</div>';
    const labelInput = card.querySelector('.ceLabel');
    function saveEdit(){
      const label = labelInput.value.trim();
      const start = card.querySelector('.ceStart').value;
      const end = card.querySelector('.ceEnd').value;
      if(!label || !start || !end) return;
      b.label = label; b.emoji = card.querySelector('.ceEmoji').value.trim(); b.start = start; b.end = end; b.color = card.querySelector('.ceColor').value;
      clockEditingBlockId = null;
      save(); renderClock();
    }
    card.querySelector('.ceSave').addEventListener('click', saveEdit);
    card.querySelector('.ceCancel').addEventListener('click', ()=>{ clockEditingBlockId = null; renderClockBlockList(); });
    labelInput.addEventListener('keydown', e=>{ if(e.key==='Enter') saveEdit(); });
    return card;
  }

  function renderClockBlockList(){
    const list = el('clockBlockList'), empty = el('clockBlockEmpty');
    list.innerHTML = '';
    const blocks = state.clock.blocks||[];
    empty.style.display = blocks.length===0 ? 'block':'none';
    blocks.forEach((b,i)=>{
      if(b.id === clockEditingBlockId){ list.appendChild(renderClockBlockEditCard(b,i)); return; }
      const dur = (b.start && b.end) ? clockBlockDurationMinutes(b.start, b.end) : null;
      const card = document.createElement('div'); card.className='cd-card';
      card.innerHTML = '<div class="clock-block-swatch" style="background:'+clockBlockColor(b,i)+';"></div>'
        + '<div class="cd-info"><div class="cd-name">'+escapeHtml(clockBlockLabelText(b))+'</div><div class="cd-date">'+fmtTimeRange12(b.start,b.end)+(dur!==null?' · '+fmtDurationMinutes(dur):'')+'</div></div>'
        + '<button class="rename-btn" title="Edit">✎</button>'
        + '<button class="del-goal">Delete</button>';
      card.querySelector('.rename-btn').addEventListener('click', ()=>{
        clockEditingBlockId = b.id;
        renderClockBlockList();
      });
      card.querySelector('.del-goal').addEventListener('click', ()=>{
        state.clock.blocks = state.clock.blocks.filter(x=>x.id!==b.id);
        save(); renderClock();
      });
      list.appendChild(card);
    });
  }

  function addClockBlock(){
    const label = el('clockBlockLabel').value.trim();
    const emoji = el('clockBlockEmoji').value.trim();
    const start = el('clockBlockStart').value;
    const end = el('clockBlockEnd').value;
    const color = el('clockBlockColor').value;
    if(!label || !start || !end) return;
    state.clock.blocks.push({ id:uid(), label, emoji, start, end, color });
    el('clockBlockLabel').value = ''; el('clockBlockEmoji').value = ''; el('clockBlockStart').value=''; el('clockBlockEnd').value='';
    save(); renderClock();
  }
  el('addClockBlockBtn').addEventListener('click', addClockBlock);
  el('clockBlockLabel').addEventListener('keydown', e=>{ if(e.key==='Enter') addClockBlock(); });

  el('clockFastingEnabled').addEventListener('change', e=>{
    state.clock.fasting.enabled = e.target.checked;
    save(); renderClock();
  });
  el('clockEatingStart').addEventListener('change', e=>{
    state.clock.fasting.eatingStart = e.target.value || '12:00';
    save(); renderClock();
  });
  el('clockEatingEnd').addEventListener('change', e=>{
    state.clock.fasting.eatingEnd = e.target.value || '20:00';
    save(); renderClock();
  });

  function renderClock(){
    if(!state.clock) state.clock = { fasting:{enabled:false,eatingStart:'12:00',eatingEnd:'20:00'}, blocks:[] };
    renderClockFace();
    el('clockFastingEnabled').checked = !!state.clock.fasting.enabled;
    el('clockEatingStart').value = state.clock.fasting.eatingStart || '';
    el('clockEatingEnd').value = state.clock.fasting.eatingEnd || '';
    el('clockFastingFields').style.opacity = state.clock.fasting.enabled ? '1' : '.6';
    // next "+ Add Block" starts pre-filled with the color that block would get by default,
    // so successive adds cycle through the palette without the user having to touch the swatch
    el('clockBlockColor').value = CLOCK_PALETTE[(state.clock.blocks||[]).length % CLOCK_PALETTE.length];
    renderClockBlockList();
    tickClock();
  }
