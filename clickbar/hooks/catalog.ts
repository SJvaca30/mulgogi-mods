// 내장 명령의 한국어 설명. 출처: https://code.claude.com/docs/en/commands (2026-10-07 확인)
// 설치된 Claude Code에 없는 명령은 팔레트에 나오지 않는다.

export type Entry = { name: string; ko: string }

export const GROUPS: { title: string; entries: Entry[] }[] = [
  {
    title: '컨텍스트',
    entries: [
      { name: 'compact', ko: '대화를 요약해 컨텍스트 공간을 확보합니다. 요약에 남길 내용을 함께 지정할 수 있습니다' },
      { name: 'context', ko: '컨텍스트 사용량을 항목별로 확인합니다' },
      { name: 'clear', ko: '빈 컨텍스트로 새 대화를 시작합니다. 이전 대화는 /resume으로 다시 열 수 있습니다' },
      { name: 'btw', ko: '대화 기록에 남기지 않고 별도 질문을 합니다. 도구 없이 한 번만 답합니다' },
      { name: 'autocompact', ko: '자동 압축을 시작할 컨텍스트 사용량을 설정합니다' },
      { name: 'focus', ko: '집중 보기를 켜고 끕니다. 내 질문·요약·답변만 표시합니다' },
    ],
  },
  // 출처: Claude Code 2.1.296 본체의 명령 설명문 (2026-10-14 확인)
  {
    title: '대화 · 세션',
    entries: [
      { name: 'resume', ko: '이전 대화를 선택해 엽니다. 실행 중인 백그라운드 대화는 연결하고, 종료된 대화는 다시 시작합니다 (Ctrl+A: 모든 폴더)' },
      { name: 'rename', ko: '이 대화의 이름을 변경합니다' },
      { name: 'background', ko: '이 대화를 백그라운드 세션으로 전환하고 터미널을 비웁니다 (/bg)' },
      { name: 'stop', ko: '백그라운드 대화를 종료합니다. 기록과 worktree는 유지됩니다 (백그라운드 세션 전용)' },
      { name: 'exit', ko: '포그라운드 대화는 종료하고, 백그라운드 대화는 화면만 닫습니다' },
      { name: 'fork', ko: '현재 대화를 백그라운드 세션으로 복제하고, 지금 대화는 그대로 이어 갑니다' },
      { name: 'branch', ko: '현재 시점에서 갈라진 사본으로 전환합니다. 원본은 /resume으로 다시 열 수 있습니다' },
      { name: 'subtask', ko: '대화 전체 맥락을 전달한 서브에이전트를 실행합니다. 결과는 이 대화로 돌아옵니다' },
      { name: 'rewind', ko: '대화나 코드를 이전 메시지 시점으로 되돌립니다 (Esc 두 번)' },
      { name: 'list-agents', ko: '메시지를 보낼 수 있는 서브에이전트·팀원·다른 Claude 세션을 확인합니다 (/peers)' },
      { name: 'cd', ko: '이 대화의 작업 폴더를 변경합니다. 이동할 경로를 함께 입력합니다' },
    ],
  },
  {
    title: '작업 · 변경 확인',
    entries: [
      { name: 'tasks', ko: '백그라운드에서 실행 중인 서브에이전트·셸 명령을 확인하고 중지합니다' },
      { name: 'workflows', ko: '실행 중이거나 완료된 워크플로를 확인합니다' },
      { name: 'loops', ko: '반복 실행(/loop)을 확인·생성·삭제합니다' },
      { name: 'goal', ko: 'Claude가 작업을 마치기 전에 확인할 목표를 설정합니다. clear로 해제합니다' },
      { name: 'diff', ko: 'Claude가 수정한 내용을 포함해 작업 트리의 변경 사항을 검토합니다' },
      { name: 'copy', ko: '마지막 답변을 클립보드에 복사합니다. /copy 2는 그 이전 답변을 복사합니다' },
      { name: 'export', ko: '대화를 텍스트 파일이나 클립보드로 내보냅니다' },
      { name: 'recap', ko: '이 세션을 한 줄로 요약합니다' },
      { name: 'review', ko: '현재 변경 사항이나 PR을 리뷰합니다' },
      { name: 'security-review', ko: '현재 브랜치 변경의 보안 취약점을 검토합니다' },
    ],
  },
  {
    title: '모델 · 설정',
    entries: [
      { name: 'model', ko: '모델을 변경합니다. 인자 없이 실행하면 선택 목록을 표시합니다' },
      { name: 'effort', ko: '추론 강도를 변경합니다: low ~ max, auto' },
      { name: 'advisor', ko: '중요한 시점에 더 강력한 모델에게 조언을 구하도록 합니다' },
      { name: 'plan', ko: '코드를 수정하기 전에 계획부터 세우는 plan 모드로 전환합니다' },
      { name: 'permissions', ko: '도구 허용·확인·거부 규칙을 관리합니다' },
      { name: 'config', ko: '설정 화면을 엽니다 (테마, 모델 등)' },
      { name: 'memory', ko: 'CLAUDE.md 같은 메모리 파일을 편집합니다' },
      { name: 'hooks', ko: '도구 이벤트에 연결된 hook 설정을 확인합니다' },
      { name: 'tui', ko: '화면 렌더러를 변경합니다 (default / fullscreen)' },
      { name: 'theme', ko: '테마를 변경합니다' },
      { name: 'color', ko: '이 대화의 입력창 색을 지정합니다' },
    ],
  },
  {
    title: '플러그인 · 스킬 · MCP',
    entries: [
      { name: 'plugin', ko: '플러그인을 설치·관리합니다 (/plugins, /marketplace)' },
      { name: 'reload-plugins', ko: '변경된 플러그인과 mod를 현재 대화에 적용합니다' },
      { name: 'skills', ko: '사용할 수 있는 스킬 목록을 확인합니다' },
      { name: 'reload-skills', ko: '대화 중 추가·수정한 스킬을 다시 불러옵니다' },
      { name: 'skill-doctor', ko: '사용하지 않으면서 컨텍스트만 차지하는 스킬을 찾아 표시합니다' },
      { name: 'mcp', ko: 'MCP 서버 연결을 관리합니다' },
    ],
  },
  {
    title: '상태 · 도움말',
    entries: [
      { name: 'usage', ko: '세션 비용과 플랜 사용 한도를 확인합니다' },
      { name: 'status', ko: '버전·모델·계정·연결 상태를 확인합니다' },
      { name: 'version', ko: '이 대화의 Claude Code 버전을 확인합니다' },
      { name: 'insights', ko: 'Claude Code 사용 기록을 분석해 보고서를 만듭니다' },
      { name: 'keybindings', ko: '키보드 단축키 설정 파일을 엽니다' },
      { name: 'doctor', ko: '설치·설정 문제를 진단합니다' },
      { name: 'powerup', ko: '짧은 실습 강좌로 Claude Code 기능을 익힙니다' },
      { name: 'help', ko: '도움말과 명령 목록을 확인합니다' },
    ],
  },
  {
    title: '직접 만든 mod',
    entries: [
      { name: 'sessions', ko: '이 PC의 모든 대화를 폴더·날짜별로 조회하고 이동·고정·보관합니다' },
      { name: 'sessions-here', ko: '같은 폴더에서 실행 중인 다른 세션을 확인합니다' },
      { name: 'sync', ko: '설정 저장소(CCsetting)와 메모리·mod·설정을 즉시 동기화합니다' },
      { name: 'idea', ko: '아이디어를 프로젝트별로 저장하거나 저장한 아이디어 목록을 엽니다' },
      { name: 'assumptions', ko: 'Claude가 확인 없이 정한 가정을 검토합니다' },
      { name: 'flow', ko: '이 대화의 서브에이전트를 트리 형태로 확인합니다. 다시 입력하면 닫힙니다' },
    ],
  },
  // 설치한 스킬과 플러그인 명령. 팔레트에 보이는 설명만 바꾸고, Claude가 스킬을 고를 때 읽는 SKILL.md의 설명은 그대로다.
  // / 메뉴의 한국어 설명(command.describe)도 엔진 내장 명령에만 쓰므로 이 묶음은 영향이 없다. 설치되지 않은 것은 보이지 않는다.
  // "직접 불러야 한다"는 SKILL.md에 disable-model-invocation: true가 있어 Claude가 알아서 쓰지 않는 스킬이다(2026-10-15 확인)
  {
    title: '스킬 · 개발 방법',
    entries: [
      { name: 'tdd', ko: '테스트를 먼저 작성하고 통과시키는 순서(레드-그린-리팩터)로 기능을 개발하거나 버그를 수정합니다' },
      { name: 'diagnosing-bugs', ko: '까다로운 버그나 성능 저하를 재현하고 가설을 검증해 원인을 찾습니다' },
      { name: 'codebase-design', ko: '작은 인터페이스 뒤에 많은 일을 숨기는 깊은 모듈 관점으로 모듈 경계와 인터페이스를 설계합니다' },
      { name: 'domain-modeling', ko: '도메인 용어를 정리해 CONTEXT.md(용어집)와 ADR(결정 기록)을 작성·수정합니다' },
      { name: 'grilling', ko: '계획·결정·아이디어를 집요하게 질문해 빈틈을 찾습니다' },
      { name: 'grill-with-docs', ko: '집요한 질문으로 계획·설계를 다듬으면서 ADR과 용어집도 함께 작성합니다. 직접 실행해야 합니다' },
      { name: 'handoff', ko: '지금 대화를 다른 에이전트가 이어받을 인계 문서로 정리합니다. 직접 실행해야 합니다' },
      { name: 'setup-matt-pocock-skills', ko: '개발 스킬을 처음 쓰기 전에 이 저장소의 이슈 트래커·라벨·문서 구조를 설정합니다. 직접 실행해야 합니다' },
      { name: 'shadcn-lint', ko: 'Tailwind v4 프로젝트의 UI 코드가 디자인 시스템 규칙에 맞는지 @shadcn/lint로 검사합니다' },
      { name: 'skill-creator', ko: '스킬을 만들거나 개선하고, 평가를 실행해 성능과 호출 정확도를 높입니다' },
    ],
  },
  {
    title: '스킬 · 문서와 파일',
    entries: [
      { name: 'docs', ko: '공유와 댓글이 가능한 claude.ai 문서를 작성·수정합니다. 보고서·제안서 같은 문서의 기본 형식입니다' },
      { name: 'docx', ko: 'Word 문서(.docx·.dotx)를 작성·조회·수정합니다' },
      { name: 'pdf', ko: 'PDF의 글·표 추출, 병합·분할, 생성, 양식 입력을 처리합니다' },
      { name: 'pptx', ko: 'PowerPoint 파일(.pptx·.potx)을 작성·조회·수정합니다' },
      { name: 'xlsx', ko: '엑셀·CSV 같은 표 파일을 편집·정리하거나 새로 만듭니다' },
      { name: 'google-workspace', ko: 'Google Docs·Sheets·Slides 파일을 만들거나 수정할 때 먼저 참고하는 안내입니다' },
    ],
  },
  {
    title: '스킬 · 그림과 웹',
    entries: [
      { name: 'diagram-design:diagram-design', ko: '아키텍처·흐름도·시퀀스·ERD·간트 등 여러 다이어그램을 HTML·SVG·PNG로 그립니다' },
      { name: 'diagram-design:import-mermaid', ko: 'Mermaid 코드를 원하는 형식·크기·상세도로 다시 그립니다' },
      { name: 'diagram-design:import-drawio', ko: 'draw.io 파일을 원하는 형식·크기·상세도로 다시 그립니다' },
      { name: 'diagram-design:import-excalidraw', ko: 'Excalidraw 보드를 원하는 형식·크기·상세도로 다시 그립니다' },
      { name: 'diagram-design:export-diagram', ko: '다이어그램 HTML 파일을 같은 폴더에 .svg와 .png로 내보냅니다' },
      { name: 'diagram-design:profile', ko: '고객사별 다이어그램 프로필을 저장·불러오기·확인·수정·초기화·삭제합니다' },
      { name: 'diagram-design:doctor', ko: '다이어그램 도구의 실행 환경을 한 번에 점검합니다' },
      { name: 'insane-search:insane-search', ko: '차단된 사이트·SNS·영상 자막 같은 웹 콘텐츠를 가능한 방법을 찾아 가져옵니다' },
    ],
  },
  {
    title: '스킬 · Orca',
    entries: [
      { name: 'orca-cli', ko: 'Orca의 워크트리·터미널·내장 브라우저·자동화를 orca 명령으로 다룹니다' },
      { name: 'orchestration', ko: '여러 Orca 작업자에게 작업을 나눠 맡기고 메시지·완료 보고를 조율합니다' },
      { name: 'computer-use', ko: '화면에 보이는 앱 창을 orca computer로 클릭·입력·메뉴·스크린샷 등으로 조작합니다' },
    ],
  },
  {
    title: '스킬 · 그 밖',
    entries: [
      { name: 'learn', ko: '작업 대행보다 원리 이해가 필요할 때 설명과 퀴즈로 학습을 돕습니다' },
      { name: 'morning', ko: '아침 브리핑을 HTML 페이지로 만들거나 평일 반복 작업으로 설정합니다' },
      { name: 'import-memory', ko: '다른 AI 비서에서 내보낸 메모리를 Claude 메모리로 가져옵니다' },
    ],
  },
]

