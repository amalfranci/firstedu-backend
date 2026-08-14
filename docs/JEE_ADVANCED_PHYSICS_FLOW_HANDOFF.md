# JEE Advanced Physics — Implementation Handoff

**Status:** Quality-first Stage A integrated (same stack as Advanced Maths)  
**Data pack:** `jee_advanced/physics/`  
**Service:** `src/services/jeeAdvancedPhysics.service.js`  
**Primary script:** `scripts/generate-jee-advanced-hard-physics-6-nonsingle.mjs`

---

## 1. Data pack

| File | Contents |
|------|----------|
| `physics_syllabus.json` | P01–P19 official Advanced topics |
| `physics_ncert_context.json` | concepts / formulas / methods / traps / hard_archetypes / banned_easy |
| `physics_scoring.json` | advanced_relevance (high/medium/low) |
| `physics_question_type_quotas.json` | bank quotas by type × difficulty |
| Shared pattern | `jee_advanced/jee_advanced_pattern_totals.json` |

**HIGH advanced_relevance (default quality lock):**  
P03 Laws of Motion, P05 Rotation, P10 Thermal, P11 Electrostatics, P12 Capacitance, P13 Current Electricity, P14 Magnetism, P15 EMI/AC, P17 Ray Optics, P19 Modern Physics.

---

## 2. Integration

| Component | Physics behaviour when topic/subject contains Physics + JEE Advanced |
|-----------|---------------------------------------------------------------------|
| `conceptArchetypePlanner` | Injects Advanced Physics syllabus + scoring + hard archetypes |
| `questionSolveFirst` | Writer gets Physics NCERT pack + syllabus + pattern |
| `answerCorrection` | Solver gets Physics formula/method lock |
| Main syllabus/scoring | Skipped when Advanced Physics pack owns the path |

---

## 3. Quality stack (same as Maths)

```
Plan HIGH Physics topics
  → Gemini hard generation (depth governor 2–3 ideas, ~9.2 authenticity)
  → Selective dual lock (A=o4, B when risk; no generator-as-B)
  → Recompute integer + multi
  → Trust grades
  → Insight-first explanations on finals only
```

---

## 4. How to run

```bash
cd firstedu-backend

# 6 hard non-single: multi 3 + integer 2 + match 1
node scripts/generate-jee-advanced-hard-physics-6-nonsingle.mjs --count=6

node scripts/generate-jee-advanced-hard-physics-6-nonsingle.mjs --count=6 --dual-mode=selective --min-difficulty=70
```

**Output:** `temp/jee-advanced-hard-physics-6-nonsingle/<timestamp>/`

**Requires:** `GEMINI_API_KEY`, `OPENAI_API_KEY`, `MONGODB_URI` (recommended), data under `jee_advanced/physics/`.

---

## 5. Smoke

```bash
node -e "import('./src/services/jeeAdvancedPhysics.service.js').then(m => {
  console.log('available', m.isJeeAdvancedPhysicsDataAvailable());
  console.log('high', m.getHighRelevanceAdvancedPhysicsTopics().map(t => t.topicId).join(','));
})"
```
