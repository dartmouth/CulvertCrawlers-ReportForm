# CulvertCrawlers-ReportForm
CulvertCrawlersCommunityScienceMap Report Form

**React PWA (offline‑enabled) + Node/Express back‑end**  

## Table of Contents  

1. [Project Overview](#project-overview)  
2. [Folder Structure](#folder-structure)  
3. [Prerequisites](#prerequisites)  
4. [Installation & Running Locally](#installation--running-locally)  
5. [Key Features](#key-features)  
   - UI & Form Logic  
   - Offline data handling  
   - Automatic resend when online  
   - Submission history lookup  
6. [Server API](#server-api)  
7. [Database](#database)  
8. [Development Tips](#development-tips)  
9. [License](#license)  

---  

## Project Overview  

The **Culvert Crawlers** application lets community scientists submit detailed observations of culverts, ditches and storm drains.  
It is a **Progressive Web App** built with **React** that works fully offline; data entered while disconnected is saved to **IndexedDB** and automatically transmitted once a network connection (Wi‑Fi or cellular) is detected.  

The back‑end is a lightweight **Express** server that receives multipart form data, stores the survey in a PostgreSQL database, and serves the compiled React build in production.

---  

## Folder Structure  

```
project-root/
│
├─ client/                     # React PWA
│   ├─ src/
│   │   ├─ App.js               # Main UI, form handling, offline logic
│   │   └─ utils/
│   │        └─ imageStore.js    # IndexedDB helpers (saveImage, get, deleteImage)
│   ├─ public/
│   ├─ package.json
│   └─ …                        # other CRA files
│
└─ server/                     # Node/Express API
    ├─ server.js                # Express setup, routes, DB queries
    ├─ .env                     # DB_URL, PORT, NODE_ENV, etc.
    └─ …                        # optional utils, migration scripts
```

* `npm start` → runs the client (`http://localhost:3000`).  
* `node server.js` → starts the API on `PORT` (default 5000).  

---  

## Prerequisites  

| Tool | Minimum version |
|------|-----------------|
| Node.js | 18.x |
| npm | 9.x |
| PostgreSQL | 12.x (any version that supports `pg` driver) |
| Git | – |

---  

## Installation & Running Locally  

```bash
# Clone the repo
git clone <repo‑url>
cd project‑root

# ---------- Client ----------
cd client
npm install
npm start            # http://localhost:3000

# ---------- Server ----------
cd ../server
npm install
# Create a .env file (example)
#   DB_URL=postgres://user:pass@localhost:5432/culvert_db
#   PORT=5000
node server.js
```

The client will proxy API calls to `http://localhost:5000` (CORS is enabled for development).  

When you are ready for production, run `npm run build` inside `client/` and copy the generated `build/` folder into `server/public/`. The Express server will then serve the static assets and the PWA will be installable from any modern browser.

---  

## Key Features  

### UI & Form Logic  

* The **survey form** is defined in `App.js` and uses **react‑hook‑form** for validation, conditional field registration (e.g., ownership only for “Culvert”), and easy value extraction [1].  
* A **review modal** (`showReviewModal`) lets users verify all entered data before submission [1].  
* Users can fetch their **submission history** by entering their email and clicking the “Retrieve Submission History” button [1].

### Offline Data Handling  

1. **Image capture** – `handleCapture` validates file counts, stores images in **IndexedDB** (via `saveImage`) when `navigator.onLine` is `false`, otherwise sets the file directly in the form state [1].  
2. **Form submission** – `onSubmit` checks connectivity. If offline, the stripped field data plus a map of image‑ID references is queued in **localStorage** under the key `offlineSurveyQueue` via `storeOfflineWithImages` [1].  
3. **Queue introspection** – `getOfflineCount` returns the number of pending submissions [1].  

### Automatic Resend When Online  

* The app registers `window.addEventListener('online', handleOnline)` [1].  
* `handleOnline` reads the offline queue, pings the back‑end with `waitForDNS` (up to 5 retries) [1], then iterates over each queued item:  
  * Re‑hydrates image IDs using `injectOfflineImages`.  
  * Calls `submitToServer` to POST the data.  
  * On success, deletes the IndexedDB blobs (`deleteImage`) and removes the entry from the queue.  
* Failed resends stay in the queue and the user is alerted [1].

### Submission History  

* `handleHistoryFetch` sends a GET request to `/api/history?reporter_name=…` and displays the results in a modal table [1].  

---  

## Server API  

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/ping` | Simple health‑check used by the client’s connectivity test [2]. |
| `GET`  | `/api/history?reporter_name=…` | Returns all surveys for the supplied email, ordered by timestamp [2]. |
| `POST` | `/api/submit` | Accepts multipart/form‑data (survey fields + photos). Stores the main row in `culvert_surveys` and any extra images in `survey_photos` (batch insert). [2] |
| `*`    | – | Wildcard route serves `index.html` for any non‑API request (required for PWA routing) [2]. |

**CORS** is enabled for `http://localhost:3000` during development; in production the server allows all origins or can be locked down as needed [2].

---  

## Database  

The server uses a **PostgreSQL** pool (`pg` library).  

* **Main table** – `culvert_surveys` (columns match the form fields, e.g., `reporter_name`, `report_type`, `latitude`, `longitude`, `culvert_type`, …, `timestamp`).  
* **Photo table** – `survey_photos` (`survey_id` FK → `culvert_surveys.id`, `image` BYTEA).  

The `INSERT` query in `server.js` maps each form field to a `$n` placeholder and returns the generated `id` for linking additional photos [2].

---  

## Development Tips  

| Tip | How to apply |
|-----|--------------|
| **Hot‑reload the client** | `npm start` in `client/` watches source changes automatically. |
| **Inspect IndexedDB** | Open Chrome DevTools → **Application → IndexedDB** to view stored image blobs while offline. |
| **Force offline mode** | In Chrome DevTools → **Network → Offline** to test queueing and automatic resend. |
| **Debug backend connectivity** | The `waitForDNS` utility logs each ping attempt; watch the console for “✅ Backend is reachable via /api/ping”. |
| **View server logs** | The Express middleware at the top of `server.js` logs every incoming request, helping you verify that `/api/submit` receives the expected fields [2]. |
| **Add new report types** | Extend the `report_type` `<select>` in `App.js`, then add corresponding fields and registration logic in the same component [1]. |
| **Deploy** | Build the client, copy `client/build` to `server/public/`, set `NODE_ENV=production`, and start `node server.js`. The PWA will be installable on mobile browsers. |

---  

## License  

This project is released under the **MIT License**. Feel free to fork, modify, and deploy it for community‑science initiatives.  

---  
