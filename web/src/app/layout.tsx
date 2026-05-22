import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { auth } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import type { AdminRole } from "@/lib/auth";
import { MainShell } from "@/components/main-shell";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "Kaoru Admin",
  description: "Administration panel for Kaoru bot",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const user = session?.user as Record<string, unknown> | undefined;
  const showSidebar = !!(user && typeof user.discordId === "string");

  return (
    <html lang="en" className={`dark ${dmSans.variable} ${jetbrainsMono.variable}`}>
      <body
        className={`${dmSans.className} bg-zinc-950 text-zinc-100 antialiased`}
      >
        {showSidebar ? (
          <div className="flex min-h-screen">
            <Sidebar
              user={{
                username: (user.username ?? user.name ?? "User") as string,
                role: (user.role ?? "viewer") as AdminRole,
                image: user.image as string | null | undefined,
              }}
            />
            <main className="main-content-gradient flex-1 min-h-screen pt-14 md:pt-0 md:pl-60">
              <MainShell>{children}</MainShell>
            </main>
          </div>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
