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

    const stem = stemOf(q);
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

/**
 * @returns {{ filePath: string, questionCount: number, appended: boolean }}
 */
export const logConfirmedQuestionsToFile = async ({
    topic,
    bankName = '',
    sectionName = '',
    sectionIndex = null,
    questions = [],
}) => {
    const list = dedupePaperQuestionsByStem(
        Array.isArray(questions) ? questions.filter(Boolean) : []
    );
    if (!String(topic || '').trim()) {
        throw new Error('Topic is required to log confirmed questions');
    }
    if (!list.length) {
        throw new Error('At least one question is required');
    }

    const now = new Date();
    const dir = ensureLogDir(now);
    let duplicateIndex = 0;
    let fileName = resolveFileName({
        topic,
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
                topic,
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
            topic,
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

    console.log(
        `[confirmed-questions] ${appended ? 'appended' : 'wrote'} ${list.length} question(s) → ${filePath}`
    );

    return {
        filePath,
        questionCount: list.length,
        appended,
    };
};

export const getConfirmedQuestionsLogRoot = () => LOG_ROOT;
