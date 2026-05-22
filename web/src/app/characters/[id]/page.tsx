import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { characters, characterEditions } from "@shared/db/schema";
import { eq, asc } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { EditionHideButton } from "@/components/edition-hide-button";
import { EditionReplaceButton } from "@/components/edition-replace-button";
import { EditionRestoreButton } from "@/components/edition-restore-button";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/roles";
import type { AdminRole } from "@/lib/auth";
import { ChevronLeft } from "lucide-react";
import { toImageApiUrl } from "@/lib/image-path";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CharacterDetailPage({ params }: Props) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) notFound();

  const char = await db.query.characters.findFirst({
    where: eq(characters.id, id),
  });
  if (!char) notFound();

  const editions = await db
    .select({
      id: characterEditions.id,
      editionNumber: characterEditions.editionNumber,
      imagePath: characterEditions.imagePath,
      generationMethod: characterEditions.generationMethod,
      summonable: characterEditions.summonable,
    })
    .from(characterEditions)
    .where(eq(characterEditions.characterId, id))
    .orderBy(asc(characterEditions.editionNumber));

  const session = await auth();
  const role = (session?.user as { role?: AdminRole } | undefined)?.role ?? "viewer";
  const canCurate = hasRole(role, "curator");

  return (
    <div className="space-y-8">
      <Link
        href="/characters"
        className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-300"
      >
        <ChevronLeft className="h-4 w-4" />
        Characters
      </Link>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="shrink-0">
          {char.imageMediumUrl || char.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={char.imageMediumUrl ?? char.imageUrl ?? ""}
              alt=""
              className="w-40 rounded-xl object-cover ring-1 ring-zinc-800 shadow-lg"
            />
          ) : (
            <div className="flex h-52 w-40 items-center justify-center rounded-xl bg-zinc-800 text-zinc-600">
              No art
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <PageHeader
            title={char.name}
            description={`${char.series}${char.nameJp ? ` · ${char.nameJp}` : ""}`}
          />
          {char.description && (
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-zinc-400 line-clamp-6">
              {char.description.replace(/<[^>]+>/g, "")}
            </p>
          )}
          <p className="mt-2 text-xs text-zinc-600">ID · {char.id}</p>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-medium text-white">Editions ({editions.length})</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Summonable editions appear in pulls. Curators can hide unsafe editions from summons.
        </p>

        <div className="mt-4 overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/30">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/80 text-xs font-medium uppercase tracking-wide text-zinc-500">
                <th className="px-4 py-3 w-20 min-w-[4.5rem]">Thumb</th>
                <th className="px-4 py-3">ED #</th>
                <th className="px-4 py-3 hidden sm:table-cell">Method</th>
                <th className="px-4 py-3">Summon</th>
                {canCurate && (
                  <th className="px-4 py-3 text-right min-w-[9rem]">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {editions.map((ed) => {
                const src = ed.imagePath ? toImageApiUrl(ed.imagePath) : null;
                return (
                  <tr key={ed.id} className="hover:bg-zinc-800/30">
                    <td className="px-4 py-2 w-16">
                      {src ? (
                        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-zinc-700">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={src}
                            alt=""
                            className="h-full w-full object-cover object-top"
                          />
                        </div>
                      ) : (
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-xs text-zinc-500">
                          ?
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-zinc-200">{ed.editionNumber}</td>
                    <td className="px-4 py-2 text-zinc-500 hidden sm:table-cell capitalize">
                      {ed.generationMethod}
                    </td>
                    <td className="px-4 py-2">
                      {ed.summonable ? (
                        <span className="text-emerald-400/90">Yes</span>
                      ) : (
                        <span className="text-amber-400/90">Hidden</span>
                      )}
                    </td>
                    {canCurate && (
                      <td className="px-4 py-2 text-right">
                        <div className="flex flex-col items-end gap-2 sm:flex-row sm:justify-end sm:gap-2">
                          <EditionReplaceButton editionId={ed.id} />
                          {ed.summonable ? (
                            <EditionHideButton editionId={ed.id} />
                          ) : (
                            <EditionRestoreButton editionId={ed.id} />
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
