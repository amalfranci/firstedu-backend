# Backend Paper Flow — Old (git HEAD) vs Current (working tree)

**Date:** 2026-09-18  
**Branch:** `feature/new-question-paper-flow`  
**Baseline (old):** `HEAD` = `3c8d970` — *harden AI paper pipeline with Luna quality gates and optional worker*  
**Current:** uncommitted working tree + new untracked services (not yet committed)  
**Also compared:** frontend edits on `-firstedu-frontend` that consume this API  

---

## 1. Executive verdict

| Dimension | Old (HEAD) | Current (working tree) |
|-----------|------------|-------------------------|
| Verify model | **Luna per question** (sequential) | **o3 parallel** + **one Luna paper audit** |
| Runner default | Code default was flipping toward worker; message still “generate → Luna” | **`PAPER_JOB_RUNNER=worker`** default; message “generate → o3 → expand → Luna audit” |
| Token risk on fails | Each fail → new seat + **Luna again** (expensive, slow) | Empty/infra/uncertain → **same-seat o3 only**; quality fail → **hard Gemini replace budget** |
| Duplicate questions in UI/confirm | Possible (stale draft / FE `prev[i]`) | **Stem dedupe** on write + poll + save + log; FE clears stale slots |
| Snapshot files under `questions/` | One file per stage per seat (same idea) | Same mechanism; fewer seats expected because replace caps |

**Bottom line:** Current code is a **different pipeline architecture**, not a small tweak. It trades per-question Luna for parallel o3 + paper Luna, and adds explicit **token-spend budgets** plus **anti-duplicate** guards.

---

## 2. Flow diagrams

### 2.1 Old flow (git HEAD — Luna-per-question)

```text
FE  →  POST /admin/ai-powered-test/questions
         → enqueue apt-* (pending)
              │
              ▼
     paper-worker (or inline setImmediate)
              │
              ▼
     plan → Gemini generate (batch/seat)
              │
              ▼
     Luna VERIFY each question (sequential / per seat)
              │  timeout → retry or drop
              │  fail → drop / fill round
              ▼
     Gemini expand explanations
              │
              ▼
     ready_to_confirm → FE poll → confirm/save
```

**Cost profile:** wall-clock dominated by **N × Luna**; failures often re-spend Gemini **and** Luna.

### 2.2 Current flow (working tree — parallel o3 + paper Luna)

```text
FE  →  POST /questions → generationId immediately (202)
         → enqueue apt-* (pending) + Mongo/disk progress fields
              │
              ▼
     paper-worker claims job
              │
              ▼
     plan
       → parallel Gemini generate
       → code validation (deterministic, local)
       → parallel o3 compact verify
            · empty / infra / uncertain → SAME-SEAT o3 retry (no Gemini)
            · clear QUALITY fail → Gemini replace ≤ JEE_ADV_QUALITY_REPLACE_MAX
       → parallel Gemini expand
       → ONE Luna paper-level audit
              │
              ▼
     ready_to_confirm (deduped stems) → FE poll (authoritative list) → confirm/save
```

**Cost profile:** wall-clock ≈ `max(gen) + max(o3) + 1×Luna`; failures prefer **o3-only retries** before burning Gemini.

---

## 3. Git change inventory

### 3.1 Modified (vs HEAD) — backend

| File | Role of change |
|------|----------------|
| `src/services/aiPoweredTestPipeline.service.js` | Switches main path to `runParallelPaperPipeline`; progress/completion **dedupe**; stage regex includes o3/code failures |
| `src/services/paperJobQueue.service.js` | Default runner **`worker`**; progress fields on enqueue; queue message updated for o3 flow |
| `src/controllers/aiPoweredTest.controller.js` | `resolvePaperJob`: disk + Mongo + draft; **never prefer longer temporary draft**; progress fields on poll |
| `src/services/questionBankGenerationJobStore.js` | Longer TTL for paper jobs; disk refresh for apt-*; **dedupe on `updateGenerationJob`** |
| `src/services/paperJobArtifact.service.js` | Draft save **dedupes**; richer persist fields |
| `src/services/aiQuestionBank.service.js` | Save path **dedupes** stems before bank write |
| `src/services/confirmedQuestionsLogger.service.js` | Confirm `.txt` uses shared stem dedupe |
| `src/models/AiPaperGenerationJob.js` | Progress / generation fields |
| `src/models/AiPaperGenerationQuestion.js` | Stage vocabulary (code/o3/ready_to_confirm) |
| `src/models/AiQuestionBank.js` + repository + validator | Generation / bank metadata support |
| `src/routes/aiPoweredTest.routes.js` | Job/status/resume wiring for paper jobs |
| `jee_advanced/topic_allocation.json` | Topic allocation tweak (minor vs pipeline) |