export const DEFAULT_FAVORITES = ['compact', 'context', 'tasks', 'fork', 'rewind', 'btw']

// 팔레트 버튼이 바로 실행하지 않고 입력창에 넣기만 하는 명령.
// btw·cd는 인자가 있어야 하고, stop·exit는 잘못 누르면 하던 일이 멈추므로 Enter로 한 번 더 확인받는다
export const NEEDS_ARGS = new Set(['btw', 'cd', 'stop', 'exit'])

export const KO = new Map(GROUPS.flatMap(group => group.entries.map(entry => [entry.name, entry.ko] as const)))

// 기본 단축키(~/.claude/keybindings.json이 없어 기본값 그대로다).
// 출처: https://code.claude.com/docs/en/interactive-mode (2026-10-09 확인, macOS 키는 2026-10-14 확인). 목록 초안은 사본 세션의 v0.3 시안에서 가져왔다.
// mod는 키를 대신 눌러 줄 수 없다. 그 키와 같은 일을 하는 명령이 있을 때만 command를 단다.
// keys·ko는 Windows 기준이다. macOS·Linux에서 키나 설명이 다르면 mac·linux에 다른 것만 적는다
export type Platform = 'windows' | 'mac' | 'linux'
type KeyText = { keys?: string; ko?: string }
export type KeyEntry = { keys: string; ko: string; command?: string; mac?: KeyText; linux?: KeyText }

