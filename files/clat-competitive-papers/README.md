# CLAT question papers

Add more papers here as `.json` files, then run:

```bash
cd firstedu-backend
npm run seed:clat
```

The seed script reads every `.json` file in this folder and upserts them into:

- `clatcompetitivepapers`
- `clatcompetitivequestions`

## JSON format

```json
{
  "paper_id": "CLAT-Paper6",
  "title": "CLAT Paper 6",
  "subjects": {
    "English Language": [
      {
        "q": 1,
        "topic": "Main idea and central theme",
        "passage": "Passage text...",
        "question": "Question text",
        "options": { "A": "", "B": "", "C": "", "D": "" },
        "correct": "B",
        "explanation": "..."
      }
    ],
    "Current Affairs including General Knowledge": [],
    "Legal Reasoning": [],
    "Logical Reasoning": [],
    "Quantitative Techniques": []
  }
}
```

Topics must match official CLAT UG 2026 syllabus topics
(source: `CLAT_EXAM/CLAT_2026_Syllabus.json`).
