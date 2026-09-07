# Home Assistant

MyBabyNotes integrates with Home Assistant in two independent ways — use either or both:

1. **MQTT entities** — the household shows up as HA devices with sensors and buttons, for automations and dashboards. Works with any MyBabyNotes install and any HA install that share an MQTT broker.
2. **The add-on** — puts the MyBabyNotes UI in the HA sidebar via ingress. Can *run* MyBabyNotes on the HA box (local mode) or embed an instance you already run elsewhere (remote mode).

Neither replaces the other: MQTT gives HA the data; the add-on gives HA users the app. Other integration surfaces: [integrations.md](integrations.md) (REST API), [mcp.md](mcp.md) (MCP).

## MQTT entities

### Prerequisites

- An MQTT broker both sides can reach — the **Mosquitto broker add-on** is the usual choice, with the MQTT integration configured in HA.
- A **dedicated broker user for MyBabyNotes**, with an ACL restricted to `babylog/#`. This matters: anyone who can publish to the command topic can press the buttons (log diapers, start/stop timers). The blast radius is deliberately limited to logging and timers — no household-management commands exist on MQTT — but scope the broker user anyway.

### Setup

In the app, as a parent: **Settings → Home Assistant**.

1. Enable the integration.
2. Enter the broker host, port, username, password, and TLS settings.
3. **Test connection** — verifies reachability without saving anything.
4. Save. Discovery messages publish immediately; the devices appear in HA under **Settings → Devices & Services → MQTT** within seconds.

The card's status line shows the current state: Off / Connected (with last-heartbeat age) / Configured but broker unreachable. Broker credentials are stored encrypted server-side and never leave the server — they are not synced to other phones and never appear in `/state`.

### What appears in HA

One **household device** named "MyBabyNotes", plus one device per unarchived child ("«name» (MyBabyNotes)", linked via the household device). Archiving a child, disabling a tracker, or disabling the integration removes the corresponding entities from HA automatically.

