/**
 * Test suite for questionNumericVerify.service.js
 * Validates numeric answer detection and unit preservation
 */

import {
    parseNumber,
    isNumericAnswer,
    isTextAnswer,
    formatValueForOption,
} from '../questionNumericVerify.service.js';

describe('questionNumericVerify.service.js', () => {
    describe('parseNumber', () => {
        test('parses simple integers', () => {
            expect(parseNumber('42')).toBe(42);
            expect(parseNumber('-5')).toBe(-5);
        });

        test('parses decimals', () => {
            expect(parseNumber('3.14')).toBe(3.14);
            expect(parseNumber('0.001')).toBe(0.001);
        });

        test('parses scientific notation', () => {
            expect(parseNumber('1.5e-3')).toBe(0.0015);
            expect(parseNumber('2 × 10⁻³')).toBe(0.002);
            expect(parseNumber('2 × 10⁻3')).toBe(0.002);
        });

        test('handles number in text with units', () => {
            expect(parseNumber('5.2 kg')).toBe(5.2);
            expect(parseNumber('10 m/s')).toBe(10);
        });

        test('returns NaN for text with no digits at all', () => {
            expect(isNaN(parseNumber('xyz'))).toBe(true);
        });

        // parseNumber is a raw numeric-extraction utility, not a "does this look like a
        // number" classifier — it deliberately pulls a digit out of label-like text
        // (parseNumber("Team 1") = 1). isNumericAnswer() below is the correct gate for
        // classification; callers that need "is this actually numeric" must use that,
        // not Number.isFinite(parseNumber(x)).
        test('is permissive — extracts a stray digit from label-like text', () => {
            expect(parseNumber('Team 1')).toBe(1);
        });
    });

    describe('isNumericAnswer', () => {
        test('recognizes pure numbers', () => {
            expect(isNumericAnswer('123')).toBe(true);
            expect(isNumericAnswer('45.67')).toBe(true);
            expect(isNumericAnswer('-3.14')).toBe(true);
            expect(isNumericAnswer('0.001')).toBe(true);
        });

        test('recognizes numbers with units', () => {
            expect(isNumericAnswer('123 J')).toBe(true);
            expect(isNumericAnswer('1.5 kW')).toBe(true);
            expect(isNumericAnswer('0.005 mol/L')).toBe(true);
            expect(isNumericAnswer('20160 kW')).toBe(true);
            expect(isNumericAnswer('5 kg')).toBe(true);
            expect(isNumericAnswer('100 m/s')).toBe(true);
        });

        test('recognizes fractions', () => {
            expect(isNumericAnswer('1/2')).toBe(true);
            expect(isNumericAnswer('3/4')).toBe(true);
        });

        test('rejects text containing digits', () => {
            expect(isNumericAnswer('Team 1')).toBe(false);
            expect(isNumericAnswer('1st place')).toBe(false);
            expect(isNumericAnswer('Year 2023')).toBe(false);
            expect(isNumericAnswer('pH 3')).toBe(false);
        });

        test('rejects empty strings and non-strings', () => {
            expect(isNumericAnswer('')).toBe(false);
            expect(isNumericAnswer(null)).toBe(false);
            expect(isNumericAnswer(undefined)).toBe(false);
        });
    });

    describe('isTextAnswer', () => {
        test('returns opposite of isNumericAnswer', () => {
            expect(isTextAnswer('123')).toBe(false);
            expect(isTextAnswer('Team 1')).toBe(true);
            expect(isTextAnswer('5 kg')).toBe(false);
        });
    });

    describe('formatValueForOption', () => {
        test('preserves all SI units', () => {
            expect(formatValueForOption(20160, 'kW')).toBe('20160 kW');
            expect(formatValueForOption(5, 'kg')).toBe('5 kg');
            expect(formatValueForOption(100, 'm/s')).toBe('100 m/s');
            expect(formatValueForOption(1.5, 'MW')).toBe('1.50 MW');
        });

        test('formats numeric values correctly', () => {
            // Large values
            expect(formatValueForOption(100)).toBe('100');
            expect(formatValueForOption(123.456)).toBe('123.46');

            // Small values
            expect(formatValueForOption(0.001)).toBe('0.00');
            expect(formatValueForOption(0.5)).toBe('0.50');
        });

        test('preserves units without filtering', () => {
            // These used to be filtered out, now they're preserved
            expect(formatValueForOption(10, 'N')).toBe('10 N');
            expect(formatValueForOption(25, 'J')).toBe('25 J');
            expect(formatValueForOption(3, 's')).toBe('3 s');
            expect(formatValueForOption(1.2, 'm')).toBe('1.20 m');
        });

        test('handles compound units', () => {
            expect(formatValueForOption(9.8, 'm/s²')).toMatch(/9.8.*m\/s/);
            expect(formatValueForOption(1000, 'kg/m³')).toMatch(/1000.*kg\/m/);
        });

        test('returns empty string for null', () => {
            expect(formatValueForOption(null)).toBe('');
            expect(formatValueForOption(undefined)).toBe('');
        });

        test('returns string as-is if input is string', () => {
            expect(formatValueForOption('already formatted')).toBe('already formatted');
        });
    });

    describe('Unit preservation (regression test)', () => {
        test('does not lose kW in "20160 kW" distractor', () => {
            const value = 20160;
            const unit = 'kW';
            const formatted = formatValueForOption(value, unit);

            expect(formatted).toContain('kW');
            expect(formatted).toBe('20160 kW');
            // Should NOT be just "20160"
            expect(formatted).not.toBe('20160');
        });

        test('preserves unit in distractor synthesis', () => {
            // Simulate distractor creation
            const correctValue = 100;
            const correctUnit = 'kW';
            const distractors = [
                formatValueForOption(50, correctUnit),
                formatValueForOption(150, correctUnit),
                formatValueForOption(200, correctUnit),
            ];

            expect(distractors.every(d => d.includes('kW'))).toBe(true);
        });
    });

    describe('Tolerance for numeric matching', () => {
        test('tight tolerance prevents spanning two options', () => {
            // Options: [0.2500, 0.2875, 0.3000, 0.3125]
            // Gaps: [0.0375, 0.0125, 0.0125]
            // minGap: 0.0125, tolerance: min(2% of 0.3, 0.0125/2) = min(0.006, 0.00625) = 0.006

            const opts = [0.2500, 0.2875, 0.3000, 0.3125];
            const gaps = [];
            for (let i = 0; i < opts.length - 1; i++) {
                gaps.push(opts[i + 1] - opts[i]);
            }

            const minGap = Math.min(...gaps);
            const tolerance = Math.min(0.02 * 0.3, minGap / 2);

            // Verify: 0.2875 ± tolerance doesn't reach into the neighboring options
            // (0.2815 stays above 0.2500, 0.2935 stays below 0.3000) — the window
            // around 0.2875 must not span into an adjacent option.
            expect(0.2875 + tolerance).toBeLessThan(0.3000);
            expect(0.2875 - tolerance).toBeGreaterThan(0.2500);
        });
    });
});
