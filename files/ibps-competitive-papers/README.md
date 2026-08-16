# IBPS PO Prelims question papers

Add more papers here as `.json` files, then run:

```bash
cd firstedu-backend
npm run seed:ibps
```

The seed script reads every `.json` file in this folder and upserts them into:

- `ibpscompetitivepapers`
- `ibpscompetitivequestions`

## JSON format

```json
{
  "paper_id": "IBPS-Paper6",
  "title": "IBPS PO Prelims Paper 6",
  "subjects": {
    "English Language": [
      {
        "q": 1,
        "topic": "Reading Comprehension",
        "passage": "optional passage",
        "question": "Question text",
        "options": { "A": "", "B": "", "C": "", "D": "", "E": "" },
        "correct": "B",
        "explanation": "..."
      }
    ],
    "Quantitative Aptitude": [],
    "Reasoning Ability": []
  }
}
```

Topics must match official IBPS PO Prelims 2026 syllabus topics
(source: `IBPS/IBPS_2026_Syllabus.json`).
