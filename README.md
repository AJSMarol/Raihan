# Raihan Timetable AI

React (Vite) + Tailwind front end, Google Sheets + Apps Script back end, Google Sign-In.

Google sign-in and role-based access are implemented. Phase 1 provides week-scoped relocation
setup, source sanitization, a deterministic timetable allocation attempt, lag reporting, and
operational notices. Print-ready outputs and later academic-operation features remain planned.

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
   contains the teacher ID (4 or 8 digits) followed by the teacher name. Department-only values
   are not treated as teacher assignments. `Number` is the teacher's mobile number and is not used
   for schedule analysis. Campus `Period` may be P1-P10, 1-10, or `Period 1`-`Period 10`; `(PT)`
   maps to `Period 1`. Periods in generated schedules and saved availability are stored as
   `Period 1`, `Period 2`, etc. Campus schedules support `Period 1`-`Period 10`; Raihan and
   temporary-teacher slots use `Period 1`-`Period 9`. `Date` may be a spreadsheet date, ISO
   `YYYY-MM-DD`, a Sheets date serial, or a slash/dot-separated date string interpreted using the
   spreadsheet locale.
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

### Login background image

Place the full-screen login photograph at `public/login-background.jpg`. The sign-in panel is
layered above the image with a dark readability overlay. Use a landscape 16:9 image, ideally
2560 x 1440 pixels (1920 x 1080 minimum), in JPG format; aim for less than 1.5 MB. Keep the
important subject near the center because `cover` cropping adjusts the edges on narrow/mobile
screens. The existing fallback background remains visible until the image is added.

## 4. Deploy to GitHub Pages

1. Push to a GitHub repo (default branch `main`) and commit the `package-lock.json` that `npm install` created.
2. Settings > Pages > Source: **GitHub Actions**.
3. Push to `main`. The workflow in `.github/workflows/deploy.yml` builds and publishes; no Actions variables are required.

The app uses `HashRouter` (URLs look like `/#/allocation`) because GitHub Pages can't rewrite
unknown paths to `index.html`.

## Phase 1: Relocation setup and schedule generation

- Choose a week number (1-41), start/end dates, and the affected classes. The week number is the
  key for saved relocation configuration and `Raihan_Week_Logs`.
- Unique class names come from `JHS_Raw_Data`. Configuration is saved in `Raihan_Weeks`;
  `Raihan_Week_Logs` records setup, analysis, refresh, and proceed actions.
- **Clean data & build schedule** copies all valid source sessions in the date range into a
  week-scoped working calculation, collapses repeated class/subject/date/period sessions, and
  detects assistants whose IDs begin `78652` as Musanid records. Those assistants are preserved
  in the teacher field but do not consume a primary-teacher slot.
- The solver chooses each affected primary teacher's least-committed weekday, moves that
  teacher's non-relocating sessions from the day to other open class/teacher slots, then
  consolidates selected-class sessions onto that one Raihan weekday. Subject groups with fewer
  sessions are attempted first; Raihan placement prefers P2/P4/P6 before other periods and uses
  P1-P9. Displaced campus sessions may also use P10.
- Generated rows are written to `Raihan_Allocations`, which adds `Week_No` before the JHS
  columns. A build replaces only the selected week's rows and preserves other weeks.
  If that tab already has the exact JHS columns without `Week_No`, generation prepends the
  identifier column and preserves its existing rows.
  `Raihan_Solver_Working` stores the intermediate source, assigned status, and diagnostics.
  Unplaceable selected-class sessions are listed as lags. Temporary teacher profiles are entered
  manually in `Raihan_Temp_Teachers`; `Availability_JSON` uses weekday keys and `Period N` values,
  for example `{"Monday":["Period 1","Period 4"],"Wednesday":["Period 9"]}`. The app reads these
  profiles and can collision-check compatible assignments.
- **Raihan final timetable** displays the built Raihan schedule as a weekday/date x class x period
  crosstab, with teacher or subject filters. Pending selected-class lags can be manually placed
  into a free P1-P9 slot with a teacher already scheduled at Raihan that day; class and teacher
  collisions are checked and the result is written to `Raihan_Allocations`.
- The generated advisory is kept in the browser session while moving between Allocation and
  Temporary teachers. Student and Asateza notices are prepared separately under **WhatsApp
  broadcast**, using the saved week setup and the current session's teacher-day advisory.
- After manually updating `JHS_Raw_Data`, rebuild the schedule. Alternatively,
  **Changes Done — Proceed** records the decision without requiring another upload.

After changing `apps-script/Code.gs`, deploy a new web app version before using corresponding
app changes.

## Later phases and remaining work

### Phase 2: Outputs and distribution

- Add a print-ready `Allocations_Raihan` export, full-screen view, and PDF export. Add more solver
  diagnostics and test allocations against full-year timetable data.
- Add teacher-specific WhatsApp messages with day, periods, class, and room, and batched
  copy-ready broadcasts.

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

The implemented solver uses dedicated week-scoped output and working sheets. Each remaining
feature needs its own sheet/API contract before it is enabled.

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
