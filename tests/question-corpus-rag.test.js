import { describe, it, expect } from "@jest/globals";
import {
    normalizeTopicKey,
    normalizeSectionLabel,
    isPrefixMatch,
    bankMatchesQuery,
    resolveBankSectionIndex,
    filterCandidatesBySection,
    mergeRagMeta,
} from "../src/services/questionCorpusRag.service.js";

describe("questionCorpusRag naming normalization", () => {
    it("normalizes UI › / Mains vs ingest > / Main", () => {
        const ui =
            "Competitive › Engineering › JEE Mains › Full paper — Physics";
        const ingest = "Competitive > Engineering > JEE Main";
        expect(normalizeTopicKey(ui)).toBe(
            "competitive > engineering > jee main > full paper — physics"
        );
        expect(normalizeTopicKey(ingest)).toBe(
            "competitive > engineering > jee main"
        );
        expect(isPrefixMatch(ingest, ui)).toBe(true);
        expect(isPrefixMatch(ui, ingest)).toBe(true);
    });

    it("normalizes JEE-Mains hyphen alias", () => {
        expect(normalizeTopicKey("Competitive › Engineering › JEE-Mains")).toBe(
            "competitive > engineering > jee main"
        );
    });

    it("does not prefix-match unrelated paper titles without shared path", () => {
        expect(
            isPrefixMatch(
                "JEE Main 2019 (09 Jan Shift 1)",
                "Competitive › Engineering › JEE Mains › Full paper"
            )
        ).toBe(false);
    });
});

describe("questionCorpusRag section filtering", () => {
    it("normalizes Maths / Mathematics / Chem labels", () => {
        expect(normalizeSectionLabel("Maths")).toBe("mathematics");
        expect(normalizeSectionLabel("Mathematics")).toBe("mathematics");
        expect(normalizeSectionLabel("Chem")).toBe("chemistry");
        expect(normalizeSectionLabel("Physics")).toBe("physics");
    });

    it("resolves sectionIndex from bank.sections", () => {
        const bank = {
            sections: [
                { name: "Physics", count: 20 },
                { name: "Chemistry", count: 20 },
                { name: "Maths", count: 20 },
            ],
        };
        expect(resolveBankSectionIndex(bank, "Physics")).toBe(0);
        expect(resolveBankSectionIndex(bank, "chemistry")).toBe(1);
        expect(resolveBankSectionIndex(bank, "Mathematics")).toBe(2);
        expect(resolveBankSectionIndex(bank, "Biology")).toBe(null);
    });

    it("hard-filters candidates by sectionIndex and falls back if empty", () => {
        const banksById = new Map([
            [
                "b1",
                {
                    sections: [
                        { name: "Physics" },
                        { name: "Chemistry" },
                        { name: "Maths" },
                    ],
                },
            ],
        ]);
        const candidates = [
            { _id: "q1", aiQuestionBank: "b1", sectionIndex: 0 },
            { _id: "q2", aiQuestionBank: "b1", sectionIndex: 1 },
            { _id: "q3", aiQuestionBank: "b1", sectionIndex: 2 },
        ];

        const physics = filterCandidatesBySection(candidates, banksById, {
            sectionName: "Physics",
        });
        expect(physics.sectionFiltered).toBe(true);
        expect(physics.filtered.map((c) => c._id)).toEqual(["q1"]);

        const emptySectionBanks = new Map([
            ["b1", { sections: [{ name: "Verbal" }] }],
        ]);
        const fellBack = filterCandidatesBySection(candidates, emptySectionBanks, {
            sectionName: "Physics",
        });
        expect(fellBack.sectionFiltered).toBe(false);
        expect(fellBack.fellBack).toBe(false);
        expect(fellBack.filtered).toHaveLength(3);

        const noIndex = filterCandidatesBySection(
            [{ _id: "q9", aiQuestionBank: "b1", sectionIndex: null }],
            banksById,
            { sectionName: "Physics" }
        );
        expect(noIndex.fellBack).toBe(true);
        expect(noIndex.filtered).toHaveLength(1);
    });
});

describe("questionCorpusRag bankMatchesQuery", () => {
    it("matches via normalized generationTopic prefix", () => {
        const bank = {
            generationTopic: "Competitive > Engineering > JEE Main",
            name: "JEE Main 2019 Shift 1",
        };
        expect(
            bankMatchesQuery(bank, {
                topic: "Competitive › Engineering › JEE Mains › Full paper — Physics",
                bankName: "Competitive › Engineering › JEE Mains › Full paper",
                queryProfile: "jee_main",
            })
        ).toBe(true);
    });

    it("matches paper-title banks via exam-profile fallback", () => {
        const bank = {
            generationTopic: "",
            name: "JEE Main 2019 (09 Jan Shift 1) Previous Year Paper",
        };
        expect(
            bankMatchesQuery(bank, {
                topic: "Competitive › Engineering › JEE Mains › Full paper",
                bankName: "Competitive › Engineering › JEE Mains › Full paper",
                queryProfile: "jee_main",
            })
        ).toBe(true);
    });

    it("does not match unrelated exams on profile fallback", () => {
        const bank = {
            generationTopic: "Competitive > Medical > NEET",
            name: "NEET 2024 Paper",
        };
        expect(
            bankMatchesQuery(bank, {
                topic: "Competitive › Engineering › JEE Mains › Full paper",
                bankName: "Competitive › Engineering › JEE Mains › Full paper",
                queryProfile: "jee_main",
            })
        ).toBe(false);
    });
});

describe("mergeRagMeta", () => {
    it("aggregates hit/miss and exemplar snippets across chunks", () => {
        const a = {
            hit: false,
            reason: "no_matching_bank",
            matchedBanks: 0,
            candidateCount: 0,
            returned: 0,
            sectionFiltered: false,
            queryText: "q1",
            rejectedNearCopies: 0,
            exemplarSnippets: [],
        };
        const b = {
            hit: true,
            reason: "ok",
            matchedBanks: 3,
            candidateCount: 40,
            returned: 5,
            sectionFiltered: true,
            queryText: "q2",
            rejectedNearCopies: 1,
            exemplarSnippets: ["stem a", "stem b"],
        };
        const merged = mergeRagMeta(a, b);
        expect(merged.hit).toBe(true);
        expect(merged.matchedBanks).toBe(3);
        expect(merged.candidateCount).toBe(40);
        expect(merged.returned).toBe(5);
        expect(merged.rejectedNearCopies).toBe(1);
        expect(merged.sectionFiltered).toBe(true);
        expect(merged.exemplarSnippets).toEqual(["stem a", "stem b"]);
    });
});
