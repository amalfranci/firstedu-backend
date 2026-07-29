import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");

const SECTIONS_ONLY_DIR = path.join(
  BACKEND_ROOT,
  "question paper with explanation",
  "sections-only"
);

const OUTPUT_DIR = SECTIONS_ONLY_DIR;

const SUBJECTS = ["Physics", "Chemistry", "Mathematics"];

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

const main = () => {
  ensureDir(OUTPUT_DIR);

  if (!fs.existsSync(SECTIONS_ONLY_DIR)) {
    console.error(`[combine] Missing dir: ${SECTIONS_ONLY_DIR}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(SECTIONS_ONLY_DIR)
    .filter((f) => f.toLowerCase().endsWith(".json"));

  for (const subject of SUBJECTS) {
    const pattern = `_${subject}.json`.toLowerCase();
    const matched = files.filter((f) => f.toLowerCase().endsWith(pattern));

    if (!matched.length) {
      console.warn(`[combine] No files found for ${subject}`);
      continue;
    }

    const combinedQuestions = [];
    const sourceFiles = [];

    for (const f of matched) {
      const full = path.join(SECTIONS_ONLY_DIR, f);
      const raw = fs.readFileSync(full, "utf8");
      const data = safeJsonParse(raw, f);

      const questions = data?.sections?.[subject]?.questions;
      if (!Array.isArray(questions) || questions.length === 0) continue;

      combinedQuestions.push(...questions);
      sourceFiles.push(f);
    }

    const out = {
      sections: {
        [subject]: {
          questions: combinedQuestions,
        },
      },
      sourceFiles,
    };

    const outPath = path.join(OUTPUT_DIR, `ALL_${subject}.json`);
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
    console.log(
      `[combine] ${subject}: ${matched.length} input file(s) → ${combinedQuestions.length} questions`
    );
  }
};

main();

