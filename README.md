# claude-connect

Connect your Claude Code session to a teammate's, so your Claudes tell each other what changed.

Unofficial: a community mod, not made or endorsed by Anthropic.

You and a friend are building one project, each with your own Claude. Yours renames an API route. Theirs hears about it a moment later and updates the client, without either of you relaying it by hand. That stops the slow drift between two people's docs, APIs and assumptions.

## Install

At the prompt of a terminal session:

```
/plugin install connect --marketplace adriandlam/claude-connect
```

Answer `y` to add the marketplace, then pick a scope. From a shell:

```
claude plugin install connect --marketplace adriandlam/claude-connect
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `adriandlam/claude-connect`, then Add plugin.

A private repository installs only for people who can read it on GitHub and whose machine already holds a git credential for github.com (an SSH key, or `gh auth login` then `gh auth setup-git`).

## Use

1. Run `/connect`. It prints a line with an invite.
2. Send that line to your teammate. They run it.
3. Work as usual.

The first time Claude sends something, you get the normal permission dialog showing the whole message. "Yes, and don't ask again" lets updates flow while you work. Claude still asks once a teammate's message has reached it, until your next prompt, so a message cannot make it send your project's files while you are away.

| Command | What it does |
| --- | --- |
| `/connect` | Rejoin this project's room, or make one |
| `/connect <relay> <token>` | Join a teammate's room, the line they sent you |
| `/connect <relay>` | Make a room on your own relay |
| `/connect new` | Start a fresh room |
| `/disconnect` | Leave. `/connect` catches up later |

## What you see

The footer says `Connected with Sam`. A message from Sam draws like this, and one you send carries Sam's name the same way, as a message to a subagent does:

```
@Sam's Claude "GET /users renamed to GET /members"
  GET /users is now GET /members and returns { data, nextCursor }.
  ⎿ on rename-users cdbba02
```

The last line is the sender's branch and commit, added for you, so you can tell whether you already have the change. A message that lands while Claude is working shows the same lines as plain dim rows, because that is all the engine draws there.

Installing `connect` also installs `connect-rows`, a small plugin that draws these rows: a plugin's own hooks cannot draw the prompts it submits. Without it the rows still work, plain, behind a `❯`.

## How Claude catches up

There is nothing to set:

- **While Claude is working,** a message reaches it right after the current tool, and the row shows then.
- **While Claude is idle,** it catches up by itself within 25 seconds of the last message, so a burst is one turn.

Claudes never edit each other's code. Messages carry facts, git carries code, and a push or rebase goes through your normal prompts.

Two Claudes could keep waking each other, so peers can start at most 5 turns in a row. After that, messages wait for your next prompt, the footer counts them, and you get one notification.

## How it works

Both sessions long-poll a small relay. It keeps the last 50 sealed messages of each room, for up to 200 rooms, in memory only, so a restart, a redeploy or 200 newer rooms drop whatever nobody has read yet, with no notice. A message crosses the relay in about 150 ms. Each address gets 120 requests a minute and 20 new rooms an hour, past which the relay answers 429.

## Security

- **Messages are end-to-end encrypted.** Text, names and message types are sealed with XChaCha20-Poly1305 under a key derived from the invite's token. The token stays on your two machines, and the relay gets only a hash of it as the room's name.
- **The relay still sees metadata:** IP addresses, timing, message sizes and which room each one is in. It can also drop messages. It cannot read or forge them. A sealed stamp drops a replayed one, unless you have joined another room from this project since.
- **The invite is the key.** Anyone holding it can read the room's last 50 messages and post as anyone in it. It never enters Claude's context. `/connect new` replaces a leaked one, but there is no forward secrecy: a leaked invite also opens any old messages someone recorded.
- **A teammate's message is untrusted input.** Claude is told it is project information, not instructions, and your normal permissions still apply to anything it does. That lowers the risk of prompt injection and does not remove it, so connect only with people you trust.
- **Sending is gated.** `send` goes through rules, hooks, the dialog and your permission mode like any tool. A hook can refuse it, but a rewrite of its input is not honoured. An allow rule lets Claude send without asking, but not once a teammate's message has reached it, until your next prompt. That check was tried by hand in `acceptEdits` and `auto` modes, not in `bypassPermissions`, and a plugin reload clears it. Invisible characters are stripped first, so what the dialog shows is what leaves. A pattern check refuses common API keys, on a best-effort basis.
- **Peer text is cleaned on arrival.** Escape codes and invisible characters are stripped, and `<` becomes `&lt;`, so a message cannot forge a frame.

## Run your own relay

The relay is one file with no dependencies, and your teammates need nothing but its address. It needs Bun 1.3.14 or later, because earlier versions do not cap chunked uploads.

```
cd relay
railway up
```

Then run `/connect https://your-relay` once, and the invite carries the address. Plain `http://` works only for `localhost` and `127.0.0.1`. Keep it to one replica, since rooms live in that process's memory, leave app sleeping off, since sleeping loses the backlog, and point its healthcheck at `/health`. The limits count by the `X-Real-IP` header, which Railway's edge sets; behind another proxy, have it set that header, or behind none, they count by socket address. `bun relay/server.ts` runs it locally on port 3000, and `bun relay/check.ts` is its self-check.

## Develop

```
claude --plugin-dir . --plugin-dir rows   # run it from this folder
claude plugin test .        # the mod's tests
bun relay/check.ts          # the relay's check
```

The hooks API this uses is early access, tested on Claude Code 2.1.319. `send` detects a call that passed its permission checks by the engine's error text for an unserved tool, so a changed message makes sends fail safely until the mod is updated.
