import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  ActionInputs,
  JiraCommentMode,
  JiraConfig,
  PrContext,
  Source,
} from "./types";
import {
  DEFAULT_BLOCKLIST,
  DEFAULT_ISSUE_PATTERN,
  extractKeysFromTexts,
} from "./extract";
import { collectSourceTexts, sourceTextsToArray } from "./sources";
import { postToJira } from "./jira";

function parseInputs(): ActionInputs {
  const projectsRaw = core.getInput("projects");
  const projects = projectsRaw
    ? projectsRaw
        .split(",")
        .map((p) => p.trim().toUpperCase())
        .filter(Boolean)
    : [];

  const fromRaw = core.getInput("from") || "branch,title,commits";
  const from = fromRaw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) as Source[];

  const failOnMissing = core.getInput("fail_on_missing") === "true";

  const blocklistRaw = core.getInput("blocklist");
  let blocklist: string[];
  if (blocklistRaw.toLowerCase() === "none") {
    blocklist = [];
  } else if (blocklistRaw !== "") {
    blocklist = blocklistRaw
      .split(",")
      .map((b) => b.trim().toUpperCase())
      .filter(Boolean);
  } else {
    blocklist = DEFAULT_BLOCKLIST;
  }

  const patternRaw = core.getInput("issue_pattern");
  const issuePattern = new RegExp(patternRaw || DEFAULT_ISSUE_PATTERN, "g");

  const postToJira = core.getInput("post_to_jira") === "true";
  const jiraCommentModeRaw = core.getInput("jira_comment_mode") || "update";
  const jiraCommentMode = (
    ["update", "new", "minimal"].includes(jiraCommentModeRaw)
      ? jiraCommentModeRaw
      : "update"
  ) as JiraCommentMode;
  const jiraFailOnError = core.getInput("jira_fail_on_error") === "true";

  return {
    projects,
    from,
    failOnMissing,
    blocklist,
    issuePattern,
    postToJira,
    jiraCommentMode,
    jiraFailOnError,
  };
}

async function run(): Promise<void> {
  try {
    const inputs = parseInputs();

    core.info(`Looking for keys from: ${inputs.from.join(", ")}`);
    if (inputs.projects.length > 0) {
      core.info(`Filtering to projects: ${inputs.projects.join(", ")}`);
    }

    const sourceTexts = collectSourceTexts(inputs.from);
    const texts = sourceTextsToArray(sourceTexts);

    core.debug(`Collected ${texts.length} text(s) to scan`);
    for (const t of texts) {
      core.debug(`  → "${t}"`);
    }

    const keys = extractKeysFromTexts(
      texts,
      inputs.projects,
      inputs.blocklist,
      inputs.issuePattern,
    );

    core.setOutput("keys", JSON.stringify(keys));
    core.setOutput("key", keys[0] || "");
    core.setOutput("found", keys.length > 0 ? "true" : "false");

    if (keys.length > 0) {
      core.info(`Found keys: ${keys.join(", ")}`);
    } else {
      const msg = "No Jira issue keys found";
      if (inputs.failOnMissing) {
        core.setFailed(msg);
      } else {
        core.info(msg);
      }
    }

    if (inputs.postToJira && keys.length > 0) {
      const { context } = github;
      const isPr =
        context.eventName === "pull_request" ||
        context.eventName === "pull_request_target";

      if (isPr && context.payload.pull_request) {
        const jiraConfig: JiraConfig = {
          baseUrl: core.getInput("jira_base_url"),
          email: core.getInput("jira_email"),
          apiToken: core.getInput("jira_api_token"),
        };

        if (!jiraConfig.baseUrl || !jiraConfig.email || !jiraConfig.apiToken) {
          const msg =
            "post_to_jira is enabled but jira_base_url, jira_email, or jira_api_token is missing";
          if (inputs.jiraFailOnError) {
            core.setFailed(msg);
          } else {
            core.warning(msg);
          }
        } else {
          const prPayload = context.payload.pull_request;
          const pr: PrContext = {
            number: prPayload.number as number,
            title: (prPayload.title as string) || "",
            body: (prPayload.body as string) || "",
            url: prPayload.html_url as string,
          };

          const prAction = (context.payload.action as string) || "opened";
          await postToJira(
            keys,
            pr,
            jiraConfig,
            inputs.jiraCommentMode,
            prAction,
            inputs.jiraFailOnError,
          );
        }
      } else if (!isPr) {
        core.info(
          "post_to_jira is enabled but event is not a pull_request — skipping",
        );
      }
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

run();
