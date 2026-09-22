// ============================================================================
// 사이드바에서 아무 메뉴도 고르지 않았을 때(처음 앱을 열었을 때) 보여주는 메인 화면입니다.
// props로 받는 onStart는 "imgfind 시작하기" 버튼을 눌렀을 때 app.jsx의 화면 전환 함수를
// 그대로 실행시켜주는 콜백(호출할 함수)입니다. 이렇게 하면 Home 컴포넌트는 "어떻게" 화면이
// 바뀌는지는 몰라도 되고, 그냥 버튼 눌렸다는 사실만 app.jsx에 알려주면 됩니다.
// ============================================================================

function Home({ onStart }) {
  return (
    <>
      <h2 className="page-title">편집자 도우미</h2>
      <p className="subtitle">왼쪽 메뉴에서 사용할 도구를 선택하세요.</p>
      <div className="upload-box">
        <button type="button" className="btn-primary" onClick={onStart}>
          imgfind로 이동
        </button>
      </div>
    </>
  )
}

export default Home
