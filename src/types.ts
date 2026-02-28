export type Source = "branch" | "title" | "commits" | "body";

export interface ActionInputs {
  projects: string[];
  from: Source[];
  failOnMissing: boolean;
  blocklist: string[];
  issuePattern: RegExp;
}

export interface SourceTexts {
  branch?: string;
  title?: string;
  commits?: string[];
  body?: string;
}
