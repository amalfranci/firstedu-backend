/**
 * Smoke-check GEMINI_API_KEY, OPENAI_API_KEY, MONGODB_URI from .env
 * Does NOT print full secrets.
 *
 *   node scripts/smoke-check-env-keys.mjs
 */
import dotenv from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import axios from "axios";
import { GoogleGenAI } from "@google/genai";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

const mask = (v) => {
    const s = String(v || "");
    if (!s) return "(missing)";
    if (s.length <= 10) return "***";
    return `${s.slice(0, 6)}…${s.slice(-4)} (len=${s.length})`;
};

const results = [];
const rec = (name, ok, detail, ms) => {
    results.push({ name, ok, detail: String(detail || "").slice(0, 220), ms });
    const mark = ok ? "PASS" : "FAIL";
    console.log(
        `${mark} | ${name} | ${ms != null ? `${ms}ms | ` : ""}${String(detail || "").slice(0, 180)}`
    );
};

console.log("=== Credential presence (masked) ===");
console.log("GEMINI_API_KEY :", mask(process.env.GEMINI_API_KEY));
console.log("OPENAI_API_KEY :", mask(process.env.OPENAI_API_KEY));
console.log("MONGODB_URI    :", mask(process.env.MONGODB_URI));
console.log("DB_NAME        :", process.env.DB_NAME || "(default)");
console.log("GEMINI_HARD    :", process.env.GEMINI_HARD_TEXT_MODEL || "(unset)");
console.log("OPENAI_SOLVER  :", process.env.OPENAI_SOLVER_MODEL || "(unset)");
console.log("");

// 1) Gemini
{
    const t0 = Date.now();
    try {
        if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");
        const model =
            process.env.GEMINI_HARD_TEXT_MODEL ||
            process.env.GEMINI_TEXT_MODEL ||
            "gemini-3.5-flash";
        const genAI = new GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY,
            httpOptions: { timeout: 45000 },
        });
        const result = await genAI.models.generateContent({
            model,
            contents: [
                {
                    role: "user",
                    parts: [
                        {
                            text: "Reply with exactly the word OK and nothing else.",
                        },
                    ],
                },
            ],
            config: { temperature: 0 },
        });
        const text = String(result.text || "").trim();
        if (!text) throw new Error(`empty response from model ${model}`);
        rec(
            `Gemini API (${model})`,
            true,
            `response="${text.slice(0, 40)}"`,
            Date.now() - t0
        );
    } catch (e) {
        rec("Gemini API", false, e?.message || e, Date.now() - t0);
    }
}

// 2) OpenAI chat
{
    const t0 = Date.now();
    try {
        if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
        const model = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
        const res = await axios.post(
            "https://api.openai.com/v1/chat/completions",
            {
                model,
                messages: [
                    {
                        role: "user",
                        content: "Reply with exactly the word OK and nothing else.",
                    },
                ],
                max_tokens: 16,
                temperature: 0,
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                    "Content-Type": "application/json",
                },
                timeout: 45000,
                validateStatus: () => true,
            }
        );
        if (res.status >= 400) {
            const msg =
                res.data?.error?.message ||
                JSON.stringify(res.data?.error || res.data).slice(0, 180);
            throw new Error(`HTTP ${res.status}: ${msg}`);
        }
        const text = String(
            res.data?.choices?.[0]?.message?.content || ""
        ).trim();
        if (!text) throw new Error("empty response");
        rec(
            `OpenAI chat (${model})`,
            true,
            `response="${text.slice(0, 40)}"`,
            Date.now() - t0
        );
    } catch (e) {
        rec("OpenAI chat", false, e?.message || e, Date.now() - t0);
    }
}

// 3) OpenAI solver (o-series)
{
    const t0 = Date.now();
    try {
        if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
        const model = process.env.OPENAI_SOLVER_MODEL || "o4-mini";
        const res = await axios.post(
            "https://api.openai.com/v1/chat/completions",
            {
                model,
                messages: [
                    { role: "developer", content: "Reply with exactly OK." },
                    {
                        role: "user",
                        content: "Reply with exactly the word OK and nothing else.",
                    },
                ],
                max_completion_tokens: 64,
                reasoning_effort: "low",
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                    "Content-Type": "application/json",
                },
                timeout: 90000,
                validateStatus: () => true,
            }
        );
        if (res.status >= 400) {
            const msg =
                res.data?.error?.message ||
                JSON.stringify(res.data?.error || res.data).slice(0, 180);
            throw new Error(`HTTP ${res.status}: ${msg}`);
        }
        const text = String(
            res.data?.choices?.[0]?.message?.content ||
                res.data?.choices?.[0]?.message?.refusal ||
                ""
        ).trim();
        rec(
            `OpenAI solver (${model})`,
            true,
            `response="${(text || "(HTTP OK, empty content)").slice(0, 40)}"`,
            Date.now() - t0
        );
    } catch (e) {
        rec("OpenAI solver", false, e?.message || e, Date.now() - t0);
    }
}

// 4) MongoDB
{
    const t0 = Date.now();
    try {
        if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI missing");
        await mongoose.connect(process.env.MONGODB_URI, {
            dbName: process.env.DB_NAME || undefined,
            serverSelectionTimeoutMS: 15000,
        });
        await mongoose.connection.db.admin().ping();
        const dbName = mongoose.connection.name;
        const host = mongoose.connection.host;
        await mongoose.connection.close();
        rec(
            "MongoDB",
            true,
            `ping ok · db=${dbName} · host=${host}`,
            Date.now() - t0
        );
    } catch (e) {
        try {
            await mongoose.connection.close();
        } catch {
            /* ignore */
        }
        rec("MongoDB", false, e?.message || e, Date.now() - t0);
    }
}

console.log("");
console.log("=== SUMMARY ===");
const pass = results.filter((r) => r.ok).length;
const fail = results.filter((r) => !r.ok).length;
console.log(`${pass} passed · ${fail} failed`);
for (const r of results) {
    console.log(`${r.ok ? "OK" : "FAIL"}  ${r.name}`);
}
process.exit(fail > 0 ? 1 : 0);
