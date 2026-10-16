export type SessionStatus = 'working' | 'waiting' | 'idle' | 'ended'

/** 세션 하나가 자기 파일에 쓰는 상태. at은 마지막으로 쓴 시각(1분마다 갱신), changedAt은 상태가 바뀐 시각 */
export type SessionRecord = {
  id: string
  root: string
  status: SessionStatus
  prompt: string
  changedAt: number
  at: number
}

/**
 * `claude agents --json --all`의 세션 하나. shortId는 백그라운드 세션의 짧은 id(claude stop·attach가 받는 값), 없으면 ''.
 * isLive는 프로세스가 떠 있는지(pid가 있음). 멈춘 백그라운드 세션은 --all에만 나오고 pid가 없다
 */
export type AgentRow = { sessionId: string; shortId: string; name: string; cwd: string; state: string; kind: string; isSelf: boolean; isLive: boolean }

/** 켜진 대화는 background·interactive, 꺼진 대화(기록만 남음)는 off. 화면에서는 off를 "유휴"라고 쓴다 */
export type SessionKind = 'background' | 'interactive' | 'off'

/**
 * 세션 패널의 한 줄: 켜진 대화와 꺼진 대화를 함께 담는다.
 * at은 마지막 활동 시각(기록 파일 수정 시각, ms). reopen은 꺼진 대화를 다시 켜는 방법:
 * attach(멈춘 백그라운드 세션, 백그라운드로 다시 켬), resume(기록만 남은 대화, 포그라운드로 다시 엶), 켜진 대화는 ''
 */
export type SessionItem = {
  sessionId: string
  shortId: string
  name: string
  cwd: string
  state: string
  kind: SessionKind
  isSelf: boolean
  at: number
  reopen: 'attach' | 'resume' | ''
}

export type ViewMode = 'folder' | 'date'
export type OnOffFilter = 'all' | 'on' | 'off'
/** 세션 패널 보기 설정. 상태 필터는 보기(폴더별·날짜별)마다 따로 기억한다 */
export type SessionView = { mode: ViewMode; filter: Record<ViewMode, OnOffFilter> }

/** 기록 파일 끝에서 읽은 제목·폴더. m·s는 읽을 때의 수정 시각·크기(바뀌면 다시 읽는다), k는 제목 종류 */
export type TitleEntry = { m: number; s: number; t: string; k: 'custom' | 'ai' | ''; c: string }

declare module 'claude-code' {
  interface PluginState {
    'session-tracker': {
      /** 같은 폴더의 살아 있는 다른 세션들 */
      peers: SessionRecord[]
      /** 이 PC에서 켜져 있는 세션(claude agents에서 pid가 있는 것) */
      agents: AgentRow[]
      /** 세션 패널에 그릴 켜진 대화와 꺼진 대화 */
      sessions: SessionItem[]
      /** 세션 패널 보기 설정($.store의 view) */
      view: SessionView
      /** 고정한 대화의 sessionId, 고정한 순서대로(먼저 고정한 것이 위, $.store의 pins) */
      pins: string[]
      /** 보관한 대화의 sessionId($.store의 archived) */
      archived: string[]
      /** 보관함을 보고 있는지 */
      showArchived: boolean
      /** [관리]를 연 대화의 sessionId(그 줄 아래에 고정·보관·끄기가 열림), 아니면 '' */
      managing: string
      /** 꺼진 대화를 모두 펼친 묶음의 key */
      expanded: string[]
      /** 패널 아래 설명(범례)을 펼쳤는지 */
      showLegend: boolean
      /** 이 세션에서 돌고 있는 서브에이전트 수 */
      subagents: number
      /** 마지막으로 목록을 읽은 시각, 아직이면 0 */
      readAt: number
      /** 이 대화의 세션 종류: background, interactive, 모르면 빈 문자열 */
      selfKind: string
      /** 세션 패널에서 이름을 고치는 중인 세션의 sessionId, 아니면 '' */
      renaming: string
      /** 이름 입력칸의 글 */
      renameDraft: string
      /** [끄기]를 한 번 누른 세션의 sessionId. 한 번 더 누르면 끈다. 아니면 '' */
      stopArmed: string
      /** orca 명령을 쓸 수 있는지. 없으면(일반 터미널) [이동]·다른 대화 이름 고치기 대신 /resume·명령 복사를 보인다 */
      orcaReady: boolean
      /** Orca 없이 [열기]·[이동]을 누른 대화의 sessionId(그 줄 아래에 여기서 열기·명령 복사가 열림), 아니면 '' */
      opening: string
      /** 새 Orca 탭에서 여는 중인 대화의 sessionId. 그 줄의 [이동]·[열기] 자리에 "여는 중…"을 보이고 다시 누르지 않게 한다 */
      launching: string[]
    }
  }
}
