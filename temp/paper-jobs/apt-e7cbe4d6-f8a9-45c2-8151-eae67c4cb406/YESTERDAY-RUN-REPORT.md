# JEE Advanced paper generation — full run report

**Job ID:** `apt-e7cbe4d6-f8a9-45c2-8151-eae67c4cb406`  
**When:** 16 September 2026, 16:12–16:23 IST (10:42–10:53 UTC)  
**Wall clock:** 11 minutes 19 seconds until logs stopped  
**Requested:** 6 questions (Physics 2 + Chemistry 2 + Maths 2)  
**Delivered before stop:** 2 fully complete + 1 locked (no explanation) + 3 never started  

Source files:

- `temp/paper-jobs/apt-e7cbe4d6-f8a9-45c2-8151-eae67c4cb406/pipeline.jsonl`
- `temp/paper-jobs/apt-e7cbe4d6-f8a9-45c2-8151-eae67c4cb406/tokens.json`
- `temp/paper-jobs/apt-e7cbe4d6-f8a9-45c2-8151-eae67c4cb406/questions/`
- `temp/generation-jobs/apt-e7cbe4d6-f8a9-45c2-8151-eae67c4cb406.json`

The file `temp/confirmed-questions/2026-09-16/16-17-16-09-26-...physics-all.txt` is **not** this pipeline log. It is a save dump written at 16:17 IST, when only Physics Q1 existed in the bank.

---

## 1. What you asked for

| Setting | Value |
|---|---|
| Exam | JEE Advanced Paper 1, hard |
| Subjects | Physics 2, Chemistry 2, Mathematics 2 |
| Topic pool | All seeded chapters (19 Physics, 36 Chemistry, 19 Maths) |
| Total | 6 |
| Enabled types | single, multiple, integer, match |
| Actual type mix sent | **1 single + 1 multiple + 1 integer + 3 match** |

The 2/2/2 split is **by subject**. The type mix came from the wizard type pattern scaled to 6, not “2 of each type”.

---

## 2. End-to-end process (what the pipeline actually does)

Questions are produced **one at a time**, not six in parallel.

```
USER wizard (Phy 2 / Chem 2 / Math 2, total 6)
        │
        ▼
1. BACKEND TOPIC ALLOCATOR  (no LLM, instant)
   Rank the ticked pool with weight + priority + hard slots
   + freshness − recently used − same-cluster penalty
        │
        ├─ Physics  → P05 Rotation, then P11 Electrostatics
        ├─ Chemistry → C06 Equilibrium, then C18 Coordination
        └─ Maths     → M07 Matrices, then M17 Integral Calculus
        │
        ▼
2. SEAT PLAN  (no LLM)
   Interleave subjects, then attach types from typeCounts
   Planned 6 seats: 1 single, 1 multiple, 1 integer, 3 match
        │
        ▼
   FOR EACH QUESTION (sequential)
        │
        ▼
3. GENERATE  — Gemini gemini-3.5-flash
   Assigned chapter only. Gemini picks one Preferred hard slot,
   writes stem + options/key + insight. No full solution yet.
        │
        ▼
4. DUAL-LOCK  — intended o4-mini (A) then o3-mini (B)
   Independent solve of stem+options. Keep only if A and B agree.
   Integer/multi also get a third recompute. Disagree → drop, try another slot.
        │
        ▼
5. EXPAND  — Gemini gemini-3.5-flash
   Official solution with LOCKED KEY. Must not change the answer.
        │
        ▼
6. CHECKPOINT
   Console + pipeline.jsonl + questions/*.json + tokens.json
   + MongoDB ai_paper_generation_jobs / ai_paper_generation_questions
```

Yesterday the job **stopped during Q3 expand**. Match questions 4–6 never started.

---

## 3. Models used

