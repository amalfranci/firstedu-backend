/**
 * Extract JEE Main question bank PDFs to separate TXT + JSON files.
 * Usage: node scripts/extract-question-banks.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PDFParse } from "pdf-parse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "extracted_questions");

const PDFS = [
  {
    file: "Chemistry - JEE Main 2025 January Chapter-wise Question Bank (1).pdf",
    key: "chemistry_jee_main_2025_january",
    subject: "Chemistry",
    style: "mathongo",
  },
  {
    file: "Mathematics_JEE_Main_2025_January_Chapter_wise_Question_Bank (1).pdf",
    key: "mathematics_jee_main_2025_january",
    subject: "Mathematics",
    style: "mathongo",
  },
  {
    file: "Physics - JEE Main 2025 January Chapter-wise Question Bank (1).pdf",
    key: "physics_jee_main_2025_january",
    subject: "Physics",
    style: "mathongo",
  },
  {
    file: "Special 26 Question Bank (JEE Main) (1).pdf",
    key: "special_26_question_bank_jee_main",
    subject: "Mixed",
    style: "special26",
  },
];

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function cleanText(t) {
  return (t || "")
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeSpace(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function stripPageNoise(text) {
  return text
    .replace(/\n--\s*\d+\s+of\s+\d+\s*--\n/gi, "\n")
    .replace(/\nJEE Main 2025 January\nChapter-wise Question Bank\nMathonGo\n/gi, "\n")
    .replace(/\nChapter-wise Question Bank\nMathonGo\n/gi, "\n")
    .replace(/\nMathonGo\n/gi, "\n");
}

/** Parse TOC: "1. Some Basic Concepts of Chemistry 3" */
function parseToc(text) {
  const chapters = [];
  const contentIdx = text.search(/\nContent\s*\n/i);
  if (contentIdx < 0) return chapters;

  const after = text.slice(contentIdx, contentIdx + 4000);
  const lines = after.split("\n");
  for (const line of lines) {
    const m = line
      .trim()
      .match(/^(\d+)\.\s+(.+?)\s+(\d+)\s*$/);
    if (m) {
      chapters.push({
        index: parseInt(m[1], 10),
        chapter: m[2].trim(),
        start_page: parseInt(m[3], 10),
      });
    }
    if (/^Answer Keys/i.test(line.trim())) {
      const am = line.trim().match(/Answer Keys\s+(\d+)/i);
      if (am) {
        chapters.push({
          index: 999,
          chapter: "Answer Keys",
          start_page: parseInt(am[1], 10),
        });
      }
      break;
    }
  }

  // Also catch "Answer Keys 71" on own line after list
  if (!chapters.some((c) => c.chapter === "Answer Keys")) {
    const am = after.match(/Answer Keys\s+(\d+)/i);
    if (am) {
      chapters.push({
        index: 999,
        chapter: "Answer Keys",
        start_page: parseInt(am[1], 10),
      });
    }
  }

  // Compute end pages
  for (let i = 0; i < chapters.length; i++) {
    const next = chapters[i + 1];
    chapters[i].end_page = next ? next.start_page - 1 : 9999;
  }
  return chapters.filter((c) => c.chapter !== "Answer Keys");
}

function chapterForPage(toc, page) {
  for (const c of toc) {
    if (page >= c.start_page && page <= c.end_page) return c.chapter;
  }
  // fallback: last chapter whose start_page <= page
  let hit = null;
  for (const c of toc) {
    if (c.start_page <= page) hit = c.chapter;
  }
  return hit || "Unknown";
}

