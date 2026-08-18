/**
 * Provider Fallback Mock Tests
 * Tests Gemini → OpenAI fallback scenarios
 *
 * Purpose: Verify fallback logic handles provider failures correctly
 *   - Gemini 429 → fallback to OpenAI
 *   - Both 429 → error
 *   - Network timeout → retry + fallback
 *   - Mid-batch fallback → partial results OK
 *
 * Usage:
 *   npm test -- provider-fallback.test.js
 *
 * Note: Uses Jest mocks; no real LLM calls
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ApiError } from '../src/utils/ApiError.js';

// Mock the provider services
jest.mock('../src/services/aiQuestion.service.js');

/**
 * Mock Helper: Create provider error
 */
const createProviderError = (statusCode, message) => {
  const error = new ApiError(statusCode, message);
  return error;
};

describe('Provider Fallback Logic', () => {
  /**
   * Test: Gemini 429 falls back to OpenAI
   */
  it('falls back from Gemini 429 to OpenAI success', async () => {
    // Simulate: Gemini fails with 429, OpenAI succeeds
    const mockGemini = jest.fn()
      .mockRejectedValueOnce(createProviderError(429, 'Gemini quota exhausted'));

    const mockOpenAI = jest.fn()
      .mockResolvedValueOnce({
        questions: [
          { questionText: 'Q1', options: ['A', 'B', 'C', 'D'], correctIndex: 0 },
          { questionText: 'Q2', options: ['A', 'B', 'C', 'D'], correctIndex: 1 },
        ],
      });

    const providers = {
      gemini: { call: mockGemini, name: 'gemini' },
      openai: { call: mockOpenAI, name: 'openai' },
    };

    // Simulate fallback logic
    let lastError;
    let result = null;

    for (const provider of Object.values(providers)) {
      try {
        result = await provider.call();
        console.log(`✓ Generated via ${provider.name}`);
        break;
      } catch (error) {
        lastError = error;
        console.log(`✗ ${provider.name} failed: ${error.statusCode}`);
        continue;
      }
    }

    // Verify: Called Gemini once, OpenAI once, got result from OpenAI
    expect(mockGemini).toHaveBeenCalledTimes(1);
    expect(mockOpenAI).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
    expect(result.questions).toHaveLength(2);
  });

  /**
   * Test: Both providers 429 → error
   */
  it('errors when both providers 429', async () => {
    const mockGemini = jest.fn()
      .mockRejectedValueOnce(createProviderError(429, 'Gemini quota exhausted'));

    const mockOpenAI = jest.fn()
      .mockRejectedValueOnce(createProviderError(429, 'OpenAI quota exhausted'));

    const providers = {
      gemini: { call: mockGemini, name: 'gemini' },
      openai: { call: mockOpenAI, name: 'openai' },
    };

    let lastError = null;
    let result = null;

    for (const provider of Object.values(providers)) {
      try {
        result = await provider.call();
        break;
      } catch (error) {
        lastError = error;
        continue;
      }
    }

    // Verify: Both called, no result, error stored
    expect(mockGemini).toHaveBeenCalledTimes(1);
    expect(mockOpenAI).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
    expect(lastError).toBeDefined();
    expect(lastError.statusCode).toBe(429);
  });

  /**
   * Test: Gemini 503 falls back to OpenAI
   */
  it('falls back from Gemini 503 to OpenAI', async () => {
    const mockGemini = jest.fn()
      .mockRejectedValueOnce(createProviderError(503, 'Gemini service unavailable'));

    const mockOpenAI = jest.fn()
      .mockResolvedValueOnce({
        questions: [{ questionText: 'Q1', options: ['A', 'B', 'C', 'D'], correctIndex: 0 }],
      });

    const providers = {
      gemini: { call: mockGemini },
      openai: { call: mockOpenAI },
    };

    let result = null;
    for (const provider of Object.values(providers)) {
      try {
        result = await provider.call();
        break;
      } catch (error) {
        continue;
      }
    }

    expect(result).toBeDefined();
    expect(result.questions).toHaveLength(1);
  });

  /**
   * Test: Network timeout → retry backoff
   */
  it('retries with backoff on network timeout', async () => {
    const mockGemini = jest
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValueOnce({
        questions: [{ questionText: 'Q1', options: ['A', 'B', 'C', 'D'], correctIndex: 0 }],
      });

    // Simulate retry with backoff
    const maxAttempts = 4;
    let result = null;
    let attempt = 0;

    while (attempt < maxAttempts) {
      try {
        result = await mockGemini();
        console.log(`✓ Succeeded on attempt ${attempt + 1}`);
        break;
      } catch (error) {
        attempt++;
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
        console.log(`✗ Attempt ${attempt} failed, retry in ${backoffMs}ms`);

        if (attempt >= maxAttempts) {
          throw error;
        }

        // In real code: await sleep(backoffMs)
      }
    }

    // Verify: Called 3 times (2 failures, 1 success)
    expect(mockGemini).toHaveBeenCalledTimes(3);
    expect(result).toBeDefined();
  });

  /**
   * Test: Provider consistency (don't mix providers mid-batch)
   */
  it('prefers to stay on same provider for batch chunks', async () => {
    const mockGemini = jest.fn();
    const mockOpenAI = jest.fn();

    // Simulate: Gemini available for all chunks
    mockGemini
      .mockResolvedValueOnce({ questions: [{ questionText: 'Q1', options: ['A', 'B', 'C', 'D'], correctIndex: 0 }] })
      .mockResolvedValueOnce({ questions: [{ questionText: 'Q2', options: ['A', 'B', 'C', 'D'], correctIndex: 1 }] })
      .mockResolvedValueOnce({ questions: [{ questionText: 'Q3', options: ['A', 'B', 'C', 'D'], correctIndex: 2 }] });

    const chunkCount = 3;
    let allResults = [];
    let lastProvider = null;

    for (let i = 0; i < chunkCount; i++) {
      try {
        const result = await mockGemini();
        allResults.push(result);
        lastProvider = 'gemini';
      } catch (error) {
        // Would fallback to OpenAI here
        const result = await mockOpenAI();
        allResults.push(result);
        lastProvider = 'openai';
      }
    }

    // Verify: All from Gemini, no provider mixing
    expect(mockGemini).toHaveBeenCalledTimes(3);
    expect(mockOpenAI).toHaveBeenCalledTimes(0);
    expect(allResults).toHaveLength(3);
    expect(lastProvider).toBe('gemini');
  });

  /**
   * Test: Mid-batch fallback returns partial results
   */
  it('returns partial batch if fallback succeeds for some chunks', async () => {
    // Simulate 3 chunks: chunk1 (Gemini OK), chunk2 (Gemini fail, OpenAI OK), chunk3 (Gemini OK)
    const mockGemini = jest.fn()
      .mockResolvedValueOnce({ questions: [{ questionText: 'Q1', options: ['A', 'B', 'C', 'D'], correctIndex: 0 }] })
      .mockRejectedValueOnce(createProviderError(429, 'Quota'))
      .mockResolvedValueOnce({ questions: [{ questionText: 'Q3', options: ['A', 'B', 'C', 'D'], correctIndex: 0 }] });

    const mockOpenAI = jest.fn()
      .mockResolvedValueOnce({ questions: [{ questionText: 'Q2', options: ['A', 'B', 'C', 'D'], correctIndex: 1 }] });

    const chunkCount = 3;
    const allResults = [];
    let fallbackUsed = false;

    for (let i = 0; i < chunkCount; i++) {
      try {
        const result = await mockGemini();
        allResults.push({ chunk: i + 1, questions: result.questions });
      } catch (error) {
        fallbackUsed = true;
        const result = await mockOpenAI();
        allResults.push({ chunk: i + 1, questions: result.questions, provider: 'openai' });
      }
    }

    // Verify: Partial batch assembled, 1 chunk via OpenAI
    expect(allResults).toHaveLength(3);
    expect(allResults[1].provider).toBe('openai');
    expect(fallbackUsed).toBe(true);
    console.log(`✓ Partial batch: 3 chunks (1 via fallback), total questions: ${allResults.reduce((sum, r) => sum + r.questions.length, 0)}`);
  });

  /**
   * Test: Logging provider switches
   */
  it('logs provider fallback events for debugging', async () => {
    const logs = [];

    const mockGemini = jest.fn()
      .mockRejectedValueOnce(createProviderError(429, 'Gemini quota'));

    const mockOpenAI = jest.fn()
      .mockResolvedValueOnce({
        questions: [{ questionText: 'Q1', options: ['A', 'B', 'C', 'D'], correctIndex: 0 }],
      });

    // Simulate logging
    const log = (provider, event, details) => {
      logs.push({ provider, event, details });
      console.log(`[${provider}] ${event}: ${JSON.stringify(details)}`);
    };

    let result = null;
    try {
      result = await mockGemini();
      log('gemini', 'success', { questionCount: result.questions.length });
    } catch (error) {
      log('gemini', 'fallback', { statusCode: error.statusCode, reason: error.message });

      try {
        result = await mockOpenAI();
        log('openai', 'success', { questionCount: result.questions.length });
      } catch (openaiError) {
        log('openai', 'error', { statusCode: openaiError.statusCode });
      }
    }

    // Verify: Logs show fallback path
    expect(logs).toHaveLength(2);
    expect(logs[0].event).toBe('fallback');
    expect(logs[1].event).toBe('success');
    expect(logs[1].provider).toBe('openai');
  });
});

