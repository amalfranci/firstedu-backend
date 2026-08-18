#!/usr/bin/env python3
"""
txt_to_pdf.py — Convert exam-question .txt files into a formatted PDF.

Supports TWO input formats automatically:

FORMAT 1 — generator/spec format (original):
    Question 1 [medium]
    Type: single
    Stem: What is the capital of France?
      A. Berlin
      B. Madrid
      C. Paris
      D. Rome
    Correct: C
    Explanation: Paris has been the capital of France since ...

FORMAT 2 — confirmed-questions log format:
    --- Question 1 ---
    <stem text on the next line(s) until options appear>

    A) Berlin
    B) Madrid
    C) Paris
    D) Rome

    Correct: C
    Explanation: Paris has been the capital of France since ...

Both formats support single / multiple / true_false question types.
For "multiple" (2 correct answers) use a comma-separated key: "Correct: A, C"

USAGE
-----
    python txt_to_pdf.py chemistry.txt physics.txt maths.txt \
        -o exam_paper.pdf -t "JEE Advanced — Full Sample Paper"

Requires: reportlab   (pip install reportlab)
"""

import argparse
import re
import sys
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (HRFlowable, PageBreak, Paragraph,
                                 SimpleDocTemplate, Spacer, Table, TableStyle)

LETTERS = ["A", "B", "C", "D", "E", "F"]
LETTER_TO_IDX = {L: i for i, L in enumerate(LETTERS)}

# ---------------------------------------------------------------------------
# Font registration
# ---------------------------------------------------------------------------

def register_fonts():
    candidates = [
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        ("C:/Windows/Fonts/arial.ttf",    "C:/Windows/Fonts/arialbd.ttf"),
        ("C:/Windows/Fonts/segoeui.ttf",  "C:/Windows/Fonts/segoeuib.ttf"),
    ]
    for regular, bold in candidates:
        if Path(regular).exists() and Path(bold).exists():
            pdfmetrics.registerFont(TTFont("Body", regular))
            pdfmetrics.registerFont(TTFont("Body-Bold", bold))
            return "Body", "Body-Bold"
    return "Helvetica", "Helvetica-Bold"


BASE_FONT, BOLD_FONT = register_fonts()

TYPE_LABELS = {
    "single":    "Single Correct",
    "multiple":  "Multiple Correct",
    "true_false":"True / False",
    "connected": "Passage-Based",
}

# ---------------------------------------------------------------------------
# Format detection & parsing
# ---------------------------------------------------------------------------

def detect_format(text):
    """Return 'log' if the file uses --- Question N --- style, else 'spec'."""
    if re.search(r'---\s*Question\s+\d+\s*---', text):
        return 'log'
    return 'spec'


def strip_trailing_junk(text):
    cut = []
    m = re.search(r'\nRaw JSON', text)
    if m:
        cut.append(m.start())
    for m in re.finditer(r'\n={20,}', text):
        if re.search(r'Question\s+\d+', text[:m.start()]):
            cut.append(m.start())
            break
    return text[:min(cut)] if cut else text


def _make_question(stem, options, correct_letters, explanation, qtype=None):
    """Build the canonical question dict shared by both parsers."""
    correct_indexes = [LETTER_TO_IDX[l] for l in correct_letters if l in LETTER_TO_IDX]
    if not correct_indexes:
        return None
    if qtype is None:
        if len(correct_indexes) > 1:
            qtype = "multiple"
        elif len(options) == 2:
            qtype = "true_false"
        else:
            qtype = "single"
    if qtype not in TYPE_LABELS:
        qtype = "single"
    return {
        "q":         escape(stem),
        "options":   [escape(o) for o in options],
        "correct":   correct_indexes,
        "exp":       escape(explanation),
        "type":      qtype,
    }


# ---- FORMAT 1: spec format (Question N [diff] / Stem: / A. B. C.) ----------

