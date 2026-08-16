# GMAT Focus question papers

Add more papers here as `.json` files, then run:

```bash
cd firstedu-backend
npm run seed:gmat
```

The seed script reads every `.json` file in this folder and upserts them into:

- `gmatcompetitivepapers`
- `gmatcompetitivequestions`

## JSON format

```json
{
  "paper_id": "GMAT-Paper6",
  "title": "GMAT Paper 6",
  "subjects": {
    "Quantitative Reasoning": [
      {
        "q": 1,
        "topic": "Ratios",
        "question": "Question text",
        "options": { "A": "", "B": "", "C": "", "D": "", "E": "" },
        "correct": "B",
        "explanation": "..."
      }
    ],
    "Verbal Reasoning": [],
    "Data Insights": []
  }
}
```

Topics must match official GMAT Focus 2026 syllabus topics
(source: `GMAT EXAM/GMAT_2026_Syllabus.json`).
