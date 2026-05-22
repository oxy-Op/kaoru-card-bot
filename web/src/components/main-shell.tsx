import { cn } from "@/lib/utils";

export function MainShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative min-h-full w-full max-w-7xl mx-auto space-y-8 px-4 py-8 sm:px-6 lg:px-8",
        className
      )}
    >
      {children}
    </div>
  );
}
