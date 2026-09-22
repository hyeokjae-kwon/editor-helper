// ============================================================================
// 이 파일은 사이드바 메뉴 중 "imgfind"(색상모델 분석) 화면 하나를 담당하는 컴포넌트입니다.
// 원래는 app.jsx 안에 전부 들어있던 코드인데, app.jsx가 여러 화면(메인 화면 + imgfind 등)을
// 오가는 "껍데기" 역할을 맡게 되면서, imgfind 기능 자체는 이 파일로 분리했습니다.
// React를 처음 보는 사람을 위해 간단히 설명하면:
//   - "컴포넌트"는 화면의 한 부분을 그려내는 자바스크립트 함수입니다.
//   - useState는 "이 값이 바뀌면 화면을 다시 그려줘"라고 React에게 알려주는 상태(state) 저장소입니다.
//   - 이 파일은 별도의 페이지 이동(라우팅) 없이, 하나의 화면 안에서
//     "파일 선택 -> 서버에 분석 요청 -> 결과 보여주기" 흐름을 모두 처리합니다.
// ============================================================================

import { useRef, useState } from 'react'

// 백엔드(서버) API의 기본 주소입니다.
// .env 파일 등에서 VITE_API_BASE 값을 설정해두면 그 값을 우선 씁니다.
// 값이 없으면: 로컬 개발 중(import.meta.env.DEV)에는 별도 포트(4000)에 떠있는 백엔드를 바라보고,
// 배포된 빌드에서는 빈 문자열을 써서 "지금 이 페이지를 서빙해준 주소"에 그대로 요청하게 만듭니다.
// (배포 시엔 백엔드가 프론트 빌드 결과까지 같이 서빙하므로 둘이 같은 주소 = 같은 출처가 되고,
//  그러면 서버 주소를 따로 몰라도 되고 CORS 걱정도 없어집니다.)
const API_BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? 'http://localhost:4000' : '')

