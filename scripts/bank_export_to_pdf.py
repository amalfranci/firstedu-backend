#!/usr/bin/env python3
"""
bank_export_to_pdf.py — Convert a pasted UI-export exam .txt file into a
formatted PDF.

Unlike txt_to_pdf.py (which expects a clean "Stem:"/"Correct:"/"Explanation:"
format), this handles the raw copy-paste export shape used for bank-exam
mock tests, e.g.:

    English
    Hard
    Q1
    Single
    Hard
    Identify the sentence that ...

    Hide options
    A. The board insisted ...
    B. The board insisted ...✓
    C. The board insisted ...
    D. The board insisted ...


    Q2
    ...

    Quatitative aptitude
    Hard
    Q31
    ...

Section headers (e.g. "English", "Reasoning Ability") are lines immediately
followed by a bare difficulty word and then a "Q<n>" line. The correct
option is marked with a trailing "✓". Questions with no revealed options
("Show options") or no stem ("—") are skipped — there's nothing to render.

Reuses the PDF styling/layout from txt_to_pdf.py so both scripts produce a
visually consistent paper.

USAGE
-----
    python bank_export_to_pdf.py "IBPS PO.txt" -o ibps_po.pdf -t "IBPS PO — Mock Paper"
"""

import argparse
import re
import sys
from pathlib import Path
from xml.sax.saxutils import escape

sys.path.insert(0, str(Path(__file__).resolve().parent))
from txt_to_pdf import LETTERS, LETTER_TO_IDX, build_pdf  # noqa: E402

DIFFICULTY_WORDS = {"Easy", "Medium", "Hard"}
STEM_TERMINATORS = {"Show more", "Show less", "Hide options", "Show options"}
OPTION_LINE_RE = re.compile(r'^([A-F])\.\s*(.+?)(✓)?$')
Q_LINE_RE = re.compile(r'^Q(\d+)$')


def parse_bank_export(text: str):
    """Returns (sections, skipped_count) where sections is a list of
    (section_name, [question_dict, ...]) in the shape build_pdf() expects."""
    lines = text.replace('\r\n', '\n').split('\n')
    n = len(lines)
    i = 0
    sections = []
    current_name = None
    current_questions = []
    skipped = 0

    def flush_section():
        if current_name is not None:
            sections.append((current_name, current_questions))

    def is_section_header_at(idx):
        """True if lines[idx] looks like <name>\n<difficulty>\nQ<n> — used both
        to detect a new section and to stop stem-collection from swallowing
        a section header that follows a trailing empty '—' question."""
        return (idx + 2 < n and lines[idx].strip()
                and lines[idx + 1].strip() in DIFFICULTY_WORDS
                and Q_LINE_RE.match(lines[idx + 2].strip()))

    while i < n:
        line = lines[i].strip()
        if not line:
            i += 1
            continue

        # Section header: <name>\n<difficulty>\nQ<n>
        if is_section_header_at(i):
            flush_section()
            current_name = line
            current_questions = []
            i += 2  # leave i pointing at the difficulty line; next loop consumes it then Q<n>
            continue

        q_m = Q_LINE_RE.match(line)
        if q_m:
            qtype = lines[i + 1].strip() if i + 1 < n else "Single"
            i += 3  # skip Q<n>, type, difficulty lines
            stem_parts = []
            while i < n:
                raw = lines[i]
                stripped = raw.strip()
                if (stripped in STEM_TERMINATORS or Q_LINE_RE.match(stripped)
                        or OPTION_LINE_RE.match(stripped) or is_section_header_at(i)):
                    break
                stem_parts.append(stripped)
                i += 1
            stem = ' '.join(p for p in stem_parts if p).strip()

            has_options = False
            while i < n:
                stripped = lines[i].strip()
                if stripped == "":
                    i += 1
                    continue
                if stripped == "Show more":
                    i += 1
                    continue
                if stripped == "Hide options":
                    has_options = True
                    i += 1
                    break
                if stripped == "Show options":
                    i += 1
                    break
                break

            options = []
            correct_indexes = []
            if has_options:
                while i < n:
                    stripped = lines[i].strip()
                    if stripped == "":
                        i += 1
                        continue
                    om = OPTION_LINE_RE.match(stripped)
                    if not om:
                        break
                    letter, opt_text, is_correct = om.group(1), om.group(2).strip(), bool(om.group(3))
                    options.append(opt_text)
                    if is_correct:
                        correct_indexes.append(LETTER_TO_IDX[letter])
                    i += 1

            if stem and stem != "—" and options and correct_indexes:
                current_questions.append({
                    "q": escape(stem),
                    "options": [escape(o) for o in options],
                    "correct": correct_indexes,
                    "exp": "",
                    "difficulty": None,
                    "type": "single" if qtype.lower() != "multiple" else "multiple",
                })
            else:
                skipped += 1
            continue

        i += 1

    flush_section()
    # Drop sections that ended up with zero usable questions.
    sections = [(name, qs) for name, qs in sections if qs]
    return sections, skipped


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                      formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", type=Path, help="The pasted UI-export .txt file.")
    parser.add_argument("-o", "--output", type=Path, default=Path("bank_exam.pdf"),
                         help="Output PDF path (default: bank_exam.pdf)")
    parser.add_argument("-t", "--title", type=str, default="Mock Question Paper",
                         help="Main title printed at the top of the PDF")
    args = parser.parse_args()

    if not args.input.exists():
        print(f"Error: {args.input} not found.", file=sys.stderr)
        sys.exit(1)

    raw_text = args.input.read_text(encoding="utf-8")
    sections, skipped = parse_bank_export(raw_text)

    if not sections:
        print("No usable questions parsed. Nothing to build.", file=sys.stderr)
        sys.exit(1)

    for name, qs in sections:
        print(f"Section '{name}': {len(qs)} questions")
    if skipped:
        print(f"Skipped {skipped} question slot(s) with no revealed answer key or empty stem.")

    subtitle = " • ".join(name for name, _ in sections)
    build_pdf(sections, str(args.output), args.title, subtitle)
    total = sum(len(qs) for _, qs in sections)
    print(f"Done. Wrote {total} questions across {len(sections)} section(s) to {args.output}")


if __name__ == "__main__":
    main()
