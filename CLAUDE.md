# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A PDF image color-model analyzer: upload a PDF, and it reports which images inside are *not* CMYK (Gray/RGB/Indexed/etc.), on which pages, with thumbnail previews where possible. Two-package monorepo, no shared root `package.json` — `client/` and `server/` are run and installed independently.

### Target users

Editors at a textbook publishing company (교과서 제작 회사의 편집자). Print output must be CMYK; images embedded as RGB, Gray, or other non-CMYK color spaces need to be caught and re-exported before print. Keep this workflow in mind when prioritizing features or UI wording — the app deliberately surfaces only non-CMYK images rather than a full inventory, and the "미리보기 불가" formats (CCITT/JBIG2 bilevel scans) are exactly the ones most likely to need manual follow-up.

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

- `src/index.js` — single Express app. One route: `POST /api/analyze`, accepting a `multipart/form-data` upload with field name `pdf` (via `multer`, in-memory storage, 50MB limit). Delegates to `pdfAnalyzer.js` and returns JSON. The uploaded file's `originalname` is re-decoded from `latin1` to `utf8` before being returned as `fileName` — multer/busboy decode multipart filenames as latin1 by default, which mangles non-ASCII (e.g. Korean) filenames otherwise.
- `src/pdfAnalyzer.js` — the core logic. Given a PDF buffer, it uses `pdf-lib` to walk every page's `Resources/XObject` dictionary and inspect each image XObject directly (not pdfjs-style full rendering):
  - `resolveColorSpace()` reads the image dict's `ColorSpace` entry and resolves it to a `{ model, channels, bitsPerComponent, isIndexed, isCmyk }` shape — handling direct names (`DeviceGray`/`DeviceRGB`/`DeviceCMYK`/`Lab`), `ICCBased` (via its `N` component count), `Indexed` (recursing into the base color space), and `Separation`/`DeviceN`. CCITT/JBIG2 streams without an explicit `ColorSpace` default to `Gray` per spec.
  - `classifyImage()` combines that with the `Filter` chain to also produce a physical format label (`ext`: jpg/jp2/tiff/jbig2/png) and a preview when possible: DCT/JPX streams are valid standalone image bytes and are returned directly as a data URL; raw bitmap streams (only generic filters like `FlateDecode`) are re-packed into an RGBA buffer and re-encoded as PNG via `pngjs` when 8-bit Gray or RGB (see `buildPngDataUrl`); CCITT/JBIG2 get no preview (would need a dedicated fax/JBIG2 decoder — out of scope).
  - `analyzePdf()` groups images by color model across the whole document (`colorModels: [{ model, isCmyk, count, pageCount, pages }]`) and returns a flat per-image list (`images: [{ id, page, ext, colorModel, isCmyk, width, height, filters, previewDataUrl }]`) plus `nonCmykCount`.

When extending this (e.g. real preview for CMYK/Indexed images, or LZW/ASCII85-wrapped images), the extension points are `resolveColorSpaceValue()` (color space → model/isCmyk) and `classifyImage()` (per-image `ext`/preview) in `pdfAnalyzer.js`.

### Frontend (`client/`, React 19 + Vite)

- Single-page app, no router. `src/App.jsx` holds all state (selected file, analysis result, loading/error) and does the fetch to `/api/analyze` directly with `FormData`. A 초기화(reset) button clears file/result/error state and resets the native file input via a `ref` (needed since `<input type="file">` is uncontrolled).
- Renders two views from one API response, both **filtered to non-CMYK images only** (`result.colorModels`/`result.images` filtered by `!isCmyk`): a color-model summary table (model / image count / page count / page numbers) and a preview section, where entries without `previewDataUrl` show a "미리보기 불가" placeholder instead of an `<img>`. `result.nonCmykCount` / `result.imageCount` drive the top summary line.
- The preview section groups non-CMYK images by page (`imagesByPage`, built client-side from the flat `images` list) with a page-number heading per group, and within each group lays images out in a fixed 3-column grid (`.preview-grid` in `App.css`).
- Styling is plain CSS (`App.css`, `index.css`) using CSS custom properties defined in `index.css` (`--accent`, `--border`, `--bg`, etc.) with a `prefers-color-scheme: dark` override block — reuse these variables rather than hardcoding colors so dark mode keeps working.
