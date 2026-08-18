import { describe, it, expect, afterAll, beforeAll } from '@jest/globals';
import axios from 'axios';

const TEST_API_URL = process.env.TEST_API_URL || 'http://localhost:3000';

const TEST_CONFIGS = {
  jee_main_hard: {
    topic: 'Competitive › JEE › Physics › Thermodynamics',
    bankName: 'Thermodynamics Hard',
    difficulty: 'hard',
    singleCount: 25,
    subject: 'Physics',
  },
  upsc_hard: {
    topic: 'Competitive › Government › UPSC › Polity',
    bankName: 'Indian Polity Hard',
    difficulty: 'hard',
    singleCount: 25,
  },
};

describe('Score Gap Investigation', () => {
  let results = [];
  let authToken = null;

  beforeAll(async () => {
    try {
      const loginResponse = await axios.post(
        `${TEST_API_URL}/admin/login`,
        { email: 'mohantysoumyan13@gmail.com', password: 'admin@12345' },
        { timeout: 10000 }
      );
      authToken = loginResponse.data.data?.accessToken;
      if (!authToken) {
        throw new Error('No accessToken in login response');
      }
      console.log('✅ Admin authenticated');
    } catch (error) {
      console.error('❌ Admin login failed:', error.response?.data || error.message);
      throw error;
    }
  });

  const investigateScoreGap = async (examKey, config) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Investigating: ${examKey}`);
    console.log(`${'='.repeat(60)}`);

    try {
      console.log(`1. Generating ${config.singleCount} questions...`);
      const generateStart = Date.now();

      const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
      const generateResponse = await axios.post(
        `${TEST_API_URL}/admin/ai/generate-question-bank-suggestions`,
        config,
        { timeout: 300000, headers }
      );

      const jobId = generateResponse.data.jobId;
      console.log(`   → Job ID: ${jobId}`);

      let job = null;
      let attempts = 0;
      const maxAttempts = 60;

      while (attempts < maxAttempts) {
        const jobResponse = await axios.get(
          `${TEST_API_URL}/admin/ai/question-bank-generation/${jobId}`,
          { timeout: 30000, headers }
        );

        job = jobResponse.data;

        if (job.status === 'done' || job.status === 'error') {
          break;
        }

        console.log(`   → Status: ${job.status}... (${attempts}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        attempts++;
      }

      if (!job || job.status !== 'done') {
        throw new Error(`Generation timed out after ${attempts * 5}s`);
      }

      const generateElapsed = Date.now() - generateStart;
      console.log(`   ✓ Generated in ${generateElapsed}ms`);
      console.log(`   → Produced ${job.questions?.length || 0} questions`);

      const internalScore = job.stats?.difficultyMatchScore ?? null;
      console.log(`\n2. Internal finalize score: ${internalScore}`);

      if (!internalScore) {
        console.warn('   ⚠ No internal score found!');
        return null;
      }

      console.log(`\n3. Running OpenAI validation audit...`);
      const validateStart = Date.now();

      const validationResponse = await axios.post(
        `${TEST_API_URL}/admin/ai/validate-question-topic-relevance`,
        {
          topic: config.topic,
          bankName: config.bankName,
          difficulty: config.difficulty,
          questions: job.questions,
          evaluationProvider: 'openai',
          singleCount: config.singleCount,
        },
        { timeout: 300000, headers }
      );

      const validationElapsed = Date.now() - validateStart;
      const validation = validationResponse.data;
      const externalScore = validation.difficultyMatchScore ?? null;

      console.log(`   ✓ Validated in ${validationElapsed}ms`);
      console.log(`\n4. External validation scores:`);
      console.log(`   - difficultyMatchScore: ${externalScore}`);
      console.log(`   - correctnessScore: ${validation.correctnessScore}`);
      console.log(`   - topicRelevanceScore: ${validation.topicRelevanceScore}`);

      const gap = internalScore - externalScore;
      const gapPercent = externalScore > 0 ? ((gap / externalScore) * 100).toFixed(1) : 'N/A';

      console.log(`\n5. SCORE GAP ANALYSIS:`);
      console.log(`   Internal:  ${internalScore}`);
      console.log(`   External:  ${externalScore}`);
      console.log(`   Gap:       ${gap} (${gapPercent}%)`);

      return {
        examKey,
        topic: config.topic,
        internalScore,
        externalScore,
        gap,
        gapPercent,
        questionCount: job.questions?.length || 0,
      };
    } catch (error) {
      const validationErrors = error.response?.data?.meta;
      if (validationErrors && Array.isArray(validationErrors)) {
        console.error(`❌ Validation Errors:`, JSON.stringify(validationErrors, null, 2));
      } else {
        console.error(`❌ Error: ${error.response?.data?.message || error.message}`);
      }
      return {
        examKey,
        topic: config.topic,
        error: error.message || 'Unknown error',
      };
    }
  };

  it('investigates score gap for JEE Main hard', async () => {
    const result = await investigateScoreGap('jee_main_hard', TEST_CONFIGS.jee_main_hard);
    results.push(result);

    expect(result).toBeDefined();
    expect(result.internalScore).toBeDefined();
    expect(result.externalScore).toBeDefined();

    if (result.gap !== undefined) {
      expect(result.gap).toBeGreaterThanOrEqual(0);
      console.log(`   → Gap of ${result.gap} is ${result.gap > 30 ? 'SUSPICIOUS' : 'acceptable'}`);
    }
  }, 600000);

  it('investigates score gap for UPSC hard', async () => {
    const result = await investigateScoreGap('upsc_hard', TEST_CONFIGS.upsc_hard);
    results.push(result);

    expect(result).toBeDefined();
    expect(result.internalScore).toBeDefined();
  }, 600000);

  afterAll(() => {
    console.log(`\n${'='.repeat(60)}`);
    console.log('SCORE GAP INVESTIGATION SUMMARY');
    console.log(`${'='.repeat(60)}\n`);

    const validResults = results.filter(r => !r.error);

    if (validResults.length === 0) {
      console.log('❌ No valid results. Check test API and LLM services.');
      return;
    }

    console.log('Per-Exam Results:');
    console.log(`Exam            Internal   External   Gap      `);
    console.log('-'.repeat(60));

    validResults.forEach(r => {
      const examPad = r.examKey.padEnd(15);
      const intPad = String(r.internalScore).padEnd(10);
      const extPad = String(r.externalScore).padEnd(10);
      const gapPad = String(r.gap).padEnd(8);
      console.log(`${examPad} ${intPad} ${extPad} ${gapPad}`);
    });

    const avgGap = validResults.reduce((sum, r) => sum + (r.gap || 0), 0) / validResults.length;
    const maxGap = Math.max(...validResults.map(r => r.gap || 0));
    const minGap = Math.min(...validResults.map(r => r.gap || 0));

    console.log(`\nAggregate Gap Statistics:`);
    console.log(`  Average Gap:    ${avgGap.toFixed(1)}`);
    console.log(`  Max Gap:        ${maxGap.toFixed(1)}`);
    console.log(`  Min Gap:        ${minGap.toFixed(1)}`);

    console.log(`\nRecommendations:`);
    if (avgGap > 25) {
      console.log(`  🔴 Large gap detected (avg ${avgGap.toFixed(1)}). Likely systemic issue.`);
    } else if (avgGap > 15) {
      console.log(`  🟡 Moderate gap (avg ${avgGap.toFixed(1)}). May be acceptable.`);
    } else {
      console.log(`  🟢 Small gap (avg ${avgGap.toFixed(1)}). Acceptable variance.`);
    }
  });
});
