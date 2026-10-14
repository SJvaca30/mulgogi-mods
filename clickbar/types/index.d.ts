export type Meter = {
  /** 마지막 API 응답이 보고한 입력 토큰. 새 세션이나 압축 직후에는 null */
  tokens: number | null
  /** 모델의 컨텍스트 창 크기 */
  window: number
  /** 자동 압축이 시작되는 토큰 수. 자동 압축이 꺼졌거나 아직 모르면 null */
  threshold: number | null
}

export type CommandRow = { name: string; description: string }

/** 요금제 사용 한도 창 하나. kind는 five_hour, seven_day, spend_limit */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Usage = {
  /** 구독 계정이 아니거나 첫 응답 전이면 빈 배열 */
  limits: Limit[]
  /** 이 세션의 API 단가 환산액(/cost와 같은 값). 모르면 null */
  costUsd: number | null
}

export type PaletteTab = 'commands' | 'keys' | 'replies' | 'ideas' | 'assume' | 'prompts'

/** 내가 보낸 질문 하나. uuid는 기록 파일의 행 id이자 화면 행의 id, at은 밀리초 */
export type PromptEntry = { uuid: string; at: number; text: string }

/**
 * Claude가 log_assumption 도구로 남긴 가정 하나.
 * status: open(아직 안 봄), right, wrong, sent(고쳐 달라고 보냄). agent는 서브에이전트 id, 메인이면 ''
 */
export type Assumption = { id: string; text: string; at: number; status: 'open' | 'right' | 'wrong' | 'sent'; fix: string; agent: string }

/** 아이디어 보관함의 한 줄. at은 보관한 시각($.clock.now()의 밀리초) */
export type Idea = { text: string; at: number }

/**
 * CCsetting sync.ps1이 ~/.claude/sync.status.json에 남기는 마지막 전체 동기화 결과.
 * result: ok, held(비밀값으로 보이는 줄이 있는 파일만 커밋에서 뺌), failed. at은 ISO 시각
 */
export type SyncStatus = { at: string; result: 'ok' | 'held' | 'failed'; held: string[]; message: string }

declare module 'claude-code' {
  interface PluginState {
    clickbar: {
      meter: Meter | null
      usage: Usage
      commands: CommandRow[]
      query: string
      favorites: string[]
      paletteTab: PaletteTab
      /** 최근 답변 글, 최신이 먼저. 답변 탭을 열 때 다시 읽는다 */
      replies: string[]
      /** 이 프로젝트의 아이디어 보관함, 최신이 먼저. $.store에 프로젝트 경로별로 저장한다 */
      ideas: Idea[]
      /** 보관함 탭의 새 아이디어 입력칸 */
      ideaDraft: string
      /** 이 세션에서 기록된 가정, 최신이 먼저 */
      assumptions: Assumption[]
      /** 이 세션에서 보낸 질문, 오래된 것이 먼저 */
      prompts: PromptEntry[]
      /** 마지막 전체 동기화 결과. 상태 파일이 없거나 읽지 못하면 null */
      syncStatus: SyncStatus | null
    }
  }
}
