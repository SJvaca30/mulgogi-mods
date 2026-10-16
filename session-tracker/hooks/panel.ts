// 세션 패널: `claude agents --json --all`이 주는 이 PC의 세션 목록과, 줄마다 쓰는 낱말·색.
// 이동은 Orca의 터미널 탭 제목과 세션 이름을 맞춰 찾는다.

import type { AgentRow } from '../types'

type Raw = { sessionId?: unknown; id?: unknown; name?: unknown; cwd?: unknown; state?: unknown; status?: unknown; kind?: unknown; pid?: unknown }

/** `claude agents --json [--all]` 출력에서 필요한 칸만 꺼낸다. pid가 있으면 켜져 있는 세션이다. 형식이 다르면 빈 목록 */
export function parseAgents(stdout: string, selfId: string): AgentRow[] {
  let list: unknown
  try {
    list = JSON.parse(stdout)
  } catch {
    return []
  }
  if (!Array.isArray(list)) return []

  return (list as Raw[]).flatMap(r => {
    const sessionId = typeof r.sessionId === 'string' ? r.sessionId : typeof r.id === 'string' ? r.id : ''
    if (sessionId === '') return []
    const state = typeof r.state === 'string' ? r.state : typeof r.status === 'string' ? r.status : ''

    return [
      {
        sessionId,
        shortId: typeof r.id === 'string' ? r.id : '',
        name: typeof r.name === 'string' && r.name.trim() !== '' ? r.name.trim() : `세션 ${sessionId.slice(0, 8)}`,
        cwd: typeof r.cwd === 'string' ? r.cwd : '',
        state,
        kind: typeof r.kind === 'string' ? r.kind : '',
        isSelf: sessionId === selfId,
        isLive: typeof r.pid === 'number',
      },
    ]
  })
}

/** 상태는 기호 없이 낱말과 색으로만 나타낸다. warning=사람이 할 일 있음, success=돌고 있음, muted=기다리는 중 */
export type Tone = 'warning' | 'success' | 'muted'

export function stateWord(state: string, kind = ''): { word: string; tone: Tone } {
  // blocked는 백그라운드 세션, waiting은 포그라운드 세션이 입력·승인을 기다릴 때 claude agents가 주는 값이다
  if (state === 'blocked' || state === 'waiting') return { word: '입력 필요', tone: 'warning' }
  if (state === 'working' || state === 'busy') return { word: '작업 중', tone: 'success' }
  // done은 꺼진 것이 아니라 답을 마치고 다음 요청을 기다리는 상태다
  if (state === 'done') return { word: '답변 완료', tone: 'muted' }
  // 켜진 채 쉬고 있는 상태. 꺼진 대화를 뜻하는 "유휴"와 헷갈리지 않게 "대기 중"이라고 쓴다
  if (state === 'idle') return { word: '대기 중', tone: 'muted' }
  // 터미널에서 직접 연 포그라운드 세션은 claude agents가 상태를 주지 않을 때가 있다
  if (state === '' && kind === 'interactive') return { word: '상태 모름', tone: 'muted' }

  return { word: state === '' ? '알 수 없음' : state, tone: 'muted' }
}

/** 상태별 개수. 사람이 할 일(입력 필요)부터 늘어놓는다 */
export function stateCounts(rows: readonly AgentRow[]): { word: string; tone: Tone; n: number }[] {
  const counts = new Map<string, { word: string; tone: Tone; n: number }>()
  for (const r of rows) {
    const s = stateWord(r.state, r.kind)
    counts.set(s.word, { ...s, n: (counts.get(s.word)?.n ?? 0) + 1 })
  }
  const rank: Record<Tone, number> = { warning: 0, success: 1, muted: 2 }

  return [...counts.values()].sort((a, b) => rank[a.tone] - rank[b.tone])
}

/** 세션 종류 낱말. claude agents의 kind 값 background, interactive와, 꺼진 대화(기록만 남음) off */
export function kindWord(kind: string): string {
  if (kind === 'background') return '백그라운드'
  if (kind === 'interactive') return '포그라운드'
  if (kind === 'off') return '유휴'

  return ''
}

/**
 * band 세션 줄의 앞부분: 이 대화의 종류 배지와, 탭을 닫으면 어떻게 되는지(대화 규칙 2). 종류를 모르면 null.
 * 백그라운드는 안전한 쪽이라 suggestion 색, 포그라운드는 탭을 닫으면 꺼지므로 warning 색 배지를 쓴다
 */
export function selfKindView(kind: string): { badge: string; color: 'suggestion' | 'warning'; hint: string } | null {
  if (kind === 'background') return { badge: '백그라운드', color: 'suggestion', hint: '탭을 닫아도 켜져 있음 · 끄기 /stop' }
  if (kind === 'interactive') return { badge: '포그라운드', color: 'warning', hint: '탭을 닫으면 꺼짐 · 유지 /background' }

  return null
}

