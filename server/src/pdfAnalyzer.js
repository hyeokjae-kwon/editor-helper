import zlib from 'node:zlib';
import { PNG } from 'pngjs';
import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFRawStream,
  PDFNumber,
} from 'pdf-lib';

// PDF image stream filters that are themselves a final image encoding.
const IMAGE_FILTER_EXTENSION = {
  DCTDecode: 'jpg',
  JPXDecode: 'jp2',
  CCITTFaxDecode: 'tiff',
  JBIG2Decode: 'jbig2',
};

// Filters that are generic stream compression, not an image format.
const GENERIC_FILTERS = new Set([
  'FlateDecode',
  'ASCII85Decode',
  'ASCIIHexDecode',
  'LZWDecode',
  'RunLengthDecode',
]);

function nameOf(obj) {
  return obj instanceof PDFName ? obj.decodeText() : null;
}

function getFilterNames(dict) {
  const filter = dict.lookup(PDFName.of('Filter'));
  if (!filter) return [];
  if (filter instanceof PDFName) return [filter.decodeText()];
  if (filter instanceof PDFArray) {
    const names = [];
    for (let i = 0; i < filter.size(); i += 1) {
      const entry = filter.lookup(i, PDFName);
      if (entry) names.push(entry.decodeText());
    }
    return names;
  }
  return [];
}

function getNumber(dict, key, fallback = null) {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFNumber ? value.asNumber() : fallback;
}

// Returns { channels, bitsPerComponent } for a raw (unencoded) image bitmap.
function readColorSpaceInfo(dict, context) {
  const bitsPerComponent = getNumber(dict, 'BitsPerComponent', 8);
  let colorSpace = dict.lookup(PDFName.of('ColorSpace'));
  if (colorSpace && !(colorSpace instanceof PDFName) && !(colorSpace instanceof PDFArray)) {
    colorSpace = context.lookup(colorSpace);
  }

  let channels = 1;
  if (colorSpace instanceof PDFName) {
    const csName = colorSpace.decodeText();
    if (csName === 'DeviceRGB' || csName === 'CalRGB') channels = 3;
    else if (csName === 'DeviceCMYK') channels = 4;
    else channels = 1;
  } else if (colorSpace instanceof PDFArray) {
    const kind = nameOf(colorSpace.lookup(0, PDFName));
    if (kind === 'ICCBased') {
      const stream = context.lookup(colorSpace.get(1));
      const n = stream && stream.dict ? getNumber(stream.dict, 'N', 3) : 3;
      channels = n;
    } else if (kind === 'Indexed') {
      channels = 1; // palette lookup not resolved; preview skipped for indexed images
    } else if (kind === 'DeviceN') {
      const names = colorSpace.lookup(1, PDFArray);
      channels = names ? names.size() : 4;
    } else {
      channels = 3;
    }
  }

  return { channels, bitsPerComponent, isIndexed: colorSpace instanceof PDFArray && nameOf(colorSpace.lookup(0, PDFName)) === 'Indexed' };
}

function applyGenericFilter(bytes, filterName) {
  if (filterName === 'FlateDecode') return zlib.inflateSync(bytes);
  // ASCII85/ASCIIHex/LZW/RunLength are uncommon for real-world image streams;
  // treated as unsupported so callers fall back to "no preview" instead of guessing wrong bytes.
  throw new Error(`unsupported-filter:${filterName}`);
}

