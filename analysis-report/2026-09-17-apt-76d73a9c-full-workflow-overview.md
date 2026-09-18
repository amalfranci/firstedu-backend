# AI Paper Generation — Full Workflow Overview & Job Analysis

**Date:** 2026-09-17  
**Report file:** `analysis-report/2026-09-17-apt-76d73a9c-full-workflow-overview.md`  
**Job analyzed:** `apt-76d73a9c-c10b-4a18-a3a9-08ad811a12cc`  
**Subject / exam (this run):** JEE Advanced · Physics · 6 questions  
**Artifacts:** `temp/paper-jobs/apt-76d73a9c-c10b-4a18-a3a9-08ad811a12cc/`

---

## 1. Executive summary

| Item | Value |
|------|--------|
| Job status | **completed** |
| Expected | **6** |
| Locked / ready | **6** (after seat replacement) |
| Seats attempted | **9** (seq 01–09) |
| Dropped | **3** — all `luna_verify_timeout` |
| Final mix | single 2 · multiple 1 · integer 2 · match 1 |

**Important:** This job ran under the **older sequential flow** (Gemini → **Luna per question** → expand).  
The **current codebase** uses a different architecture (parallel Gemini → code validation → parallel o3 → one Luna **paper** audit). Both are documented below.

---

## 2. Current implementation workflow (as of 2026-09-17)

This is what new UI paper jobs use now (`PAPER_JOB_RUNNER=inline` by default).

### 2.1 High-level diagram

```text
Admin UI (Ai Powered Test)
        │
        ▼
POST /admin/ai-powered-test/questions
        │  creates jobId = apt-<uuid>
        ▼
┌───────────────────────────────────────┐
│  API process (inline) or paper-worker │
│  runAdvancedPaperPipeline             │
│    → runParallelPaperPipeline         │
└───────────────────────────────────────┘
        │
        ▼
   Phase 0 — PLAN
   planPipelineSlots()
   · allocate chapters per subject
   · type seats: single / multiple / integer / match
   · chapter_lock + concept preference on seats
        │
        ▼
   Phase A — PARALLEL GENERATE + CODE VALIDATION
   · Gemini generate all seats (JEE_ADV_GENERATE_CONCURRENCY, default 6)
   · Deterministic code checks (no LLM):
       JSON / type / options / answer format /
       correctIndex consistency / duplicates / LaTeX balance
   · Invalid → repair from unused chapter pool
        │
        ▼
   Phase B — PARALLEL o3 VERIFY (compact JSON)
   · PAPER_SOLVER_MODEL=o3
   · Independent re-solve; does NOT rewrite explanation
   · Gates: answerMatches + calculationCorrect + questionValid
   · FAIL / UNCERTAIN → regenerate that seat only → o3 again
        │
        ▼
   Phase C — PARALLEL EXPAND (if explanation thin)
   · Gemini expand with locked key
        │
        ▼
   Phase D — ONE Luna PAPER-LEVEL AUDIT
   · OPENAI_VERIFY_MODEL=gpt-5.6-luna
   · Single call for the whole paper
   · Checks answer + explanation completeness + approximations + difficulty + paper consistency
   · Rule: model agreement ≠ proof
        │
        ▼
   READY_TO_CONFIRM  (only if productionReady gates pass)
        │
        ▼
   Admin saves bank
   · unique generationId (UUID) per save
   · same exam/subject allowed many times
```

### 2.2 Stage names (per question)

| Stage | Meaning |
|-------|---------|
| `queued` | Seat reserved |
| `generating` / `generated` | Gemini writer |
| `code_validating` / `code_valid` | Backend structural checks |
| `validating` / `verified` | o3 math lock |
| `expanding` / `expanded` | Explanation fill |
| `auditing` | (paper-level Luna; item may stay expanded until paper verdict) |
| `ready_to_confirm` | Kept for UI / save |
| `dropped` / `failed` | Not kept; reason stored |

### 2.3 Env knobs (current)