function parseAnswerKeysFromPages(pages, toc) {
  const keys = {};
  // Answer keys start page from TOC (e.g. 71), else last 5 pages
  let startPage = null;
  // TOC entry is filtered out; re-scan first pages for "Answer Keys N"
  const early = pages
    .slice(0, 3)
    .map((p) => p.text)
    .join("\n");
  const ak = early.match(/Answer Keys\s+(\d+)/i);
  if (ak) startPage = parseInt(ak[1], 10);

  const answerPages = startPage
    ? pages.filter((p) => p.page >= startPage)
    : pages.slice(-5);

  const section = answerPages.map((p) => p.text).join("\n");
  const lines = section.split("\n");
  let current = null;

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^answer keys$/i.test(t)) continue;
    if (/^JEE Main 2025/i.test(t)) continue;
    if (/^Chapter-wise Question Bank$/i.test(t)) continue;
    if (/^MathonGo$/i.test(t)) continue;
    if (/^\d+$/.test(t)) continue;
    if (/^--\s*\d+\s+of/i.test(t)) continue;

    // Answer lines: 1. (2)  2. (57)
    if (/\d+\.\s*\([^)]+\)/.test(t)) {
      if (!current) continue;
      const re = /(\d+)\.\s*\(([^)]+)\)/g;
      let m;
      while ((m = re.exec(t)) !== null) {
        keys[current][parseInt(m[1], 10)] = m[2].trim();
      }
      continue;
    }

    // Chapter heading — typically ALL CAPS in answer key pages
    if (
      /[A-Za-z]/.test(t) &&
      t.length > 2 &&
      t.length < 120 &&
      !/^Q\d+/i.test(t) &&
      !/^\(\d\)/.test(t)
    ) {
      current = normalizeSpace(t);
      if (!keys[current]) keys[current] = {};
    }
  }

  // Drop empty sections
  for (const k of Object.keys(keys)) {
    if (Object.keys(keys[k]).length === 0) delete keys[k];
  }
  return keys;
}

function findAnswerForChapter(answerKeys, chapterName) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = norm(chapterName);
  for (const [k, v] of Object.entries(answerKeys)) {
    if (norm(k) === target) return v;
  }
  // partial contains
  for (const [k, v] of Object.entries(answerKeys)) {
    const nk = norm(k);
    if (nk.includes(target) || target.includes(nk)) return v;
  }
  return null;
}

function parseOptionsMathonGo(raw) {
  const options = [];
  const optRe = /\((\d)\)\s*/g;
  const positions = [];
  let m;
  while ((m = optRe.exec(raw)) !== null) {
    positions.push({ num: m[1], index: m.index, end: m.index + m[0].length });
  }

  if (positions.length >= 2 && positions.length <= 8) {
    let startIdx = 0;
    for (let i = 0; i < positions.length; i++) {
      if (positions[i].num === "1") startIdx = i;
    }
    const group = positions.slice(startIdx);
    // Prefer groups that look like 1,2,3,4 sequence
    if (group.length >= 2 && group.length <= 4) {
      const stem = raw.slice(0, group[0].index).trim();
      for (let i = 0; i < group.length; i++) {
        const a = group[i].end;
        const b = i + 1 < group.length ? group[i + 1].index : raw.length;
        options.push({
          id: group[i].num,
          text: normalizeSpace(raw.slice(a, b)),
        });
      }
      return { stem: normalizeSpace(stem), options };
    }
  }
  return { stem: normalizeSpace(raw), options: [] };
}

