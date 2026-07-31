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

  function financeAccountLabel(type){
    return {savings:'Savings', credit:'Credit', lent:'Lent', 'custom-asset':'Custom (Asset)', 'custom-liability':'Custom (Liability)'}[type] || type;
  }
  function financeIcon(type){
    return {savings:'\ud83d\udcb0', credit:'\ud83d\udcb3', lent:'\ud83e\udd1d', 'custom-asset':'\ud83d\udcc8', 'custom-liability':'\ud83d\udcc9'}[type] || '\ud83d\udcbc';
  }

  // one-time population of every currency <select> in the Finance view
  function populateCurrencySelects(){
    const opts = CURRENCIES.map(c=>'<option value="'+c+'">'+c+' ('+ccySymbol(c)+')</option>').join('');
    ['finCurrency','subCurrency','mgCurrency','convFrom','convTo'].forEach(id=>{ const s = el(id); if(s) s.innerHTML = opts; });
    if(el('convFrom')) el('convFrom').value = 'USD';
    if(el('convTo')) el('convTo').value = CURRENCIES.includes('PHP') ? 'PHP' : 'USD';
  }

  function renderFinance(){
    renderNetWorthChart();
    renderFinanceAccounts();
    renderFinanceSubs();
    renderFinanceConverter();
    renderMoneyGoals();
  }

  /* ---- net worth trend chart: line chart over state.finance.netWorthHistory, zoomable ----
     Same hand-rolled SVG approach as the Fitness weight chart (see renderWeightChart() in
     fitness.js) minus the BMI bands / moving average, which don't have a net-worth analogue. */
  const FINANCE_CHART_ZOOMS = [
    {key:'1m', label:'1M', months:1},
    {key:'3m', label:'3M', months:3},
    {key:'6m', label:'6M', months:6},
    {key:'1y', label:'1Y', months:12},
    {key:'all', label:'All', months:null}
  ];
  let netWorthChartZoom = '6m'; // not persisted — resets to a sensible default each page load

  function renderNetWorthChart(){
    const zoomRow = el('nwChartZoomRow'); if(!zoomRow) return;
    zoomRow.innerHTML = FINANCE_CHART_ZOOMS.map(z=>
      '<button class="chart-zoom-btn'+(netWorthChartZoom===z.key?' active':'')+'" data-zoom="'+z.key+'">'+z.label+'</button>'
    ).join('');
    zoomRow.querySelectorAll('.chart-zoom-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{ netWorthChartZoom = btn.dataset.zoom; renderNetWorthChart(); });
    });

    const wrap = el('nwChartWrap');
    const nwCcy = state.profile.netWorthCurrency || 'USD';
    const log = (state.finance.netWorthHistory||[]).slice().sort((a,b)=> a.date.localeCompare(b.date));
    if(log.length < 2){
      wrap.innerHTML = '<div class="empty" style="border:none;padding:28px 10px;">Check back after a couple of days — net worth is snapshotted once per day you open the app.</div>';
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
      wrap.innerHTML = '<div class="empty" style="border:none;padding:28px 10px;">No entries in this time range — try a wider zoom.</div>';
      return;
    }
    const W = 780, H = 220, padL = 60, padR = 14, padT = 14, padB = 26;
    const vals = points.map(p => convertAmt(p.value, 'USD', nwCcy));
    let minV = Math.min(...vals), maxV = Math.max(...vals);
    if(minV === maxV){ const bump = Math.abs(minV)*0.1 || 1; minV -= bump; maxV += bump; }
    const pad = (maxV-minV)*0.12; minV -= pad; maxV += pad;
    const t0 = new Date(points[0].date).getTime(), t1 = new Date(points[points.length-1].date).getTime();
    const tSpan = Math.max(1, t1-t0);
    const xOf = d => padL + ((new Date(d).getTime()-t0)/tSpan) * (W-padL-padR);
    const yOf = v => padT + (1-(v-minV)/(maxV-minV)) * (H-padT-padB);

    const linePath = points.map((p,i)=> (i===0?'M':'L') + xOf(p.date).toFixed(1) + ',' + yOf(vals[i]).toFixed(1)).join(' ');

    let gridSvg = '';
    const steps = 4;
    for(let i=0;i<=steps;i++){
      const v = minV + (maxV-minV)*(i/steps);
      const y = yOf(v);
      gridSvg += '<line x1="'+padL+'" y1="'+y.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+y.toFixed(1)+'" stroke="var(--border)" stroke-width="1"/>';
      gridSvg += '<text x="'+(padL-8)+'" y="'+(y+3).toFixed(1)+'" font-size="10" fill="var(--muted)" text-anchor="end">'+escapeHtml(ccySymbol(nwCcy)+Math.round(v).toLocaleString())+'</text>';
    }
    const labelIdxs = [0, Math.floor((points.length-1)/2), points.length-1];
    let xLabelSvg = '';
    labelIdxs.forEach(i=>{
      const p = points[i];
      xLabelSvg += '<text x="'+xOf(p.date).toFixed(1)+'" y="'+(H-6)+'" font-size="10" fill="var(--muted)" text-anchor="middle">'+fmtDate(new Date(p.date).getTime())+'</text>';
    });

    const dotsSvg = points.map((p,i)=> '<circle cx="'+xOf(p.date).toFixed(1)+'" cy="'+yOf(vals[i]).toFixed(1)+'" r="2.5" fill="var(--violet)"></circle>').join('');

    wrap.innerHTML = '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto;display:block;">'
      + gridSvg + xLabelSvg
      + '<path d="'+linePath+'" fill="none" stroke="var(--violet)" stroke-width="2"/>'
      + dotsSvg
      + '</svg>';
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

  /* ---- spending breakdown: this calendar month's outflow transactions, grouped by category ---- */
  function renderSpendBreakdown(){
    const list = el('spendBreakdownList'); if(!list) return;
    list.innerHTML = '';
    const nwCcy = state.profile.netWorthCurrency || 'USD';
    const now = new Date();
    const monthPrefix = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
    const totals = {};
    (state.finance.accounts||[]).forEach(a=>{
      (a.transactions||[]).forEach(tx=>{
        if(tx.amount >= 0) return; // spending (outflow) only
        const d = new Date(tx.createdAt);
        const prefix = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
        if(prefix !== monthPrefix) return;
        const cat = tx.category || 'Other';
        const usd = Math.abs(convertAmt(tx.amount, a.currency||'USD', 'USD'));
        totals[cat] = (totals[cat]||0) + usd;
      });
    });
    const entries = Object.entries(totals).sort((a,b)=>b[1]-a[1]);
    el('spendBreakdownEmpty').style.display = entries.length ? 'none' : 'block';
    const maxUsd = entries.length ? entries[0][1] : 0;
    entries.forEach(([cat, usd])=>{
      const pct = maxUsd>0 ? Math.round((usd/maxUsd)*100) : 0;
      const row = document.createElement('div'); row.className = 'spend-cat-row';
      row.innerHTML = '<div class="spend-cat-name">'+escapeHtml(cat)+'</div>'
        + '<div class="mini-track"><div class="mini-fill" style="width:'+pct+'%"></div></div>'
        + '<div class="spend-cat-amt">'+fmtMoney(convertAmt(usd,'USD',nwCcy), nwCcy)+'</div>';
      list.appendChild(row);
    });
  }

  /* ---- accounts (+ transfers, transactions, per-account currency & icon image) ---- */
  function renderFinanceAccounts(){
    const list = el('financeList'); list.innerHTML = '';
    const accounts = state.finance.accounts || [];
    el('financeEmpty').style.display = accounts.length===0 ? 'block' : 'none';

    let assets = 0, liabilities = 0;
    accounts.forEach(a=>{
      const usdBal = convertAmt(a.balance, a.currency||'USD', 'USD');
      if(a.type==='credit' || a.type==='custom-liability') liabilities += usdBal; else assets += usdBal;
    });
    el('finTotalAssets').textContent = fmtMoney(assets,'USD');
    el('finTotalLiabilities').textContent = fmtMoney(liabilities,'USD');
    el('finNetWorth').textContent = fmtMoney(assets-liabilities,'USD');

    populateTransferPanel();
    renderSpendBreakdown();

    const groups = [['savings','Savings Accounts'],['lent','Lent (Owed To You)'],['credit','Credit Accounts'],['custom-asset','Custom Assets'],['custom-liability','Custom Liabilities']];
    groups.forEach(([type,label])=>{
      const items = accounts.filter(a=>a.type===type);
      if(!items.length) return;
      const lbl = document.createElement('div'); lbl.className='finance-group-lbl'; lbl.textContent = label; list.appendChild(lbl);
      items.forEach(a=>{
        if(a.currency===undefined) a.currency = 'USD';
        if(a.imageUrl===undefined) a.imageUrl = '';
        if(a.transactions===undefined) a.transactions = [];
        const bal = parseFloat(a.balance)||0;
        const isNeg = (a.type==='credit' || a.type==='custom-liability');

        const card = document.createElement('div'); card.className = 'finance-account' + (a.open ? ' open' : '');
        card.dataset.accountId = a.id;

        const head = document.createElement('div'); head.className = 'finance-account-head';
        head.innerHTML = '<span class="drag-handle" draggable="true" title="Drag to reorder">⠿</span>'
          + (a.imageUrl ? '<img class="fa-thumb" src="'+a.imageUrl+'">' : '<div class="finance-icon">'+financeIcon(a.type)+'</div>')
          + '<div class="finance-info"><div class="finance-name">'+escapeHtml(a.name)+'<span class="finance-ccy-badge">'+a.currency+'</span></div><div class="finance-type">'+financeAccountLabel(a.type)+'</div></div>'
          + '<div class="finance-amt '+(isNeg?'negative':'positive')+'">'+(isNeg?'-':'+')+fmtMoney(bal,a.currency)+'</div>'
          + '<div class="fa-chevron">▶</div>';
        head.addEventListener('click', (e)=>{
          if(e.target.closest('.drag-handle')) return;
          a.open = !a.open; save(); renderFinanceAccounts();
        });
        card.appendChild(head);

        const detail = document.createElement('div'); detail.className = 'finance-account-detail';
        const inner = document.createElement('div'); inner.className = 'finance-account-detail-inner';

        // account name (rename)
        const nameLbl = document.createElement('div'); nameLbl.className='section-lbl'; nameLbl.textContent='Account Name'; inner.appendChild(nameLbl);
        const nameRow = document.createElement('div'); nameRow.className='inline-fields';
        const nameInput = document.createElement('input'); nameInput.type='text'; nameInput.value=a.name; nameInput.maxLength=60; nameInput.style.width='220px';
        nameInput.addEventListener('change', ()=>{
          const v = nameInput.value.trim();
          if(v){ a.name = v; save(); renderFinanceAccounts(); }
        });
        nameRow.appendChild(nameInput);
        inner.appendChild(nameRow);

        // currency + balance
        const ccyLbl = document.createElement('div'); ccyLbl.className='section-lbl'; ccyLbl.textContent='Currency & Balance'; inner.appendChild(ccyLbl);
        const ccyRow = document.createElement('div'); ccyRow.className='inline-fields';
        const ccySel = document.createElement('select');
        ccySel.innerHTML = CURRENCIES.map(c=>'<option value="'+c+'" '+(a.currency===c?'selected':'')+'>'+c+'</option>').join('');
        ccySel.addEventListener('change', ()=>{ a.currency = ccySel.value; save(); renderFinanceAccounts(); });
        const balInput = document.createElement('input'); balInput.type='number'; balInput.step='0.01'; balInput.value=a.balance; balInput.style.width='120px';
        balInput.addEventListener('change', ()=>{ a.balance = parseFloat(balInput.value)||0; save(); renderFinanceAccounts(); renderGoals(); });
        ccyRow.appendChild(ccySel); ccyRow.appendChild(balInput);
        inner.appendChild(ccyRow);

        // icon image
        const iLbl = document.createElement('div'); iLbl.className='section-lbl'; iLbl.textContent='Icon Image'; inner.appendChild(iLbl);
        const imgRow = document.createElement('div'); imgRow.className='img-row';
        imgRow.innerHTML = (a.imageUrl ? '<img class="fa-thumb" src="'+a.imageUrl+'">' : '')
          + '<label>Upload image<input type="file" accept="image/*" style="display:none;"></label>'
          + (a.imageUrl ? '<button class="del-goal" style="margin-left:4px;">Remove image</button>' : '');
        imgRow.querySelector('input[type=file]').addEventListener('change', e=>{
          const file = e.target.files[0]; if(!file) return;
          const prevUrl = a.imageUrl;
          uploadCompressedImage(file, 200, 0.75, 'finance').then(url=>{
            a.imageUrl = url; save(); renderFinanceAccounts();
            deleteStorageImage(prevUrl);
          });
        });
        const rmBtn = imgRow.querySelector('.del-goal');
        if(rmBtn) rmBtn.addEventListener('click', ()=>{ deleteStorageImage(a.imageUrl); a.imageUrl=''; save(); renderFinanceAccounts(); });
        inner.appendChild(imgRow);

        // transactions
        const tLbl = document.createElement('div'); tLbl.className='section-lbl'; tLbl.textContent='Transactions'; inner.appendChild(tLbl);
        const txList = document.createElement('div');
        const txs = (a.transactions||[]).slice().sort((x,y)=>y.createdAt-x.createdAt);
        if(!txs.length){
          const noneRow = document.createElement('div'); noneRow.style.cssText='font-size:12px;color:var(--faint);padding:6px 0;'; noneRow.textContent='No transactions logged yet.';
          txList.appendChild(noneRow);
        }
        txs.forEach(tx=>{
          const row = document.createElement('div'); row.className='tx-row';
          const isPos = tx.amount >= 0;
          row.innerHTML = '<span class="tx-date">'+fmtDate(tx.createdAt)+'</span>'
            + '<span class="tx-note">'+escapeHtml(tx.note||'')+(tx.category ? ' <span class="chip">'+escapeHtml(tx.category)+'</span>' : '')+'</span>'
            + '<span class="tx-amt '+(isPos?'positive':'negative')+'">'+(isPos?'+':'-')+fmtMoney(Math.abs(tx.amount),a.currency)+'</span>'
            + '<button class="del-goal" style="padding:2px 8px;font-size:11px;">✕</button>';
          row.querySelector('.del-goal').addEventListener('click', ()=>{
            a.balance = (parseFloat(a.balance)||0) - tx.amount;
            a.transactions = (a.transactions||[]).filter(x=>x.id!==tx.id);
            save(); renderFinanceAccounts(); renderGoals();
          });
          txList.appendChild(row);
        });
        inner.appendChild(txList);

        const addTx = document.createElement('div'); addTx.className='add-tx-row';
        addTx.innerHTML = '<input type="text" placeholder="Note (e.g. Salary, Groceries)" maxlength="80">'
          + '<select class="tx-category-select">'+FINANCE_CATEGORIES.map(c=>'<option value="'+c+'">'+c+'</option>').join('')+'</select>'
          + '<input type="number" step="0.01" placeholder="Amount (+ in, - out)">'
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
  el('addFinanceBtn').addEventListener('click', ()=>{
    const name = el('finName').value.trim();
    const balance = parseFloat(el('finBalance').value);
    if(!name || isNaN(balance)) return;
    state.finance.accounts.push({ id:uid(), type: el('finType').value, name, balance, currency: el('finCurrency').value||'USD', imageUrl:'', transactions:[], open:false, createdAt: Date.now() });
    el('finName').value=''; el('finBalance').value='';
    save(); renderFinanceAccounts(); renderGoals();
  });

  /* ---- transfer funds between accounts ---- */
  el('toggleTransferBtn').addEventListener('click', ()=>{
    const panel = el('transferPanel');
    panel.style.display = panel.style.display==='none' ? 'flex' : 'none';
  });
  function populateTransferPanel(){
    const panel = el('transferPanel'); if(!panel) return;
    if(!panel.dataset.built){
      panel.innerHTML = '<select id="xferFrom"></select><span style="color:var(--muted);">→</span><select id="xferTo"></select>'
        + '<input type="number" id="xferAmt" placeholder="Amount" step="0.01" style="width:110px;">'
        + '<button class="btn btn-primary" id="xferBtn" type="button">Transfer</button>'
        + '<div id="xferMsg" style="width:100%;font-size:11.5px;color:var(--muted);"></div>';
      panel.dataset.built = '1';
      el('xferBtn').addEventListener('click', doTransfer);
    }
    const accounts = state.finance.accounts || [];
    const optHtml = accounts.map(a=>'<option value="'+a.id+'">'+escapeHtml(a.name)+' ('+a.currency+')</option>').join('');
    const fromSel = el('xferFrom'), toSel = el('xferTo');
    const fv = fromSel.value, tv = toSel.value;
    fromSel.innerHTML = optHtml; toSel.innerHTML = optHtml;
    if(accounts.some(a=>a.id===fv)) fromSel.value = fv;
    if(accounts.some(a=>a.id===tv)) toSel.value = tv;
  }
  function doTransfer(){
    const accounts = state.finance.accounts || [];
    const fromId = el('xferFrom').value, toId = el('xferTo').value;
    const amt = parseFloat(el('xferAmt').value);
    const msg = el('xferMsg');
    if(!fromId || !toId || fromId===toId || isNaN(amt) || amt<=0){ msg.textContent = 'Pick two different accounts and a positive amount.'; return; }
    const from = accounts.find(a=>a.id===fromId), to = accounts.find(a=>a.id===toId);
    if(!from || !to) return;
    const converted = convertAmt(amt, from.currency||'USD', to.currency||'USD');
    from.balance = (parseFloat(from.balance)||0) - amt;
    to.balance = (parseFloat(to.balance)||0) + converted;
    from.transactions = from.transactions || []; from.transactions.push({ id:uid(), amount:-amt, note:'Transfer to '+to.name, createdAt:Date.now() });
    to.transactions = to.transactions || []; to.transactions.push({ id:uid(), amount:converted, note:'Transfer from '+from.name, createdAt:Date.now() });
    el('xferAmt').value = '';
    msg.textContent = 'Transferred '+fmtMoney(amt, from.currency)+' → '+fmtMoney(converted, to.currency)+'.';
    save(); renderFinanceAccounts(); renderGoals();
  }

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
    el('subsMonthlyTotal').textContent = fmtMoney(totalUSD,'USD');
    subs.slice().sort((a,b)=>(parseFloat(b.amount)||0)-(parseFloat(a.amount)||0)).forEach(s=>{
      if(s.imageUrl===undefined) s.imageUrl = '';
      const card = document.createElement('div'); card.className='sub-card';
      const nextTxt = s.nextDate ? ' · Next '+fmtDate(new Date(s.nextDate).getTime()) : '';
      card.innerHTML = '<div class="sub-icon" style="cursor:pointer;overflow:hidden;padding:0;" title="Click to upload a custom icon">'
          + (s.imageUrl ? '<img src="'+s.imageUrl+'" style="width:100%;height:100%;object-fit:cover;border-radius:9px;">' : '🔁')
        + '</div>'
        + '<input type="file" accept="image/*" class="sub-icon-file" style="display:none;">'
        + '<div class="sub-info"><div class="sub-name">'+escapeHtml(s.name)+'</div><div class="sub-meta">'+(s.cycle==='yearly'?'Yearly':'Monthly')+escapeHtml(nextTxt)+'</div></div>'
        + '<div class="sub-amt">'+fmtMoney(parseFloat(s.amount)||0, s.currency||'USD')+' / '+(s.cycle==='yearly'?'yr':'mo')+'</div>'
        + '<button class="del-goal" style="margin-left:4px;">Delete</button>';
      const iconFile = card.querySelector('.sub-icon-file');
      card.querySelector('.sub-icon').addEventListener('click', ()=> iconFile.click());
      iconFile.addEventListener('change', e=>{
        const file = e.target.files[0]; if(!file) return;
        const prevUrl = s.imageUrl;
        uploadCompressedImage(file, 200, 0.75, 'finance').then(url=>{
          s.imageUrl = url; save(); renderFinanceSubs();
          deleteStorageImage(prevUrl);
        });
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
        metaHtml += '<span class="chip">'+escapeHtml('By '+fmtDate(new Date(m.deadline).getTime()))+'</span>';
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
      const nameLbl = document.createElement('div'); nameLbl.className='section-lbl'; nameLbl.textContent='Goal Name'; inner.appendChild(nameLbl);
      const nameRow = document.createElement('div'); nameRow.className='inline-fields';
      const nameInput = document.createElement('input'); nameInput.type='text'; nameInput.value=m.name; nameInput.maxLength=60; nameInput.style.width='220px';
      nameInput.addEventListener('change', ()=>{ const v=nameInput.value.trim(); if(v){ m.name=v; save(); renderMoneyGoals(); } });
      nameRow.appendChild(nameInput); inner.appendChild(nameRow);

      // target, currency, deadline
      const tLbl = document.createElement('div'); tLbl.className='section-lbl'; tLbl.textContent='Target, Currency & Deadline'; inner.appendChild(tLbl);
      const tRow = document.createElement('div'); tRow.className='inline-fields';
      const targetInput = document.createElement('input'); targetInput.type='number'; targetInput.min='0'; targetInput.step='0.01'; targetInput.value=m.target; targetInput.style.width='110px';
      targetInput.addEventListener('change', ()=>{ m.target = parseFloat(targetInput.value)||0; save(); renderMoneyGoals(); });
      const ccySel = document.createElement('select');
      ccySel.innerHTML = CURRENCIES.map(c=>'<option value="'+c+'" '+(m.currency===c?'selected':'')+'>'+c+'</option>').join('');
      ccySel.addEventListener('change', ()=>{ m.currency = ccySel.value; save(); renderMoneyGoals(); });
      const deadlineInput = document.createElement('input'); deadlineInput.type='date'; deadlineInput.value=m.deadline||'';
      deadlineInput.addEventListener('change', ()=>{ m.deadline = deadlineInput.value||''; save(); renderMoneyGoals(); });
      tRow.appendChild(targetInput); tRow.appendChild(ccySel); tRow.appendChild(deadlineInput);
      inner.appendChild(tRow);

      // contributions
      const cLbl = document.createElement('div'); cLbl.className='section-lbl'; cLbl.textContent='Contributions'; inner.appendChild(cLbl);
      const cList = document.createElement('div');
      const contribs = (m.contributions||[]).slice().sort((x,y)=>y.createdAt-x.createdAt);
      if(!contribs.length){
        const noneRow = document.createElement('div'); noneRow.style.cssText='font-size:12px;color:var(--faint);padding:6px 0;'; noneRow.textContent='No contributions logged yet.';
        cList.appendChild(noneRow);
      }
      contribs.forEach(c=>{
        const row = document.createElement('div'); row.className='tx-row';
        row.innerHTML = '<span class="tx-date">'+fmtDate(c.createdAt)+'</span>'
          + '<span class="tx-note">'+escapeHtml(c.note||'')+'</span>'
          + '<input type="number" step="0.01" class="contrib-amt-input" style="width:90px;">'
          + '<button class="del-goal" style="padding:2px 8px;font-size:11px;">✕</button>';
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
      addC.innerHTML = '<input type="text" placeholder="Note (e.g. Freelance gig)" maxlength="80">'
        + '<input type="number" step="0.01" placeholder="Amount made">'
        + '<button class="btn btn-primary" type="button">+ Log Contribution</button>';
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

  /* ---- finance sub-nav (Accounts / Subscriptions / Money Goals / Currency Converter) ---- */
  function showFinanceSubTab(key){
    document.querySelectorAll('.finance-subnav-btn').forEach(b=>b.classList.toggle('active', b.dataset.fintab===key));
    document.querySelectorAll('.fintab').forEach(t=>t.style.display = (t.id==='fintab-'+key) ? '' : 'none');
    if(key==='subs') renderFinanceSubs();
    if(key==='moneygoals') renderMoneyGoals();
    if(key==='convert') renderFinanceConverter();
  }
  document.querySelectorAll('.finance-subnav-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> showFinanceSubTab(btn.dataset.fintab));
  });
  populateCurrencySelects();

