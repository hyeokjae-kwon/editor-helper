// 이 파일은 백엔드(서버) 프로그램의 시작점(entry point)입니다.
// "Express"라는 라이브러리를 이용해서 웹 요청을 받아 처리하는 작은 웹 서버를 만듭니다.
// 역할: 브라우저(프론트엔드)가 PDF 파일을 업로드하면, 그 파일을 분석해서
//       결과를 JSON 형태로 다시 돌려주는 API 서버입니다.

import path from 'node:path'; // 파일 경로를 다루는 Node.js 내장 모듈 (client/dist 폴더 위치를 찾는 데 사용)
import { fileURLToPath } from 'node:url'; // ESM에서는 __dirname이 기본으로 없어서, 이 함수로 직접 만들어야 함
import express from 'express'; // Node.js에서 웹 서버를 쉽게 만들게 해주는 라이브러리
import cors from 'cors'; // 다른 주소(포트)의 프론트엔드에서 오는 요청을 허용해주는 라이브러리
import multer from 'multer'; // 파일 업로드(멀티파트 폼 데이터)를 처리해주는 라이브러리
import { analyzePdf } from './pdfAnalyzer.js'; // 실제 PDF 분석 로직이 들어있는 함수
import { detectImageFormat, analyzeImageFile } from './imageAnalyzer.js'; // 낱장 이미지 파일(JPG/PNG/TIFF) 분석 로직

// 이 파일(index.js) 자신이 디스크의 어느 폴더에 있는지 알아내기 위한 절차입니다.
// (CommonJS의 __dirname과 같은 역할이지만, ESM 모듈에서는 직접 이렇게 만들어줘야 합니다.)
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// express() 를 호출하면 하나의 "웹 서버 앱"이 만들어집니다.
// 이 app 객체에 "어떤 주소로 요청이 오면 어떤 함수를 실행할지"를 등록해나갑니다.
const app = express();

// multer는 파일 업로드를 처리하는 미들웨어(중간 처리기)입니다.
// storage: multer.memoryStorage() -> 업로드된 파일을 디스크에 저장하지 않고
//          메모리(RAM)에 잠깐 올려두고 바로 사용합니다. (파일을 디스크에 남기지 않음)
// limits: fileSize -> 업로드 가능한 파일 최대 크기를 50MB로 제한합니다.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 * 1024 * 1024 바이트 = 50MB
});

// cors()를 사용하면 프론트엔드(예: http://localhost:5173)처럼
// 다른 포트/주소에서 오는 요청도 브라우저가 차단하지 않고 허용해줍니다.
// (기본적으로 브라우저는 보안 때문에 다른 출처(origin)로의 요청을 막는데, 이를 풀어주는 설정)
app.use(cors());

// "POST /api/analyze" 주소로 요청이 들어왔을 때 실행되는 부분입니다.
// upload.single('file') -> 요청에 담긴 파일 중 필드 이름이 'file'인 파일 하나를 꺼내서
//                         req.file 에 담아줍니다.
// async (req, res) => {...} -> 실제 요청을 처리하는 함수. req(요청), res(응답) 두 값을 받습니다.
app.post('/api/analyze', upload.single('file'), async (req, res) => {
  // 파일이 아예 안 들어온 경우 (사용자가 파일 없이 요청을 보낸 경우) 에러 응답
  if (!req.file) {
    return res.status(400).json({ error: '파일이 필요합니다.' });
  }

  // mimetype/확장자 대신 파일의 실제 바이트(매직 넘버)로 형식을 판별합니다.
  // (브라우저가 보내주는 mimetype은 부정확하거나 없을 수 있어서 더 신뢰할 수 있는 방법)
  const isPdf = req.file.buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  const imageFormat = isPdf ? null : detectImageFormat(req.file.buffer);
  if (!isPdf && !imageFormat) {
    return res.status(400).json({ error: 'PDF 또는 이미지(JPG/PNG/TIFF) 파일만 업로드할 수 있습니다.' });
  }

  try {
    // 실제로 파일 내용을 분석하는 함수를 호출합니다.
    // req.file.buffer 에는 업로드된 파일의 실제 바이트(이진 데이터)가 들어있습니다.
    const result = isPdf ? await analyzePdf(req.file.buffer) : analyzeImageFile(req.file.buffer, imageFormat);

    // 참고(중요): multer가 내부적으로 사용하는 busboy 라이브러리는
    // 파일 이름(originalname)을 기본적으로 'latin1'이라는 옛날 방식의 문자 인코딩으로 해석합니다.
    // 그런데 브라우저는 한글 파일명을 'utf8' 방식으로 인코딩해서 보내기 때문에,
    // 그대로 사용하면 한글 파일명이 깨진 글자로 보이게 됩니다.
    // 그래서 아래처럼 "일단 latin1으로 읽었던 걸 다시 utf8로 재해석"해서 원래의 한글 파일명으로 복원합니다.
    const fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

    // 분석 결과(result)와 파일 이름을 합쳐서 JSON 형태로 응답합니다.
    // { fileName, ...result } 는 { fileName: fileName, (result 안의 모든 속성들) } 과 같은 뜻입니다.
    res.json({ fileName, ...result });
  } catch (err) {
    // 분석 도중 예상치 못한 에러가 발생하면 서버 콘솔에 로그를 남기고
    // 클라이언트(브라우저)에는 500번(서버 내부 오류) 상태 코드로 에러 메시지를 응답합니다.
    console.error(err);
    res.status(500).json({ error: '파일 분석 중 오류가 발생했습니다.' });
  }
});

// 프론트엔드(React) 빌드 결과물을 이 서버가 같이 서빙합니다.
// 배포할 때 client를 따로 호스팅하지 않고, 백엔드 서버 하나로 "정적 파일(HTML/JS/CSS) 응답"과
// "/api/analyze API 응답"을 둘 다 처리하게 해서 서버를 한 곳에만 올리면 되도록 하기 위함입니다.
// express.static은 요청 경로가 실제 파일과 일치하면 그 파일을 보내주고(예: /assets/xxx.js),
// "/" 처럼 폴더 경로면 그 안의 index.html을 자동으로 찾아서 보내줍니다.
// (로컬 개발 중에는 client/dist가 없을 수 있는데, 그런 경우엔 이 미들웨어가 그냥 아무것도
//  못 찾고 다음으로 넘어가므로 - 평소처럼 Vite 개발 서버를 따로 켜서 써도 문제없습니다.)
app.use(express.static(path.join(__dirname, '../../client/dist')));

// 에러 처리 전용 미들웨어입니다.
// 매개변수가 4개(err, req, res, next)인 함수는 Express에서 특별히
// "에러가 발생했을 때 실행되는 함수"로 인식됩니다.
// (req, next 는 이 함수 안에서 쓰지 않아서 이름 앞에 _를 붙여 "안 쓴다"는 걸 표시했습니다)
app.use((err, _req, res, _next) => {
  // multer 자체에서 발생한 에러(예: 파일 크기 제한 초과 등)인 경우
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  // 그 외의 예상치 못한 서버 에러
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

// 서버가 실제로 요청을 받을 포트 번호를 정합니다.
// 환경변수 PORT가 설정되어 있으면 그 값을 쓰고, 없으면 기본값 4000번 포트를 사용합니다.
const PORT = process.env.PORT || 4000;

// 서버를 실제로 실행(구동)합니다. 이 코드가 실행되고 나면
// http://localhost:4000 주소로 오는 요청을 받을 준비가 된 것입니다.
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
