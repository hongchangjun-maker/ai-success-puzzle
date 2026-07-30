import { describe, expect, it } from "vitest";
import { dimensions } from "../src/data/dimensions";

describe("commercial product model", () => {
  it("keeps 12 scored puzzle dimensions with 48 questions", () => {
    expect(dimensions).toHaveLength(12);
    expect(dimensions.reduce((sum, dimension) => sum + dimension.questions.length, 0)).toBe(48);
  });

  it("connects every dimension to book chapters and a concrete action", () => {
    for (const dimension of dimensions) {
      expect(dimension.chapters.length).toBeGreaterThanOrEqual(3);
      expect(dimension.action.length).toBeGreaterThan(10);
      expect(dimension.principle.length).toBeGreaterThan(10);
    }
  });

  it("uses non-stigmatizing dimension labels", () => {
    const labels = dimensions.map((dimension) => dimension.name).join(" ");
    expect(labels).not.toMatch(/루저|바보|찌질/);
  });
});
