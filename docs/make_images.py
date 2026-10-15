"""mulgogi-mods README용 화면 그림(PNG)을 만든다. 실행: python docs/make_images.py

터미널 화면을 HTML로 다시 그린 뒤 헤드리스 Edge(또는 Chrome)로 2배 해상도 PNG를 찍는다.
실제 화면 배치·문구를 따르되 대화 이름·폴더는 예시로 바꾼다(공개 저장소라 실제 이름을 쓰지 않는다).
팔레트 설명은 clickbar/hooks/catalog.ts에서 그대로 읽는다. 밝은 판·어두운 판을 함께 만든다.

준비물
- 글꼴: D2Coding(OFL 1.1). 한글이 영문의 정확히 두 배 폭이라 터미널처럼 열이 맞는다.
  D2CODING_DIR 환경 변수에 D2Coding-*.ttf·D2CodingBold-*.ttf가 있는 폴더를 넣거나, 글꼴을 설치해 둔다.
  글꼴은 PNG에 그려질 뿐 저장소에 들어가지 않는다.
- 브라우저: Edge나 Chrome. 기본 설치 경로를 찾고, 없으면 BROWSER 환경 변수로 실행 파일을 지정한다.
"""
import glob
import os
import re
import subprocess
import sys
import tempfile
import unicodedata
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs' / 'images'

FS, CW, LH = 14, 7.0, 20  # 글자 크기, 칸 폭(D2Coding 영문은 0.5em), 줄 높이(px)
COLS = 120  # 그림 하나의 터미널 폭(칸). 세 그림을 같은 폭으로 맞춘다
PAD_X, PAD_Y, BAR_H = 20, 16, 38  # 본문 안쪽 여백, 창 제목 줄 높이
MARGIN = (16, 24, 40)  # 창 바깥 여백(위, 좌우, 아래). 그림자가 잘리지 않게 둔다

THEMES = {
    'light': dict(bg='#ffffff', chrome='#f3f4f6', border='#d8dce2', title='#57606a', text='#1f2328', dim='#6e7781',
                  sug='#5769f7', succ='#2c7a39', warn='#966c1e', err='#ab2b3f', claude='#c4633f', auto='#8700ff', band='#f2f3f5',
                  inverse='#ffffff', rule='#c9ced6', shadow='rgba(31,35,40,.18)', shadow2='rgba(31,35,40,.08)'),
    'dark': dict(bg='#17191e', chrome='#22252b', border='#343943', title='#9aa1ac', text='#e6e8eb', dim='#8b919c',
                 sug='#b1b9f9', succ='#4eba65', warn='#ffc107', err='#ff6b80', claude='#d77757', auto='#af87ff', band='#2a2e35',
                 inverse='#17191e', rule='#454b55', shadow='rgba(0,0,0,.55)', shadow2='rgba(0,0,0,.3)'),
}


def cells(s):
    return sum(2 if unicodedata.east_asian_width(c) in 'WF' else 1 for c in s)


def wrap(s, cols):
    out, line = [], ''
    for word in s.split(' '):
        cand = word if line == '' else line + ' ' + word
        if cells(cand) <= cols:
            line = cand
        else:
            if line:
                out.append(line)
            line = word
    if line:
        out.append(line)
    return out


def catalog():
    src = (ROOT / 'clickbar' / 'hooks' / 'catalog.ts').read_text(encoding='utf-8')
    return {m.group(1): m.group(2) for m in re.finditer(r"\{ name: '([^']+)', ko: '([^']*)' \}", src)}


class Screen:
    """줄 = [(열, 글, 모양)]. 모양: text·dim·sug·succ·warn·err·claude·auto·rule에
    b(굵게)·u(밑줄)·chip(그 색으로 칠한 칸, 글자는 바탕색)·cursor를 붙인다"""

    def __init__(self, cols=COLS):
        self.cols = cols
        self.lines = []
        self.fills = []  # 칠한 칸: (줄, 왼쪽 열, 폭 칸 수, 색)

    def line(self, *segs):
        self.lines.append(list(segs))

    def flow(self, *parts, col=0):
        """(글, 모양)을 왼쪽부터 이어 붙인 한 줄"""
        segs, c = [], col
        for text, style in parts:
            segs.append((c, text, style))
            c += cells(text)
        self.lines.append(segs)

    def blank(self):
        self.lines.append([])

    def bubble(self, text):
        """내 질문 막대 카드: 위에 빈 줄 하나, 대화 칸 전체 폭의 옅은 카드(위아래 한 줄 여백)와 왼쪽 색 막대(칸 하나)"""
        self.lines.append([])
        top = len(self.lines)
        for r in range(3):
            self.fills.append((top + r, 0, 1, 'sug'))
            self.fills.append((top + r, 1, self.cols - 1, 'band'))
        self.lines += [[], [(3, text, 'text')], []]


