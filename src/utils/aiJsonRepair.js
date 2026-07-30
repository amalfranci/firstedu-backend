/** Utilities to parse and repair JSON from LLM responses. */

export const cleanAIResponse = (responseText) => {
    let cleaned = String(responseText || "").trim();
    cleaned = cleaned.replace(/```json\s*/gi, "");
    cleaned = cleaned.replace(/```\s*/g, "");
    return cleaned.trim().replace(/^\uFEFF/, "");
};

/**
 * Robust JSON parse for LLM output (objects or arrays).
 * Strips markdown fences, then falls back to first {...} or [...] extract.
 */
export const safeJsonParse = (rawResponse) => {
    const raw = String(rawResponse ?? "");
    try {
        const cleaned = raw
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();
        return JSON.parse(cleanAIResponse(cleaned));
    } catch (err) {
        const match = raw.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
        if (match) {
            try {
                return JSON.parse(match[0]);
            } catch {
                /* fall through */
            }
            try {
                return JSON.parse(repairAIJsonString(match[0]));
            } catch {
                /* fall through */
            }
        }
        const err2 = new Error(
            `Failed to parse AI response: ${err?.message || "Invalid JSON"}`
        );
        err2.cause = err;
        throw err2;
    }
};

/** Parse LLM JSON that may be a bare object or a one-element array. */
export const parseJsonFlexibleFromAIText = (rawText) => {
    try {
        const parsed = safeJsonParse(rawText);
        if (Array.isArray(parsed)) return parsed[0] ?? null;
        if (parsed && typeof parsed === "object") return parsed;
        return null;
    } catch {
        try {
            return parseJsonObjectFromAIText(rawText);
        } catch {
            try {
                const arr = parseJsonArrayFromAIText(rawText);
                return Array.isArray(arr) ? arr[0] ?? null : null;
            } catch {
                return null;
            }
        }
    }
};

const normalizeSmartQuotes = (str) =>
    String(str || "")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2018\u2019]/g, "'");

/**
 * Escape unescaped double quotes inside JSON string values.
 * e.g. "explanation": "He said "no"" → escaped inner quotes
 */
export const fixUnescapedQuotesInJsonStrings = (str) => {
    let result = "";
    let inString = false;
    let escaped = false;

    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (!inString) {
            result += ch;
            if (ch === '"') inString = true;
            continue;
        }
        if (escaped) {
            result += ch;
            escaped = false;
            continue;
        }
        if (ch === "\\") {
            result += ch;
            escaped = true;
            continue;
        }
        if (ch === '"') {
            let j = i + 1;
            while (j < str.length && /\s/.test(str[j])) j++;
            const next = str[j];
            if (
                next === undefined ||
                next === "," ||
                next === "}" ||
                next === "]" ||
                next === ":"
            ) {
                result += ch;
                inString = false;
            } else {
                result += '\\"';
            }
            continue;
        }
        result += ch;
    }
    if (inString) result += '"';
    return result;
};

/** Extract a complete {...} object starting at index start. */
const extractJsonObjectAt = (str, start) => {
    if (str[start] !== "{") return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < str.length; i++) {
        const ch = str[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === "{") depth++;
        else if (ch === "}") {
            depth--;
            if (depth === 0) return str.slice(start, i + 1);
        }
    }
    return str.slice(start);
};

/**
 * Salvage-parse top-level objects from a broken JSON array.
 * @returns {unknown[]}
 */
