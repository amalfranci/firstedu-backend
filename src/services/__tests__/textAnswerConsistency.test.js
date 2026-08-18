/**
 * Test suite for text answer consistency detection
 * Regression tests for DILR, VARC, CAT VARC handling
 * Ensures explanation conclusions match the marked answer
 */

import { runDeterministicCorrectnessAudit } from '../correctnessPreAudit.service.js';

describe('Text Answer Consistency (detectTextAnswerConsistency)', () => {
    describe('DILR logic puzzles', () => {
        test('catches Team 1 vs Team 14 mismatch', () => {
            const q = {
                sampleNumber: 1,
                questionNumber: 1,
                questionText: 'After the tournament, which team remains undefeated?',
                options: ['Team 1', 'Team 14', 'Team 7', 'Team 3'],
                correctIndex: 0, // marked Team 1
                correctAnswer: 'Team 1',
                explanation: 'Team 1 lost early to Team 7. Team 14 defeated every opponent including Team 7. Therefore, Team 14 remains undefeated.',
            };

            const result = runDeterministicCorrectnessAudit([q]);
            expect(result.confirmedIssues.length).toBeGreaterThan(0);
            const issue = result.confirmedIssues.find(i => i.questionNumber === 1);
            expect(issue).toBeDefined();
            expect(issue.severity).toBe('critical');
            expect(issue.issue).toMatch(/Team 14.*Team 1/i);
        });

        test('allows correct Team 1 conclusion when Team 1 is marked', () => {
            const q = {
                sampleNumber: 2,
                questionNumber: 2,
                questionText: 'Which team has the best record?',
                options: ['Team 1', 'Team 14', 'Team 7', 'Team 3'],
                correctIndex: 0, // marked Team 1
                correctAnswer: 'Team 1',
                explanation: 'Team 1 won 8 games, Team 14 won 6, Team 7 won 5. Therefore, Team 1 has the best record.',
            };

            const result = runDeterministicCorrectnessAudit([q]);
            const issue = result.confirmedIssues.find(i => i.questionNumber === 2);
            // Should not flag — conclusion correctly identifies Team 1
            expect(issue).toBeUndefined();
        });

        test('distinguishes Team 1 from Team 14 (word boundary)', () => {
            const q = {
                sampleNumber: 3,
                questionNumber: 3,
                questionText: 'Ranking analysis?',
                options: ['Team 1', 'Team 14', 'Team 7', 'Team 3'],
                correctIndex: 1, // marked Team 14
                correctAnswer: 'Team 14',
                explanation: 'Analysis shows Team 1 is ranked lower. Team 14 is ranked highest. Considering rankings, Team 14 is correct.',
            };

            const result = runDeterministicCorrectnessAudit([q]);
            const issue = result.confirmedIssues.find(i => i.questionNumber === 3);
            // Should not flag — correctly identifies Team 14, mentions of Team 1 are for comparison
            expect(issue).toBeUndefined();
        });

        test('catches multiple team references with wrong conclusion', () => {
            const q = {
                sampleNumber: 4,
                questionNumber: 4,
                questionText: 'Which team won the final?',
                options: ['Team 1', 'Team 2', 'Team 3', 'Team 4'],
                correctIndex: 0, // Team 1
                correctAnswer: 'Team 1',
                explanation: 'Team 1 lost in semifinals. Team 2 won the first round. Team 3 beat Team 2 in quarterfinals. Team 4 defeated Team 3 in the final. Therefore, Team 4 won.',
            };

            const result = runDeterministicCorrectnessAudit([q]);
            const issue = result.confirmedIssues.find(i => i.questionNumber === 4);
            expect(issue).toBeDefined();
            expect(issue.severity).toBe('critical');
            expect(issue.issue).toMatch(/Team 4.*Team 1/i);
        });
    });

    describe('VARC (reading comprehension)', () => {
        test('catches Chart type mismatch', () => {
            const q = {
                sampleNumber: 5,
                questionNumber: 5,
                questionText: 'What type of visualization best represents the data?',
                options: ['Scatter plot', 'Line graph', 'Bar chart', 'Histogram'],
                correctIndex: 0, // Scatter plot
                correctAnswer: 'Scatter plot',
                explanation: 'The data shows continuous change over time. A line graph effectively shows trends. Therefore, Line graph.',
            };

            const result = runDeterministicCorrectnessAudit([q]);
            const issue = result.confirmedIssues.find(i => i.questionNumber === 5);
            expect(issue).toBeDefined();
            expect(issue.severity).toBe('critical');
            expect(issue.issue).toMatch(/Line graph.*Scatter plot/i);
        });

        test('allows conclusion with compound words (Scatter)', () => {
            const q = {
                sampleNumber: 6,
                questionNumber: 6,
                questionText: 'Best chart type?',
                options: ['Scatter plot', 'Line graph', 'Bar chart', 'Histogram'],
                correctIndex: 0,
                correctAnswer: 'Scatter plot',
                explanation: 'The data points are scattered around a trend line, not forming a straight line. Therefore, Scatter plot is correct.',
            };

            const result = runDeterministicCorrectnessAudit([q]);
            const issue = result.confirmedIssues.find(i => i.questionNumber === 6);
            // "scattered" appears in explanation but should not cause false positive
            expect(issue).toBeUndefined();
        });
    });

    describe('CAT QA/DILR (text answers)', () => {
        test('catches statement order mismatch', () => {
            const q = {
                sampleNumber: 7,
                questionNumber: 7,
                questionText: 'Which statement is most accurate?',
                options: [
                    'India exports more than China',
                    'China exports more than India',
                    'Export levels are equal',
                    'Data is insufficient',
                ],
                correctIndex: 1, // China exports more
                correctAnswer: 'China exports more than India',
                explanation: 'Looking at the trade data, India has consistently higher exports. Therefore, India exports more than China.',
            };

            const result = runDeterministicCorrectnessAudit([q]);
            const issue = result.confirmedIssues.find(i => i.questionNumber === 7);
            expect(issue).toBeDefined();
            expect(issue.severity).toBe('critical');
        });

        test('catches numeric conclusion mismatch (but with word matching)', () => {
            const q = {
                sampleNumber: 8,
                questionNumber: 8,
                questionText: 'How many people attended?',
                options: ['100 people', '500 people', '1000 people', '5000 people'],
                correctIndex: 2, // 1000 people
                correctAnswer: '1000 people',
                explanation: 'Counting attendees from different sections: 100 + 400 = 500 total. Therefore, 500 people attended.',
            };

            const result = runDeterministicCorrectnessAudit([q]);
            const issue = result.confirmedIssues.find(i => i.questionNumber === 8);
            // This should be caught as a numeric mismatch (500 vs 1000), not text consistency
            // Depends on which detector runs first
            expect(issue).toBeDefined();
        });
    });

    describe('Edge cases and false positives', () => {
        test('ignores trivial 2-char mentions', () => {
            const q = {
                sampleNumber: 9,
                questionNumber: 9,
                questionText: 'Best option?',
                options: ['Option A', 'Option B', 'Option C', 'Option D'],
                correctIndex: 0,
                correctAnswer: 'Option A',
                explanation: 'Looking at choice B, we see issues. Looking at C, also problematic. Therefore, Option A is best.',
            };

            const result = runDeterministicCorrectnessAudit([q]);
            const issue = result.confirmedIssues.find(i => i.questionNumber === 9);
            // Should not flag because "B" and "C" are too short to be meaningful
            expect(!issue || issue.issue.includes('Option B') === false).toBe(true);
        });

        test('handles no-conclusion explanations', () => {
            const q = {
                sampleNumber: 10,
                questionNumber: 10,
                questionText: 'Which option?',
                options: ['First', 'Second', 'Third', 'Fourth'],
                correctIndex: 0,
                correctAnswer: 'First',
                explanation: 'After careful analysis of all options, considering various factors.',
                // No "therefore" or conclusion
            };

            const result = runDeterministicCorrectnessAudit([q]);
            const issue = result.confirmedIssues.find(i => i.questionNumber === 10);
            // Should not flag — no conclusion found
            expect(!issue || !issue.issue.includes('concludes')).toBe(true);
        });

        test('numeric answers skip text check', () => {
            const q = {
                sampleNumber: 11,
                questionNumber: 11,
                questionText: 'Calculate the result',
                options: ['10 m/s', '20 m/s', '30 m/s', '40 m/s'],
                correctIndex: 1, // 20 m/s
                correctAnswer: '20 m/s',
                explanation: 'v = u + at = 0 + 10×2 = 20 m/s. Therefore, 20 m/s.',
            };

            const result = runDeterministicCorrectnessAudit([q]);
            // Should not use text answer check on numeric answers
            const textIssue = result.confirmedIssues.find(i =>
                i.questionNumber === 11 && i.issue.includes('concludes')
            );
            expect(textIssue).toBeUndefined();
        });
    });
});
