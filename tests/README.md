# Critical Blocker Test Suites

This directory contains comprehensive test suites for the 4 critical blockers that must be fixed before production launch.

## Quick Start

### Prerequisites
- Backend running on localhost:3000
- LLM services (Gemini + OpenAI) configured and accessible
- Node.js with Jest installed

### Run All Critical Tests

```bash
# Run all 4 blocker tests in sequence
npm test -- --testPathPattern="blocker" --runInBand

# Or run individual tests
npm test -- score-gap-investigation.test.js
npm test -- non-stem-path-validation.test.js
npm test -- provider-fallback.test.js
npm test -- multiple-correct-validation.test.js
```

### Environment Setup

```bash
# Set test API URL (default: http://localhost:3000)
export TEST_API_URL="http://localhost:3000"

# Or for staging
export TEST_API_URL="https://staging-api.example.com"

# Run with custom timeout (tests make real LLM calls)
npm test -- --testTimeout=600000  # 10 minutes
```

---

## Test Suite Details

### 1. Score Gap Investigation (`score-gap-investigation.test.js`)

**Purpose:** Investigate why internal audits score 82-94 but OpenAI validation scores 64-66

**What it does:**
- Generates 4 test banks (JEE, UPSC, CAT, NEET)
- Captures internal finalize scores
- Runs OpenAI validation
- Compares and analyzes gaps
- Exports results to JSON for analysis

**Expected Runtime:** 20-30 minutes  
**Success Criteria:**
- Gap <15 points (internal - external)
- Identifies root cause
- Documents per-exam calibration

**Output:**
```
Score Gap Analysis Summary:
- JEE Main: Internal 88, External 67, Gap 21
- UPSC: Internal 85, External 70, Gap 15
- CAT: Internal 82, External 65, Gap 17
- NEET: Internal 90, External 72, Gap 18

Average Gap: 17.75
Recommendation: Investigate if external audit is too strict or internal too lenient
```

**Action if it fails:**
- [ ] Check if both audits receiving _solveSteps
- [ ] Compare exact prompt format
- [ ] Check data mismatch in validation payload
- [ ] Consider adjusting internal threshold (from 92 → 85)

---

### 2. Non-STEM Path Validation (`non-stem-path-validation.test.js`)

**Purpose:** Verify text-answer paths work correctly (DILR, VARC, CAT QA)

**What it does:**
- Generates DILR, VARC, and CAT QA banks
- Validates against specific bug fixes:
  - Text answer consistency (no "Team 1" vs "Team 14" confusion)
  - No numeric garbage in text options
  - No fractional distractors on whole-number answers
  - No self-contradictory explanations

**Expected Runtime:** 15-20 minutes  
**Success Criteria:**
- 0 key mismatches in text-answer banks
- Correctness score >80 for all exam types
- All bug fix checks pass

**Output:**
```
DILR Validation:
  ✓ Generated 20 questions
  ✓ Text answer consistency: No contradictions found
  ✓ No numeric garbage in text answers
  ✓ No Team 1 vs Team 14 confusion detected
  Correctness: 95

VARC Validation:
  ✓ Generated 20 questions
  ✓ Text answer consistency: No contradictions found
  Correctness: 92

CAT QA Validation:
  ✓ Generated 20 questions
  ✓ No fractional distractors on whole-number answers
  Correctness: 88
```

**Action if it fails:**
- [ ] Check logs for specific defects
- [ ] Run deterministic audit on DILR/VARC output
- [ ] Verify detectTextAnswerConsistency() is active
- [ ] Check if numeric distractor filter is working
- [ ] May need additional fixes before launch

---

### 3. Provider Fallback (`provider-fallback.test.js`)

**Purpose:** Verify Gemini → OpenAI fallback works correctly

**What it does:**
- Uses Jest mocks (no real LLM calls)
- Tests 5 scenarios:
  1. Gemini 429 → OpenAI succeeds (fallback)
  2. Both 429 → error
  3. Gemini 503 → OpenAI succeeds
  4. Network timeout → retry backoff → success
  5. Provider consistency (stay on same provider)

**Expected Runtime:** <1 minute (mocks only)  
**Success Criteria:**
- All 5 scenarios pass
- Fallback logic is correct
- Provider consistency maintained

**Output:**
```
✓ falls back from Gemini 429 to OpenAI success
✓ errors when both providers 429
✓ falls back from Gemini 503 to OpenAI
✓ retries with backoff on network timeout
✓ prefers to stay on same provider for batch chunks
✓ returns partial batch if fallback succeeds for some chunks
✓ logs provider fallback events for debugging
✓ does not fallback on non-retryable errors
✓ does not fallback on safety block errors
```

**Action if it fails:**
- [ ] Review buildProviderFallbackChain() logic
- [ ] Verify isProviderAvailabilityError() correctly identifies 429/503
- [ ] Check that non-retryable errors are handled
- [ ] Ensure logging is in place

---

### 4. Multiple-Correct Validation (`multiple-correct-validation.test.js`)

**Purpose:** Ensure all multiple-choice questions have EXACTLY 2 correct answers

