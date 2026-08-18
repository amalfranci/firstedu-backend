# Critical Blockers - Test Execution Guide

**Status:** All 4 critical blocker test suites created and ready to run  
**Files Created:** 5 test files + runner script + documentation  
**Time to Run:** ~60-90 minutes (real LLM calls)

---

## What Was Created

### Test Suites (4 files in `tests/`)

| Test Suite | Purpose | Runtime | Type |
|-----------|---------|---------|------|
| `score-gap-investigation.test.js` | Compare internal vs OpenAI validation scores | 20-30 min | Real LLM |
| `non-stem-path-validation.test.js` | Validate DILR/VARC/CAT QA text-answer handling | 15-20 min | Real LLM |
| `provider-fallback.test.js` | Test Gemini→OpenAI fallback scenarios | <1 min | Mocks |
| `multiple-correct-validation.test.js` | Verify exactly-2-correct constraint | 10-15 min | Real LLM |

### Supporting Files

- `tests/README.md` — Detailed documentation for each test
- `run-blockers.sh` — Convenient test runner script
- `BLOCKER_TEST_GUIDE.md` — This file

---

## Quick Start (5 Minutes)

### Step 1: Verify Prerequisites

```bash
# Check backend running
curl http://localhost:3000/health

# Check LLM keys
echo $GEMINI_API_KEY
echo $OPENAI_API_KEY

# Check Jest installed
npm list jest
```

### Step 2: Run All Tests

```bash
cd firstedu-backend

# Make runner executable
chmod +x run-blockers.sh

# Run all 4 blocker tests
./run-blockers.sh

# Or without runner:
npm test -- --testPathPattern="score-gap|non-stem|provider|multiple" --runInBand
```

### Step 3: Check Results

Look for:
- ✅ **All 4 tests PASSED** → Ready for production
- ⚠️ **1-2 tests failed** → Needs investigation (see troubleshooting)
- ❌ **3+ tests failed** → Major issues, block production

---

## Individual Test Runs

Run specific blocker tests:

```bash
# Score gap investigation (20-30 min)
./run-blockers.sh --gap-only

# Non-STEM validation (15-20 min)
./run-blockers.sh --non-stem-only

# Provider fallback (1 min)
./run-blockers.sh --fallback-only

# Multiple-correct (10-15 min)
./run-blockers.sh --multiple-only
```

---

## Expected Output Examples

### ✅ Passing Score Gap Test

```
Running: Score Gap Investigation
Compares internal vs OpenAI validation scores
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Generating 25 questions... (JEE Main Hard)
   → Job ID: job_1234567890
   → Produced 25 questions

2. Internal finalize score: 88

3. Running OpenAI validation audit...
   ✓ Validated in 12450ms

4. External validation scores:
   - difficultyMatchScore: 67
   - correctnessScore: 98
   - topicRelevanceScore: 92

5. SCORE GAP ANALYSIS:
   Internal:  88
   External:  67
   Gap:       21 (31.3%)

✓ PASSED (410s)
```

### ✅ Passing Non-STEM Test

```
Running: Non-STEM Path Validation
Tests DILR, VARC, CAT QA text-answer handling
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Validating: DILR Logic Puzzles Hard
  ✓ Generated 20 questions
  ✓ Text answer consistency: No contradictions found
  ✓ No numeric garbage in text answers
  ✓ No Team 1 vs Team 14 confusion detected

Validating: VARC Reading Hard
  ✓ Generated 20 questions
  ✓ Text answer consistency: No contradictions found

✓ PASSED (945s)
```

### ✅ Passing Provider Fallback Test

```
Running: Provider Fallback
Verifies Gemini → OpenAI fallback logic
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 PASS  tests/provider-fallback.test.js
  Provider Fallback Logic
    ✓ falls back from Gemini 429 to OpenAI success
    ✓ errors when both providers 429
    ✓ falls back from Gemini 503 to OpenAI
    ✓ retries with backoff on network timeout
    ✓ prefers to stay on same provider for batch chunks
    ✓ returns partial batch if fallback succeeds for some chunks
    ✓ logs provider fallback events for debugging

✓ PASSED (5s)
```

### ✅ Passing Multiple-Correct Test

```
Running: Multiple-Correct Validation
Ensures exactly 2 correct answers per question
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Generating 30 multiple-correct questions...
✓ Generated 30 questions (requested 30)

Validation Results:
  ✓ Valid:   30/30
  ✗ Invalid: 0/30

Validity rate: 100% (>95% ✓)

✓ PASSED (623s)
```

---

## Troubleshooting

### Test Timeout

**Problem:** Jest timeout after 10 minutes
```
Tests took longer than 10000 ms
```

**Solution:**
```bash
# Increase timeout to 15 minutes
npm test -- --testTimeout=900000 score-gap-investigation.test.js

# Or set globally in jest.config.js
testTimeout: 900000
```

---

### Backend Not Reachable

**Problem:** `Cannot reach API at http://localhost:3000`
```
⚠️  Backend not reachable at http://localhost:3000
```

**Solution:**
```bash
# Terminal 1: Start backend
cd firstedu-backend
npm run start

# Wait for: "Server running on port 3000"

# Terminal 2: Run tests
./run-blockers.sh
```

---

### LLM Service Errors

**Problem:** Gemini/OpenAI quota exhausted
```
Error: Gemini quota exhausted (429)
```

**Solution:**
1. Check API quotas in console.cloud.google.com / platform.openai.com
2. If quota exceeded:
   - Wait 24 hours for reset
   - Or upgrade API limits
   - Or increase budget

