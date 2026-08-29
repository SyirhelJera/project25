  /* ================= ACCESS LOG (Settings → Data) =================
     A record of every device and place this dashboard has been opened from. The shared row is
     unauthenticated — anyone with the link can read and write it (js/persistence.js) — so the one
     question this app could never answer was "has anyone but me opened this?". That's what this
     answers, and it's why it lives under Data rather than under Appearance.

     Design notes, in the order they matter:

     * It logs SESSIONS, not page loads. A reload, a tab restore, or a PWA relaunch an hour later is
       the same sitting, so an open that matches the newest entry's device AND network within
       ACCESS_SESSION_GAP_MS just bumps that entry's lastAt/visits instead of appending. Without
       that the list is a wall of identical rows and the one genuinely new device is invisible in it.
     * The log rides the SHARED blob (a new top-level `state.access` key — doSave()'s
       rest-destructure carries it, per CLAUDE.md), so it is capped at ACCESS_LOG_CAP and each row
       is a handful of short strings. That cap is not decoration: every save from every tab
       re-uploads this whole blob.
     * A bump is normally NOT saved. Recording an access is the one write in this app that happens
       without the user doing anything, and the shared row has optimistic-concurrency conflict
       detection — a phone opening the app while the laptop has it open would otherwise hand the
       laptop a conflict banner it did nothing to earn. So only a genuinely new entry, or a bump
       more than ACCESS_BUMP_MIN_MS after the last one, writes; anything smaller stays in memory and
       rides the next ordinary save.
     * Location is IP-level (city/region/country), never the Geolocation API. Geolocation prompts,
       and a permission dialog on every app open to fill in a log nobody asked to see is a worse
       trade than a coarser answer. It is also why this is a third-party call rather than an Edge
       Function: the lookup services below send permissive CORS and take no key, the same reasoning
       that lets js/tft.js call MetaTFT directly. Their hosts MUST stay listed in sw.js's
       LIVE_DATA_HOSTS — the service worker's cross-origin branch is cache-first, so a cached
       lookup would freeze the answer at whatever network the app was first opened on.
     * Both halves are switchable and the log is clearable, because this stores the user's own IP in
       that same unauthenticated row. `enabled` off stops recording entirely; `geo` off keeps the
       device history and never contacts the lookup service at all.
  ---------------------------------------------------------------- */
  const ACCESS_LOG_CAP = 100;
  const ACCESS_SESSION_GAP_MS = 6 * 60 * 60 * 1000;   // same sitting if the last hit was within this
  const ACCESS_BUMP_MIN_MS = 5 * 60 * 1000;           // below this, a bump isn't worth a network write
  const ACCESS_GEO_TIMEOUT_MS = 6000;
  const ACCESS_ROWS_COLLAPSED = 8;

  /* Three services, tried in order until one answers with an ip. All three are keyless and
     CORS-open; the second and third exist because the free tiers have daily caps, so a heavy day on
     one shouldn't blank the location. `read` normalizes each shape into the one record stored. */
  const ACCESS_GEO_SOURCES = [
    { url:'https://ipwho.is/', read: d => (d && d.success !== false && d.ip)
      ? { ip:d.ip, city:d.city||'', region:d.region||'', country:d.country||'', cc:d.country_code||'',
          org:(d.connection && (d.connection.isp || d.connection.org)) || '' } : null },
    { url:'https://ipapi.co/json/', read: d => (d && !d.error && d.ip)
      ? { ip:d.ip, city:d.city||'', region:d.region||'', country:d.country_name||'', cc:d.country_code||'',
          org:d.org||'' } : null },
    { url:'https://get.geojs.io/v1/ip/geo.json', read: d => (d && d.ip)
      ? { ip:d.ip, city:d.city||'', region:d.region||'', country:d.country||'', cc:d.country_code||'',
          org:d.organization_name||'' } : null }
  ];

  function ensureAccessState(){
    if(!state.access || typeof state.access !== 'object') state.access = { enabled:true, geo:true, log:[] };
    if(!Array.isArray(state.access.log)) state.access.log = [];
    return state.access;
  }

  /* ---- device identification ----
     userAgentData first where it exists: it names Edge, Opera and Brave properly, which UA-string
     sniffing cannot — every Chromium browser puts "Chrome" in its UA. The regexes below are the
     fallback for Safari and Firefox, and their ORDER is load-bearing for the same reason (Edg
     before Chrome, Chrome before Safari). */
  function accessBrowser(){
    const uad = navigator.userAgentData;
    const brands = (uad && uad.brands) || [];
    // "Not A(Brand" and friends are deliberate padding entries, and plain "Chromium" is the engine
    // rather than the browser — the real name is what's left
    const real = brands.filter(b => b.brand && !/not[^a-z]*a[^a-z]*brand/i.test(b.brand) && b.brand !== 'Chromium');
    if(real.length){
      const b = real[real.length-1];
      return (b.brand + ' ' + (b.version || '')).trim();
    }
    const ua = navigator.userAgent || '';
    const hit = [
      [/Edg\/([\d.]+)/, 'Edge'], [/OPR\/([\d.]+)/, 'Opera'], [/SamsungBrowser\/([\d.]+)/, 'Samsung Internet'],
      [/Firefox\/([\d.]+)/, 'Firefox'], [/CriOS\/([\d.]+)/, 'Chrome'], [/FxiOS\/([\d.]+)/, 'Firefox'],
      [/Chrome\/([\d.]+)/, 'Chrome'], [/Version\/([\d.]+).*Safari/, 'Safari']
    ].find(pair => pair[0].test(ua));
    if(!hit) return 'Unknown browser';
    const m = ua.match(hit[0]);
    return (hit[1] + ' ' + ((m && m[1]) || '').split('.')[0]).trim();
  }

  function accessOS(){
    const ua = navigator.userAgent || '';
    // iPadOS reports itself as a Mac, and the touch-point count is the only thing that gives it
    // away — checked before userAgentData/the Mac rule for exactly that reason
    if(/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPadOS';
    const uad = navigator.userAgentData;
    if(uad && uad.platform && uad.platform !== 'Unknown') return uad.platform;
    if(/iPhone|iPod/.test(ua)) return 'iOS';
    if(/Android/.test(ua)) return 'Android';
    if(/Windows/.test(ua)) return 'Windows';
    if(/Macintosh|Mac OS X/.test(ua)) return 'macOS';
    if(/CrOS/.test(ua)) return 'ChromeOS';
    if(/Linux/.test(ua)) return 'Linux';
    return 'Unknown OS';
  }

  function accessDeviceType(){
    const ua = navigator.userAgent || '';
    if(/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) || /Tablet/.test(ua)) return 'tablet';
    const uad = navigator.userAgentData;
    if(uad && typeof uad.mobile === 'boolean') return uad.mobile ? 'phone' : 'desktop';
    return /Mobi|iPhone|iPod|Android/.test(ua) ? 'phone' : 'desktop';
  }
  const ACCESS_TYPE_ICON = { phone:'📱', tablet:'📲', desktop:'🖥️' };

  function detectAccessDevice(){
    const scr = window.screen || {};
    const standalone = !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || !!navigator.standalone;
    let tz = '';
    try{ tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }catch(e){ /* ancient browser */ }
    const dev = {
      browser: accessBrowser(),
      os: accessOS(),
      type: accessDeviceType(),
      screen: (scr.width && scr.height) ? (scr.width + '×' + scr.height) : '',
      standalone: standalone,
      lang: navigator.language || '',
      tz: tz,
      // where it was served FROM, which is a second sense of "where": the same data can be opened
      // from a local file, the dev server, and the deployed page
      host: (location.protocol === 'file:') ? 'local file' : (location.hostname || '')
    };
    /* What counts as "the same device" for session-merging. Screen size is in, since a phone and a
       desktop running the same browser build would otherwise collapse into one row. The browser
       VERSION is deliberately out — a background update mid-session must not split the sitting in
       two — which is why only the name is taken here. */
    dev.fp = [dev.browser.replace(/\s[\d.]+$/, ''), dev.os, dev.type, dev.screen, dev.tz, dev.host,
      standalone ? 'app' : 'web'].join('|');
    return dev;
  }

  /* ---- geo lookup ---- */
  async function fetchAccessGeo(){
    for(const src of ACCESS_GEO_SOURCES){
      try{
        const ctrl = new AbortController();
        const t = setTimeout(()=>ctrl.abort(), ACCESS_GEO_TIMEOUT_MS);
        let res;
        try{ res = await fetch(src.url, { signal: ctrl.signal, cache:'no-store' }); }
        finally{ clearTimeout(t); }
        if(!res.ok) continue;
        const norm = src.read(await res.json());
        if(norm) return norm;
      }catch(e){ /* offline, blocked, or over quota — fall through to the next service */ }
    }
    return null;
  }

  /* ---- recording ----
     Runs once per page load, from renderAll(). The device half is synchronous and always lands; the
     location half arrives later and is attached to whatever entry this load ended up on. */
  let accessRecorded = false;      // this page load
  let accessCurrent = null;        // the entry this load is writing to
  let accessBumpUndo = null;       // enough to un-bump if the geo lookup says we're on a new network

  function newAccessEntry(dev, now){
    const e = { id:uid(), firstAt:now, lastAt:now, visits:1, fp:dev.fp, device:dev, net:null };
    state.access.log.unshift(e);
    if(state.access.log.length > ACCESS_LOG_CAP) state.access.log.length = ACCESS_LOG_CAP;
    return e;
  }

  function recordAppAccess(){
    if(accessRecorded) return;
    accessRecorded = true;
    ensureAccessState();
    if(state.access.enabled === false) return;

    const dev = detectAccessDevice();
    const now = Date.now();
    const cur = state.access.log[0];
    const continues = cur && cur.fp === dev.fp && (now - (cur.lastAt || 0)) < ACCESS_SESSION_GAP_MS;

    let worthSaving;
    if(continues){
      accessBumpUndo = { entry: cur, lastAt: cur.lastAt, visits: cur.visits };
      worthSaving = (now - cur.lastAt) > ACCESS_BUMP_MIN_MS;
      cur.lastAt = now;
      cur.visits = (cur.visits || 0) + 1;
      cur.device = dev;   // refresh: the browser version moves under an unchanged fingerprint
      accessCurrent = cur;
    } else {
      accessBumpUndo = null;
      accessCurrent = newAccessEntry(dev, now);
      worthSaving = true;
    }
    if(worthSaving) save();
    renderAccessLog();

    if(state.access.geo === false) return;
    fetchAccessGeo().then(net => {
      if(!net || !accessCurrent) return;
      if(state.access.enabled === false) return;   // switched off while the lookup was in flight
      const prev = accessCurrent.net;
      if(accessBumpUndo && prev && prev.ip && prev.ip !== net.ip){
        // same device, different network — that's a new place, so hand back the bump taken from the
        // old entry and start a row of its own
        accessBumpUndo.entry.lastAt = accessBumpUndo.lastAt;
        accessBumpUndo.entry.visits = accessBumpUndo.visits;
        accessBumpUndo = null;
        accessCurrent = newAccessEntry(accessCurrent.device, Date.now());
      } else if(prev && prev.ip === net.ip && prev.city === net.city){
        return;   // nothing changed — don't spend a write on it
      }
      accessCurrent.net = net;
      save();
      renderAccessLog();
    });
  }

  /* ---- rendering ---- */
  function accessPlaceText(net){
    if(!net) return '';
    return [net.city, net.region, net.country].filter(Boolean)
      .filter((v,i,a)=>a.indexOf(v)===i)   // "Singapore, Singapore" is a real answer from these APIs
      .join(', ');
  }
  // "Today 3:42 PM" / "Yesterday 9:10 AM" / "Mar 4, 2026 9:10 AM" — the recent rows are the ones
  // being scanned, and a bare date makes exactly those the hardest to read
  function accessWhen(ts){
    if(!ts) return '';
    const time = new Date(ts).toLocaleTimeString(undefined, { hour:'numeric', minute:'2-digit' });
    const day = localDateStr(new Date(ts));
    if(day === localDateStr(new Date())) return 'Today ' + time;
    if(day === localDateStr(new Date(Date.now() - 86400000))) return 'Yesterday ' + time;
    return fmtDate(ts) + ' ' + time;
  }

  let accessShowAll = false;
  function renderAccessLog(){
    const list = el('accessList'); if(!list) return;
    ensureAccessState();
    const log = state.access.log;
    const on = state.access.enabled !== false;

    document.querySelectorAll('#accessToggle [data-access]').forEach(b=>{
      b.classList.toggle('active', (b.dataset.access === 'on') === on);
    });
    document.querySelectorAll('#accessGeoToggle [data-accessgeo]').forEach(b=>{
      b.classList.toggle('active', (b.dataset.accessgeo === 'on') === (state.access.geo !== false));
    });
    // the location switch is a setting on a feature that's off — hide it rather than offer a
    // control that changes nothing
    const geoRow = el('accessGeoRow');
    if(geoRow) geoRow.style.display = on ? '' : 'none';

    const sum = el('accessSummary');
    if(sum){
      const devices = new Set(log.map(e=>e.fp)).size;
      const places = new Set(log.map(e=>accessPlaceText(e.net)).filter(Boolean)).size;
      sum.textContent = log.length
        ? log.length + (log.length===1?' session':' sessions')
          + ' · ' + devices + (devices===1?' device':' devices')
          + (places ? ' · ' + places + (places===1?' place':' places') : '')
        : '';
      sum.style.display = log.length ? '' : 'none';
    }

    const empty = el('accessEmpty');
    if(empty){
      empty.style.display = log.length ? 'none' : 'block';
      empty.textContent = on ? 'Nothing logged yet — this session will appear here.' : 'Logging is off, so nothing new is being recorded.';
    }

    const shown = accessShowAll ? log : log.slice(0, ACCESS_ROWS_COLLAPSED);
    list.innerHTML = shown.map(e=>{
      const d = e.device || {};
      const place = accessPlaceText(e.net);
      const bits = [d.os, d.type ? d.type.charAt(0).toUpperCase()+d.type.slice(1) : '',
        d.standalone ? 'Installed app' : '', d.screen, d.host].filter(Boolean).join(' · ');
      const meta = [
        place || (state.access.geo === false ? 'Location lookup off' : 'Location unavailable'),
        (e.net && e.net.ip) || '',
        (e.net && e.net.org) || ''
      ].filter(Boolean).join(' · ');
      const visits = (e.visits||1) > 1 ? ' · ' + e.visits + ' visits' : '';
      return '<div class="acc-row'+(e === accessCurrent ? ' is-current' : '')+'">'
        + '<div class="acc-icon" aria-hidden="true">'+(ACCESS_TYPE_ICON[d.type] || '💻')+'</div>'
        + '<div class="acc-body">'
        +   '<div class="acc-head">'+escapeHtml(d.browser || 'Unknown browser')
        +     (e === accessCurrent ? '<span class="acc-pill">This device</span>' : '')
        +   '</div>'
        +   '<div class="acc-sub">'+escapeHtml(bits)+'</div>'
        +   '<div class="acc-sub acc-place">'+escapeHtml(meta)+'</div>'
        + '</div>'
        + '<div class="acc-when">'+escapeHtml(accessWhen(e.lastAt) + visits)+'</div>'
        + '</div>';
    }).join('');

    const more = el('accessMoreBtn');
    if(more){
      more.style.display = log.length > ACCESS_ROWS_COLLAPSED ? '' : 'none';
      more.textContent = accessShowAll ? 'Show fewer' : ('Show all ' + log.length);
    }
    const clear = el('accessClearBtn');
    if(clear) clear.style.display = log.length ? '' : 'none';
  }

  /* Wiring. Delegated off the card and wired once, the settings.js pattern — renderAccessLog()
     rebuilds the rows on every call, so per-row listeners would be re-attached each time. */
  function initAccessSettings(){
    const card = el('accessCard'); if(!card || card.dataset.wired) return;
    card.dataset.wired = '1';
    card.addEventListener('click', e=>{
      const onOff = e.target.closest('#accessToggle [data-access]');
      if(onOff){
        ensureAccessState();
        state.access.enabled = onOff.dataset.access === 'on';
        save(); renderAccessLog();
        // switching it back on mid-session should record this visit, not wait for a reload
        if(state.access.enabled && !accessCurrent){ accessRecorded = false; recordAppAccess(); }
        return;
      }
      const geo = e.target.closest('#accessGeoToggle [data-accessgeo]');
      if(geo){
        ensureAccessState();
        state.access.geo = geo.dataset.accessgeo === 'on';
        save(); renderAccessLog();
        // turning lookups on with a session already recorded: fill this row in now rather than
        // leaving the current visit as the one row with no location on it
        if(state.access.geo && accessCurrent && !accessCurrent.net){
          fetchAccessGeo().then(net=>{ if(net && accessCurrent){ accessCurrent.net = net; save(); renderAccessLog(); } });
        }
        return;
      }
      if(e.target.closest('#accessMoreBtn')){ accessShowAll = !accessShowAll; renderAccessLog(); return; }
      if(e.target.closest('#accessClearBtn')){
        if(!window.confirm('Clear the whole access history? The session you’re in is logged again straight away.')) return;
        ensureAccessState();
        state.access.log = [];
        accessShowAll = false;
        accessCurrent = null;
        accessBumpUndo = null;
        accessRecorded = false;
        recordAppAccess();   // saves and re-renders
        if(state.access.enabled === false){ save(); renderAccessLog(); }
      }
    });
  }