| Stage | Intended model | What actually ran yesterday |
|---|---|---|
| Topic allocation | Backend algorithm | Backend only |
| Write question | `gemini-3.5-flash` | `gemini-3.5-flash` |
| Dual-lock A | `o4-mini` | Timed out (60s). Fell back to `o3-mini` or Gemini |
| Dual-lock B | `o3-mini` | `o3-mini` when it answered; Gemini solver on timeout |
| Recompute | Gemini solver | `gemini-3.5-flash` |
| Explanation | `gemini-3.5-flash` | `gemini-3.5-flash` |

`OPENAI_SOLVER_TIMEOUT_MS=60000` in `.env`. That 60s cap is why lock took 3–4 minutes on Q2/Q3.

---

## 4. Timeline (IST)

Job window: **16:12:23 – 16:23:42** (11 min 19 s).

| Time | Event |
|---|---|
| 16:12:23 | Job start. Plan 6 Q. Allocate P05, P11, C06, C18, M07, M17 |
| 16:12:23 | Q1 Physics single P05 — Gemini generate starts |
| 16:13:13 | Q1 generated (50 s) |
| 16:13:13 | Dual-lock A requested as o4-mini |
| 16:14:25 | A returned as **o3-mini** after 72 s (o4-mini did not finish in 60 s) |
| 16:14:34 | B o3-mini 9 s. Keys agree on **A**. Locked |
| 16:14:46 | Gemini expand 12 s. **Q1 complete** |
| 16:14:46 | Q2 Chemistry multiple C06 — generate starts |
| 16:15:35 | Q2 generated (49 s) |
| 16:16:46 | o3-mini A 70 s |
| 16:17 | `confirmed-questions` physics txt written (only Q1 existed) |
| 16:17:46 | o3-mini B **timeout 60 s** |
| 16:17:46 | Gemini solver fallback started |
| 16:19:16 | Gemini solver **aborted** (90 s) |
| 16:19:22 | Gemini solver retry 9 s + 6 s recompute. Locked **A,B,D** |
| 16:19:51 | Expand 14 s. **Q2 complete. Paper 2/6** |
| 16:19:51 | Q3 Maths integer M07 — generate starts |
| 16:20:25 | Q3 generated (34 s), claimed answer 16 |
| 16:22:25 | o4-mini **timeout 60 s** (then fallback chain) |
| 16:23:28 | Gemini solver A 63 s |
| 16:23:34 | o3-mini 6 s |
| 16:23:42 | Gemini recompute 8 s. Locked **16**. Expand requested |
| 16:23:42 | **Logs stop.** No expand response. Match ×3 never started |

---

## 5. Time per question

| Q | Subject | Type | Generate | Dual-lock | Expand | Total | Result |
|---|---|---|---|---|---|---|---|
| 1 | Physics P05 | single | 50 s | 1 min 21 s | 12 s | **2 min 23 s** | Complete |
| 2 | Chemistry C06 | multiple | 49 s | 4 min 2 s | 14 s | **5 min 5 s** | Complete |
| 3 | Maths M07 | integer | 34 s | 3 min 17 s | not finished | **~3 min 51 s** to lock | Locked, no solution |
| 4–6 | planned match | match | — | — | — | — | Not started |

**Stage averages from this run**

- Generate (Gemini write): **~35–50 s**
- Dual-lock when OpenAI is healthy (Q1): **~1.5 min**
- Dual-lock with 60 s timeouts (Q2, Q3): **~3–4 min**
- Expand explanation: **~12–15 s**

**One complete question:** about **2.5 minutes** if lock is clean, **4–5 minutes** if solvers time out.  
**Six questions in this sequential design:** about **15 minutes** best case, **25–30 minutes** with timeouts like yesterday.

---

## 6. Tokens and estimated cost

Prices used (standard paid APIs, Sep 2026):

| Model | Input / 1M | Output / 1M (includes thinking / reasoning) |
|---|---|---|
| Gemini 3.5 Flash | $1.50 | $9.00 |
| o3-mini | $1.10 | $4.40 |
| o4-mini | $1.10 | $4.40 |

o4-mini was **called** but **never recorded a successful usage row** (timeouts). Timed-out calls may still incur provider-side charges that this log cannot see.

### Job totals (`tokens.json`)

