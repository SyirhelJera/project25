  /* ================= SESSION MUSIC ================= */

  /* ---------- background music for Play sessions (YouTube / YouTube Music playlist) ----------
     YouTube Music playlists *are* YouTube playlists: the `list=` id in a music.youtube.com link
     is the same id youtube.com serves, so one embedded YouTube IFrame player covers both with no
     API key, no OAuth and no build step. The API script is loaded lazily — only when a session
     actually starts with a playlist configured — so the app still opens instantly (and offline)
     for everyone who never sets one.

     Two limits come from YouTube itself; neither is a bug to fix here:
       - Auto-generated feeds have no embeddable playlist. Liked Music (LM), Watch Later (WL) and
         radio mixes (RD…/SR…) are rejected up front with a readable message instead of failing
         silently inside the iframe. Same for private playlists — YouTube reports that as an
         embed error (101/150) once the player loads.
       - Audio may only start from a user gesture. Pressing Play on a checklist *is* one, so a
         fresh session starts the music on its own; a session **resumed** on page load is not, so
         the playlist is only cued and the ▶ button waits for a click.

     The player div must stay in the layout (1px, transparent, behind the card) — display:none or
     detaching it suspends playback in some browsers. */

  let ytPlayer = null;       // YT.Player, alive only while a Play session is on screen
  let ytApiPromise = null;   // in-flight/settled load of the IFrame API script
  let musicStatusText = '';  // transient status/error line shown in the bar
  let musicStatusIsError = false; // errors need the full sentence, so they also open the ⚙ panel
  let musicShuffled = false; // setShuffle() only sticks once a playlist is actually loaded

  function sessionMusicCfg(){
    if(!state.sessionMusic) state.sessionMusic = { url:'', enabled:true, volume:35, shuffle:true, playlists:[] };
    if(!Array.isArray(state.sessionMusic.playlists)) state.sessionMusic.playlists = [];
    return state.sessionMusic;
  }

  const MUSIC_HINT_DEFAULT = 'Open the playlist in YouTube Music → ⋮ → Share → Copy link. It should look like music.youtube.com/playlist?list=…';

  const MUSIC_UNSUPPORTED = {
    LM: 'Liked Music can’t be embedded — save those songs to a normal playlist first',
    WL: 'Watch Later can’t be embedded — use a normal playlist',
    LL: 'Liked Videos can’t be embedded — use a normal playlist'
  };

  /* Accepts any link carrying a `list=` id (youtube.com, music.youtube.com, youtu.be) or a bare
     playlist id, and normalizes the id prefixes YouTube Music adds:
       VL…      library links (…/playlist?list=VLPLxxxx) — same playlist, prefix stripped
       RDAMPL…  "radio built from this playlist" — the real playlist id follows the prefix, which
                is what you get from Share while a *playlist* is playing
       RDCLAK…  YT Music's own curated playlists (also RDTMAK) — despite the RD, that IS the real
       RDTMAK…  playlist id and it embeds fine, so these are passed through untouched
     What's left after that is a per-song/per-account mix (RDAMVM…, RDMM…, RDEM…, SR… search
     radio) or an auto-feed (LM/WL/LL), and none of those exist as an embeddable playlist. */
  function parsePlaylistUrl(raw){
    const s = (raw||'').trim();
    if(!s) return { id:'', error:'' };
    let id = '';
    const m = s.match(/[?&]list=([^&#]+)/);
    if(m) id = decodeURIComponent(m[1]);
    else if(/^[A-Za-z0-9_-]{2,}$/.test(s)) id = s;
    if(!id) return { id:'', error:'That link has no playlist id in it — it needs a “list=” part. Open the playlist in YouTube Music and use its Share link.' };
    if(/^VL/.test(id)) id = id.slice(2);
    if(/^RDAMPL/.test(id)) id = id.slice(6);
    if(MUSIC_UNSUPPORTED[id]) return { id:'', error: MUSIC_UNSUPPORTED[id] };
    if(/^(RDCLAK|RDTMAK)/.test(id)) return { id, error:'' };
    if(/^(RD|SR)/.test(id)) return { id:'', error:'That’s a radio mix built around one song, not a playlist — YouTube won’t embed it. In YouTube Music open the playlist’s own page (⋮ → Share), and paste a link that looks like music.youtube.com/playlist?list=…' };
    return { id, error:'' };
  }

  function loadYouTubeIframeApi(){
    if(window.YT && window.YT.Player) return Promise.resolve();
    if(ytApiPromise) return ytApiPromise;
    ytApiPromise = new Promise((resolve, reject)=>{
      // the API calls one fixed global when it's ready — chain any existing one rather than
      // clobbering it, in case something else on the page ever wants the same hook
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function(){ if(typeof prev === 'function') prev(); resolve(); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.onerror = ()=>{ ytApiPromise = null; reject(new Error('iframe_api unreachable')); };
      document.head.appendChild(s);
    });
    return ytApiPromise;
  }

  /* Called from openPlayOverlay(). `fromGesture` is true when a click started this session, which
     is exactly when the browser will allow audio to start by itself. */
  function startSessionMusic(fromGesture){
    const cfg = sessionMusicCfg();
    musicStatusText = ''; musicStatusIsError = false;
    syncMusicSettingsInputs();
    renderSessionMusic();
    if(!cfg.enabled) return;
    const { id, error } = parsePlaylistUrl(cfg.url);
    if(error){ setMusicStatus(error, true); return; }
    if(!id) return;
    createMusicPlayer(id, !!fromGesture);
  }

  function createMusicPlayer(playlistId, autoplay){
    destroyMusicPlayer();
    musicShuffled = false;
    setMusicStatus('Loading playlist…');
    loadYouTubeIframeApi().then(()=>{
      // destroy() strips the target element, so hand the API a fresh div every time
      el('playMusicFrameWrap').innerHTML = '<div id="playMusicFrame"></div>';
      const vars = {
        listType: 'playlist',
        list: playlistId,
        autoplay: autoplay ? 1 : 0,
        controls: 0,
        disablekb: 1,
        playsinline: 1,
        rel: 0
      };
      // opened from file:// there is no real origin to hand the player (it'd be "null")
      if(/^https?:$/.test(location.protocol)) vars.origin = location.origin;
      /* Size drives audio quality, and it's the only lever that still works. YouTube picks the
         smallest rendition that covers the player's viewport, and the low ones carry a matching
         low-bitrate audio track — at 160x90 you get the 144p "tiny" stream with ~48kbps audio,
         which sounds awful. 640x360 lands on 360p, whose audio is ~128kbps. (setPlaybackQuality()
         is ignored by the player these days, so there's nothing to call instead.)

         The iframe keeps this viewport regardless of the 1px clipping on .play-music-frame — the
         wrapper only hides it visually, so this doesn't put anything on screen. Video frames we
         never show are the cost of decent audio; going higher would only buy more of those. */
      ytPlayer = new YT.Player('playMusicFrame', {
        height: '360', width: '640',
        playerVars: vars,
        events: {
          onReady: e=>{
            e.target.setVolume(sessionMusicCfg().volume);
            setMusicStatus(autoplay ? '' : 'Ready — press ▶');
            if(autoplay){ try{ e.target.playVideo(); }catch(err){ /* gesture refused; ▶ still works */ } }
          },
          onStateChange: e=>{
            if(e.data === YT.PlayerState.PLAYING){
              musicStatusText = ''; musicStatusIsError = false;
              const cfg = sessionMusicCfg();
              // shuffle can only be applied once the playlist itself has loaded, and re-applying
              // it on every track would reshuffle mid-session — so do it exactly once
              if(cfg.shuffle && !musicShuffled){
                musicShuffled = true;
                try{ e.target.setShuffle(true); }catch(err){}
              }
            }
            renderSessionMusic();
          },
          onError: e=>{
            const code = e && e.data;
            setMusicStatus(
              (code===101||code===150) ? 'YouTube won’t embed that playlist. If it’s private, set it to Public or Unlisted in YouTube Music (⋮ → Edit playlist → Privacy).' :
              (code===100) ? 'That playlist doesn’t exist or isn’t visible — check the link.' :
              // 153 isn't in YouTube's documented list (2/5/100/101/150) — it's the player refusing
              // an embed it can't attribute to an origin, which is exactly what a file:// page is:
              // no origin to pass, no Referer header sent. Nothing in here can work around it.
              (code===153) ? (location.protocol === 'file:'
                ? 'YouTube blocks embeds from a page opened straight off disk (error 153) — file:// has no origin for it to check. Serve the folder instead: run “node scripts/serve.mjs” in the project folder and open the http://localhost:8025 address it prints. Everything else in the app works the same.'
                : 'YouTube refused the embed (error 153) — it couldn’t verify this page’s origin. Reload; if it keeps happening, check that the page isn’t sending a no-referrer policy.') :
              'YouTube couldn’t play this playlist (error ' + code + ').',
              true
            );
          }
        }
      });
    }).catch(()=> setMusicStatus('Couldn’t reach YouTube — music is offline.', true));
  }

  function destroyMusicPlayer(){
    if(ytPlayer){
      try{ ytPlayer.destroy(); }catch(e){ /* already gone */ }
      ytPlayer = null;
    }
    const wrap = el('playMusicFrameWrap');
    if(wrap) wrap.innerHTML = '<div id="playMusicFrame"></div>';
  }

  // Stops playback outright — the session is over, so the music shouldn't outlive the overlay.
  function stopSessionMusic(){
    destroyMusicPlayer();
    musicStatusText = ''; musicStatusIsError = false;
    renderSessionMusic();
  }

  /* The one-line strip ellipsises anything long ("Radio mixes can’t be e…"), which is useless for
     a message whose whole point is telling you what to paste instead — so an error also opens the
     ⚙ panel and prints the full, wrapping sentence in the hint under the field. */
  function setMusicStatus(text, isError){
    musicStatusText = text;
    musicStatusIsError = !!isError;
    if(isError && text) el('playMusicSettings').style.display = '';
    renderSessionMusic();
  }

  function musicIsPlaying(){
    if(!ytPlayer || !ytPlayer.getPlayerState) return false;
    try{ return ytPlayer.getPlayerState() === 1; }catch(e){ return false; }
  }

  function currentMusicTitle(){
    if(!ytPlayer || !ytPlayer.getVideoData) return '';
    try{ return (ytPlayer.getVideoData() || {}).title || ''; }catch(e){ return ''; }
  }

  function renderSessionMusic(){
    const bar = el('playMusic');
    if(!bar) return;
    const cfg = sessionMusicCfg();
    el('playMusicToggle').textContent = musicIsPlaying() ? '⏸' : '▶';
    const label = el('playMusicTrack');
    const title = currentMusicTitle();
    label.textContent = !cfg.enabled ? 'Music off'
      : musicStatusIsError ? '⚠ Can’t play this playlist — see below'
      : musicStatusText ? musicStatusText
      : title ? title
      : cfg.url ? 'Paused'
      : 'No playlist yet — tap ⚙';
    label.title = musicStatusText || label.textContent;
    label.classList.toggle('play-music-track-warn', musicStatusIsError);
    if(musicStatusIsError) el('playMusicHint').textContent = musicStatusText;
  }

  /* ---------- saved playlists ----------
     state.sessionMusic.playlists = [{ id, name, url }], with `url` on the config itself pointing
     at whichever one is currently loaded (that's what marks a row active — no separate activeId to
     keep in sync). Switching mid-session rebuilds the player straight away: the ▶ click is itself
     the user gesture the browser wants, so the new playlist starts without a second tap. */
  function setMusicHint(text){ el('playMusicHint').textContent = text; }

  function renderSavedPlaylists(focusRecordId){
    const wrap = el('playMusicSaved');
    if(!wrap) return;
    const cfg = sessionMusicCfg();
    wrap.innerHTML = '';
    cfg.playlists.forEach(p=>{
      const row = document.createElement('div');
      row.className = 'play-music-saved-row' + (p.url === cfg.url ? ' active' : '');
      row.innerHTML = '<button class="play-music-saved-play" title="Switch to this playlist">▶</button>'
        + '<input class="play-music-saved-name" spellcheck="false" placeholder="Name">'
        + '<button class="play-music-saved-del" title="Remove from list">×</button>';
      // assigned, never interpolated into the markup above — escapeHtml() leaves double quotes
      // alone, so a name with one in it would break out of a value="…" attribute
      const nameInput = row.querySelector('.play-music-saved-name');
      nameInput.value = p.name || '';
      nameInput.title = p.url;
      nameInput.addEventListener('change', ()=>{
        p.name = nameInput.value.trim() || defaultPlaylistName(cfg.playlists.indexOf(p));
        nameInput.value = p.name;
        save();
      });
      row.querySelector('.play-music-saved-play').addEventListener('click', ()=> selectSavedPlaylist(p));
      row.querySelector('.play-music-saved-del').addEventListener('click', ()=>{
        if(!window.confirm('Remove “'+(p.name||'this playlist')+'” from the saved list?')) return;
        cfg.playlists = cfg.playlists.filter(x=>x !== p);
        save();
        renderSavedPlaylists();
      });
      wrap.appendChild(row);
      if(focusRecordId && p.id === focusRecordId){ nameInput.focus(); nameInput.select(); }
    });
  }

  function defaultPlaylistName(index){ return 'Playlist ' + (index + 1); }

  function selectSavedPlaylist(p){
    const cfg = sessionMusicCfg();
    const { id, error } = parsePlaylistUrl(p.url);
    cfg.url = p.url;
    cfg.enabled = true;
    save();
    syncMusicSettingsInputs();
    if(error){ setMusicStatus(error, true); return; }
    musicStatusText = ''; musicStatusIsError = false;
    createMusicPlayer(id, true);
  }

  el('playMusicSaveBtn').addEventListener('click', ()=>{
    const cfg = sessionMusicCfg();
    const url = el('playMusicUrl').value.trim();
    const { id, error } = parsePlaylistUrl(url);
    if(!id){ setMusicStatus(error || 'Paste a playlist link first, then press ＋.', true); return; }
    // same playlist pasted twice (a /watch link and a /playlist link resolve to one id) — don't
    // stack duplicates, just point at the copy that's already saved
    const existing = cfg.playlists.find(p=>parsePlaylistUrl(p.url).id === id);
    if(existing){
      cfg.url = existing.url;
      save();
      syncMusicSettingsInputs();
      setMusicHint('Already saved as “'+existing.name+'”.');
      return;
    }
    const rec = { id: uid(), name: defaultPlaylistName(cfg.playlists.length), url };
    cfg.playlists.push(rec);
    cfg.url = url;
    save();
    syncMusicSettingsInputs();
    renderSavedPlaylists(rec.id);   // focuses the new row's name so you can type over it
    setMusicHint('Saved — give it a name, or press ▶ to switch to it any time.');
  });

  // ---- controls ----
  el('playMusicToggle').addEventListener('click', ()=>{
    const cfg = sessionMusicCfg();
    if(!cfg.enabled){ cfg.enabled = true; save(); }
    if(ytPlayer && ytPlayer.getPlayerState){
      if(musicIsPlaying()) ytPlayer.pauseVideo(); else ytPlayer.playVideo();
      setTimeout(renderSessionMusic, 250);
      return;
    }
    // no player yet (session resumed on load, playlist just pasted, or an earlier error) — this
    // click is the user gesture the browser wanted, so build it and start straight away
    startSessionMusic(true);
  });

  el('playMusicNext').addEventListener('click', ()=>{
    if(!ytPlayer || !ytPlayer.nextVideo) return;
    try{ ytPlayer.nextVideo(); }catch(e){}
    setTimeout(renderSessionMusic, 400);
  });

  el('playMusicSettingsBtn').addEventListener('click', ()=>{
    const panel = el('playMusicSettings');
    const opening = panel.style.display === 'none';
    panel.style.display = opening ? '' : 'none';
    if(opening) syncMusicSettingsInputs();
  });

  el('playMusicVol').addEventListener('input', e=>{
    const v = parseInt(e.target.value, 10) || 0;
    sessionMusicCfg().volume = v;
    if(ytPlayer && ytPlayer.setVolume){ try{ ytPlayer.setVolume(v); }catch(err){} }
  });
  // dragging fires `input` continuously — only persist once the drag ends
  el('playMusicVol').addEventListener('change', ()=> save());

  // `input` (not just `change`) so a paste is judged the moment it lands — waiting for blur means
  // pasting a radio-mix link looks accepted until you click away
  el('playMusicUrl').addEventListener('input', e=>{
    const cfg = sessionMusicCfg();
    cfg.url = e.target.value.trim();
    const { id, error } = parsePlaylistUrl(cfg.url);
    musicStatusText = error || '';
    musicStatusIsError = !!error;
    renderSessionMusic();
    renderSavedPlaylists();   // the active-row highlight follows cfg.url
    setMusicHint(error || (id ? '✓ Playlist ' + id + ' — press ＋ to keep it' : MUSIC_HINT_DEFAULT));
  });

  el('playMusicUrl').addEventListener('change', e=>{
    const cfg = sessionMusicCfg();
    cfg.url = e.target.value.trim();
    save();
    const { id } = parsePlaylistUrl(cfg.url);
    // swap to the new playlist immediately if a session is running; the click that landed on this
    // field counts as the gesture, so it can start playing right away
    if(state.playSession && cfg.enabled && id) createMusicPlayer(id, true);
    // no usable id — drop the player, but leave the warning from the `input` handler standing
    // (stopSessionMusic() would clear it, so the field would look accepted on blur)
    else if(!id) destroyMusicPlayer();
    renderSessionMusic();
  });

  el('playMusicShuffle').addEventListener('change', e=>{
    sessionMusicCfg().shuffle = e.target.checked;
    save();
    if(ytPlayer && ytPlayer.setShuffle){ try{ ytPlayer.setShuffle(e.target.checked); }catch(err){} }
  });

  el('playMusicEnabled').addEventListener('change', e=>{
    const cfg = sessionMusicCfg();
    cfg.enabled = e.target.checked;
    save();
    if(!cfg.enabled) stopSessionMusic();
    else if(state.playSession) startSessionMusic(true);
    renderSessionMusic();
  });

  function syncMusicSettingsInputs(){
    const cfg = sessionMusicCfg();
    el('playMusicUrl').value = cfg.url || '';
    el('playMusicShuffle').checked = !!cfg.shuffle;
    el('playMusicEnabled').checked = !!cfg.enabled;
    el('playMusicVol').value = cfg.volume;
    renderSavedPlaylists();
    const { id, error } = parsePlaylistUrl(cfg.url);
    setMusicHint(error || (id ? '✓ Playlist ' + id : MUSIC_HINT_DEFAULT));
  }
