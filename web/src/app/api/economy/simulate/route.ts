import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { redis } from "@/lib/redis";
import { withRole } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HISTORY_KEY = "econ:sim:runs";
const HISTORY_LIMIT = 20;

type SimulationMode = "selection" | "summons";

type SelectionSummary = {
  runs: number;
  totalSelections: number;
  uniqueCharacters: number;
  watch: string;
  watchHits: number;
  watchPct: number;
  top: Array<{
    rank: number;
    characterId: number;
    name: string;
    series: string;
    hits: number;
    pct: number;
  }>;
};

type SummonSummary = {
  runs: number;
  totalCardSpawns: number;
  mysteryTokenSummons: number;
  mysteryTokenRatePct: number;
  uniqueCharactersHit: number;
  pity: {
    resetsObserved: number;
    maxObservedStreak: number;
    finalStreak: number | null;
  };
  topCharacters: Array<{
    rank: number;
    characterId: number;
    name: string;
    series: string;
    hits: number;
    pctOfCards: number;
  }>;
};

type SimulationRun = {
  id: string;
  createdAt: string;
  mode: SimulationMode;
  params: {
    runs: number;
    topN: number;
    watch: string | null;
  };
  summary: SelectionSummary | SummonSummary;
};

function asInt(value: unknown, fallback: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Simulation output did not include JSON summary");
  }
  const jsonText = text.slice(start, end + 1);
  return JSON.parse(jsonText);
}

function runScript(scriptName: string, args: string[]): Promise<unknown> {
  return new Promise((resolveResult, rejectResult) => {
    const repoRoot = resolve(process.cwd(), "..");
    const tsxBin = resolve(repoRoot, "node_modules", ".bin", "tsx");
    const scriptPath = resolve(repoRoot, "scripts", scriptName);

    const child = spawn(tsxBin, [scriptPath, ...args], {
      cwd: repoRoot,
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      rejectResult(err);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        rejectResult(
          new Error(
            `Simulation exited with code ${code}. ${stderr || stdout || "No output"}`
          )
        );
        return;
      }
      try {
        resolveResult(extractJsonObject(stdout));
      } catch (err) {
        rejectResult(err);
      }
    });
  });
}

export const GET = withRole("viewer", async (_req: NextRequest) => {
  try {
    const raw = await redis.lrange(HISTORY_KEY, 0, HISTORY_LIMIT - 1);
    const runs = raw
      .map((line) => {
        try {
          return JSON.parse(line) as SimulationRun;
        } catch {
          return null;
        }
      })
      .filter((row): row is SimulationRun => row !== null);

    return NextResponse.json({ runs });
  } catch (err) {
    return NextResponse.json(
      {
        runs: [],
        error: err instanceof Error ? err.message : "Failed to load simulation history",
      },
      { status: 500 }
    );
  }
});

export const POST = withRole("admin", async (req: NextRequest) => {
  try {
    const body = await req.json().catch(() => ({}));
    const mode: SimulationMode = body?.mode === "summons" ? "summons" : "selection";
    const runs = clamp(asInt(body?.runs, mode === "summons" ? 1000 : 1500), 10, 50_000);
    const topN = clamp(asInt(body?.topN, mode === "summons" ? 20 : 50), 5, 200);
    const watch =
      mode === "selection"
        ? String(body?.watch ?? "marin").trim().toLowerCase().slice(0, 80)
        : null;

    const summary =
      mode === "selection"
        ? await runScript("simulate-selection.ts", [String(runs), String(topN), watch || "marin"])
        : await runScript("simulate-summons.ts", [String(runs), String(topN)]);

    const run: SimulationRun = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      mode,
      params: { runs, topN, watch },
      summary: summary as SelectionSummary | SummonSummary,
    };

    await redis.lpush(HISTORY_KEY, JSON.stringify(run));
    await redis.ltrim(HISTORY_KEY, 0, HISTORY_LIMIT - 1);

    return NextResponse.json({ ok: true, run });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Simulation failed" },
      { status: 500 }
    );
  }
});