| Key | Role | Typical |
|-----|------|---------|
| `JEE_ADV_GENERATE_CONCURRENCY` | Parallel Gemini | 6 |
| `JEE_ADV_O3_CONCURRENCY` | Parallel o3 | 6 |
| `JEE_ADV_EXPAND_CONCURRENCY` | Parallel expand | 4 |
| `PAPER_SOLVER_MODEL` | Math verifier | `o3` |
| `PAPER_SOLVER_TIMEOUT_MS` | o3 timeout | 120000 |
| `OPENAI_VERIFY_MODEL` | Paper auditor | `gpt-5.6-luna` |
| `OPENAI_VERIFY_TIMEOUT_MS` | Luna paper timeout | 180000 |
| `JEE_ADV_FILL_ROUNDS` | Repair multiplier | 4 |
| `PAPER_JOB_RUNNER` | `inline` \| `worker` | `inline` |

### 2.4 Save / bank uniqueness (current)

- Saving no longer blocks on “JEE Advanced › Physics already exists”.
- Each save creates a new `generationId` (UUID) on `AiQuestionBank`.
- Display name may look like `JEE Advanced › Physics · a1b2c3d4`.

---

## 3. What *this* job actually ran (historical)

Job `apt-76d73a9c…` used the **previous** per-question Luna verify path:

```text
PLAN
  → for each type (single → multiple → integer → match):
       generate 1 seat
         → Luna VERIFY (120s timeout)   ← bottleneck
         → expand
         → on FAIL/timeout: take next unused chapter (replacement)
  → JOB_DONE when 6 locked
```

Evidence from `pipeline.jsonl` event counts:

| Event | Count |
|-------|------:|
| QUESTION_START | 9 |
| GENERATE_BATCH | 9 |
| LUNA_VERIFY_ITEM | 9 |
| OPENAI_VERIFY_RESPONSE | 6 |
| OPENAI_VERIFY_ERROR | 3 |
| VERIFY_DROP / QUESTION_FAILED | 3 each |
| GEMINI_RETRY | 1 (one generate abort then retry) |
| JOB_DONE | 1 |

So: **9 attempts → 6 pass Luna → 3 timeout drops → replacements fill the paper.**

---

## 4. Seat-by-seat outcome (this job)

| Seq | Topic | Chapter | Type | Final stage | Outcome |
|----:|-------|---------|------|-------------|---------|
| 01 | P04 | Work, Energy and Power | single | `ready_to_confirm` | **PASS** |
| 02 | P18 | Wave Optics | single | `ready_to_confirm` | **PASS** |
| 03 | P11 | Electrostatics | multiple | `ready_to_confirm` | **PASS** |
| 04 | P08 | Mechanical Properties of Solids and Fluids | integer | `dropped` | **DROP** — see §5 |
| 05 | P19 | Modern Physics | integer | `ready_to_confirm` | **PASS** (replacement path for integer) |
| 06 | P03 | Newton's Laws of Motion and Friction | integer | `dropped` | **DROP** — see §5 |
| 07 | P15 | Electromagnetic Induction and AC Circuits | integer | `dropped` | **DROP** — see §5 |
| 08 | P06 | Gravitation | integer | `ready_to_confirm` | **PASS** (replacement) |
| 09 | P10 | Thermal Physics | match | `ready_to_confirm` | **PASS** |

Final paper (`generated-paper.json`): **6 questions**, status `ready_to_confirm`.

Checkpoint stages seen on a successful item (example seq 01):

`generating → generated → validating → verified → expanding → ready_to_confirm`

Dropped items stop at:

`generating → generated → validating → dropped`

---

## 5. Dropped questions — full reasons

All three drops share the **same failure class**. None failed for wrong math / chapter mismatch / hardness; they failed **infrastructure timeout** on Luna.

### 5.1 Summary table

