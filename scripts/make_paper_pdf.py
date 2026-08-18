#!/usr/bin/env python3
"""
make_paper_pdf.py — Generate a formatted PDF from a generated question-paper .txt file.

Usage:
    python make_paper_pdf.py <paper-name>
    python make_paper_pdf.py clat_web_gen
    python make_paper_pdf.py clat_web_gen.txt
    python make_paper_pdf.py "C:\\path\\to\\some_paper.txt"
    python make_paper_pdf.py clat_web_gen -o "C:\\out\\my.pdf"
    python make_paper_pdf.py clat_web_gen --title "CLAT Mock 3"

Resolution of <paper-name>:
    1. If it is an existing file path, use it directly.
    2. Otherwise search BASE_DIR (temp/confirmed-questions) recursively for a
       .txt whose filename (with or without extension) matches — exact stem
       first, then case-insensitive, then substring. If several match you get
       a list to choose from.

Output: <paper-name>.pdf written next to the source .txt (override with -o).

The .txt is a sequence of section blocks, each: a plain-text section header
followed by a JSON payload (optionally inside a ```json ... ``` fence). Two
JSON shapes are supported:
    - an array of question objects, and/or passage groups
      ({passage/paragraph, questions:[...]});
    - a caselet object {exam_section, caselets:[{passage, title, questions}]}.
Options may be an array of "A) ..." strings or an {"A": "...", ...} object.
"""
import argparse
import html
import json
import os
import re
import sys

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (KeepTogether, PageBreak, Paragraph,
                                SimpleDocTemplate, Spacer, Table, TableStyle)

# temp/confirmed-questions relative to this script (scripts/ -> ../temp/...)
BASE_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)),
                 "..", "temp", "confirmed-questions")
)


# --------------------------------------------------------------------------- #
# Input resolution
# --------------------------------------------------------------------------- #
def resolve_source(name):
    """Return an absolute path to the source .txt for the given paper name."""
    # 1. Direct path (with or without .txt)
    for cand in (name, name + ".txt"):
        if os.path.isfile(cand):
            return os.path.abspath(cand)

    stem = re.sub(r"\.(txt|pdf)$", "", os.path.basename(name), flags=re.I)

    if not os.path.isdir(BASE_DIR):
        sys.exit(f"[error] search base not found: {BASE_DIR}\n"
                 f"        Pass a full path to the .txt instead.")

    txts = []
    for root, _dirs, files in os.walk(BASE_DIR):
        for f in files:
            if f.lower().endswith(".txt"):
                txts.append(os.path.join(root, f))

    def s(p):  # filename stem, lowercased
        return re.sub(r"\.txt$", "", os.path.basename(p), flags=re.I).lower()

    exact = [p for p in txts if s(p) == stem.lower()]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        _fail_multi(stem, exact)

    partial = [p for p in txts if stem.lower() in s(p)]
    if len(partial) == 1:
        return partial[0]
    if len(partial) > 1:
        _fail_multi(stem, partial)

    sys.exit(f"[error] no .txt matching '{name}' under {BASE_DIR}")


def _fail_multi(stem, matches):
    lines = "\n".join(f"    - {os.path.relpath(m, BASE_DIR)}" for m in matches)
    sys.exit(f"[error] '{stem}' matches several files; be more specific:\n{lines}")


# --------------------------------------------------------------------------- #
# Parsing:  .txt  ->  [(section_name, groups)]
# --------------------------------------------------------------------------- #
def _json_end(lines, start):
    """Given a line index whose stripped content is '[' or '{', bracket-match
    (string-aware) and return (json_text, end_line_index_inclusive)."""
    depth = 0
    in_str = False
    esc = False
    buf = []
    j = start
    n = len(lines)
    while j < n:
        for ch in lines[j] + "\n":
            buf.append(ch)
            if esc:
                esc = False
                continue
            if ch == "\\":
                esc = True
                continue
            if ch == '"':
                in_str = not in_str
                continue
            if in_str:
                continue
            if ch in "[{":
                depth += 1
            elif ch in "]}":
                depth -= 1
                if depth == 0:
                    return "".join(buf), j
        j += 1
    return "".join(buf), n - 1


