  // Supported currencies for Finance (multi-currency accounts, subscriptions, and the converter).
  // Rates are "units per 1 USD" and are user-editable in the Currency Converter tab since they
  // aren't fetched live from anywhere.
  const CURRENCIES = ['USD','PHP','EUR','GBP','JPY','AUD','CAD','SGD','INR','CNY'];
  const CURRENCY_SYMBOLS = {USD:'$',PHP:'₱',EUR:'€',GBP:'£',JPY:'¥',AUD:'A$',CAD:'C$',SGD:'S$',INR:'₹',CNY:'¥'};
  const DEFAULT_RATES = {USD:1,PHP:58.5,EUR:0.92,GBP:0.79,JPY:157,AUD:1.52,CAD:1.36,SGD:1.34,INR:83.5,CNY:7.25};

  let state = { goals: [], habits: [], countdowns: [], mantras: [], checklists: [], checklistExp: 0,
    finance: { accounts: [], subscriptions: [], moneyGoals: [], rates: Object.assign({}, DEFAULT_RATES) },
    fitness: { currentWeight:'', targetWeight:'', height:'', age:'', sex:'male', activity:'1.55', pace:'0.5', unit:'kg', weightLog:[] },
    valorant: { apiKey:'', accounts:[], selectedAccountId:null },
    profile: {name:'',age:'',netWorth:'',netWorthCurrency:'USD',avatarImage:'',avatarGeneratedAt:null,race:'',skinTone:'',hairColor:'',hairStyle:'',eyeColor:'',clothing:'',background:'',hideAvatar:false}, focus: null, theme: 'light' };
  let goalFilter = 'working';
  let starredFirst = false;
  let sortMode = 'none';
  let sortDir = 'desc';
  let pendingImport = null;
  let mantraIdx = 0;

  const el = id => document.getElementById(id);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
  const escapeHtml = str => { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; };
  const fmtDate = ts => !ts ? '' : new Date(ts).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  const localDateStr = d => { const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return y+'-'+m+'-'+day; };

