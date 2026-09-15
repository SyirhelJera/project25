  /* ================= LIVING AVATAR =================
     The figure on Motivation -> Self. He is one fixed character — a front-facing, symmetrical,
     A-pose young man — and only his CONDITION changes. You start the morning as the soft, broke,
     unkempt, exhausted version of him and every checklist item you tick moves him toward the
     version you are trying to be. Tomorrow he is back at the start and you earn him again.

     THE RULE THAT DRIVES THE WHOLE DESIGN: each axis is INDEPENDENT. The figure shows the exact
     combination of what you actually did — never an average, never one overall level. Doing
     fitness and work but skipping grooming has to produce a man who is athletic and sharply
     dressed WITH messy hair and heavy stubble, and it does, because the axes never meet: each one
     owns its own position in the layer stack and reads its own number.

     That is why this is composited rather than picked. Five pre-drawn whole illustrations can
     only ever show five points on one line; the stack below shows 4^4 = 256 states out of eight
     layers. Adding a fifth axis is one more entry in AV_AXES and one more layer, not a new set of
     drawings.

     YOUR ARTWORK IS THE POINT; THE DRAWING IS THE FALLBACK. Each of the four stack positions has
     one PNG slot per state — 16 in all — and any slot you fill is used instead of the drawing for
     that one layer in that one state. Slots you leave empty stay drawn, so a half-finished set
     never leaves a hole in the figure and you can replace it one layer at a time.

     Layered character art normally has to be exported on a single shared canvas at a single origin
     so the pieces land in register, which is a build step this repo does not have and will not
     get. The answer is to drag each layer into place instead: the alignment only has to be right
     once per slot, and you can see whether it is. What is stored is a Storage URL plus x/y/w as a
     PERCENTAGE OF THE STAGE, so a layer placed on a laptop is still in register on a phone, where
     the frame is a different size — the same reasoning as the scratch page's floating images.

     The drawn figure stays because it has one property the artwork cannot: every layer is a
     function of the same skeleton, so the clothes fit the build automatically — the shirt is cut
     from the very numbers the torso is drawn from, and an athletic state cannot burst out of a
     shirt drawn for a soft one. It costs no Storage and no shared-blob bytes, and it is what makes
     the feature work on the first day with no assets at all.

     IT DERIVES AND NEVER WRITES — the js/insights.js contract. Nothing in this file mutates a
     checklist or calls save(); the day's state is read straight off state.checklists, so the
     avatar cannot drift from the list it describes. The one persisted thing is the MAPPING (which
     checklist feeds which axis), and it is a preference, written only when the user picks one.

     THE DAILY RESET IS NOT IMPLEMENTED HERE, ON PURPOSE. Only checklists set to "Reset daily" are
     eligible (avEligibleChecklists), so applyChecklistResets() in js/checklists.js — which already
     clears `done` at the day rollover — IS the reset. A second mechanism keeping its own copy of
     "today" would eventually disagree with the list the user is looking at. It also means a
     checklist that never resets can't permanently pin an axis at 100%.
  */

  /* ---------- the axes ----------
     Order is the order they are shown in; each `layer` names the stack position it owns, which is
     documented on the builder itself. `states` reads low -> high and is what the UI says out loud,
     so the words have to match what is actually drawn. */
  const AV_AXES = [
    { key:'physique', label:'Physique', icon:'💪', layer:'body',
      states:['Soft', 'Softening', 'Average', 'Athletic'],
      hint:'Workouts, weigh-ins, eating' },
    { key:'wealth', label:'Wealth', icon:'💼', layer:'clothing',
      states:['Broke', 'Getting by', 'Comfortable', 'Well-off'],
      hint:'Work, applications, building, money' },
    { key:'grooming', label:'Grooming', icon:'✂️', layer:'hair + stubble',
      states:['Unkempt', 'Scruffy', 'Tidy', 'Sharp'],
      hint:'Shower, hair, shave, nails, skin' },
    { key:'rest', label:'Rest', icon:'😴', layer:'eyes + skin',
      states:['Exhausted', 'Tired', 'Rested', 'Bright'],
      hint:'Sleep, wind-down, waking early' },
    /* Social status is the one axis that is not ON him. It defaults to the BOTTOM of the stack
       — behind the body — because what it describes is the room around a person rather than
       anything he is wearing, and because a backdrop plate dropped into its slots must never
       cover the figure standing in front of it. Reorder it forward if your art wants that. */
    /* `short` is for the places the full name does not fit — the axis chips are sized so all
       five land on one row, which is worth more than spelling "status" out in a 9px label that
       already carries the full name in its title. Only this axis needs one. */
    { key:'social', label:'Social status', short:'Social', icon:'🤝', layer:'presence, behind him',
      states:['Unknown', 'Noticed', 'Respected', 'Admired'],
      hint:'People, reputation, showing up, posting' }
  ];
  const AV_AXIS_KEYS = AV_AXES.map(a => a.key);
  const AV_STEPS = 4;   // 0..3. Four is the most a flat figure can show and still read at a glance.

  /* ---------- what feeds what ----------
     Only daily-reset checklists, for the reason in the header. Sorted by the list's own order so
     the mapping editor reads the same way the Checklists tab does. */
  function avEligibleChecklists(){
    return (state.checklists || []).filter(c => c && c.resetFreq === 'daily' && (c.items || []).length);
  }

  function avMap(){
    const self = selfState();
    if(!self.map || typeof self.map !== 'object') self.map = {};
    return self.map;
  }

  /* A first guess, so the feature does something the moment it is opened rather than presenting an
     empty settings form. Deliberately only ever fills in checklists that have NO entry yet — a
     user's own choice, including a deliberate "don't count this one" (''), is never overwritten,
     which is why the check is `in` rather than a truthiness test. Returns whether it changed
     anything so the caller can decide about saving; it is called from a render, and a render must
     not save on its own. */
  const AV_SEED_RULES = [
    ['physique', /\b(fit|fitness|gym|workout|exercise|body|muscle|cardio|run|lift|eat|eating|diet|food|calorie|meal|weight|nutrition|respect)\b/i],
    ['grooming', /\b(groom|grooming|hygiene|shower|bath|skin|skincare|hair|shave|shaving|beard|nail|nails|teeth|dental|wash|clean up)\b/i],
    ['rest',     /\b(sleep|rest|wind.?down|bed|bedtime|night|nightly|evening|recover|recovery|relax|shutdown|unwind)\b/i],
    /* Before wealth on purpose, but WITHOUT content/creation/creator in it: those already
       belong to wealth, and moving them would silently re-map a checklist already placed. */
    ['social',   /\b(social|relations|relationship|relationships|friend|friends|family|network|networking|community|people|reputation|audience|outreach|presence|connect|connections)\b/i],
    ['wealth',   /\b(work|working|job|jobs|career|money|finance|business|income|client|application|apply|content|creation|creator|build|study|learn|skill|sovereign|sovereignty|freedom|hustle|craft)\b/i]
  ];
  function avSeedMap(){
    const map = avMap();
    let changed = false;
    avEligibleChecklists().forEach(c=>{
      if(c.id in map) return;                       // never second-guess a decision already made
      const name = c.name || '';
      const hit = AV_SEED_RULES.find(([, re]) => re.test(name));
      map[c.id] = hit ? hit[0] : '';
      changed = true;
    });
    return changed;
  }

  /* ---------- today's state, per axis ----------
     Items, not checklists: a 15-item grooming routine and a 2-item one should not weigh the same,
     and within an axis the items are simply pooled. The step boundaries are deliberately lopsided
     — anything short of finished is not "done", so only a genuine 100% reaches the top state,
     while the first tick of the day visibly moves him off the floor. That is the whole loop.

     An axis with nothing mapped to it returns `untracked` and sits at the middle step: a figure
     permanently stuck at "unkempt" because a checklist was never assigned reads as a bug, whereas
     a neutral figure plus a chip saying "not tracked" reads as a setup step. */
  function avAxisState(axisKey){
    const map = avMap();
    let done = 0, total = 0, sources = 0;
    avEligibleChecklists().forEach(c=>{
      if(map[c.id] !== axisKey) return;
      sources++;
      total += c.items.length;
      done += c.items.filter(it => it.done).length;
    });
    if(!sources || !total) return { step: 1, pct: 0, done: 0, total: 0, sources: 0, untracked: true };
    const pct = (done / total) * 100;
    const step = pct >= 100 ? 3 : pct >= 50 ? 2 : pct > 0 ? 1 : 0;
    return { step, pct, done, total, sources, untracked: false };
  }

  /* ---------- test mode ----------
     A made-up day, so a combination can be looked at without having to live it. The point of
     the figure is that it reports what you actually did, so this is built to be impossible to
     mistake for the real thing and impossible to leave on by accident:

     it is a MODULE variable and never `state`. A persisted override would survive a reload and
     the figure would quietly lie about the day from then on — the one failure this feature
     must not have. Closing the tab ends it, the same ruling as `netWorthChartZoom`.

     It also changes nothing that is stored or derived. `avStateAll()` still reads the real
     checklists; this only substitutes what the figure and its chips are drawn FROM, which is
     why the read-only contract at the top of this file still holds while it is on. */
  let avTestOn = false;
  let avTestSteps = {};

  function avStateAll(){
    const out = {};
    AV_AXES.forEach(a => { out[a.key] = avAxisState(a.key); });
    return out;
  }
  /* What is on screen, which is the real day unless test mode is standing in for it. Returns
     the same shape either way so the chips, the grid and the figure all read one thing and
     cannot disagree about which day they are describing. */
  /* Fully earned counts only the axes that are actually TRACKED. An axis nobody has assigned a
     checklist to is unassigned, not failed — it sits at the middle step and can never reach the
     top, so counting it would make the reward unreachable the moment a new axis shipped. The day
     line already counted this way; the aura has to agree or the two halves of the same sentence
     contradict each other on screen. */
  function avFullyEarned(all){
    const tracked = AV_AXES.filter(a => !all[a.key].untracked);
    return tracked.length > 0 && tracked.every(a => all[a.key].step === AV_STEPS - 1);
  }

  function avShownState(){
    const live = avStateAll();
    if(!avTestOn) return live;
    const out = {};
    AV_AXIS_KEYS.forEach(k=>{
      const step = Math.max(0, Math.min(AV_STEPS - 1, avTestSteps[k] != null ? avTestSteps[k] : live[k].step));
      // pct drives the chip's bar; with no real tally behind it the step itself is the honest
      // figure to draw, and `test` is what stops the chip claiming a count it does not have
      out[k] = { step: step, pct: step / (AV_STEPS - 1) * 100, done: 0, total: 0,
                 sources: live[k].sources, untracked: false, test: true };
    });
    return out;
  }

  // just the step numbers — what every layer builder below actually takes
  function avSteps(all){
    const s = {};
    AV_AXIS_KEYS.forEach(k => { s[k] = all[k].step; });
    return s;
  }

  /* ================= the figure =================
     One canvas, one skeleton, eight layers. Everything is measured off AV_Y and avBuild() so the
     layers stay in register with each other by construction rather than by eye.

     Proportion is ~6 heads, not the 7.5 of a fashion plate. The figure is looked at inside a 320px
     frame and often on a phone: at 7.5 heads the head is 40px on screen and every one of the
     face's marks — a dropped lid, an eye bag, a day of stubble — is gone, which would silently
     cost two of the four axes their entire vocabulary. */
  const AV_W = 360, AV_H = 600, AV_CX = 180;
  const AV_Y = {
    hairTop: 16, skull: 28, browLine: 66, eye: 80, chin: 116,
    shoulder: 142, chest: 196, waist: 242, hip: 266, crotch: 288,
    elbow: 262, wrist: 348,
    knee: 410, ankle: 528, sole: 548
  };
  const AV_HEAD_W = 35;           // half-width of the face at its widest
  const AV_HIP_X = 23;            // half the distance between the leg centres
  // avN, not n: these are top-level declarations in a classic script, so they share one
  // global lexical scope with every other file — a second `const n` anywhere in js/ would be a
  // parse-time SyntaxError that takes the whole app down, not just this tab.
  const avN = v => Math.round(v * 10) / 10;

  /* The skeleton the PHYSIQUE axis owns. Every clothing path is padded off these same numbers, so
     a shirt can never be cut for a body the figure doesn't have. Soft and athletic are not the
     same shape at the same width: the waist is what actually moves (48 -> 30), while the shoulders
     widen alongside it, which is what reads as "lost the gut and built a back" rather than
     "shrank". The range is wider than life because it has to survive being drawn 250px tall. */
  function avBuild(step){
    const t = Math.max(0, Math.min(AV_STEPS - 1, step)) / (AV_STEPS - 1);
    const lerp = (a, b) => a + (b - a) * t;
    return {
      t,
      shoulder: lerp(48, 68),
      chest:    lerp(51, 61),
      waist:    lerp(50, 31),
      hip:      lerp(45, 39),
      armUp:    lerp(23, 27),
      armLo:    lerp(18, 20),
      legUp:    lerp(40, 37),
      legLo:    lerp(28, 27),
      neck:     lerp(12, 14.5)
    };
  }

  /* ---------- palettes ---------- */
  // Skin tracks REST, not grooming: sallow when you haven't slept, warm when you have. Grooming is
  // spent on hair and stubble, which is where "unkempt" actually reads.
  const AV_SKIN      = ['#D6B092', '#E2BDA0', '#ECC9AD', '#F5D4BA'];
  const AV_SKIN_DARK = ['#B8927A', '#C29B82', '#CCA48B', '#D7AF95'];
  const AV_HAIR      = ['#2E2118', '#37271C', '#3F2D20', '#472F21'];
  const AV_HAIR_HI   = ['#42332A', '#4E3B2D', '#5C4633', '#6B4E36'];

  /* Four outfits, and the middle-high one is the character's own look — black tee, tan chinos,
     brown belt, white shoes. The low states are that same man in worse clothes rather than a
     different person, which is what keeps the identity fixed while the condition moves. The top
     state is the same garment shape with a collar, a placket and better cloth, so nothing the
     wealth axis does can ever hide the physique axis drawn underneath it. */
  const AV_FIT = [
    { top:'#98A0AD', topSh:'#838C9A', sleeve:'#8D95A3', legs:'#7C8492', legsSh:'#6A7280',
      shoe:'#7E838D', sole:'#666B74', belt:null, dress:false, watch:false, rumpled:true },
    { top:'#33323A', topSh:'#232229', sleeve:'#2C2B33', legs:'#414757', legsSh:'#333846',
      shoe:'#DCDCE2', sole:'#BFBFC7', belt:null, dress:false, watch:false, rumpled:true },
    { top:'#232229', topSh:'#131218', sleeve:'#1D1C23', legs:'#C3A375', legsSh:'#A3854F',
      shoe:'#F1F1F4', sole:'#D2D2DA', belt:'#6B4A2F', dress:false, watch:false, rumpled:false },
    { top:'#33425A', topSh:'#222D3F', sleeve:'#2C3950', legs:'#2F2E38', legsSh:'#222129',
      shoe:'#F4F4F7', sole:'#CFCFD8', belt:'#4E3823', dress:true, watch:true, rumpled:false }
  ];

  /* ---------- layer 1 of 8: ground ----------
     Not decoration. A flat figure with nothing under it floats, and the shadow is also the only
     thing that says the stage has a floor. It tightens and darkens as the physique sharpens, which
     is the cheapest possible "he is standing up straighter". */
  function avLayerGround(st){
    const w = 78 - st.physique * 4, o = 0.1 + st.physique * 0.022;
    return '<ellipse cx="' + AV_CX + '" cy="' + (AV_Y.sole + 5) + '" rx="' + w + '" ry="10" fill="#1A1F33" opacity="' + avN(o) + '"/>';
  }

  /* ---------- layer 2 of 8: aura ----------
     The one mark on the figure that is a reward rather than a description, so it has to be rare
     enough to mean something: every axis at 3, nothing less. It sits BEHIND him — a glow he is
     standing in front of, not a ring drawn around him, which is what an outline at this scale
     turns into. */
  function avLayerAura(st){
    if(!st.earned) return '';
    return '<defs><radialGradient id="avAura">' +
      '<stop offset="0.34" stop-color="#F5A524" stop-opacity="0.3"/>' +
      '<stop offset="1" stop-color="#F5A524" stop-opacity="0"/></radialGradient></defs>' +
      '<ellipse cx="' + AV_CX + '" cy="300" rx="176" ry="296" fill="url(#avAura)"/>';
  }

  /* ---------- presence — THE SOCIAL STATUS AXIS ----------
     The only axis with nothing to draw ON the figure, so it draws the room instead: rings
     spreading out from where he stands, and marks out past the shoulders. Both live clear of
     the silhouette on purpose — this layer defaults to the BACK of the stack, so anything
     drawn inside the body's outline would simply be covered by it and the axis would look
     broken at every step.

     Blue rather than the gold the earned-day aura uses, because the two can be on screen at
     once and a second gold glow would read as part of the first. */
  const AV_SOCIAL_INK = '#4E7FC0';
  function avLayerSocial(st){
    const n = st.social;
    if(n <= 0) return '';   // Unknown draws nothing at all, which is the honest picture of it
    const out = [];
    for(let i = 0; i < n; i++){
      out.push('<ellipse cx="' + AV_CX + '" cy="' + (AV_Y.sole + 6) + '" rx="' + (64 + i * 30) +
        '" ry="' + avN(10 + i * 3.6) + '" fill="none" stroke="' + AV_SOCIAL_INK +
        '" stroke-width="' + avN(2.6 - i * 0.5) + '" opacity="' + avN(0.36 - i * 0.07) + '"/>');
    }
    /* Two marks per step above the first, alternating sides and climbing — so the axis reads
       as rising attention rather than as a bigger puddle. */
    const marks = (n - 1) * 2;
    for(let i = 0; i < marks; i++){
      const side = (i % 2) ? 1 : -1, tier = Math.floor(i / 2);
      const x = AV_CX + side * (112 + tier * 20), y = 300 - tier * 86;
      out.push('<path d="M' + x + ',' + (y - 14) + 'q10,14 0,28q-10,-14 0,-28Z" fill="' +
        AV_SOCIAL_INK + '" opacity="' + avN(0.26 + n * 0.07) + '"/>');
    }
    return out.join('');
  }

  /* ---------- layer 3 of 8: body — THE PHYSIQUE AXIS ----------
     Torso as a filled path, limbs as round-capped strokes: at this size a stroked limb reads
     exactly like a drawn one and stays perfectly in register with the sleeve or trouser leg drawn
     over it, because both are the same two points at different widths. Round caps on BOTH segments
     of a limb is what closes the knee and elbow — butt caps leave a visible seam there. */
  function avTorsoPath(b, pad){
    const p = pad || 0, cx = AV_CX, Y = AV_Y;
    const sh = b.shoulder + p, ch = b.chest + p, wa = b.waist + p, hp = b.hip + p;
    return 'M' + avN(cx - sh) + ',' + Y.shoulder +
      'C' + avN(cx - ch) + ',' + (Y.shoulder + 16) + ' ' + avN(cx - ch) + ',' + (Y.chest + 8) + ' ' + avN(cx - wa) + ',' + Y.waist +
      'C' + avN(cx - hp) + ',' + (Y.waist + 14) + ' ' + avN(cx - hp) + ',' + (Y.hip + 8) + ' ' + avN(cx - hp + 4) + ',' + Y.crotch +
      'L' + avN(cx + hp - 4) + ',' + Y.crotch +
      'C' + avN(cx + hp) + ',' + (Y.hip + 8) + ' ' + avN(cx + hp) + ',' + (Y.waist + 14) + ' ' + avN(cx + wa) + ',' + Y.waist +
      'C' + avN(cx + ch) + ',' + (Y.chest + 8) + ' ' + avN(cx + ch) + ',' + (Y.shoulder + 16) + ' ' + avN(cx + sh) + ',' + Y.shoulder +
      'Q' + cx + ',' + (Y.shoulder - 13) + ' ' + avN(cx - sh) + ',' + Y.shoulder + 'Z';
  }
  function avArmPts(b, side){
    return {
      shoulder: [AV_CX + side * (b.shoulder - 7), AV_Y.shoulder + 12],
      elbow:    [AV_CX + side * (b.shoulder + 36), AV_Y.elbow],
      wrist:    [AV_CX + side * (b.shoulder + 74), AV_Y.wrist]
    };
  }
  function avLegPts(side){
    return {
      hip:   [AV_CX + side * AV_HIP_X, AV_Y.hip + 16],
      knee:  [AV_CX + side * (AV_HIP_X + 3), AV_Y.knee],
      ankle: [AV_CX + side * (AV_HIP_X + 2), AV_Y.ankle]
    };
  }
  const avSeg = (a, bb) => 'M' + avN(a[0]) + ',' + avN(a[1]) + 'L' + avN(bb[0]) + ',' + avN(bb[1]);
  const avLimb = (a, bb, colour, w) =>
    '<path d="' + avSeg(a, bb) + '" stroke="' + colour + '" stroke-width="' + avN(w) + '" stroke-linecap="round" fill="none"/>';

  function avLayerBody(st){
    const b = avBuild(st.physique), skin = AV_SKIN[st.rest], shade = AV_SKIN_DARK[st.rest];
    const out = [];
    [-1, 1].forEach(side=>{
      const L = avLegPts(side);
      out.push(avLimb(L.hip, L.knee, skin, b.legUp));
      out.push(avLimb(L.knee, L.ankle, skin, b.legLo));
    });
    out.push('<path d="' + avTorsoPath(b, 0) + '" fill="' + skin + '"/>');
    // Definition, not a six-pack: a soft body gets a belly curve, an athletic one gets a centre
    // line and pec shading. Both ends of one opacity ramp, so nothing pops in at a threshold.
    if(b.t > 0.34){
      const d = (b.t - 0.34) / 0.66;
      out.push('<path d="M' + AV_CX + ',' + (AV_Y.chest + 2) + 'L' + AV_CX + ',' + (AV_Y.waist + 8) + '" stroke="' + shade + '" stroke-width="2.6" stroke-linecap="round" opacity="' + avN(0.5 * d) + '" fill="none"/>');
      out.push('<path d="M' + avN(AV_CX - b.chest * 0.6) + ',' + (AV_Y.chest - 6) + 'Q' + AV_CX + ',' + (AV_Y.chest + 12) + ' ' + avN(AV_CX + b.chest * 0.6) + ',' + (AV_Y.chest - 6) + '" stroke="' + shade + '" stroke-width="3" stroke-linecap="round" opacity="' + avN(0.45 * d) + '" fill="none"/>');
    } else {
      const d = 1 - b.t / 0.34;
      out.push('<path d="M' + avN(AV_CX - b.waist * 0.52) + ',' + (AV_Y.waist - 10) + 'Q' + AV_CX + ',' + (AV_Y.waist + 16) + ' ' + avN(AV_CX + b.waist * 0.52) + ',' + (AV_Y.waist - 10) + '" stroke="' + shade + '" stroke-width="2.6" stroke-linecap="round" opacity="' + avN(0.34 * d) + '" fill="none"/>');
    }
    [-1, 1].forEach(side=>{
      const A = avArmPts(b, side);
      out.push(avLimb(A.shoulder, A.elbow, skin, b.armUp));
      out.push(avLimb(A.elbow, A.wrist, skin, b.armLo));
      if(b.t > 0.5){   // a bicep, only once there is one to show
        const mx = (A.shoulder[0] + A.elbow[0]) / 2, my = (A.shoulder[1] + A.elbow[1]) / 2;
        out.push('<ellipse cx="' + avN(mx) + '" cy="' + avN(my) + '" rx="' + avN(b.armUp * 0.4) + '" ry="15" fill="' + shade + '" opacity="' + avN(0.34 * (b.t - 0.5) * 2) + '" transform="rotate(' + avN(side * 22) + ' ' + avN(mx) + ' ' + avN(my) + ')"/>');
      }
      out.push(avHand(A.wrist, side, skin, shade));
    });
    return out.join('');
  }
  // An open A-pose hand at ~22px: a palm and three suggested fingers is every bit of it that can
  // actually be seen, and more strokes only turn to mud.
  function avHand(wrist, side, skin, shade){
    const x = wrist[0] + side * 3, y = wrist[1] + 11;
    let s = '<ellipse cx="' + avN(x) + '" cy="' + avN(y) + '" rx="10.5" ry="13" fill="' + skin + '" transform="rotate(' + avN(side * 16) + ' ' + avN(x) + ' ' + avN(y) + ')"/>';
    for(let i = -1; i <= 1; i++){
      s += '<path d="M' + avN(x + i * 5) + ',' + avN(y + 6) + 'L' + avN(x + i * 6.8 + side * 2) + ',' + avN(y + 13) + '" stroke="' + shade + '" stroke-width="1.5" stroke-linecap="round" opacity="0.55" fill="none"/>';
    }
    return s;
  }

  /* ---------- layer 4 of 8: legwear — THE WEALTH AXIS ----------
     Drawn from avLegPts() plus a few px, which is the whole reason the clothes always fit. */
  function avLayerLegwear(st){
    const b = avBuild(st.physique), f = AV_FIT[st.wealth];
    const out = [];
    // seat, so the trousers read as one garment rather than two tubes
    out.push('<path d="M' + avN(AV_CX - b.hip - 1) + ',' + (AV_Y.hip - 8) +
      'L' + avN(AV_CX + b.hip + 1) + ',' + (AV_Y.hip - 8) +
      'L' + avN(AV_CX + b.hip - 2) + ',' + (AV_Y.crotch + 12) +
      'L' + avN(AV_CX - b.hip + 2) + ',' + (AV_Y.crotch + 12) + 'Z" fill="' + f.legs + '"/>');
    [-1, 1].forEach(side=>{
      const L = avLegPts(side);
      const cuffTop = L.ankle[1] - 17, cuffBot = L.ankle[1] - 7, cuffW = b.legLo + 9;
      out.push(avLimb(L.hip, L.knee, f.legs, b.legUp + 5));
      out.push(avLimb(L.knee, [L.ankle[0], cuffBot], f.legs, cuffW));
      // the turned-up cuff the character wears — a shade of the trouser, not a dark band, or it
      // reads as a strap round his shin rather than as the hem being rolled
      out.push('<path d="M' + avN(L.ankle[0] - cuffW / 2) + ',' + avN(cuffTop) + 'h' + avN(cuffW) +
        'v' + avN(cuffBot - cuffTop) + 'h' + avN(-cuffW) + 'Z" fill="' + f.legsSh + '"/>');
      if(f.rumpled){
        out.push('<path d="M' + avN(L.knee[0] - 9) + ',' + (L.knee[1] - 30) + 'q9,6 17,0" stroke="' + f.legsSh + '" stroke-width="2.2" fill="none" opacity="0.6" stroke-linecap="round"/>');
        out.push('<path d="M' + avN(L.knee[0] - 10) + ',' + (L.knee[1] + 26) + 'q10,7 19,1" stroke="' + f.legsSh + '" stroke-width="2.2" fill="none" opacity="0.45" stroke-linecap="round"/>');
      }
    });
    if(f.belt){
      out.push('<rect x="' + avN(AV_CX - b.hip - 1) + '" y="' + (AV_Y.hip - 12) + '" width="' + avN((b.hip + 1) * 2) + '" height="10" rx="2" fill="' + f.belt + '"/>');
      out.push('<rect x="' + avN(AV_CX - 7) + '" y="' + (AV_Y.hip - 13) + '" width="14" height="12" rx="2" fill="#C9B27A"/>');
    }
    return out.join('');
  }

  /* ---------- layer 5 of 8: shoes — THE WEALTH AXIS ---------- */
  function avLayerFeet(st){
    const f = AV_FIT[st.wealth];
    return [-1, 1].map(side=>{
      const L = avLegPts(side), x = L.ankle[0], y = AV_Y.ankle - 8, sole = AV_Y.sole;
      return '<path d="M' + avN(x - 13) + ',' + avN(y) +
        'Q' + avN(x - 15) + ',' + avN(sole - 4) + ' ' + avN(x - 12 + side * 5) + ',' + avN(sole - 3) +
        'L' + avN(x + 13 + side * 7) + ',' + avN(sole - 3) +
        'Q' + avN(x + 16) + ',' + avN(y + 10) + ' ' + avN(x + 12) + ',' + avN(y) + 'Z" fill="' + f.shoe + '"/>' +
        '<path d="M' + avN(x - 12 + side * 5) + ',' + avN(sole - 3) + 'L' + avN(x + 13 + side * 7) + ',' + avN(sole - 3) +
        'L' + avN(x + 13 + side * 7) + ',' + avN(sole - 1) + 'L' + avN(x - 12 + side * 5) + ',' + avN(sole - 1) + 'Z" fill="' + f.sole + '"/>';
    }).join('');
  }

  /* ---------- layer 6 of 8: top — THE WEALTH AXIS ----------
     Cut from avTorsoPath() at +4px, so it is literally the body's own outline one size up: an
     athletic state cannot burst out of a shirt drawn for a soft one, because there is only ever
     one shirt and it is drawn from whatever the body currently is. */
  function avLayerTop(st){
    const b = avBuild(st.physique), f = AV_FIT[st.wealth];
    const out = [];
    const hem = AV_Y.hip - 2;
    out.push('<clipPath id="avTopClip"><rect x="0" y="' + (AV_Y.shoulder - 18) + '" width="' + AV_W + '" height="' + avN(hem - AV_Y.shoulder + 18) + '"/></clipPath>');
    out.push('<path d="' + avTorsoPath(b, 4) + '" fill="' + f.top + '" clip-path="url(#avTopClip)"/>');
    // sleeves, over the upper arm and stopping short of the elbow
    [-1, 1].forEach(side=>{
      const A = avArmPts(b, side);
      const mid = [A.shoulder[0] + (A.elbow[0] - A.shoulder[0]) * 0.58, A.shoulder[1] + (A.elbow[1] - A.shoulder[1]) * 0.58];
      out.push('<path d="' + avSeg(A.shoulder, mid) + '" stroke="' + f.sleeve + '" stroke-width="' + avN(b.armUp + 8) + '" stroke-linecap="round" fill="none"/>');
    });
    // collar, drawn after the sleeves so the neckline sits on top of the shoulder seam
    out.push('<path d="M' + avN(AV_CX - b.neck - 6) + ',' + (AV_Y.shoulder - 8) +
      'Q' + AV_CX + ',' + (AV_Y.shoulder + 16) + ' ' + avN(AV_CX + b.neck + 6) + ',' + (AV_Y.shoulder - 8) +
      'Q' + AV_CX + ',' + (AV_Y.shoulder + 5) + ' ' + avN(AV_CX - b.neck - 6) + ',' + (AV_Y.shoulder - 8) + 'Z" fill="' + f.topSh + '"/>');
    // hem shadow, and creases only on the rumpled fits
    out.push('<path d="M' + avN(AV_CX - b.waist - 3) + ',' + avN(hem - 5) + 'Q' + AV_CX + ',' + avN(hem + 4) + ' ' + avN(AV_CX + b.waist + 3) + ',' + avN(hem - 5) + '" stroke="' + f.topSh + '" stroke-width="3.2" fill="none" opacity="0.75" stroke-linecap="round"/>');
    if(f.rumpled){
      out.push('<path d="M' + avN(AV_CX - 20) + ',' + (AV_Y.waist - 12) + 'q11,8 24,1" stroke="' + f.topSh + '" stroke-width="2.4" fill="none" opacity="0.65" stroke-linecap="round"/>');
      out.push('<path d="M' + avN(AV_CX - 24) + ',' + (AV_Y.chest + 18) + 'q13,7 26,0" stroke="' + f.topSh + '" stroke-width="2.2" fill="none" opacity="0.45" stroke-linecap="round"/>');
    }
    /* The top state is a PROPER SHIRT, not an extra garment laid over the tee — it is cut from the
       very same torso path as every other top, so a fully dressed figure still shows the physique
       axis straight through it. An open overshirt was the alternative and it lost: having geometry
       of its own, it hung off the body rather than following it, and at this width it covered the
       build it was supposed to be draped over. A collar, a placket and a cuffed sleeve say
       "dressed" using nothing but marks on a shape that was already the right shape. */
    if(f.dress){
      [-1, 1].forEach(side=>{   // collar leaves, folded open over the shoulders
        out.push('<path d="M' + avN(AV_CX + side * (b.neck + 1)) + ',' + (AV_Y.shoulder - 7) +
          'L' + avN(AV_CX + side * (b.neck + 21)) + ',' + (AV_Y.shoulder + 3) +
          'L' + avN(AV_CX + side * (b.neck + 3)) + ',' + (AV_Y.shoulder + 24) + 'Z" fill="' + f.topSh + '"/>');
      });
      out.push('<path d="M' + AV_CX + ',' + (AV_Y.shoulder + 18) + 'L' + AV_CX + ',' + avN(hem - 4) +
        '" stroke="' + f.topSh + '" stroke-width="3.4" fill="none"/>');
      for(let y = AV_Y.shoulder + 38; y < hem - 10; y += 26){
        out.push('<circle cx="' + AV_CX + '" cy="' + y + '" r="2" fill="#D9D4C7" opacity="0.85"/>');
      }
    }
    if(f.watch){
      const A = avArmPts(b, -1);
      const wx = A.wrist[0], wy = A.wrist[1] - 4;
      out.push('<rect x="' + avN(wx - 9) + '" y="' + avN(wy - 5) + '" width="18" height="10" rx="3" fill="#2C2F38" transform="rotate(-20 ' + avN(wx) + ' ' + avN(wy) + ')"/>');
      out.push('<circle cx="' + avN(wx) + '" cy="' + avN(wy) + '" r="5" fill="#C9B27A"/>');
    }
    return out.join('');
  }

  /* ---------- layer 7 of 8: head + face — REST (eyes, skin) and GROOMING (stubble) ----------
     Two axes share this layer because they share the face, but they never touch each other's
     marks: rest owns the eyes, the lids and the under-eye shading, grooming owns the stubble.
     Neither reads the other's number. */
  function avFacePath(){
    const cx = AV_CX, Y = AV_Y, w = AV_HEAD_W;
    return 'M' + (cx - w) + ',' + (Y.eye - 10) +
      'C' + (cx - w) + ',' + (Y.skull + 8) + ' ' + (cx - 22) + ',' + Y.skull + ' ' + cx + ',' + Y.skull +
      'C' + (cx + 22) + ',' + Y.skull + ' ' + (cx + w) + ',' + (Y.skull + 8) + ' ' + (cx + w) + ',' + (Y.eye - 10) +
      'C' + (cx + w) + ',' + (Y.eye + 18) + ' ' + (cx + 25) + ',' + (Y.chin - 11) + ' ' + (cx + 12) + ',' + (Y.chin - 3) +
      'Q' + cx + ',' + (Y.chin + 4) + ' ' + (cx - 12) + ',' + (Y.chin - 3) +
      'C' + (cx - 25) + ',' + (Y.chin - 11) + ' ' + (cx - w) + ',' + (Y.eye + 18) + ' ' + (cx - w) + ',' + (Y.eye - 10) + 'Z';
  }
  function avLayerHead(st){
    const b = avBuild(st.physique);
    const skin = AV_SKIN[st.rest], shade = AV_SKIN_DARK[st.rest];
    const cx = AV_CX, Y = AV_Y;
    const out = [];

    // Neck: short. An anime jaw already hides most of it, and the long rectangle this used to be
    // read as a giraffe. Plus the shadow it casts on itself, which is what stops the head from
    // looking pasted on.
    out.push('<path d="M' + avN(cx - b.neck) + ',' + (Y.chin - 16) + 'L' + avN(cx - b.neck - 1) + ',' + (Y.shoulder + 4) +
      'L' + avN(cx + b.neck + 1) + ',' + (Y.shoulder + 4) + 'L' + avN(cx + b.neck) + ',' + (Y.chin - 16) + 'Z" fill="' + skin + '"/>');
    out.push('<path d="M' + avN(cx - b.neck) + ',' + (Y.chin - 14) + 'Q' + cx + ',' + (Y.chin + 6) + ' ' + avN(cx + b.neck) + ',' + (Y.chin - 14) + 'Z" fill="' + shade + '" opacity="0.6"/>');

    [-1, 1].forEach(side=>{   // ears
      out.push('<ellipse cx="' + avN(cx + side * (AV_HEAD_W - 1)) + '" cy="' + (Y.eye + 4) + '" rx="5.5" ry="10" fill="' + skin + '"/>');
    });
    out.push('<path d="' + avFacePath() + '" fill="' + skin + '"/>');

    // STUBBLE — grooming's mark on this layer. Clipped to the face so it can never crawl off the
    // jaw, and it is one fill on an opacity ramp rather than four drawings.
    const stubble = [0.55, 0.34, 0.14, 0][st.grooming];
    if(stubble > 0){
      out.push('<clipPath id="avFaceClip"><path d="' + avFacePath() + '"/></clipPath>');
      out.push('<g clip-path="url(#avFaceClip)" opacity="' + avN(stubble) + '">');
      out.push('<path d="M' + (cx - 34) + ',' + (Y.eye + 14) + 'C' + (cx - 28) + ',' + (Y.chin + 4) + ' ' + (cx + 28) + ',' + (Y.chin + 4) + ' ' + (cx + 34) + ',' + (Y.eye + 14) +
        'L' + (cx + 34) + ',' + (Y.chin + 10) + 'L' + (cx - 34) + ',' + (Y.chin + 10) + 'Z" fill="#2E231A"/>');
      out.push('<path d="M' + (cx - 12) + ',' + (Y.chin - 22) + 'q12,-6 24,0l0,6q-12,-5 -24,0Z" fill="#2E231A"/>');
      out.push('</g>');
    }

    // BROWS — rest's first mark: the outer end drops as the sleep debt shows.
    const browDrop = [4, 2.4, 0.7, 0][st.rest];
    [-1, 1].forEach(side=>{
      const x = cx + side * 15;
      out.push('<path d="M' + avN(x - side * 9) + ',' + avN(Y.browLine + browDrop) + 'Q' + avN(x) + ',' + avN(Y.browLine - 3.2) + ' ' + avN(x + side * 9) + ',' + avN(Y.browLine + 0.8) + '" stroke="' + AV_HAIR[st.grooming] + '" stroke-width="3.8" stroke-linecap="round" fill="none"/>');
    });

    // EYES — rest's main mark. The eye is drawn whole and an eyelid the colour of the face is then
    // laid over the top of it; `lid` is how far down that lid sits. One number, four readings, and
    // the iris stays put instead of being redrawn per state.
    const lid = [9.5, 5.8, 2, 0][st.rest];
    const bag = [0.5, 0.32, 0.1, 0][st.rest];
    [-1, 1].forEach(side=>{
      const ex = cx + side * 15, ey = Y.eye;
      out.push('<ellipse cx="' + avN(ex) + '" cy="' + ey + '" rx="10.5" ry="9.6" fill="#FBFBFD"/>');
      out.push('<ellipse cx="' + avN(ex) + '" cy="' + (ey + 0.6) + '" rx="6.4" ry="7.6" fill="#4A3325"/>');
      out.push('<ellipse cx="' + avN(ex) + '" cy="' + (ey + 1.8) + '" rx="3.3" ry="3.9" fill="#201811"/>');
      out.push('<circle cx="' + avN(ex + side * 2.6) + '" cy="' + (ey - 3.4) + '" r="2.4" fill="#FFFFFF" opacity="0.95"/>');
      if(st.rest === 3) out.push('<circle cx="' + avN(ex - side * 3) + '" cy="' + (ey + 3.8) + '" r="1.4" fill="#FFFFFF" opacity="0.7"/>');
      // the lid, in skin, plus the lash line along its edge
      out.push('<path d="M' + avN(ex - 11) + ',' + avN(ey - 10.4) + 'h22v' + avN(10.4 + lid) + 'a11,10.4 0 0,0 -22,0Z" fill="' + skin + '"/>');
      out.push('<path d="M' + avN(ex - 10.8) + ',' + avN(ey - 0.4 + lid) + 'a11,10.6 0 0,1 21.6,0" stroke="#241B15" stroke-width="2.9" fill="none" stroke-linecap="round"/>');
      if(bag > 0){
        out.push('<path d="M' + avN(ex - 8.4) + ',' + (ey + 10.6) + 'q8.4,5 16.8,0" stroke="#8A6450" stroke-width="2.6" fill="none" opacity="' + avN(bag) + '" stroke-linecap="round"/>');
      }
    });

    // nose and mouth. The mouth turns down when he is wrecked and lifts when he is not — the only
    // thing on the figure allowed to look pleased with itself.
    out.push('<path d="M' + cx + ',' + (Y.eye + 12) + 'q3.4,8 -2.6,9.4" stroke="' + shade + '" stroke-width="2.2" fill="none" stroke-linecap="round" opacity="0.9"/>');
    const lift = [-3, -1.2, 1.6, 3.4][st.rest];
    out.push('<path d="M' + (cx - 8.5) + ',' + (Y.chin - 19) + 'q8.5,' + avN(lift) + ' 17,0" stroke="#8A5F4C" stroke-width="2.6" fill="none" stroke-linecap="round"/>');
    return out.join('');
  }

  /* ---------- layer 8 of 8: hair — THE GROOMING AXIS ----------
     The same cut in four conditions, not four haircuts: the character is fixed, his upkeep is not.
     Unkempt is flat, greasy, overgrown and down over the brow; sharp is lifted, layered and off
     the face. `lift` and `hang` are the two numbers that say all of it. */
  function avLayerHair(st){
    const g = st.grooming, cx = AV_CX, Y = AV_Y, w = AV_HEAD_W;
    const hair = AV_HAIR[g], hi = AV_HAIR_HI[g];
    const out = [];
    const lift = [0, 4, 8, 12][g];       // how far the mass sits off the skull
    const hang = [16, 11, 6, 2][g];      // how far the fringe hangs down over the brow
    const top = Y.skull - 5 - lift;

    // the mass, from temple to temple over the crown and down into a fringe
    out.push('<path d="M' + avN(cx - w - 2) + ',' + (Y.eye - 4) +
      'C' + avN(cx - w - 1) + ',' + avN(top + 7) + ' ' + (cx - 23) + ',' + avN(top - 5) + ' ' + cx + ',' + avN(top - 5) +
      'C' + (cx + 23) + ',' + avN(top - 5) + ' ' + avN(cx + w + 1) + ',' + avN(top + 7) + ' ' + avN(cx + w + 2) + ',' + (Y.eye - 4) +
      'L' + (cx + w - 2) + ',' + avN(Y.browLine + hang - 5) +
      'C' + (cx + 21) + ',' + avN(Y.browLine + hang) + ' ' + (cx + 15) + ',' + avN(Y.browLine + hang - 9) + ' ' + (cx + 6) + ',' + avN(Y.browLine + hang - 4) +
      'C' + (cx - 5) + ',' + avN(Y.browLine + hang + 1) + ' ' + (cx - 15) + ',' + avN(Y.browLine + hang - 8) + ' ' + (cx - 23) + ',' + avN(Y.browLine + hang - 2) +
      'L' + (cx - w + 2) + ',' + avN(Y.browLine + hang - 6) + 'Z" fill="' + hair + '"/>');

    // sideburns, longer when he has not had it cut
    [-1, 1].forEach(side=>{
      out.push('<path d="M' + avN(cx + side * (w + 1)) + ',' + (Y.eye - 8) +
        'q' + avN(side * 5) + ',' + avN(11 + hang) + ' ' + avN(side * 1) + ',' + avN(17 + hang) +
        'q' + avN(-side * 5) + ',-7 ' + avN(-side * 4) + ',' + avN(-15 - hang) + 'Z" fill="' + hair + '"/>');
    });

    /* The spikes — one cut throughout. An overgrown head is heavy and falls outward; a cut one
       stands up, which is the `tipX` term: the same six spikes lean out at low grooming and
       straighten as it rises. */
    const spikes = [[-27, 15], [-15, 24], [-2, 28], [11, 24], [23, 18], [31, 12]];
    spikes.forEach(([dx, len])=>{
      const h = len * (0.4 + g * 0.2);
      const x = cx + dx, y = top + 2;
      const tipX = x + dx * (g >= 2 ? 0.14 : 0.42);
      out.push('<path d="M' + avN(x - 7) + ',' + avN(y + 7) + 'Q' + avN(x + dx * 0.12) + ',' + avN(y - h) + ' ' + avN(tipX) + ',' + avN(y - h) +
        'Q' + avN(x + 6) + ',' + avN(y - 2) + ' ' + avN(x + 7) + ',' + avN(y + 8) + 'Z" fill="' + hair + '"/>');
    });

    // sheen — clean hair catches light, greasy hair does not
    if(g >= 1){
      out.push('<path d="M' + (cx - 20) + ',' + avN(top + 9) + 'Q' + cx + ',' + avN(top - 1) + ' ' + (cx + 19) + ',' + avN(top + 8) + '" stroke="' + hi + '" stroke-width="' + avN(2 + g) + '" fill="none" stroke-linecap="round" opacity="' + avN(0.18 + g * 0.16) + '"/>');
    }
    return out.join('');
  }

  /* THE STACK — scenery first, then the four axis layers in whatever order the user has put them.

     `AV_SCENERY` is the ground he stands on and the aura he earns: they belong to no axis, have no
     slot to drag art into, and are always behind everything, so they are pinned and not reorderable.

     `AV_AXIS_LAYER` is the real design: one drawing function per axis, and the ORDER they composite
     in lives in `state.self.order` rather than in this file. It has to, because the order that is
     right depends on what your artwork actually contains. The drawn figure assumes the anatomical
     one — body, then what he is wearing, then his face, then his hair — but a PNG set where the
     "physique" plate is a fully dressed figure needs wealth *behind* it instead, and no default can
     know that. Reordering moves the drawn layers too, which is the honest thing: what you see is
     always the stack you actually set.

     A new axis is a new entry here, a new entry in AV_AXES, and a new key in AV_ORDER_DEFAULT. */
  const AV_SCENERY = [
    { key:'ground', draw: st => avLayerGround(st) },
    { key:'aura',   draw: st => avLayerAura(st) }
  ];
  const AV_AXIS_LAYER = {
    social:   st => avLayerSocial(st),
    physique: st => avLayerBody(st),
    wealth:   st => avLayerLegwear(st) + avLayerFeet(st) + avLayerTop(st),
    rest:     st => avLayerHead(st),
    grooming: st => avLayerHair(st)
  };
  const AV_ORDER_DEFAULT = ['social', 'physique', 'wealth', 'rest', 'grooming'];   // bottom -> top

  /* Validated on every read, not trusted: this arrives from the same unauthenticated row as
     everything else, and a hand-edited order that dropped an axis would make that layer vanish
     with nothing in the UI to explain why. Anything that isn't exactly the four keys, once each,
     falls back to the anatomical default. */
  function avStackOrder(){
    const raw = selfState().order;
    if(!Array.isArray(raw)) return AV_ORDER_DEFAULT.slice();
    /* Repaired rather than rejected. Accepting only the wholesale-valid case meant that ADDING
       an axis threw away an order somebody had set by hand, which is a bad trade for a one-line
       release note. So: keep every key still recognised, in the order it was saved, drop
       duplicates and anything unknown, then slot each missing axis in at its own default
       position. An order saved before `social` existed therefore keeps its arrangement and
       simply gains the new layer at the back, where its default puts it. */
    const seen = {};
    const kept = raw.filter(k => AV_ORDER_DEFAULT.indexOf(k) >= 0 && !seen[k] && (seen[k] = 1));
    AV_ORDER_DEFAULT.forEach((k, i)=>{ if(kept.indexOf(k) < 0) kept.splice(Math.min(i, kept.length), 0, k); });
    return kept;
  }
  // bottom -> top, scenery included: the one list everything that composites walks
  function avStack(){
    return AV_SCENERY.map(s => ({ axis: null, draw: s.draw }))
      .concat(avStackOrder().map(axis => ({ axis, draw: AV_AXIS_LAYER[axis] })));
  }

  function avNormSteps(steps){
    const st = {};
    AV_AXIS_KEYS.forEach(k => { st[k] = Math.max(0, Math.min(AV_STEPS - 1, steps && steps[k] != null ? steps[k] : 1)); });
    /* Carried, not re-derived: whether a day is fully earned depends on which axes are tracked,
       which the step numbers alone cannot say. Callers that have the real state pass it in;
       the preview matrix, which has only steps, falls back to all-at-top. */
    st.earned = (steps && steps.earned != null)
      ? !!steps.earned
      : AV_AXIS_KEYS.every(k => st[k] === AV_STEPS - 1);
    return st;
  }
  function avSvgWrap(inner){
    return '<svg viewBox="0 0 ' + AV_W + ' ' + AV_H + '" xmlns="http://www.w3.org/2000/svg" class="av-svg" aria-hidden="true">' + inner + '</svg>';
  }
  // the whole drawn figure as one <svg> — what the preview matrix and any future thumbnail want
  function buildAvatarSvg(steps){
    const st = avNormSteps(steps);
    return avSvgWrap(avStack().map(l => l.draw(st)).join(''));
  }

  /* ================= your own artwork =================
     A slot is one (axis, state) pair — 4 axes x 4 states = 16 of them — and a slot holds one PNG.
     Fill the ones you have and the rest stay drawn, so the figure is never broken while a set is
     half-finished, and a slot can be replaced without touching any other.

     WHY THE POSITION IS STORED RATHER THAN BAKED IN. Layered character art normally needs every
     asset exported on one canvas at one origin, which is a build step this repo does not have and
     will not get. Dragging the layer into place instead moves that alignment into the app: x/y/w
     are a % of the STAGE, not pixels, so a slot placed on a laptop is still in register on a phone
     where the frame is a different size. Same reasoning as the scratch page's floating images, and
     the same three validated numbers.

     What lands in `state` is a Storage URL and three numbers — never image bytes. This key rides
     the shared blob that is re-uploaded in full on every save from every tab (CLAUDE.md's image
     convention), which is also why replacing a slot's art reclaims the old file. */
  const AV_SLOT_DEFAULT = { x: 0, y: 0, w: 100 };

  function avSlotKey(axis, step){ return axis + ':' + step; }
  function avLayersMap(){
    const self = selfState();
    if(!self.layers || typeof self.layers !== 'object') self.layers = {};
    return self.layers;
  }
  function avSlot(axis, step){
    const rec = avLayersMap()[avSlotKey(axis, step)];
    return (rec && typeof rec === 'object' && rec.url) ? rec : null;
  }
  /* ONE clamp, used by the read, by the live drag and by the write alike. That it is shared is the
     whole point: clamping only on read let the stored number and the drawn number disagree, so a
     drag past the limit followed your pointer and then jumped back on release, and the NEXT drag
     started from the clamped value rather than where the layer appeared to be. Placement drifted
     every time it happened. Clamp everywhere and stored always equals drawn, so nothing snaps.

     The bounds are deliberately generous — a layer at ±200% is entirely outside the frame already.
     They exist so a layer can never be dragged somewhere it can't be dragged back from, not to
     police where art may sit. */
  const AV_BOX_LIMIT = { xy: 200, wMin: 5, wMax: 400 };
  function avClampBox(x, y, w){
    const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
    const L = AV_BOX_LIMIT;
    return {
      x: Math.max(-L.xy, Math.min(L.xy, num(x, AV_SLOT_DEFAULT.x))),
      y: Math.max(-L.xy, Math.min(L.xy, num(y, AV_SLOT_DEFAULT.y))),
      w: Math.max(L.wMin, Math.min(L.wMax, num(w, AV_SLOT_DEFAULT.w)))
    };
  }
  // Read still validates, because this arrives from the same unauthenticated row as everything
  // else and a hand-edited w of 0 would make a layer invisible with no way back.
  function avSlotBox(rec){ return avClampBox(rec.x, rec.y, rec.w); }

  /* The figure as it is actually shown: every stack position in order, each either your PNG or
     this file's drawing of it. `focusAxis` is the artwork editor asking for one layer to be lit
     and the rest held back — it changes nothing about what is composited, only what is legible. */
  function avComposite(steps, focusAxis){
    const st = avNormSteps(steps);
    const anyArt = AV_AXIS_KEYS.some(k => avSlot(k, st[k]));
    return avStack().map(l=>{
      const dim = focusAxis && l.axis !== focusAxis ? ' is-dim' : '';
      const slot = l.axis ? avSlot(l.axis, st[l.axis]) : null;
      if(slot){
        const box = avSlotBox(slot);
        return '<img class="av-layer av-png' + dim + '" data-axis="' + l.axis + '" alt="" src="' + escapeHtml(slot.url) + '"' +
          ' style="left:' + avN(box.x) + '%;top:' + avN(box.y) + '%;width:' + avN(box.w) + '%">';
      }
      /* Scenery is dropped the moment any real art is in play: a drawn shadow under a photographed
         figure lands under nobody's feet, and unlike the four axis layers there is no slot to drag
         it into place with. The aura goes with it — a fully-earned day is still announced by the
         chips and the day line. */
      if(!l.axis && anyArt) return '';
      return '<div class="av-layer av-drawn' + dim + '"' + (l.axis ? ' data-axis="' + l.axis + '"' : '') + '>' + avSvgWrap(l.draw(st)) + '</div>';
    }).join('');
  }

  /* ================= the pane =================
     Everything below writes into static markup, the renderSelf() rule — nothing here is rebuilt
     except the two containers that hold no controls the user can be mid-click on. */
  function avStateLabel(axis, s){
    return s.untracked ? 'Not tracked' : axis.states[s.step];
  }

  function renderSelfAvatar(){
    const figure = el('selfFigure');
    if(!figure) return;
    const all = avShownState();
    const steps = avSteps(all);
    steps.earned = avFullyEarned(all);
    /* While a slot is being edited the figure shows THAT state for its axis rather than the live
       one — artwork for "exhausted" cannot be aligned against a face that is currently "rested".
       The other three axes keep their live values, so the layer is placed against the figure it
       will actually sit in. */
    if(avEditSlot) steps[avEditSlot.axis] = avEditSlot.step;
    figure.innerHTML = avComposite(steps, avEditSlot ? avEditSlot.axis : null);

    /* An open editing session replaces its layer's <img> with the live canvas, so every stroke is
       visible where the layer actually sits, composited against the layers around it — which is the
       only way to judge whether a bit of residue matters. The SAME node goes back in on every
       repaint rather than a copy, because it holds the work in progress. */
    if(avEdit && avEditSlot && avEdit.key === avSlotKey(avEditSlot.axis, avEditSlot.step)){
      const node = figure.querySelector('img.av-png[data-axis="' + avEditSlot.axis + '"]');
      if(node){
        avEdit.canvas.className = node.className;
        avEdit.canvas.setAttribute('data-axis', avEditSlot.axis);
        avEdit.canvas.setAttribute('style', node.getAttribute('style') || '');
        node.replaceWith(avEdit.canvas);
      }
    }

    // the readout: one chip per axis, saying which state he is in and what is left to earn
    const chips = el('selfAxisRow');
    if(chips){
      chips.innerHTML = AV_AXES.map(axis=>{
        const s = all[axis.key];
        const pct = s.untracked ? 0 : Math.round(s.pct);
        return '<div class="self-axis' + (s.untracked ? ' is-untracked' : '') + '" data-step="' + s.step + '" title="' + escapeHtml(axis.label + ' — ' + axis.hint) + '">' +
          '<div class="self-axis-top"><span class="self-axis-icon">' + axis.icon + '</span>' +
          '<span class="self-axis-lbl">' + escapeHtml(axis.short || axis.label) + '</span></div>' +
          '<div class="self-axis-state">' + escapeHtml(avStateLabel(axis, s)) + '</div>' +
          '<div class="self-axis-bar"><i style="width:' + pct + '%"></i></div>' +
          '<div class="self-axis-meta">' + (s.test ? 'test' : s.untracked ? 'Assign a checklist' : (s.done + ' / ' + s.total)) + '</div>' +
          '</div>';
      }).join('');
    }

    const day = el('selfDayLine');
    if(day && avTestOn){
      // The one place a reader would otherwise take the figure at face value, so it is the one
      // place the override has to be stated in words rather than left to a dashed outline.
      day.textContent = 'TEST MODE — this is a made-up day, not today.';
      day.classList.add('is-test');
    } else if(day){
      day.classList.remove('is-test');
      const earned = AV_AXES.filter(a => !all[a.key].untracked && all[a.key].step === AV_STEPS - 1).length;
      const tracked = AV_AXES.filter(a => !all[a.key].untracked).length;
      day.textContent = !tracked
        ? 'Nothing feeds him yet — open “What shapes him” below.'
        : earned === tracked
          ? 'Fully earned today. He resets in the morning.'
          : earned + ' of ' + tracked + ' earned today — ' + (tracked - earned) + ' to go.';
    }
  }

  /* ---------- the mapping editor ----------
     Rebuilt wholesale, which is safe because every control in it is a <select> that commits on
     change: a repaint can only happen after the change has already been applied. */
  function renderAvatarMapEditor(){
    const host = el('selfMapList');
    if(!host) return;
    const lists = avEligibleChecklists();
    const map = avMap();
    if(!lists.length){
      host.innerHTML = '<div class="self-map-none">No daily checklists yet. Only checklists set to <b>Reset daily</b> can shape him — that is what makes him start over each morning.</div>';
      return;
    }
    const opts = axisKey => ['<option value="">— not counted —</option>'].concat(
      AV_AXES.map(a => '<option value="' + a.key + '"' + (axisKey === a.key ? ' selected' : '') + '>' + a.icon + ' ' + escapeHtml(a.label) + '</option>')
    ).join('');
    host.innerHTML = lists.map(c=>{
      const done = c.items.filter(i => i.done).length;
      return '<div class="self-map-row">' +
        '<div class="self-map-name">' + escapeHtml(c.name) + '<span class="self-map-count">' + done + '/' + c.items.length + '</span></div>' +
        '<select class="self-map-pick" data-checklist-id="' + c.id + '">' + opts(map[c.id] || '') + '</select>' +
        '</div>';
    }).join('');
  }

  // Delegated from the panel, which is never itself replaced — the repaint above swaps its rows.
  const selfMapList = el('selfMapList');
  if(selfMapList){
    selfMapList.addEventListener('change', e=>{
      const pick = e.target.closest('.self-map-pick');
      if(!pick) return;
      avMap()[pick.dataset.checklistId] = pick.value;
      selfState().updatedAt = Date.now();
      save();
      renderSelfAvatar();   // the figure and chips move; the <select> already shows its own new value
    });
  }

  /* ================= the artwork editor =================
     Pick a slot, drop a PNG on the stage, drag it into place. That is the whole feature, and it is
     deliberately the whole feature: aligning layered character art is normally an export-time
     problem solved by a build step, and this moves it into the app instead, because the alignment
     only has to be right once per slot and you can see whether it is.

     Which slot you are aiming at is a MODULE variable, never `state`: it is a gesture in progress,
     not a preference, and persisting it would reopen the editor on a device that never asked. */
  let avEditSlot = null;    // {axis, step}
  let avDrag = null;

  // The editor is live only while its own pane is the one on screen. The paste handler is on
  // `document` — it has to be, since you paste at the page, not at an element — so this guard is
  // what stops it from reaching over the scratch pad or a modal sitting on top of it.
  function avEditActive(){
    if(!avEditSlot) return false;
    const pane = el('motivationPaneSelf');
    if(!pane || pane.style.display === 'none') return false;
    /* Computed, not inline: the scratch pad is a MODE that covers the whole page, and reading
       .style.display would call it closed whenever it happens to be shown by a stylesheet rather
       than by an inline write — which would let a paste meant for the napkin land on the avatar.
       This runs on paste only, so the cost of a computed read is nothing. */
    const scratch = el('scratchOverlay');
    if(scratch && getComputedStyle(scratch).display !== 'none') return false;
    return true;
  }
  function avArtHint(msg){
    const h = el('selfArtHint');
    if(h) h.textContent = msg || '';
  }
  function avAxisByKey(key){ return AV_AXES.find(a => a.key === key) || null; }

  function avSelectSlot(axis, step){
    // A session belongs to the slot it was opened on, so changing slots has to settle it first —
    // Cancel there means "stay", which is why this returns instead of selecting.
    if(!avLeaveEdit()) return;
    const same = avEditSlot && avEditSlot.axis === axis && avEditSlot.step === step;
    avEditSlot = same ? null : { axis, step };   // clicking the live slot again closes the editor
    avArtHint('');
    renderSelfAvatar();
    renderSelfArt();
  }

  /* ---------- the test-mode panel ----------
     One row per axis, one button per state, and the row is built from AV_AXES rather than from
     a list of its own — a fifth axis appeared here for free, and a sixth would too. */
  function renderSelfTest(){
    const panel = el('selfTestPanel'), btn = el('selfTestToggle');
    if(!panel || !btn) return;
    btn.classList.toggle('active', avTestOn);
    btn.textContent = avTestOn ? 'Test mode: ON' : 'Test mode';
    panel.style.display = avTestOn ? '' : 'none';
    const stage = el('selfStage');
    if(stage) stage.classList.toggle('is-test', avTestOn);
    if(!avTestOn){ panel.innerHTML = ''; return; }
    const shown = avSteps(avShownState());
    panel.innerHTML = AV_AXES.map(axis=>{
      const cells = [];
      for(let step = 0; step < AV_STEPS; step++){
        cells.push('<button type="button" class="self-test-step' + (shown[axis.key] === step ? ' is-on' : '') +
          '" data-testaxis="' + axis.key + '" data-teststep="' + step + '">' + escapeHtml(axis.states[step]) + '</button>');
      }
      return '<div class="self-test-row"><div class="self-test-axis">' + axis.icon + ' ' +
        escapeHtml(axis.label) + '</div><div class="self-test-steps">' + cells.join('') + '</div></div>';
    }).join('') +
      '<div class="self-test-quick">' +
      '<button type="button" class="btn btn-sm" data-testall="0">All at worst</button>' +
      '<button type="button" class="btn btn-sm" data-testall="3">All at best</button>' +
      '<button type="button" class="btn btn-sm" data-testall="live">Back to today</button></div>';
  }

  /* Entering seeds from the real day rather than from zero, so the first thing you see is where
     you actually are and the mixing starts from something true. */
  function avSetTestMode(on){
    avTestOn = !!on;
    if(avTestOn) avTestSteps = avSteps(avStateAll());
    renderSelfAvatar(); renderSelfArt(); renderSelfTest();
  }

  (function(){
    const btn = el('selfTestToggle');
    if(btn) btn.addEventListener('click', ()=> avSetTestMode(!avTestOn));
    const panel = el('selfTestPanel');
    if(panel) panel.addEventListener('click', e=>{
      const all = e.target.closest('[data-testall]');
      if(all){
        if(all.dataset.testall === 'live') avTestSteps = avSteps(avStateAll());
        else AV_AXIS_KEYS.forEach(k=>{ avTestSteps[k] = Number(all.dataset.testall); });
        renderSelfAvatar(); renderSelfArt(); renderSelfTest();
        return;
      }
      const cell = e.target.closest('[data-testaxis]');
      if(!cell) return;
      avTestSteps[cell.dataset.testaxis] = Number(cell.dataset.teststep);
      renderSelfAvatar(); renderSelfArt(); renderSelfTest();
    });
  })();

  /* Reordering the stack. `dir` is in the language of the PICTURE — "up" means toward the front,
     toward the viewer — not in the language of the array, where the front is the far end. The two
     run opposite ways, and saying so here is cheaper than a reader working it out at each call.

     The whole order is written every time rather than a swap in place, because avStackOrder()
     validates on read and a partially-written array would simply be discarded as invalid. */
  function avMoveLayer(axisKey, dir){
    const order = avStackOrder();               // bottom -> top
    const i = order.indexOf(axisKey);
    if(i < 0) return;
    const j = dir === 'up' ? i + 1 : i - 1;     // toward the front is later in the array
    if(j < 0 || j >= order.length) return;
    order[i] = order[j];
    order[j] = axisKey;
    selfState().order = order;
    selfState().updatedAt = Date.now();
    save();
    renderSelfAvatar();
    renderSelfArt();
  }

  /* The grid runs in STACK ORDER, front of the figure first — the Photoshop convention, and the
     only arrangement in which the ▲▼ on each row mean something you can see. It is deliberately a
     different order from the axis chips higher up the pane: those are a readout and read in a fixed
     order, this one is about what covers what. */
  function renderSelfArt(){
    const grid = el('selfArtGrid');
    if(!grid) return;
    const live = avSteps(avShownState());   // 'is-live' must mean what the figure is showing
    const order = avStackOrder();                 // bottom -> top
    const front = order.slice().reverse();        // top -> bottom, which is how it is shown
    grid.innerHTML = front.map((axisKey, i)=>{
      const axis = avAxisByKey(axisKey);
      if(!axis) return '';
      const cells = [];
      for(let step = 0; step < AV_STEPS; step++){
        const rec = avSlot(axis.key, step);
        const on = avEditSlot && avEditSlot.axis === axis.key && avEditSlot.step === step;
        cells.push('<button type="button" class="self-art-cell' + (on ? ' is-on' : '') + (live[axis.key] === step ? ' is-live' : '') +
          '" data-axis="' + axis.key + '" data-step="' + step + '" title="' + escapeHtml(axis.label + ' — ' + axis.states[step]) + '">' +
          '<span class="self-art-thumb">' + (rec ? '<img alt="" src="' + escapeHtml(rec.url) + '">' : '<i>+</i>') + '</span>' +
          '<span class="self-art-name">' + escapeHtml(axis.states[step]) + '</span></button>');
      }
      const ord = '<span class="self-art-ord">' +
        '<button type="button" data-move="up" data-axis="' + axis.key + '" title="Move this layer in front of the one above it"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
        '<button type="button" data-move="down" data-axis="' + axis.key + '" title="Move this layer behind the one below it"' + (i === front.length - 1 ? ' disabled' : '') + '>▼</button>' +
        '</span>';
      return '<div class="self-art-row"><div class="self-art-axis">' +
        '<span class="self-art-axis-name">' + axis.icon + ' ' + escapeHtml(axis.label) + '</span>' + ord + '</div>' +
        '<div class="self-art-cells">' + cells.join('') + '</div></div>';
    }).join('');

    const tools = el('selfArtTools');
    if(!tools) return;
    tools.style.display = avEditSlot ? '' : 'none';
    const stage = el('selfStage');
    stage.classList.toggle('is-editing', !!avEditSlot);
    stage.classList.toggle('is-erasing', !!avEditSlot && avArtMode === 'erase');
    if(!avEditSlot) return;
    const axis = avAxisByKey(avEditSlot.axis);
    const rec = avSlot(avEditSlot.axis, avEditSlot.step);
    const box = rec ? avSlotBox(rec) : AV_SLOT_DEFAULT;
    el('selfArtNow').textContent = (axis ? axis.label : avEditSlot.axis) + ' · ' + (axis ? axis.states[avEditSlot.step] : avEditSlot.step);
    el('selfArtUpText').textContent = rec ? '⟳ Replace PNG' : '＋ Add PNG';
    ['selfArtRemoveBg', 'selfArtRemove', 'selfArtReset', 'selfArtMatch'].forEach(id=>{
      const b = el(id);
      if(b) b.disabled = !rec;
    });

    // Move / Erase, and the controls that only make sense on one side of it
    const erasing = avArtMode === 'erase';
    document.querySelectorAll('#selfArtMode [data-artmode]').forEach(b=>{
      b.classList.toggle('active', (b.dataset.artmode === 'erase') === erasing);
      b.disabled = !rec;                      // nothing to erase out of a slot with no art in it
    });
    const move = el('selfArtMoveRow'), er = el('selfArtEraseRow');
    if(move) move.style.display = erasing ? 'none' : '';
    if(er) er.style.display = erasing ? '' : 'none';
    const size = el('selfArtSize');
    if(size) size.value = Math.round(box.w);
    const brush = el('selfArtBrush');
    if(brush) brush.value = avBrushPx;
    const tolIn = el('selfArtTol'), tolNum = el('selfArtTolNum');
    if(tolIn) tolIn.value = avBgTol;
    if(tolNum) tolNum.textContent = avBgTol;
    const undo = el('selfArtUndo'), apply = el('selfArtApply'), revert = el('selfArtRevert');
    if(undo) undo.disabled = !(avEdit && avEdit.undo.length);
    if(apply) apply.disabled = !(avEdit && avEdit.dirty);
    if(revert) revert.disabled = !(avEdit && avEdit.dirty);

    if(!rec) avArtHint('Drop a PNG on the figure, paste one with Ctrl+V, or use the button.');
  }

  /* ---------- putting art in a slot ----------
     One door for every way art reaches a slot — button, paste, drop, or the computed cut-out
     below — so the upload rules, the reclaim of the file being replaced and the "keep the
     position you already dialled in" behaviour can't drift apart between any of them.

     Takes the slot KEY rather than reading avEditSlot itself, because uploadCompressedImage() is
     a network round-trip: the user is free to select a different slot while it's in flight, and
     the art has to land in the slot it was chosen FOR, not in whatever happens to be selected
     when the upload finally resolves. */
  function avUploadIntoSlot(key, blob){
    avArtHint('Uploading…');
    /* Alpha is the entire point of a layer, and uploadCompressedImage() keeps it whenever the
       pixels carry it (js/core.js) — a cut-out arrives as PNG, a full-bleed background plate still
       comes back a JPEG. 1600 because this is layered art that gets scaled up on a big stage. */
    uploadCompressedImage(blob, 1600, 0.92, 'avatar').then(url=>{
      const map = avLayersMap();
      const old = map[key] && map[key].url;
      const box = map[key] ? avSlotBox(map[key]) : AV_SLOT_DEFAULT;
      // A replacement keeps the placement: re-exporting the same layer and having to re-align it
      // every time is exactly the friction this editor exists to remove.
      map[key] = { url, x: box.x, y: box.y, w: box.w };
      if(old) deleteStorageImage(old);
      selfState().updatedAt = Date.now();
      avArtHint('');
      save(); renderSelfAvatar(); renderSelfArt();
    }).catch(err => avArtHint(err.message || 'Could not upload that image.'));
  }
  function avSetSlotArt(file){
    if(!avEditSlot || !file) return;
    avUploadIntoSlot(avSlotKey(avEditSlot.axis, avEditSlot.step), file);
  }

  /* ================= editing a layer's pixels =================
     A working session on ONE slot: the decoded bitmap, an undo stack, and whether it has been
     touched. It exists so that the two ways of taking pixels away — the flood fill and the brush —
     are the same edit rather than two round-trips through Storage. Remove BG then brush the residue
     then Apply is ONE upload, not three, and Undo reaches back across both kinds of stroke.

     Nothing here is persisted until Apply. That is the whole point: a session is scratch work, and
     an edit that uploaded as you painted would put a new file in Storage for every stroke and
     re-upload the shared blob with it.

     The session is held in a module variable, never in `state` — it holds a decoded canvas, which
     is megabytes, and it means nothing to another device. */
  let avEdit = null;          // { key, canvas, undo:[canvas], dirty }
  let avArtMode = 'move';     // 'move' | 'erase' — which gesture the stage answers to
  let avBrushPx = 30;         // brush DIAMETER in screen pixels, so it feels the same at any zoom
  let avStroke = null;

  /* Ten is a real cap, not a round number: each entry is a full copy of the layer bitmap, and at
     the 2000px ceiling scratchStudioCanvas() imposes that is ~16MB apiece. Ten is about as far back
     as anyone reaches while cleaning up an edge, and it keeps the worst case on a phone survivable. */
  const AV_UNDO_CAP = 10;

  // Decode a slot's art into a canvas we are allowed to read back. Supabase Storage answers with a
  // wildcard CORS header, so this is free for anything this editor uploaded (js/scratch.js's own
  // image-studio probe, same reasoning) — and a data: URL simply ignores the attribute.
  function avLoadSlotCanvas(url, ok, fail){
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = ()=>{
      let c;
      try{
        c = scratchStudioCanvas(img);
        c.getContext('2d').getImageData(0, 0, 1, 1);   // the taint check, and the only one that counts
      }catch(e){ fail('This image can’t be edited here — the file would not allow a pixel read.'); return; }
      ok(c);
    };
    img.onerror = ()=> fail('Could not load this layer’s image.');
    img.src = url;
  }

  function avCloneCanvas(src){
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    c.getContext('2d').drawImage(src, 0, 0);
    return c;
  }
  function avPushUndo(){
    if(!avEdit) return;
    avEdit.undo.push(avCloneCanvas(avEdit.canvas));
    if(avEdit.undo.length > AV_UNDO_CAP) avEdit.undo.shift();
  }

  /* Opens a session on the selected slot if there isn't one already, then runs `then`. Everything
     that edits pixels goes through here, so there is one place that knows how to get from a stored
     URL to a readable canvas. */
  function avOpenEdit(then){
    if(!avEditSlot) return;
    const key = avSlotKey(avEditSlot.axis, avEditSlot.step);
    if(avEdit && avEdit.key === key){ if(then) then(); return; }
    const rec = avLayersMap()[key];
    if(!rec || !rec.url) return;
    avArtHint('Loading the layer…');
    avLoadSlotCanvas(rec.url, c=>{
      avEdit = { key: key, orig: c, canvas: avCloneCanvas(c), undo: [], dirty: false };
      avArtHint('');
      if(then) then();
      renderSelfAvatar(); renderSelfArt();
    }, msg => avArtHint(msg));
  }

  /* Leaving a session with strokes in it. Cancel keeps you where you are rather than losing the
     work — the scratch studio's own rule, and for the same reason: the alternative is a confirm
     that can only destroy. Returns whether the caller may proceed. */
  function avLeaveEdit(){
    if(!avEdit) return true;
    if(avEdit.dirty && !window.confirm('Discard the unsaved erase work on this layer?')) return false;
    avEdit = null;
    avArtMode = 'move';
    return true;
  }

  // Apply is the only thing in this section that touches Storage, and it hands the result to the
  // same door every other way of filling a slot uses.
  function avApplyEdit(){
    if(!avEdit) return;
    const key = avEdit.key, canvas = avEdit.canvas;
    avArtHint('Saving the edit…');
    canvas.toBlob(blob=>{
      if(!blob){ avArtHint('Could not encode that edit.'); return; }
      avEdit = null;
      avArtMode = 'move';
      avUploadIntoSlot(key, blob);
    }, 'image/png');
  }

  /* ---------- the flood fill ----------
     Reuses js/scratch.js's cut-out (scratchCutout / scratchStudioCanvas) rather than a second copy
     of it: the algorithm is generic — a canvas, a tolerance, a seed list — scratch.js is only where
     it was written first, for its own image studio. Both are ordinary top-level functions (no
     module, no IIFE — this repo's "no build step" architecture means every js/ file shares one
     global scope), so nothing needs importing. The one thing to be careful of: avatar.js loads
     BEFORE scratch.js in index.html's fixed script order, which is fine ONLY because these are
     never called until a click handler runs, long after every script tag has executed — never at
     parse time, where the name would not exist yet.

     It floods in from the four edges with no hand-picked seeds, so it lifts a subject off ONE
     plain-ish backdrop and will not segment a busy photo — the same honest limit the studio itself
     documents. What it leaves behind is exactly what the brush is for, which is why this now lands
     in the session instead of uploading: fill, brush the residue, Apply once. */
  /* STRENGTH is exposed rather than fixed, and the reason is concrete. Art exported from an editor
     with the transparency checkerboard flattened into it arrives as TWO alternating greys, and a
     flood tight enough to take one of them leaves the other behind as a grid of squares — which is
     what "it still leaves residue" usually turns out to be. One number decides whether both shades
     fall in the same region, so it has to be reachable; the scratch studio exposes exactly the same
     control on its own Edge slider, and 22 is its default.

     Each re-fill runs from `orig`, the pristine decode, NOT from whatever is on the canvas now.
     Running a fill over its own output compounds — the second pass starts from edges the first one
     already ate — so cranking the slider and pressing the button again has to mean "try again from
     the top", which is the only reading that lets you hunt for the right number. It costs the brush
     strokes made before the re-fill, which is why the undo stack takes a copy first. */
  let avBgTol = 22;                          // the scratch studio's own Edge-slider default
  const AV_TOL_SCALE = 2.6;                  // tol -> linear distance, the way scratchStudioTol() does it
  function avRemoveBg(){
    avOpenEdit(()=>{
      if(!avEdit) return;
      let cut;
      try{ cut = scratchCutout(avEdit.orig, avBgTol * AV_TOL_SCALE, []); }
      catch(e){ avArtHint('Could not read this image back.'); return; }
      avPushUndo();
      avEdit.canvas = cut;
      avEdit.dirty = true;
      avArtMode = 'erase';    // residue is the norm, so hand over the brush rather than making them find it
      avArtHint('Background removed at strength ' + avBgTol + ' — raise it and press again if it left specks, or brush them off.');
      renderSelfAvatar(); renderSelfArt();
    });
  }

  /* ---------- the brush ----------
     destination-out with a round cap: the standard erase, and the only compositing mode that takes
     alpha away rather than painting a colour over it.

     The brush is sized in SCREEN pixels and converted per stroke, because the layer is drawn at
     whatever the slot's width happens to be — a brush measured in the bitmap's own pixels would be
     a different size on screen for every layer, which is the opposite of what a brush should be. */
  function avStrokePoint(e, node){
    const r = node.getBoundingClientRect();
    if(!r.width || !r.height) return null;
    return {
      x: (e.clientX - r.left) / r.width * node.width,
      y: (e.clientY - r.top) / r.height * node.height,
      k: node.width / r.width          // screen px -> bitmap px
    };
  }
  function avBrushDown(e, node){
    const p = avStrokePoint(e, node);
    if(!p) return false;
    avPushUndo();
    const ctx = node.getContext('2d');
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, avBrushPx * p.k);
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    // a tap with no drag still has to take a bite out, so put the first dab down immediately
    ctx.lineTo(p.x + 0.01, p.y);
    ctx.stroke();
    avStroke = { ctx: ctx, node: node, id: e.pointerId };
    avEdit.dirty = true;
    return true;
  }
  function avBrushMove(e){
    if(!avStroke || e.pointerId !== avStroke.id) return;
    const p = avStrokePoint(e, avStroke.node);
    if(!p) return;
    avStroke.ctx.lineTo(p.x, p.y);
    avStroke.ctx.stroke();
  }
  function avBrushUp(){
    if(!avStroke) return;
    avStroke.ctx.restore();
    avStroke = null;
    renderSelfArt();   // the thumbnail and the hint catch up; the canvas itself is already current
  }

  // Rounded on the way in: a drag produces things like 20.000000000000004, and this record is
  // re-serialised into the shared blob on every save from every tab. Two decimals is finer than a
  // pixel on any stage this is drawn at.
  const avRound = v => Math.round(v * 100) / 100;
  function avWriteBox(patch, persist){
    if(!avEditSlot) return;
    const map = avLayersMap(), key = avSlotKey(avEditSlot.axis, avEditSlot.step);
    if(!map[key] || !map[key].url) return;
    const box = avSlotBox(map[key]);
    const next = avClampBox(patch.x != null ? patch.x : box.x, patch.y != null ? patch.y : box.y, patch.w != null ? patch.w : box.w);
    map[key] = { url: map[key].url, x: avRound(next.x), y: avRound(next.y), w: avRound(next.w) };
    if(persist){ selfState().updatedAt = Date.now(); save(); }
  }

  /* ---------- drag to place ----------
     Pointer capture goes on the STAGE, never on the image: renderSelfAvatar() replaces the <img>
     whenever anything repaints, and a capture held by a node that gets swapped out dies with it —
     the same rule the scratch dot row is built on. The drag writes straight to the element's style
     and only reaches `state` on release, so a placement gesture costs no repaint and no save until
     it is finished. */
  (function(){
    const stage = el('selfStage');
    if(!stage) return;

    stage.addEventListener('pointerdown', e=>{
      if(!avEditActive()) return;
      const rec = avSlot(avEditSlot.axis, avEditSlot.step);
      if(!rec) return;
      /* Erase takes the same gesture Move uses, so the mode decides which one a drag on the stage
         means. The brush works on the live session canvas, which renderSelfAvatar() has already
         put in the layer's place — if there isn't one yet, the click opens it and the user draws
         on the next stroke rather than having the first one silently do nothing. */
      if(avArtMode === 'erase'){
        const node = stage.querySelector('canvas.av-png[data-axis="' + avEditSlot.axis + '"]');
        if(!node){ avOpenEdit(); return; }
        if(avBrushDown(e, node)){
          try{ stage.setPointerCapture(e.pointerId); }catch(err){}
          e.preventDefault();
        }
        return;
      }
      const img = stage.querySelector('.av-png[data-axis="' + avEditSlot.axis + '"]');
      const r = stage.getBoundingClientRect();
      if(!img || !r.width || !r.height) return;
      const box = avSlotBox(rec);
      avDrag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, bx: box.x, by: box.y, w: r.width, h: r.height, img, moved: false };
      try{ stage.setPointerCapture(e.pointerId); }catch(err){}
      e.preventDefault();
    });

    stage.addEventListener('pointermove', e=>{
      if(avStroke){ avBrushMove(e); return; }
      if(!avDrag || e.pointerId !== avDrag.id) return;
      const dx = e.clientX - avDrag.x0, dy = e.clientY - avDrag.y0;
      if(!avDrag.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;   // a tap is not a drag
      avDrag.moved = true;
      // clamped HERE too, not just on release: the layer has to stop where it will actually be
      // saved, or it follows the pointer out and springs back the moment you let go
      const at = avClampBox(avDrag.bx + (dx / avDrag.w) * 100, avDrag.by + (dy / avDrag.h) * 100, 100);
      avDrag.nx = at.x; avDrag.ny = at.y;
      avDrag.img.style.left = avN(at.x) + '%';
      avDrag.img.style.top = avN(at.y) + '%';
    });

    const end = e=>{
      if(avStroke){
        try{ stage.releasePointerCapture(avStroke.id); }catch(err){}
        avBrushUp();
        return;
      }
      if(!avDrag || (e && e.pointerId !== avDrag.id)) return;
      const d = avDrag; avDrag = null;
      try{ stage.releasePointerCapture(d.id); }catch(err){}
      if(!d.moved) return;
      avWriteBox({ x: d.nx, y: d.ny }, true);
      renderSelfArt();
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);

    // Drop a file straight onto the figure. dragover has to preventDefault or the browser
    // navigates to the image instead of handing it over.
    stage.addEventListener('dragover', e=>{
      if(!avEditActive()) return;
      e.preventDefault();
      stage.classList.add('is-drop');
    });
    stage.addEventListener('dragleave', ()=> stage.classList.remove('is-drop'));
    stage.addEventListener('drop', e=>{
      if(!avEditActive()) return;
      e.preventDefault();
      stage.classList.remove('is-drop');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if(f && /^image\//.test(f.type)) avSetSlotArt(f);
      else avArtHint('That was not an image file.');
    });
  })();

  // Paste. On `document` because that is where a paste with nothing focused lands; avEditActive()
  // is what keeps it from reaching across the scratch pad, which has a paste handler of its own.
  document.addEventListener('paste', e=>{
    if(!avEditActive()) return;
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for(let i = 0; i < items.length; i++){
      if(items[i].kind === 'file' && /^image\//.test(items[i].type)){
        const f = items[i].getAsFile();
        if(f){ e.preventDefault(); avSetSlotArt(f); return; }
      }
    }
  });

  /* ---------- the panel's own controls ----------
     Delegated from the grid container, which is never itself replaced — only its rows are. */
  (function(){
    const grid = el('selfArtGrid');
    if(grid) grid.addEventListener('click', e=>{
      /* The arrows sit inside the row but outside any cell, so this order is not a tie-break —
         a click is one or the other and never both. */
      const mv = e.target.closest('[data-move]');
      if(mv){ avMoveLayer(mv.dataset.axis, mv.dataset.move); return; }
      const cell = e.target.closest('.self-art-cell');
      if(cell) avSelectSlot(cell.dataset.axis, Number(cell.dataset.step));
    });

    const input = el('selfArtInput');
    if(input) input.addEventListener('change', e=>{
      const f = e.target.files[0];
      e.target.value = '';                       // picking the same file twice still fires
      if(f) avSetSlotArt(f);
    });

    const size = el('selfArtSize');
    if(size){
      // live on input, saved on change: dragging a slider fires continuously, and a save per tick
      // would re-upload the whole shared blob a hundred times per gesture
      size.addEventListener('input', ()=>{
        if(!avEditSlot) return;
        const w = Number(size.value);
        avWriteBox({ w }, false);
        const img = el('selfStage').querySelector('.av-png[data-axis="' + avEditSlot.axis + '"]');
        if(img) img.style.width = avN(w) + '%';
      });
      size.addEventListener('change', ()=>{ avWriteBox({ w: Number(size.value) }, true); });
    }

    const on = (id, fn) => { const b = el(id); if(b) b.addEventListener('click', fn); };

    on('selfArtRemoveBg', avRemoveBg);

    /* Move / Erase. Leaving Erase settles the session, so a stray stroke can't be abandoned by
       accident — and entering it opens one, so the first brush stroke lands rather than being the
       click that loads the bitmap. */
    const modeRow = el('selfArtMode');
    if(modeRow) modeRow.addEventListener('click', e=>{
      const b = e.target.closest('[data-artmode]');
      if(!b || b.disabled) return;
      const want = b.dataset.artmode === 'erase' ? 'erase' : 'move';
      if(want === avArtMode) return;
      if(want === 'move'){
        if(!avLeaveEdit()) return;
        avArtMode = 'move';
        renderSelfAvatar(); renderSelfArt();
        return;
      }
      avArtMode = 'erase';
      avOpenEdit();
      renderSelfAvatar(); renderSelfArt();
    });

    const brush = el('selfArtBrush');
    if(brush) brush.addEventListener('input', ()=>{ avBrushPx = Number(brush.value) || 30; });

    // Strength only takes effect on the next Remove BG — a live re-fill per slider tick would run
    // a full flood over a multi-megapixel bitmap on every pointer move.
    const tol = el('selfArtTol');
    if(tol) tol.addEventListener('input', ()=>{
      avBgTol = Number(tol.value) || 22;
      const out = el('selfArtTolNum');
      if(out) out.textContent = avBgTol;
    });

    on('selfArtUndo', ()=>{
      if(!avEdit || !avEdit.undo.length) return;
      avEdit.canvas = avEdit.undo.pop();
      /* `dirty` deliberately stays set even when the stack empties. Undoing back to where you
         started is not the same as never having started: the session still holds a decoded bitmap
         that Apply would happily upload, and Discard is the control that says "forget it". */
      renderSelfAvatar(); renderSelfArt();
    });

    on('selfArtApply', avApplyEdit);

    on('selfArtRevert', ()=>{
      if(!avEdit) return;
      if(avEdit.dirty && !window.confirm('Throw away the erase work on this layer?')) return;
      avEdit = null;
      avArtMode = 'move';
      avArtHint('');
      renderSelfAvatar(); renderSelfArt();
    });

    on('selfArtRemove', ()=>{
      if(!avEditSlot) return;
      const map = avLayersMap(), key = avSlotKey(avEditSlot.axis, avEditSlot.step);
      if(!map[key]) return;
      if(!window.confirm('Remove this layer’s artwork? The drawn version takes its place.')) return;
      deleteStorageImage(map[key].url);
      delete map[key];
      selfState().updatedAt = Date.now();
      save(); renderSelfAvatar(); renderSelfArt();
    });

    on('selfArtReset', ()=>{ avWriteBox(AV_SLOT_DEFAULT, true); renderSelfAvatar(); renderSelfArt(); });

    /* Every layer back to filling the frame at once. Worth a button of its own because the common
       case is a set exported from ONE canvas, where 0/0/100 on all sixteen is not a reset so much
       as the correct answer — and because a placement made while the stack was mis-rendering is
       worth nothing, so hunting sixteen slots down by hand to undo it is the wrong ask. */
    /* Separate from Reset-all-positions on purpose: order and placement are two different things
       to have got wrong, and a button that quietly did both would be impossible to reach for when
       you only meant one. */
    on('selfArtDefaultOrder', ()=>{
      selfState().order = AV_ORDER_DEFAULT.slice();
      selfState().updatedAt = Date.now();
      save(); renderSelfAvatar(); renderSelfArt();
      avArtHint('Stack back to the default: body, then clothes, then face, then hair.');
    });

    on('selfArtResetAll', ()=>{
      const map = avLayersMap();
      const keys = Object.keys(map).filter(k => map[k] && map[k].url);
      if(!keys.length){ avArtHint('No layers to reset yet.'); return; }
      if(!window.confirm('Put all ' + keys.length + ' layers back to filling the frame? Their artwork is kept — only the position and size are reset.')) return;
      keys.forEach(k=>{ map[k] = { url: map[k].url, x: AV_SLOT_DEFAULT.x, y: AV_SLOT_DEFAULT.y, w: AV_SLOT_DEFAULT.w }; });
      selfState().updatedAt = Date.now();
      save(); renderSelfAvatar(); renderSelfArt();
      avArtHint('All ' + keys.length + ' layers reset to fill the frame.');
    });

    /* Four states of one axis are nearly always exported from one canvas, so once a single hair
       layer is in the right place the other three want exactly the same numbers. Without this the
       editor asks you to do the same alignment four times and get it four times right. */
    on('selfArtMatch', ()=>{
      if(!avEditSlot) return;
      const map = avLayersMap(), src = avSlot(avEditSlot.axis, avEditSlot.step);
      if(!src) return;
      const box = avSlotBox(src);
      let touched = 0;
      for(let step = 0; step < AV_STEPS; step++){
        const key = avSlotKey(avEditSlot.axis, step);
        if(step === avEditSlot.step || !map[key] || !map[key].url) continue;
        map[key] = { url: map[key].url, x: box.x, y: box.y, w: box.w };
        touched++;
      }
      if(!touched){ avArtHint('No other state on this axis has artwork yet.'); return; }
      selfState().updatedAt = Date.now();
      save(); renderSelfAvatar(); renderSelfArt();
      avArtHint('Matched ' + touched + ' other state' + (touched === 1 ? '' : 's') + ' on this axis.');
    });

    on('selfArtDone', ()=>{ if(!avLeaveEdit()) return; avEditSlot = null; renderSelfAvatar(); renderSelfArt(); });
  })();

