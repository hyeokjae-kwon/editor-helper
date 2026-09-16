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

// A PDF dict entry may be a direct Name/Array or an indirect reference to one.
function normalizeColorSpaceEntry(entry, context) {
  if (entry && !(entry instanceof PDFName) && !(entry instanceof PDFArray)) {
    return context.lookup(entry);
  }
  return entry;
}

// Resolves a ColorSpace entry to a human-readable model name plus channel
// count and whether it's (ultimately) CMYK. Recurses for Indexed color spaces
// so the CMYK check reflects the palette's base color space, not "Indexed".
function resolveColorSpaceValue(rawColorSpace, context) {
  const colorSpace = normalizeColorSpaceEntry(rawColorSpace, context);
  if (!colorSpace) {
    return { model: 'Unknown', channels: null, isIndexed: false, isCmyk: false };
  }

  if (colorSpace instanceof PDFName) {
    const csName = colorSpace.decodeText();
    if (csName === 'DeviceGray' || csName === 'CalGray') {
      return { model: 'Gray', channels: 1, isIndexed: false, isCmyk: false };
    }
    if (csName === 'DeviceRGB' || csName === 'CalRGB') {
      return { model: 'RGB', channels: 3, isIndexed: false, isCmyk: false };
    }
    if (csName === 'DeviceCMYK') {
      return { model: 'CMYK', channels: 4, isIndexed: false, isCmyk: true };
    }
    if (csName === 'Lab') {
      return { model: 'Lab', channels: 3, isIndexed: false, isCmyk: false };
    }
    return { model: csName, channels: null, isIndexed: false, isCmyk: false };
  }

  if (colorSpace instanceof PDFArray) {
    const kind = nameOf(colorSpace.lookup(0, PDFName));
    if (kind === 'ICCBased') {
      const stream = context.lookup(colorSpace.get(1));
      const n = stream && stream.dict ? getNumber(stream.dict, 'N', null) : null;
      if (n === 1) return { model: 'Gray', channels: 1, isIndexed: false, isCmyk: false };
      if (n === 3) return { model: 'RGB', channels: 3, isIndexed: false, isCmyk: false };
      if (n === 4) return { model: 'CMYK', channels: 4, isIndexed: false, isCmyk: true };
      return { model: 'ICC', channels: n, isIndexed: false, isCmyk: false };
    }
    if (kind === 'Indexed') {
      const baseInfo = resolveColorSpaceValue(colorSpace.get(1), context);
      return { model: `Indexed(${baseInfo.model})`, channels: 1, isIndexed: true, isCmyk: baseInfo.isCmyk };
    }
    if (kind === 'Separation') {
      return { model: 'Separation', channels: 1, isIndexed: false, isCmyk: false };
    }
    if (kind === 'DeviceN') {
      const names = colorSpace.lookup(1, PDFArray);
      return { model: 'DeviceN', channels: names ? names.size() : null, isIndexed: false, isCmyk: false };
    }
    return { model: kind ?? 'Unknown', channels: null, isIndexed: false, isCmyk: false };
  }

  return { model: 'Unknown', channels: null, isIndexed: false, isCmyk: false };
}

// Returns { model, channels, bitsPerComponent, isIndexed, isCmyk } describing
// an image XObject's declared color space.
function resolveColorSpace(dict, context) {
  const bitsPerComponent = getNumber(dict, 'BitsPerComponent', 8);
  const colorSpaceEntry = dict.lookup(PDFName.of('ColorSpace'));
  const info = resolveColorSpaceValue(colorSpaceEntry, context);
  return { ...info, bitsPerComponent };
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

  let colorInfo;
  try {
    colorInfo = resolveColorSpace(dict, context);
  } catch {
    colorInfo = { model: 'Unknown', channels: null, isIndexed: false, isCmyk: false, bitsPerComponent: null };
  }
  // CCITT fax / JBIG2 streams are inherently bilevel; the PDF spec expects
  // DeviceGray for them even when the ColorSpace entry is omitted.
  if (
    colorInfo.model === 'Unknown' &&
    (filterNames.includes('CCITTFaxDecode') || filterNames.includes('JBIG2Decode'))
  ) {
    colorInfo = { ...colorInfo, model: 'Gray', isCmyk: false };
  }
  const colorModel = colorInfo.model;
  const isCmyk = colorInfo.isCmyk;

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
      colorModel,
      isCmyk,
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
      colorModel,
      isCmyk,
      previewDataUrl,
    };
  }

  // No image-specific filter: this is a raw bitmap stream (or was only Flate-compressed).
  let previewDataUrl = null;
  try {
    const { channels, bitsPerComponent, isIndexed } = colorInfo;
    if (!isIndexed && bitsPerComponent === 8 && (channels === 1 || channels === 3)) {
      previewDataUrl = buildPngDataUrl(bytes, width, height, channels);
    }
  } catch {
    previewDataUrl = null;
  }

  return { ext: 'png', width, height, filters: filterNames, colorModel, isCmyk, previewDataUrl };
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

  const byColorModel = new Map();
  images.forEach((img) => {
    if (!byColorModel.has(img.colorModel)) {
      byColorModel.set(img.colorModel, { model: img.colorModel, isCmyk: img.isCmyk, count: 0, pages: new Set() });
    }
    const group = byColorModel.get(img.colorModel);
    group.count += 1;
    group.pages.add(img.page);
  });

  const colorModels = [...byColorModel.values()]
    .map((group) => ({
      model: group.model,
      isCmyk: group.isCmyk,
      count: group.count,
      pageCount: group.pages.size,
      pages: [...group.pages].sort((a, b) => a - b),
    }))
    .sort((a, b) => b.count - a.count);

  const nonCmykCount = images.filter((img) => !img.isCmyk).length;

  return {
    pageCount: pages.length,
    imageCount: images.length,
    nonCmykCount,
    colorModels,
    images,
  };
}