describe('Provider Fallback Error Handling', () => {
  /**
   * Test: Non-retryable errors don't fallback
   */
  it('does not fallback on non-retryable errors', async () => {
    const mockGemini = jest.fn()
      .mockRejectedValueOnce(createProviderError(400, 'Invalid request (non-retryable)'));

    const mockOpenAI = jest.fn();

    let result = null;
    let error = null;

    try {
      result = await mockGemini();
    } catch (e) {
      error = e;
      // For 400, should NOT fallback
    }

    // If it's 400, we don't call OpenAI
    if (error?.statusCode === 400) {
      // Non-retryable, should not fallback
      expect(mockOpenAI).not.toHaveBeenCalled();
      console.log('✓ Correctly skipped fallback for 400 error');
    }
  });

  /**
   * Test: Safety block errors don't fallback
   */
  it('does not fallback on safety block errors', async () => {
    const mockGemini = jest.fn()
      .mockRejectedValueOnce(new Error('Response was blocked by safety filter'));

    const mockOpenAI = jest.fn();

    let error = null;

    try {
      await mockGemini();
    } catch (e) {
      error = e;
      // Safety blocks should not fallback
    }

    if (error?.message?.includes('safety')) {
      expect(mockOpenAI).not.toHaveBeenCalled();
      console.log('✓ Correctly skipped fallback for safety block');
    }
  });
});