function parseMathonGoFromPages(pages, subject) {
  // Build full text with page markers preserved for page mapping
  const fullWithPages = pages
    .map((p) => `\n<<PAGE ${p.page}>>\n${p.text}`)
    .join("\n");
  const fullText = pages.map((p) => p.text).join("\n");
  const toc = parseToc(fullText);
  const answerKeys = parseAnswerKeysFromPages(pages, toc);

  // Remove header noise but keep page markers
  let working = fullWithPages;
  working = working.replace(
    /\n[^\n]+\nJEE Main 2025 January\nChapter-wise Question Bank\nMathonGo\n/gi,
    "\n"
  );
  working = working.replace(
    /\nJEE Main 2025 January\nChapter-wise Question Bank\nMathonGo\n/gi,
    "\n"
  );

  // Find all questions with page context
  const qRe = /Q(\d+)\.\s*(\d{1,2}\s+[A-Za-z]+\s+Shift\s+\d)/gi;
  const markers = [];
  let m;
  while ((m = qRe.exec(working)) !== null) {
    // find nearest preceding <<PAGE N>>
    const before = working.slice(0, m.index);
    const pageMatches = [...before.matchAll(/<<PAGE (\d+)>>/g)];
    const page = pageMatches.length
      ? parseInt(pageMatches[pageMatches.length - 1][1], 10)
      : 1;
    markers.push({
      number: parseInt(m[1], 10),
      session: normalizeSpace(m[2]),
      index: m.index,
      endHeader: m.index + m[0].length,
      page,
    });
  }

  const rawQuestions = [];
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].endHeader;
    const end = i + 1 < markers.length ? markers[i + 1].index : working.length;
    let raw = working.slice(start, end);
    // strip page markers and trailing chapter names that appear before next Q
    raw = raw.replace(/<<PAGE \d+>>/g, " ");
    raw = raw.replace(/\n--\s*\d+\s+of\s+\d+\s*--/gi, " ");
    // cut answer keys if present
    const ak = raw.search(/\nAnswer Keys\b/i);
    if (ak >= 0) raw = raw.slice(0, ak);
    raw = raw.trim();

    const parsed = parseOptionsMathonGo(raw);
    const chapter = chapterForPage(toc, markers[i].page);
    rawQuestions.push({
      number: markers[i].number,
      session: markers[i].session,
      page: markers[i].page,
      chapter,
      type: parsed.options.length >= 2 ? "MCQ" : "Numerical",
      question_text: parsed.stem,
      options: parsed.options,
      answer: null,
      raw_text: normalizeSpace(raw).slice(0, 2500),
    });
  }

  // Group by chapter preserving order of first appearance
  const chapterOrder = [];
  const byChapter = new Map();
  for (const q of rawQuestions) {
    if (!byChapter.has(q.chapter)) {
      byChapter.set(q.chapter, []);
      chapterOrder.push(q.chapter);
    }
    byChapter.get(q.chapter).push(q);
  }

  // Prefer TOC order when available
  const orderedChapters = [];
  const seen = new Set();
  for (const t of toc) {
    if (byChapter.has(t.chapter)) {
      orderedChapters.push(t.chapter);
      seen.add(t.chapter);
    }
  }
  for (const c of chapterOrder) {
    if (!seen.has(c)) orderedChapters.push(c);
  }

  const chapters = orderedChapters.map((name) => {
    const questions = byChapter.get(name) || [];
    const answers = findAnswerForChapter(answerKeys, name);
    if (answers) {
      for (const q of questions) {
        if (answers[q.number] !== undefined) q.answer = answers[q.number];
      }
    }
    return {
      chapter: name,
      question_count: questions.length,
      questions: questions.map(({ chapter, ...rest }) => rest),
    };
  });

  return {
    source_style: "mathongo_chapter_wise",
    subject,
    exam: "JEE Main 2025 January",
    chapters_toc: toc.map((t) => ({
      index: t.index,
      chapter: t.chapter,
      start_page: t.start_page,
      end_page: t.end_page,
    })),
    total_questions: rawQuestions.length,
    chapters,
    answer_keys: answerKeys,
  };
}

