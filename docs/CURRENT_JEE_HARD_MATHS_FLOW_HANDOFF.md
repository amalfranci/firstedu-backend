# JEE Main Hard Mathematics — Current Implementation Handoff

**Audience:** Developers taking over or pairing on the hard-maths generation work.  
**Status:** Lean Stage A script is working well in practice (almost production-quality dual-verified hard MCQs).  
**Last updated:** 2026-08-03  
**Primary script:** `scripts/generate-jee-hard-curated-maths-questions-only.mjs`  
**Golden paper-quality reference run:** `temp/jee-main-hard-10-curated-maths-questions-only/2026-08-01_11-25-30`  
**Earlier lock probe:** `temp/jee-main-hard-10-curated-maths-questions-only/2026-08-01_08-16-14`

---

## 1. What this system does (one paragraph)

We generate **JEE Main–level hard single-correct Mathematics MCQs** with a **solve-first** pipeline:

1. **Plan** multi-concept hard slots (chapter-locked).
2. **Ground** writers/solvers on **NCERT Class 11/12** formulas and hard archetypes (file-backed).
3. **Generate** question skeletons with **Gemini** (default hard model: `gemini-3.5-flash`).
4. **Lock answers** with **two independent OpenAI solvers** (default `o4-mini` + `o3-mini`); only dual-agree (or stage-A locked) items are kept.
5. **Fill** until the requested count (multiple generation rounds).
6. Write artifacts under `temp/jee-main-hard-<N>-curated-maths-questions-only/<timestamp>/`.

This is **not** pure free-form LLM generation: topics, hardness, methods, and answer keys are constrained by planners, NCERT reference, difficulty audits, and dual-solver verification.

---

## 2. Two scripts — which one is “current”

| Script | Purpose | Stage B (full finalize / eval / regen)? |
|--------|---------|----------------------------------------|
| **`generate-jee-hard-curated-maths-questions-only.mjs`** | **Primary / current “working almost proper” path** — Lean Stage A only | **No** (`deferValidation=true`) |
| `generate-jee-hard-curated-maths.mjs` | Full production-style pipeline (plan → gen → audits → verify → eval → targeted regen) | **Yes** |

**Recommendation for handoff:** start with the **questions-only** script. It produces the best dual-verified hard items with less noise. Stage B (full eval/regen) is deferred until Stage A quality is stable.

---

## 3. High-level flow (Lean Stage A)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  CLI: generate-jee-hard-curated-maths-questions-only.mjs                 │
│  --count=10  [--all-units]  [--provider=gemini]  [--gemini-model=…]    │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Phase 0 — MongoDB connect                                               │
│  · Needed for archetype-history + (optional) corpus RAG paths in core   │
│  · Loads NCERT reference JSON from disk                                 │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Phase 1 — Topic / slot plan                                             │
│  planQuestionBankTopics()  [aiQuestion.service.js]                       │
│  · Chapter lock: curated-5 (default) or all 14 units (--all-units)      │
│  · adminExcludeTopics = all other official JEE Main Maths units         │
│  · AI archetype planner → multi_concept slots + blueprints              │
│  · NCERT hard_archetypes / banned_easy_templates injected into plan     │
│  · Force multi-heavy: AI_QB_FORCE_ALL_MULTI=1                           │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Phase 2 — Generate + dual answer lock (fill loop)                       │
│  generateQuestionBankSuggestions({                                      │
│      generationMode: "default",                                         │
│      deferValidation: true,                                             │
│      presetSteering: <plan from Phase 1>,                               │
│  })                                                                     │
│                                                                          │
│  Internal (per batch / chunk):                                           │
│    A. Concept / blueprint steering (preset or planner)                   │
│    B. NCERT writer block in solve-first skeleton prompt                  │
│    C. Gemini hard model → solve-first skeletons                          │
│    D. Optional CAS skeleton check (SymPy path when archetype known)      │
│    E. Hard mandate + skeleton difficulty self-audit                      │
│    F. Build MCQ (stem, options, provisional key, steps)                  │
│    G. Stage A answer lock:                                               │
│         · Primary solver  (OPENAI_SOLVER_MODEL, default o4-mini)         │
│         · Secondary solver (OPENAI_SOLVER_MODEL_B, default o3-mini)      │
│         · Dual agree required → drop otherwise                           │
│    H. Script fill loop: replan + regenerate until count or fill-rounds  │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Save artifacts                                                          │
│  temp/jee-main-hard-<count>-curated-maths-questions-only/<timestamp>/  │
│    questions.json · questions.txt · topic-plan.json                      │
│    summary.json · transcript.txt · phases.jsonl                          │
│  Post-process: attachChapterLabels() (content-based chapter fix-up)      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Topics / chapters (what is locked)

