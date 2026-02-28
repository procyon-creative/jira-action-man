import { appendJiraLinksToPr } from "../src/pr-links";

const mockUpdate = jest.fn();

jest.mock("@actions/core", () => ({
  info: jest.fn(),
  debug: jest.fn(),
}));

const mockContext = {
  eventName: "pull_request",
  payload: {} as Record<string, unknown>,
  repo: { owner: "org", repo: "repo" },
};

jest.mock("@actions/github", () => ({
  get context() {
    return mockContext;
  },
  getOctokit: () => ({
    rest: {
      pulls: {
        update: mockUpdate,
      },
    },
  }),
}));

describe("appendJiraLinksToPr", () => {
  beforeEach(() => {
    mockUpdate.mockClear();
    mockContext.payload = {
      pull_request: {
        number: 7,
        body: "## Summary\n\nFixed a bug.",
      },
    };
  });

  it("appends Jira links section to PR body", async () => {
    await appendJiraLinksToPr(
      ["PROJ-1", "PROJ-2"],
      "https://test.atlassian.net",
      "fake-token",
    );

    expect(mockUpdate).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      pull_number: 7,
      body: expect.stringContaining(
        "- [PROJ-1](https://test.atlassian.net/browse/PROJ-1)",
      ),
    });

    const body = mockUpdate.mock.calls[0][0].body as string;
    expect(body).toContain(
      "- [PROJ-2](https://test.atlassian.net/browse/PROJ-2)",
    );
    expect(body).toContain("## Summary");
    expect(body).toContain("## Jira");
  });

  it("replaces existing Jira section on re-run", async () => {
    mockContext.payload = {
      pull_request: {
        number: 7,
        body: "## Summary\n\nFixed a bug.\n\n<!-- jira-action-man:start -->\n## Jira\n\n- [PROJ-1](https://test.atlassian.net/browse/PROJ-1)\n<!-- jira-action-man:end -->",
      },
    };

    await appendJiraLinksToPr(
      ["PROJ-1", "PROJ-99"],
      "https://test.atlassian.net",
      "fake-token",
    );

    const body = mockUpdate.mock.calls[0][0].body as string;
    expect(body).toContain("PROJ-99");
    // Should not duplicate the section
    expect(body.match(/## Jira/g)!.length).toBe(1);
  });

  it("skips update when body already matches", async () => {
    mockContext.payload = {
      pull_request: {
        number: 7,
        body: "## Summary\n\nFixed a bug.\n\n<!-- jira-action-man:start -->\n## Jira\n\n- [PROJ-1](https://test.atlassian.net/browse/PROJ-1)\n<!-- jira-action-man:end -->",
      },
    };

    await appendJiraLinksToPr(
      ["PROJ-1"],
      "https://test.atlassian.net",
      "fake-token",
    );

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("does nothing when no PR payload", async () => {
    mockContext.payload = {};

    await appendJiraLinksToPr(
      ["PROJ-1"],
      "https://test.atlassian.net",
      "fake-token",
    );

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("handles empty PR body", async () => {
    mockContext.payload = {
      pull_request: { number: 7, body: null },
    };

    await appendJiraLinksToPr(
      ["PROJ-1"],
      "https://test.atlassian.net",
      "fake-token",
    );

    const body = mockUpdate.mock.calls[0][0].body as string;
    expect(body).toContain("PROJ-1");
  });
});
