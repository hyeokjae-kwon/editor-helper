// 이 파일은 프론트엔드(React 앱)가 브라우저에서 시작되는 진짜 첫 지점입니다.
// index.html 안에 있는 <div id="root"></div> 라는 빈 상자를 찾아서,
// 그 안에 우리가 만든 App 컴포넌트(App.jsx)를 실제로 그려 넣는 역할을 합니다.

import { StrictMode } from 'react' // 개발 중에 흔한 실수를 미리 경고해주는 React의 "엄격 모드" 도구
import { createRoot } from 'react-dom/client' // React 컴포넌트를 실제 브라우저 화면(DOM)에 붙여주는 함수
import './index.css' // 앱 전체에 적용되는 기본 스타일(색상 변수, 다크모드 등)을 불러옴
import App from './App.jsx' // 우리가 만든 화면 전체 컴포넌트

// document.getElementById('root') : index.html 안의 <div id="root">를 찾습니다.
// createRoot(...).render(...) : 그 위치에 <App /> 컴포넌트를 그려 넣습니다.
// <StrictMode>로 감싸는 이유: 개발 환경에서 컴포넌트를 일부러 두 번 실행해보는 등,
// 잠재적인 버그(부작용이 있는 코드 등)를 더 쉽게 발견할 수 있도록 도와주기 때문입니다.
// (StrictMode는 실제 배포되는 결과물의 동작에는 영향을 주지 않습니다.)
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
