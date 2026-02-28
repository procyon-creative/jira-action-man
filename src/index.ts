import * as core from "@actions/core";
import { ActionInputs, Source } from "./types";
import {
  DEFAULT_BLOCKLIST,
  DEFAULT_ISSUE_PATTERN,
  extractKeysFromTexts,
} from "./extract";
import { collectSourceTexts, sourceTextsToArray } from "./sources";

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

  const failOnMissing = core.getInput("fail-on-missing") === "true";

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

  const patternRaw = core.getInput("issue-pattern");
  const issuePattern = new RegExp(patternRaw || DEFAULT_ISSUE_PATTERN, "g");

  return { projects, from, failOnMissing, blocklist, issuePattern };
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
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

run();
