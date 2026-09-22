// ============================================================================
// 왼쪽 사이드바: 순수하게 "네비게이션(메뉴)"만 담당합니다. 어떤 메뉴가 있는지는
// 여기서 관리하지만, 메뉴를 눌렀을 때 실제로 화면을 바꾸는 로직(view 상태)은
// 부모인 app.jsx가 가지고 있고 이 컴포넌트는 onNavigate로 "몇 번 메뉴 눌렸어요"라고
// 알리기만 합니다. props로 값을 받고 이벤트만 부모에게 전달하는 흔한 React 패턴입니다.
// ============================================================================

// 메뉴 목록. 항목이 늘어나면 이 배열에 { id, label }만 추가하면 되고,
// 아래 렌더링 부분(.map)은 손댈 필요가 없습니다.
// id는 view 상태값(영문, app.jsx의 pages 객체 키와 맞춰야 함)이고,
// label은 사이드바 화면에 실제로 보이는 글자입니다 - 화면에 보이는 메뉴명은 항상 한글로 씁니다.
const MENU_ITEMS = [
  { id: 'home', label: '홈' },
  { id: 'imgfind', label: '색상 분석' },
  { id: 'spellFind', label: '맞춤법 분석' },
]

function Sidebar({ view, onNavigate }) {
  return (
    <aside className="sidebar">
      <nav className="side-nav">
        {MENU_ITEMS.map((item) => (
          <div
            key={item.id}
            className={`side-nav-item${view === item.id ? ' active' : ''}`}
            aria-current={view === item.id ? 'page' : undefined}
            onClick={() => onNavigate(item.id)}
          >
            {item.label}
          </div>
        ))}
      </nav>
    </aside>
  )
}

export default Sidebar
