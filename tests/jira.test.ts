import {
  postToJira,
  extractImageUrls,
  replaceImageUrls,
  downloadImage,
  isSafeUrl,
  deduplicateFilenames,
} from "../src/jira";
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

describe("extractImageUrls", () => {
  it("returns empty array when no images", () => {
    expect(extractImageUrls("Just some text")).toEqual([]);
  });

  it("extracts a single image", () => {
    const md = "Before ![screenshot](https://example.com/img.png) after";
    const results = extractImageUrls(md);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      alt: "screenshot",
      url: "https://example.com/img.png",
    });
  });

  it("extracts multiple images", () => {
    const md =
      "![a](https://example.com/1.png) text ![b](https://example.com/2.jpg)";
    const results = extractImageUrls(md);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      alt: "a",
      url: "https://example.com/1.png",
    });
    expect(results[1]).toMatchObject({
      alt: "b",
      url: "https://example.com/2.jpg",
    });
  });

  it("handles empty alt text", () => {
    const md = "![](https://example.com/img.png)";
    const results = extractImageUrls(md);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      alt: "",
      url: "https://example.com/img.png",
    });
  });

  it("extracts image with title text", () => {
    const md = '![alt](https://example.com/img.png "A title")';
    const results = extractImageUrls(md);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      alt: "alt",
      url: "https://example.com/img.png",
    });
  });

  it("extracts image inside a blockquote", () => {
    const md = "> Some quote\n>\n> ![bq](https://example.com/bq.png)\n";
    const results = extractImageUrls(md);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      alt: "bq",
      url: "https://example.com/bq.png",
    });
  });
});

describe("replaceImageUrls", () => {
  it("replaces matched URLs with filenames", () => {
    const md = "See ![screenshot](https://example.com/img.png) for details";
    const map = new Map([["https://example.com/img.png", "img.png"]]);
    expect(replaceImageUrls(md, map)).toBe(
      "See ![screenshot](img.png) for details",
    );
  });

  it("leaves unmatched URLs unchanged", () => {
    const md = "![a](https://example.com/1.png) ![b](https://other.com/2.png)";
    const map = new Map([["https://example.com/1.png", "1.png"]]);
    expect(replaceImageUrls(md, map)).toBe(
      "![a](1.png) ![b](https://other.com/2.png)",
    );
  });
});

describe("isSafeUrl", () => {
  it("allows HTTPS URLs", () => {
    expect(isSafeUrl("https://example.com/img.png")).toBe(true);
  });

  it("rejects HTTP URLs", () => {
    expect(isSafeUrl("http://example.com/img.png")).toBe(false);
  });

  it("rejects private IP 127.0.0.1", () => {
    expect(isSafeUrl("https://127.0.0.1/img.png")).toBe(false);
  });

  it("rejects private IP 10.x", () => {
    expect(isSafeUrl("https://10.0.0.1/img.png")).toBe(false);
  });

  it("rejects private IP 192.168.x", () => {
    expect(isSafeUrl("https://192.168.1.1/img.png")).toBe(false);
  });

  it("rejects private IP 172.16.x", () => {
    expect(isSafeUrl("https://172.16.0.1/img.png")).toBe(false);
  });

  it("rejects link-local IP 169.254.x", () => {
    expect(isSafeUrl("https://169.254.1.1/img.png")).toBe(false);
  });

  it("allows HTTPS when host is in allowedHosts", () => {
    expect(
      isSafeUrl("https://cdn.example.com/img.png", ["cdn.example.com"]),
    ).toBe(true);
  });

  it("rejects HTTPS when host is not in allowedHosts", () => {
    expect(isSafeUrl("https://evil.com/img.png", ["cdn.example.com"])).toBe(
      false,
    );
  });

  it("rejects invalid URLs", () => {
    expect(isSafeUrl("not-a-url")).toBe(false);
  });
});

