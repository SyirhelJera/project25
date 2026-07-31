  // Supported currencies for Finance (multi-currency accounts, subscriptions, and the converter).
  // Rates are "units per 1 USD" and are user-editable in the Currency Converter tab since they
  // aren't fetched live from anywhere.
  const CURRENCIES = ['USD','PHP','EUR','GBP','JPY','AUD','CAD','SGD','INR','CNY'];
  const CURRENCY_SYMBOLS = {USD:'$',PHP:'₱',EUR:'€',GBP:'£',JPY:'¥',AUD:'A$',CAD:'C$',SGD:'S$',INR:'₹',CNY:'¥'};
  const DEFAULT_RATES = {USD:1,PHP:58.5,EUR:0.92,GBP:0.79,JPY:157,AUD:1.52,CAD:1.36,SGD:1.34,INR:83.5,CNY:7.25};

  let state = { goals: [], habits: [], countdowns: [], mantras: [], checklists: [], checklistExp: 0,
    finance: { accounts: [], subscriptions: [], moneyGoals: [], rates: Object.assign({}, DEFAULT_RATES), netWorthHistory: [] },
    fitness: { currentWeight:'', targetWeight:'', height:'', age:'', sex:'male', activity:'1.55', pace:'0.5', unit:'kg', weightLog:[], progressPhotos:[] },
    valorant: { apiKey:'', accounts:[], selectedAccountId:null, sortMode:'manual', dailyStores:{}, selectedStoreLabel:'', localServerUrl:'', localServerToken:'' },
    profile: {name:'',age:'',netWorth:'',netWorthCurrency:'USD',avatarImage:'',avatarGeneratedAt:null,race:'',skinTone:'',hairColor:'',hairStyle:'',eyeColor:'',clothing:'',background:'',hideAvatar:false}, focus: null, playSession: null, theme: 'light',
    // pinned-countdown mosaic dot colors (Settings tab) — empty string means "use the theme default"
    mosaicColors: { filled:'', today:'', empty:'' },
    // per-day tally of "dailies"-group checklist completion: { "YYYY-MM-DD": { done, total } } —
    // drives the mosaic's GitHub-style intensity coloring; see recomputeDailyActivity()
    dailyActivity: {} };
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

  // Goal/finance icon images are stored inline as base64 in the single shared app_data row
  // (see js/persistence.js) — that whole row is transferred on every load and every save, even
  // ones unrelated to these images. An unresized phone photo dropped in here (multi-MB) gets
  // re-sent on every save from then on, which is what actually drives PostgREST egress up, not
  // just the one-time upload. So every upload is downscaled + re-encoded as JPEG before it's
  // ever put in state, instead of storing the raw file. Falls back to the raw file (old
  // behavior) if decoding fails, so an upload never just silently breaks.
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
        try{ resolve(canvas.toDataURL('image/jpeg', quality)); }
        catch(e){ reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('Could not decode image')); };
      img.src = objUrl;
    }).catch(()=> new Promise((resolve, reject)=>{
      const reader = new FileReader();
      reader.onload = ev => resolve(ev.target.result);
      reader.onerror = () => reject(new Error('Could not read the selected file.'));
      reader.readAsDataURL(file);
    }));
  }

