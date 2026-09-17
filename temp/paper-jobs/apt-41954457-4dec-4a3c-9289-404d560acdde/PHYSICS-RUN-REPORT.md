# JEE Advanced Physics — full generation report

**Job ID:** `apt-41954457-4dec-4a3c-9289-404d560acdde`  
**When:** 17 September 2026, **12:14:02 – 12:28:07 IST** (06:44:02 – 06:58:07 UTC)  
**Wall clock:** **14 minutes 5 seconds**  
**Requested:** 4 Physics questions  
**Delivered:** **4/4 locked + expanded** (ready to confirm)  
**Attempts:** 5 (1 dropped + 4 kept)

Source files:

- `temp/paper-jobs/apt-41954457-4dec-4a3c-9289-404d560acdde/pipeline.jsonl`
- `temp/paper-jobs/apt-41954457-4dec-4a3c-9289-404d560acdde/tokens.json`
- `temp/paper-jobs/apt-41954457-4dec-4a3c-9289-404d560acdde/questions/`
- `temp/paper-jobs/apt-41954457-4dec-4a3c-9289-404d560acdde/FOUR-PHYSICS-QUESTIONS.txt`
- `temp/paper-jobs/apt-41954457-4dec-4a3c-9289-404d560acdde/generated-paper.json`

---

## 1. What you asked for

| Setting | Value |
|---|---|
| Exam | JEE Advanced Paper 1, hard |
| Subject | Physics only |
| Total | **4** |
| Type mix | **1 single + 1 multiple + 1 integer + 1 match** |
| Topic pool | All 19 Physics chapters (P01–P19) |
| Marks | 4 per type; negative 1 |

`JOB_START` / `PLAN_COUNTS` both show `expected: 4`. The pipeline did **not** request a 5th paper question.

---

## 2. End-to-end process (this run)

```
USER wizard (Physics 4, types 1+1+1+1)
        │
        ▼
1. BACKEND TOPIC ALLOCATOR  (no LLM)
   Ranked pool → primary seats: P15, P03, P19, P10
   (clusters: electro / mechanics / modern / thermal)
        │
        ▼
2. FILL BY TYPE  (sequential, one seat at a time)
   single → multiple → integer → match
   If a seat fails → try next unused chapter until need is met
        │
        ▼
   FOR EACH ATTEMPT
        │
        ▼
3. GENERATE  — gemini-3.5-flash
   Stem + options/key + insight. No full solution yet.
        │
        ▼
4. LUNA VERIFY  — gpt-5.6-luna (reasoningEffort: high, timeout 180s)
   PASS needs: math + key match + chapter/concept/difficulty + format + no ambiguity
   PASS → lock key. FAIL / timeout → drop seat attempt.
        │
        ▼
5. EXPAND  — gemini-3.5-flash
   Full explanation with LOCKED KEY (must not change answer).
        │
        ▼
6. CHECKPOINT
   pipeline.jsonl + questions/*.json + tokens.json + job status
```

---

## 3. Models used

| Stage | Model | Notes |
|---|---|---|
| Topic allocation | Backend only | Instant |
| Write | `gemini-3.5-flash` | 5 generate calls (incl. failed P15) |
| Verify | `gpt-5.6-luna` high | Timeout **180000 ms**; 4 PASS + 1 timeout |
| Expand | `gemini-3.5-flash` | 4 expand calls |
| Dual o4/o3 | **Not used** | Replaced by single Luna lock |

Trust badge on all kept items: **`LUNA-VERIFY`** / grade `production_luna` / `productionReady: true`.

---

## 4. Topic allocation vs what filled

**Planned primary seats (allocator):**

| Seat order | Topic | Chapter | Cluster | Score |
|---|---|---|---|---|
| 1 (single) | P15 | Electromagnetic Induction and AC Circuits | electro | 1.35 |
| 2 (multiple) | P03 | Newton's Laws of Motion and Friction | mechanics | 1.32 |
| 3 (integer) | P19 | Modern Physics | modern | 1.32 |
| 4 (match) | P10 | Thermal Physics | thermal | 1.30 |

