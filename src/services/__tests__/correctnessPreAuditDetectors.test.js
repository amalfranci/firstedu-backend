/**
 * Test suite for detectMarkedOptionUnitMismatch and detectBatchDuplicateStemIssues
 * (correctnessPreAudit.service.js) — wired into runDeterministicCorrectnessAudit but
 * had zero test coverage. Cases below are drawn from real failures found in external
 * QC reviews of generated JEE Main papers (unit-mismatched "correct" options, and
 * Wheatstone-bridge/disk-flux/point-line-distance questions repeated 2-3x per paper).
 */

import {
    detectMarkedOptionUnitMismatch,
    detectBatchDuplicateStemIssues,
} from '../correctnessPreAudit.service.js';

describe('detectMarkedOptionUnitMismatch', () => {
    test('flags a voltage question keyed to a J/mol·K option (real review finding)', () => {
        const q = {
            sampleNumber: 1,
            questionText: 'Calculate the cell potential (voltage) of the galvanic cell given ΔH° and ΔS°.',
            options: ['0.388 V', '0.42 V', '301.5 J/mol·K', '0.29 V'],
            correctIndex: 2,
        };
        const issue = detectMarkedOptionUnitMismatch(q);
        expect(issue).toBeDefined();
        expect(issue.severity).toBe('critical');
        expect(issue.issue).toMatch(/voltage/i);
    });

    test('flags a temperature question keyed to a J/mol·K option (real review finding)', () => {
        const q = {
            sampleNumber: 2,
            questionText: 'Find the temperature T at which the reaction becomes spontaneous, given ΔH° and ΔS°.',
            options: ['375 K', '425 K', '140.7 J/mol·K', '500 K'],
            correctIndex: 2,
        };
        const issue = detectMarkedOptionUnitMismatch(q);
        expect(issue).toBeDefined();
        expect(issue.severity).toBe('critical');
        expect(issue.issue).toMatch(/temperature/i);
    });

    test('does not flag a valid voltage question keyed to volts', () => {
        const q = {
            sampleNumber: 3,
            questionText: 'Calculate the emf (voltage) of the cell.',
            options: ['0.29 V', '0.42 V', '0.58 V', '0.65 V'],
            correctIndex: 2,
        };
        expect(detectMarkedOptionUnitMismatch(q)).toBeNull();
    });

    test('does not flag when the stem does not match any tracked unit family', () => {
        const q = {
            sampleNumber: 4,
            questionText: 'How many distinct arrangements are possible?',
            options: ['24', '120', '720', '360'],
            correctIndex: 0,
        };
        expect(detectMarkedOptionUnitMismatch(q)).toBeNull();
    });

    test('does not false-positive when the option carries both a matching and a foreign-looking token', () => {
        // "5 V" for a voltage stem must not be flagged just because some other
        // unit family's regex happens to loosely match part of the string.
        const q = {
            sampleNumber: 5,
            questionText: 'What is the potential difference across the resistor?',
            options: ['5 V', '10 V', '15 V', '20 V'],
            correctIndex: 0,
        };
        expect(detectMarkedOptionUnitMismatch(q)).toBeNull();
    });
});

describe('detectBatchDuplicateStemIssues', () => {
    test('flags the 2nd and 3rd of three Wheatstone-bridge questions in one batch', () => {
        const questions = [
            {
                sampleNumber: 1,
                questionText:
                    'A Wheatstone bridge has four resistors with a temperature coefficient α = 0.004/K. Find the galvanometer current.',
            },
            {
                sampleNumber: 2,
                questionText:
                    'A Wheatstone bridge has four resistors with a temperature coefficient α = 0.006/K. Find the galvanometer current.',
            },
            {
                sampleNumber: 3,
                questionText:
                    'A metre bridge has four resistors with a temperature coefficient α = 0.005/K. Find the galvanometer current.',
            },
            {
                sampleNumber: 4,
                questionText:
                    'A block of mass 2 kg slides down a frictionless incline of angle 30°. Find its acceleration.',
            },
        ];
        const issues = detectBatchDuplicateStemIssues(questions);
        const flaggedNumbers = issues
            .filter((i) => /template duplicate/i.test(i.issue))
            .map((i) => i.questionNumber);
        expect(flaggedNumbers).toContain(2);
        expect(flaggedNumbers).toContain(3);
        expect(flaggedNumbers).not.toContain(1);
        expect(flaggedNumbers).not.toContain(4);
    });

    test('flags near-identical stems even without a known template signature', () => {
        const questions = [
            {
                sampleNumber: 1,
                questionText:
                    'A particle of mass 2 kg moving at 5 m/s collides elastically with a stationary particle of mass 3 kg. Find the final velocity of the first particle.',
            },
            {
                sampleNumber: 2,
                questionText:
                    'A particle of mass 2 kg moving at 5 m/s collides elastically with a stationary particle of mass 3 kg. Find the final velocity of the second particle.',
            },
        ];
        const issues = detectBatchDuplicateStemIssues(questions);
        expect(issues.some((i) => i.questionNumber === 2)).toBe(true);
    });

    test('does not flag genuinely different questions on the same general topic', () => {
        const questions = [
            {
                sampleNumber: 1,
                questionText:
                    'A block of mass 2 kg slides down a frictionless incline of angle 30°. Find its acceleration.',
            },
            {
                sampleNumber: 2,
                questionText:
                    'A satellite orbits Earth at twice the radius of a geostationary orbit. Find its orbital period.',
            },
            {
                sampleNumber: 3,
                questionText:
                    'Calculate the pH of a buffer solution made from 0.1 M acetic acid and 0.1 M sodium acetate.',
            },
        ];
        expect(detectBatchDuplicateStemIssues(questions)).toEqual([]);
    });

    test('only counts the first occurrence of a template as the baseline, not a duplicate of itself', () => {
        const questions = [
            {
                sampleNumber: 1,
                questionText:
                    'Find the shortest distance from a point to the line of intersection of two planes given by their equations.',
            },
        ];
        expect(detectBatchDuplicateStemIssues(questions)).toEqual([]);
    });
});
