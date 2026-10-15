import { expect, test } from 'claude-code/testing'

import { cardText, countPatch, editDelta, roughDelta } from '../hooks/card'
import { ASSUME_TOOL, correctionPrompt } from '../hooks/assumptions'
import { promptsFromTranscript } from '../hooks/prompts'
import { unfence } from '../hooks/replies'
import { bar, cells, itemCells, kTokens, limitView, untilText, usdText, viewOf } from '../hooks/meter'
import { SYNC_STALE_MS, parseSyncStatus, syncView } from '../hooks/sync'
import { keyGroupsFor, platformOf } from '../hooks/catalog'
import type { Platform } from '../hooks/catalog'

const band = (bodyColumns: number) =>
  ({
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  }) as const

test('미터는 자동 압축 임계값 기준으로 계산하고, 꺼져 있으면 모델 창 기준으로 바꾼다', async () => {
  const normal = viewOf({ tokens: 94000, window: 200000, threshold: 160000 })
  expect(normal?.percent).toBe(59)
  expect(normal?.left).toBe(66000)
  expect(normal?.basis).toBe('compact')
  expect(normal?.tone).toBe('normal')
  expect(viewOf({ tokens: 120000, window: 200000, threshold: 160000 })?.tone).toBe('warn')
  expect(viewOf({ tokens: 152000, window: 200000, threshold: 160000 })?.tone).toBe('bad')
  expect(viewOf({ tokens: 170000, window: 200000, threshold: 160000 })?.left).toBe(0)
  expect(viewOf({ tokens: 100000, window: 200000, threshold: null })?.basis).toBe('window')
  expect(viewOf({ tokens: null, window: 200000, threshold: 160000 })).toBe(null)
  expect(bar(59)).toBe('██████░░░░')
  expect(kTokens(66000)).toBe('66k')
  expect(kTokens(800)).toBe('800')
})

test('한도는 band에 사용 비율과 초기화 시각만, 팔레트에는 요일과 남은 시간까지 보여 주고, 초기화 시각이 지나면 0%로 바꾼다', async () => {
  const now = Date.parse('2026-10-08T05:00:00Z')
  const low = limitView({ kind: 'five_hour', percentUsed: 31.4, resetsAt: '2026-10-08T07:10:00Z' }, now)
  // 시각은 실행 환경의 현지 시각이라 숫자 자리는 정규식으로 본다
  expect(low).toMatchObject({ name: '5시간', percent: 31, isHigh: false, tone: 'normal' })
  expect(low.reset).toMatch(/^\d\d:10$/)
  expect(low.detail).toMatch(/^\d\d:10 초기화 · 2시간 10분 뒤$/)
  const high = limitView({ kind: 'seven_day', percentUsed: 92, resetsAt: '2026-10-11T05:00:00Z' }, now)
  // band는 한 줄에 모두 두므로 요일을 빼고, 팔레트는 요일을 붙인다
  expect(high.reset).toMatch(/^10\/11 \d\d:00$/)
  expect(high.detail).toMatch(/^10\/11\(일\) \d\d:00 초기화 · 3일 0시간 뒤$/)
  expect(high.tone).toBe('bad')
  const past = limitView({ kind: 'five_hour', percentUsed: 88, resetsAt: '2026-10-08T04:00:00Z' }, now)
  expect(past).toMatchObject({ percent: 0, reset: '', isHigh: false, tone: 'normal' })
  // 칸 수: 한글은 두 칸, 막대·숫자·기호는 한 칸. 위험(bad)이면 앞의 !와 빈칸 한 칸이 더해진다
  expect(cells('5시간 █░')).toBe(8)
  expect(itemCells({ key: 'k', name: '주간', bar: '█████', figure: '92%', note: '(10/11 14:00)', tone: 'bad' })).toBe(2 + 4 + 1 + 5 + 1 + 3 + 1 + 13)
  expect(itemCells({ key: 'k', name: 'API 환산', bar: '', figure: '≈$3.84', note: '', tone: 'normal' })).toBe(8 + 1 + 6)
  expect(untilText(30 * 3600000)).toBe('1일 6시간')
  expect(usdText(1.234)).toBe('≈$1.23')
  expect(usdText(27.1)).toBe('≈$27')
})

test('작업 카드는 diff의 +/- 줄을 세고, 새 파일은 내용 줄 수로 센다', async () => {
  expect(countPatch([{ lines: [' a', '-b', '+c', '+d'] }, { lines: ['-e'] }])).toEqual({ add: 2, del: 2 })
  expect(editDelta({ filePath: 'D:/all/x.md', structuredPatch: [{ lines: ['+1', '+2', '-3'] }] })).toEqual({
    path: 'D:/all/x.md',
    delta: { add: 2, del: 1 },
  })
  expect(editDelta({ type: 'create', filePath: 'new.ts', content: 'a\nb\nc\n', structuredPatch: [] })?.delta).toEqual({ add: 3, del: 0 })
  expect(editDelta({ filePath: 'held.ts', staged: true, structuredPatch: [{ lines: ['+1'] }] })).toBe(null)
  expect(editDelta('not a record')).toBe(null)
  expect(roughDelta('a\nb\nc', 'a\nX\nY\nc')).toEqual({ add: 2, del: 1 })
  expect(roughDelta('', 'x')).toEqual({ add: 1, del: 0 })

  const text = cardText({
    files: new Map([
      ['D:\\all\\a.md', { add: 40, del: 7 }],
      ['C:/x/b.ts', { add: 2, del: 0 }],
    ]),
    tokens: 8200,
    usd: 0.123,
    isAborted: false,
  })
  // 끝난 시각과 걸린 시간은 내장 줄이 보여 주므로 카드에 없다
  expect(text).toBe('파일 2개 +42 −7 (a.md, b.ts) · 컨텍스트 +8k · API 환산 ≈$0.12')
  // 남길 것이 없으면 빈 글이고, 중단된 턴은 "중단됨"만 남긴다
  expect(cardText({ files: new Map(), tokens: 0, usd: 0.001, isAborted: false })).toBe('')
  // 파일을 고치지 않은 턴은 컨텍스트·비용이 늘었거나 중단됐어도 남기지 않는다
  expect(cardText({ files: new Map(), tokens: null, usd: null, isAborted: true })).toBe('')
  expect(cardText({ files: new Map(), tokens: 8000, usd: 0.4, isAborted: false })).toBe('')
  expect(cardText({ files: new Map([['a.md', { add: 1, del: 0 }]]), tokens: null, usd: null, isAborted: true })).toBe('중단됨 · 파일 1개 +1 −0 (a.md)')
})

