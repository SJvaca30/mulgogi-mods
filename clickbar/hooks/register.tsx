import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptFilled, Register, RenderSurface, SessionContextUsage, SessionUsage } from 'claude-code'

import { addDelta, cardText, editDelta, progressText, whenText } from './card'
import type { FileDelta } from './card'
import { DEFAULT_FAVORITES, GROUPS, KO, NEEDS_ARGS, TIPS, keyGroupsFor, platformOf } from './catalog'
import type { Platform } from './catalog'
import type { Assumption, Idea, PaletteTab, PromptEntry } from '../types'
import { ASSUME_DESCRIPTION, ASSUME_SCHEMA, ASSUME_SWITCH_KEY, ASSUME_TOOL_MATCH, ASSUME_TOOL_NAME, assumptionTexts, correctionPrompt } from './assumptions'
import { bar, itemCells, kTokens, limitView, usdText, viewOf } from './meter'
import type { MeterItem } from './meter'
import { blocksText, isTypedPrompt, mergePrompts, promptsFromTranscript } from './prompts'
import { finalReplies, previewLine, unfence } from './replies'
import { parseSyncStatus, syncView } from './sync'

const PANE = 'clickbar-palette'
// session-tracker의 세션 패널 id. [sessions]는 이 패널을 직접 연다(openSessions)
const SESSIONS_PANE = 'session-tracker-panel'
// 폭이 이보다 좁으면 tasks·fork는 [palette]에서만 열고, 한도는 경고 수준일 때만, API 환산액은 숨긴다
const WIDE_COLUMNS = 110
// 팔레트 명령 줄의 열 폭(글자 칸): [/security-review]까지 한 줄에 들어가는 명령 열, [넣기] [고정] 버튼 열
const COL_COMMAND = 20
const COL_ROW_ACTIONS = 13
// [단축키] 탭의 키 열 폭: 가장 긴 "Ctrl+W · K · U"(14칸)에 두 칸 여유
const COL_KEY = 16
// 내 질문·아이디어 탭의 시각 열 폭: 가장 긴 "10/15 16:10"(11칸). 줄지 않게 둬서 시각이 꺾이지 않고 세로로 맞는다
const COL_WHEN = 11
// band 맨 위 가로줄의 머리 글. 채팅과 band 사이 경계이고, 엔진의 [-]가 이 줄 끝에 붙는다
const BAND_RULE_LABEL = '── clickbar '
const NARROW_COLUMNS = 72
// band 상태 줄: 항목 사이 빈칸 수, 한도 막대 칸 수(컨텍스트 막대는 10칸). 팔레트 한도 줄의 이름 열 폭("! 5시간"까지)
const METER_GAP = 3
const LIMIT_BAR_CELLS = 5
const COL_LIMIT_NAME = 7
// 클릭할 때 터미널이 선택 영역을 클립보드에 넣을 수 있어, 잠시 뒤 한 번 더 복사한다 (reply-tools와 같은 방식)
const SELECTION_SETTLE_MS = 350
// btw는 모델이 대화 전체를 보므로, 선택한 글은 어느 부분인지 가리킬 만큼만 붙인다
const BTW_QUOTE_MAX = 200
// 팔레트 답변 탭에 보여줄 최근 답변 수
const RECENT_REPLIES = 20
// 프로젝트마다 보관하는 아이디어 수. 넘으면 오래된 것부터 지운다
const IDEAS_MAX = 50

const meter = atom({ plugin: 'clickbar', key: 'meter' } as const, null)
const usage = atom({ plugin: 'clickbar', key: 'usage' } as const, { limits: [], costUsd: null })
const commands = atom({ plugin: 'clickbar', key: 'commands' } as const, [])
const query = atom({ plugin: 'clickbar', key: 'query' } as const, '')
const favorites = atom({ plugin: 'clickbar', key: 'favorites' } as const, DEFAULT_FAVORITES)
const paletteTab = atom({ plugin: 'clickbar', key: 'paletteTab' } as const, 'commands')
const replies = atom({ plugin: 'clickbar', key: 'replies' } as const, [])
const ideas = atom({ plugin: 'clickbar', key: 'ideas' } as const, [])
const ideaDraft = atom({ plugin: 'clickbar', key: 'ideaDraft' } as const, '')
const prompts = atom({ plugin: 'clickbar', key: 'prompts' } as const, [])
// 명령 추천은 명령마다 세션에서 한 번만 한다
const tipped = new Set<string>()
const TIPS_SWITCH_KEY = 'tips'
// 내 질문 표시 모양(/bubbles로 고른다). card: 대화 칸 전체 폭의 옅은 카드(위아래 한 줄 여백), bar: 그 카드 왼쪽에 색 막대,
// mark: 배경 없이 색 있는 ❯와 흐린 글. 카드와 막대는 글자가 아니라 칠한 칸이라 마우스로 끌어 복사해도 질문 글만 따라온다
const BUBBLES_SWITCH_KEY = 'bubbles'
const BUBBLE_STYLES = ['card', 'bar', 'mark'] as const
type BubbleStyle = (typeof BUBBLE_STYLES)[number]
const DEFAULT_BUBBLE_STYLE: BubbleStyle = 'bar'
const BUBBLE_LABELS: Record<BubbleStyle, string> = { card: '카드', bar: '막대 카드', mark: '표식' }
// 카드 바탕색: 흰·검은 바탕에서 카드로 보일 만큼만 옅게 둔다(진하면 형광펜처럼 보인다). ANSI 테마나 모르는 테마는 엔진의 내 질문 배경색 이름을 쓴다
const BUBBLE_BAND: Record<string, string> = { light: '#f2f3f5', 'light-daltonized': '#f2f3f5', dark: '#2a2e35', 'dark-daltonized': '#2a2e35' }
let bubbleStyle: BubbleStyle | 'off' = DEFAULT_BUBBLE_STYLE
let theme = ''

function bubbleStyleOf(saved: unknown): BubbleStyle | 'off' {
  if (saved === 'off') return 'off'

  return (BUBBLE_STYLES as readonly unknown[]).includes(saved) ? (saved as BubbleStyle) : DEFAULT_BUBBLE_STYLE
}
const assumptions = atom({ plugin: 'clickbar', key: 'assumptions' } as const, [])
const syncStatus = atom({ plugin: 'clickbar', key: 'syncStatus' } as const, null)
const progress = atom({ plugin: 'clickbar', key: 'turnProgress' } as const, { files: 0, tools: 0 })

// [단축키] 탭이 보일 키의 OS. 세션을 시작할 때 환경 변수로 정한다(못 읽으면 목록을 적은 기준인 Windows)
let platform: Platform = 'windows'
let thresholdModel: string | undefined
// 마지막 측정값. 턴을 시작할 때 이 값을 복사해 두고 턴이 끝날 때의 값과 비교한다
let latest: { tokens: number | null; usd: number | null } = { tokens: null, usd: null }
let turn: { tokens: number | null; usd: number | null; files: Map<string, FileDelta> } | undefined

