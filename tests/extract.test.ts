import {
  extractKeys,
  extractKeysFromTexts,
  mergeAndSort,
  DEFAULT_BLOCKLIST,
  DEFAULT_ISSUE_PATTERN,
} from "../src/extract";

import extractCases from "./fixtures/extract-keys.json";
import blocklistCases from "./fixtures/blocklist.json";
import sortCases from "./fixtures/merge-and-sort.json";
import textsCases from "./fixtures/extract-from-texts.json";

const pattern = new RegExp(DEFAULT_ISSUE_PATTERN, "g");
const noBlocklist: string[] = [];

describe("extractKeys", () => {
  it.each(extractCases.map((c) => [c.label, c.text, c.projects, c.expected]))(
    "%s",
    (_label, text, projects, expected) => {
      expect(
        extractKeys(text as string, projects as string[], noBlocklist, pattern),
      ).toEqual(expected);
    },
  );
});

describe("blocklist", () => {
  it.each(
    blocklistCases.map((c) => [
      c.label,
      c.text,
      c.projects,
      c.blocklist,
      c.expected,
    ]),
  )("%s", (_label, text, projects, blocklist, expected) => {
    const bl =
      blocklist === "default" ? DEFAULT_BLOCKLIST : (blocklist as string[]);
    expect(
      extractKeys(text as string, projects as string[], bl, pattern),
    ).toEqual(expected);
  });

  it("filters all default blocklist entries", () => {
    const text = DEFAULT_BLOCKLIST.map((p) => `${p}-1`).join(" ");
    expect(extractKeys(text, [], DEFAULT_BLOCKLIST, pattern)).toEqual([]);
  });

  it("false positives pass when blocklist is empty", () => {
    const result = extractKeys(
      "uses SHA-256 and UTF-8 encoding",
      [],
      noBlocklist,
      pattern,
    );
    expect(result).toContain("SHA-256");
    expect(result).toContain("UTF-8");
  });
});

describe("custom pattern", () => {
  it("allows a custom regex pattern", () => {
    const customPattern = /CUSTOM-[0-9]+/g;
    expect(
      extractKeys("CUSTOM-99 PROJ-1", [], noBlocklist, customPattern),
    ).toEqual(["CUSTOM-99"]);
  });
});

describe("mergeAndSort", () => {
  it.each(sortCases.map((c) => [c.label, c.input, c.expected]))(
    "%s",
    (_label, input, expected) => {
      expect(mergeAndSort(input as string[])).toEqual(expected);
    },
  );
});

describe("extractKeysFromTexts", () => {
  it.each(textsCases.map((c) => [c.label, c.texts, c.expected]))(
    "%s",
    (_label, texts, expected) => {
      expect(
        extractKeysFromTexts(texts as string[], [], noBlocklist, pattern),
      ).toEqual(expected);
    },
  );
});