test('작업 카드: 턴 동안 Edit 결과를 모아 턴이 끝나면 한 줄을 남긴다', async ($, on) => {
  const logged: string[] = []
  const usage = (tokens: number, usd: number) => ({ startedAt: 0, context: { window: 1000000, tokens }, rateLimits: [], cost: { usd } })
  let live = usage(42000, 1.2)
  on('clock.now', () => ({ value: Date.parse('2026-10-08T05:32:00Z') }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: live }))
  on('ui.log', (_, e) => {
    logged.push(e.text)
    return { value: undefined }
  })
  // 엔진 자리를 대신한다. Edit는 실제로 실행하지 않고 결과 모양만 돌려준다
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: { filePath: 'D:/all/a.md', structuredPatch: [{ lines: ['+x', '+z', '-y'] }] } }))

  await $.session.measure({ context: live.context, rateLimits: [], cost: live.cost, changed: ['context', 'cost'] })
  await $.turn.start({ text: '고쳐 줘', turnId: 't1' })
  const edit = await $.tool.call({ tool: 'Edit', tool_use_id: 'u1', file_path: 'D:/all/a.md', old_string: 'y', new_string: 'x\nz' })
  expect(edit.result).toBeDefined()
  live = usage(50200, 1.323)
  await $.turn.complete({ answer: '끝', durationMs: 64000, isAborted: false, turnId: 't1', reason: 'answer' })

  expect(logged).toHaveLength(1)
  expect(logged[0]).toBe('파일 1개 +2 −1 (a.md) · 컨텍스트 +8k · API 환산 ≈$0.12')

  // 바뀐 것이 없는 턴은 줄을 남기지 않는다(기준값은 엔진이 알려 준 마지막 사용량)
  await $.session.measure({ context: live.context, rateLimits: [], cost: live.cost, changed: ['context', 'cost'] })
  await $.turn.start({ text: '고마워', turnId: 't2' })
  await $.turn.complete({ answer: '네', durationMs: 3000, isAborted: false, turnId: 't2', reason: 'answer' })
  expect(logged).toHaveLength(1)
  // 질문·답변만 한 턴은 컨텍스트와 비용이 늘어도 줄을 남기지 않는다
  await $.turn.start({ text: '설명해 줘', turnId: 't3' })
  live = usage(61000, 1.5)
  await $.turn.complete({ answer: '설명', durationMs: 9000, isAborted: false, turnId: 't3', reason: 'answer' })
  expect(logged).toHaveLength(1)
})

