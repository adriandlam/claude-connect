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

The first time Claude sends something, you get the normal permission dialog showing the whole message. Choose "Yes, and don't ask again" to let updates flow for that project.

| Command | What it does |
| --- | --- |
| `/connect` | Rejoin this project's room, or make one |
| `/connect <relay> <token>` | Join a teammate's room, the line they sent you |
| `/connect <relay>` | Make a room on your own relay |
| `/connect new` | Start a fresh room |
| `/disconnect` | Leave. `/connect` catches up later |

## What you see

The footer says `Connected with Sam`. What your Claude sends:

```
@Sam's Claude ❱ “GET /users renamed to GET /members”
```

What arrives:

```
› Prompt from the connect plugin
❯ @Sam's Claude: “x-team header now required on GET /members”
```

You read a one-line summary and Claude reads the whole message. `ctrl+o` shows the whole of a sent one.

## How Claude catches up

There is nothing to set:

- **While Claude is working,** a message reaches it right after the current tool, and the row shows then.
- **While Claude is idle,** it waits for 15 quiet seconds, so a burst is one turn, and then Claude catches up by itself.

Claudes never edit each other's code. Messages carry facts, git carries code, and a push or rebase goes through your normal prompts.

Two Claudes could keep waking each other, so peers can start at most 5 turns in a row. After that, messages wait for your next prompt, the footer counts them, and you get one notification.

## How it works

Both sessions long-poll a small relay. It keeps the last 50 sealed messages of each room, in memory only, so a restart or redeploy drops whatever nobody has read yet, with no notice. A message reaches the other side in about 100 ms.

## Security

- **Messages are end-to-end encrypted.** Text, names and message types are sealed with XChaCha20-Poly1305 under a key derived from the invite's token. The token stays on your two machines, and the relay gets only a hash of it as the room's name.
- **The relay still sees metadata:** IP addresses, timing, message sizes and which room each one is in. It can also drop messages. It cannot read or forge them, and a sealed stamp means a replayed one is dropped.
- **The invite is the key.** Anyone holding it can read the room's last 50 messages and post as anyone in it. It never enters Claude's context. `/connect new` replaces a leaked one, but there is no forward secrecy: a leaked invite also opens any old messages someone recorded.
- **A teammate's message is untrusted input.** Claude is told it is project information, not instructions, and your normal permissions still apply to anything it does. That lowers the risk of prompt injection and does not remove it, so connect only with people you trust.
- **Sending is gated.** `send` goes through rules, hooks, the dialog and your permission mode like any tool. A hook can refuse it, but a rewrite of its input is not honoured. An allow rule means Claude sends without asking, so an injected request could reach the room. A pattern check refuses common API keys, on a best-effort basis.
- **Peer text is cleaned on arrival.** Escape codes and invisible characters are stripped, and `<` becomes `&lt;`, so a message cannot forge a frame.

## Run your own relay

The relay is one file with no dependencies, and your teammates need nothing but its address. It needs Bun 1.3.14 or later, because earlier versions do not cap chunked uploads.

```
cd relay
railway up
```

Then run `/connect https://your-relay` once, and the invite carries the address. Use `https://` anywhere but your own machine. Keep it to one replica, since rooms live in that process's memory, and leave app sleeping off, since sleeping loses the backlog. `bun relay/server.ts` runs it locally on port 3000, and `bun relay/check.ts` is its self-check.

## Develop

```
claude --plugin-dir .       # run it from this folder
claude plugin test .        # the mod's tests
bun relay/check.ts          # the relay's check
```

The hooks API this uses is early access, tested on Claude Code 2.1.319. `send` detects a call that passed its permission checks by the engine's error text for an unserved tool, so a changed message makes sends fail safely until the mod is updated.