def parse_sections(raw):
    """Parse the file into a list of (section_title, parsed_json)."""
    lines = raw.split("\n")
    n = len(lines)
    parsed = []
    prev = 0
    i = 0
    while i < n:
        if lines[i].strip() in ("[", "{"):
            header = [l.strip() for l in lines[prev:i]
                      if l.strip() and not l.strip().startswith("```")]
            title = " ".join(header).strip()
            text, end = _json_end(lines, i)
            try:
                data = json.loads(text)
            except json.JSONDecodeError as e:
                sys.exit(f"[error] JSON parse failed near line {i + 1}: {e}")
            parsed.append((title, data))
            prev = end + 1
            i = end + 1
        else:
            i += 1
    return parsed


# --- Plain-text format fallback --------------------------------------------- #
#   ==========
#   Topic: ...
#   Section: <name> (<count>)
#   ==========
#   --- Question 1 ---
#   <question text, possibly multi-line>
#   A) ...   B) ...   C) ...   D) ...
#   Correct: D
#   Explanation: ...
_Q_MARKER = re.compile(r"^\s*-{2,}\s*Question\b.*-{2,}\s*$", re.I)
_OPT_LINE = re.compile(r"^\s*([A-Da-d])[\).]\s*(.*)$")
_CORRECT = re.compile(r"^\s*correct(?:\s*answer)?\s*[:\-]\s*(.+)$", re.I)
_EXPLAIN = re.compile(r"^\s*explanation\s*[:\-]\s*(.*)$", re.I)
_SECTION = re.compile(r"^\s*Section\s*[:\-]\s*(.+)$", re.I)
_TOPIC = re.compile(r"^\s*Topic\s*[:\-]\s*(.+)$", re.I)


def parse_plaintext(raw):
    """Parse the '--- Question N ---' plain-text export into one section."""
    lines = raw.split("\n")
    # Section name from header
    name = ""
    for l in lines[:12]:
        m = _SECTION.match(l)
        if m:
            name = re.sub(r"\s*\(\d+\)\s*$", "", m.group(1)).strip()
            break
        m = _TOPIC.match(l)
        if m and not name:
            name = m.group(1).strip()

    # Split into per-question blocks on the marker
    blocks, cur, started = [], [], False
    for l in lines:
        if _Q_MARKER.match(l):
            if started:
                blocks.append(cur)
            cur, started = [], True
            continue
        if started:
            cur.append(l)
    if started:
        blocks.append(cur)

    questions = []
    for blk in blocks:
        qtext_lines, options, answer, expl_lines = [], [], None, []
        mode = "q"
        for l in blk:
            if _CORRECT.match(l):
                answer = _CORRECT.match(l).group(1).strip()
                mode = "after"
                continue
            m = _EXPLAIN.match(l)
            if m:
                expl_lines.append(m.group(1))
                mode = "expl"
                continue
            mo = _OPT_LINE.match(l)
            if mo and mode in ("q", "opt") and len(mo.group(1)) == 1:
                options.append((mo.group(1).upper(), mo.group(2).strip()))
                mode = "opt"
                continue
            if mode == "q":
                qtext_lines.append(l)
            elif mode == "expl":
                expl_lines.append(l)
        qtext = "\n".join(qtext_lines).strip()
        if not qtext and not options:
            continue
        questions.append({
            "question": qtext,
            # store options already in (letter, text) form via a marker key
            "_options_pairs": options,
            "correct_answer": (answer or "").strip("() ").upper()[:1] or None,
            "explanation": "\n".join(expl_lines).strip(),
        })
    return [(name or "Questions", questions)]


def load_sections(raw):
    """Return [(section_name, groups)] from either the JSON or plain-text format."""
    parsed = parse_sections(raw)
    if parsed:
        return [normalize(t, d) for t, d in parsed]
    # Fallback: plain-text export
    plain = parse_plaintext(raw)
    if any(qs for _, qs in plain):
        return [(name, [make_group(None, None, [q]) for q in qs])
                for name, qs in plain]
    sys.exit("[error] could not parse the file as JSON or plain-text questions.")


# --------------------------------------------------------------------------- #
# Normalization:  parsed json  ->  groups
#   group = {passage, passage_title, questions:[{qnum,question,options,answer,
#                                                explanation,skill}]}
# --------------------------------------------------------------------------- #
def split_array_opts(opts):
    out = []
    for o in opts:
        m = re.match(r"^\s*([A-Da-d])[\).]\s*(.*)$", str(o), re.S)
        out.append((m.group(1).upper(), m.group(2)) if m else ("", str(o)))
    return out


def parse_question(q):
    if "_options_pairs" in q:                       # plain-text: already (letter, text)
        olist = q["_options_pairs"]
    else:
        opts = q.get("options", [])
        if isinstance(opts, dict):
            olist = [(k, v) for k, v in opts.items()]
        else:
            olist = split_array_opts(opts)
    return dict(
        qnum=q.get("question_number"),
        question=q.get("question_text") or q.get("question"),
        options=olist,
        answer=q.get("correct_answer"),
        explanation=q.get("explanation"),
        skill=q.get("skill_tag"),
    )


