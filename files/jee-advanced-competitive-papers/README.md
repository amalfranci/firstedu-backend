# JEE Advanced question papers

Add more papers here as `.json` files, then run:

```bash
cd firstedu-backend
npm run seed:jee-advanced
```

The seed script reads **every** `.json` file in this folder and upserts them into:

- `jeeadvancedcompetitivepapers`
- `jeeadvancedcompetitivequestions`

## File name

Use any name, for example:

- `JEE-ADVANCED-Paper6.json`
- `JEE_ADVANCED_paper6.json`

## JSON format

```json
{
  "paper_id": "JEE-ADVANCED-Paper6",
  "title": "JEE Advanced Paper 6",
  "subjects": {
    "Mathematics": [
      {
        "q": 1,
        "topic": "Complex Numbers",
        "question": "Question text here",
        "options": {
          "A": "option A",
          "B": "option B",
          "C": "option C",
          "D": "option D"
        },
        "correct": "A",
        "explanation": "Step-by-step solution"
      }
    ],
    "Physics": [],
    "Chemistry": []
  }
}
```

Required fields:

- `paper_id` — unique key stored in DB (`JEE-ADVANCED-Paper6`)
- `title` — shown to students
- `subjects.Mathematics` / `Physics` / `Chemistry` — arrays of questions
- each question: `q`, `topic` (official JEE Advanced 2026 chapter), `question`, `options` (`A`–`D`), `correct`, `explanation`

Topics must match official JEE Advanced 2026 syllabus chapters
(same as 2025; source: jeeadv.ac.in).
