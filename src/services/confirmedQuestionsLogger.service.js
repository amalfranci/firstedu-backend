/**
 * Append human-readable confirmed question logs to temp/confirmed-questions/.
 * Topic + section + questions with correct answer and explanation.
 */

import fs from 'fs';
import path from 'path';
import {
    buildLogTimestampPrefix,
    topicSlug,
} from '../utils/aiApiCallLogger.js';
import { dedupePaperQuestionsByStem } from '../utils/paperQuestionDedupe.js';
import {
    finalizeExplanationForPublish,
    autoFixOptionArticles,
    formatStatementBasedQuestion,
} from '../utils/explanationAnswerAlign.js';

const LOG_ROOT = path.join(process.cwd(), 'temp', 'confirmed-questions');

const logDateFolder = (date = new Date()) => {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const ensureLogDir = (date = new Date()) => {
    const dir = path.join(LOG_ROOT, logDateFolder(date));
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
};

const letterFromIndex = (idx) => {
    const n = Number(idx);
    if (!Number.isFinite(n) || n < 0 || n > 25) return '?';
    return String.fromCharCode(65 + n);
};

const stemOf = (q) =>
    String(q?.questionText || q?.text || q?.title || '').trim();

const optionTextOf = (opt) => {
    if (opt && typeof opt === 'object' && opt.text != null) {
        return String(opt.text).trim();
    }
    return String(opt || '').trim();
};

const optionsOf = (q) => {
    if (Array.isArray(q?.options)) return q.options;
    const legacy = ['optionA', 'optionB', 'optionC', 'optionD']
        .map((k) => q?.[k])
        .filter((o) => String(o || '').trim());
    return legacy.length ? legacy : [];
};

const resolveCorrectIndexes = (q) => {
    const type = String(q?.questionType || 'single').toLowerCase();
    if (type === 'multiple') {
        if (Array.isArray(q?.multipleCorrectIndexes) && q.multipleCorrectIndexes.length) {
            return q.multipleCorrectIndexes;
        }
        const opts = optionsOf(q);
        return opts
            .map((opt, i) => (opt && typeof opt === 'object' && opt.isCorrect ? i : -1))
            .filter((i) => i >= 0);
    }
    if (q?.correctIndex != null && Number.isFinite(Number(q.correctIndex))) {
        return [Number(q.correctIndex)];
    }
    const opts = optionsOf(q);
    const fromFlag = opts.findIndex(
        (opt) => opt && typeof opt === 'object' && opt.isCorrect
    );
    if (fromFlag >= 0) return [fromFlag];
    if (q?.correctAnswer != null && String(q.correctAnswer).trim()) {
        const letter = String(q.correctAnswer).trim().toUpperCase();
        const idx = letter.charCodeAt(0) - 65;
        if (idx >= 0 && idx <= 3) return [idx];
    }
    return [];
};

const formatCorrectAnswer = (q) => {
    const type = String(q?.questionType || 'single').toLowerCase();
    const opts = optionsOf(q);
    const indexes = resolveCorrectIndexes(q);

    if (type === 'true_false' && indexes.length) {
        const text = optionTextOf(opts[indexes[0]]);
        return text || letterFromIndex(indexes[0]);
    }
    if (type === 'multiple' && indexes.length) {
        return indexes.map(letterFromIndex).join(', ');
    }
    if (indexes.length) {
        return letterFromIndex(indexes[0]);
    }
    if (q?.correctAnswer != null && String(q.correctAnswer).trim()) {
        return String(q.correctAnswer).trim();
    }
    return '';
};

const formatQuestionBlock = (q, label) => {
    const type = String(q?.questionType || 'single').toLowerCase();
    const lines = [`--- ${label} ---`];

    if (type === 'connected') {
        const passage = String(q?.passage || '').trim();
        if (passage) {
            lines.push('Passage:', passage, '');
        }
        const subs = q?.subQuestions || q?.connectedQuestions || [];
        subs.forEach((sub, i) => {
            lines.push(
                formatQuestionBlock(
                    { ...sub, questionType: sub.questionType || 'single' },
                    `${label}.${i + 1}`
                )
            );
        });
        return lines.join('\n');
    }

    // Always print a Passage block when present — including single/multiple
    // VA items that carry an embedded source separately from the stem.
    const passage = String(q?.passage || q?.passageText || q?.paragraph || '').trim();
    const stem = formatStatementBasedQuestion(stemOf(q));
    if (passage) {
        const stemHasPassage =
            stem &&
            passage.length >= 80 &&
            stem.includes(passage.slice(0, Math.min(80, passage.length)));
        if (!stemHasPassage) {
            lines.push('Passage:', passage, '');
        }
    }
    if (stem) lines.push(stem, '');

    const opts = optionsOf(q);
    opts.forEach((opt, i) => {
        const text = optionTextOf(opt);
        if (text) lines.push(`${letterFromIndex(i)}) ${text}`);
    });

    const correct = formatCorrectAnswer(q);
    if (correct) {
        lines.push('', `Correct: ${correct}`);
    }

    const explanation = String(q?.explanation || '').trim();
    if (explanation) {
        lines.push(`Explanation: ${explanation}`);
    }

    lines.push('');
    return lines.join('\n');
};

const buildFileHeader = ({
    topic,
    sectionName = '',
    sectionIndex = null,
}) => {
    const lines = [
        '='.repeat(72),
        `Topic: ${topic}`,
    ];

    if (sectionName?.trim() || sectionIndex != null) {
        lines.push(
            `Section: ${sectionName?.trim() || '(unnamed)'}${sectionIndex != null ? ` (${sectionIndex})` : ''}`
        );
    }

    lines.push('='.repeat(72), '');
    return lines.join('\n');
};

const resolveFileName = ({ topic, sectionName, sectionIndex, date = new Date() }) => {
    const prefix = buildLogTimestampPrefix(date);
    const topicPart = topicSlug(topic || 'topic');
    const sectionPart =
        sectionName?.trim()
            ? topicSlug(sectionName)
            : sectionIndex != null
              ? `section-${sectionIndex}`
              : 'all';
    return `${prefix}-${topicPart}-${sectionPart}.txt`;
};

const normalizeConfirmedItem = (item = {}) => {
    const rawOpts = optionsOf(item);
    const fixedOpts = autoFixOptionArticles(rawOpts);
    const correct = formatCorrectAnswer(item);
    const finalized = finalizeExplanationForPublish({
        explanation: item?.explanation,
        correctAnswer: correct,
    });
    const rawSubs = Array.isArray(item?.subQuestions)
        ? item.subQuestions
        : Array.isArray(item?.connectedQuestions)
            ? item.connectedQuestions
            : null;
    const subs = rawSubs ? rawSubs.map(normalizeConfirmedItem) : undefined;

    return {
        ...item,
        options: fixedOpts,
        correctAnswer: correct,
        explanation: finalized.explanation,
        ...(subs ? { subQuestions: subs } : {}),
    };
};

/**
 * When a job config or paper has multiple subjects (e.g. ['Mathematics', 'Chemistry']),
 * ensure the topic string and resulting slug include all subjects instead of truncating.
 */
export const resolveMultiSubjectTopic = (topic, subjects = [], list = []) => {
    let resolved = String(topic || '').trim();
    const collected = [];
    const addSubj = (s) => {
        const val = String(s || '').trim();
        if (val && !collected.some(c => c.toLowerCase() === val.toLowerCase())) {
            collected.push(val);
        }
    };
    (Array.isArray(subjects) ? subjects : []).forEach(addSubj);
    (Array.isArray(list) ? list : []).forEach(q => {
        if (q?.subject) addSubj(q.subject);
        if (Array.isArray(q?.subQuestions)) {
            q.subQuestions.forEach(sq => {
                if (sq?.subject) addSubj(sq.subject);
            });
        }
    });

    if (collected.length <= 1) {
        return resolved || collected[0] || 'topic';
    }

    const missing = collected.filter(
        s => !new RegExp(`\\b${s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i').test(resolved)
    );

    if (!resolved) {
        return collected.join(', ');
    }

    if (missing.length > 0) {
        const parts = resolved.split(/\s*›\s*/);
        const lastPart = parts[parts.length - 1]?.trim();
        const matched = collected.find(
            s => s.toLowerCase() === lastPart?.toLowerCase()
        );
        if (matched) {
            parts[parts.length - 1] = collected.join(', ');
            resolved = parts.join(' › ');
        } else {
            resolved = `${resolved} › ${collected.join(', ')}`;
        }
    }

    return resolved;
};

/**
 * @returns {{ filePath: string, questionCount: number, appended: boolean }}
 */
export const logConfirmedQuestionsToFile = async ({
    topic,
    subjects = [],
    bankName = '',
    sectionName = '',
    sectionIndex = null,
    questions = [],
}) => {
    const rawList = dedupePaperQuestionsByStem(
        Array.isArray(questions) ? questions.filter(Boolean) : []
    );
    const list = rawList.map(normalizeConfirmedItem);
    if (!String(topic || '').trim()) {
        throw new Error('Topic is required to log confirmed questions');
    }
    if (!list.length) {
        throw new Error('At least one question is required');
    }

    const resolvedTopic = resolveMultiSubjectTopic(topic, subjects, list);
    let resolvedBankName = bankName;
    if (resolvedBankName && resolvedTopic !== topic) {
        const [bName, bSuffix] = resolvedBankName.split(/\s*·\s*/);
        const updatedBase = resolveMultiSubjectTopic(bName, subjects, list);
        resolvedBankName = bSuffix ? `${updatedBase} · ${bSuffix}` : updatedBase;
    }

    const now = new Date();
    const dir = ensureLogDir(now);
    let duplicateIndex = 0;
    let fileName = resolveFileName({
        topic: resolvedTopic,
        sectionName,
        sectionIndex,
        date: now,
    });
    let filePath = path.join(dir, fileName);

    while (duplicateIndex < 60) {
        try {
            await fs.promises.access(filePath);
            duplicateIndex += 1;
            fileName = resolveFileName({
                topic: resolvedTopic,
                sectionName,
                sectionIndex,
                date: now,
            }).replace(/\.txt$/, `-${duplicateIndex}.txt`);
            filePath = path.join(dir, fileName);
        } catch {
            break;
        }
    }

    const body = [
        buildFileHeader({
            topic: resolvedTopic,
            sectionName,
            sectionIndex,
        }),
        ...list.map((q, i) => formatQuestionBlock(q, `Question ${i + 1}`)),
    ].join('\n');

    let appended = false;
    try {
        await fs.promises.access(filePath);
        await fs.promises.appendFile(
            filePath,
            `\n${'─'.repeat(72)}\n\n${list.map((q, i) => formatQuestionBlock(q, `Question ${i + 1}`)).join('\n')}`,
            'utf8'
        );
        appended = true;
    } catch {
        await fs.promises.writeFile(filePath, body, 'utf8');
    }

    // Mirror to .json format in the same directory
    const jsonFilePath = filePath.replace(/\.txt$/, '.json');
    const jsonPayload = {
        topic: resolvedTopic,
        bankName: resolvedBankName || bankName,
        sectionName: sectionName || null,
        sectionIndex: sectionIndex ?? null,
        timestamp: now.toISOString(),
        questionCount: list.length,
        questions: list.map((q, i) => {
            const opts = optionsOf(q);
            const correct = formatCorrectAnswer(q);
            const subs = Array.isArray(q?.subQuestions)
                ? q.subQuestions.map((sub, sIdx) => {
                    const subOpts = optionsOf(sub);
                    return {
                        ...sub,
                        questionNumber: `${i + 1}.${sIdx + 1}`,
                        questionType: sub?.questionType || 'single',
                        options: subOpts.map((opt, optIdx) => ({
                            key: letterFromIndex(optIdx),
                            text: optionTextOf(opt),
                        })),
                        correctAnswer: formatCorrectAnswer(sub),
                        explanation: String(sub?.explanation || '').trim(),
                    };
                })
                : undefined;
            return {
                questionNumber: i + 1,
                questionType: q?.questionType || 'single',
                subject: q?.subject || null,
                topic: q?.topic || null,
                marks: q?.marks ?? 4,
                negativeMarks: q?.negativeMarks ?? 0,
                passage: q?.passage || q?.paragraph || null,
                questionText: stemOf(q),
                options: opts.map((opt, optIdx) => ({
                    key: letterFromIndex(optIdx),
                    text: optionTextOf(opt),
                })),
                correctAnswer: correct,
                explanation: String(q?.explanation || '').trim(),
                ...(subs ? { subQuestions: subs } : {}),
            };
        }),
    };
    try {
        await fs.promises.writeFile(
            jsonFilePath,
            JSON.stringify(jsonPayload, null, 2),
            'utf8'
        );
    } catch (jsonErr) {
        console.error('[confirmed-questions] failed to write json log:', jsonErr?.message);
    }

    console.log(
        `[confirmed-questions] ${appended ? 'appended' : 'wrote'} ${list.length} question(s) → ${filePath} and ${jsonFilePath}`
    );

    return {
        filePath,
        jsonFilePath,
        questionCount: list.length,
        appended,
    };
};

export const getConfirmedQuestionsLogRoot = () => LOG_ROOT;
