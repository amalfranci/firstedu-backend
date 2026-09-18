# AI Paper Generation — Current Implementation & Job Analysis

**Date:** 2026-09-18  
**Report file:** `analysis-report/2026-09-18-apt-c505ce5b-current-worker-implementation.md`  
**Job analyzed:** `apt-c505ce5b-8379-4f41-92ac-eee74d6f5ce7`  
**Subject / exam (this run):** JEE Advanced · Chemistry · 5 questions requested  
**Artifacts:** `temp/paper-jobs/apt-c505ce5b-8379-4f41-92ac-eee74d6f5ce7/`  
**Confirmed export:** `temp/confirmed-questions/2026-09-18/00-17-18-09-26-competitive-engineering-jee-advance-paper-1-chemistry-all.txt`

---

## 1. Executive summary

| Item | Value |
|------|--------|
| Architecture | **Current** parallel pipeline + **worker** runner |
| `PAPER_JOB_RUNNER` | **`worker`** (production default) |
| Job status | **completed** |
| Expected | **5** |
| Production-ready locked | **3** |
| Final mix | single **3** · multiple **0** · integer **0** · match **0** |
| Wall clock | **~4.1 min** (18:43:25 → 18:47:32 UTC) |
| Runner | Dedicated `pnpm run worker:paper` process |

**This is not the old sequential Luna-per-question flow.**  
This job exercised the **current** system end-to-end:

```text
Frontend → POST /questions → generationId (HTTP returns immediately)
                ↓
         paper-worker claims job
                ↓
   plan → parallel Gemini → code validation → parallel o3
        → parallel expand → ONE Luna paper audit
```

Earlier report (`2026-09-17-apt-76d73a9c-…`) analyzed a Physics job that still used **per-question Luna verify** and **`PAPER_JOB_RUNNER=inline`**. Treat that as historical.

---

## 2. Current implementation (as of 2026-09-18)

### 2.1 Process split (the important change)

```text
Terminal A                         Terminal B
──────────                         ──────────
pnpm run dev                       pnpm run worker:paper
(API / Express / cron)             (claims pending apt-* jobs)

Frontend
   │
   ▼
POST /admin/ai-powered-test/questions
   │  body: { config: { typeCounts, totalQuestions, … } }
   │  creates generationId = jobId = apt-<uuid>
   │  status = pending/queued
   │  persists AiPaperGenerationJob in Mongo + disk
   ▼
HTTP 202  { generationId, status: "queued", totalQuestions, … }
   │
   │  (browser polls GET …/questions/jobs/:id
   │   or GET …/questions/:generationId/status)
   │
   ▼
paper-worker
   claim → executePaperJob → runAdvancedPaperPipeline
                          → runParallelPaperPipeline
```

| If you run… | What happens |
|-------------|--------------|
| API only | Job stays **`queued`** forever |
| API + worker | Worker logs `start apt-…` → phases advance → UI shows `N / total` |

Legacy AiSuggestionModal (flat body without paper `config.typeCounts`) still uses the old question-bank suggestions path on the same `POST /questions` route (dispatcher).

### 2.2 Pipeline phases (current code)

```text
Phase 0 — PLAN
  planPipelineSlots()
  · subjects / type seats / chapter_lock + concept preference

Phase A — PARALLEL GENERATE + CODE VALIDATION
  · Gemini (JEE_ADV_GENERATE_CONCURRENCY = 6)
  · Deterministic checks: JSON / type / options / answer letters /
    correctIndex / duplicates / LaTeX balance
  · Invalid → repair from unused chapter pool
  · Infra timeout on Gemini → retry SAME seat (JEE_ADV_VERIFY_TIMEOUT_RETRIES)

Phase B — PARALLEL o3 VERIFY (compact JSON)
  · PAPER_SOLVER_MODEL = o3
  · Independent re-solve; does not rewrite explanation
  · Gates: answerMatches + calculationCorrect + questionValid
  · Timeout/network → retry SAME seat; quality FAIL → regenerate seat

Phase C — PARALLEL EXPAND (if explanation thin)
  · Gemini expand with locked key (concurrency 4)

Phase D — ONE Luna PAPER-LEVEL AUDIT
  · OPENAI_VERIFY_MODEL = gpt-5.6-luna
  · Single call for whole paper
  · productionReady only if per-question critical gates pass
  · Luna timeout ≠ drop all questions (keep stems, mark needs-review)
```

### 2.3 Failure taxonomy (current)

