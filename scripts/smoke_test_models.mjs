/**
 * Quick live smoke test for configured LLM models.
 * Usage: node scripts/smoke_test_models.mjs
 */
import { config } from "dotenv";
import axios from "axios";
import { GoogleGenAI } from "@google/genai";

config({ path: new URL("../.env", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1") });
// Windows path fix for fileURL
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "../.env") });

const PROMPT = 'Reply with exactly the word OK and nothing else.';
const results = [];

const record = (name, ok, detail, ms) => {
  results.push({ name, ok, detail: String(detail || "").slice(0, 180), ms });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name} (${ms}ms) — ${String(detail || "").slice(0, 120)}`);
};

async function testGemini(model) {
  const t0 = Date.now();
  try {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");
    const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const result = await genAI.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: PROMPT }] }],
      config: { temperature: 0 },
    });
    const text = (result.text || "").trim();
    if (!text) throw new Error("empty response");
    record(`gemini:${model}`, true, text, Date.now() - t0);
  } catch (e) {
    record(`gemini:${model}`, false, e?.message || e, Date.now() - t0);
  }
}

async function testOpenAI(model, { reasoning = false, effort = "medium" } = {}) {
  const t0 = Date.now();
  try {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
    const body = {
      model,
      messages: reasoning
        ? [
            { role: "developer", content: "Reply with exactly OK." },
            { role: "user", content: PROMPT },
          ]
        : [{ role: "user", content: PROMPT }],
    };
    if (reasoning) {
      body.max_completion_tokens = Number(
        process.env.OPENAI_SOLVER_MAX_TOKENS || 2048
      );
      body.reasoning_effort = effort;
    } else {
      body.temperature = 0;
      body.max_tokens = 16;
    }
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      body,
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: reasoning ? 180000 : 60000,
        validateStatus: () => true,
      }
    );
    if (res.status >= 400) {
      const msg =
        res.data?.error?.message || JSON.stringify(res.data?.error || res.data);
      throw new Error(`HTTP ${res.status}: ${msg}`);
    }
    const text = (res.data?.choices?.[0]?.message?.content || "").trim();
    if (!text) throw new Error("empty response");
    record(`openai:${model}`, true, text, Date.now() - t0);
  } catch (e) {
    record(
      `openai:${model}`,
      false,
      e?.response?.data?.error?.message || e?.message || e,
      Date.now() - t0
    );
  }
}

async function testClaude(model) {
  const t0 = Date.now();
  try {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY missing");
    // Map friendly id to API model if needed
    const apiModel =
      model === "claude-sonnet-5"
        ? "claude-sonnet-4-20250514"
        : model === "claude-sonnet-4-6"
          ? "claude-sonnet-4-20250514"
          : model === "claude-opus-4-8"
            ? "claude-opus-4-20250514"
            : model;
    const res = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: apiModel,
        max_tokens: 32,
        thinking: { type: "disabled" },
        messages: [{ role: "user", content: PROMPT }],
      },
      {
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        timeout: 90000,
        validateStatus: () => true,
      }
    );
    if (res.status >= 400) {
      const msg =
        res.data?.error?.message || JSON.stringify(res.data?.error || res.data);
      throw new Error(`HTTP ${res.status}: ${msg}`);
    }
    const text = (res.data?.content || [])
      .map((c) => c?.text || "")
      .join("")
      .trim();
    if (!text) throw new Error("empty response");
    record(`claude:${model}→${apiModel}`, true, text, Date.now() - t0);
  } catch (e) {
    record(
      `claude:${model}`,
      false,
      e?.response?.data?.error?.message || e?.message || e,
      Date.now() - t0
    );
  }
}

console.log("=== LLM smoke test ===\n");

await testGemini(process.env.GEMINI_TEXT_MODEL || "gemini-3.1-flash-lite");
await testOpenAI(process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini", {
  reasoning: false,
});
await testOpenAI(process.env.OPENAI_AUDIT_MODEL || "gpt-4o", {
  reasoning: false,
});
await testOpenAI(process.env.OPENAI_SOLVER_MODEL || "o3", {
  reasoning: true,
  effort: "medium",
});
await testOpenAI(process.env.OPENAI_SOLVER_MODEL_B || "o4-mini", {
  reasoning: true,
  effort: "medium",
});
await testOpenAI("o3-mini", { reasoning: true, effort: "medium" });
await testClaude(process.env.CLAUDE_TEXT_MODEL || "claude-sonnet-5");

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;
console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
