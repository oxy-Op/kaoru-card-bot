import fs from "fs/promises";
import { db } from "@/lib/db";
import { getResolvedImageBase } from "@/lib/image-storage";
import { redis } from "@/lib/redis";
import { users } from "@shared/db/schema";
import { PageHeader } from "@/components/page-header";
import { CheckCircle2, XCircle, AlertCircle } from "lucide-react";

async function checkDb() {
  try {
    await db.select({ id: users.id }).from(users).limit(1);
    return { ok: true as const, message: "Connected" };
  } catch (e) {
    return { ok: false as const, message: String(e) };
  }
}

async function checkRedis() {
  try {
    const pong = await redis.ping();
    return { ok: pong === "PONG", message: pong };
  } catch (e) {
    return { ok: false as const, message: String(e) };
  }
}

async function checkImageDir() {
  const dir = getResolvedImageBase();
  try {
    await fs.access(dir, fs.constants.R_OK);
    return { ok: true as const, message: dir };
  } catch {
    return { ok: false as const, message: `Not readable: ${dir}` };
  }
}

function StatusRow({
  label,
  result,
}: {
  label: string;
  result: { ok: boolean; message: string };
}) {
  const Icon = result.ok ? CheckCircle2 : XCircle;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
      <Icon
        className={`mt-0.5 h-5 w-5 shrink-0 ${result.ok ? "text-emerald-500" : "text-red-400"}`}
      />
      <div>
        <p className="font-medium text-zinc-200">{label}</p>
        <p className="mt-0.5 text-sm text-zinc-500 break-all">{result.message}</p>
      </div>
    </div>
  );
}

export default async function ConfigPage() {
  const [dbStatus, redisStatus, imageStatus] = await Promise.all([
    checkDb(),
    checkRedis(),
    checkImageDir(),
  ]);

  const envHints = [
    { key: "DATABASE_URL", set: !!process.env.DATABASE_URL },
    { key: "REDIS_URL", set: !!process.env.REDIS_URL },
    { key: "DISCORD_CLIENT_ID", set: !!process.env.DISCORD_CLIENT_ID },
    { key: "NEXTAUTH_SECRET", set: !!process.env.NEXTAUTH_SECRET },
    { key: "NEXTAUTH_URL", set: !!process.env.NEXTAUTH_URL },
    { key: "IMAGE_DIR", set: !!process.env.IMAGE_DIR },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="System"
        description="Runtime health and environment presence (values are never shown)."
      />

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Connectivity
        </h2>
        <div className="grid gap-3 sm:grid-cols-1 lg:grid-cols-3">
          <StatusRow label="PostgreSQL" result={dbStatus} />
          <StatusRow label="Redis" result={redisStatus} />
          <StatusRow label="Image directory" result={imageStatus} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Environment keys
        </h2>
        <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/30">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-zinc-800/80">
              {envHints.map((row) => (
                <tr key={row.key} className="hover:bg-zinc-800/20">
                  <td className="px-4 py-2 font-mono text-zinc-300">{row.key}</td>
                  <td className="px-4 py-2 text-right">
                    {row.set ? (
                      <span className="text-emerald-400/90">Set</span>
                    ) : (
                      <span className="text-zinc-600">Unset</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-200/80">
          <AlertCircle className="h-5 w-5 shrink-0 text-amber-500/80" />
          <p>
            Bot tuning (prefixes, cooldowns, anti-bot thresholds) still lives in the Node process
            and <code className="rounded bg-zinc-800 px-1 text-xs">.env</code> on the host. This
            panel only verifies what the Next.js server can reach.
          </p>
        </div>
      </section>
    </div>
  );
}
