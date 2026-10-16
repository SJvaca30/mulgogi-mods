import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { AgentRow, OnOffFilter, SessionItem, SessionRecord, SessionStatus, TermLocator, TitleEntry, ViewMode } from '../types'
import { herdrHost, herdrPaneByLabel, herdrServerRunning, herdrShows, locatorFromEnv, orcaHost } from './hosts'
import type { TerminalHost } from './hosts'
import { cleanName, clipName, composerHasText, findTerminal, kindWord, launchVerdict, parseAgents, selfKindView, stateCounts, stateWord } from './panel'
import type { Tone } from './panel'
import { HEARTBEAT_MS, PROMPT_MAX, SKIP_OLDER_MS, STATUS_WORDS, activePeers, alivePeers, firstLine, overlapNote, parseRecord, rootKey, spanText } from './records'
import {
  DEFAULT_VIEW,
  TITLE_SCRIPT,
  arrange,
  buildItems,
  isScratchProject,
  parseHistory,
  pathKey,
  reopenCommand,
  parseIdList,
  parseTitleScan,
  parseView,
  sinceText,
} from './sessions'
import type { HistoryInfo, TranscriptFile } from './sessions'

const peers = atom({ plugin: 'session-tracker', key: 'peers' } as const, [])
const agents = atom({ plugin: 'session-tracker', key: 'agents' } as const, [])
const sessions = atom({ plugin: 'session-tracker', key: 'sessions' } as const, [])
const view = atom({ plugin: 'session-tracker', key: 'view' } as const, DEFAULT_VIEW)
const pins = atom({ plugin: 'session-tracker', key: 'pins' } as const, [])
const archived = atom({ plugin: 'session-tracker', key: 'archived' } as const, [])
const showArchived = atom({ plugin: 'session-tracker', key: 'showArchived' } as const, false)
const managing = atom({ plugin: 'session-tracker', key: 'managing' } as const, '')
const expanded = atom({ plugin: 'session-tracker', key: 'expanded' } as const, [])
const showLegend = atom({ plugin: 'session-tracker', key: 'showLegend' } as const, false)
// 묶음마다 처음에 보이는 꺼진 대화 수. 나머지는 [유휴 N개 더 보기]로 편다
const OFF_PREVIEW = 5
const subagents = atom({ plugin: 'session-tracker', key: 'subagents' } as const, 0)
const readAt = atom({ plugin: 'session-tracker', key: 'readAt' } as const, 0)
const selfKind = atom({ plugin: 'session-tracker', key: 'selfKind' } as const, '')
const renaming = atom({ plugin: 'session-tracker', key: 'renaming' } as const, '')
const renameDraft = atom({ plugin: 'session-tracker', key: 'renameDraft' } as const, '')
const stopArmed = atom({ plugin: 'session-tracker', key: 'stopArmed' } as const, '')
const orcaReady = atom({ plugin: 'session-tracker', key: 'orcaReady' } as const, false)
const host = atom({ plugin: 'session-tracker', key: 'host' } as const, '')
const opening = atom({ plugin: 'session-tracker', key: 'opening' } as const, '')
const launching = atom({ plugin: 'session-tracker', key: 'launching' } as const, [])
// 새 탭에서 Claude가 뜨기를 기다리는 최대 시간과 화면을 다시 읽는 간격. 넘기면 그 탭으로 옮기고 아직 여는 중이라고 알린다
const LAUNCH_TIMEOUT_MS = 15_000
const LAUNCH_POLL_MS = 800
// 다른 세션이 /rename을 처리할 때까지 기다리는 시간, [끄기]를 한 번 누른 뒤 두 번째 누름을 기다리는 시간
const RENAME_SETTLE_MS = 1500
const STOP_CONFIRM_MS = 5000
const PANE = 'session-tracker-panel'
// 패널이 열려 있을 때만 15초마다 세션 목록을 읽는다
let panelOpen = false
// /sessions-here off로 Claude에게 붙이는 안내를 끈다
const NOTE_SWITCH_KEY = 'note'
const REFRESH_MS = 15_000
// 세션 패널의 열 폭(글자 칸). 한글은 한 글자가 두 칸이다: "이 대화" 7칸, "입력 필요" 9칸, "백그라운드" 10칸
const COL_ACTION = 8
const COL_STATE = 10
const COL_KIND = 11
// band의 세션 줄 위 가로줄 머리 글과 그 폭(한글 두 글자라 8칸). clickbar 줄과 세션 줄을 가른다
const RULE_LABEL = '── 세션 '
const RULE_LABEL_WIDTH = 8
const PEER_TONE: Record<Exclude<SessionStatus, 'ended'>, Tone> = { waiting: 'warning', working: 'success', idle: 'muted' }
// 판정과 상관없이 사람의 답을 기다리는 도구(질문, 계획 승인)
const NEEDS_PERSON = new Set(['AskUserQuestion', 'ExitPlanMode'])
// band에서 다른 세션 이름 버튼의 최대 칸 수와, 한 줄에 이름으로 보일 최대 세션 수
const PEER_NAME_MAX = 18
const PEERS_SHOWN = 2

// claude agents가 아는 켜진 세션의 이름. 모르면 undefined
function liveName(id: string): string | undefined {
  return lastRows.find(r => r.sessionId === id && r.isLive)?.name
}

// 날짜별 보기에서 줄 끝에 붙이는 폴더 이름: 경로의 마지막 부분(예: D 드라이브의 all 폴더 → all)
function folderLabel(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd
}

// 상태 색: warning=사람이 할 일 있음(굵게), success=돌고 있음, muted=기다리는 중(회색)
function toneProps(tone: Tone): { color?: 'warning' | 'success'; bold?: boolean; dimColor?: boolean } {
  if (tone === 'warning') return { color: 'warning', bold: true }
  if (tone === 'success') return { color: 'success' }

  return { dimColor: true }
}

// 이 세션의 상태 파일. 세션마다 자기 파일만 쓰므로 서로 덮어쓰지 않는다
let self: { dir: string; record: SessionRecord } | undefined
// 마지막으로 읽은 claude agents --json --all(켜진 것과 멈춘 백그라운드 세션)
let lastRows: AgentRow[] = []
// lastRows를 마지막으로 읽은 시각. band에 보일 세션의 이름을 모를 때 다시 읽는 간격을 지킨다
let agentsAt = 0
// 사람이 직접 보낸 마지막 질문(prompt.submit에서 받아 다음 메인 턴의 요청으로 쓴다)
let userText: string | undefined
// history.jsonl은 바뀌었을 때만 다시 읽는다
let historyCache: { m: number; s: number; map: Map<string, HistoryInfo> } | undefined
// $.store 키: 보기 설정, 고정, 보관, 제목 캐시(기록 파일 끝에서 읽은 것), 켜져 있을 때 본 이름
const VIEW_KEY = 'view'
const PINS_KEY = 'pins'
const ARCHIVED_KEY = 'archived'
const TITLES_KEY = 'titles'
const NAMES_KEY = 'names'

