# Deploying to Railway

Environment variables (Railway → project → Variables):

| Var | Purpose |
|---|---|
| ANTHROPIC_API_KEY | Claude text-post generation (existing) |
| DASHBOARD_PASSWORD | Login password for the web UI |
| SESSION_SECRET | Random string; signs the session cookie (`openssl rand -hex 32`) |
| API_TOKEN | Bearer token for Claude sessions/scripts (`openssl rand -hex 32`) |
| GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET | OAuth client (Google Cloud Console → APIs & Credentials, Drive API enabled) |
| GOOGLE_REFRESH_TOKEN | Minted once via `node scripts/google-oauth.js` locally |
| OUTPUT_DRIVE_FOLDER_ID | Folder ID of the output Drive root (from its URL) |

Known limitation: SQLite data resets on each deploy (no volume). Media lives in
Drive so files survive; asset/client rows do not. Fix (next up after Phase A):
attach a Railway volume for `data/` or migrate to Postgres.
