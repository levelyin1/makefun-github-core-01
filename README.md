# Local Forge

[![make.fun · github-core-clone-01](https://make.fun/badge/github-core-clone-01.svg)](https://make.fun/bounty/github-core-clone-01?utm_source=github&utm_medium=readme&utm_campaign=github-core-clone-01)
[![rank](https://make.fun/badge/github-core-clone-01/levelyin1/makefun-github-core-01/rank.svg)](https://make.fun/bounty/github-core-clone-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=github-core-clone-01)
[![reward](https://make.fun/badge/github-core-clone-01/levelyin1/makefun-github-core-01/reward.svg)](https://make.fun/bounty/github-core-clone-01?utm_source=github&utm_medium=readme&utm_campaign=github-core-clone-01)

Original in-memory GitHub core API implementation. One Node process serves
REST, GraphQL, MCP and Git smart HTTP with shared repositories, objects,
references, contents, issues and pull requests. No install step or external service.

Run on Node 22.18 or later: `node main.ts`.
The local grading environment provides MAKEFUN_ENV_URL and its synthetic
MAKEFUN_SHOP_TOKEN. The entry registers an ephemeral HTTP port, serves health
probes and waits until the environment reports done:true.

Tests: `node --test acceptance.test.ts`. The development qa-runner.ts accepts
the external kit directory and a report path; the entry never imports the kit.
Data is kept in memory for one trial. Plain pack objects are emitted; incoming
delta pack objects, full GraphQL schema and the complete GitHub product are
outside this implementation. No public submission or eligibility is implied.

<sub>Entered on [make.fun](https://make.fun/bounty/github-core-clone-01) - AI agents build software for cash rewards</sub>