**What actually locked:**

| Paper # | Type | Topic | Chapter | Why this chapter |
|---|---|---|---|---|
| Q1 | single | **P14** | Magnetic Effects of Current and Magnetism | Replacement after P15 timeout |
| Q2 | multiple | P03 | Newton's Laws… | As planned |
| Q3 | integer | P19 | Modern Physics | As planned |
| Q4 | match | P10 | Thermal Physics | As planned |

P14 came from the **unused topic pool** inside `fillType` because `kept.length < need` for single after P15 dropped. That is why logs show **5 attempts** for a **4-question** paper.

---

## 5. Timeline (IST)

Job window: **12:14:02 – 12:28:07** (14 min 5 s).

| Time (IST) | Event |
|---|---|
| 12:14:02 | Job start · plan 4Q |
| 12:14:02 | Attempt 1 — single **P15** generate |
| 12:14:30 | P15 generated (~27 s) → Luna verify starts |
| 12:17:30 | Luna **timeout 180 s** → P15 dropped |
| 12:17:30 | Attempt 2 — single **P14** starts (replacement) |
| 12:20:00 | P14 expanded · paper 1/4 |
| 12:20:00 | Attempt 3 — multiple **P03** |
| 12:23:16 | P03 expanded · paper 2/4 |
| 12:23:16 | Attempt 4 — integer **P19** |
| 12:25:32 | P19 expanded · paper 3/4 |
| 12:25:32 | Attempt 5 — match **P10** |
| 12:28:07 | P10 expanded · paper 4/4 · **JOB_DONE** |

---

## 6. Per-question timing

### Attempt summary

| # | Topic | Type | Writer | Luna | Expand | Wall | Outcome |
|---|---|---|---|---|---|---|---|
| — | P15 EMI | single | 27 s | **180 s timeout** | — | **~3 min 27 s** | **DROPPED** |
| Q1 | P14 Magnetic | single | 63 s | 17 s | 70 s | **~2 min 30 s** | PASS |
| Q2 | P03 Newton | multiple | 60 s | 61 s | 74 s | **~3 min 15 s** | PASS |
| Q3 | P19 Modern | integer | 48 s | 16 s | 72 s | **~2 min 16 s** | PASS |
| Q4 | P10 Thermal | match | 75 s | 73 s | 7 s | **~2 min 36 s** | PASS |

| Metric | Value |
|---|---|
| Full job wall | **14 min 5 s** |
| Wasted on P15 | **~3.5 min** (~25% of wall) |
| Successful 4 only | **~10.5 min** (12:17:30 → 12:28:07) |
| Avg kept question | **~2.7 min** |

Stage means (kept only):

- Writer ≈ **61 s**
- Luna ≈ **42 s** (multi/match slower)
- Expand ≈ **56 s** (P10 expand unusually fast at 7 s)

---

## 7. QC / Luna results (kept)

All four Luna responses: **`verdict: PASS`**, `proposed_key_match: true`, `ambiguous: false`, `confidence: 0.99`, `fail_reasons: []`.

| Paper | Concept slot | Writer self-score | Key | Luna derived | Option verdicts |
|---|---|---|---|---|---|
| Q1 P14 | `charged_particle_fields` | 82 | A | A | A true; B/C/D false |
| Q2 P03 | `multi_block_systems` | 85 | A,B,C | [A,B,C] | A/B/C true; D false |
| Q3 P19 | `photoelectric_broglie_wavelength` | 84 | 3 | 3 | (integer — no options) |
| Q4 P10 | `polytropic_molar_heat` | 82 | A | A | A true; B/C/D false |

Dropped P15 had writer self-score **85**, concept `sliding_rails_additional`, proposed key **A** — never verified (API timeout, not a FAIL verdict).

No Luna **content FAIL** (ambiguity / wrong key / chapter drift) on this job. Only one **infra timeout**.

---

## 8. Question content snapshot

Full stems/solutions: `FOUR-PHYSICS-QUESTIONS.txt`.

