export function normalizeImagePath(input: string): string {
  return input
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^(\.\/)+/, "")
    .replace(/^data\/images\//, "");
}

export function toImageApiUrl(input: string): string {
  const normalized = normalizeImagePath(input);
  const encoded = normalized
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/api/images/${encoded}`;
}