async function refreshMeter($: EngineInterface, context?: SessionContextUsage) {
  const model = await $.session.model()
  const needsThreshold = model !== thresholdModel
  const live = needsThreshold || context === undefined ? (await $.session.usage(needsThreshold ? { breakdown: 'summary' } : {})).context : context
  const breakdown = live.breakdown
  if (breakdown !== undefined) thresholdModel = model
  await update($, meter, old => ({
    tokens: live.tokens ?? null,
    window: live.window,
    threshold:
      breakdown === undefined
        ? (old?.threshold ?? null)
        : breakdown.isAutoCompactEnabled
          ? (breakdown.autoCompactThreshold ?? null)
          : null,
  }))
}

async function setUsage($: EngineInterface, figures: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>) {
  latest = { tokens: figures.context.tokens ?? null, usd: figures.cost?.usd ?? null }
  await update($, usage, () => ({
    limits: figures.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
    costUsd: figures.cost?.usd ?? null,
  }))
}

// 다시 로드되거나 /clear·/resume 직후에는 다음 응답 전까지 측정값이 오지 않아서, 지금 값을 한 번 읽어 둔다
async function seedUsage($: EngineInterface) {
  await setUsage($, await $.session.usage())
}

async function loadCommands($: EngineInterface) {
  const list = await $.command.list()
  await update($, commands, () => list.map(c => ({ name: c.name, description: c.description })))
}

// CCsetting sync.ps1이 남긴 마지막 동기화 결과를 읽는다. 파일이 없으면(동기화를 안 쓰는 PC) null
async function loadSyncStatus($: EngineInterface) {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  if (home === undefined) return
  const path = `${home}/.claude/sync.status.json`
  const status = (await $.fs.exists(path)) ? parseSyncStatus(String(await $.fs.read(path))) : null
  await update($, syncStatus, () => status)
}

// [sync]는 session-tracker의 /sync를 실행한다. 끝나면 결과 파일을 다시 읽어 버튼 색을 바꾼다
async function runSync($: EngineInterface) {
  await run($, 'sync')
  await loadSyncStatus($).catch(() => undefined)
}

async function loadFavorites($: EngineInterface) {
  const saved = await $.store.get('favorites')
  if (Array.isArray(saved) && saved.every(x => typeof x === 'string')) await update($, favorites, () => saved)
}

async function run($: EngineInterface, name: string) {
  try {
    const result = await $.command.run({ command: name })
    // fork는 화면에 아무 변화가 없어 무엇이 생겼는지 알기 어렵다
    if (name === 'fork') {
      $.ui.toast(`fork: ${result.text?.trim() || '지금 대화를 백그라운드 사본으로 복사했습니다'} · 지금 대화는 그대로 이어집니다`, { timeoutMs: 8000 })
    }
  } catch (error) {
    $.ui.toast(`/${name} 실행 실패: ${error instanceof Error ? error.message : String(error)}`, { timeoutMs: 8000 })
  }
}

async function recentReplies($: EngineInterface): Promise<string[]> {
  return finalReplies(await $.session.messages(), RECENT_REPLIES)
}

// 답변을 복사한다. 바깥 ````markdown 펜스는 벗겨, 붙여 넣으면 바로 마크다운 원문이 되게 한다
async function copyText($: EngineInterface, reply: string, surface: RenderSurface, what: string) {
  const text = unfence(reply)
  await $.ui.copy({ text, surface })
  await $.clock.sleep(SELECTION_SETTLE_MS)
  const result = await $.ui.copy({ text, surface })
  $.ui.toast(result.isCopied ? `${what}을 복사했습니다 (${text.split('\n').length}줄)` : `복사하지 못했습니다: ${result.reason}`)
}

async function copyLastReply($: EngineInterface, surface: RenderSurface) {
  const last = (await recentReplies($))[0]
  if (last === undefined) {
    $.ui.toast('복사할 답변이 아직 없습니다')
    return
  }
  await copyText($, last, surface, '마지막 답변')
}

// 아이디어 목록은 프로젝트(세션의 루트 폴더)마다 따로 두고, 세션이 바뀌어도 남도록 $.store에 둔다
async function ideaKey($: EngineInterface) {
  return `ideas:${await $.session.root()}`
}

async function loadIdeas($: EngineInterface) {
  const saved = await $.store.get(await ideaKey($))
  const list = Array.isArray(saved)
    ? saved.filter((x): x is Idea => typeof x === 'object' && x !== null && typeof x.text === 'string' && typeof x.at === 'number')
    : []
  await update($, ideas, () => list)
}

async function saveIdeas($: EngineInterface, list: Idea[]) {
  await $.store.set(await ideaKey($), list)
  await update($, ideas, () => list)
  await refreshStatus($)
}

// 입력창 아래 상태 줄: 보관한 아이디어 개수. 없으면 지운다
async function refreshStatus($: EngineInterface) {
  // 가정 개수는 band의 버튼이 이미 보여 주므로 상태 줄에는 아이디어만 둔다
  const idea = (await read($, ideas)).length
  $.ui.status(idea === 0 ? undefined : `보관한 아이디어 ${idea}개 · /idea로 확인`)
}

// 사용자 턴으로 보낸다. 들어가지 못했으면 false. Claude가 일하는 중이면 지금 턴이 끝난 뒤 실행된다
async function submitAsUser($: EngineInterface, text: string) {
  const result = await $.prompt.submit({ text, asUser: true })
  if ('drop' in result && result.drop !== undefined) {
    $.ui.toast('전송하지 못했습니다. 다른 mod나 훅이 전송을 차단했습니다')
    return false
  }
  $.ui.toast('전송했습니다. Claude가 작업 중이면 현재 작업이 끝난 뒤 실행됩니다')
  return true
}

// 보낸 뒤에만 아이디어 목록에서 지운다
async function sendIdea($: EngineInterface, idea: Idea) {
  if (await submitAsUser($, idea.text)) await removeIdea($, idea)
}

async function recordAssumptions($: EngineInterface, texts: string[], agent: string) {
  const now = await $.clock.now()
  const added = texts.map((text, i) => ({ id: `${now}-${i}`, text, at: now, status: 'open' as const, fix: '', agent }))
  await update($, assumptions, old => [...added, ...old])
  await refreshStatus($)
}

async function markAssumption($: EngineInterface, id: string, status: Assumption['status']) {
  await update($, assumptions, old => old.map(a => (a.id === id ? { ...a, status } : a)))
  await refreshStatus($)
}

// 목록 단위 조작은 화면 변화가 작아 눌렸는지 알기 어려우니 결과를 토스트로도 알린다
async function markAllRight($: EngineInterface) {
  const open = (await read($, assumptions)).filter(a => a.status === 'open').length
  await update($, assumptions, old => old.map(a => (a.status === 'open' ? { ...a, status: 'right' as const } : a)))
  await refreshStatus($)
  $.ui.toast(open === 0 ? '확인할 가정이 남아 있지 않습니다' : `남은 가정 ${open}개를 맞음으로 표시했습니다`)
}

async function clearAssumptions($: EngineInterface) {
  const n = (await read($, assumptions)).length
  await update($, assumptions, () => [])
  await refreshStatus($)
  $.ui.toast(n === 0 ? '비울 가정이 없습니다' : `가정 ${n}개를 목록에서 삭제했습니다`)
}

async function addPrompts($: EngineInterface, list: PromptEntry[]) {
  await update($, prompts, old => mergePrompts(old, list))
}