### 4.1 Official syllabus source

- Service: `src/services/jeeMainOfficialSyllabus.service.js`
- Data: `files/jee-main-syllabus/jee-main-2026-official.json` (14 Mathematics units)

### 4.2 Default “golden” curated-5 (what works best)

Used when **not** passing `--all-units`:

1. **Co-ordinate Geometry**
2. **Limit, Continuity and Differentiability**
3. **Integral Calculus**
4. **Matrices and Determinants**
5. **Differential Equations**

These five are the **GOLDEN STAGE** lock (paper-quality reference `2026-08-01_11-25-30`). Dual-lock accuracy is highest on multi-step calculus / coord-geo / LCD / DE style items. The questions-only script forces `AI_QB_CURATED_MATH_SLOTS_ONLY=1` so failed slots do not swap into probability fluff.

### 4.3 Full 14 units (`--all-units`)

All official units, including Sets, Complex Numbers, P&C, Binomial, Sequence & Series, 3D Geometry, Vector Algebra, Statistics & Probability, Trigonometry, etc.

Topic string examples:

```text
# curated-5
Competitive › Engineering › JEE Mains › Mathematics · Curated hard chapters: Co-ordinate Geometry, Limit, Continuity and Differentiability, Integral Calculus, Matrices and Determinants, Differential Equations

# all-units
Competitive › Engineering › JEE Mains › Mathematics · Concentrated hard (all units): …
```

### 4.4 How chapter lock is enforced

1. **Planner input:** `adminExcludeTopics` = every official unit **not** in the target list.
2. **Env:** `AI_QB_CURATED_MATH_SLOTS_ONLY=1` — prevents archetype-swap into off-lock chapters (e.g. probability fluff) when a slot fails difficulty audit.
3. **Post-process:** `attachChapterLabels()` / `inferChapterFromContent()` re-tags chapter from stem + concept slot (fixes sticky wrong tags).

### 4.5 Example planned slots (from a real run)

From `topic-plan.json` (hard / multi_concept):

| conceptSlot | label |
|-------------|--------|
| `area_bounded_curves` | Area between two curves |
| `trig_limits` | Limit involving trigonometric functions |
| `maxima_minima_functions` | Optimization with constraints |
| `differential_equation_application` | Modeling with DEs |
| `matrix_determinant_consistency` | Consistency of linear systems |
| `circle_line_intersection` | Line–circle intersection |

Kind mix under force-multi: **~100% multi_concept** for this script.

---

## 5. NCERT grounding (not the same as “RAG”, but critical)

**File:** `files/ncert-reference/mathematics/jee-ncert-chapter-reference.json`  
**Service:** `src/services/ncertChapterReference.service.js`

Per chapter the file holds roughly:

- `concepts`, `formulas`, `standard_results`, `allowed_methods`
- `common_traps` (distractor design)
- `hard_archetypes`, `hard_techniques`, `banned_easy_templates`
- out-of-scope methods (e.g. L’Hôpital) that must not be required

**Injected in two places:**

