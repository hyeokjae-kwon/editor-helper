# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A PDF/image color-model analyzer: upload a PDF *or* a standalone image file (JPG/PNG/TIFF), and it reports which images are *not* CMYK (Gray/RGB/Indexed/etc.), on which pages, with thumbnail previews where possible. Two-package monorepo, no shared root `package.json` — `client/` and `server/` are run and installed independently.

### Target users

Editors at a textbook publishing company (교과서 제작 회사의 편집자). Print output must be CMYK; images embedded as RGB, Gray, or other non-CMYK color spaces need to be caught and re-exported before print. Keep this workflow in mind when prioritizing features or UI wording — the app deliberately surfaces only non-CMYK images rather than a full inventory, and the "미리보기 불가" formats (CCITT/JBIG2 bilevel scans) are exactly the ones most likely to need manual follow-up.

## Code comments

Whenever you add or modify source code in this repo, write Korean comments explaining it — assume the reader is a college freshman with little to no programming background (this repo has been used as a learning example). Comment generously: explain not just *what* a line does but *why*, and spell out non-obvious language/library behavior (e.g. PDF internals, async/await, React state) rather than assuming prior knowledge. Match the style already in `pdfAnalyzer.js`, `imageAnalyzer.js`, and `App.jsx`.

## Commands

```bash
# Backend (Express API on :4000)
cd server && npm install
npm run dev     # node --watch src/index.js (auto-restart)
npm start       # node src/index.js

# Frontend (Vite dev server on :5173)
cd client && npm install
npm run dev
npm run build    # production build to client/dist
npm run lint     # oxlint
npm run preview  # preview the production build
```