function parseSpecial26FromPages(pages) {
  const fullText = pages.map((p) => p.text).join("\n");
  const text = cleanText(fullText);

  const toc = { Chemistry: [], Physics: [], Mathematics: [] };

  // Parse TOC from first ~3 pages more carefully
  const firstPages = pages
    .slice(0, 3)
    .map((p) => p.text)
    .join("\n");

  function parseTocSubject(block, subject) {
    if (!block) return;
    // Patterns: "1. Atomic Structure 1-11" or split across lines
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    let pending = null;
    for (const line of lines) {
      const full = line.match(
        /^(\d+)\.\s+(.+?)\s+(\d+)(?:\s*-\s*(\d+))?\s*$/
      );
      if (full) {
        toc[subject].push({
          sr_no: parseInt(full[1], 10),
          chapter: full[2].trim(),
          question_range: full[4]
            ? `${full[3]}-${full[4]}`
            : full[3],
        });
        pending = null;
        continue;
      }
      const head = line.match(/^(\d+)\.\s+(.+)$/);
      if (head) {
        pending = { sr_no: parseInt(head[1], 10), chapter: head[2].trim() };
        continue;
      }
      const rangeOnly = line.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (rangeOnly && pending) {
        toc[subject].push({
          ...pending,
          question_range: rangeOnly[2]
            ? `${rangeOnly[1]}-${rangeOnly[2]}`
            : rangeOnly[1],
        });
        pending = null;
      }
    }
  }

  const chemBlock = firstPages.match(
    /CHEMISTRY[\s\S]*?(?=PHYSICS\s|$)/i
  );
  const phyBlock = firstPages.match(
    /PHYSICS[\s\S]*?(?=MATHEMATICS\s|$)/i
  );
  const mathBlock = firstPages.match(/MATHEMATICS[\s\S]*$/i);
  parseTocSubject(chemBlock?.[0], "Chemistry");
  parseTocSubject(phyBlock?.[0], "Physics");
  parseTocSubject(mathBlock?.[0], "Mathematics");

  // Build range map
  const rangeMap = [];
  for (const subject of Object.keys(toc)) {
    for (const entry of toc[subject]) {
      const parts = String(entry.question_range).split("-").map((x) => parseInt(x, 10));
      const from = parts[0];
      const to = parts[1] || parts[0];
      if (!Number.isNaN(from)) {
        rangeMap.push({
          subject,
          chapter: entry.chapter,
          from,
          to: Number.isNaN(to) ? from : to,
        });
      }
    }
  }

  // Questions with options (A)(B)(C)(D) — multi-column PDF so imperfect
  // Work page by page and also global continuous numbers 1-750
  const byNum = new Map();

  // Strategy: join all body text after TOC, find numbered items with substantial body
  const body = pages
    .slice(3)
    .map((p) => `\n<<PAGE ${p.page}>>\n${p.text}`)
    .join("\n");

  // Split on lines that look like start of numbered question
  // Special 26 sometimes has number on same line as text start
  const qRe = /(?:^|\n)\s*(\d{1,3})\.\s+/g;
  const markers = [];
  let qm;
  while ((qm = qRe.exec(body)) !== null) {
    const num = parseInt(qm[1], 10);
    if (num < 1 || num > 750) continue;
    const before = body.slice(0, qm.index);
    const pageMatches = [...before.matchAll(/<<PAGE (\d+)>>/g)];
    const page = pageMatches.length
      ? parseInt(pageMatches[pageMatches.length - 1][1], 10)
      : 4;
    markers.push({
      number: num,
      index: qm.index,
      endHeader: qm.index + qm[0].length,
      page,
    });
  }

  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].endHeader;
    // end at next marker with higher-or-equal likelihood of next Q
    let end = body.length;
    for (let j = i + 1; j < markers.length; j++) {
      // next sequential or close number is more reliable
      if (
        markers[j].number === markers[i].number + 1 ||
        markers[j].number > markers[i].number
      ) {
        end = markers[j].index;
        break;
      }
    }
    // limit chunk size
    end = Math.min(end, start + 3000);
    let raw = body.slice(start, end);
    raw = raw.replace(/<<PAGE \d+>>/g, " ");
    raw = raw.replace(/Special 26 Question Bank[\s\S]{0,40}/gi, " ");
    raw = raw.replace(/\(CHEMISTRY\)|\(PHYSICS\)|\(MATHEMATICS\)/gi, " ");
    raw = raw.replace(/For More Join:.*/gi, " ");
    raw = normalizeSpace(raw);
    if (raw.length < 30) continue;

    // options A-D
    const options = [];
    const optRe = /\(([A-D])\)\s*/g;
    const positions = [];
    let om;
    while ((om = optRe.exec(raw)) !== null) {
      positions.push({ id: om[1], index: om.index, end: om.index + om[0].length });
    }
    let stem = raw;
    if (positions.length >= 2) {
      let startIdx = 0;
      for (let k = 0; k < positions.length; k++) {
        if (positions[k].id === "A") startIdx = k;
      }
      const group = positions.slice(startIdx);
      if (group.length >= 2 && group.length <= 4) {
        stem = raw.slice(0, group[0].index).trim();
        for (let k = 0; k < group.length; k++) {
          const a = group[k].end;
          const b = k + 1 < group.length ? group[k + 1].index : raw.length;
          options.push({
            id: group[k].id,
            text: normalizeSpace(raw.slice(a, b)),
          });
        }
      }
    }

    const hit = rangeMap.find(
      (r) => markers[i].number >= r.from && markers[i].number <= r.to
    );

    const q = {
      number: markers[i].number,
      page: markers[i].page,
      subject: hit?.subject || null,
      chapter: hit?.chapter || null,
      type: options.length >= 2 ? "MCQ" : "Unknown",
      question_text: normalizeSpace(stem),
      options,
      raw_text: raw.slice(0, 2000),
    };

    const prev = byNum.get(q.number);
    if (!prev || q.raw_text.length > prev.raw_text.length) {
      byNum.set(q.number, q);
    }
  }

  const questions = [...byNum.values()].sort((a, b) => a.number - b.number);

  // Group by subject/chapter
  const chapters = [];
  const chMap = new Map();
  for (const q of questions) {
    const key = `${q.subject || "Unknown"}::${q.chapter || "Unassigned"}`;
    if (!chMap.has(key)) {
      chMap.set(key, {
        subject: q.subject,
        chapter: q.chapter || "Unassigned",
        questions: [],
      });
      chapters.push(chMap.get(key));
    }
    const { subject, chapter, ...rest } = q;
    chMap.get(key).questions.push(rest);
  }
  for (const ch of chapters) {
    ch.question_count = ch.questions.length;
  }

  return {
    source_style: "special_26",
    exam: "JEE Main (Special 26 Question Bank)",
    toc,
    total_questions_parsed: questions.length,
    note:
      "Multi-column PDF: reading order can mix columns. Use full_text.txt / pages.txt as source of truth for complete wording.",
    chapters,
    questions,
  };
}