def make_group(passage, passage_title, questions):
    return dict(passage=passage, passage_title=passage_title,
                questions=[parse_question(q) for q in questions])


def normalize(title, data):
    """Return (section_name, groups)."""
    groups = []
    if isinstance(data, dict) and "caselets" in data:
        name = data.get("exam_section", title)
        for cl in data["caselets"]:
            groups.append(make_group(cl.get("passage"), cl.get("title"),
                                     cl["questions"]))
        return name, groups
    name = title
    for el in data:
        if isinstance(el, dict) and "questions" in el:
            groups.append(make_group(
                el.get("passage") or el.get("paragraph") or el.get("passageText"),
                el.get("passage_title") or el.get("title"),
                el["questions"],
            ))
        else:
            groups.append(make_group(None, None, [el]))
    return name, groups


# --------------------------------------------------------------------------- #
# PDF rendering
# --------------------------------------------------------------------------- #
def esc(t):
    return html.escape(str(t)).replace("\n", "<br/>")


def qcount(groups):
    return sum(len(g["questions"]) for g in groups)


def build_pdf(sections, out_path, title, subtitle):
    styles = getSampleStyleSheet()
    BLUE = colors.HexColor("#1a3c6e")
    ACCENT = colors.HexColor("#2a6bc4")
    LIGHT = colors.HexColor("#eef3fb")
    GREEN = colors.HexColor("#1b7f3b")
    GREY = colors.HexColor("#555555")

    st_title = ParagraphStyle("t", parent=styles["Title"], fontSize=26,
                              textColor=BLUE, spaceAfter=6, leading=30)
    st_sub = ParagraphStyle("sub", parent=styles["Normal"], fontSize=12,
                            textColor=GREY, alignment=1, spaceAfter=2)
    st_section = ParagraphStyle("sec", parent=styles["Heading1"], fontSize=17,
                                textColor=colors.white, spaceAfter=0,
                                spaceBefore=0, leading=21)
    st_passage_t = ParagraphStyle("pt", parent=styles["Normal"], fontSize=11,
                                  textColor=BLUE, fontName="Helvetica-Bold",
                                  spaceAfter=3)
    st_passage = ParagraphStyle("p", parent=styles["Normal"], fontSize=10,
                                textColor=colors.HexColor("#333333"),
                                leading=14, spaceAfter=4)
    st_q = ParagraphStyle("q", parent=styles["Normal"], fontSize=10.5,
                          leading=15, fontName="Helvetica-Bold", spaceAfter=5,
                          textColor=colors.HexColor("#1c1c1c"))
    st_opt = ParagraphStyle("o", parent=styles["Normal"], fontSize=10,
                            leading=14, leftIndent=14, spaceAfter=2)
    st_opt_c = ParagraphStyle("oc", parent=st_opt, textColor=GREEN,
                              fontName="Helvetica-Bold")
    st_ans = ParagraphStyle("a", parent=styles["Normal"], fontSize=9.5,
                            leading=13, textColor=GREEN,
                            fontName="Helvetica-Bold", spaceBefore=3)
    st_exp = ParagraphStyle("e", parent=styles["Normal"], fontSize=9,
                            leading=13, textColor=GREY, leftIndent=6,
                            spaceAfter=2)
    st_skill = ParagraphStyle("sk", parent=styles["Normal"], fontSize=8,
                              textColor=ACCENT, fontName="Helvetica-Oblique",
                              spaceAfter=2)

    story = []
    total_q = sum(qcount(g) for _, g in sections)

    # Cover
    story.append(Spacer(1, 60))
    story.append(Paragraph(esc(title), st_title))
    if subtitle:
        story.append(Paragraph(esc(subtitle), st_sub))
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        f"{len(sections)} Sections &nbsp;&bull;&nbsp; {total_q} "
        f"Questions with Answers &amp; Explanations", st_sub))
    story.append(Spacer(1, 20))

    toc_rows = [["#", "Section", "Questions"]]
    for i, (name, groups) in enumerate(sections, 1):
        toc_rows.append([str(i), name or f"Section {i}", str(qcount(groups))])
    toc = Table(toc_rows, colWidths=[15 * mm, 110 * mm, 30 * mm], hAlign="CENTER")
    toc.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#c9d6ea")),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("ALIGN", (2, 0), (2, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (1, 0), (1, -1), 8),
    ]))
    story.append(toc)
    story.append(PageBreak())

    def section_header(name):
        t = Table([[Paragraph(esc(name), st_section)]], colWidths=[170 * mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), BLUE),
            ("LEFTPADDING", (0, 0), (-1, -1), 12),
            ("RIGHTPADDING", (0, 0), (-1, -1), 12),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ]))
        return t

    def render_passage(title_text, passage_text):
        flow = []
        if title_text:
            flow.append(Paragraph(esc(title_text), st_passage_t))
        pcell = Table([[Paragraph(esc(passage_text), st_passage)]],
                      colWidths=[164 * mm])
        pcell.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
            ("BOX", (0, 0), (-1, -1), 0.5, ACCENT),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        flow.append(pcell)
        flow.append(Spacer(1, 6))
        return flow

    def render_question(it, seq):
        block = []
        if it["skill"]:
            block.append(Paragraph("Skill: " + esc(it["skill"]), st_skill))
        qtext = it["question"] or ""
        if not re.match(r"^\s*\d+[\).]", qtext):
            prefix = f"Q{it['qnum']}. " if it["qnum"] else f"Q{seq}. "
            qtext = prefix + qtext
        block.append(Paragraph(esc(qtext), st_q))
        for letter, otext in it["options"]:
            is_correct = it["answer"] and letter.upper() == str(it["answer"]).upper()
            label = f"<b>{letter})</b> " if letter else ""
            mark = " &#10003;" if is_correct else ""
            block.append(Paragraph(label + esc(otext) + mark,
                                   st_opt_c if is_correct else st_opt))
        if it["answer"]:
            block.append(Paragraph("Correct Answer: " + esc(it["answer"]), st_ans))
        if it["explanation"]:
            block.append(Paragraph("<b>Explanation:</b> " + esc(it["explanation"]),
                                   st_exp))
        block.append(Spacer(1, 12))
        return block

    for si, (name, groups) in enumerate(sections):
        if si > 0:
            story.append(PageBreak())
        story.append(section_header(name or f"Section {si + 1}"))
        story.append(Spacer(1, 10))
        seq = 0
        for grp in groups:
            qs = grp["questions"]
            if not qs:
                continue
            if grp["passage"]:
                n = len(qs)
                span = f"  (Questions {seq + 1}–{seq + n})" if n > 1 else ""
                ptitle = (grp["passage_title"] or "Passage") + span
                first = render_passage(ptitle, grp["passage"])
                seq += 1
                first += render_question(qs[0], seq)
                story.append(KeepTogether(first))
                for q in qs[1:]:
                    seq += 1
                    story.append(KeepTogether(render_question(q, seq)))
            else:
                seq += 1
                story.append(KeepTogether(render_question(qs[0], seq)))

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(GREY)
        canvas.drawString(20 * mm, 12 * mm, title)
        canvas.drawRightString(190 * mm, 12 * mm, "Page %d" % doc.page)
        canvas.setStrokeColor(colors.HexColor("#c9d6ea"))
        canvas.line(20 * mm, 15 * mm, 190 * mm, 15 * mm)
        canvas.restoreState()

    doc = SimpleDocTemplate(out_path, pagesize=A4,
                            leftMargin=20 * mm, rightMargin=20 * mm,
                            topMargin=18 * mm, bottomMargin=20 * mm,
                            title=title)
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return total_q


# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser(
        description="Generate a formatted PDF from a question-paper .txt file.")
    ap.add_argument("paper", help="Paper name (e.g. clat_web_gen) or path to a .txt")
    ap.add_argument("-o", "--out", help="Output PDF path (default: <source>.pdf)")
    ap.add_argument("--title", help="Cover/footer title (default: from filename)")
    ap.add_argument("--subtitle",
                    default="Competitive › LAW › CLAT",
                    help="Cover subtitle line")
    args = ap.parse_args()

    src = resolve_source(args.paper)
    out = args.out or os.path.splitext(src)[0] + ".pdf"
    title = args.title or os.path.splitext(os.path.basename(src))[0].replace("_", " ").title()

    raw = open(src, encoding="utf-8").read()
    sections = load_sections(raw)

    total = build_pdf(sections, out, title, args.subtitle)

    print(f"[ok] source : {src}")
    print(f"[ok] output : {out}")
    print(f"[ok] sections/questions: "
          f"{[(n or '?', qcount(g)) for n, g in sections]}  total={total}")


if __name__ == "__main__":
    main()
