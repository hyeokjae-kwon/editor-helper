// ============================================================================
// 이 파일은 이 프로젝트의 핵심 로직이 들어있는 파일입니다.
// 하는 일을 한 문장으로 요약하면:
//   "PDF 파일 안에 들어있는 모든 이미지를 찾아서,
//    각 이미지가 어떤 색상 모델(RGB/CMYK/Gray 등)로 저장되어 있는지 알아낸다."
//
// 배경 지식 (PDF 구조에 대해 조금 알아야 이 코드를 이해할 수 있습니다):
// - PDF 파일 안에는 "페이지(Page)"들이 있고, 각 페이지는 "리소스(Resources)"라는
//   딕셔너리(사전, 즉 key-value 모음)를 가지고 있습니다.
// - 리소스 안에는 "XObject"라는 것들이 들어있는데, 이 중 Subtype이 "Image"인 것이
//   바로 우리가 찾는 "이미지"입니다. (그림, 사진, 스캔본 등)
// - 이미지는 원본 그대로 저장되어 있지 않고, 보통 압축(Filter)이 적용된 상태로
//   저장되어 있습니다. 예를 들어 JPEG로 압축되어 있으면 필터 이름이 "DCTDecode",
//   그냥 픽셀 데이터를 zip처럼 압축한 것이면 "FlateDecode" 라고 부릅니다.
// - 이미지의 "색상 모델(ColorSpace)"은 픽셀 하나하나가 어떤 색 성분들로 표현되는지를
//   나타냅니다. 예: Gray(흑백 1채널), RGB(빨강/초록/파랑 3채널),
//   CMYK(청록/자홍/노랑/검정 4채널, 인쇄에 주로 사용).
// - 이 프로젝트의 목적(교과서 편집자용)은: 인쇄용 PDF에는 이미지가 CMYK로
//   들어있어야 하는데, 실수로 RGB나 Gray로 들어간 이미지를 찾아내는 것입니다.
// ============================================================================

import zlib from 'node:zlib'; // Node.js 내장 압축/해제 라이브러리 (FlateDecode 압축을 풀 때 사용)
import { PNG } from 'pngjs'; // 픽셀 데이터를 PNG 이미지 파일로 만들어주는 라이브러리 (미리보기 생성용)
import {
  PDFDocument, // PDF 파일 전체를 표현하는 클래스 (여기서 페이지들을 꺼낼 수 있음)
  PDFName, // PDF 안에서 "/Filter", "/ColorSpace" 같은 이름(키)을 표현하는 타입
  PDFDict, // PDF의 딕셔너리(사전, {key: value} 형태의 자료구조)를 표현하는 타입
  PDFArray, // PDF의 배열(리스트)을 표현하는 타입
  PDFRawStream, // 압축된 원본 바이트 데이터를 담고 있는 스트림(이미지 데이터 등)을 표현하는 타입
  PDFNumber, // PDF 안의 숫자 값을 표현하는 타입
  PDFRef, // 간접 참조("12 0 R" 같은 것)를 표현하는 타입. Form XObject 순환 참조 감지에 사용
} from 'pdf-lib'; // PDF 파일 내부 구조를 직접 읽고 쓸 수 있게 해주는 라이브러리

// 이미지 스트림에 적용된 필터(압축 방식) 이름 -> 실제 파일 확장자로 변환하는 매핑표입니다.
// 이 4가지 필터는 "그 자체로 완성된 이미지 포맷"입니다. 즉 압축을 풀 필요 없이
// 저장된 바이트를 그대로 파일로 저장하면 바로 열리는 이미지가 됩니다.
//   - DCTDecode      : JPEG 압축 방식 -> .jpg
//   - JPXDecode      : JPEG2000 압축 방식 -> .jp2
//   - CCITTFaxDecode : 팩스에서 쓰이는 흑백 압축 방식(옛날 스캐너에서 많이 씀) -> .tiff로 표기
//   - JBIG2Decode    : 흑백 문서 스캔에 특화된 압축 방식 -> .jbig2
const IMAGE_FILTER_EXTENSION = {
  DCTDecode: 'jpg',
  JPXDecode: 'jp2',
  CCITTFaxDecode: 'tiff',
  JBIG2Decode: 'jbig2',
};

