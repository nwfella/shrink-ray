# 📸 Shrink Ray

**Make your photos small enough to email.**

One web page. No sign-up, no upload, no internet needed after it loads. Your photos
never leave your computer — everything happens inside the browser tab.

**→ Live: https://nwfella.github.io/shrink-ray/**

---

## Who it is for

People who are not computer people. Someone who has a photo that is "too big to send"
and needs it smaller, right now, without learning anything.

That audience sets every design rule in this project:

- **Big type.** Body text 20px, the result headline 33.6px, nothing smaller than 15px anywhere.
- **No jargon.** The choices are "Email friendly", "As small as possible", "Best quality".
  The words *WebP*, *HEIC*, *compression ratio* and *quality slider* never appear.
- **One obvious button** per step, 89px tall.
- **No dead ends.** Anything it cannot do, it says in plain English and explains the fix.
- **Answers, not numbers.** "Your 3 photos are 98% smaller — 2.58 MB became 51.6 KB."

## What it does

| | |
|---|---|
| Photos it can open | JPEG, PNG, WebP, GIF, BMP, TIFF — whatever your browser can decode |
| Photos it cannot open | iPhone **HEIC** (Windows browsers cannot decode it) — detected and explained, with the fix |
| Shrinking | Resizes the photo *and* re-encodes it, then checks the result |
| Saving | One photo → a normal "Save as…" dialog. Many photos → one folder, or a single `.zip` |
| Filenames | Original name kept, only the ending changes: `holiday.png` → `holiday.jpg` |
| Uploads | None. There is no server. Open the page with the network cable out and it still works |

## Measured behaviour

Numbers from `npm run verify:all` on Chrome 155, Windows 11 (Xeon-class 8-core / 16 GB):

| Input | Setting | Output | Saving |
|---|---|---|---|
| 3000×2000 PNG, 2.58 MB | Email friendly (default) | 1600×1067 JPEG, 51.6 KB | **98% smaller** |
| 3000×2000 PNG, 2.58 MB | As small as possible | 1600×1067 WebP, 23.1 KB | 99% smaller |
| 400×300 PNG, 114 KB | Email friendly | 4.2 KB | 96% smaller |
| 1×1 GIF, 42 B | Any | left untouched, 42 B | — |
| 2 shrunken photos | Save as one .zip | 56 KB archive, CRCs verified | — |

On a slower machine expect roughly **3 seconds per large photo** (measured on the
verification run; the page processes up to 4 at once, which is ~4.6× faster than one at a time).

## The two rules that shaped it

Both came from measuring, not guessing.

1. **Re-encoding alone can make a photo BIGGER.** The earlier `image-compressor` project
   turned a 330 KB photo into a 353 KB one at full resolution. So Shrink Ray always
   considers resizing, and it never hands back a file larger than the one it was given —
   if the result would be bigger, the original is kept and the user is told.
2. **Contrast was never the accessibility problem — type size was.** The old UI passed
   WCAG contrast at 6.15:1 while setting its labels at 12px. Big type and big targets are
   the fix, and `scripts/verify_app.js` now fails the build if text drops below 15px.

## Verification

Two tiers, no test framework, no dependencies:

```bash
node scripts/verify_app.js      # 118 assertions: maths, zip, wording, offline-safety, type sizes
node scripts/browser_check.js   #  46 assertions: real Chrome, real image files, real output
node scripts/browser_check.js --url=https://nwfella.github.io/shrink-ray/   # same gate against live
```

The browser gate **launches its own throwaway headless Chrome** and generates its own test
photos (a smooth 3000×2000 PNG, a small PNG, plus HEIC/PDF/GIF stubs) — nothing is downloaded
and no binary is committed. It asserts on what actually rendered: the headline text, the
green colour of the result line, pixel-free layout at 390/1024/1500/1920px, zero console
errors, and a zip whose entry CRCs are re-checked by Node rather than by the app that wrote it.

## How it is built

- **One file.** `index.html` — no build step, no framework, no CDN, no service worker.
  Open it from disk (`file://`) and it works, which is also the offline story.
- **Native browser APIs only.** `<canvas>`, `createImageBitmap`, `canvas.toBlob`,
  `CompressionStream` is not needed (photos are stored, not deflated, in the zip), and
  `showSaveFilePicker` / `showDirectoryPicker` for real save dialogs where Chrome and Edge
  offer them, with a plain download as the fallback everywhere else.
- **A DOM-free core.** All the logic that can be tested without a browser lives between
  `/* CORE-START */` and `/* CORE-END */` and is lifted out by the Node gate.
- **Progressive halving** when resizing, because shrinking 3000px → 1600px in one step loses
  more detail than halving first.

## Deploy

```bash
gh repo create nwfella/shrink-ray --public --source=. --push
gh api --method POST repos/nwfella/shrink-ray/pages -f "source[branch]=main" -f "source[path]=/"
```

## Licence

MIT © 2026 nwfella
