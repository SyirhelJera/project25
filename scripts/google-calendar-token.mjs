// scripts/google-calendar-token.mjs
//
// One-time helper: gets the calendar.readonly REFRESH TOKEN that the google-calendar Edge
// Function needs (GOOGLE_CALENDAR_REFRESH_TOKEN). Run it, consent in the browser it opens, and
// it prints the token plus the exact `supabase secrets set` lines to paste.
//
//   node scripts/google-calendar-token.mjs
//
// Plain Node built-ins, no install — same rule as every other script in here.
//
// Why this exists alongside the OAuth Playground route in README.md: the Playground only works
// with a WEB-application OAuth client, because it needs its own URL registered as a redirect URI
// and Desktop-app clients have no such field. It also silently withholds the refresh token on a
// re-consent, which is the single most common way that route fails. This does a loopback flow
// instead — works with either client type, and passes prompt=consent so Google re-issues a
// refresh token EVERY time rather than only on the very first authorization.
//
// Nothing is written to disk. The client secret is read from stdin (so it stays out of your shell
// history), used once against Google, and dropped when the process exits.

import http from 'node:http';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

// Fixed, not ephemeral: a WEB-application client has to have this exact URI registered under
// "Authorised redirect URIs", and you can't register a port that changes every run. A Desktop-app
// client accepts any loopback port without registration, so the fixed choice costs it nothing.
// 8026 rather than 8025, which is scripts/serve.mjs's port — the app may well be running.
const PORT = 8026;
const REDIRECT_URI = `http://localhost:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

function ask(question){
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
  });
}

// Waits for Google to redirect back with ?code=… and hands that code over. Resolves exactly once,
// then the server is closed by the caller — this is a one-shot flow, not a service.
function waitForCode(server){
  return new Promise((resolve, reject) => {
    server.on('request', (req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      const code = url.searchParams.get('code');
      const err = url.searchParams.get('error');
      // Answer the browser before settling, so the tab shows something other than a dead socket.
      res.writeHead(err ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><meta charset="utf-8"><title>Project 25</title>' +
        '<body style="font:16px system-ui;padding:48px;max-width:34em;margin:0 auto">' +
        (err
          ? '<h2>Authorization was refused</h2><p>Google said: <code>' + escapeHtml(err) + '</code></p>'
          : '<h2>Done — you can close this tab.</h2><p>The refresh token has been printed in your terminal.</p>') +
        '</body>'
      );
      if (err) reject(new Error('Google returned "' + err + '"'));
      else if (code) resolve(code);
      else reject(new Error('The redirect carried no authorization code.'));
    });
    server.on('error', reject);
  });
}

// The browser is opened through the shell's own URL handler rather than by locating an executable
// (which is what valorant-login-window.mjs has to do, because that one needs a specific, isolated
// Chromium profile). Here any browser will do, so the default one is the right answer.
function openBrowser(url){
  try{
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }catch(_){ return false; }
}

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => (
  { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
));

async function main(){
  console.log('\nGoogle Calendar refresh token — one-time setup');
  console.log('─'.repeat(60));
  console.log('Before you start, in the Google Cloud project you use for this app:');
  console.log('  1. APIs & Services → Library → enable "Google Calendar API".');
  console.log('  2. APIs & Services → Credentials → open your OAuth 2.0 Client ID.');
  console.log('     · Type "Desktop app"      → nothing to change.');
  console.log('     · Type "Web application" → add this to Authorised redirect URIs:');
  console.log('         ' + REDIRECT_URI);
  console.log('─'.repeat(60) + '\n');

  // argv/env first so a re-run doesn't mean retyping the id; the SECRET is never taken from argv,
  // since that would put it in your shell history and in the process list.
  const clientId = (process.argv[2] || process.env.GOOGLE_CALENDAR_CLIENT_ID || await ask('Client ID: ')).trim();
  if (!clientId) throw new Error('A client ID is required.');
  const clientSecret = (await ask('Client secret (not echoed anywhere, not saved): ')).trim();
  if (!clientSecret) throw new Error('A client secret is required.');

  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', e => reject(
      e && e.code === 'EADDRINUSE'
        ? new Error('Port ' + PORT + ' is already in use — close whatever is on it and re-run.')
        : e
    ));
    server.listen(PORT, '127.0.0.1', resolve);
  });

  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    // access_type=offline is what makes a refresh token possible at all; prompt=consent is what
    // makes it arrive EVERY run. Without the second one Google issues a refresh token only on the
    // first-ever consent for this client+account+scope, and a re-run comes back with an access
    // token and no refresh token — the exact trap the Playground route falls into.
    access_type: 'offline',
    prompt: 'consent',
  });

  console.log('\nOpening your browser to sign in…');
  console.log('If it doesn’t open, paste this URL yourself:\n\n' + authUrl + '\n');
  console.log('You will probably see "Google hasn’t verified this app" — that’s expected for your');
  console.log('own unpublished client. Choose Advanced → Go to … (unsafe).\n');
  openBrowser(authUrl);

  let code;
  try{
    code = await waitForCode(server);
  } finally {
    server.close();
  }

  console.log('Got the authorization code, exchanging it…\n');
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    // Google's own error names the real problem far better than anything this script could infer,
    // so it's surfaced verbatim rather than translated.
    throw new Error('Google refused the exchange (' + resp.status + '): ' + (data.error_description || data.error || 'unknown error'));
  }
  if (!data.refresh_token) {
    throw new Error(
      'Google returned an access token but no refresh token. Revoke this app at\n' +
      '  https://myaccount.google.com/permissions\n' +
      'and run this again.'
    );
  }

  console.log('─'.repeat(60));
  console.log('Refresh token:\n');
  console.log('  ' + data.refresh_token + '\n');
  console.log('─'.repeat(60));
  console.log('Set it, then deploy:\n');
  console.log('  npx supabase secrets set GOOGLE_CALENDAR_REFRESH_TOKEN=' + data.refresh_token);
  console.log('  npx supabase secrets set GOOGLE_CALENDAR_CLIENT_ID=' + clientId);
  console.log('  npx supabase secrets set GOOGLE_CALENDAR_CLIENT_SECRET=<the secret you just typed>');
  console.log('  npx supabase functions deploy google-calendar\n');
  console.log('The two CLIENT lines are only needed if this client is NOT the one already in');
  console.log('GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET — a refresh token only works with the client');
  console.log('that issued it. Setting them anyway is harmless.\n');
  console.log('Treat the refresh token like a password: it grants read access to this calendar');
  console.log('until you revoke it at https://myaccount.google.com/permissions\n');
}

main().catch(err => {
  console.error('\n' + (err && err.message ? err.message : err) + '\n');
  process.exit(1);
});
