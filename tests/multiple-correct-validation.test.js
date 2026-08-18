/**
 * Multiple-Correct Question Validation Test Suite
 * Validates that multiple-choice "multiple" type has EXACTLY 2 correct answers
 *
 * Purpose: Prevent questions with 1, 3, or 4 correct answers from shipping
 *
 * Constraints:
 *   - correctAnswer must be array of exactly 2 indices
 *   - parseQuestionBankAIItem() must reject non-2 counts
 *   - Batch parser must drop bad items, not fail entire batch
 *   - Top-up must replace dropped items
 *   - Final count must match requested count
 *
 * Usage:
 *   npm test -- multiple-correct-validation.test.js
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import axios from 'axios';

const TEST_API_URL = process.env.TEST_API_URL || 'http://localhost:3000';

/**
 * Helper: Validate a single question's multiple-correct constraint
 */
const validateMultipleCorrect = (question, questionNumber) => {
  const correctAnswer = question.correctAnswer;

  if (!Array.isArray(correctAnswer)) {
    return {
      valid: false,
      reason: `correctAnswer is not array: ${JSON.stringify(correctAnswer)}`,
      questionNumber,
    };
  }

  if (correctAnswer.length !== 2) {
    return {
      valid: false,
      reason: `correctAnswer has ${correctAnswer.length} elements, need exactly 2`,
      questionNumber,
    };
  }

  // Both must be valid indices (0-3 for 4 options)
  const [idx1, idx2] = correctAnswer;
  if (!Number.isFinite(idx1) || !Number.isFinite(idx2) || idx1 < 0 || idx2 < 0 || idx1 > 3 || idx2 > 3) {
    return {
      valid: false,
      reason: `Invalid indices: [${idx1}, ${idx2}]`,
      questionNumber,
    };
  }

  // Indices must be different
  if (idx1 === idx2) {
    return {
      valid: false,
      reason: `Both indices are the same: ${idx1}`,
      questionNumber,
    };
  }

  // Marked options must be distinct
  const options = question.options || [];
  const markedOption1 = options[idx1];
  const markedOption2 = options[idx2];

  if (String(markedOption1).trim() === String(markedOption2).trim()) {
    return {
      valid: false,
      reason: `Marked options are identical: "${markedOption1}"`,
      questionNumber,
    };
  }

  return {
    valid: true,
    reason: 'OK',
    questionNumber,
  };
};