| Function | Used for |
|----------|----------|
| `buildNcertHardArchetypePlanBlock()` | Planner — prefer hard archetypes, ban easy templates |
| `buildNcertChapterReferenceBlock()` | Writer (solve-first skeleton) — formulas + methods |
| `buildNcertSolverReferenceBlock()` | Independent solvers — same formula lock when re-deriving |

**Design intent:** hardness = multi-concept fusion + multi-stage algebra **inside NCERT methods**, not college-level tricks.

---

## 6. How RAG works in this codebase

There are **several “retrieval” paths**. The lean script intentionally turns some **off**.

### 6.1 Question-corpus RAG (style / pattern exemplars)

**Service:** `src/services/questionCorpusRag.service.js`  
**Core API:** `retrieveSimilarConfirmedQuestions()`

**Purpose:** Retrieve **similar previously confirmed / banked questions** as **style and pattern exemplars** for the generation prompt.  
**Not** a topic source — topics still come from the AI planner + official syllabus + NCERT.

**Pipeline:**

1. Find matching `AiQuestionBank` documents by topic/bank name (normalized prefix match; JEE Main profile fallback).
2. Load candidate `AiQuestion` rows (active, single-type, preferably non-empty explanation).
3. Optional **section hard-filter** (Mathematics vs Physics vs Chemistry) — fail-closed by default so Maths gen does not pull Chem exemplars.
4. Optional difficulty tier filter when enough hard candidates exist.
5. Embed candidates (Gemini embeddings + `QuestionEmbeddingCache`).
6. Embed query text: `topic + subject + section + conceptHints`.
7. Rank by **cosine similarity**, take top-K (default K ≈ 8).
8. Format either:
   - full stem/options/key, or  
   - **metadata-only** (`AI_QB_RAG_METADATA_ONLY=1`) — concept, difficulty, solving length, distractor pattern, stem texture.
9. Inject as `retrievedQuestionContextBlock` into generation.
10. After generate: **near-copy reject** if embedding similarity ≥ `RAG_COPY_THRESHOLD` (default **0.93**).

**Strict mode (`generationMode: "question_rag"`):**  
If retrieval misses, generation **aborts** (no silent ungrounded fallback).

**Default / lean script mode (`generationMode: "default"`):**  
Corpus RAG may still run when the job path requests it, but the questions-only script does **not** require RAG hits to proceed. Difficulty-calibration RAG is explicitly disabled (below).

### 6.2 Difficulty-calibration RAG (OFF in lean script)

**Service:** `difficultyCalibration.service.js` → wraps `retrieveSimilarConfirmedQuestions` for easy/medium/hard exemplars.

Lean script sets:

```text
AI_QB_DIFFICULTY_CALIBRATION=0
```

Reason: for hard maths this almost always logged `DIFFICULTY_CALIBRATION_MISS` and wasted Mongo/embed work without improving dual-verified yield.

### 6.3 Exam web-research brief (OFF in lean script)

```text
EXAM_REFERENCE_RESEARCH_ENABLED=0
```

Reason: research path hit broken/404 model responses; static fallback was noise.

### 6.4 What the lean script relies on instead of RAG

| Grounding | Role |
|-----------|------|
| Official JEE syllabus units | Chapter lock / exclude list |
| NCERT chapter reference JSON | Formulas, methods, hard archetypes |
| Archetype planner + history | Diverse multi-concept slots |
| Dual independent solvers | Answer correctness |
| Difficulty self-audit | Hardness bar (~80+) |

### 6.5 Seeding corpus RAG (when you want full RAG later)

Related scripts:

- `scripts/seed-jee-main-rag-from-question-papers.mjs`
- `scripts/ingest-jee-mains-reference-papers.mjs`
- Past papers under `question paper with explanation/` and `files/jee-mains/`

Confirmed questions also accumulate via admin “log confirmed questions” → Mongo `AiQuestion` / banks, which become RAG candidates.

