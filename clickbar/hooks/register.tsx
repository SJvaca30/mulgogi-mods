import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptFilled, Register, RenderSurface, SessionContextUsage, SessionUsage } from 'claude-code'

import { addDelta, cardText, editDelta, whenText } from './card'
import type { FileDelta } from './card'
import { DEFAULT_FAVORITES, GROUPS, KEY_GROUPS, KO, NEEDS_ARGS, TIPS } from './catalog'
import type { Assumption, Idea, PaletteTab, PromptEntry } from '../types'
import { ASSUME_DESCRIPTION, ASSUME_SCHEMA, ASSUME_SWITCH_KEY, ASSUME_TOOL_MATCH, ASSUME_TOOL_NAME, assumptionTexts, correctionPrompt } from './assumptions'
import { bar, kTokens, limitView, usdText, viewOf } from './meter'
import { blocksText, isTypedPrompt, mergePrompts, promptsFromTranscript } from './prompts'
import { finalReplies, previewLine, unfence } from './replies'
import { parseSyncStatus, syncView } from './sync'

const PANE = 'clickbar-palette'
// 폭이 이보다 좁으면 tasks·fork는 [palette]에서만 열고, 한도는 경고 수준일 때만, API 환산액은 숨긴다
const WIDE_COLUMNS = 110
// 팔레트 명령 줄의 열 폭(글자 칸): [/security-review]까지 한 줄에 들어가는 명령 열, [넣기] [고정] 버튼 열
const COL_COMMAND = 20
const COL_ROW_ACTIONS = 13
// [단축키] 탭의 키 열 폭: 가장 긴 "Ctrl+W · K · U"(14칸)에 두 칸 여유
const COL_KEY = 16
// band 맨 위 가로줄의 머리 글. 채팅과 band 사이 경계이고, 엔진의 [-]가 이 줄 끝에 붙는다
const BAND_RULE_LABEL = '── clickbar '
const NARROW_COLUMNS = 72
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
const assumptions = atom({ plugin: 'clickbar', key: 'assumptions' } as const, [])
const syncStatus = atom({ plugin: 'clickbar', key: 'syncStatus' } as const, null)

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
  $.ui.toast(result.isCopied ? `${what}을 복사했습니다 (${text.split('\n').length}줄)` : `복사 실패: ${result.reason}`)
}

async function copyLastReply($: EngineInterface, surface: RenderSurface) {
  const last = (await recentReplies($))[0]
  if (last === undefined) {
    $.ui.toast('복사할 답변이 아직 없습니다')
    return
  }
  await copyText($, last, surface, '마지막 답변')
}

// 아이디어 보관함은 프로젝트(세션의 루트 폴더)마다 따로 두고, 세션이 바뀌어도 남도록 $.store에 둔다
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
  // 짐작 개수는 band의 버튼이 이미 보여 주므로 상태 줄에는 보관함만 둔다
  const idea = (await read($, ideas)).length
  $.ui.status(idea === 0 ? undefined : `보관한 아이디어 ${idea}개 (⋯ 더보기 → 보관함)`)
}

// 사용자 턴으로 보낸다. 들어가지 못했으면 false. Claude가 일하는 중이면 지금 턴이 끝난 뒤 실행된다
async function submitAsUser($: EngineInterface, text: string) {
  const result = await $.prompt.submit({ text, asUser: true })
  if ('drop' in result && result.drop !== undefined) {
    $.ui.toast('보내지 못했습니다. 다른 mod나 훅이 막았습니다')
    return false
  }
  $.ui.toast('보냈습니다. Claude가 일하는 중이면 지금 작업이 끝난 뒤 실행됩니다')
  return true
}

// 보낸 뒤에만 보관함에서 지운다
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
  $.ui.toast(open === 0 ? '확인할 짐작이 남아 있지 않습니다' : `남은 짐작 ${open}개를 맞음으로 표시했습니다`)
}

async function clearAssumptions($: EngineInterface) {
  const n = (await read($, assumptions)).length
  await update($, assumptions, () => [])
  await refreshStatus($)
  $.ui.toast(n === 0 ? '비울 짐작이 없습니다' : `짐작 ${n}개를 목록에서 지웠습니다`)
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
  const failed = '그 질문 위치로 갈 수 없습니다. 압축 이전 대화이거나 화면에 그려지지 않은 질문입니다'
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
  $.ui.toast(`팁: /${tip.command} 명령으로 바로 할 수 있습니다. ${KO.get(tip.command) ?? ''} (끄려면 /tips off)`, { timeoutMs: 10000 })
}

