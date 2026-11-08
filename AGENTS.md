# AGENTS.md

Two plugins and a relay. `hooks/register.tsx` is the `connect` mod, `rows/hooks/register.tsx` draws the rows it submits, `relay/server.ts` is the relay. Read the README first; this file holds only what it and the code don't say.

## Commands

```
claude plugin test .          # the mod's tests
claude plugin test rows       # the rows plugin's tests
claude plugin validate .      # manifest, contract and hooks, as the engine reads them
npx -y bun@1.3.14 relay/check.ts   # the relay's check; older Bun fails it on purpose
claude --plugin-dir . --plugin-dir rows   # run both in a session, hot-reloading
```

Type-check with `tsc -p .` once a session has loaded the mod, which writes `.claude-plugin/types/` (ignored by git).

## Rules the code depends on

- A teammate's text never reaches the margin. `row` indents every body line, and `connect-rows` treats any line at the margin as a headline. Keep both sides in step: `rows` cannot import from the mod.
- A command's returned text reaches the model. The invite holds the room's key, so it only ever goes out through `$.ui.log`.
- `send` must call `next(e)` and then check for the engine's exact `UNSERVED` error text. That is how it knows the call cleared rules, hooks and the dialog. Answering without `next` skips the person's permissions.
- A request's yes approves only its summary. The reason goes to Claude as a teammate's information.
- Every peer field is cleaned in `open` before anything reads it. Add new fields there, not at the point of use.

## Gotchas

- A plugin's own `ui.render` hooks are skipped for prompts it submits. That is why `connect-rows` is a separate plugin.
- The engine labels every plugin prompt "Prompt from the connect plugin". It can't be removed.
- `$.tool.call` of `AskUserQuestion` is refused; use `$.ui.ask`, which cannot tell a timeout from a choice. Keep No first.
- A hook has 10 s. The listen loop is not a hook, but it awaits `deliver`, so nothing in `deliver` may wait on the person.
- Changing a `$.state` value's shape: a reload hands new code the old value. Read it defensively.
- In a test, an `ask` from `classic.PreToolUse` reaches the test's `classic.PermissionRequest` only while a `tool.check` hook is registered. The harness registers a pass-through one for that.
- Gate a tool in `tool.check`, not `classic.PreToolUse`: Team and Enterprise sessions skip a user's mod's `classic.*` hooks. Call `next(e)` first, so the person's rules and hooks still decide a deny.

## Changes

- Behaviour changes need a test in `hooks/register.test.tsx` that fails without them.
- The relay keeps every room in memory. Keep it to one file with no dependencies.
- Commit messages: no AI attribution lines.
