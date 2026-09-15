# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A PDF image-extension analyzer: upload a PDF, and it reports which image formats (jpg/jp2/tiff/jbig2/png) are embedded inside, on which pages, with thumbnail previews where possible. Two-package monorepo, no shared root `package.json` — `client/` and `server/` are run and installed independently.

### Target users

Editors at a textbook publishing company (교과서 제작 회사의 편집자). They handle PDFs containing a mix of scanned and digitally-produced figures/photos and need to know what image formats are embedded — e.g. to catch low-quality scans (CCITT/JBIG2 fax-style bilevel images) mixed in with proper photos (JPEG), or to figure out what to re-export before print. Keep this workflow in mind when prioritizing features or UI wording (e.g. the "미리보기 불가" formats are exactly the ones most likely to need manual follow-up).

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

- `src/index.js` — single Express app. One route: `POST /api/analyze`, accepting a `multipart/form-data` upload with field name `pdf` (via `multer`, in-memory storage, 50MB limit). Delegates to `pdfAnalyzer.js` and returns JSON.
- `src/pdfAnalyzer.js` — the core logic. Given a PDF buffer, it uses `pdf-lib` to walk every page's `Resources/XObject` dictionary and inspect each image XObject's `Filter` chain directly (not pdfjs-style full rendering):
  - Terminal image filters (`DCTDecode`, `JPXDecode`, `CCITTFaxDecode`, `JBIG2Decode`) map straight to an extension (jpg/jp2/tiff/jbig2). For DCT/JPX the raw stream bytes *are* a valid standalone image file, so they're returned directly as a base64 data URL preview.
  - Streams with only generic filters (`FlateDecode`, etc., no terminal image filter) are raw pixel bitmaps — classified as `png`. If the color space resolves to 8-bit Gray or RGB, the raw bytes are manually packed into an RGBA buffer and re-encoded as an actual PNG via `pngjs` for the preview (see `buildPngDataUrl`). Indexed/CMYK/other bit depths currently get an extension label but no preview.
  - CCITT/JBIG2 images get an extension label but no preview (would require a dedicated fax/JBIG2 decoder — out of scope).
  - Results are grouped by extension across the whole document (`{ ext, count, pageCount, pages }`) as well as returned as a flat per-image list (`{ id, page, ext, width, height, filters, previewDataUrl }`).

When extending format support (e.g. real Indexed-color or CMYK preview, or LZW/ASCII85-wrapped images), the extension point is `classifyImage()` in `pdfAnalyzer.js` — it decides `ext` and `previewDataUrl` per image; `readColorSpaceInfo()` resolves PDF ColorSpace objects (including `ICCBased`/`Indexed`/`DeviceN` indirection) to a channel count.

### Frontend (`client/`, React 19 + Vite)

- Single-page app, no router. `src/App.jsx` holds all state (selected file, analysis result, loading/error) and does the fetch to `/api/analyze` directly with `FormData`.
- Renders two views from one API response: an extension summary table (`result.extensions`: ext / image count / page count / page numbers) and a preview grid (`result.images`), where entries without `previewDataUrl` show a "미리보기 불가" placeholder instead of an `<img>`.
- Styling is plain CSS (`App.css`, `index.css`) using CSS custom properties defined in `index.css` (`--accent`, `--border`, `--bg`, etc.) with a `prefers-color-scheme: dark` override block — reuse these variables rather than hardcoding colors so dark mode keeps working.
