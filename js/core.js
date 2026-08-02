  // Supported currencies for Finance (multi-currency accounts, subscriptions, and the converter).
  // Rates are "units per 1 USD" and are user-editable in the Currency Converter tab since they
  // aren't fetched live from anywhere.
  const CURRENCIES = ['USD','PHP','EUR','GBP','JPY','AUD','CAD','SGD','INR','CNY'];
  const CURRENCY_SYMBOLS = {USD:'$',PHP:'₱',EUR:'€',GBP:'£',JPY:'¥',AUD:'A$',CAD:'C$',SGD:'S$',INR:'₹',CNY:'¥'};
  const DEFAULT_RATES = {USD:1,PHP:58.5,EUR:0.92,GBP:0.79,JPY:157,AUD:1.52,CAD:1.36,SGD:1.34,INR:83.5,CNY:7.25};

  let state = { goals: [], habits: [], countdowns: [], mantras: [], motivation: { categories: [], pin: '', pinnedCategoryId: '' }, checklists: [], checklistExp: 0,
    finance: { accounts: [], subscriptions: [], moneyGoals: [], rates: Object.assign({}, DEFAULT_RATES), netWorthHistory: [] },
    fitness: { currentWeight:'', targetWeight:'', height:'', age:'', sex:'male', activity:'1.55', pace:'0.5', unit:'kg', weightLog:[], progressPhotos:[] },
    valorant: { apiKey:'', accounts:[], selectedAccountId:null, sortMode:'manual', dailyStores:{}, ownedSkins:{}, ownedSkinsCollapsed:false, selectedStoreLabel:'', localServerUrl:'', localServerToken:'', activeSubtab:'shop', wishlistCollapsed:false, wishlist:{} },
    profile: {name:'',age:'',netWorth:'',netWorthCurrency:'USD',hideAvatar:false}, focus: null, playSession: null, theme: 'light',
    // pinned-countdown mosaic dot colors (Settings tab) — empty string means "use the theme default"
    mosaicColors: { filled:'', today:'', empty:'' },
    // per-day tally of "dailies"-group checklist completion: { "YYYY-MM-DD": { done, total } } —
    // drives the mosaic's GitHub-style intensity coloring; see recomputeDailyActivity()
    dailyActivity: {},
    // vacation/sick/event date ranges (Settings tab) — excuses habit streaks and checklist
    // miss-streaks for any day they cover; see js/protecteddays.js
    protectedDays: [] };
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

  // Goal/finance icon images used to be stored inline as base64 in the single shared app_data
  // row (see js/persistence.js) — that whole row is transferred on every load and every save,
  // even ones unrelated to these images, so an embedded image got re-sent forever, not just on
  // upload. Every upload is downscaled + re-encoded as JPEG (as before), then uploaded to the
  // "icons" Supabase Storage bucket — only the resulting (short) public URL is stored in state.
  // Requires the "icons" bucket + public read/write policies (see README.md "Setup"). Falls
  // back to an inline base64 data URL when Supabase isn't configured/reachable (e.g. running
  // inside Claude, or the upload itself fails), so an upload never just silently breaks — it
  // just costs more egress than usual until Storage is reachable again.
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
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode image')), 'image/jpeg', quality);
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
      const path = folder + '/' + uid() + '.jpg';
      // cacheControl is a full year: each path is unique (uid()) and never overwritten, so the
      // browser can cache a fetched image indefinitely instead of re-pulling it from Storage
      // (and burning egress) every time its default 1-hour cache would otherwise expire — e.g.
      // on every slideshow rotation or tab revisit past that hour.
      return supa.storage.from(ICONS_BUCKET).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' })
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