| Seq | Topic | Chapter | Type | Proposed key | `failureReason` | `failureDetail` | Attempt |
|----:|-------|---------|------|-------------:|-----------------|-----------------|--------:|
| 04 | P08 | Mechanical Properties of Solids and Fluids | integer | 8 | `luna_verify_timeout` | `timeout of 120000ms exceeded` | 1 |
| 06 | P03 | Newton's Laws of Motion and Friction | integer | 10 | `luna_verify_timeout` | `timeout of 120000ms exceeded` | 3 |
| 07 | P15 | Electromagnetic Induction and AC Circuits | integer | 12 | `luna_verify_timeout` | `timeout of 120000ms exceeded` | 4 |

**Meaning:** Gemini had already generated a stem + proposed integer answer. Luna was asked to independently verify within **120 seconds**. The HTTP call aborted (`ECONNABORTED` / axios timeout). Backend logged `VERIFY_DROP` → `QUESTION_FAILED` and moved to a **replacement seat** (fill rounds).

### 5.2 Deep dive — `04-P08-dropped.json`

Source:  
`temp/paper-jobs/apt-76d73a9c-c10b-4a18-a3a9-08ad811a12cc/questions/04-P08-dropped.json`

| Field | Value |
|-------|--------|
| `ts` | 2026-09-17T13:01:17.811Z |
| `seq` | 4 |
| `type` | integer |
| `topicId` | P08 |
| `chapter` | Mechanical Properties of Solids and Fluids |
| `conceptSlot` (seat) | Efflux/draining-tank (Bernoulli + continuity + time-varying height) |
| `stage` | dropped |
| `failureReason` | **luna_verify_timeout** |
| `failureDetail` | **timeout of 120000ms exceeded** |
| Gemini generate tokens | prompt 763 · completion 330 · reasoning 6002 · total 7095 |
| Proposed answer | **8** |
| Writer insight | Continuity + Torricelli → DE for height difference → integrate to equal levels |

**Stem (preview):** Two vessels areas \(A\) and \(2A\), connected by narrow tube \(a\) with \(A/a=20\), initial height \(H=1.8\,\mathrm{m}\), find time \(T\) until levels equal (\(g=10\)).

**What did *not* happen:** No Luna PASS/FAIL JSON. No key mismatch. No chapter_match fail. The verifier never returned.

**What the system did next:** Continued integer fill with unused chapters → eventually locked P19 (seq 05) and P06 (seq 08).

### 5.3 Seq 06 — P03 (Newton / friction cart–pulley)

- Generated integer (proposed **10**): accelerating cart with blocks + friction + pulley.
- Luna verify started; timed out at 120s (one logged case showed ~613s elapsed in a stuck-call style log earlier in the day — still classified as timeout drop).
- Dropped; replacement continued.

### 5.4 Seq 07 — P15 (EMI / rails + L–C)

- Generated integer (proposed **12**): rails, \(B\), capacitor \(C\), inductor \(L\), rod projected — max displacement.
- Also preceded by one **Gemini generate abort** (180s) then **GEMINI_RETRY** which succeeded, then Luna timeout.
- Dropped; replacement continued.

### 5.5 Drop reason taxonomy (for this job + current code)

| Reason code | When it appears | This job? |
|-------------|-----------------|-----------|
| `luna_verify_timeout` | Luna HTTP > timeout | **Yes ×3** |
| `luna_verify_error` / `luna_audit_error` | API/parse failure | No |
| `key_mismatch` | Solver ≠ proposed | No |
| `code_validation_fail` | Structural check fail (current pipeline) | N/A (old job) |
| `o3_fail` / `o3_uncertain` | o3 math gates fail (current) | N/A (old job) |
| `chapter_mismatch` / `concept_mismatch` | Syllabus gates | No |
| `explanation_incomplete` | Luna audit (current paper audit) | N/A |
| `generate_empty` / `generate_error` | Writer empty / hard drop | No |
| `duplicate_stem` | Near-duplicate stem | No |

---

## 6. Successful locked questions (this job)

