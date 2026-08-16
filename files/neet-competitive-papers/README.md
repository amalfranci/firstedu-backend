# NEET question papers

Add more papers here as `.json` files, then run:

```bash
cd firstedu-backend
npm run seed:neet
```

The seed script reads **every** `.json` file in this folder and upserts them into:

- `neetcompetitivepapers`
- `neetcompetitivequestions`

## JSON format

```json
{
  "paper_id": "NEET-Paper6",
  "title": "NEET Paper 6",
  "subjects": {
    "Physics": [
      {
        "q": 1,
        "topic": "Kinematics",
        "question": "Question text here",
        "options": { "A": "option A", "B": "option B", "C": "option C", "D": "option D" },
        "correct": "A",
        "explanation": "Step-by-step solution"
      }
    ],
    "Chemistry": [],
    "Botany": [],
    "Zoology": []
  }
}
```

Topics must match official NEET UG 2026 syllabus chapters/units
(source: `NEET EXAM-JSON -FILE/NEET_2026_Syllabus.json` and NTA NEET UG syllabus).