// 엔진은 OS를 알려 주지 않아 환경 변수로 가린다. Windows에는 늘 OS=Windows_NT가, macOS에는 __CF_USER_TEXT_ENCODING이 있다
export function platformOf(env: { os?: string; cfEncoding?: string }): Platform {
  if (env.os === 'Windows_NT') return 'windows'

  return env.cfEncoding !== undefined ? 'mac' : 'linux'
}

// 이 OS에서 보일 단축키 목록. mac·linux에 적은 것만 바꾸고 나머지는 그대로 둔다
export function keyGroupsFor(platform: Platform) {
  return KEY_GROUPS.map(group => ({
    title: group.title,
    entries: group.entries.map(({ mac, linux, ...entry }) => ({ ...entry, ...(platform === 'mac' ? mac : platform === 'linux' ? linux : undefined) })),
  }))
}

export const KEY_GROUPS: { title: string; entries: KeyEntry[] }[] = [
  // 출처: 엔진 타입 2.1.295의 AbovePrompt 설명("collapses it (ctrl+x ctrl+a, [-]) or focuses it (a click, ctrl+x tab)").
  // Tab·Enter로 버튼을 고르는 흐름은 AI LABS 영상(Prompt Enhancer 시연)에서 확인했다
  {
    title: 'clickbar 줄을 키보드로 쓰기 (클릭이 안 될 때)',
    entries: [
      { keys: 'Ctrl+X Tab', ko: '입력창 위 clickbar 줄로 이동합니다. Tab으로 버튼을 옮기고 Enter로 실행합니다' },
      { keys: 'Ctrl+X Ctrl+A', ko: 'clickbar 줄을 접거나 펼칩니다 (줄 오른쪽 [-]와 같습니다)' },
    ],
  },
  {
    title: 'Claude가 일하는 중',
    entries: [
      { keys: 'Esc', ko: 'Claude를 멈추고 방향을 바꿉니다. 진행한 작업은 유지되며, 열린 대화상자는 닫힙니다' },
      { keys: 'Ctrl+B', ko: '실행 중인 Bash 명령과 에이전트를 백그라운드로 보냅니다' },
      { keys: 'Ctrl+X Ctrl+K', ko: '백그라운드 서브에이전트를 모두 멈춥니다 (3초 안에 두 번)' },
      { keys: 'Ctrl+Enter', ko: '대기 중인 메시지를 즉시 보냅니다 (Ctrl+X Ctrl+S도 같습니다. 터미널이 Ctrl+Enter를 Enter로 넘기면 Ctrl+X Ctrl+S를 사용합니다)' },
      { keys: 'Ctrl+C', ko: '작업 중이면 중단하고, 아니면 입력을 지웁니다. 빈 입력창에서 한 번 더 누르면 종료합니다' },
    ],
  },
  {
    title: '되돌리기 · 이전 입력',
    entries: [
      { keys: 'Esc Esc', ko: '입력이 있으면 지우고(↑로 복원), 비어 있으면 되감기 메뉴를 엽니다', command: 'rewind' },
      { keys: 'Ctrl+R', ko: '이전에 보낸 질문을 검색합니다' },
      { keys: '↑ / ↓', ko: '이전에 보낸 질문을 차례로 불러옵니다' },
      { keys: 'Ctrl+S', ko: '작성 중인 글을 임시 보관하고 입력창을 비웁니다. 빈 입력창에서 다시 누르면 복원합니다' },
      { keys: 'Ctrl+_', ko: '입력 편집을 한 단계 되돌립니다' },
    ],
  },
  {
    title: '모드 · 모델',
    entries: [
      {
        keys: 'Shift+Tab',
        ko: '권한 모드를 순서대로 전환합니다: Manual → acceptEdits → plan … (Windows에서 안 되면 Alt+M)',
        mac: { ko: '권한 모드를 순서대로 전환합니다: Manual → acceptEdits → plan …' },
        linux: { ko: '권한 모드를 순서대로 전환합니다: Manual → acceptEdits → plan …' },
      },
      // macOS의 Option 조합은 터미널이 Option을 Alt(Meta)로 넘겨야 된다. Option+T만 그 설정 없이 된다(공식 문서)
      {
        keys: 'Alt+P',
        ko: '입력을 지우지 않고 모델을 변경합니다',
        command: 'model',
        mac: { keys: 'Option+P', ko: '입력을 지우지 않고 모델을 변경합니다. 터미널이 Option을 Alt로 전달해야 합니다(Orca: 설정 → Terminal → Option as Alt)' },
      },
      {
        keys: 'Alt+T',
        ko: '확장 사고를 켜고 끕니다. Opus 5.5 등은 항상 켜져 있어 효과가 없습니다',
        mac: { keys: 'Option+T', ko: '확장 사고를 켜고 끕니다. Opus 5.5 등은 항상 켜져 있어 효과가 없습니다. Option 설정 없이도 동작합니다' },
      },
      // 단가 출처: https://platform.claude.com/docs/en/about-claude/pricing (2026-10-08 확인)
      { keys: 'Alt+O', ko: 'fast 모드를 켜고 끕니다. Opus 5.5에서 토큰 단가가 2배입니다 (입력·출력 $8·$40, 보통 $4·$20)', command: 'fast', mac: { keys: 'Option+O' } },
    ],
  },
  {
    title: '화면 보기',
    entries: [
      { keys: 'Ctrl+O', ko: '대화 기록 뷰어를 엽니다. 도구 내역과 답변별 시각·모델을 표시합니다' },
      { keys: 'Ctrl+T', ko: 'Claude의 할 일 목록을 표시하거나 숨깁니다' },
      { keys: '?', ko: '빈 입력창에서 누르면 단축키 도움말을 엽니다' },
      { keys: 'Ctrl+L', ko: '화면이 깨졌을 때 다시 그립니다' },
    ],
  },
  {
    title: '대화 기록 뷰어 안에서 (Ctrl+O 다음)',
    entries: [
      { keys: '{ / }', ko: '이전 · 다음 내 질문으로 이동합니다' },
      { keys: '[', ko: '대화 전체를 터미널 스크롤백에 출력해 터미널 검색으로 찾을 수 있게 합니다' },
      { keys: 'v', ko: '대화를 임시 파일로 저장해 편집기로 엽니다' },
      { keys: 'q', ko: '뷰어를 닫습니다 (Esc도 같습니다)' },
    ],
  },
  {
    title: '입력',
    entries: [
      { keys: 'Ctrl+G', ko: '입력을 기본 텍스트 편집기에서 편집합니다' },
      { keys: 'Alt+V', ko: '클립보드 이미지를 붙여 넣습니다', mac: { keys: 'Ctrl+V', ko: '클립보드 이미지를 붙여 넣습니다 (iTerm2는 Cmd+V)' }, linux: { keys: 'Ctrl+V' } },
      { keys: '!', ko: '맨 앞에 입력하면 셸 모드로 전환합니다. 명령을 바로 실행하고 결과를 대화에 추가합니다' },
      { keys: '@', ko: '파일 경로를 자동 완성합니다' },
      { keys: 'Ctrl+W · K · U', ko: '앞 단어 / 줄 끝까지 / 줄 처음까지 지웁니다. Ctrl+Y로 지운 글을 붙여 넣습니다' },
    ],
  },
]

