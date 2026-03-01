#!/usr/bin/env npx tsx
/**
 * Local test script for posting to Jira.
 *
 * Usage:
 *   npx ts-node scripts/test-jira-post.ts JAM-2
 *   npx ts-node scripts/test-jira-post.ts JAM-2 --dry-run
 *
 * Reads Jira credentials from .env (INPUT_JIRA_BASE_URL, INPUT_JIRA_EMAIL, INPUT_JIRA_API_TOKEN).
 */
import { config } from "dotenv";
config();

import { postToJira } from "../src/jira";
import { JiraConfig, PrContext } from "../src/types";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const j2m: { to_jira: (md: string) => string } = require("jira2md");

const issueKey = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

if (!issueKey) {
  console.error(
    "Usage: npx ts-node scripts/test-jira-post.ts <ISSUE-KEY> [--dry-run]",
  );
  process.exit(1);
}

const jiraConfig: JiraConfig = {
  baseUrl: process.env.INPUT_JIRA_BASE_URL || "",
  email: process.env.INPUT_JIRA_EMAIL || "",
  apiToken: process.env.INPUT_JIRA_API_TOKEN || "",
};

if (!jiraConfig.baseUrl || !jiraConfig.email || !jiraConfig.apiToken) {
  console.error(
    "Missing Jira credentials. Set INPUT_JIRA_BASE_URL, INPUT_JIRA_EMAIL, INPUT_JIRA_API_TOKEN in .env",
  );
  process.exit(1);
}

const testPr: PrContext = {
  number: 999,
  title: `${issueKey} Test comment from local script`,
  body: [
    "## Test Comment",
    "",
    "This is a **test comment** posted from `scripts/test-jira-post.ts`.",
    "",
    "- Item one",
    "- Item two",
    "",
    "```typescript",
    'console.log("hello from jira-action-man");',
    "```",
  ].join("\n"),
  url: "https://github.com/procyon-creative/jira-action-man/pull/999",
};

async function main() {
  console.log(`Issue:    ${issueKey}`);
  console.log(`Base URL: ${jiraConfig.baseUrl}`);
  console.log(`Email:    ${jiraConfig.email}`);
  console.log();

  if (dryRun) {
    console.log("--- Dry run: comment body (wiki markup) ---");
    console.log(j2m.to_jira(testPr.body));
    console.log("-------------------------------------------");
    return;
  }

  await postToJira([issueKey], testPr, jiraConfig, true);
  console.log("Done!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
