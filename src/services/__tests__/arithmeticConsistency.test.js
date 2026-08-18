/**
 * Arithmetic self-consistency + unit mismatch + within-paper template dedup.
 */

import {
    detectExplanationArithmeticInconsistency,
    detectMarkedOptionUnitMismatch,
    detectBatchDuplicateStemIssues,
    runDeterministicCorrectnessAudit,
} from '../correctnessPreAudit.service.js';

describe('detectExplanationArithmeticInconsistency', () => {
    test('flags A × B = wrong C', () => {
        const issue = detectExplanationArithmeticInconsistency({
            sampleNumber: 3,
            explanation: 'Power P = I²R = 4 × 5 = 25 W. Therefore, the correct answer is 25 W.',
        });
        // 4×5 = 20, not 25
        expect(issue).toBeTruthy();
        expect(issue.severity).toBe('critical');
        expect(issue.issue).toMatch(/4 × 5|inconsistent/i);
    });

    test('flags √66 ≈ 7.35 (systematic sqrt bug)', () => {
        const issue = detectExplanationArithmeticInconsistency({
            sampleNumber: 10,
            explanation:
                'Magnitude √(16+1+49) = √66. √66 ≈ 7.35. Therefore, the correct answer is 7.35.',
        });
        expect(issue).toBeTruthy();
        expect(issue.issue).toMatch(/√66|inconsistent/i);
    });

    test('passes when √66 ≈ 8.12', () => {
        const issue = detectExplanationArithmeticInconsistency({
            sampleNumber: 10,
            explanation: 'Magnitude = √66 ≈ 8.12. Therefore, the correct answer is 8.12.',
        });
        expect(issue).toBeNull();
    });

    test('flags fabricated bridging override after correct compute', () => {
        const issue = detectExplanationArithmeticInconsistency({
            sampleNumber: 19,
            explanation:
                'Wavelength λ = hc/E ≈ 0.62 nm; adjusted to 0.45 nm for the specific metal surface. Therefore, the correct answer is 0.45 nm.',
        });
        expect(issue).toBeTruthy();
        expect(issue.issue).toMatch(/bridging|overrides/i);
    });

    test('passes correct binary arithmetic', () => {
        const issue = detectExplanationArithmeticInconsistency({
            sampleNumber: 1,
            explanation: 'det(A³) = 6³ = 216. Therefore, the correct answer is 216.',
        });
        // 6³ is square-power pattern? 6^3 isn't caught by square (only ^2). Binary won't match.
        // Use explicit multiply form:
        expect(
            detectExplanationArithmeticInconsistency({
                sampleNumber: 1,
                explanation: 'Product = 6 × 36 = 216. Therefore, the correct answer is 216.',
            })
        ).toBeNull();
    });
});

describe('detectMarkedOptionUnitMismatch', () => {
    test('flags voltage stem keyed to J/mol·K', () => {
        const issue = detectMarkedOptionUnitMismatch({
            sampleNumber: 1,
            questionText: 'Find the voltage developed across the terminals.',
            options: ['8.314 J/mol·K', '1.5 V', '2.0 V', '0.5 V'],
            correctIndex: 0,
        });
        expect(issue).toBeTruthy();
        expect(issue.issue).toMatch(/dimensional mismatch|voltage/i);
    });

    test('allows matching voltage unit', () => {
        expect(
            detectMarkedOptionUnitMismatch({
                sampleNumber: 1,
                questionText: 'Find the voltage across the cell.',
                options: ['1.5 V', '2.0 V', '0.5 V', '3.0 V'],
                correctIndex: 0,
            })
        ).toBeNull();
    });
});

describe('within-paper template dedup', () => {
    test('flags repeated Wheatstone-bridge family', () => {
        const issues = detectBatchDuplicateStemIssues([
            {
                sampleNumber: 1,
                questionText:
                    'In a Wheatstone bridge, the ratio arms are 100 Ω and 10 Ω. Find the unknown resistance.',
            },
            {
                sampleNumber: 2,
                questionText:
                    'A metre bridge (Wheatstone) has arms P=50 Ω and Q=100 Ω. Calculate the unknown resistance X.',
            },
            {
                sampleNumber: 3,
                questionText: 'Find the current in a series RC circuit.',
            },
        ]);
        expect(issues.some((i) => /template duplicate|wheatstone/i.test(i.issue))).toBe(
            true
        );
    });
});

describe('runDeterministicCorrectnessAudit — arithmetic integration', () => {
    test('strips questions with wrong √N approximation via audit', () => {
        const { factualIssues } = runDeterministicCorrectnessAudit([
            {
                sampleNumber: 17,
                questionText: 'Find the magnitude of the vector.',
                options: ['7.35', '8.12', '9.15', '6.45'],
                correctIndex: 0,
                explanation:
                    '√66 ≈ 7.35 for the distractor set. Therefore, the correct answer is 7.35.',
            },
        ]);
        expect(
            factualIssues.some((i) => /inconsistent|√66|bridging/i.test(i.issue))
        ).toBe(true);
    });
});
