# Cabinet Inspection – Frontend (React)

React + TypeScript + Vite + Tailwind CSS frontend for the Flask backend.

| Page | URL | Backend call |
|---|---|---|
| Dashboard | `/` | `GET /api/stats` |
| New inspection | `/inspect` | `POST /api/inspections` |
| Result | `/inspections/:id` | `GET /api/inspections/:id` (+ report / image URLs) |
| History | `/history` | `GET /api/inspections?verdict=&limit=&offset=`, `DELETE` |

---

## Step-by-step setup (Windows + Antigravity)

### Step 1 – Install Node.js (once)
Download **Node.js LTS** from https://nodejs.org and install with defaults.
Check in a new terminal:
```powershell
node -v     # v20 or newer
npm -v
```

### Step 2 – Put the folders side by side
```
Downloads\
  cabinet-inspection-backend\     <- you already have this
  cabinet-inspection-frontend\    <- unzip this here
```

### Step 3 – Update 2 backend files (adds the dashboard endpoint)
Copy from `backend-update/` in this zip into your backend, replacing the old files:

| From (this zip) | To (your backend) |
|---|---|
| `backend-update/app/db.py` | `cabinet-inspection-backend/app/db.py` |
| `backend-update/app/routes/inspections.py` | `cabinet-inspection-backend/app/routes/inspections.py` |

### Step 4 – Open both folders in Antigravity
**File → Open Folder** → `cabinet-inspection-frontend`.
(Optional: **File → Add Folder to Workspace** → `cabinet-inspection-backend` to see both.)

### Step 5 – Terminal 1: start the backend
```powershell
cd C:\Users\Admin\Downloads\cabinet-inspection-backend
.venv\Scripts\activate
python run.py
```
Leave it running. Check that http://127.0.0.1:5000/api/stats works.

### Step 6 – Terminal 2: install and start the frontend
Click **+** in the terminal panel for a second terminal:
```powershell
cd C:\Users\Admin\Downloads\cabinet-inspection-frontend
npm install
npm run dev
```
`npm install` takes 1–2 minutes the first time and creates `node_modules\`.
Then open **http://localhost:5173**.

### Step 7 – Try it
1. **New inspection** → drop `cabinet_bad.png`, `bom.pdf`, `wiring.xlsx` from the backend's `samples` folder → **Run inspection**.
2. Result page shows **FAIL** with 4 defects. Hover a defect → its location lights up on the photo.
3. Repeat with `cabinet_good.png` → **PASS 100%**.
4. **Dashboard** and **History** now show both runs from the database.

Every time you work on it later: Terminal 1 `python run.py`, Terminal 2 `npm run dev`.

---

## How frontend and backend talk
`vite.config.ts` forwards every request starting with `/api` to `http://127.0.0.1:5000`.
So the frontend calls `/api/inspections`, and Vite passes it to Flask. No CORS setup is needed,
and the backend URL is defined in one place.

## Where everything is (what to edit for what)

```
cabinet-inspection-frontend/
  index.html                  page shell, fonts, title
  vite.config.ts              dev server port + /api proxy to Flask
  package.json                dependencies + npm scripts
  src/
    main.tsx                  starts React
    App.tsx                   URL -> page mapping (add new pages here)
    index.css                 Tailwind + shared styles (.card, .btn, .tag …)
    lib/
      types.ts                TypeScript shapes of the backend JSON
      api.ts                  ALL backend calls (fetch / upload with progress)
      useApi.ts               loading / error / reload hook
      format.ts               date + text formatting helpers
    components/
      Layout.tsx              sidebar, navigation, backend status lights
      ui.tsx                  VerdictBadge, SeverityBadge, ScoreRing, StatCard, Loading, ErrorState
      FileDrop.tsx            drag & drop file box with preview
      InspectionViewer.tsx    photo + SVG boxes, hover highlight, server-image toggle
    pages/
      Dashboard.tsx           stats cards, most common defects, latest inspections
      NewInspection.tsx       3 uploads, cabinet name, progress, error messages
      InspectionDetail.tsx    verdict, score, defects, photo, component + wire tables, report
      History.tsx             filter PASS/FAIL, pages, delete
      NotFound.tsx            404 page
```

Typical changes:
- **Backend on another PC / port** → change `target` in `vite.config.ts`.
- **New field from the backend** → add it in `src/lib/types.ts`, show it in the page.
- **Colours / look** → Tailwind classes in the components, shared ones in `src/index.css`.
- **New page** → create `src/pages/X.tsx`, add a `<Route>` in `App.tsx` and a link in `Layout.tsx`.

## Build for production
```powershell
npm run build      # type-checks, then creates dist/
npm run preview    # serves dist/ on http://localhost:4173 to test it
```
To serve `dist/` from Flask instead, copy its contents into the backend's `app/static/`
and add a catch-all route that returns `index.html` for non-`/api` paths.

## Troubleshooting
| Problem | Fix |
|---|---|
| Red "Backend offline" in the sidebar / "Cannot reach the backend" | Terminal 1 must be running `python run.py` |
| `npm` not recognised | Install Node.js, then open a **new** terminal |
| `npm install` errors about permissions | Close Antigravity, reopen, run again; or delete `node_modules` and retry |
| Dashboard shows an error but other pages work | You skipped Step 3 (the backend needs `/api/stats`) |
| Port 5173 in use | `npm run dev -- --port 5174` |
| PowerShell "running scripts is disabled" | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