| Device | Entity | Kind | Notes |
|---|---|---|---|
| Household | On duty | sensor | Name of the on-duty member |
| Household | Active timer | sensor | `none` / `nurse` / `pump` / `sleep` / `tummy` — the newest running timer; with several stacked, the full list rides the sensor's `timers` attribute (with `count`) |
| Household | Timer started | sensor (timestamp) | When the newest running timer started |
| Household | Last pump | sensor (timestamp) | |
| Household | Stop timer | button | Stops the newest running timer (the one the sensor shows); an MQTT command with `timer_id` can stop a specific one |
| Household | Start pump timer | button | |
| Per child | Last feeding | sensor (timestamp) | Latest of bottle/nurse |
| Per child | Last diaper | sensor (timestamp) | Latest of wet/dirty/both |
| Per child | Last sleep | sensor (timestamp) | The **wake-up** (sleep entries stamp the end of the nap — the app's own rows show the start, `wake-up − duration`), so "time since last sleep" reads as the open wake window. Only while the sleep tracker is enabled |
| Per child | Last tummy time | sensor (timestamp) | The end of the session, like Last sleep. Only while the tummy time tracker is enabled |
| Per child | Last bath | sensor (timestamp) | Only while the bath tracker is enabled |
| Per child | Last meds | sensor (timestamp) | Only while the meds tracker is enabled |
| Per child | Log wet / Log dirty | buttons | Log a diaper, stamped now |
| Per child | Start nurse timer | button | |
| Per child | Start sleep timer | button | Only while the sleep tracker is enabled |
| Per child | Start tummy time timer | button | Only while the tummy time tracker is enabled |

Details worth knowing:

- Timestamp sensors carry `device_class: timestamp` and publish ISO 8601 UTC (or `None` when nothing has been logged) — HA renders them as "23 minutes ago" natively, so there are deliberately **no** derived "hours since" sensors; use `relative_time` in templates.
- Each last-\* sensor exposes attributes with the underlying entry's `type`, `detail`, and `by` (who logged it).
- Entries created by pressing HA buttons are attributed to the **acting user** configured in Settings → Home Assistant (defaults to the parent who set the integration up) — they appear in the app's timeline under that name, and phones update instantly like any other write.
- Topics live under `babylog/<household>/…` (internal identifiers keep the `babylog` name; the base topic and the `homeassistant/` discovery prefix are both configurable in the settings card); discovery uses HA's device-based discovery — one retained config message per device at `homeassistant/device/babylog_h<id>[_c<child>]/config`. State messages are retained, so HA restarts repopulate instantly.

### Availability

The MyBabyNotes server runs a persistent MQTT listener that owns the connection and its Last Will. Semantics:

- Listener connected → entities available.
- Listener down (server stopped, broker unreachable) → the broker publishes the will and **every entity goes `unavailable`**. This is honest: with the listener down, the buttons genuinely wouldn't work.
- On every connect and every 15 minutes, the listener republishes discovery and full state — a broker restart or wiped retained store heals itself within 15 minutes.

### Example: Lovelace card

```yaml
type: entities
title: Wren
entities:
  - entity: sensor.wren_last_feeding
    name: Fed
  - entity: sensor.wren_last_diaper
    name: Diaper
  - entity: sensor.wren_last_sleep
    name: Slept
  - entity: sensor.mybabynotes_on_duty
    name: On duty
  - entity: button.wren_log_wet
  - entity: button.wren_log_dirty
```

Timestamp sensors render relative ("34 minutes ago") on their own. For a templated line:

```yaml
{{ relative_time(states.sensor.wren_last_feeding.last_changed) }} since the last feeding
```

### Example: automation

Feeding overdue while someone is home:

```yaml
alias: Feeding reminder
trigger:
  - platform: template
    value_template: >
      {{ states('sensor.wren_last_feeding') not in ['unknown','unavailable']
         and (now() - states('sensor.wren_last_feeding') | as_datetime) > timedelta(hours=3) }}
condition:
  - condition: state
    entity_id: zone.home
    state: "2"   # both phones home — tune to taste
action:
  - service: notify.everyone
    data:
      message: "It's been 3+ hours since Wren's last feeding."
```

(The app's own feed-gap push reminders — [architecture.md](architecture.md#notifications) — are smarter about rhythm; this is for when you want HA in the loop: lights, speakers, presence.)

### Troubleshooting

| Symptom | Meaning / fix |
|---|---|
| All entities `unavailable` | The listener is down or can't reach the broker. Check the api container is running, then its logs for connect errors; check broker host/port/credentials in Settings → Home Assistant (Test connection). |
| Entities never appear | Discovery didn't land: confirm HA's MQTT integration uses the same broker, and the MyBabyNotes broker user's ACL allows the `homeassistant/` discovery prefix as well as `babylog/#`. |
| Sensors stale but app is fine | Publishing is failing after an earlier success. Look for `mqtt` circuit-breaker lines in the api logs — after a publish failure the server backs off for 60s (so a dead broker never slows down app writes), then retries. Retained-state republish heals everything within 15 minutes of the broker coming back. |
| Buttons do nothing | Commands flow broker → listener → server. If sensors update but buttons don't, the listener's subscription is the problem — restart the api container and watch its logs. |
| Wrong person credited for HA-logged entries | Change the acting user in Settings → Home Assistant. |

## The add-on

The add-on puts MyBabyNotes in the HA sidebar (ingress). Once the panel is showing it is visible to **every** HA user, not just admins (`panel_admin: false` — the whole household can use it).

### Installing

Home Assistant renamed this section: it's **Settings → Apps** on 2026.6 and newer, **Settings → Add-ons** on older releases. (On new versions the old `/hassio` URLs 404 — use the Settings menu rather than a bookmark.)

1. Settings → **Apps** → **App store** (the "Install app" button) → ⋮ → **Repositories** → add:

   ```
   https://github.com/straplocked/mybabynotes-hassio-addons
   ```

2. Back in the store, open **MyBabyNotes** and click **Install**. It pulls a prebuilt image — nothing is built on your box. `amd64` and `aarch64` are published.
3. Click **Start**. First boot runs the database migrations, so give it a few seconds.
4. Turn on **Show in sidebar**.

Step 4 is not optional and not automatic: Home Assistant defaults every newly installed ingress add-on to *not* showing a sidebar panel, and it's a per-user toggle rather than something the add-on's manifest can set. Until you flip it, the only way in is **Open Web UI** on the add-on's page. Opening the ingress URL directly in a browser tab returns `401: Unauthorized` — that's expected, because HA mints a short-lived ingress session when *it* opens the panel; there is nothing wrong with your install.

Then set the one option that matters: `mode`.

### Local mode

Runs the full MyBabyNotes all-in-one on the HA box.

- All state (SQLite + self-generated secrets) lives in the add-on's `/data` — which **rides HA's own backups**. Back up HA, and you've backed up the app.
- Pairs naturally with the Mosquitto add-on for the MQTT entities above (broker host `core-mosquitto`).
- First open: register the first account (it claims the instance), invite the household — same flow as any install.

### Remote mode

A thin ingress proxy to a MyBabyNotes instance you already run elsewhere (Unraid, any Docker host). Set `remote_url` to the instance's URL.

- No data lives on the HA box; the add-on just embeds the remote UI, websockets included.
- **You still log into MyBabyNotes once inside the panel.** Ingress authenticates the *HA* user at the perimeter only — it does not log you into MyBabyNotes. The login persists per-browser after that. This is standard for proxy add-ons.
- The remote instance must run **v1.0.0 or newer** — the first public release, and the one that ships the base-path-relative UI build. Anything older than that predates public releases entirely and will render a blank page under the ingress URL prefix.

### Phones and the installable PWA

**PWA install and the service worker are disabled under ingress by design** — HA's ingress sessions don't mix with service-worker caching, and installing an app-inside-an-iframe is meaningless. For phones that want the installable, offline-capable PWA with push notifications:

- Local mode: enable the add-on's optional **direct port** and point phones at `http://<ha-host>:<port>` (put a reverse proxy with HTTPS in front for install + push, as with any deployment — see the README).
- Remote mode: phones use the remote instance's own URL directly; the add-on panel is for use *inside* HA.