/** 이름 입력을 정리한다: 줄바꿈·제어 문자를 빼고, 공백을 하나로 줄이고, 60자로 자른다 */
export function cleanName(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

/**
 * `orca terminal read --screen --json` 결과에서 Claude 입력창에 쓰던 글이 있는지 본다.
 * 입력창은 화면 아래쪽 ❯ 줄과 그 아래 가로줄(─) 사이다. 빈 입력창에 뜨는 안내 문구(Try "…")는 쓴 글로 보지 않는다.
 * 입력창을 찾지 못하면(대화상자가 떠 있는 등) 쓴 글이 있는 것으로 본다. 확실하지 않으면 건드리지 않기 위해서다
 */
export function composerHasText(stdout: string): boolean {
  let lines: string[]
  try {
    const parsed = JSON.parse(stdout) as { result?: { terminal?: { tail?: unknown } } }
    const tail = parsed?.result?.terminal?.tail
    lines = Array.isArray(tail) ? tail.map(String) : typeof tail === 'string' ? tail.split('\n') : []
  } catch {
    return true
  }
  // 오른쪽에 패널이 붙어 있으면 줄 뒤쪽에 패널 글자가 이어지므로, 패널 경계(│) 앞까지만 본다
  const left = lines.map(l => l.split('│')[0] ?? '')
  const promptAt = left.map(l => l.trimStart().startsWith('❯')).lastIndexOf(true)
  if (promptAt < 0) return true
  const borderAt = left.findIndex((l, i) => i > promptAt && /^─{10,}/.test(l.trim()))
  if (borderAt < 0) return true
  const first = left[promptAt]?.trimStart().slice(1).trim() ?? ''
  const rest = left.slice(promptAt + 1, borderAt).join(' ').trim()
  const typed = `${first} ${rest}`.trim()

  return typed !== '' && !/^Try "/.test(typed)
}

/** orca terminal read --screen --json 결과의 화면 줄. 형식이 다르면 빈 배열 */
export function screenLines(stdout: string): string[] {
  try {
    const parsed = JSON.parse(stdout) as { result?: { terminal?: { tail?: unknown } } }
    const tail = parsed?.result?.terminal?.tail

    return Array.isArray(tail) ? tail.map(String) : typeof tail === 'string' ? tail.split('\n') : []
  } catch {
    return []
  }
}

/** orca terminal create --json 결과에서 새 탭의 handle. 없으면 null */
export function createdHandle(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout) as { result?: { terminal?: { handle?: unknown }; handle?: unknown } }
    const handle = parsed?.result?.terminal?.handle ?? parsed?.result?.handle

    return typeof handle === 'string' && handle !== '' ? handle : null
  } catch {
    return null
  }
}

export type LaunchVerdict = { kind: 'ok' } | { kind: 'failed'; reason: string } | { kind: 'pending' }

/**
 * 새로 연 탭의 화면을 보고 Claude가 떴는지 판단한다. 입력창 테두리의 세션 이름(─ 이름 ─), 시작 머리글(Claude Code v…),
 * 모드 줄 안내가 보이면 떴다. 그 전에 오류 줄(No job matching 등)이 보이면 실패와 그 줄, 둘 다 없으면 아직 여는 중이다
 */
export function launchVerdict(lines: readonly string[], name: string): LaunchVerdict {
  // 오른쪽에 패널이 붙어 있으면 줄 뒤쪽에 패널 글자가 이어지므로, 패널 경계(│) 앞까지만 본다
  const left = lines.map(l => l.split('│')[0] ?? '')
  const label = name.slice(0, 20)
  const isClaude = left.some(l => (label !== '' && l.includes(`─ ${label}`)) || /Claude Code v\d|shift\+tab to cycle|\? for shortcuts|── clickbar|── 세션/.test(l))
  if (isClaude) return { kind: 'ok' }
  const error = left.find(l => /No job matching|No conversation found|is not recognized as|command not found|Error:/i.test(l))

  return error === undefined ? { kind: 'pending' } : { kind: 'failed', reason: error.trim().slice(0, 160) }
}

type OrcaTerminal = { handle?: unknown; title?: unknown }

/** Orca 탭 제목 앞의 상태 기호(✳, ⠂ 같은 것)를 떼고 세션 이름과 맞는 탭을 찾는다 */
export function findTerminal(stdout: string, name: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return null
  }
  const result = (parsed as { result?: { terminals?: unknown } })?.result
  const terminals = Array.isArray(result?.terminals) ? (result.terminals as OrcaTerminal[]) : []
  const clean = (t: string) => t.replace(/^[^\p{L}\p{N}]+/u, '').trim()
  const target = clean(name)
  const hit = terminals.find(t => typeof t.title === 'string' && typeof t.handle === 'string' && target !== '' && clean(t.title) === target)

  return hit === undefined ? null : (hit.handle as string)
}
