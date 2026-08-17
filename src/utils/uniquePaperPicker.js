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
      id: `passage:${key.slice(0, 40)}`,
      questions,
      topic: topicKey(questions[0]),
      difficulty: difficultyKey(questions[0]),
      size: questions.length,
    });
  }
  return units;
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

  let eligible = [...pool];
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
    return shuffleKeepPassages(picked);
  }

  if (eligible.length < want) return null;

  const units = buildUnits(eligible);
  const total = units.reduce((sum, unit) => sum + unit.size, 0);
  if (total < want) return null;

  let selected = takeRoundRobin(units, want);
  selected = rebalanceDifficulty(selected, want);

  const questions = [];
  for (const unit of selected) {
    if (questions.length >= want) break;
    if (questions.length + unit.size <= want) {
      questions.push(...unit.questions);
    }
  }

  if (questions.length < want) return null;
  return shuffleKeepPassages(questions.slice(0, want));
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
  const unused = all.filter((question) => !excluded.has(String(question._id)));

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
  for (const [name, need] of Object.entries(targets)) {
    const selected = pickQuestionsForSubject(groups[name] || [], need, {
      allowedTypes,
      typeCounts: requestedSubject ? typeCounts : null,
    });
    if (!selected || selected.length < need) {
      throw uniquePaperLimitError();
    }
    selected.forEach((question, index) => {
      const mapped = mapQuestion(question);
      picked.push({
        ...mapped,
        subject: name,
        displayNumber: picked.length + 1,
        subjectNumber: index + 1,
      });
    });
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
