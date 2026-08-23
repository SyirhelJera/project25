  /* ================= INSIGHTS =================
     The one cross-tracker view. Every other tab answers "how is THIS going"; this one answers
     "how am I doing". It summarises and then hands off — the real chart always lives in the tab
     that owns the data, reached by the card's → link.

     READ-ONLY BY CONTRACT. Nothing in this file mutates `state` and nothing calls save(), which
     is what keeps it clear of every data-safety rule in CLAUDE.md: no new state key, no
     applyLoadedState() default, no doSave() change, no dedicated-resource confusion. Keep it that
     way — a number worth writing down belongs in the tab that owns it, not here. The one
     exception is deliberate and lives in insGoTo(): the Games deep-link calls showGameSubTab(),
     which persists state.games.active exactly as clicking that sub-nav already does.

     Every figure is read through the owning tab's own helper (totalExp, calcStreak,
     dailiesOverallProgress, moneyGoalSaved, tftSortedEntries, getFitnessTier, …) rather than
     re-derived here. That's the whole reason this file is short, and it's what stops Insights and
     its source tab from ever disagreeing about the same number. If a figure needs new maths, add
     it to the owning file and call it from here.

     No network calls: everything charted is already persisted, Valorant RR history and TFT
     entries included. sw.js's LIVE_DATA_HOSTS needs nothing from this file. */

  const INS_TREND_DAYS = 90;   // sparkline window for the Trends row
  const INS_RATE_DAYS = 30;    // averaging window for the two consistency cards

  /* ---------- primitives ---------- */

  // last n day-keys ending today, oldest first
  function insDayKeys(n){
    const keys = [];
    const d = new Date(); d.setHours(0,0,0,0);
    d.setDate(d.getDate() - (n-1));
    for(let i=0;i<n;i++){ keys.push(localDateStr(d)); d.setDate(d.getDate()+1); }
    return keys;
  }

  // Turns a sparse {dateKey: value} map into one value per key, carrying the last known reading
  // forward. Net worth and weight are *levels*, not events: a day with no reading isn't a gap in
  // the quantity, it's a day nobody wrote it down. Days before the first reading stay null so the
  // line starts where the data does instead of at a flat invented floor.
  function insCarryForward(map, keys){
    let last = null;
    return keys.map(k=>{
      if(map[k] !== undefined) last = map[k];
      return last;
    });
  }

  /* The only chart primitive in the app that isn't welded to one dataset. It gets away with it by
     giving up what the four big charts need: a fixed 0-100 x 0-28 viewBox with
     preserveAspectRatio="none" means there's no width measurement, no ResizeObserver, no `k`
     scale factor and no redraw-on-resize — the browser stretches it. non-scaling-stroke is what
     makes that safe, keeping the line an even weight instead of smearing it horizontally.
     Sparklines are the whole reason this tab can carry fourteen cards cheaply. */
  let insGradId = 0;
  function insSparkline(values, tone){
    const pts = [];
    values.forEach((v,i)=>{ if(v !== null && v !== undefined && isFinite(v)) pts.push({ i, v }); });
    if(pts.length < 2) return '';
    const n = (values.length - 1) || 1;
    let min = Infinity, max = -Infinity;
    pts.forEach(p=>{ if(p.v < min) min = p.v; if(p.v > max) max = p.v; });
    const span = (max - min) || 1;
    const xOf = i => (i/n)*100;
    const yOf = v => 26 - ((v-min)/span)*24;   // 2..26, so the stroke never clips at either edge
    const line = pts.map((p,k)=> (k?'L':'M') + xOf(p.i).toFixed(2) + ' ' + yOf(p.v).toFixed(2)).join(' ');
    const area = line
      + ' L' + xOf(pts[pts.length-1].i).toFixed(2) + ' 28'
      + ' L' + xOf(pts[0].i).toFixed(2) + ' 28 Z';
    // ids are document-global and this tab draws several of these, so they're counted, the way
    // tftGradId does it in tft.js
    const gid = 'insSpark' + (++insGradId);
    const stroke = tone === 'pos' ? 'var(--fin-pos)' : tone === 'neg' ? 'var(--fin-neg)' : 'var(--violet)';
    return '<svg class="ins-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true" focusable="false">'
      + '<defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0" stop-color="'+stroke+'" stop-opacity=".22"/>'
      + '<stop offset="1" stop-color="'+stroke+'" stop-opacity="0"/></linearGradient></defs>'
      + '<path d="'+area+'" fill="url(#'+gid+')"/>'
      + '<path d="'+line+'" fill="none" stroke="'+stroke+'" stroke-width="1.6" '
      + 'vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>'
      + '</svg>';
  }

  // Delta chip. Reuses trendMarker() so the arrow's direction and its colour stay independent —
  // rising net worth is a green ▲ while rising weight is a red ▲ — and so these agree with the
  // arrows on the profile card instead of inventing a second convention.
  function insDelta(cur, prev, goodIsUp, fmt, since){
    if(prev === null || prev === undefined || !isFinite(prev) || !isFinite(cur)) return '';
    const diff = cur - prev;
    const title = since ? 'since ' + since : '';
    if(Math.abs(diff) < 1e-9) return '<span class="ins-delta flat" title="'+escapeHtml(title)+'">no change</span>';
    const good = goodIsUp ? diff > 0 : diff < 0;
    return '<span class="ins-delta '+(good?'pos':'neg')+'">'
      + trendMarker(diff > 0 ? 1 : -1, good, title) + fmt(Math.abs(diff)) + '</span>';
  }

  // The newest reading at or before Settings → Trend Comparison's cutoff, so every delta on this
  // tab measures over the same window the rest of the app does. Falls back to the oldest reading
  // held when nothing reaches back that far, and to the previous reading when no window is set.
  function insPrevReading(sorted){
    if(sorted.length < 2) return null;
    const cutoff = trendCutoffKey();
    if(!cutoff) return sorted[sorted.length-2];
    for(let i=sorted.length-1; i>=0; i--){
      // nothing newer than the window: there is no change to report, not a change of zero
      if(sorted[i].key <= cutoff) return i === sorted.length-1 ? null : sorted[i];
    }
    return sorted[0];
  }
  // "since Mar 4" — always names a date something was actually recorded on, never the window's
  // own edge, since insPrevReading() reaches back to a real reading
  function insSince(rec){ return rec ? fmtDate(parseLocalDateStr(rec.key)) : ''; }

  function insPct(n){ return Math.round(n) + '%'; }
  function insTabHidden(tab){ return (state.hiddenTabs||[]).indexOf(tab) >= 0; }

  /* ---------- templates ---------- */

  // role/tabindex rather than a <button>: these carry block layout and a nested progress bar, and
  // a button's own default styling fights all of it. The keydown handler below restores Enter and
  // Space, which is the part that actually matters.
  function insGoAttrs(tab, sub){
    return ' data-ins-go="'+tab+'"' + (sub ? ' data-ins-sub="'+sub+'"' : '')
      + ' role="button" tabindex="0"';
  }

  function insTile(o){
    return '<div class="ins-tile"'+insGoAttrs(o.tab, o.sub)+'>'
      + '<div class="ins-tile-num'+(o.tone?' '+o.tone:'')+'">'+o.num+'</div>'
      + '<div class="ins-tile-lbl">'+escapeHtml(o.lbl)+'</div>'

      + (o.note ? '<div class="ins-tile-sub">'+o.note+'</div>' : '')
      + '</div>';
  }

  function insCard(o){
    return '<div class="ins-card"'+insGoAttrs(o.tab, o.sub)+'>'
      + '<div class="ins-card-head"><span class="ins-card-title">'+escapeHtml(o.title)+'</span>'
      + '<span class="ins-card-go" aria-hidden="true">→</span></div>'
      + o.body
      + '</div>';
  }

  function insRow(lbl, val, tone){
    return '<div class="ins-row"><span class="ins-row-lbl">'+escapeHtml(lbl)+'</span>'
      + '<span class="ins-row-val'+(tone?' '+tone:'')+'">'+val+'</span></div>';
  }

  function insSection(lbl, cards, cls){
    const body = cards.filter(Boolean);
    if(!body.length) return '';
    return '<div class="section-lbl">'+escapeHtml(lbl)+'</div>'
      + '<div class="'+cls+'">'+body.join('')+'</div>';
  }

  /* ---------- section 1: today ---------- */

  function insTodayTiles(){
    const today = localDateStr(new Date());
    const tiles = [];

    if(!insTabHidden('goals')){
      const exp = totalExp();
      const lv = levelInfo(exp);
      const tier = levelTier(lv.level);
      tiles.push(insTile({
        tab:'goals', lbl:'Level · ' + tier.label, num:'Lv. ' + lv.level,
        note:'<div class="ins-mini"><div class="ins-mini-fill" style="width:'
          + Math.round((lv.into/lv.need)*100) + '%"></div></div>'
          + '<span class="ins-tile-meta">' + lv.into + ' / ' + lv.need + ' XP</span>'
      }));
    }

    if(!insTabHidden('habits') && state.habits.length){
      const done = state.habits.filter(h=> h.completions && h.completions[today]).length;
      const best = state.habits.reduce((m,h)=> Math.max(m, calcStreak(h)), 0);
      tiles.push(insTile({
        tab:'habits', lbl:'Habits today', num: done + ' / ' + state.habits.length,
        tone: done === state.habits.length ? 'pos' : '',
        note:'<span class="ins-tile-meta">best streak ' + best + 'd</span>'
      }));
    }

    if(!insTabHidden('checklists')){
      const d = dailiesOverallProgress();
      if(d.total){
        tiles.push(insTile({
          tab:'checklists', lbl:'Dailies today', num: d.done + ' / ' + d.total,
          tone: d.done === d.total ? 'pos' : '',
          note:'<span class="ins-tile-meta">' + insPct((d.done/d.total)*100) + ' done</span>'
        }));
      }
    }

    // "Needs you" deliberately links to whichever pile is biggest rather than to a fourth screen
    // that would just list them again — the tabs already render these, each with its own nav badge.
    const parts = [];
    if(!insTabHidden('goals')) parts.push({ n: goalsNeedingAttention().length, lbl:'goals untouched', tab:'goals' });
    if(!insTabHidden('habits')) parts.push({ n: habitsUndone().length, lbl:'habits undone', tab:'habits' });
    if(!insTabHidden('jobs')) parts.push({ n:(state.jobs||[]).filter(j=>j.status==='prospect').length, lbl:'prospects waiting', tab:'jobs' });
    if(!insTabHidden('time')) parts.push({ n:(state.countdowns||[]).filter(c=>{ const d = daysLeft(c.date); return d >= 0 && d <= 7; }).length, lbl:'countdowns this week', tab:'time' });
    const total = parts.reduce((s,p)=> s + p.n, 0);
    const top = parts.slice().sort((a,b)=> b.n - a.n)[0];
    if(parts.length){
      tiles.push(insTile({
        tab: top && top.n ? top.tab : 'goals', lbl:'Needs you', num: String(total),
        tone: total ? 'neg' : 'pos',
        note:'<span class="ins-tile-meta">' + (total && top ? escapeHtml(top.n + ' ' + top.lbl) : 'all clear') + '</span>'
      }));
    }

    return tiles;
  }

  /* ---------- section 2: trends ---------- */

  function insNetWorthCard(){
    if(insTabHidden('finance')) return '';
    const hist = (state.finance.netWorthHistory || []).slice().sort((a,b)=> a.date.localeCompare(b.date));
    if(!hist.length) return '';
    const ccy = (state.profile && state.profile.netWorthCurrency) || 'USD';
    const cur = getNetWorthNum();                       // USD, like every stored snapshot
    const map = {};
    hist.forEach(h=>{ map[h.date] = h.value; });
    const keys = insDayKeys(INS_TREND_DAYS);
    const series = insCarryForward(map, keys);
    const prev = insPrevReading(hist.map(h=>({ key:h.date, value:h.value })));
    const prevV = prev ? prev.value : null;
    const tone = prevV === null ? '' : (cur >= prevV ? 'pos' : 'neg');
    return insCard({
      title:'Net worth', tab:'finance', sub:'accounts',
      body:'<div class="ins-big">' + fmtMoney(convertAmt(cur, 'USD', ccy), ccy) + '</div>'
        + insDelta(cur, prevV, true, v=> fmtMoney(convertAmt(v, 'USD', ccy), ccy), insSince(prev))
        + insSparkline(series, tone)
    });
  }

  function insWeightCard(){
    if(insTabHidden('fitness')) return '';
    // weightLog is NOT sorted in storage — upsertWeightLog() writes in place
    const log = (state.fitness.weightLog || []).slice().sort((a,b)=> a.date.localeCompare(b.date));
    if(!log.length) return '';
    const latest = log[log.length-1];
    const map = {};
    log.forEach(w=>{ map[w.date] = w.kg; });
    const series = insCarryForward(map, insDayKeys(INS_TREND_DAYS));
    const prev = insPrevReading(log.map(w=>({ key:w.date, value:w.kg })));
    const prevV = prev ? prev.value : null;
    const tier = getFitnessTier();
    // losing is the good direction here, so the sparkline tone inverts against net worth's
    const tone = prevV === null ? '' : (latest.kg <= prevV ? 'pos' : 'neg');
    return insCard({
      title:'Weight', tab:'fitness',
      body:'<div class="ins-big">' + roundDisp(kgToDisplay(latest.kg)) + '<small>' + unitLabel() + '</small></div>'
        + insDelta(latest.kg, prevV, false, v=> roundDisp(kgToDisplay(v)) + ' ' + unitLabel(), insSince(prev))
        + (tier ? '<span class="ins-chip" style="color:'+tier.color+'">'+escapeHtml(tier.label)+'</span>' : '')
        + insSparkline(series, tone)
    });
  }

  function insHabitConsistencyCard(){
    if(insTabHidden('habits') || !state.habits.length) return '';
    const keys = insDayKeys(INS_RATE_DAYS);
    // A protected day is an *excused* day, not a missed one — counting it would read a vacation
    // as a slump, which is the opposite of what protectedDays exist to do (see protecteddays.js).
    const series = keys.map(k=>{
      if(isDateProtected(k)) return null;
      const done = state.habits.filter(h=> h.completions && h.completions[k]).length;
      return (done / state.habits.length) * 100;
    });
    const real = series.filter(v=> v !== null);
    if(real.length < 2) return '';
    const avg = real.reduce((s,v)=> s+v, 0) / real.length;
    const half = Math.floor(real.length/2);
    const firstHalf = real.slice(0, half).reduce((s,v)=> s+v, 0) / (half || 1);
    const secondHalf = real.slice(half).reduce((s,v)=> s+v, 0) / (real.length - half);
    return insCard({
      title:'Habit consistency', tab:'habits',
      body:'<div class="ins-big">' + insPct(avg) + '</div>'
        + '<div class="ins-note">' + real.length + ' of the last ' + INS_RATE_DAYS + ' days counted</div>'
        + insDelta(secondHalf, firstHalf, true, v=> insPct(v) + ' vs. first half')
        + insSparkline(series, secondHalf >= firstHalf ? 'pos' : 'neg')
    });
  }

  function insDailyActivityCard(){
    if(insTabHidden('checklists')) return '';
    const keys = insDayKeys(INS_RATE_DAYS);
    // dailyCompletionFraction() returns null for a day with no record rather than a false 0% —
    // days before dailies tracking existed must not drag the average down.
    const series = keys.map(k=>{ const f = dailyCompletionFraction(k); return f === null ? null : f*100; });
    const real = series.filter(v=> v !== null);
    if(real.length < 2) return '';
    const avg = real.reduce((s,v)=> s+v, 0) / real.length;
    const perfect = real.filter(v=> v >= 99.9).length;
    return insCard({
      title:'Daily activity', tab:'checklists',
      body:'<div class="ins-big">' + insPct(avg) + '</div>'
        + '<div class="ins-note">' + perfect + ' perfect ' + (perfect === 1 ? 'day' : 'days')
        + ' of ' + real.length + ' recorded</div>'
        + insSparkline(series, avg >= 50 ? 'pos' : '')
    });
  }

  /* ---------- section 3: pipelines ---------- */

  function insGoalsCard(){
    if(insTabHidden('goals') || !state.goals.length) return '';
    const done = state.goals.filter(g=> goalProgress(g) === 100).length;
    const risk = goalsNeedingAttention().length;
    const working = state.goals.filter(g=> g.workingOn && goalProgress(g) < 100).length;
    const dated = state.goals
      .filter(g=> g.targetDate && goalProgress(g) < 100)
      .sort((a,b)=> a.targetDate.localeCompare(b.targetDate))[0];
    return insCard({
      title:'Goals', tab:'goals',
      body:'<div class="ins-big">' + done + '<small>of ' + state.goals.length + ' done</small></div>'
        + '<div class="ins-bar"><div class="ins-bar-seg pos" style="width:'
        + Math.round((done/state.goals.length)*100) + '%"></div></div>'
        + insRow('Working on', String(working))
        + insRow('Untouched today', String(risk), risk ? 'neg' : '')
        + (dated ? insRow('Next due', escapeHtml(dated.title) + ' · ' + daysLeft(dated.targetDate) + 'd') : '')
    });
  }

  function insMoneyCard(){
    if(insTabHidden('finance')) return '';
    const ccy = (state.profile && state.profile.netWorthCurrency) || 'USD';
    const money = v => fmtMoney(convertAmt(v, 'USD', ccy), ccy);
    const goals = (state.finance.moneyGoals || []).filter(m=> m.open !== false);
    const debts = (state.finance.debts || []).filter(d=> !isDebtSettled(d));
    const subs = state.finance.subscriptions || [];
    if(!goals.length && !debts.length && !subs.length) return '';

    const rows = [];
    if(goals.length){
      const next = goals.slice().sort((a,b)=>
        (a.deadline||'9999').localeCompare(b.deadline||'9999'))[0];
      const saved = moneyGoalSaved(next), target = parseFloat(next.target) || 0;
      rows.push(insRow('Money goal · ' + next.name,
        (target ? insPct((saved/target)*100) : '—')
        + (next.deadline ? ' · ' + daysLeft(next.deadline) + 'd' : '')));
    }
    if(debts.length){
      const owed = debts.filter(d=> d.direction === 'borrowed')
        .reduce((s,d)=> s + convertAmt(debtRemaining(d), d.currency||'USD', 'USD'), 0);
      const lent = debts.filter(d=> d.direction !== 'borrowed')
        .reduce((s,d)=> s + convertAmt(debtRemaining(d), d.currency||'USD', 'USD'), 0);
      if(lent) rows.push(insRow('Owed to you', money(lent), 'pos'));
      if(owed) rows.push(insRow('You owe', money(owed), 'neg'));
    }
    if(subs.length){
      // yearly plans are divided down the same way renderFinanceSubs() does it, so the two agree
      const monthly = subs.reduce((s,x)=>{
        const amt = (parseFloat(x.amount) || 0) / (x.cycle === 'yearly' ? 12 : 1);
        return s + convertAmt(amt, x.currency||'USD', 'USD');
      }, 0);
      rows.push(insRow(subs.length + ' subscription' + (subs.length===1?'':'s'), money(monthly) + '/mo', 'neg'));
    }
    return insCard({ title:'Money', tab:'finance', sub: goals.length ? 'moneygoals' : 'accounts', body: rows.join('') });
  }

  function insJobsCard(){
    if(insTabHidden('jobs')) return '';
    const jobs = state.jobs || [];
    if(!jobs.length) return '';
    const counts = {};
    Object.keys(JOB_STATUS_ORDER).forEach(k=>{ counts[k] = 0; });
    jobs.forEach(j=>{ if(counts[j.status] !== undefined) counts[j.status]++; });
    const active = counts.prospect + counts.applied + counts.interviewing;
    const segTone = { prospect:'', applied:'', interviewing:'pos', offer:'pos', rejected:'neg', ghosted:'neg' };
    const bar = Object.keys(JOB_STATUS_ORDER)
      .sort((a,b)=> JOB_STATUS_ORDER[a] - JOB_STATUS_ORDER[b])
      .filter(k=> counts[k])
      .map(k=> '<div class="ins-bar-seg'+(segTone[k]?' '+segTone[k]:'')+'" style="width:'
        + ((counts[k]/jobs.length)*100).toFixed(2) + '%" title="'
        + escapeHtml(JOB_STATUS_LABELS[k] + ': ' + counts[k]) + '"></div>').join('');
    const oldest = jobs.filter(j=> j.status === 'prospect')
      .sort((a,b)=> (a.createdAt||0) - (b.createdAt||0))[0];
    return insCard({
      title:'Job pipeline', tab:'jobs',
      body:'<div class="ins-big">' + active + '<small>active of ' + jobs.length + '</small></div>'
        + '<div class="ins-bar">' + bar + '</div>'
        + insRow('Interviewing', String(counts.interviewing), counts.interviewing ? 'pos' : '')
        + insRow('Offers', String(counts.offer), counts.offer ? 'pos' : '')
        + (oldest ? insRow('Oldest prospect',
            escapeHtml(oldest.company || 'Untitled') + ' · '
            + Math.max(0, Math.round((Date.now() - (oldest.createdAt||Date.now()))/86400000)) + 'd') : '')
    });
  }

  function insCountdownsCard(){
    if(insTabHidden('time')) return '';
    const up = (state.countdowns || [])
      .map(c=> ({ c, d: daysLeft(c.date) }))
      .filter(x=> x.d >= 0)
      .sort((a,b)=> (b.c.pinned?1:0) - (a.c.pinned?1:0) || a.d - b.d)
      .slice(0,3);
    if(!up.length) return '';
    return insCard({
      title:'Coming up', tab:'time', sub:'countdowns',
      body: up.map(x=> insRow((x.c.pinned ? '📌 ' : '') + x.c.label,
        x.d === 0 ? 'today' : x.d + ' day' + (x.d===1?'':'s'),
        x.d <= 7 ? 'neg' : '')).join('')
    });
  }

  /* ---------- section 4: games ---------- */

  /* Which account the Valorant card reads. Session-only on purpose: this file is read-only by
     contract, and which account you're *looking at* here is a way of reading the summary, not a
     fact worth persisting — state.valorant.selectedAccountId already exists and belongs to the
     Valorant tab's own RR chart. It stays the default, so the two agree until you pick otherwise,
     and it's re-read (not copied) on every render so selecting an account over there still moves
     this card. Nulled rather than defended when the account disappears: insValAccount() falls
     through the same ladder again. */
  let insValAcctId = null;

  // sortedValorantAccounts() is the Valorant tab's own ordering, so the chips read in the same
  // order the account list does. Only accounts with RR history have anything to chart.
  function insValAccounts(){
    return sortedValorantAccounts().filter(a=> (a.history||[]).length);
  }
  function insValAccount(accounts){
    return accounts.find(a=> a.id === insValAcctId)
      || accounts.find(a=> a.id === state.valorant.selectedAccountId)
      || accounts[0];
  }

  // Real <button>s, unlike the cards: these act in place instead of navigating, so they want the
  // element that already means that — and the delegated handler below has to catch them before the
  // card's own deep link, since they sit inside it.
  function insValChips(accounts, curId){
    if(accounts.length < 2) return '';
    return '<div class="ins-chips">' + accounts.map(a=>
      '<button type="button" class="ins-chip-btn'+(a.id === curId ? ' on' : '')+'"'
      + ' data-ins-val-acct="'+escapeHtml(a.id)+'" aria-pressed="'+(a.id === curId)+'">'
      + escapeHtml(a.name) + '</button>').join('') + '</div>';
  }

  function insValorantCard(){
    if(insTabHidden('games')) return '';
    const accounts = insValAccounts();
    if(!accounts.length) return '';
    const acc = insValAccount(accounts);
    const hist = acc.history.slice(-20);
    // history[].date is an ISO 8601 string from HenrikDev — the only date in the app that is
    // neither YYYY-MM-DD nor epoch ms. Rank power is tierId*100 + rr, the RR chart's own scalar.
    const series = hist.map(h=> (typeof h.tierId === 'number' ? h.tierId : 0)*100 + (h.rr||0));
    const net = hist.reduce((s,h)=> s + (h.lastChange || 0), 0);
    const cur = acc.current;
    return insCard({
      // the chips already name the account when there are several, so the title only carries it
      // when there's nothing to pick from
      title: accounts.length > 1 ? 'Valorant' : 'Valorant · ' + acc.name,
      tab:'games', sub:'valorant',
      body: insValChips(accounts, acc.id)
        + '<div class="ins-big" style="color:'+(cur ? valTierColor(cur.tierName) : 'var(--text)')+'">'
        + escapeHtml(cur && cur.tierName ? cur.tierName : 'Unranked')
        + (cur ? '<small>' + (cur.rr||0) + ' RR</small>' : '') + '</div>'
        + insRow('Last ' + hist.length + ' matches', (net > 0 ? '+' : '') + net + ' RR', net >= 0 ? 'pos' : 'neg')
        + insSparkline(series, net >= 0 ? 'pos' : 'neg')
    });
  }

  // Re-renders the whole tab rather than patching the one card — everything here is string-built
  // from state, and the pick is cheap. Focus is restored onto the chip that was activated, which
  // is what keeps keyboard use from being dumped back at the top of the document.
  function insPickValAccount(id){
    if(insValAcctId === id) return;
    insValAcctId = id;
    renderInsights(true);
    const again = document.querySelector('[data-ins-val-acct="'+id+'"]');
    if(again) again.focus();
  }

  function insTftCard(){
    if(insTabHidden('games')) return '';
    // tftSortedEntries() is the only correct ordering, and the only place bad tier keys are
    // filtered out — one hand-edited record would otherwise NaN the whole series.
    const all = tftSortedEntries();
    if(!all.length) return '';
    const hist = all.slice(-20);
    const cur = all[all.length-1];
    const series = hist.map(tftEntryValue);
    const net = series.length > 1 ? series[series.length-1] - series[0] : 0;
    const placed = hist.filter(e=> e.placement);
    const avg = placed.length ? placed.reduce((s,e)=> s + e.placement, 0) / placed.length : null;
    const top4 = placed.length ? (placed.filter(e=> e.placement <= 4).length / placed.length) * 100 : null;
    /* Progress toward the goal rank, straight out of the TFT tab's own tftTargetProgress() — same
       anchor, same percentage, same bar the tab draws, so the two can't drift apart. Null when no
       target is set: the tab itself says how to set one, and repeating that here would spend the
       card's best line on an instruction. */
    const prog = tftTargetProgress();
    const goal = prog
      ? insRow('Goal · ' + prog.label,
          prog.remaining === 0 ? 'reached' : insPct(prog.pct) + ' · ' + prog.remaining + ' LP to go',
          prog.remaining === 0 ? 'pos' : '')
        + '<div class="ins-bar"><div class="ins-bar-seg'+(prog.remaining === 0 ? ' pos' : '')
        + '" style="width:' + prog.pct + '%"></div></div>'
      : '';
    return insCard({
      title:'TFT', tab:'games', sub:'tft',
      body:'<div class="ins-big">' + escapeHtml(tftRankLabel(cur.tier, cur.division))
        + '<small>' + cur.lp + ' LP</small></div>'
        + goal
        + insRow('Last ' + hist.length + ' games', (net > 0 ? '+' : '') + net + ' LP', net >= 0 ? 'pos' : 'neg')
        + (avg !== null ? insRow('Avg placement', avg.toFixed(2), avg <= 4 ? 'pos' : 'neg') : '')
        + (top4 !== null ? insRow('Top 4', insPct(top4), top4 >= 50 ? 'pos' : '') : '')
        + insSparkline(series, net >= 0 ? 'pos' : 'neg')
    });
  }

  /* ---------- render ---------- */

  function renderInsights(force){
    const view = el('view-insights');
    if(!view) return;
    // renderAll() runs after essentially every mutation in every tab. Recomputing fourteen
    // aggregates each time something unrelated saves would be pure waste, so this no-ops unless
    // the tab is the one on screen; nav.js passes force=true on entry, before .active is set.
    if(!force && !view.classList.contains('active')) return;
    const body = el('insBody');
    if(!body) return;

    const html = insSection('Today', insTodayTiles(), 'ins-today')
      + insSection('Trends', [insNetWorthCard(), insWeightCard(), insHabitConsistencyCard(), insDailyActivityCard()], 'ins-grid')
      + insSection('Pipelines', [insGoalsCard(), insMoneyCard(), insJobsCard(), insCountdownsCard()], 'ins-grid')
      + insSection('Games', [insValorantCard(), insTftCard()], 'ins-grid');

    body.innerHTML = html
      || '<div class="empty">Nothing to summarise yet — track a goal, a habit or a weigh-in and this fills in.</div>';
  }

  /* ---------- deep links ----------
     The point of the tab: every card is a doorway, never a dead end. It reuses nav.js's own click
     ladder rather than duplicating the teardown/setup it does (stopping the Live Match poll, the
     motivation slideshow, the mantra speech), so a tab entered from here is indistinguishable
     from one entered by clicking the sidebar.

     The sub-tab is applied AFTER the click, never instead of it: that ladder resets Finance to
     'accounts' and Games to state.games.active, so anything set first would be immediately
     overwritten. showGameSubTab() persists state.games.active — the single write this file
     causes, and the same one clicking that sub-nav already makes. */
  function insGoTo(tab, sub){
    const item = document.querySelector('.nav-item[data-tab="'+tab+'"]');
    if(!item) return;
    item.click();
    if(!sub) return;
    if(tab === 'finance' && typeof showFinanceSubTab === 'function') showFinanceSubTab(sub);
    else if(tab === 'games' && typeof showGameSubTab === 'function') showGameSubTab(sub);
    else if(tab === 'time' && typeof showTimeSubTab === 'function') showTimeSubTab(sub);
  }

  // delegated and wired once at script eval, so renderInsights() stays pure string-building and
  // never has to re-attach a listener per card
  (function wireInsights(){
    const view = el('view-insights');
    if(!view) return;
    const fire = target=>{
      if(!target.closest) return false;
      // the account chips live INSIDE the Valorant card, so they have to be claimed before its
      // deep link — otherwise picking an account would also navigate away from the tab
      const chip = target.closest('[data-ins-val-acct]');
      if(chip){ insPickValAccount(chip.dataset.insValAcct); return true; }
      const go = target.closest('[data-ins-go]');
      if(!go) return false;
      insGoTo(go.dataset.insGo, go.dataset.insSub || '');
      return true;
    };
    view.addEventListener('click', e=>{ fire(e.target); });
    view.addEventListener('keydown', e=>{
      if(e.key !== 'Enter' && e.key !== ' ') return;
      // the chips are real <button>s — the browser already turns Enter/Space into a click on them,
      // so handling the keydown here too would switch the account twice
      if(e.target.closest && e.target.closest('[data-ins-val-acct]')) return;
      if(fire(e.target)) e.preventDefault();   // Space would otherwise scroll the page
    });
  })();