---

## 7. Generation path inside `aiQuestion.service.js` (default mode)

For each chunk / batch of singles:

| Step | What happens | Key modules |
|------|----------------|-------------|
| 1. Difficulty resolution | Exam context → often **hard / examCalibrated** | `examGenerationDifficulty.service.js` |
| 2. Archetype / slot plan | AI plans unique slots + blueprints; history avoids repeats | `conceptArchetypePlanner.service.js`, `archetypeHistory.service.js` |
| 3. Blueprint enrich | Phase C blueprint metadata | `questionBlueprint.service.js` |
| 4. (Optional) calibration RAG | Exemplars by difficulty | **OFF** in lean script |
| 5. Solve-first skeletons | LLM solves first, emits structured skeleton | `questionSolveFirst.service.js` |
| 6. CAS verify (when archetype known) | SymPy sidecar for some math archetypes | `skeletonCasVerification.service.js`, `scripts/verify_answer.py` |
| 7. Difficulty self-audit | LLM scores skeleton 0–100; reject weak | `difficultySelfAudit.service.js` |
| 8. Hard mandate | Multi-concept / exam hardness rules | `hardQuestionMandate.service.js` |
| 9. MCQ build | Options, key, explanation from skeleton | solve-first build path |
| 10. Stage A answer lock | Dual solvers re-solve stem; lock key | `runStageAAnswerLock`, `solverTruth.service.js`, `answerCorrection.service.js` |
| 11. Finalize / eval | Full quality + OpenAI validation | **SKIPPED** when `deferValidation=true` |

**Generation modes (for context):**

| `generationMode` | Behavior |
|------------------|----------|
| `default` | Solve-first + topic planner (**this script**) |
| `prompt_first` | One-shot exam-setter prompt (no slot machinery) |
| `paper_reference` | Past-paper text for **difficulty floor only** (not topic source) |
| `question_rag` | Require corpus RAG hit; abort on miss |

---

## 8. Stage A dual-solver answer lock (correctness)

Controlled by the lean script env:

```text
AI_QB_STAGE_A_ANSWER_LOCK=1
AI_QB_STRICT_ANSWER_CORRECTNESS=1
AI_QB_DOUBLE_SOLVE=1
AI_QB_REQUIRE_DOUBLE_SOLVE=1
AI_QB_STAGE_A_REQUIRE_DOUBLE_AGREE=1
AI_QB_STAGE_A_DROP_UNVERIFIED=1
AI_QB_SOLVER_TRUTH=1
AI_QB_BLIND_SOLVER=1
OPENAI_SOLVER_MODEL=o4-mini          # primary
OPENAI_SOLVER_MODEL_B=o3-mini        # secondary
```

**Behavior:**

1. After MCQs are built, strip reliance on the generator’s claimed key.
2. Run **independent** solve (blind to generator answer when blind solver on).
3. Run **second** model; require **agreement**.
4. On agree → stamp `_stageAAnswerLocked`, `_doubleSolverAgree`, `_answerCorrectnessGuaranteed` (flags vary by path).
5. On disagree / fail → **drop** item (fill loop requests more).

**Why this matters:** Gemini is strong at writing multi-step hard stems but weak at guaranteeing arithmetic. Dual o-series re-derivation is the accuracy gate that made Stage A “almost proper.”

---

## 9. Fill loop (script-level)

Strict dual-lock often yields **fewer** than requested questions per batch.

Script behavior:

- Up to **`FILL_ROUNDS`** (default **6**).
- Each round asks for **need + headroom** (e.g. need 3 → request 5).
- After round 1, **re-plans** slots for diversity.
- Dedupes by normalized stem prefix.
- Only accepts items with lock flags (`_answerCorrectnessGuaranteed` / `_doubleSolverAgree` / `_stageAAnswerLocked` / `_solverTruthApplied`).
- Retries whole generation call on transient Gemini timeouts (default max retries **3**).

