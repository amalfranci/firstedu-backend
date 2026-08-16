export const stemOf = (item) =>
  String(
    item.question_text ||
      item.questionText ||
      item.question ||
      item.stem ||
      ""
  ).trim();

export const optionsOf = (item) =>
  Object.fromEntries(
    Object.entries(item.options || {}).map(([k, v]) => [
      String(k).toUpperCase(),
      String(v ?? "").trim(),
    ])
  );

export const correctOf = (item) =>
  String(item.correct_option || item.correct_answer || item.correct || "A")
    .toUpperCase()
    .trim()
    .replace(/^OPTION\s+/, "")
    .charAt(0) || "A";

export const pushItem = (grouped, section, item, extra = {}) => {
  if (!grouped[section]) grouped[section] = [];
  const question = stemOf(item);
  if (!question) return;
  grouped[section].push({
    question,
    options: optionsOf(item),
    correct: correctOf(item),
    explanation: String(item.explanation || "").trim(),
    passage: String(
      extra.passage ||
        item.passage ||
        item.passage_text ||
        item.shared_context ||
        item.passage_or_context ||
        ""
    ).trim(),
    type: String(extra.type || item.type || item.topic || "").trim(),
  });
};

const walkSectionBlock = (block, section, grouped) => {
  if (!block || typeof block !== "object") return;
  if (Array.isArray(block.questions)) {
    for (const q of block.questions) pushItem(grouped, section, q);
  }
  if (Array.isArray(block.standalone_questions)) {
    for (const q of block.standalone_questions) pushItem(grouped, section, q);
  }
  if (Array.isArray(block.passages)) {
    for (const p of block.passages) {
      const text = p.text || p.passage_text || p.passage || p.shared_context || "";
      for (const q of p.questions || []) pushItem(grouped, section, q, { passage: text });
    }
  }
  if (Array.isArray(block.sets)) {
    for (const set of block.sets) {
      const text = set.text || set.passage || set.context || "";
      for (const q of set.questions || []) pushItem(grouped, section, q, { passage: text, type: set.set_name || set.name });
    }
  }
  if (Array.isArray(block.caselets)) {
    for (const c of block.caselets) {
      const text = c.text || c.passage || "";
      for (const q of c.questions || []) pushItem(grouped, section, q, { passage: text });
    }
  }
  if (Array.isArray(block.subsections)) {
    for (const sub of block.subsections) {
      const text = sub.text || sub.passage || sub.passage_text || sub.shared_context || "";
      const type = sub.subsection_name || sub.section_name || sub.name || "";
      if (Array.isArray(sub.questions)) {
        for (const q of sub.questions) pushItem(grouped, section, q, { passage: text, type });
      }
      walkSectionBlock(sub, section, grouped);
    }
  }
};

export const collectSectioned = (raw, normalizeSection) => {
  const grouped = {};
  const source = Array.isArray(raw) ? { questions: raw } : raw;

  if (Array.isArray(source.questions)) {
    for (const q of source.questions) {
      pushItem(grouped, normalizeSection(q.section || q.subject || ""), q);
    }
  }

  if (Array.isArray(source.sections)) {
    for (const sec of source.sections) {
      const name = normalizeSection(
        sec.section_name || sec.section || sec.name || sec.subject || ""
      );
      walkSectionBlock(sec, name, grouped);
    }
  }

  if (Array.isArray(source.modules)) {
    for (const mod of source.modules) {
      const name = normalizeSection(mod.section_name || mod.module || "");
      walkSectionBlock(mod, name, grouped);
    }
  }

  if (Array.isArray(source.papers)) {
    for (const paper of source.papers) {
      const inner = collectSectioned(paper, normalizeSection);
      for (const [k, v] of Object.entries(inner)) {
        grouped[k] = (grouped[k] || []).concat(v);
      }
    }
  }

  if (Array.isArray(raw)) {
    for (const q of raw) {
      pushItem(grouped, normalizeSection(q.section || q.subject || ""), q);
    }
  }

  return grouped;
};

export const writePaper = (fs, path, outDir, paperId, title, exam, year, subjects) => {
  const paper = { paper_id: paperId, title, exam, year, subjects };
  const file = `${paperId}.json`;
  fs.writeFileSync(path.join(outDir, file), `${JSON.stringify(paper, null, 2)}\n`, "utf8");
  return file;
};

export const rule = (re, topic) => ({ re: new RegExp(re, "i"), topic });

export const matchRules = (text, rules, fallback) => {
  for (const item of rules) {
    if (item.re.test(text)) return { topic: item.topic, matched: true };
  }
  return { topic: fallback, matched: false };
};
