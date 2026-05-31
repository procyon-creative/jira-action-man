import * as core from "@actions/core";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import j2m from "jira2md";
import { marked } from "marked";
import { JiraCommentMode, JiraConfig, PrContext } from "./types";

interface ImageRef {
  alt: string;
  url: string;
  raw: string;
  title?: string;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
};

// RFC 1918 / loopback / link-local patterns for SSRF protection
const PRIVATE_IP_PATTERNS = [
  /^127\./, // loopback
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^169\.254\./, // link-local
  /^0\./, // 0.0.0.0/8
  /^::1$/, // IPv6 loopback
  /^fe80:/i, // IPv6 link-local
  /^f[cd]/i, // IPv6 unique local (fc00::/7)
];

export function extractImageUrls(markdown: string): ImageRef[] {
  const results: ImageRef[] = [];
  const tokens = marked.lexer(markdown);
  marked.walkTokens(tokens, (token) => {
    if (token.type === "image") {
      results.push({
        alt: token.text,
        url: token.href,
        raw: token.raw,
        title: token.title || undefined,
      });
    }
  });
  return results;
}

export function replaceImageUrls(
  markdown: string,
  urlToFilename: Map<string, string>,
): string {
  // Extract images to get their raw tokens, then replace in reverse order
  // to preserve string positions
  const images = extractImageUrls(markdown);
  let result = markdown;
  // Process in reverse so earlier replacements don't shift later positions
  for (let i = images.length - 1; i >= 0; i--) {
    const img = images[i];
    const filename = urlToFilename.get(img.url);
    if (filename) {
      const titlePart = img.title ? ` "${img.title}"` : "";
      const replacement = `![${img.alt}](${filename}${titlePart})`;
      const idx = result.lastIndexOf(img.raw);
      if (idx !== -1) {
        result =
          result.slice(0, idx) +
          replacement +
          result.slice(idx + img.raw.length);
      }
    }
  }
  return result;
}

function isGitHubUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "github.com" || host.endsWith(".githubusercontent.com");
  } catch {
    return false;
  }
}

// Strip the IPv4-mapped IPv6 prefix (::ffff:) so embedded IPv4 addresses
// are matched against the IPv4 private patterns.
function normalizeIp(ip: string): string {
  const lower = ip.toLowerCase();
  if (lower.startsWith("::ffff:")) {
    const rest = ip.slice(7);
    if (isIP(rest) === 4) return rest;
  }
  return ip;
}

export function isPrivateIp(ip: string): boolean {
  const normalized = normalizeIp(ip);
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(normalized)) {
      return true;
    }
  }
  return false;
}

export async function isSafeUrl(
  url: string,
  allowedHosts?: string[],
): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  // HTTPS only
  if (parsed.protocol !== "https:") {
    return false;
  }

  // URL.hostname returns IPv6 wrapped in brackets — strip them
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  const hasAllowlist = !!(allowedHosts && allowedHosts.length > 0);

  // If hostname is a literal IP, check it directly — DNS lookup would be a no-op
  // and the regex patterns must only be applied to actual IPs (not hostnames
  // that happen to start with digits, like "10.example.com").
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) return false;
    if (hasAllowlist && !allowedHosts!.includes(hostname)) return false;
    return true;
  }

  // Hostname path: apply allowlist as a *filter*, not a bypass — DNS checks
  // still run so an allowlisted host that resolves to a private address is rejected.
  if (hasAllowlist && !allowedHosts!.includes(hostname)) {
    return false;
  }

  // Resolve every A/AAAA record and reject if any points to a private range.
  try {
    const addresses = await lookup(hostname, { all: true });
    if (addresses.length === 0) return false;
    for (const { address } of addresses) {
      if (isPrivateIp(address)) return false;
    }
  } catch {
    return false;
  }

  return true;
}

function stripContentType(raw: string): string {
  return raw.split(";")[0].trim();
}

function filenameFromUrl(url: string, contentType: string | null): string {
  const pathname = new URL(url).pathname;
  let basename = pathname.split("/").pop() || "image";

  const hasExt = /\.\w{2,5}$/.test(basename);
  if (!hasExt && contentType) {
    const ext = CONTENT_TYPE_TO_EXT[stripContentType(contentType)] || ".bin";
    basename += ext;
  }

  return basename;
}

export function deduplicateFilenames(
  entries: { url: string; filename: string }[],
): Map<string, string> {
  // Pass 1: record every natural filename so suffixed candidates don't steal
  // a name that another entry still needs.
  const natural = new Set<string>();
  for (const e of entries) {
    natural.add(e.filename);
  }

  // Pass 2: walk entries, assigning the natural name on first occurrence and
  // a fresh numeric suffix on duplicates — skipping any candidate that's
  // either already assigned or claimed by a different entry's natural name.
  const assigned = new Set<string>();
  const result = new Map<string, string>();
  for (const e of entries) {
    if (!assigned.has(e.filename)) {
      assigned.add(e.filename);
      result.set(e.url, e.filename);
      continue;
    }
    const dotIdx = e.filename.lastIndexOf(".");
    const stem = dotIdx !== -1 ? e.filename.slice(0, dotIdx) : e.filename;
    const ext = dotIdx !== -1 ? e.filename.slice(dotIdx) : "";
    let n = 1;
    let candidate = `${stem}-${n}${ext}`;
    while (assigned.has(candidate) || natural.has(candidate)) {
      n++;
      candidate = `${stem}-${n}${ext}`;
    }
    assigned.add(candidate);
    result.set(e.url, candidate);
  }
  return result;
}

