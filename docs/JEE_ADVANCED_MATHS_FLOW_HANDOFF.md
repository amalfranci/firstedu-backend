# JEE Advanced Mathematics — Implementation Handoff

**Status:** Quality-first Stage A integrated (2026-08-04)  
**Data pack:** `jee_advanced/` (project root)  
**Service:** `src/services/jeeAdvancedMaths.service.js`  
**Primary script:** `scripts/generate-jee-advanced-hard-maths-questions-only.mjs`

---

## 1. What was implemented

File-backed JEE Advanced Maths generation, wired into the same **solve-first + dual-lock** stack as JEE Main hard maths, but with **Advanced-specific** syllabus, scoring, and hard context.

| Layer | Main (existing) | Advanced (new) |
|-------|-----------------|----------------|
| Syllabus | `files/jee-main-syllabus/` (14 units) | `jee_advanced/maths_syllabus.json` (M01–M19) |
| Hard context | `files/ncert-reference/mathematics/` | `jee_advanced/maths_ncert_context.json` |
| Scoring | April-2026 Main scoring concepts | `jee_advanced/maths_scoring.json` (advanced_relevance) |
| Quotas | — | `jee_advanced/maths_question_type_quotas.json` |
| Paper pattern | Main single MCQ | `jee_advanced/jee_advanced_pattern_totals.json` |

---

## 2. Files in `jee_advanced/`

| File | Contents |
|------|----------|
| `maths_syllabus.json` | 19 topics M01–M19 with chapter names + subtopics |
| `maths_ncert_context.json` | Per topic: concepts, formulas, methods, traps, **hard_archetypes**, **banned_easy_templates**, out_of_scope |
| `maths_scoring.json` | Per topic: advanced_relevance (high/medium/low), difficulty_split, notes |
| `maths_question_type_quotas.json` | Bank quotas: single/multi/integer/match × medium/hard |
| `jee_advanced_pattern_totals.json` | Paper 1/2 per-subject section counts (single 4, multi 3, integer 6, match 4) |

**Default quality lock topics (HIGH relevance):**  
M02 Complex, M05 P&C, M07 Matrices, M08 Probability, M13 Conics, M14 3D, M16 AOD, M17 Integrals, M18 DE, M19 Vectors.

---

## 3. Integration points

| Component | Behaviour when `examProfile === jee_advanced` |
|-----------|-----------------------------------------------|
| `conceptArchetypePlanner.service.js` | Injects Advanced syllabus + scoring + hard archetypes; skips Main syllabus/scoring double-inject |
| `questionSolveFirst.service.js` | Writer prompt gets Advanced NCERT pack + syllabus lock + pattern note |
| `answerCorrection.service.js` | Solver gets Advanced formula/method lock when topic path contains "JEE Advanced" |
| `jeeMainOfficialSyllabus.service.js` | Returns empty for Advanced (Advanced pack owns syllabus) |
| `jeeMainScoringConcept.service.js` | Planning block empty for Advanced; writer gets short Advanced hardness lock |

Exam profile detection: topic/bank name must contain **`JEE Advanced`** (script does this).

---

## 4. Quality stack (Stage A)

```
Plan (Advanced M01–M19 + HIGH scoring) 
  → Gemini hard skeleton (gemini-3.5-flash)
  → CAS (when archetype known)
  → Skeleton difficulty audit (min 70, last-attempt 65)
  → Hard mandate (multi_concept)
  → MCQ build
  → Dual lock o4-mini + o3-mini (drop disagree)
  → Fill until N dual-locked
```

**Hardness vs yield:** skeleton min **70** (Main golden 80), last-attempt **65**. Dual-lock still enforces answer correctness; the lower floor reduces empty regen waves on borderline multi-concept stems.

---

## 5. How to run

```bash
cd firstedu-backend

# Default: 10 hard singles from HIGH-relevance Advanced topics
node scripts/generate-jee-advanced-hard-maths-questions-only.mjs --count=10

# Include medium+high relevance
node scripts/generate-jee-advanced-hard-maths-questions-only.mjs --count=10 --medium-plus=1

# All M01–M19
node scripts/generate-jee-advanced-hard-maths-questions-only.mjs --count=10 --all-topics

# Keep unverified (debug only — not for ship)
node scripts/generate-jee-advanced-hard-maths-questions-only.mjs --count=5 --keep-unverified
```

