import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");

const INPUT_DIR = path.join(BACKEND_ROOT, "question paper with explanation");
const OUTPUT_DIR = path.join(INPUT_DIR, "sections-only");

const normalizeSubject = (s) => {
  const raw = String(s || "").trim().toLowerCase();
  if (!raw) return "";
  // Common variants inside your JSONs.
  if (raw.includes("math")) return "Mathematics";
  if (raw === "physics") return "Physics";
  if (raw.includes("chem")) return "Chemistry";
  // Sometimes the subject is already "Mathematics" / "Physics" / "Chemistry".
  if (raw === "mathematics") return "Mathematics";
  if (raw === "physics") return "Physics";
  if (raw === "chemistry") return "Chemistry";
  return "";
};

const ensureDir = (p) => {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
};

const safeJsonParse = (text, file) => {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Failed to parse JSON (${file}): ${err?.message || err}`);
  }
};

const groupQuestionsBySection = (paper) => {
  const out = {};

  const add = (subject, q) => {
    const key = normalizeSubject(subject);
    if (!key) return;
    if (!out[key]) out[key] = { questions: [] };
    out[key].questions.push(q);
  };

  // Case 1: sections is an array of { subject, questions } (common in jee_main_*.json).
  if (Array.isArray(paper?.sections)) {
    for (const s of paper.sections) {
      const subject = s?.subject || s?.name;
      const questions = Array.isArray(s?.questions) ? s.questions : [];
      for (const q of questions) add(subject, q);
    }
    return out;
  }

  // Case 2: sections is an object map + top-level `questions` array (common in sample-like JSONs).
  if (paper?.sections && typeof paper.sections === "object" && Array.isArray(paper?.questions)) {
    for (const q of paper.questions) {
      add(q?.subject || q?.section || q?.paper_subject, q);
    }
    return out;
  }

  // Fallback: attempt to group by question.subject if present.
  if (Array.isArray(paper?.questions)) {
    for (const q of paper.questions) add(q?.subject || q?.section || q?.paper_subject, q);
  }

  return out;
};

const copyMeta = (paper) => {
  // Keep top-level meta keys you likely want in output.
  const meta = { ...paper };
  delete meta.sections;
  delete meta.questions;
  return meta;
};

const splitOneFile = (filePath) => {
  const fileName = path.basename(filePath);
  const raw = fs.readFileSync(filePath, "utf8");
  const paper = safeJsonParse(raw, fileName);

  const grouped = groupQuestionsBySection(paper);
  const keys = Object.keys(grouped);
  if (!keys.length) {
    console.warn(`[split] No section questions found in ${fileName}`);
    return { fileName, written: 0, keys: [] };
  }

  const meta = copyMeta(paper);
  const base = fileName.replace(/\.json$/i, "");

  let written = 0;
  for (const subject of ["Physics", "Chemistry", "Mathematics"]) {
    if (!grouped[subject]?.questions?.length) continue;

    const outPaper = {
      ...meta,
      sections: {
        [subject]: {
          questions: grouped[subject].questions,
        },
      },
    };

    const outName = `${base}_${subject}.json`;
    const outPath = path.join(OUTPUT_DIR, outName);
    fs.writeFileSync(outPath, JSON.stringify(outPaper, null, 2), "utf8");
    written += 1;
  }

  return { fileName, written, keys };
};

const main = () => {
  ensureDir(OUTPUT_DIR);

  const files = fs
    .readdirSync(INPUT_DIR)
    .filter((f) => f.toLowerCase().endsWith(".json"));

  if (!files.length) {
    console.log(`[split] No JSON files found in ${INPUT_DIR}`);
    return;
  }

  const results = [];
  for (const f of files) {
    const full = path.join(INPUT_DIR, f);
    results.push(splitOneFile(full));
  }

  const totalWritten = results.reduce((s, r) => s + (r.written || 0), 0);
  console.log(`[split] Done. ${files.length} input files → ${totalWritten} output section files.`);
};

main();

