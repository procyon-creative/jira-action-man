export const DEFAULT_ISSUE_PATTERN =
  "(?<![A-Z0-9])([A-Z][A-Z0-9]{1,9}-[0-9]{1,6})(?![A-Z0-9])";

export const DEFAULT_BLOCKLIST = [
  "SHA",
  "UTF",
  "ISO",
  "TCP",
  "UDP",
  "HTTP",
  "HTTPS",
  "SSL",
  "TLS",
  "SSH",
  "DNS",
  "FTP",
  "SMTP",
  "IMAP",
  "POP",
  "API",
  "URL",
  "URI",
  "XML",
  "JSON",
  "YAML",
  "HTML",
  "CSS",
  "RFC",
  "IEEE",
  "ANSI",
  "ASCII",
];

export function extractKeys(
  text: string,
  projects: string[],
  blocklist: string[],
  pattern: RegExp,
): string[] {
  const matches = text.match(pattern);
  if (!matches) return [];

  return matches.filter((key) => {
    const prefix = key.split("-")[0];
    if (blocklist.includes(prefix)) return false;
    if (projects.length === 0) return true;
    return projects.includes(prefix);
  });
}

export function extractKeysFromTexts(
  texts: string[],
  projects: string[],
  blocklist: string[],
  pattern: RegExp,
): string[] {
  const all = texts.flatMap((t) =>
    extractKeys(t, projects, blocklist, pattern),
  );
  return mergeAndSort(all);
}

export function mergeAndSort(keys: string[]): string[] {
  const unique = [...new Set(keys)];
  return unique.sort((a, b) => {
    const [prefixA, numA] = a.split("-");
    const [prefixB, numB] = b.split("-");
    if (prefixA !== prefixB) return prefixA.localeCompare(prefixB);
    return parseInt(numA, 10) - parseInt(numB, 10);
  });
}
