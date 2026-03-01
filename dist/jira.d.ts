import { JiraCommentMode, JiraConfig, PrContext } from "./types";
interface ImageRef {
  alt: string;
  url: string;
}
export declare function extractImageUrls(markdown: string): ImageRef[];
export declare function downloadImage(
  url: string,
  githubToken?: string,
): Promise<{
  buffer: Buffer;
  filename: string;
  contentType: string;
} | null>;
export declare function uploadAttachment(
  issueKey: string,
  filename: string,
  buffer: Buffer,
  contentType: string,
  config: JiraConfig,
): Promise<boolean>;
export declare function replaceImageUrls(
  markdown: string,
  urlToFilename: Map<string, string>,
): string;
export declare function postToJira(
  keys: string[],
  pr: PrContext,
  config: JiraConfig,
  mode: JiraCommentMode,
  prAction: string,
  failOnError: boolean,
  githubToken?: string,
): Promise<void>;
export {};