| Reason | Meaning | Action |
|--------|---------|--------|
| `generate_timeout` / infra Gemini | Network / timeout | Retry **same** seat |
| `code_validation_fail` | Structural / format | Regenerate / unused seat |
| `o3_timeout` | o3 infra after retries | Regenerate seat |
| `o3_fail` / `o3_uncertain` | Quality fail | Regenerate seat |
| `o3_solve_error` | Empty / hard API error | Regenerate seat |
| `luna_paper_fail` | Paper audit rejected item | Drop from production-ready set |
| Luna paper **timeout** | Infra | Do **not** treat as bad math; keep + needsReview |

### 2.4 Persistence / reconnect

| Layer | What |
|-------|------|
| Disk job | `temp/generation-jobs/apt-….json` (API + worker share) |
| Disk artifacts | `temp/paper-jobs/apt-…/pipeline.jsonl`, `questions/*.json`, `generated-paper.json`, `tokens.json` |
| Mongo job | `ai_paper_generation_jobs` — `generationId`, progress counters, status, config |
| Mongo questions | `ai_paper_generation_questions` — seq, stage/status, questionData, verificationData |
| Frontend draft | Stores `generationId`; refresh resumes poll of **same** id |

### 2.5 Env knobs (this machine / `.env`)

| Key | Value used |
|-----|------------|
| `PAPER_JOB_RUNNER` | **`worker`** |
| `JEE_ADV_GENERATE_CONCURRENCY` | 6 |
| `JEE_ADV_O3_CONCURRENCY` | 6 |
| `JEE_ADV_EXPAND_CONCURRENCY` | 4 |
| `PAPER_SOLVER_MODEL` | `o3` |
| `PAPER_SOLVER_TIMEOUT_MS` | 120000 |
| `OPENAI_VERIFY_MODEL` | `gpt-5.6-luna` |
| `OPENAI_VERIFY_TIMEOUT_MS` | 180000 |
| `JEE_ADV_VERIFY_TIMEOUT_RETRIES` | **2** |
| `JEE_ADV_FILL_ROUNDS` | 4 |
| `AI_QB_GENERATION_JOB_TTL_MS` | 21600000 (6h active paper jobs) |
| `GEMINI_HARD_TEXT_MODEL` | `gemini-3.5-flash` |

### 2.6 Stage names (per question)

| Stage | Meaning |
|-------|---------|
| `queued` | Seat reserved |
| `generating` / `generated` | Gemini writer |
| `code_validating` / `code_valid` | Deterministic structural checks |
| `validating` / `verified` | o3 math lock |
| `expanding` / `expanded` | Explanation fill |
| `ready_to_confirm` | Kept after Luna paper PASS |
| `dropped` / `failed` | Not kept; `failureReason` stored |

Checkpoint path on a success (this job):  
`generating → generated → code_validating → code_valid → validating → verified → expanding → expanded → ready_to_confirm`

---

## 3. This job — what was requested

| Field | Value |
|-------|--------|
| `generationId` / `jobId` | `apt-c505ce5b-8379-4f41-92ac-eee74d6f5ce7` |
| Exam | JEE Advanced · Paper 1 |
| Subject | **Chemistry** (5) |
| Requested type mix | single 1 · multiple 2 · integer 1 · match 1 |
| Difficulty | hard |
| Mode (plan log) | `parallel_o3_luna_paper` |
| Runner | **worker** |

Initial chapter allocation (plan):

| Topic | Chapter | Cluster |
|-------|---------|---------|
| C21 | Basic Principles of Organic Chemistry | organic |
| C05 | Chemical Thermodynamics | physical |
| C15 | p-Block Elements | inorganic |
| C04 | Chemical Bonding and Molecular Structure | physical |
| C07 | Electrochemistry | physical |

---

## 4. Timeline (from `pipeline.jsonl`)

| UTC time | Phase | Message |
|----------|-------|---------|
| 18:43:25 | JOB_START | worker + env snapshot |
| 18:43:26 | plan | Phase 1 — slot plan (5 Q) |
| 18:43:26 | generate | Parallel generate ×5 (concurrency=6) |
| 18:44:56 | code_valid | Code-valid **5/5** (after early repairs) |
| 18:44:56 | o3_verify | Parallel o3 verify ×5 (concurrency=6) |
| 18:46:12 | o3_done | o3 passed 5/5 |
| 18:46:12 | expand | Parallel expand ×5 |
| 18:46:31 | luna_paper_audit | Luna paper-level audit ×5 (single call) |
| 18:47:32 | done | Paper needs review — **3/5** production-ready |
| 18:47:32 | JOB_DONE | completed |

