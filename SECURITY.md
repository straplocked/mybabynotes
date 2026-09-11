# Security Policy

mybabynotes stores sensitive family data (feeding, sleep, health notes about real children), so security reports are taken seriously and handled with priority.

## Supported versions

| Version | Supported |
|---|---|
| Latest tagged release (`vX.Y.Z`) | ✅ |
| `main` (pre-release) | ✅ |
| Older tagged releases | ❌ — please upgrade |

Self-hosted instances update by pulling the latest images; there are no long-term support branches.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report vulnerabilities privately via **GitHub's private vulnerability reporting**: go to this repository's **Security** tab → **Report a vulnerability**. That keeps the report visible only to you and the maintainer until a fix is released.

Include what you can of the following:

- A description of the issue and its impact
- Steps to reproduce (a proof of concept helps a lot)
- The version or commit you tested against
- Any suggested fix, if you have one

## What to expect

- **Acknowledgment** within a few days (this is a solo-maintained project — usually faster).
- An assessment of severity and impact, discussed with you in the advisory thread.
- A fix released as a new tagged version, with the advisory published after users have had a reasonable window to update.
- Credit in the advisory and release notes, if you'd like it.

## Scope notes

- The invite-only registration, token scopes (`/api/v1`), household data isolation, and the MCP server's auth are all in scope — cross-household data access of any kind is treated as critical.
- Vulnerabilities in dependencies are best reported upstream, but a heads-up here is welcome if mybabynotes' usage makes one exploitable.
- Testing must only be done against **your own self-hosted instance** — never against instances or hosted services you don't own.

## Fixed issues

Security fixes that warrant action from an operator are listed here; the rest go in [CHANGELOG.md](CHANGELOG.md).

- **2026-09-11 — scoped personal access tokens reached the first-party API.** Before this fix, a personal access token minted from Settings → API access with any scope (`entries:read`, say) could also call the PWA's own `/api/*` routes — household state, invites, membership changes, settings, and the MQTT broker configuration — because those routes checked authentication but not the token's scopes. A token holder was still confined to their own household, and the routes still enforce the parent/caregiver role, so a caregiver's token could not do more than that caregiver. Fixed on `main` and in the next tagged release: every unversioned route now requires a first-party login token, and any scoped token gets 403 there. If you handed a scoped token to a third party (a dashboard, a script you don't run yourself, an MCP client on someone else's machine), revoke it and issue a new one from Settings → API access after updating; the new token cannot reach those routes at all. The other nine fixes from the same audit — push endpoint validation, forwarded-header handling in the all-in-one image, a Content-Security-Policy, reset tokens in the URL fragment, unprivileged background processes, push sends after the response, MQTT test error messages, CSV formula neutralization, and security headers on static assets — need nothing from you and are described in [CHANGELOG.md](CHANGELOG.md#security).
