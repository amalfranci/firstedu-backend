#!/usr/bin/env python3
"""
db_to_pdf.py — Export a question bank from MongoDB directly to a PDF.

Connects to the same MongoDB Atlas instance used by the backend, finds
the question bank(s) whose name or generationTopic matches the search
term, fetches all questions, and builds a formatted PDF.

USAGE
-----
    # Search by bank name / topic (case-insensitive substring):
    python db_to_pdf.py "CLAT 2026" -o clat_paper.pdf

    # List matching banks without generating PDF:
    python db_to_pdf.py "CLAT" --list

    # Use a specific bank _id:
    python db_to_pdf.py --id 6874abc123def456 -o clat_paper.pdf

Requires:
    pip install pymongo reportlab python-dotenv
"""

import argparse
import os
import re
import sys
from pathlib import Path
from xml.sax.saxutils import escape

# Windows consoles default stdout/stderr to cp1252, which can't encode the
# Unicode arrows/bullets this script prints (e.g. "Building PDF → ..."),
# crashing before the PDF is ever built. UTF-8 handles all of them.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

# ---- MongoDB (pymongo) ----
try:
    from pymongo import MongoClient
    from bson import ObjectId
except ImportError:
    print("pymongo not installed. Run: pip install pymongo", file=sys.stderr)
    sys.exit(1)

# ---- PDF (reportlab) ----
try:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import cm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import (HRFlowable, PageBreak, Paragraph,
                                     SimpleDocTemplate, Spacer, Table,
                                     TableStyle)
except ImportError:
    print("reportlab not installed. Run: pip install reportlab", file=sys.stderr)
    sys.exit(1)

# ---- Load .env ----
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass  # dotenv optional — will use os.environ directly

MONGO_URI = os.environ.get("MONGODB_URI", "")
DB_NAME   = os.environ.get("DB_NAME", "FirstEdu")

LETTERS = ["A", "B", "C", "D", "E", "F"]

TYPE_LABELS = {
    "single":    "Single Correct",
    "multiple":  "Multiple Correct",
    "true_false":"True / False",
    "connected": "Passage-Based",
}

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

# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def connect_db():
    if not MONGO_URI:
        print("MONGODB_URI not set. Check your .env file.", file=sys.stderr)
        sys.exit(1)
    import dns
    if MONGO_URI.startswith("mongodb+srv://"):
        try:
            dns.resolver.default_resolver = dns.resolver.Resolver(configure=False)
            dns.resolver.default_resolver.nameservers = ["8.8.8.8", "1.1.1.1"]
        except Exception:
            pass
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=15000)
    return client[DB_NAME]


def search_banks(db, term=None, bank_id=None):
    """Return list of matching AiQuestionBank docs."""
    col = db["aiquestionbanks"]
    if bank_id:
        doc = col.find_one({"_id": ObjectId(bank_id)})
        return [doc] if doc else []
    regex = re.compile(re.escape(term), re.IGNORECASE)
    return list(col.find({"$or": [
        {"name": regex},
        {"generationTopic": regex},
    ]}).sort("createdAt", -1))