There is no test suite in either package (`server`'s `npm test` is the default unconfigured stub).

The frontend calls the backend via `VITE_API_BASE` (defaults to `http://localhost:4000` in `client/src/App.jsx`); both dev servers must be running for the app to work end to end.

## Architecture

### Backend (`server/`, Node ESM + Express)

- `src/index.js` — single Express app. One route: `POST /api/analyze`, accepting a `multipart/form-data` upload with field name `file` (via `multer`, in-memory storage, 50MB limit; the field was renamed from `pdf` when image uploads were added). The request body is **not** dispatched by client-supplied `mimetype`/extension — it's sniffed from the buffer's magic bytes (`%PDF-` header for PDF, else `detectImageFormat()` from `imageAnalyzer.js`), then routed to `analyzePdf()` or `analyzeImageFile()` accordingly; an unrecognized format returns 400. The uploaded file's `originalname` is re-decoded from `latin1` to `utf8` before being returned as `fileName` — multer/busboy decode multipart filenames as latin1 by default, which mangles non-ASCII (e.g. Korean) filenames otherwise.
- `src/pdfAnalyzer.js` — the core logic for PDFs. Given a PDF buffer, it uses `pdf-lib` to walk every page's `Resources/XObject` dictionary and inspect each image XObject directly (not pdfjs-style full rendering):
  - `resolveColorSpace()` reads the image dict's `ColorSpace` entry and resolves it to a `{ model, channels, bitsPerComponent, isIndexed, isCmyk }` shape — handling direct names (`DeviceGray`/`DeviceRGB`/`DeviceCMYK`/`Lab`), `ICCBased` (via its `N` component count), `Indexed` (recursing into the base color space), and `Separation`/`DeviceN`. CCITT/JBIG2 streams without an explicit `ColorSpace` default to `Gray` per spec.
  - `classifyImage()` combines that with the `Filter` chain to also produce a physical format label (`ext`: jpg/jp2/tiff/jbig2/png) and a preview when possible: DCT/JPX streams are valid standalone image bytes and are returned directly as a data URL; raw bitmap streams (only generic filters like `FlateDecode`) are re-packed into an RGBA buffer and re-encoded as PNG via `pngjs` when 8-bit Gray or RGB (see `buildPngDataUrl`); CCITT/JBIG2 get no preview (would need a dedicated fax/JBIG2 decoder — out of scope).
  - `collectImagesFromResources()` walks a `Resources/XObject` dict and recurses into any XObject with `Subtype Form` (transparency groups, clipping masks, OCG layers commonly nest images this way in InDesign/Illustrator exports) — a `visited` `Set` keyed by `PDFRef.toString()` guards against circular references in malformed/malicious PDFs. Called once per page with a fresh `visited` set.
  - `analyzePdf()` groups images by color model across the whole document (`colorModels: [{ model, isCmyk, count, pageCount, pages }]`) and returns a flat per-image list (`images: [{ id, page, ext, colorModel, isCmyk, width, height, filters, previewDataUrl }]`) plus `nonCmykCount`.
  - Extension points when extending PDF handling: `resolveColorSpaceValue()` (color space → model/isCmyk) and `classifyImage()` (per-image `ext`/preview). Known gap: an image's `/ColorSpace` given as a *named* reference into `Resources/ColorSpace` (common in Illustrator/InDesign exports, e.g. `/CS0`) is not resolved against that dictionary — it falls through to the "unknown name" branch instead of recursing.
- `src/imageAnalyzer.js` — analyzes a **standalone** image file (not embedded in a PDF), byte-sniffing its format and reading just enough of the header to determine color model, without decoding the whole image:
  - `detectImageFormat()` — magic-byte sniff for `jpeg`/`png`/`tiff`.
  - `classifyJpeg()` — walks JFIF markers to the SOF segment; component count decides the model (1=Gray, 3=RGB, 4=CMYK/YCCK — treated as CMYK either way, mirroring the ICCBased `N`-count heuristic in `pdfAnalyzer.js`).
  - `classifyPng()` — reads the IHDR `colorType` byte directly; PNG has no CMYK color type in the spec, so any valid PNG is always reported non-CMYK.
  - `classifyTiff()` — walks the first IFD for tag 262 (`PhotometricInterpretation`); 5 = CMYK (Separated), relevant since CMYK TIFFs are a common print-workflow deliverable.
  - `analyzeImageFile()` — wraps one of the above into the same result shape `analyzePdf()` returns (`pageCount`/`imageCount`/`nonCmykCount`/`colorModels`/`images`), with `page` hardcoded to `1`. JPEG/PNG get a `previewDataUrl` (original bytes are already browser-displayable); TIFF does not (no browser-native decoder, same "미리보기 불가" treatment as CCITT/JBIG2).

### Frontend (`client/`, React 19 + Vite)

- Single-page app, no router. `src/App.jsx` holds all state (selected file, analysis result, loading/error, the currently zoomed preview image) and does the fetch to `/api/analyze` directly with `FormData` (field name `file`, `accept="application/pdf,image/jpeg,image/png,image/tiff"` on the `<input>`). A 초기화(reset) button clears file/result/error state and resets the native file input via a `ref` (needed since `<input type="file">` is uncontrolled).
- Layout is a fixed left sidebar (`.sidebar`: brand "편집자 도우미" + `.side-nav`, currently one item) plus a `<main className="content">` that fills the rest — add future tools as more `.side-nav-item` entries, no router needed yet. `#root` has no `max-width` — the layout intentionally fills the full viewport width; `.result`/`.preview-grid` size themselves accordingly (`.preview-grid` is `repeat(auto-fill, minmax(160px, 1fr))`, not a fixed column count).
- The color-model summary **table always renders**: it shows `result.colorModels.filter(!isCmyk)` when there are non-CMYK images, or falls back to the full `result.colorModels` (i.e. just the CMYK row) when everything is CMYK, so a clean file still gets a visible result table, not just a text line. The **preview section is conditional** — it only renders (grouped by page via client-built `imagesByPage`) when there's at least one non-CMYK image; entries without `previewDataUrl` show a "미리보기 불가" placeholder instead of an `<img>`. Clicking a preview `<img>` opens it enlarged in a native `<dialog>` (`.preview-dialog`, ref `previewDialogRef`) — Esc-to-close and the backdrop are the browser's built-in `<dialog>` behavior; the click-outside-to-close handler just checks `e.target === e.currentTarget`.
- Styling is plain CSS (`App.css`, `index.css`) using CSS custom properties defined in `index.css` (`--accent`, `--border`, `--bg`, `--sidebar-bg`, etc.). The app is **always light theme** — there is no `prefers-color-scheme: dark` block (removed; `color-scheme: light` is set explicitly) — so don't reintroduce dark-mode variants without being asked. `--accent` is a blue/sky-blue midtone (`#1a84ea`), used sparingly as accent points (sidebar active item, primary button, badge chips, section-heading "—" prefixes, a 3px top hairline on `#root`) rather than as a dominant color. Badge/label styling (`.ext-badge`, buttons) uses pill shapes (`border-radius: 999px`) and `var(--mono)`; **`.ext-badge` must be applied to a `<span>` inside a table cell, never directly on a `<td>`** — putting the pill radius on the cell itself collides with the table's own cell borders and looks broken.
- Responsive breakpoints in `App.css` (all mobile-first-ish max-width, sidebar-first): **≤1024px** narrows the sidebar (240px → 200px) and content padding instead of stacking it — most tablets in portrait (iPad Mini and up, ≥744px) stay comfortably above this, so they keep the desktop-style side-by-side layout. **≤640px** is the actual "stack sidebar above content" breakpoint, meant for phones, not tablets. Separately, `@media (pointer: coarse)` bumps button/nav-item padding for touch input regardless of viewport width. The result table (`.ext-table`) is wrapped in `.table-scroll` (`overflow-x: auto`) so a long page-number list can never blow out the page layout, only scroll within the table.