| # | Topic | Type | Trust badge (artifact) | Notes |
|---|-------|------|------------------------|-------|
| 1 | P04 Work–Energy | single | `LUNA-VERIFY` | Spring pulled at \(v_0\); work \(m v_0^2\) |
| 2 | P18 Wave Optics | single | `LUNA-VERIFY` | YDSE + thermal / slab \(\beta\) condition |
| 3 | P11 Electrostatics | multiple | `LUNA-VERIFY` | Multi-correct electrostatics |
| 4 | P19 Modern Physics | integer | `LUNA-VERIFY` | Replaced failed integers |
| 5 | P06 Gravitation | integer | `LUNA-VERIFY` | Replaced failed integers |
| 6 | P10 Thermal Physics | match | `LUNA-VERIFY` | Match-the-following |

(Badge reflects **per-question Luna** era. Current code stamps `O3+LUNA-PAPER` after paper audit.)

---

## 7. Token usage (this job)

From `tokens.json`:

| Model | Calls | Prompt | Completion | Reasoning | Total |
|-------|------:|-------:|-----------:|----------:|------:|
| `gemini-3.5-flash` | 14 | 9,477 | 11,892 | 79,508 | 100,877 |
| `gpt-5.6-luna` | 6 | 4,630 | 25,311 | 23,341 | 29,941 |

Interpretation:

- Gemini: generate + expand (+ 1 retried generate).
- Luna: **6 successful verifies** (3 timed-out calls still burned wall-clock; may not all bill the same).
- Integer seats dominated drop cost: hard numerical verifies hit the 120s ceiling.

---

## 8. Timing lesson (why architecture changed)

For this 6Q Physics paper under **sequential** Luna-per-question:

- Each Luna timeout burned **≥ 120s** before replacement.
- Three timeouts ≈ **≥ 6 minutes** of pure wait, plus generate/expand.
- Cron on the same Node process showed **missed execution** warnings during long verifies (`inline` coupling).

**Current design targets:**

\[
t_{\text{wall}} \approx t_{\text{gen (parallel)}} + t_{\text{o3 (parallel)}} + t_{\text{expand (parallel)}} + t_{\text{one Luna paper audit}}
\]

instead of \(\sum_i (t_{\text{gen},i} + t_{\text{Luna},i} + t_{\text{expand},i})\).

---

## 9. Artifact map for this job

```text
temp/paper-jobs/apt-76d73a9c-c10b-4a18-a3a9-08ad811a12cc/
├── pipeline.jsonl          # every event
├── tokens.json             # model totals
├── generated-paper.json    # final 6 Q draft
└── questions/
    ├── 01-P04-*.json       # stage snapshots through ready_to_confirm
    ├── …
    ├── 04-P08-dropped.json # DROP — luna_verify_timeout (detailed in §5.2)
    ├── 06-P03-dropped.json
    ├── 07-P15-dropped.json
    └── 09-P10-ready_to_confirm.json
```

Related poll store: `temp/generation-jobs/apt-76d73a9c-c10b-4a18-a3a9-08ad811a12cc.json`

---

## 10. Code entry points (current)

| Piece | Path |
|-------|------|
| HTTP start / poll | `src/controllers/aiPoweredTest.controller.js` |
| Job loop | `src/services/aiPoweredTestPipeline.service.js` → `runAdvancedPaperPipeline` |
| Parallel orchestrator | `src/services/paperParallelOrchestrator.service.js` |
| Code validation | `src/services/paperCodeValidation.service.js` |
| Optional worker | `scripts/paper-job-worker.mjs` |
| Bank save + `generationId` | `src/services/aiQuestionBank.service.js` |

---

## 11. Bottom line

1. **This job** finished 6/6 Physics questions using **seat replacement** after **3 Luna timeouts**, all on **integer** seats (P08, P03, P15).  
2. Drop reason is consistently documented as **`luna_verify_timeout` / `timeout of 120000ms exceeded`** — see especially `04-P08-dropped.json`.  
3. **Current product flow** is no longer “Luna once per question”; it is **parallel generate → code validation → parallel o3 → one Luna paper audit**, with unique **`generationId`** per saved bank so the same exam/subject can be generated repeatedly.

---

*Generated 2026-09-17 for internal analysis. Job data read from local `temp/paper-jobs` artifacts.*
