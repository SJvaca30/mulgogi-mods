// 턴 작업 카드: 턴이 끝날 때 대화 기록에 남기는 한 줄
// 파일 변경은 Edit·Write·NotebookEdit 호출만 센다. Bash로 바꾼 파일(sed, 스크립트)은 잡히지 않는다.

import { clockText, kTokens } from './meter'

export type FileDelta = { add: number; del: number }

type EditRecord = {
  filePath?: string
  notebook_path?: string
  type?: string
  content?: string
  staged?: boolean
  structuredPatch?: { lines: string[] }[]
  old_source?: string
  new_source?: string
}

export function countPatch(hunks: readonly { lines: readonly string[] }[]): FileDelta {
  let add = 0
  let del = 0
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) add++
      else if (line.startsWith('-')) del++
    }
  }

  return { add, del }
}

function lines(text: string): string[] {
  return text === '' ? [] : text.replace(/\n$/, '').split('\n')
}

// NotebookEdit 결과에는 diff가 없어서, 앞뒤로 같은 줄을 빼고 남은 줄 수로 어림한다
export function roughDelta(before: string, after: string): FileDelta {
  const a = lines(before)
  const b = lines(after)
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++

  return { add: b.length - head - tail, del: a.length - head - tail }
}

/** 도구 결과에서 바뀐 파일과 줄 수를 꺼낸다. 파일이 바뀌지 않았으면 null */
export function editDelta(output: unknown): { path: string; delta: FileDelta } | null {
  if (typeof output !== 'object' || output === null) return null
  const out = output as EditRecord
  const path = out.filePath ?? out.notebook_path
  if (path === undefined || out.staged === true) return null
  const delta =
    out.structuredPatch !== undefined && out.structuredPatch.length > 0
      ? countPatch(out.structuredPatch)
      : out.type === 'create' && out.content !== undefined
        ? { add: lines(out.content).length, del: 0 }
        : out.new_source !== undefined
          ? roughDelta(out.old_source ?? '', out.new_source)
          : { add: 0, del: 0 }

  return { path, delta }
}

export function addDelta(files: Map<string, FileDelta>, path: string, delta: FileDelta) {
  const prev = files.get(path) ?? { add: 0, del: 0 }
  files.set(path, { add: prev.add + delta.add, del: prev.del + delta.del })
}

export type Card = {
  files: ReadonlyMap<string, FileDelta>
  /** 턴 동안 늘어난 컨텍스트 토큰. 모르면 null */
  tokens: number | null
  /** 턴 동안 늘어난 API 단가 환산액. 모르면 null */
  usd: number | null
  isAborted: boolean
}

/** 오늘이면 시각만, 아니면 월/일도 붙인다 */
export function whenText(ms: number, now: number): string {
  const d = new Date(ms)
  const today = new Date(now)
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()

  return sameDay ? clockText(ms) : `${d.getMonth() + 1}/${d.getDate()} ${clockText(ms)}`
}

const SHOWN_FILES = 3

/** 끝난 시각과 걸린 시간은 내장 줄(✻ Baked for 3m 30s · done 4:37 PM)이 보여 주므로 넣지 않는다. 남길 것이 없으면 '' */
export function cardText(card: Card): string {
  const parts: string[] = card.isAborted ? ['중단됨'] : []
  if (card.files.size > 0) {
    let add = 0
    let del = 0
    for (const d of card.files.values()) {
      add += d.add
      del += d.del
    }
    const names = [...card.files.keys()].map(path => path.split(/[\\/]/).pop() ?? path)
    const shown = names.slice(0, SHOWN_FILES).join(', ') + (names.length > SHOWN_FILES ? ` 외 ${names.length - SHOWN_FILES}개` : '')
    parts.push(`파일 ${names.length}개 +${add} −${del} (${shown})`)
  }
  if (card.tokens !== null && card.tokens !== 0) parts.push(`컨텍스트 ${card.tokens > 0 ? '+' : '−'}${kTokens(Math.abs(card.tokens))}`)
  if (card.usd !== null && card.usd >= 0.005) parts.push(`API 환산 ≈$${card.usd.toFixed(2)}`)

  return parts.join(' · ')
}
