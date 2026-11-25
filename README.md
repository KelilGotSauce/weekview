# Weekview — unified Calendar + Notion dashboard

This project combines the original read-only Google Calendar week view with the Notion habits table.

## Dashboard layout
- Left 30%: Google Calendar categories with total scheduled hours for the selected week.
- Right upper 75%: weekly Google Calendar view.
- Right lower 25%: Notion date + eight selected checkbox habits.
- Finance tab: 2026 Notion transactions, asset and credit inputs, monthly summaries, and registered-account progress.
- Network tab: editable people and organization graph, relationship paths, and direct connection-strength ratings.
- Google Calendar access is read-only. Notion access is read-only.

## Requirements
- Node.js 20 or newer
- A Google Cloud OAuth **Web application** client
- Your existing Notion internal integration with Read content permission

## 1. Preserve your existing environment file
When replacing your old project, keep your existing `.env` file private. Do not upload or share it.

The new server needs these variables:
```env
NOTION_API_KEY=...
NOTION_DATABASE_ID=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:8787/api/auth/google/callback
APP_ORIGIN=http://localhost:5173
SESSION_SECRET=a_long_random_secret
PORT=8787
MONGODB_URI=your_private_mongodb_atlas_connection_uri
MONGODB_DATABASE=weekview
```

Finance balances, credit inputs, credit score, registered-account contribution inputs, transaction Expense 2 overrides, and annual expense budgets are saved in MongoDB Atlas. Add the Atlas URI to your private local `.env` file; do not paste it into chat or commit it. The server stores these values in the `finance_settings` collection in the configured database. If MongoDB is not configured, finance data from Notion remains viewable, but manual finance inputs cannot be saved.

The Network tab stores its graph separately in the `network_graphs` collection in the same Atlas database. It can show several directed routes from you to a target; mark a route as a potential lead when it is not confirmed.

The existing browser-only Google project used `VITE_GOOGLE_CLIENT_ID`. You can reuse the same OAuth client ID, but the new server-side flow also requires that OAuth client's **client secret**. The server supports `VITE_GOOGLE_CLIENT_ID` as a fallback for the client ID, but do not put the client secret in a `VITE_` variable.

## 2. Update Google OAuth configuration
In Google Cloud Console, open the same OAuth Web application client:
- Keep `http://localhost:5173` under Authorized JavaScript origins if you still use it.
- Add `http://localhost:8787/api/auth/google/callback` under Authorized redirect URIs.
- Ensure Google Calendar API is enabled.
- Keep the read-only Calendar scopes.

For personal testing, add your Google account as a test user if the consent screen is in Testing mode.

## 3. Install and run
In PowerShell, from the project folder:
```powershell
npm install
Copy-Item .env.example .env
```
Only use `Copy-Item` if you do not already have a `.env` file. If you already have one, edit it carefully and preserve your current Notion values.

Then run:
```powershell
npm run dev
```
Open `http://localhost:5173`.

## 4. Persistent sign-in
Google uses the OAuth authorization-code flow. The server stores the refresh token in a server-side session file and the browser keeps a signed, HTTP-only session cookie. On refresh, Weekview checks the existing session and refreshes the Google access token when needed.

The `.sessions` folder contains private session/token data. Do not upload it, commit it to Git, or share it. Keep `.env` and `.sessions` out of source control. Set a strong random `SESSION_SECRET`.

Notion uses the server-side integration secret and therefore does not require a separate interactive sign-in each time.

## Notes
- The Google OAuth client must be a **Web application** client, not a desktop client.
- This is designed for a single-user local development setup. Before exposing it publicly, use HTTPS, secure cookies, CSRF protections, a managed session store, and review Google's OAuth verification requirements.
- Google refresh tokens issued while an OAuth app is in Testing mode may expire after seven days for non-basic scopes. For long-term uninterrupted use, review the app's publishing/verification status.
- Category totals sum the durations of timed events in each selected calendar for the displayed week. All-day events are excluded from hour totals.
- The Notion table currently loads up to 100 rows and shows the latest 12.