**Requires:** `GEMINI_API_KEY`, `OPENAI_API_KEY`, `MONGODB_URI` (recommended), data under `jee_advanced/`.

**Output:** `temp/jee-advanced-hard-<N>-maths-questions-only/<timestamp>/`

### Timeouts (do not use Main `.env` fail-fast values)

| Call | Advanced default | Why |
|------|------------------|-----|
| Gemini skeleton | **240s** | Hard multi-concept regen waves hit `"This operation was aborted"` at 150s |
| OpenAI dual solvers (o4/o3) | **150s** | 60s produced 100% `unfixable` drops on Stage A lock |

CLI overrides:

```bash
node scripts/generate-jee-advanced-hard-maths-questions-only.mjs --count=1 \
  --solver-timeout-ms=180000 --gemini-timeout-ms=300000
```

Banner should print `Timeouts : gemini=…ms · solver=…ms` and `Difficulty floors: skeletonMin=70 · lastAttempt=65`.

### Failure modes seen in live runs

| Symptom | Cause | Fix |
|---------|-------|-----|
| `STAGE_A_ANSWER_LOCK_DROPPED_UNVERIFIED` all items, `timeout of 60000ms exceeded` | Solver budget too short for hard multi-concept | Default now 150s; raise `--solver-timeout-ms` if still timing out |
| `This operation was aborted` mid fill | Gemini AbortController timeout | Default now 240s; raise `--gemini-timeout-ms` |
| `skeletonMin=80` in banner | Main `.env` leaked into Advanced floors | Script now forces 85/78 via `JEE_ADV_*` / hardcoded defaults |
| `sympy sidecar unavailable (exit=9009)` | No Python on PATH | Optional: set `AI_QB_PYTHON` or `AI_QB_SKELETON_CAS_VERIFY=0` |

---

## 6. Quality break analysis (from 6-Q live paper review)

| Layer | Status | Notes |
|-------|--------|--------|
| Mathematical key (dual-lock) | Strong | o4/o3 agree can hit ~correctness |
| Stem design (aha / hidden insight) | Weak spot | Multi one-shot path produced Main-level Q2/Q3 |
| Uniform Advanced depth | Uneven | Q4–Q6 Advanced; Q2–Q3 drills |
| Explanations | Too brief | Generator + solver notes ≠ full solution |

**Root causes fixed in code (2026-08-04):**
1. `buildJeeAdvancedDesignQualityBlock` — ban plug-in-only stems; require insight + full explain
2. Multi-correct generation uses **custom Gemini Advanced prompt** (not one-shot QB default)
3. Post dual-lock **`expandExplanation`** — key locked, solution rewritten to full derivation
4. Multi dual-lock by letter-set (Stage A single-only re-key cannot verify multi)

**Quality-preserving upgrades (post 9.2 authenticity set):**
1. **Trust grades** on every locked item (`production_dual` / `provisional` / `A-only` …) — never treat A+generator as production dual
2. **Selective B** with **force B** on integer/match/high-risk; integer **independent recompute** when lock is weak
3. **Insight-first solutions only on final kept items** (not mid-regen) — preserves hard stem quality
4. **Archetype diversity** hints + slot reordering (cap pure Apollonius→transform chains)

**Balanced hard (~9.2) + correctness (92–100% ship path):**
1. **Depth governor** — max 2–3 major techniques per stem (no 4-engine mega multi)
2. **No generator-as-B** — when OpenAI 429, B is independent Gemini solve
3. **Mandatory recompute** on all integers + all multi letter-sets; mismatch → DROP
4. Multi difficulty self-score target **78–88** (hard Advanced, not olympiad stack)

**Still deferred for 100/100 authenticity:**
- Full CAS/sympy on every integer (optional when Python available)
- Single-correct Advanced path with same stack
- Paragraph / matrix-match types
- Human paper-setter review loop for provisional tags

