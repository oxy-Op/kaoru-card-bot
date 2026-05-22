import "dotenv/config";
import { mkdir } from "fs/promises";
import path from "path";
import { spawn } from "child_process";

function timestampNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function runPgDump(databaseUrl: string, outFile: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "pg_dump",
      [
        "--no-owner",
        "--no-privileges",
        "--format=plain",
        "--file",
        outFile,
        databaseUrl,
      ],
      { stdio: "inherit" }
    );

    child.on("error", (err) => reject(err));
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited with code ${code}`));
    });
  });
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }

  const outDir =
    process.env.DB_BACKUP_DIR?.trim() ||
    path.resolve(process.cwd(), "backups");
  await mkdir(outDir, { recursive: true });

  const outFile = path.join(outDir, `db-backup-${timestampNow()}.sql`);
  console.log(`[db:backup] Writing: ${outFile}`);

  try {
    await runPgDump(databaseUrl, outFile);
  } catch (err) {
    console.error(
      "[db:backup] Failed to run pg_dump. Ensure PostgreSQL client tools are installed."
    );
    throw err;
  }

  console.log("[db:backup] Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