# 칸에 맞춰 직접 그리는 글자: 가로줄·세로줄은 선으로, 막대는 칸을 채운 사각형으로 그린다
SPECIAL = re.compile(r'(─+|│|█+|░+)')
# D2Coding에 없거나 폭이 다른 기호는 한 글자씩 칸 가운데에 놓는다
SAFE = re.compile(r"[\x20-\x7e\uac00-\ud7a3]+")


def draw_segment(out, x, text, style, t):
    parts = style.split()
    color = t.get(parts[0], t['text'])
    weight = 700 if 'b' in parts else 400
    deco = 'underline' if 'u' in parts else 'none'
    w = cells(text) * CW
    if 'cursor' in parts:
        out.append(f'<i class="blk" style="left:{x:.1f}px;width:{CW:.1f}px;top:2px;height:16px;background:{t["text"]}"></i>')
        return
    if 'chip' in parts:
        out.append(f'<i class="blk" style="left:{x:.1f}px;width:{w:.1f}px;top:1px;height:18px;border-radius:4px;background:{color}"></i>')
        color = t['inverse']
    c = 0
    for piece in SPECIAL.split(text):
        if piece == '':
            continue
        px = x + c * CW
        pw = cells(piece) * CW
        if piece[0] == '─':
            out.append(f'<i class="blk" style="left:{px:.1f}px;width:{pw:.1f}px;top:9.5px;height:1px;background:{color}"></i>')
        elif piece == '│':
            out.append(f'<i class="blk" style="left:{px + CW / 2 - .5:.1f}px;width:1px;top:3px;height:14px;background:{color}"></i>')
        elif piece[0] in '█░':
            alpha = 1 if piece[0] == '█' else .22
            out.append(f'<i class="blk" style="left:{px:.1f}px;width:{pw:.1f}px;top:5px;height:10px;background:{color};opacity:{alpha}"></i>')
        else:
            cc = 0
            for m in re.finditer(r"[\x20-\x7e\uac00-\ud7a3]+|.", piece):
                run = m.group(0)
                rx = px + cc * CW
                rw = cells(run) * CW
                body = escape(run)
                if SAFE.fullmatch(run):
                    out.append(f'<span style="left:{rx:.1f}px;color:{color};font-weight:{weight};text-decoration:{deco}">{body}</span>')
                else:
                    out.append(f'<span class="sym" style="left:{rx:.1f}px;width:{rw:.1f}px;color:{color};font-weight:{weight}">{body}</span>')
                cc += cells(run)
        c += cells(piece)