**Duration:** ~246 s (~4.1 minutes) for a 5-seat Chemistry paper.

### Event counts

| Event | Count |
|-------|------:|
| QUESTION_START | 8 |
| GENERATE_BATCH | 8 |
| GEMINI_REQUEST / RESPONSE | 13 each |
| OPENAI_SOLVE_REQUEST | 6 |
| OPENAI_SOLVE_RESPONSE | 5 |
| OPENAI_SOLVE_ERROR | 1 |
| QUESTION_FAILED | 5 |
| OPENAI_VERIFY_REQUEST / RESPONSE | 1 each (paper audit) |
| LUNA_PAPER_AUDIT_RESULT | 1 |
| INFRA_RETRY | 0 (no timeout retries needed this run) |
| JOB_DONE | 1 |

---

## 5. Seat-by-seat outcome

| Seq | Topic | Chapter | Type | Final | Reason |
|----:|-------|---------|------|-------|--------|
| 01 | C21 | Basic Principles of Organic Chemistry | single | **dropped** | `luna_paper_fail` — chemically invalid stem (no C1–H on bridgehead) |
| 02 | C05 | Chemical Thermodynamics | multiple | **dropped** | `code_validation_fail` — `multiple_no_correct_letters` |
| 03 | C15 | p-Block Elements | multiple | **dropped** | `code_validation_fail` — `multiple_no_correct_letters` |
| 04 | C04 | Chemical Bonding and Molecular Structure | integer | **dropped** | `luna_paper_fail` — explanation completeness / audit fail |
| 05 | C07 | Electrochemistry | match | **dropped** | `o3_solve_error` — `OpenAI returned empty response` (~39s, not a timeout) |
| 06 | C01 | General Topics | single | **ready_to_confirm** | Repair / fill seat — **PASS** |
| 07 | C02 | States of Matter: Gases and Liquids | single | **ready_to_confirm** | Repair / fill seat — **PASS** |
| 08 | C03 | Atomic Structure | single | **ready_to_confirm** | Repair / fill seat — **PASS** |

**Net:** requested mix (1+2+1+1) collapsed to **3 singles** after code/o3/Luna filtering + unused-pool repairs. Job still marked **completed** with `counts.total=3`, `expected=5`.

---

## 6. Dropped questions — detailed reasons

### 6.1 Code validation (early) — seq 02, 03

| Seq | Type | Chapter | `failureReason` | Detail |
|----:|------|---------|-----------------|--------|
| 02 | multiple | Chemical Thermodynamics | `code_validation_fail` | `multiple_no_correct_letters` |
| 03 | multiple | p-Block Elements | `code_validation_fail` | `multiple_no_correct_letters` |

Gemini returned multi-correct items without parseable correct-letter sets. Deterministic validator rejected them **before** o3. System repaired from unused pool (hence 8 QUESTION_START for 5 seats).

### 6.2 o3 empty response — seq 05

| Field | Value |
|-------|--------|
| Topic | C07 Electrochemistry |
| Type | match |
| `failureReason` | `o3_solve_error` |
| Detail | `OpenAI returned empty response` |
| Elapsed | ~39 s (timeout was 120 s — **not** a timeout) |

Classified as quality/API failure → seat replaced. Infra retry path did not fire (`INFRA_RETRY=0`).

### 6.3 Luna paper audit — seq 01, 04

Paper-level result:

| Field | Value |
|-------|--------|
| `productionReady` | **false** |
| `needsReview` | **true** |
| Pass map | seq 1 ✗ · 4 ✗ · 6 ✓ · 7 ✓ · 8 ✓ |

**Seq 01 (Organic / C21)** — genuine chemical validity fail:

- Bridgehead C1 already fully substituted by methylsulfonyl → no C1–H.
- Ordering / species R undefined → `questionValid=false`, `answerCorrect=false`.

**Seq 04 (Bonding / C04)** — audit fail on explanation completeness gates (`explanationComplete=false`). Luna issues text also references \(\sqrt{27/8}\) Boyle/Berthelot algebra (same ratio as the surviving C02 question). Treat as **audit rejection of that seat**; possible Q-index/seq confusion in free-text `paperIssues`, while structured `passes[].seq` is authoritative for keep/drop.

**Important contrast with apt-76d73a9c:**  
That older Physics job dropped 3 seats solely on **`luna_verify_timeout`**.  
This Chemistry job’s Luna drops are **quality/validity**, not timeouts.

---

## 7. Successful locked questions (saved)