// 위와 달리, 이 필터들은 "이미지 포맷"이 아니라 "그냥 데이터를 압축하는 범용 방식"입니다.
// 예를 들어 FlateDecode는 zip 파일처럼 그냥 바이트를 압축한 것뿐이라서,
// 압축을 풀어도 그 안에 있는 건 "그림 파일"이 아니라 "가공되지 않은 픽셀 값들의 나열"입니다.
// (현재 코드에서는 이 Set 자체를 직접 참조하진 않고, 아래 applyGenericFilter 함수에서
//  FlateDecode만 실제로 처리합니다. 나머지는 이름만 알아두는 참고용 목록입니다.)
const GENERIC_FILTERS = new Set([
  'FlateDecode',
  'ASCII85Decode',
  'ASCIIHexDecode',
  'LZWDecode',
  'RunLengthDecode',
]);

// PDF 객체(obj)가 "이름(Name)" 타입이면 그 실제 문자열 값을 꺼내서 반환하고,
// 아니라면 null을 반환하는 작은 도우미 함수입니다.
// 예: /DeviceRGB 라는 PDF Name이 들어오면 "DeviceRGB" 라는 문자열을 반환합니다.
function nameOf(obj) {
  return obj instanceof PDFName ? obj.decodeText() : null;
}

// 이미지(또는 스트림) 딕셔너리에서 "/Filter" 항목을 읽어서,
// 적용된 필터 이름들을 문자열 배열로 반환합니다.
// PDF에서 필터는 하나만 있을 수도 있고(PDFName), 여러 개가 순서대로
// 적용될 수도 있습니다(PDFArray, 예: [ASCII85Decode FlateDecode]처럼 순서대로 풀어야 함).
function getFilterNames(dict) {
  const filter = dict.lookup(PDFName.of('Filter'));
  if (!filter) return []; // 필터가 아예 없는 경우 (드묾)
  if (filter instanceof PDFName) return [filter.decodeText()]; // 필터가 하나뿐인 경우
  if (filter instanceof PDFArray) {
    // 필터가 여러 개인 경우, 배열을 순서대로 돌면서 이름을 하나씩 꺼냅니다.
    const names = [];
    for (let i = 0; i < filter.size(); i += 1) {
      const entry = filter.lookup(i, PDFName);
      if (entry) names.push(entry.decodeText());
    }
    return names;
  }
  return [];
}

// 딕셔너리에서 특정 key에 해당하는 값을 "숫자"로 읽어옵니다.
// 값이 없거나 숫자가 아니면 fallback(기본값)을 반환합니다.
// 예: getNumber(imageDict, 'Width', null) -> 이미지의 가로 픽셀 수를 가져옴
function getNumber(dict, key, fallback = null) {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFNumber ? value.asNumber() : fallback;
}

// PDF 파일 안에서 어떤 값(entry)은 "직접 값"이 아니라 "다른 곳에 있는 값을 가리키는
// 참조(간접 참조, indirect reference)"로 저장되어 있을 수 있습니다.
// (비유: 책에서 "자세한 내용은 부록 3번을 참고하세요"라고 적혀 있는 것과 비슷합니다.)
// 이 함수는 entry가 이름(Name)이나 배열(Array)이 "아니라면"(= 아마도 참조일 것이므로)
// context.lookup()을 통해 실제 값을 찾아서 반환해줍니다.
function normalizeColorSpaceEntry(entry, context) {
  if (entry && !(entry instanceof PDFName) && !(entry instanceof PDFArray)) {
    return context.lookup(entry);
  }
  return entry;
}

