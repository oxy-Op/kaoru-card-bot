import { describe, it, expect } from "vitest";
import {
  communityBoostFromHearts,
  parseCommunityLookupLine,
  getCommunityWeight,
} from "../src/services/community-weight.service.js";

describe("community-weight parser", () => {
  it("parses lookup line format", () => {
    const parsed = parseCommunityLookupLine("Jujutsu Kaisen · Satoru Gojo · ❤1,945");
    expect(parsed).not.toBeNull();
    expect(parsed?.series).toBe("Jujutsu Kaisen");
    expect(parsed?.name).toBe("Satoru Gojo");
    expect(parsed?.hearts).toBe(1945);
  });

  it("returns null for invalid line", () => {
    expect(parseCommunityLookupLine("not a valid format")).toBeNull();
  });
});

describe("community-weight boost", () => {
  it("is bounded and monotonic", () => {
    expect(communityBoostFromHearts(0, 2000)).toBe(1);
    expect(communityBoostFromHearts(100, 2000)).toBeGreaterThan(1);
    expect(communityBoostFromHearts(1000, 2000)).toBeGreaterThan(communityBoostFromHearts(100, 2000));
    expect(communityBoostFromHearts(2000, 2000)).toBeLessThanOrEqual(2.2);
  });

  it("returns neutral weight when no community file exists", async () => {
    const unknown = await getCommunityWeight("Some Unknown Series", "Some Unknown Character");
    expect(unknown).toBe(1);
  });
});