test('스피너 줄: 이번 턴에 고친 파일 수와 메인 에이전트의 도구 호출 수를 "…" 앞에 붙인다', async ($, on) => {
  const drawn: string[] = []
  on('clock.now', () => ({ value: 0 }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', e => ({ result: { filePath: 'D:/all/a.md', structuredPatch: [{ lines: ['+x'] }] } }) as never)
  // 엔진 자리: 플러그인이 넘긴 suffix를 받아 적는다
  on('ui.render', { component: 'Spinner' }, (_, e) => {
    drawn.push(e.props.suffix)
    return { type: 'Text', props: {}, children: [e.props.word + e.props.suffix] } as never
  })
  const spin = (message: string | null = null) =>
    $.ui.render({ surface: 'terminal', component: 'Spinner', props: { word: 'Pondering', message, suffix: '…', mode: 'tool-use' } } as never)

  await $.turn.start({ text: '고쳐 줘', turnId: 't1' })
  await spin()
  await $.tool.call({ tool: 'Bash', tool_use_id: 'u1', command: 'ls' } as never)
  await $.tool.call({ tool: 'Edit', tool_use_id: 'u2', file_path: 'D:/all/a.md', old_string: 'y', new_string: 'x' } as never)
  // 서브에이전트 안의 호출과 가정 기록 도구는 세지 않는다
  await $.tool.call({ tool: 'Read', tool_use_id: 'u3', file_path: 'D:/all/a.md', agentId: 'sub1' } as never)
  await $.tool.call({ tool: 'mcp__clickbar__log_assumption', tool_use_id: 'u4', assumptions: ['x'] } as never)
  await spin()
  // 엔진이 낱말 대신 안내를 보이는 동안은 손대지 않는다
  await spin('Compacting conversation…')
  // 새 턴은 0부터 센다
  await $.turn.start({ text: '다음', turnId: 't2' })
  await spin()
  expect(drawn).toEqual(['…', ' · 파일 1개 수정 · 도구 2회…', '…', '…'])
})

test('band 상태 줄: 컨텍스트 값이 아직 없을 때의 "컨텍스트 —"도 폭에 넣어, 넘칠 API 환산액은 붙이지 않는다', async ($, on) => {
  on('clock.now', () => ({ value: Date.parse('2026-10-08T05:00:00Z') }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ children: [] }))
  const rateLimits = [
    { kind: 'five_hour' as const, percentUsed: 31, resetsAt: '2026-10-08T08:00:00Z' },
    { kind: 'seven_day' as const, percentUsed: 95, resetsAt: '2026-10-11T05:00:00Z' },
    { kind: 'spend_limit' as const, percentUsed: 46, resetsAt: '2026-11-01T00:00:00Z' },
  ]
  // 컨텍스트는 보고하지 않아(changed에 없음) 미터가 비어 있다
  await $.session.measure({ context: { window: 1000000 }, rateLimits, cost: { usd: 3.84 }, changed: ['rateLimits', 'cost'] } as never)
  const ui = await $.ui.mount({ plugin: 'clickbar', surface: 'terminal', ...band(112) })
  expect(await ui.find({ type: 'Text', text: '—' })).toBeDefined()
  expect(await ui.find({ key: 'band-limit-spend_limit' })).toBeDefined()
  expect(await ui.find({ key: 'band-meter-cost' })).toBe(undefined)
  await ui.unmount()
})

test('동기화 결과 파일로 [sync] 버튼의 이름과 색을 정한다: 보류·실패·하루 넘게 안 돎', async () => {
  const now = Date.parse('2026-10-14T03:00:00Z')
  const held = parseSyncStatus(String.fromCharCode(0xfeff) + '{"at":"2026-10-14T02:00:00+09:00","result":"held","held":["a.md","b.md"],"message":"보류 2개"}')
  expect(held?.held).toEqual(['a.md', 'b.md'])
  expect(syncView(held, now)).toEqual({ word: 'sync held 2', color: 'warning' })
  expect(syncView(parseSyncStatus('{"at":"2026-10-14T02:00:00Z","result":"failed","held":[],"message":"받기 실패"}'), now)).toEqual({ word: 'sync failed', color: 'error' })
  const old = new Date(now - SYNC_STALE_MS - 60_000).toISOString()
  expect(syncView(parseSyncStatus(`{"at":"${old}","result":"ok","held":[],"message":""}`), now)).toEqual({ word: 'sync stale', color: 'warning' })
  expect(syncView(parseSyncStatus('{"at":"2026-10-14T02:30:00Z","result":"ok","held":[],"message":""}'), now)).toEqual({ word: 'sync', color: 'suggestion' })
  // 파일이 없거나 형식이 다르면 문제 없는 것으로 본다
  expect(parseSyncStatus('{broken')).toBe(null)
  expect(parseSyncStatus('{"at":"x","result":"maybe"}')).toBe(null)
  expect(syncView(null, now)).toEqual({ word: 'sync', color: 'suggestion' })
})

test('band: compact 버튼은 /compact를 실행하고, 좁으면 tasks·fork를 팔레트로 보낸다', async ($, on) => {
  const ran: string[] = []
  on('clock.now', () => ({ value: 0 }))
  on('command.run', ($, e) => {
    ran.push(e.command)
    return { text: '' }
  })
  // band는 다른 mod가 그린 내용(next)을 함께 보여주므로, 그 자리를 빈 Box로 채운다
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ children: [] }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'clickbar', surface, ...band(120) })
    expect(await ui.find({ key: 'band-fork' })).toBeDefined()
    expect(await ui.find({ key: 'band-quote' })).toBeDefined()
    // 터미널에서는 맨 위 가로줄이 채팅과 band를 가른다. 폭은 band 폭과 같다
    const rule = await ui.find({ type: 'Text', text: /^── clickbar ─/ })
    if (surface === 'terminal') expect(rule?.text.length).toBe(120)
    else expect(rule).toBe(undefined)
    await ui.press({ key: 'band-compact' })
    await ui.unmount()
  }
  expect(ran).toEqual(['compact', 'compact'])
  // 아주 좁아도 가로줄은 band 폭을 넘지 않는다(넘으면 한 줄 더 꺾인다)
  const tiny = await $.ui.mount({ plugin: 'clickbar', surface: 'terminal', ...band(8) })
  expect((await tiny.find({ type: 'Text', text: /^── click/ }))?.text.length).toBe(8)
  await tiny.unmount()

  const narrow = await $.ui.mount({ plugin: 'clickbar', surface: 'terminal', ...band(90) })
  expect(await narrow.find({ key: 'band-fork' })).toBe(undefined)
  expect(await narrow.find({ key: 'band-btw' })).toBeDefined()
  // 지난 대화 전체 목록은 좁아도 늘 보인다
  await narrow.press({ key: 'band-resume' })
  await narrow.unmount()
  expect(ran).toEqual(['compact', 'compact', 'resume'])
})

