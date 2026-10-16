// 탭을 다루는 터미널 프로그램(호스트). 세션 패널의 [이동]·[열기]는 이 다섯 동작만 쓴다:
// 세션이 떠 있는 탭 찾기, 그 탭으로 옮기기, 새 탭 열기(앞으로 띄우지 않음), 탭 화면 읽기, 탭 닫기.
// Orca와 herdr를 지원한다. Windows Terminal·일반 PowerShell 창은 열린 탭 목록을 읽거나 탭을 골라 옮기는 명령이 없어
// 이미 떠 있는 세션으로 옮길 수 없으므로 넣지 않았다(그때는 /resume·명령 복사로 연다)

import type { SessionItem, TermLocator } from '../types'
import { createdHandle, findTerminal, screenLines } from './panel'
import { orcaHasPath } from './sessions'

export type RunResult = { exitCode: number; stdout: string; stderr: string }
export type Run = (argv: string[]) => Promise<RunResult>

export type OpenRequest = {
  item: Pick<SessionItem, 'cwd' | 'name'>
  /** 실행할 명령(claude attach … / claude --resume …) */
  command: string
  /** 기록으로 다시 여는 명령이면 그 폴더에서 실행해야 한다(기록은 폴더별로 찾는다) */
  needsCwd: boolean
  isWindows: boolean
}

export interface TerminalHost {
  name: TermLocator['host']
  /** 세션이 떠 있는 탭(패널)의 handle. hint는 그 세션이 자기 기록에 남긴 위치(이 호스트의 것일 때만 온다) */
  locate(item: SessionItem, hint: string | null): Promise<string | null>
  focus(handle: string): Promise<boolean>
  /** 새 탭을 앞으로 띄우지 않고 열어 명령을 실행한다. 실패하면 이유 */
  open(req: OpenRequest): Promise<{ handle: string } | { error: string }>
  read(handle: string): Promise<string[]>
  close(handle: string): Promise<void>
}

/** orca terminal list 결과에 이 handle의 탭이 있는지 */
export function orcaHasTerminal(stdout: string, handle: string): boolean {
  try {
    const parsed = JSON.parse(stdout) as { result?: { terminals?: { handle?: unknown }[] } }
    const list = Array.isArray(parsed?.result?.terminals) ? parsed.result.terminals : []

    return list.some(t => t.handle === handle)
  } catch {
    return false
  }
}

export function orcaHost(run: Run): TerminalHost {
  return {
    name: 'orca',
    async locate(item, hint) {
      const list = await run(['orca', 'terminal', 'list', '--json'])
      if (list.exitCode !== 0) return null
      // 포그라운드 세션은 그 탭 안에서 도는 프로세스라, 세션이 남긴 탭 handle이 지금도 있으면 그 탭이다(이름 없는 세션도 찾는다).
      // 백그라운드 작업이 남긴 handle은 처음 실행된 탭의 것이라 믿지 않고 제목으로 찾는다
      if (hint !== null && item.kind === 'interactive' && orcaHasTerminal(list.stdout, hint)) return hint

      return findTerminal(list.stdout, item.name)
    },
    async focus(handle) {
      return (await run(['orca', 'terminal', 'switch', '--terminal', handle, '--json'])).exitCode === 0
    },
    async open(req) {
      const worktrees = await run(['orca', 'worktree', 'list', '--json'])
      const registered = worktrees.exitCode === 0 && orcaHasPath(worktrees.stdout, req.item.cwd)
      // Orca에 없는 폴더는 지금 작업 공간에 연다. 그 폴더에서 실행해야 하면 옮긴 뒤 실행한다(cd /d는 cmd 문법이라 Windows에서는 셸을 cmd로 정한다)
      const moved = !registered && req.needsCwd
      const command = moved ? (req.isWindows ? `cd /d "${req.item.cwd}" && ${req.command}` : `cd '${req.item.cwd}' && ${req.command}`) : req.command
      const shell = moved && req.isWindows ? ['--shell', 'cmd.exe'] : []
      const made = await run(['orca', 'terminal', 'create', '--worktree', registered ? `path:${req.item.cwd}` : 'active', '--title', req.item.name, '--command', command, ...shell, '--json'])
      const handle = made.exitCode === 0 ? createdHandle(made.stdout) : null

      return handle === null ? { error: firstLine(made.stderr || made.stdout) || 'Orca 탭을 만들지 못했습니다' } : { handle }
    },
    async read(handle) {
      return screenLines((await run(['orca', 'terminal', 'read', '--terminal', handle, '--screen', '--json'])).stdout)
    },
    async close(handle) {
      await run(['orca', 'terminal', 'close', '--terminal', handle, '--tab', '--json'])
    },
  }
}