export const salvageParseJsonArrayObjects = (rawText) => {
    const preprocessed = fixUnescapedQuotesInJsonStrings(
        escapeControlCharsInJsonStrings(normalizeSmartQuotes(cleanAIResponse(rawText)))
    );
    const source =
        extractJsonArraySubstring(preprocessed) || preprocessed;
    const start = source.indexOf("[");
    if (start === -1) return [];

    const items = [];
    let i = start + 1;

    while (i < source.length) {
        while (i < source.length && /[\s,]/.test(source[i])) i++;
        if (i >= source.length || source[i] === "]") break;
        if (source[i] !== "{") {
            i++;
            continue;
        }

        const chunk = extractJsonObjectAt(source, i);
        if (!chunk) break;

        const repairs = [
            () => chunk,
            () => repairAIJsonString(chunk, "object"),
            () =>
                repairAIJsonString(
                    fixUnescapedQuotesInJsonStrings(
                        escapeControlCharsInJsonStrings(normalizeSmartQuotes(chunk))
                    ),
                    "object"
                ),
        ];

        let parsed = null;
        for (const build of repairs) {
            try {
                parsed = JSON.parse(build());
                break;
            } catch {
                /* try next repair */
            }
        }

        if (parsed && typeof parsed === "object") items.push(parsed);
        i += chunk.length;
    }

    return items;
};

/**
 * Walk JSON text and escape raw control characters inside string literals.
 */
export const escapeControlCharsInJsonStrings = (str) => {
    let result = "";
    let inString = false;
    let escaped = false;

    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (!inString) {
            result += ch;
            if (ch === '"') inString = true;
            continue;
        }
        if (escaped) {
            result += ch;
            escaped = false;
            continue;
        }
        if (ch === "\\") {
            result += ch;
            escaped = true;
            continue;
        }
        if (ch === '"') {
            result += ch;
            inString = false;
            continue;
        }
        if (ch === "\n") result += "\\n";
        else if (ch === "\r") result += "\\r";
        else if (ch === "\t") result += "\\t";
        else result += ch;
    }
    if (inString) result += '"';
    return result;
};

/**
 * Fix invalid escape sequences inside JSON strings (common with LaTeX: \frac, \sin).
 */
export const fixInvalidBackslashEscapesInJsonStrings = (str) => {
    let result = "";
    let inString = false;
    let escaped = false;

    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (!inString) {
            result += ch;
            if (ch === '"') inString = true;
            continue;
        }
        if (escaped) {
            result += ch;
            escaped = false;
            continue;
        }
        if (ch === "\\") {
            const next = str[i + 1];
            if (next === undefined) {
                result += "\\\\";
                continue;
            }
            if (next === "u") {
                const hex = str.slice(i + 2, i + 6);
                if (/^[0-9a-fA-F]{4}$/.test(hex)) {
                    result += ch;
                    escaped = true;
                    continue;
                }
                result += "\\\\";
                continue;
            }
            if ('"\\/bfnrt'.includes(next)) {
                result += ch;
                escaped = true;
                continue;
            }
            result += "\\\\";
            continue;
        }
        if (ch === '"') {
            result += ch;
            inString = false;
            continue;
        }
        result += ch;
    }
    return result;
};

/** Remove trailing commas before } or ]. */
export const stripTrailingCommas = (str) =>
    String(str || "").replace(/,\s*([\]}])/g, "$1");

/** Trim junk after the last closing bracket/brace. */
export const trimAfterLastCloser = (str, closer) => {
    const idx = String(str || "").lastIndexOf(closer);
    if (idx === -1) return str;
    return str.slice(0, idx + 1);
};

const scanJsonStructure = (str) => {
    let depthArr = 0;
    let depthObj = 0;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === "[") depthArr++;
        else if (ch === "]") depthArr = Math.max(0, depthArr - 1);
        else if (ch === "{") depthObj++;
        else if (ch === "}") depthObj = Math.max(0, depthObj - 1);
    }

    return { depthArr, depthObj, inString };
};

/** Attempt to close truncated JSON arrays/objects. */
export const tryCloseTruncatedJson = (str) => {
    let s = String(str || "");
    const { depthArr, depthObj, inString } = scanJsonStructure(s);
    if (inString) s += '"';
    let dObj = depthObj;
    let dArr = depthArr;
    while (dObj > 0) {
        s += "}";
        dObj--;
    }
    while (dArr > 0) {
        s += "]";
        dArr--;
    }
    return s;
};

