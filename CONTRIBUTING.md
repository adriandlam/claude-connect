# Contributing

Issues and PRs welcome. For anything bigger than a small fix, open an issue first so we can agree on the approach.

## Layout

- `hooks/register.tsx` is the `connect` plugin: the `/connect` command, the `send` tool Claude uses, and delivery of incoming messages.
- `rows/` is `connect-rows`, which draws incoming messages. It's a separate plugin because a plugin can't draw the prompts it submits itself.
- `relay/server.ts` is the relay, one file with no dependencies.

[AGENTS.md](AGENTS.md) lists the rules the code depends on and the gotchas. Read it before changing how messages are sent, delivered or cleaned.

## Running it

You need Claude Code 2.1.319 or later and Bun 1.3.14 or later.

```
claude --plugin-dir . --plugin-dir rows   # a session with your local copy, reloading on save
claude plugin test .                      # all plugin tests
claude plugin validate . && claude plugin validate rows
bun relay/check.ts                        # the relay's checks
bun relay/server.ts                       # a local relay on port 3000
```

With a local relay, run `/connect http://localhost:3000` in two sessions, in different clones or worktrees, to try it end to end.

## Pull requests

- Behavior changes need a test that fails without the change.
- Keep the relay a single file with no dependencies.
- Security-relevant changes, like anything touching what peers can send or what reaches Claude, should say what they protect against in the PR description.
- CI runs the same checks as above. Please make sure they pass.

To report a security problem, don't open an issue. See [SECURITY.md](SECURITY.md).
