# JEE Main question papers

Add more papers here as `.json` files, then run:

```bash
cd firstedu-backend
npm run seed:jee-main
```

The seed script reads **every** `.json` file in this folder and upserts them into:

- `jeemaincompetitivepapers`
- `jeemaincompetitivequestions`

## File name

Use any name, for example:

- `JEE_Paper4.json`
- `JEE_MAIN_22Jan2026_Morning.json`

## JSON format

```json
{
  "paper_id": "JEE-MAIN-Paper4",
  "title": "JEE Main Paper 4",
  "subjects": {
    "Mathematics": [
      {
        "q": 1,
        "topic": "Matrices and Determinants",
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

- `paper_id` — unique key stored in DB (`JEE-MAIN-Paper4`)
- `title` — shown to students
- `subjects.Mathematics` / `Physics` / `Chemistry` — arrays of questions
- each question: `q`, `topic` (official JEE Main chapter), `question`, `options` (`A`–`D`), `correct`, `explanation`

Optional: `"section": "A"` on a question.