**Reality check from recent runs:** e.g. requested 10, produced **6** dual-locked after fill (quality over filler). That is expected under strict dual-agree.

---

## 10. Archetype history

**Service:** `archetypeHistory.service.js`  
**Dir:** `temp/archetype-history/*.json`

Persists used concept-slot / archetype IDs per bank section so later plans avoid repeating the same patterns.  
File names are slugified from bank name + section, e.g.:

```text
competitive_engineering_jee_mains_mathematics_curated_hard_chapters_…__default.json
```

---

## 11. What is ON vs OFF in the lean script

### ON (keep — these produce good dual-verified hard items)

- Multi-concept topic plan + chapter lock  
- NCERT hard reference (plan + write + solve)  
- Gemini hard skeleton gen (`gemini-3.5-flash` default for hard)  
- Hard mandate + difficulty self-audit (min ~80)  
- Dual independent solvers + drop unverified  
- Fill-to-count loop  
- Archetype history / curated-slots-only  
- Stage A answer lock  

### OFF (noise / always-miss / Stage B)

- Exam web-research brief  
- Difficulty-calibration RAG  
- Full finalize quality eval / multi-round regen  
- SymPy finalize strip path (Stage B)  
- Distractor LLM pass (optional; solvers rebuild options)  
- Explanation verifier in deferred path  

---

## 12. How to run

### Prerequisites

- Node + dependencies (`pnpm install` in `firstedu-backend`)
- `.env` with at least:
  - `MONGODB_URI`, `DB_NAME`
  - `GEMINI_API_KEY` (generation)
  - `OPENAI_API_KEY` (dual solvers)
- NCERT file present: `files/ncert-reference/mathematics/jee-ncert-chapter-reference.json`

### Commands

```bash
cd firstedu-backend

# Golden curated-5, 10 hard questions (lean Stage A)
node scripts/generate-jee-hard-curated-maths-questions-only.mjs --count=10

# Stronger hard model (if available on the account)
node scripts/generate-jee-hard-curated-maths-questions-only.mjs --count=10 --provider=gemini --gemini-model=gemini-3.5-flash

# All 14 units
node scripts/generate-jee-hard-curated-maths-questions-only.mjs --count=10 --all-units

# OpenAI as generation provider (if Gemini credits low)
node scripts/generate-jee-hard-curated-maths-questions-only.mjs --count=5 --provider=openai

# Keep provisional keys if solvers cannot lock (debug only — not for shipping)
node scripts/generate-jee-hard-curated-maths-questions-only.mjs --count=5 --keep-unverified
```

### Useful CLI flags

| Flag | Default | Meaning |
|------|---------|---------|
| `--count=N` | 10 | Target number of questions |
| `--all-units` | off | Use all 14 units instead of curated-5 |
| `--provider=` | gemini | Generation provider |
| `--gemini-model=` | gemini-3.5-flash | Hard generation model |
| `--verify-model=` | o4-mini | Primary solver |
| `--verify-model-b=` | o3-mini | Secondary solver |
| `--fill-rounds=` | 6 | Max fill loops |
| `--max-retries=` | 3 | Retries per generation call |
| `--min-difficulty=` | 80 | Skeleton difficulty self-audit floor |
| `--strict-correct=0` | on | Disable dual-agree strictness |
| `--keep-unverified` | off | Do not drop unlocked keys |

### Full pipeline (Stage B) — secondary

```bash
node scripts/generate-jee-hard-curated-maths.mjs --count=10
```

Outputs extra `evaluation.json`, `chapter-audit.json`, etc., under `temp/jee-main-hard-<N>-curated-maths/`.

---

## 13. Output artifacts (lean script)

Directory pattern:

```text
temp/jee-main-hard-<count>-curated-maths-questions-only/<YYYY-MM-DD_HH-mm-ss>/
```

