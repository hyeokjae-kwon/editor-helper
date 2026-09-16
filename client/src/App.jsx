import { useRef, useState } from 'react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:4000'

function App() {
  const [file, setFile] = useState(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)

  const handleFileChange = (e) => {
    setFile(e.target.files?.[0] ?? null)
    setResult(null)
    setError('')
  }

  const handleReset = () => {
    setFile(null)
    setResult(null)
    setError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
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

  const nonCmykModels = result?.colorModels.filter((group) => !group.isCmyk) ?? []
  const nonCmykImages = result?.images.filter((img) => !img.isCmyk) ?? []

  const imagesByPage = []
  nonCmykImages.forEach((img) => {
    let group = imagesByPage.find((g) => g.page === img.page)
    if (!group) {
      group = { page: img.page, images: [] }
      imagesByPage.push(group)
    }
    group.images.push(img)
  })
  imagesByPage.sort((a, b) => a.page - b.page)

  return (
    <div className="page">
      <h1>PDF 이미지 색상모델 분석기</h1>
      <p className="subtitle">PDF 파일을 업로드하면 안에 포함된 이미지 중 CMYK가 아닌 것을 찾아드려요.</p>

      <div className="upload-box">
        <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handleFileChange} />
        <button type="button" onClick={handleAnalyze} disabled={!file || loading}>
          {loading ? '분석 중...' : '분석하기'}
        </button>
        <button type="button" onClick={handleReset} disabled={loading || (!file && !result && !error)}>
          초기화
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {result && (
        <div className="result">
          <p className="summary">
            <strong>{result.fileName}</strong> · 총 {result.pageCount}페이지 · 이미지 {result.imageCount}개 중{' '}
            <strong>CMYK 아님 {result.nonCmykCount}개</strong>
          </p>

          {nonCmykModels.length === 0 ? (
            <p className="summary">모든 이미지가 CMYK 색상모델입니다.</p>
          ) : (
            <>
              <table className="ext-table">
                <thead>
                  <tr>
                    <th>색상모델</th>
                    <th>이미지 수</th>
                    <th>포함된 페이지 수</th>
                    <th>페이지 번호</th>
                  </tr>
                </thead>
                <tbody>
                  {nonCmykModels.map((group) => (
                    <tr key={group.model}>
                      <td className="ext-badge">{group.model}</td>
                      <td>{group.count}</td>
                      <td>{group.pageCount}</td>
                      <td>{group.pages.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h2>미리보기 (CMYK 아닌 이미지)</h2>
              {imagesByPage.map((group) => (
                <div className="preview-page-group" key={group.page}>
                  <h3 className="preview-page-title">{group.page}페이지</h3>
                  <div className="preview-grid">
                    {group.images.map((img) => (
                      <div className="preview-card" key={img.id}>
                        {img.previewDataUrl ? (
                          <img src={img.previewDataUrl} alt={`${img.page}페이지 ${img.colorModel} 이미지`} />
                        ) : (
                          <div className="no-preview">미리보기 불가</div>
                        )}
                        <div className="preview-meta">
                          <span className="ext-badge">{img.colorModel}</span>
                          <span>{img.page}페이지</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default App