def html_page(screen, theme, title, fonts):
    t = THEMES[theme]
    term_w = round(PAD_X * 2 + screen.cols * CW)
    term_h = round(PAD_Y * 2 + len(screen.lines) * LH)
    top, side, bottom = MARGIN
    page_w, page_h = term_w + side * 2, top + BAR_H + term_h + bottom
    face = ''.join(f"@font-face{{font-family:'Term';src:url('{Path(p).as_uri()}');font-weight:{wt}}}" for wt, p in fonts.items())
    rows = []
    for r, segs in enumerate(screen.lines):
        out = []
        for col, text, style in segs:
            draw_segment(out, col * CW, text, style, t)
        rows.append(f'<div class="ln" style="top:{PAD_Y + r * LH}px">{"".join(out)}</div>')
    # 칠한 칸은 글보다 먼저 깔아야 글이 위에 보인다
    for row, col, width, color in screen.fills:
        rows.insert(0, f'<i class="blk" style="left:{PAD_X + col * CW:.1f}px;top:{PAD_Y + row * LH:.1f}px;width:{width * CW:.1f}px;height:{LH}px;background:{t[color]}"></i>')
    # 창 조절 단추(최소화·최대화·닫기)는 Windows 11 모양을 단순한 선으로 그린다
    ctl = (f'<svg viewBox="0 0 46 38"><path d="M18 19h10" stroke="{t["title"]}" stroke-width="1"/></svg>'
           f'<svg viewBox="0 0 46 38"><rect x="18.5" y="14.5" width="9" height="9" rx="1.5" fill="none" stroke="{t["title"]}"/></svg>'
           f'<svg viewBox="0 0 46 38"><path d="M18.5 14.5l9 9M27.5 14.5l-9 9" stroke="{t["title"]}"/></svg>')
    html = f'''<!doctype html><html><head><meta charset="utf-8"><style>
{face}
html,body{{margin:0;background:transparent}}
body{{width:{page_w}px;height:{page_h}px;overflow:hidden}}
.win{{position:absolute;left:{side}px;top:{top}px;width:{term_w}px;border-radius:12px;overflow:hidden;background:{t["bg"]};
  box-shadow:0 0 0 1px {t["border"]},0 22px 44px -14px {t["shadow"]},0 4px 14px {t["shadow2"]}}}
.bar{{height:{BAR_H}px;background:{t["chrome"]};border-bottom:1px solid {t["border"]};position:relative;display:flex;justify-content:flex-end}}
.bar svg{{width:46px;height:{BAR_H}px}}
.title{{position:absolute;inset:0;text-align:center;font:500 12.5px/{BAR_H}px 'Pretendard','Segoe UI','Malgun Gothic',sans-serif;color:{t["title"]};letter-spacing:.1px}}
.term{{position:relative;height:{term_h}px;font-family:'Term',monospace;font-size:{FS}px;line-height:{LH}px;
  -webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}}
.ln{{position:absolute;left:{PAD_X}px;right:0;height:{LH}px}}
.ln span{{position:absolute;top:0;white-space:pre}}
.ln .sym{{text-align:center;overflow:visible}}
.blk{{position:absolute;display:block}}
</style></head><body><div class="win"><div class="bar"><div class="title">{escape(title)}</div>{ctl}</div>
<div class="term">{"".join(rows)}</div></div></body></html>'''
    return html, page_w, page_h


def find_fonts():
    dirs = [os.environ.get('D2CODING_DIR', ''), os.path.join(os.environ.get('WINDIR', 'C:/Windows'), 'Fonts'),
            os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Microsoft', 'Windows', 'Fonts'),
            os.path.expanduser('~/Library/Fonts'), '/Library/Fonts', os.path.expanduser('~/.local/share/fonts'), '/usr/share/fonts']
    for d in dirs:
        if not d or not os.path.isdir(d):
            continue
        regular = [p for p in glob.glob(os.path.join(d, '**', 'D2Coding*.tt[fc]'), recursive=True) if 'Bold' not in p and 'ligature' not in p.lower()]
        bold = [p for p in glob.glob(os.path.join(d, '**', 'D2CodingBold*.ttf'), recursive=True) if 'ligature' not in p.lower()]
        if regular:
            return {400: regular[0], 700: (bold or regular)[0]}
    sys.exit('D2Coding 글꼴을 찾지 못했습니다. D2CODING_DIR에 D2Coding-*.ttf가 있는 폴더를 지정하세요')


def find_browser():
    names = [os.environ.get('BROWSER', ''),
             r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
             r'C:\Program Files\Google\Chrome\Application\chrome.exe',
             '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
             '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge']
    for n in names:
        if n and os.path.isfile(n):
            return n
    sys.exit('Edge나 Chrome을 찾지 못했습니다. BROWSER에 실행 파일 경로를 지정하세요')


def shoot(browser, html, w, h, png):
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / 'page.html'
        page.write_text(html, encoding='utf-8')
        # 따로 만든 빈 프로필로 띄워, 열려 있는 브라우저와 그 설정을 건드리지 않는다
        subprocess.run([browser, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', f'--user-data-dir={tmp}/profile',
                        '--force-device-scale-factor=2', '--default-background-color=00000000', f'--window-size={w},{h}',
                        f'--screenshot={png}', page.as_uri()], check=True, capture_output=True, timeout=120)


KO = catalog()