| File | Contents |
|------|----------|
| `questions.json` | Full question objects + lock/blueprint metadata |
| `questions.txt` | Human-readable stems, options, correct, explanation |
| `topic-plan.json` | Planner slots, kind ratio, blueprints |
| `summary.json` | Stage flags, models, counts, chapters, ON/OFF steps |
| `transcript.txt` | Human phase log |
| `phases.jsonl` | Machine-readable phase events |

**Question flags to look for:**

- `_doubleSolverAgree` / `_answerCorrectnessGuaranteed` → dual-verified shippable key  
- `_stageAAnswerLocked` / `_solverTruthApplied` → stage-A locked  
- `_answerProvisional` → not locked (should be rare under strict drop)  
- `_conceptSlot`, `chapter` / `chapterLabel`, `_blueprint` → topic metadata  

---

## 14. Key files map

| Area | Path |
|------|------|
| **Lean CLI (current)** | `scripts/generate-jee-hard-curated-maths-questions-only.mjs` |
| Full CLI | `scripts/generate-jee-hard-curated-maths.mjs` |
| Generation orchestration | `src/services/aiQuestion.service.js` |
| Solve-first | `src/services/questionSolveFirst.service.js` |
| Archetype planner | `src/services/conceptArchetypePlanner.service.js` |
| Archetype guidance catalog | `src/services/conceptArchetypeGuidance.service.js` |
| Archetype history | `src/services/archetypeHistory.service.js` |
| NCERT reference | `src/services/ncertChapterReference.service.js` |
| Official syllabus | `src/services/jeeMainOfficialSyllabus.service.js` |
| Question corpus RAG | `src/services/questionCorpusRag.service.js` |
| Difficulty calibration RAG | `src/services/difficultyCalibration.service.js` |
| Stage A lock / solver truth | `aiQuestion.service.js` (`runStageAAnswerLock`), `solverTruth.service.js` |
| Hard mandate | `src/services/hardQuestionMandate.service.js` |
| CAS / SymPy | `skeletonCasVerification.service.js`, `scripts/verify_answer.py` |
| Embeddings | `embedding.service.js`, `geminiEmbeddingModels.js` |
| NCERT data | `files/ncert-reference/mathematics/jee-ncert-chapter-reference.json` |
| Syllabus data | `files/jee-main-syllabus/jee-main-2026-official.json` |
| Older full pipeline doc | `docs/AI_QUESTION_BANK_GENERATION_EVALUATION_FLOW.txt` |
| Phase C status | `IMPLEMENTATION_STATUS.md` |

---

## 15. Environment variables cheat sheet (lean defaults set by script)

| Variable | Lean default | Notes |
|----------|--------------|-------|
| `GEMINI_HARD_TEXT_MODEL` | gemini-3.5-flash | Hard generation |
| `GEMINI_REQUEST_TIMEOUT_MS` | 120000 | Hard skeletons can be long |
| `GEMINI_QB_MAX_ATTEMPTS` | 3 | |
| `EXAM_REFERENCE_RESEARCH_ENABLED` | 0 | OFF |
| `AI_QB_DIFFICULTY_CALIBRATION` | 0 | OFF |
| `AI_QB_DEFER_VALIDATION` | 1 | Stage A only |
| `AI_QB_DISTRACTOR_PASS` | 0 | OFF (preserve clean exam options) |
| `AI_QB_CURATED_MATH_SLOTS_ONLY` | 1 | No off-lock swap (script forces for curated-5) |
| `AI_QB_STAGE_A_ANSWER_LOCK` | 1 | ON |
| `AI_QB_STAGE_A_DROP_UNVERIFIED` | 1 | ON |
| `AI_QB_STRICT_ANSWER_CORRECTNESS` | 1 | Dual agree |
| `AI_QB_DOUBLE_SOLVE` / `REQUIRE` | 1 | |
| `AI_QB_FORCE_ALL_MULTI` | 1 | 100% multi_concept plan |
| `AI_QB_HARD_MULTI_HEAVY` | 1 | |
| `AI_QB_DIFFICULTY_SELF_AUDIT` | 1 | |
| `AI_QB_SKELETON_DIFFICULTY_SELF_AUDIT_MIN` | 80 | |
| `AI_QB_SKELETON_SELF_AUDIT_LAST_ATTEMPT_FLOOR` | 72 | Was 55 — raised to stop weak dump |
| `AI_QB_SKELETON_SELF_AUDIT_RELAXED_FLOOR` | 72 | |
| `AI_QB_VETERAN_DIFFICULTY` | 1 | |
| `OPENAI_SOLVER_MODEL` | o4-mini | Primary |
| `OPENAI_SOLVER_MODEL_B` | o3-mini | Must differ from primary |
| `OPENAI_SOLVER_TIMEOUT_MS` | 60000 | |