// ----------------------------------------------------------------------------
// 색상 모델(ColorSpace)을 해석하는 핵심 함수입니다.
// PDF의 ColorSpace 값을 받아서, 우리가 화면에 보여줄 "사람이 읽기 쉬운 이름"
// (예: "RGB", "CMYK", "Gray")과, 채널 수(channels), 그리고 "이게 CMYK인가?"(isCmyk)
// 여부를 계산해서 돌려줍니다.
//
// PDF의 ColorSpace는 아래처럼 여러 형태로 존재할 수 있습니다:
//   1) 이름 하나로 끝나는 단순한 경우: /DeviceRGB, /DeviceCMYK, /DeviceGray, /Lab 등
//   2) 배열로 되어 있고, 좀 더 복잡한 정보가 필요한 경우:
//      - [/ICCBased 스트림]  : 컬러 프로파일(ICC 프로파일)을 사용하는 경우.
//                              몇 개의 색상 채널(N)을 쓰는지 봐야 실제 색상 모델을 알 수 있음.
//      - [/Indexed 기준색상공간 ...] : 팔레트(색상표)를 사용하는 경우.
//                              실제 색은 "기준이 되는 색상 공간"에 들어있으므로 재귀적으로 확인.
//      - [/Separation ...] 또는 [/DeviceN ...] : 인쇄에서 별색(spot color)을 표현할 때 씀.
//
// 재귀 함수인 이유: Indexed 색상 공간은 "그 안에 또 다른 색상 공간"을 담고 있기 때문에,
// 이 함수가 스스로를 다시 호출해서 진짜 기준 색상이 무엇인지 파고 들어갑니다.
// ----------------------------------------------------------------------------
function resolveColorSpaceValue(rawColorSpace, context) {
  const colorSpace = normalizeColorSpaceEntry(rawColorSpace, context);

  // ColorSpace 정보 자체가 없는 경우 (알 수 없음)
  if (!colorSpace) {
    return { model: 'Unknown', channels: null, isIndexed: false, isCmyk: false };
  }

  // 케이스 1: 이름 하나로 된 단순한 색상 공간인 경우
  if (colorSpace instanceof PDFName) {
    const csName = colorSpace.decodeText();
    if (csName === 'DeviceGray' || csName === 'CalGray') {
      // 흑백(회색조), 채널 1개 (밝기 값 하나)
      return { model: 'Gray', channels: 1, isIndexed: false, isCmyk: false };
    }
    if (csName === 'DeviceRGB' || csName === 'CalRGB') {
      // 빨강/초록/파랑, 채널 3개 (모니터/화면에서 주로 쓰는 방식)
      return { model: 'RGB', channels: 3, isIndexed: false, isCmyk: false };
    }
    if (csName === 'DeviceCMYK') {
      // 청록/자홍/노랑/검정, 채널 4개 (인쇄용 색상 모델 - 이게 우리가 "정상"이라고 보는 값)
      return { model: 'CMYK', channels: 4, isIndexed: false, isCmyk: true };
    }
    if (csName === 'Lab') {
      // Lab 색공간 (밝기 + 두 개의 색 축), 채널 3개
      return { model: 'Lab', channels: 3, isIndexed: false, isCmyk: false };
    }
    // 위에서 처리하지 못한 특이한 이름이면, 이름 그대로를 모델명으로 사용합니다.
    return { model: csName, channels: null, isIndexed: false, isCmyk: false };
  }

  // 케이스 2: 배열로 된 좀 더 복잡한 색상 공간인 경우
  if (colorSpace instanceof PDFArray) {
    // 배열의 첫 번째 값이 "이게 무슨 종류의 색상 공간인지"를 알려주는 이름입니다.
    const kind = nameOf(colorSpace.lookup(0, PDFName));

    if (kind === 'ICCBased') {
      // [/ICCBased 스트림] 형태. 두 번째 값(colorSpace.get(1))이 실제 ICC 프로파일 데이터가 담긴
      // 스트림을 가리킵니다. 이 스트림의 딕셔너리 안에 있는 "/N" 값이 채널 개수를 알려줍니다.
      const stream = context.lookup(colorSpace.get(1));
      const n = stream && stream.dict ? getNumber(stream.dict, 'N', null) : null;
      if (n === 1) return { model: 'Gray', channels: 1, isIndexed: false, isCmyk: false };
      if (n === 3) return { model: 'RGB', channels: 3, isIndexed: false, isCmyk: false };
      if (n === 4) return { model: 'CMYK', channels: 4, isIndexed: false, isCmyk: true };
      // N이 1/3/4가 아닌 특이한 경우 (드묾)
      return { model: 'ICC', channels: n, isIndexed: false, isCmyk: false };
    }

    if (kind === 'Indexed') {
      // [/Indexed 기준색상공간 최대인덱스 팔레트데이터] 형태.
      // 이미지의 실제 픽셀 값은 "팔레트의 몇 번째 색인가"만 저장하고,
      // 진짜 색상은 "기준 색상 공간(colorSpace.get(1))"의 팔레트 표에 들어있습니다.
      // 그래서 기준 색상 공간이 무엇인지 이 함수를 재귀 호출해서 알아냅니다.
      const baseInfo = resolveColorSpaceValue(colorSpace.get(1), context);
      // 예: 기준이 CMYK라면 "Indexed(CMYK)" 라는 이름으로 보여줍니다.
      return { model: `Indexed(${baseInfo.model})`, channels: 1, isIndexed: true, isCmyk: baseInfo.isCmyk };
    }

    if (kind === 'Separation') {
      // 인쇄용 별색(예: 금색, 은색 같은 특수 잉크) 한 가지를 표현하는 색상 공간입니다.
      return { model: 'Separation', channels: 1, isIndexed: false, isCmyk: false };
    }

    if (kind === 'DeviceN') {
      // Separation과 비슷하지만 여러 개의 별색 채널을 동시에 표현할 수 있는 색상 공간입니다.
      const names = colorSpace.lookup(1, PDFArray); // 채널 이름들의 목록
      return { model: 'DeviceN', channels: names ? names.size() : null, isIndexed: false, isCmyk: false };
    }

    // 위에서 다루지 못한 종류의 배열형 색상 공간인 경우
    return { model: kind ?? 'Unknown', channels: null, isIndexed: false, isCmyk: false };
  }

  // 이름도, 배열도 아닌 예상치 못한 형태인 경우
  return { model: 'Unknown', channels: null, isIndexed: false, isCmyk: false };
}

