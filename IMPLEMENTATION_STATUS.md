# Implementation Status - Production Readiness

**Last Updated:** 2026-07-28  
**Status:** Phase A (verification) + Phase C (generation quality) landed

---

## Phase A — Independent Verification (done)

- FINAL_ANSWER lock, auto solver, explanation verifier, difficulty judge
- Rule engine, parallel verify, selective regen, `_verification`
- SymPy sidecar, human review queue, telemetry, stage providers

---

## Phase C — Generation Quality (done)

1. **Blueprint Planner** — `questionBlueprint.service.js`  
   Enriches slotPlans → `{topic, concept, difficulty, type, estimatedTime, blooms, questionKind}`  
   Generate stamps `_blueprint`; plan API returns `blueprints` + `examDistribution`

2. **Difficulty Calibration** — `difficultyCalibration.service.js`  
   Retrieves easy/medium/hard exemplars before solve-first (`AI_QB_DIFFICULTY_CALIBRATION`)

3. **Compact prompts** — `AI_QB_COMPACT_PROMPTS=1` + blueprint block injected into skeleton prompt

4. **Exam Blueprint** — `buildExamBlueprintDistribution` enforces subject × difficulty counts

5. **Stronger metadata RAG** — concept / difficulty / distractor / time / formula / mistakes  
   (`AI_QB_RAG_METADATA_ONLY=1`) + difficulty filter on retrieval

6. **Distractor Pass** — `distractorPass.service.js` (separate LLM + validate)  
   `AI_QB_DISTRACTOR_PASS=1` (default on)

7. **Coverage Checker** — `checkBlueprintCoverage` on generate result → `pipelineSummary.blueprintCoverage`

8. **Formula Validator** — `formulaValidator.service.js` allow-list + impossible patterns  
   `AI_QB_FORMULA_VALIDATOR=1` (default on)

9. **Model routing by difficulty** — `resolveProviderForDifficulty`  
   `AI_QB_EASY_PROVIDER` / `AI_QB_MEDIUM_PROVIDER` / `AI_QB_HARD_PROVIDER`

10. **Eval harness** — `scripts/eval-phase-c-quality.mjs` + `tests/phase-c-generation-quality.test.js`

### Phase C env knobs
```
AI_QB_BLUEPRINT_PLANNER=1
AI_QB_DIFFICULTY_CALIBRATION=1
AI_QB_DISTRACTOR_PASS=1
AI_QB_FORMULA_VALIDATOR=1
AI_QB_RAG_METADATA_ONLY=1
AI_QB_COMPACT_PROMPTS=0
AI_QB_EASY_PROVIDER=gemini
AI_QB_MEDIUM_PROVIDER=claude
AI_QB_HARD_PROVIDER=openai
```

### Verify
```bash
pnpm test -- tests/phase-c-generation-quality.test.js tests/final-answer-lock.test.js
node scripts/eval-phase-c-quality.mjs
```