**Diff size (tracked):** ~**+560 / −187** across 14 files.

### 3.2 New untracked (current only — must be committed to ship)

| File | Purpose |
|------|---------|
| `src/services/paperParallelOrchestrator.service.js` | **Core new pipeline** (~1.2k lines): parallel gen/o3/expand, same-seat o3, quality/code replace budgets, Luna paper audit |
| `src/services/paperCodeValidation.service.js` | Deterministic pre-o3 gates + duplicate-stem check |
| `src/services/questionQualityGate.service.js` | Shared PASS/FAIL/UNCERTAIN/INFRA-style gate helpers |
| `src/services/questionDomainRules.service.js` | Domain rules used by gates |
| `src/utils/paperQuestionDedupe.js` | Stem dedupe + authoritative draft vs job pick |
| `analysis-report/*` | Prior job writeups (docs only) |

### 3.3 Frontend (separate repo, related)

| File | Change |
|------|--------|
| `AiPoweredTestPage.jsx` | `applyJobQuestions`: **do not keep stale `prev[i]`** when list shrinks; save only filled slots |
| `jeeAdvancedWizard.utils.js` | Tag slots `_productionReady` / `_pipelineStage` |
| `AiBankCreateView.jsx` / AI test service / endpoints | Poll/resume UX for worker jobs |

### 3.4 Not changed vs HEAD (gap to be aware of)

| Item | Status |
|------|--------|
| `scripts/paper-job-worker.mjs` | Still HEAD behavior: on start **always** `requeueOrphanedWorkerJobs()`; Ctrl+C only drains — **does not cancel remaining queue** in current file |
| `.env` `PAPER_WORKER_AUTO_REQUEUE=0` | Present locally, but worker code **does not yet gate** on it (requeue still runs) |

*Earlier session work on cancel-on-Ctrl+C is not present in the worker file on disk right now.* Re-apply if that shutdown behavior is still required.

---

## 4. Stage-by-stage comparison

| Stage | Old (HEAD) | Current |
|-------|------------|---------|
| Plan / topic seats | Yes | Yes (same planner family) |
| Generate | Gemini | Gemini **parallel** (`JEE_ADV_GENERATE_CONCURRENCY`, default 6) |
| Pre-verify gate | Mostly Luna’s job | **Code validation** (local) + near-dup stem reject |
| Answer verify | **Luna each Q** | **o3 compact JSON** parallel |
| Fail: empty / timeout | Often new seat or Luna retry | **Same-seat o3** (`JEE_ADV_O3_SAME_SEAT_RETRIES=2`) — **no Gemini** |
| Fail: uncertain | Drop / regenerate | Same-seat o3, then **drop without Gemini** |
| Fail: quality (wrong key) | Fill rounds × Luna | Gemini replace ≤ **`JEE_ADV_QUALITY_REPLACE_MAX`** (env **7**) |
| Code-valid fail replace | Fill rounds (high) | ≤ **`JEE_ADV_CODE_REPLACE_MAX`** (env **14**) |
| Expand | Gemini | Gemini **parallel** |
| Final audit | Implicit per-Q Luna | **One Luna paper audit** |
| Terminal stage | `ready_to_confirm` | Same, plus stem dedupe |

---

## 5. Token / cost comparison (why `apt-dfb36811` hurt)

### What that job showed (old-style repair churn under transitional parallel code)

- Expected **7** Q → **44** seat sequences → **294** stage snapshot files  
- Drops: many `o3_fail` / `o3_solve_error` / code fails  
- Tokens: Gemini ~414k, o3 ~61k, Luna ~21k (one paper call)  
- Snapshot files themselves are **disk only** — cost was the **API repair loop**

### Why old HEAD would also burn (differently)

- Per-question Luna is **more expensive per seat** than compact o3  
- Failures that regenerate still re-pay Gemini + Luna  
- No quality-replace hard budget equivalent to `JEE_ADV_QUALITY_REPLACE_MAX`

### What current budgets enforce (7Q example)

| Budget | Env | Cap |
|--------|-----|-----|
| Same-seat o3 retries | `JEE_ADV_O3_SAME_SEAT_RETRIES=2` | Up to 3 o3 calls **per locked stem** for infra/empty/uncertain |
| Gemini after **quality** o3 fail | `JEE_ADV_QUALITY_REPLACE_MAX=7` | ≤ 7 new generates for whole paper |
| Gemini after **code** fail | `JEE_ADV_CODE_REPLACE_MAX=14` | ≤ 14 code-repair generates |
| Fill rounds (legacy knobs) | `JEE_ADV_FILL_ROUNDS=2` | Reduced from 4 |

