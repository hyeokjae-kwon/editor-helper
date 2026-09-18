# CLAUDE.md

이 파일은 이 저장소에서 작업할 때 Claude Code(claude.ai/code)에게 가이드가 되는 문서입니다.

## 프로젝트 개요

PDF/이미지 색상모델 분석기입니다: PDF 파일 *또는* 낱장 이미지 파일(JPG/PNG/TIFF)을 업로드하면, 그 안에 포함된 이미지 중 CMYK가 *아닌* 것들(Gray/RGB/Indexed 등)을 어느 페이지에 있는지와 함께 보여주고, 가능한 경우 썸네일 미리보기까지 제공합니다. 루트에 공용 `package.json`이 없는 2-패키지 모노레포이며, `client/`와 `server/`는 각각 따로 설치·실행합니다.

### 대상 사용자

교과서 제작 회사의 편집자입니다. 인쇄 결과물은 반드시 CMYK여야 하며, RGB·Gray 등 CMYK가 아닌 색상공간으로 들어간 이미지는 인쇄 전에 찾아내서 다시 내보내야 합니다. 기능이나 UI 문구를 정할 때 이 워크플로우를 염두에 두세요 — 이 앱은 의도적으로 전체 이미지 목록이 아니라 CMYK가 아닌 이미지만 골라서 보여주며, "미리보기 불가"로 뜨는 포맷(CCITT/JBIG2 이진 스캔본)이야말로 사람이 직접 확인해야 할 가능성이 가장 높은 대상입니다.

## 코드 주석

이 저장소의 소스 코드를 추가하거나 수정할 때는, 그 내용을 설명하는 한글 주석을 달아주세요 — 읽는 사람이 프로그래밍 경험이 거의 없는 대학교 1학년이라고 가정합니다(이 저장소는 학습용 예제로도 쓰이고 있습니다). 주석은 아끼지 말고, 코드가 *무엇을* 하는지뿐 아니라 *왜* 그렇게 하는지도 설명하며, 당연히 알 거라고 가정하지 말고 언어/라이브러리의 낯선 동작(예: PDF 내부 구조, async/await, React state)도 풀어서 적어주세요. `pdfAnalyzer.js`, `imageAnalyzer.js`, `App.jsx`에 이미 적용된 스타일을 따르면 됩니다.

## 명령어

```bash
# 백엔드 (Express API, :4000 포트)
cd server && npm install
npm run dev     # node --watch src/index.js (파일 바뀌면 자동 재시작)
npm start       # node src/index.js

# 프론트엔드 (Vite 개발 서버, :5173 포트)
cd client && npm install
npm run dev
npm run build    # client/dist 에 프로덕션 빌드 생성
npm run lint     # oxlint
npm run preview  # 프로덕션 빌드 미리보기
```

두 패키지 모두 테스트 스위트는 없습니다(`server`의 `npm test`는 설정되지 않은 기본 스텁입니다).

프론트엔드는 `VITE_API_BASE`를 통해 백엔드를 호출합니다. 로컬 개발 중(`import.meta.env.DEV`)에는 기본값이 `http://localhost:4000`인데, Vite와 Express가 서로 다른 포트에서 별개의 개발 서버로 떠 있기 때문입니다 — 둘 다 실행 중이어야 앱이 정상 동작합니다. 반면 프로덕션 빌드에서는 기본값이 빈 문자열(같은 출처를 쓰는 상대경로)이 되는데, 이는 아래 배포 방식과 맞물려 있습니다.

## 배포

서버가 빌드된 프론트엔드를 직접 서빙하도록 되어 있어서(`server/src/index.js`에 `express.static(path.join(__dirname, '../../client/dist'))`가 `/api/analyze` 라우트 *다음에* 추가되어 있음 — API 라우트를 가리지 않기 위함), 전체 앱을 서버 하나로 배포할 수 있습니다. Render 같은 플랫폼에서는 이 GitHub 저장소를 연결하고 아래처럼 설정하면 됩니다.

```
Build Command: npm install --prefix client && npm run build --prefix client && npm install --prefix server
Start Command: npm start --prefix server
```

