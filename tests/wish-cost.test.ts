import { describe, it, expect } from "vitest";
import { wishAddCost } from "../src/commands/play/wish.js";

describe("wishAddCost", () => {
  it("charges most for very popular characters", () => {
    expect(wishAddCost(15000)).toBe(5000);
    expect(wishAddCost(10000)).toBe(5000);
  });

  it("uses tiered inverse-popularity scaling", () => {
    expect(wishAddCost(5000)).toBe(2500);
    expect(wishAddCost(3000)).toBe(2500);
    expect(wishAddCost(800)).toBe(1000);
    expect(wishAddCost(500)).toBe(1000);
    expect(wishAddCost(120)).toBe(400);
    expect(wishAddCost(50)).toBe(400);
    expect(wishAddCost(49)).toBe(150);
  });

  it("handles empty popularity values", () => {
    expect(wishAddCost(undefined)).toBe(150);
    expect(wishAddCost(null)).toBe(150);
  });
});