**Temporary:** Skip that test and move to next
```bash
./run-blockers.sh --non-stem-only  # Skip gap test, run others
```

---

### Provider Fallback Tests Failing

**Problem:** Mock tests are failing
```
FAIL  tests/provider-fallback.test.js
```

**Solution:**
```bash
# Check Jest is installed
npm install --save-dev jest @jest/globals

# Clear Jest cache
npx jest --clearCache

# Run with verbose output
npm test -- --verbose tests/provider-fallback.test.js
```

---

### Multiple Questions Less Than Requested

**Problem:** Generated 28/30 questions
```
Requested: 30
Delivered: 28
```

**Context:** This is NORMAL. Top-up mechanism attempts to reach target.

**If <25 delivered:** Investigate
```bash
# Check logs for why questions were dropped
docker logs backend | grep -i "drop\|invalid"

# Increase top-up retry attempts
AI_QB_FINALIZE_TOPUP_MAX_WAVES=5 npm test -- ...
```

---

## Reading Test Results

### Score Gap Results

**Good (Gap <15):**
```
Average Gap: 12.3 points
→ Acceptable variance between internal and external audits
→ Both scoring similarly, just slight calibration difference
```

**Moderate (Gap 15-25):**
```
Average Gap: 19.8 points
→ Noticeable gap, but may be acceptable
→ Investigate if systematic (all exams) or exam-specific
→ Consider tuning one audit's thresholds
```

**Bad (Gap >25):**
```
Average Gap: 28.5 points
→ Large systematic mismatch
→ One audit is significantly off
→ Must fix before production
→ Options:
  1. Adjust internal threshold (92 → 80)
  2. Adjust external prompt
  3. Investigate data difference
```

### Non-STEM Results

**Good:**
```
✓ Text answer consistency: No contradictions found
✓ No numeric garbage in text answers
✓ No Team 1 vs Team 14 confusion detected
→ All bug fixes working correctly
```

**Issue:**
```
✗ Found numeric distractors mixed with text options
→ isNumericAnswer() guard not working
→ Check if buildNumericDistractors() is guarded
```

### Provider Fallback Results

**Good:**
```
✓ All 7 scenarios pass
→ Fallback logic is correct
→ Safe for production
```

**Issue:**
```
FAIL: falls back from Gemini 429 to OpenAI success
→ Fallback logic broken
→ Review buildProviderFallbackChain()
→ Check isProviderAvailabilityError() detection
```

### Multiple-Correct Results

**Good:**
```
Validity rate: 100% (>95% ✓)
→ All questions have exactly 2 correct
→ Safe for production
```

**Issue:**
```
Validity rate: 92% (>95% expected)
→ 8% of questions invalid
→ Drop rate is too high
→ Check AI output format
→ Verify batch parser is working
```

---

## Next Steps

### If All Tests Pass ✅

1. **Archive results:** Copy test output to `/docs/blocker-test-results/`
2. **Update status:** Mark blockers as RESOLVED in roadmap
3. **Proceed to Phase 2:**
   - Add answer correction endpoint (6-8h)
   - Add job cleanup task (4-6h)
   - Move to production launch prep

### If Some Tests Fail ⚠️

1. **Identify failures:** Which test(s) failed?
2. **Root cause:** See troubleshooting section above
3. **Fix:** Implement required code changes
4. **Re-run:** Run test again to verify fix
5. **Document:** Note what was fixed in CHANGELOG

### If Multiple Tests Fail ❌

1. **Stop:** Do NOT proceed to production
2. **Investigate:** 
   - Check backend health
   - Check LLM service status
   - Check API keys
3. **Escalate:** Contact team lead
4. **Retry:** Once issues fixed, re-run all tests

---

## Performance Expectations

Typical runtime breakdown:

| Test | Generation | Validation | Analysis | Total |
|------|------------|-----------|----------|-------|
| Score Gap | 15-20 min | 5-10 min | 1-2 min | 20-30 min |
| Non-STEM | 10-15 min | 3-5 min | 1 min | 15-20 min |
| Fallback | - | - | - | <1 min |
| Multiple | 8-12 min | 2-3 min | 1 min | 10-15 min |
| **TOTAL** | — | — | — | **~60-90 min** |

---

## CI/CD Integration

Add to GitHub Actions:

```yaml
# .github/workflows/critical-blockers.yml
name: Critical Blockers

on: [push, pull_request, schedule]

jobs:
  blockers:
    runs-on: ubuntu-latest
    timeout-minutes: 120

    steps:
      - uses: actions/checkout@v3
      - name: Install dependencies
        run: npm install
      - name: Run blocker tests
        run: ./run-blockers.sh
      - name: Upload results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: blocker-results
          path: test-results/
```

---

## Support

### Questions?

1. **Test documentation:** See `tests/README.md`
2. **Troubleshooting:** See troubleshooting section above
3. **Code issues:** Check test file comments
4. **LLM issues:** Check backend logs

### Getting Help

```bash
# Verbose test output
npm test -- --verbose tests/score-gap-investigation.test.js

# Show test plan without running
npm test -- --listTests

# Run with debug logging
DEBUG=* npm test -- tests/provider-fallback.test.js
```

---

## Summary

**You now have:**
- ✅ 4 comprehensive test suites for critical blockers
- ✅ Mock tests for provider fallback (quick)
- ✅ Real LLM tests for score gap, non-STEM, multiple-correct
- ✅ Automated test runner script
- ✅ Detailed troubleshooting guide
- ✅ Expected output examples

**To start:** Run `./run-blockers.sh` and follow the output.

**Time to launch:** ~90 minutes test time + fix time if needed