// herdr 응답은 { id, result: { type, … } } 꼴이다(herdr api schema로 확인). 봉투 없이 result만 오는 경우도 받는다
function herdrResult(stdout: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(stdout) as { result?: unknown }
    const result = parsed !== null && typeof parsed === 'object' && 'result' in parsed ? parsed.result : parsed

    return result !== null && typeof result === 'object' ? (result as Record<string, unknown>) : null
  } catch {
    return null
  }
}

type HerdrAgent = { pane_id?: unknown; tab_id?: unknown; terminal_title_stripped?: unknown; agent_session?: { kind?: unknown; value?: unknown } | null }

// 창 제목 앞의 상태 표시(✳ 등)를 떼고 비교한다(Orca 탭 제목을 찾는 findTerminal과 같은 방법)
const titleKey = (title: string) => title.replace(/^[^\p{L}\p{N}]+/u, '').trim()
const agentsOf = (stdout: string) => {
  const agents = herdrResult(stdout)?.agents

  return Array.isArray(agents) ? (agents as HerdrAgent[]) : []
}

/** herdr status 출력(server: 아래 status: running|not running)에서 서버가 떠 있는지 */
export function herdrServerRunning(stdout: string): boolean {
  return /^server:\s*$[\s\S]*?^\s+status:\s*running\s*$/m.test(stdout.replace(/\r/g, ''))
}

/** herdr에 이 이름을 창 제목으로 띄운 Claude 패널이 있는지. 백그라운드 작업을 attach해서 보고 있는 곳을 찾을 때 쓴다 */
export function herdrShows(stdout: string, name: string): boolean {
  const key = titleKey(name)

  return key !== '' && agentsOf(stdout).some(a => typeof a.terminal_title_stripped === 'string' && titleKey(a.terminal_title_stripped) === key)
}

/**
 * herdr agent list에서 이 세션이 떠 있는 패널. 포그라운드 세션은 herdr의 Claude 연동이 패널마다 알려 둔 세션 id, 그다음 세션이
 * 자기 기록에 남긴 패널(hint)로 찾는다. 둘 다 세션 프로세스의 환경에서 온 값이라, 백그라운드 작업은 작업을 처음 띄운 곳의 패널을
 * 가리킬 수 있어 쓰지 않는다. 마지막으로 탭 제목(= 세션 이름)으로 찾는다
 */
export function herdrPaneOf(stdout: string, item: Pick<SessionItem, 'sessionId' | 'name' | 'kind'>, hint: string | null): string | null {
  const agents = agentsOf(stdout)
  const interactive = item.kind === 'interactive'
  const sessionOf = (a: HerdrAgent) => (a.agent_session?.kind === 'id' && typeof a.agent_session.value === 'string' ? a.agent_session.value : null)
  const bySession = interactive ? agents.find(a => sessionOf(a) === item.sessionId) : undefined
  // 기록의 패널은 지금도 Claude가 떠 있고 다른 세션이 차지하지 않았을 때만 믿는다(herdr는 닫거나 옮긴 패널의 id를 다시 쓰지 않는다)
  const byHint = interactive && hint !== null ? agents.find(a => a.pane_id === hint && (sessionOf(a) ?? item.sessionId) === item.sessionId) : undefined
  const byTitle = agents.find(a => typeof a.terminal_title_stripped === 'string' && titleKey(a.terminal_title_stripped) === titleKey(item.name))
  const hit = bySession ?? byHint ?? byTitle

  return hit !== undefined && typeof hit.pane_id === 'string' ? hit.pane_id : null
}

/**
 * 이름표(label)가 세션 이름인 탭에 떠 있는 Claude 패널. 이 mod는 새 탭을 열 때 이름표에 세션 이름을 단다.
 * 그 탭에 붙은 Claude가 창 제목을 세션 이름으로 바꾸지 않아도, 다음 [이동]이 새 탭을 또 열지 않고 그 탭을 찾는다
 */
