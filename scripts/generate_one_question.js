#!/usr/bin/env node
/**
 * Generate JEE Mains Maths question(s) via the solve-first pipeline.
 * Usage:
 *   node scripts/generate_one_question.js
 *   node scripts/generate_one_question.js 5
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import connectDB from '../src/config/db.js';
import { generateQuestionBankSuggestions } from '../src/services/aiQuestion.service.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOPIC = 'Competitive › Engineering › JEE Mains › Full paper';
const SECTION = 'Maths';
const COUNT = Math.min(25, Math.max(1, Number(process.argv[2] || 1) || 1));

const formatQuestion = (q, n = 1) => {
    const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
    const idx = Number.isFinite(q.correctIndex) ? q.correctIndex : 0;
    const lines = [
        `--- Question ${n} ---`,
        q.questionText || '',
        '',
        ...(q.options || []).map((o, i) => `${letters[i]}) ${o}`),
        '',
        `Correct: ${letters[idx]}`,
        `Explanation: ${q.explanation || '(none)'}`,
        '',
    ];
    return lines.join('\n');
};

const main = async () => {
    console.log('Connecting to MongoDB…');
    await connectDB();

    const workflowLogKey = `test-maths-${COUNT}q-${Date.now()}`;
    console.log(
        `Generating ${COUNT} JEE Mains Maths question(s) (workflow: ${workflowLogKey})…`
    );

    const started = Date.now();
    const result = await generateQuestionBankSuggestions({
        topic: TOPIC,
        bankName: TOPIC,
        sectionName: SECTION,
        subject: 'Maths',
        categoryPaths: [
            'Competitive',
            'Engineering',
            'JEE Mains',
            'Full paper',
        ],
        difficulty: 'medium',
        singleCount: COUNT,
        multipleCount: 0,
        trueFalseCount: 0,
        passageCount: 0,
        deferValidation: false,
        generationProvider: 'gemini',
        workflowLogKey,
    });

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const questions = result?.questions || [];

    console.log(`\nDone in ${elapsed}s — ${questions.length}/${COUNT} question(s) returned`);
    console.log('Pipeline:', JSON.stringify(result?.pipelineSummary || {}, null, 2));

    if (!questions.length) {
        console.error('No questions returned — check temp/ai-api-logs for details.');
        process.exit(1);
    }

    const text = [
        '='.repeat(72),
        `Topic: ${TOPIC}`,
        `Section: ${SECTION} (test run — ${questions.length} questions)`,
        '='.repeat(72),
        '',
        ...questions.map((q, i) => formatQuestion(q, i + 1)),
    ].join('\n');

    const outDir = path.join(__dirname, '../temp/confirmed-questions/test-runs');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `${workflowLogKey}.txt`);
    fs.writeFileSync(outFile, text, 'utf8');

    // Also dump raw JSON for PDF tooling / inspection
    const jsonFile = path.join(outDir, `${workflowLogKey}.json`);
    fs.writeFileSync(
        jsonFile,
        JSON.stringify(
            {
                topic: TOPIC,
                section: SECTION,
                pipelineSummary: result?.pipelineSummary || {},
                questions,
            },
            null,
            2
        ),
        'utf8'
    );

    console.log('\n' + text);
    console.log(`Saved to ${outFile}`);
    console.log(`JSON: ${jsonFile}`);
    process.exit(0);
};

main().catch((err) => {
    console.error('Generation failed:', err?.message || err);
    process.exit(1);
});