export async function downloadImage(
  url: string,
  githubToken?: string,
  allowedHosts?: string[],
): Promise<{ buffer: Buffer; filename: string; contentType: string } | null> {
  try {
    if (!(await isSafeUrl(url, allowedHosts))) {
      core.warning(`Blocked image download from unsafe URL: ${url}`);
      return null;
    }

    const headers: Record<string, string> = {};
    if (githubToken && isGitHubUrl(url)) {
      headers["Authorization"] = `token ${githubToken}`;
    }

    // redirect: "manual" prevents fetch from auto-following redirects to a
    // private address that wouldn't pass isSafeUrl.
    const response = await fetch(url, { headers, redirect: "manual" });

    // Manual redirect handling returns the 3xx response itself. Reject it —
    // the redirect target would need its own SSRF validation.
    if (response.status >= 300 && response.status < 400) {
      core.warning(
        `Blocked redirect from ${url} to ${response.headers.get("location") || "(unknown)"}`,
      );
      return null;
    }

    if (!response.ok) {
      core.warning(`Failed to download image ${url}: ${response.status}`);
      return null;
    }

    const rawContentType =
      response.headers.get("content-type") || "application/octet-stream";
    const contentType = stripContentType(rawContentType).toLowerCase();

    // Validate content type is an image
    if (!contentType.startsWith("image/")) {
      core.warning(
        `Rejected non-image content-type "${contentType}" from ${url}`,
      );
      return null;
    }

    // Check content-length before reading body
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_BYTES) {
      core.warning(
        `Rejected image from ${url}: content-length ${contentLength} exceeds ${MAX_IMAGE_BYTES} bytes`,
      );
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();

    // Safety net: check actual size after reading
    if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
      core.warning(
        `Rejected image from ${url}: size ${arrayBuffer.byteLength} exceeds ${MAX_IMAGE_BYTES} bytes`,
      );
      return null;
    }

    const buffer = Buffer.from(arrayBuffer);
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

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(buffer)], { type: contentType }),
    filename,
  );

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader(config),
      "X-Atlassian-Token": "no-check",
    },
    body: form,
  });

  if (!response.ok) {
    core.warning(
      `Failed to upload attachment ${filename} to ${issueKey}: ${response.status}`,
    );
    return false;
  }
  return true;
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
  allowedHosts?: string[],
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
      const result = await downloadImage(img.url, githubToken, allowedHosts);
      if (result) {
        downloaded.set(img.url, result);
      }
    }

    // Deduplicate filenames across all downloaded images
    if (downloaded.size > 1) {
      const entries = Array.from(downloaded, ([url, d]) => ({
        url,
        filename: d.filename,
      }));
      const dedupedNames = deduplicateFilenames(entries);
      for (const [url, newName] of dedupedNames) {
        const existing = downloaded.get(url)!;
        existing.filename = newName;
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

interface JiraTransition {
  id: string;
  name: string;
}

export async function transitionIssues(
  keys: string[],
  targetStatus: string,
  config: JiraConfig,
  failOnError: boolean,
): Promise<void> {
  config = { ...config, baseUrl: config.baseUrl.replace(/\/+$/, "") };
  const wanted = targetStatus.toLowerCase();

  for (const key of keys) {
    try {
      const url = `${config.baseUrl}/rest/api/2/issue/${encodeURIComponent(key)}/transitions`;

      const listRes = await fetch(url, {
        headers: {
          Authorization: authHeader(config),
          Accept: "application/json",
        },
      });
      if (!listRes.ok) {
        throw new Error(
          `Failed to fetch transitions for ${key}: ${listRes.status} ${listRes.statusText}`,
        );
      }

      const { transitions } = (await listRes.json()) as {
        transitions: JiraTransition[];
      };
      const match = transitions.find((t) => t.name.toLowerCase() === wanted);

      if (!match) {
        const available = transitions.map((t) => t.name).join(", ") || "none";
        core.warning(
          `No "${targetStatus}" transition available for ${key} (available: ${available})`,
        );
        continue;
      }

      const postRes = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: authHeader(config),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ transition: { id: match.id } }),
      });
      if (!postRes.ok) {
        throw new Error(
          `Failed to transition ${key} to ${targetStatus}: ${postRes.status} ${postRes.statusText}`,
        );
      }

      core.info(`Transitioned ${key} → ${targetStatus}`);
    } catch (error) {
      const msg = `Failed to transition ${key}: ${error instanceof Error ? error.message : String(error)}`;
      if (failOnError) {
        throw new Error(msg);
      }
      core.warning(msg);
    }
  }
}
