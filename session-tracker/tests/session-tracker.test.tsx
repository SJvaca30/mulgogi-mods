import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { cleanName, composerHasText, findTerminal, kindWord, launchVerdict, parseAgents, selfKindView, stateCounts, stateWord } from '../hooks/panel'
import { DEFAULT_VIEW, arrange, buildItems, dayTitle, orcaHasPath, parseHistory, parseIdList, parseView, sinceText } from '../hooks/sessions'
import { alivePeers, overlapNote, parseRecord, rootKey } from '../hooks/records'
import { herdrCreated, herdrLines, herdrPaneByLabel, herdrPaneOf, locatorFromEnv, orcaHasTerminal } from '../hooks/hosts'
import type { SessionRecord } from '../types'

const NOW = Date.parse('2026-10-11T05:00:00Z')
// 엔진은 경로 구분자를 바꿔 넘기므로, 대역에서는 소문자와 /로 맞춰 비교한다.
// macOS·Linux 엔진은 'C:/…'를 상대 경로로 보고 현재 폴더 뒤에 붙여 넘기므로, 'c:/' 앞에 붙은 것은 떼고 비교한다(2026-10-14)
const norm = (path: string) => {
  const p = path.split('\\').join('/').toLowerCase()
  const at = p.indexOf('c:/')

  return at > 0 ? p.slice(at) : p
}
const rec = (over: Partial<SessionRecord>): SessionRecord => ({
  id: 'other',
  root: 'D:\\all',
  status: 'working',
  prompt: '결제 API 오류 고쳐 줘',
  changedAt: NOW - 120_000,
  at: NOW - 30_000,
  ...over,
})

test('같은 폴더의 살아 있는 다른 세션만 고르고, 끝났거나 소식이 끊긴 세션과 나 자신은 뺀다', async () => {
  const list = [
    rec({ id: 'me' }),
    rec({ id: 'other' }),
    rec({ id: 'ended', status: 'ended' }),
    rec({ id: 'stale', at: NOW - 10 * 60_000 }),
    rec({ id: 'elsewhere', root: 'D:\\other-project' }),
    rec({ id: 'idle', status: 'idle', changedAt: NOW - 60_000 }),
  ]
  expect(alivePeers(list, 'me', 'D:\\all', NOW).map(r => r.id)).toEqual(['idle', 'other'])
  expect(rootKey('D:\\all')).toBe('D-all')
  expect(parseRecord('{broken')).toBe(null)
  expect(parseRecord(JSON.stringify(rec({}))))
    .toEqual(rec({}))
})

test('Claude에게 붙이는 안내는 다른 세션이 작업 중일 때만 만든다', async () => {
  expect(overlapNote([rec({ status: 'idle' })])).toBe(null)
  expect(overlapNote([rec({})])).toBe(
    '참고(session-tracker): 같은 폴더에서 다른 Claude 세션 1개가 작업 중이다(요청: "결제 API 오류 고쳐 줘"). 같은 파일을 동시에 고치지 않도록, 겹칠 것 같으면 먼저 사용자에게 확인하라.',
  )
})

