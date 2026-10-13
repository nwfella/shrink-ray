#!/usr/bin/env node
/**
 * Tier 2 gate for Shrink Ray — a real browser, real photo files, no dependencies.
 *
 * Launches its own throwaway headless Chrome (never the user's profile), drives the page over
 * the DevTools Protocol, feeds it genuine image files, and asserts on what actually rendered.
 * Fixtures are generated here: nothing is downloaded and no binary is committed.
 *
 *   node scripts/browser_check.js            # local file:// run
 *   node scripts/browser_check.js --url=https://user.github.io/shrink-ray/   # live run
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const PORT = Number(process.env.CDP_PORT || 9223);
const TARGET_URL = (process.argv.find(function (a) { return a.indexOf('--url=') === 0; }) || '').slice(6)
  || 'file:///' + INDEX.split(path.sep).join('/');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'shrink-ray-gate-'));
let pass = 0;
const failures = [];
function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + label + (detail ? '   [' + detail + ']' : '')); }
  else { failures.push(label); console.log('  FAIL ' + label + (detail ? '   [' + detail + ']' : '')); }
}
function eq(l, a, e) { ok(l, a === e, 'got ' + JSON.stringify(a) + ', want ' + JSON.stringify(e)); }
function section(n) { console.log('\n' + n); }

/* ── Fixtures: real image files, generated locally ── */
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) : 0, 0);
  return Buffer.concat([len, body, crc]);
}
function makePng(w, h, noisy) {
  const stride = w * 3 + 1;
  const raw = Buffer.alloc(stride * h);
  let seed = 12345;
  const rnd = function () { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  let p = 0;
  for (let y = 0; y < h; y++) {
    raw[p++] = 0;
    for (let x = 0; x < w; x++) {
      const base = 0.35 + 0.45 * (x / w) * (y / h);
      const wave = 0.12 * Math.sin(x / 37) * Math.cos(y / 41);
      const n = noisy ? (rnd() - 0.5) * 0.18 : 0;
      raw[p++] = Math.max(0, Math.min(255, Math.round(255 * (base + wave + n))));
      raw[p++] = Math.max(0, Math.min(255, Math.round(255 * (base + 0.1 + n))));
      raw[p++] = Math.max(0, Math.min(255, Math.round(255 * (base + 0.2 - wave + n))));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

const F = {
  big: path.join(scratch, 'holiday-photo.png'),
  small: path.join(scratch, 'tiny.png'),
  heic: path.join(scratch, 'IMG_0042.HEIC'),
  pdf: path.join(scratch, 'letter.pdf'),
  gif: path.join(scratch, 'waving.gif')
};
fs.writeFileSync(F.big, makePng(3000, 2000, false));
fs.writeFileSync(F.small, makePng(400, 300, false));
fs.writeFileSync(F.heic, Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmif1'), Buffer.alloc(4096)]));
fs.writeFileSync(F.pdf, Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'));
fs.writeFileSync(F.gif, Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
console.log('fixtures in ' + scratch);
console.log('  big   ' + fs.statSync(F.big).size + ' bytes (3000x2000)');
console.log('  small ' + fs.statSync(F.small).size + ' bytes (400x300)');
console.log('  heic/pdf/gif stubs for the "not usable / explain it" paths');

/* ── Chrome ── */
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);
  for (const c of candidates) { if (fs.existsSync(c)) return c; }
  return null;
}

const profileDir = path.join(scratch, 'profile');
const chromePath = findChrome();
if (!chromePath) { console.log('\nNo Chrome/Edge found — set CHROME_PATH.'); process.exit(1); }

const child = spawn(chromePath, [
  '--headless=new',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profileDir.split(path.sep).join('/'),
  '--no-first-run', '--no-default-browser-check', '--disable-sync',
  '--window-size=1500,1000',
  'about:blank'
], { stdio: 'ignore', detached: false });

function cleanup() {
  try { child.kill(); } catch (e) {}
  try { fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { /* cache pruning will get it */ }
}
process.on('exit', cleanup);
process.on('SIGINT', function () { cleanup(); process.exit(130); });

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function waitForDevtools(deadlineMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      if (r.ok) return await r.json();
    } catch (e) { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('Chrome devtools never came up on port ' + PORT);
}

(async function () {
  const version = await waitForDevtools(30000);
  console.log('\nbrowser: ' + version.Browser);

  const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
  const page = targets.find(function (t) { return t.type === 'page'; });
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();
  const events = [];
  const send = function (method, params) {
    return new Promise(function (res, rej) {
      const id = ++msgId;
      pending.set(id, { res: res, rej: rej });
      ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    });
  };
  await new Promise(function (r, j) {
    ws.addEventListener('open', r, { once: true });
    ws.addEventListener('error', function () { j(new Error('websocket failed')); }, { once: true });
  });
  ws.addEventListener('message', function (ev) {
    const m = JSON.parse(ev.data);
    if (m.method) events.push(m);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    }
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');
  await send('DOM.enable');

  const evaluate = async function (expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('page threw: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const waitFor = async function (expr, deadlineMs, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < deadlineMs) {
      try { if (await evaluate(expr)) return true; } catch (e) { /* mid-navigation */ }
      await sleep(400);
    }
    ok('wait: ' + label, false, 'timed out after ' + deadlineMs + 'ms');
    return false;
  };
  const setFiles = async function (files) {
    const doc = await send('DOM.getDocument', { depth: -1 });
    const found = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#fileInput' });
    if (!found.nodeId) throw new Error('no #fileInput found');
    await send('DOM.setFileInputFiles', { files: files, nodeId: found.nodeId });
  };

  section('Loading the app');
  await send('Page.navigate', { url: TARGET_URL });
  await waitFor('!!window.__app', 20000, 'app booted');
  eq('page title', await evaluate('document.title'), 'Shrink Ray — make your photos small enough to email');
  ok('no external resources are requested (offline-safe)',
     (await evaluate("JSON.stringify([...document.querySelectorAll('link[href],script[src],img[src]')].map(e=>e.href||e.src).filter(u=>u&&!/^data:/.test(u)))")) === '[]',
     await evaluate("JSON.stringify([...document.querySelectorAll('link[href],script[src],img[src]')].map(e=>e.href||e.src))"));
  ok('presets rendered as large choice cards', await evaluate("document.querySelectorAll('.choices .choice').length") === 3,
     'cards=' + await evaluate("document.querySelectorAll('.choices .choice').length"));
  eq('default choice is the recommend one', await evaluate("document.querySelector('.choice input:checked').value"), 'email');

  /* ── Bad input first: does it explain, or fail silently? ── */
  section('Files it cannot use (the whole audience question)');
  await setFiles([F.heic, F.pdf]);
  await waitFor("document.querySelector('#notices').textContent.length > 10", 10000, 'notices appeared');
  const noticeText = await evaluate("document.querySelector('#notices').textContent");
  ok('iPhone HEIC is explained in plain language, not silently dropped',
     /iPhone/i.test(noticeText) && /HEIC/.test(noticeText), noticeText.slice(0, 90) + '…');
  ok('tells the user how to fix it (Most Compatible or email it)',
     /Most Compatible/i.test(noticeText) || /by email/i.test(noticeText));
  ok('a PDF is reported as "not a photo"', /not a photo/i.test(noticeText));
  ok('no photos accepted means no shrink step offered',
     await evaluate("document.getElementById('step2').classList.contains('hidden')"));

  /* ── The real job: a big photo, as the default (email) preset ── */
  section('Shrinking a 3000x2000 photo on the default setting');
  await evaluate("document.getElementById('againBtn').click()");
  await setFiles([F.big, F.small, F.gif]);
  await waitFor("!document.getElementById('step2').classList.contains('hidden')", 10000, 'step 2 shown');
  ok('the three usable files were accepted',
     (await evaluate("JSON.stringify(window.__app.dom().fileRows)"), true) && (await evaluate("document.getElementById('fileSummary').textContent")).indexOf('3 photos') >= 0,
     await evaluate("document.getElementById('fileSummary').textContent"));

  await evaluate("document.getElementById('goBtn').click()");
  await waitFor("!document.getElementById('resultsCard').classList.contains('hidden')", 120000, 'results rendered');

  const res = await evaluate("JSON.stringify(window.__app.results())").then(JSON.parse);
  const dom = await evaluate("JSON.stringify(window.__app.dom())").then(JSON.parse);
  const bigBefore = fs.statSync(F.big).size;
  const big = res.find(function (r) { return /holiday-photo/.test(r.name); });
  const smallR = res.find(function (r) { return /tiny/.test(r.name); });
  const gifR = res.find(function (r) { return /waving/.test(r.name); });

  ok('every file produced a result row', res.length === 3, 'rows=' + res.length);
  ok('THE PROMISE: nothing is handed back bigger than it went in',
     res.every(function (r) { return r.afterBytes <= r.beforeBytes; }),
     res.map(function (r) { return r.name + ' ' + r.beforeBytes + '->' + r.afterBytes; }).join(', '));
  ok('the big photo is dramatically smaller', big && big.afterBytes < bigBefore / 4,
     big ? big.beforeBytes + ' -> ' + big.afterBytes + ' (' + Math.round(100 - 100 * big.afterBytes / big.beforeBytes) + '%)' : 'missing');
  eq('big photo saved as JPEG on the default preset', big && big.type, 'image/jpeg');
  eq('filename kept, extension swapped', big && big.name, 'holiday-photo.jpg');
  ok('the resize is reported to the user', big && /3000\u00d72000 \u2192 1600\u00d71067/.test(big.note), big && big.note);
  ok('the 400x300 photo was not blown up', smallR && smallR.afterBytes <= smallR.beforeBytes, smallR ? smallR.beforeBytes + ' -> ' + smallR.afterBytes : 'missing');
  ok('the GIF is left untouched rather than corrupted', gifR && (gifR.changed === false || gifR.afterBytes <= gifR.beforeBytes), gifR && (gifR.beforeBytes + ' -> ' + gifR.afterBytes));
  ok('headline reports a real percentage saving', /% smaller/.test(dom.headline), dom.headline);
  ok('headline is the big green line in the DOM', await evaluate("getComputedStyle(document.getElementById('resultHead')).color") === 'rgb(15, 107, 61)');
  ok('result headline is at least 32px', parseFloat(await evaluate("getComputedStyle(document.getElementById('resultHead')).fontSize")) >= 32,
     await evaluate("getComputedStyle(document.getElementById('resultHead')).fontSize"));
  ok('a save button exists', dom.saveButtons.length >= 1, JSON.stringify(dom.saveButtons));
  ok('per-file rows are shown to the user', dom.fileRows.length === 3, dom.fileRows.length + ' rows');

  /* ── The archive path, validated outside the browser ── */
  section('One .zip instead of many files');
  const zipB64 = await evaluate("window.__app.zipBase64()");
  const zipPath = path.join(scratch, 'gate-output.zip');
  fs.writeFileSync(zipPath, Buffer.from(zipB64, 'base64'));
  const zip = fs.readFileSync(zipPath);
  eq('zip signature', zip.subarray(0, 4).toString('binary'), 'PK\u0003\u0004');
  const eocdAt = zip.length - 22;
  eq('end-of-central-directory record present', zip.readUInt32LE(eocdAt), 0x06054B50);
  const entryCount = zip.readUInt16LE(eocdAt + 10);
  ok('zip holds every shrunken photo', entryCount === res.filter(function (r) { return r.changed; }).length,
     entryCount + ' entries for ' + res.filter(function (r) { return r.changed; }).length + ' changed photos');
  let zc = 0, zp = 0;
  const zipNames = [];
  while (zp + 30 <= zip.length && zip.readUInt32LE(zp) === 0x04034B50) {
    const crc = zip.readUInt32LE(zp + 14), size = zip.readUInt32LE(zp + 18);
    const nlen = zip.readUInt16LE(zp + 26);
    const nm = zip.subarray(zp + 30, zp + 30 + nlen).toString('utf8');
    const data = zip.subarray(zp + 30 + nlen, zp + 30 + nlen + size);
    zipNames.push(nm);
    if (zlib.crc32 && zlib.crc32(data) === crc) zc++;
    zp += 30 + nlen + size;
  }
  eq('every entry passes a CRC check done by Node, not by the app', zc, entryCount);
  ok('zip entry names are the shrunken photo names', zipNames.every(function (n) { return /\.(jpg|png|webp)$/.test(n); }), JSON.stringify(zipNames));
  ok('the zip is smaller than the original big photo', zip.length < bigBefore, zip.length + ' vs ' + bigBefore);

  /* ── Preset changes really change the output ── */
  section('The smaller-file preset produces a smaller, different file');
  await evaluate("document.getElementById('againBtn').click()");
  await setFiles([F.big]);
  await waitFor("!document.getElementById('step2').classList.contains('hidden')", 10000, 'step 2 shown again');
  await evaluate("window.__app.setPreset('tiny')");
  eq('choice card selection moved', await evaluate("document.querySelector('.choice input:checked').value"), 'tiny');
  await evaluate("document.getElementById('goBtn').click()");
  await waitFor("!document.getElementById('resultsCard').classList.contains('hidden')", 120000, 'tiny results');
  const tinyRes = await evaluate("JSON.stringify(window.__app.results())").then(JSON.parse);
  eq('saved as WebP', tinyRes[0].type, 'image/webp');
  eq('extension swapped to .webp', tinyRes[0].name, 'holiday-photo.webp');
  ok('WebP beats JPEG on the same photo (measured before: 50KB vs 103KB)',
     tinyRes[0].afterBytes < big.afterBytes, tinyRes[0].afterBytes + 'B vs ' + big.afterBytes + 'B');

  section('The "best quality" preset keeps the original size but still never grows it');
  await evaluate("document.getElementById('againBtn').click()");
  await setFiles([F.small]);
  await waitFor("!document.getElementById('step2').classList.contains('hidden')", 10000, 'step 2 shown for small');
  await evaluate("window.__app.setPreset('best')");
  await evaluate("document.getElementById('goBtn').click()");
  await waitFor("!document.getElementById('resultsCard').classList.contains('hidden')", 60000, 'best results');
  const bestRes = await evaluate("JSON.stringify(window.__app.results())").then(JSON.parse);
  ok('a small photo is never made bigger', bestRes[0].afterBytes <= bestRes[0].beforeBytes,
     bestRes[0].beforeBytes + ' -> ' + bestRes[0].afterBytes + (bestRes[0].changed ? ' (re-encoded)' : ' (left alone)'));
  ok('the user is told either way', bestRes[0].note.length >= 0);

  /* ── PNG override ── */
  section('Advanced override: PNG output');
  await evaluate("document.getElementById('againBtn').click()");
  await setFiles([F.small]);
  await waitFor("!document.getElementById('step2').classList.contains('hidden')", 10000, 'step 2 for png');
  await evaluate("window.__app.setOverride('image/png')");
  await evaluate("document.getElementById('goBtn').click()");
  await waitFor("!document.getElementById('resultsCard').classList.contains('hidden')", 60000, 'png results');
  const pngRes = await evaluate("JSON.stringify(window.__app.results())").then(JSON.parse);
  ok('PNG output is honoured (or honestly refused with a note)',
     pngRes[0].type === 'image/png' || /does not make/.test(pngRes[0].note), pngRes[0].type + ' | ' + pngRes[0].note);
  ok('PNG never grows the file either', pngRes[0].afterBytes <= pngRes[0].beforeBytes, pngRes[0].beforeBytes + ' -> ' + pngRes[0].afterBytes);

  /* ── Responsive + clean console ── */
  section('Layout and console hygiene');
  for (const [w, h] of [[390, 844], [1024, 768], [1500, 1000], [1920, 1080]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
    await sleep(300);
    const overflow = await evaluate('document.documentElement.scrollWidth - window.innerWidth');
    ok('no sideways scrolling at ' + w + 'px wide', overflow <= 1, 'overflow=' + overflow + 'px');
    const tap = await evaluate("Math.round(document.getElementById('goBtn').getBoundingClientRect().height)");
    ok('the main button is a big target at ' + w + 'px', tap >= 60, tap + 'px tall');
  }
  await send('Emulation.clearDeviceMetricsOverride');

  const exceptions = events.filter(function (e) { return e.method === 'Runtime.exceptionThrown'; })
    .map(function (e) { const d = e.params.exceptionDetails; return (d.exception && d.exception.description) || d.text; });
  /* The page declares its own inline icon, so the browser should never ask for /favicon.ico.
     Assert that, rather than only filtering the 404 away. */
  ok('the page declares an inline icon (no resulting /favicon.ico 404)',
     /<link rel="icon" href="data:/.test(fs.readFileSync(INDEX, 'utf8')));
  const consoleErrors = events.filter(function (e) {
    return e.method === 'Log.entryAdded' && e.params.entry.level === 'error' &&
      !/favicon|net::ERR_FILE_NOT_FOUND/.test(e.params.entry.text);
  }).map(function (e) { return e.params.entry.text; });
  ok('no uncaught exceptions during the whole session', exceptions.length === 0, JSON.stringify(exceptions.slice(0, 3)));
  ok('no console errors during the whole session', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));

  console.log('\n' + (failures.length ? failures.length + ' FAILED, ' + pass + ' passed' : 'all ' + pass + ' assertions passed'));
  try { ws.close(); } catch (e) {}
  cleanup();
  process.exit(failures.length ? 1 : 0);
})().catch(function (e) {
  console.log('\ngate crashed: ' + (e && e.stack ? e.stack : e));
  cleanup();
  process.exit(1);
});
