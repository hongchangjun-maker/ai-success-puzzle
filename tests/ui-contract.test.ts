import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bookViewer = readFileSync(new URL("../src/components/BookViewer.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const logo = readFileSync(new URL("../src/components/SuccessPuzzleLogo.tsx", import.meta.url), "utf8");

describe("reader and brand UI contracts", () => {
  it("defaults to full-page fitting and keeps width fitting optional", () => {
    expect(bookViewer).toContain('useState<"page" | "width">("page")');
    expect(styles).toContain(".book-spread.fit-page .book-page canvas { position: absolute; inset: 0; width: auto; height: auto;");
    expect(styles).toContain(".book-spread.fit-width { overflow-y: auto;");
  });

  it("uses a single sequential page on mobile", () => {
    expect(bookViewer).toContain("const step = singlePage ? 1 : 2;");
    expect(styles).toContain(".book-page:last-child { display: none; }");
  });

  it("renders the custom dimensional puzzle logo", () => {
    expect(logo).toContain('filter id="logo-depth"');
    expect(logo).toContain('linearGradient id="logo-top"');
  });
});