---

## 16. How this relates to the admin UI pipeline

The **same core** (`generateQuestionBankSuggestions`, `planQuestionBankTopics`) powers:

- Admin UI: `POST /admin/ai/generate-question-bank-suggestions` (async job + poll)
- These CLI scripts (direct service import, no HTTP)

Differences for the lean CLI:

- Forces curated chapter topic string + exclude list  
- Sets lean env before import side effects  
- Always `deferValidation: true`  
- Implements its own fill/retry/artifact logging  

Full UI/API map remains in:

- `docs/AI_QUESTION_BANK_GENERATION_EVALUATION_FLOW.txt`
- `docs/AI_EVALUATION_FLOW_SUMMARY.txt`

---

## 17. Known behavior / expectations for the next developer

1. **Yield &lt; request is normal** under dual-agree + hard multi-concept (e.g. 6/10). Prefer fewer correct hard items over filler.
2. **Do not re-enable difficulty-calibration RAG** for this path unless hard exemplars exist in Mongo for the topic; it currently mostly MISS.
3. **Chapter tags can drift** from the planner; always trust `attachChapterLabels` / content inference when auditing.
4. **Model choice:** generation = Gemini hard tier; verification = OpenAI o-series dual. Do not use the generator as the sole correctness authority.
5. **Golden chapters** (5) outperform full-14 for dual-lock accuracy on current models; expand units only after curated-5 is solid.
6. **Stage B** (eval + targeted regen) is the next layer after Stage A yield/quality is accepted — use the full script, not by re-enabling half of Stage B env flags blindly.
7. **Costs:** dual o4-mini/o3-mini per question + Gemini skeleton + optional plan LLM = expensive; use small `--count` when iterating.

---

## 18. Suggested next steps (optional roadmap)

1. Stabilize curated-5 dual-lock yield (raise fill rounds / headroom, not lower correctness).  
2. Expand CAS archetypes so more skeletons get deterministic SymPy checks before LLM solvers.  
3. Seed / confirm a Maths hard corpus → re-enable corpus RAG or calibration RAG with real hits.  
4. Wire Stage B eval only on dual-locked items.  
5. Promote best questions into Mongo banks so RAG has high-quality exemplars for the admin UI.

---

## 19. Quick mental model

```text
TOPICS     = official syllabus ∩ (curated-5 | all-14)  +  AI multi-concept plan
HARDNESS   = NCERT hard_archetypes + multi-concept fusion + difficulty audit
METHODS    = NCERT formulas/methods only (file-backed)
STYLE RAG  = optional past AiQuestion exemplars (OFF calibration path in lean)
ANSWERS    = dual independent OpenAI solvers must agree, else DROP
SHIP       = fill until N dual-locked MCQs (or partial under fill-round cap)
```

---

*This document describes the implementation as of the lean Stage A script and supporting services in `firstedu-backend`. For the broader multi-exam / evaluation / regeneration system, also read `docs/AI_QUESTION_BANK_GENERATION_EVALUATION_FLOW.txt`.*
