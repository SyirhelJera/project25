// scripts/pinterest-login.mjs
//
// Saves a Pinterest session by pasting its cookies, and verifies them before writing anything.
// This is the reliable path; scripts/pinterest-login-window.mjs is the convenient one. Both exist
// for the reason the Valorant pair does: the automated window is Chromium-only and can be beaten
// by a browser setup it wasn't expecting, and the answer to that must never be "no way in".
//
// Where to get the cookies (Chrome/Edge/Brave, signed in to pinterest.com):
//   F12 → Application → Storage → Cookies → https://www.pinterest.com
//   Copy the VALUE of `_pinterest_sess` and of `csrftoken`.
//
// Usage:
//   node scripts/pinterest-login.mjs
//   node scripts/pinterest-login.mjs --check      just test the saved session
//   node scripts/pinterest-login.mjs --forget     delete it
//
// The cookie is full account access, so it is written to scripts/.pinterest-session.json, which is
// gitignored. Never commit it and never paste it anywhere else.

import readline from 'node:readline';
import { saveSession, loadSession, deleteSession, getHomeFeed, verifySession, SESSION_FILE } from './pinterest-lib.mjs';

function ask(question, { hidden = false } = {}){
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (!hidden) { rl.question(question, a => { rl.close(); resolve(a.trim()); }); return; }
    // A session cookie is a credential; don't leave it on screen or in the scrollback.
    const onData = () => { rl.output.write(`\x1B[2K\x1B[200D${question}`); };
    rl.output.write(question);
    rl.input.on('data', onData);
    rl.question('', a => { rl.input.off('data', onData); rl.output.write('\n'); rl.close(); resolve(a.trim()); });
  });
}

async function check(){
  const s = loadSession();
  if (!s) { console.log('No session saved. Run this without --check to add one.'); return false; }
  process.stdout.write('Checking the saved session... ');
  try {
    const feed = await getHomeFeed({ wanted: 20 });
    console.log(`ok — read ${feed.total} pins from your home feed.`);
    feed.pins.slice(0, 5).forEach(p => console.log(`   · ${p.title || '(no title)'}`));
    return true;
  } catch (err) {
    console.log(`failed: ${err.message}`);
    return false;
  }
}

async function main(){
  const arg = (process.argv[2] || '').trim();

  if (arg === '--forget') {
    console.log(deleteSession() ? `Deleted ${SESSION_FILE}` : 'Nothing to delete.');
    return;
  }
  if (arg === '--check') { process.exit(await check() ? 0 : 1); }

  console.log('Paste your Pinterest cookies (F12 → Application → Cookies → https://www.pinterest.com).\n');
  const sess = await ask('_pinterest_sess: ', { hidden: true });
  if (!sess) { console.error('Nothing pasted — stopping.'); process.exit(1); }
  const csrf = await ask('csrftoken:       ');

  // Verified BEFORE it is written. Writing first and failing after is what left a signed-out jar
  // in the session file, which the app then reported as "expired" on every refresh while quietly
  // falling back to the public path.
  const jar = { _pinterest_sess: sess };
  if (csrf) jar.csrftoken = csrf;
  process.stdout.write('Checking those cookies... ');
  try {
    const total = await verifySession(jar);
    console.log(`ok — read ${total} pins from your home feed.`);
  } catch (err) {
    console.log('failed.');
    console.error(`\n${err.message}`);
    console.error('\nNothing was saved. Copy the VALUE (not the name) of BOTH cookies, from');
    console.error('www.pinterest.com, in a browser where you are signed in.');
    process.exit(1);
  }
  saveSession(jar);
  console.log(`\nSaved to ${SESSION_FILE}`);
}

main();