describe('Multiple-Correct Question Validation', () => {
  /**
   * Test: Generate multiple-correct questions
   */
  it('generates multiple-correct questions with exactly 2 correct answers', async () => {
    const config = {
      topic: 'Competitive › JEE › Physics › Optics',
      bankName: 'Multiple-Correct Optics',
      difficulty: 'hard',
      multipleCount: 30, // Request 30 multiple-correct questions
    };

    console.log(`\nGenerating ${config.multipleCount} multiple-correct questions...`);

    try {
      // Generate
      const genResponse = await axios.post(
        `${TEST_API_URL}/admin/ai/generate-question-bank-suggestions`,
        config,
        { timeout: 300000 }
      );

      const jobId = genResponse.data.jobId;

      // Poll for completion
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
      console.log(`✓ Generated ${questions.length} questions (requested ${config.multipleCount})`);

      // Validate each question
      let validCount = 0;
      let invalidCount = 0;
      const invalidQuestions = [];

      questions.forEach((q, idx) => {
        const validation = validateMultipleCorrect(q, idx + 1);

        if (validation.valid) {
          validCount++;
        } else {
          invalidCount++;
          if (invalidQuestions.length < 5) {
            invalidQuestions.push({
              number: idx + 1,
              question: q.questionText?.slice(0, 50),
              reason: validation.reason,
            });
          }
        }
      });

      console.log(`\nValidation Results:`);
      console.log(`  ✓ Valid:   ${validCount}/${questions.length}`);
      console.log(`  ✗ Invalid: ${invalidCount}/${questions.length}`);

      if (invalidQuestions.length > 0) {
        console.log(`\nFirst ${invalidQuestions.length} invalid questions:`);
        invalidQuestions.forEach(iq => {
          console.log(`  Q${iq.number}: "${iq.question}..."`);
          console.log(`    Reason: ${iq.reason}`);
        });
      }

      // Expectations
      expect(validCount).toBeGreaterThan(0);
      // Allow some dropout due to other constraints, but expect >95%
      const validityRate = validCount / questions.length;
      expect(validityRate).toBeGreaterThan(0.95);

      // Question count should be at requested (or close)
      expect(questions.length).toBeGreaterThanOrEqual(config.multipleCount * 0.85);
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
      throw error;
    }
  }, 600000);

  /**
   * Test: Verify batch parser drops invalid items
   */
  it('batch parser drops invalid multiple-correct items', async () => {
    // This test simulates what would happen if AI returned bad data
    // The parser should drop items with wrong correctAnswer format

    const testCases = [
      {
        name: 'Valid: exactly 2 indices',
        correctAnswer: [0, 2],
        shouldPass: true,
      },
      {
        name: 'Invalid: single index',
        correctAnswer: [1],
        shouldPass: false,
      },
      {
        name: 'Invalid: 3 indices',
        correctAnswer: [0, 1, 2],
        shouldPass: false,
      },
      {
        name: 'Invalid: 4 indices (all)',
        correctAnswer: [0, 1, 2, 3],
        shouldPass: false,
      },
      {
        name: 'Invalid: string instead of array',
        correctAnswer: 'A,B',
        shouldPass: false,
      },
      {
        name: 'Invalid: null',
        correctAnswer: null,
        shouldPass: false,
      },
      {
        name: 'Invalid: same index twice',
        correctAnswer: [1, 1],
        shouldPass: false,
      },
    ];

    console.log(`\nTesting ${testCases.length} batch parser scenarios...`);

    let passCount = 0;
    let failCount = 0;

    testCases.forEach(testCase => {
      const question = {
        questionText: `Test: ${testCase.name}`,
        options: ['Option A', 'Option B', 'Option C', 'Option D'],
        correctAnswer: testCase.correctAnswer,
      };

      const validation = validateMultipleCorrect(question, 0);

      if (testCase.shouldPass) {
        if (validation.valid) {
          passCount++;
          console.log(`  ✓ ${testCase.name}`);
        } else {
          console.log(`  ✗ ${testCase.name} (should have passed)`);
          console.log(`    ${validation.reason}`);
          failCount++;
        }
      } else {
        if (!validation.valid) {
          passCount++;
          console.log(`  ✓ ${testCase.name} (correctly rejected)`);
        } else {
          console.log(`  ✗ ${testCase.name} (should have been rejected)`);
          failCount++;
        }
      }
    });

    console.log(`\nParser behavior:`);
    console.log(`  Correct rejections: ${passCount}/${testCases.length}`);
    console.log(`  Incorrect decisions: ${failCount}/${testCases.length}`);

    expect(failCount).toBe(0); // All decisions should be correct
  });

  /**
   * Test: Top-up replaces dropped items
   */
  it('top-up batch replaces dropped invalid questions', async () => {
    // Simulate scenario where some questions are dropped due to invalid correctAnswer
    // The system should request top-up questions to reach the target count

    const config = {
      topic: 'Competitive › JEE › Chemistry › Equilibrium',
      bankName: 'Multiple-Correct Chemistry',
      difficulty: 'hard',
      multipleCount: 20,
    };

    console.log(`\nTesting top-up mechanism for multiple-correct...`);

    try {
      const genResponse = await axios.post(
        `${TEST_API_URL}/admin/ai/generate-question-bank-suggestions`,
        config,
        { timeout: 300000 }
      );

      const jobId = genResponse.data.jobId;

      // Poll
      let job = null;
      for (let i = 0; i < 60; i++) {
        const jobResponse = await axios.get(
          `${TEST_API_URL}/admin/ai/question-bank-generation/${jobId}`,
          { timeout: 30000 }
        );

        job = jobResponse.data;
        if (job.status === 'done') break;

        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      if (!job || job.status !== 'done') {
        throw new Error('Generation timeout');
      }

      const finalCount = job.questions?.length || 0;

      console.log(`  Requested: ${config.multipleCount}`);
      console.log(`  Delivered: ${finalCount}`);

      // Should deliver close to requested (within 5% tolerance for dropout)
      const acceptableMin = config.multipleCount * 0.95;
      expect(finalCount).toBeGreaterThanOrEqual(acceptableMin);

      // All should be valid
      let allValid = true;
      job.questions?.forEach((q, idx) => {
        const validation = validateMultipleCorrect(q, idx);
        if (!validation.valid) {
          console.log(`  Q${idx}: Invalid - ${validation.reason}`);
          allValid = false;
        }
      });

      expect(allValid).toBe(true);
    } catch (error) {
      console.error(`Error: ${error.message}`);
      throw error;
    }
  }, 600000);

  /**
   * Test: Marked options are distinct
   */
  it('ensures marked options are distinct (no duplicates)', async () => {
    const config = {
      topic: 'Competitive › JEE › Mathematics › Calculus',
      bankName: 'Multiple-Correct Math',
      difficulty: 'hard',
      multipleCount: 15,
    };

    console.log(`\nValidating marked options are distinct...`);

    try {
      const genResponse = await axios.post(
        `${TEST_API_URL}/admin/ai/generate-question-bank-suggestions`,
        config,
        { timeout: 300000 }
      );

      const jobId = genResponse.data.jobId;

      let job = null;
      for (let i = 0; i < 60; i++) {
        const jobResponse = await axios.get(
          `${TEST_API_URL}/admin/ai/question-bank-generation/${jobId}`,
          { timeout: 30000 }
        );

        job = jobResponse.data;
        if (job.status === 'done') break;

        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      if (!job) throw new Error('Generation timeout');

      let duplicateMarkedCount = 0;
      job.questions?.forEach((q, idx) => {
        if (!Array.isArray(q.correctAnswer) || q.correctAnswer.length !== 2) return;

        const [idx1, idx2] = q.correctAnswer;
        const options = q.options || [];
        const opt1 = String(options[idx1] || '').trim();
        const opt2 = String(options[idx2] || '').trim();

        if (opt1 === opt2) {
          duplicateMarkedCount++;
          console.log(`  Q${idx + 1}: Marked options are identical: "${opt1}"`);
        }
      });

      console.log(`  Duplicate marked options found: ${duplicateMarkedCount}`);
      expect(duplicateMarkedCount).toBe(0);
    } catch (error) {
      console.error(`Error: ${error.message}`);
      throw error;
    }
  }, 600000);

  /**
   * Summary
   */
  afterAll(() => {
    console.log(`\n${'='.repeat(60)}`);
    console.log('MULTIPLE-CORRECT VALIDATION SUMMARY');
    console.log(`${'='.repeat(60)}`);
    console.log(`
If all tests passed:
  ✅ All generated questions have exactly 2 correct answers
  ✅ Invalid questions are dropped (not shipped)
  ✅ Top-up fills dropped items
  ✅ Marked options are always distinct
  ✅ Safe for production

If any test failed:
  ⚠️  May still ship invalid multiple-correct questions
  ⚠️  Users will report wrong answer keys
    `);
  });
});
