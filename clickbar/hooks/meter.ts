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

/**
 * 한도 한 줄. 이름·비율·막대는 band와 팔레트가 같은 모양으로 그린다.
 * reset은 band의 괄호 안 초기화 시각(요일 없음, 모르거나 지났으면 ''), detail은 팔레트에서 그 옆에 쓰는 초기화 시각과 남은 시간이다
 */
export type LimitView = { kind: string; name: string; percent: number; reset: string; detail: string; isHigh: boolean; tone: 'normal' | 'warn' | 'bad' }

export function limitView(limit: Limit, now: number): LimitView {
  const name = LIMIT_NAMES[limit.kind] ?? limit.kind
  const resetsAt = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt)
  // 한도 값은 응답이 올 때만 바뀐다. 초기화 시각이 지난 뒤 응답이 없었다면 그동안 쓴 양도 없으므로 0%다
  if (!Number.isNaN(resetsAt) && resetsAt <= now) {
    return { kind: limit.kind, name, percent: 0, reset: '', detail: '초기화됨 · 다음 응답부터 다시 집계합니다', isHigh: false, tone: 'normal' }
  }
  const isHigh = limit.percentUsed >= LIMIT_ALERT
  const hasReset = !Number.isNaN(resetsAt)

  return {
    kind: limit.kind,
    name,
    percent: Math.round(limit.percentUsed),
    // band는 한 줄에 컨텍스트·한도를 모두 두므로 요일을 뺀다. 팔레트는 한도마다 한 줄이라 요일과 남은 시간을 함께 쓴다
    reset: hasReset ? resetWhen(resetsAt, now, false) : '',
    detail: hasReset ? `${resetWhen(resetsAt, now)} 초기화 · ${untilText(resetsAt - now)} 뒤` : '',
    isHigh,
    tone: limit.percentUsed >= 90 ? 'bad' : isHigh ? 'warn' : 'normal',
  }
}

/** band 상태 줄의 항목 하나: [!] 이름 막대 비율 (설명). 막대·설명이 없으면 '' */
export type MeterItem = { key: string; name: string; bar: string; figure: string; note: string; tone: 'normal' | 'warn' | 'bad' }

/** 터미널 칸 수. 한글·한자 같은 넓은 글자는 두 칸, 막대(█░)를 포함한 나머지는 한 칸으로 센다 */
export function cells(text: string): number {
  let n = 0
  for (const ch of text) n += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1

  return n
}

/** 항목이 차지하는 칸 수. 조각 사이는 한 칸씩 띄운다(band가 columnGap 1로 그린다) */
export function itemCells(item: MeterItem): number {
  const parts = [item.tone === 'bad' ? '!' : '', item.name, item.bar, item.figure, item.note].filter(p => p !== '')

  return parts.reduce((n, p) => n + cells(p), 0) + parts.length - 1
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
