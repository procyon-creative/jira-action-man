[**jira-action-man**](../../README.md)

***

[jira-action-man](../../modules.md) / [types](../README.md) / FailureContext

# Interface: FailureContext

Defined in: [types.ts:22](https://github.com/procyon-creative/jira-action-man/blob/37df913da3194bdeead9a41e8c8da2c30899b860/src/types.ts#L22)

## Properties

### branch?

> `optional` **branch**: `string`

Defined in: [types.ts:28](https://github.com/procyon-creative/jira-action-man/blob/37df913da3194bdeead9a41e8c8da2c30899b860/src/types.ts#L28)

***

### prNumber?

> `optional` **prNumber**: `number`

Defined in: [types.ts:27](https://github.com/procyon-creative/jira-action-man/blob/37df913da3194bdeead9a41e8c8da2c30899b860/src/types.ts#L27)

***

### repo?

> `optional` **repo**: `string`

Defined in: [types.ts:26](https://github.com/procyon-creative/jira-action-man/blob/37df913da3194bdeead9a41e8c8da2c30899b860/src/types.ts#L26)

owner/repo

***

### runUrl?

> `optional` **runUrl**: `string`

Defined in: [types.ts:32](https://github.com/procyon-creative/jira-action-man/blob/37df913da3194bdeead9a41e8c8da2c30899b860/src/types.ts#L32)

URL of the failed workflow run, when available.

***

### title

> **title**: `string`

Defined in: [types.ts:24](https://github.com/procyon-creative/jira-action-man/blob/37df913da3194bdeead9a41e8c8da2c30899b860/src/types.ts#L24)

Human label for the failing thing, e.g. "PR #6" or "branch main".

***

### url?

> `optional` **url**: `string`

Defined in: [types.ts:30](https://github.com/procyon-creative/jira-action-man/blob/37df913da3194bdeead9a41e8c8da2c30899b860/src/types.ts#L30)

PR html_url, when a PR is associated.
