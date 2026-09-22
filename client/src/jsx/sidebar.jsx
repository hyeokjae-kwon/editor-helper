// ============================================================================
// 왼쪽 사이드바: 순수하게 "네비게이션(메뉴)"만 담당합니다. 어떤 메뉴가 있는지는
// 여기서 관리하지만, 메뉴를 눌렀을 때 실제로 화면을 바꾸는 로직(view 상태)은
// 부모인 app.jsx가 가지고 있고 이 컴포넌트는 onNavigate로 "몇 번 메뉴 눌렸어요"라고
// 알리기만 합니다. props로 값을 받고 이벤트만 부모에게 전달하는 흔한 React 패턴입니다.
// ============================================================================

function Sidebar({ view, onNavigate }) {
  return (
    <aside className="sidebar">
      <nav className="side-nav">
        {/* 메뉴가 늘어나면 이 배열에 { id, label } 형태로 항목만 추가하면 됩니다. */}
        <div
          className={`side-nav-item${view === 'home' ? ' active' : ''}`}
          aria-current={view === 'home' ? 'page' : undefined}
          onClick={() => onNavigate('home')}
        >
          홈
        </div>
        <div
          className={`side-nav-item${view === 'imgfind' ? ' active' : ''}`}
          aria-current={view === 'imgfind' ? 'page' : undefined}
          onClick={() => onNavigate('imgfind')}
        >
          imgfind
        </div>
      </nav>
    </aside>
  )
}

export default Sidebar
