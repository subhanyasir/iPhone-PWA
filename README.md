# Italian Number Generator

A local-first Progressive Web App for creating synthetic Italian-format mobile numbers. It uses a Web Worker for generation and IndexedDB for persistent browser storage. Generated data is not uploaded to a server.

The interface defaults to Italian, with English available from the language selector. Language and light/dark appearance preferences are saved in this browser.

## Private master-number file

The large master file belongs in the local `data/` folder and is intentionally excluded from Git and Vercel deployments. Never commit or publish it: a deployed static asset would be downloadable by anyone.

In the app, open **Settings → Master number file** and select the TXT file from the device. Import is streamed in bounded batches; use one phone number per line. The file is merged into a separate IndexedDB master list on that device, with duplicates ignored. Generation is disabled until an import completes. Every generated candidate is checked against this master list, and only new unique numbers are saved to the generation session and appended to the master list in the same local transaction.

The browser cannot modify the original file in `data/`. The IndexedDB list becomes the writable master for that browser/device; the source TXT remains unchanged. Use **Download updated master TXT** to save the complete local master. Very large exports stream directly to disk in Chrome or Edge on PC; browsers without file-stream support can download smaller masters, or you can export generated sessions and merge those additions into the source file on your PC. Import the master separately on each device. Clearing generation history does not remove master numbers.

The master list is private to the browser profile and is not synced to Vercel or other devices. A large import requires adequate browser storage; if storage fills, imported batches remain local and safe, and the same file can be imported again to continue merging.

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
   git remote add origin https://github.com/<USERNAME>/<REPOSITORY>.git
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
- IndexedDB persists sessions, generated entries, and the imported master list on the current device. Every generated candidate is checked against the master list; duplicates are always skipped, regardless of earlier generation preferences.
- Storage capacity is controlled by the browser and device. Large runs may fail if quota is reached; reduce batch size or quantity and free device storage if needed.
- Avoid duplicate generation sessions: a second session cannot start while one is active. Reloading during generation records the session as interrupted and preserves already-saved batches.
- No master numbers, generated entries, telemetry, account data, or settings are transmitted to a server. Vercel hosts static application assets only.

## Project layout

```text
src/
  App.tsx               Responsive dashboard and application workflows
  db.ts                 IndexedDB persistence and paged reads
  masterFile.ts         Streamed master TXT parsing
  generation.worker.ts  Batch number generation
  main.tsx              React entry point and PWA registration
  styles.css            Responsive dark dashboard and iPhone safe areas
  types.ts              Shared app data types
public/icons/           PWA and iOS touch icons
```
