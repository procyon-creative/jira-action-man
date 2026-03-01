import * as core from "@actions/core";
import j2m from "jira2md";
import { JiraCommentMode, JiraConfig, PrContext } from "./types";

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
): Promise<void> {
  config = { ...config, baseUrl: config.baseUrl.replace(/\/+$/, "") };

  for (const key of keys) {
    try {
      if (mode === "update") {
        const body = buildFullBody(pr);
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
          await createComment(key, buildFullBody(pr), config);
          core.info(`Created comment on ${key}`);
        } else {
          await createComment(key, buildMinimalBody(pr), config);
          core.info(`Created minimal comment on ${key}`);
        }
      } else {
        // "new" — always create a full comment
        await createComment(key, buildFullBody(pr), config);
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
