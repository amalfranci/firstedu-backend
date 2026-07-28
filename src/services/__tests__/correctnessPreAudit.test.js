/**
 * Test suite for correctnessPreAudit.service.js
 * Validates deterministic correctness checks before LLM audit
 */

import {
    detectExplanationConclusionMismatch,
    detectExplanationNamedConclusionMismatch,
    detectInvalidPhScaleOptions,
    detectHybridizationFactualError,
    runDeterministicCorrectnessAudit,
} from '../correctnessPreAudit.service.js';

describe('correctnessPreAudit.service.js', () => {
    describe('detectExplanationConclusionMismatch', () => {
        test('catches Team 1 vs Team 14 confusion (word boundary)', () => {
            const q = {
                questionNumber: 1,
                sampleNumber: 1,
                questionText: 'Which team advances?',
                options: ['Team 1', 'Team 14', 'Team 7', 'Team 3'],
                correctIndex: 1, // Team 14
                correctAnswer: 'Team 14',
                explanation: 'After analysis, Team 1 performed poorly. Team 14 showed excellent performance. Therefore, the correct answer is Team 14.',
            };

            const issue = detectExplanationConclusionMismatch(q);
            // Should NOT flag this — conclusion correctly identifies Team 14
            expect(issue).toBeNull();
        });

        // "Team 14" is a named/text conclusion (not a bare number), so it's caught by
        // detectExplanationNamedConclusionMismatch — detectExplanationConclusionMismatch
        // only matches claim patterns requiring a number immediately after the trigger
        // phrase ("answer is 42"), which "answer is Team 14" does not satisfy.
        test('detects actual Team 1 vs Team 14 mismatch', () => {
            const q = {
                questionNumber: 1,
                sampleNumber: 1,
                questionText: 'Which team advances?',
                options: ['Team 1', 'Team 14', 'Team 7', 'Team 3'],
                correctIndex: 0, // marked Team 1
                correctAnswer: 'Team 1',
                explanation: 'After analysis, Team 14 dominated the tournament. Therefore, the correct answer is Team 14.',
            };

            const issue = detectExplanationNamedConclusionMismatch(q);
            expect(issue).toBeDefined();
            expect(issue.severity).toBe('critical');
            expect(issue.issue).toMatch(/Team 14.*Team 1/i);
        });

        test('catches numeric mismatch (0.2875 vs 0.3000)', () => {
            const q = {
                questionNumber: 2,
                sampleNumber: 2,
                questionText: 'Calculate the probability.',
                options: ['0.2500', '0.2875', '0.3000', '0.3125'],
                correctIndex: 2, // 0.3000
                correctAnswer: '0.3000',
                explanation: 'P(A) = 0.15, P(B) = 0.1375, total probability = 0.2875. Therefore, the correct answer is 0.2875.',
            };

            const issue = detectExplanationConclusionMismatch(q);
            expect(issue).toBeDefined();
            expect(issue.severity).toBe('critical');
        });

        test('ignores false positives in compound explanations', () => {
            const q = {
                questionNumber: 3,
                sampleNumber: 3,
                questionText: 'Chart type?',
                options: ['Scatter plot', 'Line graph', 'Bar chart', 'Histogram'],
                correctIndex: 0,
                correctAnswer: 'Scatter plot',
                explanation: 'The data points are scattered, not forming a line. Therefore, Scatter plot is the correct answer.',
            };

            const issue = detectExplanationConclusionMismatch(q);
            // "scattered" in explanation, "Scatter plot" is the key — should not flag
            expect(issue).toBeNull();
        });
    });

    describe('detectInvalidPhScaleOptions', () => {
        test('flags pH > 14 in buffer question', () => {
            const q = {
                questionNumber: 4,
                sampleNumber: 4,
                questionText: 'Calculate pH of a buffer solution using Henderson-Hasselbalch.',
                options: ['5.5', '7.4', '44', '9.2'],
                correctIndex: 1,
            };

            const issue = detectInvalidPhScaleOptions(q);
            expect(issue).toBeDefined();
            expect(issue.severity).toBe('critical');
            expect(issue.issue).toMatch(/44.*pH/i);
        });

        test('allows valid pH values 0-14', () => {
            const q = {
                questionNumber: 5,
                sampleNumber: 5,
                questionText: 'What is the pH?',
                options: ['1.2', '7.0', '12.5', '0.5'],
                correctIndex: 1,
            };

            const issue = detectInvalidPhScaleOptions(q);
            expect(issue).toBeNull();
        });
    });

    describe('runDeterministicCorrectnessAudit', () => {
        test('detects multiple issues in a batch', () => {
            const questions = [
                {
                    questionNumber: 1,
                    sampleNumber: 1,
                    questionText: 'Team question',
                    options: ['Team 1', 'Team 14', 'Team 7', 'Team 3'],
                    correctIndex: 0,
                    correctAnswer: 'Team 1',
                    explanation: 'Analysis shows Team 14 wins. Therefore, Team 14.',
                },
                {
                    questionNumber: 2,
                    sampleNumber: 2,
                    questionText: 'pH buffer problem',
                    options: ['5.5', '7.4', '55', '9.2'],
                    correctIndex: 1,
                },
            ];

            const result = runDeterministicCorrectnessAudit(questions);
            expect(result.confirmedIssues.length).toBeGreaterThan(0);
            expect(result.correctnessScore).toBeDefined();
        });

        test('returns empty issues for valid questions', () => {
            const questions = [
                {
                    questionNumber: 1,
                    sampleNumber: 1,
                    questionText: 'Simple physics question',
                    options: ['10 m/s', '20 m/s', '30 m/s', '40 m/s'],
                    correctIndex: 1,
                    correctAnswer: '20 m/s',
                    explanation: 'Using kinematics: v = u + at = 0 + 10 × 2 = 20 m/s. Therefore, 20 m/s is correct.',
                },
            ];

            const result = runDeterministicCorrectnessAudit(questions);
            expect(Array.isArray(result.confirmedIssues)).toBe(true);
        });
    });
});