function log($: EngineInterface, what: string, error: unknown) {
  $.ui.log(`session-tracker: ${what}: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
}

// 프로젝트 폴더를 건드리지 않도록 사용자 폴더 아래(~\.claude\mods-state)에 둔다
async function stateDir($: EngineInterface, root: string) {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))

  return home === undefined ? undefined : `${home}/.claude/mods-state/session-tracker/${rootKey(root)}`
}

async function init($: EngineInterface) {
  const root = await $.session.root()
  const dir = await stateDir($, root)
  if (dir === undefined) return
  const now = await $.clock.now()
  // 이 세션이 떠 있는 탭(Orca 탭 handle·herdr 패널 id). 다른 세션의 [이동]이 이 값으로 정확히 찾아온다
  const term = locatorFromEnv({ herdrEnv: await $.env.get('HERDR_ENV'), herdrPane: await $.env.get('HERDR_PANE_ID'), orcaHandle: await $.env.get('ORCA_TERMINAL_HANDLE') })
  self = { dir, record: { id: await $.session.id(), root, status: 'idle', prompt: '', changedAt: now, at: now, ...(term === null ? {} : { term }) } }
  await save($)
}

async function save($: EngineInterface) {
  if (self === undefined) return
  self.record = { ...self.record, at: await $.clock.now() }
  await $.fs.write(`${self.dir}/${self.record.id}.json`, JSON.stringify(self.record))
}

async function setStatus($: EngineInterface, status: SessionStatus, prompt?: string) {
  if (self === undefined) return
  self.record = { ...self.record, status, changedAt: await $.clock.now(), prompt: prompt === undefined ? self.record.prompt : firstLine(prompt, PROMPT_MAX) }
  await save($)
}

async function refresh($: EngineInterface) {
  if (self === undefined) return
  const now = await $.clock.now()
  let entries: Awaited<ReturnType<EngineInterface['fs']['list']>>
  try {
    entries = await $.fs.list(self.dir)
  } catch {
    entries = [] // 폴더가 아직 없으면 다른 세션도 없다
  }
  const records: SessionRecord[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json') || entry.name === `${self.record.id}.json`) continue
    if (entry.mtimeMs > 0 && now - entry.mtimeMs > SKIP_OLDER_MS) continue
    try {
      const record = parseRecord(String(await $.fs.read(`${self.dir}/${entry.name}`)))
      if (record !== null) records.push(record)
    } catch {
      // 다른 세션이 쓰는 도중이면 다음 갱신 때 다시 읽는다
    }
  }
  const list = alivePeers(records, self?.record.id ?? '', self?.record.root ?? '', now)
  await update($, peers, () => list)
  // band는 겹칠 수 있는 세션을 이름으로 보인다. 이름을 모르는 세션이 있으면 claude agents를 다시 읽는다(1분에 한 번까지)
  const unnamed = activePeers(list).some(p => !lastRows.some(r => r.sessionId === p.id && r.isLive))
  if (unnamed && now - agentsAt > 60_000) await safely($, '세션 이름 읽기', () => loadAgents($))
}

// 실행하는 프로그램은 claude, orca, 그리고 꺼진 대화 제목을 읽는 pwsh 도우미로만 고정한다
async function loadAgents($: EngineInterface) {
  // --all: 멈춘 백그라운드 세션(pid 없음)도 받아 꺼진 대화의 이름과 다시 켜는 방법을 안다
  const run = await $.process.run(['claude', 'agents', '--json', '--all'], { timeoutMs: 20_000 })
  if (run.exitCode === 0) {
    lastRows = parseAgents(run.stdout, self?.record.id ?? '')
    agentsAt = await $.clock.now()
    const rows = lastRows.filter(r => r.isLive)
    await update($, agents, () => rows)
    // 시작할 때 환경변수로 짐작한 종류를 claude agents의 판정으로 바로잡는다
    const mine = rows.find(r => r.isSelf)
    if (mine !== undefined && kindWord(mine.kind) !== '') await update($, selfKind, () => mine.kind)
  }
  const running = (await $.agent.list()).filter(a => a.status === 'running' || a.status === 'waiting' || a.status === 'pending').length
  await update($, subagents, () => running)
  const now = await $.clock.now()
  await update($, readAt, () => now)
}

async function homeDir($: EngineInterface) {
  return (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
}

/** $.store의 제목 캐시. 기록 파일의 수정 시각·크기가 그대로면 다시 읽지 않는다 */
function parseTitleCache(raw: unknown): Record<string, TitleEntry> {
  const out: Record<string, TitleEntry> = {}
  if (raw === null || typeof raw !== 'object') return out
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const e = v as Partial<TitleEntry>
    if (typeof e?.m === 'number' && typeof e.s === 'number' && typeof e.t === 'string' && typeof e.c === 'string') {
      out[id] = { m: e.m, s: e.s, t: e.t, k: e.k === 'custom' || e.k === 'ai' ? e.k : '', c: e.c }
    }
  }

  return out
}

function parseNames(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (raw === null || typeof raw !== 'object') return out
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === 'string' && v !== '') out[id] = v

  return out
}

/**
 * 꺼진 대화의 제목을 /resume처럼 기록 파일 끝부분에서 읽는다. mod는 파일 일부만 읽을 수 없어 pwsh 도우미에 맡긴다.
 * 도우미 스크립트는 mods-state에 써 두고, 읽을 파일 경로는 표준 입력으로 넘긴다(경로에 공백이 있어도 안전하게)
 */
async function readTitles($: EngineInterface, home: string, paths: string[]) {
  const script = `${home}/.claude/mods-state/session-tracker/titles.ps1`
  await $.fs.write(script, TITLE_SCRIPT)
  const run = await $.process.run(['pwsh', '-NoProfile', '-NonInteractive', '-File', script], { stdin: paths.join('\n'), timeoutMs: 120_000 })

  return run.exitCode === 0 ? parseTitleScan(run.stdout) : new Map<string, { t: string; k: 'custom' | 'ai' | ''; c: string }>()
}

/**
 * 켜진 대화와 꺼진 대화(기록 파일이 남은 것)를 모아 세션 패널 목록을 만든다. 기록 파일은 이름과 수정 시각만 본다.
 * 지워진 기록(30일 보관 기간이 지남)은 제목 캐시·이름 캐시·고정·보관에서도 지운다
 */
async function scanSessions($: EngineInterface) {
  const home = await homeDir($)
  if (home === undefined) return
  const projects = `${home}/.claude/projects`
  const files: TranscriptFile[] = []
  for (const dir of await $.fs.list(projects)) {
    if (dir.kind !== 'dir' || isScratchProject(dir.name)) continue
    for (const f of await $.fs.list(`${projects}/${dir.name}`)) {
      if (f.kind !== 'file' || !f.name.endsWith('.jsonl')) continue
      files.push({ sessionId: f.name.slice(0, -'.jsonl'.length), slug: dir.name, path: `${projects}/${dir.name}/${f.name}`, mtimeMs: f.mtimeMs, size: f.size })
    }
  }
  const historyPath = `${home}/.claude/history.jsonl`
  if (await $.fs.exists(historyPath)) {
    const st = await $.fs.stat(historyPath)
    if (historyCache === undefined || historyCache.m !== st.mtimeMs || historyCache.s !== st.size) {
      historyCache = { m: st.mtimeMs, s: st.size, map: parseHistory(String(await $.fs.read(historyPath))) }
    }
  }
  const existing = new Set(files.map(f => f.sessionId))
  const liveIds = new Set(lastRows.filter(r => r.isLive).map(r => r.sessionId))
  // 제목: 꺼진 대화 중 처음 보거나 바뀐 파일만 읽는다. 켜진 대화는 claude agents의 이름을 쓴다
  const titles = parseTitleCache(await $.store.get(TITLES_KEY))
  const stale = files.filter(f => !liveIds.has(f.sessionId) && (titles[f.sessionId]?.m !== f.mtimeMs || titles[f.sessionId]?.s !== f.size))
  let titlesChanged = Object.keys(titles).some(id => !existing.has(id))
  if (stale.length > 0) {
    try {
      const found = await readTitles($, home, stale.map(f => f.path))
      for (const f of stale) {
        const hit = found.get(f.path)
        // 제목을 못 찾은 파일도 적어 둬서 같은 파일을 다시 읽지 않는다
        titles[f.sessionId] = { m: f.mtimeMs, s: f.size, t: hit?.t ?? '', k: hit?.k ?? '', c: hit?.c ?? '' }
      }
      titlesChanged = true
    } catch (error) {
      log($, '꺼진 대화 제목 읽기(pwsh)', error)
    }
  }
  for (const id of Object.keys(titles)) if (!existing.has(id)) delete titles[id]
  if (titlesChanged) await $.store.set(TITLES_KEY, titles)
  // 켜져 있을 때 본 이름을 남겨 두면, 꺼진 뒤에도 같은 이름으로 보인다
  const names = parseNames(await $.store.get(NAMES_KEY))
  let namesChanged = false
  for (const r of lastRows) {
    if (r.name !== '' && !r.name.startsWith('세션 ') && names[r.sessionId] !== r.name) {
      names[r.sessionId] = r.name
      namesChanged = true
    }
  }
  for (const id of Object.keys(names)) {
    if (!existing.has(id) && !liveIds.has(id)) {
      delete names[id]
      namesChanged = true
    }
  }
  if (namesChanged) await $.store.set(NAMES_KEY, names)
  const now = await $.clock.now()
  const items = buildItems({ rows: lastRows, files, titles, names, history: historyCache?.map ?? new Map(), now })
  await update($, sessions, () => items)
  // 지워진 대화는 고정·보관 목록에서도 뺀다(다른 패널이 동시에 고쳤을 수 있어 저장값을 새로 읽어 고친다)
  const known = new Set(items.map(it => it.sessionId))
  for (const key of [PINS_KEY, ARCHIVED_KEY]) {
    const list = parseIdList(await $.store.get(key))
    const kept = list.filter(id => known.has(id))
    if (kept.length !== list.length) await $.store.set(key, kept)
  }
}

// 고정·보관·보기 설정을 저장값에서 다시 읽는다. 다른 세션의 패널이 바꾼 것도 이때 반영된다
async function loadView($: EngineInterface) {
  const v = parseView(await $.store.get(VIEW_KEY))
  const p = parseIdList(await $.store.get(PINS_KEY))
  const a = parseIdList(await $.store.get(ARCHIVED_KEY))
  await update($, view, () => v)
  await update($, pins, () => p)
  await update($, archived, () => a)
}

async function refreshPanel($: EngineInterface) {
  await safely($, '세션 목록 읽기', () => loadAgents($))
  await safely($, '모든 대화 읽기', () => scanSessions($))
  await safely($, '보기 설정 읽기', () => loadView($))
  // 버튼 모양은 같으므로 목록을 먼저 그리고, 누르기 전까지만 맞으면 된다
  await safely($, '보는 곳 확인', () => checkViewer($))
}

// 저장값 고치기는 늘 새로 읽어 고친 뒤 쓴다. 여러 패널이 함께 열려 있어도 서로 덮어쓰지 않게
async function setMode($: EngineInterface, mode: ViewMode) {
  const v = parseView(await $.store.get(VIEW_KEY))
  const next = { ...v, mode }
  await $.store.set(VIEW_KEY, next)
  await update($, view, () => next)
}

async function setFilter($: EngineInterface, mode: ViewMode, filter: OnOffFilter) {
  const v = parseView(await $.store.get(VIEW_KEY))
  const next = { ...v, filter: { ...v.filter, [mode]: filter } }
  await $.store.set(VIEW_KEY, next)
  await update($, view, () => next)
}

async function togglePin($: EngineInterface, id: string) {
  const list = parseIdList(await $.store.get(PINS_KEY))
  const next = list.includes(id) ? list.filter(x => x !== id) : [...list, id]
  await $.store.set(PINS_KEY, next)
  await update($, pins, () => next)
}

// 보관은 목록에서 숨기기만 한다. 고정도 함께 푼다. 기록은 그대로라 [복구]로 언제든 되살린다
async function archiveItem($: EngineInterface, item: SessionItem) {
  const list = parseIdList(await $.store.get(ARCHIVED_KEY))
  const next = list.includes(item.sessionId) ? list : [...list, item.sessionId]
  await $.store.set(ARCHIVED_KEY, next)
  await update($, archived, () => next)
  const pinned = parseIdList(await $.store.get(PINS_KEY))
  if (pinned.includes(item.sessionId)) {
    const kept = pinned.filter(x => x !== item.sessionId)
    await $.store.set(PINS_KEY, kept)
    await update($, pins, () => kept)
  }
  $.ui.toast(`"${item.name}"을 보관했습니다. [보관함]에서 [복구]로 되살립니다`)
}

async function restoreItem($: EngineInterface, item: SessionItem) {
  const list = parseIdList(await $.store.get(ARCHIVED_KEY))
  const next = list.filter(x => x !== item.sessionId)
  await $.store.set(ARCHIVED_KEY, next)
  await update($, archived, () => next)
  $.ui.toast(`"${item.name}"을 목록으로 되돌렸습니다`)
}

/**
 * 꺼진 대화를 다시 켠다. 멈춘 백그라운드 세션은 claude attach로 백그라운드로 다시 켜고,
 * 기록만 남은 대화는 그 폴더의 새 Orca 탭에서 claude --resume으로 연다(포그라운드).
 * 목록은 15초마다 읽으므로, 열기 직전에 다시 확인해 그 사이 켜진 대화를 한 번 더 열지 않는다(같은 기록에 둘이 쓰게 된다)
 */
async function openOff($: EngineInterface, item: SessionItem) {
  try {
    if (await isLiveNow($, item)) return
    if (!(await $.fs.exists(item.cwd))) {
      $.ui.toast(`이 대화의 폴더가 이 PC에 없습니다: ${item.cwd}`, { timeoutMs: 10000 })
      return
    }
  } catch (error) {
    $.ui.toast(`다시 열지 못했습니다: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  await openSession($, item, item.reopen === 'attach' ? 'attach' : 'resume')
}

type LaunchResult = { kind: 'ok' | 'slow' } | { kind: 'failed'; reason: string; command: string }

// [이동]·[열기]에 쓰는 터미널 프로그램(hosts.ts). herdr 패널 안이면 herdr, Orca를 쓸 수 있으면 Orca, 아니면 null(일반 터미널)
async function termHost($: EngineInterface): Promise<TerminalHost | null> {
  const name = await read($, host)
  const run = (argv: string[]) => $.process.run(argv, { timeoutMs: 20_000 })

  return name === 'herdr' ? herdrHost(run) : name === 'orca' ? orcaHost(run) : null
}

/**
 * 새 탭에서 그 대화를 연다. 탭을 앞으로 띄우지 않고 열어, 화면에 Claude가 뜬 것을 확인한 뒤에만 그 탭으로 옮긴다.
 * 붙지 못하면 오류만 남은 셸 탭을 닫고 결과를 돌려준다(바로 띄우면, 실패했을 때 오류가 찍힌 셸 창만 남고 여기 알림은 보이지 않는다).
 * attach는 claude agents의 짧은 id만 받고 어느 폴더에서든 붙는다. resume은 기록을 폴더별로 찾으므로 그 폴더에서 실행한다
 */
async function launchTab($: EngineInterface, term: TerminalHost, item: SessionItem, how: 'attach' | 'resume'): Promise<LaunchResult> {
  const base = how === 'attach' ? `claude attach ${item.shortId}` : `claude --resume ${item.sessionId}`
  const made = await term.open({ item, command: base, needsCwd: how === 'resume', isWindows: (await $.env.get('OS')) === 'Windows_NT' })
  if ('error' in made) return { kind: 'failed', reason: made.error, command: base }
  for (let waited = 0; waited < LAUNCH_TIMEOUT_MS; waited += LAUNCH_POLL_MS) {
    await $.clock.sleep(LAUNCH_POLL_MS)
    const verdict = launchVerdict(await term.read(made.handle), item.name)
    if (verdict.kind === 'failed') {
      await term.close(made.handle)
      return { kind: 'failed', reason: verdict.reason, command: base }
    }
    if (verdict.kind === 'ok') break
    if (waited + LAUNCH_POLL_MS >= LAUNCH_TIMEOUT_MS) {
      await term.focus(made.handle)
      return { kind: 'slow' }
    }
  }
  await term.focus(made.handle)

  return { kind: 'ok' }
}

/**
 * [이동]·[열기]로 새 탭을 여는 동안 그 줄에 "여는 중…"을 보이고(다시 눌러도 또 열지 않는다), 끝나면 결과를 알린다.
 * 붙일 백그라운드 작업이 그사이 정리됐으면(No job matching) 기록으로 다시 연다. 짧은 id가 없는 세션도 기록으로 연다
 */
async function openSession($: EngineInterface, item: SessionItem, how: 'attach' | 'resume') {
  if ((await read($, launching)).includes(item.sessionId)) return
  const term = await termHost($)
  if (term === null) return
  await update($, launching, old => [...old, item.sessionId])
  $.ui.toast(`"${item.name}"을(를) 새 탭에서 여는 중입니다…`)
  try {
    const first = how === 'attach' && item.shortId !== '' ? 'attach' : 'resume'
    let result = await launchTab($, term, item, first)
    let fellBack = false
    if (result.kind === 'failed' && first === 'attach' && /No job matching/i.test(result.reason) && (await $.fs.exists(item.cwd))) {
      fellBack = true
      result = await launchTab($, term, item, 'resume')
    }
    $.ui.toast(
      result.kind === 'failed'
        ? `"${item.name}"을(를) 열지 못했습니다: ${result.reason} · 터미널에서 직접 실행: ${result.command}`
        : result.kind === 'slow'
          ? `"${item.name}" 탭이 아직 열리는 중입니다. 새 탭을 확인하세요`
          : fellBack
            ? `백그라운드 작업이 이미 정리돼 연결할 수 없어, "${item.name}"을(를) 기록으로 새 탭에서 다시 열었습니다`
            : first === 'attach'
              ? `"${item.name}"에 연결했습니다. 탭을 닫아도 백그라운드 세션은 계속 실행됩니다`
              : `"${item.name}"을(를) 새 탭에서 다시 열었습니다`,
      { timeoutMs: result.kind === 'failed' ? 15000 : 8000 },
    )
  } catch (error) {
    $.ui.toast(`"${item.name}"을(를) 열지 못했습니다: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await update($, launching, old => old.filter(id => id !== item.sessionId))
    await refreshPanel($)
  }
}

// 목록은 15초마다 읽으므로, 꺼진 대화를 열기 직전에 그사이 켜졌는지 한 번 더 본다(두 터미널이 같은 기록에 쓰면 메시지가 섞인다)
async function isLiveNow($: EngineInterface, item: SessionItem) {
  const fresh = await $.process.run(['claude', 'agents', '--json'], { timeoutMs: 20_000 })
  if (fresh.exitCode !== 0 || !parseAgents(fresh.stdout, '').some(r => r.sessionId === item.sessionId && r.isLive)) return false
  $.ui.toast(`"${item.name}"은 그사이 켜져 있어 다시 열지 않았습니다. 목록을 새로 읽습니다`)
  await refreshPanel($)

  return true
}

// 시작할 때 환경으로 정한 터미널 프로그램. 백그라운드 작업은 보는 곳에 따라 바꾸고(checkViewer), 보는 곳을 모르면 이 값으로 돌아간다
let envHost: '' | 'orca' | 'herdr' = ''
// orca 명령을 쓸 수 있는지(herdr 안이어도). 백그라운드 작업을 Orca 탭에서 보고 있는지 볼 때 쓴다
let orcaAvailable = false

// [이동]·[열기]에 쓸 터미널 프로그램을 세션마다 한 번 정한다. herdr 패널 안(HERDR_ENV=1)이면 herdr를 쓴다.
// 아니면 Orca: Orca 안(ORCA_PANE_KEY)이면 묻지 않고, 밖이면 orca --version으로 본다. 둘 다 없으면 일반 터미널이라 /resume·명령 복사를 보인다
async function checkOrca($: EngineInterface) {
  let ready = (await $.env.get('ORCA_PANE_KEY')) !== undefined
  if (!ready) {
    try {
      ready = (await $.process.run(['orca', '--version'], { timeoutMs: 5_000 })).exitCode === 0
    } catch {
      ready = false
    }
  }
  const inHerdr = (await $.env.get('HERDR_ENV')) === '1'
  orcaAvailable = ready
  envHost = inHerdr ? 'herdr' : ready ? 'orca' : ''
  await update($, orcaReady, () => envHost === 'orca')
  await update($, host, () => envHost)
}

// 백그라운드 작업의 화면은 사용자가 attach한 탭(claude attach·claude agents)에 뜨지만, 작업 프로세스의 환경은 처음 띄운 곳의 것이다.
// 그래서 세션 패널을 읽을 때마다 이 세션을 띄운 탭이 herdr나 Orca에 있는지 보고, 있으면 그 프로그램을 쓴다.
// herdr는 창 제목(claude agents로 들어가면 세션 이름이 된다)과, 이 mod가 연 탭의 이름표로 찾는다(claude attach는 창 제목을 바꾸지 않는다)
async function checkViewer($: EngineInterface) {
  if ((await read($, selfKind)) !== 'background') return
  const name = lastRows.find(r => r.isSelf)?.name ?? ''
  if (name === '') return
  const run = (argv: string[]) => $.process.run(argv, { timeoutMs: 10_000 }).catch(() => null)
  // herdr 서버가 떠 있을 때만 묻는다(herdr status는 서버를 띄우지 않고 상태만 알려 준다)
  const status = await run(['herdr', 'status'])
  const herdr = status !== null && status.exitCode === 0 && herdrServerRunning(status.stdout) ? await run(['herdr', 'agent', 'list']) : null
  let found: '' | 'orca' | 'herdr' = ''
  if (herdr !== null && herdr.exitCode === 0) {
    if (herdrShows(herdr.stdout, name)) found = 'herdr'
    else {
      const tabs = await run(['herdr', 'tab', 'list'])
      if (tabs !== null && tabs.exitCode === 0 && herdrPaneByLabel(herdr.stdout, tabs.stdout, name) !== null) found = 'herdr'
    }
  }
  if (found === '' && orcaAvailable) {
    const orca = await run(['orca', 'terminal', 'list', '--json'])
    if (orca !== null && orca.exitCode === 0 && findTerminal(orca.stdout, name) !== null) found = 'orca'
  }
  const next = found === '' ? envHost : found
  await update($, host, () => next)
  await update($, orcaReady, () => next === 'orca')
}

// 대상 세션이 자기 기록에 남긴 위치. 기록은 그 세션의 루트 폴더별로 두므로 작업 폴더로 먼저 찾고, 없으면 다른 폴더들을 본다
async function locatorOf($: EngineInterface, item: SessionItem): Promise<TermLocator | null> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  if (home === undefined) return null
  const base = `${home}/.claude/mods-state/session-tracker`
  const readAt = async (dir: string) => {
    try {
      return parseRecord(String(await $.fs.read(`${base}/${dir}/${item.sessionId}.json`)))?.term ?? null
    } catch {
      return null
    }
  }
  const direct = await readAt(rootKey(item.cwd))
  if (direct !== null) return direct
  try {
    for (const entry of await $.fs.list(base)) {
      if (entry.kind !== 'dir' || entry.name === rootKey(item.cwd)) continue
      const found = await readAt(entry.name)
      if (found !== null) return found
    }
  } catch {
    // 기록 폴더가 없으면 위치를 모른다
  }

  return null
}

// Orca 없이 그 대화를 이 터미널에서 연다(내장 /resume <id>). 꺼진 대화는 기록을 불러오고, 켜진 백그라운드 세션은
// 지금 대화를 백그라운드로 보내고 이 터미널을 그 세션에 붙인다(Claude Code 2.1.285부터, ←로 agent view에 돌아온다).
// $.command.run은 답변이 끝날 때까지 기다리므로, 일하는 중이면 그 뒤에 열린다
async function openHere($: EngineInterface, item: SessionItem) {
  await update($, opening, () => '')
  try {
    if (item.kind === 'off' && (await isLiveNow($, item))) return
    if (self?.record.status === 'working') $.ui.toast(`답변이 끝나면 "${item.name}"을(를) 이 터미널에서 엽니다`)
    await $.ui.close({ id: PANE })
    await $.command.run({ command: 'resume', args: item.sessionId })
  } catch (error) {
    $.ui.toast(`/resume으로 열지 못했습니다: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// 새 터미널 탭에 붙여 넣을 명령을 복사한다. Orca가 없으면 다른 탭을 대신 열 수 없어서다
async function copyCommand($: EngineInterface, item: SessionItem, surface: RenderSurface) {
  await update($, opening, () => '')
  const text = reopenCommand(item)
  try {
    const done = await $.ui.copy({ text, surface })
    $.ui.toast(done.isCopied ? `명령을 복사했습니다. 새 터미널 탭에서 붙여 넣으세요: ${text}` : `복사하지 못했습니다. 새 탭에서 직접 치세요: ${text}`, { timeoutMs: 12000 })
  } catch {
    $.ui.toast(`복사하지 못했습니다. 새 탭에서 직접 치세요: ${text}`, { timeoutMs: 12000 })
  }
}

// 설정 저장소(CCsetting)의 sync.ps1 위치. 저장소 위치는 ~/.claude/sync-config.json, 없으면 ~/CCsetting.
// 이 저장소를 쓰지 않는 PC(mod를 받아 쓰는 다른 사람)에는 스크립트가 없으므로 undefined다
async function findSyncScript($: EngineInterface): Promise<{ home: string; script: string } | undefined> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  if (home === undefined) return undefined
  let repo = `${home}/CCsetting`
  try {
    const config = JSON.parse(String(await $.fs.read(`${home}/.claude/sync-config.json`))) as { repo?: unknown }
    if (typeof config.repo === 'string' && config.repo !== '') repo = config.repo
  } catch {
    // 설정 파일이 없으면 기본 위치를 쓴다
  }
  const script = `${repo}/sync.ps1`

  return (await $.fs.exists(script)) ? { home, script } : undefined
}

async function runSync($: EngineInterface) {
  const found = await findSyncScript($)
  if (found === undefined) return $.ui.toast('동기화 스크립트(CCsetting의 sync.ps1)를 찾지 못했습니다')
  const { home, script } = found
  $.ui.toast('동기화 중입니다…')
  const run = await $.process.run(['pwsh', '-NoProfile', '-File', script, '-Quiet'], { timeoutMs: 180_000 })
  let last = ''
  try {
    last = String(await $.fs.read(`${home}/.claude/sync.log`)).trim().split(/\r?\n/).pop() ?? ''
  } catch {
    // 기록이 없으면 종료 코드만 알린다
  }
  // 일부 파일만 보류됐으면 sync.ps1이 남긴 결과 파일에서 그 파일 이름을 꺼내 알린다(로그 마지막 줄에는 이름이 없다)
  let held: string[] = []
  try {
    const status = JSON.parse(String(await $.fs.read(`${home}/.claude/sync.status.json`)).trim()) as { result?: unknown; held?: unknown }
    if (status.result === 'held' && Array.isArray(status.held)) held = status.held.filter((x): x is string => typeof x === 'string')
  } catch {
    // 결과 파일이 없으면 로그 줄만 알린다
  }
  $.ui.toast(
    run.exitCode !== 0
      ? `동기화 실패(코드 ${run.exitCode}): ${firstLine(run.stderr || last, 160)}`
      : held.length > 0
        ? `동기화: 나머지는 올렸고, 비밀값으로 보이는 줄이 있는 파일 ${held.length}개는 보류했습니다. 그 줄을 고치거나 지운 뒤 다시 sync: ${firstLine(held.join(', '), 200)}`
        : `동기화 끝: ${firstLine(last, 160) || '완료'}`,
    { timeoutMs: held.length > 0 ? 20000 : 10000 },
  )
}

async function openPanel($: EngineInterface) {
  panelOpen = true
  await $.ui.open({ id: PANE, title: '세션', closeOnEscape: true })
  await refreshPanel($)
}

// band에서 다른 세션의 이름을 눌렀을 때. 탭을 다루는 프로그램(Orca·herdr)이 있으면 그 세션으로 옮기고, 없으면 세션 패널을 연다
async function goToPeer($: EngineInterface, sessionId: string) {
  // 백그라운드 작업이면 지금 보고 있는 곳(Orca·herdr)을 먼저 확인한다(세션 패널을 열지 않았어도 맞는 프로그램으로 옮기게)
  await safely($, '보는 곳 확인', () => checkViewer($))
  const row = lastRows.find(r => r.sessionId === sessionId && r.isLive)
  if (row === undefined || (await read($, host)) === '') return await openPanel($)
  const kind = row.kind === 'interactive' ? 'interactive' : 'background'
  await switchTo($, { sessionId: row.sessionId, shortId: row.shortId, name: row.name, cwd: row.cwd, state: row.state, kind, isSelf: false, at: 0, reopen: '' })
}

// 그 세션이 떠 있는 탭으로 옮긴다. 세션이 자기 기록에 남긴 위치로 먼저 찾고, 없으면 탭 제목(= 세션 이름)으로 찾는다.
// 탭이 없는 백그라운드 세션은 새 탭에서 붙인다(openSession, ← 로 agent view, 탭을 닫아도 세션은 계속 돈다).
// 탭이 없는 포그라운드 세션은 다른 창에서 돌고 있어 여기서 열지 않는다(두 창이 한 기록에 쓰면 메시지가 섞인다).
// 다른 터미널 프로그램에서 도는 세션이면 그 프로그램을 쓰라고 알린다
async function switchTo($: EngineInterface, item: SessionItem) {
  const { name } = item
  const term = await termHost($)
  if (term === null) return
  try {
    const where = await locatorOf($, item)
    if (where !== null && where.host !== term.name && item.kind === 'interactive') {
      $.ui.toast(`"${name}"은(는) ${where.host === 'herdr' ? 'herdr' : 'Orca'}에서 실행 중입니다. 그 프로그램의 탭에서 이어 쓰세요`, { timeoutMs: 10000 })
      return
    }
    const handle = await term.locate(item, where !== null && where.host === term.name ? where.id : null)
    if (handle !== null) {
      if (!(await term.focus(handle))) $.ui.toast(`"${name}" 탭으로 전환하지 못했습니다`)
      return
    }
    if (item.kind === 'background') return await openSession($, item, 'attach')
    $.ui.toast(
      `"${name}"은(는) ${term.name === 'herdr' ? 'herdr' : 'Orca'} 탭에서 찾지 못했습니다. 다른 창(cmd 등)에서 실행 중이라 여기서 열지 않습니다. 그 창에서 이어 쓰거나, 그 창을 닫은 뒤 [열기]로 다시 여세요`,
      { timeoutMs: 12000 },
    )
  } catch (error) {
    $.ui.toast(`"${name}" 탭으로 옮기지 못했습니다: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// 내장 /resume 선택 창을 연다. Claude가 일하는 중이면 끝난 뒤에 열린다
async function openResume($: EngineInterface) {
  try {
    await $.command.run({ command: 'resume' })
  } catch (error) {
    $.ui.toast(`/resume을 열지 못했습니다: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// 이름을 누르면 그 줄이 입력칸으로 바뀐다. 입력하려면 패널이 키보드를 잡아야 해서 focus로 다시 연다
async function startRename($: EngineInterface, row: SessionItem) {
  await update($, stopArmed, () => '')
  await update($, renameDraft, () => row.name)
  await update($, renaming, () => row.sessionId)
  await $.ui.open({ id: PANE, title: '세션', focus: true, closeOnEscape: true })
}

async function cancelRename($: EngineInterface) {
  await update($, renaming, () => '')
}

/**
 * 이 대화는 내장 /rename으로 바꾼다. 다른 세션은 mod가 직접 바꿀 수 없어, 그 세션의 Orca 탭 입력창에 /rename을 대신 친다.
 * 남의 입력창에 글자를 넣는 일이라 세 가지를 확인하고, 하나라도 걸리면 바꾸지 않는다:
 * 그 세션이 입력·승인을 기다리는 중이 아닐 것, Orca 탭이 있을 것, 그 탭 입력창이 비어 있을 것
 */
async function applyRename($: EngineInterface, row: SessionItem, raw: string) {
  const name = cleanName(raw)
  await update($, renaming, () => '')
  if (name === '' || name === row.name) return
  try {
    if (row.isSelf) {
      await $.command.run({ command: 'rename', args: name })
      $.ui.toast(`이 대화의 이름을 "${name}"(으)로 바꿨습니다`)
    } else {
      if (row.state === 'blocked') {
        $.ui.toast(`"${row.name}"은 입력이나 승인을 기다리는 중이라 이름을 바꾸지 않았습니다. 그 세션에서 답한 뒤 다시 하세요`, { timeoutMs: 10000 })
        return
      }
      // [이동]과 같은 방법으로 그 세션의 Orca 탭을 찾는다(세션이 남긴 탭 handle, 없으면 탭 제목)
      const where = await locatorOf($, row)
      const handle = await orcaHost(argv => $.process.run(argv, { timeoutMs: 15_000 })).locate(row, where?.host === 'orca' ? where.id : null)
      if (handle === null) {
        $.ui.toast(
          row.kind === 'background'
            ? `"${row.name}"은 열린 Orca 탭이 없어 이름을 바꾸지 못했습니다. [이동]으로 탭을 연 뒤 다시 하세요`
            : `"${row.name}"의 Orca 탭을 찾지 못해 이름을 바꾸지 못했습니다. 그 탭에서 /rename 으로 바꾸세요`,
          { timeoutMs: 10000 },
        )
        return
      }
      const screen = await $.process.run(['orca', 'terminal', 'read', '--terminal', handle, '--screen', '--json'], { timeoutMs: 15_000 })
      if (screen.exitCode !== 0 || composerHasText(screen.stdout)) {
        $.ui.toast(`"${row.name}" 입력창에 쓰던 글이 있거나 화면을 읽지 못해, 덮어쓰지 않으려고 이름을 바꾸지 않았습니다`, { timeoutMs: 10000 })
        return
      }
      const sent = await $.process.run(['orca', 'terminal', 'send', '--terminal', handle, '--text', `/rename ${name}`, '--enter', '--json'], { timeoutMs: 15_000 })
      $.ui.toast(sent.exitCode === 0 ? `"${row.name}"의 이름을 "${name}"(으)로 바꿨습니다` : `이름을 바꾸지 못했습니다: ${firstLine(sent.stderr || sent.stdout, 120)}`)
    }
  } catch (error) {
    $.ui.toast(`이름을 바꾸지 못했습니다: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  // 상대 세션이 /rename을 처리할 시간을 준 뒤 목록을 다시 읽는다
  await $.clock.sleep(RENAME_SETTLE_MS)
  await refreshPanel($)
}

// [끄기]는 두 번 눌러야 끈다. 처음 누르면 [정말 끄기]로 바뀌고, 몇 초 안에 다시 누르지 않으면 되돌아간다.
// isArmed는 그릴 때 본 값이다(누를 때 다시 읽으면 한 박자 늦게 바뀐다)
async function pressStop($: EngineInterface, row: SessionItem, isArmed: boolean) {
  if (!isArmed) {
    await update($, stopArmed, () => row.sessionId)
    $.clock.after(STOP_CONFIRM_MS, () => void update($, stopArmed, old => (old === row.sessionId ? '' : old)))
    return
  }
  await update($, stopArmed, () => '')
  const run = await $.process.run(['claude', 'stop', row.shortId || row.sessionId], { timeoutMs: 20_000 })
  $.ui.toast(
    run.exitCode === 0
      ? `"${row.name}"을 껐습니다. 기록은 남아 있어 [resume]으로 다시 열 수 있습니다`
      : `끄지 못했습니다: ${firstLine(run.stderr || run.stdout, 120)}`,
    { timeoutMs: 10000 },
  )
  await refreshPanel($)
}

// 상태를 기록하는 훅은 모두 엔진의 일을 먼저 끝내고, 기록이 실패해도 결과는 그대로 돌려준다
async function safely($: EngineInterface, what: string, work: () => Promise<void>) {
  try {
    await work()
  } catch (error) {
    log($, what, error)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'sessions-here',
      description: '같은 폴더에서 실행 중인 다른 세션을 확인합니다. /sessions-here off·on으로 Claude에게 보내는 안내를 끄고 켭니다',
      argumentHint: '[on|off]',
      immediate: true,
    })
    await safely($, '시작', async () => {
      await init($)
      await refresh($)
    })
    // 백그라운드 관리자가 띄운 세션에만 CLAUDE_JOB_DIR가 있다. /background는 새 프로세스로 옮겨 가므로 종류는 시작할 때 한 번 정해진다
    await safely($, '세션 종류 확인', async () => {
      const jobDir = await $.env.get('CLAUDE_JOB_DIR')
      await update($, selfKind, () => (jobDir !== undefined && jobDir !== '' ? 'background' : 'interactive'))
    })
    await safely($, 'Orca 확인', () => checkOrca($))
    $.clock.every(HEARTBEAT_MS, () => void safely($, '살아 있음 기록', () => save($)))
    $.clock.every(REFRESH_MS, () => void safely($, '다른 세션 읽기', () => refresh($)))
    $.clock.every(REFRESH_MS, () => void (panelOpen ? refreshPanel($) : undefined))
    // /sync는 설정 저장소(CCsetting)를 쓰는 PC에만 둔다. 없으면 clickbar의 [sync] 버튼도 생기지 않는다
    await safely($, '동기화 명령 등록', async () => {
      if ((await findSyncScript($)) === undefined) return
      await $.command.register({
        name: 'sync',
        description: '설정 저장소(CCsetting)와 메모리·mod·설정을 즉시 동기화합니다',
        immediate: true,
      })
    })
    await $.command.register({
      name: 'sessions',
      description: '세션 패널을 엽니다. 이 PC의 모든 대화를 폴더·날짜별로 조회하고 이동·고정·보관합니다',
      immediate: true,
    })

    return result
  })

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    // 2.1.299부터 서브에이전트·팀원의 턴에도 온다(e.agentId가 있다). 이 세션의 상태·요청은 메인 대화의 턴만 바꾼다
    if ((e as { agentId?: string }).agentId !== undefined) return result
    // 요청은 사람이 직접 보낸 질문만 쓴다. 알림·예약 작업·다른 세션의 메시지로 시작한 턴은 앞 요청을 그대로 둔다
    const text = userText
    userText = undefined
    await safely($, '작업 시작 기록', () => setStatus($, 'working', text === undefined || text.trim() === '' ? undefined : text))

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await safely($, '작업 끝 기록', () => setStatus($, 'idle'))

    return result
  })

  // 권한 판정이 "물어봄"이면 권한 창이 뜬다. bypass 모드에서는 도구 승인을 묻지 않지만, 질문(AskUserQuestion)·계획 승인(ExitPlanMode)은
  // 판정과 상관없이 사람의 답을 기다린다(판정이 허용이어도 창이 닫히지 않는다).
  // classic.Notification은 Team 플랜에서 user mod에 오지 않아(2026-10-11 확인) tool.check의 결과로 판단한다
  on('tool.check', async ($, e, next) => {
    const result = await next(e)
    const asks = result.decision === 'ask' || (NEEDS_PERSON.has(e.tool) && result.decision !== 'deny')
    if (e.agentId === undefined && asks) await safely($, '입력 필요 기록', () => setStatus($, 'waiting'))

    return result
  })

  // 승인을 받아 도구가 실제로 돌기 시작하면 다시 "작업 중"이다
  on('tool.call', async ($, e, next) => {
    if (self?.record.status === 'waiting') await safely($, '작업 재개 기록', () => setStatus($, 'working'))

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    const result = await next(e)
    await safely($, '종료 기록', () => setStatus($, 'ended'))

    return result
  })

  // 다른 세션이 같은 폴더에서 작업 중일 때만 Claude에게 한 줄을 붙인다. 질문 글은 바꾸지 않는다
  on('prompt.submit', async ($, e, next) => {
    // 입력창(composer)이나 Remote Control로 사람이 보낸 질문만 다음 턴의 요청으로 기억한다
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') userText = e.text
    let note: string | null = null
    try {
      if ((await $.store.get(NOTE_SWITCH_KEY)) !== 'off') note = overlapNote(await read($, peers), liveName)
    } catch (error) {
      log($, '안내 만들기', error)
    }

    return next(note === null ? e : { ...e, context: [...(e.context ?? []), note] })
  })

  on('command.run', { command: 'sync' }, async $ => {
    try {
      await runSync($)
    } catch (error) {
      $.ui.toast(`동기화를 실행하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`)
    }

    return {}
  })

  on('command.run', { command: 'sessions' }, async $ => {
    await openPanel($)

    return {}
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    panelOpen = false
    await update($, opening, () => '')
    // 패널을 닫으면 고치던 이름, 한 번 누른 [끄기], 열어 둔 [관리], 보관함 보기는 없던 일로 한다
    await update($, renaming, () => '')
    await update($, stopArmed, () => '')
    await update($, managing, () => '')
    await update($, showArchived, () => false)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // clickbar의 [sessions]처럼 다른 mod가 이 패널을 직접 열면 /sessions를 거치지 않아 목록을 읽지 않았다.
    // 처음 그릴 때 읽기 시작한다. 그래야 답변 중에도 패널이 바로 뜬다($.command.run은 답변이 끝날 때까지 기다린다)
    if (!panelOpen) {
      panelOpen = true
      void refreshPanel($)
    }
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    // 입력칸이 없는 화면에서는 이름 고치기를 /rename 안내로 대신한다
    const Input = 'Input' in elements ? elements.Input : undefined
    const items = await read($, sessions)
    const live = await read($, agents)
    const running = await read($, subagents)
    const at = await read($, readAt)
    const editing = await read($, renaming)
    const launchingIds = await read($, launching)
    const draft = await read($, renameDraft)
    const armed = await read($, stopArmed)
    const managed = await read($, managing)
    const opened = await read($, expanded)
    const legendOn = await read($, showLegend)
    const v = await read($, view)
    const pinned = await read($, pins)
    const hidden = await read($, archived)
    const inArchive = await read($, showArchived)
    // Orca가 없으면(일반 터미널) 다른 탭으로 옮기거나 다른 대화의 입력창에 대신 칠 수 없어, 줄 첫 칸과 이름 고치기를 바꿔 그린다
    // 다른 대화의 이름을 그 탭 입력창에 쳐서 고치는 기능은 Orca에서만, [이동]·[열기]는 탭을 다루는 프로그램(Orca·herdr)이 있으면 쓴다
    const hasOrca = await read($, orcaReady)
    const hostName = await read($, host)
    const hasHost = hostName !== ''
    const openingId = await read($, opening)
    // 꺼진 대화를 이 터미널에서 열 수 있는지(같은 폴더인지) 볼 때 쓰는 이 세션의 폴더
    const here = self === undefined ? '' : pathKey(self.record.root)
    const now = await $.clock.now()
    // 개수는 보관하지 않은 대화만 센다. 상태 필터 버튼의 개수가 그 필터로 보이는 줄 수와 맞도록
    const visible = items.filter(it => !hidden.includes(it.sessionId))
    const counts = stateCounts(live.filter(r => !hidden.includes(r.sessionId)))
    const offCount = visible.filter(it => it.kind === 'off').length
    const archivedCount = items.length - visible.length
    const layout = arrange(items, { view: v, pins: pinned, archived: hidden, showArchived: inArchive, now })
    const filter = v.filter[v.mode]

    // 회색 글자는 정보, 색 있는 [괄호]는 버튼이다(clickbar band와 같은 규칙). 고른 보기는 칠한 버튼으로 보인다
    const button = (key: string, word: string, onPress: () => void, color: string = 'suggestion', bold = false) => (
      <Button key={key} plain label={`[${word}]`} onPress={onPress}>
        <Text color={color} bold={bold}>
          {`[${word}]`}
        </Text>
      </Button>
    )
    // 고른 보기·필터는 [ ] 대신 같은 폭의 칠한 칸으로 그린다. 폭이 같아 골라도 옆 버튼이 밀리지 않는다(명령 팔레트 탭과 같은 모양)
    const choice = (key: string, word: string, isOn: boolean, onPress: () => void) =>
      isOn ? (
        <Button key={key} plain label={word} onPress={onPress}>
          <Text backgroundColor="suggestion" color="inverseText" bold>{` ${word} `}</Text>
        </Button>
      ) : (
        button(key, word, onPress)
      )
    const closeManage = () => update($, managing, () => '')

    // 자주 쓰지 않는 고정·보관·끄기·이름 고치기는 [관리]를 눌렀을 때만 그 줄 아래에 연다. 줄마다 버튼을 늘어놓지 않아 열이 맞는다
    const manageLine = (it: SessionItem) => {
      const isPinned = pinned.includes(it.sessionId)
      const isArmed = armed === it.sessionId

      return (
        <Box key={`manage-${it.sessionId}`} paddingLeft={COL_ACTION + 1} columnGap={1} flexWrap="wrap">
          {button(
            `agent-pin-${it.sessionId}`,
            isPinned ? '고정 해제' : '고정',
            () => void togglePin($, it.sessionId).then(closeManage),
            isPinned ? 'warning' : 'suggestion',
          )}
          {it.kind !== 'off' && (hasOrca || it.isSelf) && button(`agent-rename-menu-${it.sessionId}`, '이름 고치기', () => void closeManage().then(() => startRename($, it)))}
          {!it.isSelf && button(`agent-archive-${it.sessionId}`, '보관', () => void archiveItem($, it).then(closeManage))}
          {/* 다 쓴 백그라운드 세션을 끈다. 이 대화는 /stop, 포그라운드 세션은 그 탭을 닫아 끈다 */}
          {it.kind === 'background' &&
            !it.isSelf &&
            button(`agent-stop-${it.sessionId}`, isArmed ? '정말 끄기' : '끄기', () => void pressStop($, it, isArmed), isArmed ? 'error' : 'suggestion', isArmed)}
          {it.isSelf && <Text dimColor>이 대화는 보관·끄기 대신 /stop</Text>}
        </Box>
      )
    }

    // Orca가 없을 때 [열기]·[이동]을 누르면 그 줄 아래에 여는 방법을 편다. 켜진 백그라운드 세션과 같은 폴더의 꺼진 대화는
    // 이 터미널에서 열 수 있고(/resume), 다른 폴더의 꺼진 대화는 그 폴더로 가는 명령을 복사한다(Claude Code의 /resume 목록도 그렇게 한다)
    const toggleOpening = (it: SessionItem) => update($, opening, old => (old === it.sessionId ? '' : it.sessionId))
    const openLine = (it: SessionItem) => {
      const canHere = it.kind === 'background' || (here !== '' && pathKey(it.cwd) === here)

      return (
        <Box key={`opening-${it.sessionId}`} paddingLeft={COL_ACTION + 1} columnGap={1} flexWrap="wrap">
          {canHere && button(`agent-here-${it.sessionId}`, '여기서 열기', () => void openHere($, it))}
          {button(`agent-copy-${it.sessionId}`, '명령 복사', () => void copyCommand($, it, e.surface))}
          <Text dimColor>
            {it.kind === 'background'
              ? '여기서 열면 지금 대화는 백그라운드로 옮겨지고 이 터미널이 그 세션에 붙습니다(←로 돌아옴) · 복사하면 새 탭에서 붙습니다'
              : canHere
                ? '여기서 열면 이 터미널이 그 대화로 바뀝니다(지금 대화는 기록이 남음) · 복사하면 새 탭에서 엽니다'
                : '다른 폴더의 대화라 새 탭에서 엽니다. 명령을 복사해 붙여 넣으세요'}
          </Text>
        </Box>
      )
    }

    const row = (it: SessionItem) => {
      const isOff = it.kind === 'off'
      const s = stateWord(it.state, it.kind)
      const kindView = selfKindView(it.kind)
      const isManaged = managed === it.sessionId

      return (
        <Box key={`agent-${it.sessionId}`} flexDirection="column">
          <Box gap={1}>
            <Box width={COL_ACTION} flexShrink={0}>
              {it.isSelf ? (
                <Text color="suggestion" bold>
                  이 대화
                </Text>
              ) : launchingIds.includes(it.sessionId) ? (
                // 새 탭에서 Claude가 뜨기를 기다리는 동안은 누를 수 없게 글로만 보인다
                <Text dimColor>여는 중…</Text>
              ) : isOff ? (
                button(`agent-open-${it.sessionId}`, '열기', () => void (hasHost ? openOff($, it) : toggleOpening(it)))
              ) : hasHost ? (
                button(`agent-go-${it.sessionId}`, '이동', () => void switchTo($, it))
              ) : it.kind === 'background' ? (
                button(`agent-go-${it.sessionId}`, '이동', () => void toggleOpening(it))
              ) : (
                // 다른 창에서 켜진 대화형 세션: 여기서 열면 두 터미널의 메시지가 한 기록에 섞이므로 버튼을 두지 않는다
                <Text dimColor>다른 창</Text>
              )}
            </Box>
            <Box width={COL_STATE} flexShrink={0}>
              {isOff ? <Text dimColor>{sinceText(now - it.at)}</Text> : <Text {...toneProps(s.tone)}>{s.word}</Text>}
            </Box>
            <Box width={COL_KIND} flexShrink={0}>
              {/* 켜진 대화의 종류는 입력창 위 배지와 같은 색(백그라운드 파랑, 포그라운드 노랑)으로, 유휴는 흐리게 */}
              {kindView === null ? <Text dimColor>{kindWord(it.kind) || '-'}</Text> : <Text color={kindView.color}>{kindWord(it.kind)}</Text>}
            </Box>
            {/* 켜진 대화의 이름은 밑줄로 눌러서 고칠 수 있음을 보인다. 꺼진 대화는 이름을 바꿀 수 없다 */}
            {editing === it.sessionId && Input !== undefined ? (
              <Box flexGrow={1} flexShrink={1} columnGap={1}>
                <Input
                  key="rename-input"
                  placeholder="새 이름"
                  value={draft}
                  autoFocus
                  onInput={(text: string) => void update($, renameDraft, () => text)}
                  onSubmit={(text: string) => void applyRename($, it, text)}
                />
                {button('rename-save', '저장', () => void applyRename($, it, draft))}
                {button('rename-cancel', '취소', () => void cancelRename($))}
              </Box>
            ) : (
              <Box flexGrow={1} flexShrink={1} columnGap={1}>
                {/* 이름 칸이 남는 폭을 모두 차지해 폴더 이름이 늘 [관리] 바로 앞에 맞춰 선다 */}
                <Box flexGrow={1} flexShrink={1}>
                  {/* Orca가 없으면 다른 대화의 입력창에 /rename을 대신 칠 수 없어 이름을 누를 수 없게 둔다 */}
                  {isOff || (!hasOrca && !it.isSelf) ? (
                    <Text>{it.name}</Text>
                  ) : (
                    <Button key={`agent-rename-${it.sessionId}`} plain label={`${it.name} (이름 고치기)`} onPress={() => void startRename($, it)}>
                      <Text bold={it.isSelf} underline>
                        {it.name}
                      </Text>
                    </Button>
                  )}
                </Box>
                {/* 날짜별 보기에서는 여러 폴더가 섞이므로 폴더 끝 이름을 함께 적는다. 줄지 않게 해서 이름이 대신 줄바꿈된다 */}
                {v.mode === 'date' && !inArchive && (
                  <Box flexShrink={0}>
                    <Text dimColor>{folderLabel(it.cwd)}</Text>
                  </Box>
                )}
              </Box>
            )}
            <Box flexShrink={0}>
              {inArchive
                ? button(`agent-restore-${it.sessionId}`, '복구', () => void restoreItem($, it))
                : button(`agent-manage-${it.sessionId}`, isManaged ? '접기' : '관리', () => void update($, managing, old => (old === it.sessionId ? '' : it.sessionId)), isManaged ? 'warning' : 'suggestion')}
            </Box>
          </Box>
          {isManaged && !inArchive && manageLine(it)}
          {openingId === it.sessionId && !hasHost && !inArchive && openLine(it)}
        </Box>
      )
    }

    const groupHead = (key: string, title: string, list: readonly SessionItem[]) => {
      const liveCount = list.filter(it => it.kind !== 'off').length

      return (
        <Box key={`head-${key}`} gap={1}>
          <Text bold>{title}</Text>
          <Text dimColor>{`${list.length}개 (켜짐 ${liveCount} · 유휴 ${list.length - liveCount})`}</Text>
        </Box>
      )
    }
    // 묶음마다 꺼진 대화는 최근 몇 개만 보이고 나머지는 [더 보기]로 편다. [유휴] 필터와 보관함에서는 모두 보인다
    const groupBody = (key: string, title: string, list: readonly SessionItem[]) => {
      const showAll = filter === 'off' || inArchive || opened.includes(key)
      const shown: SessionItem[] = []
      let offShown = 0
      for (const it of list) {
        if (it.kind !== 'off' || showAll || offShown < OFF_PREVIEW) shown.push(it)
        if (it.kind === 'off') offShown += 1
      }
      const rest = list.length - shown.length
      const canFold = !inArchive && filter !== 'off' && opened.includes(key) && offShown > OFF_PREVIEW

      return (
        <Box key={`group-${key}`} flexDirection="column" marginTop={1}>
          {groupHead(key, title, list)}
          {shown.map(row)}
          {(rest > 0 || canFold) && (
            <Box paddingLeft={COL_ACTION + 1}>
              {rest > 0
                ? button(`more-${key}`, `유휴 ${rest}개 더 보기`, () => void update($, expanded, old => [...old, key]))
                : button(`less-${key}`, '유휴 접기', () => void update($, expanded, old => old.filter(k => k !== key)))}
            </Box>
          )}
        </Box>
      )
    }
    const isEmpty = layout.pinned.length === 0 && layout.groups.length === 0

    return (
      <Box flexDirection="column">
        {/* 머리 줄은 명령 팔레트와 같은 모양이다: 왼쪽에 보기 탭(고른 탭은 칠한 버튼), 오른쪽 끝에 [다시 읽기]·[닫기]와 닫는 키.
            탭 쪽만 줄고 꺾이게 해서, 좁은 화면에서도 버튼은 첫 줄 오른쪽에 남는다. 보기 설정은 이 PC에 저장된다 */}
        <Box key="head" columnGap={1}>
          <Box flexGrow={1} flexShrink={1} columnGap={1} flexWrap="wrap">
            {choice('view-folder', '폴더별', v.mode === 'folder' && !inArchive, () => void update($, showArchived, () => false).then(() => setMode($, 'folder')))}
            {choice('view-date', '날짜별', v.mode === 'date' && !inArchive, () => void update($, showArchived, () => false).then(() => setMode($, 'date')))}
            {choice('archive-toggle', `보관함 ${archivedCount}`, inArchive, () => void update($, showArchived, () => true))}
          </Box>
          <Box flexShrink={0} columnGap={1}>
            {button('panel-refresh', '다시 읽기', () => void refreshPanel($))}
            <Button key="panel-close" plain role="dismiss" label="[닫기]" onPress={() => void $.ui.close({ id: PANE })}>
              <Text color="suggestion">[닫기]</Text>
            </Button>
            <Text dimColor>Esc</Text>
          </Box>
        </Box>
        {/* 둘째 줄: 상태 필터 버튼에 개수를 붙이고, 켜진 대화의 상태별 개수를 이어 쓴다. 필터는 폴더별·날짜별마다 따로 기억한다.
            보관함에는 필터가 없어 개수만 보인다 */}
        {inArchive ? (
          <Text key="toolbar" dimColor>{`보관한 대화 ${archivedCount}개 · [폴더별]이나 [날짜별]을 누르면 목록으로 돌아갑니다`}</Text>
        ) : (
          <Box key="toolbar" columnGap={1} flexWrap="wrap">
            <Text dimColor>상태</Text>
            {choice('filter-all', `전체 ${visible.length}`, filter === 'all', () => void setFilter($, v.mode, 'all'))}
            {choice('filter-on', `켜짐 ${visible.length - offCount}`, filter === 'on', () => void setFilter($, v.mode, 'on'))}
            {choice('filter-off', `유휴 ${offCount}`, filter === 'off', () => void setFilter($, v.mode, 'off'))}
            {/* 상태별 개수는 한 묶음으로, 필터 버튼과 두 칸 띄운다. 꺾여도 줄 앞에 기호가 남지 않게 구분 기호는 개수 사이에만 둔다 */}
            {counts.length > 0 && (
              <Box key="state-counts" flexShrink={0} columnGap={1} marginLeft={1}>
                {counts.map((c, i) => (
                  <Box key={`count-${c.word}`} columnGap={1}>
                    {i > 0 && <Text dimColor>·</Text>}
                    <Text {...toneProps(c.tone)}>{`${c.word} ${c.n}`}</Text>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        )}
        {at === 0 && <Text dimColor>세션 목록을 불러오는 중입니다…</Text>}
        {at > 0 && isEmpty && <Text dimColor>{inArchive ? '보관한 대화가 없습니다' : '표시할 대화가 없습니다. 상태 필터를 [전체]로 바꿔 보세요'}</Text>}
        {/* 고정한 대화는 보기·상태 필터와 상관없이 맨 위에 한 번만 나온다 */}
        {layout.pinned.length > 0 && (
          <Box key="pinned" flexDirection="column" marginTop={1}>
            {groupHead('pinned', '고정', layout.pinned)}
            {layout.pinned.map(row)}
          </Box>
        )}
        {layout.groups.map(g => groupBody(g.key, g.title, g.items))}
        {inArchive && (
          <Box key="archive-note" marginTop={1}>
            <Text dimColor>보관은 목록에서 숨기기만 합니다. 다만 30일(cleanupPeriodDays)이 지나면 Claude Code가 기록을 지워 복구할 수 없습니다</Text>
          </Box>
        )}
        {running > 0 && (
          <Box key="subagents" gap={1} marginTop={1}>
            <Text dimColor>이 대화의 서브에이전트 {running}개 실행 중</Text>
            <Button key="panel-flow" plain label="[자세히]" onPress={() => void $.command.run({ command: 'flow' }).catch(() => $.ui.toast('/flow가 없습니다. agent-flow mod가 설치돼 있어야 합니다'))}>
              <Text color="suggestion">[자세히]</Text>
            </Button>
          </Box>
        )}
        {/* 범례는 [설명]을 눌렀을 때만 편다. 늘 펼쳐 두면 목록이 그만큼 아래로 밀린다 */}
        <Box key="footer" columnGap={1} flexWrap="wrap" marginTop={1}>
          {button('legend-toggle', legendOn ? '설명 접기' : '설명', () => void update($, showLegend, old => !old))}
          <Text dimColor>Claude Code 기본 목록</Text>
          <Button key="panel-resume" plain label="[resume]" onPress={() => void openResume($)}>
            <Text color="suggestion">[resume]</Text>
          </Button>
        </Box>
        {legendOn && (
          <Box key="legend" flexDirection="column">
            <Text dimColor>백그라운드: 탭을 닫아도 켜져 있음 · 포그라운드: 탭을 닫으면 꺼짐 · 유휴: 꺼져 있고 기록만 남음([열기]로 다시 켬)</Text>
            <Text dimColor>밑줄 친 이름을 누르면 바로 고칩니다(켜진 대화만) · [관리]: 고정·보관·끄기([끄기]는 두 번 눌러야 끔)</Text>
            <Text dimColor>목록은 15초마다 새로 읽습니다 · 고정·보관·보기 설정은 이 PC에만 저장 · [resume] 목록에서 Ctrl+A는 모든 폴더 · 패널은 Esc나 Ctrl+X X로도 닫힘</Text>
            {!hasHost && (
              <Text dimColor>
                탭을 다루는 프로그램(Orca·herdr) 밖이라 다른 탭으로 옮기지 못합니다: [열기]·[이동]은 이 터미널에서 열거나(/resume) 새 탭용 명령을 복사합니다 · 다른 창의 대화는 그 창에서 쓰고 이름도 그 창에서 /rename
              </Text>
            )}
            {hostName === 'herdr' && <Text dimColor>herdr 안에서는 다른 대화의 이름을 그 탭에서 /rename으로 바꿉니다</Text>}
          </Box>
        )}
      </Box>
    )
  })

  on('command.run', { command: 'sessions-here' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'on') {
      await $.store.set(NOTE_SWITCH_KEY, arg)
      $.ui.toast(arg === 'off' ? 'Claude에게 다른 세션을 알리는 안내를 껐습니다. 화면 표시는 그대로입니다' : 'Claude에게 다른 세션을 알리는 안내를 켰습니다')

      return {}
    }
    await refresh($)
    // 쉬는 세션까지 모두 이름으로 보인다(band에는 겹칠 수 있는 세션만 나온다)
    await safely($, '세션 이름 읽기', () => loadAgents($))
    const list = await read($, peers)
    const now = await $.clock.now()
    $.ui.toast(
      list.length === 0
        ? '같은 폴더에서 열린 다른 세션이 없습니다(이 mod가 켜진 세션만 보입니다)'
        : list
            .map(p => `${liveName(p.id) ?? `세션 ${p.id.slice(0, 8)}`} · ${STATUS_WORDS[p.status as Exclude<SessionStatus, 'ended'>]} ${spanText(now - p.changedAt)} · ${firstLine(p.prompt, 80) || '(아직 요청 없음)'}`)
            .join('\n'),
      { timeoutMs: 12000 },
    )

    return {}
  })

  // clickbar 등 다른 mod가 그린 줄은 그대로 두고, 그 위에 이 대화의 종류와 같은 폴더의 다른 세션을 한 줄로 더한다
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    // 다른 세션 칸에는 이 세션과 겹칠 수 있는 세션(작업 중·입력 필요)만 이름으로 보인다. Claude에게 붙이는 안내와 같은 기준이다.
    // 쉬는 세션은 겹치지 않고 할 일도 없어 보이지 않는다(전체 목록은 /sessions, /sessions-here)
    const active = activePeers(await read($, peers))
    const kind = selfKindView(await read($, selfKind))
    if (active.length === 0 && kind === null) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const rows = await read($, agents)
    const now = await $.clock.now()
    const others = await next(e)
    // 위의 clickbar 줄과 섞여 보이지 않게 "── 세션 ───" 가로줄을 band 폭에 맞춰 긋는다. 너무 좁으면 머리 글 없이 줄만
    const width = e.props.bodyColumns
    const rule = e.surface !== 'terminal' || width <= 0 ? null : width >= RULE_LABEL_WIDTH ? RULE_LABEL + '─'.repeat(width - RULE_LABEL_WIDTH) : '─'.repeat(width)

    return (
      <Box flexDirection="column">
        {rule !== null && (
          <Text dimColor wrap="truncate-end">
            {rule}
          </Text>
        )}
        {/* 한 줄에 이 대화의 종류, 같은 폴더에서 겹칠 수 있는 다른 세션을 차례로 둔다. │·같은 구분 기호 대신 빈칸으로 띄워
            좁아서 꺾일 때 줄 맨 앞에 기호가 남지 않게 하고, 꺾여도 빈 줄이 끼지 않도록 가로 간격만 둔다.
            안쪽에 또 꺾이는 상자를 두면 그 상자가 한 줄을 다 차지하므로 항목을 한 단계로 늘어놓는다.
            항목 사이는 clickbar 상태 줄처럼 세 칸이다. 배지·이름 버튼·"작업 중 3분째"는 줄지 않게 해서 쪼개지지 않고, 요청 미리보기만 남는 폭 안에서 줄어든다 */}
        <Box key="peers" columnGap={3} rowGap={0} flexWrap="wrap">
          {kind !== null && (
            <Box key="self-kind" columnGap={1} flexShrink={1}>
              <Box flexShrink={0}>
                <Text backgroundColor={kind.color} color="inverseText" bold>
                  {` ${kind.badge} `}
                </Text>
              </Box>
              <Text dimColor>{kind.hint}</Text>
            </Box>
          )}
          {active.length > 0 && (
            <Box key="peer-label" flexShrink={0}>
              <Text dimColor>같은 폴더:</Text>
            </Box>
          )}
          {active.slice(0, PEERS_SHOWN).map(p => {
            // 이름을 누르면 그 세션으로 옮긴다(Orca·herdr가 없으면 세션 패널). 이름을 아직 모르면 세션 id 앞자리로 보인다
            const name = clipName(rows.find(r => r.sessionId === p.id)?.name ?? `세션 ${p.id.slice(0, 8)}`, PEER_NAME_MAX)
            const status = p.status as Exclude<SessionStatus, 'ended'>
            const request = firstLine(p.prompt, 24)

            return (
              <Box key={`peer-${p.id}`} columnGap={1} flexShrink={1}>
                <Box flexShrink={0}>
                  <Button key={`peer-go-${p.id}`} plain label={`[${name}]`} onPress={() => void safely($, '다른 세션으로 이동', () => goToPeer($, p.id))}>
                    <Text color="suggestion">{`[${name}]`}</Text>
                  </Button>
                </Box>
                <Box flexShrink={0}>
                  <Text {...toneProps(PEER_TONE[status])}>{`${STATUS_WORDS[status]} ${spanText(now - p.changedAt)}`}</Text>
                </Box>
                {request !== '' && (
                  <Box flexShrink={1}>
                    <Text dimColor wrap="truncate-end">{`"${request}"`}</Text>
                  </Box>
                )}
              </Box>
            )
          })}
          {active.length > PEERS_SHOWN && (
            <Box key="peer-more" flexShrink={0}>
              <Text dimColor>{`외 ${active.length - PEERS_SHOWN}개`}</Text>
            </Box>
          )}
        </Box>
        {others}
      </Box>
    )
  })
}