async function extractPdf(pdfPath) {
  const buffer = fs.readFileSync(pdfPath);
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const pages = (result.pages || []).map((p, i) => ({
      page: p.num ?? i + 1,
      text: cleanText(p.text || ""),
    }));
    const text = cleanText(result.text || pages.map((p) => p.text).join("\n"));
    const numpages = result.total || pages.length;
    return { text, pages, numpages };
  } finally {
    if (typeof parser.destroy === "function") await parser.destroy();
  }
}

function writeReadableMathongo(meta, structured) {
  let readable = `# ${meta.subject} — ${meta.file}\n# Exam: ${structured.exam}\n# Total questions: ${structured.total_questions}\n\n`;
  for (const ch of structured.chapters) {
    readable += `\n${"=".repeat(60)}\nCHAPTER: ${ch.chapter}\nQuestions: ${ch.question_count}\n${"=".repeat(60)}\n\n`;
    for (const q of ch.questions) {
      readable += `Q${q.number}. [${q.session}] p.${q.page} (${q.type})\n`;
      readable += `${q.question_text}\n`;
      for (const o of q.options) {
        readable += `  (${o.id}) ${o.text}\n`;
      }
      if (q.answer != null) readable += `  >>> Answer: ${q.answer}\n`;
      readable += "\n";
    }
  }
  if (Object.keys(structured.answer_keys || {}).length) {
    readable += `\n${"=".repeat(60)}\nANSWER KEYS\n${"=".repeat(60)}\n`;
    for (const [ch, ans] of Object.entries(structured.answer_keys)) {
      readable += `\n${ch}\n`;
      for (const [n, a] of Object.entries(ans)) {
        readable += `  ${n}. (${a})\n`;
      }
    }
  }
  return readable;
}

function writeReadableSpecial(meta, structured) {
  let readable = `# Special 26 — ${meta.file}\n# Parsed questions: ${structured.total_questions_parsed}\n# ${structured.note}\n\n`;
  readable += "## TOC\n";
  for (const sub of ["Chemistry", "Physics", "Mathematics"]) {
    readable += `\n### ${sub}\n`;
    for (const e of structured.toc[sub] || []) {
      readable += `- ${e.sr_no}. ${e.chapter} (${e.question_range})\n`;
    }
  }
  readable += "\n## Questions\n";
  for (const q of structured.questions) {
    readable += `\nQ${q.number}`;
    if (q.chapter) readable += ` [${q.subject} / ${q.chapter}]`;
    readable += ` p.${q.page} (${q.type})\n`;
    readable += `${q.question_text}\n`;
    for (const o of q.options) {
      readable += `  (${o.id}) ${o.text}\n`;
    }
  }
  return readable;
}

