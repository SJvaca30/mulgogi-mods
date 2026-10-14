import type { SyncStatus } from '../types'

// 마지막 동기화가 이보다 오래되면 [sync stale]로 알린다. 동기화는 세션이 열리고 닫힐 때만 돌아,
// 세션 하나를 며칠 켜 두면 그동안 아무것도 올라가지 않는다
export const SYNC_STALE_MS = 24 * 3600_000

/** sync.status.json 내용을 검사해 꺼낸다. 형식이 다르면 null */
export function parseSyncStatus(text: string): SyncStatus | null {
  let raw: unknown
  try {
    raw = JSON.parse(text.trim())
  } catch {
    return null
  }
  const s = raw as Partial<Record<keyof SyncStatus, unknown>>
  if (typeof s?.at !== 'string' || (s.result !== 'ok' && s.result !== 'held' && s.result !== 'failed')) return null
  const held = Array.isArray(s.held) ? s.held.filter((x): x is string => typeof x === 'string') : []

  return { at: s.at, result: s.result, held, message: typeof s.message === 'string' ? s.message : '' }
}

/** band의 [sync] 버튼 이름과 색. 문제가 없으면 그냥 [sync]다 */
export function syncView(status: SyncStatus | null, now: number): { word: string; color: 'suggestion' | 'warning' | 'error' } {
  if (status === null) return { word: 'sync', color: 'suggestion' }
  if (status.result === 'failed') return { word: 'sync failed', color: 'error' }
  if (status.result === 'held') return { word: `sync held ${status.held.length}`, color: 'warning' }
  const at = Date.parse(status.at)
  if (!Number.isNaN(at) && now - at > SYNC_STALE_MS) return { word: 'sync stale', color: 'warning' }

  return { word: 'sync', color: 'suggestion' }
}