_SPEC_SPLIT    = re.compile(r'\n(?=Question\s+\d+\b)')
_SPEC_STEM     = re.compile(r'Stem:\s*(.+?)\n\s*[A-F]\.', re.S)
_SPEC_OPTION   = re.compile(r'^\s*([A-F])\.\s*(.+)$', re.M)
_SPEC_CORRECT  = re.compile(r'Correct:\s*([A-F](?:\s*,\s*[A-F])*)')
_SPEC_EXP      = re.compile(r'Explanation:\s*(.+)$', re.S)
_SPEC_TYPE     = re.compile(r'Type:\s*(\S+)')


def parse_spec(text):
    text = strip_trailing_junk(text)
    questions = []
    for block in _SPEC_SPLIT.split(text.strip()):
        if not re.match(r'Question\s+\d+\b', block):
            continue
        stem_m    = _SPEC_STEM.search(block)
        correct_m = _SPEC_CORRECT.search(block)
        if not stem_m or not correct_m:
            continue
        stem    = stem_m.group(1).strip()
        options = [o.strip() for _, o in _SPEC_OPTION.findall(block)]
        letters = [l.strip() for l in correct_m.group(1).split(',')]
        exp_m   = _SPEC_EXP.search(block)
        exp     = exp_m.group(1).strip() if exp_m else ""
        type_m  = _SPEC_TYPE.search(block)
        qtype   = type_m.group(1).strip().lower() if type_m else None
        q = _make_question(stem, options, letters, exp, qtype)
        if q:
            questions.append(q)
    return questions


# ---- FORMAT 2: log format (--- Question N --- / A) B) C) D) style) ---------

_LOG_SPLIT   = re.compile(r'(?=--- Question\s+\d+\s*---)')
_LOG_OPTION  = re.compile(r'^\s*([A-F])\)\s*(.+)$', re.M)
_LOG_CORRECT = re.compile(r'Correct:\s*([A-F](?:\s*,\s*[A-F])*)')
_LOG_EXP     = re.compile(r'Explanation:\s*(.+)$', re.S)


def parse_log(text):
    text = strip_trailing_junk(text)
    questions = []
    for block in _LOG_SPLIT.split(text):
        if not re.match(r'--- Question\s+\d+', block):
            continue
        # Strip the "--- Question N ---" header line
        body = re.sub(r'^---\s*Question\s+\d+\s*---\s*\n?', '', block).strip()

        correct_m = _LOG_CORRECT.search(body)
        if not correct_m:
            continue

        # Options: everything matching "A) ..." lines
        options_found = _LOG_OPTION.findall(body)
        if not options_found:
            continue
        options = [o.strip() for _, o in options_found]

        # Stem: everything before the first option line
        first_opt_pos = re.search(r'^\s*[A-F]\)', body, re.M)
        stem = body[:first_opt_pos.start()].strip() if first_opt_pos else body.strip()

        letters = [l.strip() for l in correct_m.group(1).split(',')]
        exp_m   = _LOG_EXP.search(body)
        exp     = exp_m.group(1).strip() if exp_m else ""
        # Trim the duplicate "Therefore, the correct answer is X." tail added by the pipeline
        exp = re.sub(r'(\. Therefore, the correct answer is [^.]+\.)\s*\1\s*$', r'\1', exp).strip()

        q = _make_question(stem, options, letters, exp)
        if q:
            questions.append(q)
    return questions


def parse_questions(text):
    fmt = detect_format(text)
    return parse_log(text) if fmt == 'log' else parse_spec(text)


