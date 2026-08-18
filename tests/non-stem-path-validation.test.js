/**
 * Non-STEM Path Validation Test Suite
 * Tests DILR, VARC, CAT QA, and text-answer paths
 *
 * Purpose: Verify fixes for text-answer handling work at scale
 * Recent fixes (2026-07-21):
 *   - detectTextAnswerConsistency()
 *   - isNumericAnswer() guard
 *   - sanitizeDistractorQuality()
 *   - detectExplanationContradictsKey()
 *
 * Usage:
 *   npm test -- non-stem-path-validation.test.js
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import axios from 'axios';

const TEST_API_URL = process.env.TEST_API_URL || 'http://localhost:3000';

/**
 * Test Configs
 */
const TEST_BANKS = {
  dilr_hard: {
    topic: 'Competitive › CAT › DILR › Logical Reasoning',
    bankName: 'DILR Logic Puzzles Hard',
    difficulty: 'hard',
    singleCount: 20,
    examProfile: 'cat',
    subject: 'DILR',
  },
  varc_hard: {
    topic: 'Competitive › CAT › VARC › Reading Comprehension',
    bankName: 'VARC Reading Hard',
    difficulty: 'hard',
    singleCount: 20,
    examProfile: 'cat',
    subject: 'VARC',
  },
  cat_qa_hard: {
    topic: 'Competitive › CAT › Quantitative Ability › Arithmetic',
    bankName: 'CAT QA Hard',
    difficulty: 'hard',
    singleCount: 20,
    examProfile: 'cat',
    subject: 'Quantitative Ability',
  },
};

