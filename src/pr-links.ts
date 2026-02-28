import * as core from "@actions/core";
import * as github from "@actions/github";

const SECTION_START = "<!-- jira-action-man:start -->";
const SECTION_END = "<!-- jira-action-man:end -->";

function buildJiraSection(keys: string[], baseUrl: string): string {
  const url = baseUrl.replace(/\/+$/, "");
  const links = keys
    .map((key) => `- [${key}](${url}/browse/${key})`)
    .join("\n");

  return `${SECTION_START}\n## Jira\n\n${links}\n${SECTION_END}`;
}

export async function appendJiraLinksToPr(
  keys: string[],
  baseUrl: string,
  token: string,
): Promise<void> {
  const { context } = github;
  const pr = context.payload.pull_request;
  if (!pr) return;

  const currentBody = (pr.body as string) || "";
  const section = buildJiraSection(keys, baseUrl);

  let newBody: string;
  const startIdx = currentBody.indexOf(SECTION_START);
  const endIdx = currentBody.indexOf(SECTION_END);

  if (startIdx !== -1 && endIdx !== -1) {
    // Replace existing section
    newBody =
      currentBody.substring(0, startIdx) +
      section +
      currentBody.substring(endIdx + SECTION_END.length);
  } else {
    // Append to bottom
    newBody = currentBody.trimEnd() + "\n\n" + section;
  }

  if (newBody === currentBody) {
    core.info("PR body already has correct Jira links — skipping update");
    return;
  }

  const octokit = github.getOctokit(token);
  await octokit.rest.pulls.update({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: pr.number as number,
    body: newBody,
  });

  core.info(`Appended Jira links to PR #${pr.number}`);
}