describe("downloadImage", () => {
  const origFetch = global.fetch;

  afterEach(() => {
    global.fetch = origFetch;
    core.warning.mockClear();
  });

  it("strips charset from content-type and uses correct extension", async () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "image/jpeg; charset=utf-8" }),
      arrayBuffer: async () => pngBytes.buffer,
    })) as unknown as typeof global.fetch;

    const result = await downloadImage("https://example.com/photo");
    expect(result).not.toBeNull();
    expect(result!.filename).toBe("photo.jpg");
    expect(result!.contentType).toBe("image/jpeg");
  });

  it("rejects non-image content-type", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as unknown as typeof global.fetch;

    const result = await downloadImage("https://example.com/page.html");
    expect(result).toBeNull();
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('non-image content-type "text/html"'),
    );
  });

  it("rejects oversized images by content-length", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({
        "content-type": "image/png",
        "content-length": "20000000",
      }),
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as unknown as typeof global.fetch;

    const result = await downloadImage("https://example.com/huge.png");
    expect(result).toBeNull();
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("exceeds"),
    );
  });

  it("blocks unsafe URLs", async () => {
    const result = await downloadImage("http://example.com/img.png");
    expect(result).toBeNull();
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("unsafe URL"),
    );
  });
});

describe("deduplicateFilenames", () => {
  it("returns filenames unchanged when no collisions", () => {
    const entries = [
      { url: "https://a.com/1.png", filename: "1.png" },
      { url: "https://b.com/2.png", filename: "2.png" },
    ];
    const result = deduplicateFilenames(entries);
    expect(result.get("https://a.com/1.png")).toBe("1.png");
    expect(result.get("https://b.com/2.png")).toBe("2.png");
  });

  it("appends -1, -2 for colliding filenames", () => {
    const entries = [
      { url: "https://a.com/img.png", filename: "img.png" },
      { url: "https://b.com/img.png", filename: "img.png" },
      { url: "https://c.com/img.png", filename: "img.png" },
    ];
    const result = deduplicateFilenames(entries);
    expect(result.get("https://a.com/img.png")).toBe("img-1.png");
    expect(result.get("https://b.com/img.png")).toBe("img-2.png");
    expect(result.get("https://c.com/img.png")).toBe("img-3.png");
  });

  it("handles files without extensions", () => {
    const entries = [
      { url: "https://a.com/image", filename: "image" },
      { url: "https://b.com/image", filename: "image" },
    ];
    const result = deduplicateFilenames(entries);
    expect(result.get("https://a.com/image")).toBe("image-1");
    expect(result.get("https://b.com/image")).toBe("image-2");
  });
});