Trust badge on all three: **`O3+LUNA-PAPER`** · `_lockMode: o3(o3)+luna_paper` · `_productionReady: true`

| # | Seq | Topic | Chapter | Type | Key | Concept |
|---|----:|-------|---------|------|-----|---------|
| 1 | 06 | C01 | General Topics | single | **B** | sequential redox stoichiometry (oxalate mixture % KHC₂O₄) |
| 2 | 07 | C02 | States of Matter | single | **A** | Berthelot EOS → \(T_B/T_c=\sqrt{27/8}\) |
| 3 | 08 | C03 | Atomic Structure | single | **A** | (atomic / QM style stem in draft) |

Admin confirmed export written under `temp/confirmed-questions/2026-09-18/…chemistry-all.txt`.

---

## 8. Token usage (this job)

| Model | Calls | Prompt | Completion | Reasoning | Total |
|-------|------:|-------:|-----------:|----------:|------:|
| `gemini-3.5-flash` | 13 | 6 309 | 10 065 | 53 978 | 70 352 |
| `o3` | 5 | 2 249 | 11 155 | 10 880 | 13 404 |
| `gpt-5.6-luna` | 1 | 6 271 | 6 771 | 6 141 | 13 042 |
| **Sum** | **19** | **14 829** | **27 991** | **70 999** | **96 798** |

Gemini dominates token spend (generate + expand). Luna is one expensive paper call.

---

## 9. What the UI / API did (worker mode)

1. Start returned **`generationId = apt-c505ce5b-…`** immediately (`status: queued`).
2. Worker claimed job → `runner: worker` in job store.
3. Frontend polled job; progress fields: `totalQuestions=5`, `completedQuestions→3`, `failedQuestions=5` (includes mid-pipeline drops).
4. Final job store:
   - `status: completed`
   - `message: Done — 3 locked questions`
   - `counts: { single: 3, total: 3, expected: 5 }`
5. Refresh/reconnect can reload the same `generationId` from disk/Mongo without starting a new paper.

---

## 10. Comparison: previous report vs this report

| | apt-76d73a9c (2026-09-17 report) | apt-c505ce5b (this report) |
|--|----------------------------------|----------------------------|
| Runner | **inline** (documented default then) | **worker** |
| Verify path | Luna **per question** | o3 parallel + **one** Luna paper audit |
| Subject | Physics · 6 Q | Chemistry · 5 Q |
| Outcome | 6/6 locked | 3/5 production-ready |
| Main drop cause | **`luna_verify_timeout` ×3** | code_validation ×2, o3 empty ×1, **luna_paper_fail ×2** |
| Wall time | long / sequential Luna | **~4 min** parallel |

---

## 11. Implications / next work (unchanged roadmap)

### Already done (Phase 1–2)

- Worker default + immediate `generationId`
- DB + disk progress for reconnect
- Timeout → retry same seat; quality → regenerate
- Parallelism kept (6 / 6 / 4)

### Still open (Phase 3 — quality)

- Explicit Luna QC fields (`verdict`, `mathematical_correct`, `physical_correct`, `chapter_match`, `concept_match`, `difficulty_match`, `ambiguity`, `format_valid`, `derived_answer`, `confidence`, …)
- Stronger multi-correct letter emission (this run’s `multiple_no_correct_letters`)
- Decide whether under-filled papers (`3/5`) should auto-continue fill until `expected` or surface a clear “short paper” UI state
- Optional architecture A/B later: per-question Luna High vs current o3 + paper Luna — **do not redesign while measuring this worker path**

### Ops reminder

Always run **both**:

```bash
pnpm run dev            # API
pnpm run worker:paper   # generation worker
```

---

## 12. Artifact index

| Path | Role |
|------|------|
| `temp/paper-jobs/apt-c505ce5b-8379-4f41-92ac-eee74d6f5ce7/pipeline.jsonl` | Full event log |
| `…/generated-paper.json` | Final 3 Q draft (`ready_to_confirm`) |
| `…/tokens.json` | Token totals |
| `…/questions/*-dropped.json` | Per-seat failure payloads |
| `…/questions/*-ready_to_confirm.json` | Locked survivors |
| `temp/generation-jobs/apt-c505ce5b-8379-4f41-92ac-eee74d6f5ce7.json` | Shared job status |
| `temp/confirmed-questions/2026-09-18/00-17-18-09-26-…chemistry-all.txt` | Admin confirm export |

---

*Report generated from live artifacts of job `apt-c505ce5b-8379-4f41-92ac-eee74d6f5ce7` and the 2026-09-18 worker-based codebase.*
