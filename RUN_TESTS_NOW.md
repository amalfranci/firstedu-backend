# 🚀 Run Blocker Tests NOW - Step by Step

**Total time:** ~90 minutes (make coffee ☕)  
**Cost:** ~$2-5 LLM credits

---

## Prerequisites Checklist

Before starting, ensure you have:

- [ ] Node.js 18+ installed (`node --version`)
- [ ] npm installed (`npm --version`)
- [ ] GEMINI_API_KEY set (get from console.cloud.google.com)
- [ ] OPENAI_API_KEY set (get from platform.openai.com)
- [ ] Backend running OR ready to start

---

## Option A: Fully Automated (Recommended)

**This script does everything automatically:**

```bash
cd firstedu-backend

# Set API keys
export GEMINI_API_KEY="your-gemini-key"
export OPENAI_API_KEY="your-openai-key"

# Run setup + tests
chmod +x SETUP_AND_RUN_TESTS.sh
./SETUP_AND_RUN_TESTS.sh
```

**What it does:**
1. ✅ Checks prerequisites
2. ✅ Installs dependencies
3. ✅ Verifies backend is running
4. ✅ Runs all 4 blocker tests
5. ✅ Shows results

---

## Option B: Manual Step by Step

### Step 1: Set API Keys

```bash
# Terminal 1 - Set environment variables
export GEMINI_API_KEY="your-gemini-key-here"
export OPENAI_API_KEY="your-openai-key-here"

# Verify
echo $GEMINI_API_KEY
echo $OPENAI_API_KEY
```

### Step 2: Start Backend

```bash
# Terminal 1 (leave running)
cd firstedu-backend
npm run start

# Wait for: "Server running on port 3000"
```

### Step 3: Run Tests

```bash
# Terminal 2
cd firstedu-backend

# Option 3a: Run all tests
chmod +x run-blockers.sh
./run-blockers.sh

# Option 3b: Run individual tests
npm test -- tests/score-gap-investigation.test.js
npm test -- tests/non-stem-path-validation.test.js
npm test -- tests/provider-fallback.test.js
npm test -- tests/multiple-correct-validation.test.js
```

---

## What To Expect

### Score Gap Test (20-30 min)
```
Running: Score Gap Investigation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Generating 25 questions...
✓ Generated
✓ Validated
Score gap: 21 points

✓ PASSED
```

### Non-STEM Test (15-20 min)
```
Running: Non-STEM Path Validation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DILR: ✓ Generated ✓ No issues
VARC: ✓ Generated ✓ No issues
CAT QA: ✓ Generated ✓ No issues

✓ PASSED
```

### Provider Fallback (1 min)
```
Running: Provider Fallback
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Gemini 429 → OpenAI success
✓ Both 429 → error
✓ Retry backoff → success
[7 more scenarios]

✓ PASSED
```

### Multiple-Correct (10-15 min)
```
Running: Multiple-Correct Validation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Generated: 30 questions
Valid: 30/30 (100%)
Validity rate: 100% ✓

✓ PASSED
```

### Final Summary
```
✓ All 4 tests PASSED
🚀 Ready for production!
```

---

## Troubleshooting

### "Backend not reachable"
```bash
# In Terminal 1, start backend
npm run start

# Wait for: "Server running on port 3000"
# Then run tests in Terminal 2
```

### "API key invalid"
```bash
# Check keys are set
echo $GEMINI_API_KEY
echo $OPENAI_API_KEY

# Or export in same terminal:
export GEMINI_API_KEY="your-key"
export OPENAI_API_KEY="your-key"
npm test -- tests/score-gap-investigation.test.js
```

### "Timeout after 10 minutes"
```bash
# Increase timeout
npm test -- --testTimeout=900000 tests/score-gap-investigation.test.js
```

### "Rate limit exceeded (429)"
```
Tests failed because LLM quota exhausted.
- Wait 24 hours for reset, OR
- Increase API quota in console, OR
- Skip that test and move to next
```

### "Out of memory"
```bash
# Increase Node memory
NODE_OPTIONS=--max-old-space-size=4096 npm test -- tests/score-gap-investigation.test.js
```

---

## After Tests Complete

### If All Pass ✅
```
Great! System is production-ready.

Next steps:
1. Merge code to staging
2. Deploy new endpoints
3. Start Phase 3 (calibration work)
```

### If Some Fail ⚠️
```
Review failures:
1. Open BLOCKER_TEST_GUIDE.md
2. Find your failure scenario
3. Follow troubleshooting steps
4. Fix issue
5. Re-run tests
```

### If Multiple Fail ❌
```
Major issues detected.
1. Check backend logs
2. Verify API keys
3. Check API quotas
4. Contact team for debugging
```

---

## Monitoring Progress

### Terminal Output
Tests print detailed progress. Watch for:
- ✅ Green checkmarks = passing
- ❌ Red X = failing
- ⏱️ Timings per test

### Estimated Timeline
```
Start:           00:00
Score Gap:       00:25 (25 min)
Non-STEM:        00:45 (20 min)
Fallback:        00:46 (1 min)
Multiple:        01:15 (30 min)
Final:           01:20 (5 min summary)

Total: ~90 minutes
```

---

## Quick Reference

```bash
# Set keys
export GEMINI_API_KEY="..."
export OPENAI_API_KEY="..."

# Start backend (Terminal 1)
npm run start

# Run all tests (Terminal 2)
cd firstedu-backend
./run-blockers.sh

# Run one test
npm test -- tests/score-gap-investigation.test.js

# Increase timeout
npm test -- --testTimeout=900000 tests/score-gap-investigation.test.js

# View results
cat score-gap-results-*.json
```

---

## Support

- **Test docs:** See `BLOCKER_TEST_GUIDE.md`
- **Setup issues:** Check prerequisites above
- **API issues:** Check console.cloud.google.com / platform.openai.com
- **Test failures:** See troubleshooting section
- **Other:** Contact team lead

---

## Start Now! 🚀

```bash
# Copy-paste this:
cd firstedu-backend
export GEMINI_API_KEY="your-key"
export OPENAI_API_KEY="your-key"
chmod +x run-blockers.sh
./run-blockers.sh

# Or use automated setup:
chmod +x SETUP_AND_RUN_TESTS.sh
./SETUP_AND_RUN_TESTS.sh
```

**Expected wait time:** ~90 minutes ☕

