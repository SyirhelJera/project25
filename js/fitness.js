  /* ================= FITNESS ================= */
  const KG_PER_LB = 0.45359237;
  // fitness.currentWeight / targetWeight / weightLog entries are always stored internally in kg;
  // the unit toggle only changes how values are displayed and entered.
  function kgToDisplay(kg){ return state.fitness.unit === 'lb' ? kg / KG_PER_LB : kg; }
  function displayToKg(v){ return state.fitness.unit === 'lb' ? v * KG_PER_LB : v; }
  function unitLabel(){ return state.fitness.unit === 'lb' ? 'lb' : 'kg'; }
  function roundDisp(v){ return Math.round(v*10)/10; }

  function bmiCategory(bmi){
    if(bmi < 18.5) return 'Underweight';
    if(bmi < 25) return 'Normal weight';
    if(bmi < 30) return 'Overweight';
    return 'Obese';
  }

  // Simplified read of BMI (Underweight / Fit / Overweight / Obese), color-coded so it's readable
  // at a glance: green when normal, amber when under/overweight, red when obese.
  function getFitnessTier(){
    const f = state.fitness;
    const cw = parseFloat(f.currentWeight), h = parseFloat(f.height);
    if(isNaN(cw) || isNaN(h) || h<=0) return null;
    const heightM = h/100;
    const bmi = cw / (heightM*heightM);
    if(bmi < 18.5) return { label:'Underweight', color:'var(--gold)' };
    if(bmi >= 30) return { label:'Obese', color:'var(--danger)' };
    if(bmi >= 25) return { label:'Overweight', color:'var(--gold)' };
    return { label:'Fit', color:'var(--success)' };
  }

  // Fitness Level shown on the profile card
  function updateFitnessLevelUI(){
    const lvlEl = el('pfFitnessLevel');
    if(!lvlEl) return;
    const tier = getFitnessTier();
    lvlEl.textContent = tier ? tier.label : '—';
    lvlEl.style.color = tier ? tier.color : '';
    updateAvatar();
  }

  // Hair size/shape and color by age bracket — bigger head + higher hairline reads as younger,
  // grey hair + glasses reads as older. Kept to broad, respectful brackets rather than exact age.
  function avatarAgeProfile(age){
    if(isNaN(age)) return { headR:21, hairR:24, hairCy:36, hairColor:'#3D2B1F', glasses:false };
    if(age < 18) return { headR:23, hairR:21, hairCy:32, hairColor:'#6B4226', glasses:false };
    if(age < 60) return { headR:21, hairR:24, hairCy:36, hairColor:'#3D2B1F', glasses:false };
    return { headR:21, hairR:22, hairCy:37, hairColor:'#B8BCC4', glasses:true };
  }
  // Chest-pin color by XP level tier — same bronze/silver/gold/platinum/diamond progression
  // used elsewhere for level tiers.
  function avatarLevelColor(level){
    if(level >= 30) return '#EC4899';
    if(level >= 20) return '#3B82F6';
    if(level >= 10) return '#F5A524';
    if(level >= 5) return '#B7C0CC';
    return '#CD7F32';
  }
  // Outfit color (and a crown at the top tier) by net worth — richer colors as net worth climbs.
  function avatarWorthTier(nw){
    if(nw >= 1000000) return { color:'#A855F7', crown:true };
    if(nw >= 100000) return { color:'#F5A524', crown:false };
    if(nw >= 10000) return { color:'#818CF8', crown:false };
    if(nw >= 1000) return { color:'#60A5FA', crown:false };
    return { color:'#94A3B8', crown:false };
  }

  // Player-card avatar: either the AI-generated image (once the user has manually generated
  // one — see generateAiAvatar()), or a fallback hand-drawn SVG character (no external
  // images/fonts) whose hair/build reflects age, chest pin reflects level tier, and outfit
  // color (plus a crown at the top tier) reflects net worth —
  // all redrawn from current state. The AI image is never (re)generated automatically; it's
  // only ever replaced when the user presses the generate/regenerate button.
  function updateAvatar(){
    const ringEl = el('pfAvatarRing'), svg = el('pfAvatarSvg'), img = el('pfAvatarImg');
    if(!ringEl || !svg) return;

    const fitTier = getFitnessTier();

    const genBtn = el('pfAvatarGenBtn');
    if(genBtn && !genBtn.disabled){
      genBtn.textContent = state.profile.avatarImage ? '↻ Regenerate Avatar' : '✦ Generate AI Avatar';
    }

    if(state.profile.avatarImage){
      img.src = state.profile.avatarImage;
      img.style.display = 'block';
      svg.style.display = 'none';
    } else {
      img.style.display = 'none';
      svg.style.display = 'block';
    }

    const ap = avatarAgeProfile(parseFloat(state.profile.age));
    const { level } = levelInfo(totalExp());
    const emblemColor = avatarLevelColor(level);
    const worthTier = avatarWorthTier(getNetWorthNum());
    const skin = '#F2C79E';
    const headCx = 50, headCy = 44;
    const hairTop = ap.hairCy - ap.hairR;

    const parts = [];
    parts.push('<path d="M14,100 Q14,66 50,66 Q86,66 86,100 Z" fill="'+worthTier.color+'"/>');
    parts.push('<path d="M50,66 L42,80 L50,74 L58,80 Z" fill="#fff" opacity="0.35"/>');
    parts.push('<rect x="43" y="54" width="14" height="16" rx="5" fill="'+skin+'"/>');
    parts.push('<circle cx="'+headCx+'" cy="'+ap.hairCy+'" r="'+ap.hairR+'" fill="'+ap.hairColor+'"/>');
    parts.push('<circle cx="'+headCx+'" cy="'+headCy+'" r="'+ap.headR+'" fill="'+skin+'"/>');
    parts.push('<circle cx="'+(headCx-8)+'" cy="'+headCy+'" r="2.3" fill="#2B2B2B"/>');
    parts.push('<circle cx="'+(headCx+8)+'" cy="'+headCy+'" r="2.3" fill="#2B2B2B"/>');
    parts.push('<path d="M'+(headCx-8)+','+(headCy+8)+' Q'+headCx+','+(headCy+14)+' '+(headCx+8)+','+(headCy+8)+'" stroke="#2B2B2B" stroke-width="2" fill="none" stroke-linecap="round"/>');
    if(ap.glasses){
      parts.push('<circle cx="'+(headCx-8)+'" cy="'+headCy+'" r="6" fill="none" stroke="#4B5563" stroke-width="1.6"/>');
      parts.push('<circle cx="'+(headCx+8)+'" cy="'+headCy+'" r="6" fill="none" stroke="#4B5563" stroke-width="1.6"/>');
      parts.push('<line x1="'+(headCx-2)+'" y1="'+headCy+'" x2="'+(headCx+2)+'" y2="'+headCy+'" stroke="#4B5563" stroke-width="1.6"/>');
    }
    if(level >= 10 && !worthTier.crown){
      parts.push('<path d="M46,'+(hairTop+2)+' L50,'+(hairTop-6)+' L54,'+(hairTop+2)+' Z" fill="'+ap.hairColor+'"/>');
    }
    const emblemSize = 6 + Math.min(4, Math.floor(level/10));
    parts.push('<rect x="'+(50-emblemSize/2)+'" y="'+(84-emblemSize/2)+'" width="'+emblemSize+'" height="'+emblemSize+'" transform="rotate(45 50 84)" fill="'+emblemColor+'" stroke="#fff" stroke-width="0.8"/>');
    if(worthTier.crown){
      parts.push('<path d="M36,20 L40,28 L50,17 L60,28 L64,20 L61,30 L39,30 Z" fill="#FFD700" stroke="#B8860B" stroke-width="0.8"/>');
    }
    if(level >= 30){
      parts.push('<rect x="16" y="70" width="4" height="4" transform="rotate(45 18 72)" fill="#EC4899"/>');
      parts.push('<rect x="80" y="70" width="4" height="4" transform="rotate(45 82 72)" fill="#EC4899"/>');
    }
    svg.innerHTML = parts.join('');
    ringEl.title = 'Lv.'+level+' · '+(fitTier?fitTier.label:'Fitness not set')+' · $'+Math.round(getNetWorthNum()).toLocaleString()+' net worth';
  }

  // Reduce the current stats down to small fixed vocabularies before they ever leave the
  // browser — the edge function maps these keys to its own prompt text server-side, so no
  // free-form profile text (name, etc.) is ever sent to the image model.
  function avatarAgeBracketKey(age){
    if(isNaN(age)) return 'unknown';
    if(age < 18) return 'young';
    if(age < 60) return 'adult';
    return 'senior';
  }
  function avatarFitnessKey(){
    const t = getFitnessTier();
    if(!t) return 'unknown';
    if(t.label === 'Fit') return 'fit';
    if(t.label === 'Underweight') return 'underweight';
    if(t.label === 'Overweight') return 'overweight';
    return 'obese'; // only remaining tier from getFitnessTier()
  }
  function avatarWorthKey(nw){
    if(nw >= 1000000) return 'elite';
    if(nw >= 100000) return 'wealthy';
    if(nw >= 10000) return 'comfortable';
    if(nw >= 1000) return 'stable';
    return 'starter';
  }

  // Manual only, by design: this never runs on page load or on a stat change — only a direct
  // button click calls it, and the resulting image is saved into state.profile.avatarImage so
  // it persists as-is across visits until the user presses the button again.
  async function generateAiAvatar(){
    const btn = el('pfAvatarGenBtn'), errEl = el('pfAvatarGenErr');
    if(!btn) return;
    errEl.style.display = 'none';
    if(usingClaudeStorage){
      errEl.textContent = 'AI avatar generation isn’t available in this mode — it only works on the Supabase-hosted deployment.';
      errEl.style.display = 'block';
      return;
    }
    if(!initSupabaseIfNeeded()) return;
    btn.textContent = '✦ Generating...'; btn.disabled = true;
    try{
      const payload = {
        ageBracket: avatarAgeBracketKey(parseFloat(state.profile.age)),
        fitnessTier: avatarFitnessKey(),
        worthTier: avatarWorthKey(getNetWorthNum()),
        // Optional free-text appearance details from the About Me tab — the edge function
        // sanitizes/truncates these itself; net worth still always shapes clothing quality
        // and surroundings server-side even when these are filled in.
        race: state.profile.race || '',
        skinTone: state.profile.skinTone || '',
        hairColor: state.profile.hairColor || '',
        hairStyle: state.profile.hairStyle || '',
        eyeColor: state.profile.eyeColor || '',
        clothing: state.profile.clothing || '',
        background: state.profile.background || '',
      };
      const { data, error } = await supa.functions.invoke('generate-avatar', { body: payload });
      if(error){
        // supabase-js's default error.message is just "Edge Function returned a non-2xx
        // status code" — the real reason (rate limit, upstream failure, etc.) is in the
        // response body, so pull it out when available instead of showing the generic text.
        let detail = '';
        if(error.context && typeof error.context.json === 'function'){
          try{ detail = (await error.context.json())?.error || ''; }catch(_){}
        }
        throw new Error(detail || error.message);
      }
      if(data && data.error) throw new Error(data.error);
      if(!data || !data.image) throw new Error('No image came back, try again.');
      state.profile.avatarImage = data.image;
      state.profile.avatarGeneratedAt = Date.now();
      save();
    }catch(e){
      const msg = (e && e.message) ? e.message : 'Could not generate an avatar right now, try again shortly.';
      errEl.textContent = msg;
      errEl.style.display = 'block';
    }
    btn.disabled = false;
    updateAvatar();
  }
  el('pfAvatarGenBtn').addEventListener('click', generateAiAvatar);

  function calcFitness(){
    const f = state.fitness;
    const cw = parseFloat(f.currentWeight), tw = parseFloat(f.targetWeight), h = parseFloat(f.height), age = parseFloat(f.age);
    const activity = parseFloat(f.activity)||1.55, pace = parseFloat(f.pace)||0.5;
    const resultsEl = el('fitnessResults'), noteEl = el('fitnessNote');
    updateFitnessLevelUI();
    if(isNaN(cw) || isNaN(h) || isNaN(age)){
      resultsEl.style.display='none';
      noteEl.textContent = 'Fill in current weight, height, and age to calculate your calorie targets.';
      return;
    }
    // Mifflin-St Jeor BMR formula
    const bmr = f.sex==='female' ? (10*cw + 6.25*h - 5*age - 161) : (10*cw + 6.25*h - 5*age + 5);
    const tdee = bmr * activity;
    let target = tdee, note = 'Enter a target weight above to get a daily calorie target for reaching it.';
    if(!isNaN(tw) && tw !== cw){
      const dailyDelta = (pace * 7700) / 7; // ~7700 kcal per kg of body weight
      target = tw < cw ? tdee - dailyDelta : tdee + dailyDelta;
      const weeks = Math.ceil(Math.abs(tw - cw) / pace);
      el('fitWeeks').textContent = weeks;
      note = (tw < cw ? 'A daily deficit of ' : 'A daily surplus of ') + Math.round(dailyDelta) + ' kcal gets you to ' + roundDisp(kgToDisplay(tw)) + unitLabel() + ' in about ' + weeks + ' week' + (weeks===1?'':'s') + ', at ' + pace + 'kg/week.';
    } else {
      el('fitWeeks').textContent = '\u2014';
    }
    // BMI: always calculated from kg + cm regardless of display unit
    const heightM = h/100;
    const bmi = heightM > 0 ? cw / (heightM*heightM) : null;
    if(bmi){
      el('fitBMI').textContent = bmi.toFixed(1);
      el('fitBMICat').textContent = bmiCategory(bmi);
    } else {
      el('fitBMI').textContent = '\u2014';
      el('fitBMICat').textContent = '\u2014';
    }
    el('fitBMR').textContent = Math.round(bmr);
    el('fitTDEE').textContent = Math.round(tdee);
    el('fitTarget2').textContent = Math.round(target);
    resultsEl.style.display = 'grid';
    noteEl.textContent = note;
  }

  function updateUnitLabels(){
    const u = unitLabel();
    el('fitCurrentLbl').textContent = 'Current Weight ('+u+')';
    el('fitTargetLbl').textContent = 'Target Weight ('+u+')';
    el('fitPaceLbl').textContent = 'Target Pace (kg/week)';
    el('unitBtnKg').classList.toggle('active', state.fitness.unit!=='lb');
    el('unitBtnLb').classList.toggle('active', state.fitness.unit==='lb');
  }

  function renderFitness(){
    const f = state.fitness;
    updateUnitLabels();
    el('fitCurrent').value = f.currentWeight ? roundDisp(kgToDisplay(parseFloat(f.currentWeight))) : '';
    el('fitTarget').value = f.targetWeight ? roundDisp(kgToDisplay(parseFloat(f.targetWeight))) : '';
    el('fitHeight').value = f.height || '';
    el('fitAge').value = f.age || '';
    el('fitSex').value = f.sex || 'male';
    el('fitActivity').value = f.activity || '1.55';
    el('fitPace').value = f.pace || '0.5';
    el('wlDate').value = localDateStr(new Date());
    calcFitness();
    renderWeightLog();
    renderWeightChart();
    updateFitnessReminder();
  }
  el('fitCurrent').addEventListener('input', ()=>{
    const v = parseFloat(el('fitCurrent').value);
    state.fitness.currentWeight = isNaN(v) ? '' : displayToKg(v);
    debouncedSave(); calcFitness(); renderWeightChart();
  });
  el('fitTarget').addEventListener('input', ()=>{
    const v = parseFloat(el('fitTarget').value);
    state.fitness.targetWeight = isNaN(v) ? '' : displayToKg(v);
    debouncedSave(); calcFitness();
  });
  ['fitHeight','fitAge'].forEach(id=>{
    el(id).addEventListener('input', ()=>{
      state.fitness.height = el('fitHeight').value;
      state.fitness.age = el('fitAge').value;
      debouncedSave(); calcFitness(); renderWeightChart();
    });
  });
  ['fitSex','fitActivity','fitPace'].forEach(id=>{
    el(id).addEventListener('change', ()=>{
      state.fitness.sex = el('fitSex').value;
      state.fitness.activity = el('fitActivity').value;
      state.fitness.pace = el('fitPace').value;
      save(); calcFitness();
    });
  });

  el('unitToggle').addEventListener('click', e=>{
    const btn = e.target.closest('[data-unit]');
    if(!btn) return;
    state.fitness.unit = btn.dataset.unit;
    save(); renderFitness();
  });

  /* ---- daily weight log ---- */
  function upsertWeightLog(dateStr, kg){
    if(!state.fitness.weightLog) state.fitness.weightLog = [];
    const existing = state.fitness.weightLog.find(e=>e.date===dateStr);
    if(existing) existing.kg = kg;
    else state.fitness.weightLog.push({date:dateStr, kg});
    syncCurrentWeightFromLog();
  }
  // Keeps "Current Weight" (and therefore BMI/BMR) in sync with the most recently dated log
  // entry, so logging a new weight — even backfilling a past date — always recalculates BMI
  // against whichever entry is chronologically most recent.
  function syncCurrentWeightFromLog(){
    const log = state.fitness.weightLog;
    if(!log || !log.length) return;
    const latest = log.reduce((a,b)=> (b.date > a.date ? b : a));
    state.fitness.currentWeight = latest.kg;
  }
  function addWeightLogEntry(){
    const dateStr = el('wlDate').value || localDateStr(new Date());
    const v = parseFloat(el('wlWeight').value);
    if(isNaN(v) || v<=0) return;
    upsertWeightLog(dateStr, displayToKg(v));
    el('wlWeight').value = '';
    save(); renderFitness();
  }
  el('wlAddBtn').addEventListener('click', addWeightLogEntry);
  el('wlWeight').addEventListener('keydown', e=>{ if(e.key==='Enter') addWeightLogEntry(); });
  el('fitnessLogNowBtn').addEventListener('click', ()=>{ el('wlWeight').focus(); });

  // collapse state for each month group in the weight log — not persisted; all months
  // collapsed by default except the most recent one, to avoid a wall of rows once the
  // log has built up history.
  const weightLogGroupCollapsed = {};
  function renderWeightLog(){
    const log = (state.fitness.weightLog||[]).slice().sort((a,b)=> b.date.localeCompare(a.date));
    const listEl = el('weightLogList');
    el('weightLogEmpty').style.display = log.length===0 ? 'block':'none';
    listEl.style.display = log.length===0 ? 'none':'block';
    listEl.innerHTML = '';
    if(!log.length) return;

    // group entries by "YYYY-MM"
    const groups = [];
    const groupMap = {};
    log.forEach(entry=>{
      const key = entry.date.slice(0,7);
      if(!groupMap[key]){ groupMap[key] = { key, label: new Date(entry.date+'T00:00:00').toLocaleDateString(undefined,{month:'long',year:'numeric'}), entries: [] }; groups.push(groupMap[key]); }
      groupMap[key].entries.push(entry);
    });

    groups.forEach((grp, gi) => {
      if(!(grp.key in weightLogGroupCollapsed)) weightLogGroupCollapsed[grp.key] = gi !== 0; // only newest month open by default
      const collapsed = weightLogGroupCollapsed[grp.key];

      const header = document.createElement('div');
      header.className = 'weight-log-group-header';
      header.innerHTML = '<span class="wlg-chevron">'+(collapsed?'▶':'▼')+'</span><span class="wlg-label">'+escapeHtml(grp.label)+'</span><span class="wlg-count">'+grp.entries.length+' '+(grp.entries.length===1?'entry':'entries')+'</span>';
      header.addEventListener('click', ()=>{ weightLogGroupCollapsed[grp.key] = !weightLogGroupCollapsed[grp.key]; renderWeightLog(); });
      listEl.appendChild(header);

      if(collapsed) return;
      grp.entries.forEach((entry, idx)=>{
        // show change vs the previous (older) logged entry for quick context, without cluttering the row
        const olderVal = grp.entries[idx+1] ? grp.entries[idx+1].kg
          : (log[log.indexOf(entry)+1] ? log[log.indexOf(entry)+1].kg : null);
        let deltaHtml = '';
        if(olderVal != null){
          const deltaKg = entry.kg - olderVal;
          const deltaDisp = roundDisp(kgToDisplay(deltaKg));
          if(Math.abs(deltaDisp) >= 0.1){
            deltaHtml = '<span class="wl-delta '+(deltaKg<0?'down':'up')+'">'+(deltaKg>0?'+':'')+deltaDisp+'</span>';
          }
        }
        const row = document.createElement('div'); row.className='weight-log-item';
        row.innerHTML = '<span class="wl-date">'+escapeHtml(fmtDate(new Date(entry.date+'T00:00:00').getTime()))+'</span>'
          + '<span class="wl-weight">'+roundDisp(kgToDisplay(entry.kg))+' '+unitLabel()+'</span>'
          + deltaHtml
          + '<button class="wl-del">✕</button>';
        row.querySelector('.wl-del').addEventListener('click', ()=>{
          state.fitness.weightLog = state.fitness.weightLog.filter(e=>e.date!==entry.date);
          syncCurrentWeightFromLog();
          save(); renderFitness();
        });
        listEl.appendChild(row);
      });
    });
  }

  function updateFitnessReminder(){
    const todayStr = localDateStr(new Date());
    const loggedToday = (state.fitness.weightLog||[]).some(e=>e.date===todayStr);
    el('fitnessLogBanner').style.display = loggedToday ? 'none' : 'flex';
    el('fitnessLogBadge').style.display = loggedToday ? 'none' : 'inline-flex';
  }

  /* ---- weight trend chart: line + moving average, zoomable to a chosen time range ---- */
  const WEIGHT_CHART_ZOOMS = [
    {key:'1m', label:'1M', months:1},
    {key:'3m', label:'3M', months:3},
    {key:'6m', label:'6M', months:6},
    {key:'1y', label:'1Y', months:12},
    {key:'all', label:'All', months:null}
  ];
  let weightChartZoom = '1y'; // not persisted — resets to a sensible default each page load
  // background bands showing BMI territory (underweight/normal/overweight/obese) translated into
  // actual weight values for this person's height, so the chart visually shows which zone their
  // weight sits in over time. Skipped entirely if height hasn't been entered yet.
  function bmiBandsSvg(minV, maxV, yOf, W, padL, padR){
    const heightCm = parseFloat(state.fitness.height);
    if(!heightCm || heightCm<=0) return '';
    const hM = heightCm/100;
    const thresholdsDisp = [18.5,25,30].map(bmi => kgToDisplay(bmi*hM*hM));
    const bounds = [-Infinity, thresholdsDisp[0], thresholdsDisp[1], thresholdsDisp[2], Infinity];
    const bandColors = ['rgba(245,165,36,0.15)','rgba(22,163,74,0.14)','rgba(245,165,36,0.22)','rgba(239,68,68,0.15)'];
    let svg = '';
    for(let i=0;i<4;i++){
      const lo = Math.max(bounds[i], minV), hi = Math.min(bounds[i+1], maxV);
      if(hi <= lo) continue;
      const yTop = yOf(hi), yBot = yOf(lo);
      svg += '<rect x="'+padL+'" y="'+yTop.toFixed(1)+'" width="'+(W-padL-padR)+'" height="'+(yBot-yTop).toFixed(1)+'" fill="'+bandColors[i]+'"/>';
    }
    return svg;
  }

  function renderWeightChart(){
    const zoomRow = el('weightChartZoomRow');
    zoomRow.innerHTML = WEIGHT_CHART_ZOOMS.map(z=>
      '<button class="chart-zoom-btn'+(weightChartZoom===z.key?' active':'')+'" data-zoom="'+z.key+'">'+z.label+'</button>'
    ).join('');
    zoomRow.querySelectorAll('.chart-zoom-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        weightChartZoom = btn.dataset.zoom;
        renderWeightChart();
      });
    });

    const wrap = el('weightChartWrap');
    const log = (state.fitness.weightLog||[]).slice().sort((a,b)=> a.date.localeCompare(b.date));
    if(log.length < 2){
      wrap.innerHTML = '<div class="empty" style="border:none;padding:28px 10px;">Log at least two days of weight to see your trend chart.</div>';
      return;
    }
    const zoomOpt = WEIGHT_CHART_ZOOMS.find(z=>z.key===weightChartZoom) || WEIGHT_CHART_ZOOMS[3];
    let points = log;
    if(zoomOpt.months != null){
      const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - zoomOpt.months);
      const cutoffStr = localDateStr(cutoff);
      points = log.filter(e=>e.date >= cutoffStr);
    }
    if(points.length < 2){
      wrap.innerHTML = '<div class="empty" style="border:none;padding:28px 10px;">No entries in this time range — try a wider zoom.</div>';
      return;
    }
    const W = 780, H = 240, padL = 44, padR = 14, padT = 14, padB = 26;
    const vals = points.map(p=>kgToDisplay(p.kg));
    let minV = Math.min(...vals), maxV = Math.max(...vals);
    if(minV === maxV){ minV -= 1; maxV += 1; }
    const pad = (maxV-minV)*0.12; minV -= pad; maxV += pad;
    const t0 = new Date(points[0].date).getTime(), t1 = new Date(points[points.length-1].date).getTime();
    const tSpan = Math.max(1, t1-t0);
    const xOf = d => padL + ((new Date(d).getTime()-t0)/tSpan) * (W-padL-padR);
    const yOf = v => padT + (1-(v-minV)/(maxV-minV)) * (H-padT-padB);

    // moving average: window of up to 5 surrounding entries (or fewer if near the edges)
    const windowSize = 5;
    const maVals = vals.map((_,i)=>{
      const start = Math.max(0, i-Math.floor(windowSize/2));
      const end = Math.min(vals.length, i+Math.ceil(windowSize/2));
      const slice = vals.slice(start,end);
      return slice.reduce((a,b)=>a+b,0)/slice.length;
    });

    const linePath = points.map((p,i)=> (i===0?'M':'L') + xOf(p.date).toFixed(1) + ',' + yOf(vals[i]).toFixed(1)).join(' ');
    const maPath = points.map((p,i)=> (i===0?'M':'L') + xOf(p.date).toFixed(1) + ',' + yOf(maVals[i]).toFixed(1)).join(' ');

    // gridlines + y-axis labels (4 bands)
    let gridSvg = '';
    const steps = 4;
    for(let i=0;i<=steps;i++){
      const v = minV + (maxV-minV)*(i/steps);
      const y = yOf(v);
      gridSvg += '<line x1="'+padL+'" y1="'+y.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+y.toFixed(1)+'" stroke="var(--border)" stroke-width="1"/>';
      gridSvg += '<text x="'+(padL-8)+'" y="'+(y+3).toFixed(1)+'" font-size="10" fill="var(--muted)" text-anchor="end">'+roundDisp(v)+'</text>';
    }
    // x-axis labels: first, middle, last date
    const labelIdxs = [0, Math.floor((points.length-1)/2), points.length-1];
    let xLabelSvg = '';
    labelIdxs.forEach(i=>{
      const p = points[i];
      xLabelSvg += '<text x="'+xOf(p.date).toFixed(1)+'" y="'+(H-6)+'" font-size="10" fill="var(--muted)" text-anchor="middle">'+fmtDate(new Date(p.date).getTime())+'</text>';
    });

    const dotsSvg = points.map((p,i)=> '<circle cx="'+xOf(p.date).toFixed(1)+'" cy="'+yOf(vals[i]).toFixed(1)+'" r="2.5" fill="var(--violet)"></circle>').join('');
    const bandsSvg = bmiBandsSvg(minV, maxV, yOf, W, padL, padR);

    wrap.innerHTML = '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto;display:block;">'
      + bandsSvg + gridSvg + xLabelSvg
      + '<path d="'+linePath+'" fill="none" stroke="var(--violet)" stroke-width="2"/>'
      + dotsSvg
      + '<path d="'+maPath+'" fill="none" stroke="var(--gold)" stroke-width="2.5" stroke-dasharray="6,4"/>'
      + '</svg>'
      + (bandsSvg ? '<div style="font-size:10.5px;color:var(--muted);text-align:center;margin-top:6px;">Shaded bands show BMI zones for your height — <span style="color:#16A34A;font-weight:700;">green = normal weight</span>, amber = under/overweight, red = obese.</div>' : '');
  }