async function main() {
  ensureDir(OUT);
  const summary = [];

  for (const meta of PDFS) {
    const pdfPath = path.join(ROOT, meta.file);
    if (!fs.existsSync(pdfPath)) {
      console.error("Missing:", meta.file);
      continue;
    }
    console.log("\n=== Extracting:", meta.file, "===");
    const { text, pages, numpages } = await extractPdf(pdfPath);
    console.log("Pages:", numpages, "| chars:", text.length);

    const dir = path.join(OUT, meta.key);
    ensureDir(dir);

    fs.writeFileSync(path.join(dir, "full_text.txt"), text, "utf8");
    const pagesTxt = pages
      .map((p) => `===== PAGE ${p.page} =====\n${p.text}`)
      .join("\n\n");
    fs.writeFileSync(path.join(dir, "pages.txt"), pagesTxt, "utf8");

    let structured;
    if (meta.style === "mathongo") {
      structured = parseMathonGoFromPages(pages, meta.subject);
    } else {
      structured = parseSpecial26FromPages(pages);
    }

    const jsonDoc = {
      source_file: meta.file,
      subject: meta.subject,
      extracted_at: new Date().toISOString(),
      page_count: numpages,
      character_count: text.length,
      ...structured,
    };

    fs.writeFileSync(
      path.join(dir, "questions.json"),
      JSON.stringify(jsonDoc, null, 2),
      "utf8"
    );

    const readable =
      meta.style === "mathongo"
        ? writeReadableMathongo(meta, structured)
        : writeReadableSpecial(meta, structured);
    fs.writeFileSync(path.join(dir, "questions_readable.txt"), readable, "utf8");

    // Also write one combined JSON per chapter (mathongo)
    if (meta.style === "mathongo") {
      const chDir = path.join(dir, "by_chapter");
      ensureDir(chDir);
      for (const ch of structured.chapters) {
        const safe = ch.chapter
          .replace(/[<>:"/\\|?*]/g, "")
          .replace(/\s+/g, "_")
          .slice(0, 80);
        fs.writeFileSync(
          path.join(chDir, `${safe}.json`),
          JSON.stringify(ch, null, 2),
          "utf8"
        );
      }
    } else {
      const subDir = path.join(dir, "by_subject_chapter");
      ensureDir(subDir);
      for (const ch of structured.chapters || []) {
        const safe = `${ch.subject || "Unknown"}__${(ch.chapter || "x")
          .replace(/[<>:"/\\|?*]/g, "")
          .replace(/\s+/g, "_")
          .slice(0, 60)}`;
        fs.writeFileSync(
          path.join(subDir, `${safe}.json`),
          JSON.stringify(ch, null, 2),
          "utf8"
        );
      }
    }

    const qCount =
      meta.style === "mathongo"
        ? structured.total_questions
        : structured.total_questions_parsed;
    const chCount =
      meta.style === "mathongo"
        ? structured.chapters.length
        : (structured.chapters || []).length;

    const info = {
      key: meta.key,
      subject: meta.subject,
      pages: numpages,
      chars: text.length,
      questions: qCount,
      chapters: chCount,
      out: dir,
      files: [
        "full_text.txt",
        "pages.txt",
        "questions.json",
        "questions_readable.txt",
        meta.style === "mathongo" ? "by_chapter/*.json" : "by_subject_chapter/*.json",
      ],
    };
    summary.push(info);
    console.log(`→ questions: ${qCount}, chapters: ${chCount}`);
    if (meta.style === "mathongo") {
      for (const ch of structured.chapters.slice(0, 5)) {
        console.log(`   - ${ch.chapter}: ${ch.question_count}`);
      }
      if (structured.chapters.length > 5) {
        console.log(`   ... +${structured.chapters.length - 5} more chapters`);
      }
    }
  }

  fs.writeFileSync(
    path.join(OUT, "extraction_summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8"
  );
  console.log("\nDone. Summary: extracted_questions/extraction_summary.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
