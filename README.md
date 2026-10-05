# Raihan Timetable AI

React (Vite) + Tailwind front end, Google Sheets + Apps Script back end, Google Sign-In.

Google sign-in and role-based access are implemented. Phase 1 provides week-scoped relocation
setup, a JHS schedule advisory, and operational notices. Schedule generation and later phases
remain planned work and are not represented as complete.

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
2. Add a `JHS_Raw_Data` tab with these required headers (other columns may be present):
   `Period`, `Class`, `Subject`, `Mufawwaz/Department`, and `Date`. `Mufawwaz/Department`
   contains the teacher ID (4 or 8 digits) followed by the teacher name. `Number` is the teacher's
   mobile number and is not used for schedule analysis. `Period` must be P1-P8 or 1-8, and
   `Date` must contain actual spreadsheet dates or ISO `YYYY-MM-DD` dates.
3. Extensions > Apps Script. Paste `apps-script/Code.gs`; its `GOOGLE_CLIENT_ID` must match
   `googleClientId` in `src/config/publicConfig.js`.
4. Deploy > New deployment > Web app. Execute as **Me**, access **Anyone**. Copy the `/exec` URL.

## 3. Public app configuration

Set `googleClientId` and `apiUrl` in `src/config/publicConfig.js`:

- `googleClientId`: the web OAuth client ID from Google Cloud.
- `apiUrl`: the deployed Apps Script web app `/exec` URL.

These values are public and are included in the browser bundle. Do not put private
credentials or secrets in this file. The OAuth client ID must match the ID configured
in `apps-script/Code.gs`.

To run locally, use `npm install` and `npm run dev` (`http://localhost:5173`).

## 4. Deploy to GitHub Pages

1. Push to a GitHub repo (default branch `main`) and commit the `package-lock.json` that `npm install` created.
2. Settings > Pages > Source: **GitHub Actions**.
3. Push to `main`. The workflow in `.github/workflows/deploy.yml` builds and publishes; no Actions variables are required.

The app uses `HashRouter` (URLs look like `/#/allocation`) because GitHub Pages can't rewrite
unknown paths to `index.html`.

## Phase 1: Relocation setup and advisory

- Choose a week number (1-41), start/end dates, and the affected classes. The week number is the
  key for saved relocation configuration and `Raihan_Week_Logs`.
- Unique class names come from `JHS_Raw_Data`. Configuration is saved in `Raihan_Weeks`;
  `Raihan_Week_Logs` records setup, analysis, refresh, and proceed actions.
- The advisory deduplicates identical date/period/class/subject/teacher rows, chooses each
  affected teacher's weekday with the fewest home-campus sessions, then maps home sessions from
  that day to free P1-P8 slots on other weekdays. It flags sessions that cannot be placed and
  Raihan assignments exceeding one day's eight-period capacity.
- Student and Asateza notices can be copied or opened as prefilled WhatsApp messages.
- After manually updating `JHS_Raw_Data`, refresh the advisory. Alternatively, **Changes Done —
  Proceed** records the decision without requiring another upload.

After changing `apps-script/Code.gs`, deploy a new web app version before using corresponding
app changes.

## Later phases (planned, not yet implemented)

### Phase 2: Sanitization, solver, and schedule distribution

- Sanitize split/duplicate sessions and tag the secondary teacher whose ID begins `78652` as
  `MUSANID`; bypass constraint checks for Musanid records while preserving them next to the primary
  teacher in final timetable views.
- Keep all Raihan periods for each teacher on one designated weekday. Prefer alternating P2/P4/P6;
  if unavailable, use any remaining free period that day. Flag unsatisfied sessions with diagnostics
  such as period collision, no single-day availability, and teacher overbooked.
- Add temporary teachers with a draggable Days x P1-P8 availability grid and assign lagged sessions
  only to valid, collision-free slots.
- Export the exact `JHS_Raw_Data` column schema into `Raihan_Allocations`. Store printable
  allocations in `Allocations_Raihan`, with a Days x P1-P8 crosstab, class/teacher filters,
  full-screen view, and PDF export.
- Add teacher-specific WhatsApp messages with day, periods, class, and room; support `wa.me`
  dispatch and batched copy-ready broadcasts.

Subject color palette for the crosstab:

| Subject | Color |
|---|---|
| Adab, Tawil | `#F5E0CB` |
| Al-Lisān al-ʿArabī | `#F2F3F8` |
| English | `#9796A6` |
| Fiqh | `#D5F1CA` |
| Hikmat | `#B3F7B2` |
| Jameeiyaah Thaniyah, Marhalat Saqafat Aamah | `#E5CCDF` |
| Khaimat Riyadat | `#C9EBFB` |
| Nashatat Ilmiyah | `#F1E3FE` |
| Quran Kareem | `#FFD5E5` |
| Sciences | `#FFF6A3` |
| Akhbaar | `#CFF88A` |
| Takhassus | `#A3CBE3` |
| Barāmij ʿIlmiyya | `#F8D0B3` |
| Maqaalah Muwasah | `#BCC77C` |
| Jameeiyah Ula | `#F8CBAB` |

### Phase 3: Academic operations and events

- Create secure, lightweight monitor links for pre-relocation syllabus reports in `Syllabus_Records`;
  aggregate class-by-class briefs and map them to subject teachers before Raihan day.
- Log weekly teacher/admin feedback, curriculum progress, attendance flags, and operational changes
  with timestamps and teacher IDs.
- Add a special-event/override manager for seminars, assemblies, Duas, guest lectures, schedule
  freezes, and period suppressions without overwriting the underlying master timetable.

Each later phase needs dedicated Apps Script endpoints and sheet schemas before it is enabled.

## 5. Arabic font

The Kanz Al Lulu font is bundled from `src/assets/fonts/` and applies only to elements with
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
src/config/                public app config + role constants
src/services/api.js        the only place that talks to Apps Script
src/context/               AuthProvider (Context + useReducer), useAuth
src/routes/                routeConfig, ProtectedRoute, AppRoutes
src/layouts/AppLayout.jsx  sidebar + header
src/pages/                 login, not-authorised, not-found
src/modules/               Phase 1 Allocation plus planned module screens
```
