import { ApiError } from "./ApiError.js";

export const UNIQUE_PAPER_LIMIT_CODE = "UNIQUE_PAPER_LIMIT";

export const UNIQUE_PAPER_LIMIT_MESSAGE =
  "You've used all currently available unique question papers for this exam. Please try another exam";

export const uniquePaperLimitError = () =>
  new ApiError(400, UNIQUE_PAPER_LIMIT_MESSAGE, {
    code: UNIQUE_PAPER_LIMIT_CODE,
  });

export const shuffle = (items = []) => {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
};

export const questionId = (question) =>
  String(question?._id || question?.questionId || "");

export const contentKey = (question) => {
  const text = String(question?.questionText || question?.question || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const passage = String(question?.passage || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return `${passage}||${text}`;
};

export const dedupeQuestions = (questions = [], blocked = new Set()) => {
  const seen = new Set(blocked);
  const unique = [];
  for (const question of questions) {
    const id = questionId(question);
    const key = contentKey(question);
    const idToken = id ? `id:${id}` : "";
    const textToken = key.replace(/\|/g, "") ? `text:${key}` : "";
    if ((idToken && seen.has(idToken)) || (textToken && seen.has(textToken))) {
      continue;
    }
    if (idToken) seen.add(idToken);
    if (textToken) seen.add(textToken);
    unique.push(question);
  }
  return unique;
};

export const inferQuestionType = (question) => {
  const raw = String(question?.questionType || question?.type || "").toLowerCase();
  if (raw.includes("true") || raw === "tf") return "true_false";
  if (raw.includes("multi") || raw.includes("msq")) return "multiple";
  if (raw.includes("single") || raw.includes("mcq")) return "single";
  const correct = question?.correctAnswer ?? question?.correct;
  if (Array.isArray(correct) && correct.length > 1) return "multiple";
  if (
    typeof correct === "string" &&
    correct.includes(",") &&
    correct.replace(/[^A-Ea-e]/g, "").length > 1
  ) {
    return "multiple";
  }
  return "single";
};

export const passageKey = (question) => String(question?.passage || "").trim();

export const topicKey = (question) =>
  String(question?.topic || question?.chapter || "General").trim() || "General";

export const difficultyKey = (question) => {
  const value = String(question?.difficulty || "").toLowerCase();
  if (value === "easy" || value === "hard") return value;
  return "medium";
};

export const paperFingerprint = (questions = []) =>
  questions
    .map(questionId)
    .filter(Boolean)
    .sort()
    .join("|");

const buildUnits = (pool) => {
  const passages = new Map();
  const units = [];
  for (const question of pool) {
    const key = passageKey(question);
    if (key) {
      if (!passages.has(key)) passages.set(key, []);
      passages.get(key).push(question);
      continue;
    }
    units.push({
      id: questionId(question),
      questions: [question],
      topic: topicKey(question),
      difficulty: difficultyKey(question),
      size: 1,
    });
  }
  for (const [key, questions] of passages.entries()) {
    units.push({
      id: `passage:${key}`,
      questions,
      topic: topicKey(questions[0]),
      difficulty: difficultyKey(questions[0]),
      size: questions.length,
    });
  }
  return units;
};

const questionsFromUnits = (units = []) =>
  units.flatMap(unit => unit.questions || []);

const fillQuestionsToNeed = (units, need) => {
  const exact = pickExactUnits(units, need);
  if (exact) return questionsFromUnits(exact);

  const greedy = takeRoundRobin(units, need);
  const picked = questionsFromUnits(greedy);
  if (picked.length >= need) return picked.slice(0, need);

  const used = new Set(greedy.map(unit => unit.id));
  const leftover = shuffle(units.filter(unit => !used.has(unit.id)));
  for (const unit of leftover) {
    for (const question of unit.questions) {
      if (picked.length >= need) break;
      picked.push(question);
    }
    if (picked.length >= need) break;
  }
  return picked.length >= need ? picked.slice(0, need) : null;
};

const pickExactUnits = (units, need) => {
  const want = Math.max(0, Number(need) || 0);
  if (!want) return [];
  const ordered = shuffle(units);
  const best = new Map([[0, []]]);
  for (let i = 0; i < ordered.length; i += 1) {
    const size = ordered[i].size;
    const snapshot = [...best.entries()];
    for (const [sum, idxs] of snapshot) {
      const next = sum + size;
      if (next > want || best.has(next)) continue;
      best.set(next, [...idxs, i]);
      if (next === want) {
        return best.get(want).map(index => ordered[index]);
      }
    }
  }
  return best.has(want) ? best.get(want).map(index => ordered[index]) : null;
};

const takeRoundRobin = (units, need) => {
  const byTopic = new Map();
  for (const unit of shuffle(units)) {
    if (!byTopic.has(unit.topic)) byTopic.set(unit.topic, []);
    byTopic.get(unit.topic).push(unit);
  }
  const queues = [...byTopic.values()];
  const picked = [];
  const used = new Set();
  let progressed = true;

  const tryTake = (unit) => {
    if (used.has(unit.id)) return false;
    if (picked.length + unit.size > need) return false;
    picked.push(unit);
    used.add(unit.id);
    return true;
  };

  while (picked.reduce((sum, unit) => sum + unit.size, 0) < need && progressed) {
    progressed = false;
    for (const queue of queues) {
      const filled = picked.reduce((sum, unit) => sum + unit.size, 0);
      if (filled >= need) break;
      const next = queue.find((unit) => !used.has(unit.id) && filled + unit.size <= need);
      if (next && tryTake(next)) progressed = true;
    }
  }

  if (picked.reduce((sum, unit) => sum + unit.size, 0) < need) {
    const leftover = shuffle(units)
      .filter((unit) => !used.has(unit.id))
      .sort((a, b) => a.size - b.size);
    for (const unit of leftover) {
      if (tryTake(unit) && picked.reduce((sum, item) => sum + item.size, 0) >= need) {
        break;
      }
    }
  }

  return picked;
};

const rebalanceDifficulty = (units, need) => {
  const standalone = units.filter((unit) => unit.size === 1);
  const diffs = new Set(standalone.map((unit) => unit.difficulty));
  if (diffs.size < 2) return units;

  const target = {
    easy: Math.round(need * 0.3),
    medium: Math.round(need * 0.5),
    hard: 0,
  };
  target.hard = Math.max(0, need - target.easy - target.medium);

  const buckets = { easy: [], medium: [], hard: [] };
  for (const unit of shuffle(standalone)) {
    buckets[unit.difficulty].push(unit);
  }

  const chosen = [];
  const used = new Set();
  for (const [level, want] of Object.entries(target)) {
    while (chosen.length < need && buckets[level].length && want > chosen.filter((u) => u.difficulty === level).length) {
      const unit = buckets[level].shift();
      chosen.push(unit);
      used.add(unit.id);
    }
  }
  const rest = shuffle(units.filter((unit) => !used.has(unit.id)));
  for (const unit of rest) {
    if (chosen.reduce((sum, item) => sum + item.size, 0) >= need) break;
    if (chosen.reduce((sum, item) => sum + item.size, 0) + unit.size <= need) {
      chosen.push(unit);
    }
  }
  return chosen;
};

export const pickQuestionsForSubject = (pool = [], need = 0, options = {}) => {
  const want = Math.max(0, Number(need) || 0);
  if (want <= 0) return [];

  let eligible = dedupeQuestions(pool, options.blocked || new Set());
  if (options.allowedTypes?.length) {
    eligible = eligible.filter((question) =>
      options.allowedTypes.includes(inferQuestionType(question))
    );
  }

  const typeCounts = options.typeCounts || null;
  const typedNeed =
    typeCounts &&
    (Number(typeCounts.single) || 0) +
      (Number(typeCounts.multiple) || 0) +
      (Number(typeCounts.trueFalse) || 0);

  if (typedNeed > 0) {
    const picked = [];
    for (const [type, count] of [
      ["single", Number(typeCounts.single) || 0],
      ["multiple", Number(typeCounts.multiple) || 0],
      ["true_false", Number(typeCounts.trueFalse) || 0],
    ]) {
      if (count <= 0) continue;
      const slice = pickQuestionsForSubject(
        eligible.filter((question) => inferQuestionType(question) === type),
        count,
        { allowedTypes: [type] }
      );
      if (!slice || slice.length < count) return null;
      picked.push(...slice);
    }
    const unique = dedupeQuestions(picked);
    if (unique.length < picked.length) return null;
    return shuffleKeepPassages(unique);
  }

  if (eligible.length < want) return null;

  const units = buildUnits(eligible);
  const total = units.reduce((sum, unit) => sum + unit.size, 0);
  if (total < want) return null;

  const questions = fillQuestionsToNeed(units, want);
  const unique = dedupeQuestions(questions || []);
  if (unique.length < want) return null;
  return shuffleKeepPassages(unique.slice(0, want));
};

const shuffleKeepPassages = (questions = []) => {
  const groups = [];
  const seen = new Map();
  for (const question of questions) {
    const key = passageKey(question);
    if (!key) {
      groups.push([question]);
      continue;
    }
    if (!seen.has(key)) {
      const group = [];
      seen.set(key, group);
      groups.push(group);
    }
    seen.get(key).push(question);
  }
  return shuffle(groups).flat();
};

export const remainingUniqueSets = (pool, need) => {
  const size = Math.max(0, Number(need) || 0);
  if (!size) return 0;
  return Math.floor((pool?.length || 0) / size);
};

export const generateUniqueCompetitivePaper = async ({
  loadQuestions,
  examType,
  examLabel,
  counts,
  durationMinutes,
  marksPerQuestion,
  negativeMarks,
  normalizeSubject,
  excludeQuestionIds = [],
  subject = null,
  count = null,
  typeCounts = null,
  allowedTypes = null,
  mapQuestion,
}) => {
  const pattern = { ...counts };
  const subjectOrder = Object.keys(pattern);
  const all = await loadQuestions();
  if (!all.length) {
    throw new ApiError(400, `No ${examLabel} questions are stored in the database.`);
  }

  const excluded = new Set((excludeQuestionIds || []).map(String));
  const blocked = new Set();
  for (const question of all) {
    if (!excluded.has(String(question._id))) continue;
    const id = questionId(question);
    const key = contentKey(question);
    if (id) blocked.add(`id:${id}`);
    if (key.replace(/\|/g, "")) blocked.add(`text:${key}`);
  }

  const unused = dedupeQuestions(
    all.filter((question) => !excluded.has(String(question._id))),
    blocked
  );

  const groups = Object.fromEntries(subjectOrder.map((name) => [name, []]));
  unused.forEach((question) => {
    const name = normalizeSubject(question.subject);
    if (groups[name]) groups[name].push(question);
  });

  const requestedSubject = subject
    ? subjectOrder.find((name) => name.toLowerCase() === String(subject).toLowerCase()) ||
      normalizeSubject(subject)
    : null;

  const targets = requestedSubject
    ? {
        [requestedSubject]: Math.max(
          1,
          Number(count) || pattern[requestedSubject] || 0
        ),
      }
    : { ...pattern };

  const remainingBySubject = {};
  for (const name of Object.keys(targets)) {
    remainingBySubject[name] = remainingUniqueSets(
      groups[name] || [],
      targets[name]
    );
  }
  const remainingSets = Math.min(
    ...Object.keys(targets).map((name) => remainingBySubject[name] || 0)
  );

  if (remainingSets < 1) {
    throw uniquePaperLimitError();
  }

  const picked = [];
  const alreadyUsed = new Set(blocked);
  for (const [name, need] of Object.entries(targets)) {
    const selected = pickQuestionsForSubject(groups[name] || [], need, {
      allowedTypes,
      typeCounts: requestedSubject ? typeCounts : null,
      blocked: alreadyUsed,
    });
    if (!selected || selected.length < need) {
      throw uniquePaperLimitError();
    }
    selected.forEach((question, index) => {
      const mapped = mapQuestion(question);
      const id = questionId(mapped);
      const key = contentKey(mapped);
      if (id) alreadyUsed.add(`id:${id}`);
      if (key.replace(/\|/g, "")) alreadyUsed.add(`text:${key}`);
      picked.push({
        ...mapped,
        subject: name,
        displayNumber: picked.length + 1,
        subjectNumber: index + 1,
      });
    });
  }

  const uniquePicked = dedupeQuestions(picked);
  if (uniquePicked.length !== picked.length) {
    throw uniquePaperLimitError();
  }

  const leftoverBySubject = {};
  for (const name of subjectOrder) {
    const used = new Set(picked.map((question) => String(question.questionId)));
    leftoverBySubject[name] = remainingUniqueSets(
      (groups[name] || []).filter((question) => !used.has(String(question._id))),
      requestedSubject ? targets[requestedSubject] : pattern[name]
    );
  }

  return {
    exam: examLabel,
    examType,
    title: requestedSubject
      ? `${examLabel} · ${requestedSubject}`
      : `${examLabel} Combined Paper`,
    durationMinutes,
    totalQuestions: picked.length,
    totalMarks: picked.reduce(
      (sum, question) => sum + (question.marks || marksPerQuestion),
      0
    ),
    pattern: requestedSubject ? targets : pattern,
    sections: Object.keys(targets).map((name) => ({
      subject: name,
      count: targets[name],
      questions: picked.filter((question) => question.subject === name),
    })),
    questions: picked,
    usedQuestionIds: picked.map((question) => String(question.questionId)),
    fingerprint: paperFingerprint(picked),
    remainingSets: Math.min(...Object.values(leftoverBySubject)),
    remainingBySubject: leftoverBySubject,
    uniquePaper: true,
  };
};
