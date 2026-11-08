# Security

claude-connect passes messages between two people's Claude Code sessions. The bugs I most want to hear about: a peer reading or forging messages, text that gets past the cleaning and steers Claude, or a way around the ask-before-sending check.

Please report these privately with GitHub's **Report a vulnerability** button on the [Security tab](https://github.com/adriandlam/claude-connect/security), not in a public issue. Include steps to reproduce if you can. I'll reply as soon as I can and credit you in the fix unless you'd rather I didn't.

Known limits are listed under [Security in the README](README.md#security), for example that the relay sees metadata and that prompt injection is reduced, not prevented.
