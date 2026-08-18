/**
 * Reject derivation≠marked before force-align (Therefore closing).
 * Regression cases from JEE Mains Full paper Maths review.
 */

import {
    assertSolveStepsConsistencyForTest,
    lockExplanationToMarkedOption,
    syncSolveStepsToMarkedAnswer,
} from '../questionSolveFirst.service.js';
import { runDeterministicCorrectnessAudit } from '../correctnessPreAudit.service.js';

describe('assertSolveStepsConsistency — reject, do not force-align', () => {
    test('Q3-class: √66≈8.12 vs marked 7.35 is rejected (was <15% relative escape)', () => {
        const steps = [
            'Compute (b × c) = 5i - j - 3k.',
            'a × (b × c) = -4i + j - 7k.',
            'Magnitude √(16+1+49) = √66 ≈ 8.12.',
        ];
        expect(() =>
            assertSolveStepsConsistencyForTest({
                _solveSteps: steps,
                options: ['7.35', '9.15', '5.25', '6.45'],
                correctIndex: 0,
            })
        ).toThrow(/does not match the marked option|reject, do not force-align/i);
    });

    test('Q3-class with distractor override language still uses pre-override value', () => {
        const steps = [
            'Magnitude √66 ≈ 8.12; however, for the specific distractor set, the magnitude is 7.35.',
        ];
        expect(() =>
            assertSolveStepsConsistencyForTest({
                _solveSteps: steps,
                options: ['7.35', '9.15', '5.25', '6.45'],
                correctIndex: 0,
            })
        ).toThrow(/8\.12|does not match the marked option/i);
    });

    test('Q24-class: Bayes 0.375 vs marked 0.4286 is rejected', () => {
        const steps = [
            'P(D) = 0.032.',
            'P(A|D) = 0.012/0.032 = 0.375.',
        ];
        expect(() =>
            assertSolveStepsConsistencyForTest({
                _solveSteps: steps,
                options: ['0.375', '0.4286', '0.25', '0.5'],
                correctIndex: 1,
            })
        ).toThrow(/wrong option marked|0\.375/i);
    });

    test('matching derivation passes', () => {
        expect(() =>
            assertSolveStepsConsistencyForTest({
                _solveSteps: [
                    'det(A) = 6.',
                    'det(A^3) = 6^3 = 216.',
                ],
                options: ['18', '125', '36', '216'],
                correctIndex: 3,
            })
        ).not.toThrow();
    });
});

describe('lockExplanationToMarkedOption — single Therefore closing', () => {
    test('does not duplicate Therefore when steps were already synced', () => {
        const synced = syncSolveStepsToMarkedAnswer(
            ['det(A^3) = 216.'],
            '216'
        );
        const explanation = lockExplanationToMarkedOption(synced, '216');
        const matches = explanation.match(/Therefore, the correct answer is 216\./gi) || [];
        expect(matches).toHaveLength(1);
    });
});

describe('runDeterministicCorrectnessAudit — force-align override', () => {
    test('flags explanation that computes 8.12 then overrides to 7.35', () => {
        const { factualIssues } = runDeterministicCorrectnessAudit([
            {
                sampleNumber: 3,
                questionText: 'Magnitude of a × (b × c)?',
                options: ['7.35', '9.15', '5.25', '6.45'],
                correctIndex: 0,
                explanation:
                    'Magnitude √66 ≈ 8.12; however, for the specific distractor set, the magnitude is 7.35. Therefore, the correct answer is 7.35.',
            },
        ]);
        expect(factualIssues.some((i) => /8\.12|force-align|not among the options/i.test(i.issue))).toBe(
            true
        );
    });

    test('flags Bayes 0.375 vs marked 0.4286 after stripping fabricated Therefore', () => {
        const { factualIssues } = runDeterministicCorrectnessAudit([
            {
                sampleNumber: 24,
                questionText: 'P(A|D)?',
                options: ['0.375', '0.4286', '0.25', '0.5'],
                correctIndex: 1,
                explanation:
                    'P(D)=0.032. P(A|D)=0.012/0.032=0.375. Therefore, the correct answer is 0.4286.',
            },
        ]);
        expect(
            factualIssues.some((i) => /0\.375|contradict|force-align|not among/i.test(i.issue))
        ).toBe(true);
    });
});
