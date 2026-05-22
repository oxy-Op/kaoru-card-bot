import Redis from "ioredis";

export const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    return Math.min(times * 200, 5000);
  },
});