async function sendCorrections($: EngineInterface) {
  const list = await read($, assumptions)
  const text = correctionPrompt(list)
  if (text === null) {
    $.ui.toast('틀렸다고 고른 짐작이 없습니다')
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
    $.ui.toast('보관할 글이 없습니다. /idea 뒤에 내용을 쓰거나, 입력창에 쓴 뒤 "지금 입력 보관"을 누르세요')
    return false
  }
  await loadIdeas($)
  const list = [{ text: trimmed, at: await $.clock.now() }, ...(await read($, ideas))].slice(0, IDEAS_MAX)
  await saveIdeas($, list)
  $.ui.toast(`아이디어를 보관했습니다 (이 프로젝트 ${list.length}개). ⋯ → 보관함에서 다시 꺼냅니다`)
  return true
}

// 입력창의 글을 보관한 뒤에만 입력창을 비운다. 저장이 실패하면 쓰던 글은 그대로 남는다
async function shelveDraft($: EngineInterface) {
  const draft = (await $.prompt.read()).text
  if (!(await addIdea($, draft))) return
  const cleared = await $.prompt.fill({ text: '', mode: 'replace' })
  if (!cleared.isFilled) $.ui.toast('보관은 했지만 입력창을 비우지 못했습니다')
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
      description: '명령 팔레트: 슬래시 명령을 한국어 설명과 함께 보고 클릭으로 실행',
      immediate: true,
    })
    // Claude가 일하는 중에도 끊지 않고 보관할 수 있도록 immediate로 둔다
    await $.command.register({
      name: 'idea',
      description: '아이디어 보관함: /idea 내용 → 이 프로젝트에 보관, /idea만 치면 보관함을 연다',
      argumentHint: '[보관할 내용]',
      immediate: true,
    })
    await $.command.register({
      name: 'tips',
      description: '명령 추천: 질문 문장에서 바로 쓸 수 있는 명령을 알려 준다. /tips off로 끄기',
      argumentHint: '[on|off]',
      immediate: true,
    })
    await $.command.register({
      name: 'assumptions',
      description: 'Claude 짐작 확인: Claude가 묻지 않고 짐작해서 정한 것 목록. /assumptions off로 끄기, on으로 켜기(다음 세션부터)',
      argumentHint: '[on|off]',
      immediate: true,
    })
    // 이 도구는 모든 세션의 모델에게 보인다. 사용자가 꺼 두었으면 등록하지 않는다
    if ((await $.store.get(ASSUME_SWITCH_KEY)) !== 'off') {
      await $.tool.register({ name: ASSUME_TOOL_NAME, description: ASSUME_DESCRIPTION, inputSchema: ASSUME_SCHEMA, isDeferred: false })
    }
    await loadFavorites($)
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
      $.ui.toast(arg === 'off' ? '짐작 기록을 껐습니다. 지금부터 기록하지 않고, 다음 세션부터는 도구도 모델에게 보이지 않습니다' : '짐작 기록을 켰습니다. 다음 세션부터 적용됩니다')
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
  on('turn.start', (_, e, next) => {
    turn = { tokens: latest.tokens, usd: latest.usd, files: new Map() }

    return next(e)
  })

  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    const result = await next(e)
    try {
      const edit = turn !== undefined && result.deny === undefined && result.isError !== true ? editDelta(result.result) : null
      if (turn !== undefined && edit !== null) addDelta(turn.files, edit.path, edit.delta)
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
    const tone = toneColor(view?.tone)
    const label =
      view === null
        ? '컨텍스트 —'
        : isNarrow
          ? `컨텍스트 ${view.percent}%`
          : isWide
            ? `컨텍스트 ${bar(view.percent)} ${view.percent}% (${view.basis === 'compact' ? '자동 압축까지' : '창 여유'} ${kTokens(view.left)})`
            : `컨텍스트 ${view.percent}% (${view.basis === 'compact' ? '압축까지' : '창 여유'} ${kTokens(view.left)})`
    // 넓거나 중간 폭이면 비율과 초기화 시각이 늘 보이고, 좁으면 70% 이상만 보인다
    const limits = stats.limits.map(l => limitView(l, now)).filter(l => !isNarrow || l.isHigh)
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
        <Box key="status" gap={1} flexWrap="wrap">
          <Text color={tone} dimColor={tone === undefined}>
            {label}
          </Text>
          {limits.length > 0 && <Text dimColor>│ 사용량</Text>}
          {limits.map(l => (
            <Text key={`band-limit-${l.kind}`} color={toneColor(l.tone)} dimColor={l.tone === 'normal'}>
              {`${l.tone === 'bad' ? '! ' : ''}${isWide ? l.text : l.short}`}
            </Text>
          ))}
          {isWide && stats.costUsd !== null && <Text dimColor>│ API 환산 {usdText(stats.costUsd)}</Text>}
        </Box>
        {/* 버튼 이름은 모두 영어다. 명령이 있는 버튼은 그 명령 이름 그대로다(palette=/palette, assumptions=/assumptions).
            용도별로 │로 묶는다: 컨텍스트 │ 대화 찾기·나누기 │ 답변 다루기 │ 도구. 나타났다 사라지는 assumptions는 맨 끝에 둬서 다른 버튼이 밀리지 않게 한다 */}
        <Box key="actions" gap={1} flexWrap="wrap">
          {act('band-compact', view?.tone === 'bad' ? 'compact now' : 'compact', () => void run($, 'compact'), view?.tone === 'bad' ? 'error' : 'suggestion')}
          {act('band-context', 'context', () => void run($, 'context'))}
          <Text key="band-sep-chat" dimColor>
            │
          </Text>
          {/* 지난 대화 전체 목록. 켜진 백그라운드 대화는 연결되고, 꺼진 대화는 다시 켜진다(Ctrl+A로 모든 폴더) */}
          {act('band-resume', 'resume', () => void run($, 'resume'))}
          {hasSessions && act('band-sessions', 'sessions', () => void run($, 'sessions'))}
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
    const tabsRow = (
      <Box key="tabs" gap={1}>
        {(
          [
            ['commands', '명령'],
            ['keys', '단축키'],
            ['prompts', '내 질문'],
            ['replies', '답변'],
            ['ideas', '보관함'],
            ['assume', '짐작'],
          ] as const
        ).map(([id, title]) =>
          id === tab ? (
            <Button key={`tab-${id}`} variant="primary" label={title} onPress={() => void showTab($, id)} />
          ) : (
            <Button key={`tab-${id}`} plain label={`[${title}]`} onPress={() => void showTab($, id)}>
              <Text color="suggestion">[{title}]</Text>
            </Button>
          ),
        )}
      </Box>
    )
    // band에는 짧게만 보이는 사용량 한도를 여기서 자세히 보여 준다(남은 비율, 초기화 시각과 남은 시간)
    const now = await $.clock.now()
    const limitDetails = (await read($, usage)).limits.map(l => limitView(l, now))
    const tabs = (
      <Box key="tabs-area" flexDirection="column">
        <Box key="pane-head" gap={1}>
          {tabsRow}
          <Button key="pane-close" plain role="dismiss" label="[닫기]" onPress={() => void $.ui.close({ id: PANE })}>
            <Text color="suggestion">[닫기]</Text>
          </Button>
          <Text dimColor>Esc · Ctrl+X X</Text>
        </Box>
        {/* 한도는 한 줄에 모은다. 구분 기호 없이 빈칸으로 띄워, 좁아서 꺾여도 줄 앞에 기호가 남지 않는다 */}
        {limitDetails.length > 0 && (
          <Box key="limit-details" columnGap={3} flexWrap="wrap">
            {limitDetails.map(l => (
              <Text key={`limit-detail-${l.kind}`} color={l.tone === 'bad' ? 'error' : l.tone === 'warn' ? 'warning' : undefined} dimColor={l.tone === 'normal'}>
                {l.detail}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )

    if (tab === 'keys') {
      // 키는 줄지 않는 열에 기본색으로(파란 [괄호]는 버튼에만 쓴다), 설명은 그 옆 열 안에서만 꺾인다. [/명령]은 줄 끝에 둔다
      const keyGroups = KEY_GROUPS.map(group => ({
        title: group.title,
        entries: group.entries.filter(entry => q === '' || entry.keys.toLowerCase().includes(q) || entry.ko.toLowerCase().includes(q)),
      })).filter(group => group.entries.length > 0)

      return (
        <Box flexDirection="column" gap={1}>
          {tabs}
          <Text dimColor>키는 직접 누른다 · 같은 일을 하는 명령이 있으면 줄 끝 [/명령]으로 바로 실행한다</Text>
          {Input !== undefined && (
            <Input key="search" placeholder="키나 설명으로 검색" value={raw} autoFocus onInput={(v: string) => void update($, query, () => v)} onSubmit={(v: string) => void update($, query, () => v)} />
          )}
          {keyGroups.length === 0 && <Text dimColor>찾는 단축키가 없습니다</Text>}
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
          <Text dimColor>내가 보낸 질문, 최신이 위. [이동]은 대화에서 그 질문 위치로 스크롤하고, [입력창에]는 입력창에 다시 넣는다</Text>
          {list.length === 0 && <Text dimColor>아직 기록된 질문이 없습니다. 이 기능을 켠 뒤에 보낸 질문부터 쌓입니다</Text>}
          {list.map((p, i) => (
            <Box key={`prompt-${p.uuid}`} gap={1}>
              {act(`prompt-jump-${i}`, '이동', () => void jumpTo($, p))}
              {act(`prompt-fill-${i}`, '입력창에', () => void $.prompt.fill({ text: p.text, mode: 'insert' }).then(filled => reportFill($, filled)))}
              <Text dimColor>{p.at > 0 ? whenText(p.at, now) : '--:--'}</Text>
              <Text>{p.text}</Text>
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
          <Text dimColor>Claude가 묻지 않고 짐작해서 정한 것들이다. 틀린 것만 "틀림"을 누르고 고칠 내용을 쓴 뒤 보내면 그 부분만 고친다</Text>
          <Box key="assume-head" gap={1}>
            {act('assume-send', `틀린 짐작 고쳐 달라고 보내기 (${wrong})`, () => void sendCorrections($), wrong > 0 ? 'warning' : 'suggestion')}
            {act('assume-all-right', '남은 것 모두 맞음', () => void markAllRight($))}
            {act('assume-clear', '목록 비우기', () => void clearAssumptions($))}
          </Box>
          {list.length === 0 && <Text dimColor>아직 기록된 짐작이 없습니다. 끄려면 /assumptions off</Text>}
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
                  placeholder="대신 어떻게? (비우면 다시 판단해 달라고 보낸다)"
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
          <Box key="ideas-head" gap={1}>
            {act('idea-shelve', '+ 지금 입력 보관', () => void shelveDraft($))}
            <Text dimColor>이 프로젝트 전용 · [보내기]는 바로 보내고 [입력창에]는 넣기만 한다 · /idea 내용 으로도 보관</Text>
          </Box>
          {Input !== undefined && (
            <Input
              key="idea-new"
              placeholder="새 아이디어를 쓰고 Enter로 보관"
              value={draftIdea}
              onInput={(v: string) => void update($, ideaDraft, () => v)}
              onSubmit={(v: string) => void addIdea($, v).then(ok => (ok ? update($, ideaDraft, () => '') : undefined))}
            />
          )}
          {list.length === 0 && <Text dimColor>보관한 아이디어가 없습니다</Text>}
          {list.map((idea, i) => (
            <Box key={`idea-${i}`} gap={1}>
              {act(`idea-send-${i}`, '보내기', () => void sendIdea($, idea))}
              {act(`idea-use-${i}`, '입력창에', () => void $.prompt.fill({ text: idea.text, mode: 'insert' }).then(filled => reportFill($, filled)))}
              {act(`idea-del-${i}`, '삭제', () => void removeIdea($, idea))}
              <Text dimColor>{whenText(idea.at, now)}</Text>
              <Text>{idea.text}</Text>
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
          <Box key="replies-head" gap={1}>
            <Text dimColor>최근 답변 {list.length}개, 최신이 위</Text>
            {act('replies-refresh', '다시 읽기', () => void showTab($, 'replies'))}
          </Box>
          {list.length === 0 && <Text dimColor>아직 답변이 없습니다</Text>}
          {list.map((text, i) => (
            <Box key={`reply-${i}`} gap={1}>
              {act(`reply-copy-${i}`, 'copy', press => void copyText($, text, press.surface, `${i + 1}번째 최근 답변`))}
              <Text dimColor>{i + 1}</Text>
              <Text>{previewLine(text)}</Text>
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
        <Text dimColor>[/명령] 실행 · [넣기] 입력창에 넣기(인자를 붙일 때) · [고정] 맨 위로 · [해제] 고정 풀기</Text>
        {Input !== undefined && (
          <Input key="search" placeholder="명령 이름이나 설명으로 검색" value={raw} autoFocus onInput={(v: string) => void update($, query, () => v)} onSubmit={(v: string) => void update($, query, () => v)} />
        )}
        {installed.length === 0 && <Text dimColor>명령 목록을 읽는 중입니다…</Text>}
        {section('fav', '고정한 명령', favs.filter(n => byName.has(n) && matches(n)))}
        {GROUPS.map((group, i) => section(`g${i}`, group.title, group.entries.map(x => x.name).filter(n => byName.has(n) && matches(n) && unpinned(n))))}
        {/* 한국어 설명을 아직 달지 않은 명령도 숨기지 않는다. 설명은 엔진이 주는 원문 그대로다 */}
        {section('etc', `그 밖의 명령 ${others.filter(unpinned).length}개 (플러그인·스킬 포함, 설명은 원문)`, others.filter(unpinned))}
      </Box>
    )
  })
}
