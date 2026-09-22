// ============================================================================
// 이 파일은 앱의 "껍데기"입니다. 화면을 topFrame(상단바) / sidebar(좌측 메뉴) /
// main(본문) / bottomFrame(하단바) 네 구역으로 나누고, 지금 어떤 메뉴가 선택됐는지
// (view 상태)에 따라 main 자리에 Home 또는 Imgfind 화면을 바꿔 끼워 보여줍니다.
// React를 처음 보는 사람을 위해 설명하면:
//   - useState('home')은 "지금 보여줄 화면은 처음엔 home"이라는 뜻이고,
//     setView('imgfind')처럼 값을 바꾸면 React가 화면을 자동으로 다시 그려줍니다.
//   - 별도의 페이지 이동(라우팅) 라이브러리 없이, 메뉴가 하나둘뿐인 지금 규모에서는
//     이렇게 상태값 하나로 화면을 바꿔주는 것만으로 충분합니다.
// ============================================================================

import { useState } from 'react'
import '../css/app.css'
import TopFrame from './topFrame'
import Sidebar from './sidebar'
import BottomFrame from './bottomFrame'
import Home from './home'
import Imgfind from './imgfind'

function App() {
  // 지금 보여줄 화면. 'home'(메인 화면) 또는 'imgfind'(색상모델 분석 화면).
  const [view, setView] = useState('home')

  return (
    <div className="layout">
      {/* 상단바: 화면 맨 위를 가로지름 */}
      <TopFrame />

      {/* 상단바 아래는 사이드바(좌측 메뉴) + 본문(main)을 가로로 배치 */}
      <div className="body-row">
        <Sidebar view={view} onNavigate={setView} />

        {/* view 값에 따라 Home 또는 Imgfind 컴포넌트를 본문에 넣어줍니다. */}
        <main className="content">{view === 'home' ? <Home onStart={() => setView('imgfind')} /> : <Imgfind />}</main>
      </div>

      {/* 하단바: 화면 맨 아래를 가로지름 */}
      <BottomFrame />
    </div>
  )
}

// 이 App 컴포넌트를 다른 파일(main.jsx)에서 가져다 쓸 수 있도록 내보냅니다.
export default App