function Imgfind() {
  // ---- 상태(state) 선언 부분 ------------------------------------------------
  // useState(초기값) 은 [현재값, 값을바꾸는함수] 쌍을 돌려줍니다.
  // 아래 상태 중 하나라도 바뀌면 React가 이 컴포넌트를 자동으로 다시 그려줍니다.
  const [file, setFile] = useState(null) // 사용자가 선택한 파일(PDF 또는 이미지, 아직 선택 안 했으면 null)
  const [result, setResult] = useState(null) // 서버에서 받아온 분석 결과 (아직 없으면 null)
  const [loading, setLoading] = useState(false) // 지금 서버에 요청을 보내고 응답을 기다리는 중인지
  const [error, setError] = useState('') // 에러 메시지 (없으면 빈 문자열)

  // <input type="file"> 태그 자체를 직접 가리키기 위한 ref입니다.
  // React에서는 보통 상태(state)로 화면을 관리하지만, 파일 입력창은 보안상의 이유로
  // 자바스크립트가 값을 직접 설정할 수 없는 "제어되지 않는(uncontrolled)" 요소입니다.
  // 그래서 "초기화" 버튼을 눌렀을 때 화면에 표시된 파일명을 지우려면,
  // 이렇게 ref를 이용해 DOM 요소에 직접 접근해서 .value = '' 로 비워줘야 합니다.
  const fileInputRef = useRef(null)

  // 미리보기 이미지를 클릭했을 때 확대해서 보여줄 <dialog> 태그를 가리키는 ref입니다.
  // <dialog>는 브라우저가 기본으로 지원하는 모달 창으로, Esc로 닫기/바깥 배경 어둡게 처리를
  // 직접 구현할 필요 없이 공짜로 제공해줍니다.
  const previewDialogRef = useRef(null)
  const [zoomedImage, setZoomedImage] = useState(null) // 지금 확대해서 보고 있는 이미지 (없으면 null)

  // 미리보기 카드의 이미지를 클릭했을 때: 어떤 이미지를 확대할지 저장하고 모달을 엽니다.
  const openZoom = (img) => {
    setZoomedImage(img)
    previewDialogRef.current?.showModal()
  }

  // 사용자가 파일 선택창에서 새 파일을 고를 때마다 실행되는 함수입니다.
  const handleFileChange = (e) => {
    // e.target.files는 선택된 파일들의 목록입니다. 우리는 한 개만 받으므로 첫 번째 것만 사용합니다.
    setFile(e.target.files?.[0] ?? null)
    // 새 파일을 골랐으면 이전에 보던 분석 결과/에러는 화면에서 지워줍니다.
    setResult(null)
    setError('')
  }

  // "초기화" 버튼을 눌렀을 때 실행되는 함수입니다. 모든 상태를 처음 상태로 되돌립니다.
  const handleReset = () => {
    setFile(null)
    setResult(null)
    setError('')
    // 파일 입력창에 표시된 "선택된 파일명" 텍스트도 지워줍니다.
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // "분석하기" 버튼을 눌렀을 때 실행되는 함수입니다.
  // async 함수인 이유: 서버에 요청을 보내고 응답이 올 때까지 "기다려야" 하기 때문입니다.
  const handleAnalyze = async () => {
    if (!file) return // 파일이 없으면 아무것도 하지 않음 (버튼도 비활성화되어 있어서 보통 여긴 안 옴)

    // 요청을 시작하기 전에 화면 상태를 "로딩 중"으로 바꾸고, 이전 결과/에러는 지웁니다.
    setLoading(true)
    setError('')
    setResult(null)

    // 서버로 파일을 보내려면 일반 JSON이 아니라 FormData(멀티파트 폼 데이터) 형식을 사용해야 합니다.
    // 'file' 이라는 이름(필드명)으로 파일을 담는데, 이 이름은 서버(server/src/index.js)의
    // upload.single('file') 부분과 반드시 똑같아야 서로 짝이 맞습니다.
    const formData = new FormData()
    formData.append('file', file)

    try {
      // fetch()로 서버의 /api/analyze 주소에 POST 요청을 보냅니다.
      const res = await fetch(`${API_BASE}/api/analyze`, {
        method: 'POST',
        body: formData,
      })
      // 서버가 보낸 응답 본문을 JSON으로 해석합니다.
      const data = await res.json()
      // res.ok는 응답 상태 코드가 200번대(성공)인지를 나타냅니다. 실패했으면 에러를 던집니다.
      if (!res.ok) throw new Error(data.error || '분석에 실패했습니다.')
      // 성공했으면 받은 데이터를 result 상태에 저장 -> 화면이 자동으로 결과 화면으로 바뀝니다.
      setResult(data)
    } catch (err) {
      // 네트워크 오류든, 서버가 보낸 에러든 여기서 잡아서 화면에 보여줄 메시지로 저장합니다.
      setError(err.message)
    } finally {
      // 성공하든 실패하든 마지막엔 항상 "로딩 중" 상태를 꺼줍니다.
      setLoading(false)
    }
  }

  // ---- 화면을 그리기 전에 데이터를 가공하는 부분 -------------------------------
  // result가 아직 없을 수도 있으므로 "옵셔널 체이닝(?.)"과 "??"(값이 없으면 기본값 사용)을 사용합니다.

  // 서버가 보내준 색상 모델 요약 목록(colorModels) 중에서, CMYK가 "아닌" 것들만 걸러냅니다.
  // 이 프로젝트의 핵심 기능: 정상(CMYK)인 이미지는 화면에 보여줄 필요가 없기 때문입니다.
  const nonCmykModels = result?.colorModels.filter((group) => !group.isCmyk) ?? []
  // 이미지 목록(images)도 마찬가지로 CMYK가 아닌 것들만 걸러냅니다.
  const nonCmykImages = result?.images.filter((img) => !img.isCmyk) ?? []

  // 미리보기를 "페이지별로 묶어서" 보여주기 위해, 이미지 목록을 페이지 번호 기준으로 그룹화합니다.
  // 예: [{page: 1, images: [...]}, {page: 3, images: [...]}] 같은 배열을 만듭니다.
  const imagesByPage = []
  nonCmykImages.forEach((img) => {
    // 이미 같은 페이지 번호의 그룹이 만들어져 있는지 찾아봅니다.
    let group = imagesByPage.find((g) => g.page === img.page)
    if (!group) {
      // 없으면 새 그룹을 만들어서 배열에 추가합니다.
      group = { page: img.page, images: [] }
      imagesByPage.push(group)
    }
    group.images.push(img)
  })
  // 페이지 번호가 뒤죽박죽 섞이지 않도록 오름차순(1, 2, 3 ...)으로 정렬합니다.
  imagesByPage.sort((a, b) => a.page - b.page)

  // ---- 실제로 화면에 그려지는 부분(JSX) --------------------------------------
  // JSX는 HTML과 비슷하게 생겼지만 사실은 자바스크립트 코드입니다.
  // {중괄호} 안에는 자바스크립트 표현식을 자유롭게 넣을 수 있습니다.
  // app.jsx가 이미 <main className="content">로 감싸주므로, 여기서는 그 안쪽 내용만 돌려줍니다.
  return (
    <>
      <h2 className="page-title">색상 분석</h2>
      <p className="subtitle">PDF 또는 이미지(JPG/PNG/TIFF) 파일을 업로드하면 안에 포함된 이미지 중 CMYK가 아닌 것을 찾아드려요.</p>

      {/* 파일 선택 + 버튼들이 모여있는 영역 */}
      <div className="upload-box">
        {/* type="file" : 파일 선택창을 여는 input. accept로 PDF/이미지 파일만 고를 수 있게 제한합니다. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/tiff"
          onChange={handleFileChange}
        />

        {/* 분석하기 버튼: 파일이 없거나(!file), 이미 로딩 중이면 눌러도 반응하지 않도록 비활성화합니다. */}
        <button type="button" className="btn-primary" onClick={handleAnalyze} disabled={!file || loading}>
          {/* 로딩 중이면 버튼 글자를 "분석 중..."으로 바꿔서 사용자에게 진행 상황을 알려줍니다. */}
          {loading ? '분석 중...' : '분석하기'}
        </button>

        {/* 초기화 버튼: 로딩 중이거나, 지울 게 아무것도 없는 상태(파일도/결과도/에러도 없음)면 비활성화 */}
        <button type="button" className="btn-secondary" onClick={handleReset} disabled={loading || (!file && !result && !error)}>
          초기화
        </button>
      </div>

      {/* error 값이 있을 때만(비어있지 않은 문자열이면) 에러 메시지를 보여줍니다. */}
      {error && <p className="error">{error}</p>}

      {/* result 값이 있을 때만(분석이 성공적으로 끝났을 때만) 결과 영역 전체를 보여줍니다. */}
      {result && (
        <div className="result">
          {/* 상단 요약 문장: 파일명, 전체 페이지 수, 전체 이미지 수, 그중 CMYK가 아닌 개수 */}
          <p className="summary">
            <strong>{result.fileName}</strong> · 총 {result.pageCount}페이지 · 이미지 {result.imageCount}개 중{' '}
            <strong>CMYK 아님 {result.nonCmykCount}개</strong>
          </p>

          {/* CMYK가 아닌 이미지가 하나도 없다면(전부 정상이라면) 안내 문구를 추가로 보여주고,
              표는 이 경우 result.colorModels(전체 목록, 즉 CMYK만 있는 목록)를 그대로 보여줍니다. */}
          {nonCmykModels.length === 0 && <p className="summary">모든 이미지가 CMYK 색상모델입니다.</p>}

          {/* 색상 모델별 요약 표 (RGB가 몇 개, 어느 페이지에 있는지 등).
              non-CMYK 이미지가 있으면 그것만, 없으면 전체 색상모델(=CMYK만)을 보여줍니다.
              table-scroll로 감싸는 이유: 태블릿처럼 화면이 좁은데 페이지 번호가 많아서 표가
              넓어질 때, 화면 전체 레이아웃이 깨지는 대신 표 안에서만 가로 스크롤이 생기게 하기 위함입니다. */}
          <div className="table-scroll">
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
                {/* 배열의 각 항목마다 <tr> 한 줄씩 만듭니다.
                    key는 React가 각 항목을 구별하기 위해 반드시 필요한 값입니다(고유해야 함). */}
                {(nonCmykModels.length > 0 ? nonCmykModels : result.colorModels).map((group) => (
                  <tr key={group.model}>
                    <td>
                      <span className="ext-badge">{group.model}</span>
                    </td>
                    <td>{group.count}</td>
                    <td>{group.pageCount}</td>
                    <td>{group.pages.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 미리보기는 CMYK가 아닌 이미지가 있을 때만 보여줍니다. */}
          {nonCmykModels.length > 0 && (
            <>
              <h3 className="section-title">미리보기 (CMYK 아닌 이미지)</h3>
              {/* 페이지별로 묶은 그룹(imagesByPage)마다 "N페이지" 제목과 그 안의 이미지들을 그립니다. */}
              {imagesByPage.map((group) => (
                <div className="preview-page-group" key={group.page}>
                  <h3 className="preview-page-title">{group.page}페이지</h3>
                  {/* 한 페이지 안의 이미지들을 3열 격자(grid)로 배치합니다. (CSS는 App.css 참고) */}
                  <div className="preview-grid">
                    {group.images.map((img) => (
                      <div className="preview-card" key={img.id}>
                        {/* previewDataUrl이 있으면(=미리보기를 만들 수 있었으면) 이미지를 보여주고,
                            없으면(=CCITT/JBIG2처럼 지원하지 않는 형식이면) 안내 문구를 대신 보여줍니다. */}
                        {img.previewDataUrl ? (
                          <img
                            src={img.previewDataUrl}
                            alt={`${img.page}페이지 ${img.colorModel} 이미지`}
                            onClick={() => openZoom(img)}
                            className="zoomable"
                          />
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

      {/* 이미지 확대보기 모달. onClick에서 "배경(dialog 자기 자신)을 직접 클릭했을 때만" 닫히게 해서
          이미지 자체를 클릭하는 건 그냥 무시되도록 합니다(실수로 안 닫히게). Esc 키는 <dialog>가 알아서 처리해줍니다. */}
      <dialog
        ref={previewDialogRef}
        className="preview-dialog"
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close()
        }}
        onClose={() => setZoomedImage(null)}
      >
        {zoomedImage && (
          <>
            <img src={zoomedImage.previewDataUrl} alt={`${zoomedImage.page}페이지 ${zoomedImage.colorModel} 이미지 확대`} />
            <button type="button" className="dialog-close" onClick={() => previewDialogRef.current?.close()}>
              닫기
            </button>
          </>
        )}
      </dialog>
    </>
  )
}

// 이 Imgfind 컴포넌트를 app.jsx에서 가져다 쓸 수 있도록 내보냅니다.
export default Imgfind
