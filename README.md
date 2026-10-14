# mulgogi-mods

한국어 화면으로 쓰는 Claude Code mod 두 개입니다.

| mod | 하는 일 | 명령 |
| :- | :- | :- |
| **clickbar** | 입력창 위에 컨텍스트·사용 한도 상태 줄과 자주 쓰는 명령 버튼 줄을 둡니다. 턴이 끝나면 바뀐 파일·컨텍스트 증가·API 환산 비용을 한 줄로 남깁니다. 명령·단축키·내 질문·답변·보관함·짐작 탭이 있는 팔레트를 엽니다 | `/palette` `/idea` `/tips` `/assumptions` |
| **session-tracker** | 입력창 위에 이 대화가 백그라운드인지 포그라운드인지와, 같은 폴더의 다른 Claude 세션을 보여 줍니다. 세션 패널에서 이 PC의 켜진 대화와 꺼진 대화를 폴더별·날짜별로 보고 고정·보관·이름 바꾸기·끄기를 합니다 | `/sessions` `/sessions-here` |

## 설치

Claude Code v2.1.287 이상이 필요합니다(mod 기능이 이 버전부터 켜짐). 셸에서 칩니다.

```bash
claude plugin marketplace add SJvaca30/mulgogi-mods
claude plugin install clickbar@mulgogi-mods
claude plugin install session-tracker@mulgogi-mods
```

필요한 것만 골라 설치해도 됩니다. 열려 있는 세션에서는 `/reload-plugins`를 치면 바로 보입니다. `/plugin`을 열었을 때 위쪽에 `2 mods active · clickbar, session-tracker`가 보이면 성공입니다.

Claude Code 안에서 한 줄로 설치하려면 `/plugin install clickbar --marketplace SJvaca30/mulgogi-mods`를 칩니다(v2.1.275 이상).

## 업데이트·삭제

```bash
claude plugin marketplace update mulgogi-mods    # 새 목록 받기
claude plugin update clickbar@mulgogi-mods        # mod별 업데이트
claude plugin uninstall clickbar@mulgogi-mods     # 삭제
```

자동 업데이트는 기본으로 꺼져 있습니다. `/plugin`의 Marketplaces에서 `mulgogi-mods`를 고르고 Enable auto-update를 켜면 새 버전을 알아서 받습니다. 업데이트한 뒤에는 `/reload-plugins`를 치거나 세션을 다시 엽니다.

GitHub SSH 키가 없는 PC에서 Claude Code 안의 설치·업데이트가 실패하면, 환경 변수 `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1`을 두고 다시 해 보세요.

## 시험한 환경과 제약

- Windows 11, Claude Code v2.1.299, 터미널(Orca 안)에서 만들고 시험했습니다. macOS·Linux와 데스크톱 앱 Code 탭에서는 시험하지 않았습니다.
- session-tracker의 [이동]·[열기]와 다른 세션의 이름 바꾸기는 Orca 앱의 `orca` 명령이 있어야 합니다. 없으면 안내 메시지를 띄우고, [열기]는 터미널에 직접 칠 명령을 알려 줍니다.
- 꺼진 대화의 제목(`/resume`에 보이는 제목)은 PowerShell 7(`pwsh`)로 읽습니다. 없으면 제목 대신 첫 질문을 보여 줍니다.
- VS Code 확장의 채팅 창에서는 mod가 그리는 화면이 보이지 않습니다(공식 문서 기준).
- 회사 계정이면 관리자가 사용자가 설치한 mod를 막아 두었을 수 있습니다. 설치했는데 `/plugin` 위쪽에 `mods active` 줄이 없으면 관리자에게 확인하세요.

## Claude에게 영향을 주는 부분

- clickbar는 Claude에게 `log_assumption` 도구를 줍니다. Claude가 묻지 않고 짐작해서 정한 것을 기록하면, [assumptions N] 버튼과 팔레트의 [짐작] 탭에서 맞음·틀림을 고릅니다. `/assumptions off`로 끕니다.
- clickbar는 질문 문장이 내장 명령으로 바로 할 수 있는 일이면 한 번만 알려 줍니다. 질문은 바꾸지 않습니다. `/tips off`로 끕니다.
- session-tracker는 같은 폴더에서 다른 세션이 작업 중이면, 보내는 질문에 그 사실을 알리는 안내 한 줄을 붙입니다. 같은 파일을 함께 고치는 일을 막으려는 것입니다. `/sessions-here off`로 끕니다.
- session-tracker의 세션 패널에서 다른 세션의 이름을 고치면, 그 세션의 Orca 탭 입력창에 `/rename 새 이름`을 대신 쳐 넣습니다. 그 세션이 승인을 기다리는 중이 아니고 입력창이 비어 있을 때만 합니다.
- 버튼 몇 개는 누르면 질문을 보내 Claude가 답하게 합니다. 보관함의 [Send], 짐작 탭의 [틀린 짐작 고쳐 달라고 보내기], [btw]가 그렇습니다. 누르지 않으면 질문을 보내지 않습니다.

## 어디에 무엇을 저장하나

- 설정, 고정, 보관, 팔레트 보관함: `~/.claude/plugins/store/`. 이 PC에만 남습니다.
- 세션 상태: `~/.claude/mods-state/session-tracker/`. 같은 폴더의 다른 세션을 알려고 세션마다 상태 파일을 하나씩 씁니다. 제목을 읽는 도우미 스크립트도 여기에 둡니다.
- 네트워크 요청은 하지 않습니다. mod가 스스로 모델을 부르지도 않습니다(위의 버튼은 사용자 질문으로 보냅니다).

## 설치하기 전에

mod는 내 권한으로 실행되는 코드입니다. 파일을 읽고 쓰고 프로그램을 실행할 수 있습니다. 이 저장소를 내려받은 뒤 `claude plugin validate ./clickbar`처럼 치면, 그 mod가 어떤 이벤트를 받고 무엇을 부르는지 목록으로 볼 수 있습니다.

## 라이선스

[MIT](LICENSE)
