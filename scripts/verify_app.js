#!/usr/bin/env node
/**
 * Tier 1 gate for Shrink Ray — no browser needed.
 *
 * Lifts the DOM-free CORE out of index.html and asserts the numbers, then runs static
 * assertions over the page itself (offline-safety, plain-language/accessibility rules).
 *
 *   node scripts/verify_app.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

let pass = 0;
const failures = [];

function ok(label, condition, detail) {
  if (condition) { pass++; console.log('  ok   ' + label + (detail ? '   [' + detail + ']' : '')); }
  else { failures.push(label); console.log('  FAIL ' + label + (detail ? '   [' + detail + ']' : '')); }
}
function eq(label, actual, expected) { ok(label, actual === expected, 'got ' + JSON.stringify(actual)); }
function near(label, actual, expected, tol) {
  ok(label, Math.abs(actual - expected) <= (tol === undefined ? 1 : tol), 'got ' + actual + ' (want ~' + expected + ')');
}
function section(name) { console.log('\n' + name); }

/* ── Extract the tested core ── */
const coreMatch = html.match(/\/\* CORE-START \*\/([\s\S]*?)\/\* CORE-END \*\//);
ok('CORE markers present in index.html', !!coreMatch);
if (!coreMatch) { console.log('\nCannot continue without the core block.'); process.exit(1); }

const coreSrc = coreMatch[1];
/* Strip comments before the isolation check: the block's own header explains what it must
   not contain, and matching that comment tells you nothing about the code. */
const coreCode = coreSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

section('Core isolation (the Node tier can only test what has no DOM in it)');
const leak = coreCode.match(/\b(document|window|canvas|fetch)\b/);
ok('core code has no document/window/canvas/fetch', !leak,
   leak ? 'leak: "' + leak[0] + '"' : coreCode.split('\n').filter(function (l) { return l.trim(); }).length + ' code lines, comment-free');
ok('the core block is a real, substantial module (not a stub)',
   coreCode.split('\n').filter(function (l) { return l.trim(); }).length > 80,
   coreCode.split('\n').filter(function (l) { return l.trim(); }).length + ' lines');
const Core = new Function(coreSrc + '\nreturn Core;')();
ok('Core exported', !!Core && typeof Core === 'object');

/* ── Presets ── */
section('Presets (plain language, sane numbers)');
eq('three presets', Core.PRESETS.length, 3);
eq('default preset is the safest one', Core.preset('nonsense-id').id, 'email');
Core.PRESETS.forEach(function (p) {
  ok('preset "' + p.id + '" has a title and a description', !!p.title && p.desc.length > 40);
  ok('preset "' + p.id + '" maxEdge is 0 or 800..4000', p.maxEdge === 0 || (p.maxEdge >= 800 && p.maxEdge <= 4000), 'maxEdge=' + p.maxEdge);
  ok('preset "' + p.id + '" quality in 0.5..0.95', p.quality >= 0.5 && p.quality <= 0.95, 'q=' + p.quality);
  ok('preset "' + p.id + '" format is a real mime', ['image/jpeg', 'image/png', 'image/webp'].indexOf(p.format) >= 0, p.format);
});
eq('email preset is JPEG (opens anywhere)', Core.preset('email').format, 'image/jpeg');
eq('tiny preset is WebP (smallest)', Core.preset('tiny').format, 'image/webp');
eq('best preset keeps original size', Core.preset('best').maxEdge, 0);
ok('no jargon in preset text (no "WebP/HEIC/AVIF/algorithm" in descriptions)',
   !Core.PRESETS.some(function (p) { return /algorithm|codec|resampl/i.test(p.desc); }));

/* ── targetDims ── */
section('Resizing maths (the whole point — format alone can GROW a file)');
const d1 = Core.targetDims(4000, 3000, 1600);
eq('4000x3000 -> longest side 1600', d1.width + 'x' + d1.height, '1600x1200');
ok('flagged as resized', d1.resized === true);
const d2 = Core.targetDims(4000, 3000, 1600);
near('aspect ratio kept', d2.width / d2.height, 4000 / 3000, 0.01);
const d3 = Core.targetDims(3000, 4000, 1600);
eq('portrait 3000x4000 -> 1200x1600', d3.width + 'x' + d3.height, '1200x1600');
const d4 = Core.targetDims(800, 600, 1600);
eq('already-small photo untouched', d4.width + 'x' + d4.height, '800x600');
ok('not flagged as resized', d4.resized === false);
const d5 = Core.targetDims(5000, 3000, 0);
eq('maxEdge 0 keeps the original size', d5.width + 'x' + d5.height, '5000x3000');
const d6 = Core.targetDims(10000, 10, 1600);
ok('extreme panorama never produces a zero side or NaN',
   d6.width === 1600 && d6.height >= 1 && Number.isFinite(d6.height), d6.width + 'x' + d6.height);
const d7 = Core.targetDims(0, 0, 1600);
ok('degenerate input does not throw or produce NaN', d7.width === 0 && d7.height === 0);
const d8 = Core.targetDims(16385, 16385, 1600);
eq('very large photo scales down', d8.width, 1600);

/* ── Naming and formatting ── */
section('Filenames and human-readable sizes');
eq('png -> jpg keeps the name', Core.swapExt('holiday.png', 'image/jpeg'), 'holiday.jpg');
eq('HEIC -> webp keeps the name', Core.swapExt('IMG_1234.HEIC', 'image/webp'), 'IMG_1234.webp');
eq('no extension gets one', Core.swapExt('photo', 'image/png'), 'photo.png');
eq('multi-dot name only swaps the last part', Core.swapExt('scan.final.v2.jpg', 'image/webp'), 'scan.final.v2.webp');

eq('bytes', Core.formatBytes(999), '999 B');
eq('kilobytes', Core.formatBytes(2048), '2.0 KB');
eq('tens of KB lose the decimal', Core.formatBytes(45056), '44 KB');
eq('megabytes', Core.formatBytes(3 * 1024 * 1024), '3.00 MB');
eq('big megabytes', Core.formatBytes(40 * 1024 * 1024), '40.0 MB');
eq('zero is handled', Core.formatBytes(0), '0 B');

/* ── Format choice ── */
section('Output format choice');
eq('auto follows the preset', Core.outputMime('auto', 'image/jpeg'), 'image/jpeg');
eq('an explicit choice wins', Core.outputMime('image/png', 'image/jpeg'), 'image/png');
ok('JPEG output gets a white base (transparency would otherwise go black)', Core.needsWhiteBase('image/jpeg') === true);
ok('WebP keeps transparency', Core.needsWhiteBase('image/webp') === false);
eq('ext for webp', Core.extFor('image/webp'), 'webp');
eq('unknown mime falls back to jpg', Core.extFor('image/avif'), 'jpg');

/* ── File sniffing ── */
section('Recognising files by their first bytes');
function bytes(arr) { return Uint8Array.from(arr); }
function ascii(s) { return Array.prototype.map.call(s, function (c) { return c.charCodeAt(0); }); }
ok('jpeg sniffed', Core.sniff(bytes([0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46, 0x49, 0x46, 0, 1])) === 'jpeg');
ok('png sniffed', Core.sniff(bytes([0x89].concat(ascii('PNG'), [0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13]))) === 'png');
ok('gif sniffed', Core.sniff(bytes(ascii('GIF89a').concat([1, 0, 1, 0, 0x80, 0, 0]))) === 'gif');
ok('bmp sniffed', Core.sniff(bytes(ascii('BM').concat([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))) === 'bmp');
ok('webp sniffed', Core.sniff(bytes(ascii('RIFF').concat([0x24, 0, 0, 0], ascii('WEBP'), [0, 0, 0, 0]))) === 'webp');
ok('a name with a non-image ending gets the extension added, not swapped',
   Core.swapExt('my.photo.2024', 'image/jpeg') === 'my.photo.2024.jpg', Core.swapExt('my.photo.2024', 'image/jpeg'));
ok('re-saving an already-jpg name does not double the ending',
   Core.swapExt('holiday.jpg', 'image/jpeg') === 'holiday.jpg', Core.swapExt('holiday.jpg', 'image/jpeg'));
const heic = bytes([0, 0, 0, 0x18].concat(ascii('ftypmif1'), [0, 0, 0, 0]));
ok('iPhone HEIC sniffed (mif1 brand)', Core.sniff(heic) === 'heic');
const heic2 = bytes([0, 0, 0, 0x18].concat(ascii('ftypheic'), [0, 0, 0, 0]));
ok('iPhone HEIC sniffed (heic brand)', Core.sniff(heic2) === 'heic');
ok('AVIF sniffed separately', Core.sniff(bytes([0, 0, 0, 0x1C].concat(ascii('ftypavif'), [0, 0, 0, 0]))) === 'avif');
ok('TIFF sniffed', Core.sniff(bytes([0x49, 0x49, 0x2A, 0, 8, 0, 0, 0, 0, 0, 0, 0])) === 'tiff');
ok('a PDF is NOT a photo', Core.looksLikePhoto(bytes(ascii('%PDF-1.4\n%').concat([0, 0, 0, 0]))) === false);
ok('a HEIC IS a photo (so we can explain, not ignore)', Core.looksLikePhoto(heic) === true);
ok('a short/garbage file is not a photo', Core.looksLikePhoto(bytes([1, 2, 3])) === false);

/* ── CRC + ZIP ── */
section('Zip writer (no library, must be a real .zip)');
const crcVector = new TextEncoder().encode('123456789');
eq('crc32 matches the standard check value 0xCBF43926', Core.crc32(crcVector).toString(16), 'cbf43926');
if (typeof zlib.crc32 === 'function') {
  const probe = new TextEncoder().encode('shrink ray independent crc cross-check');
  eq('crc32 agrees with Node zlib.crc32', Core.crc32(probe), zlib.crc32(probe));
}

(async function () {
  const enc = new TextEncoder();
  const a = enc.encode('hello zip '.repeat(300));
  const b = enc.encode('second entry');
  const zip = await Core.buildZip([{ name: 'one.txt', data: a }, { name: 'two.txt', data: b }]);

  eq('starts with the local file header signature', String.fromCharCode(zip[0], zip[1], zip[2], zip[3]), 'PK\u0003\u0004');

  // parse the archive ourselves rather than trusting the writer that made it
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const entries = [];
  let p = 0;
  while (p + 30 <= zip.length && dv.getUint32(p, true) === 0x04034b50) {
    const method = dv.getUint16(p + 8, true);
    const crc = dv.getUint32(p + 14, true);
    const csize = dv.getUint32(p + 18, true);
    const usize = dv.getUint32(p + 22, true);
    const nlen = dv.getUint16(p + 26, true);
    const name = Buffer.from(zip.buffer, zip.byteOffset + p + 30, nlen).toString('utf8');
    const data = zip.subarray(p + 30 + nlen, p + 30 + nlen + csize);
    entries.push({ name: name, method: method, crc: crc, csize: csize, usize: usize, data: Buffer.from(data) });
    p += 30 + nlen + csize;
  }
  eq('two entries parsed back out', entries.length, 2);
  eq('first entry name', entries[0].name, 'one.txt');
  eq('second entry name', entries[1].name, 'two.txt');
  eq('stored (method 0) so already-compressed photos are not re-compressed', entries[0].method, 0);
  eq('declared size matches real payload', entries[0].usize, a.length);
  ok('payload is byte-identical', entries[0].data.compare(Buffer.from(a)) === 0);
  ok('payload 2 is byte-identical', entries[1].data.compare(Buffer.from(b)) === 0);
  eq('crc in the header matches the payload', entries[0].crc, zlib.crc32 ? zlib.crc32(Buffer.from(a)) : Core.crc32(a));
  const eocd = zip.length >= 22 ? new DataView(zip.buffer, zip.byteOffset + zip.length - 22, 22) : null;
  ok('ends with a valid end-of-central-directory record', !!eocd && eocd.getUint32(0, true) === 0x06054b50);
  eq('central directory says 2 entries', eocd.getUint16(10, true), 2);
  ok('zip is bigger than its payloads (headers present)', zip.length > a.length + b.length, zip.length + ' bytes');
  const empty = await Core.buildZip([]);
  eq('an empty zip is exactly 22 bytes', empty.length, 22);
  eq('zip filename is dated', /^smaller-photos-\d{4}-\d{2}-\d{2}\.zip$/.test(Core.zipName(new Date(2026, 9, 12))), true);

  /* ── Summary wording ── */
  section('Plain-language summary');
  const s1 = Core.summarize([
    { ok: true, beforeBytes: 10 * 1024 * 1024, afterBytes: 1024 * 1024 },
    { ok: true, beforeBytes: 10 * 1024 * 1024, afterBytes: 1024 * 1024 }
  ]);
  eq('90% saving computed', s1.savedPct, 90);
  ok('headline says % smaller', /90% smaller/.test(s1.headline), s1.headline);
  ok('plural wording for 2 photos', /2 photos are/.test(s1.headline), s1.headline);
  ok('sub line shows a before and an after', /became/.test(s1.sub) && /saved/.test(s1.sub), s1.sub);
  const s2 = Core.summarize([{ ok: true, beforeBytes: 400000, afterBytes: 400000 }]);
  ok('singular wording for 1 photo', /photo is/.test(s2.headline), s2.headline);
  ok('no-growth case is stated honestly, not as a win', /already as small as they get/.test(s2.sub), s2.sub);
  const s3 = Core.summarize([]);
  ok('nothing changed case does not claim a saving', /Nothing was changed/.test(s3.headline), s3.headline);
  const s4 = Core.summarize([{ ok: false, beforeBytes: 0, afterBytes: 0 }, { ok: true, beforeBytes: 100, afterBytes: 50 }]);
  eq('failed files are excluded from the totals', s4.count, 1);

  section('Concurrency (fast without exhausting an older machine)');
  eq('8 cores, 30 photos -> 4 at a time', Core.pickConcurrency(8, 30), 4);
  eq('16 cores stays at 4', Core.pickConcurrency(16, 30), 4);
  eq('2 cores -> 1 at a time', Core.pickConcurrency(2, 30), 1);
  eq('unknown cores assumes 4 and leaves one free -> 3', Core.pickConcurrency(undefined, 30), 3);
  ok('concurrency always leaves at least one core for the page to stay responsive',
     Core.pickConcurrency(1, 30) === 1 && Core.pickConcurrency(4, 30) === 3, '1 core->' + Core.pickConcurrency(1, 30) + ', 4 cores->' + Core.pickConcurrency(4, 30));
  eq('never more workers than photos', Core.pickConcurrency(8, 2), 2);
  eq('empty list still yields 1', Core.pickConcurrency(8, 0), 1);

  /* ── Static page assertions ── */
  section('Page is self-contained and works with no internet');
  ok('no <script src>', !/<script[^>]+src=/i.test(html));
  ok('no <link rel=stylesheet> or @import', !/<link[^>]+stylesheet/i.test(html) && !/@import/i.test(html));
  ok('no fetch(', !/\bfetch\s*\(/.test(html));
  ok('no XMLHttpRequest', !/XMLHttpRequest/.test(html));
  ok('no external URL in the markup', !/(src|href)\s*=\s*["']https?:/i.test(html));
  ok('no CDN hostnames', !/(cdn|unpkg|jsdelivr|googleapis|cloudflare)/i.test(html));
  ok('no service worker (cannot run from file://)', !/serviceWorker/.test(html));
  ok('no advertising or analytics', !/(gtag|analytics|tracking|utm_)/i.test(html));

  section('Accessibility of the page itself');
  ok('language declared', /<html lang="en"/.test(html));
  ok('viewport meta present (works on phones)', /name="viewport"/.test(html));
  ok('page has a title', /<title>[^<]{10,}<\/title>/.test(html));
  ok('progress is announced to screen readers', /aria-live=/.test(html));
  ok('progress bar has progressbar role and values', /role="progressbar"/.test(html) && /aria-valuenow/.test(html));
  const fontSizes = (html.match(/font-size:\s*([\d.]+)rem/g) || []).map(function (m) { return parseFloat(m.match(/[\d.]+/)[0]); });
  const smallest = Math.min.apply(null, fontSizes);
  ok('no text smaller than 0.95rem (15px)', smallest >= 0.95, 'smallest = ' + smallest + 'rem, ' + fontSizes.length + ' sizes checked');
  const sorted = fontSizes.slice().sort(function (a, b) { return a - b; });
  const median = sorted[Math.floor(sorted.length / 2)];
  ok('the typical (median) text size is at least 1.1rem / 17.6px', median >= 1.1,
     'median = ' + median + 'rem over ' + sorted.length + ' sizes (smallest ' + sorted[0] + ', largest ' + sorted[sorted.length - 1] + ')');
  const big = fontSizes.filter(function (v) { return v >= 1.6; }).length;
  ok('several sizes are headline scale (>=1.6rem / 25.6px)', big >= 6, big + ' found');
  const bodySize = html.match(/body\s*\{[^}]*font-size:\s*([\d.]+)rem/);
  ok('body text is at least 1.2rem (19px)', !!bodySize && parseFloat(bodySize[1]) >= 1.2, bodySize ? bodySize[1] + 'rem' : 'not found');
  const giantPad = html.match(/\.giant\s*\{[^}]*padding:\s*([\d.]+)rem/);
  ok('primary buttons are at least 1.4rem of padding tall', !!giantPad && parseFloat(giantPad[1]) >= 1.4, giantPad ? giantPad[1] + 'rem' : 'not found');
  ok('focus ring defined for keyboard users', /:focus-visible/.test(html));
  ok('reduced-motion is not required (no animation loops)', !/requestAnimationFrame/.test(html));
  ok('drop zone is reachable by keyboard', /id="dropBox"[^>]*tabindex="0"/.test(html));
  ok('the file input accepts any image so HEIC can be explained rather than hidden', /accept="image\/\*"/.test(html));

  section('The two rules that came out of measuring the old app');
  ok('photos are downscaled, not just re-encoded', /targetDims\(realW, realH, settings\.maxEdge\)/.test(html));
  ok('output is never handed back bigger than the input', /Already as small as it gets/.test(html));
  ok('a mismatched output type is reported, not hidden', /does not make/.test(html));

  console.log('\n' + (failures.length
    ? failures.length + ' FAILED, ' + pass + ' passed'
    : 'all ' + pass + ' assertions passed'));
  process.exit(failures.length ? 1 : 0);
})().catch(function (e) { console.log('gate crashed: ' + e.message); process.exit(1); });