def fetch_questions(db, bank_id):
    """
    Fetch all AiQuestion docs for a bank and reconstruct passage groups.

    Storage pattern in this codebase:
      - Parent doc:  questionType='connected', isParent=True, passage=<text>,
                     childQuestions=[ObjectId, ...]   (refs to child docs)
      - Child docs:  questionType='single'/'multiple'/'true_false',
                     parentQuestionId=<parent _id>,
                     has the actual questionText + options

    Returns a list of normalised items ready for PDF rendering, ordered by
    sectionIndex then orderInBank.  Passage groups come out as a single item
    with is_passage_group=True.
    """
    col = db["aiquestions"]

    # Fetch every active doc in one query, sort by position
    all_docs = list(col.find(
        {"aiQuestionBank": bank_id, "isActive": {"$ne": False}},
        sort=[("sectionIndex", 1), ("orderInBank", 1)]
    ))

    # Separate parents and children
    parents  = {str(d["_id"]): d for d in all_docs if d.get("isParent")}
    children = [d for d in all_docs if d.get("parentQuestionId")]
    standalone = [d for d in all_docs
                  if not d.get("isParent") and not d.get("parentQuestionId")]

    # Group children under their parent
    children_by_parent = {}
    for c in children:
        pid = str(c["parentQuestionId"])
        children_by_parent.setdefault(pid, []).append(c)

    # Build passage-group items, preserving parent order
    passage_groups = []
    for pid, parent in parents.items():
        subs_docs = children_by_parent.get(pid, [])
        # Sort sub-questions by orderInBank
        subs_docs.sort(key=lambda d: d.get("orderInBank", 0))

        sub_items = []
        for c in subs_docs:
            opts = c.get("options", [])
            sub_items.append({
                "q":       escape(c.get("questionText", "")),
                "options": [escape(o.get("text", "")) for o in opts],
                "correct": [i for i, o in enumerate(opts) if o.get("isCorrect")],
                "exp":     escape(c.get("explanation", "")),
                "type":    c.get("questionType", "single"),
            })

        passage_groups.append({
            "is_passage_group": True,
            "passage":          escape(parent.get("passage") or parent.get("questionText", "")),
            "title":            escape(parent.get("questionText", "")),
            "sub_questions":    sub_items,
            "_sectionIndex":    parent.get("sectionIndex"),
            "_orderInBank":     parent.get("orderInBank", 0),
        })

    # Normalise standalone questions
    standalone_items = []
    for doc in standalone:
        opts = doc.get("options", [])
        standalone_items.append({
            "is_passage_group": False,
            "q":       escape(doc.get("questionText", "")),
            "options": [escape(o.get("text", "")) for o in opts],
            "correct": [i for i, o in enumerate(opts) if o.get("isCorrect")],
            "exp":     escape(doc.get("explanation", "")),
            "type":    doc.get("questionType", "single"),
            "_sectionIndex": doc.get("sectionIndex"),
            "_orderInBank":  doc.get("orderInBank", 0),
        })

    # Merge and sort by sectionIndex then orderInBank
    all_items = passage_groups + standalone_items
    all_items.sort(key=lambda x: (x.get("_sectionIndex") or 0, x.get("_orderInBank") or 0))
    return all_items


def group_by_section(bank_doc, items):
    """
    Bucket pre-normalised items by section using the _sectionIndex field.
    Returns list of (section_name, [items]).
    """
    sections_def = bank_doc.get("sections", [])
    # Questions use 0-based sectionIndex; section definitions use 1-based id.
    # Build the map as: question's sectionIndex (0-based) -> section name
    # by sorting sections by their id and mapping positionally.
    sorted_sections = sorted(sections_def, key=lambda s: s.get("id", 0))
    idx_to_name = {}
    for zero_based, sec in enumerate(sorted_sections):
        idx_to_name[zero_based] = sec.get("name") or f"Section {zero_based + 1}"

    if not sections_def:
        return [(bank_doc.get("name", "Questions"), items)]

    buckets = {}
    for item in items:
        si   = item.get("_sectionIndex")
        name = idx_to_name.get(si, f"Section {(si or 0)+1}")
        buckets.setdefault(name, []).append(item)

    result, seen = [], set()
    for zero_based, sec in enumerate(sorted_sections):
        name = idx_to_name[zero_based]
        if name not in seen and name in buckets:
            result.append((name, buckets[name]))
            seen.add(name)
    for name, qs in buckets.items():
        if name not in seen:
            result.append((name, qs))
    return result


# ---------------------------------------------------------------------------
# PDF styles
# ---------------------------------------------------------------------------