test('band 상태 줄: 항목마다 이름·막대·비율을 묶고, 위험이면 !와 색을, API 환산액은 한 줄에 들어갈 때만 붙인다', async ($, on) => {
  const live = {
    startedAt: 0,
    context: { window: 1000000, tokens: 500000 },
    rateLimits: [
      { kind: 'five_hour' as const, percentUsed: 31, resetsAt: '2026-10-08T08:00:00Z' },
      { kind: 'seven_day' as const, percentUsed: 95, resetsAt: '2026-10-11T05:00:00Z' },
    ],
    cost: { usd: 3.84 },
  }
  on('clock.now', () => ({ value: Date.parse('2026-10-08T05:00:00Z') }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: live }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ children: [] }))
  await $.session.measure({ context: live.context, rateLimits: live.rateLimits, cost: live.cost, changed: ['context', 'rateLimits', 'cost'] })

  const wide = await $.ui.mount({ plugin: 'clickbar', surface: 'terminal', ...band(160) })
  expect(await wide.find({ type: 'Text', text: '5시간' })).toBeDefined()
  expect(await wide.find({ type: 'Text', text: '██░░░' })).toBeDefined()
  expect((await wide.find({ type: 'Text', text: '95%' }))?.props.color).toBe('error')
  expect(await wide.find({ type: 'Text', text: /^!$/ })).toBeDefined()
  expect(await wide.find({ key: 'band-meter-cost' })).toBeDefined()
  // "사용량" 낱말과 │ 구분 기호는 쓰지 않는다
  expect(await wide.find({ type: 'Text', text: /사용량|│ API/ })).toBe(undefined)
  await wide.unmount()
  // 넓은 band의 가장 좁은 폭(110칸)에서는 컨텍스트와 한도까지만 한 줄에 두고 API 환산액은 뺀다
  const tight = await $.ui.mount({ plugin: 'clickbar', surface: 'terminal', ...band(110) })
  expect(await tight.find({ key: 'band-limit-seven_day' })).toBeDefined()
  expect(await tight.find({ key: 'band-meter-cost' })).toBe(undefined)
  await tight.unmount()
})

test('quote는 선택한 글을 인용 블록으로 넣고, btw는 쓰던 글을 질문으로 남긴다', async ($, on) => {
  const filled: { text: string; mode: string }[] = []
  on('clock.now', () => ({ value: 0 }))
  on('ui.selection', () => ({ value: { text: '첫 줄\n둘째 줄' } }))
  on('prompt.read', () => ({ value: { text: '이건 왜?', cursor: 5 } }))
  on('prompt.fill', ($, e) => {
    filled.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ children: [] }))
  const ui = await $.ui.mount({ plugin: 'clickbar', surface: 'terminal', ...band(120) })
  await ui.press({ key: 'band-quote' })
  await ui.press({ key: 'band-btw' })
  await ui.unmount()
  expect(filled).toEqual([
    { text: '> 첫 줄\n> 둘째 줄\n\n', mode: 'insert' },
    { text: '/btw "첫 줄 둘째 줄" 이건 왜?', mode: 'replace' },
  ])
})

