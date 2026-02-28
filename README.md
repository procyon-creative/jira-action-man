# Jira Action Man

A GitHub Action that extracts Jira issue keys from GitHub events. A modern, maintained replacement for the abandoned [Atlassian gajira](https://github.com/atlassian/gajira) actions.

- Node 20
- Extracts from branch names, PR titles, commit messages, and PR body
- Configurable project filters, blocklist, and regex pattern
- Zero dependencies beyond `@actions/core` and `@actions/github`

## Quick Start

```yaml
- uses: procyon-creative/jira-action-man@main
  id: jira
  with:
    projects: "PROJ,TEAM"

- run: echo "Found keys: ${{ steps.jira.outputs.keys }}"
```

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `projects` | `""` (match all) | Comma-separated Jira project prefixes to match (e.g. `PROJ,TEAM`) |
| `from` | `branch,title,commits` | Comma-separated sources to check: `branch`, `title`, `commits`, `body` |
| `fail-on-missing` | `false` | Fail the action if no Jira keys are found |
| `blocklist` | *(see below)* | Comma-separated prefixes to ignore. Set to `none` to disable |
| `issue-pattern` | *(see below)* | Custom regex pattern for matching issue keys |

## Outputs

| Output | Description |
|--------|-------------|
| `keys` | JSON array of unique sorted keys, e.g. `["PROJ-123","PROJ-456"]` |
| `key` | First key found (convenience) |
| `found` | `"true"` or `"false"` |

Keys are sorted alphabetically by project prefix, then numerically by issue number (`PROJ-2` before `PROJ-10`).

## Sources by Event Type

| Source | `push` | `pull_request` |
|--------|--------|----------------|
| `branch` | From `refs/heads/...` | From `pull_request.head.ref` |
| `title` | skipped | PR title |
| `commits` | `payload.commits[].message` | not supported in v1 |
| `body` | skipped | PR body |

## Examples

### Pull Request with Multiple Sources

```yaml
- uses: procyon-creative/jira-action-man@main
  id: jira
  with:
    projects: "PROJ"
    from: "branch,title,body"
    fail-on-missing: true
```

### Use Extracted Keys in Later Steps

```yaml
- uses: procyon-creative/jira-action-man@main
  id: jira
  with:
    projects: "PROJ,TEAM"

- if: steps.jira.outputs.found == 'true'
  run: |
    echo "First key: ${{ steps.jira.outputs.key }}"
    echo "All keys: ${{ steps.jira.outputs.keys }}"
```

## Blocklist

By default, common technical acronyms are filtered to avoid false positives:

```
SHA, UTF, ISO, TCP, UDP, HTTP, HTTPS, SSL, TLS, SSH, DNS, FTP,
SMTP, IMAP, POP, API, URL, URI, XML, JSON, YAML, HTML, CSS,
RFC, IEEE, ANSI, ASCII
```

Override with your own list:

```yaml
with:
  blocklist: "SHA,UTF"  # only block these two
```

Or disable entirely:

```yaml
with:
  blocklist: "none"
```

## Custom Regex Pattern

The default pattern is:

```
(?<![A-Z0-9])([A-Z][A-Z0-9]{1,9}-[0-9]{1,6})(?![A-Z0-9])
```

This matches standard Jira keys (2-10 char uppercase prefix, dash, 1-6 digit number) while avoiding partial matches inside longer tokens. The lookahead deliberately does not exclude `-`, so branch names like `feature/PROJ-123-add-login` work correctly.

Override with a custom pattern:

```yaml
with:
  issue-pattern: "MYPROJ-[0-9]+"
```

## Development

```bash
npm install
npm test              # run tests
npm run lint          # eslint
npm run typecheck     # tsc --noEmit
npm run build         # bundle to dist/
npm run package       # typecheck + test + build
```

Copy `.env.example` to `.env` for local testing — the env var names match what GitHub Actions sets at runtime.

## License

MIT
