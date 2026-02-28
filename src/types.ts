export type Source = "branch" | "title" | "commits" | "body";

export interface ActionInputs {
  projects: string[];
  from: Source[];
  failOnMissing: boolean;
  blocklist: string[];
  issuePattern: RegExp;
  postToJira: boolean;
  jiraFailOnError: boolean;
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
