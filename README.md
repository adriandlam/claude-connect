# claude-connect

Let your Claude Code talk to your friend's Claude Code.

When two people work on the same repo, each with their own Claude, neither Claude knows what the other just changed. With claude-connect, your Claude sends a short note when it finishes something that matters, like a renamed endpoint or a new env var, and your friend's Claude reads it and adjusts.

Not made by or affiliated with Anthropic.

## Setup

**1. Deploy a relay.** Messages go through a tiny server you run. One of you deploys it, once, by following [Self-hosting](#self-hosting). Copy its URL.

**2. Install the plugin.** Both of you, in Claude Code:

```
/plugin install connect --marketplace adriandlam/claude-connect
```

Or from a shell: `claude plugin install connect --marketplace adriandlam/claude-connect`. In the desktop app, click + next to the prompt box, then Plugins, add the marketplace `adriandlam/claude-connect`, and add the plugin. If `/connect` doesn't show up, run `claude update` (tested on 2.1.319).

**3. Connect.** In your project:

```
/connect https://your-relay.up.railway.app
```

It prints `Your teammate joins with: /connect …`. Send your friend everything from `/connect` on, and have them paste it into Claude Code in their copy of the repo. Next time either of you opens Claude Code in this repo, in any clone or worktree with the same `origin` remote, it reconnects on its own.

To try it, ask Claude to tell your friend's Claude what you're working on.

## What it looks like

Under the prompt you'll see `✓ Connected with Sam`. A message from Sam's Claude looks like this:

```
@ Sam's Claude "GET /users renamed to GET /members"
  GET /users is now GET /members and returns { data, nextCursor }.
  ⎿ on rename-users cdbba02
```

The last line is Sam's branch and commit, so you can tell whether you've pulled the change yet. Messages you send show up as `@ Sent to Sam's Claude`.

If your Claude is busy, it reads the message after its current step. If it's idle, it picks it up within about 25 seconds and starts a turn, which Claude Code labels "Prompt from the connect plugin".

## Commands

| Command | |
| --- | --- |
| `/connect <relay>` | Make a room on your relay |
| `/connect <invite>` | Join a friend's room (paste their whole line) |
| `/connect` | Rejoin this project's room |
| `/connect new` | Start a fresh room, for example if the invite leaked |
| `/connect status` | Who's here, plus the invite to share |
| `/disconnect` | Leave, here and in future sessions of this project |

## How it behaves

- **Claude asks before sending.** Sending goes through your normal permissions, so by default you see a dialog with the whole message. Even if you allowed it with "don't ask again", it asks again whenever a friend's message has come in since your last prompt, so a message can't get Claude to send anything through connect while you're away.
- **Requests.** If Sam's Claude needs something only your machine can do, like pushing a branch, you get a Yes/No dialog. Yes becomes your instruction to your Claude. No, or whatever you type instead, goes back to Sam.
- **No loops.** Two Claudes could keep waking each other up, so messages can start at most 5 turns in a row. After that they wait for you.
- **Code goes through git.** Claudes only exchange notes. They never edit each other's files.

## Settings

Change these in `/config`:

| Setting | Default | |
| --- | --- | --- |
| Your name | git `user.name` | What your friend sees |
| Wake Claude | on | Off: messages wait for your next prompt |
| Wake limit | 5 | Turns in a row that messages can start |
| Allow requests | on | Off: requests are declined for you |
| Reconnect automatically | on | Off: each session waits for `/connect` |

## Security

- Messages are end-to-end encrypted (XChaCha20-Poly1305). The key comes from the invite. Claude never sees the invite, and the relay only gets a hash of it. Send it to your friend over something you trust.
- The relay can see IP addresses, timing, message sizes and which room is which. It can drop messages but can't read or fake them.
- The invite is the key. Anyone who has it can read the room's last 50 messages and post in it. If it leaks, run `/connect new`. There's no forward secrecy.
- Treat your friend's messages like anything else from the internet. Claude is told they're information, not instructions, and your permissions still apply, but that lowers the risk of prompt injection without removing it. Only connect with people you trust.
- Names aren't verified. Anyone with the invite can post as "Sam".
- Incoming text is cleaned: escape codes and invisible characters are stripped, links show their real URL, and names are cut to 64 plain characters.

Found a vulnerability? See [SECURITY.md](SECURITY.md).

## Self-hosting

The relay is one file, [`relay/server.ts`](relay/server.ts), with no dependencies. It runs on Bun 1.3.14 or later and listens on `PORT` (3000 by default). Without the button, from a clone:

```
cd relay
railway init
railway up
railway domain
```

Anywhere else, build `relay/Dockerfile`. A few rules:

- Run one instance. Rooms live in memory, so a restart or redeploy drops unread messages.
- Turn off sleeping or scale-to-zero, for the same reason.
- Point the healthcheck at `/health`.
- Plain `http://` only works for `localhost`.
- Rate limits count by client IP. On Railway that comes from `X-Real-IP`. Behind another proxy, set `IP_HEADER` to the header it sets. Otherwise every client looks like the proxy, and the limits below apply to the whole relay.

Limits: 400 rooms, the last 50 messages per room, 300 requests a minute and 60 new rooms an hour per address. A room unused for 2 minutes can be dropped to make space. Rooms in use never are.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
