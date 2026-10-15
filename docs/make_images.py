"""mulgogi-mods README용 화면 그림(SVG)을 만든다. 실행: python docs/make_images.py

실제 화면 배치·문구를 따르되 대화 이름·폴더는 예시로 바꾼다(공개 저장소라 실제 이름을 쓰지 않는다).
팔레트 설명은 clickbar/hooks/catalog.ts에서 그대로 읽는다. 밝은 판·어두운 판을 함께 만든다.
"""
import os
import re
import unicodedata
from html import escape

# 저장소 루트(이 파일은 docs/ 안에 있다)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'images')
os.makedirs(OUT, exist_ok=True)

FONT = "'D2Coding','JetBrains Mono','Cascadia Mono',Consolas,'Noto Sans Mono CJK KR','Malgun Gothic',monospace"
CW, LH, FS = 8.4, 20, 14  # 글자 칸 폭, 줄 높이, 글자 크기(px)
PAD_X, PAD_TOP, BAR_H = 18, 14, 34

THEMES = {
    'dark': dict(bg='#16181d', chrome='#22252b', border='#30343c', title='#8b919c', text='#e6e8eb', dim='#8b919c',
                 sug='#b1b9f9', succ='#4eba65', warn='#ffc107', err='#ff6b80', claude='#e08a68', inverse='#16181d',
                 rule='#4a4f59', shadow='rgba(0,0,0,.45)'),
    'light': dict(bg='#ffffff', chrome='#f1f3f5', border='#d9dde3', title='#6e7781', text='#1f2328', dim='#6e7781',
                  sug='#5769f7', succ='#2c7a39', warn='#966c1e', err='#ab2b3f', claude='#c4633f', inverse='#ffffff',
                  rule='#c2c7cf', shadow='rgba(31,35,40,.12)'),
}


def wide(ch):
    return unicodedata.east_asian_width(ch) in 'WF'


def width(s):
    return sum(2 if wide(c) else 1 for c in s)


def wrap(s, cols):
    out, line = [], ''
    for word in s.split(' '):
        cand = word if line == '' else line + ' ' + word
        if width(cand) <= cols:
            line = cand
        else:
            if line:
                out.append(line)
            line = word
    if line:
        out.append(line)
    return out


def catalog():
    src = open(os.path.join(ROOT, 'clickbar', 'hooks', 'catalog.ts'), encoding='utf-8').read()
    return {m.group(1): m.group(2) for m in re.finditer(r"\{ name: '([^']+)', ko: '([^']*)' \}", src)}


# 줄 = [(열, 글, 모양)] 모양: text·dim·sug·succ·warn·claude·rule, 접미사 b(굵게)·u(밑줄)·spin·cursor·badge-<색>
class Screen:
    def __init__(self, cols):
        self.cols = cols
        self.lines = []

    def line(self, *segs):
        self.lines.append(list(segs))

    def flow(self, *parts, col=0):
        """(글, 모양)을 왼쪽부터 이어 붙인 한 줄"""
        segs, c = [], col
        for text, style in parts:
            segs.append((c, text, style))
            c += width(text)
        self.lines.append(segs)

    def blank(self):
        self.lines.append([])


