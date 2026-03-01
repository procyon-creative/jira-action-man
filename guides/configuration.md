---
title: Configuration
---

# Configuration

## Action Inputs

### Key Extraction

| Input | Default | Description |
|-------|---------|-------------|
| `projects` | `""` (match all) | Comma-separated Jira project prefixes to match (e.g. `"PROJ,TEAM"`) |
| `from` | `"branch,title,commits"` | Comma-separated sources to check: `branch`, `title`, `commits`, `body` |
| `fail_on_missing` | `"false"` | Fail the action if no Jira keys are found |
| `blocklist` | `""` (use defaults) | Comma-separated prefixes to ignore. Set to `"none"` to disable |
| `issue_pattern` | built-in regex | Custom regex pattern for matching issue keys |

### Jira Comment Posting

| Input | Default | Description |
|-------|---------|-------------|
| `post_to_jira` | `"false"` | Post PR description as a comment on linked Jira tickets |
| `jira_base_url` | `""` | Jira instance base URL (e.g. `https://yourorg.atlassian.net`) |
| `jira_email` | `""` | Jira account email for API authentication |
| `jira_api_token` | `""` | Jira API token for authentication |
| `jira_comment_mode` | `"update"` | Comment behavior: `update`, `new`, or `minimal` |
| `jira_fail_on_error` | `"false"` | Fail the action if posting to Jira fails |
| `github_token` | `""` | GitHub token for modifying PRs |

## Comment Modes

The `jira_comment_mode` input controls how comments are posted to Jira tickets:

- **`update`** — Searches for an existing comment containing the PR URL. If found, updates it in place. If not, creates a new comment. This is the default and avoids duplicate comments on re-runs.
- **`new`** — Always creates a new comment. Use this if you want a comment trail showing each push.
- **`minimal`** — Posts a single-line comment with just the PR link instead of the full description.

## Outputs

| Output | Description |
|--------|-------------|
| `keys` | JSON array of unique sorted Jira issue keys (e.g. `["PROJ-1","PROJ-23"]`) |
| `key` | First Jira issue key found (convenience for single-ticket workflows) |
| `found` | `"true"` if any keys were found, `"false"` otherwise |

## Example Workflow

```yaml
- uses: procyon-creative/jira-action-man@v1
  id: jira
  with:
    projects: "PROJ,TEAM"
    from: "branch,title,commits,body"
    post_to_jira: "true"
    jira_base_url: ${{ secrets.JIRA_BASE_URL }}
    jira_email: ${{ secrets.JIRA_EMAIL }}
    jira_api_token: ${{ secrets.JIRA_API_TOKEN }}
    github_token: ${{ secrets.GITHUB_TOKEN }}

- run: echo "Found keys: ${{ steps.jira.outputs.keys }}"
```
