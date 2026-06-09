# Jira Action Man

A GitHub Action that extracts Jira issue keys from GitHub events and posts PR comments to Jira.

- Node 24
- Extracts from branch names, PR titles, commit messages, and PR body
- Posts PR descriptions as comments on linked Jira tickets (with update-on-rerun dedup)
- Uploads PR body images to Jira as attachments (with SSRF protection and size limits)
- Configurable project filters, blocklist, and regex pattern

## Quick Start

```yaml
- uses: procyon-creative/jira-action-man@v1
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
| `jira_fail_on_error` | `false` | Fail the action if posting to Jira or transitioning an issue fails (default: warn only) |
| `transition_to` | `""` | Status name to transition matched issues to (e.g. `QA`, `Done`). Empty = no transition (see below) |
| `create_issue_on_failure` | `false` | Open a Jira ticket when a run fails (independent of issue keys — covers failing dependabot PRs). See below |
| `issue_type` | `Bug` | Issue type for the ticket created by `create_issue_on_failure` (must exist in the project) |
| `issue_project` | `""` | Project key for the failure ticket. Defaults to the first entry of `projects` |
| `github_token` | `""` | GitHub token for downloading GitHub-hosted images in PR bodies |
| `allowed_image_hosts` | `""` | Comma-separated hostnames allowed for image downloads (empty = all non-private HTTPS hosts) |

## Outputs

| Output | Description |
|--------|-------------|
| `keys` | JSON array of unique sorted keys, e.g. `["PROJ-123","PROJ-456"]` |
| `key` | First key found (convenience) |
| `found` | `"true"` or `"false"` |
| `created_issue` | Key of the ticket created (or reused) by `create_issue_on_failure`, or empty |

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
- uses: procyon-creative/jira-action-man@v1
  id: jira
  with:
    projects: "PROJ"
    from: "branch,title,body"
    fail_on_missing: true
```

### Use Extracted Keys in Later Steps

```yaml
- uses: procyon-creative/jira-action-man@v1
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
- uses: procyon-creative/jira-action-man@v1
  id: jira
  with:
    projects: "PROJ"
    from: "branch,title,body"
    post_to_jira: true
    jira_comment_mode: update
    jira_base_url: ${{ secrets.JIRA_BASE_URL }}
    jira_email: ${{ secrets.JIRA_EMAIL }}
    jira_api_token: ${{ secrets.JIRA_API_TOKEN }}
    github_token: ${{ secrets.GITHUB_TOKEN }}
```

Images in the PR body are automatically downloaded and uploaded to Jira as attachments. The image references in the comment are updated to point to the uploaded files. Only HTTPS URLs are allowed, and private/loopback IPs are blocked. Use `allowed_image_hosts` to restrict downloads to specific domains.

### Transition Issues

Set `transition_to` to a status name and the action moves every matched issue to that status (using `jira_base_url`/`jira_email`/`jira_api_token`). The status is matched case-insensitively against the issue's available transitions. If no matching transition exists for an issue, the action logs a warning and continues — it does not fail (unless `jira_fail_on_error: true`). Transitions are event-agnostic: they run wherever issue keys are found, independent of `post_to_jira`.

### Open a Ticket When CI Fails

`create_issue_on_failure` files a Jira ticket when a run fails — even when the PR carries **no** issue key (e.g. a failing **dependabot** PR). Tickets are **deduplicated by label**, so repeated failures of the same PR/branch reuse one open ticket instead of spamming a new one each run.

Trigger it from a `workflow_run` on your CI workflow — the action reads the run's conclusion and only files a ticket on `failure`:

```yaml
name: CI Failures → Jira
on:
  workflow_run:
    workflows: ["CI"] # the name: of your CI workflow
    types: [completed]

jobs:
  file-ticket:
    runs-on: ubuntu-latest
    steps:
      - uses: procyon-creative/jira-action-man@v2
        with:
          create_issue_on_failure: true
          issue_project: "PROJ" # or rely on `projects`
          issue_type: "Bug"
          jira_base_url: ${{ secrets.JIRA_BASE_URL }}
          jira_email: ${{ secrets.JIRA_EMAIL }}
          jira_api_token: ${{ secrets.JIRA_API_TOKEN }}
```

Alternatively, call it from an `if: failure()` job in the same workflow as your build — it then files a ticket for the current PR/branch.

The created ticket carries two labels: `ci-failure` and a per-target dedup label (e.g. `cifail-org-repo-pr-6`). Move that ticket to a Done status (or close it) and the next failure opens a fresh one. The created key is exposed as the `created_issue` output.

A common pattern is one job that moves issues to a review column when a PR opens, and another that moves them to Done when it merges:

```yaml
jobs:
  to-qa:
    if: github.event.action == 'opened' || github.event.action == 'reopened'
    runs-on: ubuntu-latest
    steps:
      - uses: procyon-creative/jira-action-man@v2
        with:
          projects: "PROJ"
          from: "branch,title,commits,body"
          transition_to: "QA"
          jira_base_url: ${{ secrets.JIRA_BASE_URL }}
          jira_email: ${{ secrets.JIRA_EMAIL }}
          jira_api_token: ${{ secrets.JIRA_API_TOKEN }}

  to-done:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    steps:
      - uses: procyon-creative/jira-action-man@v2
        with:
          projects: "PROJ"
          from: "branch,title,commits,body"
          transition_to: "Done"
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
