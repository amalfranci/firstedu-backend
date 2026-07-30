/** Strip LLM draft/meta phrases — used by all generation paths. */

/** Phrases that must never appear in production explanations. */
export const META_COMMENTARY_PATTERN =
    /\b(?:re-?evaluat(?:ing|e|ion)?|re-?calculat(?:ing|e|ion)?|recomput(?:ing|e)?|correcting|correction|upon reconsideration|actually|instead|however|wait|my mistake|i made a mistake|let us correct|let'?s correct|adjusting|draft|none match|editing option)\b/i;

export const hasMetaCommentary = (text = "") =>
    META_COMMENTARY_PATTERN.test(String(text || ""));

export const stripMetaCommentary = (text = "") =>
    String(text || "")
        .replace(/\(?\s*re-?calculat(?:ing|e|ion)?[^.)]*\)?/gi, "")
        .replace(/\(?\s*re-?evaluat(?:ing|e|ion)?[^.)]*\)?/gi, "")
        .replace(/\(?\s*correcting[^.)]*\)?/gi, "")
        .replace(/\bCorrection:\s*[^.]*\./gi, "")
        .replace(/\bupon reconsideration\b[^.]*\./gi, "")
        .replace(/\bactually\b[^.]*\./gi, "")
        .replace(/\binstead\b[^.]*\./gi, "")
        .replace(/\bhowever\b[^.]*\./gi, "")
        .replace(/\bwait\b[^.]*\./gi, "")
        .replace(/\bi made a mistake\b[^.]*\./gi, "")
        .replace(/\blet us correct\b[^.]*\./gi, "")
        .replace(/\blet'?s correct\b[^.]*\./gi, "")
        .replace(/\?\s*No,[^.]*\./gi, "")
        .replace(
            /\(?\s*(?:Let'?s|let us)\s+(?:adjust|use|recalculate|recompute|try|assume|pick|choose|set|take|correct)[^.)]*\)?/gi,
            ""
        )
        .replace(
            /\bhowever,?\s+considering\b[^.]*\bcalculated\s+as\b[^.]*\./gi,
            ""
        )
        .replace(/\bhowever,?\s+considering\b[^.]*\./gi, "")
        .replace(/\bcalculated\s+as\s+[^.]*\b(?:instead|but)\b[^.]*\./gi, "")
        .replace(/\(?\s*(?:Let'?s|Adjusting|adjust)\s+(?:mass|to match|parameters|F\s+to)[^.)]*\)?/gi, "")
        .replace(/\bFinal check:[^.]*\./gi, "")
        .replace(/\bis incorrect\b[^.]*\./gi, "")
        .replace(/\busing\s+standard\s+constants[^.]*\./gi, "")
        .replace(/\b(?:let us|let's)\s+use\s+option\s+[A-D][^.]*\./gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();
