**jira-action-man**

***

# Jira Action Man

A GitHub Action that extracts Jira issue keys from GitHub events and posts PR comments to Jira.

- Node 20
- Extracts from branch names, PR titles, commit messages, and PR body
- Posts PR descriptions as comments on linked Jira tickets (with update-on-rerun dedup)
- Configurable project filters, blocklist, and regex pattern

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
| `fail_on_missing` | `false` | Fail the action if no Jira keys are found |
| `blocklist` | *(see below)* | Comma-separated prefixes to ignore. Set to `none` to disable |
| `issue_pattern` | *(see below)* | Custom regex pattern for matching issue keys |
| `post_to_jira` | `false` | Post PR description as a comment on linked Jira tickets |
| `jira_base_url` | `""` | Jira instance base URL (e.g. `https://yourorg.atlassian.net`) |
| `jira_email` | `""` | Jira account email for API authentication |
| `jira_api_token` | `""` | Jira API token for authentication |
| `jira_comment_mode` | `update` | Comment behavior: `update`, `new`, or `minimal` (see below) |
| `jira_fail_on_error` | `false` | Fail the action if posting to Jira fails (default: warn only) |
| `github_token` | `""` | GitHub token for downloading GitHub-hosted images in PR bodies |
| `allowed_image_hosts` | `""` | Comma-separated hostnames allowed for image downloads (empty = all non-private HTTPS hosts) |

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
| `commits` | `payload.commits[].message` | — |
| `body` | skipped | PR body |

## Examples

### Pull Request with Multiple Sources

```yaml
- uses: procyon-creative/jira-action-man@main
  id: jira
  with:
    projects: "PROJ"
    from: "branch,title,body"
    fail_on_missing: true
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

### Post PR Description to Jira

When `post_to_jira` is enabled on `pull_request` events, the action posts the PR description as a comment on each linked Jira ticket. The `jira_comment_mode` input controls the behavior:

| Mode | Behavior |
|------|----------|
| `update` | Updates the existing comment if found, otherwise creates one. Best for keeping a single up-to-date comment per PR. |
| `new` | Always creates a new comment. Gives a history trail of PR changes. |
| `minimal` | Creates a single-line link to the PR. Low noise. |

```yaml
- uses: procyon-creative/jira-action-man@main
  id: jira
  with:
    projects: "PROJ"
    post_to_jira: true
    jira_comment_mode: update
    jira_base_url: ${{ secrets.JIRA_BASE_URL }}
    jira_email: ${{ secrets.JIRA_EMAIL }}
    jira_api_token: ${{ secrets.JIRA_API_TOKEN }}
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
  issue_pattern: "MYPROJ-[0-9]+"
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
