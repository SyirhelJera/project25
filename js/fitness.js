  /* ================= FITNESS ================= */
  const KG_PER_LB = 0.45359237;
  // fitness.currentWeight / targetWeight / weightLog entries are always stored internally in kg;
  // the unit toggle only changes how values are displayed and entered.
  function kgToDisplay(kg){ return state.fitness.unit === 'lb' ? kg / KG_PER_LB : kg; }
  function displayToKg(v){ return state.fitness.unit === 'lb' ? v * KG_PER_LB : v; }
  function unitLabel(){ return state.fitness.unit === 'lb' ? 'lb' : 'kg'; }
  /* Two rounders, split by what the number *is*.

     roundWeight() is for a reading — a weigh-in, a target, or the difference between two of them.
     Scales report two decimals and people enter what the scale said, so one decimal is not a
     display choice here but data loss: the fields are pre-filled from state, so showing 73.65 as
     73.7 meant the next save wrote 73.7 back and the real figure was gone.

     roundDisp() stays one decimal for derived summaries and axis labels — a gridline at 72.42 or a
     headline reading "1.24 kg to go on the 5-day avg" is false precision about a smoothed number,
     and the axis has four labels competing for a phone's width. */
  function roundWeight(v){ return Math.round(v*100)/100; }
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

  /* The weigh-in the latest one is judged against, and the difference between them — one helper
     because the profile card's arrow and the Fitness hero's trend chip are the same statement in
     two places, and two copies of this walk would eventually disagree about which reading "since"
     names. What it compares against is Settings -> Trend Comparison: with a window, the newest
     weigh-in on or before it (or the oldest, if none reaches back that far); without one, simply
     the entry before the latest. Returns null when there is nothing to compare. */
  function fitnessTrendDelta(){
    const log = (state.fitness.weightLog||[]).slice().sort((a,b)=> a.date.localeCompare(b.date));
    const latest = log[log.length-1];
    if(!latest) return null;
    const cutoff = trendCutoffKey();
    let prev = null;
    if(cutoff){
      for(let i=log.length-1; i>=0; i--){ if(log[i].date <= cutoff){ prev = log[i]; break; } }
      if(!prev && log.length > 1) prev = log[0];
      if(prev === latest) prev = null; // nothing newer than the window: no change to report
    } else {
      prev = log[log.length-2];
    }
    if(!prev) return null;
    return { latest, prev, deltaDisp: roundWeight(kgToDisplay(latest.kg - prev.kg)) };
  }

  // Fitness Level shown on the profile card, plus a weight-direction arrow beside it: losing
  // weight reads as a green ▼ and gaining as a red ▲, regardless of which BMI tier you're in.
  function updateFitnessLevelUI(){
    const lvlEl = el('pfFitnessLevel');
    if(!lvlEl) return;
    const tier = getFitnessTier();
    lvlEl.textContent = tier ? tier.label : '—';
    lvlEl.style.color = tier ? tier.color : '';

    const trendEl = el('pfFitnessTrend');
    if(trendEl){
      // Same 0.1-display-unit threshold the per-entry deltas in the weight log use, so tiny scale
      // noise doesn't show an arrow.
      const t = fitnessTrendDelta();
      const deltaDisp = t ? t.deltaDisp : 0;
      trendEl.innerHTML = Math.abs(deltaDisp) >= 0.1
        ? trendMarker(deltaDisp > 0 ? 1 : -1, deltaDisp < 0,
            (deltaDisp > 0 ? 'Gained ' : 'Lost ') + Math.abs(deltaDisp) + ' ' + unitLabel()
            + ' since ' + fmtDate(parseLocalDateStr(t.prev.date)))
        : '';
    }
    // after the trend, not before: the Goals board mirrors both the tier and its arrow on phones,
    // where the profile card is hidden, and syncing first would copy last update's arrow
    if(typeof syncBoardStats === 'function') syncBoardStats();
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
  // Chest-pin color by XP level tier — the bronze/silver/gold/platinum/diamond progression whose
  // thresholds and colors levelTier() in goals.js owns (the level-up popup names the same tier),
  // so this is only the lookup.
  function avatarLevelColor(level){ return levelTier(level).color; }
  // Outfit color (and a crown at the top tier) by net worth — richer colors as net worth climbs.
  function avatarWorthTier(nw){
    if(nw >= 1000000) return { color:'#A855F7', crown:true };
    if(nw >= 100000) return { color:'#F5A524', crown:false };
    if(nw >= 10000) return { color:'#818CF8', crown:false };
    if(nw >= 1000) return { color:'#60A5FA', crown:false };
    return { color:'#94A3B8', crown:false };
  }

  // Player-card avatar: a hand-drawn SVG character (no external images/fonts) whose hair/build
  // reflects age, chest pin reflects level tier, and outfit color (plus a crown at the top
  // tier) reflects net worth — all redrawn from current state.
  function updateAvatar(){
    const ringEl = el('pfAvatarRing'), svg = el('pfAvatarSvg');
    if(!ringEl || !svg) return;

    const blockEl = el('pfAvatarBlock');
    if(blockEl) blockEl.style.display = state.profile.hideAvatar ? 'none' : '';

    const fitTier = getFitnessTier();

    const ap = avatarAgeProfile(parseFloat(state.profile.age));
    const { level } = currentLevelInfo();  // the shown level, Mythical bonus included
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

  /* The BMR -> TDEE -> daily-target ladder, lifted out of calcFitness() so the Calorie Budget
     Check further down compares against exactly the figures this card shows rather than
     re-deriving them: two answers to "what is my daily target" that differ by a rounding step
     read as a bug, and one of them would eventually drift. */
  const KCAL_PER_KG = 7700;                     // ~kcal stored in a kilo of body weight
  function fitnessBmr(){
    const f = state.fitness;
    const cw = parseFloat(f.currentWeight), h = parseFloat(f.height), age = parseFloat(f.age);
    if(isNaN(cw) || isNaN(h) || isNaN(age)) return null;
    // Mifflin-St Jeor BMR formula
    return f.sex==='female' ? (10*cw + 6.25*h - 5*age - 161) : (10*cw + 6.25*h - 5*age + 5);
  }
  function fitnessTdee(){
    const bmr = fitnessBmr();
    return bmr==null ? null : bmr * (parseFloat(state.fitness.activity)||1.55);
  }
  // Signed kg/week the plan asks for: negative when the target sits below current weight, positive
  // above it, 0 when no target is set — so callers can read the sign as "which way am I meant to
  // be going" without re-inspecting the weights themselves.
  function fitnessPaceWeekly(){
    const f = state.fitness;
    const cw = parseFloat(f.currentWeight), tw = parseFloat(f.targetWeight);
    if(isNaN(cw) || isNaN(tw) || tw === cw) return 0;
    return (tw < cw ? -1 : 1) * (parseFloat(f.pace)||0.5);
  }
  function fitnessCalorieTarget(){
    const tdee = fitnessTdee();
    return tdee==null ? null : tdee + (fitnessPaceWeekly() * KCAL_PER_KG) / 7;
  }

  function calcFitness(){
    const f = state.fitness;
    const cw = parseFloat(f.currentWeight), tw = parseFloat(f.targetWeight), h = parseFloat(f.height);
    const pace = parseFloat(f.pace)||0.5;
    // the note now lives INSIDE the primary result card, which is the thing it qualifies — so the
    // standalone copy below the block is what carries it in the state where there is no card yet,
    // and exactly one of the two is ever showing
    const resultsEl = el('fitnessResults'), noteEl = el('fitnessNote'), emptyNoteEl = el('fitnessNoteEmpty');
    updateFitnessLevelUI();
    renderFitnessHero();
    const bmr = fitnessBmr();
    if(bmr==null){
      resultsEl.style.display='none';
      emptyNoteEl.style.display='';
      return;
    }
    emptyNoteEl.style.display='none';
    const tdee = fitnessTdee(), target = fitnessCalorieTarget();
    let note = 'Enter a target weight above to get a daily calorie target for reaching it.';
    if(!isNaN(tw) && tw !== cw){
      const dailyDelta = (pace * KCAL_PER_KG) / 7;
      const weeks = Math.ceil(Math.abs(tw - cw) / pace);
      el('fitWeeks').textContent = weeks;
      note = (tw < cw ? 'A daily deficit of ' : 'A daily surplus of ') + Math.round(dailyDelta) + ' kcal gets you to ' + roundWeight(kgToDisplay(tw)) + unitLabel() + ' in about ' + weeks + ' week' + (weeks===1?'':'s') + ', at ' + pace + 'kg/week.';
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

  /* ---- the hero -----------------------------------------------------------------------------
     The first card of the Weight pane: today's reading, what qualifies it, and how far along the
     goal it sits. Every figure comes from a helper that already owns it — getFitnessTier() for the
     band, fitnessTrendDelta() for the arrow — rather than being re-derived here, the same rule the
     Insights tab follows, so the hero and the profile card can never disagree about the same
     number.

     The rail is drawn from the FIRST weigh-in to the target, not from some notion of a starting
     weight typed once: the log is the only record of where this began, and a rail anchored to an
     editable field would move its own start line every time the calculator was touched. It is
     skipped entirely when the two ends coincide (or either is missing) — a rail with no length
     reads as a broken control, and the sentence that replaces it says what to do instead. */
  function renderFitnessHero(){
    const valEl = el('fitHeroVal'); if(!valEl) return;
    const asEl = el('fitHeroAs'), chipsEl = el('fitHeroChips'), railEl = el('fitHeroRail');
    const u = unitLabel();
    const log = (state.fitness.weightLog||[]).slice().sort((a,b)=> a.date.localeCompare(b.date));
    const latest = log[log.length-1] || null;
    // the log first, the calculator field second: syncCurrentWeightFromLog() keeps them equal, but
    // the field is what exists before anything has ever been weighed in
    const curKg = latest ? latest.kg : parseFloat(state.fitness.currentWeight);
    const haveCur = curKg != null && !isNaN(curKg) && curKg > 0;

    valEl.innerHTML = haveCur
      ? escapeHtml(String(roundWeight(kgToDisplay(curKg)))) + '<span class="fit-hero-unit">' + escapeHtml(u) + '</span>'
      // a 40px em dash in the reading's own colour reads as a drawn bar rather than as a blank;
      // it is a placeholder standing beside a sentence that explains itself, so it recedes
      : '<span class="fit-hero-none">—</span>';

    const todayStr = localDateStr(new Date());
    asEl.textContent = !latest ? 'Nothing weighed in yet — the box below starts the log.'
      : latest.date === todayStr ? 'Weighed in today'
      : 'Last weighed in ' + fmtDate(parseLocalDateStr(latest.date).getTime());

    /* Two chips at most, and each only when it is true of something: the BMI band, and the change
       since Settings -> Trend Comparison. The arrow reports which way the weight went and the
       colour reports whether that was TOWARD the target — cutting and bulking are both progress,
       so a green ↓ would be wrong half the time — and the chip repeats both in words, so neither
       channel is carried by colour alone. */
    const chips = [];
    const tier = getFitnessTier();
    // the band's own colour rides on the dot, not on the word: getFitnessTier() hands back the raw
    // --gold/--success/--danger hues, which sit near 3:1 on a pale card — fine for a mark, short of
    // AA for a 12.5px label. The label is the second channel, so the meaning survives greyscale.
    if(tier) chips.push('<span class="fit-chip fit-chip-tier">'
      + '<span class="fit-chip-dot" style="background:' + tier.color + '"></span>'
      + escapeHtml(tier.label) + '</span>');
    const t = fitnessTrendDelta();
    if(t && Math.abs(t.deltaDisp) >= 0.1){
      const targetKg = parseFloat(state.fitness.targetWeight);
      let tone = 'neutral';
      if(!isNaN(targetKg) && targetKg > 0){
        tone = Math.abs(t.latest.kg - targetKg) < Math.abs(t.prev.kg - targetKg) ? 'good' : 'bad';
      }
      chips.push('<span class="fit-chip fit-chip-' + tone + '">'
        + (t.deltaDisp > 0 ? '↑' : '↓') + ' ' + escapeHtml(Math.abs(t.deltaDisp) + ' ' + u)
        + '<span class="fit-chip-since">since ' + escapeHtml(fmtDate(parseLocalDateStr(t.prev.date).getTime())) + '</span>'
        + '</span>');
    }
    chipsEl.innerHTML = chips.join('');

    const targetKg = parseFloat(state.fitness.targetWeight);
    const startKg = log.length ? log[0].kg : NaN;
    const canRail = haveCur && !isNaN(targetKg) && targetKg > 0 && !isNaN(startKg)
      && Math.abs(targetKg - startKg) > 0.05;
    if(!canRail){
      railEl.innerHTML = '<p class="fit-rail-none">'
        + (isNaN(targetKg) || targetKg <= 0
            ? 'Set a target weight under <b>Calories</b> to track how far along you are.'
            : escapeHtml('Target ' + roundWeight(kgToDisplay(targetKg)) + ' ' + u
              + (haveCur ? ' · ' + roundDisp(Math.abs(kgToDisplay(curKg - targetKg))) + ' ' + u + ' to go' : '')))
        + '</p>';
      return;
    }
    const frac = Math.min(1, Math.max(0, (curKg - startKg) / (targetKg - startKg)));
    const pct = Math.round(frac * 100);
    const gap = Math.abs(kgToDisplay(curKg - targetKg));
    const done = gap < 0.05;
    const gapTxt = done ? 'Target reached' : roundDisp(gap) + ' ' + u + ' to go';
    railEl.innerHTML =
      '<div class="fit-rail-track' + (done ? ' done' : '') + '" role="progressbar" aria-valuemin="0" aria-valuemax="100"'
      + ' aria-valuenow="' + pct + '" aria-label="Progress toward target weight"'
      + ' aria-valuetext="' + escapeHtml(pct + '% of the way — ' + gapTxt) + '">'
      + '<span class="fit-rail-fill" style="width:' + pct + '%"></span>'
      + '<span class="fit-rail-dot" style="left:' + pct + '%"></span>'
      + '</div>'
      + '<div class="fit-rail-ends">'
      +   '<span class="fit-rail-end">' + escapeHtml(roundDisp(kgToDisplay(startKg)) + ' ' + u) + '<i>start</i></span>'
      +   '<span class="fit-rail-gap' + (done ? ' done' : '') + '">' + escapeHtml(gapTxt) + '</span>'
      +   '<span class="fit-rail-end to">' + escapeHtml(roundDisp(kgToDisplay(targetKg)) + ' ' + u) + '<i>target</i></span>'
      + '</div>';
  }

  function renderFitness(){
    const f = state.fitness;
    updateUnitLabels();
    el('fitCurrent').value = f.currentWeight ? roundWeight(kgToDisplay(parseFloat(f.currentWeight))) : '';
    el('fitTarget').value = f.targetWeight ? roundWeight(kgToDisplay(parseFloat(f.targetWeight))) : '';
    el('fitHeight').value = f.height || '';
    el('fitAge').value = f.age || '';
    el('fitSex').value = f.sex || 'male';
    el('fitActivity').value = f.activity || '1.55';
    el('fitPace').value = f.pace || '0.5';
    el('wlKcalDay').value = String(kcalOffset());
    updateLogHint();
    calcFitness();
    renderWeightCalendar();
    renderWeightChart();
    renderCalorieReview();
    renderComparePhotos();
    renderSleep();
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
  /* ---- calorie intake ----
     Calories live in their own dated log rather than as a field on the weigh-in, because the two
     readings that belong together are taken on *different* days: you weigh in on the morning after
     the day you ate. So one row records both, and the kcal box attributes to the day before the
     weigh-in by default (state.fitness.kcalOffset — switchable for anyone who logs food at night
     instead). Either half of the row is a complete entry on its own. */
  function calorieLog(){
    if(!state.fitness.calorieLog) state.fitness.calorieLog = [];
    return state.fitness.calorieLog;
  }
  function kcalOffset(){ return state.fitness.kcalOffset === 0 ? 0 : 1; }
  // date arithmetic through Date rather than ms maths: adding 86400000 to a local midnight lands
  // on 23:00 or 01:00 across a DST boundary, which reads back as the wrong day key
  function shiftDateStr(dateStr, days){
    const d = parseLocalDateStr(dateStr); d.setDate(d.getDate()+days); return localDateStr(d);
  }
  function daysBetween(a, b){ return Math.round((parseLocalDateStr(b) - parseLocalDateStr(a)) / 86400000); }
  function kcalOn(dateStr){ const e = calorieLog().find(x=>x.date===dateStr); return e ? e.kcal : null; }
  function upsertCalorieLog(dateStr, kcal){
    const log = calorieLog();
    const existing = log.find(e=>e.date===dateStr);
    if(existing) existing.kcal = kcal;
    else log.push({date:dateStr, kcal});
  }
  // The offset is the one part of this row that isn't visible in the fields themselves, so the
  // hint states both dates outright instead of leaving "yesterday" to be worked out.
  function updateLogHint(){
    const hintEl = el('wlAddHint'); if(!hintEl) return;
    const wDate = localDateStr(new Date());
    const kDate = shiftDateStr(wDate, -kcalOffset());
    hintEl.innerHTML = 'Weight lands on <b>' + escapeHtml(fmtDate(parseLocalDateStr(wDate).getTime()))
      + '</b> · calories land on <b>' + escapeHtml(fmtDate(parseLocalDateStr(kDate).getTime())) + '</b>';
  }

  function addWeightLogEntry(){
    // today, always — a past date is corrected on the calendar, where you can see what is missing
    const dateStr = localDateStr(new Date());
    const v = parseFloat(el('wlWeight').value);
    const kc = parseFloat(el('wlKcal').value);
    const hasWeight = !isNaN(v) && v > 0, hasKcal = !isNaN(kc) && kc >= 0;
    if(!hasWeight && !hasKcal) return;
    if(hasWeight) upsertWeightLog(dateStr, displayToKg(v));
    if(hasKcal) upsertCalorieLog(shiftDateStr(dateStr, -kcalOffset()), Math.round(kc));
    el('wlWeight').value = '';
    el('wlKcal').value = '';
    // This row writes to today, and today may be the very day open in the calendar editor below —
    // which does not rebuild unless the day or the unit changed, so its fields and note would go
    // on showing what they held before this entry. Every other write path resets this for the same
    // reason; the date picker used to make the collision unlikely, and now it is the common case.
    weightCalEditorFor = null;
    save(); renderFitness();
  }
  el('wlAddBtn').addEventListener('click', addWeightLogEntry);
  el('wlWeight').addEventListener('keydown', e=>{ if(e.key==='Enter') addWeightLogEntry(); });
  el('wlKcal').addEventListener('keydown', e=>{ if(e.key==='Enter') addWeightLogEntry(); });
  el('wlKcalDay').addEventListener('change', ()=>{
    state.fitness.kcalOffset = Number(el('wlKcalDay').value) === 0 ? 0 : 1;
    save(); updateLogHint();
  });
  // whichever half of today's entry is still missing is the one the banner is nagging about
  el('fitnessLogNowBtn').addEventListener('click', ()=>{
    // the banner sits above the strip and can be clicked from any pane, and a display:none input
    // cannot take focus — so reveal the pane the fields live in first
    showFitnessSubTab('weight');
    const loggedToday = (state.fitness.weightLog||[]).some(e=>e.date===localDateStr(new Date()));
    el(loggedToday ? 'wlKcal' : 'wlWeight').focus();
  });

  /* ---- activities -------------------------------------------------------------------------
     What you did on a day and roughly what it cost, recorded per day and any number per day, so
     they are a flat dated array like the two logs rather than a field on either.

     **This burn is displayed, never added to anything.** The Budget Check's maintenance figure is
     measured from intake against the scale, so it already contains every calorie you burned that
     week whether or not you logged the walk — adding logged exercise on top would count it twice,
     and the formula's TDEE double-counts it a third time through its activity multiplier. The
     honest role of this data is context: why one week's deficit ran deeper than the budget said.

     METs are the standard multiples of resting metabolic rate; kcal/min = MET x 3.5 x kg / 200,
     which is MET x kg x hours. It is an estimate and is offered as a *placeholder* rather than
     written into the field, so a figure from a watch always wins and nothing is ever overwritten
     under the caret. */
  const FITNESS_ACTIVITIES = [
    {key:'walk',  name:'Walk',           met:3.5, emoji:'🚶'},
    {key:'brisk', name:'Brisk walk',     met:4.8, emoji:'👟'},
    {key:'run',   name:'Run',            met:9.8, emoji:'🏃'},
    {key:'rope',  name:'Jump rope',      met:11.8, emoji:'🪢'},
    {key:'cycle', name:'Cycle',          met:7.5, emoji:'🚴'},
    {key:'swim',  name:'Swim',           met:7.0, emoji:'🏊'},
    {key:'gym',   name:'Gym / weights',  met:5.0, emoji:'🏋️'},
    {key:'sport', name:'Sports',         met:7.0, emoji:'⚽'},
    {key:'hike',  name:'Hike',           met:6.0, emoji:'🥾'},
    {key:'yoga',  name:'Yoga / stretch', met:3.0, emoji:'🧘'},
    {key:'other', name:'Other',          met:4.0, emoji:'⚡'}
  ];
  // Looked up from the stored name on read rather than saved onto the record — the same
  // never-goes-stale trick as noteTags() and scratchPageTitle(): re-labelling a type here relabels
  // every day that ever used it, and a record written before this existed still gets a mark.
  function activityEmoji(name){
    const hit = FITNESS_ACTIVITIES.find(a=>a.name===name);
    return hit ? hit.emoji : '⚡';
  }
  // The day's headline activity is the one that cost the most — a 10-minute stretch after an hour's
  // run shouldn't be what the grid shows. Ties keep the earlier entry, so the mark is stable.
  function topActivityOn(dateStr){
    const list = activitiesOn(dateStr);
    if(!list.length) return null;
    return list.reduce((best,a)=> (a.kcal||0) > (best.kcal||0) ? a : best);
  }
  function activityLog(){
    if(!state.fitness.activityLog) state.fitness.activityLog = [];
    return state.fitness.activityLog;
  }
  function activitiesOn(dateStr){ return activityLog().filter(a=>a.date===dateStr); }
  function activityBurnOn(dateStr){ return activitiesOn(dateStr).reduce((sum,a)=> sum + (a.kcal||0), 0); }
  // the weigh-in from that day when there is one, so backfilling last month uses last month's
  // weight rather than today's — falling back to current weight, and to nothing at all if neither
  function activityWeightKg(dateStr){
    const rec = (state.fitness.weightLog||[]).find(e=>e.date===dateStr);
    if(rec) return rec.kg;
    const cw = parseFloat(state.fitness.currentWeight);
    return isNaN(cw) ? null : cw;
  }
  function estimateActivityKcal(met, mins, dateStr){
    const kg = activityWeightKg(dateStr);
    if(kg == null || !mins || isNaN(mins) || mins <= 0) return null;
    return Math.round(met * kg * (mins/60));
  }

  /* ---- the three panes ----------------------------------------------------------------------
     Weight (the trend, the entry row and the calendar), Photos, and Calories. Three views of one
     concern rather than three separate things, so the choice is NOT persisted and resets to Weight
     on entry — the Time tab's rule, not the Games tab's. You open this tab to see the trend, and
     landing on whichever pane you happened to leave last would bury it. */
  const FITNESS_SUBTABS = ['weight','photos','calories','sleep'];
  let fitnessSubTab = 'weight';
  function showFitnessSubTab(key){
    if(FITNESS_SUBTABS.indexOf(key) < 0) key = 'weight';
    fitnessSubTab = key;
    document.querySelectorAll('#view-fitness .finance-subnav-btn').forEach(b=>{
      b.classList.toggle('active', b.dataset.fittab === key);
    });
    document.querySelectorAll('#view-fitness .fittab').forEach(t=>{
      t.style.display = (t.id === 'fittab-'+key) ? '' : 'none';
    });
    /* A chart drawn while its pane was display:none measured a zero-width wrapper and fell back to
       the 780-unit default, which renders desktop-scaled type on a phone. Redraw whichever pane
       just became visible now that it has a real width. The observers below would get there
       eventually, but only once something else changed size — this makes it immediate. */
    if(key === 'weight') renderWeightChart();
    if(key === 'calories') renderCalorieReview();
    if(key === 'sleep'){ renderSleepReview(); renderCircadianRhythm(); }
    // and the battery's minute timer follows the pane either way — leaving this pane has to stop it
    // as surely as entering starts it. (Leaving the whole TAB is caught one tick later, by the
    // ticker's own visibility test; a minute of a hidden redraw is not worth a hook in nav.js.)
    syncSleepBatteryTicker();
  }
  el('fitnessSubnav').addEventListener('click', e=>{
    const btn = e.target.closest('[data-fittab]');
    if(btn) showFitnessSubTab(btn.dataset.fittab);
  });

  /* ---- measurement conditions ---------------------------------------------------------------
     A weigh-in is only comparable to the one before it if it was taken the same way, and the three
     things that move the number most overnight are food the evening before, food that morning, and
     water drunk before stepping on. Ticking all three marks the day's reading as taken under the
     same protocol as every other ticked day — a green ✓ on the calendar — so a jump can be read as
     a real change rather than as a measurement artefact.

     Only the ticked keys are stored, which is what keeps a day with nothing ticked absent from the
     array entirely, and means adding a fourth condition later leaves old days honestly short of it
     rather than retroactively declaring them controlled. */
  const WEIGH_CHECKS = [
    {key:'noLate',  label:'No eating after 7 PM'},
    {key:'fasted',  label:'Ate only after 8 AM'},
    {key:'noWater', label:'No water before weighing'},
    {key:'noHeavy', label:'No heavy clothes'}
  ];
  function measureLog(){
    if(!state.fitness.measureLog) state.fitness.measureLog = [];
    return state.fitness.measureLog;
  }
  function measureChecks(dateStr){
    const rec = measureLog().find(e=>e.date===dateStr);
    return (rec && rec.checks) || [];
  }
  function isControlledDay(dateStr){
    const on = measureChecks(dateStr);
    return WEIGH_CHECKS.every(c=> on.indexOf(c.key) >= 0);
  }
  function toggleMeasureCheck(dateStr, key){
    const log = measureLog();
    let rec = log.find(e=>e.date===dateStr);
    if(!rec){ rec = { date:dateStr, checks:[] }; log.push(rec); }
    const i = rec.checks.indexOf(key);
    if(i >= 0) rec.checks.splice(i,1); else rec.checks.push(key);
    // an emptied record is dead weight in a row that is re-uploaded whole on every save
    if(!rec.checks.length) state.fitness.measureLog = log.filter(e=> e !== rec);
  }

  /* ---- the log as a month calendar -------------------------------------------------------
     A list answered "what have I logged"; a calendar answers "which days am I missing", and that
     is the question this tab actually raises — every figure in the Budget Check below depends on
     coverage, and its two gates are literally counts of logged days. A gap is invisible in a list
     (rows simply sit next to each other) and obvious in a grid.

     Two module-level bits of view state, neither persisted — same rule as the chart zooms: the
     month on show, and the day whose editor is open. `weightCalEditorFor` is what stops a re-render
     rebuilding the editor under your caret; only a change of day, or a save, is allowed to. */
  let weightCalMonth = '';        // 'YYYY-MM'
  let weightCalSelected = '';     // 'YYYY-MM-DD', '' when the editor is closed
  let weightCalEditorFor = null;

  function weightCalMonthKey(){ return weightCalMonth || localDateStr(new Date()).slice(0,7); }
  function shiftWeightCalMonth(delta){
    const [y,m] = weightCalMonthKey().split('-').map(Number);
    // through Date rather than arithmetic on the month number, so December rolls the year
    weightCalMonth = localDateStr(new Date(y, m-1+delta, 1)).slice(0,7);
    renderWeightCalendar();
  }

  function renderWeightCalendar(){
    const wLog = state.fitness.weightLog || [], kLog = calorieLog();
    const todayStr = localDateStr(new Date());
    weightCalMonth = weightCalMonthKey();
    el('weightLogEmpty').style.display = (!wLog.length && !kLog.length) ? 'block' : 'none';

    // one record per day, merged from the two logs — they deliberately don't share dates
    const byDate = {};
    wLog.forEach(e=>{ (byDate[e.date] = byDate[e.date] || {}).kg = e.kg; });
    kLog.forEach(e=>{ (byDate[e.date] = byDate[e.date] || {}).kcal = e.kcal; });
    // deltas stay weigh-in to weigh-in and skip over calorie-only days rather than treating them
    // as a break in the chain
    const sortedW = wLog.slice().sort((a,b)=> b.date.localeCompare(a.date));
    const prevKg = {};
    sortedW.forEach((e,i)=>{ if(sortedW[i+1]) prevKg[e.date] = sortedW[i+1].kg; });

    const [y,m] = weightCalMonth.split('-').map(Number);
    const first = new Date(y, m-1, 1);
    el('wcalTitle').textContent = first.toLocaleDateString(undefined,{month:'long',year:'numeric'});
    el('wcalToday').style.display = weightCalMonth === todayStr.slice(0,7) ? 'none' : '';

    // Monday-first, matching habits.js and checklists.js — and the weekday names come from the
    // locale rather than a hardcoded list, since every other date on this page does
    el('wcalDow').innerHTML = [0,1,2,3,4,5,6].map(i=>
      '<span>'+escapeHtml(new Date(2024,0,1+i).toLocaleDateString(undefined,{weekday:'short'}))+'</span>').join('');

    const lead = (first.getDay()+6)%7;                 // Sunday is 0, so shift to a Monday start
    const daysInMonth = new Date(y, m, 0).getDate();   // day 0 of next month is the last of this
    const target = fitnessCalorieTarget();
    // which side of the budget counts as the miss follows the goal, exactly as on the chart
    const overIsMiss = fitnessPaceWeekly() <= 0;

    let html = '';
    for(let i=0;i<lead;i++) html += '<div class="wcal-cell empty"></div>';
    for(let d=1; d<=daysInMonth; d++){
      const ds = weightCalMonth + '-' + String(d).padStart(2,'0');
      const rec = byDate[ds] || {};
      const future = ds > todayStr;
      const burn = activityBurnOn(ds);
      const controlled = rec.kg != null && isControlledDay(ds);
      const has = rec.kg != null || rec.kcal != null || burn > 0 || measureChecks(ds).length > 0;
      let cls = 'wcal-cell';
      if(has) cls += ' has';
      /* An ideal-conditions day is tinted rather than badged: the point is to see at a glance which
         stretches of the month are comparable, and a glyph per cell reads one day at a time. The
         weight value is underlined in the same blue as a second, non-colour channel — the tint
         alone would vanish in greyscale and for a colour-blind reader. Only on a day that has a
         weigh-in: this qualifies a reading, and there is nothing to qualify without one. */
      if(controlled) cls += ' is-ideal';
      // The heaviest activity's own emoji in the corner, rather than a third line of figures:
      // seven columns on a 360px screen have no room for one, and this says what you did as well
      // as that you did something. aria-hidden because the cell's label already names them all
      // in words — a screen reader announcing "runner" adds nothing there.
      const top = burn > 0 ? topActivityOn(ds) : null;
      const actMark = top ? '<span class="wcal-act-mark" aria-hidden="true">'+activityEmoji(top.name)+'</span>' : '';
      if(ds === todayStr) cls += ' today';
      if(future) cls += ' future';
      if(ds === weightCalSelected) cls += ' sel';

      let wHtml = '';
      if(rec.kg != null){
        const older = prevKg[ds];
        const deltaDisp = older != null ? roundWeight(kgToDisplay(rec.kg - older)) : 0;
        const arrow = Math.abs(deltaDisp) >= 0.1
          ? '<i class="wcal-dt '+(deltaDisp < 0 ? 'down' : 'up')+'">'+(deltaDisp < 0 ? '▼' : '▲')+'</i>' : '';
        wHtml = '<span class="wcal-w">'+roundWeight(kgToDisplay(rec.kg))+arrow+'</span>';
      }
      let kHtml = '';
      if(rec.kcal != null){
        const miss = target != null && (overIsMiss ? rec.kcal > target : rec.kcal < target);
        kHtml = '<span class="wcal-k'+(miss ? ' miss' : '')+'">'+escapeHtml(Math.round(rec.kcal).toLocaleString())+'</span>';
      } else if(rec.kg != null && !future){
        // a day you weighed in on but never recorded food for is the gap the Budget Check trips
        // over, so it gets a mark of its own rather than blank space
        kHtml = '<span class="wcal-k none">–</span>';
      }

      const label = fmtDate(parseLocalDateStr(ds).getTime()) + ' · '
        + (rec.kg != null ? roundWeight(kgToDisplay(rec.kg))+' '+unitLabel() : 'no weigh-in') + ' · '
        + (rec.kcal != null ? Math.round(rec.kcal).toLocaleString()+' kcal' : 'no calories logged')
        + (burn > 0 ? ' · ' + activitiesOn(ds).map(a=>a.name).join(', ')
            + ', ' + burn.toLocaleString() + ' kcal burned' : '')
        + (controlled ? ' · controlled measurement' : '');
      html += '<button type="button" class="'+cls+'" data-day="'+ds+'"'
        + ' aria-pressed="'+(ds === weightCalSelected ? 'true' : 'false')+'"'
        + ' aria-label="'+escapeHtml(label)+'">'
        + '<span class="wcal-top"><span class="wcal-num">'+d+'</span>'
        +   '<span class="wcal-marks">' + actMark + '</span></span>'
        + wHtml + kHtml + '</button>';
    }
    // trail the last week out to seven, so the final row's cells keep the same width as the rest
    const trail = (7 - ((lead + daysInMonth) % 7)) % 7;
    for(let i=0;i<trail;i++) html += '<div class="wcal-cell empty"></div>';
    el('wcalGrid').innerHTML = html;

    const idealDays = (state.fitness.weightLog||[]).filter(e=>
      e.date.slice(0,7) === weightCalMonth && isControlledDay(e.date)).length;
    el('wcalLegend').innerHTML = idealDays
      ? '<span class="wcal-legend-key"></span>'
        + escapeHtml(idealDays + (idealDays === 1 ? ' day' : ' days')
          + ' weighed under ideal conditions — fasted, no water, light clothing, nothing after 7 PM')
      : '';

    renderWeightDayEditor();
  }

  /* The day editor is one panel under the grid rather than a popover: it has two number fields and
     two buttons, which is more than fits beside a 50px cell on a phone, and a popover would have to
     be positioned against a cell that moves when the month changes. Both fields write to the day
     you clicked — the add row's day-before offset is a property of the morning routine, not of a
     date you picked deliberately. */
  function renderWeightDayEditor(){
    const wrap = el('wcalEditor');
    if(!weightCalSelected){
      wrap.style.display = 'none'; wrap.innerHTML = ''; weightCalEditorFor = null;
      return;
    }
    // keyed by unit as well as day: toggling kg/lb has to relabel the field and reconvert its
    // value, and comparing on the day alone would leave a kg figure sitting under an lb label
    const edKey = weightCalSelected + String.fromCharCode(124) + state.fitness.unit;
    if(weightCalEditorFor === edKey) return;   // otherwise never rebuild under a live caret
    weightCalEditorFor = edKey;
    const ds = weightCalSelected;
    const kgVal = (state.fitness.weightLog||[]).find(e=>e.date===ds);
    const kcalVal = kcalOn(ds);
    const acts = activitiesOn(ds);
    const checks = measureChecks(ds);
    const has = !!kgVal || kcalVal != null || acts.length > 0 || checks.length > 0;

    wrap.style.display = 'block';
    wrap.innerHTML = '<div class="wcal-ed-head">'
      + '<span class="wcal-ed-date">'+escapeHtml(parseLocalDateStr(ds).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'}))+'</span>'
      + '<button type="button" class="wcal-ed-close" aria-label="Close">✕</button>'
      + '</div>'
      + '<div class="wcal-ed-fields">'
      +   '<label>Weight ('+escapeHtml(unitLabel())+')<input type="number" class="wcal-ed-w" step="0.01" min="0" placeholder="—"></label>'
      +   '<label>Calories<input type="number" class="wcal-ed-k" step="10" min="0" placeholder="—"></label>'
      +   '<button type="button" class="btn btn-primary btn-sm wcal-ed-save">Save</button>'
      +   (has ? '<button type="button" class="btn btn-ghost btn-sm wcal-ed-del">Clear day</button>' : '')
      + '</div>'
      + '<div class="wcal-checks">'
      +   '<div class="wcal-act-lbl">Measurement conditions</div>'
      +   WEIGH_CHECKS.map(c=>{
            const on = checks.indexOf(c.key) >= 0;
            return '<label class="wcal-check'+(on?' on':'')+'">'
              + '<input type="checkbox" data-chk="'+c.key+'"'+(on?' checked':'')+'>'
              + '<span>'+escapeHtml(c.label)+'</span></label>';
          }).join('')
      +   '<div class="wcal-check-status'+(checks.length === WEIGH_CHECKS.length ? ' ok' : '')+'">'
      +     (checks.length === WEIGH_CHECKS.length
              ? (kgVal ? 'Ideal conditions — this reading is comparable' : 'All conditions met — log a weight to mark the day')
              : checks.length + ' of ' + WEIGH_CHECKS.length + ' conditions')
      +   '</div>'
      + '</div>'
      + '<div class="wcal-act">'
      +   '<div class="wcal-act-lbl">Activity</div>'
      +   '<div class="wcal-act-list">'
      +     acts.map(a=> '<div class="wcal-act-row">'
      +       '<span class="wcal-act-nm">'+activityEmoji(a.name)+' '+escapeHtml(a.name)+'</span>'
      +       '<span class="wcal-act-mn">'+(a.mins ? escapeHtml(a.mins+' min') : '')+'</span>'
      +       '<span class="wcal-act-kc">'+escapeHtml(Math.round(a.kcal).toLocaleString())+' kcal</span>'
      +       '<button type="button" class="wcal-act-del" data-act="'+escapeHtml(a.id)+'" aria-label="Remove '+escapeHtml(a.name)+'">✕</button>'
      +     '</div>').join('')
      +   '</div>'
      +   '<div class="wcal-act-add">'
      +     '<select class="wcal-act-name" aria-label="Activity">'
      +       FITNESS_ACTIVITIES.map(a=> '<option value="'+a.key+'">'+escapeHtml(a.name)+'</option>').join('')
      +     '</select>'
      +     '<input type="number" class="wcal-act-mins" min="0" step="5" placeholder="min" aria-label="Minutes">'
      +     '<input type="number" class="wcal-act-kcal" min="0" step="10" placeholder="kcal" aria-label="Calories burned">'
      +     '<button type="button" class="btn btn-ghost btn-sm wcal-act-btn">+ Add</button>'
      +   '</div>'
      + '</div>'
      + '<div class="wcal-ed-note">'+weightDayNote(ds, kgVal, kcalVal)+'</div>';

    // assigned rather than interpolated into value="": escapeHtml() doesn't escape double quotes,
    // the same rule the Notes title field follows
    const wIn = wrap.querySelector('.wcal-ed-w'), kIn = wrap.querySelector('.wcal-ed-k');
    wIn.value = kgVal ? roundWeight(kgToDisplay(kgVal.kg)) : '';
    kIn.value = kcalVal != null ? kcalVal : '';

    wrap.querySelector('.wcal-ed-close').addEventListener('click', ()=>{
      weightCalSelected = ''; renderWeightCalendar();
    });
    wrap.querySelector('.wcal-ed-save').addEventListener('click', commitWeightDay);
    const delBtn = wrap.querySelector('.wcal-ed-del');
    if(delBtn) delBtn.addEventListener('click', ()=>{
      state.fitness.weightLog = (state.fitness.weightLog||[]).filter(e=>e.date!==ds);
      state.fitness.calorieLog = calorieLog().filter(e=>e.date!==ds);
      state.fitness.activityLog = activityLog().filter(a=>a.date!==ds);
      state.fitness.measureLog = measureLog().filter(m=>m.date!==ds);
      syncCurrentWeightFromLog();
      weightCalSelected = ''; weightCalEditorFor = null;
      save(); renderFitness();
    });

    // delegated, and it commits the two number fields first: this re-renders the editor, which
    // would otherwise discard a weight you had half-typed above it
    wrap.querySelector('.wcal-checks').addEventListener('change', e=>{
      const box = e.target.closest('[data-chk]');
      if(!box) return;
      applyWeightDayFields();
      toggleMeasureCheck(ds, box.dataset.chk);
      weightCalEditorFor = null;
      save(); renderFitness();
    });

    /* The estimate follows the type and the minutes as a placeholder only — writing it into the
       field would fight anyone typing a figure off their watch, and the Add handler falls back to
       it when the box is left empty, which is the same offer without the interference. */
    const nameSel = wrap.querySelector('.wcal-act-name');
    const minsIn = wrap.querySelector('.wcal-act-mins');
    const kcalIn = wrap.querySelector('.wcal-act-kcal');
    function syncActEstimate(){
      const preset = FITNESS_ACTIVITIES.find(a=>a.key===nameSel.value) || FITNESS_ACTIVITIES[0];
      const est = estimateActivityKcal(preset.met, parseFloat(minsIn.value), ds);
      kcalIn.placeholder = est != null ? '≈ ' + est : 'kcal';
    }
    nameSel.addEventListener('change', syncActEstimate);
    minsIn.addEventListener('input', syncActEstimate);
    wrap.querySelector('.wcal-act-btn').addEventListener('click', ()=> addDayActivity(ds));
    [minsIn, kcalIn].forEach(inp=> inp.addEventListener('keydown', e=>{
      if(e.key === 'Enter'){ e.preventDefault(); addDayActivity(ds); }
    }));
    // delegated, because the rows are rebuilt with the editor
    wrap.querySelector('.wcal-act-list').addEventListener('click', e=>{
      const btn = e.target.closest('[data-act]');
      if(!btn) return;
      applyWeightDayFields();
      state.fitness.activityLog = activityLog().filter(a=>a.id !== btn.dataset.act);
      weightCalEditorFor = null;
      save(); renderFitness();
    });
    [wIn, kIn].forEach(inp=> inp.addEventListener('keydown', e=>{
      if(e.key === 'Enter'){ e.preventDefault(); commitWeightDay(); }
      else if(e.key === 'Escape'){ e.preventDefault(); weightCalSelected = ''; renderWeightCalendar(); }
    }));
    // On a coarse pointer, opening a day is often just reading it — raising the soft keyboard would
    // cover half the calendar you were looking at. Tapping a field still opens it natively.
    if(!window.matchMedia || !window.matchMedia('(pointer: coarse)').matches) wIn.focus();
  }

  // what the day says beyond its two numbers: the change it represents, and how it sat against the
  // budget — the two readings you'd otherwise have to work out from the chart
  function weightDayNote(ds, kgRec, kcalVal){
    const bits = [];
    const sortedW = (state.fitness.weightLog||[]).slice().sort((a,b)=> b.date.localeCompare(a.date));
    const i = sortedW.findIndex(e=>e.date===ds);
    if(kgRec && i >= 0 && sortedW[i+1]){
      const deltaDisp = roundWeight(kgToDisplay(kgRec.kg - sortedW[i+1].kg));
      if(Math.abs(deltaDisp) >= 0.1){
        // the arrow already carries the direction, so the figure beside it is unsigned —
        // '▼ -0.25' reads as a double negative
        bits.push((deltaDisp > 0 ? '▲ +' : '▼ ') + Math.abs(deltaDisp) + ' ' + unitLabel()
          + ' since ' + fmtDate(parseLocalDateStr(sortedW[i+1].date).getTime()));
      }
    }
    const target = fitnessCalorieTarget();
    if(kcalVal != null && target != null){
      const off = Math.round(kcalVal - target);
      bits.push(Math.abs(off) < 25 ? 'on budget'
        : Math.abs(off).toLocaleString() + ' kcal ' + (off > 0 ? 'over' : 'under')
          + ' your ' + Math.round(target).toLocaleString() + ' budget');
    }
    // burn is reported beside intake, and the net alongside it when both exist — the one figure
    // someone eating their exercise calories back actually wants. It stays a reading of the day,
    // not an input to anything: see the note above FITNESS_ACTIVITIES.
    const burn = activityBurnOn(ds);
    if(burn > 0){
      bits.push(burn.toLocaleString() + ' kcal burned');
      if(kcalVal != null) bits.push(Math.round(kcalVal - burn).toLocaleString() + ' kcal net');
    }
    // first, because it qualifies every other figure on the line
    if(kgRec && isControlledDay(ds)) bits.unshift('ideal conditions');
    if(!bits.length && !kgRec && kcalVal == null && burn === 0) bits.push('Nothing logged on this day yet.');
    return escapeHtml(bits.join(' · '));
  }

  /* Writes the two number fields into state and nothing else. It is split out because adding or
     removing an activity re-renders the editor, which would otherwise throw away a weight you had
     half-typed above it — so those handlers commit the fields first. Same rule as the scratch pad's
     commitScratchSurface(): anything that rebuilds the surface has to bank it first. */
  function applyWeightDayFields(){
    const ds = weightCalSelected; if(!ds) return;
    const wrap = el('wcalEditor');
    const wEl = wrap.querySelector('.wcal-ed-w'), kEl = wrap.querySelector('.wcal-ed-k');
    if(!wEl || !kEl) return;
    const w = parseFloat(wEl.value), kc = parseFloat(kEl.value);
    // an emptied field deletes that half of the day — the only way back from a mistyped figure
    // that doesn't also throw away the other reading, which "Clear day" would
    if(!isNaN(w) && w > 0) upsertWeightLog(ds, displayToKg(w));
    else state.fitness.weightLog = (state.fitness.weightLog||[]).filter(e=>e.date!==ds);
    if(!isNaN(kc) && kc >= 0) upsertCalorieLog(ds, Math.round(kc));
    else state.fitness.calorieLog = calorieLog().filter(e=>e.date!==ds);
    syncCurrentWeightFromLog();
  }
  function commitWeightDay(){
    if(!weightCalSelected) return;
    applyWeightDayFields();
    weightCalEditorFor = null;      // the saved values are the ones to show now
    save(); renderFitness();
  }

  // An activity with neither a duration nor a figure is nothing to record, so the button no-ops
  // rather than filing a 0 — and minutes alone is enough, because that is what the estimate needs.
  function addDayActivity(ds){
    const wrap = el('wcalEditor');
    const nameSel = wrap.querySelector('.wcal-act-name');
    const preset = FITNESS_ACTIVITIES.find(a=>a.key===nameSel.value) || FITNESS_ACTIVITIES[0];
    const mins = parseFloat(wrap.querySelector('.wcal-act-mins').value);
    const typed = parseFloat(wrap.querySelector('.wcal-act-kcal').value);
    const kcal = (!isNaN(typed) && typed > 0) ? typed : estimateActivityKcal(preset.met, mins, ds);
    if(kcal == null || isNaN(kcal) || kcal <= 0) return;
    applyWeightDayFields();
    activityLog().push({ id: uid(), date: ds, name: preset.name,
      mins: (!isNaN(mins) && mins > 0) ? Math.round(mins) : null, kcal: Math.round(kcal) });
    weightCalEditorFor = null;
    save(); renderFitness();
  }

  // wired once: the grid's cells are rebuilt on every render, so the click is delegated
  el('wcalGrid').addEventListener('click', e=>{
    const cell = e.target.closest('[data-day]');
    if(!cell) return;
    const ds = cell.dataset.day;
    weightCalSelected = (weightCalSelected === ds) ? '' : ds;   // clicking the open day closes it
    weightCalEditorFor = null;
    renderWeightCalendar();
  });
  /* ---- the maximised photo ----
     One overlay for both sides; which one it is showing is the only state it keeps. Escape and a
     backdrop click close it, and the Escape listener is added on open and removed on close rather
     than living for the life of the page — the same shape the calendar bubble's outside-click
     listener uses. */
  let photoViewKind = '';
  function photoViewRec(){
    if(photoViewKind === 'goal') return state.fitness.dreamPhoto || null;
    const photos = (state.fitness.progressPhotos || []).slice()
      .sort((a,b)=> (a.uploadedAt||0) - (b.uploadedAt||0));
    return photos[comparePhotoIdx] || null;
  }
  function openPhotoView(kind){
    photoViewKind = kind;
    const rec = photoViewRec();
    if(!rec || !rec.imageUrl) return;
    el('photoViewImg').src = rec.imageUrl;
    el('photoViewImg').alt = kind === 'goal' ? 'Goal physique' : 'Progress photo';

    let cap;
    if(kind === 'goal'){
      cap = 'Goal physique';
    } else {
      const ds = localDateStr(new Date(rec.uploadedAt));
      const w = weightAtOrBefore(ds);
      cap = (ds === localDateStr(new Date()) ? 'Today' : fmtDate(rec.uploadedAt))
        + (w ? ' · ' + roundWeight(kgToDisplay(w.kg)) + ' ' + unitLabel() : '');
    }
    el('photoViewCap').textContent = cap;

    // Remove sits at the far left of the bar and Close at the far right, so the destructive one is
    // never the button your thumb lands on when reaching for the safe one
    el('photoViewActs').innerHTML =
      '<button type="button" class="photo-view-btn danger" data-pv="remove">Remove</button>'
      + (kind === 'goal' ? '<button type="button" class="photo-view-btn" data-pv="replace">Replace</button>' : '')
      + (rec.driveViewLink ? '<a class="photo-view-btn" href="'+escapeHtml(rec.driveViewLink)+'" target="_blank" rel="noopener">Drive ↗</a>' : '')
      + '<button type="button" class="photo-view-btn primary" data-pv="close">Close</button>';

    el('photoViewOverlay').style.display = 'flex';
    document.addEventListener('keydown', photoViewKeys);
  }
  function closePhotoView(){
    el('photoViewOverlay').style.display = 'none';
    el('photoViewImg').src = '';        // don't hold the bytes for a photo nobody is looking at
    photoViewKind = '';
    document.removeEventListener('keydown', photoViewKeys);
  }
  function photoViewKeys(e){ if(e.key === 'Escape') closePhotoView(); }

  el('photoViewOverlay').addEventListener('click', e=>{
    // the backdrop closes; a click on the picture or the bar must not
    if(e.target === el('photoViewOverlay')){ closePhotoView(); return; }
    const btn = e.target.closest('[data-pv]');
    if(!btn) return;
    if(btn.dataset.pv === 'close'){ closePhotoView(); return; }
    if(btn.dataset.pv === 'replace'){
      // the picker replaces the overlay: uploadDreamPhoto() re-renders the panel behind it, and
      // leaving a stale photo maximised over the new one would be the one thing worse than either
      closePhotoView();
      el('dreamPhotoInput').click();
      return;
    }
    if(btn.dataset.pv === 'remove'){
      // it leaves this list, the Drive file stays — the contract every Remove here has had
      const rec = photoViewRec();
      if(rec){
        if(photoViewKind === 'goal') state.fitness.dreamPhoto = null;
        else {
          state.fitness.progressPhotos = (state.fitness.progressPhotos||[]).filter(p=> p.id !== rec.id);
          if(comparePhotoIdx >= state.fitness.progressPhotos.length) comparePhotoIdx = -1;
        }
        save();
      }
      closePhotoView();
      renderComparePhotos();
    }
  });

  el('wcalPrev').addEventListener('click', ()=> shiftWeightCalMonth(-1));
  el('wcalNext').addEventListener('click', ()=> shiftWeightCalMonth(1));
  el('wcalToday').addEventListener('click', ()=>{
    weightCalMonth = localDateStr(new Date()).slice(0,7);
    renderWeightCalendar();
  });

  // Drive filenames are named by upload time + logged weight (e.g. "July 30, 2026 7:45AM
  // (74.5 KG)") rather than the original camera/phone filename, so files are easy to sort
  // and identify from within Drive itself.
  function driveProgressPhotoFilename(uploadedAt, originalName){
    const d = new Date(uploadedAt);
    const datePart = d.toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'});
    let hours = d.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12; if(hours === 0) hours = 12;
    const minutes = String(d.getMinutes()).padStart(2,'0');
    const timePart = hours+':'+minutes+ampm;
    const kg = parseFloat(state.fitness.currentWeight);
    const weightPart = !isNaN(kg) ? ' ('+roundWeight(kg)+' KG)' : '';
    const extMatch = /\.[^.]+$/.exec(originalName||'');
    const ext = extMatch ? extMatch[0] : '';
    return datePart+' '+timePart+weightPart+ext;
  }

  /* The Drive round trip itself, with the two callers below differing only in what they name the
     file and where they put the record it returns. Both keep only the Drive id/link/thumbnail —
     never the bytes — which is the whole reason the shared JSON row stays small. */
  async function driveUploadPhoto(file, driveFilename){
    // read-only session (js/pin.js): this writes a file into the owner's Google Drive. Thrown
    // rather than returned so it lands in the caller's existing upload-failed path.
    if(!appCanWrite()) throw new Error('This session is read-only — photos can’t be uploaded.');
    const dataUrl = await new Promise((resolve, reject)=>{
      const reader = new FileReader();
      reader.onload = ev => resolve(ev.target.result);
      reader.onerror = () => reject(new Error('Could not read the selected file.'));
      reader.readAsDataURL(file);
    });
    const commaIdx = dataUrl.indexOf(',');
    const imageBase64 = commaIdx>=0 ? dataUrl.slice(commaIdx+1) : dataUrl;
    const { data, error } = await supa.functions.invoke('upload-fitness-photo', {
      body: { imageBase64, filename: driveFilename, mimeType: file.type || 'image/jpeg' }
    });
    if(error){
      let detail = '';
      if(error.context && typeof error.context.json === 'function'){
        try{ detail = (await error.context.json())?.error || ''; }catch(_){}
      }
      throw new Error(detail || error.message);
    }
    if(data && data.error) throw new Error(data.error);
    if(!data || !data.fileId) throw new Error('Upload didn’t return a file, try again.');
    return { driveFileId: data.fileId, driveViewLink: data.webViewLink || '', imageUrl: data.thumbnailUrl || '' };
  }

  async function uploadProgressPhoto(file){
    const statusEl = el('photoStatus');
    if(usingClaudeStorage || !supabaseConfigured){
      statusEl.textContent = 'Photo upload isn’t available in this mode.';
      return;
    }
    if(!initSupabaseIfNeeded()) return;
    statusEl.textContent = 'Uploading…';
    try{
      const uploadedAt = Date.now();
      const driveFilename = driveProgressPhotoFilename(uploadedAt, file.name);
      const rec = await driveUploadPhoto(file, driveFilename);
      state.fitness.progressPhotos = state.fitness.progressPhotos || [];
      state.fitness.progressPhotos.push(Object.assign({ id: uid(), filename: driveFilename, uploadedAt }, rec));
      comparePhotoIdx = -1;         // a new photo is the one you want to be looking at
      save();
      statusEl.textContent = 'Uploaded to Google Drive.';
      renderComparePhotos();
    }catch(e){
      statusEl.textContent = (e && e.message) ? e.message : 'Upload failed, try again.';
    }
  }
  el('progressPhotoInput').addEventListener('change', e=>{
    const file = e.target.files[0];
    e.target.value = ''; // allow re-selecting the same file consecutively
    if(file) uploadProgressPhoto(file);
  });
  /* A real <button> forwarding to the hidden input, not a <label> wrapping it. The input has to
     stay display:none (a file input draws its own control and its own filename), and a display:none
     input cannot take focus while a <label> is not a tab stop — so the old pairing left the only
     way to add a photo unreachable from a keyboard entirely. */
  el('progressPhotoBtn').addEventListener('click', ()=> el('progressPhotoInput').click());

  // The goal physique is a single photo rather than a list — it is the one thing you are aiming
  // at, and a carousel of aspirations is a different feature. Uploading again replaces it.
  async function uploadDreamPhoto(file){
    const statusEl = el('photoStatus');
    if(usingClaudeStorage || !supabaseConfigured){
      statusEl.textContent = 'Photo upload isn’t available in this mode.';
      return;
    }
    if(!initSupabaseIfNeeded()) return;
    statusEl.textContent = 'Uploading…';
    try{
      const uploadedAt = Date.now();
      const ext = (/\.[^.]+$/.exec(file.name || '') || [''])[0];
      const driveFilename = 'Dream physique ' + new Date(uploadedAt).toLocaleDateString(undefined,
        {month:'long',day:'numeric',year:'numeric'}) + ext;
      const rec = await driveUploadPhoto(file, driveFilename);
      state.fitness.dreamPhoto = Object.assign({ id: uid(), filename: driveFilename, uploadedAt }, rec);
      save();
      statusEl.textContent = 'Saved to Google Drive.';
      renderComparePhotos();
    }catch(e){
      statusEl.textContent = (e && e.message) ? e.message : 'Upload failed, try again.';
    }
  }
  el('dreamPhotoInput').addEventListener('change', e=>{
    const file = e.target.files[0];
    e.target.value = '';
    if(file) uploadDreamPhoto(file);
  });

  /* ---- goal comparison ----
     Your photo beside the one you're working toward. The left side steps through the progress
     photos rather than pinning itself to the newest, so the same panel answers "how far have I
     come" against any of them; which one is showing is view state only, never persisted, the same
     rule the chart zooms follow. The images are object-fit:contain, not cover — cropping a
     physique to fill a box is exactly the wrong thing to do to the subject of the comparison. */
  let comparePhotoIdx = -1;        // -1 means "the current one", resolved on every render

  // the weigh-in that was true when a photo was taken: on that day if there is one, else the most
  // recent before it, so an old photo is captioned with the weight it actually shows
  function weightAtOrBefore(dateStr){
    const log = (state.fitness.weightLog||[]).filter(e=> e.date <= dateStr)
      .sort((a,b)=> b.date.localeCompare(a.date));
    return log.length ? log[0] : null;
  }

  function renderComparePhotos(){
    const section = el('compareSection'); if(!section) return;
    if(!state.fitness.progressPhotos) state.fitness.progressPhotos = [];
    const unavailable = usingClaudeStorage || !supabaseConfigured;
    /* The heading stays and the note explains itself, rather than the block vanishing: with the
       carousel gone this is the only place photos appear, so a silent disappearance would read as
       lost data rather than as a mode without Edge Functions. */
    el('comparePhotoUnavailable').style.display = unavailable ? 'block' : 'none';
    el('progressPhotoBtn').style.display = unavailable ? 'none' : '';
    el('comparePhotoUploadRow').style.display = unavailable ? 'none' : '';
    el('compareWrap').style.display = unavailable ? 'none' : '';
    if(unavailable) return;

    /* Sorted by when the photo was taken, not by where it sits in the array. The two normally
       agree, since progress photos are only ever appended — but the arrows are labelled "earlier"
       and "later" and the counter reads "2 / 3", and both of those are lies the moment a restored
       backup hands back the same photos in a different order. Sorting here is also what makes the
       landing photo simply the last one: today's, or the most recent before it. */
    const photos = (state.fitness.progressPhotos || []).slice()
      .sort((a,b)=> (a.uploadedAt||0) - (b.uploadedAt||0));
    const dream = state.fitness.dreamPhoto;
    if(comparePhotoIdx < 0 || comparePhotoIdx >= photos.length) comparePhotoIdx = photos.length - 1;
    const cur = photos[comparePhotoIdx] || null;

    /* The picture is the button: tapping it maximises the photo, and the Drive link and Remove
       live in there. They used to sit on the card itself, a few pixels from the ‹ › arrows — one
       mis-tap from deleting the photo you were trying to step past. */
    const imgBox = (url, alt, cmd) => url
      ? '<button type="button" class="compare-img" data-cmp="'+cmd+'" aria-label="'+escapeHtml('Open '+alt)+'">'
        + '<img src="'+escapeHtml(url)+'" alt="'+escapeHtml(alt)+'" loading="lazy">'
        // a persistent corner glyph, not a hover state: there is no hover on a phone, and this is
        // now the only way to reach the photo's actions
        + '<span class="compare-zoom" aria-hidden="true">⤢</span></button>'
      : '<div class="compare-img"><div class="compare-empty">No in-app preview<br>(uploaded before this feature, or Drive sharing failed)</div></div>';

    let nowSide;
    if(cur){
      const dateStr = localDateStr(new Date(cur.uploadedAt));
      const w = weightAtOrBefore(dateStr);
      nowSide = '<figure class="compare-side">'
        + imgBox(cur.imageUrl, 'progress photo', 'viewCur')
        + '<figcaption class="compare-cap">'
        +   '<span class="compare-lbl">You</span>'
        +   '<span class="compare-meta">'+escapeHtml(dateStr === localDateStr(new Date())
              ? 'Today' : fmtDate(cur.uploadedAt))+'</span>'
        +   '<span class="compare-sub">'+escapeHtml(w ? roundWeight(kgToDisplay(w.kg))+' '+unitLabel() : 'no weigh-in that day')+'</span>'
        + '</figcaption>'
        + '<div class="compare-tools">'
        +   (photos.length > 1
              ? '<div class="compare-nav">'
                + '<button type="button" class="compare-arrow" data-cmp="prev"'+(comparePhotoIdx<=0?' disabled':'')+' aria-label="Earlier photo">‹</button>'
                + '<span class="compare-count">'+(comparePhotoIdx+1)+' / '+photos.length+'</span>'
                + '<button type="button" class="compare-arrow" data-cmp="next"'+(comparePhotoIdx>=photos.length-1?' disabled':'')+' aria-label="Later photo">›</button>'
                + '</div>'
              : '')
        + '</div>'
        + '</figure>';
    } else {
      nowSide = '<figure class="compare-side"><div class="compare-img">'
        + '<div class="compare-empty">No progress photos yet.<br>Add one below to start comparing.</div></div>'
        + '<figcaption class="compare-cap"><span class="compare-lbl">You</span></figcaption></figure>';
    }

    let goalSide;
    if(dream){
      const tw = parseFloat(state.fitness.targetWeight), cw = parseFloat(state.fitness.currentWeight);
      const meta = !isNaN(tw) ? roundWeight(kgToDisplay(tw)) + ' ' + unitLabel() + ' target' : 'No target weight set';
      const sub = (!isNaN(tw) && !isNaN(cw))
        ? (Math.abs(cw - tw) < 0.005 ? 'you’re there' : roundWeight(Math.abs(kgToDisplay(cw - tw))) + ' ' + unitLabel() + ' to go')
        : 'set a target weight in the calculator below';
      goalSide = '<figure class="compare-side goal">'
        + imgBox(dream.imageUrl, 'goal physique', 'viewGoal')
        + '<figcaption class="compare-cap">'
        +   '<span class="compare-lbl">Goal</span>'
        +   '<span class="compare-meta">'+escapeHtml(meta)+'</span>'
        +   '<span class="compare-sub">'+escapeHtml(sub)+'</span>'
        + '</figcaption>'
        + '</figure>';
    } else {
      // the empty card is the way in the first time: there is no viewer to open yet, so the
      // placeholder itself picks the file
      goalSide = '<figure class="compare-side goal">'
        + '<button type="button" class="compare-img" data-cmp="pickDream">'
        +   '<span class="compare-empty">🎯 Upload the physique you’re working toward,<br>and it sits here beside your own.</span>'
        + '</button>'
        + '<figcaption class="compare-cap"><span class="compare-lbl">Goal</span></figcaption></figure>';
    }

    // the one figure the pairing is actually for: what has changed since the photo on the left
    let foot = '';
    if(cur){
      const w = weightAtOrBefore(localDateStr(new Date(cur.uploadedAt)));
      const cw = parseFloat(state.fitness.currentWeight);
      if(w && !isNaN(cw)){
        const d = roundWeight(kgToDisplay(cw - w.kg));
        foot = Math.abs(d) < 0.01
          ? 'Same weight as when this photo was taken.'
          : (d < 0 ? '▼ ' : '▲ +') + Math.abs(d) + ' ' + unitLabel() + ' since this photo';
      }
    }
    el('compareWrap').innerHTML = '<div class="compare-grid">' + nowSide + goalSide + '</div>'
      + (foot ? '<div class="compare-foot">'+escapeHtml(foot)+'</div>' : '');
  }

  // delegated: the panel is rebuilt on every render
  el('compareWrap').addEventListener('click', e=>{
    const btn = e.target.closest('[data-cmp]');
    if(!btn) return;
    const photos = state.fitness.progressPhotos || [];
    if(btn.dataset.cmp === 'pickDream'){ el('dreamPhotoInput').click(); return; }
    if(btn.dataset.cmp === 'viewCur' || btn.dataset.cmp === 'viewGoal'){
      openPhotoView(btn.dataset.cmp === 'viewGoal' ? 'goal' : 'progress');
      return;                       // nothing changed, so nothing to re-render
    }
    // stepping is all that is left here: removal moved into the viewer, where it cannot be hit
    // by a thumb aiming for an arrow
    if(btn.dataset.cmp === 'prev' && comparePhotoIdx > 0) comparePhotoIdx--;
    else if(btn.dataset.cmp === 'next' && comparePhotoIdx < photos.length-1) comparePhotoIdx++;
    renderComparePhotos();
  });

  function updateFitnessReminder(){
    const todayStr = localDateStr(new Date());
    const loggedToday = (state.fitness.weightLog||[]).some(e=>e.date===todayStr);
    // The calorie half of the nag only appears once calories have been logged at least once:
    // someone who only tracks weight shouldn't be told daily that they're missing a field they
    // never opted into, and the badge is app-wide.
    const kcalDay = shiftDateStr(todayStr, -kcalOffset());
    const kcalMissing = calorieLog().length > 0 && kcalOn(kcalDay) == null;
    const missing = [];
    if(!loggedToday) missing.push('your weight today');
    if(kcalMissing) missing.push('what you ate on ' + fmtDate(parseLocalDateStr(kcalDay).getTime()));
    const banner = el('fitnessLogBanner');
    banner.style.display = missing.length ? 'flex' : 'none';
    const txt = banner.querySelector('span');
    if(txt) txt.textContent = 'You haven\u2019t logged ' + missing.join(' or ') + ' yet.';
    el('fitnessLogBadge').style.display = missing.length ? 'inline-flex' : 'none';
  }

  /* ---- weight trend chart: line + moving average, zoomable to a chosen time range ---- */
  const WEIGHT_CHART_ZOOMS = [
    {key:'1m', label:'1M', months:1},
    {key:'3m', label:'3M', months:3},
    {key:'6m', label:'6M', months:6},
    {key:'1y', label:'1Y', months:12},
    {key:'all', label:'All', months:null}
  ];
  // 1M by default, not persisted — it resets to this every page load. A month is the window a
  // cut or a bulk is actually judged over: long enough that daily water noise has averaged out,
  // short enough that the line still has the shape of what you are doing now rather than a year of
  // history compressed into a slope.
  let weightChartZoom = '1m';
  // background bands showing BMI territory (underweight/normal/overweight/obese) translated into
  // actual weight values for this person's height, so the chart visually shows which zone their
  // weight sits in over time. Skipped entirely if height hasn't been entered yet.
  // The fills are CSS custom properties rather than literal rgba() so the dark themes can raise
  // their alpha — a 14%-opacity tint tuned for a white card is all but invisible on a #1C1F2B one.
  function bmiBandsSvg(minV, maxV, yOf, W, padL, padR){
    const heightCm = parseFloat(state.fitness.height);
    if(!heightCm || heightCm<=0) return '';
    const hM = heightCm/100;
    const thresholdsDisp = [18.5,25,30].map(bmi => kgToDisplay(bmi*hM*hM));
    const bounds = [-Infinity, thresholdsDisp[0], thresholdsDisp[1], thresholdsDisp[2], Infinity];
    const bandVars = ['var(--wt-band-under)','var(--wt-band-ok)','var(--wt-band-over)','var(--wt-band-obese)'];
    let svg = '';
    for(let i=0;i<4;i++){
      const lo = Math.max(bounds[i], minV), hi = Math.min(bounds[i+1], maxV);
      if(hi <= lo) continue;
      const yTop = yOf(hi), yBot = yOf(lo);
      svg += '<rect x="'+padL+'" y="'+yTop.toFixed(1)+'" width="'+(W-padL-padR)+'" height="'+(yBot-yTop).toFixed(1)+'" fill="'+bandVars[i]+'"/>';
    }
    return svg;
  }

  function renderWeightChart(){
    const zoomRow = el('weightChartZoomRow');
    zoomRow.innerHTML = WEIGHT_CHART_ZOOMS.map(z=>
      '<button type="button" class="chart-zoom-btn'+(weightChartZoom===z.key?' active':'')+'"'
      + (weightChartZoom===z.key?' aria-current="true"':'')+' data-zoom="'+z.key+'">'+z.label+'</button>'
    ).join('');
    zoomRow.querySelectorAll('.chart-zoom-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        weightChartZoom = btn.dataset.zoom;
        renderWeightChart();
      });
    });

    const wrap = el('weightChartWrap');
    const deltaEl = el('weightTrendDelta');
    const legendEl = el('weightChartLegend');
    const setDelta = html => { if(deltaEl) deltaEl.innerHTML = html; };
    const log = (state.fitness.weightLog||[]).slice().sort((a,b)=> a.date.localeCompare(b.date));
    if(legendEl) legendEl.innerHTML = '';
    if(log.length < 2){
      setDelta('');
      wrap.innerHTML = '<div class="wt-chart-empty">Log at least two days of weight to see your trend.</div>';
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
      setDelta('');
      wrap.innerHTML = '<div class="wt-chart-empty">Nothing logged in this range — try a wider one.</div>';
      return;
    }

    const vals = points.map(p=>kgToDisplay(p.kg));
    const targetKg = parseFloat(state.fitness.targetWeight);
    const targetDisp = (!isNaN(targetKg) && targetKg > 0) ? kgToDisplay(targetKg) : null;

    // moving average: window of up to 5 surrounding entries (or fewer if near the edges).
    // Computed here rather than beside the path that draws it because the headline is measured
    // against it too — see the note on smoothedLast below.
    const windowSize = 5;
    const maVals = vals.map((_,i)=>{
      const start = Math.max(0, i-Math.floor(windowSize/2));
      const end = Math.min(vals.length, i+Math.ceil(windowSize/2));
      const slice = vals.slice(start,end);
      return slice.reduce((a,b)=>a+b,0)/slice.length;
    });

    /* Headline readout — the question this panel exists to answer is "am I moving toward my
       target", so that figure carries the most weight on the card and the plot recedes behind it.

       It is measured on the moving average, not on the raw first/last readings: a target is a
       weight you hold, not one you touch. Day-to-day scale noise is easily a kilo of water, so a
       single lucky morning at 63 would otherwise flip the readout to "at target" and a single bad
       one would take it back — the reading still counts, but by pulling the average down rather
       than by standing in for it. Reading the *drawn* average also keeps the number honest against
       the chart: the gold line ending at 63.2 while the headline claims 62.8 would look like a bug.

       Direction and judgement are deliberately separate: the arrow reports which way the weight
       went, the colour reports whether that was *toward* the target. Cutting and bulking are both
       progress, so colouring "down" green would be wrong half the time — and with no target set
       there is no good direction, so it stays neutral rather than guessing. */
    const first = maVals[0], last = maVals[maVals.length-1];
    const change = last - first;
    const moved = Math.abs(change) >= 0.05;
    const arrow = !moved ? '→' : (change > 0 ? '↑' : '↓');
    let tone = 'flat', toward = '';
    if(moved && targetDisp != null){
      const closer = Math.abs(last-targetDisp) < Math.abs(first-targetDisp);
      tone = closer ? 'good' : 'bad';
      toward = closer ? 'toward target' : 'away from target';
    } else if(moved) tone = 'neutral';
    const pct = Math.abs(first) > 0.05 ? ' (' + Math.abs(change/first*100).toFixed(1).replace(/\.0$/,'') + '%)' : '';
    const rangeTxt = zoomOpt.months == null ? 'all time'
      : zoomOpt.months === 12 ? 'the past year'
      : 'the past ' + zoomOpt.months + ' month' + (zoomOpt.months > 1 ? 's' : '');
    const gap = targetDisp != null ? Math.abs(last - targetDisp) : null;
    // reaching the target is the one moment worth naming outright, and the tone goes green for it
    // whichever way the weight was moving when it got there
    const hit = gap != null && gap < 0.05;
    if(hit){ tone = 'good'; toward = ''; }
    // "avg" is stated once, on the figure it qualifies: without it a headline reading 1.2 kg to go
    // beside a scale showing the target already met reads as broken rather than as smoothed
    const gapTxt = gap == null ? ''
      : hit ? ' · at target (5-day avg)'
      : ' · ' + escapeHtml(roundDisp(gap) + ' ' + unitLabel()) + ' to go on the 5-day avg';
    // the words repeat what the colour says, so direction survives greyscale and colour blindness
    setDelta('<span class="wt-delta-val ' + tone + '">' + arrow + ' '
      + escapeHtml(moved ? roundDisp(Math.abs(change)) + ' ' + unitLabel() + pct : 'No change') + '</span>'
      + '<span class="wt-delta-note">over ' + escapeHtml(rangeTxt)
      + (toward ? ' · ' + escapeHtml(toward) : '')
      + gapTxt
      + '</span>');

    /* Everything inside an SVG scales with the viewBox, type included — a fixed font-size:10 in a
       780-unit chart renders at about 4.6px once it is squeezed into a 360px phone column, which is
       how a chart ends up with an axis nobody can read. So the type and the gutters it needs are
       expressed in *rendered pixels* and converted into viewBox units by k, and the chart is given
       a taller aspect on narrow screens instead of becoming a sliver. Same approach as the
       net-worth chart in finance.js. */
    const wrapW = Math.max(260, wrap.clientWidth || 780);
    const k = 780 / wrapW;                        // viewBox units per rendered pixel
    const W = 780;
    const H = Math.round((wrapW < 560 ? 168 : 240) * k);
    const fs = +(11 * k).toFixed(1);              // axis type, ~11px rendered at any width
    const padL = Math.round(fs * 2.7 + 10 * k);   // room for the widest tick label
    const padR = Math.round(14 * k), padT = Math.round(16 * k), padB = Math.round(fs + 16 * k);

    let minV = Math.min(...vals), maxV = Math.max(...vals);
    if(minV === maxV){ minV -= 1; maxV += 1; }
    /* Pull the target into view when reaching it costs at most half again the value range. The
       target line matters most exactly when it is nearly met, and without this it would pop into
       existence only once it had already been crossed. The cap is what keeps it honest: the axis
       can never grow past 1.5x, so the actual trend keeps at least two thirds of its amplitude
       instead of being flattened into a straight line by a target 12 kg away. A target outside
       that budget simply isn't drawn — the headline above states the remaining gap either way.
       Phrasing the budget as a share of the span rather than an absolute number of kg is also what
       keeps it working in both units, since vals are already in display units here. */
    if(targetDisp != null){
      const budget = ((maxV - minV) || 1) * 0.5;
      if(targetDisp < minV && minV - targetDisp <= budget) minV = targetDisp;
      else if(targetDisp > maxV && targetDisp - maxV <= budget) maxV = targetDisp;
    }
    const pad = (maxV-minV)*0.12; minV -= pad; maxV += pad;
    // parseLocalDateStr, not new Date(str): the latter reads "YYYY-MM-DD" as UTC per spec, which
    // lands a day early in negative-UTC-offset zones and mislabels the axis
    const t0 = parseLocalDateStr(points[0].date).getTime(), t1 = parseLocalDateStr(points[points.length-1].date).getTime();
    const tSpan = Math.max(1, t1-t0);
    const xOf = d => padL + ((parseLocalDateStr(d).getTime()-t0)/tSpan) * (W-padL-padR);
    const yOf = v => padT + (1-(v-minV)/(maxV-minV)) * (H-padT-padB);

    // one array carrying both the plot geometry and the source values, so the scrub handler can
    // hit-test and format from the same record (same shape the net-worth chart's scrub uses)
    const pts = points.map((p,i)=> ({ x:xOf(p.date), y:yOf(vals[i]), v:vals[i], ma:maVals[i], date:p.date,
      delta: i===0 ? null : vals[i]-vals[i-1] }));

    const linePath = pts.map((p,i)=> (i===0?'M':'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
    const maPath = points.map((p,i)=> (i===0?'M':'L') + xOf(p.date).toFixed(1) + ',' + yOf(maVals[i]).toFixed(1)).join(' ');
    const floor = H - padB;
    const areaPath = linePath + ' L' + pts[pts.length-1].x.toFixed(1) + ',' + floor
      + ' L' + pts[0].x.toFixed(1) + ',' + floor + ' Z';

    // three gridlines, not five, and hairline-weight: the axis is a reference, not the subject
    let gridSvg = '';
    const steps = 3;
    for(let i=0;i<=steps;i++){
      const v = minV + (maxV-minV)*(i/steps);
      const y = yOf(v);
      gridSvg += '<line x1="'+padL+'" y1="'+y.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+y.toFixed(1)+'" stroke="var(--border)" stroke-width="'+k.toFixed(2)+'" opacity=".7"/>';
      gridSvg += '<text x="'+(padL-Math.round(8*k))+'" y="'+(y+fs*0.34).toFixed(1)+'" font-size="'+fs+'" fill="var(--muted)" text-anchor="end">'+roundDisp(v)+'</text>';
    }

    // a narrow chart can't fit three full dates without them touching, so it shows the two ends
    // only, and drops the year — the range control above already says which window this is
    const narrow = wrapW < 560;
    const axisDate = ts => narrow
      ? new Date(ts).toLocaleDateString(undefined,{month:'short',day:'numeric'})
      : fmtDate(ts);
    const xLabelSpec = narrow
      ? [[0,'start'],[points.length-1,'end']]
      : [[0,'start'],[Math.floor((points.length-1)/2),'middle'],[points.length-1,'end']];
    let xLabelSvg = '';
    xLabelSpec.forEach(([i,anchor])=>{
      // the outer labels hug the plot edges so they can't spill outside the card
      const x = anchor==='start' ? padL : anchor==='end' ? W-padR : pts[i].x;
      xLabelSvg += '<text x="'+x.toFixed(1)+'" y="'+(H-Math.round(5*k))+'" font-size="'+fs+'" fill="var(--muted)" text-anchor="'+anchor+'">'+escapeHtml(axisDate(parseLocalDateStr(pts[i].date).getTime()))+'</text>';
    });

    /* Target line — an annotation, not a third series, so it is drawn in neutral ink rather than
       given a colour of its own: a green rule would collide with the green BMI band it usually
       sits inside, and any accent would read as more data. Only drawn when it falls inside the
       visible range; stretching the axis to reach a far-off target would flatten the actual trend
       into a straight line, and the headline above already states the remaining gap either way. */
    let targetSvg = '';
    if(targetDisp != null && targetDisp > minV && targetDisp < maxV){
      const ty = yOf(targetDisp);
      targetSvg = '<line x1="'+padL+'" y1="'+ty.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+ty.toFixed(1)+'" stroke="var(--text)" stroke-width="'+(1.1*k).toFixed(2)+'" stroke-dasharray="'+(2.5*k).toFixed(1)+','+(3.5*k).toFixed(1)+'" opacity=".45"/>'
        + '<text x="'+(W-padR)+'" y="'+(ty-4*k).toFixed(1)+'" font-size="'+(fs*0.9).toFixed(1)+'" fill="var(--muted)" text-anchor="end" font-weight="700">Target '+roundWeight(targetDisp)+'</text>';
    }

    /* Per-point dots only while they still read as data. Past ~45 entries they merge into a
       beaded rope thicker than the line itself, and the line already carries the shape. */
    const dotsSvg = pts.length <= 45
      ? pts.map(p=> '<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="'+(2*k).toFixed(1)+'" fill="var(--violet)" opacity=".55"/>').join('')
      : '';
    const bandsSvg = bmiBandsSvg(minV, maxV, yOf, W, padL, padR);
    const lastPt = pts[pts.length-1];

    wrap.innerHTML = '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Weight trend over '+escapeHtml(rangeTxt)+'">'
      + '<defs><linearGradient id="wtAreaFill" x1="0" y1="0" x2="0" y2="1">'
      +   '<stop offset="0%" stop-color="var(--violet)" stop-opacity=".22"/>'
      +   '<stop offset="100%" stop-color="var(--violet)" stop-opacity="0"/>'
      + '</linearGradient></defs>'
      + bandsSvg + gridSvg + xLabelSvg + targetSvg
      + '<path d="'+areaPath+'" fill="url(#wtAreaFill)" stroke="none"/>'
      // the moving average is the quieter mark on purpose: it is a reading *of* the data, so it
      // must not outweigh the data — it used to be the thickest stroke on the chart
      + '<path d="'+maPath+'" fill="none" stroke="var(--gold)" stroke-width="'+(1.6*k).toFixed(2)+'" stroke-dasharray="'+(5*k).toFixed(1)+','+(4*k).toFixed(1)+'" stroke-linecap="round" opacity=".9"/>'
      + '<path d="'+linePath+'" fill="none" stroke="var(--violet)" stroke-width="'+(2.25*k).toFixed(2)+'" stroke-linejoin="round" stroke-linecap="round"/>'
      + dotsSvg
      + '<line class="wt-guide" x1="0" y1="'+padT+'" x2="0" y2="'+floor+'" stroke="var(--violet)" stroke-width="'+k.toFixed(2)+'" opacity="0"/>'
      + '<circle cx="'+lastPt.x.toFixed(1)+'" cy="'+lastPt.y.toFixed(1)+'" r="'+(4*k).toFixed(1)+'" fill="var(--violet)" stroke="var(--surface)" stroke-width="'+(2.5*k).toFixed(1)+'"/>'
      + '<circle class="wt-hover-dot" cx="0" cy="0" r="'+(4.5*k).toFixed(1)+'" fill="var(--violet)" stroke="var(--surface)" stroke-width="'+(2.5*k).toFixed(1)+'" opacity="0"/>'
      + '</svg>';

    if(legendEl){
      legendEl.innerHTML = '<span><span class="dot" style="background:var(--violet);"></span>Weight</span>'
        + '<span><span class="dot dash" style="color:var(--gold);"></span>5-day average</span>'
        + (targetSvg ? '<span><span class="dot dash" style="color:var(--muted);"></span>Target</span>' : '')
        + (bandsSvg ? '<span class="wt-legend-bands">BMI zones for your height: <b class="ok">normal</b>, <b class="warn">under/over</b>, <b class="bad">obese</b></span>' : '');
    }
    wireWeightChartScrub(wrap, pts, W, H);
    observeWeightChartWidth(wrap);
  }

  /* The sizing above measures the wrapper, and the wrapper measures 0 while the Fitness view is
     display:none — so a chart first drawn on another tab would keep desktop-scaled type after the
     user switched to Fitness on a phone. This redraws it once the real width is known, and again
     on rotate/resize. Guarded on a meaningful change so setting innerHTML can't loop. */
  let wtChartLastWidth = 0, wtChartObserver = null;
  function observeWeightChartWidth(wrap){
    wtChartLastWidth = wrap.clientWidth || 0;
    if(wtChartObserver || typeof ResizeObserver === 'undefined') return;
    wtChartObserver = new ResizeObserver(entries=>{
      const w = Math.round(entries[0].contentRect.width);
      if(!w || Math.abs(w - wtChartLastWidth) < 12) return;
      wtChartLastWidth = w;
      renderWeightChart();
    });
    wtChartObserver.observe(wrap);
  }

  /* The calorie chart used to ride the weight chart's observer, back when the two sat in one
     column and always resized together. They are in different panes now — the weight pane can be
     hidden while the calorie pane is the one being resized — so it needs its own. Same guard: only
     a meaningful width change redraws, or setting innerHTML would loop. */
  let kcalChartLastWidth = 0, kcalChartObserver = null;
  function observeCalorieChartWidth(wrap){
    kcalChartLastWidth = wrap.clientWidth || 0;
    if(kcalChartObserver || typeof ResizeObserver === 'undefined') return;
    kcalChartObserver = new ResizeObserver(entries=>{
      const w = Math.round(entries[0].contentRect.width);
      if(!w || Math.abs(w - kcalChartLastWidth) < 12) return;
      kcalChartLastWidth = w;
      renderCalorieReview();
    });
    kcalChartObserver.observe(wrap);
  }

  /* Pointer/finger scrub over the weight line — same interaction as the net-worth chart in
     finance.js: pointer events so mouse, pen and touch share one path, and touch-action:pan-y on
     the svg (CSS) so a vertical swipe still scrolls the page while a horizontal drag reads the
     chart. */
  function wireWeightChartScrub(wrap, pts, W, H){
    const svg = wrap.querySelector('svg'); if(!svg) return;
    const guide = svg.querySelector('.wt-guide');
    const dot = svg.querySelector('.wt-hover-dot');
    const tip = document.createElement('div');
    tip.className = 'wt-tip';
    wrap.appendChild(tip);

    function show(clientX){
      const r = svg.getBoundingClientRect();
      if(!r.width) return;
      const sx = ((clientX - r.left) / r.width) * W;
      let best = pts[0], bestD = Infinity;
      pts.forEach(p=>{ const d = Math.abs(p.x - sx); if(d < bestD){ bestD = d; best = p; } });
      guide.setAttribute('x1', best.x); guide.setAttribute('x2', best.x);
      guide.setAttribute('opacity', '.35');
      dot.setAttribute('cx', best.x); dot.setAttribute('cy', best.y); dot.setAttribute('opacity', '1');
      // day-over-day change reuses the same 0.1-display-unit threshold as the weight log's deltas,
      // so the same scale reading isn't called a gain in one place and flat in the other
      const d = best.delta;
      const deltaTxt = d == null || Math.abs(d) < 0.05 ? ''
        : '<span class="wt-tip-delta">' + (d > 0 ? '▲' : '▼') + ' ' + escapeHtml(String(roundWeight(Math.abs(d)))) + '</span>';
      tip.innerHTML = '<span class="wt-tip-date">'+escapeHtml(fmtDate(parseLocalDateStr(best.date).getTime()))+'</span>'
        + '<span class="wt-tip-val">'+escapeHtml(roundWeight(best.v)+' '+unitLabel())+deltaTxt+'</span>'
        + '<span class="wt-tip-ma">avg '+escapeHtml(roundWeight(best.ma)+' '+unitLabel())+'</span>';
      // clamp so the bubble can't hang off either edge of the card
      const px = (best.x / W) * r.width;
      tip.style.left = Math.max(60, Math.min(r.width - 60, px)) + 'px';
      tip.style.top = ((best.y / H) * r.height - 12) + 'px';
      tip.classList.add('on');
    }
    function hide(){
      guide.setAttribute('opacity', '0');
      dot.setAttribute('opacity', '0');
      tip.classList.remove('on');
    }
    svg.addEventListener('pointermove', e=> show(e.clientX));
    svg.addEventListener('pointerdown', e=> show(e.clientX));
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('pointercancel', hide);
  }

  /* ---- calorie budget check ---------------------------------------------------------------
     The question this panel answers is the one the calculator above it structurally cannot. The
     Mifflin formula guesses maintenance from height/age/sex and a five-step activity dropdown, and
     for any individual it is routinely a few hundred kcal out — which is the entire size of a
     deficit. So "is my budget working" can only be settled from the outside: eat a known amount,
     watch what the scale does over the same stretch, and the energy balance falls out of the two.
     Whatever you ate, minus whatever the scale says you banked or spent, is what you actually burn.

     Every figure here is therefore measured; the formula's TDEE appears only as the thing being
     checked, never as an input. The range isn't persisted, matching the weight chart's zoom. */
  const KCAL_RANGES = [
    {key:'7',  label:'7D',  days:7},
    {key:'14', label:'14D', days:14},
    {key:'30', label:'30D', days:30},
    {key:'90', label:'90D', days:90}
  ];
  /* 7D by default, not persisted. It is the most current answer the panel can give, and the one
       worth seeing first: what this week's eating did.

       It is also the noisiest, and the panel is honest about that on its own — a week gives the
       regression fewer weigh-ins to work from, so the maintenance figure moves around more than the
       14D one does, and the two gates below (half the window's days logged, three weigh-ins spanning
       five days) bite sooner on a week with a gap in it. When the estimate looks unstable, 14D is
       one tap away and is the steadier read. */
  let kcalRange = '7';

  // signed weekly rate, in whichever unit is on display — the pace dropdown is always kg/week, so
  // the plan figure is converted too rather than printing two units in one sentence
  function fmtWeeklyRate(kgPerWeek){
    const d0 = roundDisp(kgToDisplay(kgPerWeek));
    const d = Math.abs(d0) < 0.05 ? 0 : d0;      // roundDisp can hand back -0, which prints as "-0"
    return (d > 0 ? '+' : '') + d + ' ' + unitLabel() + '/wk';
  }

  /* Everything the panel states, worked out in one place so the verdict, the stat cards and the
     chart can never disagree about the same window. Returns a `need` code instead of null when
     there isn't enough logged yet: the partial figures are still worth showing, and the reader has
     to be told *what* to log rather than shown an empty card. */
  function calorieReview(days){
    const today = localDateStr(new Date());
    const start = shiftDateStr(today, -(days-1));
    const inWindow = e => e.date >= start && e.date <= today;
    const intake = calorieLog().filter(inWindow).sort((a,b)=> a.date.localeCompare(b.date));
    const weighIns = (state.fitness.weightLog||[]).filter(inWindow).sort((a,b)=> a.date.localeCompare(b.date));
    // Recorded burn is carried on the result so the panel can show it, and is deliberately absent
    // from every calculation below: estTdee is measured from the scale and already contains it.
    const acts = activityLog().filter(inWindow);
    const r = {
      days, start, today, intake, weighIns, acts,
      burnTotal: acts.reduce((sum,a)=> sum + (a.kcal||0), 0),
      avgBurn: acts.reduce((sum,a)=> sum + (a.kcal||0), 0) / days,
      formulaTdee: fitnessTdee(), formulaTarget: fitnessCalorieTarget(), wantWeekly: fitnessPaceWeekly(),
      avgIntake: null, weeklyKg: null, estTdee: null, suggested: null, need: null, needTxt: ''
    };
    if(!intake.length){
      r.need = 'intake';
      r.needTxt = 'Nothing logged in this window. Record what you eat each day and this works out what you actually burn.';
      return r;
    }
    // Averaged over the days actually logged, never over the window: a skipped day is unknown, and
    // counting it as zero would invent a deficit that never happened.
    r.avgIntake = intake.reduce((a,b)=> a + b.kcal, 0) / intake.length;
    // The estimate below reads that average as though it held all window long, though, so it needs
    // most of the days present before it can be trusted — half the window is the floor.
    const needDays = Math.max(4, Math.ceil(days * 0.5));
    if(intake.length < needDays){
      r.need = 'intake-more';
      r.needTxt = intake.length + ' of ' + days + ' days logged — about ' + (needDays - intake.length)
        + ' more and this can read your real maintenance.';
      return r;
    }
    const span = weighIns.length ? daysBetween(weighIns[0].date, weighIns[weighIns.length-1].date) : 0;
    if(weighIns.length < 3 || span < 5){
      r.need = 'weight';
      r.needTxt = 'Needs at least 3 weigh-ins spanning 5 days or more in this window to read a trend — '
        + weighIns.length + ' so far.';
      return r;
    }
    /* Least squares across every weigh-in, not last-minus-first: a single watery morning at either
       end moves an endpoint difference by most of a kilo, which over a 7-day window is a ~1,100
       kcal/day error — larger than the deficit being measured. x is days since the window start,
       so the slope is kg/day directly and irregular logging gaps cost nothing. */
    const xs = weighIns.map(e=> daysBetween(start, e.date));
    const ys = weighIns.map(e=> e.kg);
    const n = xs.length;
    const mx = xs.reduce((a,b)=>a+b,0)/n, my = ys.reduce((a,b)=>a+b,0)/n;
    let num = 0, den = 0;
    for(let i=0;i<n;i++){ num += (xs[i]-mx)*(ys[i]-my); den += (xs[i]-mx)*(xs[i]-mx); }
    if(den <= 0){ // every weigh-in on one date — no slope to read
      r.need = 'weight';
      r.needTxt = 'Needs weigh-ins on more than one day in this window.';
      return r;
    }
    const slope = num/den;                                  // kg per day
    r.weeklyKg = slope * 7;
    r.estTdee = r.avgIntake - slope * KCAL_PER_KG;          // ate − banked = burned
    // What to eat to hit the planned pace against the maintenance just measured — the actual answer
    // to "should I adjust". With no target weight the plan is to hold, so it lands on maintenance.
    r.suggested = Math.round((r.estTdee + (r.wantWeekly * KCAL_PER_KG) / 7) / 10) * 10;
    return r;
  }

  function kcalStatCard(num, lbl, sub, cls){
    return '<div class="kcal-stat"><div class="num'+(cls ? ' '+cls : '')+'">'+escapeHtml(String(num))+'</div>'
      + '<div class="lbl">'+escapeHtml(lbl)+'</div>'
      + (sub ? '<div class="sub">'+escapeHtml(sub)+'</div>' : '')
      + '</div>';
  }

  function renderCalorieReview(){
    const rangeRow = el('kcalRangeRow'); if(!rangeRow) return;
    rangeRow.innerHTML = KCAL_RANGES.map(z=>
      '<button type="button" class="chart-zoom-btn'+(kcalRange===z.key?' active':'')+'"'
      + (kcalRange===z.key?' aria-current="true"':'')+' data-krange="'+z.key+'">'+z.label+'</button>'
    ).join('');
    rangeRow.querySelectorAll('.chart-zoom-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{ kcalRange = btn.dataset.krange; renderCalorieReview(); });
    });

    const opt = KCAL_RANGES.find(z=>z.key===kcalRange) || KCAL_RANGES[1];
    const r = calorieReview(opt.days);
    const kc = v => Math.round(v).toLocaleString();

    /* Verdict — the chip carries the action, the note carries the evidence it came from, and the
       words repeat whatever the colour says so the panel survives greyscale. "Eat 200 less" is
       violet rather than red on purpose: being off by a couple of hundred kcal is a dial to turn,
       not a failure. Red is kept for the one case that genuinely is one — the weight moving away
       from the target while you were following the budget. */
    let chip = '', tone = 'flat', note = '';
    if(r.need){
      chip = r.avgIntake != null ? kc(r.avgIntake) + ' kcal/day avg' : 'Not enough logged yet';
      note = r.needTxt;
    } else {
      const diff = Math.round((r.suggested - r.avgIntake) / 10) * 10;
      const wrongWay = r.wantWeekly !== 0 && Math.abs(r.weeklyKg) >= 0.1
        && Math.sign(r.weeklyKg) !== Math.sign(r.wantWeekly);
      if(wrongWay){
        tone = 'bad';
        chip = 'Moving away from target';
      } else if(Math.abs(diff) <= 60){
        // inside the noise of food logging itself — telling someone to shave 30 kcal would be
        // false precision, and "it's working" is the more useful sentence
        tone = 'good';
        chip = r.wantWeekly === 0 ? 'Holding steady' : 'Budget is working';
      } else {
        tone = 'neutral';
        chip = 'Eat ' + kc(Math.abs(diff)) + ' kcal/day ' + (diff > 0 ? 'more' : 'less');
      }
      note = 'Averaged ' + kc(r.avgIntake) + ' kcal/day and moved ' + fmtWeeklyRate(r.weeklyKg)
        + (r.wantWeekly === 0 ? ' · no target weight set' : ' · plan is ' + fmtWeeklyRate(r.wantWeekly))
        + ' · eat ~' + kc(r.suggested) + ' kcal/day to ' + (r.wantWeekly === 0 ? 'hold steady' : 'hit it');
    }
    el('kcalVerdict').innerHTML = '<span class="wt-delta-val '+tone+'">'+escapeHtml(chip)+'</span>'
      + '<span class="wt-delta-note">'+escapeHtml(note)+'</span>';

    const cards = [];
    if(r.avgIntake != null){
      cards.push(kcalStatCard(kc(r.avgIntake), 'Avg intake', r.intake.length + ' of ' + r.days + ' days logged'));
    }
    if(r.estTdee != null){
      let sub = 'measured from intake + weight trend';
      if(r.formulaTdee != null){
        const off = Math.round(r.estTdee - r.formulaTdee);
        sub = 'formula says ' + kc(r.formulaTdee)
          + (Math.abs(off) >= 25 ? ' · ' + (off > 0 ? '+' : '−') + kc(Math.abs(off)) + ' out' : ' · matches');
      }
      cards.push(kcalStatCard(kc(r.estTdee), 'Real maintenance', sub));
    }
    if(r.weeklyKg != null){
      // green/red here is "toward the target", the same rule the weight chart's headline uses —
      // cutting and bulking are both progress, so down is not automatically good
      let cls = '';
      if(r.wantWeekly !== 0 && Math.abs(r.weeklyKg) >= 0.05){
        cls = Math.sign(r.weeklyKg) === Math.sign(r.wantWeekly) ? 'pos' : 'neg';
      }
      cards.push(kcalStatCard(fmtWeeklyRate(r.weeklyKg), 'Weight trend',
        r.wantWeekly === 0 ? 'no target weight set' : 'plan ' + fmtWeeklyRate(r.wantWeekly), cls));
    }
    if(r.acts && r.acts.length){
      cards.push(kcalStatCard(kc(r.avgBurn), 'Avg activity',
        r.acts.length + ' session' + (r.acts.length===1?'':'s')
        + (r.estTdee != null ? ' · already inside the maintenance' : ' logged')));
    }
    if(r.suggested != null){
      const diff = Math.round((r.suggested - r.avgIntake) / 10) * 10;
      cards.push(kcalStatCard(kc(r.suggested), r.wantWeekly === 0 ? 'To hold steady' : 'Suggested budget',
        Math.abs(diff) <= 60 ? 'about what you already eat'
          : (diff > 0 ? '+' : '−') + kc(Math.abs(diff)) + ' vs your average'));
    }
    el('kcalStats').innerHTML = cards.join('');

    const drewTarget = renderCalorieChart(r);
    const legendEl = el('kcalChartLegend');
    if(!r.intake.length) legendEl.innerHTML = '';
    else if(drewTarget){
      legendEl.innerHTML = '<span><span class="dot" style="background:var(--violet);"></span>On budget</span>'
        + '<span><span class="dot" style="background:var(--gold);"></span>'
        + (r.wantWeekly > 0 ? 'Under budget' : 'Over budget') + '</span>'
        + '<span><span class="dot dash" style="color:var(--muted);"></span>Daily budget</span>';
    } else {
      legendEl.innerHTML = '<span><span class="dot" style="background:var(--violet);"></span>Daily intake</span>';
    }
  }

  /* Daily intake as bars against the budget line. Bars rather than a line because intake is a set
     of separate days, not a continuous quantity — and an unlogged day has to read as a gap, which
     a line would quietly interpolate straight across. Sized the same way as the weight chart: type
     and gutters in rendered pixels, converted into viewBox units by k. Returns whether a budget
     line was drawn, since the legend can only name it if it's there. */
  function renderCalorieChart(r){
    const wrap = el('kcalChartWrap');
    if(!r.intake.length){
      wrap.innerHTML = '<div class="wt-chart-empty">Log a day of calories to start the chart.</div>';
      return false;
    }
    const wrapW = Math.max(260, wrap.clientWidth || 780);
    const k = 780 / wrapW;
    const W = 780;
    const H = Math.round((wrapW < 560 ? 150 : 200) * k);
    const fs = +(11 * k).toFixed(1);
    const padL = Math.round(fs * 3.1 + 10 * k);
    const padR = Math.round(14 * k), padT = Math.round(16 * k), padB = Math.round(fs + 16 * k);

    const target = r.formulaTarget;
    // bars start at zero — a truncated baseline would make a 5% overshoot look like a doubling
    const maxV = (Math.max(...r.intake.map(e=>e.kcal), target != null ? target : 0) * 1.12) || 1;
    const yOf = v => padT + (1 - v/maxV) * (H - padT - padB);
    const floor = H - padB;
    const slot = (W - padL - padR) / r.days;
    const barW = Math.max(2 * k, Math.min(slot * 0.72, 26 * k));
    // +0.5 centres the bar in its day's slot, so the first and last bars sit inside the plot
    const xOf = dateStr => padL + (daysBetween(r.start, dateStr) + 0.5) * slot;

    let gridSvg = '';
    for(let i=0;i<=3;i++){
      const v = maxV * (i/3), y = yOf(v);
      gridSvg += '<line x1="'+padL+'" y1="'+y.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+y.toFixed(1)+'" stroke="var(--border)" stroke-width="'+k.toFixed(2)+'" opacity=".7"/>'
        + '<text x="'+(padL-Math.round(8*k))+'" y="'+(y+fs*0.34).toFixed(1)+'" font-size="'+fs+'" fill="var(--muted)" text-anchor="end">'+Math.round(v/10)*10+'</text>';
    }

    /* Which side of the budget counts as the miss depends on which way you're going: on a cut the
       over-budget days are the ones that matter, on a bulk it's the days you under-ate. */
    const overIsMiss = r.wantWeekly <= 0;
    let barsSvg = '';
    r.intake.forEach(e=>{
      const y = yOf(e.kcal);
      const miss = target != null && (overIsMiss ? e.kcal > target : e.kcal < target);
      barsSvg += '<rect x="'+(xOf(e.date)-barW/2).toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+barW.toFixed(1)+'"'
        + ' height="'+Math.max(0, floor-y).toFixed(1)+'" rx="'+(2*k).toFixed(1)+'"'
        + ' fill="'+(miss ? 'var(--gold)' : 'var(--violet)')+'" opacity=".85">'
        + '<title>'+escapeHtml(fmtDate(parseLocalDateStr(e.date).getTime())+' · '+Math.round(e.kcal).toLocaleString()+' kcal')+'</title></rect>';
    });

    // the budget line is an annotation over the bars, so it's neutral ink and dashed — the same
    // treatment (and the same reasoning) as the target line on the weight chart
    let targetSvg = '';
    if(target != null && target > 0 && target < maxV){
      const ty = yOf(target);
      targetSvg = '<line x1="'+padL+'" y1="'+ty.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+ty.toFixed(1)+'" stroke="var(--text)" stroke-width="'+(1.1*k).toFixed(2)+'" stroke-dasharray="'+(2.5*k).toFixed(1)+','+(3.5*k).toFixed(1)+'" opacity=".45"/>'
        + '<text x="'+(W-padR)+'" y="'+(ty-4*k).toFixed(1)+'" font-size="'+(fs*0.9).toFixed(1)+'" fill="var(--muted)" text-anchor="end" font-weight="700">Budget '+Math.round(target).toLocaleString()+'</text>';
    }

    const narrow = wrapW < 560;
    const axisDate = ds => narrow
      ? parseLocalDateStr(ds).toLocaleDateString(undefined,{month:'short',day:'numeric'})
      : fmtDate(parseLocalDateStr(ds).getTime());
    const xLabelSvg = '<text x="'+padL+'" y="'+(H-Math.round(5*k))+'" font-size="'+fs+'" fill="var(--muted)" text-anchor="start">'+escapeHtml(axisDate(r.start))+'</text>'
      + '<text x="'+(W-padR)+'" y="'+(H-Math.round(5*k))+'" font-size="'+fs+'" fill="var(--muted)" text-anchor="end">'+escapeHtml(axisDate(r.today))+'</text>';

    wrap.innerHTML = '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Daily calorie intake over the last '+r.days+' days">'
      + gridSvg + xLabelSvg + barsSvg + targetSvg
      + '</svg>';
    observeCalorieChartWidth(wrap);
    return !!targetSvg;
  }

  /* ================= SLEEP =====================================================================
     A night is stored as the two clock times it actually was — {id, date, bed, wake, mins,
     quality} — and filed under the date you WOKE UP on, so a sleep crossing midnight belongs to
     exactly one date. `mins` is derived from bed/wake at write time rather than at read time: the
     times are what the consistency figure is measured from, and the duration is what every other
     figure wants, so caching it keeps the chart from re-deriving a wrap-around on every repaint.

     UNLIKE weightLog/calorieLog, `date` is not unique here — a day can hold more than one session
     (a nap, then a full night), and both have to survive. Identity is `id` (recordSleepLog()
     always appends a fresh one; nothing here ever writes onto an existing record by matching its
     date), which is what fixes the toggle silently erasing an earlier nap the moment a second
     sleep the same day was logged. Anything that asks "how did the DAY go" — the review's
     averages, the goal-hit count, sleep debt, the chart — reads sleepDayAgg()'s per-date sums
     instead of the raw array, so a nap on top of a full night correctly adds to the day's total
     rather than counting as its own separate short "night". The hero and the battery stay
     session-level on purpose: they answer "what is the state of the charge right now", which is
     whichever session most recently ended, not a day-blended figure.

     Same flat array shape as weightLog and calorieLog otherwise, and it rides the shared blob
     with them — which is why nothing here writes per keystroke except through debouncedSave(). */
  function sleepLog(){
    if(!state.fitness.sleepLog) state.fitness.sleepLog = [];
    return state.fitness.sleepLog;
  }
  function sleepGoalHours(){
    const g = parseFloat(state.fitness.sleepGoal);
    return (!isNaN(g) && g > 0) ? g : 8;
  }
  // 'HH:MM' -> minutes past midnight, or null for anything that isn't one
  function clockMins(hhmm){
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm||''));
    if(!m) return null;
    const h = +m[1], mi = +m[2];
    if(h > 23 || mi > 59) return null;
    return h*60 + mi;
  }
  function fmtClock(mins){
    const m = ((mins % 1440) + 1440) % 1440;
    const d = new Date(2000, 0, 1, Math.floor(m/60), m%60);
    return d.toLocaleTimeString(undefined, {hour:'numeric', minute:'2-digit'});
  }
  /* Wrapping is the normal case here, not the edge one: a bed time later in the clock than the wake
     time simply means the night crossed midnight, which almost every night does. Equal times are
     rejected rather than read as 24 hours. */
  function sleepDuration(bed, wake){
    const b = clockMins(bed), w = clockMins(wake);
    if(b == null || w == null || b === w) return null;
    return w > b ? w - b : (1440 - b) + w;
  }
  function fmtDuration(mins){
    const h = Math.floor(mins/60), m = Math.round(mins%60);
    return h + 'h' + (m ? ' ' + m + 'm' : '');
  }
  // Always inserts — never looks for an existing record to overwrite. See the header note
  // above: that overwrite is exactly the bug where a second sleep the same day erased the first.
  function recordSleepLog(dateStr, rec){
    sleepLog().push(Object.assign({ id: uid(), date: dateStr }, rec));
  }
  // ms timestamp of the moment a session ended — the wake clock time applied to the date it is
  // filed under, which is the wake date by definition, so no day offset is needed
  function sleepWakeTs(rec){
    const w = clockMins(rec && rec.wake);
    if(w == null) return null;
    return parseLocalDateStr(rec.date).getTime() + w * 60000;
  }
  // date first, then chronological within a date — a nap and a later full night share a date but
  // must still sort nap-then-night, so "the latest session" (the hero, the battery) and "newest
  // first" (the list) both read true even when two sessions land on the same day
  function sleepChronoCompare(a, b){
    const d = a.date.localeCompare(b.date);
    return d || ((sleepWakeTs(a)||0) - (sleepWakeTs(b)||0));
  }
  /* One row per calendar day, built from every session filed under it — the total minutes slept
     that day, and `main` (the longest session) standing in for "the night" wherever a day can
     only sensibly have one bed/wake pair, such as the bedtime-consistency figure: a nap's bed
     time would otherwise add noise to a reading about when you actually go down for the night. */
  function sleepDayAgg(sortedNights){
    const byDate = new Map();
    sortedNights.forEach(n=>{
      let d = byDate.get(n.date);
      if(!d){ d = { date:n.date, mins:0, sessions:[], main:n }; byDate.set(n.date, d); }
      d.mins += n.mins;
      d.sessions.push(n);
      if(n.mins > d.main.mins) d.main = n;
    });
    return Array.from(byDate.values()).sort((a,b)=> a.date.localeCompare(b.date));
  }
  /* Bedtimes placed on an axis centred on midnight — 23:30 is −30 and 00:30 is +30 — so the spread
     of a person who goes to bed either side of midnight reads as an hour rather than as 23. Times
     from 18:00 on are the previous evening; anything earlier is that morning. */
  function bedAxis(bed){
    const b = clockMins(bed);
    return b == null ? null : (b >= 18*60 ? b - 1440 : b);
  }

  /* ---- the review ---------------------------------------------------------------------------
     Same contract as calorieReview(): one place works out everything the verdict, the stat cards
     and the chart state, so the three can never disagree about the same window. Averages are over
     the nights actually logged, never over the window — a missing night is unknown, and counting
     it as zero would invent an all-nighter that never happened. */
  const SLEEP_RANGES = [
    {key:'7',  label:'7D',  days:7},
    {key:'14', label:'14D', days:14},
    {key:'30', label:'30D', days:30},
    {key:'90', label:'90D', days:90}
  ];
  let sleepRange = '7';   // not persisted, the kcalRange rule — the most current answer first

  function sleepReview(days){
    const today = localDateStr(new Date());
    const start = shiftDateStr(today, -(days-1));
    const raw = sleepLog()
      .filter(e => e.date >= start && e.date <= today && e.mins > 0)
      .sort(sleepChronoCompare);
    // `nights` is one row per DAY, not per session — see sleepDayAgg()'s note above. avgMins,
    // hitNights and debtMins all read this, so a nap stacked on a full night correctly adds to
    // that day's total instead of counting as its own separate short night.
    const nights = sleepDayAgg(raw);
    const goalMins = sleepGoalHours() * 60;
    const r = {
      days, start, today, nights, goalMins,
      avgMins:null, avgBed:null, bedSpread:null, avgQuality:null, hitNights:0, debtMins:0
    };
    if(!nights.length) return r;
    r.avgMins = nights.reduce((a,d)=> a + d.mins, 0) / nights.length;
    r.hitNights = nights.filter(d=> d.mins >= goalMins - 15).length;
    // Debt is only ever counted from the days that fell SHORT: a long lie-in does not give back
    // the sleep an earlier night lost, so letting surplus cancel shortfall would read a wrecked
    // week with one 11-hour Sunday as a week with no debt at all.
    r.debtMins = nights.reduce((a,d)=> a + Math.max(0, goalMins - d.mins), 0);
    // the day's MAIN session only — a nap's bed time would otherwise pollute a figure that is
    // meant to answer "how steady is your actual bedtime"
    const beds = nights.map(d=> bedAxis(d.main.bed)).filter(v=> v != null);
    if(beds.length){
      const mb = beds.reduce((a,b)=>a+b,0)/beds.length;
      r.avgBed = mb;
      r.bedSpread = Math.sqrt(beds.reduce((a,b)=> a + (b-mb)*(b-mb), 0) / beds.length);
    }
    // quality is rated per session (the chips show on every Log), so this reads every rated
    // session in the window rather than only each day's main one
    const q = raw.filter(n=> n.quality > 0);
    if(q.length) r.avgQuality = q.reduce((a,b)=> a + b.quality, 0) / q.length;
    return r;
  }

  const SLEEP_QUALITY = [
    {v:1, emoji:'😩', label:'Awful'},
    {v:2, emoji:'😕', label:'Poor'},
    {v:3, emoji:'😐', label:'OK'},
    {v:4, emoji:'🙂', label:'Good'},
    {v:5, emoji:'😴', label:'Great'}
  ];
  let sleepQualityDraft = 0;   // what the chips are showing before Log is pressed

  function sleepNightDate(){ return shiftDateStr(localDateStr(new Date()), -(+(el('slNight').value || 0))); }

  function renderSleepQualityChips(){
    const row = el('slQualRow'); if(!row) return;
    row.innerHTML = SLEEP_QUALITY.map(q =>
      '<button type="button" class="sleep-qchip'+(sleepQualityDraft===q.v?' active':'')+'"'
      + ' data-sq="'+q.v+'" aria-pressed="'+(sleepQualityDraft===q.v)+'"'
      + ' title="'+escapeHtml(q.label)+'"><span aria-hidden="true">'+q.emoji+'</span>'
      + '<span class="sleep-qchip-lbl">'+escapeHtml(q.label)+'</span></button>'
    ).join('');
  }

  function updateSleepHint(){
    const hint = el('slAddHint'); if(!hint) return;
    const ds = sleepNightDate();
    const mins = sleepDuration(el('slBed').value, el('slWake').value);
    const woke = fmtDate(parseLocalDateStr(ds).getTime());
    hint.textContent = mins == null
      ? 'Filed under the morning you woke up — ' + woke + '.'
      : fmtDuration(mins) + ' asleep, filed under ' + woke + '.';
  }

  function addSleepEntry(){
    const bed = el('slBed').value, wake = el('slWake').value;
    const mins = sleepDuration(bed, wake);
    if(mins == null){ el('slAddHint').textContent = 'Enter both a bed time and a wake time.'; return; }
    const rec = {bed, wake, mins};
    // an unrated session is a session with no rating, not a session rated zero, so the key is
    // only written when there is one
    if(sleepQualityDraft) rec.quality = sleepQualityDraft;
    // recordSleepLog() always creates a new record — logging a nap and, later the same day, a
    // full night no longer overwrites the first one; both survive as separate rows in the list
    // and both count toward that day's total in the review. Correcting a session already typed
    // in is done from the list below (delete and re-log) rather than by retyping over it here.
    recordSleepLog(sleepNightDate(), rec);
    sleepQualityDraft = 0;
    el('slBed').value = ''; el('slWake').value = '';
    save(); renderSleep();
  }

  function renderSleepHero(){
    const valEl = el('sleepHeroVal'); if(!valEl) return;
    const asEl = el('sleepHeroAs'), chipsEl = el('sleepHeroChips'), railEl = el('sleepHeroRail');
    const log = sleepLog().slice().filter(e=>e.mins > 0).sort(sleepChronoCompare);
    const latest = log[log.length-1] || null;
    const goalMins = sleepGoalHours() * 60;

    valEl.innerHTML = latest
      ? escapeHtml(String(Math.floor(latest.mins/60))) + '<span class="fit-hero-unit">h</span>'
        + (latest.mins%60 ? escapeHtml(String(Math.round(latest.mins%60))) + '<span class="fit-hero-unit">m</span>' : '')
      : '<span class="fit-hero-none">—</span>';

    const todayStr = localDateStr(new Date());
    asEl.textContent = !latest ? 'No nights logged yet — the fields below start the log.'
      // textContent, so no escaping here — escapeHtml would print the entities literally
      : latest.date === todayStr ? fmtClock(clockMins(latest.bed)) + ' → ' + fmtClock(clockMins(latest.wake))
      : 'Last logged ' + fmtDate(parseLocalDateStr(latest.date).getTime());

    const chips = [];
    /* A night in progress is the first thing the pane should say — the quick-actions toggle is
       running, so last night's figure beside it would read as tonight's. It is a chip rather than
       a replacement for the reading, because the reading is still true of the last night that
       finished, and the elapsed time is deliberately not live here: this pane isn't the ticker,
       the bar is. */
    const pend = (typeof sleepPendingElapsed === 'function') ? sleepPendingElapsed() : null;
    if(pend != null){
      chips.push('<span class="fit-chip fit-chip-tier"><span aria-hidden="true">🌙</span> '
        + escapeHtml('Asleep — ' + fmtDuration(Math.floor(pend/60000)) + ' so far') + '</span>');
    }
    if(latest){
      const off = latest.mins - goalMins;
      const tone = off >= -15 ? 'good' : off >= -75 ? 'neutral' : 'bad';
      chips.push('<span class="fit-chip fit-chip-'+tone+'">'
        + (off >= -15 ? 'Hit the goal' : fmtDuration(Math.abs(off)) + ' short') + '</span>');
      const q = SLEEP_QUALITY.find(x=>x.v === latest.quality);
      if(q) chips.push('<span class="fit-chip fit-chip-tier"><span aria-hidden="true">'+q.emoji+'</span> '
        + escapeHtml(q.label) + '</span>');
    }
    chipsEl.innerHTML = chips.join('');

    renderSleepBattery();
  }

  /* ---- the sleep battery ----------------------------------------------------------------------
     How much of the night you are still running on, right now. A full night charges it to 100% and
     it empties across the hours you would normally be awake, so a short night both starts lower AND
     runs out earlier — which is the whole reading. A static "you slept 6h" tells you what happened;
     this tells you what it is costing you at 4pm.

     The maths is deliberately one line of physics rather than a model of anything: charge is last
     night against the goal, the waking day is 24h minus the goal (16h on an 8h goal), and the level
     is the charge minus how far into that day you are. Nothing here claims to be alertness — it is
     the goal you set, spread over the day it was meant to cover. Four rules.

       · It charges from the LAST FINISHED night, and while the quick-actions toggle is running it
         is charging instead — a battery that ignored the night in progress would sit at 0% at the
         exact moment you are doing the thing that fills it.
       · The waking day is 24h − goal, not a typed figure. It is the only definition that makes 100%
         mean "a full night ago" and 0% mean "you are due the next one", and it moves correctly when
         the goal does.
       · A night older than SLEEP_BATT_STALE_H is not drawn as a flat battery but as a prompt. A
         reading of 0% is a claim about right now; if the last night on record is Tuesday's, the
         honest answer is that there is no reading, not that you are empty.
       · It re-renders on a minute timer, and only while this pane is the visible one — the calorie
         chart's ResizeObserver reasoning: a redraw for a hidden pane is a redraw nobody can see.
       · It reads the LATEST SESSION, not the latest day — a nap logged mid-afternoon and a full
         night logged that evening both file under the same date now (recordSleepLog() never
         overwrites), and the battery has to pick the one that actually just ended, which
         sleepChronoCompare()'s within-day tiebreak by wake time is what guarantees. */
  const SLEEP_BATT_STALE_H = 30;    // past this the last session can't describe now
  // sleepWakeTs() / sleepChronoCompare() are defined once, up by recordSleepLog() — this is the
  // one other place in the file that needs "which session ended most recently" on a day that may
  // hold more than one.

  function sleepBattery(){
    const goalMins = sleepGoalHours() * 60;
    const pend = (typeof sleepPendingElapsed === 'function') ? sleepPendingElapsed() : null;
    if(pend != null){
      // asleep: filling toward the goal, and it can pass it — sleeping past the goal is not an
      // error, so the bar caps at 100% while the caption keeps counting
      return { state:'charging', level: Math.min(1, pend / (goalMins*60000)), elapsedMs: pend };
    }
    const log = sleepLog().slice().filter(e=> e.mins > 0 && clockMins(e.wake) != null)
      .sort(sleepChronoCompare);
    const last = log[log.length-1] || null;
    if(!last) return { state:'none' };
    const wokeAt = sleepWakeTs(last);
    // a wake stamp in the future means a corrected clock or a hand-typed time, not a charged
    // battery — treat the awake span as zero rather than drawing an over-full bar
    const awakeMs = Math.max(0, Date.now() - wokeAt);
    if(awakeMs > SLEEP_BATT_STALE_H * 3600000) return { state:'stale', last, awakeMs };
    const charge = Math.min(1, last.mins / goalMins);
    const dayMs = Math.max(1, (24 - sleepGoalHours()) * 3600000);
    const level = Math.max(0, charge - awakeMs / dayMs);
    return {
      state:'draining', last, charge, level, awakeMs,
      emptyAt: wokeAt + charge * dayMs
    };
  }

  // one class for the bar and the figure, so the colour and the words can't disagree
  function sleepBattTone(level){ return level >= 0.5 ? 'good' : level >= 0.2 ? 'warn' : 'low'; }

  function renderSleepBattery(){
    const railEl = el('sleepHeroRail'); if(!railEl) return;
    const b = sleepBattery();
    const goalH = sleepGoalHours();

    if(b.state === 'none'){
      railEl.innerHTML = '<p class="fit-rail-none">Log a night — or tap 🌙 in the corner on your way '
        + 'to bed — and this becomes a battery that charges as you sleep and empties across the day.</p>';
      syncSleepBatteryTicker();
      return;
    }
    if(b.state === 'stale'){
      railEl.innerHTML = '<p class="fit-rail-none">'
        + escapeHtml('Last night on record is ' + fmtDate(parseLocalDateStr(b.last.date).getTime())
          + ' — too long ago to say anything about today. Log a night to bring the battery back.')
        + '</p>';
      syncSleepBatteryTicker();
      return;
    }

    const pct = Math.round(b.level * 100);
    const charging = b.state === 'charging';
    const tone = charging ? 'good' : sleepBattTone(b.level);
    let caption, right;
    if(charging){
      caption = 'Charging · ' + fmtDuration(Math.floor(b.elapsedMs/60000)) + ' of ' + goalH + 'h';
      right = pct >= 100 ? 'Full' : fmtDuration(Math.max(0, Math.round(goalH*60 - b.elapsedMs/60000))) + ' to full';
    } else if(b.level <= 0){
      caption = 'Flat — running on ' + fmtDuration(b.last.mins) + ' from last night';
      right = 'Due a night';
    } else {
      const leftMs = b.emptyAt - Date.now();
      caption = 'Charged ' + Math.round(b.charge*100) + '% by ' + fmtDuration(b.last.mins) + ' last night';
      right = 'Empty by ' + fmtClock(new Date(b.emptyAt).getHours()*60 + new Date(b.emptyAt).getMinutes())
        + ' · ' + fmtDuration(Math.max(0, Math.round(leftMs/60000))) + ' left';
    }

    /* The nub on the right is what makes this read as a battery rather than as another progress
       rail — the pane already has one of those on the Weight side, and the two mean different
       things. The ticks are at the quarters, drawn inside the track so they show through the fill:
       a bar with no marks on it can only be read as "roughly half". */
    railEl.innerHTML =
      '<div class="sleep-batt is-'+tone+(charging?' is-charging':'')+'">'
      + '<div class="sleep-batt-body" role="progressbar" aria-valuemin="0" aria-valuemax="100"'
      +   ' aria-valuenow="'+pct+'" aria-label="Sleep battery"'
      +   ' aria-valuetext="'+escapeHtml(pct+'% — '+caption+' · '+right)+'">'
      +   '<span class="sleep-batt-fill" style="width:'+Math.max(0,Math.min(100,pct))+'%"></span>'
      +   '<span class="sleep-batt-ticks" aria-hidden="true"><i></i><i></i><i></i></span>'
      +   '<span class="sleep-batt-pct">'+pct+'%'+(charging?' <span class="sleep-batt-bolt" aria-hidden="true">⚡</span>':'')+'</span>'
      + '</div>'
      + '<span class="sleep-batt-nub" aria-hidden="true"></span>'
      + '</div>'
      + '<div class="fit-rail-ends">'
      +   '<span class="sleep-batt-cap">'+escapeHtml(caption)+'</span>'
      +   '<span class="sleep-batt-cap to">'+escapeHtml(right)+'</span>'
      + '</div>';
    syncSleepBatteryTicker();
  }

  /* The battery moves without anything happening, so it has to redraw on a clock. Once a minute is
     all the display can show — over a 16-hour day that is a tenth of a percent per tick — and the
     timer exists only while the Sleep pane is the visible one and the tab is in front, which is the
     same gate syncValLivePolling() and syncTftLobbyPolling() use for the same reason. */
  let sleepBattTicker = null;
  function sleepBatteryVisible(){
    return !document.hidden && fitnessSubTab === 'sleep'
      && document.querySelector('#view-fitness.active') != null;
  }
  function syncSleepBatteryTicker(){
    const want = sleepBatteryVisible();
    if(want && !sleepBattTicker) sleepBattTicker = setInterval(renderSleepBattery, 60000);
    else if(!want && sleepBattTicker){ clearInterval(sleepBattTicker); sleepBattTicker = null; }
  }
  document.addEventListener('visibilitychange', ()=>{
    if(!document.hidden && sleepBatteryVisible()) renderSleepBattery();
    else syncSleepBatteryTicker();
  });

  function renderSleepReview(){
    const rangeRow = el('slRangeRow'); if(!rangeRow) return;
    rangeRow.innerHTML = SLEEP_RANGES.map(z=>
      '<button type="button" class="chart-zoom-btn'+(sleepRange===z.key?' active':'')+'"'
      + (sleepRange===z.key?' aria-current="true"':'')+' data-slrange="'+z.key+'">'+z.label+'</button>'
    ).join('');
    rangeRow.querySelectorAll('.chart-zoom-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{ sleepRange = btn.dataset.slrange; renderSleepReview(); });
    });

    const opt = SLEEP_RANGES.find(z=>z.key===sleepRange) || SLEEP_RANGES[0];
    const r = sleepReview(opt.days);

    /* The verdict answers the one question the panel is for — am I sleeping enough — and the note
       under it carries the evidence, so the sentence still works in greyscale. Consistency is
       reported as a second clause rather than as its own verdict: a steady 5 hours is not a good
       week, so the bedtime spread only ever qualifies the duration. */
    let chip = '', tone = 'flat', note = '';
    if(!r.nights.length){
      chip = 'Nothing logged yet';
      note = 'Log a night above and this reads your average, your debt and how steady your bedtime is.';
    } else {
      const off = r.avgMins - r.goalMins;
      if(off >= -15){ tone = 'good'; chip = 'Sleeping enough'; }
      else if(off >= -60){ tone = 'neutral'; chip = fmtDuration(Math.round(-off)) + ' under most nights'; }
      else { tone = 'bad'; chip = 'Short by ' + fmtDuration(Math.round(-off)) + ' a night'; }
      note = 'Averaged ' + fmtDuration(Math.round(r.avgMins)) + ' across '
        + r.nights.length + ' of ' + r.days + ' nights · hit the goal ' + r.hitNights + ' time'
        + (r.hitNights===1?'':'s')
        + (r.bedSpread != null
            ? ' · bedtime varies by about ' + Math.round(r.bedSpread) + ' min'
            : '');
    }
    el('slVerdict').innerHTML = '<span class="wt-delta-val '+tone+'">'+escapeHtml(chip)+'</span>'
      + '<span class="wt-delta-note">'+escapeHtml(note)+'</span>';

    const cards = [];
    if(r.avgMins != null){
      cards.push(kcalStatCard(fmtDuration(Math.round(r.avgMins)), 'Avg sleep',
        r.nights.length + ' of ' + r.days + ' nights logged'));
      cards.push(kcalStatCard(r.hitNights + '/' + r.nights.length, 'Nights on goal',
        sleepGoalHours() + 'h or more', r.hitNights >= r.nights.length/2 ? 'pos' : ''));
      cards.push(kcalStatCard(r.debtMins ? fmtDuration(Math.round(r.debtMins)) : '0h', 'Sleep debt',
        'summed shortfall, surplus never repays it', r.debtMins > 0 ? 'neg' : 'pos'));
    }
    if(r.avgBed != null){
      /* Against the target bedtime when there is one, and only the spread when there isn't —
         "±20 min" is the useful half of the answer either way, since a steady bedtime is what
         actually moves the duration, and a target with no spread beside it says nothing about
         whether you keep it. */
      const targetBed = bedAxis(state.fitness.sleepBedGoal);
      const spread = r.bedSpread != null ? '±' + Math.round(r.bedSpread) + ' min' : '';
      let sub = spread;
      if(targetBed != null){
        const off = Math.round(r.avgBed - targetBed);
        sub = (Math.abs(off) <= 10 ? 'on your ' + fmtClock(targetBed) + ' target'
              : Math.abs(off) + ' min ' + (off > 0 ? 'later than' : 'earlier than') + ' ' + fmtClock(targetBed))
            + (spread ? ' · ' + spread : '');
      }
      cards.push(kcalStatCard(fmtClock(r.avgBed), 'Usual bedtime', sub));
    }
    if(r.avgQuality != null){
      const near = SLEEP_QUALITY[Math.max(0, Math.min(4, Math.round(r.avgQuality) - 1))];
      cards.push(kcalStatCard(Math.round(r.avgQuality*10)/10 + '/5', 'Avg quality', near ? near.label : ''));
    }
    el('slStats').innerHTML = cards.join('');

    renderSleepChart(r);
    el('slChartLegend').innerHTML = !r.nights.length ? ''
      : '<span><span class="dot" style="background:var(--violet);"></span>On goal</span>'
        + '<span><span class="dot" style="background:var(--gold);"></span>Short</span>'
        + '<span><span class="dot dash" style="color:var(--muted);"></span>Nightly goal</span>';
  }

  /* Hours per night as bars against the goal line — the calorie chart's shape and, for the same
     reason, its geometry: bars because nights are separate quantities and an unlogged night has to
     read as a gap rather than as a line drawn straight across it. */
  function renderSleepChart(r){
    const wrap = el('slChartWrap');
    if(!r.nights.length){
      wrap.innerHTML = '<div class="wt-chart-empty">Log a night to start the chart.</div>';
      return;
    }
    const wrapW = Math.max(260, wrap.clientWidth || 780);
    const k = 780 / wrapW;
    const W = 780;
    const H = Math.round((wrapW < 560 ? 150 : 200) * k);
    const fs = +(11 * k).toFixed(1);
    const padL = Math.round(fs * 2.4 + 10 * k);
    const padR = Math.round(14 * k), padT = Math.round(16 * k), padB = Math.round(fs + 16 * k);

    const goalH = r.goalMins / 60;
    // zero-based like the intake chart: a truncated baseline would draw six hours as half of eight
    const maxH = Math.max(...r.nights.map(d=> d.mins/60), goalH) * 1.12;
    const yOf = h => padT + (1 - h/maxH) * (H - padT - padB);
    const floor = H - padB;
    const slot = (W - padL - padR) / r.days;
    const barW = Math.max(2 * k, Math.min(slot * 0.72, 26 * k));
    const xOf = ds => padL + (daysBetween(r.start, ds) + 0.5) * slot;

    let gridSvg = '';
    for(let i=0;i<=3;i++){
      const v = maxH * (i/3), y = yOf(v);
      gridSvg += '<line x1="'+padL+'" y1="'+y.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+y.toFixed(1)+'" stroke="var(--border)" stroke-width="'+k.toFixed(2)+'" opacity=".7"/>'
        + '<text x="'+(padL-Math.round(8*k))+'" y="'+(y+fs*0.34).toFixed(1)+'" font-size="'+fs+'" fill="var(--muted)" text-anchor="end">'+Math.round(v)+'h</text>';
    }

    // r.nights is one bar per DAY (sleepDayAgg()), so a nap stacked on a full night draws as ONE
    // taller bar rather than two overlapping ones at the same x — the tooltip lists every session
    // that day rather than naming just the bed/wake of whichever one happens to be `main`.
    let barsSvg = '';
    r.nights.forEach(d=>{
      const y = yOf(d.mins/60);
      const short = d.mins < r.goalMins - 15;
      const title = d.sessions.length > 1
        ? fmtDate(parseLocalDateStr(d.date).getTime()) + ' · ' + fmtDuration(d.mins) + ' across ' + d.sessions.length + ' sessions'
        : fmtDate(parseLocalDateStr(d.date).getTime()) + ' · ' + fmtDuration(d.mins)
          + ' · ' + fmtClock(clockMins(d.main.bed)) + ' → ' + fmtClock(clockMins(d.main.wake));
      barsSvg += '<rect x="'+(xOf(d.date)-barW/2).toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+barW.toFixed(1)+'"'
        + ' height="'+Math.max(0, floor-y).toFixed(1)+'" rx="'+(2*k).toFixed(1)+'"'
        + ' fill="'+(short ? 'var(--gold)' : 'var(--violet)')+'" opacity=".85">'
        + '<title>'+escapeHtml(title)+'</title></rect>';
    });

    const gy = yOf(goalH);
    const goalSvg = '<line x1="'+padL+'" y1="'+gy.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+gy.toFixed(1)+'" stroke="var(--text)" stroke-width="'+(1.1*k).toFixed(2)+'" stroke-dasharray="'+(2.5*k).toFixed(1)+','+(3.5*k).toFixed(1)+'" opacity=".45"/>'
      + '<text x="'+(W-padR)+'" y="'+(gy-4*k).toFixed(1)+'" font-size="'+(fs*0.9).toFixed(1)+'" fill="var(--muted)" text-anchor="end" font-weight="700">Goal '+goalH+'h</text>';

    const narrow = wrapW < 560;
    const axisDate = ds => narrow
      ? parseLocalDateStr(ds).toLocaleDateString(undefined,{month:'short',day:'numeric'})
      : fmtDate(parseLocalDateStr(ds).getTime());
    const xLabelSvg = '<text x="'+padL+'" y="'+(H-Math.round(5*k))+'" font-size="'+fs+'" fill="var(--muted)" text-anchor="start">'+escapeHtml(axisDate(r.start))+'</text>'
      + '<text x="'+(W-padR)+'" y="'+(H-Math.round(5*k))+'" font-size="'+fs+'" fill="var(--muted)" text-anchor="end">'+escapeHtml(axisDate(r.today))+'</text>';

    wrap.innerHTML = '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Hours slept per day over the last '+r.days+' days">'
      + gridSvg + xLabelSvg + barsSvg + goalSvg
      + '</svg>';
    observeSleepChartWidth(wrap);
  }

  // its own observer for the same reason the calorie chart has one: this pane can be the one being
  // resized while the other two are display:none, and a hidden wrapper measures zero
  let slChartLastWidth = 0, slChartObserver = null;
  function observeSleepChartWidth(wrap){
    slChartLastWidth = wrap.clientWidth || 0;
    if(slChartObserver || typeof ResizeObserver === 'undefined') return;
    slChartObserver = new ResizeObserver(entries=>{
      const w = Math.round(entries[0].contentRect.width);
      if(!w || Math.abs(w - slChartLastWidth) < 12) return;
      slChartLastWidth = w;
      renderSleepReview();
    });
    slChartObserver.observe(wrap);
  }

  /* The nights themselves, newest first — the log a chart summarises, and the only place a wrong
     entry can be corrected or removed. Capped at 30 rows: the ranges above answer "how has the
     month gone", so a list past a month is scrolling for its own sake in a section that rides the
     shared blob. */
  function renderSleepList(){
    const box = el('slList'); if(!box) return;
    // session-level and deliberately not day-aggregated, unlike the review/chart above — this is
    // the only place a specific session (a nap versus that night's main sleep) can be told apart
    // and deleted, so collapsing it to one row per day would hide the very thing it exists to show.
    const log = sleepLog().slice().sort((a,b)=> sleepChronoCompare(b,a)).slice(0, 30);
    if(!log.length){
      box.innerHTML = '<p class="fit-rail-none">Nothing logged yet.</p>';
      return;
    }
    const goalMins = sleepGoalHours() * 60;
    box.innerHTML = log.map(n=>{
      const short = n.mins < goalMins - 15;
      const q = SLEEP_QUALITY.find(x=>x.v === n.quality);
      const durTxt = fmtDuration(n.mins);
      return '<div class="sleep-row'+(short?' short':'')+'">'
        + '<span class="sleep-row-date">'+escapeHtml(fmtDate(parseLocalDateStr(n.date).getTime()))+'</span>'
        + '<span class="sleep-row-dur">'+escapeHtml(durTxt)+'</span>'
        + '<span class="sleep-row-times">'+escapeHtml(fmtClock(clockMins(n.bed))+' → '+fmtClock(clockMins(n.wake)))+'</span>'
        + '<span class="sleep-row-q" title="'+escapeHtml(q?q.label:'')+'">'+(q?q.emoji:'')+'</span>'
        // identity is the record's id, not its date — a date can now hold more than one session,
        // and deleting "the night of the 4th" used to delete whichever one matched the date first
        + '<button type="button" class="sleep-row-del" data-sldel="'+escapeHtml(n.id)+'"'
        + ' aria-label="Delete the '+escapeHtml(durTxt)+' session on '+escapeHtml(fmtDate(parseLocalDateStr(n.date).getTime()))+'">✕</button>'
        + '</div>';
    }).join('');
  }

  /* ---- circadian rhythm ------------------------------------------------------------------------
     Everything above answers "how much" and "how long" — this answers "when". A person who
     averages 8h a night by sleeping 11pm-7am one day and 3am-11am the next has a perfectly good
     average and no rhythm at all, and a duration bar chart cannot show that; only plotting bed and
     wake times ON THE CLOCK can. So this is an actogram: one row per calendar day, a bar wherever
     you were actually asleep, positioned by clock time rather than stacked into a total.

     circadianStats() is the review panel's contract again — one function works out the verdict and
     the chart's average-time markers, so the two can never disagree. It deliberately reads each
     day's LONGEST session only (sleepDayAgg()'s `main`), the same choice sleepReview() makes for
     bedtime consistency: a nap's bed and wake time are real but are not "when you sleep", and
     mixing them into the average would blur a genuinely late chronotype with someone who merely
     naps at odd hours. */
  function circMean(arr){ return arr.reduce((a,b)=>a+b,0) / arr.length; }
  function circStdev(arr, m){ return Math.sqrt(arr.reduce((a,b)=> a + (b-m)*(b-m), 0) / arr.length); }

  function circadianStats(days){
    const today = localDateStr(new Date());
    const start = shiftDateStr(today, -(days-1));
    const raw = sleepLog()
      .filter(e=> e.mins > 0 && e.date >= start && e.date <= today)
      .sort(sleepChronoCompare);
    const agg = sleepDayAgg(raw);
    const r = { days, dayCount: agg.length, avgBed:null, bedSpread:null, avgWake:null, wakeSpread:null, tone:'flat' };
    const beds = agg.map(d=> bedAxis(d.main.bed)).filter(v=> v != null);
    if(beds.length){ r.avgBed = circMean(beds); r.bedSpread = circStdev(beds, r.avgBed); }
    const wakes = agg.map(d=> clockMins(d.main.wake)).filter(v=> v != null);
    if(wakes.length){ r.avgWake = circMean(wakes); r.wakeSpread = circStdev(wakes, r.avgWake); }
    if(r.bedSpread != null && r.wakeSpread != null){
      const avgSpread = (r.bedSpread + r.wakeSpread) / 2;
      r.tone = avgSpread <= 30 ? 'good' : avgSpread <= 75 ? 'neutral' : 'bad';
    }
    return r;
  }

  const CIRC_RANGES = [
    {key:'14', label:'14D', days:14},
    {key:'30', label:'30D', days:30},
    {key:'60', label:'60D', days:60}
  ];
  let circRange = '14';   // not persisted, the review panel's rule — opens on the tightest window

  function renderCircadianRhythm(){
    const rangeRow = el('circRangeRow'); if(!rangeRow) return;
    rangeRow.innerHTML = CIRC_RANGES.map(z=>
      '<button type="button" class="chart-zoom-btn'+(circRange===z.key?' active':'')+'"'
      + (circRange===z.key?' aria-current="true"':'')+' data-crange="'+z.key+'">'+z.label+'</button>'
    ).join('');
    rangeRow.querySelectorAll('.chart-zoom-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{ circRange = btn.dataset.crange; renderCircadianRhythm(); });
    });

    const opt = CIRC_RANGES.find(z=>z.key===circRange) || CIRC_RANGES[0];
    const stats = circadianStats(opt.days);

    let chip = '', tone = 'flat', note = '';
    if(!stats.dayCount){
      chip = 'Nothing logged yet';
      note = 'Log a few nights and this reads how steady your rhythm actually is, not just how long you slept.';
    } else if(stats.avgBed == null || stats.avgWake == null){
      chip = 'Not enough logged yet';
      note = stats.dayCount + ' day' + (stats.dayCount===1?'':'s') + ' logged — needs a bed and a wake time on more of them to read a pattern.';
    } else {
      tone = stats.tone;
      chip = tone === 'good' ? 'Regular rhythm' : tone === 'neutral' ? 'Somewhat irregular' : 'Irregular rhythm';
      note = 'Usual bedtime ' + fmtClock(stats.avgBed) + ' (±' + Math.round(stats.bedSpread) + ' min) · usual wake '
        + fmtClock(stats.avgWake) + ' (±' + Math.round(stats.wakeSpread) + ' min), across '
        + stats.dayCount + ' of ' + opt.days + ' days';
    }
    el('circVerdict').innerHTML = '<span class="wt-delta-val '+tone+'">'+escapeHtml(chip)+'</span>'
      + '<span class="wt-delta-note">'+escapeHtml(note)+'</span>';

    const drewChart = renderCircadianChart(opt.days, stats);
    el('circChartLegend').innerHTML = !drewChart ? ''
      : '<span><span class="dot" style="background:var(--violet);"></span>Sleep</span>'
        + '<span><span class="dot" style="background:var(--gold);"></span>Nap (under 3h)</span>'
        + '<span><span class="dot dash" style="color:var(--violet);"></span>Usual bedtime</span>'
        + '<span><span class="dot dash" style="color:var(--gold);"></span>Usual wake</span>';
  }

  // the last `days` calendar dates, oldest first — one actogram row per date, logged or not, so a
  // gap in the middle of the window shows as an empty row rather than silently compressing the rest
  function circWindowDates(days){
    const today = localDateStr(new Date());
    const dates = [];
    for(let i = days-1; i >= 0; i--) dates.push(shiftDateStr(today, -i));
    return dates;
  }

  /* The x-axis is hours relative to each ROW's own midnight, using bedAxis()'s midnight-centred
     convention for the bed edge (18:00+ reads negative, i.e. "the evening before") and plain clock
     hours for the wake edge — the same asymmetry sleepReview() already relies on, because a bed
     time clusters in the evening and a wake time clusters in the morning, so the two need different
     zero points to both land inside one comfortable, non-wrapping row. The domain defaults to
     16:00-the-evening-before through 16:00-same-day and only widens for data that actually needs
     it, so a normal week's rows aren't stretched thin to make room for one outlier nap. */
  function renderCircadianChart(days, stats){
    const wrap = el('circChartWrap');
    const dates = circWindowDates(days);
    const raw = sleepLog().filter(e=> e.mins > 0 && dates.indexOf(e.date) >= 0);
    if(!raw.length){
      wrap.innerHTML = '<div class="wt-chart-empty">Log a few nights to see your rhythm.</div>';
      return false;
    }
    const byDate = new Map();
    raw.forEach(n=>{
      const arr = byDate.get(n.date); if(arr) arr.push(n); else byDate.set(n.date, [n]);
    });

    const wrapW = Math.max(260, wrap.clientWidth || 780);
    const k = 780 / wrapW;
    const W = 780;
    // rows compress as the window widens rather than growing the chart without bound — 14D reads
    // as a comfortable week-and-a-half of thick bars, 60D as a thin but still legible two months
    const rowH = Math.max(4, Math.min(18, Math.floor(300 / dates.length))) * k;
    const gapH = Math.max(1 * k, rowH * 0.18);
    const fs = +(10.5 * k).toFixed(1);
    const padL = Math.round(fs * 2.6 + 8 * k);
    const padR = Math.round(10 * k), padT = Math.round(fs + 10 * k), padB = Math.round(fs + 8 * k);
    const H = Math.round(padT + dates.length * (rowH + gapH) - gapH + padB);

    let lo = -8, hi = 16;
    raw.forEach(n=>{
      const b = bedAxis(n.bed); if(b != null) lo = Math.min(lo, b/60 - 0.5);
      const w = clockMins(n.wake); if(w != null) hi = Math.max(hi, w/60 + 0.5);
    });
    const span = hi - lo;
    const xOf = h => padL + ((h - lo)/span) * (W - padL - padR);

    let gridSvg = '';
    for(let h = Math.ceil(lo/4)*4; h <= hi; h += 4){
      const x = xOf(h);
      const clock = ((Math.round(h) % 24) + 24) % 24;
      gridSvg += '<line x1="'+x.toFixed(1)+'" y1="'+padT+'" x2="'+x.toFixed(1)+'" y2="'+H+'" stroke="var(--border)" stroke-width="'+k.toFixed(2)+'" opacity=".5"/>'
        + '<text x="'+x.toFixed(1)+'" y="'+(padT - 4*k).toFixed(1)+'" font-size="'+fs+'" fill="var(--muted)" text-anchor="middle">'+escapeHtml(fmtClock(clock*60))+'</text>';
    }

    let avgSvg = '';
    if(stats && stats.avgBed != null){
      const x = xOf(stats.avgBed/60);
      avgSvg += '<line x1="'+x.toFixed(1)+'" y1="'+padT+'" x2="'+x.toFixed(1)+'" y2="'+H+'" stroke="var(--violet)" stroke-width="'+(1.1*k).toFixed(2)+'" stroke-dasharray="'+(2.5*k).toFixed(1)+','+(3.5*k).toFixed(1)+'" opacity=".6"/>';
    }
    if(stats && stats.avgWake != null){
      const x = xOf(stats.avgWake/60);
      avgSvg += '<line x1="'+x.toFixed(1)+'" y1="'+padT+'" x2="'+x.toFixed(1)+'" y2="'+H+'" stroke="var(--gold)" stroke-width="'+(1.1*k).toFixed(2)+'" stroke-dasharray="'+(2.5*k).toFixed(1)+','+(3.5*k).toFixed(1)+'" opacity=".6"/>';
    }

    // a day label on every row past ~20 of them is unreadable noise, so the window thins them out
    const labelEvery = dates.length <= 20 ? 1 : dates.length <= 40 ? 2 : 4;
    let rowsSvg = '', labelSvg = '';
    dates.forEach((ds, i)=>{
      const y = padT + i * (rowH + gapH);
      if(i % labelEvery === 0){
        labelSvg += '<text x="'+(padL - 6*k).toFixed(1)+'" y="'+(y + rowH*0.75).toFixed(1)+'" font-size="'+fs+'" fill="var(--muted)" text-anchor="end">'
          + escapeHtml(parseLocalDateStr(ds).toLocaleDateString(undefined,{month:'short',day:'numeric'})) + '</text>';
      }
      (byDate.get(ds) || []).forEach(n=>{
        const b = bedAxis(n.bed), w = clockMins(n.wake);
        if(b == null || w == null) return;
        const x1 = xOf(b/60), x2 = xOf(w/60);
        const isNap = n.mins < 180;
        rowsSvg += '<rect x="'+Math.min(x1,x2).toFixed(1)+'" y="'+y.toFixed(1)+'"'
          + ' width="'+Math.max(1.5*k, Math.abs(x2-x1)).toFixed(1)+'" height="'+rowH.toFixed(1)+'"'
          + ' rx="'+(rowH*0.3).toFixed(1)+'" fill="'+(isNap ? 'var(--gold)' : 'var(--violet)')+'" opacity="'+(isNap?'.7':'.88')+'">'
          + '<title>'+escapeHtml(fmtDate(parseLocalDateStr(ds).getTime()) + ' · '
              + fmtClock(clockMins(n.bed)) + ' → ' + fmtClock(clockMins(n.wake)) + ' · ' + fmtDuration(n.mins))+'</title></rect>';
      });
    });

    wrap.innerHTML = '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Bed and wake times over the last '+days+' days">'
      + gridSvg + avgSvg + rowsSvg + labelSvg
      + '</svg>';
    observeCircChartWidth(wrap);
    return true;
  }

  // its own observer, the calorie/sleep chart rule: this section can be the one being resized
  // while its siblings are display:none, and a hidden wrapper measures zero
  let circChartLastWidth = 0, circChartObserver = null;
  function observeCircChartWidth(wrap){
    circChartLastWidth = wrap.clientWidth || 0;
    if(circChartObserver || typeof ResizeObserver === 'undefined') return;
    circChartObserver = new ResizeObserver(entries=>{
      const w = Math.round(entries[0].contentRect.width);
      if(!w || Math.abs(w - circChartLastWidth) < 12) return;
      circChartLastWidth = w;
      renderCircadianRhythm();
    });
    circChartObserver.observe(wrap);
  }

  function renderSleep(){
    if(!el('slBed')) return;
    el('slGoal').value = sleepGoalHours();
    el('slBedGoal').value = state.fitness.sleepBedGoal || '';
    renderSleepQualityChips();
    updateSleepHint();
    renderSleepHero();
    renderSleepReview();
    renderCircadianRhythm();
    renderSleepList();
  }

  // Delegated from the containers, which are rebuilt on every render — the chips and the rows are
  // both innerHTML, so a handler bound to a node would die with it.
  if(el('slQualRow')){
    el('slQualRow').addEventListener('click', e=>{
      const btn = e.target.closest('[data-sq]'); if(!btn) return;
      const v = +btn.dataset.sq;
      sleepQualityDraft = (sleepQualityDraft === v) ? 0 : v;   // clicking the active chip clears it
      renderSleepQualityChips();
    });
    el('slList').addEventListener('click', e=>{
      const btn = e.target.closest('[data-sldel]'); if(!btn) return;
      const id = btn.dataset.sldel;
      const rec = sleepLog().find(e2=> e2.id === id); if(!rec) return;
      if(!confirm('Delete the ' + fmtDuration(rec.mins) + ' session on '
        + fmtDate(parseLocalDateStr(rec.date).getTime()) + '?')) return;
      state.fitness.sleepLog = sleepLog().filter(e2=> e2.id !== id);
      save(); renderSleep();
    });
    el('slAddBtn').addEventListener('click', addSleepEntry);
    ['slBed','slWake'].forEach(id=>{
      el(id).addEventListener('input', updateSleepHint);
      // Enter from either field logs, so a night can be entered without reaching for the mouse
      el(id).addEventListener('keydown', e=>{ if(e.key === 'Enter') addSleepEntry(); });
    });
    el('slNight').addEventListener('change', updateSleepHint);
    el('slGoal').addEventListener('input', ()=>{
      const v = parseFloat(el('slGoal').value);
      // an out-of-range goal is ignored rather than clamped mid-typing, which would fight the caret
      if(!isNaN(v) && v >= 3 && v <= 14){ state.fitness.sleepGoal = v; debouncedSave(); }
      renderSleepHero(); renderSleepReview(); renderSleepList();
    });
    el('slBedGoal').addEventListener('input', ()=>{
      state.fitness.sleepBedGoal = el('slBedGoal').value || '';
      debouncedSave();
    });
  }
