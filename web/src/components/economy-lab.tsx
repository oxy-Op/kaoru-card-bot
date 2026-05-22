"use client";

import { useEffect, useMemo, useState } from "react";

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

type FusionStats = {
  available: number;
  claimed24h: number;
  total: number;
  recent: Array<{
    id: number;
    claimedAt: string | null;
    claimSummonId: string | null;
    username: string | null;
    characterName: string | null;
    series: string | null;
  }>;
};

function fmtPercent(value: number): string {
  return `${value.toFixed(3)}%`;
}

function fmtDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

export function EconomyLab() {
  const [history, setHistory] = useState<SimulationRun[]>([]);
  const [fusionStats, setFusionStats] = useState<FusionStats | null>(null);
  const [mode, setMode] = useState<SimulationMode>("selection");
  const [runs, setRuns] = useState(1500);
  const [topN, setTopN] = useState(30);
  const [watch, setWatch] = useState("marin kitagawa");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latest = history[0] ?? null;

  async function parseApiResponse<T>(res: Response): Promise<T> {
    const raw = await res.text();
    const parsed = raw ? JSON.parse(raw) as T : ({} as T);
    if (!res.ok) {
      const message =
        typeof parsed === "object" &&
        parsed !== null &&
        "error" in parsed &&
        typeof (parsed as { error?: unknown }).error === "string"
          ? (parsed as { error: string }).error
          : `Request failed (${res.status})`;
      throw new Error(message);
    }
    return parsed;
  }

  async function loadHistory() {
    try {
      const [simRes, fusionRes] = await Promise.all([
        fetch("/api/economy/simulate", { cache: "no-store" }),
        fetch("/api/economy/fusion", { cache: "no-store" }),
      ]);
      const simData = await parseApiResponse<{ runs?: SimulationRun[] }>(simRes);
      const fusionData = await parseApiResponse<FusionStats>(fusionRes);
      setHistory(Array.isArray(simData.runs) ? simData.runs : []);
      setFusionStats(fusionData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    }
  }

  useEffect(() => {
    void loadHistory();
  }, []);

  async function runSimulation() {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        mode,
        runs,
        topN,
        watch: mode === "selection" ? watch : null,
      };
      const res = await fetch("/api/economy/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await parseApiResponse<{ ok?: boolean; run?: SimulationRun; error?: string }>(res);
      if (!data?.ok || !data.run) {
        throw new Error(data?.error ?? "Simulation failed");
      }
      const run = data.run;
      setHistory((prev) => [run, ...prev].slice(0, 20));
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      setLoading(false);
    }
  }

  const topRows = useMemo(() => {
    if (!latest) return [];
    if (latest.mode === "selection") {
      return (latest.summary as SelectionSummary).top.map((r) => ({
        key: `${r.characterId}`,
        label: `${r.name} (${r.series})`,
        hits: r.hits,
        pct: r.pct,
      }));
    }
    return (latest.summary as SummonSummary).topCharacters.map((r) => ({
      key: `${r.characterId}`,
      label: `${r.name} (${r.series})`,
      hits: r.hits,
      pct: r.pctOfCards,
    }));
  }, [latest]);

  const maxHits = topRows.length > 0 ? Math.max(...topRows.map((r) => r.hits)) : 1;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <label className="text-xs text-zinc-400">
            Mode
            <select
              className="mt-1 h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white"
              value={mode}
              onChange={(e) => setMode(e.target.value as SimulationMode)}
              disabled={loading}
            >
              <option value="selection">Selection only</option>
              <option value="summons">Full summons + pity</option>
            </select>
          </label>

          <label className="text-xs text-zinc-400">
            Runs
            <input
              type="number"
              min={10}
              max={50000}
              className="mt-1 h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white"
              value={runs}
              onChange={(e) => setRuns(Number.parseInt(e.target.value || "0", 10))}
              disabled={loading}
            />
          </label>

          <label className="text-xs text-zinc-400">
            Top rows
            <input
              type="number"
              min={5}
              max={200}
              className="mt-1 h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white"
              value={topN}
              onChange={(e) => setTopN(Number.parseInt(e.target.value || "0", 10))}
              disabled={loading}
            />
          </label>

          <label className="text-xs text-zinc-400 md:col-span-2">
            Watch text (selection mode)
            <input
              type="text"
              className="mt-1 h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white"
              value={watch}
              onChange={(e) => setWatch(e.target.value)}
              disabled={loading || mode !== "selection"}
            />
          </label>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={runSimulation}
            disabled={loading}
            className="h-10 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Running..." : "Run simulation"}
          </button>
          <button
            type="button"
            onClick={() => void loadHistory()}
            disabled={loading}
            className="h-10 rounded-lg border border-zinc-700 px-4 text-sm text-zinc-200 hover:bg-zinc-800"
          >
            Refresh history
          </button>
          {error ? <span className="text-sm text-rose-400">{error}</span> : null}
        </div>
      </section>

      {latest ? (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-4">
            <p className="text-xs text-zinc-500">Last run</p>
            <p className="mt-1 text-sm text-zinc-200">{fmtDate(latest.createdAt)}</p>
            <p className="mt-1 text-xs text-zinc-500">Mode: {latest.mode}</p>
          </div>
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-4">
            <p className="text-xs text-zinc-500">Runs</p>
            <p className="mt-1 text-2xl font-semibold text-white">{latest.params.runs}</p>
          </div>
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-4">
            <p className="text-xs text-zinc-500">
              {latest.mode === "selection" ? "Unique characters" : "Unique characters hit"}
            </p>
            <p className="mt-1 text-2xl font-semibold text-white">
              {latest.mode === "selection"
                ? (latest.summary as SelectionSummary).uniqueCharacters
                : (latest.summary as SummonSummary).uniqueCharactersHit}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-4">
            {latest.mode === "selection" ? (
              <>
                <p className="text-xs text-zinc-500">Watch hit rate</p>
                <p className="mt-1 text-2xl font-semibold text-white">
                  {fmtPercent((latest.summary as SelectionSummary).watchPct)}
                </p>
              </>
            ) : (
              <>
                <p className="text-xs text-zinc-500">Mystery token rate</p>
                <p className="mt-1 text-2xl font-semibold text-white">
                  {fmtPercent((latest.summary as SummonSummary).mysteryTokenRatePct)}
                </p>
              </>
            )}
          </div>
        </section>
      ) : null}

      {fusionStats ? (
        <section className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-4">
          <p className="text-sm font-medium text-zinc-100">Fusion Pile</p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              <p className="text-xs text-zinc-500">Available entries</p>
              <p className="mt-1 text-xl font-semibold text-white">{fusionStats.available}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              <p className="text-xs text-zinc-500">Claims (24h)</p>
              <p className="mt-1 text-xl font-semibold text-white">{fusionStats.claimed24h}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              <p className="text-xs text-zinc-500">Total entries (all-time)</p>
              <p className="mt-1 text-xl font-semibold text-white">{fusionStats.total}</p>
            </div>
          </div>

          <div className="mt-4">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Recent claims</p>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-[760px] w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500">
                    <th className="px-2 py-2">Time</th>
                    <th className="px-2 py-2">User</th>
                    <th className="px-2 py-2">Character</th>
                    <th className="px-2 py-2">Summon</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {fusionStats.recent.length === 0 ? (
                    <tr>
                      <td className="px-2 py-3 text-zinc-500" colSpan={4}>
                        No recent fusion pile claims.
                      </td>
                    </tr>
                  ) : (
                    fusionStats.recent.map((row) => (
                      <tr key={row.id}>
                        <td className="px-2 py-2 text-zinc-300">{row.claimedAt ? fmtDate(row.claimedAt) : "n/a"}</td>
                        <td className="px-2 py-2 text-zinc-300">{row.username ?? "unknown"}</td>
                        <td className="px-2 py-2 text-zinc-300">
                          {row.characterName ? `${row.characterName} (${row.series ?? "Unknown"})` : "unknown"}
                        </td>
                        <td className="px-2 py-2 font-mono text-xs text-zinc-500">{row.claimSummonId ?? "n/a"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      {latest?.mode === "summons" ? (
        <section className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-4">
          <p className="text-sm font-medium text-zinc-100">Pity stats</p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              <p className="text-xs text-zinc-500">Resets observed</p>
              <p className="mt-1 text-xl font-semibold text-white">
                {(latest.summary as SummonSummary).pity.resetsObserved}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              <p className="text-xs text-zinc-500">Max streak</p>
              <p className="mt-1 text-xl font-semibold text-white">
                {(latest.summary as SummonSummary).pity.maxObservedStreak}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              <p className="text-xs text-zinc-500">Final streak</p>
              <p className="mt-1 text-xl font-semibold text-white">
                {(latest.summary as SummonSummary).pity.finalStreak ?? "n/a"}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {topRows.length > 0 ? (
        <section className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-4">
          <p className="text-sm font-medium text-zinc-100">Top characters (latest run)</p>
          <div className="mt-4 space-y-2">
            {topRows.map((row) => (
              <div key={row.key} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                  <span className="truncate text-zinc-300">{row.label}</span>
                  <span className="tabular-nums text-zinc-500">
                    {row.hits} hits · {fmtPercent(row.pct)}
                  </span>
                </div>
                <div className="h-2 rounded bg-zinc-800">
                  <div
                    className="h-2 rounded bg-indigo-500"
                    style={{ width: `${Math.max(4, (row.hits / maxHits) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-4">
        <p className="text-sm font-medium text-zinc-100">Recent runs</p>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-[760px] w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-2 py-2">Time</th>
                <th className="px-2 py-2">Mode</th>
                <th className="px-2 py-2 text-right">Runs</th>
                <th className="px-2 py-2 text-right">Unique</th>
                <th className="px-2 py-2 text-right">Primary KPI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {history.map((run) => (
                <tr key={run.id}>
                  <td className="px-2 py-2 text-zinc-300">{fmtDate(run.createdAt)}</td>
                  <td className="px-2 py-2 text-zinc-400">{run.mode}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-zinc-300">{run.params.runs}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-zinc-300">
                    {run.mode === "selection"
                      ? (run.summary as SelectionSummary).uniqueCharacters
                      : (run.summary as SummonSummary).uniqueCharactersHit}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-zinc-300">
                    {run.mode === "selection"
                      ? `watch ${fmtPercent((run.summary as SelectionSummary).watchPct)}`
                      : `token ${fmtPercent((run.summary as SummonSummary).mysteryTokenRatePct)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
