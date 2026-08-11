  /* ================= FINANCE ================= */
  const FINANCE_CATEGORIES = ['Income','Food','Transport','Bills & Subscriptions','Shopping','Health','Entertainment','Savings/Transfer','Other'];

  // captures one net-worth data point per calendar day, updating today's point in place if
  // save() runs more than once that day — same per-day dedupe idiom as recomputeDailyActivity()
  function snapshotNetWorth(){
    const hist = state.finance.netWorthHistory || (state.finance.netWorthHistory = []);
    const today = localDateStr(new Date());
    const value = getNetWorthNum();
    const last = hist[hist.length-1];
    if(last && last.date === today) last.value = value;
    else hist.push({ date: today, value });
  }

  // Writes a money figure into a .fin-stat-num and tints it only when it is non-zero, so an empty
  // total reads as "nothing here" rather than as a red warning.
  function setToneAmount(node, amount, ccy, tone){
    if(!node) return;
    node.textContent = fmtMoney(amount, ccy);
    const on = Math.abs(amount) >= 0.005;
    node.classList.toggle('pos', tone === 'pos' && on);
    node.classList.toggle('neg', tone === 'neg' && on);
  }

  function financeAccountLabel(type){
    return {savings:'Savings', credit:'Credit', lent:'Lent', 'custom-asset':'Custom (Asset)', 'custom-liability':'Custom (Liability)'}[type] || type;
  }
  function financeIcon(type){
    return {savings:'\ud83d\udcb0', credit:'\ud83d\udcb3', lent:'\ud83e\udd1d', 'custom-asset':'\ud83d\udcc8', 'custom-liability':'\ud83d\udcc9'}[type] || '\ud83d\udcbc';
  }

  // one-time population of every currency <select> in the Finance view
  function populateCurrencySelects(){
    const opts = CURRENCIES.map(c=>'<option value="'+c+'">'+c+' ('+ccySymbol(c)+')</option>').join('');
    ['finCurrency','subCurrency','mgCurrency','debtCurrency','convFrom','convTo'].forEach(id=>{ const s = el(id); if(s) s.innerHTML = opts; });
    if(el('convFrom')) el('convFrom').value = 'USD';
    if(el('convTo')) el('convTo').value = CURRENCIES.includes('PHP') ? 'PHP' : 'USD';
  }

  function renderFinance(){
    renderNetWorthChart();
    renderFinanceAccounts();
    renderDebts();
    renderFinanceSubs();
    renderFinanceConverter();
    renderMoneyGoals();
  }

  /* ---- net worth trend chart: line chart over state.finance.netWorthHistory, zoomable ----
     Same hand-rolled SVG approach as the Fitness weight chart (see renderWeightChart() in
     fitness.js) minus the BMI bands / moving average, which don't have a net-worth analogue.
     Three things differ from a plain polyline, all for legibility rather than decoration: an area
     wash under the line so the trend reads as a mass at a glance, a dot only on the latest point
     (one per day turned a year of history into a dotted rope), and a scrub readout, because a
     chart you can't query only answers "roughly which way". */
  const FINANCE_CHART_ZOOMS = [
    {key:'1m', label:'1M', months:1},
    {key:'3m', label:'3M', months:3},
    {key:'6m', label:'6M', months:6},
    {key:'1y', label:'1Y', months:12},
    {key:'all', label:'All', months:null}
  ];
  let netWorthChartZoom = '6m'; // not persisted — resets to a sensible default each page load

  // short form for the delta chip — "₱124k" instead of "₱124,500.00", which at this size is
  // noise rather than information
  function fmtMoneyShort(v, ccy){
    const sym = ccySymbol(ccy||'USD');
    const a = Math.abs(v), sign = v < 0 ? '-' : '';
    const trim = n => n.toFixed(1).replace(/\.0$/,'');
    if(a >= 1e9) return sign+sym+trim(a/1e9)+'B';
    if(a >= 1e6) return sign+sym+trim(a/1e6)+'M';
    if(a >= 1e4) return sign+sym+Math.round(a/1e3)+'k';
    if(a >= 1e3) return sign+sym+trim(a/1e3)+'k';
    return sign+sym+Math.round(a).toLocaleString();
  }

  /* Axis ticks need precision chosen from the *span* being plotted, not from the magnitude of the
     numbers: a net worth hovering between ₱154,200 and ₱155,100 rounds to "₱154k, ₱155k, ₱155k,
     ₱155k" — four labels, two distinct values, and a chart that looks flat by mistake. So the
     decimal count comes from how wide the visible range is. */
  function axisTickFormatter(minV, maxV, ccy){
    const sym = ccySymbol(ccy||'USD');
    const range = Math.abs(maxV - minV) || 1;
    const mag = Math.max(Math.abs(minV), Math.abs(maxV));
    if(mag >= 1e6){
      const d = range < 1e5 ? 2 : range < 1e6 ? 1 : 0;
      return v => (v<0?'-':'')+sym+Math.abs(v/1e6).toFixed(d)+'M';
    }
    if(mag >= 1e4){
      const d = range < 1e3 ? 2 : range < 1e4 ? 1 : 0;
      return v => (v<0?'-':'')+sym+Math.abs(v/1e3).toFixed(d)+'k';
    }
    const d = range < 10 ? 2 : range < 100 ? 1 : 0;
    return v => (v<0?'-':'')+sym+Math.abs(v).toFixed(d);
  }

  // the range control is stable markup — rebuilding it every render (and re-binding its listeners)
  // was pointless churn, and it fought the CSS transition on the active segment
  function renderNetWorthZoomRow(){
    const zoomRow = el('nwChartZoomRow'); if(!zoomRow) return;
    if(!zoomRow.dataset.built){
      zoomRow.dataset.built = '1';
      zoomRow.innerHTML = FINANCE_CHART_ZOOMS.map(z=>
        '<button type="button" data-zoom="'+z.key+'">'+z.label+'</button>'
      ).join('');
      zoomRow.querySelectorAll('button').forEach(btn=>{
        btn.addEventListener('click', ()=>{ netWorthChartZoom = btn.dataset.zoom; renderNetWorthChart(); });
      });
    }
    zoomRow.querySelectorAll('button').forEach(btn=>{
      const on = btn.dataset.zoom === netWorthChartZoom;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function renderNetWorthChart(){
    renderNetWorthZoomRow();

    const nwCcy = state.profile.netWorthCurrency || 'USD';
    const currentValueEl = el('nwCurrentValue'); if(!currentValueEl) return;
    currentValueEl.textContent = fmtMoney(convertAmt(getNetWorthNum(), 'USD', nwCcy), nwCcy);
    // the display currency used to be cycled by clicking the figure, which nothing announced and
    // no keyboard could reach — it's a labelled control of its own now, showing the active code
    const ccyBtn = el('nwCurrencyBtn');
    if(ccyBtn){
      ccyBtn.textContent = nwCcy;
      if(!ccyBtn.dataset.wired){
        ccyBtn.dataset.wired = '1';
        ccyBtn.addEventListener('click', ()=>{
          const idx = CURRENCIES.indexOf(state.profile.netWorthCurrency || 'USD');
          state.profile.netWorthCurrency = CURRENCIES[(idx+1) % CURRENCIES.length];
          save(); renderFinance(); renderGoals();
        });
      }
    }

    const wrap = el('nwChartWrap');
    const deltaEl = el('nwDelta');
    const log = (state.finance.netWorthHistory||[]).slice().sort((a,b)=> a.date.localeCompare(b.date));
    const setDelta = html => { if(deltaEl) deltaEl.innerHTML = html; };
    if(log.length < 2){
      setDelta('<span class="fin-delta-val flat">No trend yet</span>');
      wrap.innerHTML = '<div class="fin-chart-empty">Check back in a couple of days — net worth is snapshotted once per day you open the app.</div>';
      return;
    }
    const zoomOpt = FINANCE_CHART_ZOOMS.find(z=>z.key===netWorthChartZoom) || FINANCE_CHART_ZOOMS[2];
    let points = log;
    if(zoomOpt.months != null){
      const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - zoomOpt.months);
      const cutoffStr = localDateStr(cutoff);
      points = log.filter(e=>e.date >= cutoffStr);
    }
    if(points.length < 2){
      setDelta('<span class="fin-delta-val flat">No trend yet</span>');
      wrap.innerHTML = '<div class="fin-chart-empty">Nothing recorded in this range — try a wider one.</div>';
      return;
    }

    const vals = points.map(p => convertAmt(p.value, 'USD', nwCcy));

    // headline change across the visible window — the arrow repeats what the colour says so the
    // direction survives greyscale printing and colour blindness
    const change = vals[vals.length-1] - vals[0];
    const base = Math.abs(vals[0]);
    const pctTxt = base > 0.005 ? ' (' + Math.abs(change/base*100).toFixed(1).replace(/\.0$/,'') + '%)' : '';
    const dir = Math.abs(change) < 0.005 ? 'flat' : (change > 0 ? 'up' : 'down');
    const arrow = dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→';
    const rangeTxt = zoomOpt.months == null ? 'all time'
      : zoomOpt.months === 12 ? 'the past year'
      : 'the past ' + zoomOpt.months + ' month' + (zoomOpt.months > 1 ? 's' : '');
    setDelta('<span class="fin-delta-val '+dir+'">'+arrow+' '+escapeHtml(fmtMoneyShort(Math.abs(change), nwCcy))+escapeHtml(pctTxt)+'</span>'
      + '<span>over '+escapeHtml(rangeTxt)+'</span>');

    /* Everything inside an SVG scales with the viewBox, type included — a fixed font-size:10.5
       renders at about 5px once a 780-unit chart is squeezed into a 390px phone column, which is
       how a chart ends up with an axis nobody can read. So the type and the gutters it needs are
       expressed in *rendered pixels* and converted into viewBox units by k, and the chart is given
       a taller aspect on narrow screens instead of becoming a 100px sliver. */
    const wrapW = Math.max(280, wrap.clientWidth || 780);
    const k = 780 / wrapW;                       // viewBox units per rendered pixel
    const W = 780;
    const H = Math.round((wrapW < 560 ? 150 : 240) * k);
    const fs = +(11 * k).toFixed(1);             // axis type, ~11px rendered at any width
    const padL = Math.round(fs * 3.9 + 10 * k);  // room for the widest tick label
    const padR = Math.round(14 * k), padT = Math.round(18 * k), padB = Math.round(fs + 16 * k);
    let minV = Math.min(...vals), maxV = Math.max(...vals);
    if(minV === maxV){ const bump = Math.abs(minV)*0.1 || 1; minV -= bump; maxV += bump; }
    const pad = (maxV-minV)*0.14; minV -= pad; maxV += pad;
    // parseLocalDateStr, not new Date(str): the latter reads "YYYY-MM-DD" as UTC per spec, which
    // lands a day early in negative-UTC-offset zones and mislabels the axis
    const t0 = parseLocalDateStr(points[0].date).getTime(), t1 = parseLocalDateStr(points[points.length-1].date).getTime();
    const tSpan = Math.max(1, t1-t0);
    const xOf = d => padL + ((parseLocalDateStr(d).getTime()-t0)/tSpan) * (W-padL-padR);
    const yOf = v => padT + (1-(v-minV)/(maxV-minV)) * (H-padT-padB);

    // one array carrying both the plot geometry and the source values, so the scrub handler can
    // hit-test and format from the same record
    const pts = points.map((p,i)=> ({ x:xOf(p.date), y:yOf(vals[i]), v:vals[i], date:p.date }));
    const linePath = pts.map((p,i)=> (i===0?'M':'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
    const floor = H - padB;
    const areaPath = linePath + ' L' + pts[pts.length-1].x.toFixed(1) + ',' + floor
      + ' L' + pts[0].x.toFixed(1) + ',' + floor + ' Z';

    // three gridlines, not five: the axis is a reference, not the subject
    let gridSvg = '';
    const steps = 3;
    const tick = axisTickFormatter(minV, maxV, nwCcy);
    for(let i=0;i<=steps;i++){
      const v = minV + (maxV-minV)*(i/steps);
      const y = yOf(v);
      gridSvg += '<line x1="'+padL+'" y1="'+y.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+y.toFixed(1)+'" stroke="var(--border)" stroke-width="'+k.toFixed(2)+'" opacity=".7"/>';
      gridSvg += '<text x="'+(padL-Math.round(9*k))+'" y="'+(y+fs*0.34).toFixed(1)+'" font-size="'+fs+'" fill="var(--muted)" text-anchor="end">'+escapeHtml(tick(v))+'</text>';
    }
    // a narrow chart can't fit three full dates without them touching, so it shows the two ends
    // only, and drops the year — the range control above already says which window this is
    let xLabelSvg = '';
    const narrow = wrapW < 560;
    const axisDate = ts => narrow
      ? new Date(ts).toLocaleDateString(undefined,{month:'short',day:'numeric'})
      : fmtDate(ts);
    const xLabelSpec = narrow
      ? [[0,'start'],[points.length-1,'end']]
      : [[0,'start'],[Math.floor((points.length-1)/2),'middle'],[points.length-1,'end']];
    xLabelSpec.forEach(([i,anchor])=>{
      const p = pts[i];
      // the outer labels hug the plot edges so they can't spill outside the panel
      const x = anchor==='start' ? padL : anchor==='end' ? W-padR : p.x;
      xLabelSvg += '<text x="'+x.toFixed(1)+'" y="'+(H-Math.round(5*k))+'" font-size="'+fs+'" fill="var(--muted)" text-anchor="'+anchor+'">'+escapeHtml(axisDate(parseLocalDateStr(p.date).getTime()))+'</text>';
    });

    const last = pts[pts.length-1];
    wrap.innerHTML = '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Net worth trend over '+escapeHtml(rangeTxt)+'">'
      + '<defs><linearGradient id="nwAreaFill" x1="0" y1="0" x2="0" y2="1">'
      +   '<stop offset="0%" stop-color="var(--violet)" stop-opacity=".26"/>'
      +   '<stop offset="100%" stop-color="var(--violet)" stop-opacity="0"/>'
      + '</linearGradient></defs>'
      + gridSvg + xLabelSvg
      + '<path d="'+areaPath+'" fill="url(#nwAreaFill)" stroke="none"/>'
      + '<path d="'+linePath+'" fill="none" stroke="var(--violet)" stroke-width="'+(2.25*k).toFixed(2)+'" stroke-linejoin="round" stroke-linecap="round"/>'
      + '<line class="nw-guide" x1="0" y1="'+padT+'" x2="0" y2="'+floor+'" stroke="var(--violet)" stroke-width="'+k.toFixed(2)+'" opacity="0"/>'
      + '<circle cx="'+last.x.toFixed(1)+'" cy="'+last.y.toFixed(1)+'" r="'+(4*k).toFixed(1)+'" fill="var(--violet)" stroke="var(--surface)" stroke-width="'+(2.5*k).toFixed(1)+'"/>'
      + '<circle class="nw-hover-dot" cx="0" cy="0" r="'+(4.5*k).toFixed(1)+'" fill="var(--violet)" stroke="var(--surface)" stroke-width="'+(2.5*k).toFixed(1)+'" opacity="0"/>'
      + '</svg>';
    wireNetWorthScrub(wrap, pts, W, H, nwCcy);
    observeNetWorthChartWidth(wrap);
  }

  /* The sizing above measures the wrapper, and the wrapper measures 0 while the Finance view is
     display:none — so a chart first drawn on another tab would keep desktop-scaled type after the
     user switched to Finance on a phone. This redraws it once the real width is known, and again
     on rotate/resize. Guarded on a meaningful change so setting innerHTML can't loop. */
  let nwChartLastWidth = 0, nwChartObserver = null;
  function observeNetWorthChartWidth(wrap){
    nwChartLastWidth = wrap.clientWidth || 0;
    if(nwChartObserver || typeof ResizeObserver === 'undefined') return;
    nwChartObserver = new ResizeObserver(entries=>{
      const w = Math.round(entries[0].contentRect.width);
      if(!w || Math.abs(w - nwChartLastWidth) < 12) return;
      nwChartLastWidth = w;
      renderNetWorthChart();
    });
    nwChartObserver.observe(wrap);
  }

  /* Pointer/finger scrub over the trend line. Uses pointer events so mouse, pen and touch share
     one path; the matching touch-action:pan-y (CSS) keeps a vertical swipe scrolling the page,
     and nav.js opts .fin-chart out of swipe-to-change-tab so a horizontal drag reads the chart
     instead of leaving the tab. */
  function wireNetWorthScrub(wrap, pts, W, H, ccy){
    const svg = wrap.querySelector('svg'); if(!svg) return;
    const guide = svg.querySelector('.nw-guide');
    const dot = svg.querySelector('.nw-hover-dot');
    const tip = document.createElement('div');
    tip.className = 'fin-tip';
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
      tip.innerHTML = '<span class="fin-tip-date">'
        + escapeHtml(fmtDate(parseLocalDateStr(best.date).getTime()))
        + '</span>' + escapeHtml(fmtMoney(best.v, ccy));
      // clamp so the bubble can't hang off either edge of the panel
      const px = (best.x / W) * r.width;
      tip.style.left = Math.max(52, Math.min(r.width - 52, px)) + 'px';
      tip.style.top = ((best.y / H) * r.height - 10) + 'px';
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

  /* drag-to-reorder finance accounts — registered once, delegated over #financeList */
  let draggedAccountId = null;
  const financeListEl = el('financeList');
  financeListEl.addEventListener('dragstart', e=>{
    const handle = e.target.closest('.drag-handle');
    if(!handle) return;
    const card = handle.closest('.finance-account');
    draggedAccountId = card ? card.dataset.accountId : null;
    e.dataTransfer.effectAllowed = 'move';
  });
  financeListEl.addEventListener('dragover', e=>{
    if(!draggedAccountId) return;
    e.preventDefault();
    const overCard = e.target.closest('.finance-account');
    financeListEl.querySelectorAll('.finance-account.drag-over').forEach(c=>c.classList.remove('drag-over'));
    if(overCard && overCard.dataset.accountId !== draggedAccountId) overCard.classList.add('drag-over');
  });
  financeListEl.addEventListener('drop', e=>{
    if(!draggedAccountId) return;
    e.preventDefault();
    financeListEl.querySelectorAll('.finance-account.drag-over').forEach(c=>c.classList.remove('drag-over'));
    const overCard = e.target.closest('.finance-account');
    const toId = overCard ? overCard.dataset.accountId : null;
    const fromId = draggedAccountId; draggedAccountId = null;
    if(!toId || toId === fromId) return;
    const accounts = state.finance.accounts;
    const fromIdx = accounts.findIndex(x=>x.id===fromId);
    const toIdx = accounts.findIndex(x=>x.id===toId);
    if(fromIdx<0 || toIdx<0) return;
    const [moved] = accounts.splice(fromIdx,1);
    accounts.splice(toIdx,0,moved);
    save(); renderFinanceAccounts();
  });
  financeListEl.addEventListener('dragend', ()=>{ draggedAccountId = null; financeListEl.querySelectorAll('.finance-account.drag-over').forEach(c=>c.classList.remove('drag-over')); });

  /* ---- spending breakdown: this period's outflow transactions, grouped by category ---- */
  // `short` is what the segment shows once the column is too narrow for the strip to stay on two
  // rows — swapped by CSS, not by JS, so it survives a resize without a re-render
  const SPEND_PERIODS = [
    {key:'week', label:'Weekly', short:'Wk'},
    {key:'month', label:'Monthly', short:'Mo'},
    {key:'year', label:'Yearly', short:'Yr'}
  ];
  let spendPeriod = 'month'; // not persisted — resets to a sensible default each page load
  // How many periods back from the current one — 0 = the ongoing week/month/year, 1 = the one
  // before that, etc. Not persisted; resets to 0 (and whenever the period type is switched) so
  // you always land back on "now" rather than being stuck looking at some old month.
  let spendPeriodOffset = 0;

  // Account transfers (see transferFunds()) are logged as ordinary transactions so account balances
  // stay accurate, but they're money moving between your own accounts, not spending — the note
  // is code-generated (never user-editable), so matching its fixed prefix is reliable.
  // Debt transactions (see logDebtPayment()) are excluded for the same reason: lending money out or
  // being paid back moves value between an account and a debt you already hold, so counting it as
  // spending/earnings would double-count money you never gained or lost.
  const DEBT_TX_PREFIX = 'Debt: ';
  function isTransferTx(tx){
    const note = tx.note || '';
    return note.indexOf('Transfer to ') === 0 || note.indexOf('Transfer from ') === 0
      || note.indexOf(DEBT_TX_PREFIX) === 0;
  }

  // Returns the [start, end) range for the period `offset` steps before the current one, plus a
  // human label for it — e.g. offset 1 with period 'month' is last calendar month.
  function spendPeriodRange(period, offset, now){
    const start = new Date(now); start.setHours(0,0,0,0);
    let end, label;
    if(period === 'week'){
      start.setDate(start.getDate() - start.getDay() - offset*7);
      end = new Date(start); end.setDate(start.getDate()+7);
      label = offset===0 ? 'This week' : fmtDate(start.getTime())+' – '+fmtDate(new Date(end-1).getTime());
    } else if(period === 'year'){
      start.setMonth(0,1); start.setFullYear(start.getFullYear()-offset);
      end = new Date(start); end.setFullYear(start.getFullYear()+1);
      label = String(start.getFullYear());
    } else {
      start.setDate(1); start.setMonth(start.getMonth()-offset);
      end = new Date(start); end.setMonth(start.getMonth()+1);
      label = start.toLocaleDateString(undefined,{month:'long',year:'numeric'});
    }
    return { start, end, label };
  }

  // per-category USD totals for one sign of transaction ('spend' = outflow, 'earn' = inflow)
  // within [start, end) — shared by the inline spending list and both period-breakdown modals
  function categoryTotalsForPeriod(kind, start, end){
    const totals = {};
    (state.finance.accounts||[]).forEach(a=>{
      (a.transactions||[]).forEach(tx=>{
        if(isTransferTx(tx)) return; // moving money between your own accounts is neither spending nor earning
        const isEarn = tx.amount >= 0;
        if((kind==='spend') === isEarn) return;
        const d = new Date(tx.createdAt);
        if(d < start || d >= end) return;
        const cat = tx.category || 'Other';
        const usd = Math.abs(convertAmt(tx.amount, a.currency||'USD', 'USD'));
        totals[cat] = (totals[cat]||0) + usd;
      });
    });
    return totals;
  }

  // updates the period controls, the in/out pair and the net line; the per-category breakdown
  // lives in the on-demand modals (see openPeriodBreakdownModal()) — the inline list under
  // Accounts was removed as redundant with those modals
  function renderSpendBreakdown(){
    // period segments and the ◀/▶ stepper are static markup wired once, so switching periods
    // animates the active segment instead of replacing the whole control mid-interaction
    const zoomRow = el('spendPeriodRow');
    if(zoomRow){
      if(!zoomRow.dataset.built){
        zoomRow.dataset.built = '1';
        zoomRow.innerHTML = SPEND_PERIODS.map(p=>
          '<button type="button" data-period="'+p.key+'" aria-label="'+p.label+'">'
            + '<span class="seg-long">'+p.label+'</span><span class="seg-short">'+p.short+'</span></button>'
        ).join('');
        zoomRow.querySelectorAll('button').forEach(btn=>{
          btn.addEventListener('click', ()=>{ spendPeriod = btn.dataset.period; spendPeriodOffset = 0; renderSpendBreakdown(); });
        });
      }
      zoomRow.querySelectorAll('button').forEach(btn=>{
        const on = btn.dataset.period === spendPeriod;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }

    const nwCcy = state.profile.netWorthCurrency || 'USD';
    const { start, end, label } = spendPeriodRange(spendPeriod, spendPeriodOffset, new Date());

    const prevBtn = el('spendPeriodPrevBtn'), nextBtn = el('spendPeriodNextBtn'), labelEl = el('spendPeriodLabel');
    if(labelEl) labelEl.textContent = label;
    if(prevBtn && !prevBtn.dataset.wired){
      prevBtn.dataset.wired = '1';
      prevBtn.addEventListener('click', ()=>{ spendPeriodOffset++; renderSpendBreakdown(); });
    }
    if(nextBtn && !nextBtn.dataset.wired){
      nextBtn.dataset.wired = '1';
      nextBtn.addEventListener('click', ()=>{ if(spendPeriodOffset>0){ spendPeriodOffset--; renderSpendBreakdown(); } });
    }
    // there is no "next" past the current period, so the control says so rather than no-opping
    if(nextBtn) nextBtn.disabled = spendPeriodOffset === 0;

    const earningsUsd = Object.values(categoryTotalsForPeriod('earn', start, end)).reduce((sum,usd)=>sum+usd, 0);
    const spendingUsd = Object.values(categoryTotalsForPeriod('spend', start, end)).reduce((sum,usd)=>sum+usd, 0);
    el('spendEarningsTotal').textContent = fmtMoney(convertAmt(earningsUsd,'USD',nwCcy), nwCcy);
    el('spendBreakdownTotal').textContent = fmtMoney(convertAmt(spendingUsd,'USD',nwCcy), nwCcy);
    el('spendEarningsStat').setAttribute('aria-label', 'Money in this period: '+el('spendEarningsTotal').textContent+'. See the breakdown by category.');
    el('spendBreakdownStat').setAttribute('aria-label', 'Money out this period: '+el('spendBreakdownTotal').textContent+'. See the breakdown by category.');

    // the figure the two tiles exist to produce, which the tab never actually stated. Kept to a
    // label and a signed number so it fits on the strip — the sentence version lives in the
    // tooltip, since the sign and colour already say which way it went.
    const netRow = el('spendNetRow');
    if(netRow){
      const netUsd = earningsUsd - spendingUsd;
      const net = convertAmt(netUsd, 'USD', nwCcy);
      const dir = Math.abs(net) < 0.005 ? 'flat' : (net > 0 ? 'up' : 'down');
      const money = fmtMoney(Math.abs(net), nwCcy);
      netRow.innerHTML = '<span>Net</span><span class="fin-net-val '+dir+'">'
        + (dir === 'flat' ? escapeHtml(money) : (dir === 'up' ? '+' : '−') + escapeHtml(money)) + '</span>';
      netRow.title = dir === 'flat' ? 'Broke even this period — as much came in as went out.'
        : dir === 'up' ? 'You kept ' + money + ' of what came in this period.'
        : money + ' more went out than came in this period.';
    }
  }

  /* ---- period breakdown modal — opened by clicking "Total Earnings/Spending This Period";
     same category rows as the inline spending list, just for whichever sign was clicked ---- */
  let periodBreakdownKind = 'spend';
  function openPeriodBreakdownModal(kind){
    periodBreakdownKind = kind;
    populatePeriodBreakdownModal();
    el('periodBreakdownOverlay').style.display = 'flex';
  }
  function closePeriodBreakdownModal(){ el('periodBreakdownOverlay').style.display = 'none'; }
  function populatePeriodBreakdownModal(){
    const kind = periodBreakdownKind;
    const nwCcy = state.profile.netWorthCurrency || 'USD';
    const { start, end, label } = spendPeriodRange(spendPeriod, spendPeriodOffset, new Date());
    const titleEl = el('periodBreakdownTitle');
    titleEl.textContent = (kind==='spend' ? 'Spending' : 'Earnings') + ' by Category — ' + label;
    // the shared .struggle-overlay-title class is red by default (borrowed from the struggling-
    // tasks panel) — neither spending nor earnings is a warning, so it wears the neutral modifier
    titleEl.classList.add('is-neutral');
    const totals = categoryTotalsForPeriod(kind, start, end);
    const entries = Object.entries(totals).sort((a,b)=>b[1]-a[1]);
    const list = el('periodBreakdownList'); list.innerHTML = '';
    el('periodBreakdownEmpty').style.display = entries.length ? 'none' : 'block';
    const maxUsd = entries.length ? entries[0][1] : 0;
    entries.forEach(([cat, usd])=>{
      const pct = maxUsd>0 ? Math.round((usd/maxUsd)*100) : 0;
      const row = document.createElement('button'); row.type = 'button'; row.className = 'spend-cat-row';
      row.title = 'See all '+cat+' transactions in this period';
      row.innerHTML = '<span class="spend-cat-name">'+escapeHtml(cat)+'</span>'
        + '<span class="mini-track"><span class="mini-fill" style="width:'+pct+'%"></span></span>'
        + '<span class="spend-cat-amt">'+fmtMoney(convertAmt(usd,'USD',nwCcy), nwCcy)+'</span>';
      row.addEventListener('click', ()=>{
        // close this modal first — two struggle-overlay panels stacked at the same z-index would
        // otherwise paint in DOM order, not open order, hiding the detail popup behind this one
        closePeriodBreakdownModal();
        openCategoryDetail(cat, start, end, label, kind);
      });
      list.appendChild(row);
    });
  }
  el('spendEarningsStat').addEventListener('click', ()=> openPeriodBreakdownModal('earn'));
  el('spendBreakdownStat').addEventListener('click', ()=> openPeriodBreakdownModal('spend'));
  el('periodBreakdownCloseBtn').addEventListener('click', closePeriodBreakdownModal);
  el('periodBreakdownOverlay').addEventListener('click', e=>{ if(e.target === el('periodBreakdownOverlay')) closePeriodBreakdownModal(); });

  /* ---- category drill-down: every transaction (outflow or inflow) behind one category/period cell ---- */
  function openCategoryDetail(cat, start, end, periodLabel, kind){
    kind = kind || 'spend';
    const titleEl = el('spendCategoryTitle');
    titleEl.textContent = cat+' — '+periodLabel;
    titleEl.classList.add('is-neutral'); // same as the period-breakdown modal — not a warning
    const rows = [];
    (state.finance.accounts||[]).forEach(a=>{
      (a.transactions||[]).forEach(tx=>{
        const isEarn = tx.amount >= 0;
        if((kind==='spend') === isEarn) return;
        if(isTransferTx(tx)) return;
        if((tx.category || 'Other') !== cat) return;
        const d = new Date(tx.createdAt);
        if(d < start || d >= end) return;
        rows.push({ tx, account: a });
      });
    });
    rows.sort((x,y)=> y.tx.createdAt - x.tx.createdAt);
    const listEl = el('spendCategoryList');
    if(!rows.length){
      listEl.innerHTML = '<div class="fin-none">No transactions in this period.</div>';
    } else {
      listEl.innerHTML = rows.map(({tx, account})=>{
        const isPos = tx.amount >= 0;
        return '<div class="tx-row">'
          + '<span class="tx-date">'+fmtDate(tx.createdAt)+'</span>'
          + '<span class="tx-note">'+escapeHtml(tx.note||'')+' <span class="chip">'+escapeHtml(account.name)+'</span></span>'
          + '<span class="tx-amt '+(isPos?'positive':'negative')+'">'+(isPos?'+':'-')+fmtMoney(Math.abs(tx.amount), account.currency||'USD')+'</span>'
        + '</div>';
      }).join('');
    }
    el('spendCategoryOverlay').style.display = 'flex';
  }
  function closeSpendCategoryDetail(){ el('spendCategoryOverlay').style.display = 'none'; }
  el('spendCategoryCloseBtn').addEventListener('click', closeSpendCategoryDetail);
  el('spendCategoryOverlay').addEventListener('click', e=>{ if(e.target === el('spendCategoryOverlay')) closeSpendCategoryDetail(); });

  /* ---- accounts (+ transfers, transactions, per-account currency & icon image) ---- */
  function renderFinanceAccounts(){
    const list = el('financeList'); list.innerHTML = '';
    const accounts = state.finance.accounts || [];
    el('financeEmpty').style.display = accounts.length===0 ? 'block' : 'none';

    renderSpendBreakdown();
    // every account/transaction mutation routes through renderFinanceAccounts(), and save()
    // (already called by all of those) updates today's netWorthHistory point in place — so this
    // is the one place that needs to refresh the chart for the change to show up immediately
    renderNetWorthChart();

    const nwCcyAcct = state.profile.netWorthCurrency || 'USD';
    const groups = [['savings','Savings'],['lent','Lent out'],['credit','Credit'],['custom-asset','Custom assets'],['custom-liability','Custom liabilities']];
    groups.forEach(([type,label])=>{
      const items = accounts.filter(a=>a.type===type);
      if(!items.length) return;
      // the group heading carries its own subtotal so the list answers "how much is in savings?"
      // without the user adding the cards up in their head. Converted to the net-worth display
      // currency, since a group can mix currencies.
      const groupUsd = items.reduce((sum,a)=>{
        const usd = convertAmt(parseFloat(a.balance)||0, a.currency||'USD', 'USD');
        return sum + (isLiabilityAccount(a) ? -Math.abs(usd) : usd);
      }, 0);
      const groupTotal = convertAmt(groupUsd, 'USD', nwCcyAcct);
      const lbl = document.createElement('div'); lbl.className='fin-group';
      lbl.innerHTML = '<span class="fin-group-name">'+escapeHtml(label)+'</span>'
        + '<span class="fin-group-total">'+escapeHtml((groupTotal<0?'-':'')+fmtMoney(Math.abs(groupTotal), nwCcyAcct))+'</span>';
      list.appendChild(lbl);
      items.forEach(a=>{
        if(a.currency===undefined) a.currency = 'USD';
        if(a.imageUrl===undefined) a.imageUrl = '';
        if(a.transactions===undefined) a.transactions = [];
        const bal = parseFloat(a.balance)||0;
        // what this account actually contributes to net worth — liabilities always subtract their
        // magnitude (see financeNetWorth()), and an asset can legitimately sit below zero, so the
        // +/- prefix is derived rather than assumed from the account type
        const signedBal = isLiabilityAccount(a) ? -Math.abs(bal) : bal;
        const isNeg = signedBal < 0;

        const card = document.createElement('div'); card.className = 'finance-account' + (a.open ? ' open' : '');
        card.dataset.accountId = a.id;

        // the group heading already names the type, so the second line spends itself on something
        // the card can't otherwise tell you: whether this account is actually being used
        const txs = (a.transactions||[]).slice().sort((x,y)=>y.createdAt-x.createdAt);
        const meta = !txs.length ? 'No activity yet'
          : txs.length + ' transaction' + (txs.length>1?'s':'') + ' · last ' + fmtDate(txs[0].createdAt);

        // the drag handle sits *outside* the toggle button on purpose: a draggable child of a
        // <button> is not reliably draggable across browsers, and reordering isn't the button's job
        const headRow = document.createElement('div'); headRow.className = 'fa-head-row';
        const handle = document.createElement('span');
        handle.className = 'drag-handle'; handle.draggable = true;
        handle.title = 'Drag to reorder'; handle.setAttribute('aria-hidden','true'); handle.textContent = '⠿';
        headRow.appendChild(handle);
        const head = document.createElement('button'); head.type = 'button'; head.className = 'finance-account-head';
        head.setAttribute('aria-expanded', a.open ? 'true' : 'false');
        head.innerHTML = (a.imageUrl ? '<img class="fa-thumb" src="'+a.imageUrl+'" alt="">' : '<span class="finance-icon'+(isLiabilityAccount(a)?' is-liability':'')+'" aria-hidden="true">'+financeIcon(a.type)+'</span>')
          + '<span class="finance-info"><span class="finance-name">'+escapeHtml(a.name)+'<span class="finance-ccy-badge">'+a.currency+'</span></span><span class="finance-type">'+escapeHtml(meta)+'</span></span>'
          + '<span class="finance-amt '+(isNeg?'negative':'positive')+'">'+(isNeg?'-':'+')+fmtMoney(Math.abs(signedBal),a.currency)+'</span>'
          + '<span class="fa-chevron" aria-hidden="true">▶</span>';
        // Expanding centers the card (scrollCardIntoCenter, js/core.js) — same as Habits and
        // Checklists. renderFinanceAccounts() throws away every card node, so it's re-queried by
        // id, and rAF lets the new layout settle before it's measured. Collapsing never scrolls.
        head.addEventListener('click', ()=>{
          a.open = !a.open; save(); renderFinanceAccounts();
          if(!a.open) return;
          requestAnimationFrame(()=> scrollCardIntoCenter(financeListEl.querySelector('.finance-account[data-account-id="'+a.id+'"]')));
        });
        headRow.appendChild(head);
        card.appendChild(headRow);

        const detail = document.createElement('div'); detail.className = 'finance-account-detail';
        const inner = document.createElement('div'); inner.className = 'finance-account-detail-inner';

        // account actions — name/currency&balance/icon editing and transfers live in their own
        // modals now, so the default expanded view is just transactions (see openEditAccountModal(),
        // openTransferFundsModal())
        const actionRow = document.createElement('div'); actionRow.className='fin-detail-actions';
        const editBtn = document.createElement('button'); editBtn.className='btn btn-ghost btn-sm'; editBtn.type='button'; editBtn.textContent='✎ Edit account';
        editBtn.addEventListener('click', ()=> openEditAccountModal(a.id));
        const xferBtn = document.createElement('button'); xferBtn.className='btn btn-ghost btn-sm'; xferBtn.type='button'; xferBtn.textContent='⇄ Transfer funds';
        xferBtn.addEventListener('click', ()=> openTransferFundsModal(a.id));
        actionRow.appendChild(editBtn); actionRow.appendChild(xferBtn);
        inner.appendChild(actionRow);

        // transactions — log row on top, most-recent-first list below in a scrollable box so a
        // long history doesn't crowd the rest of the card
        const tLbl = document.createElement('div'); tLbl.className='section-lbl'; tLbl.textContent='Transactions'; inner.appendChild(tLbl);

        const addTx = document.createElement('div'); addTx.className='add-tx-row';
        addTx.innerHTML = '<input type="text" placeholder="Note (e.g. Salary, Groceries)" maxlength="80" aria-label="Transaction note">'
          + '<select class="tx-category-select" aria-label="Category">'+FINANCE_CATEGORIES.map(c=>'<option value="'+c+'">'+c+'</option>').join('')+'</select>'
          + '<input type="number" step="0.01" placeholder="Amount (+ in, - out)" aria-label="Amount — positive for money in, negative for money out">'
          + '<button class="btn btn-primary" type="button">+ Add</button>';
        const txInputs = addTx.querySelectorAll('input');
        const noteInput = txInputs[0], amtInput = txInputs[1];
        const categorySelect = addTx.querySelector('.tx-category-select');
        addTx.querySelector('button').addEventListener('click', ()=>{
          const amt = parseFloat(amtInput.value);
          if(isNaN(amt) || amt===0) return;
          const tx = { id:uid(), amount:amt, note:noteInput.value.trim(), category:categorySelect.value, createdAt:Date.now() };
          a.transactions = a.transactions || []; a.transactions.push(tx);
          a.balance = (parseFloat(a.balance)||0) + amt;
          noteInput.value=''; amtInput.value=''; categorySelect.value = FINANCE_CATEGORIES[0];
          save(); renderFinanceAccounts(); renderGoals();
        });
        inner.appendChild(addTx);

        // `txs` is the same most-recent-first list the card header summarised above
        const txList = document.createElement('div'); txList.className = 'tx-list-scroll';
        if(!txs.length){
          const noneRow = document.createElement('div'); noneRow.className = 'fin-none'; noneRow.textContent='No transactions logged yet.';
          txList.appendChild(noneRow);
        }
        txs.forEach(tx=>{
          const row = document.createElement('div'); row.className='tx-row';
          const isPos = tx.amount >= 0;
          row.innerHTML = '<span class="tx-date">'+fmtDate(tx.createdAt)+'</span>'
            + '<span class="tx-note">'+escapeHtml(tx.note||'')+(tx.category ? ' <span class="chip">'+escapeHtml(tx.category)+'</span>' : '')+'</span>'
            + '<span class="tx-amt '+(isPos?'positive':'negative')+'">'+(isPos?'+':'-')+fmtMoney(Math.abs(tx.amount),a.currency)+'</span>'
            + '<button class="del-goal" type="button" aria-label="Delete this transaction">✕</button>';
          row.querySelector('.del-goal').addEventListener('click', ()=>{
            a.balance = (parseFloat(a.balance)||0) - tx.amount;
            a.transactions = (a.transactions||[]).filter(x=>x.id!==tx.id);
            save(); renderFinanceAccounts(); renderGoals();
          });
          txList.appendChild(row);
        });
        inner.appendChild(txList);

        const footer = document.createElement('div'); footer.className='goal-footer'; footer.style.marginTop='12px';
        footer.innerHTML = '<span></span><button class="del-goal">Delete account</button>';
        footer.querySelector('.del-goal').addEventListener('click', ()=>{
          state.finance.accounts = state.finance.accounts.filter(x=>x.id!==a.id);
          save(); renderFinanceAccounts(); renderGoals();
        });
        inner.appendChild(footer);

        detail.appendChild(inner);
        card.appendChild(detail);
        list.appendChild(card);
      });
    });
  }
  function openAddAccountModal(){ el('addAccountOverlay').style.display = 'flex'; }
  function closeAddAccountModal(){ el('addAccountOverlay').style.display = 'none'; }
  el('openAddAccountBtn').addEventListener('click', openAddAccountModal);
  el('addAccountCloseBtn').addEventListener('click', closeAddAccountModal);
  el('addAccountOverlay').addEventListener('click', e=>{ if(e.target === el('addAccountOverlay')) closeAddAccountModal(); });
  el('addFinanceBtn').addEventListener('click', ()=>{
    const name = el('finName').value.trim();
    const balance = parseFloat(el('finBalance').value);
    if(!name || isNaN(balance)) return;
    state.finance.accounts.push({ id:uid(), type: el('finType').value, name, balance, currency: el('finCurrency').value||'USD', imageUrl:'', transactions:[], open:false, createdAt: Date.now() });
    el('finName').value=''; el('finBalance').value='';
    save(); renderFinanceAccounts(); renderGoals();
    closeAddAccountModal();
  });

  /* ---- edit account modal (name / currency & balance / icon image) — opened via the "Edit
     Account" button inside an expanded account; the default expanded view stays transactions-only ---- */
  let editingAccountId = null;
  function openEditAccountModal(accountId){
    editingAccountId = accountId;
    populateEditAccountBody();
    el('editAccountOverlay').style.display = 'flex';
  }
  function closeEditAccountModal(){ el('editAccountOverlay').style.display = 'none'; editingAccountId = null; }
  function populateEditAccountBody(){
    const a = (state.finance.accounts||[]).find(x=>x.id===editingAccountId); if(!a) return;
    const body = el('editAccountBody'); body.innerHTML = '';

    const nameLbl = document.createElement('div'); nameLbl.className='section-lbl'; nameLbl.textContent='Account Name'; body.appendChild(nameLbl);
    const nameRow = document.createElement('div'); nameRow.className='inline-fields';
    const nameInput = document.createElement('input'); nameInput.type='text'; nameInput.value=a.name; nameInput.maxLength=60; nameInput.style.width='220px';
    nameInput.addEventListener('change', ()=>{
      const v = nameInput.value.trim();
      if(v){ a.name = v; save(); renderFinanceAccounts(); }
    });
    nameRow.appendChild(nameInput);
    body.appendChild(nameRow);

    const ccyLbl = document.createElement('div'); ccyLbl.className='section-lbl'; ccyLbl.textContent='Currency & Balance'; body.appendChild(ccyLbl);
    const ccyRow = document.createElement('div'); ccyRow.className='inline-fields';
    const ccySel = document.createElement('select');
    ccySel.innerHTML = CURRENCIES.map(c=>'<option value="'+c+'" '+(a.currency===c?'selected':'')+'>'+c+'</option>').join('');
    ccySel.addEventListener('change', ()=>{ a.currency = ccySel.value; save(); renderFinanceAccounts(); });
    const balInput = document.createElement('input'); balInput.type='number'; balInput.step='0.01'; balInput.value=a.balance; balInput.style.width='120px';
    balInput.addEventListener('change', ()=>{ a.balance = parseFloat(balInput.value)||0; save(); renderFinanceAccounts(); renderGoals(); });
    ccyRow.appendChild(ccySel); ccyRow.appendChild(balInput);
    body.appendChild(ccyRow);

    const iLbl = document.createElement('div'); iLbl.className='section-lbl'; iLbl.textContent='Icon Image'; body.appendChild(iLbl);
    const imgRow = document.createElement('div'); imgRow.className='img-row';
    imgRow.innerHTML = (a.imageUrl ? '<img class="fa-thumb" src="'+a.imageUrl+'">' : '')
      + '<label>Upload image<input type="file" accept="image/*" style="display:none;"></label>'
      + (a.imageUrl ? '<button class="del-goal" style="margin-left:4px;">Remove image</button>' : '');
    imgRow.querySelector('input[type=file]').addEventListener('change', e=>{
      const file = e.target.files[0]; if(!file) return;
      const prevUrl = a.imageUrl;
      uploadCompressedImage(file, 200, 0.75, 'finance').then(url=>{
        a.imageUrl = url; save(); renderFinanceAccounts();
        populateEditAccountBody();
        deleteStorageImage(prevUrl);
      }).catch(err=> window.alert(err.message));
    });
    const rmBtn = imgRow.querySelector('.del-goal');
    if(rmBtn) rmBtn.addEventListener('click', ()=>{ deleteStorageImage(a.imageUrl); a.imageUrl=''; save(); renderFinanceAccounts(); populateEditAccountBody(); });
    body.appendChild(imgRow);
  }
  el('editAccountCloseBtn').addEventListener('click', closeEditAccountModal);
  el('editAccountOverlay').addEventListener('click', e=>{ if(e.target === el('editAccountOverlay')) closeEditAccountModal(); });

  /* ---- transfer funds between accounts — initiated from within an expanded account's own
     detail panel via a "Transfer Funds" button that opens this modal, "from" fixed to that account ---- */
  let transferringAccountId = null;
  function openTransferFundsModal(accountId){
    const a = (state.finance.accounts||[]).find(x=>x.id===accountId); if(!a) return;
    transferringAccountId = accountId;
    el('transferFundsTitle').textContent = 'Transfer Funds — '+a.name;
    populateTransferFundsBody();
    el('transferFundsOverlay').style.display = 'flex';
  }
  function closeTransferFundsModal(){ el('transferFundsOverlay').style.display = 'none'; transferringAccountId = null; }
  function populateTransferFundsBody(){
    const a = (state.finance.accounts||[]).find(x=>x.id===transferringAccountId); if(!a) return;
    const body = el('transferFundsBody'); body.innerHTML = '';
    const otherAccounts = (state.finance.accounts||[]).filter(x=>x.id!==a.id);
    if(!otherAccounts.length){
      const noneRow = document.createElement('div'); noneRow.className='fin-none'; noneRow.textContent='Add another account to transfer funds.';
      body.appendChild(noneRow);
      return;
    }
    const row = document.createElement('div'); row.className='inline-fields';
    const sel = document.createElement('select');
    sel.innerHTML = otherAccounts.map(x=>'<option value="'+x.id+'">'+escapeHtml(x.name)+' ('+x.currency+')</option>').join('');
    const amt = document.createElement('input'); amt.type='number'; amt.step='0.01'; amt.placeholder='Amount'; amt.style.width='110px';
    const fee = document.createElement('input'); fee.type='number'; fee.step='0.01'; fee.min='0'; fee.placeholder='Fee (optional)'; fee.title='Transfer fee, charged in '+a.currency+' on top of the amount — counts as real spending, not a transfer'; fee.style.width='120px';
    const btn = document.createElement('button'); btn.className='btn btn-primary'; btn.type='button'; btn.textContent='⇄ Transfer';
    const msg = document.createElement('div'); msg.style.cssText='width:100%;font-size:11.5px;color:var(--muted);';
    btn.addEventListener('click', ()=>{
      const amtVal = parseFloat(amt.value);
      const feeVal = parseFloat(fee.value) || 0;
      if(isNaN(amtVal) || amtVal<=0){ msg.textContent = 'Enter a positive amount.'; return; }
      if(feeVal < 0){ msg.textContent = 'Fee can\'t be negative.'; return; }
      const result = transferFunds(a.id, sel.value, amtVal, feeVal);
      if(!result){ msg.textContent = 'Transfer failed — pick a valid account.'; return; }
      msg.textContent = 'Transferred '+fmtMoney(amtVal, a.currency)+' → '+fmtMoney(result.converted, result.to.currency)
        + (result.fee>0 ? ' (+'+fmtMoney(result.fee, a.currency)+' fee)' : '')+'.';
      amt.value = ''; fee.value = '';
    });
    row.appendChild(sel); row.appendChild(amt); row.appendChild(fee); row.appendChild(btn); row.appendChild(msg);
    body.appendChild(row);
  }
  el('transferFundsCloseBtn').addEventListener('click', closeTransferFundsModal);
  el('transferFundsOverlay').addEventListener('click', e=>{ if(e.target === el('transferFundsOverlay')) closeTransferFundsModal(); });
  // fee is charged in the "from" account's currency, deducted on top of the transferred amount —
  // unlike the transfer itself, a fee actually leaves your net worth, so it's logged as an
  // ordinary (non-transfer) expense transaction and shows up in spending totals/breakdown
  function transferFunds(fromId, toId, amt, fee){
    const accounts = state.finance.accounts || [];
    const from = accounts.find(a=>a.id===fromId), to = accounts.find(a=>a.id===toId);
    fee = Math.max(0, parseFloat(fee) || 0);
    if(!from || !to || fromId===toId || isNaN(amt) || amt<=0) return null;
    const converted = convertAmt(amt, from.currency||'USD', to.currency||'USD');
    from.balance = (parseFloat(from.balance)||0) - amt - fee;
    to.balance = (parseFloat(to.balance)||0) + converted;
    from.transactions = from.transactions || [];
    from.transactions.push({ id:uid(), amount:-amt, note:'Transfer to '+to.name, createdAt:Date.now() });
    if(fee > 0) from.transactions.push({ id:uid(), amount:-fee, note:'Transfer fee to '+to.name, category:'Other', createdAt:Date.now() });
    to.transactions = to.transactions || []; to.transactions.push({ id:uid(), amount:converted, note:'Transfer from '+from.name, createdAt:Date.now() });
    save(); renderFinanceAccounts(); renderGoals();
    return { from, to, converted, fee };
  }

  /* ================= DEBTS (money lent out / money owed) =================
     A debt is deliberately rendered with the same .finance-account card as an account, but it is
     *not* one: the outstanding figure is derived (principal − payments) rather than stored, so a
     logged payment can never drift out of sync with the balance the way a hand-edited one could.
     Payments can be any size — several small ones or a single "Full" one — which is the whole
     point of tracking a debt separately from a plain 'lent' account. */

  function debtPaid(d){ return (d.payments||[]).reduce((sum,p)=> sum + (parseFloat(p.amount)||0), 0); }
  function debtRemaining(d){ return Math.max(0, (parseFloat(d.amount)||0) - debtPaid(d)); }
  // half a cent of slack — payments are stored rounded, so an exact ">= principal" test can leave a
  // fully repaid debt showing a fraction of a cent outstanding forever
  function isDebtSettled(d){ return debtRemaining(d) < 0.005; }
  function debtDirectionLabel(dir){ return dir==='borrowed' ? 'You owe' : 'Owed to you'; }
  function debtIcon(dir){ return dir==='borrowed' ? '💸' : '🤝'; }

  // Outstanding debts count toward net worth exactly like the account types they mirror: what's
  // still owed to you is an asset, what you still owe is a liability. Only the unpaid remainder
  // counts, so a payment logged against a linked account is net-worth-neutral (the account gains
  // what the debt loses) and settling a debt outright changes nothing. Called by financeNetWorth().
  function debtsNetWorth(){
    return (state.finance.debts||[]).reduce((sum,d)=>{
      const usd = convertAmt(debtRemaining(d), d.currency||'USD', 'USD');
      return sum + (d.direction==='borrowed' ? -usd : usd);
    }, 0);
  }

  // "— no account —" plus every account, for the optional cash-movement link on a debt/payment
  function debtAccountOptions(selectedId){
    return '<option value="">— no account —</option>'
      + (state.finance.accounts||[]).map(a=>
          '<option value="'+a.id+'"'+(a.id===selectedId?' selected':'')+'>'+escapeHtml(a.name)+' ('+(a.currency||'USD')+')</option>'
        ).join('');
  }

  /* Mirrors the money in/out of a real account when a debt is created or paid, and records the
     transaction's id on the debt/payment so deleting that payment can reverse it. The note carries
     DEBT_TX_PREFIX so isTransferTx() keeps it out of the spending/earnings breakdown. */
  function addDebtAccountTx(accountId, debtCcy, amount, note){
    const acct = (state.finance.accounts||[]).find(a=>a.id===accountId);
    if(!acct) return null;
    const signed = convertAmt(amount, debtCcy||'USD', acct.currency||'USD');
    const tx = { id:uid(), amount:signed, note:DEBT_TX_PREFIX+note, category:'Other', createdAt:Date.now() };
    acct.transactions = acct.transactions || []; acct.transactions.push(tx);
    acct.balance = (parseFloat(acct.balance)||0) + signed;
    return tx;
  }
  // reverses one of the above. A no-op if the transaction is already gone — deleting it by hand from
  // the account card is allowed, and leaves the id on the payment dangling rather than broken.
  function removeDebtAccountTx(accountId, txId){
    if(!accountId || !txId) return;
    const acct = (state.finance.accounts||[]).find(a=>a.id===accountId);
    if(!acct) return;
    const tx = (acct.transactions||[]).find(t=>t.id===txId);
    if(!tx) return;
    acct.balance = (parseFloat(acct.balance)||0) - tx.amount;
    acct.transactions = acct.transactions.filter(t=>t.id!==txId);
  }

  function logDebtPayment(d, amount, note, accountId){
    const amt = parseFloat(amount);
    if(isNaN(amt) || amt<=0) return null;
    const payment = { id:uid(), amount:amt, note:(note||'').trim(), accountId:accountId||'', accountTxId:'', createdAt:Date.now() };
    if(accountId){
      // being paid back puts money into the account; paying down what you owe takes it out
      const signedAmt = d.direction==='borrowed' ? -amt : amt;
      const label = d.direction==='borrowed' ? 'paid '+d.person : 'repayment from '+d.person;
      const tx = addDebtAccountTx(accountId, d.currency, signedAmt, label);
      if(tx) payment.accountTxId = tx.id;
    }
    d.payments = d.payments || []; d.payments.push(payment);
    save(); renderDebts(); renderFinanceAccounts(); renderGoals();
    return payment;
  }

  function deleteDebtPayment(d, paymentId){
    const p = (d.payments||[]).find(x=>x.id===paymentId); if(!p) return;
    removeDebtAccountTx(p.accountId, p.accountTxId);
    d.payments = (d.payments||[]).filter(x=>x.id!==paymentId);
    save(); renderDebts(); renderFinanceAccounts(); renderGoals();
  }

  /* drag-to-reorder debts — same delegated pattern as #financeList above */
  let draggedDebtId = null;
  const debtListEl = el('debtList');
  debtListEl.addEventListener('dragstart', e=>{
    const handle = e.target.closest('.drag-handle');
    if(!handle) return;
    const card = handle.closest('.finance-account');
    draggedDebtId = card ? card.dataset.debtId : null;
    e.dataTransfer.effectAllowed = 'move';
  });
  debtListEl.addEventListener('dragover', e=>{
    if(!draggedDebtId) return;
    e.preventDefault();
    const overCard = e.target.closest('.finance-account');
    debtListEl.querySelectorAll('.finance-account.drag-over').forEach(c=>c.classList.remove('drag-over'));
    if(overCard && overCard.dataset.debtId !== draggedDebtId) overCard.classList.add('drag-over');
  });
  debtListEl.addEventListener('drop', e=>{
    if(!draggedDebtId) return;
    e.preventDefault();
    debtListEl.querySelectorAll('.finance-account.drag-over').forEach(c=>c.classList.remove('drag-over'));
    const overCard = e.target.closest('.finance-account');
    const toId = overCard ? overCard.dataset.debtId : null;
    const fromId = draggedDebtId; draggedDebtId = null;
    if(!toId || toId === fromId) return;
    const debts = state.finance.debts || [];
    const fromIdx = debts.findIndex(x=>x.id===fromId);
    const toIdx = debts.findIndex(x=>x.id===toId);
    if(fromIdx<0 || toIdx<0) return;
    const [moved] = debts.splice(fromIdx,1);
    debts.splice(toIdx,0,moved);
    save(); renderDebts();
  });
  debtListEl.addEventListener('dragend', ()=>{ draggedDebtId = null; debtListEl.querySelectorAll('.finance-account.drag-over').forEach(c=>c.classList.remove('drag-over')); });

  function renderDebts(){
    const list = el('debtList'); if(!list) return; list.innerHTML = '';
    const debts = state.finance.debts || [];
    el('debtEmpty').style.display = debts.length===0 ? 'block' : 'none';
    // a debt shifts net worth the moment it's created or paid, so keep the trend chart in step —
    // same reasoning as renderFinanceAccounts()
    renderNetWorthChart();

    const nwCcy = state.profile.netWorthCurrency || 'USD';
    let owedToYouUsd = 0, youOweUsd = 0;
    debts.forEach(d=>{
      const usd = convertAmt(debtRemaining(d), d.currency||'USD', 'USD');
      if(d.direction==='borrowed') youOweUsd += usd; else owedToYouUsd += usd;
    });
    // a zero total is good news, not a warning — the money colour only applies once there is
    // actually money in the figure, otherwise "nothing owed" renders in alarm red
    setToneAmount(el('debtOwedToYouTotal'), convertAmt(owedToYouUsd,'USD',nwCcy), nwCcy, 'pos');
    setToneAmount(el('debtYouOweTotal'), convertAmt(youOweUsd,'USD',nwCcy), nwCcy, 'neg');

    const today = localDateStr(new Date());
    // settled debts drop out of their direction group into one archive group at the bottom, so the
    // top of the tab only ever shows money that's actually still moving
    const groups = [
      ['lent','Owed to you', d=> d.direction!=='borrowed' && !isDebtSettled(d)],
      ['borrowed','You owe', d=> d.direction==='borrowed' && !isDebtSettled(d)],
      ['settled','Settled', d=> isDebtSettled(d)]
    ];
    groups.forEach(([key,label,match])=>{
      const items = debts.filter(match);
      if(!items.length) return;
      // same self-totalling heading as the account groups; the settled archive counts records
      // rather than money, since its outstanding total is zero by definition
      const lbl = document.createElement('div'); lbl.className='fin-group';
      const groupRight = key==='settled'
        ? items.length + ' settled'
        : fmtMoney(convertAmt(items.reduce((sum,d)=> sum + convertAmt(debtRemaining(d), d.currency||'USD', 'USD'), 0), 'USD', nwCcy), nwCcy);
      lbl.innerHTML = '<span class="fin-group-name">'+escapeHtml(label)+'</span>'
        + '<span class="fin-group-total">'+escapeHtml(groupRight)+'</span>';
      list.appendChild(lbl);
      items.forEach(d=>{
        const principal = parseFloat(d.amount)||0;
        const paid = debtPaid(d);
        const remaining = debtRemaining(d);
        const settled = isDebtSettled(d);
        const pct = principal>0 ? Math.min(100, Math.round((paid/principal)*100)) : 100;
        const overdue = !settled && d.dueDate && d.dueDate < today;

        const card = document.createElement('div');
        card.className = 'finance-account' + (d.open ? ' open' : '');
        card.dataset.debtId = d.id;

        // the group heading already says which direction this is, so the second line carries the
        // repayment state instead of repeating it
        let sub = fmtMoney(paid, d.currency) + ' of ' + fmtMoney(principal, d.currency) + ' paid';
        // overdue-ness moved to a chip beside the name (colour *and* a word), so the due date can
        // stay visible instead of being replaced by the word "overdue"
        if(settled) sub += ' · settled';
        else if(d.dueDate) sub += ' · due '+fmtDate(parseLocalDateStr(d.dueDate).getTime());

        // outstanding is shown the way the matching account type would show it: money coming back
        // to you reads as a positive balance, money you still owe as a negative one
        const amtHtml = settled
          ? '<span class="finance-amt settled">✓ Paid</span>'
          : '<span class="finance-amt '+(d.direction==='borrowed'?'negative':'positive')+'">'
              + (d.direction==='borrowed'?'-':'+') + fmtMoney(remaining, d.currency) + '</span>';

        const headRow = document.createElement('div'); headRow.className = 'fa-head-row';
        const handle = document.createElement('span');
        handle.className = 'drag-handle'; handle.draggable = true;
        handle.title = 'Drag to reorder'; handle.setAttribute('aria-hidden','true'); handle.textContent = '⠿';
        headRow.appendChild(handle);
        const head = document.createElement('button'); head.type = 'button'; head.className = 'finance-account-head';
        head.setAttribute('aria-expanded', d.open ? 'true' : 'false');
        head.innerHTML = (d.imageUrl ? '<img class="fa-thumb" src="'+d.imageUrl+'" alt="">' : '<span class="finance-icon'+(d.direction==='borrowed'?' is-liability':'')+'" aria-hidden="true">'+debtIcon(d.direction)+'</span>')
          + '<span class="finance-info"><span class="finance-name">'+escapeHtml(d.person)+'<span class="finance-ccy-badge">'+(d.currency||'USD')+'</span>'
          +   (overdue ? '<span class="chip chip-danger">Overdue</span>' : '')+'</span>'
          +   '<span class="finance-type">'+escapeHtml(sub)+'</span></span>'
          + amtHtml
          + '<span class="fa-chevron" aria-hidden="true">▶</span>';
        head.addEventListener('click', ()=>{
          d.open = !d.open; save(); renderDebts();
          if(!d.open) return;
          requestAnimationFrame(()=> scrollCardIntoCenter(debtListEl.querySelector('.finance-account[data-debt-id="'+d.id+'"]')));
        });
        headRow.appendChild(head);
        card.appendChild(headRow);

        const detail = document.createElement('div'); detail.className = 'finance-account-detail';
        const inner = document.createElement('div'); inner.className = 'finance-account-detail-inner';

        const actionRow = document.createElement('div'); actionRow.className='fin-detail-actions';
        const editBtn = document.createElement('button'); editBtn.className='btn btn-ghost btn-sm'; editBtn.type='button'; editBtn.textContent='✎ Edit debt';
        editBtn.addEventListener('click', ()=> openEditDebtModal(d.id));
        actionRow.appendChild(editBtn);
        inner.appendChild(actionRow);

        // the bar says what it measures now — a naked track plus a percentage left the reader to
        // guess whether it meant repaid or remaining
        const prog = document.createElement('div'); prog.className = 'fin-progress';
        prog.innerHTML = '<span class="fin-progress-lbl">Repaid</span>'
          + '<div class="mini-track"><div class="mini-fill" style="width:'+pct+'%"></div></div>'
          + '<span class="progress-pct">'+pct+'%</span>';
        inner.appendChild(prog);
        if(d.note){
          const noteEl = document.createElement('div'); noteEl.className = 'fin-note';
          noteEl.textContent = d.note;
          inner.appendChild(noteEl);
        }

        const pLbl = document.createElement('div'); pLbl.className='section-lbl';
        pLbl.textContent = d.direction==='borrowed' ? 'Payments you made' : 'Payments received';
        inner.appendChild(pLbl);

        const addPay = document.createElement('div'); addPay.className='add-tx-row';
        addPay.innerHTML = '<input type="text" placeholder="Note (optional)" maxlength="80" aria-label="Payment note">'
          + '<input type="number" step="0.01" min="0" placeholder="Amount" aria-label="Payment amount">'
          + '<select class="debt-pay-account" aria-label="Also move the money in or out of a real account" title="Optionally move the money in or out of a real account too">'+debtAccountOptions(d.accountId)+'</select>'
          + '<button class="btn btn-ghost btn-sm debt-fill-btn" type="button" title="Fill in everything that\'s left">Full</button>'
          + '<button class="btn btn-primary debt-pay-btn" type="button">+ Log payment</button>';
        const payNote = addPay.querySelector('input[type=text]');
        const payAmt = addPay.querySelector('input[type=number]');
        const paySel = addPay.querySelector('.debt-pay-account');
        addPay.querySelector('.debt-fill-btn').addEventListener('click', ()=>{
          payAmt.value = remaining.toFixed(2);
          payAmt.focus();
        });
        addPay.querySelector('.debt-pay-btn').addEventListener('click', ()=>{
          logDebtPayment(d, payAmt.value, payNote.value, paySel.value);
        });
        inner.appendChild(addPay);

        const payList = document.createElement('div'); payList.className = 'tx-list-scroll';
        const pays = (d.payments||[]).slice().sort((x,y)=>y.createdAt-x.createdAt);
        if(!pays.length){
          const noneRow = document.createElement('div'); noneRow.className='fin-none';
          noneRow.textContent='No payments logged yet.';
          payList.appendChild(noneRow);
        }
        pays.forEach(p=>{
          const acct = p.accountId ? (state.finance.accounts||[]).find(a=>a.id===p.accountId) : null;
          const row = document.createElement('div'); row.className='tx-row';
          row.innerHTML = '<span class="tx-date">'+fmtDate(p.createdAt)+'</span>'
            + '<span class="tx-note">'+escapeHtml(p.note||'')+(acct ? ' <span class="chip">'+escapeHtml(acct.name)+'</span>' : '')+'</span>'
            + '<span class="tx-amt positive">'+fmtMoney(parseFloat(p.amount)||0, d.currency)+'</span>'
            + '<button class="del-goal" type="button" aria-label="Delete this payment" title="Delete this payment (also reverses the account transaction it created)">✕</button>';
          row.querySelector('.del-goal').addEventListener('click', ()=> deleteDebtPayment(d, p.id));
          payList.appendChild(row);
        });
        inner.appendChild(payList);

        const footer = document.createElement('div'); footer.className='goal-footer'; footer.style.marginTop='12px';
        footer.innerHTML = '<span class="completed-tag">'+(settled?'✦ Settled':'')+'</span>'
          + '<button class="del-goal" title="Removes the record only — any account transactions it logged are real money movements and stay put">Delete debt</button>';
        footer.querySelector('.del-goal').addEventListener('click', ()=>{
          state.finance.debts = state.finance.debts.filter(x=>x.id!==d.id);
          save(); renderDebts(); renderGoals();
        });
        inner.appendChild(footer);

        detail.appendChild(inner);
        card.appendChild(detail);
        list.appendChild(card);
      });
    });
  }

  /* ---- add debt modal ---- */
  function openAddDebtModal(){
    el('debtAccount').innerHTML = debtAccountOptions('');
    el('addDebtOverlay').style.display = 'flex';
  }
  function closeAddDebtModal(){ el('addDebtOverlay').style.display = 'none'; }
  el('openAddDebtBtn').addEventListener('click', openAddDebtModal);
  el('addDebtCloseBtn').addEventListener('click', closeAddDebtModal);
  el('addDebtOverlay').addEventListener('click', e=>{ if(e.target === el('addDebtOverlay')) closeAddDebtModal(); });
  el('addDebtBtn').addEventListener('click', ()=>{
    const person = el('debtPerson').value.trim();
    const amount = parseFloat(el('debtAmount').value);
    if(!person || isNaN(amount) || amount<=0) return;
    const direction = el('debtDirection').value;
    const currency = el('debtCurrency').value||'USD';
    const accountId = el('debtAccount').value || '';
    const debt = { id:uid(), direction, person, amount, currency, dueDate: el('debtDueDate').value||'',
      note:'', imageUrl:'', payments:[], accountId, accountTxId:'', open:false, createdAt: Date.now() };
    if(accountId){
      // lending money out leaves the account; money you borrow arrives in it
      const signedAmt = direction==='borrowed' ? amount : -amount;
      const label = direction==='borrowed' ? 'borrowed from '+person : 'lent to '+person;
      const tx = addDebtAccountTx(accountId, currency, signedAmt, label);
      if(tx) debt.accountTxId = tx.id;
    }
    state.finance.debts.push(debt);
    el('debtPerson').value=''; el('debtAmount').value=''; el('debtDueDate').value='';
    save(); renderDebts(); renderFinanceAccounts(); renderGoals();
    closeAddDebtModal();
  });

  /* ---- edit debt modal (person / direction, currency & amount / due date & note / icon image) —
     same shape as openEditAccountModal(), opened from inside an expanded debt ---- */
  let editingDebtId = null;
  function openEditDebtModal(debtId){
    const d = (state.finance.debts||[]).find(x=>x.id===debtId); if(!d) return;
    editingDebtId = debtId;
    el('editDebtTitle').textContent = 'Edit Debt — '+d.person;
    populateEditDebtBody();
    el('editDebtOverlay').style.display = 'flex';
  }
  function closeEditDebtModal(){ el('editDebtOverlay').style.display = 'none'; editingDebtId = null; }
  function populateEditDebtBody(){
    const d = (state.finance.debts||[]).find(x=>x.id===editingDebtId); if(!d) return;
    const body = el('editDebtBody'); body.innerHTML = '';

    const nameLbl = document.createElement('div'); nameLbl.className='section-lbl'; nameLbl.textContent='Person'; body.appendChild(nameLbl);
    const nameRow = document.createElement('div'); nameRow.className='inline-fields';
    const nameInput = document.createElement('input'); nameInput.type='text'; nameInput.value=d.person; nameInput.maxLength=60; nameInput.style.width='220px';
    nameInput.addEventListener('change', ()=>{
      const v = nameInput.value.trim();
      if(v){ d.person = v; save(); renderDebts(); el('editDebtTitle').textContent = 'Edit Debt — '+d.person; }
    });
    nameRow.appendChild(nameInput);
    body.appendChild(nameRow);

    const amtLbl = document.createElement('div'); amtLbl.className='section-lbl'; amtLbl.textContent='Direction, Currency & Amount'; body.appendChild(amtLbl);
    const amtRow = document.createElement('div'); amtRow.className='inline-fields';
    const dirSel = document.createElement('select');
    dirSel.innerHTML = '<option value="lent"'+(d.direction!=='borrowed'?' selected':'')+'>They owe me</option>'
      + '<option value="borrowed"'+(d.direction==='borrowed'?' selected':'')+'>I owe them</option>';
    dirSel.addEventListener('change', ()=>{ d.direction = dirSel.value; save(); renderDebts(); renderGoals(); });
    const ccySel = document.createElement('select');
    ccySel.innerHTML = CURRENCIES.map(c=>'<option value="'+c+'" '+(d.currency===c?'selected':'')+'>'+c+'</option>').join('');
    ccySel.addEventListener('change', ()=>{ d.currency = ccySel.value; save(); renderDebts(); renderGoals(); });
    const amtInput = document.createElement('input'); amtInput.type='number'; amtInput.min='0'; amtInput.step='0.01'; amtInput.value=d.amount; amtInput.style.width='120px';
    amtInput.title = 'The original amount lent or borrowed — payments are subtracted from it';
    amtInput.addEventListener('change', ()=>{ d.amount = parseFloat(amtInput.value)||0; save(); renderDebts(); renderGoals(); });
    amtRow.appendChild(dirSel); amtRow.appendChild(ccySel); amtRow.appendChild(amtInput);
    body.appendChild(amtRow);

    const dueLbl = document.createElement('div'); dueLbl.className='section-lbl'; dueLbl.textContent='Due Date & Note'; body.appendChild(dueLbl);
    const dueRow = document.createElement('div'); dueRow.className='inline-fields';
    const dueInput = document.createElement('input'); dueInput.type='date'; dueInput.value=d.dueDate||'';
    dueInput.addEventListener('change', ()=>{ d.dueDate = dueInput.value||''; save(); renderDebts(); });
    const noteInput = document.createElement('input'); noteInput.type='text'; noteInput.maxLength=200; noteInput.placeholder='What was it for?'; noteInput.style.width='240px';
    noteInput.value = d.note||'';
    noteInput.addEventListener('change', ()=>{ d.note = noteInput.value.trim(); save(); renderDebts(); });
    dueRow.appendChild(dueInput); dueRow.appendChild(noteInput);
    body.appendChild(dueRow);

    const iLbl = document.createElement('div'); iLbl.className='section-lbl'; iLbl.textContent='Icon Image'; body.appendChild(iLbl);
    const imgRow = document.createElement('div'); imgRow.className='img-row';
    imgRow.innerHTML = (d.imageUrl ? '<img class="fa-thumb" src="'+d.imageUrl+'">' : '')
      + '<label>Upload image<input type="file" accept="image/*" style="display:none;"></label>'
      + (d.imageUrl ? '<button class="del-goal" style="margin-left:4px;">Remove image</button>' : '');
    imgRow.querySelector('input[type=file]').addEventListener('change', e=>{
      const file = e.target.files[0]; if(!file) return;
      const prevUrl = d.imageUrl;
      uploadCompressedImage(file, 200, 0.75, 'finance').then(url=>{
        d.imageUrl = url; save(); renderDebts();
        populateEditDebtBody();
        deleteStorageImage(prevUrl);
      }).catch(err=> window.alert(err.message));
    });
    const rmBtn = imgRow.querySelector('.del-goal');
    if(rmBtn) rmBtn.addEventListener('click', ()=>{ deleteStorageImage(d.imageUrl); d.imageUrl=''; save(); renderDebts(); populateEditDebtBody(); });
    body.appendChild(imgRow);
  }
  el('editDebtCloseBtn').addEventListener('click', closeEditDebtModal);
  el('editDebtOverlay').addEventListener('click', e=>{ if(e.target === el('editDebtOverlay')) closeEditDebtModal(); });

  /* ---- subscriptions ---- */
  function renderFinanceSubs(){
    const list = el('subsList'); if(!list) return; list.innerHTML = '';
    const subs = state.finance.subscriptions || [];
    el('subsEmpty').style.display = subs.length===0 ? 'block' : 'none';
    let totalUSD = 0;
    subs.forEach(s=>{
      const monthlyAmt = s.cycle==='yearly' ? (parseFloat(s.amount)||0)/12 : (parseFloat(s.amount)||0);
      totalUSD += convertAmt(monthlyAmt, s.currency||'USD', 'USD');
    });
    // shown in the net-worth display currency like every other total on the tab — it used to be
    // hard-coded to USD, so a PHP subscription list summed to "$23.00" right above "P1,400.00"
    const subsCcy = state.profile.netWorthCurrency || 'USD';
    setToneAmount(el('subsMonthlyTotal'), convertAmt(totalUSD, 'USD', subsCcy), subsCcy, 'neg');
    subs.slice().sort((a,b)=>(parseFloat(b.amount)||0)-(parseFloat(a.amount)||0)).forEach(s=>{
      if(s.imageUrl===undefined) s.imageUrl = '';
      const card = document.createElement('div'); card.className='sub-card';
      const nextTxt = s.nextDate ? ' · next '+fmtDate(parseLocalDateStr(s.nextDate).getTime()) : '';
      // the cycle drops to a second line under the amount instead of trailing it, so the figures
      // in the column all start at the same place and can be compared down the list
      card.innerHTML = '<button class="sub-icon" type="button" title="Upload a custom icon" aria-label="Upload an icon for '+escapeHtml(s.name)+'">'
          + (s.imageUrl ? '<img src="'+s.imageUrl+'" alt="" style="width:100%;height:100%;object-fit:cover;">' : '🔁')
        + '</button>'
        + '<input type="file" accept="image/*" class="sub-icon-file" style="display:none;">'
        + '<div class="sub-info"><div class="sub-name">'+escapeHtml(s.name)+'</div><div class="sub-meta">'+(s.cycle==='yearly'?'Yearly':'Monthly')+escapeHtml(nextTxt)+'</div></div>'
        + '<div class="sub-amt">'+fmtMoney(parseFloat(s.amount)||0, s.currency||'USD')+'<small>per '+(s.cycle==='yearly'?'year':'month')+'</small></div>'
        + '<button class="del-goal" type="button" aria-label="Delete '+escapeHtml(s.name)+'">Delete</button>';
      const iconFile = card.querySelector('.sub-icon-file');
      card.querySelector('.sub-icon').addEventListener('click', ()=> iconFile.click());
      iconFile.addEventListener('change', e=>{
        const file = e.target.files[0]; if(!file) return;
        const prevUrl = s.imageUrl;
        uploadCompressedImage(file, 200, 0.75, 'finance').then(url=>{
          s.imageUrl = url; save(); renderFinanceSubs();
          deleteStorageImage(prevUrl);
        }).catch(err=> window.alert(err.message));
      });
      card.querySelector('.del-goal').addEventListener('click', ()=>{
        state.finance.subscriptions = state.finance.subscriptions.filter(x=>x.id!==s.id);
        save(); renderFinanceSubs();
      });
      list.appendChild(card);
    });
  }
  el('addSubBtn').addEventListener('click', ()=>{
    const name = el('subName').value.trim();
    const amount = parseFloat(el('subAmount').value);
    if(!name || isNaN(amount)) return;
    state.finance.subscriptions.push({ id:uid(), name, amount, currency: el('subCurrency').value||'USD', cycle: el('subCycle').value||'monthly', nextDate: el('subNextDate').value||'', imageUrl:'', createdAt: Date.now() });
    el('subName').value=''; el('subAmount').value=''; el('subNextDate').value='';
    save(); renderFinanceSubs();
  });

  /* ---- money goals: a target amount by a deadline, editable, with contributions logged toward it ---- */
  function moneyGoalSaved(m){
    return (m.contributions||[]).reduce((sum,c)=> sum + (parseFloat(c.amount)||0), 0);
  }

  function renderMoneyGoals(){
    const list = el('moneyGoalList'); if(!list) return; list.innerHTML = '';
    const goals = state.finance.moneyGoals || [];
    el('moneyGoalEmpty').style.display = goals.length===0 ? 'block' : 'none';
    const now = new Date(); now.setHours(0,0,0,0);
    const nwCcy = state.profile.netWorthCurrency || 'USD';
    let dailyTotal = 0;

    goals.slice().sort((a,b)=> (a.deadline? new Date(a.deadline).getTime(): Infinity) - (b.deadline? new Date(b.deadline).getTime(): Infinity)).forEach(m=>{
      if(m.contributions===undefined) m.contributions = [];
      if(m.open===undefined) m.open = false;
      const target = parseFloat(m.target)||0;
      const saved = moneyGoalSaved(m);
      const pct = target>0 ? Math.min(100, Math.round((saved/target)*100)) : 0;
      const met = target>0 && saved>=target;
      let daysLeft = null, overdue = false;
      if(m.deadline){
        const d = new Date(m.deadline); d.setHours(0,0,0,0);
        daysLeft = Math.round((d-now)/(1000*3600*24));
        overdue = daysLeft < 0 && !met;
      }
      if(!met && target>0 && m.deadline){
        const remaining = target - saved;
        const effDays = Math.max(1, daysLeft);
        dailyTotal += convertAmt(remaining/effDays, m.currency||'USD', nwCcy);
      }

      const card = document.createElement('div');
      card.className = 'goal' + (met?' done':'') + (m.open?' open':'');
      card.dataset.moneyGoalId = m.id;

      let metaHtml = '<span class="chip">'+escapeHtml(fmtMoney(saved,m.currency)+' of '+fmtMoney(target,m.currency))+'</span>';
      if(m.deadline){
        metaHtml += '<span class="chip">'+escapeHtml('By '+fmtDate(parseLocalDateStr(m.deadline).getTime()))+'</span>';
        metaHtml += '<span class="chip'+(overdue?' chip-danger':'')+'">'+escapeHtml(met ? 'Goal met' : (overdue ? 'Past due' : daysLeft+' days left'))+'</span>';
      }
      if(!met && target>0 && daysLeft!==null && daysLeft>0){
        metaHtml += '<span class="chip">'+escapeHtml('~'+fmtMoney((target-saved)/daysLeft, m.currency)+'/day')+'</span>';
      }

      const head = document.createElement('div'); head.className = 'goal-head';
      head.innerHTML = '<div class="goal-head-top">'
        +   '<div class="goal-title-wrap"><div class="goal-title">' + escapeHtml(m.name) + '</div></div>'
        +   '<div class="chevron">▶</div>'
        + '</div>'
        + '<div class="goal-meta">' + metaHtml + '</div>'
        + '<div class="goal-foot-row">'
        +   '<div class="mini-track"><div class="mini-fill" style="width:'+pct+'%"></div></div>'
        +   '<span class="progress-pct">'+pct+'%</span>'
        + '</div>';
      head.addEventListener('click', ()=>{ m.open = !m.open; save(); renderMoneyGoals(); });
      card.appendChild(head);

      const detail = document.createElement('div'); detail.className = 'goal-detail';
      const inner = document.createElement('div'); inner.className = 'goal-detail-inner';

      // name
      const nameLbl = document.createElement('div'); nameLbl.className='section-lbl'; nameLbl.textContent='Goal name'; inner.appendChild(nameLbl);
      const nameRow = document.createElement('div'); nameRow.className='inline-fields';
      const nameInput = document.createElement('input'); nameInput.type='text'; nameInput.value=m.name; nameInput.maxLength=60; nameInput.style.width='220px'; nameInput.setAttribute('aria-label','Goal name');
      nameInput.addEventListener('change', ()=>{ const v=nameInput.value.trim(); if(v){ m.name=v; save(); renderMoneyGoals(); } });
      nameRow.appendChild(nameInput); inner.appendChild(nameRow);

      // target, currency, deadline
      const tLbl = document.createElement('div'); tLbl.className='section-lbl'; tLbl.textContent='Target, currency & deadline'; inner.appendChild(tLbl);
      const tRow = document.createElement('div'); tRow.className='inline-fields';
      const targetInput = document.createElement('input'); targetInput.type='number'; targetInput.min='0'; targetInput.step='0.01'; targetInput.value=m.target; targetInput.style.width='110px'; targetInput.setAttribute('aria-label','Target amount');
      targetInput.addEventListener('change', ()=>{ m.target = parseFloat(targetInput.value)||0; save(); renderMoneyGoals(); });
      const ccySel = document.createElement('select'); ccySel.setAttribute('aria-label','Currency');
      ccySel.innerHTML = CURRENCIES.map(c=>'<option value="'+c+'" '+(m.currency===c?'selected':'')+'>'+c+'</option>').join('');
      ccySel.addEventListener('change', ()=>{ m.currency = ccySel.value; save(); renderMoneyGoals(); });
      const deadlineInput = document.createElement('input'); deadlineInput.type='date'; deadlineInput.value=m.deadline||''; deadlineInput.setAttribute('aria-label','Deadline');
      deadlineInput.addEventListener('change', ()=>{ m.deadline = deadlineInput.value||''; save(); renderMoneyGoals(); });
      tRow.appendChild(targetInput); tRow.appendChild(ccySel); tRow.appendChild(deadlineInput);
      inner.appendChild(tRow);

      // contributions
      const cLbl = document.createElement('div'); cLbl.className='section-lbl'; cLbl.textContent='Contributions'; inner.appendChild(cLbl);
      const cList = document.createElement('div');
      const contribs = (m.contributions||[]).slice().sort((x,y)=>y.createdAt-x.createdAt);
      if(!contribs.length){
        const noneRow = document.createElement('div'); noneRow.className='fin-none'; noneRow.textContent='No contributions logged yet.';
        cList.appendChild(noneRow);
      }
      contribs.forEach(c=>{
        const row = document.createElement('div'); row.className='tx-row';
        row.innerHTML = '<span class="tx-date">'+fmtDate(c.createdAt)+'</span>'
          + '<span class="tx-note">'+escapeHtml(c.note||'')+'</span>'
          + '<input type="number" step="0.01" class="contrib-amt-input" aria-label="Contribution amount">'
          + '<button class="del-goal" type="button" aria-label="Delete this contribution">✕</button>';
        const amtInput = row.querySelector('.contrib-amt-input'); amtInput.value = c.amount;
        amtInput.addEventListener('change', ()=>{ c.amount = parseFloat(amtInput.value)||0; save(); renderMoneyGoals(); });
        row.querySelector('.del-goal').addEventListener('click', ()=>{
          m.contributions = (m.contributions||[]).filter(x=>x.id!==c.id);
          save(); renderMoneyGoals();
        });
        cList.appendChild(row);
      });
      inner.appendChild(cList);

      const addC = document.createElement('div'); addC.className='add-tx-row';
      addC.innerHTML = '<input type="text" placeholder="Note (e.g. Freelance gig)" maxlength="80" aria-label="Contribution note">'
        + '<input type="number" step="0.01" placeholder="Amount made" aria-label="Amount made">'
        + '<button class="btn btn-primary" type="button">+ Log contribution</button>';
      const cInputs = addC.querySelectorAll('input');
      const cNoteInput = cInputs[0], cAmtInput = cInputs[1];
      addC.querySelector('button').addEventListener('click', ()=>{
        const amt = parseFloat(cAmtInput.value);
        if(!amt || amt<=0) return;
        m.contributions = m.contributions || [];
        m.contributions.push({ id:uid(), amount:amt, note:cNoteInput.value.trim(), createdAt:Date.now() });
        cNoteInput.value=''; cAmtInput.value='';
        save(); renderMoneyGoals();
      });
      inner.appendChild(addC);

      const footer = document.createElement('div'); footer.className='goal-footer'; footer.style.marginTop='12px';
      footer.innerHTML = '<span class="completed-tag">'+(met?'✦ Goal met':'')+'</span><button class="del-goal">Delete goal</button>';
      footer.querySelector('.del-goal').addEventListener('click', ()=>{
        state.finance.moneyGoals = state.finance.moneyGoals.filter(x=>x.id!==m.id);
        save(); renderMoneyGoals();
      });
      inner.appendChild(footer);

      detail.appendChild(inner);
      card.appendChild(detail);
      list.appendChild(card);
    });

    el('mgDailyTotal').textContent = fmtMoney(dailyTotal, nwCcy);
  }
  el('addMoneyGoalBtn').addEventListener('click', ()=>{
    const name = el('mgName').value.trim();
    const target = parseFloat(el('mgTarget').value);
    if(!name || isNaN(target) || target<=0) return;
    state.finance.moneyGoals.push({ id:uid(), name, target, currency: el('mgCurrency').value||'USD', deadline: el('mgDeadline').value||'', contributions:[], open:true, createdAt: Date.now() });
    el('mgName').value=''; el('mgTarget').value=''; el('mgDeadline').value='';
    save(); renderMoneyGoals();
  });

  /* ---- currency converter ---- */
  function renderFinanceConverter(){
    const rt = el('ratesTable'); if(!rt) return;
    if(!rt.dataset.built){
      rt.innerHTML = CURRENCIES.map(c=>'<div class="rate-cell"><label>'+c+' per $1</label><input type="number" step="0.0001" min="0" data-ccy="'+c+'"></div>').join('');
      rt.dataset.built = '1';
      rt.querySelectorAll('input').forEach(inp=>{
        inp.addEventListener('change', ()=>{
          const c = inp.dataset.ccy;
          const v = parseFloat(inp.value);
          state.finance.rates[c] = isNaN(v) || v<=0 ? DEFAULT_RATES[c] : v;
          save(); renderFinanceConverter();
        });
      });
    }
    rt.querySelectorAll('input').forEach(inp=>{
      if(document.activeElement !== inp) inp.value = rateFor(inp.dataset.ccy);
    });
    doConvert();
  }
  function doConvert(){
    const amt = parseFloat(el('convAmount').value);
    const from = el('convFrom').value, to = el('convTo').value;
    if(isNaN(amt)){ el('convResult').textContent = '—'; return; }
    el('convResult').textContent = fmtMoney(convertAmt(amt, from, to), to);
  }
  ['convAmount','convFrom','convTo'].forEach(id=>{
    el(id).addEventListener('input', doConvert);
    el(id).addEventListener('change', doConvert);
  });
  el('fetchRatesBtn').addEventListener('click', async ()=>{
    const btn = el('fetchRatesBtn');
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = 'Fetching…';
    try{
      const res = await fetch('https://open.er-api.com/v6/latest/USD');
      const data = await res.json();
      if(data && data.result === 'success' && data.rates){
        CURRENCIES.forEach(c=>{ if(typeof data.rates[c] === 'number') state.finance.rates[c] = data.rates[c]; });
        state.finance.rates.USD = 1;
        save(); renderFinanceConverter();
        btn.textContent = '✓ Rates updated';
      } else {
        btn.textContent = 'Fetch failed — try again';
      }
    }catch(e){
      btn.textContent = 'Fetch failed — try again';
    }
    setTimeout(()=>{ btn.textContent = orig; btn.disabled = false; }, 2200);
  });

  /* Escape closes whichever finance dialog is open. Every one of them could already be dismissed
     by clicking the backdrop or the Close button, but neither is reachable from the keyboard
     without tabbing to it, and Escape is what a dialog is expected to answer to. Registered once,
     topmost-first, so it closes exactly one layer per press (the category drill-down opens *from*
     the period breakdown). */
  const FINANCE_OVERLAY_CLOSERS = [
    ['spendCategoryOverlay', closeSpendCategoryDetail],
    ['periodBreakdownOverlay', closePeriodBreakdownModal],
    ['transferFundsOverlay', closeTransferFundsModal],
    ['editAccountOverlay', closeEditAccountModal],
    ['editDebtOverlay', closeEditDebtModal],
    ['addAccountOverlay', closeAddAccountModal],
    ['addDebtOverlay', closeAddDebtModal]
  ];
  document.addEventListener('keydown', e=>{
    if(e.key !== 'Escape') return;
    for(const [id, close] of FINANCE_OVERLAY_CLOSERS){
      const node = el(id);
      if(node && node.style.display !== 'none'){ close(); return; }
    }
  });

  /* ---- finance sub-nav (Accounts / Debts / Money Goals / Wishlist / Subscriptions / Currency Converter) ---- */
  function showFinanceSubTab(key){
    document.querySelectorAll('#view-finance .finance-subnav-btn').forEach(b=>b.classList.toggle('active', b.dataset.fintab===key));
    document.querySelectorAll('.fintab').forEach(t=>t.style.display = (t.id==='fintab-'+key) ? '' : 'none');
    el('financeAccountsOverview').style.display = key==='accounts' ? '' : 'none';
    if(key==='debts') renderDebts();
    if(key==='subs') renderFinanceSubs();
    if(key==='moneygoals') renderMoneyGoals();
    if(key==='wishlist') renderWishlist();
    if(key==='convert') renderFinanceConverter();
  }
  document.querySelectorAll('#view-finance .finance-subnav-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> showFinanceSubTab(btn.dataset.fintab));
  });

  // A sub-nav scrolls horizontally (overflow-x:auto, scrollbar hidden) when it doesn't fit —
  // dragging across it with the mouse otherwise still fires a native click on whatever button
  // the pointer happens to release over, switching tabs unintentionally mid-drag. Applied to every
  // .finance-subnav strip (so the Time tab's Countdowns/Clock toggle gets the same guard) and to
  // the Checklists subgroup nav, which scrolls the same way.
  // (The matching touch fix — not letting the same drag swipe to the next view — is in nav.js.)
  document.querySelectorAll('.finance-subnav, .checklist-group-nav').forEach(nav=>{
    let dragging = false, dragged = false, startX = 0, startScroll = 0;
    nav.addEventListener('pointerdown', e=>{
      if(e.pointerType === 'mouse' && e.button !== 0) return;
      dragging = true; dragged = false;
      startX = e.clientX; startScroll = nav.scrollLeft;
    });
    nav.addEventListener('pointermove', e=>{
      if(!dragging) return;
      const dx = e.clientX - startX;
      if(Math.abs(dx) > 6) dragged = true;
      if(e.pointerType === 'mouse') nav.scrollLeft = startScroll - dx; // touch/pen already scroll natively
    });
    const stopDragging = ()=>{ dragging = false; };
    nav.addEventListener('pointerup', stopDragging);
    nav.addEventListener('pointercancel', stopDragging);
    nav.addEventListener('pointerleave', stopDragging);
    nav.addEventListener('click', e=>{
      if(dragged){ e.stopPropagation(); e.preventDefault(); dragged = false; }
    }, true);
  });

  populateCurrencySelects();