| Model | Calls | Prompt | Completion | Reasoning / thinking | Total tokens | Est. USD |
|---|---|---|---|---|---|---|
| gemini-3.5-flash | 9 | 3,622 | 4,349 | 35,328 | 43,299 | **$0.36** |
| o3-mini | 4 | 1,426 | 7,604 | 6,656 | 9,030 | **$0.04** |
| o4-mini | 0 billed | — | — | — | — | unknown (timeouts) |
| **Run total** | **13** | **5,048** | **11,953** | **41,984** | **52,329** | **~$0.40** |

Gemini cost = `3622 × $1.50/1M + (4349+35328) × $9.00/1M` = **$0.363**.  
o3-mini cost = `1426 × $1.10/1M + 7604 × $4.40/1M` = **$0.035**.

Most spend is **Gemini thinking tokens**, not the short written answer.

### Cost by question (from recorded calls)

| Q | Gemini in / thinking+out | o3-mini in / out | Est. USD |
|---|---|---|---|
| Physics Q1 | 989 / 15,068 | 816 / 4,202 | **~$0.16** |
| Chemistry Q2 | 1,607 / 12,566 | 393 / 2,377 | **~$0.13** |
| Maths Q3 | 1,026 / 12,043 | 217 / 1,025 | **~$0.11** |

Rough run rate: **~$0.13 per question** that reached lock. If all 6 had finished similarly: **about $0.80**, plus unused o4-mini timeout attempts.

---

## 7. Output of each question

### Q1 — Physics — complete

| Field | Value |
|---|---|
| Chapter | P05 System of Particles and Rotational Motion |
| Type | Single correct |
| Hard slot Gemini chose | rigid-body toppling / critical ω |
| Self-score | (writer sent a hard stem; lock badge DUAL-OPENAI) |
| Locked key | **A** |
| Trust | `dual(o4-mini+o3-mini)` · production ready |
| Time | 2 min 23 s |
| Est. cost | ~$0.16 |

Stem (short): uniform solid cylinder on a rough turntable, distance `d ≫ R`, angular acceleration `α`. Find `ω` at the verge of toppling given `μ > 2R/H` and `α < 2gR/(dH)`.

| Option | |
|---|---|
| A | `ω = [ (2gR/(dH))² − α² ]^(1/4)` **correct** |
| B | `ω = [ (μg/d)² − α² ]^(1/4)` |
| C | `ω = [ 2gR/(dH) − α ]^(1/2)` |
| D | `ω = [ (gR/(dH))² − α² ]^(1/4)` |

This is the only item copied into the physics `confirmed-questions` txt.

### Q2 — Chemistry — complete

| Field | Value |
|---|---|
| Chapter | C06 Chemical and Ionic Equilibrium |
| Type | Multiple correct |
| Hard slot | simultaneous equilibria |
| Writer score | 84 |
| Locked key | **A, B, D** |
| Trust | `dual(o4-mini+o3-mini)+recompute` · production ready |
| Time | 5 min 5 s |
| Est. cost | ~$0.13 |

Stem (short): solids NH₄HS and H₂NCOONH₄ in an evacuated vessel. `Kp1 = 6 atm²`, `Kp2 = 20 atm³`. Select correct statements.

| Option | Verdict |
|---|---|
| A | P(NH₃) = 4 atm — **correct** |
| B | Total P = 6.75 atm — **correct** |
| C | Double volume → CO₂ mole fraction increases — **incorrect** |
| D | Moles NH₄HS : H₂NCOONH₄ consumed = 6 : 5 — **correct** |

### Q3 — Maths — locked, explanation not written

| Field | Value |
|---|---|
| Chapter | M07 Matrices and Determinants |
| Type | Integer / numerical |
| Hard slot | matrix-equation properties |
| Writer score | 84 |
| Locked key | **16** |
| Trust | `dual(o4-mini+o3-mini)+recompute` · production ready |
| Time | 3 min 51 s to lock |
| Est. cost | ~$0.11 |
| Expand | Gemini request sent; **no response in the log** |

