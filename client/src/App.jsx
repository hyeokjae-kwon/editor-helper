import { useState } from 'react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:4000'

function App() {
  const [file, setFile] = useState(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleFileChange = (e) => {
    setFile(e.target.files?.[0] ?? null)
    setResult(null)
    setError('')
  }

  const handleAnalyze = async () => {
    if (!file) return
    setLoading(true)
    setError('')
    setResult(null)

    const formData = new FormData()
    formData.append('pdf', file)

    try {
      const res = await fetch(`${API_BASE}/api/analyze`, {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '분석에 실패했습니다.')
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <h1>PDF 이미지 확장자 분석기</h1>
      <p className="subtitle">PDF 파일을 업로드하면 안에 포함된 이미지의 확장자를 찾아드려요.</p>

      <div className="upload-box">
        <input type="file" accept="application/pdf" onChange={handleFileChange} />
        <button type="button" onClick={handleAnalyze} disabled={!file || loading}>
          {loading ? '분석 중...' : '분석하기'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {result && (
        <div className="result">
          <p className="summary">
            <strong>{result.fileName}</strong> · 총 {result.pageCount}페이지 · 이미지 {result.imageCount}개
          </p>

          <table className="ext-table">
            <thead>
              <tr>
                <th>확장자</th>
                <th>이미지 수</th>
                <th>포함된 페이지 수</th>
                <th>페이지 번호</th>
              </tr>
            </thead>
            <tbody>
              {result.extensions.map((ext) => (
                <tr key={ext.ext}>
                  <td className="ext-badge">.{ext.ext}</td>
                  <td>{ext.count}</td>
                  <td>{ext.pageCount}</td>
                  <td>{ext.pages.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>미리보기</h2>
          <div className="preview-grid">
            {result.images.map((img) => (
              <div className="preview-card" key={img.id}>
                {img.previewDataUrl ? (
                  <img src={img.previewDataUrl} alt={`${img.page}페이지 .${img.ext} 이미지`} />
                ) : (
                  <div className="no-preview">미리보기 불가</div>
                )}
                <div className="preview-meta">
                  <span className="ext-badge">.{img.ext}</span>
                  <span>{img.page}페이지</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
