// 답변 목록: 턴마다 마지막 답변 하나만 고른다.
// 한 턴 안의 assistant 행에는 도구 호출 사이의 중간 설명("~를 확인하겠습니다")도 섞여 있어서다.

type Row = { role: 'user' | 'assistant'; text: string; toolResults?: readonly unknown[] }

/** 턴마다 마지막 답변 글, 최신이 먼저. 도구 결과가 아닌 user 행을 새 턴의 시작으로 본다 */
export function finalReplies(messages: readonly Row[], limit: number): string[] {
  const out: string[] = []
  let last: string | undefined
  for (const m of messages) {
    if (m.role === 'user' && (m.toolResults === undefined || m.toolResults.length === 0)) {
      if (last !== undefined) out.push(last)
      last = undefined
    } else if (m.role === 'assistant' && m.text.trim() !== '') {
      last = m.text
    }
  }
  if (last !== undefined) out.push(last)

  return out.slice(-limit).reverse()
}

// 전역 CLAUDE.md 규칙으로 답변 전체가 ````markdown 펜스 하나에 담겨 온다. 그대로 그리면 표가 글자 그대로 보인다.
// 백틱 4개 이상에 markdown·md 표시가 붙었거나 표시가 없는 펜스만 벗긴다. ````python 같은 다른 언어와
// 안쪽의 ``` 코드 블록은 그대로 둔다. 닫는 펜스가 아직 오지 않은(받는 중인) 답변은 바꾸지 않는다.
const OUTER_FENCE = /^(`{4,})(?:markdown|md)?[ \t]*\n([\s\S]*?)\n\1[ \t]*$/gm

/** 답변을 감싼 바깥 마크다운 펜스를 벗긴다. 없으면 그대로 */
export function unfence(text: string): string {
  return text.replace(OUTER_FENCE, '$2')
}

/** 목록에 보여줄 첫 줄. 코드 펜스 줄은 건너뛰고 제목·인용 기호는 뗀다 */
export function previewLine(text: string): string {
  const line = text.split('\n').find(l => l.trim() !== '' && !/^\s*`{3,}/.test(l)) ?? ''

  return line.replace(/^\s*(#+|>)\s*/, '').trim()
}
