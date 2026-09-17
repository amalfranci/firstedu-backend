# JEE Advanced Mathematics — full generation report

**Job ID:** `apt-4b887f5e-51a3-4a6c-94da-b5c00c060955`  
**When:** 17 September 2026, **10:58:39 – 11:06:50 IST** (05:28:39 – 05:36:50 UTC)  
**Wall clock:** **8 minutes 11 seconds**  
**Requested:** 4 Mathematics questions  
**Delivered:** **4/4 locked + expanded** (ready to confirm)  
**Attempts:** **4** (no drops / no replacements)

Source files:

- `temp/paper-jobs/apt-4b887f5e-51a3-4a6c-94da-b5c00c060955/pipeline.jsonl`
- `temp/paper-jobs/apt-4b887f5e-51a3-4a6c-94da-b5c00c060955/tokens.json`
- `temp/paper-jobs/apt-4b887f5e-51a3-4a6c-94da-b5c00c060955/questions/`
- `temp/paper-jobs/apt-4b887f5e-51a3-4a6c-94da-b5c00c060955/FOUR-MATHS-QUESTIONS.txt`
- `temp/paper-jobs/apt-4b887f5e-51a3-4a6c-94da-b5c00c060955/generated-paper.json`

---

## 1. What you asked for

| Setting | Value |
|---|---|
| Exam | JEE Advanced Paper 1, hard |
| Subject | Mathematics only |
| Total | **4** |
| Type mix | **1 single + 1 multiple + 1 integer + 1 match** |
| Topic pool | All Maths chapters in the seed list |
| Marks | 4 per type; negative 1 |

`JOB_START` / `PLAN_COUNTS` / `JOB_DONE` all show `expected: 4` and `failures: 0`.

---

## 2. End-to-end process (this run)

```
USER wizard (Maths 4, types 1+1+1+1)
        │
        ▼
1. BACKEND TOPIC ALLOCATOR  (no LLM)
   Ranked pool → seats: M13, M02, M08, M16
   (clusters: geometry / algebra / probability / calculus)
        │
        ▼
2. FILL BY TYPE  (sequential)
   single → multiple → integer → match
        │
        ▼
   FOR EACH SEAT (all passed first try)
3. GENERATE  — gemini-3.5-flash
4. LUNA VERIFY  — gpt-5.6-luna (high, timeout 180s)
5. EXPAND  — gemini-3.5-flash (locked key)
6. CHECKPOINT
```

Same pipeline as Physics; this Maths job had **zero** Luna timeouts and **zero** content FAILs.

---

## 3. Models used

| Stage | Model | Notes |
|---|---|---|
| Topic allocation | Backend only | Instant |
| Write | `gemini-3.5-flash` | 4 generate calls |
| Verify | `gpt-5.6-luna` high | 4/4 PASS |
| Expand | `gemini-3.5-flash` | 4 expand calls |
| Dual o4/o3 | **Not used** | Single Luna lock |

Trust on all items: **`LUNA-VERIFY`** / `production_luna` / `productionReady: true`.

---

## 4. Topic allocation (= filled)

| Paper # | Type | Topic | Chapter | Cluster | Allocator score |
|---|---|---|---|---|---|
| Q1 | single | M13 | Conic Sections (Parabola, Ellipse, Hyperbola) | geometry | 1.37 |
| Q2 | multiple | M02 | Complex Numbers | algebra | 1.36 |
| Q3 | integer | M08 | Probability | probability | 1.36 |
| Q4 | match | M16 | Applications of Derivatives | calculus | 1.36 |

Planned seats = filled seats. No unused-pool replacement.

---

## 5. Timeline (IST)

Job window: **10:58:39 – 11:06:50** (8 min 11 s).

| Time (IST) | Event |
|---|---|
| 10:58:39 | Job start · plan 4Q |
| 10:58:39 | single **M13** generate |
| 10:59:50 | M13 expanded · paper 1/4 |
| 10:59:50 | multiple **M02** generate |
| 11:03:13 | M02 expanded · paper 2/4 |
| 11:03:13 | integer **M08** generate |
| 11:04:25 | M08 expanded · paper 3/4 |
| 11:04:25 | match **M16** generate |
| 11:06:50 | M16 expanded · paper 4/4 · **JOB_DONE** |

---

## 6. Per-question timing

| # | Topic | Type | Writer | Luna | Expand | Wall | Outcome |
|---|---|---|---|---|---|---|---|
| Q1 | M13 Conics | single | 42 s | 15 s | 14 s | **~1 min 11 s** | PASS · A |
| Q2 | M02 Complex | multiple | 52 s | 9 s | **141 s** | **~3 min 23 s** | PASS · A,B,C,D |
| Q3 | M08 Probability | integer | 51 s | 10 s | 12 s | **~1 min 12 s** | PASS · 8 |
| Q4 | M16 AoD | match | 53 s | **78 s** | 14 s | **~2 min 25 s** | PASS · A |

| Metric | Value |
|---|---|
| Full job wall | **8 min 11 s** |
| Failures / drops | **0** |
| Avg per question | **~2.0 min** |
| Slowest stage | Q2 expand **141 s** (~47% of that question) |
| Slowest Luna | Q4 match **78 s** |

Stage means:

