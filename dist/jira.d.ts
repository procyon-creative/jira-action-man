import { JiraCommentMode, JiraConfig, PrContext } from "./types";
export declare function postToJira(
  keys: string[],
  pr: PrContext,
  config: JiraConfig,
  mode: JiraCommentMode,
  prAction: string,
  failOnError: boolean,
): Promise<void>;
