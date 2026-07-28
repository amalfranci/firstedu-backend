/**
 * Lightweight stage telemetry for AI question-bank pipeline.
 * Writes structured JSONL under temp/ai-api-logs/telemetry/.
 */

import { mkdirSync, appendFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { pipelineTrace } from "../utils/aiApiCallLogger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TELEMETRY_DIR = join(
    __dirname,
    "..",
    "..",
    "temp",
    "ai-api-logs",
    "telemetry"
);

export const isVerificationTelemetryEnabled = () => {
    const flag = process.env.AI_QB_VERIFICATION_TELEMETRY;
    if (flag === "0" || flag === "false") return false;
    return true;
};

export const recordVerificationTelemetry = (event = {}) => {
    if (!isVerificationTelemetryEnabled()) return;
    const row = {
        ts: new Date().toISOString(),
        ...event,
    };
    try {
        mkdirSync(TELEMETRY_DIR, { recursive: true });
        const day = row.ts.slice(0, 10);
        appendFileSync(
            join(TELEMETRY_DIR, `${day}.jsonl`),
            `${JSON.stringify(row)}\n`,
            "utf8"
        );
    } catch (err) {
        // never break generation for telemetry
        pipelineTrace("TELEMETRY_WRITE_FAILED", {
            error: err?.message || String(err),
        });
    }
    pipelineTrace("VERIFICATION_TELEMETRY", {
        stage: event.stage,
        durationMs: event.durationMs,
        provider: event.provider,
        failureReason: event.failureReason,
        retryCount: event.retryCount,
    });
};

export const withStageTiming = async (stage, fn, meta = {}) => {
    const started = Date.now();
    try {
        const result = await fn();
        recordVerificationTelemetry({
            stage,
            durationMs: Date.now() - started,
            ok: true,
            ...meta,
        });
        return result;
    } catch (err) {
        recordVerificationTelemetry({
            stage,
            durationMs: Date.now() - started,
            ok: false,
            failureReason: err?.message || String(err),
            ...meta,
        });
        throw err;
    }
};
