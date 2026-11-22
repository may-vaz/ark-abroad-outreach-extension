# Renders each text resume fixture into real PDFs with different visual layouts, to test the full
# PDF → text → parse pipeline. Run: python3 tests/make_resume_pdfs.py
import re, os, glob
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
HERE = os.path.dirname(__file__)
SRC = os.path.join(HERE, 'fixtures', 'resumes'); OUT = os.path.join(HERE, 'fixtures', 'resume-pdfs')
W, H = A4
DATE = re.compile(r'((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s*)?(19|20)\d{2}\s*(–|-|to)\s*(((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s*)?(19|20)\d{2}|Present|present)\s*$')
HEAD = re.compile(r'^(EXPERIENCE|PROFESSIONAL EXPERIENCE|WORK EXPERIENCE|Experience|Work History|Internships|EDUCATION|Education|SKILLS|TECHNICAL SKILLS|Skills|Summary|Projects)$')

def simple(lines, c):
    y = H - 50
    for l in lines:
        bold = bool(HEAD.match(l.strip())) or l is lines[0]
        c.setFont('Helvetica-Bold' if bold else 'Helvetica', 14 if l is lines[0] else 10.5)
        x = 50
        for i, seg in enumerate(re.split(r'\t|\s{3,}', l)):
            seg = seg.strip(); c.drawString(x, y, seg); x += c.stringWidth(seg, 'Helvetica', 10.5) + 45
        y -= 15

def right_dates(lines, c):
    y = H - 50
    for l in lines:
        s = l.strip(); m = DATE.search(s)
        bold = bool(HEAD.match(s)) or l is lines[0]
        c.setFont('Helvetica-Bold' if bold else 'Helvetica', 14 if l is lines[0] else 10.5)
        if HEAD.match(s): y -= 6; c.line(50, y - 3, W - 50, y - 3)
        if m and not s.startswith(m.group(0)):
            left = re.sub(r'[\s|,–-]+$', '', s[:m.start()])
            c.drawString(50, y, left); c.setFont('Helvetica-Oblique', 10); c.drawRightString(W - 50, y, m.group(0).strip())
        else:
            c.drawString(50 if not s.startswith(('•', '-')) else 62, y, re.sub(r'\t|\s{3,}', '   ', s))
        y -= 15

def two_column(lines, c):
    # header full width; Education + Skills in a left sidebar; everything else on the right
    sec, blocks, cur = None, {'header': []}, 'header'
    for l in lines:
        if HEAD.match(l.strip()): cur = l.strip(); blocks[cur] = []; continue
        blocks[cur].append(l)
    y = H - 50
    for l in blocks['header']:
        c.setFont('Helvetica-Bold' if l is lines[0] else 'Helvetica', 14 if l is lines[0] else 10); c.drawString(50, y, l.strip()); y -= 15
    top = y - 10
    yl, yr = top, top
    for name, body in blocks.items():
        if name == 'header': continue
        left = name.lower().startswith(('education', 'skills', 'technical skills'))
        x, width = (50, 150) if left else (230, 315)
        yy = yl if left else yr
        c.setFont('Helvetica-Bold', 11); c.drawString(x, yy, name); yy -= 15
        c.setFont('Helvetica', 9.5)
        for l in body:
            words, cur_line = re.sub(r'\t|\s{3,}', ' ', l.strip()).split(' '), ''
            for w in words:
                if c.stringWidth(cur_line + ' ' + w, 'Helvetica', 9.5) > width and cur_line:
                    c.drawString(x, yy, cur_line); yy -= 13; cur_line = w
                else: cur_line = (cur_line + ' ' + w).strip()
            if cur_line: c.drawString(x, yy, cur_line); yy -= 13
        yy -= 6
        if left: yl = yy
        else: yr = yy

for f in sorted(glob.glob(os.path.join(SRC, '*.txt'))):
    lines = [l.rstrip('\n') for l in open(f, encoding='utf8') if l.strip()]
    base = os.path.basename(f)[:-4]
    for style, fn in (('simple', simple), ('right-dates', right_dates), ('two-column', two_column)):
        c = canvas.Canvas(os.path.join(OUT, f'{base}.{style}.pdf'), pagesize=A4); fn(lines, c); c.save()
print('ok')