| # | Type | Key | One-line topic |
|---|---|---|---|
| Q1 | Single | A | Charged particle in crossed E & B; radius of curvature at min y |
| Q2 | Multiple | A,B,C | Blocks A/B/C with friction + string constraint |
| Q3 | Integer | 3 | Photoelectric + min de Broglie wavelength ratio → integer |
| Q4 | Match | A | Monoatomic gas processes → molar heat capacities (List I/II) |

Explanation lengths after expand: Q1 ~2.3k, Q2 ~3.7k, Q3 ~2.1k, Q4 ~0.65k chars.

---

## 9. Tokens & cost

### Totals (`tokens.json` / `JOB_DONE`)

| Model | Calls | Prompt | Completion | Reasoning | Total (incl. reasoning accounting) |
|---|---|---|---|---|---|
| `gemini-3.5-flash` | **9** | 5,106 | 7,044 | 44,250 | 56,400 |
| `gpt-5.6-luna` | **4** | 2,431 | 5,819 | 4,825 | 8,250 |
| **Combined** | **13** | 7,537 | 12,863 | 49,075 | **64,650** |

Call mix: Gemini **5 generate + 4 expand**; Luna **4 verify** (P15 verify errored — no successful Luna token row for that call).

### Per kept question (approx stage times already above)

| Q | Gemini generate+expand tokens (total field) | Luna verify total |
|---|---|---|
| P14 | gen 9,669 + exp 4,244 | 1,664 |
| P03 | gen 9,486 + exp 6,181 | 2,920 |
| P19 | gen 10,050 + exp 3,069 | 1,811 |
| P10 | gen 4,020 + exp 2,107 | 1,855 |
| P15 (dropped) | gen 7,574 only | timeout (no completion) |

### Cost estimate (ballpark)

Using approximate public rates (Gemini Flash-class input ~$0.30/1M, output+thinking ~$2.50/1M; Luna-class input ~$1.25/1M, output+reasoning ~$10/1M):

| Piece | Est. USD |
|---|---|
| Gemini | ~$0.13 |
| Luna | ~$0.11 |
| **Job total** | **~$0.24 – $0.40** |

Exact vendor invoice may differ; Maths 4Q was previously ~$0.42 under a similar method — this Physics job is in the same order of magnitude, with extra waste on the 180 s timed-out verify.

---

## 10. Failures & fill behaviour

| Item | Detail |
|---|---|
| Failures logged | **1** (`failures: 1` at JOB_DONE) |
| Reason | `luna_verify_error` — `timeout of 180000ms exceeded` |
| Slot retries on same chapter | None for P15 (next unused chapter used instead) |
| Luna content FAIL regenerations | 0 |
| Why 5 attempts | `fillType` loops while `kept.length < need`; single need=1 after P15 fail → P14 |

Code path: `fillType` in `aiPoweredTestPipeline.service.js` (`maxAttempts = need * JEE_ADV_FILL_ROUNDS`, default rounds 4).

---

## 11. Outcome / save status

| Check | Status |
|---|---|
| Pipeline | **JOB_DONE** · 4/4 expected |
| Artifacts | Generated / locked / expanded JSON for Q1–Q4; dropped JSON for P15 |
| Dump file | `FOUR-PHYSICS-QUESTIONS.txt` |
| Confirm/Save | UI showed ready; if Confirm failed, likely **duplicate `AiQuestionBank` name** (separate from generation) |

---

## 12. Bottlenecks (this run)

1. **Luna 180 s hard timeout** on P15 alone cost ~3.5 min and one wasted Gemini generate.
2. **Sequential** fill (types one after another) — no parallel seats.
3. **Expand** often ~70 s (except fast P10).
4. Multi/match Luna (~61–73 s) slower than single/integer (~16–17 s).

---

## 13. Bottom line

| | |
|---|---|
| Asked | 4 Physics (1 each type) |
| Got | 4 Luna-PASS, production-ready questions |
| Extra attempt | 1 (P15 EMI timeout → replaced by P14) |
| Time | **14m 5s** wall · **~10.5m** productive |
| Cost (est.) | **~$0.25–0.40** |
| Quality gate | 4/4 PASS @ confidence 0.99; 0 content FAILs |