def render(screen, theme, title, path, rows_extra=0):
    t = THEMES[theme]
    w = round(PAD_X * 2 + screen.cols * CW)
    h = round(BAR_H + PAD_TOP * 2 + (len(screen.lines) + rows_extra) * LH)
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h + 16}" viewBox="0 0 {w} {h + 16}" role="img" aria-label="{escape(title)}">',
           '<style>',
           f'text{{font-family:{FONT};font-size:{FS}px;white-space:pre}}',
           '.b{font-weight:700}.u{text-decoration:underline}',
           '@keyframes pulse{50%{opacity:.25}}.spin{animation:pulse 1.6s ease-in-out infinite}',
           '@keyframes blink{50%{opacity:0}}.cursor{animation:blink 1.1s steps(1) infinite}',
           '@media (prefers-reduced-motion:reduce){.spin,.cursor{animation:none}}',
           '</style>',
           f'<rect x="1" y="5" width="{w - 2}" height="{h}" rx="11" fill="{t["shadow"]}" opacity=".6"/>',
           f'<rect x="1" y="1" width="{w - 2}" height="{h}" rx="10" fill="{t["bg"]}" stroke="{t["border"]}"/>',
           f'<path d="M1 11a10 10 0 0 1 10-10h{w - 22}a10 10 0 0 1 10 10v{BAR_H - 10}h-{w - 2}z" fill="{t["chrome"]}"/>',
           f'<line x1="1" y1="{BAR_H + 1}" x2="{w - 1}" y2="{BAR_H + 1}" stroke="{t["border"]}"/>']
    for i, color in enumerate(['#ff5f57', '#febc2e', '#28c840']):
        out.append(f'<circle cx="{20 + i * 18}" cy="{BAR_H / 2 + 1}" r="5.5" fill="{color}"/>')
    out.append(f'<text x="{w / 2}" y="{BAR_H / 2 + 6}" text-anchor="middle" fill="{t["title"]}" style="font-size:12.5px">{escape(title)}</text>')
    y0 = BAR_H + PAD_TOP + 15
    for r, segs in enumerate(screen.lines):
        y = y0 + r * LH
        for col, text, style in segs:
            parts = style.split()
            color = t.get(parts[0], t['text'])
            cls = ' '.join(p for p in parts[1:] if p in ('b', 'u', 'spin', 'cursor'))
            x = PAD_X + col * CW
            badge = next((p for p in parts if p.startswith('badge-')), None)
            if badge:
                out.append(f'<rect x="{x:.1f}" y="{y - 15}" width="{width(text) * CW:.1f}" height="{LH - 1}" rx="3" fill="{t[badge[6:]]}"/>')
                color = t['inverse']
            if 'cursor' in parts:
                out.append(f'<rect class="cursor" x="{x:.1f}" y="{y - 14}" width="{CW:.1f}" height="17" fill="{t["text"]}"/>')
                continue
            # 글자 폭이 섞인 글은 같은 폭끼리 나눠 칸에 맞춘다(보는 PC의 글꼴과 상관없이 열이 맞도록)
            c = 0
            for m in re.finditer(r'[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]+|[^\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]+', text):
                run = m.group(0)
                rw = width(run)
                xr = x + c * CW
                attrs = f'x="{xr:.1f}" y="{y}" fill="{color}"'
                if run.strip() and (rw > 1 or wide(run[0])):
                    attrs += f' textLength="{rw * CW:.1f}" lengthAdjust="spacingAndGlyphs"'
                cl = f' class="{cls}"' if cls else ''
                out.append(f'<text {attrs}{cl}>{escape(run)}</text>')
                c += rw
    out.append('</svg>')
    open(path, 'w', encoding='utf-8', newline='\n').write('\n'.join(out))


KO = catalog()

# ---------- 1. 첫 화면: 대화 + 입력창 위 줄(band) ----------
def hero():
    s = Screen(112)
    s.flow(('❯ ', 'dim'), ('결제 실패 시 재시도 로직을 추가해 줘', 'text'))
    s.blank()
    s.flow(('● ', 'text'), ('재시도 정책을 PaymentService에 추가하고 테스트 3개를 함께 넣었습니다.', 'text'))
    s.blank()
    s.flow(('✻ Worked for 1m 12s · done 3:42 PM', 'dim'))
    s.flow(('● clickbar: 파일 2개 +48 −6 (PaymentService.java, RetryPolicyTest.java) · 컨텍스트 +6k · API 환산 ≈$0.21', 'dim'))
    s.blank()
    s.flow(('❯ ', 'dim'), ('환불 API에도 같은 방식으로 적용해 줘', 'text'))
    s.blank()
    s.flow(('✶', 'claude spin'), (' Pondering…', 'claude'), (' (8s · ↓ 1.2k tokens)', 'dim'))
    s.flow(('── clickbar ' + '─' * (106 - 12), 'rule'), (' [-]', 'dim'))
    s.flow(('컨텍스트 ███████░░░ 68% (자동 압축까지 290k)', 'dim'), (' │ 사용량', 'dim'), (' 5시간 31% (17:00)', 'dim'),
           (' 주간 46% (내일 23:00)', 'dim'), (' │ API 환산 ≈$3.84', 'dim'))
    s.flow(('[compact] [context]', 'sug'), (' │ ', 'dim'), ('[resume] [sessions] [fork]', 'sug'), (' │ ', 'dim'),
           ('[copy] [quote] [btw]', 'sug'), (' │ ', 'dim'), ('[tasks] [palette]', 'sug'))
    s.flow(('── 세션 ' + '─' * (106 - 8), 'rule'))
    s.flow((' 백그라운드 ', 'text b badge-sug'), (' 탭을 닫아도 켜져 있음 · 끄기 /stop │ 같은 폴더 다른 세션 2개:', 'dim'),
           (' 작업 중 1', 'succ'), (' ("버그 찾아 줘" 3분 전)', 'dim'))
    s.flow(('· 대기 중 1', 'dim'))
    s.flow(('─' * (112 - 11) + ' shop-api ─', 'rule'))
    s.line((0, '❯ ', 'text'), (2, ' ', 'text cursor'))
    s.flow(('─' * 112, 'rule'))
    s.flow(('  ⏵⏵ accept edits on (shift+tab to cycle)', 'dim'))
    return s