describe('Non-STEM Path Validation', () => {
  /**
   * Helper: Check for specific bugs
   */
  const validateNonStemBank = async (config, expectedBugFixes) => {
    console.log(`\nValidating: ${config.bankName}`);

    try {
      // Generate bank
      const genResponse = await axios.post(
        `${TEST_API_URL}/admin/ai/generate-question-bank-suggestions`,
        config,
        { timeout: 300000 }
      );

      const jobId = genResponse.data.jobId;

      // Poll until done
      let job = null;
      for (let i = 0; i < 60; i++) {
        const jobResponse = await axios.get(
          `${TEST_API_URL}/admin/ai/question-bank-generation/${jobId}`,
          { timeout: 30000 }
        );

        job = jobResponse.data;
        if (job.status === 'done' || job.status === 'error') break;

        console.log(`  [${i}] Status: ${job.status}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      if (!job || job.status !== 'done') {
        throw new Error('Generation timeout');
      }

      const questions = job.questions || [];
      console.log(`  ✓ Generated ${questions.length} questions`);

      // Validate
      const valResponse = await axios.post(
        `${TEST_API_URL}/admin/ai/validate-question-topic-relevance`,
        {
          topic: config.topic,
          bankName: config.bankName,
          difficulty: config.difficulty,
          questions,
          evaluationProvider: 'openai',
          singleCount: config.singleCount,
        },
        { timeout: 300000 }
      );

      const validation = valResponse.data;
      const defects = validation.confirmedIssues || [];

      console.log(`  ✓ Validated: ${questions.length} questions`);
      console.log(`  → Correctness: ${validation.correctnessScore}`);
      console.log(`  → Defects found: ${defects.length}`);

      // Check each expected bug fix
      const bugCheckResults = {
        passed: [],
        failed: [],
      };

      if (expectedBugFixes.includes('text_answer_consistency')) {
        const textAnswerMismatches = defects.filter(d =>
          d.issue?.includes('conclusion') ||
          d.issue?.includes('matches option') ||
          d.issue?.includes('contradiction')
        );

        if (textAnswerMismatches.length === 0) {
          bugCheckResults.passed.push('✓ Text answer consistency: No contradictions found');
        } else {
          bugCheckResults.failed.push(
            `✗ Text answer consistency: Found ${textAnswerMismatches.length} contradictions`
          );
          textAnswerMismatches.slice(0, 2).forEach(d => {
            console.log(`    Q${d.questionNumber}: ${d.issue?.slice(0, 80)}`);
          });
        }
      }

      if (expectedBugFixes.includes('no_numeric_in_text')) {
        let hasNumericInText = false;
        let numericExamples = [];

        for (const q of questions) {
          if (q.correctAnswer && typeof q.correctAnswer === 'string' && /^\d+$/.test(q.correctAnswer.trim())) {
            // Text answer is all digits - could be Team 1, option 1, etc.
            // Check if options are also numeric
            const allNumeric = q.options?.every(opt => /^\d+(?:\.\d+)?$/.test(String(opt).trim()));
            if (!allNumeric) {
              hasNumericInText = true;
              if (numericExamples.length < 2) {
                numericExamples.push({ questionText: q.questionText, options: q.options });
              }
            }
          }
        }

        if (!hasNumericInText) {
          bugCheckResults.passed.push('✓ No numeric garbage in text answers');
        } else {
          bugCheckResults.failed.push(`✗ Found numeric distractors mixed with text options`);
          numericExamples.forEach(ex => {
            console.log(`    Text question with mixed options: ${ex.questionText?.slice(0, 60)}...`);
          });
        }
      }

      if (expectedBugFixes.includes('no_fractional_whole_numbers')) {
        const fractionalOnWhole = questions.filter(q => {
          const keyVal = parseFloat(String(q.correctAnswer || ''));
          if (!Number.isFinite(keyVal)) return false;
          if (!Number.isInteger(keyVal)) return false; // Key is whole number

          // Check if any option is fractional
          return (q.options || []).some(opt => {
            const optVal = parseFloat(String(opt));
            return Number.isFinite(optVal) && !Number.isInteger(optVal);
          });
        });

        if (fractionalOnWhole.length === 0) {
          bugCheckResults.passed.push('✓ No fractional distractors on whole-number answers');
        } else {
          bugCheckResults.failed.push(
            `✗ Found ${fractionalOnWhole.length} questions with fractional distractors on whole-number keys`
          );
          fractionalOnWhole.slice(0, 2).forEach(q => {
            console.log(`    Question: "${q.questionText?.slice(0, 60)}..."`);
            console.log(`    Key: ${q.correctAnswer}, Options: ${q.options?.join(', ')}`);
          });
        }
      }

      if (expectedBugFixes.includes('team_vs_team14')) {
        // Specifically check for Team 1 vs Team 14 style confusion
        const teamMismatches = defects.filter(d =>
          /team\s*\d+/i.test(d.issue || '')
        );

        if (teamMismatches.length === 0) {
          bugCheckResults.passed.push('✓ No Team 1 vs Team 14 confusion detected');
        } else {
          bugCheckResults.failed.push(`✗ Found ${teamMismatches.length} potential team number confusions`);
        }
      }

      // Report results
      console.log(`\n  Bug Fix Checks:`);
      bugCheckResults.passed.forEach(msg => console.log(`  ${msg}`));
      bugCheckResults.failed.forEach(msg => console.log(`  ${msg}`));

      return {
        bankName: config.bankName,
        questionCount: questions.length,
        correctnessScore: validation.correctnessScore,
        defectCount: defects.length,
        passed: bugCheckResults.passed.length,
        failed: bugCheckResults.failed.length,
        success: bugCheckResults.failed.length === 0,
      };
    } catch (error) {
      console.error(`  ❌ Error: ${error.message}`);
      return { bankName: config.bankName, error: error.message };
    }
  };

  /**
   * Test: DILR (Logic puzzles with text answers)
   */
  it('validates DILR path (text answers, logic puzzles)', async () => {
    const result = await validateNonStemBank(TEST_BANKS.dilr_hard, [
      'text_answer_consistency',
      'no_numeric_in_text',
      'team_vs_team14',
    ]);

    expect(result).toBeDefined();
    expect(result.questionCount).toBeGreaterThan(0);

    if (!result.error) {
      expect(result.correctnessScore).toBeGreaterThan(0);
      // Correctness should be high for DILR (no numeric concerns)
      expect(result.correctnessScore).toBeGreaterThanOrEqual(80);
      expect(result.failed).toBe(0); // All bug fixes should pass
    }
  }, 600000);

  /**
   * Test: VARC (Reading comprehension)
   */
  it('validates VARC path (reading comprehension, text answers)', async () => {
    const result = await validateNonStemBank(TEST_BANKS.varc_hard, [
      'text_answer_consistency',
      'no_numeric_in_text',
    ]);

    expect(result).toBeDefined();
    expect(result.questionCount).toBeGreaterThan(0);

    if (!result.error) {
      expect(result.correctnessScore).toBeGreaterThan(0);
      // Correctness should be high for VARC
      expect(result.correctnessScore).toBeGreaterThanOrEqual(80);
    }
  }, 600000);

  /**
   * Test: CAT QA (Quantitative ability - numeric but may have text)
   */
  it('validates CAT QA path (quantitative with possible text)', async () => {
    const result = await validateNonStemBank(TEST_BANKS.cat_qa_hard, [
      'no_fractional_whole_numbers',
    ]);

    expect(result).toBeDefined();
    expect(result.questionCount).toBeGreaterThan(0);

    if (!result.error) {
      expect(result.correctnessScore).toBeGreaterThan(0);
      // QA should be correct (numeric)
      expect(result.correctnessScore).toBeGreaterThanOrEqual(85);
    }
  }, 600000);

  /**
   * Summary
   */
  afterAll(() => {
    console.log(`\n${'='.repeat(60)}`);
    console.log('NON-STEM PATH VALIDATION SUMMARY');
    console.log(`${'='.repeat(60)}`);
    console.log(`
If all tests passed:
  ✅ Text-answer consistency checks work
  ✅ No numeric garbage in text answers
  ✅ Team 1 vs Team 14 distinction works
  ✅ Non-STEM paths are safe for production

If any test failed:
  ⚠️  Check the specific bugs listed above
  ⚠️  May need additional fixes before launch
    `);
  });
});