def build_styles():
    base = getSampleStyleSheet()
    s = {}
    s["title"] = ParagraphStyle('TitleStyle', parent=base['Title'], fontSize=20,
                                 fontName=BOLD_FONT, spaceAfter=4,
                                 textColor=colors.HexColor("#1a1a2e"))
    s["subtitle"] = ParagraphStyle('SubtitleStyle', parent=base['Normal'],
                                    fontSize=11, fontName=BASE_FONT,
                                    alignment=TA_CENTER,
                                    textColor=colors.HexColor("#555555"), spaceAfter=2)
    s["section"] = ParagraphStyle('SectionStyle', fontSize=16, fontName=BOLD_FONT,
                                   textColor=colors.white, spaceBefore=0, spaceAfter=0,
                                   alignment=TA_LEFT, leading=20)
    s["qnum"] = ParagraphStyle('QNum', fontSize=11.5, fontName=BOLD_FONT,
                                textColor=colors.HexColor("#1a1a2e"), spaceAfter=4)
    s["question"] = ParagraphStyle('Question', fontSize=11, fontName=BASE_FONT,
                                    leading=15, spaceAfter=8,
                                    textColor=colors.HexColor("#222222"))
    s["question_bold"] = ParagraphStyle('QuestionBold', fontSize=11, fontName=BOLD_FONT,
                                         leading=15, spaceAfter=8,
                                         textColor=colors.HexColor("#1a1a2e"))
    s["passage"] = ParagraphStyle('Passage', fontSize=10.5, fontName=BASE_FONT,
                                   leading=15, textColor=colors.HexColor("#333333"))
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
    s["passage_label"] = ParagraphStyle('PassageLabel', fontSize=9, fontName=BOLD_FONT,
                                         textColor=colors.HexColor("#888866"),
                                         spaceAfter=2)
    return s


# ---------------------------------------------------------------------------
# Passage splitting (for standalone questions whose stem contains a passage)
# ---------------------------------------------------------------------------

DIRECTIVES = re.compile(
    r'^(which\b|what\b|how\b|why\b|determine\b|identify\b|analyze\b|'
    r'analyse\b|calculate\b|select\b|choose\b|find\b|state\b|'
    r'as used\b|based on\b|according to\b)',
    re.I
)

def split_passage_and_question(raw_text):
    """
    For CLAT-style standalone questions where the stem embeds a passage
    followed by a question sentence.  Returns (passage, question_sentence).
    If the stem is short or no split point found, returns ("", raw_text).
    """
    # Already HTML-escaped — decode for splitting
    raw = (raw_text
           .replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
           .replace('&#39;', "'").replace('&quot;', '"'))

    sentences = re.split(r'(?<=[.?!])\s+', raw.strip())
    if len(sentences) < 2:
        return "", raw_text

    split_at = None
    for i in range(len(sentences) - 1, 0, -1):
        s = sentences[i].strip()
        if s.endswith('?') or DIRECTIVES.match(s):
            split_at = i
            break
    if split_at is None:
        split_at = len(sentences) - 1

    passage  = ' '.join(sentences[:split_at]).strip()
    question = ' '.join(sentences[split_at:]).strip()
    return escape(passage), escape(question)


