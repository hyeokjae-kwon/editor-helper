// ============================================================================
// PDF가 아니라 "낱장 이미지 파일"(JPG/PNG/TIFF)을 업로드했을 때 색상 모델을 판별하는 파일입니다.
// pdfAnalyzer.js는 PDF 안에 박혀있는 이미지 스트림을 다뤘다면, 이 파일은 이미지 파일 자체의
// 바이트를 직접 읽어서 색상 모델을 알아냅니다. 포맷마다 색상 정보가 저장되는 위치가 달라서
// 포맷별로 각각 최소한의 헤더 파싱만 합니다(전체 이미지를 디코딩하지 않음).
// ============================================================================

// 파일의 맨 앞 몇 바이트(매직 넘버)를 보고 "이게 무슨 이미지 포맷인지" 알아냅니다.
// 확장자나 브라우저가 보내주는 mimetype은 틀릴 수 있어서, 실제 바이트로 판별하는 게 더 안전합니다.
export function detectImageFormat(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'png';
  if (buffer.length >= 4 && (buffer.subarray(0, 4).equals(Buffer.from('II*\0')) || buffer.subarray(0, 4).equals(Buffer.from('MM\0*'))))
    return 'tiff';
  return null;
}

// JPEG: SOF(Start Of Frame) 마커를 찾아 컴포넌트(채널) 개수로 색상 모델을 판별합니다.
// 1개=Gray, 3개=RGB(대개 YCbCr로 압축되어 있지만 논리적 채널은 R/G/B), 4개=CMYK(YCCK 포함).
function classifyJpeg(buffer) {
  let offset = 2; // 0xFFD8(SOI) 다음부터 시작
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    // 길이 필드가 없는 단독 마커(SOI/EOI/RSTn/TEM)는 건너뜁니다.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    const isSof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      const numComponents = buffer[offset + 9];
      const model = numComponents === 1 ? 'Gray' : numComponents === 3 ? 'RGB' : numComponents === 4 ? 'CMYK' : 'Unknown';
      return { model, isCmyk: numComponents === 4, width, height };
    }
    if (marker === 0xda) break; // SOS(Start Of Scan) 이후는 압축된 이미지 데이터라 더 볼 필요 없음
    offset += 2 + segmentLength;
  }
  return { model: 'Unknown', isCmyk: false, width: null, height: null };
}

// PNG: IHDR 청크의 colorType 바이트로 색상 모델을 판별합니다.
// PNG 표준 자체에 CMYK 색상 타입이 없으므로, 유효한 PNG는 항상 non-CMYK입니다.
function classifyPng(buffer) {
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const colorType = buffer[25];
  const model = { 0: 'Gray', 2: 'RGB', 3: 'Indexed', 4: 'Gray(Alpha)', 6: 'RGB(Alpha)' }[colorType] ?? 'Unknown';
  return { model, isCmyk: false, width, height };
}

// TIFF: IFD(이미지 파일 디렉터리)에서 PhotometricInterpretation(태그 262) 값을 찾아 판별합니다.
// CMYK TIFF(값 5)는 인쇄 워크플로우에서 실제로 흔히 쓰이는 포맷이라 이 프로젝트 목적상 중요합니다.
function classifyTiff(buffer) {
  const little = buffer[0] === 0x49; // 'II' = little-endian, 'MM' = big-endian
  const readU16 = (o) => (little ? buffer.readUInt16LE(o) : buffer.readUInt16BE(o));
  const readU32 = (o) => (little ? buffer.readUInt32LE(o) : buffer.readUInt32BE(o));

  const ifdOffset = readU32(4);
  const entryCount = readU16(ifdOffset);
  let width = null;
  let height = null;
  let photometric = null;

  for (let i = 0; i < entryCount; i += 1) {
    const entryOffset = ifdOffset + 2 + i * 12;
    const tag = readU16(entryOffset);
    // SHORT 타입 값 1개는 4바이트 값 필드의 앞 2바이트에, 파일의 바이트 순서 그대로 저장됩니다.
    if (tag === 256) width = readU16(entryOffset + 8);
    else if (tag === 257) height = readU16(entryOffset + 8);
    else if (tag === 262) photometric = readU16(entryOffset + 8);
  }

  const model = { 0: 'Gray', 1: 'Gray', 2: 'RGB', 3: 'Indexed', 5: 'CMYK', 6: 'YCbCr', 8: 'Lab' }[photometric] ?? 'Unknown';
  return { model, isCmyk: photometric === 5, width, height };
}

const EXT_BY_FORMAT = { jpeg: 'jpg', png: 'png', tiff: 'tiff' };
// 브라우저가 <img>로 바로 렌더링할 수 있는 포맷만 미리보기를 만듭니다. TIFF는 전용 디코더가 없어 불가.
const PREVIEWABLE_FORMATS = new Set(['jpeg', 'png']);

// 낱장 이미지 파일 하나를 분석해서, PDF 분석 결과(analyzePdf)와 같은 모양의 객체로 돌려줍니다.
// (프론트엔드가 결과 하나의 형태만 알면 되도록 맞춰주는 것)
export function analyzeImageFile(buffer, format) {
  const classify = { jpeg: classifyJpeg, png: classifyPng, tiff: classifyTiff }[format];
  const { model, isCmyk, width, height } = classify(buffer);

  const previewDataUrl = PREVIEWABLE_FORMATS.has(format)
    ? `data:image/${format};base64,${buffer.toString('base64')}`
    : null;

  const image = {
    id: 'image-1',
    page: 1,
    ext: EXT_BY_FORMAT[format],
    width,
    height,
    filters: [],
    colorModel: model,
    isCmyk,
    previewDataUrl,
  };

  return {
    pageCount: 1,
    imageCount: 1,
    nonCmykCount: isCmyk ? 0 : 1,
    colorModels: [{ model, isCmyk, count: 1, pageCount: 1, pages: [1] }],
    images: [image],
  };
}
