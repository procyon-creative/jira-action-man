import { JiraConfig, PrContext } from "./types";
export declare function postToJira(
  keys: string[],
  pr: PrContext,
  config: JiraConfig,
  failOnError: boolean,
): Promise<void>;
