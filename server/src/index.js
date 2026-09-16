import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { analyzePdf } from './pdfAnalyzer.js';

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

app.use(cors());

app.post('/api/analyze', upload.single('pdf'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'PDF 파일이 필요합니다.' });
  }
  if (req.file.mimetype !== 'application/pdf') {
    return res.status(400).json({ error: 'PDF 파일만 업로드할 수 있습니다.' });
  }

  try {
    const result = await analyzePdf(req.file.buffer);
    // multer/busboy decode multipart filenames as latin1 by default, so a
    // UTF-8 filename (e.g. Korean) sent by the browser comes through mangled.
    const fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    res.json({ fileName, ...result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'PDF 분석 중 오류가 발생했습니다.' });
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
