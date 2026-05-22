import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres", "ioredis"],
  turbopack: {
    root: path.join(/* turbopackIgnore: true */ __dirname, ".."),
    resolveAlias: {
      "@shared": path.join(/* turbopackIgnore: true */ __dirname, "../src"),
    },
  },
  // Fallback for webpack mode
  webpack: (config) => {
    config.resolve.alias["@shared"] = path.join(
      /* turbopackIgnore: true */ __dirname,
      "../src"
    );
    return config;
  },
};

export default nextConfig;