따로 설정해야 할 환경변수는 없습니다 — `client/src/App.jsx`의 `API_BASE`는 프로덕션 빌드에서 이미 같은 출처의 상대경로(`''`)로 정해지고(위 참고), 서버도 이미 환경변수 `PORT`를 읽습니다(`server/src/index.js`, 로컬에서는 4000으로 대체). GitHub 자동배포를 지원하는 플랫폼(예: Render)이라면 `main`에 push할 때마다 재빌드·재배포가 일어나며, 플랫폼이 제공하는 서브도메인의 HTTPS는 별도 설정 없이 자동 적용됩니다.

## 아키텍처

### 백엔드 (`server/`, Node ESM + Express)

- `src/index.js` — Express 앱 하나로 구성됩니다. 라우트는 `POST /api/analyze` 하나뿐이며, `multipart/form-data`로 필드명 `file`인 파일 업로드를 받습니다(`multer` 사용, 메모리 저장, 50MB 제한 — 필드명은 이미지 업로드가 추가되면서 `pdf`에서 `file`로 바뀌었습니다). 요청 본문의 형식은 클라이언트가 보내는 `mimetype`/확장자로 판단하지 **않고**, 버퍼의 매직 바이트로 직접 판별합니다(PDF는 `%PDF-` 헤더, 그 외에는 `imageAnalyzer.js`의 `detectImageFormat()`) — 이후 `analyzePdf()` 또는 `analyzeImageFile()`로 라우팅되며, 알 수 없는 형식이면 400을 반환합니다. 업로드된 파일의 `originalname`은 `latin1`으로 다시 디코드한 뒤 `utf8`로 재해석해서 `fileName`으로 응답합니다 — multer/busboy가 멀티파트 파일명을 기본적으로 latin1로 해석하기 때문에, 그대로 두면 한글 등 비ASCII 파일명이 깨지기 때문입니다.
- `src/pdfAnalyzer.js` — PDF에 대한 핵심 분석 로직입니다. PDF 버퍼를 받으면 `pdf-lib`으로 모든 페이지의 `Resources/XObject` 딕셔너리를 훑으면서 각 이미지 XObject를 직접 들여다봅니다(pdfjs처럼 전체를 렌더링하지 않습니다):
  - `resolveColorSpace()`는 이미지 딕셔너리의 `ColorSpace` 항목을 읽어서 `{ model, channels, bitsPerComponent, isIndexed, isCmyk }` 형태로 해석합니다 — 단순 이름(`DeviceGray`/`DeviceRGB`/`DeviceCMYK`/`Lab`), `ICCBased`(`N` 채널 수로 판단), `Indexed`(기준 색상공간으로 재귀), `Separation`/`DeviceN`까지 처리합니다. `ColorSpace`가 명시되지 않은 CCITT/JBIG2 스트림은 스펙에 따라 기본값을 `Gray`로 둡니다.
  - `classifyImage()`는 여기에 `Filter` 체인 정보를 더해 실제 파일 형식 라벨(`ext`: jpg/jp2/tiff/jbig2/png)과 가능하면 미리보기까지 만듭니다: DCT/JPX 스트림은 그 자체로 완성된 이미지 바이트이므로 바로 data URL로 반환하고, 순수 픽셀 데이터만 있는 스트림(FlateDecode 같은 범용 필터만 적용된 경우)은 8비트 Gray/RGB일 때만 RGBA 버퍼로 재조립해서 `pngjs`로 PNG로 재인코딩합니다(`buildPngDataUrl` 참고). CCITT/JBIG2는 미리보기를 만들지 않습니다(전용 팩스/JBIG2 디코더가 필요해서 범위 밖으로 둠).
  - `collectImagesFromResources()`는 `Resources/XObject` 딕셔너리를 훑으면서, `Subtype`이 `Form`인 XObject를 만나면 그 안으로 재귀합니다(투명도 그룹·클리핑마스크·OCG 레이어 등은 InDesign/Illustrator 출력물에서 이미지를 이런 식으로 중첩시키는 경우가 흔합니다) — `PDFRef.toString()`을 키로 쓰는 `visited` `Set`으로 손상되었거나 악의적인 PDF의 순환 참조를 방어합니다. 페이지마다 새 `visited` 셋으로 한 번씩 호출됩니다.
  - `analyzePdf()`는 문서 전체의 이미지를 색상모델별로 묶고(`colorModels: [{ model, isCmyk, count, pageCount, pages }]`), 이미지별 평면 목록(`images: [{ id, page, ext, colorModel, isCmyk, width, height, filters, previewDataUrl }]`)과 `nonCmykCount`를 함께 반환합니다.
  - PDF 처리를 확장할 때 건드릴 지점: `resolveColorSpaceValue()`(색상공간 → model/isCmyk)와 `classifyImage()`(이미지별 `ext`/미리보기). 알려진 한계: 이미지의 `/ColorSpace`가 `Resources/ColorSpace` 안의 *이름 참조*로 주어진 경우(Illustrator/InDesign 출력물에서 흔한 `/CS0` 같은 것)는 그 딕셔너리를 실제로 찾아서 해석하지 않고, "알 수 없는 이름" 분기로 빠집니다.