// 이미지 하나(dict)의 색상 공간 정보를 종합해서 반환하는 함수입니다.
// 반환값: { model(색상 모델 이름), channels(채널 수), bitsPerComponent(채널당 비트 수),
//          isIndexed(팔레트 방식인지), isCmyk(CMYK인지) }
function resolveColorSpace(dict, context) {
  // BitsPerComponent: 색상 채널 하나를 표현하는 데 몇 비트를 쓰는지 (보통 8비트 = 256단계)
  const bitsPerComponent = getNumber(dict, 'BitsPerComponent', 8);
  const colorSpaceEntry = dict.lookup(PDFName.of('ColorSpace'));
  const info = resolveColorSpaceValue(colorSpaceEntry, context);
  return { ...info, bitsPerComponent };
}

// 범용 압축 필터를 실제로 풀어주는 함수입니다.
// 현재는 FlateDecode(zip과 비슷한 압축 방식)만 지원합니다.
function applyGenericFilter(bytes, filterName) {
  if (filterName === 'FlateDecode') return zlib.inflateSync(bytes);
  // ASCII85/ASCIIHex/LZW/RunLength 필터는 실제 이미지 데이터에서는 거의 쓰이지 않기 때문에
  // 지원하지 않고, 에러를 던져서 "이 이미지는 미리보기를 만들 수 없다"고 처리되게 합니다.
  throw new Error(`unsupported-filter:${filterName}`);
}