describe("postToJira with images", () => {
  const origFetch = global.fetch;

  afterEach(() => {
    global.fetch = origFetch;
    core.info.mockClear();
    core.warning.mockClear();
  });

  it("downloads images, uploads attachments, and replaces URLs in comment", async () => {
    const prWithImage: PrContext = {
      ...pr,
      body: "## Summary\n\n![screenshot](https://example.com/shot.png)\n\nDone.",
    };

    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = jest.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();

      // Image download
      if (urlStr === "https://example.com/shot.png") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Headers({ "content-type": "image/png" }),
          arrayBuffer: async () => pngBytes.buffer,
        };
      }

      // Attachment upload
      if (urlStr.includes("/attachments")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({}),
        };
      }

      // Comment create
      return {
        ok: true,
        status: 201,
        statusText: "OK",
        json: async () => ({}),
      };
    }) as unknown as jest.Mock & typeof global.fetch;
    global.fetch = fetchMock;

    await postToJira(
      ["PROJ-1"],
      prWithImage,
      config,
      "update",
      "opened",
      false,
    );

    // Should have: 1 download + 1 upload + 1 comment = 3 fetches
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Verify attachment upload has correct headers
    const uploadCall = fetchMock.mock.calls[1] as [
      string,
      Record<string, unknown>,
    ];
    expect(uploadCall[0]).toContain("/attachments");
    const uploadHeaders = uploadCall[1].headers as Record<string, string>;
    expect(uploadHeaders["X-Atlassian-Token"]).toBe("no-check");

    // Verify the comment body references the filename, not the URL
    const commentCall = fetchMock.mock.calls[2] as [
      string,
      Record<string, unknown>,
    ];
    const commentBody = JSON.parse(commentCall[1].body as string)
      .body as string;
    expect(commentBody).toContain("!shot.png!");
    expect(commentBody).not.toContain("https://example.com/shot.png");

    expect(core.info).toHaveBeenCalledWith("Found 1 image(s) in PR body");
    expect(core.info).toHaveBeenCalledWith("Uploaded shot.png to PROJ-1");
  });

  it("adds auth header for GitHub URLs when token provided", async () => {
    const prWithGhImage: PrContext = {
      ...pr,
      body: "![img](https://user-images.githubusercontent.com/123/shot.png)",
    };

    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = jest.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("githubusercontent.com")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Headers({ "content-type": "image/png" }),
          arrayBuffer: async () => pngBytes.buffer,
        };
      }
      return {
        ok: true,
        status: urlStr.includes("/attachments") ? 200 : 201,
        statusText: "OK",
        json: async () => ({}),
      };
    }) as unknown as jest.Mock & typeof global.fetch;
    global.fetch = fetchMock;

    await postToJira(
      ["PROJ-1"],
      prWithGhImage,
      config,
      "update",
      "opened",
      false,
      "gh-token-123",
    );

    // Verify download request included auth header
    const downloadCall = fetchMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    const downloadHeaders = downloadCall[1].headers as Record<string, string>;
    expect(downloadHeaders["Authorization"]).toBe("token gh-token-123");
  });

  it("gracefully degrades when image download fails", async () => {
    const prWithImage: PrContext = {
      ...pr,
      body: "![broken](https://example.com/missing.png)\n\nText.",
    };

    const fetchMock = jest.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr === "https://example.com/missing.png") {
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
        };
      }
      return {
        ok: true,
        status: 201,
        statusText: "OK",
        json: async () => ({}),
      };
    }) as unknown as jest.Mock & typeof global.fetch;
    global.fetch = fetchMock;

    await postToJira(
      ["PROJ-1"],
      prWithImage,
      config,
      "update",
      "opened",
      false,
    );

    // Should warn about the download failure
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("Failed to download image"),
    );

    // Should still create the comment (1 download attempt + 1 comment = 2 fetches)
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Comment should still contain the original URL
    const commentCall = fetchMock.mock.calls[1] as [
      string,
      Record<string, unknown>,
    ];
    const commentBody = JSON.parse(commentCall[1].body as string)
      .body as string;
    expect(commentBody).toContain("https://example.com/missing.png");
    expect(core.info).toHaveBeenCalledWith("Created comment on PROJ-1");
  });

  it("deduplicates downloads for the same URL", async () => {
    const prWithDupes: PrContext = {
      ...pr,
      body: "![a](https://example.com/img.png) ![b](https://example.com/img.png)",
    };

    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = jest.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr === "https://example.com/img.png") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Headers({ "content-type": "image/png" }),
          arrayBuffer: async () => pngBytes.buffer,
        };
      }
      return {
        ok: true,
        status: urlStr.includes("/attachments") ? 200 : 201,
        statusText: "OK",
        json: async () => ({}),
      };
    }) as unknown as jest.Mock & typeof global.fetch;
    global.fetch = fetchMock;

    await postToJira(
      ["PROJ-1"],
      prWithDupes,
      config,
      "update",
      "opened",
      false,
    );

    // Only 1 download (deduped) + 1 upload + 1 comment = 3
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(core.info).toHaveBeenCalledWith("Found 2 image(s) in PR body");
  });
});