def derive_section_title(file_path, raw_text):
    # Try "Section: SubjectName (N)" line first — most specific
    m = re.search(r'^Section:\s*(.+?)(?:\s*\(\d+\))?\s*$', raw_text, re.M)
    if m:
        return m.group(1).strip()
    # Try "Topic: ..." line (log format)
    m = re.search(r'^Topic:\s*(.+)$', raw_text, re.M)
    if m:
        # "Competitive › Engineering › JEE Mains › Physics 15-07-26" -> "Physics"
        parts = re.split(r'\s*[›>|]\s*', m.group(1).strip())
        last = parts[-1].strip() if parts else m.group(1).strip()
        # Strip trailing date/timestamp like "15-07-26" or "15-06-26"
        last = re.sub(r'\s+\d{2}-\d{2}-\d{2,4}\s*$', '', last).strip()
        return last if last else m.group(1).strip()
    # Try first non-empty, non-separator line
    for line in raw_text.strip().splitlines():
        line = line.strip()
        if line and not re.match(r'^[=\-*]+$', line) and not re.match(r'Question\s+\d+', line):
            parts = re.split(r'\s+[—-]\s+', line)
            return parts[-1].strip() if len(parts) > 1 else line
    return file_path.stem.replace("_", " ").title()


# ---------------------------------------------------------------------------
# PDF styling
# ---------------------------------------------------------------------------

def build_styles():
    styles = getSampleStyleSheet()
    s = {}
    s["title"] = ParagraphStyle('TitleStyle', parent=styles['Title'], fontSize=20,
                                 fontName=BOLD_FONT, spaceAfter=4,
                                 textColor=colors.HexColor("#1a1a2e"))
    s["subtitle"] = ParagraphStyle('SubtitleStyle', parent=styles['Normal'], fontSize=11,
                                    fontName=BASE_FONT, alignment=TA_CENTER,
                                    textColor=colors.HexColor("#555555"), spaceAfter=2)
    s["section"] = ParagraphStyle('SectionStyle', fontSize=16, fontName=BOLD_FONT,
                                   textColor=colors.white, spaceBefore=0, spaceAfter=0,
                                   alignment=TA_LEFT, leading=20)
    s["qnum"] = ParagraphStyle('QNum', fontSize=11.5, fontName=BOLD_FONT,
                                textColor=colors.HexColor("#1a1a2e"), spaceAfter=4)
    s["question"] = ParagraphStyle('Question', fontSize=11, fontName=BASE_FONT, leading=15,
                                    spaceAfter=8, textColor=colors.HexColor("#222222"))
    s["option"] = ParagraphStyle('Option', fontSize=10.5, fontName=BASE_FONT, leading=14,
                                  leftIndent=14, spaceAfter=3,
                                  textColor=colors.HexColor("#333333"))
    s["option_correct"] = ParagraphStyle('OptionCorrect', parent=s["option"],
                                          fontName=BOLD_FONT,
                                          textColor=colors.HexColor("#0a7a3d"),
                                          backColor=colors.HexColor("#e8f8ee"))
    s["answer"] = ParagraphStyle('Answer', fontSize=10.5, fontName=BOLD_FONT, leading=14,
                                  spaceBefore=6, spaceAfter=3,
                                  textColor=colors.HexColor("#0a7a3d"))
    s["expl_label"] = ParagraphStyle('ExplLabel', fontSize=10.5, fontName=BOLD_FONT,
                                      textColor=colors.HexColor("#1a1a2e"))
    s["explanation"] = ParagraphStyle('Explanation', fontSize=10, fontName=BASE_FONT,
                                       leading=14, textColor=colors.HexColor("#444444"),
                                       leftIndent=6, spaceAfter=2)
    s["passage"] = ParagraphStyle('Passage', fontSize=10.5, fontName=BASE_FONT, leading=15,
                                   textColor=colors.HexColor("#333333"), spaceAfter=0)
    s["question_bold"] = ParagraphStyle('QuestionBold', fontSize=11, fontName=BOLD_FONT,
                                         leading=15, spaceAfter=8,
                                         textColor=colors.HexColor("#1a1a2e"))
    return s


