// 내 질문 타임라인: 사람이 직접 보낸 질문만 모은다(where-were-we의 방식).
// 시스템이 넣은 글(<command-name>, <task-notification> 같은 태그로 시작)과 도구 결과는 뺀다.

import type { PromptEntry } from '../types'

export const PROMPTS_MAX = 200

export function isTypedPrompt(text: string): boolean {
  const t = text.trim()

  return t !== '' && !t.startsWith('<')
}

type Block = { type?: unknown; text?: unknown }

export function blocksText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return (content as Block[])
    .filter(b => b?.type === 'text' && typeof b.text === 'string')
    .map(b => b.text as string)
    .join('\n')
}

/** 기록 파일(JSONL)에서 사람이 보낸 질문을 순서대로 꺼낸다. 시각은 파일에 적힌 값이다 */
export function promptsFromTranscript(jsonl: string): PromptEntry[] {
  const out: PromptEntry[] = []
  for (const line of jsonl.split('\n')) {
    if (!line.includes('"type":"user"')) continue
    let row: { type?: unknown; uuid?: unknown; timestamp?: unknown; isMeta?: unknown; isSidechain?: unknown; message?: { content?: unknown } }
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (row.type !== 'user' || row.isMeta === true || row.isSidechain === true || typeof row.uuid !== 'string') continue
    const text = blocksText(row.message?.content)
    if (!isTypedPrompt(text)) continue
    out.push({ uuid: row.uuid, at: typeof row.timestamp === 'string' ? Date.parse(row.timestamp) || 0 : 0, text })
  }

  return out.slice(-PROMPTS_MAX)
}

/** 같은 uuid는 한 번만 두고, 시각 순으로 정렬한다 */
export function mergePrompts(a: readonly PromptEntry[], b: readonly PromptEntry[]): PromptEntry[] {
  const byId = new Map<string, PromptEntry>()
  for (const p of [...a, ...b]) if (!byId.has(p.uuid)) byId.set(p.uuid, p)

  return [...byId.values()].sort((x, y) => x.at - y.at).slice(-PROMPTS_MAX)
}
