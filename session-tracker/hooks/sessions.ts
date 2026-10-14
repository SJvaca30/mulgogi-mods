// 세션 패널의 "모든 대화" 목록: 켜진 대화(claude agents)와 꺼진 대화(기록 파일만 남은 것)를 합쳐 묶는다.
// 꺼진 대화의 제목은 /resume처럼 기록 파일 끝부분에서 읽는다(TITLE_SCRIPT). mod는 파일 일부만 읽을 수 없어서다.

import type { AgentRow, OnOffFilter, SessionItem, SessionView, TitleEntry } from '../types'

export const DEFAULT_VIEW: SessionView = { mode: 'folder', filter: { folder: 'all', date: 'all' } }

const FILTERS: readonly OnOffFilter[] = ['all', 'on', 'off']

/** $.store의 view를 검사해 꺼낸다. 모르는 값은 기본값으로 */
export function parseView(raw: unknown): SessionView {
  const v = (raw ?? {}) as { mode?: unknown; filter?: Record<string, unknown> }
  const pick = (x: unknown): OnOffFilter => (FILTERS.includes(x as OnOffFilter) ? (x as OnOffFilter) : 'all')

  return {
    mode: v.mode === 'date' ? 'date' : 'folder',
    filter: { folder: pick(v.filter?.folder), date: pick(v.filter?.date) },
  }
}

/** $.store의 문자열 목록(pins, archived)을 검사해 꺼낸다 */
export function parseIdList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
}

export type HistoryInfo = { cwd: string; firstPrompt: string; lastAt: number }

const TITLE_MAX = 40

function shorten(text: string): string {
  const line = text.split('\n').find(l => l.trim() !== '')?.trim() ?? ''

  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX)}…` : line
}

/**
 * ~/.claude/history.jsonl(보낸 질문마다 한 줄: display, project, sessionId, timestamp)을 대화별로 모은다.
 * 첫 질문은 /rename 같은 슬래시 명령을 건너뛴 첫 진짜 질문이다(제목이 없을 때 쓴다)
 */
export function parseHistory(text: string): Map<string, HistoryInfo> {
  const map = new Map<string, HistoryInfo>()
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let o: { display?: unknown; project?: unknown; sessionId?: unknown; timestamp?: unknown }
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof o.sessionId !== 'string' || typeof o.project !== 'string') continue
    const at = Number(o.timestamp)
    const display = typeof o.display === 'string' ? o.display.trim() : ''
    const old = map.get(o.sessionId)
    const firstPrompt = old?.firstPrompt || (display !== '' && !display.startsWith('/') ? shorten(display) : '')
    map.set(o.sessionId, { cwd: o.project, firstPrompt, lastAt: Math.max(old?.lastAt ?? 0, Number.isFinite(at) ? at : 0) })
  }

  return map
}

/** Claude Desktop의 임시 작업 폴더(scratch)와 Temp 아래 폴더는 목록에서 뺀다 */
export function isScratchProject(dirName: string): boolean {
  return /AppData-Local-Temp|scratch-workspaces/i.test(dirName)
}

/** slug는 기록 폴더 이름(~/.claude/projects/<slug>). Claude Code가 작업 폴더 경로의 영숫자 아닌 글자를 -로 바꿔 만든다 */
export type TranscriptFile = { sessionId: string; slug: string; path: string; mtimeMs: number; size: number }

/** 작업 폴더 경로 → 기록 폴더 이름. D:\all → D--all */
export function projectSlug(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-')
}

/** 제목 도우미 출력: [{ p: 경로, c: customTitle, a: aiTitle, w: cwd }] */
export function parseTitleScan(stdout: string): Map<string, { t: string; k: 'custom' | 'ai' | ''; c: string }> {
  const map = new Map<string, { t: string; k: 'custom' | 'ai' | ''; c: string }>()
  let list: unknown
  try {
    list = JSON.parse(stdout.trim() || '[]')
  } catch {
    return map
  }
  for (const r of (Array.isArray(list) ? list : [list]) as { p?: unknown; c?: unknown; a?: unknown; w?: unknown }[]) {
    if (typeof r?.p !== 'string') continue
    const custom = typeof r.c === 'string' ? r.c.trim() : ''
    const ai = typeof r.a === 'string' ? r.a.trim() : ''
    map.set(r.p, { t: custom || ai, k: custom !== '' ? 'custom' : ai !== '' ? 'ai' : '', c: typeof r.w === 'string' ? r.w : '' })
  }

  return map
}

/**
 * 켜진 대화와 꺼진 대화를 한 목록으로 만든다. 꺼진 대화는 기록 파일이 남아 있는 것만 넣는다
 * (30일 보관 기간이 지나 지워진 대화는 열 수 없으므로). 이름은 이름 바꾸기(custom) → 멈춘 백그라운드 세션의 이름 →
 * 켜져 있을 때 본 이름 → 자동 제목(ai) → 첫 질문 순으로 고르고, 이름도 질문도 없는 빈 세션은 뺀다.
 * 작업 폴더는 기록 파일 → 멈춘 세션 → 질문 기록 → 같은 기록 폴더의 다른 대화 순으로 찾는다(아주 짧은 기록에는 폴더가 없다)
 */
export function buildItems(input: {
  rows: readonly AgentRow[]
  files: readonly TranscriptFile[]
  titles: Readonly<Record<string, TitleEntry>>
  names: Readonly<Record<string, string>>
  history: ReadonlyMap<string, HistoryInfo>
  now: number
}): SessionItem[] {
  const fileById = new Map(input.files.map(f => [f.sessionId, f]))
  // 기록 폴더 이름 → 작업 폴더: 폴더를 알아낸 대화들에서 모은다
  const slugCwd = new Map<string, string>()
  const learn = (cwd: string | undefined) => {
    if (cwd !== undefined && cwd !== '' && !slugCwd.has(projectSlug(cwd))) slugCwd.set(projectSlug(cwd), cwd)
  }
  for (const r of input.rows) learn(r.cwd)
  for (const t of Object.values(input.titles)) learn(t.c)
  for (const h of input.history.values()) learn(h.cwd)
  const live = input.rows.filter(r => r.isLive)
  const liveIds = new Set(live.map(r => r.sessionId))
  const stopped = new Map(input.rows.filter(r => !r.isLive).map(r => [r.sessionId, r]))
  const items: SessionItem[] = live.map(r => ({
    sessionId: r.sessionId,
    shortId: r.shortId,
    name: r.name,
    cwd: r.cwd,
    state: r.state,
    kind: r.kind === 'interactive' ? 'interactive' : 'background',
    isSelf: r.isSelf,
    at: fileById.get(r.sessionId)?.mtimeMs ?? input.now,
    reopen: '',
  }))
  for (const f of input.files) {
    if (liveIds.has(f.sessionId)) continue
    const row = stopped.get(f.sessionId)
    const title = input.titles[f.sessionId]
    const hist = input.history.get(f.sessionId)
    const name =
      (title?.k === 'custom' ? title.t : '') || row?.name || input.names[f.sessionId] || (title?.k === 'ai' ? title.t : '') || hist?.firstPrompt || ''
    const cwd = title?.c || row?.cwd || hist?.cwd || slugCwd.get(f.slug) || ''
    if (name === '' || cwd === '') continue
    items.push({ sessionId: f.sessionId, shortId: row?.shortId ?? '', name, cwd, state: '', kind: 'off', isSelf: false, at: f.mtimeMs, reopen: row !== undefined ? 'attach' : 'resume' })
  }

  return items
}

const LIVE_RANK: Record<string, number> = { blocked: 0, working: 1, busy: 1 }
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

export const pathKey = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()

function dayKey(at: number): string {
  const d = new Date(at)

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 날짜 묶음 제목: 오늘, 어제, 그 전은 10/12(일) */
export function dayTitle(at: number, now: number): string {
  const d = new Date(at)
  const today = new Date(now)
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000)
  if (days === 0) return '오늘'
  if (days === -1) return '어제'

  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`
}