export function herdrPaneByLabel(agentsOut: string, tabsOut: string, name: string): string | null {
  const tabs = herdrResult(tabsOut)?.tabs
  const labeled = new Set(
    (Array.isArray(tabs) ? (tabs as { tab_id?: unknown; label?: unknown }[]) : [])
      .filter(t => typeof t.tab_id === 'string' && typeof t.label === 'string' && t.label.trim() === name)
      .map(t => t.tab_id),
  )
  const hit = agentsOf(agentsOut).find(a => labeled.has(a.tab_id))

  return hit !== undefined && typeof hit.pane_id === 'string' ? hit.pane_id : null
}

/** herdr tab create 결과에서 새 탭과 그 첫 패널. 둘을 "탭|패널"로 묶어 handle로 쓴다 */
export function herdrCreated(stdout: string): { tab: string; pane: string } | null {
  const result = herdrResult(stdout)
  const tab = (result?.tab as { tab_id?: unknown } | undefined)?.tab_id
  const pane = (result?.root_pane as { pane_id?: unknown } | undefined)?.pane_id

  return typeof tab === 'string' && typeof pane === 'string' ? { tab, pane } : null
}

/** herdr pane read 결과의 화면 줄. CLI는 화면 글을 그대로 찍는다(herdr 0.9.4에서 확인). API 응답 모양({ result: { read: { text } } })도 받는다 */
export function herdrLines(stdout: string): string[] {
  const text = (herdrResult(stdout)?.read as { text?: unknown } | undefined)?.text

  return (typeof text === 'string' ? text : stdout).split('\n')
}

export function herdrHost(run: Run): TerminalHost {
  return {
    name: 'herdr',
    async locate(item, hint) {
      const list = await run(['herdr', 'agent', 'list'])
      if (list.exitCode !== 0) return null
      const pane = herdrPaneOf(list.stdout, item, hint)
      if (pane !== null) return pane
      const tabs = await run(['herdr', 'tab', 'list'])

      return tabs.exitCode === 0 ? herdrPaneByLabel(list.stdout, tabs.stdout, item.name) : null
    },
    async focus(handle) {
      // 새로 연 탭은 "탭|패널", 찾은 세션은 패널 id다
      const tab = handle.includes('|') ? (handle.split('|')[0] ?? '') : ''
      const done = tab !== '' ? await run(['herdr', 'tab', 'focus', tab]) : await run(['herdr', 'agent', 'focus', handle])

      return done.exitCode === 0
    },
    async open(req) {
      // herdr는 새 탭의 폴더를 직접 받으므로 폴더로 옮기는 명령이 필요 없다
      const made = await run(['herdr', 'tab', 'create', '--cwd', req.item.cwd, '--label', req.item.name, '--no-focus'])
      const ids = made.exitCode === 0 ? herdrCreated(made.stdout) : null
      if (ids === null) return { error: firstLine(made.stderr || made.stdout) || 'herdr 탭을 만들지 못했습니다' }
      const ran = await run(['herdr', 'pane', 'run', ids.pane, req.command])
      if (ran.exitCode !== 0) {
        await run(['herdr', 'tab', 'close', ids.tab])
        return { error: firstLine(ran.stderr || ran.stdout) || 'herdr 탭에서 명령을 실행하지 못했습니다' }
      }

      return { handle: `${ids.tab}|${ids.pane}` }
    },
    async read(handle) {
      const pane = handle.includes('|') ? (handle.split('|')[1] ?? handle) : handle

      return herdrLines((await run(['herdr', 'pane', 'read', pane, '--source', 'visible'])).stdout)
    },
    async close(handle) {
      const tab = handle.includes('|') ? (handle.split('|')[0] ?? '') : ''
      if (tab !== '') await run(['herdr', 'tab', 'close', tab])
    },
  }
}

function firstLine(text: string): string {
  const line = text.split('\n').find(l => l.trim() !== '')?.trim() ?? ''

  return line.length > 160 ? `${line.slice(0, 160)}…` : line
}

/** 세션이 자기 기록에 남길 위치: herdr 패널 안이면 패널 id, Orca 탭 안이면 탭 handle. 둘 다 아니면 null */
export function locatorFromEnv(env: { herdrEnv?: string; herdrPane?: string; orcaHandle?: string }): TermLocator | null {
  if (env.herdrEnv === '1' && env.herdrPane !== undefined && env.herdrPane !== '') return { host: 'herdr', id: env.herdrPane }
  if (env.orcaHandle !== undefined && env.orcaHandle !== '') return { host: 'orca', id: env.orcaHandle }

  return null
}