**What it does:**
- Generates 30 multiple-correct questions
- Validates each has array of exactly 2 indices
- Tests batch parser drops invalid items
- Verifies top-up fills dropped items
- Checks marked options are distinct

**Expected Runtime:** 10-15 minutes  
**Success Criteria:**
- >95% of questions pass exactly-2 constraint
- Invalid questions are dropped
- Top-up replaces dropped items
- Final count ≈ requested count

**Output:**
```
Generated 30 questions (requested 30)

Validation Results:
  ✓ Valid:   29/30
  ✗ Invalid: 1/30

Invalid question:
  Q15: correctAnswer has 3 elements, need exactly 2

Top-up test:
  Requested: 20
  Delivered: 20 (after top-up)
  All valid: Yes
```

**Action if it fails:**
- [ ] Check parseQuestionBankAIItem() validation logic
- [ ] Verify correctAnswer array length check
- [ ] Ensure batch parser drops bad items correctly
- [ ] Test top-up batch generation
- [ ] May indicate AI is generating wrong format

---

## Running Tests Locally

### Step 1: Start Backend

```bash
cd firstedu-backend
npm run start  # or npm run dev
# Wait for: "Server running on port 3000"
```

### Step 2: Start LLM Services

Ensure GEMINI_API_KEY and OPENAI_API_KEY are set:

```bash
export GEMINI_API_KEY="your-key"
export OPENAI_API_KEY="your-key"
```

### Step 3: Run Tests

```bash
# Terminal 2: Run blocker tests
cd firstedu-backend
npm test -- --testPathPattern="score-gap|non-stem|provider|multiple" --runInBand

# Watch output for:
# - Score gap analysis
# - Non-STEM defect counts
# - Provider fallback validation
# - Multiple-correct percentage
```

---

## Interpreting Results

### Green ✅ (Ready for production)
- Score gap <15 points
- Non-STEM correctness >90%
- All provider fallback scenarios pass
- Multiple-correct >95% valid

### Yellow ⚠️ (Needs investigation)
- Score gap 15-25 points → investigate calibration
- Non-STEM correctness 80-90% → some issues remain
- Provider tests pass but no load testing → test under load
- Multiple-correct 90-95% valid → acceptable but monitor

### Red ❌ (Block production)
- Score gap >25 points → systemic mismatch
- Non-STEM correctness <80% → shipping broken banks
- Provider tests fail → fallback broken
- Multiple-correct <90% valid → wrong answer keys shipping

---

## Results Export

Each test suite exports a JSON results file:

```bash
# Score gap results
score-gap-results-2026-07-22.json

# Format:
{
  "timestamp": "2026-07-22T14:30:00Z",
  "tests": [
    {
      "examKey": "jee_main_hard",
      "internalScore": 88,
      "externalScore": 67,
      "gap": 21,
      "defectCount": 3
    }
  ],
  "summary": {
    "averageGap": 17.75,
    "recommendation": "Investigate external audit calibration"
  }
}
```

Use this for:
- Tracking historical gaps
- Per-exam calibration tuning
- Identifying trends over time

---

## CI/CD Integration

Add to `.github/workflows/critical-blockers.yml`:

```yaml
name: Critical Blocker Tests

on: [push, pull_request]

jobs:
  blockers:
    runs-on: ubuntu-latest
    timeout-minutes: 120  # 2 hours for LLM calls

    services:
      backend:
        image: your-backend:latest
        ports:
          - 3000:3000
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}

    steps:
      - uses: actions/checkout@v3

      - name: Install dependencies
        run: cd firstedu-backend && npm install

      - name: Wait for API
        run: npx wait-on http://localhost:3000 --timeout 60000

      - name: Run critical blocker tests
        run: npm test -- --testPathPattern="blocker" --runInBand

      - name: Upload results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: blocker-test-results
          path: tests/*-results-*.json

      - name: Comment on PR
        if: failure()
        uses: actions/github-script@v6
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '❌ Critical blocker tests failed. See logs above.'
            })
```

---

## Troubleshooting

### Timeout errors
```bash
# Increase Jest timeout
npm test -- --testTimeout=900000  # 15 minutes
```

### API connection errors
```bash
# Verify backend is running
curl http://localhost:3000/health

# Check LLM service keys
echo $GEMINI_API_KEY
echo $OPENAI_API_KEY
```

### Mock test failures
```bash
# Ensure jest is installed
npm install --save-dev jest @jest/globals
```

### LLM call failures
```bash
# Check backend logs for rate limits
docker logs backend | grep -i "429\|503\|quota"

# May need to increase timeout or retry
```

---

## Next Steps After Passing

Once all 4 critical blocker tests pass:

1. **Week 2-3:** Core fixes (answer correction endpoint, job cleanup)
2. **Week 4-5:** Edge cases (small counts, non-Latin scripts, large batches)
3. **Week 6:** Documentation (runbook, troubleshooting guide)
4. **Week 7:** Canary launch to staging

See [PRODUCTION_READINESS_ROADMAP.md](../docs/PRODUCTION_READINESS_ROADMAP.md) for full timeline.