test('팔레트는 한국어 설명을 보여주고, ▶는 실행하되 인자가 필요한 /btw는 입력창에 넣는다', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const ran: string[] = []
  const filled: string[] = []
  on('command.list', () => ({
    value: [
      { name: 'compact', description: 'Free up context', source: 'builtin' as const },
      { name: 'btw', description: 'Ask aside', source: 'builtin' as const },
      { name: 'rewind', description: 'Rewind', source: 'builtin' as const },
      { name: 'stop', description: 'Stop this background session', source: 'builtin' as const },
      { name: 'my-skill', description: 'A skill', source: 'user' as const },
      { name: 'tdd', description: 'Test-driven development.', source: 'user' as const },
    ],
  }))
  on('command.run', ($, e) => {
    ran.push(e.command)
    return { text: '' }
  })
  on('prompt.fill', ($, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  await $.command.run({ command: 'palette', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  const ui = await $.ui.mount({
    plugin: 'clickbar',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'clickbar-palette',
    props: { title: '명령', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  expect(await ui.find({ type: 'Text', text: /대화를 요약해/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /그 밖의 명령 1개/ })).toBeDefined()
  // 한국어 설명이 없는 명령도 검색하지 않아도 보인다
  expect(await ui.find({ key: 'etc-run-my-skill' })).toBeDefined()
  // 설치한 스킬은 용도별 묶음에 한국어 설명으로 나오고, 설치되지 않은 스킬 묶음은 보이지 않는다
  expect(await ui.find({ type: 'Text', text: '스킬 · 개발 방법' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^테스트를 먼저 작성하고/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '스킬 · 문서와 파일' })).toBe(undefined)
  await ui.press({ key: 'fav-run-rewind' })
  await ui.press({ key: 'fav-run-btw' })
  // 잘못 누르면 하던 일이 멈추는 /stop은 입력창에만 넣는다
  await ui.press({ key: 'g1-run-stop' })
  // 검색어는 팔레트를 다시 열면 비운다
  await ui.input({ key: 'search', text: 'zzz', kind: 'change' })
  expect(await ui.find({ type: 'Text', text: /대화를 요약해/ })).toBeUndefined()
  await $.command.run({ command: 'palette', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  expect(await ui.find({ type: 'Text', text: /대화를 요약해/ })).toBeDefined()
  await ui.unmount()
  expect(ran).toContain('rewind')
  expect(ran).not.toContain('btw')
  expect(ran).not.toContain('stop')
  expect(filled).toEqual(['/btw ', '/stop '])
})

test('팔레트 탭: 단축키는 설치된 명령에만 ▶를 달고, 답변 탭의 copy는 그 답변을 복사한다', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const ran: string[] = []
  const copied: string[] = []
  on('command.list', () => ({
    value: [
      { name: 'rewind', description: 'Rewind', source: 'builtin' as const },
      { name: 'model', description: 'Model', source: 'builtin' as const },
    ],
  }))
  on('command.run', (_, e) => {
    ran.push(e.command)
    return { text: '' }
  })
  on('session.messages', () => ({
    value: [
      { role: 'user' as const, text: '첫 질문', toolUses: [] },
      { role: 'assistant' as const, text: '첫 답변\n둘째 줄', toolUses: [] },
      { role: 'user' as const, text: '둘째 질문', toolUses: [] },
      // 도구 호출 사이의 중간 설명과 도구 결과 행은 답변 목록에 들어가지 않는다
      { role: 'assistant' as const, text: '파일을 확인하겠습니다', toolUses: [] },
      { role: 'user' as const, text: '', toolUses: [], toolResults: [{ tool_use_id: 'u1', text: 'ok', isError: false, result: null }] },
      { role: 'assistant' as const, text: '', toolUses: [] },
      { role: 'assistant' as const, text: '````markdown\n# 최신 답변 제목\n본문\n````', toolUses: [] },
    ],
  }))
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('clock.sleep', () => ({ value: undefined }))
  await $.command.run({ command: 'palette', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  const ui = await $.ui.mount({
    plugin: 'clickbar',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'clickbar-palette',
    props: { title: '명령', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  // 고정한 명령(rewind)은 맨 위 '고정한 명령'에만 나오고 아래 그룹에는 다시 나오지 않는다
  expect(await ui.find({ key: 'fav-run-rewind' })).toBeDefined()
  expect(await ui.find({ key: 'g1-run-rewind' })).toBe(undefined)

  await ui.press({ key: 'tab-keys' })
  expect(await ui.find({ type: 'Text', text: 'Esc Esc' })).toBeDefined()
  expect(await ui.find({ key: 'key-run-fast' })).toBe(undefined)
  await ui.press({ key: 'key-run-model' })
  expect(ran.filter(c => c !== 'palette')).toEqual(['model'])
  // 검색은 키와 설명에서 대소문자 없이 찾고, 맞는 것이 없는 묶음은 숨긴다
  await ui.input({ key: 'search', text: 'ctrl+r', kind: 'change' })
  expect(await ui.find({ type: 'Text', text: 'Ctrl+R' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Esc Esc' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: '모드 · 모델' })).toBe(undefined)
  await ui.input({ key: 'search', text: '되감기', kind: 'change' })
  expect(await ui.find({ type: 'Text', text: 'Esc Esc' })).toBeDefined()
  await ui.input({ key: 'search', text: 'zzz', kind: 'change' })
  expect(await ui.find({ type: 'Text', text: '일치하는 단축키가 없습니다' })).toBeDefined()
  await ui.input({ key: 'search', text: '', kind: 'change' })

  await ui.press({ key: 'tab-replies' })
  expect(await ui.find({ type: 'Text', text: '최신 답변 제목' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '파일을 확인하겠습니다' })).toBe(undefined)
  expect(await ui.find({ key: 'reply-copy-2' })).toBe(undefined)
  await ui.press({ key: 'reply-copy-1' })
  // 바깥 ````markdown 펜스는 벗겨 복사한다
  await ui.press({ key: 'reply-copy-0' })
  await ui.unmount()
  expect(copied).toEqual(['첫 답변\n둘째 줄', '첫 답변\n둘째 줄', '# 최신 답변 제목\n본문', '# 최신 답변 제목\n본문'])
})

test('답변을 감싼 바깥 마크다운 펜스만 벗기고, 안쪽 코드 블록과 받는 중인 답변은 그대로 둔다', async () => {
  const inner = '# 제목\n| a | b |\n| - | - |\n```sql\nselect 1\n```'
  expect(unfence('````markdown\n' + inner + '\n````')).toBe(inner)
  expect(unfence('먼저 한 줄.\n\n````markdown\n' + inner + '\n````\n')).toBe('먼저 한 줄.\n\n' + inner + '\n')
  expect(unfence('````markdown\n' + inner)).toBe('````markdown\n' + inner)
  expect(unfence('```markdown\n# 세 개는 코드 예시\n```')).toBe('```markdown\n# 세 개는 코드 예시\n```')
  expect(unfence('````\n| 태그 | 없음 |\n````')).toBe('| 태그 | 없음 |')
  expect(unfence('````python\nprint(1)\n````')).toBe('````python\nprint(1)\n````')
})

test('내 질문은 막대 카드(기본)·카드·표식으로 그리고, ctrl+o 전체 기록·다른 세션의 글·/bubbles off에서는 엔진에 맡긴다', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  // 엔진 자리: 엔진이 직접 그리면 이 표시가 남는다
  on('ui.render', { component: 'UserMessage' }, (_, e) => ({ type: 'Text', props: {}, children: [`engine:${e.props.text}`] }) as never)
  const user = (text: string, kind: string, isExpanded = false) =>
    $.ui.mount({ plugin: 'clickbar', surface: 'terminal', component: 'UserMessage', props: { text, origin: { kind }, isExpanded } } as never)
  const bubbles = (args: string) =>
    $.command.run({ command: 'bubbles', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as never)
  on('store.set', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))

  // 기본은 막대 카드: 테두리 글자 없이 왼쪽 막대(칸 하나)와 위아래 여백을 둔 카드를 칠한다(복사할 때 글만 따라온다).
  // 테마를 모르면 카드 바탕은 엔진의 내 질문 배경색 이름을 쓴다
  const mine = await user('결제 실패 시 재시도 로직을 추가해 줘\n', 'composer')
  expect(await mine.find({ type: 'Text', text: '결제 실패 시 재시도 로직을 추가해 줘' })).toBeDefined()
  const boxes = await mine.findAll({ type: 'Box' })
  expect(boxes.some(b => b.props.borderStyle !== undefined)).toBe(false)
  expect(boxes.find(b => b.props.width === 1)?.props.backgroundColor).toBe('suggestion')
  expect(boxes.find(b => b.props.paddingY === 1)?.props.backgroundColor).toBe('userMessageBackground')
  await mine.unmount()
  for (const [text, kind, expanded] of [['펼친 기록', 'composer', true], ['다른 세션', 'peer', false]] as const) {
    const other = await user(text, kind, expanded)
    expect(await other.find({ type: 'Text', text: `engine:${text}` })).toBeDefined()
    await other.unmount()
  }
  // 카드는 막대 없이 칠하고, 표식은 배경 없이 ❯와 흐린 글이다
  await bubbles('card')
  const card = await user('카드', 'composer')
  expect((await card.findAll({ type: 'Box' })).some(b => b.props.width === 1)).toBe(false)
  await card.unmount()
  await bubbles('mark')
  const mark = await user('표식', 'composer')
  expect(await mark.find({ type: 'Text', text: '❯' })).toBeDefined()
  expect((await mark.find({ type: 'Text', text: '표식' }))?.props.dimColor).toBe(true)
  await mark.unmount()
  await bubbles('off')
  const off = await user('끈 뒤', 'composer')
  expect(await off.find({ type: 'Text', text: 'engine:끈 뒤' })).toBeDefined()
  await off.unmount()
  // 다음 시험을 위해 기본 모양으로 되돌린다
  await bubbles('on')
})

test('화면에 그리는 답변에서만 바깥 펜스를 벗긴다', async ($, on) => {
  const drawn: string[] = []
  // 엔진 자리: 플러그인이 넘긴 글을 받아 적는다
  on('ui.render', { component: 'AssistantMessage' }, (_, e) => {
    drawn.push(e.props.text)
    return { type: 'Text', props: {}, children: [e.props.text] } as never
  })
  for (const text of ['````markdown\n| a |\n| - |\n````', '그냥 답변']) {
    await $.ui.render({ surface: 'terminal', component: 'AssistantMessage', requestId: 'r1', props: { text, isFirstOfReply: true } } as never)
  }
  expect(drawn).toEqual(['| a |\n| - |', '그냥 답변'])
})

test('fork 버튼은 무엇이 생겼는지 토스트로 알려 준다', async ($, on) => {
  const toasts: string[] = []
  on('clock.now', () => ({ value: 0 }))
  on('command.run', () => ({ text: 'session waiting for a prompt · 사본 · c7d937ba' }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ children: [] }))
  const ui = await $.ui.mount({ plugin: 'clickbar', surface: 'terminal', ...band(120) })
  await ui.press({ key: 'band-fork' })
  await ui.unmount()
  expect(toasts).toEqual(['fork: session waiting for a prompt · 사본 · c7d937ba · 지금 대화는 그대로 이어집니다'])
})

test('아이디어 탭: /idea로 보관하면 프로젝트별로 저장되고, [입력창에]는 입력창에 넣기만 한다', async ($, on) => {
  const store = new Map<string, unknown>()
  const filled: { text: string; mode: string }[] = []
  on('clock.now', () => ({ value: Date.parse('2026-10-10T05:00:00Z') }))
  on('session.root', () => ({ value: 'D:\all' }))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.read', () => ({ value: { text: '쓰던 글', cursor: 4 } }))
  on('prompt.fill', (_, e) => {
    filled.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })
  const run = (args: string) =>
    $.command.run({ command: 'idea', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })

  await run('타임라인 기능 검토')
  await run('')
  expect(store.get('ideas:D:\all')).toEqual([{ text: '타임라인 기능 검토', at: Date.parse('2026-10-10T05:00:00Z') }])

  const ui = await $.ui.mount({
    plugin: 'clickbar',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'clickbar-palette',
    props: { title: '명령', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  expect(await ui.find({ type: 'Text', text: '타임라인 기능 검토' })).toBeDefined()
  await ui.press({ key: 'idea-use-0' })
  // 지금 입력창의 글을 보관하면, 저장한 뒤 입력창을 비운다
  await ui.press({ key: 'idea-shelve' })
  await ui.unmount()
  expect(filled).toEqual([
    { text: '타임라인 기능 검토', mode: 'insert' },
    { text: '', mode: 'replace' },
  ])
  expect((store.get('ideas:D:\all') as { text: string }[]).map(x => x.text)).toEqual(['쓰던 글', '타임라인 기능 검토'])
})

test('가정 탭: "나머지 모두 맞음"은 열린 것을 맞음으로 바꾸고, "목록 비우기"는 목록을 비운다', async ($, on) => {
  on('clock.now', () => ({ value: Date.parse('2026-10-10T05:00:00Z') }))
  on('store.get', () => ({ value: undefined }))
  on('command.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ children: [] }))
  await $.tool.call({ tool: ASSUME_TOOL, assumptions: ['가', '나'] } as never)
  const bandUi = await $.ui.mount({ plugin: 'clickbar', surface: 'terminal', ...band(120) })
  await bandUi.press({ key: 'band-assume' })
  await bandUi.unmount()
  const pane = await $.ui.mount({
    plugin: 'clickbar',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'clickbar-palette',
    props: { title: '명령', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  expect(await pane.find({ type: 'Text', text: '○' })).toBeDefined()
  await pane.press({ key: 'assume-all-right' })
  expect(await pane.find({ type: 'Text', text: '○' })).toBe(undefined)
  expect(await pane.find({ type: 'Text', text: '✓' })).toBeDefined()
  await pane.press({ key: 'assume-clear' })
  expect(await pane.find({ type: 'Text', text: '✓' })).toBe(undefined)
  await pane.unmount()
})

test('가정 확인: 도구로 한 번에 기록하고, band에 ◆를 띄우고, 틀린 것만 고쳐 달라고 보낸다', async ($, on) => {
  const submitted: string[] = []
  on('clock.now', () => ({ value: Date.parse('2026-10-10T05:00:00Z') }))
  on('store.get', () => ({ value: undefined }))
  on('command.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ children: [] }))

  const answer = await $.tool.call({ tool: ASSUME_TOOL, assumptions: ['표는 날짜순으로 정렬한다', '  ', '금액은 원 단위다'] } as never)
  expect(answer.result).toBe('2개 기록됨. 사용자가 clickbar에서 확인한다. 계속 진행하라.')

  for (const columns of [120, 60]) {
    const ui = await $.ui.mount({ plugin: 'clickbar', surface: 'terminal', ...band(columns) })
    expect(await ui.find({ key: 'band-assume' })).toBeDefined()
    if (columns === 120) await ui.press({ key: 'band-assume' })
    await ui.unmount()
  }

  const pane = await $.ui.mount({
    plugin: 'clickbar',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'clickbar-palette',
    props: { title: '명령', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  const id = `${Date.parse('2026-10-10T05:00:00Z')}`
  await pane.press({ key: `assume-wrong-${id}-0` })
  await pane.press({ key: `assume-right-${id}-1` })
  await pane.press({ key: 'assume-send' })
  await pane.unmount()
  expect(submitted).toEqual([
    [
      '방금 작업에서 세운 가정 중 아래는 틀렸어. 이 부분만 고쳐 줘.',
      '1. 가정: 표는 날짜순으로 정렬한다',
      '   → 이 가정을 버리고 다시 판단해 줘',
      '',
      '맞다고 확인한 가정(그대로 둬): 금액은 원 단위다',
    ].join('\n'),
  ])
  expect(correctionPrompt([{ id: 'x', text: 'A', at: 0, status: 'wrong', fix: ' B ', agent: '' }])).toBe(
    ['방금 작업에서 세운 가정 중 아래는 틀렸어. 이 부분만 고쳐 줘.', '1. 가정: A', '   → 대신: B'].join('\n'),
  )
})

test('가정 기록을 꺼 두면 세션 시작 때 도구를 등록하지 않고, 불려도 기록하지 않는다', async ($, on) => {
  const registered: string[] = []
  let mode: string | undefined = 'off'
  on('store.get', (_, e) => ({ value: e.key === 'assumptions' ? mode : undefined }))
  on('tool.register', (_, e) => {
    registered.push(e.name)
    return { value: { tool: `mcp__clickbar__${e.name}` } }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: 'D:\all', surface: 'terminal', isInteractive: true })
  expect(registered).toEqual([])
  const answer = await $.tool.call({ tool: ASSUME_TOOL, assumptions: ['아무거나'] } as never)
  expect(answer.result).toBe('가정 기록이 꺼져 있다. 이 도구를 더 부르지 마라.')
  // 대조군: 켜져 있으면 같은 세션 시작에서 도구를 등록한다
  mode = undefined
  await $.session.start({ cwd: 'D:\all', surface: 'terminal', isInteractive: true })
  expect(registered).toEqual(['log_assumption'])
})

test('아이디어 탭의 [보내기]는 보낸 것이 확인된 뒤에만 아이디어를 지운다', async ($, on) => {
  const store = new Map<string, unknown>([['ideas:D:\all', [{ text: '첫째', at: 1 }, { text: '둘째', at: 2 }]]])
  let accept = false
  on('clock.now', () => ({ value: 3 }))
  on('session.root', () => ({ value: 'D:\all' }))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => (accept ? { text: e.text } : { drop: 'blocked' }))
  await $.command.run({ command: 'idea', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  const ui = await $.ui.mount({
    plugin: 'clickbar',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'clickbar-palette',
    props: { title: '명령', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  await ui.press({ key: 'idea-send-0' })
  expect((store.get('ideas:D:\all') as unknown[]).length).toBe(2)
  accept = true
  await ui.press({ key: 'idea-send-0' })
  await ui.unmount()
  expect((store.get('ideas:D:\all') as { text: string }[]).map(x => x.text)).toEqual(['둘째'])
})

test('기록 파일에서 사람이 직접 보낸 질문만 꺼낸다', async () => {
  const lines = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-10T05:00:00Z', message: { content: '첫 질문' } },
    { type: 'user', uuid: 'u2', timestamp: '2026-10-10T05:01:00Z', message: { content: '<command-name>/clear</command-name>' } },
    { type: 'user', uuid: 'u3', timestamp: '2026-10-10T05:02:00Z', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'user', uuid: 'u4', timestamp: '2026-10-10T05:03:00Z', isMeta: true, message: { content: '숨은 글' } },
    { type: 'assistant', uuid: 'a1', message: { content: [{ type: 'text', text: '답' }] } },
    { type: 'user', uuid: 'u5', timestamp: '2026-10-10T05:04:00Z', message: { content: [{ type: 'text', text: '둘째 질문' }] } },
  ]
    .map(x => JSON.stringify(x))
    .join('\n')
  expect(promptsFromTranscript(`${lines}\n{broken`).map(p => [p.uuid, p.text])).toEqual([
    ['u1', '첫 질문'],
    ['u5', '둘째 질문'],
  ])
})

test('내 질문: 보낸 질문만 모아 보여 주고, 이동이 안 되면 오류 대신 안내한다', async ($, on) => {
  const toasts: string[] = []
  on('clock.now', () => ({ value: Date.parse('2026-10-10T05:00:00Z') }))
  on('command.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.session.append({
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: '표를 날짜순으로 정리해 줘' }] },
    door: 'prompt',
    origin: { kind: 'composer' },
    uuid: 'row-1',
  } as never)
  await $.session.append({
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: '<task-notification>끝</task-notification>' }] },
    door: 'prompt',
    origin: { kind: 'task-notification' },
    uuid: 'row-2',
  } as never)

  await $.command.run({ command: 'palette', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  const ui = await $.ui.mount({
    plugin: 'clickbar',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'clickbar-palette',
    props: { title: '명령', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  await ui.press({ key: 'tab-prompts' })
  expect(await ui.find({ type: 'Text', text: '표를 날짜순으로 정리해 줘' })).toBeDefined()
  expect(await ui.find({ key: 'prompt-jump-1' })).toBe(undefined)
  await ui.press({ key: 'prompt-jump-0' })
  await ui.unmount()
  // 테스트 환경에는 대화 행이 그려져 있지 않아 이동은 거절된다. 실제 이동은 화면에서 확인한다
  expect(toasts).toEqual(['해당 질문 위치로 이동할 수 없습니다. 압축 이전 대화이거나 화면에 표시되지 않은 질문입니다'])
})

test('명령 추천: 질문 문장이 내장 명령과 맞으면 한 번만 알려 주고, 질문은 바꾸지 않는다', async ($, on) => {
  const toasts: string[] = []
  on('store.get', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  const r1 = await $.prompt.submit({ text: '컨텍스트 좀 압축해 줘', wait: false, origin: { kind: 'composer' } })
  await $.prompt.submit({ text: '대화 압축해 줘', wait: false, origin: { kind: 'composer' } })
  await $.prompt.submit({ text: '로그인 화면 만들어 줘', wait: false, origin: { kind: 'composer' } })
  expect('text' in r1 && r1.text).toBe('컨텍스트 좀 압축해 줘')
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toMatch(/^팁: \/compact 명령으로 바로 실행할 수 있습니다\. 대화를 요약해/)
})

test('/ 메뉴: 엔진 내장 명령의 설명만 한국어로 바꾼다', async ($, on) => {
  on('command.describe', (_, e) => ({ description: e.description, isHidden: e.isHidden }))
  const core = await $.command.describe({ command: 'compact', description: 'Free up context', isHidden: false, immediate: false, provider: { plugin: 'engine', tier: 'core' } } as never)
  const other = await $.command.describe({ command: 'compact', description: 'Mine', isHidden: false, immediate: false, provider: { plugin: 'someone', tier: 'user' } } as never)
  expect(core.description).toMatch(/^대화를 요약해/)
  expect(other.description).toBe('Mine')
  // 팔레트에 한국어 설명을 둔 스킬도 / 메뉴에서는 원래 설명 그대로다(엔진 내장 명령이 아니므로)
  const skill = await $.command.describe({ command: 'tdd', description: 'Test-driven development.', isHidden: false, immediate: false, provider: { plugin: 'skills', tier: 'user' } } as never)
  expect(skill.description).toBe('Test-driven development.')
})

test('[단축키]는 OS에 맞는 키를 보인다: macOS는 Option 키·이미지 붙여넣기 Ctrl+V, OS는 환경 변수로 가린다', async () => {
  expect(platformOf({ os: 'Windows_NT', cfEncoding: '0x0:3:51' })).toBe('windows')
  expect(platformOf({ cfEncoding: '0x0:3:51' })).toBe('mac')
  expect(platformOf({})).toBe('linux')
  const keysOf = (platform: Platform) => keyGroupsFor(platform).flatMap(group => group.entries)
  const win = keysOf('windows')
  const mac = keysOf('mac')
  const linux = keysOf('linux')
  // Windows는 적은 그대로
  expect(win.find(k => k.command === 'model')?.keys).toBe('Alt+P')
  expect(win.some(k => k.keys === 'Alt+V')).toBe(true)
  // macOS: Option 키, 이미지 붙여넣기는 Ctrl+V(iTerm2는 Cmd+V), Windows에만 맞는 Alt+M 안내는 뺀다
  expect(mac.find(k => k.command === 'model')?.keys).toBe('Option+P')
  expect(mac.find(k => k.command === 'fast')?.keys).toBe('Option+O')
  expect(mac.some(k => k.keys === 'Option+T')).toBe(true)
  expect(mac.some(k => k.keys.startsWith('Alt+'))).toBe(false)
  expect(mac.find(k => k.keys === 'Ctrl+V')?.ko).toContain('iTerm2')
  expect(mac.find(k => k.keys === 'Shift+Tab')?.ko).not.toContain('Alt+M')
  // Linux: Alt는 그대로, 이미지 붙여넣기만 Ctrl+V
  expect(linux.find(k => k.command === 'model')?.keys).toBe('Alt+P')
  expect(linux.some(k => k.keys === 'Ctrl+V')).toBe(true)
  // OS마다 줄 수는 같다(바꾸기만 하고 빼거나 더하지 않는다)
  expect(mac.length).toBe(win.length)
  expect(linux.length).toBe(win.length)
})

test('[sessions]는 /sessions를 거치지 않고 세션 패널을 바로 연다(답변 중에도 줄 서지 않게)', async ($, on) => {
  const opened: string[] = []
  const ran: string[] = []
  on('clock.now', () => ({ value: 0 }))
  on('store.get', () => ({ value: undefined }))
  on('command.list', () => ({ value: [{ name: 'sessions', description: '세션 패널', source: 'builtin' as const }] }))
  on('command.run', (_, e) => {
    ran.push(e.command)
    return { text: '' }
  })
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ children: [] }))
  // 명령 목록은 팔레트를 열 때 읽는다. /sessions가 있어야 [sessions]가 생긴다
  await $.command.run({ command: 'palette', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  const ui = await $.ui.mount({ plugin: 'clickbar', surface: 'terminal', ...band(120) })
  await ui.press({ key: 'band-sessions' })
  await ui.unmount()
  expect(opened).toContain('session-tracker-panel')
  expect(ran).not.toContain('sessions')
})