// 압축이 풀린 "날 것의(raw)" 픽셀 데이터를 실제로 화면에서 볼 수 있는 PNG 이미지로
// 변환해서, <img> 태그에 바로 넣을 수 있는 data URL(base64 문자열) 형태로 만들어주는 함수입니다.
// - rawBytes: 압축을 푼 픽셀 데이터 (한 줄씩, 왼쪽 위부터 순서대로 저장되어 있음)
// - width, height: 이미지의 가로/세로 픽셀 수
// - channels: 픽셀 하나당 색상 채널 수 (1 = 흑백, 3 = RGB)
function buildPngDataUrl(rawBytes, width, height, channels) {
  if (!width || !height) return null; // 크기 정보가 없으면 변환 불가능
  const rowBytes = width * channels; // 한 줄(가로 한 줄)을 표현하는 데 필요한 바이트 수
  if (rawBytes.length < rowBytes * height) return null; // 데이터가 예상보다 부족하면 변환 포기

  // pngjs의 PNG 객체를 만듭니다. png.data는 항상 RGBA(빨강,초록,파랑,투명도) 4바이트/픽셀 형식입니다.
  const png = new PNG({ width, height });
  const out = png.data;

  // 픽셀을 한 줄(y), 한 칸(x)씩 돌면서 rawBytes(원본) -> out(PNG용 RGBA)로 값을 옮겨 담습니다.
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowBytes;
    for (let x = 0; x < width; x += 1) {
      const inIdx = rowStart + x * channels; // 원본 데이터에서 이 픽셀이 시작하는 위치
      const outIdx = (y * width + x) * 4; // PNG 데이터에서 이 픽셀이 시작하는 위치 (항상 4바이트씩)

      if (channels === 1) {
        // 흑백(Gray) 이미지: 값 하나(v)를 R, G, B 채널에 똑같이 넣어서 회색을 만듭니다.
        const v = rawBytes[inIdx];
        out[outIdx] = v;
        out[outIdx + 1] = v;
        out[outIdx + 2] = v;
        out[outIdx + 3] = 255; // 투명도는 항상 불투명(255)
      } else {
        // RGB 이미지: R, G, B 값을 그대로 옮겨 담습니다.
        out[outIdx] = rawBytes[inIdx];
        out[outIdx + 1] = rawBytes[inIdx + 1];
        out[outIdx + 2] = rawBytes[inIdx + 2];
        out[outIdx + 3] = 255;
      }
    }
  }

  // 완성된 PNG 데이터를 실제 PNG 파일 바이트로 인코딩하고,
  // 그 바이트를 base64 문자열로 바꿔서 브라우저 <img src="..."> 에 바로 쓸 수 있는
  // "data URL" 형식(data:image/png;base64,....)으로 만들어 반환합니다.
  const buf = PNG.sync.write(png);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

