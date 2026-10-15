// 내장 명령의 한국어 설명. 출처: https://code.claude.com/docs/en/commands (2026-10-07 확인)
// 설치된 Claude Code에 없는 명령은 팔레트에 나오지 않는다.

export type Entry = { name: string; ko: string }

export const GROUPS: { title: string; entries: Entry[] }[] = [
  {
    title: '컨텍스트',
    entries: [
      { name: 'compact', ko: '대화를 요약해 컨텍스트 공간을 비운다. 뒤에 남길 내용을 적을 수 있다' },
      { name: 'context', ko: '컨텍스트를 무엇이 얼마나 차지하는지 종류별로 본다' },
      { name: 'clear', ko: '빈 컨텍스트로 새 대화를 시작한다. 이전 대화는 /resume으로 돌아간다' },
      { name: 'btw', ko: '대화 기록에 남기지 않고 곁가지 질문을 한다. 도구 없이 한 번만 답한다' },
      { name: 'autocompact', ko: '컨텍스트가 얼마나 차면 자동 압축할지 정한다' },
      { name: 'focus', ko: '집중 보기를 켜고 끈다: 내 질문, 요약, 답만 보인다' },
    ],
  },
  // 출처: Claude Code 2.1.296 본체의 명령 설명문 (2026-10-14 확인)
  {
    title: '대화 · 세션',
    entries: [
      { name: 'resume', ko: '지난 대화를 고른다. 켜진 백그라운드 대화는 연결되고, 꺼진 대화는 다시 켜진다 (Ctrl+A: 모든 폴더)' },
      { name: 'rename', ko: '이 대화의 이름을 바꾼다' },
      { name: 'background', ko: '이 대화를 백그라운드 세션으로 보내고 터미널을 비운다 (/bg)' },
      { name: 'stop', ko: '백그라운드 대화를 끈다. 기록과 worktree는 남는다 (백그라운드 세션에서만)' },
      { name: 'exit', ko: '포그라운드면 대화를 끄고, 백그라운드면 화면만 떠난다' },
      { name: 'fork', ko: '현재 대화를 백그라운드 세션으로 복사하고 지금 대화는 계속한다' },
      { name: 'branch', ko: '현재 시점에서 갈라진 사본으로 옮겨 간다. 원본은 /resume으로 돌아간다' },
      { name: 'subtask', ko: '대화 전체 맥락을 넘긴 서브에이전트를 보낸다. 결과는 이 대화로 돌아온다' },
      { name: 'rewind', ko: '대화나 코드를 이전 메시지 시점으로 되돌린다 (Esc 두 번)' },
      { name: 'list-agents', ko: '메시지를 보낼 수 있는 서브에이전트, 팀원, 다른 Claude 세션을 본다 (/peers)' },
      { name: 'cd', ko: '이 대화의 작업 폴더를 옮긴다. 옮길 경로를 붙인다' },
    ],
  },
  {
    title: '작업 · 변경 확인',
    entries: [
      { name: 'tasks', ko: '백그라운드로 도는 서브에이전트·셸 명령을 보고 멈춘다' },
      { name: 'workflows', ko: '실행 중이거나 끝난 워크플로를 본다' },
      { name: 'loops', ko: '반복 실행(/loop)을 보고, 만들고, 지운다' },
      { name: 'goal', ko: 'Claude가 멈추기 전에 확인할 목표를 정한다. clear로 지운다' },
      { name: 'diff', ko: 'Claude가 고친 것을 포함해 작업 트리의 변경을 검토한다' },
      { name: 'copy', ko: '마지막 답변을 클립보드에 복사한다. /copy 2는 그 전 답변' },
      { name: 'export', ko: '대화를 텍스트 파일이나 클립보드로 내보낸다' },
      { name: 'recap', ko: '이 세션을 한 줄로 요약한다' },
      { name: 'review', ko: '현재 변경이나 PR을 리뷰한다' },
      { name: 'security-review', ko: '현재 브랜치 변경의 보안 취약점을 검토한다' },
    ],
  },
  {
    title: '모델 · 설정',
    entries: [
      { name: 'model', ko: '모델을 바꾼다. 인자 없이 실행하면 선택 목록이 뜬다' },
      { name: 'effort', ko: '생각 깊이를 바꾼다: low ~ max, auto' },
      { name: 'advisor', ko: '중요한 순간에 더 강한 모델에게 조언을 구하게 한다' },
      { name: 'plan', ko: '코드를 건드리기 전에 계획부터 세우는 plan 모드로 들어간다' },
      { name: 'permissions', ko: '도구 허용·확인·거부 규칙을 관리한다' },
      { name: 'config', ko: '설정 화면을 연다 (테마, 모델 등)' },
      { name: 'memory', ko: 'CLAUDE.md 같은 메모리 파일을 편집한다' },
      { name: 'hooks', ko: '도구 이벤트에 걸린 hook 설정을 본다' },
      { name: 'tui', ko: '화면 렌더러를 바꾼다 (default / fullscreen)' },
      { name: 'theme', ko: '테마를 바꾼다' },
      { name: 'color', ko: '이 대화의 입력창 색을 정한다' },
    ],
  },
  {
    title: '플러그인 · 스킬 · MCP',
    entries: [
      { name: 'plugin', ko: '플러그인을 설치·관리한다 (/plugins, /marketplace)' },
      { name: 'reload-plugins', ko: '바뀐 플러그인과 mod를 지금 대화에 적용한다' },
      { name: 'skills', ko: '쓸 수 있는 스킬 목록을 본다' },
      { name: 'reload-skills', ko: '대화 중에 추가·수정한 스킬을 다시 읽는다' },
      { name: 'skill-doctor', ko: '쓰이지 않으면서 컨텍스트만 차지하는 스킬을 보여 준다' },
      { name: 'mcp', ko: 'MCP 서버 연결을 관리한다' },
    ],
  },
  {
    title: '상태 · 도움말',
    entries: [
      { name: 'usage', ko: '세션 비용과 플랜 사용 한도를 본다' },
      { name: 'status', ko: '버전, 모델, 계정, 연결 상태를 본다' },
      { name: 'version', ko: '이 대화의 Claude Code 버전을 본다' },
      { name: 'insights', ko: 'Claude Code 사용 기록을 분석한 보고서를 만든다' },
      { name: 'keybindings', ko: '키보드 단축키 설정 파일을 연다' },
      { name: 'doctor', ko: '설치·설정 문제를 진단한다' },
      { name: 'powerup', ko: '짧은 체험 강좌로 Claude Code 기능을 익힌다' },
      { name: 'help', ko: '도움말과 명령 목록을 본다' },
    ],
  },
  {
    title: '직접 만든 mod',
    entries: [
      { name: 'sessions', ko: '이 PC에서 켜져 있는 대화를 폴더별로 보고 [이동]으로 간다' },
      { name: 'sessions-here', ko: '같은 폴더의 다른 대화만 본다' },
      { name: 'sync', ko: '설정 저장소(CCsetting)와 메모리·mod·설정을 지금 주고받는다' },
      { name: 'idea', ko: '아이디어 보관함에 넣거나 보관함을 연다' },
      { name: 'assumptions', ko: 'Claude가 묻지 않고 짐작해서 정한 것을 확인한다' },
      { name: 'flow', ko: '이 대화의 서브에이전트를 나무 모양으로 본다. 다시 입력하면 닫힌다' },
    ],
  },
  // 설치한 스킬과 플러그인 명령. 팔레트에 보이는 설명만 바꾸고, Claude가 스킬을 고를 때 읽는 SKILL.md의 설명은 그대로다.
  // / 메뉴의 한국어 설명(command.describe)도 엔진 내장 명령에만 쓰므로 이 묶음은 영향이 없다. 설치되지 않은 것은 보이지 않는다.
  // "직접 불러야 한다"는 SKILL.md에 disable-model-invocation: true가 있어 Claude가 알아서 쓰지 않는 스킬이다(2026-10-15 확인)
  {
    title: '스킬 · 개발 방법',
    entries: [
      { name: 'tdd', ko: '테스트를 먼저 쓰고 통과시키는 순서(레드-그린-리팩터)로 기능을 만들거나 버그를 고친다' },
      { name: 'diagnosing-bugs', ko: '어려운 버그나 성능 저하를 재현하고 가설을 세워 원인을 좁혀 찾는다' },
      { name: 'codebase-design', ko: '작은 인터페이스 뒤에 많은 일을 숨기는 깊은 모듈 관점으로 모듈 경계와 인터페이스를 설계한다' },
      { name: 'domain-modeling', ko: '도메인 용어를 다듬어 CONTEXT.md(용어집)와 ADR(결정 기록)을 쓰고 고친다' },
      { name: 'grilling', ko: '계획·결정·아이디어를 끝까지 따져 묻는 질문으로 빈틈을 찾는다' },
      { name: 'grill-with-docs', ko: '따져 묻는 질문으로 계획·설계를 다듬으면서 ADR과 용어집도 함께 쓴다. 직접 불러야 한다' },
      { name: 'handoff', ko: '지금 대화를 다른 에이전트가 이어받을 인계 문서로 줄여 쓴다. 직접 불러야 한다' },
      { name: 'setup-matt-pocock-skills', ko: '개발 스킬을 처음 쓰기 전에 이 저장소의 이슈 트래커·라벨·문서 구조를 한 번 설정한다. 직접 불러야 한다' },
      { name: 'shadcn-lint', ko: 'Tailwind v4 프로젝트의 UI 코드가 디자인 시스템 규칙에 맞는지 @shadcn/lint로 검사한다' },
      { name: 'skill-creator', ko: '스킬을 새로 만들거나 고치고, 평가를 돌려 성능과 설명의 호출 정확도를 높인다' },
    ],
  },
  {
    title: '스킬 · 문서와 파일',
    entries: [
      { name: 'docs', ko: '공유하고 댓글을 다는 claude.ai 문서를 만들고 고친다. 보고서·제안서 같은 글의 기본 형식이다' },
      { name: 'docx', ko: 'Word 문서(.docx·.dotx)를 만들고, 읽고, 고친다' },
      { name: 'pdf', ko: 'PDF에서 글·표를 뽑고, 합치고, 나누고, 새로 만들고, 양식을 채운다' },
      { name: 'pptx', ko: 'PowerPoint 파일(.pptx·.potx)을 만들고, 읽고, 고친다' },
      { name: 'xlsx', ko: '엑셀·CSV 같은 표 파일을 열어 고치고 정리하거나 새로 만든다' },
      { name: 'google-workspace', ko: 'Google Docs·Sheets·Slides 파일을 만들거나 고칠 때 연결 도구보다 먼저 읽는 안내다' },
    ],
  },
  {
    title: '스킬 · 그림과 웹',
    entries: [
      { name: 'diagram-design:diagram-design', ko: '아키텍처·흐름도·시퀀스·ERD·간트 등 여러 다이어그램을 HTML·SVG·PNG로 그린다' },
      { name: 'diagram-design:import-mermaid', ko: 'Mermaid 코드를 원하는 형식·크기·상세도로 다시 그린다' },
      { name: 'diagram-design:import-drawio', ko: 'draw.io 파일을 원하는 형식·크기·상세도로 다시 그린다' },
      { name: 'diagram-design:import-excalidraw', ko: 'Excalidraw 보드를 원하는 형식·크기·상세도로 다시 그린다' },
      { name: 'diagram-design:export-diagram', ko: '다이어그램 HTML 파일을 같은 폴더에 .svg와 .png로 내보낸다' },
      { name: 'diagram-design:profile', ko: '고객사별 다이어그램 프로필을 저장·불러오기·확인·수정·초기화·삭제한다' },
      { name: 'diagram-design:doctor', ko: '다이어그램 도구를 쓸 환경이 준비됐는지 한 번에 점검한다' },
      { name: 'insane-search:insane-search', ko: '차단된 사이트·SNS·영상 자막 같은 웹 내용을 되는 방법을 찾아가며 가져온다' },
    ],
  },
  {
    title: '스킬 · Orca',
    entries: [
      { name: 'orca-cli', ko: 'Orca의 워크트리·터미널·내장 브라우저·자동화를 orca 명령으로 다룬다' },
      { name: 'orchestration', ko: 'Orca 작업자 여럿에게 일을 나눠 맡기고 메시지·완료 보고를 조율한다' },
      { name: 'computer-use', ko: '화면에 보이는 앱 창을 orca computer로 클릭·입력·메뉴·스크린샷 조작한다' },
    ],
  },
  {
    title: '스킬 · 그 밖',
    entries: [
      { name: 'learn', ko: '일을 대신하기보다 원리를 이해하고 싶을 때 설명과 퀴즈로 가르쳐 준다' },
      { name: 'morning', ko: '아침 브리핑을 HTML 페이지로 만들거나 평일마다 도는 작업으로 설정한다' },
      { name: 'import-memory', ko: '다른 AI 비서에서 내보낸 메모리를 Claude 메모리로 가져온다' },
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
      { keys: 'Ctrl+X Tab', ko: '입력창 위 clickbar 줄로 들어간다. 버튼은 Tab으로 옮기고 Enter로 누른다' },
      { keys: 'Ctrl+X Ctrl+A', ko: 'clickbar 줄을 접거나 다시 편다 (줄 오른쪽 [-]와 같다)' },
    ],
  },
  {
    title: 'Claude가 일하는 중',
    entries: [
      { keys: 'Esc', ko: 'Claude를 멈추고 방향을 바꾼다. 한 작업은 남는다. 열린 대화상자는 닫는다' },
      { keys: 'Ctrl+B', ko: '실행 중인 Bash 명령과 에이전트를 백그라운드로 보낸다' },
      { keys: 'Ctrl+X Ctrl+K', ko: '백그라운드 서브에이전트를 모두 멈춘다 (3초 안에 두 번)' },
      { keys: 'Ctrl+Enter', ko: '대기 중인 메시지를 지금 바로 보낸다 (Ctrl+X Ctrl+S도 같다. 터미널이 Ctrl+Enter를 Enter로만 넘기면 Ctrl+X Ctrl+S)' },
      { keys: 'Ctrl+C', ko: '일하는 중이면 중단하고, 아니면 입력을 지운다. 빈 입력에서 한 번 더 누르면 종료' },
    ],
  },
  {
    title: '되돌리기 · 이전 입력',
    entries: [
      { keys: 'Esc Esc', ko: '입력이 있으면 지우고(↑로 되살림), 비어 있으면 되감기 메뉴를 연다', command: 'rewind' },
      { keys: 'Ctrl+R', ko: '전에 보낸 질문을 검색한다' },
      { keys: '↑ / ↓', ko: '전에 보낸 질문을 차례로 불러온다' },
      { keys: 'Ctrl+S', ko: '쓰던 글을 임시 보관하고 입력창을 비운다. 빈 입력창에서 다시 누르면 되살린다' },
      { keys: 'Ctrl+_', ko: '입력 편집을 한 단계 되돌린다' },
    ],
  },
  {
    title: '모드 · 모델',
    entries: [
      {
        keys: 'Shift+Tab',
        ko: '권한 모드를 돌아가며 바꾼다: Manual → acceptEdits → plan … (Windows에서 안 되면 Alt+M)',
        mac: { ko: '권한 모드를 돌아가며 바꾼다: Manual → acceptEdits → plan …' },
        linux: { ko: '권한 모드를 돌아가며 바꾼다: Manual → acceptEdits → plan …' },
      },
      // macOS의 Option 조합은 터미널이 Option을 Alt(Meta)로 넘겨야 된다. Option+T만 그 설정 없이 된다(공식 문서)
      {
        keys: 'Alt+P',
        ko: '입력을 지우지 않고 모델을 바꾼다',
        command: 'model',
        mac: { keys: 'Option+P', ko: '입력을 지우지 않고 모델을 바꾼다. 터미널이 Option을 Alt로 넘겨야 된다(Orca: 설정 → Terminal → Option as Alt)' },
      },
      {
        keys: 'Alt+T',
        ko: '확장 사고를 켜고 끈다. Opus 5.5 등은 항상 켜져 있어 효과가 없다',
        mac: { keys: 'Option+T', ko: '확장 사고를 켜고 끈다. Opus 5.5 등은 항상 켜져 있어 효과가 없다. Option 설정 없이도 된다' },
      },
      // 단가 출처: https://platform.claude.com/docs/en/about-claude/pricing (2026-10-08 확인)
      { keys: 'Alt+O', ko: 'fast 모드를 켜고 끈다. Opus 5.5에서 토큰 단가가 2배다 (입력·출력 $8·$40, 보통 $4·$20)', command: 'fast', mac: { keys: 'Option+O' } },
    ],
  },
  {
    title: '화면 보기',
    entries: [
      { keys: 'Ctrl+O', ko: '대화 기록 뷰어: 도구 내역과 답변마다 시각·모델을 보여준다' },
      { keys: 'Ctrl+T', ko: 'Claude의 할 일 체크리스트를 보이거나 숨긴다' },
      { keys: '?', ko: '빈 입력창에서 누르면 단축키 도움말을 연다' },
      { keys: 'Ctrl+L', ko: '화면이 깨졌을 때 다시 그린다' },
    ],
  },
  {
    title: '대화 기록 뷰어 안에서 (Ctrl+O 다음)',
    entries: [
      { keys: '{ / }', ko: '이전 · 다음 내 질문으로 이동한다' },
      { keys: '[', ko: '대화 전체를 터미널 스크롤백에 써서 터미널 검색으로 찾게 한다' },
      { keys: 'v', ko: '대화를 임시 파일로 써서 편집기로 연다' },
      { keys: 'q', ko: '뷰어를 닫는다 (Esc도 같다)' },
    ],
  },
  {
    title: '입력',
    entries: [
      { keys: 'Ctrl+G', ko: '입력을 기본 텍스트 편집기에서 편집한다' },
      { keys: 'Alt+V', ko: '클립보드 이미지를 붙여 넣는다', mac: { keys: 'Ctrl+V', ko: '클립보드 이미지를 붙여 넣는다 (iTerm2는 Cmd+V)' }, linux: { keys: 'Ctrl+V' } },
      { keys: '!', ko: '맨 앞에 쓰면 셸 모드: 명령을 바로 실행하고 결과를 대화에 넣는다' },
      { keys: '@', ko: '파일 경로를 자동 완성한다' },
      { keys: 'Ctrl+W · K · U', ko: '앞 단어 / 줄 끝까지 / 줄 처음까지 지운다. Ctrl+Y로 지운 글을 붙여 넣는다' },
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
