# Approximate: GPT-5.6 Terra High vs Luna High

Projection only — based on your **8 kept** Maths + Physics questions (Luna High verify token logs). Gemini write/expand unchanged. **Not** a live Terra benchmark.

**Rates used (OpenAI list, short context, Jul 30 2026 cut):**

| Model | Input / 1M | Output / 1M |
|---|---|---|
| `gpt-5.6-luna` | $0.20 | $1.20 |
| `gpt-5.6-terra` | $2.00 | $12.00 (**10×**) |
| `gemini-3.5-flash` | $1.50 | $9.00 (thinking = output) |

Billing assumption: verify `promptTokens` = input; `completionTokens + reasoningTokens` = output.

---

## Per-question price (approx)

| Question | Gemini write+expand | Verify Luna | Verify Terra (same tokens) | **Total Luna** | **Total Terra** |
|---|---|---|---|---|---|
| M13 single | $0.131 | $0.003 | $0.027 | **$0.134** | **$0.158** |
| M02 multiple | $0.106 | $0.002 | $0.016 | **$0.107** | **$0.121** |
| M08 integer | $0.080 | $0.001 | $0.013 | **$0.081** | **$0.093** |
| M16 match | $0.100 | $0.004 | $0.042 | **$0.104** | **$0.142** |
| P14 single | $0.118 | $0.002 | $0.025 | **$0.120** | **$0.143** |
| P03 multiple | $0.132 | $0.005 | $0.051 | **$0.137** | **$0.184** |
| P19 integer | $0.110 | $0.003 | $0.028 | **$0.113** | **$0.138** |
| P10 match | $0.045 | $0.003 | $0.028 | **$0.048** | **$0.074** |
| **Average** | **~$0.103** | **~$0.003** | **~$0.029** | **~$0.11** | **~$0.13** |

**Takeaway:** Terra verify is ~**10×** Luna verify, but full question cost only rises ~**20–30%** (~+$0.02–0.03), because Gemini is ~90%+ of spend today.

If Terra High uses ~1.5× more reasoning tokens, avg total ≈ **~$0.14 / Q**.

---

## Per-question timing (approx)

Writer + expand stay the same. Only verify latency may change. Luna is OpenAI’s fastest GPT-5.6 tier; Terra is the balanced mid tier — so verify may be similar or slower at `high`.

| Scenario | Avg verify | Avg wall / Q |
|---|---|---|
| **Luna High (measured)** | ~35 s | **~2.3 min** |
| Terra High @ **same** latency | ~35 s | ~2.3 min |
| Terra High @ **1.5×** verify | ~52 s | **~2.6 min** |
| Terra High @ **2×** verify | ~70 s | **~2.9 min** |

Match/multi already 60–80s on Luna — those seats move most if Terra is slower.

### 4-question paper (kept seats only)

| Paper | Luna (actual) | Terra @1.5× verify | Terra @2× verify |
|---|---|---|---|
| Maths 4Q | **8m 11s** · ~$0.43 | ~**9.1 min** · ~$0.51 | ~**10.1 min** · ~$0.51 |
| Physics 4Q kept | ~**10.6 min** · ~$0.42 | ~**12.0 min** · ~$0.54 | ~**13.4 min** · ~$0.54 |

Physics wall with the EMI timeout (14m 5s) is separate; Terra does not remove that risk if a verify still hits the 180s cap.

---

## Bottom line

| | Luna High (now) | Terra High (est.) |
|---|---|---|
| **$/question** | **~$0.11** | **~$0.13** (same tokens) |
| **Verify-only $/Q** | ~$0.003 | ~$0.029 (**10×**) |
| **Minutes / question** | **~2.3** | **~2.6–2.9** (if verify 1.5–2× slower) |
| **4Q paper $** | ~$0.42–0.43 | ~$0.51–0.54 |

Terra buys stronger mid-tier verify, not speed. Expect modestly higher wall time and ~25% higher $ per finished question — not a 10× paper cost.