- `src/imageAnalyzer.js` — PDF에 포함되지 않은 **낱장** 이미지 파일을 분석합니다. 파일 포맷을 바이트로 판별한 뒤, 이미지 전체를 디코딩하지 않고 헤더만 필요한 만큼 읽어서 색상모델을 알아냅니다:
  - `detectImageFormat()` — `jpeg`/`png`/`tiff`를 매직 바이트로 판별합니다.
  - `classifyJpeg()` — JFIF 마커를 따라가서 SOF 세그먼트를 찾고, 컴포넌트 개수로 모델을 판단합니다(1=Gray, 3=RGB, 4=CMYK/YCCK — 어느 쪽이든 CMYK로 취급하며, 이는 `pdfAnalyzer.js`의 ICCBased `N` 채널 수 판정 방식과 같은 논리입니다).
  - `classifyPng()` — IHDR의 `colorType` 바이트를 직접 읽습니다. PNG 스펙 자체에 CMYK 색상 타입이 없으므로, 유효한 PNG는 항상 non-CMYK로 판정됩니다.
  - `classifyTiff()` — 첫 번째 IFD에서 태그 262(`PhotometricInterpretation`)를 찾습니다. 5 = CMYK(Separated)이며, CMYK TIFF는 인쇄 워크플로우에서 흔히 쓰이는 결과물이라 이 프로젝트 목적상 중요합니다.
  - `analyzeImageFile()` — 위 함수들 중 하나의 결과를 `analyzePdf()`가 반환하는 것과 같은 모양(`pageCount`/`imageCount`/`nonCmykCount`/`colorModels`/`images`)으로 감싸며, `page`는 `1`로 고정됩니다. JPEG/PNG는 `previewDataUrl`을 갖지만(원본 바이트 자체가 이미 브라우저에서 바로 보여줄 수 있는 형식이므로), TIFF는 갖지 않습니다(브라우저 내장 디코더가 없어서, CCITT/JBIG2와 같은 "미리보기 불가" 처리를 합니다).

### 프론트엔드 (`client/`, React 19 + Vite)

