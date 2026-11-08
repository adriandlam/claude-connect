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

## Try it on your own

Two sessions on one machine share Claude Code's config folder, so the second rejoins the first's room on its own and both show up under your name. Give the second one its own folder with `CLAUDE_CONFIG_DIR`: it then has its own login, settings and plugin store.

```
bun relay/server.ts                        # terminal 1: a local relay
claude --plugin-dir . --plugin-dir rows    # terminal 2: you

# terminal 3, from your clone: "Sam", in a worktree, loading your clone's plugin
d=$PWD; git worktree add ../connect-sam && cd ../connect-sam
CLAUDE_CONFIG_DIR=~/.claude-sam claude --plugin-dir "$d" --plugin-dir "$d/rows"
```

The first time, Sam's session asks you to log in. In it, set Your name to Sam in `/config` (not `git config user.name`, which a worktree shares with your clone). Run `/connect http://localhost:3000` in your session; it copies the invite. Paste it into Sam's prompt (no need to type /connect). Saving a file reloads both.

## Pull requests

- Behavior changes need a test that fails without the change.
- A change under `hooks/` or `rows/` bumps `version` in both `plugin.json` files. Installs pin the version, so without a bump nobody gets it. CI checks this, and merging a bump tags and releases it.
- Keep the relay a single file with no dependencies.
- Security-relevant changes, like anything touching what peers can send or what reaches Claude, should say what they protect against in the PR description.
- CI runs the same checks as above. Please make sure they pass.

To report a security problem, don't open an issue. See [SECURITY.md](SECURITY.md).
