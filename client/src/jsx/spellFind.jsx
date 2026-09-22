// ============================================================================
// 사이드바 메뉴 중 "spellFind"(맞춤법 검사) 화면을 담당하는 컴포넌트입니다.
// 지금 단계에서는 실제 맞춤법 검사 로직은 아직 없고, 검사에 필요한 두 개의
// 첨부파일을 받는 화면만 만듭니다:
//   1) 기준자료 - 맞춤법 판단 기준이 될 자료 (예: 편수자료).
//   2) 대상 파일 - 기준자료를 바탕으로 맞춤법을 검사받을 파일.
// 둘 다 화면 위아래로 나란히, "조회조건"처럼 생긴 같은 모양의 영역(.criteria-box)에
// 올려두고 고른 파일의 이름만 간단히 보여줍니다.
// useState는 "이 값이 바뀌면 화면을 다시 그려줘"라고 React에게 알려주는 상태 저장소입니다.
// ============================================================================

import { useState } from 'react'

function SpellFind() {
  const [criteriaFile, setCriteriaFile] = useState(null) // 기준자료 파일 (아직 안 골랐으면 null)
  const [targetFile, setTargetFile] = useState(null) // 검사 대상 파일 (아직 안 골랐으면 null)

  return (
    <>
      <h2 className="page-title">맞춤법 분석</h2>
      <p className="subtitle">기준자료를 기준으로 대상 파일의 맞춤법을 검사하는 도구입니다.</p>

      {/* "조회조건"처럼 화면 맨 위에 고정된 영역: 기준자료를 고르면 파일명만 간단히 보여줌 */}
      <div className="criteria-box">
        <span className="criteria-label">기준자료</span>
        <input type="file" onChange={(e) => setCriteriaFile(e.target.files?.[0] ?? null)} />
        {/* 파일을 고르기 전에는 아무것도 안 보여주고, 고른 뒤에만 파일명을 표시합니다. */}
        {criteriaFile && <span className="criteria-filename">{criteriaFile.name}</span>}
      </div>

      {/* 검사 대상 파일 영역도 기준자료와 똑같은 모양(.criteria-box)으로 그 아래에 두되,
          기준자료(파란색)와 구분되도록 criteria-box--target 클래스로 붉은 톤을 입힙니다. */}
      <div className="criteria-box criteria-box--target">
        <span className="criteria-label">검사대상</span>
        <input type="file" onChange={(e) => setTargetFile(e.target.files?.[0] ?? null)} />
        {targetFile && <span className="criteria-filename">{targetFile.name}</span>}
      </div>
    </>
  )
}

export default SpellFind
