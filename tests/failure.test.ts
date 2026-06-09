import {
  buildFailureIssue,
  createFailureIssue,
  resolveFailureContext,
} from "../src/failure";
import { FailureContext, JiraConfig } from "../src/types";

jest.mock("@actions/core", () => ({
  info: jest.fn(),
  warning: jest.fn(),
  setFailed: jest.fn(),
}));

const core = jest.requireMock("@actions/core") as {
  info: jest.Mock;
  warning: jest.Mock;
};

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

const config: JiraConfig = {
  baseUrl: "https://test.atlassian.net",
  email: "user@example.com",
  apiToken: "test-token",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockFetch(responses: Array<{ status: number; body?: any }>) {
  const queue = [...responses];
  return jest.fn(async () => {
    const next = queue.shift()!;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      statusText: next.status >= 200 && next.status < 300 ? "OK" : "Error",
      json: async () => next.body,
      text: async () => "",
    };
  }) as unknown as jest.Mock & typeof global.fetch;
}

const prCtx: FailureContext = {
  title: "PR #6",
  repo: "org/repo",
  prNumber: 6,
  branch: "dependabot/npm_and_yarn/vite-8.0.16",
  url: "https://github.com/org/repo/pull/6",
  runUrl: "https://github.com/org/repo/actions/runs/1",
};

describe("buildFailureIssue", () => {
  it("builds summary, labels and a deterministic dedup label for a PR", () => {
    const r = buildFailureIssue(prCtx);
    expect(r.summary).toBe(
      "CI failed: PR #6 (dependabot/npm_and_yarn/vite-8.0.16)",
    );
    expect(r.labels).toEqual(["ci-failure", "cifail-org-repo-pr-6"]);
    expect(r.dedupeLabel).toBe("cifail-org-repo-pr-6");
    expect(r.description).toContain("https://github.com/org/repo/pull/6");
    expect(r.description).toContain(
      "https://github.com/org/repo/actions/runs/1",
    );
  });

  it("falls back to the branch when there is no PR", () => {
    const r = buildFailureIssue({
      title: "branch main",
      repo: "org/repo",
      branch: "main",
    });
    expect(r.summary).toBe("CI failed: branch main");
    expect(r.dedupeLabel).toBe("cifail-org-repo-main");
  });

  it("keeps the dedup label the same across repeated failures of the same PR", () => {
    const a = buildFailureIssue(prCtx).dedupeLabel;
    const b = buildFailureIssue({
      ...prCtx,
      runUrl: "different-run",
    }).dedupeLabel;
    expect(a).toBe(b);
  });
});

describe("resolveFailureContext", () => {
  beforeEach(() => setContext("", "", {}));

  it("returns a context for a failed workflow_run with a PR", () => {
    setContext("workflow_run", "", {
      repository: { full_name: "org/repo" },
      workflow_run: {
        conclusion: "failure",
        head_branch: "dependabot/x",
        html_url: "https://github.com/org/repo/actions/runs/9",
        pull_requests: [{ number: 6 }],
      },
    });
    const ctx = resolveFailureContext();
    expect(ctx).not.toBeNull();
    expect(ctx!.prNumber).toBe(6);
    expect(ctx!.url).toBe("https://github.com/org/repo/pull/6");
    expect(ctx!.runUrl).toBe("https://github.com/org/repo/actions/runs/9");
  });

  it("returns null when the workflow_run did not fail", () => {
    setContext("workflow_run", "", {
      repository: { full_name: "org/repo" },
      workflow_run: { conclusion: "success", pull_requests: [] },
    });
    expect(resolveFailureContext()).toBeNull();
  });

  it("uses the pull_request payload for non-workflow_run events", () => {
    setContext("pull_request", "", {
      repository: { full_name: "org/repo" },
      pull_request: {
        number: 12,
        title: "Fix things",
        html_url: "https://github.com/org/repo/pull/12",
        head: { ref: "fix-things" },
      },
    });
    const ctx = resolveFailureContext();
    expect(ctx!.prNumber).toBe(12);
    expect(ctx!.title).toBe("Fix things");
    expect(ctx!.branch).toBe("fix-things");
  });
});

describe("createFailureIssue", () => {
  const origFetch = global.fetch;
  afterEach(() => {
    global.fetch = origFetch;
    jest.clearAllMocks();
  });

  it("reuses an existing open ticket and does not create a duplicate", async () => {
    const fetchMock = mockFetch([
      { status: 200, body: { issues: [{ key: "SONG-9" }] } },
    ]);
    global.fetch = fetchMock;
    const key = await createFailureIssue(prCtx, config, "SONG", "Bug", false);
    expect(key).toBe("SONG-9");
    expect(fetchMock).toHaveBeenCalledTimes(1); // search only, no create
  });

  it("creates a new ticket when none exists", async () => {
    const fetchMock = mockFetch([
      { status: 200, body: { issues: [] } },
      { status: 201, body: { key: "SONG-10" } },
    ]);
    global.fetch = fetchMock;
    const key = await createFailureIssue(prCtx, config, "SONG", "Bug", false);
    expect(key).toBe("SONG-10");
    expect(fetchMock).toHaveBeenCalledTimes(2); // search + create
    const [, createOpts] = fetchMock.mock.calls[1] as [
      string,
      { body: string },
    ];
    const sent = JSON.parse(createOpts.body);
    expect(sent.fields.project.key).toBe("SONG");
    expect(sent.fields.issuetype.name).toBe("Bug");
    expect(sent.fields.labels).toContain("cifail-org-repo-pr-6");
  });

  it("warns and returns null on error when failOnError is false", async () => {
    global.fetch = mockFetch([{ status: 500 }]);
    const key = await createFailureIssue(prCtx, config, "SONG", "Bug", false);
    expect(key).toBeNull();
    expect(core.warning).toHaveBeenCalled();
  });

  it("throws on error when failOnError is true", async () => {
    global.fetch = mockFetch([{ status: 500 }]);
    await expect(
      createFailureIssue(prCtx, config, "SONG", "Bug", true),
    ).rejects.toThrow();
  });
});
