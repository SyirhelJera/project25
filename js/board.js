  /* ================= BOARD OF ADVISERS =================
     A prompt-assembly tab, not an AI tab. Nothing here calls a model: it turns a roster of
     personas + your question + (optionally) a summary of your own dashboard data into one block
     of markdown, and hands that to whichever AI tool you already use. The deliberate consequence
     is that there's no API key, no Edge Function, no rate limit and no bill — and you can use the
     paid tool you're already subscribed to instead of one this app picks for you.

     Three panes under a .finance-subnav, same pattern as the Time tab: Ask / Board / History.
     Unlike the Games tab the choice is NOT persisted — these are three views of one concern, so
     landing on Ask every time is right (see showBoardSubTab below).
  ==================================================== */

  const BOARD_CTX_SOURCES = [
    { key:'goals',      label:'🎯 Goals' },
    { key:'finance',    label:'💰 Finance' },
    { key:'habits',     label:'⚡ Habits' },
    { key:'checklists', label:'☑️ Checklists' },
    { key:'fitness',    label:'💪 Fitness' },
    { key:'countdowns', label:'⏳ Countdowns' },
    { key:'jobs',       label:'💼 Jobs' },
    { key:'profile',    label:'👤 Profile' }
  ];
  // Prefill support differs per tool and it isn't a detail we can paper over: Google exposes no
  // query param that seeds a Gemini conversation, so that button opens the app bare and relies on
  // the clipboard write that boardOpenTool() always does first.
  const BOARD_TOOLS = [
    { key:'chatgpt',    label:'ChatGPT',    url:'https://chatgpt.com/?q=',            prefill:true  },
    { key:'claude',     label:'Claude',     url:'https://claude.ai/new?q=',           prefill:true  },
    { key:'gemini',     label:'Gemini',     url:'https://gemini.google.com/app',      prefill:false },
    { key:'perplexity', label:'Perplexity', url:'https://www.perplexity.ai/search?q=',prefill:true  }
  ];
  // Browsers and servers cap URL length well below what a context-packed prompt can reach. Past
  // this we open the tool bare rather than send a silently truncated prompt — the clipboard copy
  // has already happened either way, so the user is never stranded.
  const BOARD_URL_MAX = 6000;

  let boardSubTab = 'ask';
  let boardQuestion = '';
  let boardSeats = null;        // adviser ids selected for THIS consult; null = "all hired"
  let boardEditingId = null;    // adviser being edited in the overlay; '' = creating a new one
  let boardOpenSessionId = null;
  let boardPromptDirty = false; // true once the user hand-edits the generated prompt

  /* ---------- sub-nav ---------- */
  function showBoardSubTab(key){
    boardSubTab = key;
    document.querySelectorAll('#view-board .finance-subnav-btn').forEach(b=>b.classList.toggle('active', b.dataset.boardtab===key));
    document.querySelectorAll('.boardtab').forEach(t=>t.style.display = (t.id==='boardtab-'+key) ? '' : 'none');
    renderBoard();
  }

  function renderBoard(){
    hydrateBoardStaticFields();
    renderBoardRoster();
    renderBoardAsk();
    renderBoardHistory();
  }

  /* ---------- roster ---------- */
  function hiredAdvisers(){ return state.board.advisers.filter(a=>a.hired !== false); }
  function adviserById(id){ return state.board.advisers.find(a=>a.id===id) || null; }
  // the seats for the consult being composed: null means "everyone", which is also what a newly
  // hired adviser should join without the user having to re-tick anything
  function boardSelectedAdvisers(){
    const hired = hiredAdvisers();
    if(boardSeats === null) return hired;
    return hired.filter(a=>boardSeats.indexOf(a.id) >= 0);
  }

  function renderBoardRoster(){
    const list = el('boardRoster'); if(!list) return;
    list.innerHTML = '';
    const advisers = state.board.advisers;
    el('boardRosterEmpty').style.display = advisers.length===0 ? 'block' : 'none';
    el('boardRosterCount').textContent = advisers.length + (advisers.length===1 ? ' adviser' : ' advisers');
    advisers.forEach(a=>{
      const card = document.createElement('div');
      card.className = 'adviser-card';
      if(a.color) card.style.setProperty('--adviser-color', a.color);
      card.innerHTML = '<div class="adviser-emoji">'+escapeHtml(a.emoji||'💬')+'</div>'
        + '<div class="adviser-body">'
          + '<div class="adviser-name">'+escapeHtml(a.name||'Adviser')+(a.presetKey ? '' : ' <span class="chip">custom</span>')+'</div>'
          + '<div class="adviser-lens">'+escapeHtml(a.lens||'No lens written yet — this adviser will contribute nothing useful until you give them one.')+'</div>'
        + '</div>'
        + '<div class="adviser-actions">'
          + '<button class="rename-btn" type="button" title="Edit this adviser">✎</button>'
          + '<button class="del-goal" type="button">Fire</button>'
        + '</div>';
      card.querySelector('.rename-btn').addEventListener('click', ()=> openAdviserEditor(a.id));
      card.querySelector('.del-goal').addEventListener('click', ()=>{
        if(!confirm('Fire '+(a.name||'this adviser')+'? Saved consults keep their name, but they won\'t sit on future boards.')) return;
        state.board.advisers = state.board.advisers.filter(x=>x.id!==a.id);
        if(boardSeats) boardSeats = boardSeats.filter(id=>id!==a.id);
        save(); renderBoard();
      });
      list.appendChild(card);
    });
  }

  /* ---------- hire sheet ---------- */
  function openHireSheet(){
    const body = el('boardHireBody');
    const hiredKeys = state.board.advisers.map(a=>a.presetKey).filter(Boolean);
    body.innerHTML = '<div class="board-sheet-title">Hire an adviser</div>'
      + '<div class="view-sub">Every field stays editable after you hire — presets are a starting point, not a contract.</div>'
      + '<div id="boardHireList"></div>'
      + '<div class="board-sheet-actions">'
        + '<button class="btn btn-primary btn-sm" id="boardHireCustomBtn" type="button">+ Create custom</button>'
        + '<button class="btn btn-ghost btn-sm" id="boardHireCloseBtn" type="button">Close</button>'
      + '</div>';
    const listEl = body.querySelector('#boardHireList');
    BOARD_PRESETS.forEach(p=>{
      const already = hiredKeys.indexOf(p.key) >= 0;
      const row = document.createElement('div');
      row.className = 'adviser-hire-card' + (already ? ' hired' : '');
      row.style.setProperty('--adviser-color', p.color);
      row.innerHTML = '<div class="adviser-emoji">'+escapeHtml(p.emoji)+'</div>'
        + '<div class="adviser-body">'
          + '<div class="adviser-name">'+escapeHtml(p.name)+'</div>'
          + '<div class="adviser-lens">'+escapeHtml(p.lens)+'</div>'
        + '</div>'
        + (already ? '<span class="chip">on the board</span>' : '<button class="btn btn-primary btn-sm" type="button">Hire</button>');
      if(!already){
        row.querySelector('button').addEventListener('click', ()=>{
          state.board.advisers.push({ id:uid(), presetKey:p.key, emoji:p.emoji, name:p.name, lens:p.lens, color:p.color, hired:true, createdAt:Date.now() });
          // a newly hired adviser joins the consult being composed too, rather than silently
          // sitting out because the seat list was pinned before they existed
          if(boardSeats) boardSeats.push(state.board.advisers[state.board.advisers.length-1].id);
          save(); renderBoard(); openHireSheet();
        });
      }
      listEl.appendChild(row);
    });
    body.querySelector('#boardHireCustomBtn').addEventListener('click', ()=>{ closeHireSheet(); openAdviserEditor(''); });
    body.querySelector('#boardHireCloseBtn').addEventListener('click', closeHireSheet);
    el('boardHireOverlay').style.display = 'flex';
  }
  function closeHireSheet(){ el('boardHireOverlay').style.display = 'none'; }

  /* ---------- adviser editor ---------- */
  function openAdviserEditor(id){
    boardEditingId = id;
    const a = id ? adviserById(id) : null;
    const body = el('boardEditBody');
    body.innerHTML = '<div class="board-sheet-title">'+(a ? 'Edit adviser' : 'New adviser')+'</div>'
      + '<div class="board-edit-grid">'
        + '<label class="board-field board-field-emoji"><span>Emoji</span><input id="advEmoji" type="text" maxlength="4" class="mini-input"></label>'
        + '<label class="board-field"><span>Name</span><input id="advName" type="text" maxlength="60" class="mini-input"></label>'
        + '<label class="board-field board-field-color"><span>Colour</span><input id="advColor" type="color" class="mini-input"></label>'
      + '</div>'
      + '<label class="board-field"><span>Lens — written as an instruction to the AI, in the second person</span>'
        + '<textarea id="advLens" class="board-textarea" rows="5" maxlength="1200"></textarea></label>'
      + '<div class="board-sheet-actions">'
        + '<button class="btn btn-primary btn-sm" id="advSaveBtn" type="button">Save</button>'
        + '<button class="btn btn-ghost btn-sm" id="advCancelBtn" type="button">Cancel</button>'
      + '</div>';
    // set as properties, never interpolated into value="…" — escapeHtml() doesn't escape double
    // quotes, so an adviser named  The "Realist"  would break out of the attribute
    body.querySelector('#advEmoji').value = a ? (a.emoji||'💬') : '💬';
    body.querySelector('#advName').value  = a ? (a.name||'') : '';
    body.querySelector('#advColor').value = (a && a.color) ? a.color : '#7C3AED';
    body.querySelector('#advLens').value  = a ? (a.lens||'') : '';
    body.querySelector('#advSaveBtn').addEventListener('click', commitAdviserEditor);
    body.querySelector('#advCancelBtn').addEventListener('click', closeAdviserEditor);
    el('boardEditOverlay').style.display = 'flex';
    body.querySelector('#advName').focus();
  }
  function commitAdviserEditor(){
    const body = el('boardEditBody');
    const name = body.querySelector('#advName').value.trim();
    if(!name){ body.querySelector('#advName').focus(); return; }
    const fields = {
      emoji: body.querySelector('#advEmoji').value.trim() || '💬',
      name,
      color: body.querySelector('#advColor').value || '',
      lens:  body.querySelector('#advLens').value.trim()
    };
    const existing = boardEditingId ? adviserById(boardEditingId) : null;
    if(existing){
      Object.assign(existing, fields);
    } else {
      // an edited preset keeps its presetKey (so the hire sheet still knows it's on the board),
      // but anything created here is custom and has none
      const created = Object.assign({ id:uid(), presetKey:'', hired:true, createdAt:Date.now() }, fields);
      state.board.advisers.push(created);
      if(boardSeats) boardSeats.push(created.id);
    }
    closeAdviserEditor();
    save(); renderBoard();
  }
  function closeAdviserEditor(){ boardEditingId = null; el('boardEditOverlay').style.display = 'none'; }

  /* ---------- context pack ----------
     WHAT MAY NEVER GO IN HERE. This is the one function in the app whose output is meant to leave
     the machine and be pasted into a third-party service, so the exclusions are a safety rule, not
     a formatting preference:
       - state.jobSiteAccounts  — plaintext site passwords (see the comment on it in core.js)
       - state.valorant.apiKey / localServerToken — credentials
       - note bodies            — freeform private writing, and unbounded in size
     Everything below is a derived summary: counts, percentages and totals, capped per section so a
     long-running dashboard can't produce a prompt no tool will accept. ---- */
  function boardCtxGoals(){
    const goals = (state.goals||[]).filter(g=>g.workingOn || g.starred).slice(0, 10);
    if(!goals.length) return '';
    const rows = goals.map(g=>{
      const bits = ['- ' + g.title + ' — ' + goalProgress(g) + '% done'];
      if(g.tier) bits.push('tier ' + g.tier);
      if(g.targetDate){
        const d = daysLeft(g.targetDate);
        bits.push(d < 0 ? 'target date passed ' + Math.abs(d) + ' days ago' : d + ' days to target');
      }
      if(g.financeTarget) bits.push('needs ' + fmtMoney(g.financeTarget, 'USD') + ', saved ' + fmtMoney(g.financeSaved||0, 'USD'));
      return bits.join(' · ');
    });
    return '### Goals (working on / starred)\n' + rows.join('\n');
  }
  function boardCtxFinance(){
    const f = state.finance || {};
    const lines = ['- Net worth: ' + fmtMoney(getNetWorthNum(), 'USD') + ' (USD equivalent)'];
    const subs = (f.subscriptions||[]).reduce((s,x)=> s + convertAmt(x.amount, x.currency||'USD', 'USD') * (x.cycle==='yearly' ? 1/12 : 1), 0);
    if(subs > 0) lines.push('- Subscriptions: ' + fmtMoney(subs, 'USD') + '/month across ' + f.subscriptions.length + ' service' + (f.subscriptions.length===1 ? '' : 's'));
    const openDebts = (f.debts||[]).filter(d=>d.open !== false);
    if(openDebts.length){
      const owed = openDebts.filter(d=>d.direction==='borrowed').reduce((s,d)=> s + convertAmt(debtRemaining(d), d.currency||'USD', 'USD'), 0);
      const lent = openDebts.filter(d=>d.direction==='lent').reduce((s,d)=> s + convertAmt(debtRemaining(d), d.currency||'USD', 'USD'), 0);
      if(owed > 0) lines.push('- I still owe: ' + fmtMoney(owed, 'USD'));
      if(lent > 0) lines.push('- Still owed to me: ' + fmtMoney(lent, 'USD'));
    }
    const end = new Date(); const start = new Date(); start.setDate(start.getDate() - 30);
    const spend = categoryTotalsForPeriod('spend', start, end);
    const top = Object.keys(spend).sort((a,b)=> spend[b]-spend[a]).slice(0, 5);
    if(top.length){
      lines.push('- Last 30 days spending: ' + top.map(c=> c + ' ' + fmtMoney(spend[c], 'USD')).join(', '));
    }
    return '### Finance\n' + lines.join('\n');
  }
  function boardCtxHabits(){
    const habits = (state.habits||[]).slice(0, 12);
    if(!habits.length) return '';
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    const rows = habits.map(h=>{
      const hits = Object.keys(h.completions||{}).filter(k=> parseLocalDateStr(k) >= cutoff).length;
      return '- ' + h.name + ' — ' + calcStreak(h) + ' day streak, ' + Math.round((hits/30)*100) + '% over the last 30 days';
    });
    return '### Habits\n' + rows.join('\n');
  }
  function boardCtxChecklists(){
    const p = dailiesOverallProgress();
    const lines = [];
    if(p.total) lines.push("- Today's dailies: " + p.done + '/' + p.total + ' done');
    const struggling = getStrugglingItems().slice(0, 5);
    if(struggling.length){
      lines.push('- Tasks I keep failing: ' + struggling.map(r=> r.text + ' (' + r.failCount + '×)').join(', '));
    }
    return lines.length ? '### Checklists\n' + lines.join('\n') : '';
  }
  function boardCtxFitness(){
    // deliberately NOT calcFitness() — that one renders into the Fitness tab's DOM and returns
    // nothing, so calling it here would have the side effect of repainting another tab
    const f = state.fitness || {};
    const cw = parseFloat(f.currentWeight), tw = parseFloat(f.targetWeight), h = parseFloat(f.height);
    if(isNaN(cw)) return '';
    const lines = ['- Current weight: ' + roundWeight(kgToDisplay(cw)) + unitLabel()];
    if(!isNaN(tw)) lines.push('- Target weight: ' + roundWeight(kgToDisplay(tw)) + unitLabel() + ' (' + roundWeight(Math.abs(kgToDisplay(cw)-kgToDisplay(tw))) + unitLabel() + ' to go)');
    if(!isNaN(h) && h > 0){
      const bmi = cw / ((h/100)*(h/100));
      lines.push('- BMI: ' + bmi.toFixed(1) + ' (' + bmiCategory(bmi) + ')');
    }
    return '### Fitness\n' + lines.join('\n');
  }
  function boardCtxCountdowns(){
    const cds = (state.countdowns||[]).filter(c=> daysLeft(c.date) >= 0)
      .sort((a,b)=> daysLeft(a.date) - daysLeft(b.date)).slice(0, 5);
    if(!cds.length) return '';
    return '### Countdowns\n' + cds.map(c=> '- ' + c.label + ' — ' + daysLeft(c.date) + ' days away').join('\n');
  }
  function boardCtxJobs(){
    // counts only. Never the applications themselves, and never state.jobSiteAccounts.
    const jobs = state.jobs || [];
    if(!jobs.length) return '';
    const by = {};
    jobs.forEach(j=>{ const s = j.status || 'prospect'; by[s] = (by[s]||0) + 1; });
    return '### Job search\n- ' + Object.keys(by).map(k=> by[k] + ' ' + k).join(', ');
  }
  function boardCtxProfile(){
    const p = state.profile || {};
    const bits = [];
    if(p.name) bits.push('- Name: ' + p.name);
    if(p.age) bits.push('- Age: ' + p.age);
    return bits.length ? '### About me\n' + bits.join('\n') : '';
  }
  const BOARD_CTX_BUILDERS = {
    goals: boardCtxGoals, finance: boardCtxFinance, habits: boardCtxHabits, checklists: boardCtxChecklists,
    fitness: boardCtxFitness, countdowns: boardCtxCountdowns, jobs: boardCtxJobs, profile: boardCtxProfile
  };
  function buildBoardContext(attach){
    return BOARD_CTX_SOURCES.filter(s=>attach[s.key])
      .map(s=> BOARD_CTX_BUILDERS[s.key]())
      .filter(Boolean)
      .join('\n\n');
  }

  /* ---------- prompt assembly ---------- */
  function buildBoardPrompt(){
    const advisers = boardSelectedAdvisers();
    const prefs = state.board.prefs;
    const roster = advisers.map(a=> '### ' + (a.emoji||'💬') + ' ' + (a.name||'Adviser') + '\n' + (a.lens||'')).join('\n\n');
    const ctx = buildBoardContext(prefs.attach || {});
    const out = ['You are my personal board of advisers. You are ' + advisers.length + ' distinct people with genuinely different priorities — never one voice wearing different labels.'];
    out.push('## The board\n' + (roster || '_(no advisers selected)_'));
    out.push('## My situation\n' + (boardQuestion.trim() || '_(describe the situation here)_'));
    if(ctx) out.push('## Context from my dashboard\nThese are real figures from my own tracking app. Use them; do not ask me for them.\n\n' + ctx);
    out.push('## How to answer\n' + (prefs.rules || BOARD_DEFAULT_RULES));
    return out.join('\n\n');
  }

  /* ---------- ask pane ---------- */
  function renderBoardAsk(){
    const seatsEl = el('boardSeats'); if(!seatsEl) return;
    const prefs = state.board.prefs;
    const hired = hiredAdvisers();
    const selected = boardSelectedAdvisers();

    seatsEl.innerHTML = '';
    el('boardNoAdvisers').style.display = hired.length===0 ? 'block' : 'none';
    hired.forEach(a=>{
      const on = selected.indexOf(a) >= 0;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'board-seat' + (on ? ' on' : '');
      if(a.color) chip.style.setProperty('--adviser-color', a.color);
      chip.innerHTML = '<span class="board-seat-emoji">'+escapeHtml(a.emoji||'💬')+'</span>'+escapeHtml(a.name||'Adviser');
      chip.addEventListener('click', ()=>{
        if(boardSeats === null) boardSeats = hired.map(x=>x.id);
        const i = boardSeats.indexOf(a.id);
        if(i >= 0) boardSeats.splice(i, 1); else boardSeats.push(a.id);
        boardPromptDirty = false; // the roster changed, so a stale hand-edited prompt is worse than a fresh one
        renderBoardAsk();
      });
      seatsEl.appendChild(chip);
    });

    const ctxEl = el('boardCtxRow');
    if(!ctxEl.dataset.built){
      ctxEl.dataset.built = '1';
      ctxEl.innerHTML = BOARD_CTX_SOURCES.map(s=>
        '<label class="board-ctx-opt"><input type="checkbox" data-ctx="'+s.key+'"><span>'+escapeHtml(s.label)+'</span></label>'
      ).join('');
      ctxEl.addEventListener('change', e=>{
        const box = e.target.closest('input[data-ctx]'); if(!box) return;
        state.board.prefs.attach[box.dataset.ctx] = box.checked;
        boardPromptDirty = false;
        save(); renderBoardAsk();
      });
    }
    ctxEl.querySelectorAll('input[data-ctx]').forEach(box=>{ box.checked = !!(prefs.attach||{})[box.dataset.ctx]; });

    const promptEl = el('boardPrompt');
    if(!boardPromptDirty) promptEl.value = buildBoardPrompt();
    const len = promptEl.value.length;
    el('boardPromptLen').textContent = len.toLocaleString() + ' characters'
      + (len > BOARD_URL_MAX ? ' — too long to prefill a link, so the tool buttons open blank with this on your clipboard' : '');
    el('boardSaveConsultBtn').disabled = !boardQuestion.trim();
  }

  /* ---------- copy & hand-off ---------- */
  function boardCopyPrompt(btn){
    const ta = el('boardPrompt');
    const done = () => {
      if(!btn) return;
      const orig = btn.dataset.label || btn.textContent;
      btn.dataset.label = orig;
      btn.textContent = 'Copied!';
      setTimeout(()=>{ btn.textContent = btn.dataset.label; }, 1200);
    };
    // Unlike jobAccountCopy() this needs a fallback: navigator.clipboard is undefined on a
    // non-secure origin (opening index.html straight off the filesystem, which this app supports),
    // and a prompt that can't leave the app is the whole feature failing silently. Selecting the
    // textarea works there, and leaves the text selected for a manual Ctrl+C if even that is off.
    if(navigator.clipboard){
      navigator.clipboard.writeText(ta.value).then(done).catch(()=>{ ta.focus(); ta.select(); });
      return true;
    }
    ta.focus(); ta.select();
    try{ document.execCommand('copy'); done(); }catch(e){ /* text is selected; Ctrl+C works */ }
    return true;
  }
  function boardOpenTool(toolKey){
    const tool = BOARD_TOOLS.find(t=>t.key===toolKey); if(!tool) return;
    state.board.prefs.tool = toolKey; save();
    const text = el('boardPrompt').value;
    boardCopyPrompt(null); // always copy first, so a failed/absent prefill is an inconvenience rather than a dead end
    const prefill = tool.prefill && (tool.url.length + encodeURIComponent(text).length) <= BOARD_URL_MAX;
    window.open(prefill ? tool.url + encodeURIComponent(text) : tool.url.split('?')[0], '_blank', 'noopener');
  }

  /* ---------- history ---------- */
  function saveBoardConsult(){
    if(!boardQuestion.trim()) return;
    state.board.sessions.unshift({
      id: uid(), createdAt: Date.now(),
      question: boardQuestion.trim(),
      adviserIds: boardSelectedAdvisers().map(a=>a.id),
      attach: BOARD_CTX_SOURCES.filter(s=>(state.board.prefs.attach||{})[s.key]).map(s=>s.key),
      prompt: el('boardPrompt').value,
      response: ''
    });
    // hard cap rather than unbounded growth — see BOARD_SESSION_CAP in core.js
    if(state.board.sessions.length > BOARD_SESSION_CAP) state.board.sessions.splice(BOARD_SESSION_CAP);
    boardOpenSessionId = state.board.sessions[0].id;
    save();
    showBoardSubTab('history');
  }

  function renderBoardHistory(){
    const list = el('boardHistory'); if(!list) return;
    list.innerHTML = '';
    const sessions = state.board.sessions;
    el('boardHistoryEmpty').style.display = sessions.length===0 ? 'block' : 'none';
    el('boardHistoryCount').textContent = sessions.length + ' / ' + BOARD_SESSION_CAP + ' kept';
    sessions.forEach(s=>{
      const open = s.id === boardOpenSessionId;
      const row = document.createElement('div');
      row.className = 'board-session' + (open ? ' open' : '');
      const seats = s.adviserIds.map(id=>{ const a = adviserById(id); return a ? (a.emoji||'💬') : '·'; }).join('');
      row.innerHTML = '<div class="board-session-head">'
          + '<span class="board-session-seats">'+escapeHtml(seats)+'</span>'
          + '<span class="board-session-q">'+escapeHtml(s.question)+'</span>'
          + '<span class="board-session-date">'+escapeHtml(fmtDate(s.createdAt))+'</span>'
          + '<span class="chip">'+(s.response ? 'answered' : 'no answer yet')+'</span>'
        + '</div>';
      row.querySelector('.board-session-head').addEventListener('click', ()=>{
        boardOpenSessionId = open ? null : s.id;
        renderBoardHistory();
      });
      if(open){
        const bodyEl = document.createElement('div');
        bodyEl.className = 'board-session-body';
        bodyEl.innerHTML = '<div class="section-lbl">The board\'s answer</div>'
          + '<textarea class="board-textarea board-response" rows="8" placeholder="Paste what the board said back here…"></textarea>'
          + '<div class="board-session-actions">'
            + '<button class="btn btn-ghost btn-sm board-recopy" type="button">📋 Copy the prompt again</button>'
            + '<button class="del-goal board-session-del" type="button">Delete consult</button>'
          + '</div>'
          + (s.response ? '<div class="section-lbl">Rendered</div><div class="board-session-render">'+renderMarkdown(s.response)+'</div>' : '');
        const ta = bodyEl.querySelector('.board-response');
        ta.value = s.response || ''; // property, not an attribute — the answer is arbitrary text
        // Same caret trap as Notes: re-rendering on every keystroke would rebuild this textarea
        // mid-word and drop the caret. Persist only, and repaint the markdown on blur.
        ta.addEventListener('input', ()=>{ s.response = ta.value; debouncedSave(); });
        ta.addEventListener('blur', ()=>{ save(); renderBoardHistory(); });
        bodyEl.querySelector('.board-recopy').addEventListener('click', (e)=>{
          const target = el('boardPrompt');
          target.value = s.prompt; boardPromptDirty = true;
          boardCopyPrompt(e.currentTarget);
        });
        bodyEl.querySelector('.board-session-del').addEventListener('click', ()=>{
          if(!confirm('Delete this consult and the answer saved with it?')) return;
          state.board.sessions = state.board.sessions.filter(x=>x.id!==s.id);
          boardOpenSessionId = null;
          save(); renderBoardHistory();
        });
        row.appendChild(bodyEl);
      }
      list.appendChild(row);
    });
  }

  /* ---------- wiring (static markup only; per-card listeners are attached as cards are built) ---------- */
  document.querySelectorAll('#view-board .finance-subnav-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> showBoardSubTab(btn.dataset.boardtab));
  });
  el('boardQuestion').addEventListener('input', e=>{
    boardQuestion = e.target.value;
    boardPromptDirty = false;
    renderBoardAsk(); // rebuilds the generated prompt only — never this textarea, so the caret holds
  });
  el('boardRulesToggle').addEventListener('click', ()=>{
    const wrap = el('boardRulesWrap');
    const showing = wrap.style.display !== 'none';
    wrap.style.display = showing ? 'none' : '';
    el('boardRulesToggle').textContent = showing ? '⚙ Output rules' : '⚙ Hide output rules';
  });
  el('boardRules').addEventListener('input', e=>{
    state.board.prefs.rules = e.target.value;
    boardPromptDirty = false;
    debouncedSave();
    renderBoardAsk();
  });
  el('boardRulesResetBtn').addEventListener('click', ()=>{
    state.board.prefs.rules = BOARD_DEFAULT_RULES;
    el('boardRules').value = BOARD_DEFAULT_RULES;
    boardPromptDirty = false;
    save(); renderBoardAsk();
  });
  // a hand-edited prompt is the escape hatch for anything the builder doesn't cover, so once it's
  // touched the generated version stops overwriting it until an input above resets the flag
  el('boardPrompt').addEventListener('input', ()=>{
    boardPromptDirty = true;
    el('boardPromptLen').textContent = el('boardPrompt').value.length.toLocaleString() + ' characters — edited by hand';
  });
  el('boardRegenBtn').addEventListener('click', ()=>{ boardPromptDirty = false; renderBoardAsk(); });
  el('boardCopyBtn').addEventListener('click', e=> boardCopyPrompt(e.currentTarget));
  el('boardSaveConsultBtn').addEventListener('click', saveBoardConsult);
  el('boardHireBtn').addEventListener('click', openHireSheet);
  el('boardHireOverlay').addEventListener('click', e=>{ if(e.target===el('boardHireOverlay')) closeHireSheet(); });
  el('boardEditOverlay').addEventListener('click', e=>{ if(e.target===el('boardEditOverlay')) closeAdviserEditor(); });
  el('boardToolRow').innerHTML = BOARD_TOOLS.map(t=>
    '<button class="btn btn-ghost btn-sm board-tool-btn" type="button" data-tool="'+t.key+'">'+escapeHtml(t.label)+'</button>'
  ).join('');
  el('boardToolRow').addEventListener('click', e=>{
    const btn = e.target.closest('.board-tool-btn'); if(!btn) return;
    boardOpenTool(btn.dataset.tool);
  });
  // The rules textarea is static markup rather than something a render rebuilds, so it's filled
  // from state here. Skipped while it has focus: renderBoardAsk() runs on its own input handler,
  // and reassigning .value mid-keystroke would drop the caret to the end (the Notes lesson).
  function hydrateBoardStaticFields(){
    const rules = el('boardRules');
    if(document.activeElement !== rules) rules.value = (state.board.prefs && state.board.prefs.rules) || BOARD_DEFAULT_RULES;
  }
