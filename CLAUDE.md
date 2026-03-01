# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A GitHub Action (Node 20) that extracts Jira issue keys from GitHub events — branch names, PR titles, commit messages, and PR body text. Replacement for the abandoned Atlassian gajira actions.

## Commands

| Command | Purpose |
|---------|---------|
| `npm test` | Run Jest test suite |
| `npm run build` | Bundle to `dist/index.js` via NCC |
| `npm run typecheck` | Type-check without emitting |
| `npm run lint` | ESLint on `src/` and `tests/` |
| `npm run lint:fix` | ESLint with auto-fix |
| `npm run package` | Full pipeline: typecheck → test → build |
| `npx jest tests/extract.test.ts` | Run a single test file |
| `npx jest -t "single key"` | Run a single test by name |

## Architecture

```
index.ts → parseInputs() → collectSourceTexts() → extractKeysFromTexts() → setOutput()
                                                                          → postToJira() (if post_to_jira enabled)
```

- **`types.ts`** — `Source`, `ActionInputs`, `SourceTexts`, `JiraConfig`, `PrContext` interfaces
- **`extract.ts`** — Pure functions: regex matching, project filtering, blocklist filtering, dedup+sort. Exports `DEFAULT_ISSUE_PATTERN` and `DEFAULT_BLOCKLIST` constants
- **`sources.ts`** — Reads text from GitHub event context. Event-aware: push gets branch+commits, pull_request gets branch+title+body
- **`jira.ts`** — Posts PR descriptions as comments on Jira tickets via REST API v2. Deduplicates by searching existing comments for the PR URL
- **`index.ts`** — Entry point. Parses action inputs, wires modules together, sets outputs (`keys`, `key`, `found`)

## Key Design Details

**Regex:** `(?<![A-Z0-9])([A-Z][A-Z0-9]{1,9}-[0-9]{1,6})(?![A-Z0-9])` — lookahead deliberately does NOT exclude `-` so branch names like `feature/PROJ-123-add-login` match correctly.

**Sorting:** Alphabetical by prefix, then numeric by issue number (`PROJ-2` before `PROJ-10`).

**Blocklist:** Filters known false positives (SHA, UTF, HTTP, etc.) by prefix. Overridable via `blocklist` input. Set to `"none"` to disable.

**Action inputs** are read via `@actions/core.getInput()` which reads `INPUT_<NAME>` env vars. The `.env.example` shows all available vars for local testing.

## Testing Conventions

- Tests use `it.each()` with data loaded from `tests/fixtures/*.json` — add new test cases by appending to the JSON files
- `sources.test.ts` mocks `@actions/core` and `@actions/github` with a `setContext()` helper
- Prefix unused params with `_` (ESLint configured to allow this)

## Pre-commit

Husky runs lint-staged: ESLint + Prettier on `*.ts`, Prettier on `*.{json,yml,yaml}`.

## Build Output

`dist/index.js` is the NCC-bundled file committed to the repo — this is what GitHub Actions consumers run. Rebuild with `npm run build` after any source changes.