function buildPngDataUrl(rawBytes, width, height, channels) {
  if (!width || !height) return null;
  const rowBytes = width * channels;
  if (rawBytes.length < rowBytes * height) return null;

  const png = new PNG({ width, height });
  const out = png.data; // RGBA buffer, 4 bytes/pixel
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowBytes;
    for (let x = 0; x < width; x += 1) {
      const inIdx = rowStart + x * channels;
      const outIdx = (y * width + x) * 4;
      if (channels === 1) {
        const v = rawBytes[inIdx];
        out[outIdx] = v;
        out[outIdx + 1] = v;
        out[outIdx + 2] = v;
        out[outIdx + 3] = 255;
      } else {
        out[outIdx] = rawBytes[inIdx];
        out[outIdx + 1] = rawBytes[inIdx + 1];
        out[outIdx + 2] = rawBytes[inIdx + 2];
        out[outIdx + 3] = 255;
      }
    }
  }

  const buf = PNG.sync.write(png);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function classifyImage(xobj, context) {
  const { dict } = xobj;
  const filterNames = getFilterNames(dict);
  const width = getNumber(dict, 'Width');
  const height = getNumber(dict, 'Height');

  let bytes = xobj.contents;
  let terminalFilter = null;

  try {
    for (const filterName of filterNames) {
      if (IMAGE_FILTER_EXTENSION[filterName]) {
        terminalFilter = filterName;
        break;
      }
      bytes = applyGenericFilter(bytes, filterName);
    }
  } catch {
    return {
      ext: filterNames.length ? filterNames[filterNames.length - 1].replace('Decode', '').toLowerCase() : 'unknown',
      width,
      height,
      filters: filterNames,
      previewDataUrl: null,
    };
  }

  if (terminalFilter) {
    let previewDataUrl = null;
    if (terminalFilter === 'DCTDecode') {
      previewDataUrl = `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`;
    } else if (terminalFilter === 'JPXDecode') {
      previewDataUrl = `data:image/jp2;base64,${Buffer.from(bytes).toString('base64')}`;
    }
    return {
      ext: IMAGE_FILTER_EXTENSION[terminalFilter],
      width,
      height,
      filters: filterNames,
      previewDataUrl,
    };
  }

  // No image-specific filter: this is a raw bitmap stream (or was only Flate-compressed).
  let previewDataUrl = null;
  try {
    const { channels, bitsPerComponent, isIndexed } = readColorSpaceInfo(dict, context);
    if (!isIndexed && bitsPerComponent === 8 && (channels === 1 || channels === 3)) {
      previewDataUrl = buildPngDataUrl(bytes, width, height, channels);
    }
  } catch {
    previewDataUrl = null;
  }

  return { ext: 'png', width, height, filters: filterNames, previewDataUrl };
}

export async function analyzePdf(buffer) {
  const pdfDoc = await PDFDocument.load(buffer, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const { context } = pdfDoc;
  const pages = pdfDoc.getPages();
  const images = [];

  pages.forEach((page, pageIndex) => {
    const pageNumber = pageIndex + 1;
    const resources = page.node.Resources();
    if (!resources) return;

    const xobjects = resources.lookupMaybe(PDFName.of('XObject'), PDFDict);
    if (!xobjects) return;

    xobjects.keys().forEach((key) => {
      const ref = xobjects.get(key);
      const xobj = context.lookup(ref);
      if (!(xobj instanceof PDFRawStream)) return;

      const subtype = xobj.dict.lookup(PDFName.of('Subtype'));
      if (nameOf(subtype) !== 'Image') return;

      const info = classifyImage(xobj, context);
      images.push({
        id: `${pageNumber}-${key.decodeText()}`,
        page: pageNumber,
        ...info,
      });
    });
  });

  const byExt = new Map();
  images.forEach((img) => {
    if (!byExt.has(img.ext)) {
      byExt.set(img.ext, { ext: img.ext, count: 0, pages: new Set() });
    }
    const group = byExt.get(img.ext);
    group.count += 1;
    group.pages.add(img.page);
  });

  const extensions = [...byExt.values()]
    .map((group) => ({
      ext: group.ext,
      count: group.count,
      pageCount: group.pages.size,
      pages: [...group.pages].sort((a, b) => a - b),
    }))
    .sort((a, b) => b.count - a.count);

  return {
    pageCount: pages.length,
    imageCount: images.length,
    extensions,
    images,
  };
}
