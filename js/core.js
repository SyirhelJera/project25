  // Supported currencies for Finance (multi-currency accounts, subscriptions, and the converter).
  // Rates are "units per 1 USD" and are user-editable in the Currency Converter tab since they
  // aren't fetched live from anywhere.
  const CURRENCIES = ['USD','PHP','EUR','GBP','JPY','AUD','CAD','SGD','INR','CNY'];
  const CURRENCY_SYMBOLS = {USD:'$',PHP:'₱',EUR:'€',GBP:'£',JPY:'¥',AUD:'A$',CAD:'C$',SGD:'S$',INR:'₹',CNY:'¥'};
  const DEFAULT_RATES = {USD:1,PHP:58.5,EUR:0.92,GBP:0.79,JPY:157,AUD:1.52,CAD:1.36,SGD:1.34,INR:83.5,CNY:7.25};

  /* ---------- Board of Advisers (js/board.js) ----------
     The roster of personas the prompt maker writes into a prompt. Defined HERE rather than in
     board.js for the same reason DEFAULT_RATES is: applyLoadedState() in persistence.js needs
     seedBoardAdvisers() to fill an absent board key, and persistence.js parses before board.js.
     `lens` is the sentence that literally goes into the prompt under the adviser's name, so it's
     written as an instruction to the model, not as a description of the persona. ---- */
  const BOARD_PRESETS = [
    { key:'truth',     emoji:'👤', name:'The Truth-Teller', color:'#DC2626', lens:'Brutally honest, analytical. Cut through my excuses, name the cognitive biases I am running, and tell me what I NEED to hear rather than what I want to hear.' },
    { key:'pragmatist',emoji:'⚙️', name:'The Pragmatist',   color:'#64748B', lens:'Focused entirely on logic, risk management, execution, numbers, efficiency, and resource constraints — time and money. Ask what this actually costs and whether it can be done with what I have.' },
    { key:'visionary', emoji:'🚀', name:'The Visionary',    color:'#7C3AED', lens:'Optimistic and growth-minded. Push me toward bold moves, long-term opportunity and compounding upside, and stop me from playing too safe.' },
    { key:'health',    emoji:'🧠', name:'The Health Anchor',color:'#059669', lens:'Focused on my mental health, relationship quality, boundaries, stress levels, and avoiding burnout. Guard the parts of my life that do not show up on a spreadsheet.' },
    { key:'outsider',  emoji:'🌍', name:'The Outsider',     color:'#0284C7', lens:'Completely detached, big-picture. Question my baseline assumptions, and ask whether this even matters in five years.' },
    // offered in the hire sheet, not seeded
    { key:'operator',  emoji:'🛠️', name:'The Operator',     color:'#B45309', lens:'Cares only about the next concrete action. Turn everything into a specific step with an owner and a date, and call out anything that is a plan to make a plan.' },
    { key:'contrarian',emoji:'🔀', name:'The Contrarian',   color:'#DB2777', lens:'Argue the opposite of whatever the room is converging on. If everyone agrees, that is the signal something has not been examined.' },
    { key:'money',     emoji:'💰', name:'The Money Coach',  color:'#0F7A38', lens:'Read every decision through cash flow, runway, and opportunity cost. Be specific about what this does to my savings rate and my net worth over the next 12 months.' },
    { key:'mentor',    emoji:'🧭', name:'The Mentor',       color:'#4F46E5', lens:'Someone ten years ahead of me who has already made this mistake. Be warm but direct, and tell me what you would do differently with hindsight.' },
    { key:'future',    emoji:'⏳', name:'Future Me',        color:'#9333EA', lens:'Speak as me, five years from now, looking back at this decision. Tell me which part of it I will still be thinking about and which part turned out not to matter.' },
    { key:'skeptic',   emoji:'🔍', name:'The Skeptic',      color:'#475569', lens:'Attack the evidence. Ask what I actually know versus what I am assuming, and what would have to be true for this to work.' },
    { key:'closer',    emoji:'🏁', name:'The Closer',       color:'#EA580C', lens:'Impatient with deliberation. Force a decision, name the deadline, and point out the cost of spending another week thinking about it.' },
    { key:'devil',     emoji:'😈', name:"The Devil's Advocate", color:'#991B1B', lens:'Build the strongest possible case for the option I am least inclined to take, in good faith and without strawmanning it.' }
  ];
  const BOARD_DEFAULT_KEYS = ['truth','pragmatist','visionary','health','outsider'];
  // The output contract sent with every prompt — editable per-board in the Ask pane.
  const BOARD_DEFAULT_RULES = 'Start immediately with the persona breakdown. No introductory pleasantries.\n'
    + 'Each adviser gives a short, punchy critique of my situation through their own lens — 2-3 sentences maximum. Make them sound like distinct people, not one voice with different labels.\n'
    + 'Advisers must reference or challenge each other by name (e.g. "While the Visionary wants to jump, the Pragmatist is right about the cash flow risk...").\n'
    + 'Conclude with a section called "📊 Board Consensus" giving a 3-step actionable compromise.';
  // Consult history rides the shared app_data row, so it is capped rather than unbounded — a saved
  // consult carries the whole prompt plus a pasted answer, and every save re-uploads the blob whole.
  const BOARD_SESSION_CAP = 25;
  function seedBoardAdvisers(){
    return BOARD_PRESETS.filter(p=>BOARD_DEFAULT_KEYS.indexOf(p.key)>=0)
      .map(p=>({ id:uid(), presetKey:p.key, emoji:p.emoji, name:p.name, lens:p.lens, color:p.color, hired:true, createdAt:Date.now() }));
  }
  function defaultBoardState(){
    return { advisers: seedBoardAdvisers(), sessions: [], prefs: { attach:{}, rules: BOARD_DEFAULT_RULES, tool:'chatgpt' } };
  }

  let state = { goals: [], habits: [], habitSort: { mode:'none', dir:'desc' }, countdowns: [], mantras: [], motivation: { categories: [], pin: '', pinnedCategoryId: '', catOrder: 'added', speakMantra: false }, checklists: [], checklistExp: 0,
    // The level the user has already been congratulated for. Level itself is derived from exp on
    // every load, so without a remembered mark the level-up popup (js/goals.js) would replay on
    // every reload after a level-up. null = never marked; see noteLevelChange().
    lastLevelSeen: null,
    finance: { accounts: [], subscriptions: [], moneyGoals: [], debts: [], rates: Object.assign({}, DEFAULT_RATES), netWorthHistory: [] },
    fitness: { currentWeight:'', targetWeight:'', height:'', age:'', sex:'male', activity:'1.55', pace:'0.5', unit:'kg', weightLog:[], calorieLog:[], kcalOffset:1, activityLog:[], measureLog:[], progressPhotos:[], dreamPhoto:null },
    // valorant.live holds PREFERENCES ONLY — the live lobby itself is never stored anywhere,
    // see applyLoadedState() in persistence.js and README.md's "Live Match" section.
    valorant: { apiKey:'', accounts:[], selectedAccountId:null, sortMode:'manual', dailyStores:{}, ownedSkins:{}, selectedStoreLabel:'', storeMode:'store', localServerUrl:'', localServerToken:'', activeSubtab:'shop', wishlist:{},
      skinPrices:{},
      vp:{ currency:'', packages:[{vp:475,price:0},{vp:1000,price:0},{vp:2050,price:0},{vp:3650,price:0},{vp:5350,price:0},{vp:11000,price:0}], offers:[], useOffers:true },
      live:{ enabled:true, label:'', regionOverride:'', historyDepth:10, showEnemyStats:true, showIncognito:false } },
    // which game the Games tab is showing. Defined HERE and not only in applyLoadedState(), because
    // syncValLivePolling() reads it and can fire before a load finishes (the visibilitychange
    // listener in valorant.js) — it must never be undefined. See showGameSubTab() in js/tft.js.
    games: { active: 'valorant' },
    // Teamfight Tactics — manual entry only. There is no API path: the HenrikDev key above is
    // Valorant-only, and Riot's official TFT API needs a personal key that expires every 24h.
    // One flat log of games; the current rank is DERIVED from the newest record, never stored, so
    // the two can't drift apart. See js/tft.js for the rank-power scalar.
    tft: { entries: [], target: { tier:'', division:4, lp:0, date:'', startValue:null, setAt:null },
      // The climb's real deadline is the set ending, not an arbitrary date — rank resets with it.
      // `set` is detected from synced data; `endDate` has to be typed, because Riot only announces
      // it in patch notes and no API exposes it (checked MetaTFT and the set tables).
      season: { set:'', endDate:'' },
      // MetaTFT auto-sync (js/tft.js). Their public API sends permissive CORS, so the browser calls
      // it directly — no local helper and no Edge Function, unlike the Valorant tooling.
      sync: { region:'sg2', riotId:'', auto:true, lastSyncedAt:null, lastError:'', cutoffs:null },
      // Live lobby (js/tft.js) — PREFERENCES ONLY, the same rule as valorant.live above: the eight
      // players themselves never touch state. Defined HERE as well as in applyLoadedState() for
      // the same reason games.active is: syncTftLobbyPolling() reads it from a visibilitychange
      // listener that can fire before a load finishes, so it must never be undefined.
      lobby: { enabled:true } },
    clock: { fasting: { enabled:false, eatingStart:'12:00', eatingEnd:'20:00' }, blocks: [] },
    // Google Calendar (js/calendar.js) — PREFERENCES ONLY, the same rule as valorant.live above.
    // The fetched events are never stored anywhere: they'd ride in the shared blob on every save
    // from every tab, and they're stale within the hour. calendarIds:[] means "just the account's
    // own calendar". ✕ on a bubble is session-only and records nothing — see js/calendar.js.
    calendar: { calendarIds: [], lookaheadDays: 14, bubbleDays: 7, bubbleCount: 1, bubbleEnabled: true, bubbleSound: true, bubbleCountdowns: true },
    wishlist: [], // { id, name, cost, contributions:[{id,amount,createdAt}], imageUrl, favorite, bought, createdAt }
    jobs: [], // { id, createdAt, updatedAt, company, group, logoUrl, workModel, hqLocation, companySiteUrl,
              //   title, postingUrl, salaryRange, resumeVersion, resumeFileId, resumeFileName, resumeViewLink,
              //   coverLetterVersion, notes, source, sourceOther, status, appliedDate,
              //   contacts:[{id,name,title,email}] }
              // group: free-text subcategory ('' = ungrouped), shown as a colored pill on the card;
              // its color comes from state.jobCategoryColors below. logoUrl: company photo/logo,
              // a Supabase Storage URL from uploadCompressedImage(), never embedded base64.
              // resumeFileId/resumeFileName/resumeViewLink: the attached resume PDF, uploaded via the
              // upload-resume Edge Function straight to a Google Drive folder named "Uploaded Resumes"
              // (see supabase/functions/upload-resume) — only the Drive file id/link are stored here,
              // never the PDF bytes, same pattern as fitness progress photos.
    // login credentials for job-search sites (LinkedIn, Indeed, ...) — plaintext, stored in the same
    // shared unauthenticated row as everything else in this app (see js/persistence.js), just masked
    // in the UI; not real encryption
    jobSiteAccounts: [], // { id, site, loginUrl, username, password, imageUrl, createdAt }
    // per-Jobs-subcategory pill color: { "<group name>": "#RRGGBB" }. Deliberately lives in the
    // shared row rather than the dedicated jobs row (see js/jobs.js) — it's a tiny bounded map, and
    // keeping it here means doSave()'s rest-destructure carries it automatically.
    jobCategoryColors: {},
    // Board of Advisers (js/board.js) — a roster of AI personas plus the consults you've run past
    // them. The tab builds a prompt and hands it to whichever AI tool you use; nothing here calls
    // an API. Deliberately EMPTY here rather than seeded with the five default advisers: seeding
    // calls seedBoardAdvisers() -> uid(), and uid() is declared below this literal, so calling it
    // at parse time would hit the temporal dead zone. applyLoadedState() does the seeding instead,
    // which is also the only place that can tell "never had a board" from "fired everyone".
    board: { advisers: [], sessions: [], prefs: { attach:{}, rules:'', tool:'chatgpt' } },
    profile: {name:'',age:'',netWorth:'',netWorthCurrency:'USD',hideAvatar:false}, focus: null, playSession: null, theme: 'light',
    // background music for Play sessions (js/music.js) — `url` is the playlist currently loaded
    // (any YouTube / YouTube Music link), `playlists` the saved shortlist you can switch between
    // mid-session, volume is 0-100. `mode` is 'embed' (in-app iframe player) or 'external' (hand
    // the playlist to YouTube Music itself, the only way Premium applies — see js/music.js).
    // Settings only; nothing about playback state is persisted.
    sessionMusic: { url:'', enabled:true, volume:35, shuffle:true, mode:'embed', playlists:[] },
    // navbar appearance (Settings tab): tabOrder is the sidebar's tab keys in display order
    // (empty = the order they appear in index.html), hideTabIcons drops the per-tab logos,
    // hiddenTabs are the tab keys kept out of the navbar entirely ('settings' is never hideable).
    // All three are applied by applyTabOrder()/applyTabIcons()/applyTabVisibility() in js/settings.js.
    tabOrder: [], hideTabIcons: false, hiddenTabs: [],
    // pinned-countdown mosaic dot colors (Settings tab) — empty string means "use the theme default".
    // perfectGlow toggles whether 100%-completed ("perfect") days are highlighted differently;
    // perfectStyle picks how ('color' solid fill / 'rainbow' / 'golden' shimmer / 'emoji' overlay);
    // perfect is the 'color' style's color override (empty = theme default gold); perfectEmoji is
    // the 'emoji' style's chosen emoji
    mosaicColors: { filled:'', today:'', empty:'', perfect:'', perfectGlow:true, perfectStyle:'color', perfectEmoji:'⭐' },
    // per-day tally of "dailies"-group checklist completion: { "YYYY-MM-DD": { done, total } } —
    // drives the mosaic's GitHub-style intensity coloring; see recomputeDailyActivity()
    dailyActivity: {},
    // vacation/sick/event date ranges (Settings tab) — excuses habit streaks and checklist
    // miss-streaks for any day they cover; see js/protecteddays.js
    protectedDays: [],
    // the color protected days are ringed in — on the habit week/month calendars AND on the goals
    // heat map, so it's a top-level key rather than part of mosaicColors. Empty = the theme's violet.
    protectedDayColor: '',
    // hierarchical outliner notes (Notes tab, js/notes.js) — a FLAT list: nesting is expressed
    // by parentId (null = top level) and sibling order is this array's own order, so a move is a
    // splice plus one field write, and a whole subtree follows its parent for free (the children
    // still point at it). No `order` ints to renumber, no nested children[] to recurse through.
    // Like state.jobs, this does NOT ride in the shared app_data row — it has its own resource,
    // hydrated by applyLoadedNotesState() and written by saveNotes(), both in js/notes.js.
    notes: [],  // { id, title, body, parentId, collapsed, pinned, createdAt, updatedAt }
    // the hidden scratch pad (js/scratch.js) — a small stack of free-form pages, reached only by
    // clicking the sidebar logo and paged through by swipe or tab+A/tab+D. HTML rather than plain
    // text because pages hold tickboxes, links and pasted images; everything read back in goes
    // through sanitizeScratchHtml() first. ensureScratchPages() guarantees there is always at
    // least one page and that activeId points at one of them. Like state.jobs
    // and state.notes this does NOT ride in the shared app_data row — it has its own resource,
    // hydrated by applyLoadedScratchState() and written by saveScratch(). Defaulted here as well
    // as there because flushPendingScratchSave() is wired to visibilitychange and can fire before
    // a load has finished.
    scratch: { pages: [], activeId: '', updatedAt: 0, mute: false } };
  let goalFilter = 'working';
  let starredFirst = false;
  let sortMode = 'none';
  let sortDir = 'desc';
  let mantraIdx = -1;

  const el = id => document.getElementById(id);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
  const escapeHtml = str => { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; };
  const fmtDate = ts => !ts ? '' : new Date(ts).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  const localDateStr = d => { const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return y+'-'+m+'-'+day; };
  // Inverse of localDateStr — parses a "YYYY-MM-DD" string as a local-midnight Date by reading its
  // components directly, unlike new Date(str) (parsed as UTC per spec, which can land on the
  // previous local day in negative-UTC-offset zones once .setHours(0,0,0,0) is applied elsewhere).
  const parseLocalDateStr = str => { const [y,m,day] = str.split('-').map(Number); return new Date(y, m-1, day); };

  // Scrolls `node` to the middle of the viewport — used when expanding a card, so the newly
  // revealed content isn't left hanging off the bottom of the screen. Two cases scrollIntoView's
  // block:'center' gets wrong here: on mobile the sidebar is a sticky top bar, so it has to come
  // off the usable viewport height; and a card taller than what's left can't be centered without
  // pushing its own header off the top, so those align to the top instead.
  function scrollCardIntoCenter(node){
    if(!node) return;
    const sidebar = document.querySelector('.sidebar');
    const barH = (sidebar && window.matchMedia('(max-width:760px)').matches) ? sidebar.getBoundingClientRect().height : 0;
    const avail = window.innerHeight - barH;
    const rect = node.getBoundingClientRect();
    const gap = rect.height < avail ? (avail - rect.height)/2 : 12;
    window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - barH - gap), behavior:'smooth' });
  }

  // ▲/▼ trend marker for the profile card. Direction and color are separate on purpose: net
  // worth rising is good (green ▲) while weight rising is not (red ▲), so callers pass the
  // arrow direction and whether that direction is a good thing independently.
  function trendMarker(dir, good, title){
    if(!dir) return '';
    return '<span class="pf-trend-mark '+(good?'good':'bad')+'" title="'+escapeHtml(title||'')+'">'+(dir>0?'▲':'▼')+'</span>';
  }
  /* How far back those arrows compare — Settings -> Trend Comparison. Returns the date key to
     reach back to, or null for "the last entry", where each trend keeps its own previous-reading
     rule (they differ: net worth compares a live figure against a daily snapshot, fitness compares
     one logged weigh-in against the one before it). Callers take the newest reading on or before
     the key, so "since" always names a date something was actually recorded on.

     'week' and 'month' are calendar anchors, not rolling windows: they answer "how far have I moved
     *this* week/month", which is a different question from "…in the last 7/30 days" and the reason
     both kinds are offered. Week starts Monday, matching habits.js and checklists.js. */
  function trendCutoffKey(){
    const w = state.trendWindow == null ? '0' : String(state.trendWindow);
    if(w === '0') return null;
    const d = new Date(); d.setHours(0,0,0,0);
    if(w === 'week'){ d.setDate(d.getDate() - ((d.getDay()+6)%7)); }
    else if(w === 'month'){ d.setDate(1); }
    else {
      const days = Number(w) || 0;
      if(days <= 0) return null;
      d.setDate(d.getDate() - days);
    }
    return localDateStr(d);
  }

  // Goal/finance icon images used to be stored inline as base64 in the single shared app_data
  // row (see js/persistence.js) — that whole row is transferred on every load and every save,
  // even ones unrelated to these images, so an embedded image got re-sent forever, not just on
  // upload. Every upload is downscaled + re-encoded as JPEG (as before), then uploaded to the
  // "icons" Supabase Storage bucket — only the resulting (short) public URL is stored in state.
  // Requires the "icons" bucket + public read/write policies (see README.md "Setup"). Falls
  // back to an inline base64 data URL when Supabase isn't configured/reachable (e.g. running
  // inside Claude, or the upload itself fails), so an upload never just silently breaks — it
  // just costs more egress than usual until Storage is reachable again.
  /* ---------- alpha-aware output ----------
     Every upload used to be re-encoded as JPEG unconditionally. That is right for a photograph and
     wrong for a cut-out: JPEG has no alpha channel, so a transparent PNG came back with its
     transparency flattened onto the canvas's own (black) backdrop — barely noticeable on a dark
     theme, a black slab on a light one, and unmistakable the moment two images overlap, which is
     exactly what the scratch page's free-floating images do.
     So the OUTPUT FORMAT follows the pixels rather than the caller: an image whose source type can
     carry alpha at all is scanned once, and only if some pixel is actually less than fully opaque
     is it re-encoded as PNG (lossless, alpha kept). Everything else takes the JPEG path byte for
     byte as before — which matters more than it looks: nearly every pasted screenshot arrives as
     image/png and is fully opaque, and encoding those losslessly would multiply what Storage holds
     for no visible gain at all. */
  const ALPHA_SOURCE_TYPE = /^image\/(png|webp|gif|avif|svg\+xml)$/i;

  /* Scanned on the ALREADY DOWNSCALED canvas and early-exiting on the first transparent pixel, so
     the full-buffer walk only ever happens for an opaque PNG. getImageData cannot taint here (the
     source is an object URL for a local File, same-origin by construction), but it is wrapped
     anyway and a failure simply means "assume opaque" — i.e. the old behaviour. */
  function canvasHasAlpha(ctx, w, h){
    try{
      const data = ctx.getImageData(0, 0, w, h).data;
      for(let i = 3; i < data.length; i += 4) if(data[i] < 255) return true;
    }catch(e){}
    return false;
  }

  function compressImageFile(file, maxDim, quality){
    return new Promise((resolve, reject)=>{
      const objUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(objUrl);
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const done = blob => blob ? resolve(blob) : reject(new Error('Could not encode image'));
        // note the missing quality argument on the PNG branch: PNG is lossless, and passing one
        // there is meaningless rather than merely ignored
        if(ALPHA_SOURCE_TYPE.test(file.type || '') && canvasHasAlpha(ctx, w, h)) canvas.toBlob(done, 'image/png');
        else canvas.toBlob(done, 'image/jpeg', quality);
      };
      img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('Could not decode image')); };
      img.src = objUrl;
    }).catch(()=> file); // decode failed — fall back to uploading/encoding the raw file as-is
  }

  function blobToDataUrl(blob){
    return new Promise((resolve, reject)=>{
      const reader = new FileReader();
      reader.onload = ev => resolve(ev.target.result);
      reader.onerror = () => reject(new Error('Could not read the selected file.'));
      reader.readAsDataURL(blob);
    });
  }

  // One-time setup: run supabase/setup-egress-fix.sql in the Supabase SQL editor to create this
  // bucket + its public read/write policies (same "anyone can read/write" model already used
  // for app_data — see js/persistence.js — since this app has no login).
  const ICONS_BUCKET = 'icons';
  function uploadCompressedImage(file, maxDim, quality, folder){
    return compressImageFile(file, maxDim, quality).then(blob=>{
      if(!supabaseConfigured || usingClaudeStorage || !supa) return blobToDataUrl(blob);
      /* The extension and the content type have to FOLLOW THE ENCODING, not the caller's
         assumption: compressImageFile() now emits PNG for anything that turned out to carry
         transparency, and serving those bytes from a .jpg path labelled image/jpeg is how the
         alpha would get thrown away again one step later. Anything that isn't PNG is JPEG,
         including the raw-File fallback above. */
      const type = /^image\/png$/i.test(blob.type || '') ? 'image/png' : 'image/jpeg';
      const path = folder + '/' + uid() + (type === 'image/png' ? '.png' : '.jpg');
      // cacheControl is a full year: each path is unique (uid()) and never overwritten, so the
      // browser can cache a fetched image indefinitely instead of re-pulling it from Storage
      // (and burning egress) every time its default 1-hour cache would otherwise expire — e.g.
      // on every slideshow rotation or tab revisit past that hour.
      return supa.storage.from(ICONS_BUCKET).upload(path, blob, { contentType: type, cacheControl: '31536000' })
        .then(({ error })=>{
          if(error) throw error;
          return supa.storage.from(ICONS_BUCKET).getPublicUrl(path).data.publicUrl;
        })
        .catch(err=>{
          // Deliberately do NOT fall back to embedding the image as a base64 data: URL here —
          // that used to happen silently on any Storage failure (bad network, bucket/policy
          // issue) and permanently bloats the single shared app_data row with the full image
          // bytes, since every load()/save() round-trips that whole row regardless of which
          // tab is open. Surface the failure instead so the user can retry.
          console.error('Image upload to Storage failed', err);
          throw new Error('Could not upload the image — check your connection and try again.');
        });
    });
  }

  // Best-effort delete of a previously-uploaded icon when it's replaced or removed, so the free
  // Storage quota doesn't slowly fill with orphaned files. A no-op for base64 data URLs (icons
  // saved before this change, or ones that fell back to base64 above) since those aren't in
  // Storage at all. Failures are swallowed — a stray orphaned file is harmless, unlike blocking
  // the user's edit on a delete call failing.
  function deleteStorageImage(url){
    if(!url || !supabaseConfigured || usingClaudeStorage || !supa) return;
    const marker = '/storage/v1/object/public/' + ICONS_BUCKET + '/';
    const idx = url.indexOf(marker);
    if(idx === -1) return;
    supa.storage.from(ICONS_BUCKET).remove([url.slice(idx + marker.length)]).catch(()=>{});
  }