- 별도 라우터 없는 단일 페이지 앱입니다. `src/App.jsx`가 모든 상태(선택한 파일, 분석 결과, 로딩/에러, 지금 확대해서 보고 있는 미리보기 이미지)를 들고 있고, `FormData`로 `/api/analyze`에 직접 fetch합니다(필드명 `file`, `<input>`의 `accept="application/pdf,image/jpeg,image/png,image/tiff"`). 초기화 버튼은 file/result/error 상태를 비우고, `ref`를 통해 네이티브 파일 입력창도 리셋합니다(`<input type="file">`은 uncontrolled 요소라 이렇게 해야 합니다).
- 레이아웃은 고정된 왼쪽 사이드바(`.sidebar`: 브랜드 "편집자 도우미" + `.side-nav`, 지금은 메뉴 항목 하나)와 나머지 공간을 채우는 `<main className="content">`로 구성됩니다 — 나중에 기능이 늘어나면 `.side-nav-item`을 더 추가하면 되고, 아직 라우터는 필요 없습니다. `#root`에는 `max-width`가 없어서 레이아웃이 의도적으로 화면 전체 너비를 채우며, `.result`/`.preview-grid`도 그에 맞게 크기가 정해집니다(`.preview-grid`는 고정 열 개수가 아니라 `repeat(auto-fill, minmax(160px, 1fr))`입니다).
- 색상모델 요약 **표는 항상 렌더링됩니다**: CMYK가 아닌 이미지가 있으면 `result.colorModels.filter(!isCmyk)`를 보여주고, 전부 CMYK라면 전체 `result.colorModels`(즉 CMYK 한 줄)로 대체해서 보여줍니다 — 그래서 깨끗한 파일이어도 텍스트 한 줄이 아니라 표 자체는 항상 눈에 보입니다. **미리보기 영역은 조건부**입니다 — CMYK가 아닌 이미지가 하나라도 있을 때만(클라이언트에서 만든 `imagesByPage`로 페이지별로 묶어서) 렌더링되며, `previewDataUrl`이 없는 항목은 `<img>` 대신 "미리보기 불가" placeholder를 보여줍니다. 미리보기 `<img>`를 클릭하면 네이티브 `<dialog>`(`.preview-dialog`, ref는 `previewDialogRef`)로 확대해서 보여줍니다 — Esc로 닫기와 배경(backdrop)은 브라우저의 `<dialog>` 기본 동작이며, 바깥 클릭으로 닫는 처리는 `e.target === e.currentTarget`만 확인하는 간단한 핸들러입니다.
- 스타일은 순수 CSS(`App.css`, `index.css`)이며, `index.css`에 정의된 CSS 커스텀 프로퍼티(`--accent`, `--border`, `--bg`, `--sidebar-bg` 등)를 씁니다. 이 앱은 **항상 밝은(라이트) 테마**입니다 — `prefers-color-scheme: dark` 블록이 없고(제거됨, `color-scheme: light`를 명시적으로 지정), 요청 없이 다크모드 변형을 다시 넣지 마세요. `--accent`는 파란색-하늘색 중간톤(`#1a84ea`)이며, 전체를 물들이는 주색이 아니라 곳곳의 포인트(사이드바 활성 메뉴, 기본 버튼, 뱃지 칩, 섹션 제목 앞 "—" 장식, `#root` 상단의 3px 라인)로만 절제해서 씁니다. 뱃지/라벨 스타일(`.ext-badge`, 버튼)은 알약(pill) 모양(`border-radius: 999px`)과 `var(--mono)`를 쓰며, **`.ext-badge`는 반드시 표 셀 안의 `<span>`에 적용해야 하고, `<td>`에 직접 적용하면 안 됩니다** — 셀 자체에 pill 모양 radius를 주면 표의 셀 테두리와 부딪혀서 깨져 보입니다.
- `App.css`의 반응형 분기점(전부 max-width 기준, 사이드바 우선 방식): **1024px 이하**에서는 사이드바를 쌓지 않고 폭만 줄입니다(240px → 200px), 본문 패딩도 함께 줄입니다 — 대부분의 태블릿은 세로 모드여도(아이패드 미니 이상, 744px 이상) 이 기준보다 넉넉히 넓어서, 데스크톱과 같은 좌우 배치를 그대로 유지합니다. **640px 이하**가 실제로 "사이드바를 본문 위로 쌓는" 분기점이며, 태블릿이 아니라 스마트폰을 겨냥한 것입니다. 이와 별개로 `@media (pointer: coarse)`는 화면 너비와 무관하게 터치 입력이면 버튼/메뉴 항목의 패딩을 키워줍니다. 결과 표(`.ext-table`)는 `.table-scroll`(`overflow-x: auto`)로 감싸여 있어서, 페이지 번호 목록이 아주 길어져도 페이지 전체 레이아웃이 무너지지 않고 표 안에서만 가로 스크롤됩니다.
