import * as core from "@actions/core";
import * as github from "@actions/github";
import { FailureContext, JiraConfig } from "./types";
import { createIssue, searchIssue } from "./jira";

/**
 * Work out what failed, from the GitHub event context.
 *
 * - `workflow_run`: the natural "CI finished" signal. We only return a context
 *   when the run actually FAILED (conclusion === "failure"); otherwise null so
 *   the caller does nothing. PR info comes from `workflow_run.pull_requests`.
 * - any other event (e.g. `pull_request`): we assume the workflow gated this
 *   step on failure itself (`if: failure()`), so we build the context from the
 *   PR payload (or the ref for pushes).
 *
 * Returns null when there's nothing to file a ticket for.
 */
export function resolveFailureContext(): FailureContext | null {
  const { context } = github;
  const repo =
    (context.payload.repository?.full_name as string | undefined) ||
    (context.payload.repository
      ? `${context.payload.repository.owner?.login}/${context.payload.repository.name}`
      : undefined);

  if (context.eventName === "workflow_run") {
    const wr = context.payload.workflow_run as
      | {
          conclusion?: string;
          head_branch?: string;
          html_url?: string;
          pull_requests?: { number: number }[];
        }
      | undefined;
    if (!wr) return null;
    // Only act on genuine failures.
    if (wr.conclusion !== "failure") return null;

    const prNumber = wr.pull_requests?.[0]?.number;
    const branch = wr.head_branch;
    const url =
      prNumber && repo
        ? `https://github.com/${repo}/pull/${prNumber}`
        : undefined;
    return {
      title: prNumber ? `PR #${prNumber}` : `branch ${branch ?? "?"}`,
      repo,
      prNumber,
      branch,
      url,
      runUrl: wr.html_url,
    };
  }

  const pr = context.payload.pull_request as
    | {
        number: number;
        title?: string;
        html_url?: string;
        head?: { ref?: string };
      }
    | undefined;
  if (pr) {
    return {
      title: pr.title || `PR #${pr.number}`,
      repo,
      prNumber: pr.number,
      branch: pr.head?.ref,
      url: pr.html_url,
    };
  }

  // Fallback: a push/other event the workflow gated on failure.
  const branch = context.ref?.replace(/^refs\/heads\//, "");
  return { title: branch ? `branch ${branch}` : "build", repo, branch };
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Build the summary, description and labels for a CI-failure ticket. Pure — no
 * network. The second label is a deterministic dedup key so repeated failures of
 * the same PR/branch reuse a single open ticket.
 */
export function buildFailureIssue(ctx: FailureContext): {
  summary: string;
  description: string;
  labels: string[];
  dedupeLabel: string;
} {
  const idLabel = ctx.prNumber
    ? `PR #${ctx.prNumber}`
    : ctx.branch
      ? `branch ${ctx.branch}`
      : "build";
  const summary =
    `CI failed: ${idLabel}${ctx.prNumber && ctx.branch ? ` (${ctx.branch})` : ""}`.slice(
      0,
      250,
    );

  const idSlug = ctx.prNumber
    ? `pr-${ctx.prNumber}`
    : slug(ctx.branch || "build");
  const repoSlug = ctx.repo ? slug(ctx.repo) : "repo";
  const dedupeLabel = `cifail-${repoSlug}-${idSlug}`.slice(0, 50);
  const labels = ["ci-failure", dedupeLabel];

  const lines = [
    "A CI run failed. This ticket was opened automatically by jira-action-man.",
    "",
  ];
  if (ctx.url) lines.push(`* PR: ${ctx.url}`);
  if (ctx.branch) lines.push(`* Branch: {{${ctx.branch}}}`);
  if (ctx.runUrl) lines.push(`* Failed run: ${ctx.runUrl}`);
  if (ctx.repo) lines.push(`* Repo: ${ctx.repo}`);

  return { summary, description: lines.join("\n"), labels, dedupeLabel };
}

/**
 * Create a CI-failure ticket, unless an open one already exists for the same
 * PR/branch (matched by the dedup label). Obeys failOnError (warn by default).
 * Returns the issue key (existing or new), or null on a swallowed error.
 */
export async function createFailureIssue(
  ctx: FailureContext,
  config: JiraConfig,
  projectKey: string,
  issueType: string,
  failOnError: boolean,
): Promise<string | null> {
  const { summary, description, labels, dedupeLabel } = buildFailureIssue(ctx);
  try {
    const jql = `project = "${projectKey}" AND statusCategory != Done AND labels = "${dedupeLabel}"`;
    const existing = await searchIssue(config, jql);
    if (existing) {
      core.info(
        `Open CI-failure ticket already exists for ${dedupeLabel}: ${existing} — not creating a duplicate`,
      );
      return existing;
    }

    const key = await createIssue(config, {
      projectKey,
      issueType,
      summary,
      description,
      labels,
    });
    core.info(`Created CI-failure ticket ${key} (${projectKey})`);
    return key;
  } catch (error) {
    const msg = `Failed to create CI-failure issue: ${error instanceof Error ? error.message : String(error)}`;
    if (failOnError) {
      throw new Error(msg);
    }
    core.warning(msg);
    return null;
  }
}