# ---------- 1. 첫 화면: 대화와 입력창 위 줄(band) ----------
def hero():
    s = Screen()
    # 내 질문은 왼쪽 막대가 있는 옅은 카드, Claude의 답은 칠하지 않은 글이다. 메시지 사이 빈 줄은 실제 화면과 같다
    s.bubble('결제 실패 시 재시도 로직을 추가해 줘')
    s.blank()
    s.flow(('● ', 'text'), ('재시도 정책을 PaymentService에 추가하고 테스트 3개를 함께 넣었습니다.', 'text'))
    s.blank()
    s.flow(('✻ Worked for 1m 12s · done 3:42 PM', 'dim'))
    s.flow(('● clickbar: 파일 2개 +48 −6 (PaymentService.java, RetryPolicyTest.java) · 컨텍스트 +6k · API 환산 ≈$0.21', 'dim'))
    s.blank()
    s.bubble('환불 API에도 같은 방식으로 적용해 줘')
    s.blank()
    # 스피너 줄 끝에 이번 턴의 진행 상황(수정한 파일 수·도구 호출 수)이 붙는다
    s.flow(('✶', 'claude'), (' Pondering · 파일 1개 수정 · 도구 4회…', 'claude'), (' (8s · ↓ 1.2k tokens)', 'dim'))
    s.flow(('── clickbar ' + '─' * (COLS - 12 - 4), 'rule'), (' [-]', 'dim'))
    # 상태 줄: 항목마다 이름(기본색) 막대 비율(굵게) (설명, 흐리게), 항목 사이는 세 칸. 60%를 넘은 컨텍스트는 경고색
    s.flow(('컨텍스트 ', 'text'), ('███████░░░', 'warn'), (' ', 'text'), ('68%', 'warn b'), (' (자동 압축까지 290k)', 'dim'),
           ('   5시간 ', 'text'), ('██░░░', 'dim'), (' ', 'text'), ('31%', 'text b'), (' (17:00)', 'dim'),
           ('   주간 ', 'text'), ('██░░░', 'dim'), (' ', 'text'), ('46%', 'text b'), (' (10/17 23:00)', 'dim'),
           ('   API 환산 ', 'text'), ('≈$3.84', 'text b'))
    s.flow(('[compact] [context]', 'sug'), (' │ ', 'dim'), ('[resume] [sessions] [fork]', 'sug'), (' │ ', 'dim'),
           ('[copy] [quote] [btw]', 'sug'), (' │ ', 'dim'), ('[tasks] [palette]', 'sug'))
    s.flow(('── 세션 ' + '─' * (COLS - 8), 'rule'))
    s.flow((' 백그라운드 ', 'sug chip b'), (' 탭을 닫아도 켜져 있음 · 끄기 /stop', 'dim'), ('   같은 폴더 다른 세션 2개:', 'dim'),
           ('   작업 중 1', 'succ'), (' ("버그 찾아 줘" 3분 전)', 'dim'), ('   대기 중 1', 'dim'))
    s.flow(('─' * (COLS - 11) + ' shop-api ─', 'rule'))
    s.line((0, '❯ ', 'text'), (2, ' ', 'text cursor'))
    s.flow(('─' * COLS, 'rule'))
    s.flow(('  ⏵⏵ accept edits on', 'auto'), (' (shift+tab to cycle)', 'dim'))
    return s


# ---------- 2. 명령 팔레트 ----------
def palette():
    s = Screen()
    # 머리 줄: 왼쪽에 탭(고른 탭은 칠한 칸), 오른쪽 끝에 [닫기]와 닫는 키
    s.flow((' 명령 ', 'sug chip b'), (' [단축키] [내 질문] [답변] [아이디어] [가정]', 'sug'))
    s.lines[-1] += [(COLS - 10, '[닫기]', 'sug'), (COLS - 3, 'Esc', 'dim')]
    # 한도: 한 줄에 하나씩 이름·막대·비율 열을 맞추고 초기화 시각과 남은 시간을 붙인다
    s.line((0, '5시간', 'text'), (8, '██░░░', 'dim'), (14, ' 31%', 'text b'), (19, '17:00 초기화 · 1시간 18분 뒤', 'dim'))
    s.line((0, '주간', 'text'), (8, '██░░░', 'dim'), (14, ' 46%', 'text b'), (19, '10/17(금) 23:00 초기화 · 2일 5시간 뒤', 'dim'))
    s.flow(('[/명령] 실행 · [넣기] 입력창에 넣기(인자 입력용) · [고정] 맨 위에 고정 · [해제] 고정 해제', 'dim'))
    s.flow(('명령 이름이나 설명으로 검색', 'dim'), ('  ⏎ submit', 'dim'))
    desc_col = 35

    def group(title, names, pinned=False):
        s.blank()
        s.flow((title, 'text b'))
        for n in names:
            desc = wrap(KO[n], COLS - desc_col)
            s.line((0, f'[/{n}]', 'sug'), (21, '[넣기]', 'sug'), (28, '[해제]' if pinned else '[고정]', 'warn' if pinned else 'sug'), (desc_col, desc[0], 'dim'))
            for more in desc[1:]:
                s.line((desc_col, more, 'dim'))

    group('고정한 명령', ['compact', 'context', 'rewind'], pinned=True)
    group('대화 · 세션', ['resume', 'rename', 'background'])
    group('스킬 · 개발 방법', ['tdd', 'diagnosing-bugs'])
    return s