- Writer ≈ **49 s**
- Luna ≈ **28 s**
- Expand ≈ **45 s** (skewed by Q2)

---

## 7. QC / Luna results

All four: **`verdict: PASS`**, `proposed_key_match: true`, `ambiguous: false`, `fail_reasons: []`.

| Paper | Concept slot | Writer self-score | Key | Luna derived | Confidence |
|---|---|---|---|---|---|
| Q1 M13 | `common_tangent_conics` | 85 | A | A | 0.99 |
| Q2 M02 | `apollonius_locus_properties` | 82 | A,B,C,D | [A,B,C,D] | 1.0 |
| Q3 M08 | `model_recursion` | 80 | 8 | 8 | 1.0 |
| Q4 M16 | `proving_inequality_rolle` | 84 | A | A | 1.0 |

Option verdicts:

- Q1: A true; B/C/D false  
- Q2: A/B/C/D all true  
- Q3: integer (no options)  
- Q4: A true; B/C/D false  

No Luna content FAIL. No verify timeout.

---

## 8. Question content snapshot

Full stems/solutions: `FOUR-MATHS-QUESTIONS.txt`.

| # | Type | Key | One-line topic |
|---|---|---|---|
| Q1 | Single | A | Confocal parabola/ellipse common tangent; area of △FAB |
| Q2 | Multiple | A,B,C,D | Apollonius locus \|z−3\|=2\|z−3i\| circle properties |
| Q3 | Integer | 8 | Urn Markov expected steps (2R+2B draw/replace process) |
| Q4 | Match | A | AoD / MVT–Rolle style List I ↔ List II |

Explanation lengths after expand: Q1 ~2.6k, Q2 ~2.7k, Q3 ~1.6k, Q4 ~3.9k chars.

---

## 9. Tokens & cost

### Totals (`tokens.json` / `JOB_DONE`)

| Model | Calls | Prompt | Completion | Reasoning | Total (acct.) |
|---|---|---|---|---|---|
| `gemini-3.5-flash` | **8** | 4,437 | 7,286 | 38,271 | 49,994 |
| `gpt-5.6-luna` | **4** | 2,244 | 4,378 | 3,395 | 6,622 |
| **Combined** | **12** | 6,681 | 11,664 | 41,666 | **56,616** |

Call mix: Gemini **4 generate + 4 expand**; Luna **4 verify**.

### Per-call timings already above; notable token spikes

| Q | Generate total | Luna total | Expand total |
|---|---|---|---|
| M13 | 11,737 | 1,775 | 3,641 |
| M02 | 5,930 | 1,280 | 6,707 |
| M08 | 6,556 | 1,037 | 3,154 |
| M16 | 7,606 | 2,530 | 4,663 |

### Cost estimate (ballpark)

Same rate assumptions as Physics report (Flash-class in ~$0.30/1M, out+think ~$2.50/1M; Luna in ~$1.25/1M, out+reason ~$10/1M):

| Piece | Est. USD |
|---|---|
| Gemini | ~$0.12 |
| Luna | ~$0.08 |
| **Job total** | **~$0.20 – $0.42** |

Earlier conversation quote for this Maths run was **~$0.42** under a similar method — treat **~$0.20–0.42** as the range.

---

## 10. Failures & fill behaviour

| Item | Detail |
|---|---|
| Failures logged | **0** |
| Drops | **0** |
| Extra attempts | **0** (exactly 4 attempts for 4 seats) |
| fillType replacements | None |

---

## 11. Outcome

| Check | Status |
|---|---|
| Pipeline | **JOB_DONE** · 4/4 expected |
| Artifacts | generated / locked / expanded for all 4 |
| Dump file | `FOUR-MATHS-QUESTIONS.txt` |
| Confirm status | ready to confirm · 4/4 locked |

---

## 12. Bottlenecks (this run)

1. **Q2 expand took 141 s** — largest single stage; drove most of the multi wall time.
2. **Q4 Luna match verify 78 s** — slowest verify (still well under 180 s timeout).
3. Sequential type fill — no parallel seats.
4. Otherwise clean: writer ~50 s and most Luna verifies ~9–15 s.

---

## 13. Maths vs Physics (same day, same pipeline)

| | Maths 4Q | Physics 4Q |
|---|---|---|
| Job | `apt-4b887f5e-…` | `apt-41954457-…` |
| Wall | **8m 11s** | **14m 5s** |
| Attempts | 4 | 5 (1 EMI timeout) |
| Failures | 0 | 1 (`luna_verify_error`) |
| Productive fill | full window | ~10.5m of 14m |
| Gemini calls | 8 | 9 |
| Luna calls | 4 | 4 (+1 timed-out request) |
| Est. cost | ~$0.20–0.42 | ~$0.25–0.40 |

Physics was slower mainly because of the **180 s P15 timeout** plus generally longer expands (~70 s), not because Maths asked for fewer questions.

---

## 14. Bottom line

| | |
|---|---|
| Asked | 4 Maths (1 each type) |
| Got | 4 Luna-PASS, production-ready questions |
| Extra attempts | **0** |
| Time | **8m 11s** |
| Cost (est.) | **~$0.20–0.42** |
| Quality gate | 4/4 PASS; confidence 0.99–1.0; 0 FAILs / 0 timeouts |
