# 편집자 도우미

PDF 또는 이미지 파일(JPG/PNG/TIFF)을 업로드하면, 그 안에 들어있는 이미지 중 **인쇄용 색상모델(CMYK)이 아닌 이미지**를 찾아서 어느 페이지에 있는지 알려주는 웹 도구입니다.

## 왜 필요한가요?

교과서 같은 인쇄물은 최종 출력이 반드시 CMYK(청록·자홍·노랑·검정 4색 인쇄) 색상모델이어야 합니다. 그런데 편집 과정에서 이미지가 실수로 RGB(화면용)나 Gray(흑백) 색상모델로 들어가는 경우가 있고, 이런 이미지는 인쇄 전에 반드시 CMYK로 다시 뽑아야 합니다. 이 도구는 파일 전체를 한 장씩 눈으로 확인하는 대신, CMYK가 아닌 이미지만 자동으로 걸러서 보여줍니다.

## 주요 기능

- **PDF 분석**: PDF 안의 모든 페이지를 훑어서 이미지들의 색상모델을 판별합니다. 이미지가 투명도 그룹/클리핑마스크 같은 Form 안에 중첩되어 있어도 놓치지 않습니다.
- **낱장 이미지 분석**: PDF 없이 JPG/PNG/TIFF 이미지 파일 하나만 올려도 색상모델을 바로 확인할 수 있습니다.
- **CMYK가 아닌 이미지만 표시**: 색상모델별 요약 표와 페이지별 미리보기를 보여주되, 이미 CMYK인 이미지는 굳이 보여주지 않습니다(모두 CMYK면 그 사실을 알려주는 표만 나옵니다).
- **미리보기 확대보기**: 미리보기 이미지를 클릭하면 크게 확대해서 볼 수 있습니다.
- **PC/태블릿/모바일 반응형**: 화면 크기에 맞춰 레이아웃이 자동으로 조정됩니다.

## 기술 스택

- **백엔드**: Node.js + Express, PDF 파싱은 [`pdf-lib`](https://github.com/Hopding/pdf-lib), PNG 인코딩은 [`pngjs`](https://github.com/lukeapage/pngjs)
- **프론트엔드**: React 19 + Vite (별도 라우터 없는 단일 페이지 앱)

두 패키지(`client/`, `server/`)를 따로 설치·실행하는 모노레포 구조이며, 루트에 공용 `package.json`은 없습니다.

## 로컬에서 실행하기

백엔드와 프론트엔드를 각각 다른 터미널에서 띄워야 합니다.

```bash
# 백엔드 (http://localhost:4000)
cd server
npm install
npm run dev

# 프론트엔드 (http://localhost:5173)
cd client
npm install
npm run dev
```

브라우저에서 프론트엔드 주소(`http://localhost:5173`)로 접속하면 됩니다.

## 배포하기

배포용 빌드에서는 백엔드 서버가 프론트엔드 빌드 결과물까지 함께 서빙하도록 되어 있어서, 서버 하나만 올리면 됩니다. [Render](https://render.com) 같은 플랫폼에서 이 저장소를 연결하고 아래처럼 설정하면 됩니다.

```
Build Command: npm install --prefix client && npm run build --prefix client && npm install --prefix server
Start Command: npm start --prefix server
```

별도로 설정해야 할 환경변수는 없습니다. `main` 브랜치에 push할 때마다 자동으로 재배포됩니다(연결한 플랫폼이 GitHub 자동배포를 지원하는 경우).

## 프로젝트 구조

```
editor-helper/
├── client/            # 프론트엔드 (React + Vite)
│   └── src/
│       ├── App.jsx    # 화면 전체를 담당하는 단 하나의 컴포넌트
│       ├── App.css
│       └── index.css
└── server/            # 백엔드 (Express)
    └── src/
        ├── index.js         # API 서버 진입점 (POST /api/analyze)
        ├── pdfAnalyzer.js   # PDF 안 이미지 색상모델 분석
        └── imageAnalyzer.js # 낱장 이미지(JPG/PNG/TIFF) 색상모델 분석
```

더 자세한 아키텍처 설명은 [CLAUDE.md](./CLAUDE.md)를 참고하세요.