/** Extract outermost JSON array respecting strings and nesting. */
export const extractJsonArraySubstring = (text) => {
    const cleaned = cleanAIResponse(text);
    const start = cleaned.indexOf("[");
    if (start === -1) return cleaned;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < cleaned.length; i++) {
        const ch = cleaned[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === "[") depth++;
        else if (ch === "]") {
            depth--;
            if (depth === 0) return cleaned.slice(start, i + 1);
        }
    }

    return cleaned.slice(start);
};

/** Extract outermost JSON object respecting strings and nesting. */
export const extractJsonObjectSubstring = (text) => {
    const cleaned = cleanAIResponse(text);
    const start = cleaned.indexOf("{");
    if (start === -1) return cleaned;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < cleaned.length; i++) {
        const ch = cleaned[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === "{") depth++;
        else if (ch === "}") {
            depth--;
            if (depth === 0) return cleaned.slice(start, i + 1);
        }
    }

    return cleaned.slice(start);
};

/**
 * Apply common repairs for LLM JSON output.
 * @param {string} raw
 * @param {'array'|'object'} kind
 */
export const repairAIJsonString = (raw, kind = "array") => {
    const closer = kind === "object" ? "}" : "]";
    let s = normalizeSmartQuotes(cleanAIResponse(raw));
    s = fixUnescapedQuotesInJsonStrings(s);
    s = escapeControlCharsInJsonStrings(s);
    s = fixInvalidBackslashEscapesInJsonStrings(s);
    s = stripTrailingCommas(s);
    s = trimAfterLastCloser(s, closer);
    s = tryCloseTruncatedJson(s);
    s = stripTrailingCommas(s);
    return s;
};

/**
 * Try multiple strategies to parse JSON array from AI text.
 * @returns {unknown[]}
 */
export const parseJsonArrayFromAIText = (rawText) => {
    const builders = [
        () => cleanAIResponse(rawText),
        () => extractJsonArraySubstring(rawText),
        () => repairAIJsonString(cleanAIResponse(rawText), "array"),
        () => repairAIJsonString(extractJsonArraySubstring(rawText), "array"),
        () =>
            repairAIJsonString(
                extractJsonArraySubstring(repairAIJsonString(rawText, "array")),
                "array"
            ),
    ];

    let lastError;
    for (const build of builders) {
        try {
            const parsed = JSON.parse(build());
            if (Array.isArray(parsed)) return parsed;
            lastError = new Error("Response is not a JSON array");
        } catch (e) {
            lastError = e;
        }
    }

    const salvaged = salvageParseJsonArrayObjects(rawText);
    if (salvaged.length > 0) return salvaged;

    const err = new Error(
        `Failed to parse AI response: ${lastError?.message || "Invalid JSON"}. Please try again.`
    );
    err.cause = lastError;
    throw err;
};

/**
 * Try multiple strategies to parse JSON object from AI text.
 * @returns {Record<string, unknown>}
 */
export const parseJsonObjectFromAIText = (rawText) => {
    const builders = [
        () => cleanAIResponse(rawText),
        () => extractJsonObjectSubstring(rawText),
        () => repairAIJsonString(cleanAIResponse(rawText), "object"),
        () => repairAIJsonString(extractJsonObjectSubstring(rawText), "object"),
    ];

    let lastError;
    for (const build of builders) {
        try {
            const parsed = JSON.parse(build());
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return parsed;
            }
            lastError = new Error("Response is not a JSON object");
        } catch (e) {
            lastError = e;
        }
    }

    const salvaged = salvageParseJsonArrayObjects(rawText);
    if (salvaged.length > 0) {
        const skIdx = String(rawText || "").indexOf('"skeletons"');
        if (skIdx >= 0) return { skeletons: salvaged };
    }

    const err = new Error(
        `Failed to parse AI JSON object: ${lastError?.message || "Invalid JSON"}`
    );
    err.cause = lastError;
    throw err;
};