Worst-case Gemini seats ≈ initial N + code budget + quality budget ≈ **7 + 14 + 7 = 28**, not unbounded 40+.

Empty o3 no longer counts as “quality fail → Gemini” (that was a major waste vector).

---

## 6. Duplicate-question bug — before vs after

| Layer | Before | After |
|-------|--------|-------|
| Job poll | Could prefer **longer temporary draft** over shorter final list | `pickAuthoritativePaperQuestions` — terminal job list wins |
| Job store updates | Could store duplicate stems | Dedupe in `updateGenerationJob` + progress + draft |
| Orchestrator output | Could emit dups if seats collided | Final list stem-deduped |
| FE bank slots | Kept `prev[i]` when list shrank → **chemistry-all Q4/Q5** | Clears to empty; only filled slots saved |
| Confirm `.txt` / bank save | Logged whatever FE sent | Stem dedupe server-side |

Confirmed export `00-17-18-09-26-…chemistry-all.txt` was rewritten to the **3** true `ready_to_confirm` items from `apt-c505ce5b`.

---

## 7. Runner / ops comparison

| | Old HEAD | Current |
|--|----------|---------|
| Default `PAPER_JOB_RUNNER` | Historically **inline** in older commits; HEAD message still Luna-centric | **`worker`** |
| API alone | Inline could still run; worker mode queues forever | **Must run `pnpm run worker:paper`** |
| Progress on poll | Weaker cross-process | Disk + Mongo + draft merge |
| Paper job TTL | Short generic TTL risk | **6h-class** paper TTL |
| Ctrl+C | Drain in-flight | **Still drain-only in worker file** (cancel-all / no-requeue gate **not** in current worker — gap) |

---

## 8. Evidence jobs

| Job | Flow | Outcome | Lesson |
|-----|------|---------|--------|
| `apt-76d73a9c` (Physics, report 2026-09-17) | Closer to **old Luna-per-Q / inline** | 6/6 but Luna timeouts | Sequential Luna fragile |
| `apt-c505ce5b` (Chemistry 5Q) | **Current parallel** worker | 3/5 ready; confirm had FE dups | Architecture OK; FE/draft bug fixed after |
| `apt-dfb36811` (Chemistry 7Q) | Parallel but **uncapped repair** | Cancelled; 44 seats / huge token spend | Motivated same-seat + replace budgets |

---

## 9. File map — “what to read”

```text
OLD path still in repo (legacy helpers kept):
  aiPoweredTestPipeline.service.js  → dualLockQuestion / Luna-per-Q still exist
                                      but main job loop calls runParallelPaperPipeline

NEW path (untracked — ship these):
  paperParallelOrchestrator.service.js
  paperCodeValidation.service.js
  questionQualityGate.service.js
  questionDomainRules.service.js
  utils/paperQuestionDedupe.js

WIRING:
  paperJobQueue.service.js          → worker default + enqueue fields
  aiPoweredTest.controller.js       → resolvePaperJob / poll
  questionBankGenerationJobStore.js → TTL + dedupe
  paperJobArtifact.service.js       → draft dedupe
```

---

## 10. Ship checklist

1. **Commit** all modified + untracked orchestrator/QC/dedupe files (otherwise production stays on HEAD Luna-per-Q if someone resets).  
2. Restart **API + `worker:paper`** after `.env` budgets.  
3. Optionally **re-apply** worker Ctrl+C cancel + `PAPER_WORKER_AUTO_REQUEUE` gate (currently missing in `scripts/paper-job-worker.mjs`).  
4. Smoke a small Chemistry run (e.g. 3–5Q) and confirm:  
   - log lines `O3_SAME_SEAT` / `QUALITY_REPLACE` / `O3_REPLACE_BUDGET_STOP`  
   - `questions/` seat count stays near budget  
   - confirm export has **no duplicate stems**

---

## 11. One-line summary

**Old HEAD:** worker-capable API, but **generate → Luna each question → expand** (slow, fail-expensive).  

**Current tree:** **generate ∥ → code → o3 ∥ (same-seat retry) → expand ∥ → 1× Luna paper**, with **replace budgets + stem dedupe + FE slot fix** — designed to stop the `dfb36811`-style Gemini/o3 burn and the chemistry confirm duplicates.