// 질문 문장에서 내장 명령으로 바로 할 수 있는 일을 알아보고 한 번만 알려 준다(command-hub의 방식).
// 잘못 알아보면 귀찮기만 하므로, 명령이 하는 일과 거의 같은 말만 넣는다.
export type Tip = { command: string; pattern: RegExp }

export const TIPS: Tip[] = [
  { command: 'compact', pattern: /(컨텍스트|대화).{0,6}(압축|줄여|비워)|압축해\s*줘/ },
  { command: 'context', pattern: /컨텍스트.{0,8}(얼마나|몇\s*%|사용량|차지)/ },
  { command: 'usage', pattern: /(한도|사용량|리밋|limit).{0,10}(얼마|남았|확인|초기화)/i },
  { command: 'rewind', pattern: /(방금|아까|이전).{0,10}(되돌려|원래대로|롤백|취소해)|되돌려\s*줘/ },
  { command: 'clear', pattern: /(대화|세션).{0,6}(새로|처음부터)\s*시작/ },
  { command: 'resume', pattern: /(이전|예전|지난)\s*(대화|세션).{0,8}(이어|열어|불러)/ },
  { command: 'model', pattern: /모델.{0,6}(바꿔|변경|교체)/ },
  { command: 'diff', pattern: /(바뀐|변경된|수정된)\s*(내용|부분|파일|사항).{0,10}(보여|확인)/ },
  { command: 'tasks', pattern: /(백그라운드|실행\s*중인)\s*(작업|태스크|에이전트).{0,10}(보여|확인|목록)/ },
  { command: 'plan', pattern: /(계획만|먼저\s*계획|코드\s*건드리지\s*말고\s*계획)/ },
]