/** 꺼진 대화의 마지막 활동: 방금, 5분 전, 3시간 전, 2일 전 */
export function sinceText(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  if (minutes < 1) return '방금'
  if (minutes < 60) return `${minutes}분 전`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전`

  return `${Math.floor(minutes / 1440)}일 전`
}

export type Group = { key: string; title: string; items: SessionItem[] }

/**
 * 화면에 그릴 순서로 나눈다. 대화 하나는 한 곳에만 나온다:
 * 보관한 대화는 보관함에만, 고정한 대화는 맨 위 "고정"에만(묶음·켜짐 필터와 상관없이), 나머지는 묶음 안에.
 * 폴더별: 이 대화가 있는 폴더가 먼저, 폴더 안에서는 켜진 대화(입력 필요 → 작업 중 → 나머지)가 먼저, 꺼진 대화는 최근 것부터.
 * 날짜별: 최근 날짜부터, 같은 날 안에서는 최근 활동부터
 */
export function arrange(
  items: readonly SessionItem[],
  opts: { view: SessionView; pins: readonly string[]; archived: readonly string[]; showArchived: boolean; now: number },
): { pinned: SessionItem[]; groups: Group[] } {
  const archived = new Set(opts.archived)
  const byRecent = (a: SessionItem, b: SessionItem) => b.at - a.at
  if (opts.showArchived) {
    const list = items.filter(it => archived.has(it.sessionId)).sort(byRecent)

    return { pinned: [], groups: list.length === 0 ? [] : [{ key: 'archived', title: '보관함', items: list }] }
  }
  const visible = items.filter(it => !archived.has(it.sessionId))
  const pinOrder = new Map(opts.pins.map((id, i) => [id, i]))
  const pinned = visible.filter(it => pinOrder.has(it.sessionId)).sort((a, b) => (pinOrder.get(a.sessionId) ?? 0) - (pinOrder.get(b.sessionId) ?? 0))
  const filter = opts.view.filter[opts.view.mode]
  const rest = visible.filter(it => !pinOrder.has(it.sessionId) && (filter === 'all' || (filter === 'on') === (it.kind !== 'off')))
  const groups = new Map<string, Group>()
  for (const it of rest) {
    const key = opts.view.mode === 'folder' ? pathKey(it.cwd) : dayKey(it.at)
    const title = opts.view.mode === 'folder' ? it.cwd : dayTitle(it.at, opts.now)
    const g = groups.get(key) ?? { key, title, items: [] }
    g.items.push(it)
    groups.set(key, g)
  }
  const list = [...groups.values()]
  if (opts.view.mode === 'date') {
    for (const g of list) g.items.sort(byRecent)
    list.sort((a, b) => b.key.localeCompare(a.key))
  } else {
    const rank = (it: SessionItem) => (it.kind === 'off' ? 3 : (LIVE_RANK[it.state] ?? 2))
    for (const g of list) g.items.sort((a, b) => rank(a) - rank(b) || byRecent(a, b))
    const latest = (g: Group) => Math.max(...g.items.map(it => it.at))
    list.sort((a, b) => Number(b.items.some(it => it.isSelf)) - Number(a.items.some(it => it.isSelf)) || latest(b) - latest(a))
  }

  return { pinned, groups: list }
}

/**
 * Orca 없이 새 터미널 탭에 붙여 넣을 명령. 백그라운드 세션(켜져 있거나 멈춘 것)은 id로 붙고,
 * 기록만 남은 대화는 그 폴더로 가서 다시 연다(cd 없이 열면 지금 폴더의 대화로 열린다)
 */
export function reopenCommand(item: Pick<SessionItem, 'cwd' | 'sessionId' | 'shortId' | 'reopen' | 'kind'>): string {
  if (item.kind === 'background' || item.reopen === 'attach') return `claude attach ${item.shortId || item.sessionId}`

  return `cd "${item.cwd}" && claude --resume ${item.sessionId}`
}

/** orca worktree list --json 결과에 이 폴더가 있는지. 없는 폴더에는 Orca 탭을 열 수 없다 */
export function orcaHasPath(stdout: string, cwd: string): boolean {
  try {
    const parsed = JSON.parse(stdout) as { result?: { worktrees?: { path?: unknown }[] } }
    const list = Array.isArray(parsed?.result?.worktrees) ? parsed.result.worktrees : []

    return list.some(w => typeof w.path === 'string' && pathKey(w.path) === pathKey(cwd))
  } catch {
    return false
  }
}

/**
 * 기록 파일 끝 256KB(없으면 앞 64KB)에서 마지막 customTitle·aiTitle·cwd를 찾는 PowerShell 도우미.
 * 표준 입력으로 받은 경로마다 { p, c, a, w }를 JSON 배열로 낸다. 한글이 깨지지 않게 \uXXXX로 내보낸다.
 * 파일을 열기만 하고 고치지 않는다
 */
export const TITLE_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$paths = [Console]::In.ReadToEnd().Split([char]10) | ForEach-Object { $_.Trim() } | Where-Object { $_ }',
  '$rxCustom = [regex]\'"customTitle":"((?:[^"\\\\]|\\\\.)*)"\'',
  '$rxAi = [regex]\'"aiTitle":"((?:[^"\\\\]|\\\\.)*)"\'',
  '$rxCwd = [regex]\'"cwd":"((?:[^"\\\\]|\\\\.)*)"\'',
  'function Read-Part($fs, $offset, $count) { $buf = New-Object byte[] $count; [void]$fs.Seek($offset, [IO.SeekOrigin]::Begin); $n = $fs.Read($buf, 0, $count); [Text.Encoding]::UTF8.GetString($buf, 0, $n) }',
  'function Get-Last($re, $text) { $m = $re.Matches($text); if ($m.Count -gt 0) { return ((\'"\' + $m[$m.Count - 1].Groups[1].Value + \'"\') | ConvertFrom-Json) }; return \'\' }',
  '$out = foreach ($p in $paths) {',
  '  try {',
  '    $fs = [IO.File]::Open($p, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)',
  '    try {',
  '      $len = $fs.Length; $n = [Math]::Min(262144, $len)',
  '      $tail = Read-Part $fs ($len - $n) $n',
  "      $head = if ($len -gt $n) { Read-Part $fs 0 ([Math]::Min(65536, $len)) } else { '' }",
  '    } finally { $fs.Dispose() }',
  '    $c = Get-Last $rxCustom $tail; if (-not $c) { $c = Get-Last $rxCustom $head }',
  '    $a = Get-Last $rxAi $tail; if (-not $a) { $a = Get-Last $rxAi $head }',
  '    $w = Get-Last $rxCwd $tail; if (-not $w) { $w = Get-Last $rxCwd $head }',
  '    [ordered]@{ p = $p; c = "$c"; a = "$a"; w = "$w" }',
  '  } catch { }',
  '}',
  'ConvertTo-Json -InputObject @($out) -Compress -EscapeHandling EscapeNonAscii',
].join('\n')

