import * as core from "@actions/core";
import j2m from "jira2md";
import { JiraCommentMode, JiraConfig, PrContext } from "./types";

interface ImageRef {
  alt: string;
  url: string;
}

const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
};

export function extractImageUrls(markdown: string): ImageRef[] {
  const results: ImageRef[] = [];
  const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    results.push({ alt: match[1], url: match[2] });
  }
  return results;
}

function isGitHubUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "github.com" || host.endsWith(".githubusercontent.com");
  } catch {
    return false;
  }
}

function filenameFromUrl(url: string, contentType: string | null): string {
  const pathname = new URL(url).pathname;
  let basename = pathname.split("/").pop() || "image";

  const hasExt = /\.\w{2,5}$/.test(basename);
  if (!hasExt && contentType) {
    const ext = CONTENT_TYPE_TO_EXT[contentType] || ".bin";
    basename += ext;
  }

  return basename;
}

export async function downloadImage(
  url: string,
  githubToken?: string,
): Promise<{ buffer: Buffer; filename: string; contentType: string } | null> {
  try {
    const headers: Record<string, string> = {};
    if (githubToken && isGitHubUrl(url)) {
      headers["Authorization"] = `token ${githubToken}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      core.warning(`Failed to download image ${url}: ${response.status}`);
      return null;
    }

    const contentType =
      response.headers.get("content-type") || "application/octet-stream";
    const buffer = Buffer.from(await response.arrayBuffer());
    const filename = filenameFromUrl(url, contentType);

    return { buffer, filename, contentType };
  } catch (error) {
    core.warning(
      `Failed to download image ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export async function uploadAttachment(
  issueKey: string,
  filename: string,
  buffer: Buffer,
  contentType: string,
  config: JiraConfig,
): Promise<boolean> {
  const url = `${config.baseUrl}/rest/api/2/issue/${issueKey}/attachments`;

  const boundary = `----formdata-${Date.now()}`;
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;

  const body = Buffer.concat([
    Buffer.from(header),
    buffer,
    Buffer.from(footer),
  ]);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader(config),
      "X-Atlassian-Token": "no-check",
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    core.warning(
      `Failed to upload attachment ${filename} to ${issueKey}: ${response.status}`,
    );
    return false;
  }
  return true;
}

export function replaceImageUrls(
  markdown: string,
  urlToFilename: Map<string, string>,
): string {
  return markdown.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (original, alt: string, url: string) => {
      const filename = urlToFilename.get(url);
      return filename ? `![${alt}](${filename})` : original;
    },
  );
}

function buildFullBody(pr: PrContext): string {
  const wikiBody = j2m.to_jira(pr.body);
  return [`h3. [${pr.title}|${pr.url}]`, "", wikiBody].join("\n");
}

function buildMinimalBody(pr: PrContext): string {
  return `PR updated: [${pr.title}|${pr.url}]`;
}

function authHeader(config: JiraConfig): string {
  return (
    "Basic " +
    Buffer.from(`${config.email}:${config.apiToken}`).toString("base64")
  );
}

interface JiraComment {
  id: string;
  body: string;
}

async function findExistingComment(
  issueKey: string,
  prUrl: string,
  config: JiraConfig,
): Promise<string | null> {
  const url = `${config.baseUrl}/rest/api/2/issue/${issueKey}/comment`;
  const response = await fetch(url, {
    headers: {
      Authorization: authHeader(config),
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch comments for ${issueKey}: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as { comments: JiraComment[] };

  for (const comment of data.comments) {
    if (comment.body.includes(prUrl)) {
      return comment.id;
    }
  }

  return null;
}

async function createComment(
  issueKey: string,
  body: string,
  config: JiraConfig,
): Promise<void> {
  const url = `${config.baseUrl}/rest/api/2/issue/${issueKey}/comment`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader(config),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ body }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to create comment on ${issueKey}: ${response.status} ${response.statusText}`,
    );
  }
}

async function updateComment(
  issueKey: string,
  commentId: string,
  body: string,
  config: JiraConfig,
): Promise<void> {
  const url = `${config.baseUrl}/rest/api/2/issue/${issueKey}/comment/${commentId}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: authHeader(config),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ body }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to update comment ${commentId} on ${issueKey}: ${response.status} ${response.statusText}`,
    );
  }
}

export async function postToJira(
  keys: string[],
  pr: PrContext,
  config: JiraConfig,
  mode: JiraCommentMode,
  prAction: string,
  failOnError: boolean,
  githubToken?: string,
): Promise<void> {
  config = { ...config, baseUrl: config.baseUrl.replace(/\/+$/, "") };

  // Extract and download images once (dedup by URL)
  const images = extractImageUrls(pr.body);
  const downloaded = new Map<
    string,
    { buffer: Buffer; filename: string; contentType: string }
  >();

  if (images.length > 0) {
    core.info(`Found ${images.length} image(s) in PR body`);
    const seenUrls = new Set<string>();
    for (const img of images) {
      if (seenUrls.has(img.url)) continue;
      seenUrls.add(img.url);
      const result = await downloadImage(img.url, githubToken);
      if (result) {
        downloaded.set(img.url, result);
      }
    }
  }

  for (const key of keys) {
    try {
      // Upload attachments for this issue and build URL→filename map
      const urlToFilename = new Map<string, string>();
      for (const [url, { buffer, filename, contentType }] of downloaded) {
        const ok = await uploadAttachment(
          key,
          filename,
          buffer,
          contentType,
          config,
        );
        if (ok) {
          urlToFilename.set(url, filename);
          core.info(`Uploaded ${filename} to ${key}`);
        }
      }

      // Replace image URLs in PR body before building comment
      const prWithImages = {
        ...pr,
        body:
          urlToFilename.size > 0
            ? replaceImageUrls(pr.body, urlToFilename)
            : pr.body,
      };

      if (mode === "update") {
        const body = buildFullBody(prWithImages);
        if (prAction === "opened") {
          await createComment(key, body, config);
          core.info(`Created comment on ${key}`);
        } else {
          const existingId = await findExistingComment(key, pr.url, config);
          if (existingId) {
            await updateComment(key, existingId, body, config);
            core.info(`Updated comment on ${key}`);
          } else {
            await createComment(key, body, config);
            core.info(`Created comment on ${key}`);
          }
        }
      } else if (mode === "minimal") {
        if (prAction === "opened") {
          await createComment(key, buildFullBody(prWithImages), config);
          core.info(`Created comment on ${key}`);
        } else {
          await createComment(key, buildMinimalBody(prWithImages), config);
          core.info(`Created minimal comment on ${key}`);
        }
      } else {
        // "new" — always create a full comment
        await createComment(key, buildFullBody(prWithImages), config);
        core.info(`Created comment on ${key}`);
      }
    } catch (error) {
      const msg = `Failed to post to ${key}: ${error instanceof Error ? error.message : String(error)}`;
      if (failOnError) {
        throw new Error(msg);
      }
      core.warning(msg);
    }
  }
}
