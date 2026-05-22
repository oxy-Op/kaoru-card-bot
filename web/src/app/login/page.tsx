import { signIn } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errorMessage =
    error === "AccessDenied"
      ? "Your Discord account is not in the admin allowlist."
      : error
        ? "Sign-in failed. Try again or contact an owner."
        : null;

  return (
    <div className="main-content-gradient flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md space-y-8 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-8 shadow-2xl shadow-black/40 backdrop-blur-sm">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-xl font-bold text-white shadow-lg shadow-indigo-500/25">
            K
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Kaoru Admin</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Sign in with Discord — only users in <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">admin_users</code> can enter.
          </p>
        </div>

        {errorMessage && (
          <div className="rounded-lg border border-red-500/30 bg-red-950/40 px-4 py-3 text-center text-sm text-red-200/90">
            {errorMessage}
          </div>
        )}

        <form
          action={async () => {
            "use server";
            await signIn("discord", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-xl bg-[#5865F2] px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-950/50 transition-colors hover:bg-[#4752C4]"
          >
            <svg width="20" height="20" viewBox="0 0 71 55" fill="currentColor">
              <path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.8 40.8 0 00-1.8 3.7 54 54 0 00-16.2 0A37.4 37.4 0 0025.4.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.6 5a.2.2 0 00-.1 0C1.5 18.7-.9 32 .3 45.2v.1a58.7 58.7 0 0017.9 9.1.2.2 0 00.3-.1 42 42 0 003.6-5.9.2.2 0 00-.1-.3 38.6 38.6 0 01-5.5-2.7.2.2 0 01 0-.4l1.1-.9a.2.2 0 01.2 0 41.9 41.9 0 0035.6 0 .2.2 0 01.2 0l1.1.9a.2.2 0 010 .3 36.3 36.3 0 01-5.5 2.7.2.2 0 00-.1.4 47.2 47.2 0 003.6 5.9.2.2 0 00.2.1A58.5 58.5 0 0070.7 45.3v-.1c1.4-14.8-2.3-27.7-9.8-39.1a.2.2 0 00-.1-.1zM23.7 37.1c-3.4 0-6.2-3.1-6.2-7s2.7-7 6.2-7 6.3 3.2 6.2 7-2.8 7-6.2 7zm23 0c-3.4 0-6.2-3.1-6.2-7s2.7-7 6.2-7 6.3 3.2 6.2 7-2.7 7-6.2 7z" />
            </svg>
            Sign in with Discord
          </button>
        </form>

        <p className="text-center text-xs text-zinc-600">
          Sessions are gated by your Discord account and panel role.
        </p>
      </div>
    </div>
  );
}