Stem: `A` symmetric 3×3, `B` nonzero skew-symmetric, `C = (A+B)⁻¹(A−B)`. Find `det( Cᵀ(A+B)C + A − B )`. Insight: expression collapses to `2A`, `det(2A) = 16`.

### Q4–Q6 — not generated

Planned as **match × 3** on remaining allocated chapters (second Physics P11, second Chemistry C18, second Maths M17, depending on seat order). Job never reached them.

---

## 8. Token calls (every billed call in order)

| Time UTC | Model | Stage | Prompt | Completion | Thinking | Total | Latency |
|---|---|---|---|---|---|---|---|
| 10:43:13 | gemini-3.5-flash | generate Q1 | 555 | 462 | 11,941 | 12,958 | 50 s |
| 10:44:25 | o3-mini | lock A Q1 | 408 | 2,483 | 2,240 | 2,891 | 72 s |
| 10:44:34 | o3-mini | lock B Q1 | 408 | 1,719 | 1,536 | 2,127 | 9 s |
| 10:44:46 | gemini-3.5-flash | expand Q1 | 434 | 769 | 1,896 | 3,099 | 12 s |
| 10:45:35 | gemini-3.5-flash | generate Q2 | 410 | 475 | 4,557 | 5,442 | 49 s |
| 10:46:46 | o3-mini | lock A Q2 | 393 | 2,377 | 2,048 | 2,770 | 70 s |
| 10:47:46 | o3-mini | lock B Q2 | — | — | — | — | **timeout 60 s** |
| 10:49:16 | gemini-3.5-flash | solver fallback | — | — | — | — | **abort 90 s** |
| 10:49:31 | gemini-3.5-flash | solver Q2 | 375 | 376 | 1,708 | 2,459 | 9 s |
| 10:49:37 | gemini-3.5-flash | recompute Q2 | 345 | 38 | 1,624 | 2,007 | 6 s |
| 10:49:51 | gemini-3.5-flash | expand Q2 | 477 | 1,524 | 2,264 | 4,265 | 14 s |
| 10:50:25 | gemini-3.5-flash | generate Q3 | 640 | 269 | 8,232 | 9,141 | 34 s |
| 10:52:25 | o4-mini | lock A Q3 | — | — | — | — | **timeout 60 s** |
| 10:53:28 | gemini-3.5-flash | solver Q3 | 195 | 188 | 1,252 | 1,635 | 63 s |
| 10:53:34 | o3-mini | lock Q3 | 217 | 1,025 | 832 | 1,242 | 6 s |
| 10:53:42 | gemini-3.5-flash | recompute Q3 | 191 | 248 | 1,854 | 2,293 | 8 s |
| 10:53:42 | gemini-3.5-flash | expand Q3 | — | — | — | — | **no response logged** |

---

## 9. Why you only saw one question in that txt file

1. Pipeline had only finished **Q1** at 16:14. Q2 finished at 16:19.
2. The physics `confirmed-questions` file is timestamped **16:17** — between Q1 done and Q2 done.
3. That logger writes the **current bank snapshot**, not the full job folder.
4. The real checkpoints are `questions/01-P05-expanded.json`, `02-C06-expanded.json`, `03-M07-locked.json`.

---

## 10. Bottom line

| Metric | Result |
|---|---|
| Asked | 6 questions |
| Fully finished | **2** (Physics single, Chemistry multi) |
| Locked without solution | **1** (Maths integer = 16) |
| Not started | **3** (match) |
| Wall time logged | **11 min 19 s** |
| Recorded spend | **~$0.40** (Gemini ~$0.36, o3-mini ~$0.04) |
| o4-mini | Configured as lock A; **timed out every time it was used** |
| Slow step | Dual-lock, not Gemini writing |
| Resume | Same job can continue from Q3 expand + remaining 3 match seats without regenerating Q1/Q2 |

To finish the paper without wasting tokens: use **Resume generation** on job `apt-e7cbe4d6-f8a9-45c2-8151-eae67c4cb406`. It should skip the two expanded questions and continue from the locked Maths item.
