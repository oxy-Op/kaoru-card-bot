"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";

interface SearchFormProps {
  paramName?: string;
  placeholder?: string;
  /** Preserve these query keys when submitting */
  preserveParams?: string[];
}

export function SearchForm({
  paramName = "q",
  placeholder = "Search…",
  preserveParams = [],
}: SearchFormProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = searchParams.get(paramName) ?? "";
  const [value, setValue] = useState(initial);

  useEffect(() => {
    setValue(searchParams.get(paramName) ?? "");
  }, [searchParams, paramName]);

  const submit = useCallback(() => {
    const next = new URLSearchParams();
    for (const key of preserveParams) {
      const v = searchParams.get(key);
      if (v) next.set(key, v);
    }
    if (value.trim()) next.set(paramName, value.trim());
    else next.delete(paramName);
    next.delete("page");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }, [router, pathname, searchParams, value, paramName, preserveParams]);

  return (
    <form
      className="flex w-full max-w-md gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-900/80 pl-10 pr-3 text-sm text-white placeholder:text-zinc-600 outline-none ring-indigo-500/0 transition-[box-shadow,border-color] focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20"
        />
      </div>
      <button
        type="submit"
        className="h-10 shrink-0 rounded-lg bg-zinc-800 px-4 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
      >
        Search
      </button>
    </form>
  );
}
