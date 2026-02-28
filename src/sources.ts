import * as core from "@actions/core";
import * as github from "@actions/github";
import { Source, SourceTexts } from "./types";

export function collectSourceTexts(requestedSources: Source[]): SourceTexts {
  const { context } = github;
  const eventName = context.eventName;
  const result: SourceTexts = {};

  for (const source of requestedSources) {
    switch (source) {
      case "branch":
        result.branch = getBranch(eventName, context);
        break;
      case "title":
        result.title = getTitle(eventName, context);
        break;
      case "commits":
        result.commits = getCommits(eventName, context);
        break;
      case "body":
        result.body = getBody(eventName, context);
        break;
    }
  }

  return result;
}

function getBranch(
  eventName: string,
  context: typeof github.context,
): string | undefined {
  if (eventName === "pull_request" || eventName === "pull_request_target") {
    const ref = context.payload.pull_request?.head?.ref;
    if (ref) return ref;
  }

  if (eventName === "push") {
    // context.ref is like "refs/heads/feature/PROJ-123"
    const ref = context.ref;
    if (ref) return ref.replace(/^refs\/heads\//, "");
  }

  core.debug(`No branch source for event: ${eventName}`);
  return undefined;
}

function getTitle(
  eventName: string,
  context: typeof github.context,
): string | undefined {
  if (eventName === "pull_request" || eventName === "pull_request_target") {
    return context.payload.pull_request?.title;
  }

  core.debug(`Title source not available for event: ${eventName}`);
  return undefined;
}

function getCommits(
  eventName: string,
  context: typeof github.context,
): string[] | undefined {
  if (eventName === "push") {
    const commits = context.payload.commits;
    if (Array.isArray(commits)) {
      return commits.map((c: { message: string }) => c.message);
    }
  }

  if (eventName === "pull_request" || eventName === "pull_request_target") {
    core.info(
      "Commits source for pull_request events requires API calls — not supported in v1. Use branch/title/body instead.",
    );
  }

  return undefined;
}

function getBody(
  eventName: string,
  context: typeof github.context,
): string | undefined {
  if (eventName === "pull_request" || eventName === "pull_request_target") {
    return context.payload.pull_request?.body ?? undefined;
  }

  core.debug(`Body source not available for event: ${eventName}`);
  return undefined;
}

export function sourceTextsToArray(texts: SourceTexts): string[] {
  const result: string[] = [];
  if (texts.branch) result.push(texts.branch);
  if (texts.title) result.push(texts.title);
  if (texts.commits) result.push(...texts.commits);
  if (texts.body) result.push(texts.body);
  return result;
}
