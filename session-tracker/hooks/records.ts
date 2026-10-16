// 같은 폴더 세션 추적: 세션마다 자기 상태 파일 하나를 쓰고, 같은 폴더의 다른 파일을 읽는다.
// AI LABS 영상의 session-tracker를 다시 만든 것이다. 모델을 호출하지 않는다.

import type { SessionRecord, SessionStatus } from '../types'

// 1분마다 살아 있다고 쓰므로, 3분 넘게 소식이 없으면 꺼진 세션으로 본다(강제 종료되면 session.end가 오지 않는다)
export const HEARTBEAT_MS = 60_000
export const ALIVE_MS = 3 * 60_000
// 이보다 오래된 파일은 열어 보지도 않는다
export const SKIP_OLDER_MS = 24 * 3600_000
export const PROMPT_MAX = 200
export const NOTE_PROMPT_MAX = 120

export const STATUS_WORDS: Record<Exclude<SessionStatus, 'ended'>, string> = { working: '작업 중', waiting: '승인 대기', idle: '대기 중' }

/** 폴더 경로를 파일 이름에 쓸 수 있는 키로 바꾼다. D:\all → D-all */
export function rootKey(root: string): string {
  return root.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function parseRecord(text: string): SessionRecord | null {
  try {
    const r = JSON.parse(text) as Partial<SessionRecord>
    const ok =
      typeof r.id === 'string' &&
      typeof r.root === 'string' &&
      typeof r.prompt === 'string' &&
      typeof r.at === 'number' &&
      typeof r.changedAt === 'number' &&
      (r.status === 'working' || r.status === 'waiting' || r.status === 'idle' || r.status === 'ended')
    if (!ok) return null
    // 위치는 모양이 맞을 때만 받는다(예전 기록에는 없다)
    const term = r.term !== undefined && (r.term.host === 'orca' || r.term.host === 'herdr') && typeof r.term.id === 'string' && r.term.id !== '' ? r.term : undefined

    return { ...(r as SessionRecord), term }
  } catch {
    return null
  }
}

/** 같은 폴더에서 살아 있는 다른 세션만 남긴다. 최근에 상태가 바뀐 것이 먼저 */
export function alivePeers(records: readonly SessionRecord[], selfId: string, root: string, now: number): SessionRecord[] {
  return records
    .filter(r => r.id !== selfId && r.root === root && r.status !== 'ended' && now - r.at < ALIVE_MS)
    .sort((a, b) => b.changedAt - a.changedAt)
}

export function agoText(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  if (minutes < 1) return '방금'
  if (minutes < 60) return `${minutes}분 전`

  return `${Math.floor(minutes / 60)}시간 전`
}

export function firstLine(text: string, max: number): string {
  const line = text.split('\n').find(l => l.trim() !== '')?.trim() ?? ''

  return line.length > max ? `${line.slice(0, max)}…` : line
}

/** 다른 세션이 작업 중일 때만 Claude에게 붙이는 한 줄. 없으면 null */
export function overlapNote(peers: readonly SessionRecord[]): string | null {
  const working = peers.filter(p => p.status === 'working' || p.status === 'waiting')
  if (working.length === 0) return null
  const items = working.slice(0, 2).map(p => `"${firstLine(p.prompt, NOTE_PROMPT_MAX)}"`)

  return `참고(session-tracker): 같은 폴더에서 다른 Claude 세션 ${working.length}개가 작업 중이다(요청: ${items.join(', ')}). 같은 파일을 동시에 고치지 않도록, 겹칠 것 같으면 먼저 사용자에게 확인하라.`
}
