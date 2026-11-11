# Italian Number Generator

A local-first Progressive Web App for creating synthetic Italian-format mobile numbers. It uses a Web Worker for generation and IndexedDB for persistent browser storage. Generated data is not uploaded to a server.

The interface defaults to Italian, with English available from the language selector. Language and light/dark appearance preferences are saved in this browser.

## Requirements

- Node.js 20.19+ or 22.12+ (Node 24 is also supported)
- npm
- VS Code (optional)

## Run locally on Windows

Open PowerShell in the project folder:

```powershell
npm install
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). To test on an iPhone on the same Wi-Fi, run `npm run dev -- --host 0.0.0.0` and open the computer's LAN URL on the phone. For Add to Home Screen and service-worker checks, use an HTTPS deployment; iOS does not install a PWA from an ordinary LAN HTTP URL.

## Build and preview

```powershell
npm run build
npm run preview
```

The production files are written to `dist/`. `npm test` runs the automated test suite.

## Deploy from GitHub to Vercel

1. Create an empty repository on GitHub (do not initialize it with a README or license).
2. In PowerShell, from the project directory, initialize and push the project. Replace the remote URL with your repository URL:

   ```powershell
   git init
   git add .
   git commit -m "Initial Italian Number Generator app"
   git branch -M main
   git remote add origin https://github.com/tc067367-web/iphone-pws.git
   git push -u origin main
   ```

3. Sign in to [Vercel](https://vercel.com/), choose **Add New → Project**, and import the GitHub repository.
4. Keep the detected Vite settings: build command `npm run build`, output directory `dist`, and install command `npm install`. No environment variables or backend services are required.
5. Choose **Deploy**. Every later push to the connected production branch triggers a new deployment.
6. Open the production HTTPS URL and verify the app, offline shell, and manifest in the browser.

The `vercel.json` rewrite supports SPA routes. No API routes are used.

## Install on iPhone

1. Deploy the site to Vercel and open its HTTPS URL in **Safari** on the iPhone.
2. Tap **Share** → **Add to Home Screen**.
3. Keep **Open as Web App** enabled (if shown) and tap **Add**.
4. Launch **Italian Numbers** from the Home Screen. The interface adapts to the safe areas and standalone display.

The service worker caches the application shell for offline reopening. Number data is kept in that browser's IndexedDB; clearing Safari website data or removing browser data can remove it. Exports are created locally. Browsers exposing the File System Access API can write export chunks directly to a selected file; other browsers download a Blob assembled from bounded database reads, which may require substantial device memory for very large exports.

## Data and performance notes

- Italian-style synthetic mobile numbers use a 10-digit national part beginning with `3`, preceded by the configurable country code (default `39`). They are not checked against carrier allocations and may coincide with real assigned numbers; do not call or message generated entries.
- Generation is capped at 2,000,000 entries per session and runs in a dedicated Web Worker in batches. The interface displays progress, generation rate, pause/resume, and cancellation.
- IndexedDB persists sessions and entries on the current device. Duplicate avoidance checks stored entries before insertion; disabling it permits repeated numbers across sessions.
- Storage capacity is controlled by the browser and device. Large runs may fail if quota is reached; reduce batch size or quantity and free device storage if needed.
- Avoid duplicate generation sessions: a second session cannot start while one is active. Reloading during generation records the session as interrupted and preserves already-saved batches.
- No generated entries, telemetry, account data, or settings are transmitted to a server. Vercel hosts static application assets only.

## Project layout

```text
src/
  App.tsx               Responsive dashboard and application workflows
  db.ts                 IndexedDB persistence and paged reads
  generation.worker.ts  Batch number generation
  main.tsx              React entry point and PWA registration
  styles.css            Responsive dark dashboard and iPhone safe areas
  types.ts              Shared app data types
public/icons/           PWA and iOS touch icons
```