def passage_box(text, styles, col_width=17 * cm):
    t = Table([[Paragraph(text, styles["passage"])]], colWidths=[col_width])
    t.setStyle(TableStyle([
        ('BACKGROUND',    (0, 0), (-1, -1), colors.HexColor("#f5f5f0")),
        ('BOX',           (0, 0), (-1, -1), 0.8, colors.HexColor("#bbbbaa")),
        ('LEFTPADDING',   (0, 0), (-1, -1), 10),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 10),
        ('TOPPADDING',    (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
    ]))
    return t


# ---------------------------------------------------------------------------
# Question block builders
# ---------------------------------------------------------------------------

def _options_and_answer(item, styles):
    """Shared: render option list + correct answer line."""
    story = []
    correct_set = set(item["correct"])
    for i, opt in enumerate(item["options"]):
        label = LETTERS[i] if i < len(LETTERS) else str(i)
        text  = f"({label})&nbsp;&nbsp;{opt}"
        if i in correct_set:
            story.append(Paragraph(text + "&nbsp;&nbsp;&#10003;", styles["option_correct"]))
        else:
            story.append(Paragraph(text, styles["option"]))
    correct_labels = ", ".join(
        f"({LETTERS[i]})" for i in sorted(correct_set) if i < len(LETTERS)
    )
    answer_word = "Correct Answers" if len(correct_set) > 1 else "Correct Answer"
    story.append(Paragraph(f"{answer_word}: {correct_labels}", styles["answer"]))
    if item.get("exp"):
        story.append(Paragraph("Explanation:", styles["expl_label"]))
        # Trim duplicate "Therefore, the correct answer is X." tail
        exp = re.sub(
            r'(\.\s*Therefore,\s*the\s+correct\s+answer\s+is\s+[^.]+\.)\s*\1\s*$',
            r'\1', item["exp"]
        ).strip()
        story.append(Paragraph(exp, styles["explanation"]))
    return story


def build_question_block(q_num, item, styles):
    """Build PDF flowables for one question (or one passage group)."""
    story = []

    if item.get("is_passage_group"):
        # ---- Passage group (connected / passage-based) ----
        story.append(Paragraph(
            f"<font size=9 color='#888866'>[Passage — Questions "
            f"{q_num}–{q_num + len(item['sub_questions']) - 1}]</font>",
            styles["passage_label"]
        ))
        story.append(passage_box(item["passage"], styles))
        story.append(Spacer(1, 8))
        for offset, sub in enumerate(item["sub_questions"]):
            qtype = sub.get("type", "single")
            label = TYPE_LABELS.get(qtype, "Single Correct")
            story.append(Paragraph(
                f"Q{q_num + offset}.&nbsp;&nbsp;"
                f"<font size=8.5 color='#777777'>[{label}]</font>",
                styles["qnum"]
            ))
            story.append(Paragraph(sub["q"], styles["question_bold"]))
            story.extend(_options_and_answer(sub, styles))
            story.append(Spacer(1, 6))
        story.append(HRFlowable(width="100%", thickness=0.8,
                                 color=colors.HexColor("#bbbbaa"),
                                 spaceBefore=4, spaceAfter=14))
        return story, len(item["sub_questions"])

    # ---- Standalone question ----
    qtype = item.get("type", "single")
    label = TYPE_LABELS.get(qtype, "Single Correct")
    story.append(Paragraph(
        f"Q{q_num}.&nbsp;&nbsp;<font size=8.5 color='#777777'>[{label}]</font>",
        styles["qnum"]
    ))

    stem = item["q"]
    # Auto-detect embedded passage (long stem with a question sentence at end)
    passage, question_sentence = split_passage_and_question(stem)
    if passage and len(passage) > 120:
        story.append(passage_box(passage, styles))
        story.append(Spacer(1, 6))
        story.append(Paragraph(question_sentence, styles["question_bold"]))
    else:
        story.append(Paragraph(stem, styles["question"]))

    story.extend(_options_and_answer(item, styles))
    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=0.5,
                             color=colors.HexColor("#dddddd"),
                             spaceBefore=2, spaceAfter=12))
    return story, 1


# ---------------------------------------------------------------------------
# PDF assembly
# ---------------------------------------------------------------------------

def section_type_summary(items):
    counts = {}
    for item in items:
        if item.get("is_passage_group"):
            t = "connected"
        else:
            t = item.get("type", "single")
        counts[t] = counts.get(t, 0) + 1
    order = ["single", "multiple", "true_false", "connected"]
    parts = [f"{TYPE_LABELS[t]} ({counts[t]})" for t in order if counts.get(t)]
    return ", ".join(parts) if parts else "Single Correct"


def section_q_count(items):
    total = 0
    for item in items:
        if item.get("is_passage_group"):
            total += len(item["sub_questions"])
        else:
            total += 1
    return total


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