# ---------- 3. 세션 패널 ----------
def sessions():
    s = Screen()
    # 머리 줄: 왼쪽에 보기 탭, 오른쪽 끝에 [다시 읽기]·[닫기]와 닫는 키. 둘째 줄은 개수를 붙인 상태 필터와 상태별 개수
    s.flow((' 폴더별 ', 'sug chip b'), (' [날짜별] [보관함 1]', 'sug'))
    s.lines[-1] += [(COLS - 22, '[다시 읽기] [닫기]', 'sug'), (COLS - 3, 'Esc', 'dim')]
    s.flow(('상태 ', 'dim'), (' 전체 23 ', 'sug chip b'), (' [켜짐 3] [유휴 20]', 'sug'), ('  입력 필요 1', 'warn b'), (' · ', 'dim'),
           ('작업 중 1', 'succ'), (' · ', 'dim'), ('대기 중 1', 'dim'))
    manage_col = COLS - 6

    def row(action, state, kind, name, manage='[관리]'):
        s.line((0, *action), (9, *state), (20, *kind), (32, *name), (manage_col, manage, 'warn' if manage == '[접기]' else 'sug'))

    def head(title, count):
        s.blank()
        s.flow((title, 'text b'), (' ' + count, 'dim'))

    head('고정', '2개 (켜짐 1 · 유휴 1)')
    row(('[이동]', 'sug'), ('작업 중', 'succ'), ('백그라운드', 'sug'), ('결제 API 리팩터링', 'text u'))
    row(('[열기]', 'sug'), ('2시간 전', 'dim'), ('유휴', 'dim'), ('배포 체크리스트', 'text'))
    head('D:\\work\\shop-api', '9개 (켜짐 2 · 유휴 7)')
    row(('이 대화', 'sug b'), ('입력 필요', 'warn b'), ('포그라운드', 'warn'), ('주간 보고서 작성', 'text b u'))
    row(('[이동]', 'sug'), ('대기 중', 'dim'), ('백그라운드', 'sug'), ('로그인 버그 수정', 'text u'), manage='[접기]')
    s.line((9, '[고정] [이름 고치기] [보관] [끄기]', 'sug'))
    row(('[열기]', 'sug'), ('35분 전', 'dim'), ('유휴', 'dim'), ('테스트 커버리지 점검', 'text'))
    row(('[열기]', 'sug'), ('1일 전', 'dim'), ('유휴', 'dim'), ('README 정리', 'text'))
    s.line((9, '[유휴 5개 더 보기]', 'sug'))
    head('D:\\work\\docs', '4개 (켜짐 0 · 유휴 4)')
    row(('[열기]', 'sug'), ('3일 전', 'dim'), ('유휴', 'dim'), ('API 문서 개편', 'text'))
    row(('[열기]', 'sug'), ('5일 전', 'dim'), ('유휴', 'dim'), ('온보딩 가이드 초안', 'text'))
    s.blank()
    s.flow(('[설명]', 'sug'), (' Claude Code 기본 목록 ', 'dim'), ('[resume]', 'sug'))
    return s


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    fonts, browser = find_fonts(), find_browser()
    for name, build, title in [('hero', hero, 'claude — shop-api'), ('palette', palette, '명령 팔레트 — /palette'), ('sessions', sessions, '세션 패널 — /sessions')]:
        scr = build()
        for theme in THEMES:
            html, w, h = html_page(scr, theme, title, fonts)
            png = OUT / f'{name}-{theme}.png'
            shoot(browser, html, w, h, png)
            print('wrote', png.name, f'{w}x{h} css', png.stat().st_size, 'bytes')
