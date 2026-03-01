import { postToJira } from "../src/jira";
import { JiraConfig, PrContext } from "../src/types";

jest.mock("@actions/core", () => ({
  info: jest.fn(),
  warning: jest.fn(),
}));

const core = jest.requireMock("@actions/core") as {
  info: jest.Mock;
  warning: jest.Mock;
};

const config: JiraConfig = {
  baseUrl: "https://test.atlassian.net",
  email: "user@example.com",
  apiToken: "test-token",
};

const pr: PrContext = {
  number: 42,
  title: "PROJ-1 Add feature",
  body: "## Summary\n\nAdded a new feature.",
  url: "https://github.com/org/repo/pull/42",
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
    };
  }) as unknown as jest.Mock & typeof global.fetch;
}

function getCall(fetchMock: jest.Mock, index: number) {
  return fetchMock.mock.calls[index] as [string, Record<string, unknown>];
}

describe("postToJira", () => {
  const origFetch = global.fetch;

  afterEach(() => {
    global.fetch = origFetch;
    core.info.mockClear();
    core.warning.mockClear();
  });

  it("creates a new comment on PR opened (no lookup)", async () => {
    const fetchMock = mockFetch([{ status: 201 }]);
    global.fetch = fetchMock;

    await postToJira(["PROJ-1"], pr, config, "update", "opened", false);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [postUrl, postOpts] = getCall(fetchMock, 0);
    expect(postUrl).toBe(
      "https://test.atlassian.net/rest/api/2/issue/PROJ-1/comment",
    );
    expect(postOpts.method).toBe("POST");
    const body = JSON.parse(postOpts.body as string);
    expect(body.body).toContain("PROJ-1 Add feature");
    expect(body.body).toContain(pr.url);

    expect(core.info).toHaveBeenCalledWith("Created comment on PROJ-1");
  });

  it("updates an existing comment on PR synchronize", async () => {
    const fetchMock = mockFetch([
      {
        status: 200,
        body: {
          comments: [
            { id: "10001", body: "unrelated comment" },
            {
              id: "10002",
              body: `old content [PR|${pr.url}]`,
            },
          ],
        },
      },
      { status: 200 },
    ]);
    global.fetch = fetchMock;

    await postToJira(["PROJ-1"], pr, config, "update", "synchronize", false);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [putUrl, putOpts] = getCall(fetchMock, 1);
    expect(putUrl).toBe(
      "https://test.atlassian.net/rest/api/2/issue/PROJ-1/comment/10002",
    );
    expect(putOpts.method).toBe("PUT");

    expect(core.info).toHaveBeenCalledWith("Updated comment on PROJ-1");
  });

  it("creates comment on PR synchronize when no existing comment found", async () => {
    const fetchMock = mockFetch([
      { status: 200, body: { comments: [] } },
      { status: 201 },
    ]);
    global.fetch = fetchMock;

    await postToJira(["PROJ-1"], pr, config, "update", "synchronize", false);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, postOpts] = getCall(fetchMock, 1);
    expect(postOpts.method).toBe("POST");
    expect(core.info).toHaveBeenCalledWith("Created comment on PROJ-1");
  });

  it("posts to multiple issues", async () => {
    const fetchMock = mockFetch([{ status: 201 }, { status: 201 }]);
    global.fetch = fetchMock;

    await postToJira(
      ["PROJ-1", "PROJ-2"],
      pr,
      config,
      "update",
      "opened",
      false,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(core.info).toHaveBeenCalledWith("Created comment on PROJ-1");
    expect(core.info).toHaveBeenCalledWith("Created comment on PROJ-2");
  });

  it("warns on error by default (failOnError=false)", async () => {
    global.fetch = mockFetch([{ status: 404 }]);

    await postToJira(["PROJ-1"], pr, config, "update", "opened", false);

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("Failed to post to PROJ-1"),
    );
  });

  it("throws on error when failOnError=true", async () => {
    global.fetch = mockFetch([{ status: 404 }]);

    await expect(
      postToJira(["PROJ-1"], pr, config, "update", "opened", true),
    ).rejects.toThrow("Failed to post to PROJ-1");
  });

  it("sends correct Basic auth header", async () => {
    const fetchMock = mockFetch([
      { status: 200, body: { comments: [] } },
      { status: 201 },
    ]);
    global.fetch = fetchMock;

    await postToJira(["PROJ-1"], pr, config, "update", "opened", false);

    const expectedAuth =
      "Basic " + Buffer.from("user@example.com:test-token").toString("base64");
    const [, getOpts] = getCall(fetchMock, 0);
    expect((getOpts.headers as Record<string, string>).Authorization).toBe(
      expectedAuth,
    );
  });

  it("includes PR title as linked heading in comment body", async () => {
    const fetchMock = mockFetch([{ status: 201 }]);
    global.fetch = fetchMock;

    await postToJira(["PROJ-1"], pr, config, "update", "opened", false);

    const [, postOpts] = getCall(fetchMock, 0);
    const body = JSON.parse(postOpts.body as string);
    expect(body.body).toContain(
      "[PROJ-1 Add feature|https://github.com/org/repo/pull/42]",
    );
  });

  it("does not match a different PR URL", async () => {
    const fetchMock = mockFetch([
      {
        status: 200,
        body: {
          comments: [
            {
              id: "10001",
              body: "content [PR|https://github.com/org/repo/pull/99]",
            },
          ],
        },
      },
      { status: 201 },
    ]);
    global.fetch = fetchMock;

    await postToJira(["PROJ-1"], pr, config, "update", "synchronize", false);

    const [, postOpts] = getCall(fetchMock, 1);
    expect(postOpts.method).toBe("POST");
  });

  it("mode 'new' always creates without checking existing comments", async () => {
    const fetchMock = mockFetch([{ status: 201 }]);
    global.fetch = fetchMock;

    await postToJira(["PROJ-1"], pr, config, "new", "opened", false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [postUrl, postOpts] = getCall(fetchMock, 0);
    expect(postUrl).toBe(
      "https://test.atlassian.net/rest/api/2/issue/PROJ-1/comment",
    );
    expect(postOpts.method).toBe("POST");
    expect(core.info).toHaveBeenCalledWith("Created comment on PROJ-1");
  });

  it("mode 'minimal' posts full comment when PR is opened", async () => {
    const fetchMock = mockFetch([{ status: 201 }]);
    global.fetch = fetchMock;

    await postToJira(["PROJ-1"], pr, config, "minimal", "opened", false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, postOpts] = getCall(fetchMock, 0);
    const body = JSON.parse(postOpts.body as string);
    expect(body.body).toContain("[PROJ-1 Add feature|");
    expect(body.body).toContain("Added a new feature");
    expect(core.info).toHaveBeenCalledWith("Created comment on PROJ-1");
  });

  it("mode 'minimal' posts single-line on subsequent events", async () => {
    const fetchMock = mockFetch([{ status: 201 }]);
    global.fetch = fetchMock;

    await postToJira(["PROJ-1"], pr, config, "minimal", "synchronize", false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, postOpts] = getCall(fetchMock, 0);
    expect(postOpts.method).toBe("POST");
    const body = JSON.parse(postOpts.body as string);
    expect(body.body).toBe(
      "PR updated: [PROJ-1 Add feature|https://github.com/org/repo/pull/42]",
    );
    expect(core.info).toHaveBeenCalledWith("Created minimal comment on PROJ-1");
  });

  it("continues to next issue after one fails (failOnError=false)", async () => {
    const fetchMock = mockFetch([
      { status: 404 },
      { status: 200, body: { comments: [] } },
      { status: 201 },
    ]);
    global.fetch = fetchMock;

    await postToJira(
      ["PROJ-1", "PROJ-2"],
      pr,
      config,
      "update",
      "opened",
      false,
    );

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("Failed to post to PROJ-1"),
    );
    expect(core.info).toHaveBeenCalledWith("Created comment on PROJ-2");
  });
});