def build_pdf(sections, output_path, title, subtitle=""):
    styles  = build_styles()
    doc     = SimpleDocTemplate(output_path, pagesize=A4,
                                 topMargin=1.6*cm, bottomMargin=1.6*cm,
                                 leftMargin=1.5*cm, rightMargin=1.5*cm)
    story   = [Paragraph(escape(title), styles["title"])]
    if subtitle:
        story.append(Paragraph(escape(subtitle), styles["subtitle"]))

    total_q = sum(section_q_count(qs) for _, qs in sections)
    type_cell = ParagraphStyle('TC', fontSize=9, fontName=BASE_FONT,
                                leading=11.5, textColor=colors.HexColor("#333333"))

    summary = [["Section", "Questions", "Question Types"]]
    for name, qs in sections:
        summary.append([
            name, str(section_q_count(qs)),
            Paragraph(escape(section_type_summary(qs)), type_cell),
        ])
    summary.append(["Total", str(total_q), ""])

    tbl = Table(summary, colWidths=[5.5*cm, 3*cm, 8.5*cm])
    tbl.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0),  colors.HexColor("#1a1a2e")),
        ('TEXTCOLOR',  (0, 0), (-1, 0),  colors.white),
        ('FONTNAME',   (0, 0), (-1, 0),  BOLD_FONT),
        ('FONTNAME',   (0, 1), (-1, -2), BASE_FONT),
        ('FONTNAME',   (0, -1),(-1, -1), BOLD_FONT),
        ('BACKGROUND', (0, -1),(-1, -1), colors.HexColor("#f0f0f5")),
        ('GRID',       (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
        ('ALIGN',      (1, 0), (1, -1),  'CENTER'),
        ('VALIGN',     (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING',    (0,0),(-1,-1), 6),
        ('BOTTOMPADDING', (0,0),(-1,-1), 6),
        ('FONTSIZE',   (0, 0), (-1, -1), 10.5),
    ]))
    story.append(tbl)
    story.append(PageBreak())

    for name, qs in sections:
        story.append(build_section_header(name, styles))
        story.append(Spacer(1, 14))
        q_num = 1
        for item in qs:
            flowables, count = build_question_block(q_num, item, styles)
            story.extend(flowables)
            q_num += count
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
    parser.add_argument("search", nargs="?", help="Bank name/topic search term")
    parser.add_argument("--id",   help="Specific AiQuestionBank _id")
    parser.add_argument("-o", "--output", type=Path, default=Path("question_paper.pdf"))
    parser.add_argument("-t", "--title",  default=None)
    parser.add_argument("--list", action="store_true",
                        help="List matching banks without building PDF")
    args = parser.parse_args()

    if not args.search and not args.id:
        parser.error("Provide a search term or --id")

    print("Connecting to MongoDB…")
    db = connect_db()

    banks = search_banks(db, term=args.search, bank_id=args.id)
    if not banks:
        print("No matching question banks found.", file=sys.stderr)
        sys.exit(1)

    if args.list or len(banks) > 1:
        print(f"\nFound {len(banks)} matching bank(s):\n")
        for b in banks:
            print(f"  {b['_id']}  |  {b.get('name', '?')}  |  "
                  f"topic: {b.get('generationTopic', '—')}  |  "
                  f"questions: {b.get('questionCount', '?')}")
        if args.list:
            return
        print("\nMultiple banks found. Re-run with --id <id> to pick one.")
        sys.exit(1)

    bank = banks[0]
    print(f"Bank: {bank['name']}  (id: {bank['_id']})")

    questions = fetch_questions(db, bank["_id"])
    print(f"Fetched {len(questions)} item(s) (passages + standalone)")

    if not questions:
        print("No questions found in this bank.", file=sys.stderr)
        sys.exit(1)

    sections = group_by_section(bank, questions)
    for name, qs in sections:
        print(f"  Section '{name}': {section_q_count(qs)} question(s)")

    title    = args.title or bank.get("name", "Question Paper")
    subtitle = bank.get("generationTopic", "")

    print(f"Building PDF → {args.output}")
    build_pdf(sections, str(args.output), title, subtitle)
    total = sum(section_q_count(qs) for _, qs in sections)
    print(f"Done. {total} questions written to {args.output}")


if __name__ == "__main__":
    main()