// 이어서 연 세션은 기록 파일에서 예전 질문을 채운다. 파일이 4MiB를 넘으면 읽을 수 없어 건너뛴다
async function backfillPrompts($: EngineInterface, transcriptPath: string) {
  try {
    const stat = await $.fs.stat(transcriptPath)
    if (stat.size > 4 * 1024 * 1024) return
    await addPrompts($, promptsFromTranscript(String(await $.fs.read(transcriptPath))))
  } catch (error) {
    $.ui.log(`clickbar: 질문 목록을 기록 파일에서 채우지 못함: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
  }
}

async function jumpTo($: EngineInterface, entry: PromptEntry) {
  const failed = '해당 질문 위치로 이동할 수 없습니다. 압축 이전 대화이거나 화면에 표시되지 않은 질문입니다'
  try {
    const result = await $.ui.scroll({ to: { requestId: entry.uuid }, block: 'start' })
    if (result.deny !== undefined) $.ui.toast(failed)
  } catch {
    $.ui.toast(failed)
  }
}

async function suggestCommand($: EngineInterface, text: string) {
  if (text.trim().startsWith('/') || (await $.store.get(TIPS_SWITCH_KEY)) === 'off') return
  const installed = new Set((await read($, commands)).map(c => c.name))
  const tip = TIPS.find(t => !tipped.has(t.command) && (installed.size === 0 || installed.has(t.command)) && t.pattern.test(text))
  if (tip === undefined) return
  tipped.add(tip.command)
  $.ui.toast(`팁: /${tip.command} 명령으로 바로 실행할 수 있습니다. ${KO.get(tip.command) ?? ''} (끄려면 /tips off)`, { timeoutMs: 10000 })
}

async function sendCorrections($: EngineInterface) {
  const list = await read($, assumptions)
  const text = correctionPrompt(list)
  if (text === null) {
    $.ui.toast('틀림으로 표시한 가정이 없습니다')
    return
  }
  if (await submitAsUser($, text)) {
    await update($, assumptions, old => old.map(a => (a.status === 'wrong' ? { ...a, status: 'sent' as const } : a)))
    await refreshStatus($)
  }
}

async function addIdea($: EngineInterface, text: string) {
  const trimmed = text.trim()
  if (trimmed === '') {
    $.ui.toast('보관할 내용이 없습니다. /idea 뒤에 내용을 입력하거나, 입력창에 작성한 뒤 [+ 입력 내용 보관]을 누르세요')
    return false
  }
  await loadIdeas($)
  const list = [{ text: trimmed, at: await $.clock.now() }, ...(await read($, ideas))].slice(0, IDEAS_MAX)
  await saveIdeas($, list)
  $.ui.toast(`아이디어를 보관했습니다 (이 프로젝트 ${list.length}개). /idea로 다시 확인할 수 있습니다`)
  return true
}

// 입력창의 글을 보관한 뒤에만 입력창을 비운다. 저장이 실패하면 쓰던 글은 그대로 남는다
async function shelveDraft($: EngineInterface) {
  const draft = (await $.prompt.read()).text
  if (!(await addIdea($, draft))) return
  const cleared = await $.prompt.fill({ text: '', mode: 'replace' })
  if (!cleared.isFilled) $.ui.toast('보관했지만 입력창을 비우지 못했습니다')
}

async function removeIdea($: EngineInterface, idea: Idea) {
  await loadIdeas($)
  await saveIdeas($, (await read($, ideas)).filter(x => !(x.at === idea.at && x.text === idea.text)))
}

async function showTab($: EngineInterface, tab: PaletteTab) {
  if (tab === 'replies') {
    const list = await recentReplies($)
    await update($, replies, () => list)
  }
  if (tab === 'ideas') await loadIdeas($)
  await update($, paletteTab, () => tab)
}

function reportFill($: EngineInterface, filled: PromptFilled) {
  if (!filled.isFilled) $.ui.toast(filled.refusal === 'dialog' ? '대화상자가 열려 있어 입력창에 넣지 못했습니다' : '입력창에 넣지 못했습니다')
}

async function quoteSelection($: EngineInterface) {
  const selected = (await $.ui.selection())?.text.trim() ?? ''
  if (selected === '') {
    $.ui.toast('먼저 마우스로 인용할 글을 선택하세요')
    return
  }
  const quoted = selected
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n')
  reportFill($, await $.prompt.fill({ text: `${quoted}\n\n`, mode: 'insert' }))
}

// 선택한 글을 가리키는 /btw를 입력창 맨 앞에 넣는다. 쓰던 글은 질문으로 뒤에 남긴다
async function askAside($: EngineInterface) {
  const selected = (await $.ui.selection())?.text.replace(/\s+/g, ' ').trim() ?? ''
  const about = selected === '' ? '' : `"${selected.length > BTW_QUOTE_MAX ? `${selected.slice(0, BTW_QUOTE_MAX)}…` : selected}" `
  const draft = (await $.prompt.read()).text
  const question = draft.startsWith('/btw ') ? draft.slice('/btw '.length) : draft
  reportFill($, await $.prompt.fill({ text: `/btw ${about}${question}`, mode: 'replace' }))
}

async function toggleFavorite($: EngineInterface, name: string) {
  const list = await update($, favorites, old => (old.includes(name) ? old.filter(n => n !== name) : [...old, name]))
  await $.store.set('favorites', list)
}

// session-tracker의 세션 패널을 직접 연다. /sessions를 $.command.run으로 부르면 엔진이 사람이 친 명령처럼 다뤄
// 답변이 끝날 때까지 줄을 세우므로(immediate는 사람이 직접 친 명령에만 듣는다), 답변 중에도 바로 뜨게 패널을 연다.
// 목록 읽기는 session-tracker가 이 패널이 열리는 것(ui.open)을 받아서 한다
async function openSessions($: EngineInterface) {
  try {
    await $.ui.open({ id: SESSIONS_PANE, title: '세션', focus: true, closeOnEscape: true })
  } catch {
    await run($, 'sessions')
  }
}

async function openPalette($: EngineInterface) {
  await loadCommands($)
  // 탭은 기억하되 검색어는 비운다. 지난 검색어가 남으면 목록이 걸러진 채 열려 명령이 없어 보인다
  await update($, query, () => '')
  const tab = await read($, paletteTab)
  if (tab === 'replies' || tab === 'ideas') await showTab($, tab)
  if (tab === 'assume') await update($, paletteTab, () => tab)
  await $.ui.open({ id: PANE, title: '명령', focus: true, closeOnEscape: true })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'palette',
      description: '명령 팔레트를 엽니다. 명령·스킬·단축키·대화 기록을 한국어 설명과 함께 검색하고 바로 실행합니다',
      immediate: true,
    })
    // Claude가 일하는 중에도 끊지 않고 보관할 수 있도록 immediate로 둔다
    await $.command.register({
      name: 'idea',
      description: '아이디어를 프로젝트별로 저장합니다. 내용 없이 실행하면 저장한 아이디어 목록을 엽니다',
      argumentHint: '[보관할 내용]',
      immediate: true,
    })
    await $.command.register({
      name: 'tips',
      description: '질문에 맞는 내장 명령을 한 번씩 추천합니다. /tips off로 끌 수 있습니다',
      argumentHint: '[on|off]',
      immediate: true,
    })
    await $.command.register({
      name: 'bubbles',
      description: '대화에서 내 질문을 카드로 표시해 답변과 구분합니다. /bubbles card·bar·mark·off로 모양을 고릅니다',
      argumentHint: '[card|bar|mark|off]',
      immediate: true,
    })
    bubbleStyle = bubbleStyleOf(await $.store.get(BUBBLES_SWITCH_KEY))
    theme = String((await $.config.list().catch(() => [])).find(row => row.key === 'theme')?.value ?? '')
    await $.command.register({
      name: 'assumptions',
      description: 'Claude가 확인 없이 정한 가정을 검토하고 바로잡습니다. /assumptions off·on으로 끄고 켭니다(다음 세션부터 적용)',
      argumentHint: '[on|off]',
      immediate: true,
    })
    // 이 도구는 모든 세션의 모델에게 보인다. 사용자가 꺼 두었으면 등록하지 않는다
    if ((await $.store.get(ASSUME_SWITCH_KEY)) !== 'off') {
      await $.tool.register({ name: ASSUME_TOOL_NAME, description: ASSUME_DESCRIPTION, inputSchema: ASSUME_SCHEMA, isDeferred: false })
    }
    await loadFavorites($)
    try {
      platform = platformOf({ os: await $.env.get('OS'), cfEncoding: await $.env.get('__CF_USER_TEXT_ENCODING') })
    } catch {
      // 환경 변수를 못 읽으면 Windows 기준 목록을 그대로 보인다
    }
    // 다른 플러그인이 자기 명령을 등록할 시간을 준 뒤 읽는다 (quickbar와 같은 방식)
    $.clock.after(1500, () => void loadCommands($).then(() => refreshMeter($)).then(() => seedUsage($)).then(() => loadIdeas($)).then(() => refreshStatus($)).then(() => loadSyncStatus($)))
    // 한도의 초기화 시각이 지나는 것과 다른 세션이 돌린 동기화 결과를 보이도록 1분마다 다시 읽고 그린다
    $.clock.every(60000, () => void loadSyncStatus($).catch(() => undefined).then(() => $.ui.invalidate('ui.render')))

    return next(e)
  })

  // 가정 기록 도구는 이 mod가 직접 답한다. 화면에 목록을 쌓을 뿐이라 권한을 묻지 않는다
  on('tool.check', { tool: ASSUME_TOOL_MATCH }, () => ({ decision: 'allow' as const, reason: 'clickbar: 가정 기록 전용 도구' }))

  on('tool.call', { tool: ASSUME_TOOL_MATCH }, async ($, e) => {
    if ((await $.store.get(ASSUME_SWITCH_KEY)) === 'off') return { result: '가정 기록이 꺼져 있다. 이 도구를 더 부르지 마라.' }
    const texts = assumptionTexts(e)
    if (texts.length === 0) return { result: '기록할 가정이 없었다. 계속 진행하라.' }
    await recordAssumptions($, texts, e.agentId ?? '')

    return { result: `${texts.length}개 기록됨. 사용자가 clickbar에서 확인한다. 계속 진행하라.` }
  })

  on('command.run', { command: 'assumptions' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'on') {
      await $.store.set(ASSUME_SWITCH_KEY, arg)
      $.ui.toast(arg === 'off' ? '가정 기록을 껐습니다. 지금부터 기록하지 않으며, 다음 세션부터는 모델에 도구도 제공하지 않습니다' : '가정 기록을 켰습니다. 다음 세션부터 적용됩니다')
    } else {
      await update($, paletteTab, () => 'assume')
      await openPalette($)
    }

    return {}
  })

  // /clear, /resume, /branch는 $.state를 초기화하고, 압축은 토큰 수를 바꾼다.
  // Team 플랜에서는 내장 보안 mod가 user mod의 classic.* 훅을 건너뛰게 해서(2026-10-11 디버그 로그로 확인), 명령이 끝난 직후에 갱신한다
  on('command.run', { command: ['clear', 'resume', 'branch', 'compact'] }, async ($, e, next) => {
    const result = await next(e)
    try {
      if (e.command === 'clear') await update($, prompts, () => [])
      await loadFavorites($)
      thresholdModel = undefined
      await refreshMeter($)
      await seedUsage($)
    } catch (error) {
      $.ui.log(`clickbar: /${e.command} 뒤 갱신 실패: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
    }

    return result
  })

  // 내가 보낸 질문을 기록 파일에 들어가는 행 id와 함께 모은다. 기록은 받은 그대로 넘긴다
  on('session.append', { door: 'prompt' }, async ($, e, next) => {
    const result = await next(e)
    try {
      const text = blocksText(e.message.content)
      if (e.agentId === undefined && e.message.isMeta !== true && isTypedPrompt(text) && result.uuid !== undefined) {
        await addPrompts($, [{ uuid: result.uuid, at: await $.clock.now(), text }])
      }
    } catch (error) {
      $.ui.log(`clickbar: 질문 기록 실패: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
    }

    return result
  })

  // 사람이 직접 쓴 질문에서 내장 명령으로 바로 할 수 있는 일을 알아보면 한 번 알려 준다. 질문은 바꾸지 않는다
  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') {
      try {
        await suggestCommand($, e.text)
      } catch (error) {
        $.ui.log(`clickbar: 명령 추천 실패: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
      }
    }

    return result
  })

  // 입력창에 /를 쳤을 때 뜨는 기본 명령 목록의 설명을 한국어로 바꾼다
  on('command.describe', async ($, e, next) => {
    const result = await next(e)
    // 엔진이 직접 제공하는 명령(core)만 바꾼다. 같은 이름의 플러그인 명령은 그대로 둔다
    const ko = e.provider.tier === 'core' ? KO.get(e.command) : undefined

    return ko === undefined ? result : { ...result, description: ko }
  })

  on('command.run', { command: 'bubbles' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const choice = arg === 'on' ? DEFAULT_BUBBLE_STYLE : arg
    if (choice === 'off' || (BUBBLE_STYLES as readonly string[]).includes(choice)) {
      await $.store.set(BUBBLES_SWITCH_KEY, choice)
      bubbleStyle = bubbleStyleOf(choice)
      // 이미 그려진 질문도 바로 바뀌도록 다시 그린다
      $.ui.invalidate('ui.render')
      $.ui.toast(bubbleStyle === 'off' ? '내 질문 표시를 껐습니다' : `내 질문을 ${BUBBLE_LABELS[bubbleStyle]} 모양으로 표시합니다`)
    } else {
      $.ui.toast('/bubbles 뒤에 card(카드) · bar(막대 카드) · mark(표식) · off(끄기) 중 하나를 입력합니다')
    }

    return {}
  })

  on('command.run', { command: 'tips' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'on') {
      await $.store.set(TIPS_SWITCH_KEY, arg)
      $.ui.toast(arg === 'off' ? '명령 추천을 껐습니다' : '명령 추천을 켰습니다')
    } else {
      $.ui.toast('/tips off로 명령 추천을 끄고, /tips on으로 다시 켭니다')
    }

    return {}
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    await setUsage($, e)
    if (e.changed.includes('context')) await refreshMeter($, e.context)

    return result
  })

  // 턴 작업 카드. 집계가 실패해도 턴과 도구 호출에는 손대지 않는다
  on('turn.start', async ($, e, next) => {
    turn = { tokens: latest.tokens, usd: latest.usd, files: new Map() }
    await update($, progress, () => ({ files: 0, tools: 0 }))

    return next(e)
  })

  // 스피너 줄의 "도구 N회"는 메인 에이전트가 이번 턴에 부른 도구 수다. 서브에이전트 안의 호출과 가정 기록 도구는 세지 않는다
  on('tool.call', async ($, e, next) => {
    if (turn !== undefined && e.agentId === undefined && !ASSUME_TOOL_MATCH.test(e.tool)) {
      await update($, progress, old => ({ ...old, tools: old.tools + 1 }))
    }

    return next(e)
  })

  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    const result = await next(e)
    try {
      const edit = turn !== undefined && result.deny === undefined && result.isError !== true ? editDelta(result.result) : null
      if (turn !== undefined && edit !== null) {
        addDelta(turn.files, edit.path, edit.delta)
        const files = turn.files.size
        await update($, progress, old => ({ ...old, files }))
      }
    } catch (error) {
      $.ui.log(`clickbar: 작업 카드 집계 실패: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const started = turn
    if (e.agentId !== undefined || started === undefined) return result
    turn = undefined
    try {
      const live = await $.session.usage()
      const tokens = live.context.tokens
      const usd = live.cost?.usd
      const text = cardText({
        files: started.files,
        tokens: tokens === undefined || started.tokens === null ? null : tokens - started.tokens,
        usd: usd === undefined || started.usd === null ? null : usd - started.usd,
        isAborted: e.isAborted,
      })
      if (text !== '') $.ui.log(text)
    } catch (error) {
      $.ui.log(`clickbar: 작업 카드 실패: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
    }

    return result
  })

  on('command.run', { command: 'palette' }, async $ => {
    await openPalette($)

    return {}
  })

  on('command.run', { command: 'idea' }, async ($, e) => {
    if (e.args.trim() === '') {
      await update($, paletteTab, () => 'ideas')
      await openPalette($)
    } else {
      await addIdea($, e.args)
    }

    return {}
  })

  // 일하는 동안 스피너 줄에 이번 턴의 진행 상황을 붙인다: "✶ Pondering · 파일 2개 수정 · 도구 7회… (8s · ↓ 1.2k tokens)".
  // suffix는 엔진의 "…" 자리라 그 앞에 끼워 넣는다. 엔진이 낱말 대신 안내(message)를 보이는 동안은 그대로 둔다
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const extra = progressText(await read($, progress))
    if (e.surface !== 'terminal' || e.props.message !== null || extra === '') return next(e)

    return next({ ...e, props: { ...e.props, suffix: ` · ${extra}${e.props.suffix}` } })
  })

  // 내가 보낸 질문을 Claude의 답과 갈리게 그린다(레퍼런스: Codex CLI의 전체 폭 카드, opencode의 카드+왼쪽 막대, Gemini CLI의 ❯ 표식).
  // 카드는 대화 칸 전체 폭에 위아래 한 줄 여백을 둬서 글 길이와 상관없이 한 덩어리로 보인다. 엔진은 앞 턴의 마지막 줄(✻ … done)과
  // 내 질문 사이를 띄우지 않으므로 위에 한 줄을 띄운다.
  // ctrl+o 전체 기록, 터미널이 아닌 화면, 다른 세션·알림이 보낸 글은 엔진이 그린 그대로 둔다
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const kind = e.props.origin.kind
    const text = e.props.text.replace(/\s+$/, '')
    if (bubbleStyle === 'off' || e.surface !== 'terminal' || e.props.isExpanded || (kind !== 'composer' && kind !== 'bridge') || text === '') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    if (bubbleStyle === 'mark') {
      // 배경 없이 색 있는 ❯ 뒤에 흐린 글: 내 말은 한발 물러나고 Claude의 답이 앞으로 나온다
      return (
        <Box flexDirection="row" columnGap={1} marginTop={1}>
          <Box flexShrink={0}>
            <Text color="suggestion" bold>
              ❯
            </Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text dimColor wrap="wrap">
              {text}
            </Text>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="row" marginTop={1}>
        {bubbleStyle === 'bar' && <Box width={1} flexShrink={0} backgroundColor="suggestion" />}
        <Box flexGrow={1} flexShrink={1} backgroundColor={BUBBLE_BAND[theme] ?? 'userMessageBackground'} paddingX={2} paddingY={1}>
          <Text wrap="wrap">{text}</Text>
        </Box>
      </Box>
    )
  })

  // /theme으로 테마를 바꾸면 말풍선 색도 바로 바꾼다
  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const result = await next(e)
    theme = String(e.value)
    $.ui.invalidate('ui.render')

    return result
  })

  // 저장된 답변은 그대로 두고(ctrl+o·/copy는 원문) 화면에서만 바깥 펜스를 벗겨 표·제목을 마크다운으로 그린다
  on('ui.render', { component: 'AssistantMessage' }, async (_, e, next) => {
    const text = unfence(e.props.text)
    return next(text === e.props.text ? e : { ...e, props: { ...e.props, text } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const current = await read($, meter)
    const stats = await read($, usage)
    const now = await $.clock.now()
    const view = current === null ? null : viewOf(current)
    const isWide = e.props.bodyColumns >= WIDE_COLUMNS
    const isNarrow = e.props.bodyColumns < NARROW_COLUMNS
    const toneColor = (t: 'normal' | 'warn' | 'bad' | undefined) => (t === 'bad' ? 'error' : t === 'warn' ? 'warning' : undefined)
    // 상태 줄 항목: 이름(기본색) · 막대 · 비율(굵게) · (설명, 흐리게). 넓을 때만 막대를 그린다
    // 새 세션이나 압축 직후처럼 아직 값이 없으면 "컨텍스트 —"로 둔다. 이 자리도 폭 계산에 넣는다
    const contextItem: MeterItem =
      view === null
        ? { key: 'band-meter-context', name: '컨텍스트', bar: '', figure: '', note: '—', tone: 'normal' }
        : {
            key: 'band-meter-context',
            name: '컨텍스트',
            bar: isWide ? bar(view.percent) : '',
            figure: `${view.percent}%`,
            note: isNarrow ? '' : `(${view.basis === 'compact' ? (isWide ? '자동 압축까지' : '압축까지') : '창 여유'} ${kTokens(view.left)})`,
            tone: view.tone,
          }
    // 넓거나 중간 폭이면 비율과 초기화 시각이 늘 보이고, 좁으면 70% 이상만 보인다
    const limitItems: MeterItem[] = stats.limits
      .map(l => limitView(l, now))
      .filter(l => !isNarrow || l.isHigh)
      .map(l => ({ key: `band-limit-${l.kind}`, name: l.name, bar: isWide ? bar(l.percent, LIMIT_BAR_CELLS) : '', figure: `${l.percent}%`, note: l.reset === '' ? '' : `(${l.reset})`, tone: l.tone }))
    const meterItems = [contextItem, ...limitItems]
    // API 환산액은 넓은 band에서, 나머지 항목과 한 줄에 들어갈 때만 붙인다(넘치면 줄이 두 줄로 바뀌며 흔들린다)
    const costItem: MeterItem | null =
      !isWide || stats.costUsd === null ? null : { key: 'band-meter-cost', name: 'API 환산', bar: '', figure: usdText(stats.costUsd), note: '', tone: 'normal' }
    const usedCells = meterItems.reduce((n, it, i) => n + itemCells(it) + (i > 0 ? METER_GAP : 0), 0)
    if (costItem !== null && usedCells + METER_GAP + itemCells(costItem) <= e.props.bodyColumns) meterItems.push(costItem)
    const meterView = (it: MeterItem) => {
      const color = toneColor(it.tone)

      return (
        <Box key={it.key} flexShrink={0} columnGap={1}>
          {it.tone === 'bad' && (
            <Text color={color} bold>
              !
            </Text>
          )}
          <Text>{it.name}</Text>
          {it.bar !== '' && (
            <Text color={color} dimColor={color === undefined}>
              {it.bar}
            </Text>
          )}
          {it.figure !== '' && (
            <Text color={color} bold>
              {it.figure}
            </Text>
          )}
          {it.note !== '' && <Text dimColor>{it.note}</Text>}
        </Box>
      )
    }
    const openAssumptions = (await read($, assumptions)).filter(a => a.status === 'open').length
    // session-tracker가 설치돼 있으면 세션 패널 버튼을 둔다
    const hasSessions = (await read($, commands)).some(c => c.name === 'sessions')
    const hasSync = (await read($, commands)).some(c => c.name === 'sync')
    const sync = syncView(await read($, syncStatus), now)
    const others = await next(e)

    // 회색 글자는 정보(누를 수 없음), 색 있는 [괄호]는 버튼이다. 윗줄은 상태, 아랫줄은 버튼만 둔다.
    // 경고일 때만 색을 바꾼다: 상태는 그 글자를, 버튼은 [compact 권장]처럼 눌러야 할 것을 칠한다.
    const act = (key: string, word: string, onPress: (press: { surface: RenderSurface }) => void, color: string = 'suggestion') => (
      <Button key={key} plain label={`[${word}]`} onPress={onPress}>
        <Text color={color}>[{word}]</Text>
      </Button>
    )
    // 채팅과 band 사이에 흐린 가로줄을 긋는다. 폭은 band 폭(엔진의 [-] 다섯 칸 제외)에 맞춘다. 데스크톱은 엔진이 따로 그린다
    const ruleWidth = e.props.bodyColumns
    const rule = e.surface === 'terminal' && ruleWidth > 0 ? (BAND_RULE_LABEL + '─'.repeat(Math.max(0, ruleWidth - BAND_RULE_LABEL.length))).slice(0, ruleWidth) : null
    return (
      <Box flexDirection="column">
        {rule !== null && (
          <Text dimColor wrap="truncate-end">
            {rule}
          </Text>
        )}
        {/* 항목은 줄지 않는 묶음이라, 폭이 모자라면 항목째 다음 줄로 넘어간다. 구분 기호 대신 빈칸으로 띄워 줄 앞에 기호가 남지 않는다 */}
        <Box key="status" columnGap={METER_GAP} flexWrap="wrap">
          {meterItems.map(meterView)}
        </Box>
        {/* 버튼 이름은 모두 영어다. 명령이 있는 버튼은 그 명령 이름 그대로다(palette=/palette, assumptions=/assumptions).
            용도별로 │로 묶는다: 컨텍스트 │ 대화 찾기·나누기 │ 답변 다루기 │ 도구. 나타났다 사라지는 assumptions는 맨 끝에 둬서 다른 버튼이 밀리지 않게 한다 */}
        <Box key="actions" columnGap={1} flexWrap="wrap">
          {act('band-compact', view?.tone === 'bad' ? 'compact now' : 'compact', () => void run($, 'compact'), view?.tone === 'bad' ? 'error' : 'suggestion')}
          {act('band-context', 'context', () => void run($, 'context'))}
          <Text key="band-sep-chat" dimColor>
            │
          </Text>
          {/* 지난 대화 전체 목록. 켜진 백그라운드 대화는 연결되고, 꺼진 대화는 다시 켜진다(Ctrl+A로 모든 폴더) */}
          {act('band-resume', 'resume', () => void run($, 'resume'))}
          {hasSessions && act('band-sessions', 'sessions', () => void openSessions($))}
          {isWide && act('band-fork', 'fork', () => void run($, 'fork'))}
          <Text key="band-sep-reply" dimColor>
            │
          </Text>
          {act('band-copy', 'copy', press => void copyLastReply($, press.surface))}
          {act('band-quote', 'quote', () => void quoteSelection($))}
          {act('band-btw', 'btw', () => void askAside($))}
          <Text key="band-sep-tools" dimColor>
            │
          </Text>
          {isWide && act('band-tasks', 'tasks', () => void run($, 'tasks'))}
          {/* 동기화가 보류·실패했거나 하루 넘게 안 돌았으면 이름과 색이 바뀐다(sync.status.json) */}
          {hasSync && act('band-sync', sync.word, () => void runSync($), sync.color)}
          {act('band-more', 'palette', () => void openPalette($))}
          {openAssumptions > 0 && (
            <Text key="band-sep-assume" dimColor>
              │
            </Text>
          )}
          {openAssumptions > 0 &&
            act('band-assume', `assumptions ${openAssumptions}`, () => void update($, paletteTab, () => 'assume').then(() => openPalette($)), 'warning')}
        </Box>
        {others}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const Input = 'Input' in elements ? elements.Input : undefined
    // band와 같은 규칙: 회색 글자는 정보, 색 있는 [괄호]는 버튼
    const act = (key: string, word: string, onPress: (press: { surface: RenderSurface }) => void, color: string = 'suggestion') => (
      <Button key={key} plain label={`[${word}]`} onPress={onPress}>
        <Text color={color}>[{word}]</Text>
      </Button>
    )
    const installed = await read($, commands)
    const raw = await read($, query)
    const q = raw.trim().toLowerCase()
    const favs = await read($, favorites)
    const byName = new Map(installed.map(c => [c.name, c.description]))
    const describe = (name: string) => KO.get(name) ?? byName.get(name) ?? ''
    const matches = (name: string) => q === '' || name.includes(q) || describe(name).toLowerCase().includes(q)
    const grouped = new Set(GROUPS.flatMap(g => g.entries.map(x => x.name)))
    const others = installed.filter(c => !grouped.has(c.name) && matches(c.name)).map(c => c.name)

    // 명령 · 버튼 · 설명을 고정 폭 열로 맞춘다. 설명이 길어 꺾여도 설명 열 안에서만 꺾여 표처럼 읽힌다
    const row = (section: string, name: string) => (
      <Box key={`${section}-${name}`} gap={1}>
        <Box width={COL_COMMAND} flexShrink={0}>
          {act(`${section}-run-${name}`, `/${name}`, () => void (NEEDS_ARGS.has(name) ? $.prompt.fill({ text: `/${name} `, mode: 'replace' }) : run($, name)))}
        </Box>
        <Box width={COL_ROW_ACTIONS} flexShrink={0} columnGap={1}>
          {act(`${section}-fill-${name}`, '넣기', () => void $.prompt.fill({ text: `/${name} `, mode: 'replace' }))}
          {act(`${section}-fav-${name}`, favs.includes(name) ? '해제' : '고정', () => void toggleFavorite($, name), favs.includes(name) ? 'warning' : 'suggestion')}
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          <Text dimColor>{describe(name)}</Text>
        </Box>
      </Box>
    )

    const section = (key: string, title: string, names: string[]) =>
      names.length === 0 ? null : (
        <Box key={`sec-${key}`} flexDirection="column" marginTop={1}>
          <Text bold>{title}</Text>
          {names.map(name => row(key, name))}
        </Box>
      )

    const tab = await read($, paletteTab)
    // 머리 줄은 세션 패널과 같은 모양이다: 왼쪽에 탭(고른 탭은 칠한 버튼), 오른쪽 끝에 [닫기]와 닫는 키.
    // 탭 쪽만 줄고 꺾이게 해서, 좁은 화면에서도 [닫기]는 첫 줄 오른쪽에 남는다
    const tabsRow = (
      <Box key="tabs" flexGrow={1} flexShrink={1} columnGap={1} flexWrap="wrap">
        {(
          [
            ['commands', '명령'],
            ['keys', '단축키'],
            ['prompts', '내 질문'],
            ['replies', '답변'],
            ['ideas', '아이디어'],
            ['assume', '가정'],
          ] as const
        ).map(([id, title]) =>
          id === tab ? (
            // 고른 탭은 [ ] 대신 같은 폭의 칠한 칸으로 그린다. 폭이 같아 탭을 바꿔도 옆 탭이 밀리지 않는다(세션 패널과 같은 모양)
            <Button key={`tab-${id}`} plain label={title} onPress={() => void showTab($, id)}>
              <Text backgroundColor="suggestion" color="inverseText" bold>{` ${title} `}</Text>
            </Button>
          ) : (
            <Button key={`tab-${id}`} plain label={`[${title}]`} onPress={() => void showTab($, id)}>
              <Text color="suggestion">[{title}]</Text>
            </Button>
          ),
        )}
      </Box>
    )
    // band에는 짧게만 보이는 사용량 한도를 여기서 자세히 보여 준다(초기화 시각의 요일과 남은 시간)
    const now = await $.clock.now()
    const limitDetails = (await read($, usage)).limits.map(l => limitView(l, now))
    const tabs = (
      <Box key="tabs-area" flexDirection="column">
        <Box key="pane-head" columnGap={1}>
          {tabsRow}
          <Box flexShrink={0} columnGap={1}>
            <Button key="pane-close" plain role="dismiss" label="[닫기]" onPress={() => void $.ui.close({ id: PANE })}>
              <Text color="suggestion">[닫기]</Text>
            </Button>
            <Text dimColor>Esc</Text>
          </Box>
        </Box>
        {/* 한도는 한 줄에 하나씩, band와 같은 모양(이름·막대·비율)으로 열을 맞추고 초기화 시각과 남은 시간을 붙인다 */}
        {limitDetails.map(l => {
          const color = l.tone === 'bad' ? 'error' : l.tone === 'warn' ? 'warning' : undefined

          return (
            <Box key={`limit-detail-${l.kind}`} columnGap={1}>
              <Box width={COL_LIMIT_NAME} flexShrink={0} columnGap={1}>
                {l.tone === 'bad' && (
                  <Text color={color} bold>
                    !
                  </Text>
                )}
                <Text>{l.name}</Text>
              </Box>
              <Text color={color} dimColor={color === undefined}>
                {bar(l.percent, LIMIT_BAR_CELLS)}
              </Text>
              <Box width={4} flexShrink={0} justifyContent="flex-end">
                <Text color={color} bold>
                  {`${l.percent}%`}
                </Text>
              </Box>
              {l.detail !== '' && <Text dimColor>{l.detail}</Text>}
            </Box>
          )
        })}
      </Box>
    )

    if (tab === 'keys') {
      // 키는 줄지 않는 열에 기본색으로(파란 [괄호]는 버튼에만 쓴다), 설명은 그 옆 열 안에서만 꺾인다. [/명령]은 줄 끝에 둔다
      const keyGroups = keyGroupsFor(platform).map(group => ({
        title: group.title,
        entries: group.entries.filter(entry => q === '' || entry.keys.toLowerCase().includes(q) || entry.ko.toLowerCase().includes(q)),
      })).filter(group => group.entries.length > 0)

      return (
        <Box flexDirection="column" gap={1}>
          {tabs}
          <Text dimColor>단축키는 직접 눌러야 합니다 · 같은 기능의 명령이 있으면 줄 끝 [/명령]으로 바로 실행할 수 있습니다</Text>
          {platform === 'mac' && <Text dimColor>Mac: Ctrl은 ⌘Command가 아닌 ⌃Control 키이며, Option은 ⌥ 키입니다</Text>}
          {Input !== undefined && (
            <Input key="search" placeholder="키 또는 설명으로 검색" value={raw} autoFocus onInput={(v: string) => void update($, query, () => v)} onSubmit={(v: string) => void update($, query, () => v)} />
          )}
          {keyGroups.length === 0 && <Text dimColor>일치하는 단축키가 없습니다</Text>}
          {keyGroups.map(group => (
            <Box key={`keys-${group.title}`} flexDirection="column">
              <Text bold>{group.title}</Text>
              {group.entries.map(entry => (
                <Box key={`key-${entry.keys}`} gap={1}>
                  <Box width={COL_KEY} flexShrink={0}>
                    <Text>{entry.keys}</Text>
                  </Box>
                  <Box flexGrow={1} flexShrink={1}>
                    <Text dimColor>{entry.ko}</Text>
                  </Box>
                  {entry.command !== undefined && byName.has(entry.command) && (
                    <Box flexShrink={0}>{act(`key-run-${entry.command}`, `/${entry.command}`, () => void run($, entry.command ?? ''))}</Box>
                  )}
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      )
    }

    if (tab === 'prompts') {
      const list = [...(await read($, prompts))].reverse()
      const now = await $.clock.now()

      return (
        <Box flexDirection="column" gap={1}>
          {tabs}
          <Text dimColor>보낸 질문을 최신순으로 표시합니다. [이동]은 대화에서 해당 질문 위치로 이동하고, [입력창에]는 질문을 입력창에 다시 넣습니다</Text>
          {list.length === 0 && <Text dimColor>아직 기록된 질문이 없습니다. 이 기능을 켠 뒤 보낸 질문부터 기록합니다</Text>}
          {list.map((p, i) => (
            <Box key={`prompt-${p.uuid}`} gap={1}>
              {/* 버튼과 시각은 줄지 않는 열, 질문 글은 남는 폭 안에서만 꺾인다(명령 탭과 같은 표 모양) */}
              <Box flexShrink={0} columnGap={1}>
                {act(`prompt-jump-${i}`, '이동', () => void jumpTo($, p))}
                {act(`prompt-fill-${i}`, '입력창에', () => void $.prompt.fill({ text: p.text, mode: 'insert' }).then(filled => reportFill($, filled)))}
              </Box>
              <Box width={COL_WHEN} flexShrink={0}>
                <Text dimColor>{p.at > 0 ? whenText(p.at, now) : '--:--'}</Text>
              </Box>
              <Box flexGrow={1} flexShrink={1}>
                <Text>{p.text}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      )
    }

    if (tab === 'assume') {
      const list = await read($, assumptions)
      const wrong = list.filter(a => a.status === 'wrong').length
      const mark = { open: '○', right: '✓', wrong: '✗', sent: '↗' } as const

      return (
        <Box flexDirection="column" gap={1}>
          {tabs}
          <Text dimColor>Claude가 확인 없이 정한 가정입니다. 틀린 항목에 [틀림]을 누르고 수정 내용을 적어 보내면 해당 부분만 수정합니다</Text>
          <Box key="assume-head" columnGap={1} flexWrap="wrap">
            {act('assume-send', `틀린 가정 수정 요청 (${wrong})`, () => void sendCorrections($), wrong > 0 ? 'warning' : 'suggestion')}
            {act('assume-all-right', '나머지 모두 맞음', () => void markAllRight($))}
            {act('assume-clear', '목록 비우기', () => void clearAssumptions($))}
          </Box>
          {list.length === 0 && <Text dimColor>아직 기록된 가정이 없습니다. 기능을 끄려면 /assumptions off를 입력합니다</Text>}
          {list.map(a => (
            <Box key={`assume-${a.id}`} flexDirection="column">
              <Box gap={1}>
                <Text color={a.status === 'wrong' ? 'error' : a.status === 'open' ? 'warning' : undefined}>{mark[a.status]}</Text>
                {act(`assume-right-${a.id}`, '맞음', () => void markAssumption($, a.id, 'right'), a.status === 'right' ? 'success' : 'suggestion')}
                {act(`assume-wrong-${a.id}`, '틀림', () => void markAssumption($, a.id, 'wrong'), a.status === 'wrong' ? 'error' : 'suggestion')}
                <Text>{a.agent === '' ? a.text : `[서브에이전트] ${a.text}`}</Text>
              </Box>
              {a.status === 'wrong' && Input !== undefined && (
                <Input
                  key={`assume-fix-${a.id}`}
                  placeholder="올바른 내용 (비워 두면 다시 판단하도록 요청합니다)"
                  value={a.fix}
                  onInput={(v: string) => void update($, assumptions, old => old.map(x => (x.id === a.id ? { ...x, fix: v } : x)))}
                  onSubmit={(v: string) => void update($, assumptions, old => old.map(x => (x.id === a.id ? { ...x, fix: v } : x)))}
                />
              )}
            </Box>
          ))}
        </Box>
      )
    }

    if (tab === 'ideas') {
      const list = await read($, ideas)
      const draftIdea = await read($, ideaDraft)
      const now = await $.clock.now()

      return (
        <Box flexDirection="column" gap={1}>
          {tabs}
          {/* 탭마다 안내 한 줄을 먼저 두고, 탭 전용 버튼은 그 아래 줄에 모은다(가정·답변 탭과 같은 순서) */}
          <Text dimColor>이 프로젝트 전용입니다 · [보내기]는 바로 전송하고 [입력창에]는 입력창에 넣기만 합니다 · /idea 내용으로도 보관할 수 있습니다</Text>
          <Box key="ideas-head" columnGap={1}>
            {act('idea-shelve', '+ 입력 내용 보관', () => void shelveDraft($))}
          </Box>
          {Input !== undefined && (
            <Input
              key="idea-new"
              placeholder="새 아이디어를 입력하고 Enter로 보관"
              value={draftIdea}
              onInput={(v: string) => void update($, ideaDraft, () => v)}
              onSubmit={(v: string) => void addIdea($, v).then(ok => (ok ? update($, ideaDraft, () => '') : undefined))}
            />
          )}
          {list.length === 0 && <Text dimColor>보관한 아이디어가 없습니다</Text>}
          {list.map((idea, i) => (
            <Box key={`idea-${i}`} gap={1}>
              <Box flexShrink={0} columnGap={1}>
                {act(`idea-send-${i}`, '보내기', () => void sendIdea($, idea))}
                {act(`idea-use-${i}`, '입력창에', () => void $.prompt.fill({ text: idea.text, mode: 'insert' }).then(filled => reportFill($, filled)))}
                {act(`idea-del-${i}`, '삭제', () => void removeIdea($, idea))}
              </Box>
              <Box width={COL_WHEN} flexShrink={0}>
                <Text dimColor>{whenText(idea.at, now)}</Text>
              </Box>
              <Box flexGrow={1} flexShrink={1}>
                <Text>{idea.text}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      )
    }

    if (tab === 'replies') {
      const list = await read($, replies)

      return (
        <Box flexDirection="column" gap={1}>
          {tabs}
          <Text dimColor>최근 답변 {list.length}개를 최신순으로 표시합니다. [copy]는 답변을 클립보드에 복사합니다</Text>
          <Box key="replies-head" columnGap={1}>
            {act('replies-refresh', '다시 읽기', () => void showTab($, 'replies'))}
          </Box>
          {list.length === 0 && <Text dimColor>아직 답변이 없습니다</Text>}
          {list.map((text, i) => (
            <Box key={`reply-${i}`} gap={1}>
              <Box flexShrink={0}>{act(`reply-copy-${i}`, 'copy', press => void copyText($, text, press.surface, `${i + 1}번째 최근 답변`))}</Box>
              <Box width={2} flexShrink={0} justifyContent="flex-end">
                <Text dimColor>{i + 1}</Text>
              </Box>
              <Box flexGrow={1} flexShrink={1}>
                <Text>{previewLine(text)}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      )
    }

    // 고정한 명령은 맨 위에 한 번만 보이고, 아래 그룹에서는 뺀다(같은 줄이 두 번 나오지 않게)
    const unpinned = (n: string) => !favs.includes(n)

    return (
      <Box flexDirection="column">
        {tabs}
        <Text dimColor>[/명령] 실행 · [넣기] 입력창에 넣기(인자 입력용) · [고정] 맨 위에 고정 · [해제] 고정 해제</Text>
        {Input !== undefined && (
          <Input key="search" placeholder="명령 이름이나 설명으로 검색" value={raw} autoFocus onInput={(v: string) => void update($, query, () => v)} onSubmit={(v: string) => void update($, query, () => v)} />
        )}
        {installed.length === 0 && <Text dimColor>명령 목록을 불러오는 중입니다…</Text>}
        {section('fav', '고정한 명령', favs.filter(n => byName.has(n) && matches(n)))}
        {GROUPS.map((group, i) => section(`g${i}`, group.title, group.entries.map(x => x.name).filter(n => byName.has(n) && matches(n) && unpinned(n))))}
        {/* 한국어 설명을 아직 달지 않은 명령도 숨기지 않는다. 설명은 엔진이 주는 원문 그대로다 */}
        {section('etc', `그 밖의 명령 ${others.filter(unpinned).length}개 (플러그인·스킬 포함, 원문 설명)`, others.filter(unpinned))}
      </Box>
    )
  })
}
