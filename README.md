# Raihan Timetable AI

React (Vite) + Tailwind front end, Google Sheets + Apps Script back end, Google Sign-In.

Build status: project scaffold, Google sign-in, and role-based routing are done.
Modules 1-5 are placeholder pages; the Allocation Engine is next.

## 1. Google Cloud: OAuth client

1. Google Cloud Console > APIs & Services > OAuth consent screen: configure it (External is fine).
2. Credentials > Create credentials > OAuth client ID > **Web application**.
3. Authorized JavaScript origins (origin only, no path):
   - `http://localhost:5173`
   - `https://<your-github-username>.github.io`
4. No redirect URIs are needed. Copy the client ID.

## 2. Google Sheet + Apps Script

1. Create a Google Sheet. Add a tab named `Users` with this header row:

   | email | role | name | assigned_class | teacher_id | active |
   |---|---|---|---|---|---|
   | you@example.com | admin | Your Name | | | TRUE |
   | rep@example.com | monitor | Class Rep | 4 A M | | TRUE |
   | teacher@example.com | viewer | A. Teacher | | 12345 | TRUE |

   Roles: `admin`, `scheduler`, `monitor`, `viewer`. Monitors need `assigned_class`.
2. Extensions > Apps Script. Paste `apps-script/Code.gs` and set `GOOGLE_CLIENT_ID`.
3. Deploy > New deployment > Web app. Execute as **Me**, access **Anyone**. Copy the `/exec` URL.

## 3. Run locally

```bash
npm install
cp .env.example .env.local     # fill in VITE_GOOGLE_CLIENT_ID and VITE_API_URL
npm run dev                    # http://localhost:5173
```

## 4. Deploy to GitHub Pages

1. Push to a GitHub repo (default branch `main`) and commit the `package-lock.json` that `npm install` created.
2. Settings > Pages > Source: **GitHub Actions**.
3. Settings > Secrets and variables > Actions > **Variables**: add `VITE_GOOGLE_CLIENT_ID` and `VITE_API_URL`.
4. Push again. The workflow in `.github/workflows/deploy.yml` builds and publishes.

The app uses `HashRouter` (URLs look like `/#/allocation`) because GitHub Pages can't rewrite
unknown paths to `index.html`.

## 5. Arabic font

Add the licensed font as `public/fonts/KanzAlLulu.woff2`. It applies only to elements with
`lang="ar"` or `dir="rtl"`. In Arabic modules, prefer logical Tailwind classes (`ms-*`, `me-*`,
`ps-*`, `pe-*`, `text-start`) so layouts flip correctly.

## How sign-in and roles work

1. The Google button returns an **ID token** (a signed JWT).
2. The app POSTs it to Apps Script (`auth.login`). Apps Script verifies it with Google, checks the
   token was issued for your client ID, then looks the email up in the `Users` sheet.
3. The backend returns `{ email, name, picture, role, assignedClass, teacherId }`.
4. `src/routes/routeConfig.js` lists which roles may open each page; it drives both the routes and
   the sidebar. Every later API call sends the token again and Apps Script re-checks the role,
   so hiding a page in the UI is never the only protection.
5. The token is kept in `sessionStorage` (cleared when the tab closes). It expires after about an
   hour, at which point the user is signed out and asked to sign in again.

## Folder layout

```
apps-script/Code.gs        backend: token check + Users sheet lookup
src/config/                env + role constants
src/services/api.js        the only place that talks to Apps Script
src/context/               AuthProvider (Context + useReducer), useAuth
src/routes/                routeConfig, ProtectedRoute, AppRoutes
src/layouts/AppLayout.jsx  sidebar + header
src/pages/                 login, not-authorised, not-found
src/modules/               one folder per module (placeholders for now)
```