def build_section_header(title, styles):
    t = Table([[Paragraph(escape(title), styles["section"])]], colWidths=[17 * cm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#1a1a2e")),
        ('LEFTPADDING', (0, 0), (-1, -1), 12),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    return t


def _split_passage_and_question(stem_text):
    """
    For CLAT-style stems: split the passage paragraph(s) from the final
    question sentence. The question sentence is the last sentence that
    ends with '?' or starts with a known interrogative/directive keyword.
    Returns (passage_text, question_text). If no split is found, returns
    ("", stem_text) so the whole thing renders as a plain question.
    """
    # Decode HTML entities back for splitting logic
    raw = stem_text.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&#39;', "'").replace('&quot;', '"')

    # Split into sentences on '. ' or '? ' boundaries, keeping delimiters
    sentences = re.split(r'(?<=[.?!])\s+', raw.strip())
    if len(sentences) < 2:
        return "", stem_text

    # The question sentence is the last sentence that ends with '?'
    # or starts with a directive phrase
    DIRECTIVES = re.compile(
        r'^(which\b|what\b|how\b|why\b|determine\b|identify\b|analyze\b|'
        r'analyse\b|calculate\b|select\b|choose\b|find\b|state\b|'
        r'as used\b|based on\b|according to\b)',
        re.I
    )

    # Walk backwards to find the question sentence
    split_at = None
    for i in range(len(sentences) - 1, 0, -1):
        s = sentences[i].strip()
        if s.endswith('?') or DIRECTIVES.match(s):
            split_at = i
            break

    if split_at is None:
        # Last sentence is always the question as fallback
        split_at = len(sentences) - 1

    passage = ' '.join(sentences[:split_at]).strip()
    question = ' '.join(sentences[split_at:]).strip()

    # Re-escape for XML/reportlab
    return escape(passage), escape(question)


def build_question_block(idx, item, styles):
    qtype = item.get("type", "single")
    correct_set = set(item["correct"])
    type_label = TYPE_LABELS.get(qtype, "Single Correct")
    stem = item["q"]

    # Detect if this looks like a passage-based question (long stem with
    # multiple sentences — characteristic of CLAT / reading comprehension)
    passage, question_sentence = _split_passage_and_question(stem)
    is_passage = bool(passage) and len(passage) > 120

    story = [
        Paragraph(
            f"Q{idx}.&nbsp;&nbsp;<font size=8.5 color='#777777'>[{type_label}]</font>",
            styles["qnum"]
        ),
    ]

    if is_passage:
        # Passage in a shaded box
        passage_table = Table(
            [[Paragraph(passage, styles["passage"])]],
            colWidths=[17 * cm]
        )
        passage_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#f5f5f0")),
            ('BOX',        (0, 0), (-1, -1), 0.8, colors.HexColor("#bbbbaa")),
            ('LEFTPADDING',  (0, 0), (-1, -1), 10),
            ('RIGHTPADDING', (0, 0), (-1, -1), 10),
            ('TOPPADDING',   (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING',(0, 0), (-1, -1), 8),
        ]))
        story.append(passage_table)
        story.append(Spacer(1, 6))
        story.append(Paragraph(question_sentence, styles["question_bold"]))
    else:
        story.append(Paragraph(stem, styles["question"]))

    for i, opt in enumerate(item["options"]):
        label = LETTERS[i]
        text = f"({label})&nbsp;&nbsp;{opt}"
        if i in correct_set:
            story.append(Paragraph(text + "&nbsp;&nbsp;&#10003;", styles["option_correct"]))
        else:
            story.append(Paragraph(text, styles["option"]))

    correct_labels = ", ".join(f"({LETTERS[i]})" for i in sorted(correct_set))
    answer_word = "Correct Answers" if len(correct_set) > 1 else "Correct Answer"
    story.append(Paragraph(f"{answer_word}: {correct_labels}", styles["answer"]))
    if item["exp"]:
        story.append(Paragraph("Explanation:", styles["expl_label"]))
        story.append(Paragraph(item["exp"], styles["explanation"]))
    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#dddddd"),
                             spaceBefore=2, spaceAfter=12))
    return story


# ---------------------------------------------------------------------------
# PDF assembly
# ---------------------------------------------------------------------------

def section_type_summary(qs):
    counts = {}
    for item in qs:
        t = item.get("type", "single")
        counts[t] = counts.get(t, 0) + 1
    order = ["single", "multiple", "true_false", "connected"]
    parts = [f"{TYPE_LABELS[t]} ({counts[t]})" for t in order if counts.get(t)]
    return ", ".join(parts) if parts else "Single Correct"


