import type { Limit, Meter } from '../types'

export type MeterView = {
  percent: number
  left: number
  /** compact: 자동 압축 임계값 기준, window: 모델 창 기준(자동 압축이 꺼졌을 때) */
  basis: 'compact' | 'window'
  tone: 'normal' | 'warn' | 'bad'
}

export function viewOf(meter: Meter): MeterView | null {
  if (meter.tokens === null) return null
  const isCompactBasis = meter.threshold !== null && meter.threshold > 0
  const limit = isCompactBasis && meter.threshold !== null ? meter.threshold : meter.window
  if (limit <= 0) return null
  const percent = Math.round((meter.tokens / limit) * 100)
  const tone = percent >= 85 ? 'bad' : percent >= 60 ? 'warn' : 'normal'

  return { percent, left: Math.max(0, limit - meter.tokens), basis: isCompactBasis ? 'compact' : 'window', tone }
}

export function bar(percent: number, cells = 10): string {
  const filled = Math.min(cells, Math.max(0, Math.round((percent / 100) * cells)))

  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

export function kTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

// 한도는 넉넉할 때 band 폭이 좁으면 숨기고, 이 값을 넘으면 항상 보인다
export const LIMIT_ALERT = 70
const LIMIT_NAMES: Record<string, string> = { five_hour: '5시간', seven_day: '주간', spend_limit: '지출' }

/** text는 넓은 band, short는 중간 폭 band, detail은 눌렀을 때 토스트로 보여 주는 글 */
export type LimitView = { kind: string; text: string; short: string; detail: string; isHigh: boolean; tone: 'normal' | 'warn' | 'bad' }

export function limitView(limit: Limit, now: number): LimitView {
  const name = LIMIT_NAMES[limit.kind] ?? limit.kind
  const resetsAt = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt)
  // 한도 값은 응답이 올 때만 바뀐다. 초기화 시각이 지난 뒤 응답이 없었다면 그동안 쓴 양도 없으므로 0%다
  if (!Number.isNaN(resetsAt) && resetsAt <= now) {
    return {
      kind: limit.kind,
      text: `${name} 0%`,
      short: `${name} 0%`,
      detail: `${name} 한도: 초기화됐습니다. 다음 응답부터 새로 집계됩니다`,
      isHigh: false,
      tone: 'normal',
    }
  }
  const percent = Math.round(limit.percentUsed)
  const isHigh = limit.percentUsed >= LIMIT_ALERT
  const hasReset = !Number.isNaN(resetsAt)

  return {
    kind: limit.kind,
    // band에는 초기화 시각만 둔다. 남은 시간과 "초기화" 낱말은 팔레트 맨 위 detail에서 본다
    text: `${name} ${percent}%${hasReset ? ` (${resetWhen(resetsAt, now)})` : ''}`,
    short: `${name} ${percent}%${hasReset ? ` (${resetWhen(resetsAt, now, false)})` : ''}`,
    // 팔레트 맨 위 한 줄(약 88칸)에 둘을 나란히 놓으므로 짧게 쓴다. "사용" 낱말과 요일은 band와 같이 뺀다
    detail: `${name} ${percent}%${hasReset ? ` · ${resetWhen(resetsAt, now, false)} 초기화(${untilText(resetsAt - now)} 뒤)` : ''}`,
    isHigh,
    tone: limit.percentUsed >= 90 ? 'bad' : isHigh ? 'warn' : 'normal',
  }
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

/** 초기화 시각: 오늘이면 17:20, 내일이면 내일 09:00, 그 뒤면 10/14(화) 09:00. 좁은 곳에서는 요일을 뺀다 */
export function resetWhen(at: number, now: number, withWeekday = true): string {
  const d = new Date(at)
  const today = new Date(now)
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000)
  if (days === 0) return clockText(at)
  if (days === 1) return `내일 ${clockText(at)}`

  return `${d.getMonth() + 1}/${d.getDate()}${withWeekday ? `(${WEEKDAYS[d.getDay()]})` : ''} ${clockText(at)}`
}

export function clockText(ms: number): string {
  const d = new Date(ms)

  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function untilText(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60000))
  if (minutes < 60) return `${minutes}분`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 === 0 ? `${hours}시간` : `${hours}시간 ${minutes % 60}분`

  return `${Math.floor(hours / 24)}일 ${hours % 24}시간`
}

/** API 단가 환산액. 구독 계정에서는 실제 청구액이 아니라서 ≈를 붙인다 */
export function usdText(usd: number): string {
  return `≈$${usd < 10 ? usd.toFixed(2) : Math.round(usd)}`
}
