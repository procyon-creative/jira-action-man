export declare const DEFAULT_ISSUE_PATTERN =
  "(?<![A-Z0-9])([A-Z][A-Z0-9]{1,9}-[0-9]{1,6})(?![A-Z0-9])";
export declare const DEFAULT_BLOCKLIST: string[];
export declare function extractKeys(
  text: string,
  projects: string[],
  blocklist: string[],
  pattern: RegExp,
): string[];
export declare function extractKeysFromTexts(
  texts: string[],
  projects: string[],
  blocklist: string[],
  pattern: RegExp,
): string[];
export declare function mergeAndSort(keys: string[]): string[];