def build_pdf(sections, output_path, title, subtitle):
    styles = build_styles()
    doc = SimpleDocTemplate(output_path, pagesize=A4,
                             topMargin=1.6 * cm, bottomMargin=1.6 * cm,
                             leftMargin=1.5 * cm, rightMargin=1.5 * cm)
    story = [Paragraph(escape(title), styles["title"])]
    if subtitle:
        story.append(Paragraph(escape(subtitle), styles["subtitle"]))

    all_types = {item.get("type", "single") for _, qs in sections for item in qs}
    if all_types <= {"single"}:
        type_line = "Single Correct Answer MCQs &bull; With Explanations"
    else:
        type_line = "Single, Multiple &amp; True/False MCQs &bull; With Explanations"
    story.append(Paragraph(type_line, styles["subtitle"]))
    story.append(Spacer(1, 16))

    type_cell_style = ParagraphStyle('TypeCell', fontSize=9, fontName=BASE_FONT,
                                      leading=11.5, textColor=colors.HexColor("#333333"))

    total_q = sum(len(qs) for _, qs in sections)
    summary_data = [["Section", "No. of Questions", "Question Type"]]
    for name, qs in sections:
        summary_data.append([
            name,
            str(len(qs)),
            Paragraph(escape(section_type_summary(qs)), type_cell_style),
        ])
    summary_data.append(["Total", str(total_q), ""])

    summary_table = Table(summary_data, colWidths=[5.5 * cm, 3.5 * cm, 8 * cm])
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#1a1a2e")),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), BOLD_FONT),
        ('FONTNAME', (0, 1), (-1, -1), BASE_FONT),
        ('FONTNAME', (0, -1), (-1, -1), BOLD_FONT),
        ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor("#f0f0f5")),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
        ('ALIGN', (1, 0), (1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('FONTSIZE', (0, 0), (-1, -1), 10.5),
    ]))
    story.append(summary_table)
    story.append(PageBreak())

    for name, qs in sections:
        story.append(build_section_header(name, styles))
        story.append(Spacer(1, 14))
        for i, item in enumerate(qs, start=1):
            story.extend(build_question_block(i, item, styles))
        story.append(PageBreak())

    if story and isinstance(story[-1], PageBreak):
        story.pop()

    doc.build(story)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                      formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("inputs", nargs="+", type=Path,
                         help="One or more .txt files; each becomes a section.")
    parser.add_argument("-o", "--output", type=Path, default=Path("question_paper.pdf"),
                         help="Output PDF path (default: question_paper.pdf)")
    parser.add_argument("-t", "--title", type=str, default="Sample Question Paper",
                         help="Main title printed at the top of the PDF")
    parser.add_argument("-s", "--subtitle", type=str, default=None,
                         help="Optional subtitle line")
    args = parser.parse_args()

    sections = []
    for path in args.inputs:
        if not path.exists():
            print(f"Warning: {path} not found, skipping.", file=sys.stderr)
            continue
        raw_text = path.read_text(encoding="utf-8")
        sec_title = derive_section_title(path, raw_text)
        qs = parse_questions(raw_text)
        if not qs:
            print(f"Warning: no questions parsed from {path}, skipping.", file=sys.stderr)
            continue
        sections.append((sec_title, qs))
        print(f"Parsed {len(qs)} questions from {path.name} -> section '{sec_title}'")

    if not sections:
        print("No questions parsed from any input file. Nothing to build.", file=sys.stderr)
        sys.exit(1)

    subtitle = args.subtitle or " \u2022 ".join(name for name, _ in sections)
    build_pdf(sections, str(args.output), args.title, subtitle)
    total = sum(len(qs) for _, qs in sections)
    print(f"Done. Wrote {total} questions across {len(sections)} section(s) to {args.output}")


if __name__ == "__main__":
    main()