# ---------- 2. 명령 팔레트 ----------
def palette():
    s = Screen(88)
    s.flow(('[ 명령 ]', 'text b'), (' [단축키] [내 질문] [답변] [보관함] [짐작] [닫기]', 'sug'), (' Esc · Ctrl+X X', 'dim'))
    s.flow(('5시간 31% · 17:00 초기화(1시간 18분 뒤)   주간 46% · 10/17 23:00 초기화(2일 5시간 뒤)', 'dim'))
    s.blank()
    s.flow(('[/명령] 실행 · [넣기] 입력창에 넣기(인자를 붙일 때) · [고정] 맨 위로 · [해제] 고정 풀기', 'dim'))
    s.blank()
    s.flow(('명령 이름이나 설명으로 검색', 'dim'), ('  ⏎ submit', 'dim'))

    def group(title, names, pinned=False):
        s.blank()
        s.flow((title, 'text b'))
        for n in names:
            desc = wrap(KO[n], 88 - 35)
            s.line((0, f'[/{n}]', 'sug'), (21, '[넣기]', 'sug'), (28, '[해제]' if pinned else '[고정]', 'warn' if pinned else 'sug'), (35, desc[0], 'dim'))
            for more in desc[1:]:
                s.line((35, more, 'dim'))

    group('고정한 명령', ['compact', 'context', 'rewind'], pinned=True)
    group('대화 · 세션', ['resume', 'rename', 'background'])
    group('스킬 · 개발 방법', ['tdd', 'diagnosing-bugs'])
    return s


# ---------- 3. 세션 패널 ----------
def sessions():
    s = Screen(88)
    s.line((0, '대화 24개', 'text b'), (10, '· 켜짐 3', 'dim'), (19, '작업 중 1', 'succ'), (29, '입력 필요 1', 'warn'),
           (41, '대기 중 1', 'dim'), (51, '· 유휴 21', 'dim'), (70, '[다시 읽기] [닫기]', 'sug'))
    s.flow(('보기 ', 'dim'), ('[ 폴더별 ]', 'text b'), (' [날짜별]', 'sug'), (' │ 상태 ', 'dim'), ('[ 전체 ]', 'text b'),
           (' [켜짐] [유휴]', 'sug'), (' │ ', 'dim'), ('[보관함 0]', 'sug'))

    def row(action, state, kind, name, manage='[관리]'):
        a, a_style = action
        st, st_style = state
        k, k_style = kind
        n, n_style = name
        s.line((0, a, a_style), (9, st, st_style), (20, k, k_style), (32, n, n_style), (82, manage, 'warn' if manage == '[접기]' else 'sug'))

    s.blank()
    s.line((0, '고정 2개', 'text b'), (9, '(켜짐 1 · 유휴 1)', 'dim'))
    row(('[이동]', 'sug'), ('작업 중', 'succ'), ('백그라운드', 'sug'), ('결제 API 리팩터링', 'text u'))
    row(('[열기]', 'sug'), ('2시간 전', 'dim'), ('유휴', 'dim'), ('배포 체크리스트', 'text'))
    s.blank()
    s.line((0, 'D:\\work\\shop-api', 'text b'), (17, '9개 (켜짐 2 · 유휴 7)', 'dim'))
    row(('이 대화', 'sug b'), ('입력 필요', 'warn'), ('포그라운드', 'warn'), ('주간 보고서 작성', 'text b u'))
    row(('[이동]', 'sug'), ('대기 중', 'dim'), ('백그라운드', 'sug'), ('로그인 버그 수정', 'text u'), manage='[접기]')
    s.line((9, '[고정] [이름 고치기] [보관] [끄기]', 'sug'))
    row(('[열기]', 'sug'), ('35분 전', 'dim'), ('유휴', 'dim'), ('테스트 커버리지 점검', 'text'))
    row(('[열기]', 'sug'), ('1일 전', 'dim'), ('유휴', 'dim'), ('README 정리', 'text'))
    s.line((9, '[유휴 5개 더 보기]', 'sug'))
    s.blank()
    s.line((0, 'D:\\work\\docs', 'text b'), (13, '4개 (켜짐 0 · 유휴 4)', 'dim'))
    row(('[열기]', 'sug'), ('3일 전', 'dim'), ('유휴', 'dim'), ('API 문서 개편', 'text'))
    row(('[열기]', 'sug'), ('5일 전', 'dim'), ('유휴', 'dim'), ('온보딩 가이드 초안', 'text'))
    s.blank()
    s.flow(('[설명]', 'sug'), (' Claude Code 기본 목록 ', 'dim'), ('[resume]', 'sug'), (' · Esc · Ctrl+X X로 닫기', 'dim'))
    return s


for name, build, title in [('hero', hero, '~/shop-api — claude'), ('palette', palette, '명령 팔레트 — /palette'), ('sessions', sessions, '세션 패널 — /sessions')]:
    scr = build()
    for theme in THEMES:
        render(scr, theme, title, os.path.join(OUT, f'{name}-{theme}.svg'))
        print('wrote', f'{name}-{theme}.svg', os.path.getsize(os.path.join(OUT, f'{name}-{theme}.svg')), 'bytes')