---

## 7. What is intentionally deferred (next)

Quality first path now has **6 non-single** (multi/integer/match) + dual type-specific locks.
Still deferred for full paper fidelity:

| Deferred | Why |
|----------|-----|
| Single-correct Advanced path with design-quality auditor | Same insight bar as non-single |
| Paragraph / matrix-match types | Structure not fully wired |
| Full 17Q × subject paper mix | Scale after uniform depth |
| Stage B full finalize | Same as Main lean path |
| Automated "aha" judge (drop Main-level stems) | Design block is prompt-only today |

Paper pattern file is loaded and written into `summary.json` / `advanced-data-snapshot.json` for later wiring.

---

## 8. Smoke checklist

1. `isJeeAdvancedMathsDataAvailable()` → true  
2. Topic string contains `JEE Advanced` → `detectExamProfile` → `jee_advanced`  
3. Plan transcript shows Advanced syllabus / hard archetype blocks  
4. Generated items have dual-lock flags under strict mode  
5. Chapters attach to M-ids via `inferJeeAdvancedTopicsFromSlots`

```bash
node -e "import('./src/services/jeeAdvancedMaths.service.js').then(m => {
  console.log('available', m.isJeeAdvancedMathsDataAvailable());
  console.log('high', m.getHighRelevanceAdvancedTopics().map(t => t.topicId).join(','));
  console.log('paper P1', m.getAdvancedPaperTypeCounts({ paper: 1 }));
})"
```

---

## 9. Gemini cost (accurate · no buffer) — 2026-08-05

**Canonical report:** `temp/reports/jee-advanced-gemini-paper-cost-report.md`  
**Regenerate:** `node scripts/report-jee-advanced-gemini-paper-cost.mjs`

### Wallet calibration (real)

| Item | Value |
|------|------:|
| Credit added | ₹2,000 |
| Remaining after runs | ₹950 |
| **Spent** | **₹1,050** |
| Successful Qs | **24** hard Maths non-single (4 × 6) |
| **Accurate unit** | **₹43.75 / hard non-single Q** |
| Wall time (4 runs) | ~42 min (~105 s/Q) |
| Writer | `gemini-3.5-flash` |

Baseline folders: `temp/jee-advanced-hard-6-nonsingle-maths/2026-08-04_*`  
Pattern: multi 3 + integer 2 + match 1 per run (no singles, no Phy/Chem, hard only).

### Full paper Gemini estimate (accurate only)

Pattern from `jee_advanced/jee_advanced_pattern_totals.json`: 17/subject/paper → **51/paper**, **102 total**.

| Scope | Accurate Gemini ₹ | Est. wall |
|-------|------------------:|----------:|
| Hard non-single unit | **₹43.75** | ~105 s |
| One paper (51 Q, mixed E/M/H) | **₹1,392** | ~0.93 h |
| **Full dual paper (102 Q, mixed)** | **₹2,783** | **~1.86 h** |
| Full dual paper (102 Q, all-hard) | **₹3,693** | ~2.47 h |
| Avg ₹/Q mixed | **₹27.3** | |
| Avg ₹/Q all-hard | **₹36.2** | |

**Per subject one paper (mixed):** Physics ~₹464 · Chemistry ~₹439 · Maths ~₹488.

**Hard type rates (Maths):** multi ~₹56.4 · integer ~₹23.2 · match ~₹46.8 · single (est.) ~₹38.1.

### Credit check

| Goal | Need | Have (₹950) | Shortfall |
|------|-----:|------------:|----------:|
| Mixed 102 | ₹2,783 | ₹950 | ₹1,833 |
| All-hard 102 | ₹3,693 | ₹950 | ₹2,743 |
| ₹950 alone | | | ~**21** hard non-single Qs |

### Notes

- Figures are **wallet-calibrated** and **do not** include abort/kill buffers.
- **OpenAI dual-lock cost is separate** (and was exhausted independently).
- Tokens remain estimates until `usageMetadata` is logged on Gemini calls.
- Do **not** use `temp/reports/jee-advanced-gemini-cost-WITH-BUFFER.md` for planning (deprecated).
