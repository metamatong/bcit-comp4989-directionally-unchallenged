"""Render the editable two-page proposal and QA images.
Usage: python scripts/render_proposal.py
Uses reportlab, pypdf and pdfplumber; no external fonts or network required.
"""
from pathlib import Path
import re
from html import escape
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from pypdf import PdfReader
import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'output/pdf/proposal_groupnumber.pdf'
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
GREEN = colors.HexColor('#164d3d')
BODY = colors.HexColor('#31473a')
MUTED = colors.HexColor('#697966')
styles = {
    'title': ParagraphStyle('title', fontName='Helvetica-Bold', fontSize=28, leading=32, textColor=GREEN, spaceAfter=8),
    'subtitle': ParagraphStyle('subtitle', fontName='Helvetica', fontSize=14, leading=18, textColor=BODY, spaceAfter=13),
    'meta': ParagraphStyle('meta', fontName='Helvetica', fontSize=8.3, leading=11.5, textColor=MUTED, spaceAfter=4),
    'heading': ParagraphStyle('heading', fontName='Helvetica-Bold', fontSize=11.4, leading=14, textColor=GREEN, spaceBefore=12, spaceAfter=6, keepWithNext=True),
    'body': ParagraphStyle('body', fontName='Helvetica', fontSize=9.6, leading=12.8, textColor=BODY, spaceAfter=8, alignment=TA_LEFT),
    'reference': ParagraphStyle('reference', fontName='Helvetica', fontSize=7.2, leading=9.3, textColor=MUTED, spaceAfter=3),
}

def markup(text):
    text = escape(text.replace('→', ' > ').replace('—','-').replace('–','-').replace('“','"').replace('”','"').replace('’',"'"))
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'(https://\S+)', r'<a href="\1" color="#164d3d">\1</a>', text)
    return text

def page_chrome(canvas, doc):
    canvas.saveState()
    width, height = letter
    canvas.setFillColor(GREEN)
    canvas.rect(0, height-11, width, 11, fill=1, stroke=0)
    canvas.setFont('Helvetica-Bold', 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(49, height-36, 'CAMPUSLENS  /  COMP 4989')
    canvas.drawRightString(width-49, height-36, 'PROPOSAL DRAFT  -  15 OCT 2026')
    canvas.setStrokeColor(colors.HexColor('#dce3d5'))
    canvas.line(49, 37, width-49, 37)
    canvas.setFont('Helvetica', 7.2)
    canvas.drawString(49, 24, 'Group [NUMBER]  |  Members [NAMES / STUDENT IDS]  |  Not submitted')
    canvas.drawRightString(width-49, 24, f'{doc.page} / 2')
    canvas.restoreState()

source = (ROOT / 'docs/proposal.md').read_text()
flow = []
for block in re.split(r'\n\s*\n', source.strip()):
    if block.strip() == '---page---':
        flow.append(PageBreak())
    elif block.startswith('# '):
        flow.append(Paragraph(markup(block[2:]), styles['title']))
    elif block.startswith('## '):
        flow.append(Paragraph(markup(block[3:]), styles['subtitle']))
    elif block.startswith('### '):
        flow.append(Paragraph(markup(block[4:]), styles['heading']))
    elif block.startswith('[1]'):
        for line in block.splitlines():
            flow.append(Paragraph(markup(line), styles['reference']))
    elif block.startswith('**COMP'):
        for line in block.splitlines():
            flow.append(Paragraph(markup(line), styles['meta']))
    elif block.startswith('Sources checked'):
        flow.append(Paragraph(markup(block), styles['reference']))
    else:
        flow.append(Paragraph(markup(block), styles['body']))

SimpleDocTemplate(str(OUTPUT), pagesize=letter, rightMargin=49, leftMargin=49,
                  topMargin=57, bottomMargin=49, title='CampusLens - COMP 4989 Proposal Draft',
                  author='Group [NUMBER] - Members [NAMES]').build(flow, onFirstPage=page_chrome, onLaterPages=page_chrome)
reader = PdfReader(OUTPUT)
if len(reader.pages) != 2:
    raise RuntimeError(f'Expected exactly two pages, rendered {len(reader.pages)}. Edit the source or layout before delivery.')
qa = ROOT / 'tmp/pdfs'
qa.mkdir(parents=True, exist_ok=True)
with pdfplumber.open(OUTPUT) as pdf:
    for number, page in enumerate(pdf.pages, 1):
        page.to_image(resolution=120).save(qa / f'proposal-page-{number}.png')
print(f'Rendered {OUTPUT} (2 pages). Inspect tmp/pdfs/proposal-page-1.png and -2.png.')
