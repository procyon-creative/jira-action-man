import { collectSourceTexts, sourceTextsToArray } from "../src/sources";

// Mock @actions/core
jest.mock("@actions/core", () => ({
  debug: jest.fn(),
  info: jest.fn(),
}));

// Mock @actions/github
const mockContext = {
  eventName: "",
  ref: "",
  payload: {} as Record<string, unknown>,
};

jest.mock("@actions/github", () => ({
  get context() {
    return mockContext;
  },
}));

function setContext(
  eventName: string,
  ref: string,
  payload: Record<string, unknown>,
) {
  mockContext.eventName = eventName;
  mockContext.ref = ref;
  mockContext.payload = payload;
}

describe("collectSourceTexts", () => {
  beforeEach(() => {
    setContext("", "", {});
  });

  describe("push events", () => {
    it("reads branch from ref", () => {
      setContext("push", "refs/heads/feature/PROJ-123-login", {});
      const result = collectSourceTexts(["branch"]);
      expect(result.branch).toBe("feature/PROJ-123-login");
    });

    it("reads commit messages", () => {
      setContext("push", "refs/heads/main", {
        commits: [
          { message: "PROJ-1 fix bug" },
          { message: "PROJ-2 add feature" },
        ],
      });
      const result = collectSourceTexts(["commits"]);
      expect(result.commits).toEqual(["PROJ-1 fix bug", "PROJ-2 add feature"]);
    });

    it("returns undefined title for push", () => {
      setContext("push", "refs/heads/main", {});
      const result = collectSourceTexts(["title"]);
      expect(result.title).toBeUndefined();
    });

    it("returns undefined body for push", () => {
      setContext("push", "refs/heads/main", {});
      const result = collectSourceTexts(["body"]);
      expect(result.body).toBeUndefined();
    });
  });

  describe("pull_request events", () => {
    it("reads branch from head ref", () => {
      setContext("pull_request", "", {
        pull_request: {
          head: { ref: "feature/TEAM-42-update" },
          title: "",
          body: "",
        },
      });
      const result = collectSourceTexts(["branch"]);
      expect(result.branch).toBe("feature/TEAM-42-update");
    });

    it("reads PR title", () => {
      setContext("pull_request", "", {
        pull_request: {
          head: { ref: "" },
          title: "PROJ-99 Add login",
          body: "",
        },
      });
      const result = collectSourceTexts(["title"]);
      expect(result.title).toBe("PROJ-99 Add login");
    });

    it("reads PR body", () => {
      setContext("pull_request", "", {
        pull_request: {
          head: { ref: "" },
          title: "",
          body: "Fixes PROJ-10 and PROJ-20",
        },
      });
      const result = collectSourceTexts(["body"]);
      expect(result.body).toBe("Fixes PROJ-10 and PROJ-20");
    });

    it("returns undefined commits for pull_request", () => {
      setContext("pull_request", "", {
        pull_request: { head: { ref: "" }, title: "", body: "" },
      });
      const result = collectSourceTexts(["commits"]);
      expect(result.commits).toBeUndefined();
    });

    it("handles null PR body", () => {
      setContext("pull_request", "", {
        pull_request: { head: { ref: "" }, title: "", body: null },
      });
      const result = collectSourceTexts(["body"]);
      expect(result.body).toBeUndefined();
    });
  });

  describe("pull_request_target events", () => {
    it("reads branch from head ref", () => {
      setContext("pull_request_target", "", {
        pull_request: {
          head: { ref: "feature/PROJ-5" },
          title: "PROJ-5 fix",
          body: "",
        },
      });
      const result = collectSourceTexts(["branch", "title"]);
      expect(result.branch).toBe("feature/PROJ-5");
      expect(result.title).toBe("PROJ-5 fix");
    });
  });

  it("collects multiple sources at once", () => {
    setContext("pull_request", "", {
      pull_request: {
        head: { ref: "feature/PROJ-1" },
        title: "PROJ-2 update",
        body: "Refs PROJ-3",
      },
    });
    const result = collectSourceTexts(["branch", "title", "body"]);
    expect(result.branch).toBe("feature/PROJ-1");
    expect(result.title).toBe("PROJ-2 update");
    expect(result.body).toBe("Refs PROJ-3");
  });
});

describe("sourceTextsToArray", () => {
  it("flattens all defined sources into an array", () => {
    const texts = sourceTextsToArray({
      branch: "feature/PROJ-1",
      title: "PROJ-2 fix",
      commits: ["PROJ-3 a", "PROJ-4 b"],
      body: "PROJ-5",
    });
    expect(texts).toEqual([
      "feature/PROJ-1",
      "PROJ-2 fix",
      "PROJ-3 a",
      "PROJ-4 b",
      "PROJ-5",
    ]);
  });

  it("skips undefined sources", () => {
    const texts = sourceTextsToArray({ branch: "feature/PROJ-1" });
    expect(texts).toEqual(["feature/PROJ-1"]);
  });

  it("handles empty object", () => {
    const texts = sourceTextsToArray({});
    expect(texts).toEqual([]);
  });
});