// 엔진 자리: 상태 폴더 하나에 이 세션과 다른 세션의 파일이 있다고 가정한다
// jobDir를 주면 백그라운드 관리자가 띄운 세션(CLAUDE_JOB_DIR 있음)으로 흉내 낸다
function fakeHost(on: Parameters<TestBody>[1], files: Map<string, string>, note: 'on' | 'off' | undefined, jobDir?: string, registered?: string[]) {
  on('env.get', (_, e) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : e.name === 'CLAUDE_JOB_DIR' ? jobDir : undefined }))
  on('session.root', () => ({ value: 'D:\\all' }))
  on('session.id', () => ({ value: 'me' }))
  on('clock.now', () => ({ value: NOW }))
  on('store.get', () => ({ value: note }))
  on('command.register', (_, e) => {
    registered?.push(e.name)
    return { value: { command: e.name } }
  })
  on('fs.write', (_, e) => {
    files.set(norm(e.path), e.text)
    return { value: undefined }
  })
  on('fs.list', () => ({
    value: [...files.keys()].map(path => ({ name: path.split('/').pop() ?? path, kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false })),
  }))
  on('fs.read', (_, e) => ({ value: files.get(norm(e.path)) ?? '' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.every', () => ({ value: undefined }))
}

test('/sync는 설정 저장소의 동기화 스크립트가 있는 PC에서만 등록한다(mod를 받아 쓰는 PC에는 [sync]가 생기지 않는다)', async ($, on) => {
  const registered: string[] = []
  let hasScript = false
  fakeHost(on, new Map(), undefined, undefined, registered)
  on('fs.exists', (_, e) => ({ value: hasScript && norm(e.path) === 'c:/users/me/ccsetting/sync.ps1' }))
  await $.session.start({ cwd: 'D:\\all', surface: 'terminal', isInteractive: true })
  expect(registered).toContain('sessions')
  expect(registered).not.toContain('sync')

  hasScript = true
  registered.length = 0
  await $.session.start({ cwd: 'D:\\all', surface: 'terminal', isInteractive: true })
  expect(registered).toContain('sync')
})

test('세션이 시작되면 자기 상태를 쓰고, band에서 다른 세션 줄을 더하되 다른 mod의 줄은 그대로 둔다', async ($, on) => {
  const dir = 'C:/Users/me/.claude/mods-state/session-tracker/D-all'
  const files = new Map([[norm(`${dir}/other.json`), JSON.stringify(rec({}))]])
  fakeHost(on, files, undefined)
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: ['CLICKBAR'] }))
  await $.session.start({ cwd: 'D:\\all', surface: 'terminal', isInteractive: true })
  expect(JSON.parse(files.get(norm(`${dir}/me.json`)) ?? '{}').status).toBe('idle')

  const ui = await $.ui.mount({
    plugin: 'session-tracker',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  expect(await ui.find({ key: 'peer-other' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'CLICKBAR' })).toBeDefined()
  // 세션 줄 위에는 "── 세션 ───" 가로줄을 band 폭(100칸)에 맞춰 긋는다. 한글 두 글자가 네 칸이라 글자 수는 98개다
  expect((await ui.find({ type: 'Text', text: /^── 세션 ─/ }))?.text.length).toBe(98)
  // CLAUDE_JOB_DIR가 없으면 포그라운드 세션이다
  expect(await ui.find({ type: 'Text', text: ' 포그라운드 ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '탭을 닫으면 꺼짐 · 유지 /background' })).toBeDefined()
  // 다른 세션은 상태별 개수로 줄인다
  expect(await ui.find({ type: 'Text', text: '작업 중 1' })).toBeDefined()
  await ui.unmount()
})

test('백그라운드 세션이면 다른 세션이 없어도 band 세션 줄에 종류 배지와 끄는 법을 보인다', async ($, on) => {
  const files = new Map<string, string>()
  fakeHost(on, files, undefined, 'C:/Users/me/.claude/jobs/abc12345')
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: ['CLICKBAR'] }))
  await $.session.start({ cwd: 'D:\\all', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'session-tracker',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  expect(await ui.find({ type: 'Text', text: ' 백그라운드 ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '탭을 닫아도 켜져 있음 · 끄기 /stop' })).toBeDefined()
  expect(await ui.find({ key: 'self-kind-sep' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'CLICKBAR' })).toBeDefined()
  await ui.unmount()
  expect(selfKindView('')).toBe(null)
  expect(kindWord('interactive')).toBe('포그라운드')
})

test('다른 세션이 작업 중이면 질문에 안내 한 줄을 붙이고, 꺼 두면 붙이지 않는다', async ($, on) => {
  const contexts: (readonly string[] | undefined)[] = []
  const dir = 'C:/Users/me/.claude/mods-state/session-tracker/D-all'
  let note: 'on' | 'off' | undefined
  const files = new Map([[norm(`${dir}/other.json`), JSON.stringify(rec({}))]])
  on('env.get', (_, e) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('session.root', () => ({ value: 'D:\\all' }))
  on('session.id', () => ({ value: 'me' }))
  on('clock.now', () => ({ value: NOW }))
  on('store.get', () => ({ value: note }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('fs.write', (_, e) => {
    files.set(norm(e.path), e.text)
    return { value: undefined }
  })
  on('fs.list', () => ({ value: [...files.keys()].map(path => ({ name: path.split('/').pop() ?? path, kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false })) }))
  on('fs.read', (_, e) => ({ value: files.get(norm(e.path)) ?? '' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.every', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => {
    contexts.push(e.context)
    return { text: e.text }
  })
  await $.session.start({ cwd: 'D:\\all', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: '로그인 화면 고쳐 줘', wait: false, origin: { kind: 'composer' } })
  note = 'off'
  await $.prompt.submit({ text: '다른 질문', wait: false, origin: { kind: 'composer' } })
  expect(contexts[0]?.some(c => c.startsWith('참고(session-tracker)'))).toBe(true)
  expect(contexts[1] ?? []).toEqual([])
})

const AGENTS_JSON = JSON.stringify([
  { pid: 1, id: '2561affb', cwd: 'D:\\other-project', kind: 'background', sessionId: '2561affb-1', name: 'frontend 2', status: 'idle', state: 'blocked' },
  { pid: 2, id: 'abc12345', cwd: 'D:\\all', kind: 'background', sessionId: 'me', name: 'Claude mods 편의 기능 아이디어', status: 'busy', state: 'working' },
  { pid: 3, id: '96394c1c', cwd: 'D:\\all', kind: 'background', sessionId: '96394c1c-1', name: 'Claude Code 설정 동기화 ⑂', status: 'idle', state: 'done' },
  { pid: 4, cwd: 'D:\\other-project', kind: 'interactive', sessionId: '7148776f-1', name: 'SSO 연동', state: 'working' },
  // 멈춘 백그라운드 세션: --all에만 나오고 pid가 없다
  { id: '30a5238d', cwd: 'D:\\all', kind: 'background', sessionId: '30a5238d-1', name: '청년미래적금 연계가입 안내', state: 'done' },
])
const HISTORY = [
  { display: '/sessions', project: 'D:\\all', sessionId: '83b9eb02-1', timestamp: NOW - 3_600_000 },
  { display: 'Orca 세션 정리해 줘', project: 'D:\\all', sessionId: '83b9eb02-1', timestamp: NOW - 3_500_000 },
  // 기록 파일이 30일이 지나 지워진 대화: 열 수 없으니 목록에 넣지 않는다
  { display: '지워진 대화', project: 'D:\\all', sessionId: 'gone-1', timestamp: NOW - 40 * 86_400_000 },
  ...[1, 2, 3, 4, 5, 6].map(i => ({ display: `예전 질문 ${i}`, project: 'D:\\all', sessionId: `old-${i}`, timestamp: NOW - (3 + i) * 86_400_000 })),
]
  .map(o => JSON.stringify(o))
  .join('\n')
const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const entry = (name: string, kind: 'file' | 'dir', mtimeMs = NOW, size = 100) => ({ name, kind, size, mtimeMs, isLink: false })

// 세션 패널 테스트의 엔진 자리: 기록 폴더 목록, history.jsonl, $.store, claude agents, 제목 도우미(pwsh), Orca를 흉내 낸다.
// liveAlso에 넣은 대화는 [열기] 직전의 다시 확인에서 켜진 것으로 나온다. noOrca면 orca 명령이 없는 일반 터미널, root는 이 세션의 폴더
function panelHost(on: Parameters<TestBody>[1], liveAlso: Set<string> = new Set(), opts: { noOrca?: boolean; root?: string; attachFails?: boolean; noWorktree?: boolean; windows?: boolean; records?: Record<string, string>; herdr?: boolean; herdrViewer?: 'title' | 'label' } = {}) {
  const ran: string[][] = []
  const created: { title: string; command: string }[] = []
  const copies: string[] = []
  const toasts: string[] = []
  const commands: { command: string; args?: string }[] = []
  const store = new Map<string, unknown>()
  // 가짜 herdr에서 이 mod가 연 탭(이름표 = 세션 이름)
  const herdrTabs: { tab_id: string; label: string }[] = []
  on('env.get', (_, e) => ({
    value: e.name === 'USERPROFILE' ? 'C:/Users/me' : e.name === 'CLAUDE_JOB_DIR' ? 'C:/Users/me/.claude/jobs/abc12345' : e.name === 'OS' && opts.windows ? 'Windows_NT' : e.name === 'HERDR_ENV' && opts.herdr ? '1' : undefined,
  }))
  on('session.root', () => ({ value: opts.root ?? 'D:\\all' }))
  on('session.id', () => ({ value: 'me' }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.sleep', () => ({ value: undefined }))
  on('ui.copy', (_, e) => {
    copies.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('ui.close', () => ({ value: undefined }))
  // [끄기]의 5초 타이머는 테스트 안에서 끝나지 않게 둔다(바로 끝내면 한 번 누른 상태가 곧장 풀린다)
  on('clock.after', () => new Promise<never>(() => undefined))
  on('clock.every', () => ({ value: undefined }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('agent.list', () => ({ value: [] }))
  on('command.run', (_, e) => {
    commands.push({ command: e.command, args: e.args })
    return {}
  })
  on('fs.write', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: HISTORY.length, mtimeMs: NOW, isLink: false } }))
  on('fs.read', (_, e) => {
    const path = norm(e.path)
    const record = Object.entries(opts.records ?? {}).find(([id]) => path.endsWith(`/${id}.json`) && path.includes('/mods-state/session-tracker/'))

    return { value: record !== undefined ? record[1] : path.endsWith('/history.jsonl') ? HISTORY : '' }
  })
  on('fs.list', (_, e) => {
    const p = norm(e.path)
    if (p.endsWith('/.claude/projects')) return { value: [entry('D--all', 'dir'), entry('D--other-project', 'dir'), entry('C--Users-FS-AppData-Local-Temp-x', 'dir')] }
    if (p.endsWith('/projects/d--all')) {
      return {
        value: [
          entry('me.jsonl', 'file'),
          entry('96394c1c-1.jsonl', 'file'),
          entry('30a5238d-1.jsonl', 'file', NOW - 2 * 86_400_000),
          entry('83b9eb02-1.jsonl', 'file', NOW - 3_000_000),
          entry('spare-1.jsonl', 'file'),
          ...[1, 2, 3, 4, 5, 6].map(i => entry(`old-${i}.jsonl`, 'file', NOW - (3 + i) * 86_400_000)),
          entry('83b9eb02-1', 'dir'),
        ],
      }
    }
    if (p.endsWith('/projects/d--other-project')) return { value: [entry('2561affb-1.jsonl', 'file'), entry('7148776f-1.jsonl', 'file')] }
    if (p.includes('appdata-local-temp')) return { value: [entry('scratch-1.jsonl', 'file')] }

    return { value: [] }
  })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    ran.push(argv)
    if (argv[0] === 'herdr') {
      if (argv[1] === 'agent' && argv[2] === 'list') {
        // 백그라운드 작업 2561affb-1은 작업을 처음 띄운 다른 패널(w1:p5)의 것으로 알려져 있다(세션 프로세스의 환경에서 온 값)
        return ok(JSON.stringify({ id: '1', result: { type: 'agent_list', agents: [
          { pane_id: 'w1:p2', tab_id: 'w1:t2', terminal_title_stripped: 'SSO 연동', agent_session: { agent: 'claude', kind: 'id', source: 'herdr:claude', value: '7148776f-1' } },
          { pane_id: 'w1:p5', tab_id: 'w1:t5', terminal_title_stripped: '다른 작업', agent_session: { agent: 'claude', kind: 'id', source: 'herdr:claude', value: '2561affb-1' } },
          // 이 세션(백그라운드 작업)을 herdr 패널에서 attach해 보고 있다. 창 제목 = 세션 이름(앞에 상태 표시)
          // claude agents로 들어가면 창 제목이 세션 이름이 되고, claude attach는 셸 제목을 그대로 둔다(그때는 이 mod가 단 탭 이름표로 찾는다)
          ...(opts.herdrViewer ? [{ pane_id: 'w1:p1', tab_id: 'w1:t1', terminal_title_stripped: opts.herdrViewer === 'title' ? '✳ Claude mods 편의 기능 아이디어' : '관리자: pwsh.exe', agent_session: null }] : []),
          // 연 탭에 붙은 Claude. 창 제목은 세션 이름이 아니다
          ...herdrTabs.map(t => ({ pane_id: 'w1:p9', tab_id: t.tab_id, terminal_title_stripped: 'Claude Code', agent_session: null })),
        ] } }))
      }
      if (argv[1] === 'tab' && argv[2] === 'list') return ok(JSON.stringify({ id: '5', result: { type: 'tab_list', tabs: [{ tab_id: 'w1:t2', label: 'SSO 연동' }, ...(opts.herdrViewer === 'label' ? [{ tab_id: 'w1:t1', label: 'Claude mods 편의 기능 아이디어' }] : []), ...herdrTabs] } }))
      if (argv[1] === 'tab' && argv[2] === 'create') {
        herdrTabs.push({ tab_id: 'w1:t9', label: argv[argv.indexOf('--label') + 1] ?? '' })
        return ok(JSON.stringify({ id: '2', result: { type: 'tab_created', tab: { tab_id: 'w1:t9' }, root_pane: { pane_id: 'w1:p9' } } }))
      }
      // 실제 herdr CLI는 pane read에 화면 글을 그대로 찍는다(JSON 봉투 없음, herdr 0.9.4에서 확인)
      if (argv[1] === 'pane' && argv[2] === 'read') return ok(`${'─'.repeat(30)} frontend 2 ─${String.fromCharCode(10)}❯ `)
      return ok(JSON.stringify({ id: '4', result: { type: 'ok' } }))
    }
    if (opts.noOrca && argv[0] === 'orca') return { value: { exitCode: 127, stdout: '', stderr: 'orca: command not found', isStdoutTruncated: false, isStderrTruncated: false } }
    if (argv[0] === 'claude' && argv[1] === 'agents') {
      if (argv.includes('--all')) return ok(AGENTS_JSON)
      const fresh = JSON.parse(AGENTS_JSON).filter((r: { pid?: number }) => r.pid !== undefined)
      for (const id of liveAlso) fresh.push({ pid: 9, cwd: 'D:\\all', kind: 'interactive', sessionId: id, name: id })
      return ok(JSON.stringify(fresh))
    }
    if (argv[0] === 'pwsh') {
      const paths = String(e.init?.stdin ?? '').split('\n').filter(Boolean)
      const found = paths.map(path => ({ p: path, c: '', a: path.endsWith('83b9eb02-1.jsonl') ? 'Orca의 미사용 세션' : '', w: path.includes('spare-1') ? '' : 'D:\\all' }))
      return ok(JSON.stringify(found))
    }
    if (argv[1] === 'worktree') return ok(JSON.stringify({ ok: true, result: { worktrees: opts.noWorktree ? [] : [{ path: 'D:\\all' }, { path: 'D:\\other-project' }] } }))
    if (argv[2] === 'list') return ok(JSON.stringify({ ok: true, result: { terminals: [{ handle: 'term_b', title: '⠂ SSO 연동' }, { handle: 'term_c', title: '⠂ Claude Code 설정 동기화 ⑂' }] } }))
    if (argv[2] === 'create') {
      created.push({ title: argv[argv.indexOf('--title') + 1] ?? '', command: argv[argv.indexOf('--command') + 1] ?? '' })
      return ok(JSON.stringify({ ok: true, result: { terminal: { handle: `term_new${created.length}` } } }))
    }
    if (argv[2] === 'read' && String(argv[4]).startsWith('term_new')) {
      const tab = created[Number(String(argv[4]).slice('term_new'.length)) - 1] ?? { title: '', command: '' }
      const failed = opts.attachFails === true && tab.command.startsWith('claude attach')
      const tail = failed
        ? [`No job matching '${tab.command.split(' ')[2]}'. Run 'claude agents' to list running sessions.`, 'D:\\all>']
        : ['─'.repeat(30) + ` ${tab.title} ─`, '❯ ', '─'.repeat(40)]
      return ok(JSON.stringify({ ok: true, result: { terminal: { tail } } }))
    }
    if (argv[2] === 'read') return ok(JSON.stringify({ ok: true, result: { terminal: { tail: ['─'.repeat(40), '❯ ', '─'.repeat(40)] } } }))

    return ok('{}')
  })

  return { ran, toasts, commands, store, copies }
}

async function openPanel($: Parameters<TestBody>[0]) {
  await $.session.start({ cwd: 'D:\\all', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'sessions', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })

  return $.ui.mount({
    plugin: 'session-tracker',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'session-tracker-panel',
    props: { title: '세션', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  })
}

test('모든 대화 목록: 켜진 대화와 기록이 남은 꺼진 대화를 합치고, 폴더별·날짜별·고정·보관으로 한 번씩만 놓는다', async () => {
  const rows = parseAgents(AGENTS_JSON, 'me')
  expect(rows.find(r => r.sessionId === 'me')?.isSelf).toBe(true)
  expect(rows.find(r => r.sessionId === '30a5238d-1')?.isLive).toBe(false)
  const files = ['me', '96394c1c-1', '30a5238d-1', '83b9eb02-1', 'spare-1', '2561affb-1', '7148776f-1'].map(id => ({
    sessionId: id,
    slug: id.startsWith('2561') || id.startsWith('7148') ? 'D--other-project' : 'D--all',
    path: `C:/x/${id}.jsonl`,
    mtimeMs: id === '30a5238d-1' ? NOW - 2 * 86_400_000 : id === '83b9eb02-1' ? NOW - 3_000_000 : NOW,
    size: 100,
  }))
  const titles = {
    '83b9eb02-1': { m: 0, s: 0, t: 'Orca의 미사용 세션', k: 'ai' as const, c: 'D:\\all' },
    'spare-1': { m: 0, s: 0, t: '', k: '' as const, c: '' },
  }
  const items = buildItems({ rows, files, titles, names: {}, history: parseHistory(HISTORY), now: NOW })
  const byId = new Map(items.map(it => [it.sessionId, it]))
  expect(byId.get('83b9eb02-1')).toMatchObject({ kind: 'off', name: 'Orca의 미사용 세션', reopen: 'resume', cwd: 'D:\\all' })
  expect(byId.get('30a5238d-1')).toMatchObject({ kind: 'off', name: '청년미래적금 연계가입 안내', reopen: 'attach', shortId: '30a5238d' })
  // 기록 파일이 없는 대화와 이름·질문이 없는 빈 세션은 뺀다
  expect(byId.has('gone-1')).toBe(false)
  expect(byId.has('spare-1')).toBe(false)
  // 첫 질문은 슬래시 명령을 건너뛴다
  expect(parseHistory(HISTORY).get('83b9eb02-1')?.firstPrompt).toBe('Orca 세션 정리해 줘')

  const folder = arrange(items, { view: DEFAULT_VIEW, pins: [], archived: [], showArchived: false, now: NOW })
  expect(folder.groups.map(g => g.title)).toEqual(['D:\\all', 'D:\\other-project'])
  // 폴더 안에서는 켜진 대화(작업 중 → 나머지)가 먼저, 꺼진 대화는 최근 것부터
  expect(folder.groups[0]?.items.map(it => it.sessionId)).toEqual(['me', '96394c1c-1', '83b9eb02-1', '30a5238d-1'])
  expect(folder.groups[1]?.items.map(it => it.sessionId)).toEqual(['2561affb-1', '7148776f-1'])

  const offByDate = arrange(items, { view: { mode: 'date', filter: { folder: 'all', date: 'off' } }, pins: [], archived: [], showArchived: false, now: NOW })
  expect(offByDate.groups.map(g => g.title)).toEqual(['오늘', dayTitle(NOW - 2 * 86_400_000, NOW)])
  expect(offByDate.groups.flatMap(g => g.items).every(it => it.kind === 'off')).toBe(true)

  // 고정한 대화는 필터와 상관없이 맨 위에, 묶음에는 다시 나오지 않는다. 보관한 대화는 보관함에만
  const pinned = arrange(items, { view: { mode: 'folder', filter: { folder: 'off', date: 'all' } }, pins: ['me'], archived: ['30a5238d-1'], showArchived: false, now: NOW })
  expect(pinned.pinned.map(it => it.sessionId)).toEqual(['me'])
  expect(pinned.groups.flatMap(g => g.items).map(it => it.sessionId)).toEqual(['83b9eb02-1'])
  const box = arrange(items, { view: DEFAULT_VIEW, pins: ['me'], archived: ['30a5238d-1'], showArchived: true, now: NOW })
  expect(box.groups.flatMap(g => g.items).map(it => it.sessionId)).toEqual(['30a5238d-1'])

  expect(dayTitle(NOW, NOW)).toBe('오늘')
  expect(dayTitle(NOW - 86_400_000, NOW)).toBe('어제')
  expect(sinceText(3 * 86_400_000)).toBe('3일 전')
  expect(stateWord('waiting').word).toBe('입력 필요')
  expect(stateWord('idle').word).toBe('대기 중')
  expect(parseView({ mode: 'date', filter: { folder: 'on', date: 'weird' } })).toEqual({ mode: 'date', filter: { folder: 'on', date: 'all' } })
  expect(parseIdList(['a', 1, 'b'])).toEqual(['a', 'b'])
  expect(orcaHasPath(JSON.stringify({ result: { worktrees: [{ path: 'd:/all/' }] } }), 'D:\\all')).toBe(true)
  expect(stateCounts(rows.filter(r => r.isLive)).map(c => `${c.word} ${c.n}`)).toEqual(['입력 필요 1', '작업 중 2', '답변 완료 1'])
  const orca = JSON.stringify({ ok: true, result: { terminals: [{ handle: 'term_a', title: '✳ frontend 2' }, { handle: 'term_b', title: '⠂ SSO 연동' }] } })
  expect(findTerminal(orca, 'SSO 연동')).toBe('term_b')
  expect(findTerminal(orca, '없는 세션')).toBe(null)
})

test('세션 패널: 꺼진 대화를 유휴로 보이고, 보기·상태 필터를 저장하고, 고정·보관·복구·열기를 한다', async ($, on) => {
  const host = panelHost(on)
  const ui = await openPanel($)
  expect(await ui.find({ key: 'agent-open-83b9eb02-1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Orca의 미사용 세션' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^유휴$/ })).toBeDefined()
  // 종류 글자는 입력창 위 배지와 같은 색이다: 백그라운드 파랑, 포그라운드 노랑, 유휴는 흐리게. text는 부분 일치라 ^$로 낱말 하나만 고른다
  expect((await ui.find({ type: 'Text', text: /^백그라운드$/ }))?.props.color).toBe('suggestion')
  expect((await ui.find({ type: 'Text', text: /^포그라운드$/ }))?.props.color).toBe('warning')
  expect((await ui.find({ type: 'Text', text: /^유휴$/ }))?.props.dimColor).toBe(true)
  // 상태 필터 버튼에는 보관하지 않은 대화의 개수가 붙는다
  expect(await ui.find({ type: 'Text', text: /^\[유휴 \d+\]$/ })).toBeDefined()
  expect(await ui.find({ key: 'agent-open-spare-1' })).toBeUndefined()
  expect(await ui.find({ key: 'agent-open-scratch-1' })).toBeUndefined()
  // 켜진 대화의 이동: Orca 탭이 있으면 전환, 탭 없는 백그라운드 세션은 새 탭에서 붙인다
  await ui.press({ key: 'agent-go-7148776f-1' })
  await ui.press({ key: 'agent-go-2561affb-1' })
  expect(host.ran).toContainEqual(['claude', 'agents', '--json', '--all'])
  expect(host.ran).toContainEqual(['orca', 'terminal', 'switch', '--terminal', 'term_b', '--json'])
  // 탭이 없는 백그라운드 세션: 앞으로 띄우지 않고 짧은 id로 붙인 뒤, Claude가 뜬 것을 확인하고 그 탭으로 옮긴다
  expect(host.ran).toContainEqual(['orca', 'terminal', 'create', '--worktree', 'path:D:\\other-project', '--title', 'frontend 2', '--command', 'claude attach 2561affb', '--json'])
  expect(host.ran).toContainEqual(['orca', 'terminal', 'switch', '--terminal', 'term_new1', '--json'])
  // 보기와 상태 필터는 저장되고, 필터는 보기마다 따로다
  await ui.press({ key: 'view-date' })
  await ui.press({ key: 'filter-off' })
  expect(host.store.get('view')).toEqual({ mode: 'date', filter: { folder: 'all', date: 'off' } })
  expect(await ui.find({ key: 'agent-go-2561affb-1' })).toBeUndefined()
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'view-folder' })
  // 묶음마다 꺼진 대화는 5개만 보이고, [더 보기]로 편다
  expect(await ui.find({ key: 'agent-old-6' })).toBeUndefined()
  await ui.press({ key: 'more-d:\\all' })
  expect(await ui.find({ key: 'agent-old-6' })).toBeDefined()
  await ui.press({ key: 'less-d:\\all' })
  expect(await ui.find({ key: 'agent-old-6' })).toBeUndefined()
  // 날짜별 보기는 폴더 끝 이름을 줄지 않게 붙인다(긴 이름이 대신 줄바꿈된다)
  await ui.press({ key: 'view-date' })
  expect(await ui.find({ type: 'Text', text: 'all' })).toBeDefined()
  await ui.press({ key: 'view-folder' })
  // 고정: [관리]를 열어 누르면 맨 위에 한 번만
  expect(await ui.find({ key: 'agent-pin-83b9eb02-1' })).toBeUndefined()
  await ui.press({ key: 'agent-manage-83b9eb02-1' })
  await ui.press({ key: 'agent-pin-83b9eb02-1' })
  expect(host.store.get('pins')).toEqual(['83b9eb02-1'])
  expect((await ui.findAll({ key: 'agent-83b9eb02-1' })).length).toBe(1)
  await ui.press({ key: 'agent-manage-83b9eb02-1' })
  expect(await ui.find({ type: 'Text', text: '[고정 해제]' })).toBeDefined()
  await ui.press({ key: 'agent-manage-83b9eb02-1' })
  // 보관: 목록에서 사라지고, 보관함에서 복구한다
  await ui.press({ key: 'agent-manage-30a5238d-1' })
  await ui.press({ key: 'agent-archive-30a5238d-1' })
  expect(host.store.get('archived')).toEqual(['30a5238d-1'])
  expect(await ui.find({ key: 'agent-30a5238d-1' })).toBeUndefined()
  await ui.press({ key: 'archive-toggle' })
  await ui.press({ key: 'agent-restore-30a5238d-1' })
  expect(host.store.get('archived')).toEqual([])
  // 보관함은 탭이라 다시 눌러도 그대로이고, [폴더별]을 누르면 목록으로 돌아간다
  await ui.press({ key: 'archive-toggle' })
  expect(await ui.find({ key: 'filter-all' })).toBeUndefined()
  await ui.press({ key: 'view-folder' })
  expect(await ui.find({ key: 'filter-all' })).toBeDefined()
  // 열기: 기록만 남은 대화는 --resume, 멈춘 백그라운드 세션은 attach
  await ui.press({ key: 'agent-open-83b9eb02-1' })
  expect(host.ran).toContainEqual(['orca', 'terminal', 'create', '--worktree', 'path:D:\\all', '--title', 'Orca의 미사용 세션', '--command', 'claude --resume 83b9eb02-1', '--json'])
  await ui.press({ key: 'agent-open-30a5238d-1' })
  expect(host.ran).toContainEqual(['orca', 'terminal', 'create', '--worktree', 'path:D:\\all', '--title', '청년미래적금 연계가입 안내', '--command', 'claude attach 30a5238d', '--json'])
  await ui.unmount()
})

test('세션 패널 [이동]: 붙일 작업이 그사이 정리됐으면 실패한 탭을 닫고 기록으로 다시 연다', async ($, on) => {
  const host = panelHost(on, new Set(), { attachFails: true })
  const ui = await openPanel($)
  await ui.press({ key: 'agent-go-2561affb-1' })
  // 붙기 실패(No job matching): 오류만 남은 셸 탭을 닫는다
  expect(host.ran).toContainEqual(['orca', 'terminal', 'close', '--terminal', 'term_new1', '--tab', '--json'])
  // 기록으로 그 폴더에서 다시 열고, 뜬 것을 확인한 뒤 그 탭으로 옮긴다
  expect(host.ran).toContainEqual(['orca', 'terminal', 'create', '--worktree', 'path:D:\\other-project', '--title', 'frontend 2', '--command', 'claude --resume 2561affb-1', '--json'])
  expect(host.ran).toContainEqual(['orca', 'terminal', 'switch', '--terminal', 'term_new2', '--json'])
  expect(host.toasts.some(t => t.includes('기록으로 새 탭에서 다시 열었습니다'))).toBe(true)
  await ui.unmount()
})

test('세션 패널 [이동]: Orca 탭이 없는 포그라운드 세션은 새로 열지 않고 그 창에서 쓰라고 알린다', async ($, on) => {
  const host = panelHost(on)
  const ui = await openPanel($)
  // SSO 연동은 탭 제목으로 찾는다. 다른 이름의 포그라운드 세션은 Orca 밖의 창에서 돌고 있는 것으로 본다
  await ui.press({ key: 'agent-go-7148776f-1' })
  expect(host.ran).toContainEqual(['orca', 'terminal', 'switch', '--terminal', 'term_b', '--json'])
  expect(host.ran.some(a => a[2] === 'create')).toBe(false)
  await ui.unmount()
})

test('세션 패널 [열기]: Orca에 없는 폴더의 기록은 지금 작업 공간의 탭에서 그 폴더로 옮겨 연다(Windows는 cmd로)', async ($, on) => {
  const host = panelHost(on, new Set(), { noWorktree: true, windows: true })
  const ui = await openPanel($)
  await ui.press({ key: 'agent-open-83b9eb02-1' })
  expect(host.ran).toContainEqual(['orca', 'terminal', 'create', '--worktree', 'active', '--title', 'Orca의 미사용 세션', '--command', 'cd /d "D:\\all" && claude --resume 83b9eb02-1', '--shell', 'cmd.exe', '--json'])
  await ui.unmount()
})

test('세션 패널 [이동]: 세션이 자기 기록에 남긴 Orca 탭 handle로 먼저 찾고(이름 없는 세션도), 그 탭이 없으면 제목으로 찾는다', async ($, on) => {
  const record = (term: string) => JSON.stringify({ id: '7148776f-1', root: 'D:\\other-project', status: 'idle', prompt: '', changedAt: NOW, at: NOW, term: { host: 'orca', id: term } })
  const host = panelHost(on, new Set(), { records: { '7148776f-1': record('term_c') } })
  const ui = await openPanel($)
  await ui.press({ key: 'agent-go-7148776f-1' })
  expect(host.ran).toContainEqual(['orca', 'terminal', 'switch', '--terminal', 'term_c', '--json'])
  expect(host.ran).not.toContainEqual(['orca', 'terminal', 'switch', '--terminal', 'term_b', '--json'])
  await ui.unmount()
})

test('세션 패널 [이동]: 기록의 탭이 이미 닫혔으면 제목으로 찾는다', async ($, on) => {
  const stale = JSON.stringify({ id: '7148776f-1', root: 'D:\\other-project', status: 'idle', prompt: '', changedAt: NOW, at: NOW, term: { host: 'orca', id: 'term_gone' } })
  const host = panelHost(on, new Set(), { records: { '7148776f-1': stale } })
  const ui = await openPanel($)
  await ui.press({ key: 'agent-go-7148776f-1' })
  expect(host.ran).toContainEqual(['orca', 'terminal', 'switch', '--terminal', 'term_b', '--json'])
  await ui.unmount()
})

test('세션 패널 herdr: 세션 id로 패널을 찾아 옮기고, 탭 없는 백그라운드 세션은 새 탭(앞으로 띄우지 않음)에 붙인 뒤 옮긴다', async ($, on) => {
  const host = panelHost(on, new Set(), { herdr: true })
  const ui = await openPanel($)
  await ui.press({ key: 'agent-go-7148776f-1' })
  expect(host.ran).toContainEqual(['herdr', 'agent', 'focus', 'w1:p2'])
  await ui.press({ key: 'agent-go-2561affb-1' })
  // 백그라운드 작업의 세션 id가 알려진 패널은 작업을 처음 띄운 곳일 수 있어 그리로 옮기지 않는다
  expect(host.ran).not.toContainEqual(['herdr', 'agent', 'focus', 'w1:p5'])
  expect(host.ran).toContainEqual(['herdr', 'tab', 'create', '--cwd', 'D:\\other-project', '--label', 'frontend 2', '--no-focus'])
  expect(host.ran).toContainEqual(['herdr', 'pane', 'run', 'w1:p9', 'claude attach 2561affb'])
  expect(host.ran).toContainEqual(['herdr', 'tab', 'focus', 'w1:t9'])
  // 화면에서 Claude가 뜬 것을 알아보고 옮겼다(15초를 다 기다린 "아직 열리는 중"이 아니다)
  expect(host.toasts.some(t => t.includes('아직 열리는 중'))).toBe(false)
  // 다시 누르면 새 탭을 또 열지 않고, 이름표로 그 탭을 찾아 옮긴다
  await ui.press({ key: 'agent-go-2561affb-1' })
  expect(host.ran.filter(a => a[0] === 'herdr' && a[1] === 'tab' && a[2] === 'create')).toHaveLength(1)
  expect(host.ran).toContainEqual(['herdr', 'agent', 'focus', 'w1:p9'])
  // herdr 안에서는 Orca를 부르지 않는다
  expect(host.ran.some(a => a[0] === 'orca' && a[2] === 'create')).toBe(false)
  await ui.unmount()
})

for (const how of ['title', 'label'] as const) test(`세션 패널: 백그라운드 작업을 herdr에서 attach해 보고 있으면(${how === 'title' ? '창 제목으로' : '탭 이름표로'} 찾음), 작업 환경이 Orca여도 [이동]은 herdr로 옮긴다`, async ($, on) => {
  const record = JSON.stringify({ id: '7148776f-1', root: 'D:\other-project', status: 'idle', prompt: '', changedAt: NOW, at: NOW, term: { host: 'herdr', id: 'w1:p2' } })
  const host = panelHost(on, new Set(), { herdrViewer: how, records: { '7148776f-1': record } })
  const ui = await openPanel($)
  await ui.press({ key: 'agent-go-7148776f-1' })
  expect(host.ran).toContainEqual(['herdr', 'agent', 'focus', 'w1:p2'])
  expect(host.ran.some(a => a[0] === 'orca' && a[2] === 'switch')).toBe(false)
  expect(host.toasts.some(t => t.includes('실행 중입니다'))).toBe(false)
  await ui.unmount()
})

test('터미널 호스트: herdr 응답에서 세션 패널·새 탭·화면을 꺼내고, 세션 위치는 herdr 패널을 Orca 탭보다 먼저 쓴다', async () => {
  const agents = JSON.stringify({ id: '1', result: { type: 'agent_list', agents: [
    { pane_id: 'w1:p1', terminal_title_stripped: '다른 작업', agent_session: { agent: 'claude', kind: 'id', source: 'herdr:claude', value: 'aaa-1' } },
    { pane_id: 'w1:p3', terminal_title_stripped: '이름만 같음', agent_session: null },
  ] } })
  const fg = (sessionId: string, name: string) => ({ sessionId, name, kind: 'interactive' as const })
  expect(herdrPaneOf(agents, fg('aaa-1', '아무 이름'), null)).toBe('w1:p1')
  expect(herdrPaneOf(agents, fg('zzz-9', '이름만 같음'), null)).toBe('w1:p3')
  expect(herdrPaneOf(agents, fg('zzz-9', '없는 이름'), null)).toBe(null)
  // 백그라운드 작업은 세션 id가 알려진 패널을 믿지 않고 제목으로만 찾는다
  expect(herdrPaneOf(agents, { sessionId: 'aaa-1', name: '아무 이름', kind: 'background' }, null)).toBe(null)
  // 기록의 패널은 지금도 Claude가 떠 있고 다른 세션 것이 아닐 때만 쓴다
  expect(herdrPaneOf(agents, fg('zzz-9', '없는 이름'), 'w1:p3')).toBe('w1:p3')
  expect(herdrPaneOf(agents, fg('zzz-9', '없는 이름'), 'w1:p1')).toBe(null)
  expect(herdrPaneOf(agents, fg('zzz-9', '없는 이름'), 'w1:p8')).toBe(null)
  // 이름표가 세션 이름인 탭에 Claude가 떠 있으면 그 패널, 탭에 Claude가 없으면 없음
  const tabs = JSON.stringify({ id: '5', result: { type: 'tab_list', tabs: [{ tab_id: 'w1:t1', label: '붙인 작업' }, { tab_id: 'w1:t6', label: '빈 탭' }] } })
  const inTab = JSON.stringify({ id: '1', result: { type: 'agent_list', agents: [{ pane_id: 'w1:p4', tab_id: 'w1:t1', terminal_title_stripped: 'Claude Code', agent_session: null }] } })
  expect(herdrPaneByLabel(inTab, tabs, '붙인 작업')).toBe('w1:p4')
  expect(herdrPaneByLabel(inTab, tabs, '빈 탭')).toBe(null)
  expect(herdrPaneByLabel(inTab, tabs, '없는 이름')).toBe(null)
  expect(herdrCreated(JSON.stringify({ id: '2', result: { type: 'tab_created', tab: { tab_id: 'w2:t4' }, root_pane: { pane_id: 'w2:p7' } } }))).toEqual({ tab: 'w2:t4', pane: 'w2:p7' })
  expect(herdrCreated('not json')).toBe(null)
  expect(herdrLines('a' + String.fromCharCode(10) + 'b')).toEqual(['a', 'b'])
  expect(herdrLines(JSON.stringify({ id: '3', result: { type: 'pane_read', read: { text: 'a' + String.fromCharCode(10) + 'b' } } }))).toEqual(['a', 'b'])
  expect(locatorFromEnv({ herdrEnv: '1', herdrPane: 'w1:p2', orcaHandle: 'term_x' })).toEqual({ host: 'herdr', id: 'w1:p2' })
  expect(locatorFromEnv({ orcaHandle: 'term_x' })).toEqual({ host: 'orca', id: 'term_x' })
  expect(locatorFromEnv({})).toBe(null)
  expect(orcaHasTerminal(JSON.stringify({ ok: true, result: { terminals: [{ handle: 'term_x' }] } }), 'term_x')).toBe(true)
  expect(orcaHasTerminal(JSON.stringify({ ok: true, result: { terminals: [] } }), 'term_x')).toBe(false)
})

test('새 탭 화면 판정: 세션 이름 테두리·시작 머리글이면 떴고, 오류 줄이면 실패, 둘 다 없으면 여는 중', async () => {
  expect(launchVerdict(['─'.repeat(20) + ' 결제 리팩터링 ─', '❯ '], '결제 리팩터링')).toEqual({ kind: 'ok' })
  expect(launchVerdict([' ▐▛███▛█   Claude Code v2.1.300'], '아무 이름')).toEqual({ kind: 'ok' })
  expect(launchVerdict(["No job matching 'b6873318-1'. Run 'claude agents' to list running sessions.", 'D:\\all>'], 'x')).toEqual({
    kind: 'failed',
    reason: "No job matching 'b6873318-1'. Run 'claude agents' to list running sessions.",
  })
  expect(launchVerdict(['Microsoft Windows [Version 10.0]', 'D:\\all>claude attach b6873318'], 'x')).toEqual({ kind: 'pending' })
  // 오른쪽에 붙은 패널 글자는 보지 않는다
  expect(launchVerdict(['D:\\all>                    │ ── 세션 ──'], 'x')).toEqual({ kind: 'pending' })
})

test('세션 패널: [열기] 직전에 다시 보고 그사이 켜진 대화는 두 번 열지 않는다', async ($, on) => {
  const host = panelHost(on, new Set(['83b9eb02-1']))
  const ui = await openPanel($)
  await ui.press({ key: 'agent-open-83b9eb02-1' })
  expect(host.ran.some(a => a.includes('claude --resume 83b9eb02-1'))).toBe(false)
  expect(host.toasts.some(t => t.includes('그사이 켜져'))).toBe(true)
  await ui.unmount()
})

test('권한 판정이 "물어봄"이면 승인 대기로, 도구가 돌기 시작하면 다시 작업 중으로 기록한다', async ($, on) => {
  const files = new Map<string, string>()
  on('env.get', (_, e) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('session.root', () => ({ value: 'D:\all' }))
  on('session.id', () => ({ value: 'me' }))
  on('clock.now', () => ({ value: NOW }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('fs.write', (_, e) => {
    files.set(norm(e.path), e.text)
    return { value: undefined }
  })
  on('fs.list', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.every', () => ({ value: undefined }))
  on('tool.check', () => ({ decision: 'ask' as const }))
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start({ cwd: 'D:\all', surface: 'terminal', isInteractive: true })
  const mine = () => JSON.parse(files.get(norm('C:/Users/me/.claude/mods-state/session-tracker/D-all/me.json')) ?? '{}').status
  await $.tool.check({ tool: 'Bash', input: { command: 'ls' } })
  expect(mine()).toBe('waiting')
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  expect(mine()).toBe('working')
})

test('이름 고치기 준비: 다른 세션 입력창이 비었는지 화면으로 보고, 이름은 한 줄 60자로 정리한다', async () => {
  const screen = (lines: string[]) => JSON.stringify({ ok: true, result: { terminal: { tail: lines } } })
  const border = '─'.repeat(40)
  expect(composerHasText(screen(['❯ /reload-plugins', '  ⎿  Reloaded', border, '❯ ', border]))).toBe(false)
  expect(composerHasText(screen([border, '❯ Try "how do I log an error?"', border]))).toBe(false)
  expect(composerHasText(screen([border, '❯ 쓰던 질문', border]))).toBe(true)
  // 여러 줄로 쓰던 글도 쓴 글이다
  expect(composerHasText(screen([border, '❯ ', '  둘째 줄', border]))).toBe(true)
  // 오른쪽에 붙은 패널 글자는 보지 않는다
  expect(composerHasText(screen([`${border}│패널`, '❯                    │[이동] frontend 2', `${border}│`]))).toBe(false)
  // 입력창을 찾지 못하면(대화상자 등) 건드리지 않는다
  expect(composerHasText(screen(['Do you want to proceed?', '❯ 1. Yes']))).toBe(true)
  expect(composerHasText('not json')).toBe(true)
  expect(cleanName('  새\n이름\t ')).toBe('새 이름')
  expect(cleanName('가'.repeat(80)).length).toBe(60)
})

test('세션 패널: 이름을 눌러 고치고, 다른 세션은 그 Orca 탭에 /rename을 친다. [끄기]는 두 번 눌러야 끈다', async ($, on) => {
  const host = panelHost(on)
  const ui = await openPanel($)
  // 이 대화: 내장 /rename
  await ui.press({ key: 'agent-rename-me' })
  expect(await ui.find({ key: 'rename-input' })).toBeDefined()
  await ui.input({ key: 'rename-input', text: 'mods 개발', kind: 'submit' })
  expect(host.commands).toContainEqual({ command: 'rename', args: 'mods 개발' })
  // 다른 세션: 입력창이 빈 것을 확인한 뒤 그 탭에 /rename을 친다
  await ui.press({ key: 'agent-rename-96394c1c-1' })
  await ui.input({ key: 'rename-input', text: ' sync 정리 ', kind: 'submit' })
  expect(host.ran).toContainEqual(['orca', 'terminal', 'read', '--terminal', 'term_c', '--screen', '--json'])
  expect(host.ran).toContainEqual(['orca', 'terminal', 'send', '--terminal', 'term_c', '--text', '/rename sync 정리', '--enter', '--json'])
  // 입력·승인을 기다리는 세션은 건드리지 않는다
  await ui.press({ key: 'agent-rename-2561affb-1' })
  await ui.input({ key: 'rename-input', text: 'x', kind: 'submit' })
  expect(host.ran.some(a => a.includes('/rename x'))).toBe(false)
  // 꺼진 대화는 이름을 바꿀 수 없다
  expect(await ui.find({ key: 'agent-rename-83b9eb02-1' })).toBeUndefined()
  // [끄기]: [관리]를 열고, 한 번 누르면 [정말 끄기]로 바뀌고, 두 번째에 claude stop <짧은 id>
  await ui.press({ key: 'agent-manage-96394c1c-1' })
  await ui.press({ key: 'agent-stop-96394c1c-1' })
  expect(host.ran.some(a => a[1] === 'stop')).toBe(false)
  expect(await ui.find({ type: 'Text', text: '[정말 끄기]' })).toBeDefined()
  await ui.press({ key: 'agent-stop-96394c1c-1' })
  expect(host.ran).toContainEqual(['claude', 'stop', '96394c1c'])
  // 이 대화와 포그라운드 세션, 꺼진 대화는 [관리]를 열어도 [끄기]가 없다. 이 대화는 [보관]도 없고, 꺼진 대화는 이름을 못 바꾼다
  await ui.press({ key: 'agent-manage-me' })
  expect(await ui.find({ key: 'agent-stop-me' })).toBeUndefined()
  expect(await ui.find({ key: 'agent-archive-me' })).toBeUndefined()
  await ui.press({ key: 'agent-manage-7148776f-1' })
  expect(await ui.find({ key: 'agent-stop-7148776f-1' })).toBeUndefined()
  await ui.press({ key: 'agent-manage-30a5238d-1' })
  expect(await ui.find({ key: 'agent-stop-30a5238d-1' })).toBeUndefined()
  expect(await ui.find({ key: 'agent-rename-menu-30a5238d-1' })).toBeUndefined()
  await ui.unmount()
})

test('Orca가 없으면: [이동]·[열기]는 여기서 열기(/resume)와 명령 복사를 펴고, 다른 창의 대화형 세션과 다른 대화의 이름은 누를 수 없다', async ($, on) => {
  const host = panelHost(on, new Set(), { noOrca: true })
  const ui = await openPanel($)
  expect(host.ran).toContainEqual(['orca', '--version'])
  // 다른 창에서 켜진 대화형 세션: 여기서 열면 두 터미널의 메시지가 섞이므로 버튼 없이 표시만 한다
  expect(await ui.find({ key: 'agent-go-7148776f-1' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '다른 창' })).toBeDefined()
  // 다른 대화의 이름은 Orca 탭에 /rename을 대신 칠 수 없어 누를 수 없고, 이 대화는 그대로 고친다
  expect(await ui.find({ key: 'agent-rename-7148776f-1' })).toBeUndefined()
  expect(await ui.find({ key: 'agent-rename-me' })).toBeDefined()
  // 켜진 백그라운드 세션: 다른 폴더여도 여기서 열 수 있고(/resume이 붙여 준다), 복사하면 claude attach
  await ui.press({ key: 'agent-go-2561affb-1' })
  expect(await ui.find({ key: 'agent-here-2561affb-1' })).toBeDefined()
  await ui.press({ key: 'agent-copy-2561affb-1' })
  // 꺼진 대화: 기록만 남은 것은 그 폴더로 가서 --resume, 멈춘 백그라운드 세션은 attach
  await ui.press({ key: 'agent-open-83b9eb02-1' })
  await ui.press({ key: 'agent-copy-83b9eb02-1' })
  await ui.press({ key: 'agent-open-30a5238d-1' })
  await ui.press({ key: 'agent-copy-30a5238d-1' })
  expect(host.copies).toEqual(['claude attach 2561affb', 'cd "D:\\all" && claude --resume 83b9eb02-1', 'claude attach 30a5238d'])
  // 같은 폴더의 꺼진 대화를 여기서 열면, 그사이 켜졌는지 확인한 뒤 /resume <id>
  await ui.press({ key: 'agent-open-83b9eb02-1' })
  await ui.press({ key: 'agent-here-83b9eb02-1' })
  expect(host.ran).toContainEqual(['claude', 'agents', '--json'])
  expect(host.commands).toContainEqual({ command: 'resume', args: '83b9eb02-1' })
  // orca는 있는지 확인할 때 말고는 부르지 않는다
  expect(host.ran.filter(argv => argv[0] === 'orca')).toEqual([['orca', '--version']])
  await ui.unmount()
})

test('Orca가 없을 때 다른 폴더의 꺼진 대화는 여기서 열지 않고 명령 복사만 둔다', async ($, on) => {
  const host = panelHost(on, new Set(), { noOrca: true, root: 'D:\\elsewhere' })
  const ui = await openPanel($)
  await ui.press({ key: 'agent-open-83b9eb02-1' })
  expect(await ui.find({ key: 'agent-here-83b9eb02-1' })).toBeUndefined()
  expect(await ui.find({ key: 'agent-copy-83b9eb02-1' })).toBeDefined()
  // 켜진 백그라운드 세션은 폴더와 상관없이 여기서 연다
  await ui.press({ key: 'agent-go-96394c1c-1' })
  await ui.press({ key: 'agent-here-96394c1c-1' })
  expect(host.commands).toContainEqual({ command: 'resume', args: '96394c1c-1' })
  await ui.unmount()
})

test('다른 mod(clickbar [sessions])가 세션 패널을 직접 열어도 목록을 읽는다', async ($, on) => {
  const host = panelHost(on)
  await $.session.start({ cwd: 'D:\\all', surface: 'terminal', isInteractive: true })
  // /sessions를 거치지 않고 패널이 그려진다(다른 mod가 $.ui.open으로 연 경우)
  const ui = await $.ui.mount({
    plugin: 'session-tracker',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'session-tracker-panel',
    props: { title: '세션', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  })
  expect(host.ran).toContainEqual(['claude', 'agents', '--json', '--all'])
  expect(await ui.find({ key: 'agent-open-83b9eb02-1' })).toBeDefined()
  await ui.unmount()
})
