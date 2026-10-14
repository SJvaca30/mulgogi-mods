// 가정 확인: Claude가 묻지 않고 정한 것을 도구로 기록하게 하고, 사용자가 맞음·틀림을 고른다.
// AI LABS 영상의 assumption-tracker를 다시 만든 것이다. 별도의 모델 호출은 없다.

import type { Assumption } from '../types'

export const ASSUME_TOOL_NAME = 'log_assumption'
export const ASSUME_TOOL = `mcp__clickbar__${ASSUME_TOOL_NAME}`
// 훅 매처용. 등록 전에는 타입에 이 도구 이름이 없어서 정규식으로 맞춘다
export const ASSUME_TOOL_MATCH = /^mcp__clickbar__log_assumption$/
// 사용자가 꺼 두면 이 값이 $.store에 'off'로 남는다
export const ASSUME_SWITCH_KEY = 'assumptions'

export const ASSUME_DESCRIPTION = [
  'Log the assumptions you made without asking the user, so they can confirm or correct them in the clickbar panel.',
  'Only log assumptions that change the outcome: how you read an ambiguous request, defaults you chose, scope you added or left out, guesses about data, formats or environment. Skip trivial implementation details.',
  'Batch them: call at most once per response with every new assumption, preferably alongside your other tool calls in the same response.',
  "Write each assumption as one short sentence in the user's language. The result is only an acknowledgement; keep working.",
].join(' ')

export const ASSUME_SCHEMA = {
  type: 'object',
  properties: {
    assumptions: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'One short sentence per assumption' },
  },
  required: ['assumptions'],
}

/** 도구 입력에서 가정 문장들만 꺼낸다 */
export function assumptionTexts(input: unknown): string[] {
  const list = typeof input === 'object' && input !== null ? (input as { assumptions?: unknown }).assumptions : undefined
  if (!Array.isArray(list)) return []

  return list.filter((x): x is string => typeof x === 'string').map(x => x.trim()).filter(x => x !== '')
}

/** 틀렸다고 고른 가정을 고쳐 달라는 프롬프트. 맞다고 확인한 가정은 그대로 두라고 함께 알린다 */
export function correctionPrompt(list: readonly Assumption[]): string | null {
  const wrong = list.filter(a => a.status === 'wrong')
  if (wrong.length === 0) return null
  const right = list.filter(a => a.status === 'right')
  const lines = ['방금 작업에서 세운 가정 중 아래는 틀렸어. 이 부분만 고쳐 줘.']
  wrong.forEach((a, i) => {
    lines.push(`${i + 1}. 가정: ${a.text}`)
    lines.push(`   → ${a.fix.trim() === '' ? '이 가정을 버리고 다시 판단해 줘' : `대신: ${a.fix.trim()}`}`)
  })
  if (right.length > 0) lines.push('', `맞다고 확인한 가정(그대로 둬): ${right.map(a => a.text).join(' / ')}`)

  return lines.join('\n')
}