// ----------------------------------------------------------------------------
// 이미지 XObject 하나(xobj)를 분석해서 아래 정보를 알아내는 함수입니다:
//   - ext          : 실제 파일 형식 (jpg/jp2/tiff/jbig2/png)
//   - width/height : 이미지 크기
//   - filters      : 적용된 필터 목록
//   - colorModel   : 색상 모델 이름 (RGB/CMYK/Gray 등)
//   - isCmyk       : CMYK인지 여부 (이 프로젝트의 핵심 판단 기준!)
//   - previewDataUrl : 브라우저에서 바로 보여줄 수 있는 미리보기 이미지 (불가능하면 null)
// ----------------------------------------------------------------------------
function classifyImage(xobj, context) {
  const { dict } = xobj; // 이 이미지의 속성들이 들어있는 딕셔너리
  const filterNames = getFilterNames(dict); // 이 이미지에 적용된 필터들 (압축 방식들)
  const width = getNumber(dict, 'Width');
  const height = getNumber(dict, 'Height');

  // 1단계: 먼저 색상 모델을 알아냅니다. (필터가 뭐든 상관없이 항상 시도)
  let colorInfo;
  try {
    colorInfo = resolveColorSpace(dict, context);
  } catch {
    // 색상 공간을 해석하다가 예상치 못한 에러가 나면 "알 수 없음"으로 처리하고 넘어갑니다.
    colorInfo = { model: 'Unknown', channels: null, isIndexed: false, isCmyk: false, bitsPerComponent: null };
  }

  // CCITT 팩스 압축이나 JBIG2 압축은 원래 "흑백 2단계(선/없음)" 이미지를 위한 방식이라서,
  // PDF 표준상 ColorSpace가 따로 적혀 있지 않아도 항상 흑백(Gray)이라고 봐야 합니다.
  // (예: 오래된 스캐너로 스캔한 흑백 문서가 이런 방식으로 저장되는 경우가 많습니다.)
  if (
    colorInfo.model === 'Unknown' &&
    (filterNames.includes('CCITTFaxDecode') || filterNames.includes('JBIG2Decode'))
  ) {
    colorInfo = { ...colorInfo, model: 'Gray', isCmyk: false };
  }
  const colorModel = colorInfo.model;
  const isCmyk = colorInfo.isCmyk;

  // 2단계: 실제 이미지 데이터(바이트)를 필터에 따라 처리해서 "미리보기"를 만들 수 있는지 확인합니다.
  let bytes = xobj.contents; // 아직 압축이 풀리지 않은 원본 바이트
  let terminalFilter = null; // "그 자체로 완성된 이미지 포맷"인 필터를 찾으면 여기에 저장

  try {
    // 필터는 여러 개가 순서대로 적용되어 있을 수 있으므로 앞에서부터 하나씩 확인합니다.
    for (const filterName of filterNames) {
      if (IMAGE_FILTER_EXTENSION[filterName]) {
        // JPEG(DCTDecode)처럼 "이 필터 자체가 이미지 포맷"이면, 더 풀 필요 없이 멈춥니다.
        terminalFilter = filterName;
        break;
      }
      // FlateDecode처럼 그냥 압축인 필터라면, 압축을 풀어서 다음 단계로 넘어갑니다.
      bytes = applyGenericFilter(bytes, filterName);
    }
  } catch {
    // 압축을 풀 수 없는 필터를 만난 경우 (예: 지원하지 않는 필터) -
    // 미리보기는 포기하지만, 색상 모델 정보는 이미 알아냈으므로 그대로 반환합니다.
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
    // DCTDecode(JPEG)나 JPXDecode(JPEG2000)는 압축된 바이트 자체가 이미 "완성된 이미지 파일"이기
    // 때문에, 별도의 변환 없이 그 바이트를 그대로 base64로 인코딩해서 미리보기로 사용합니다.
    let previewDataUrl = null;
    if (terminalFilter === 'DCTDecode') {
      previewDataUrl = `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`;
    } else if (terminalFilter === 'JPXDecode') {
      previewDataUrl = `data:image/jp2;base64,${Buffer.from(bytes).toString('base64')}`;
    }
    // CCITTFaxDecode(팩스 압축), JBIG2Decode는 전용 디코더가 필요해서
    // 이 프로젝트에서는 미리보기를 만들지 않습니다(previewDataUrl이 null로 남음).
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

  // 여기까지 왔다면: "완성된 이미지 포맷" 필터가 없었다는 뜻 -> 압축만 풀린 순수 픽셀 데이터입니다.
  // 이런 경우는 PNG로 분류하고, 8비트 Gray 또는 RGB일 때만 실제로 미리보기 PNG를 만들어줍니다.
  // (팔레트 방식(Indexed)이나 CMYK, 그 외 특이한 형식은 변환 로직이 없어서 미리보기를 생략합니다.
  //  다만 CMYK 이미지는 어차피 이 앱에서 "정상"으로 취급해 화면에 표시하지 않으므로 문제되지 않습니다.)
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

// ----------------------------------------------------------------------------
// 리소스 딕셔너리 안의 XObject들을 훑으면서 이미지를 찾아 images 배열에 채워 넣는 함수입니다.
// XObject 중 Subtype이 "Form"인 것(투명도 그룹, 클리핑마스크, 레이어 등으로 콘텐츠를 감싸는 컨테이너)은
// 그 자체가 이미지가 아니라, 내부에 자기만의 Resources/XObject를 또 가지고 있을 수 있습니다.
// 즉 진짜 이미지가 Form 안에 중첩되어 있을 수 있으므로, 이 함수가 스스로를 재귀 호출해서
// Form 내부까지 파고듭니다. (안 그러면 Form으로 감싸진 non-CMYK 이미지를 통째로 놓치게 됩니다.)
// visited는 순환 참조(Form이 자기 자신을 가리키는 손상되었거나 악의적인 PDF)로 인한
// 무한 재귀를 막기 위한 안전장치입니다.
function collectImagesFromResources(resources, context, pageNumber, images, visited) {
  if (!resources) return;
  const xobjects = resources.lookupMaybe(PDFName.of('XObject'), PDFDict);
  if (!xobjects) return;

  xobjects.keys().forEach((key) => {
    const ref = xobjects.get(key);
    if (ref instanceof PDFRef) {
      const refKey = ref.toString();
      if (visited.has(refKey)) return; // 이미 방문한 객체면 순환 참조이므로 건너뜀
      visited.add(refKey);
    }

    const xobj = context.lookup(ref);
    if (!(xobj instanceof PDFRawStream)) return;

    const subtype = nameOf(xobj.dict.lookup(PDFName.of('Subtype')));
    if (subtype === 'Image') {
      const info = classifyImage(xobj, context);
      images.push({ id: `${pageNumber}-${key.decodeText()}`, page: pageNumber, ...info });
    } else if (subtype === 'Form') {
      const formResources = xobj.dict.lookupMaybe(PDFName.of('Resources'), PDFDict);
      collectImagesFromResources(formResources, context, pageNumber, images, visited);
    }
  });
}

// ============================================================================
// 이 파일에서 유일하게 외부(index.js)로 내보내는 함수입니다.
// PDF 파일 전체의 바이트(buffer)를 받아서, 안에 들어있는 모든 이미지를 찾아
// 분석한 결과를 하나의 객체로 정리해서 반환합니다.
// ============================================================================
export async function analyzePdf(buffer) {
  // pdf-lib으로 PDF 파일을 읽어들여서 구조를 파악합니다.
  // ignoreEncryption: 암호가 걸린 PDF라도 일단 읽기를 시도합니다.
  // updateMetadata: false -> 메타데이터(수정 날짜 등)를 자동으로 바꾸지 않도록 설정합니다.
  const pdfDoc = await PDFDocument.load(buffer, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const { context } = pdfDoc; // PDF 내부의 "참조(간접 참조)"를 실제 값으로 바꿔주는 도구
  const pages = pdfDoc.getPages(); // PDF의 모든 페이지 목록
  const images = []; // 찾아낸 이미지들을 여기에 하나씩 쌓아 나갑니다.

  // 모든 페이지를 순서대로 돌면서 그 안에 있는 이미지를 찾습니다.
  pages.forEach((page, pageIndex) => {
    const pageNumber = pageIndex + 1; // 배열 인덱스는 0부터 시작하므로, 사람이 보는 "1페이지"에 맞춰 +1

    // 페이지의 리소스(그 페이지에서 쓰는 폰트/이미지 등 자원 모음)를 가져옵니다.
    const resources = page.node.Resources();

    // 이미지는 페이지 리소스에 직접 있을 수도, Form XObject(투명도 그룹/클리핑마스크/레이어 등) 안에
    // 중첩되어 있을 수도 있으므로 재귀 함수로 훑습니다. visited는 페이지마다 새로 시작합니다.
    collectImagesFromResources(resources, context, pageNumber, images, new Set());
  });

  // 이제 찾아낸 이미지들을 "색상 모델별로" 묶어서 요약 통계를 만듭니다.
  // Map을 사용해서 "RGB", "CMYK", "Gray" 같은 모델 이름별로 그룹을 만듭니다.
  const byColorModel = new Map();
  images.forEach((img) => {
    if (!byColorModel.has(img.colorModel)) {
      // 해당 색상 모델 그룹이 아직 없으면 새로 만듭니다.
      // pages: Set을 쓰는 이유는 "이 색상 모델의 이미지가 등장한 페이지 번호"를
      // 중복 없이 모으기 위해서입니다 (같은 페이지에 같은 모델 이미지가 여러 개 있어도 한 번만 셈).
      byColorModel.set(img.colorModel, { model: img.colorModel, isCmyk: img.isCmyk, count: 0, pages: new Set() });
    }
    const group = byColorModel.get(img.colorModel);
    group.count += 1; // 이 색상 모델의 이미지 개수를 하나 늘림
    group.pages.add(img.page); // 이 이미지가 있는 페이지 번호를 기록
  });

  // Map에 모아둔 그룹 정보를, 프론트엔드로 보내기 좋은 배열 형태로 바꿉니다.
  const colorModels = [...byColorModel.values()]
    .map((group) => ({
      model: group.model,
      isCmyk: group.isCmyk,
      count: group.count,
      pageCount: group.pages.size, // 이 색상 모델이 나타난 서로 다른 페이지의 개수
      pages: [...group.pages].sort((a, b) => a - b), // 페이지 번호를 오름차순으로 정렬
    }))
    .sort((a, b) => b.count - a.count); // 이미지 개수가 많은 색상 모델부터 보이도록 정렬

  // CMYK가 아닌 이미지의 총 개수 (이 프로젝트에서 사용자가 가장 궁금해하는 숫자!)
  const nonCmykCount = images.filter((img) => !img.isCmyk).length;

  // 최종적으로 프론트엔드에 돌려줄 결과 객체입니다.
  return {
    pageCount: pages.length, // PDF 전체 페이지 수
    imageCount: images.length, // 찾아낸 이미지 총 개수
    nonCmykCount, // 그중 CMYK가 아닌 이미지 개수
    colorModels, // 색상 모델별 요약 (표에 사용)
    images, // 이미지 하나하나에 대한 상세 정보 (미리보기 목록에 사용)
  };
}
