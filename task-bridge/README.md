# Niewdel Task Bridge

A small MCP server that connects Claude (phone, iPad, computer) to **your** Google Tasks and Google Calendar. You talk to Claude; tasks land in Google Tasks, appointments land on Google Calendar, and Google's own apps buzz every device when things are due.

## What Claude can do through it

| Tool | What it does |
|---|---|
| `add_task` | Adds a to-do to Google Tasks. If a time is given, it also schedules a phone alert at that exact time via Calendar (Google Tasks only keeps the date). |
| `list_tasks` | Reads back what's open — today, this week, or everything. Overdue items always surface. |
| `complete_task` | Checks a task off by matching a word or phrase from its title. |
| `add_event` | Puts an appointment on Google Calendar with a popup alert. |
| `list_events` | Reads back today's or this week's calendar. |

## One-time setup

Everything below works from a phone or iPad browser — no computer required.

### 1. Google Cloud (5 min)

In [Google Cloud Console](https://console.cloud.google.com) (same project as the dashboard's Drive setup is fine):

1. **APIs & Services → Library** — enable **Google Tasks API** and **Google Calendar API**.
2. **APIs & Services → Credentials** — you can reuse the existing OAuth "Web application" client. After Railway gives you a domain (step 2), add redirect URI `https://<your-railway-domain>/oauth/callback`.

### 2. Deploy on Railway

New Railway service from this repo with **Root Directory** set to `task-bridge/`. Set variables:

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — from the OAuth client above
- `MCP_SECRET` — a long random string (a password manager's generated password works fine). The bridge's endpoint is `/mcp/<that secret>`; the secret in the URL is what keeps strangers out, so treat the full URL like a password.
- `BRIDGE_TZ` — e.g. `America/Chicago`

Railway sets `PORT` automatically. Health check path: `/health`.

### 3. Sign in with Google (in the browser)

Visit:

```
https://<your-railway-domain>/setup/<MCP_SECRET>
```

Tap **Connect Google**, sign in with the account whose Tasks/Calendar you use, and the page hands you a `GOOGLE_REFRESH_TOKEN` value to paste into Railway's variables. After the redeploy, that same setup page shows your finished Claude connector URL.

> The dashboard's existing refresh token won't work here — it only has Drive permission. This one adds Tasks + Calendar.
>
> Prefer a terminal? `node scripts/google-oauth.js` still works as a local alternative (redirect URI `http://localhost:53683/callback`).

### 4. Connect it to Claude

On claude.ai → **Settings → Connectors → Add custom connector**, paste:

```
https://<your-railway-domain>/mcp/<MCP_SECRET>
```

No OAuth screen will appear — the secret URL is the credential. Once added, the connector is available in the Claude apps on your phone, iPad, and computer.

### 5. Make sure the buzzing works

Install the **Google Tasks** app on phone + iPad and allow notifications. The **Google Calendar** app handles timed alerts. That's the whole notification system — nothing to build or maintain.

## Try it

Say to Claude on your phone:

> "I need to call the roofing client back Thursday at 2"

Watch it appear in Google Tasks, and expect the buzz Thursday at 1:30 and 2:00.

## Local development

```bash
npm install
npm test        # jest — googleapis fully mocked, no network
npm start       # listens on :3200
```

## Notes

- Timezone defaults to `America/Chicago`; override with `BRIDGE_TZ`.
- Tasks go to your default Google Tasks list (`@default`), events to your primary calendar.
- The server is stateless — every request builds a fresh MCP session, so it scales to zero and restarts cleanly.
