export type Source = "branch" | "title" | "commits" | "body";

export type JiraCommentMode = "update" | "new" | "minimal";

export interface ActionInputs {
  projects: string[];
  from: Source[];
  failOnMissing: boolean;
  blocklist: string[];
  issuePattern: RegExp;
  postToJira: boolean;
  jiraCommentMode: JiraCommentMode;
  jiraFailOnError: boolean;
  transitionTo?: string;
  createIssueOnFailure: boolean;
  issueType: string;
  issueProject?: string;
  githubToken?: string;
  allowedImageHosts?: string[];
}

export interface FailureContext {
  /** Human label for the failing thing, e.g. "PR #6" or "branch main". */
  title: string;
  /** owner/repo */
  repo?: string;
  prNumber?: number;
  branch?: string;
  /** PR html_url, when a PR is associated. */
  url?: string;
  /** URL of the failed workflow run, when available. */
  runUrl?: string;
}

export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export interface PrContext {
  number: number;
  title: string;
  body: string;
  url: string;
}

export interface SourceTexts {
  branch?: string;
  title?: string;
  commits?: string[];
  body?: string;
}
