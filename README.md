# Italian Number Generator

A React, Vite, and PWA app for generating synthetic Italian-format mobile numbers. The interface defaults to Italian, supports English, and includes dark and light themes.

## How the shared master works

The master TXT stays in your local `data\` folder and is not included in Git or Vercel. Import it once from your PC directly into a private Supabase Postgres database. The importer streams the file to the database; it does not send the file through this app or through Vercel.

When signed in, each generation batch is submitted to an authenticated database function. A unique database key atomically filters numbers already in the master and adds only new numbers. Only returned unique values are saved in the current browser's IndexedDB session. The master is shared between authorized devices; session history, preferences, and exports remain local to each browser. Generation requires an internet connection and an authorized Supabase account. The installed PWA can cache its app shell for offline reopening, but cannot check or update the shared master offline.

The database stores phone-number strings, not names or other personal information. The generator is for synthetic test data only: generated values can match real assigned phone numbers. Do not call or message them.

## Requirements

- Node.js 20.19+ or 22.12+ (Node 24 is supported)
- npm
- A Supabase project with enough database capacity for the source data, its indexes, and import overhead
- The source master TXT in the ignored `data\` folder

**Check Supabase database disk capacity and plan limits before importing.** The current source file is roughly 759 MB, and Postgres needs additional space for the table, unique index, transaction work, and future growth. Do not start an import unless the project has sufficient capacity. The importer leaves the original source file unchanged.

## Set up Supabase

1. Create a Supabase project and check its current database storage limits and available disk.
2. In the Supabase SQL Editor, run [`supabase/migrations/202611120001_shared_master.sql`](./supabase/migrations/202611120001_shared_master.sql).
3. Create your single application user in Supabase Authentication. Disable public sign-ups after creating it.
4. In the SQL Editor, authorize that user's Auth user ID:

   ```sql
   insert into public.master_access (user_id)
   values ('YOUR-AUTH-USER-UUID');
   ```

   Use the user's UUID from Supabase Authentication, not their email. Only allowlisted accounts can call the master RPCs. Do not add a service-role key to the application.
5. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` using the project's public URL and publishable/anon key. These two public values are required by the app. Never use a service-role key or database password for either variable.
6. Configure the same two public variables in the Vercel project's environment settings before deploying.

The migration denies direct access to the master tables and exposes only status and atomic candidate-add RPCs to authenticated users. Keep Supabase Authentication and database credentials private.

## Import the master once from Windows

Install dependencies and run the app locally:

```powershell
npm install
npm run dev
```

In a separate PowerShell window, from the project directory, set the private database connection string for that shell and start the importer:

```powershell
$env:DATABASE_URL = Read-Host "Paste the private Supabase database connection string"
npm run import:master -- "data\TUTTI_NUMERI_GENERATI_UNICI_AGGIORNATO.txt"
Remove-Item Env:DATABASE_URL
```

Use the Supabase Postgres direct connection or an appropriate session-pooler connection string. Do not use the public app key here. The script prints the file size, asks you to type `IMPORT`, then streams and normalizes lines into a temporary staging table before merging unique numbers into the master. It reports line progress and a final count. The source TXT is not modified. Re-running the importer is safe for duplicates, but repeats the full upload; only run it again if needed.

The import uses a database transaction and may take a long time. Keep the PC and connection running until it finishes. If the transaction is interrupted, the master is not marked initialized; after resolving the cause and confirming disk capacity, rerun the import. Do not import the large file through an iPhone browser or upload it to a public/static hosting folder.

## Run, test, and build

```powershell
npm run dev
npm test
npm run build
npm run preview
```

Open the Vite URL printed in the terminal. The production build is written to `dist\`. Generation batches are produced in a Web Worker; IndexedDB stores local session results, and TXT/CSV exports read sessions in bounded pages. The app caps a generation session at 2,000,000 unique values. Browser storage quotas still apply; large sessions need enough free space on the device.

## Deploy from GitHub to Vercel

1. Create a private GitHub repository. Confirm `data\` and `.env.local` are not staged; both are excluded by `.gitignore`.
2. From PowerShell in this project folder, connect and push the repository:

   ```powershell
   git init
   git add .
   git status
   git commit -m "Initial Italian Number Generator app"
   git branch -M main
   git remote add origin https://github.com/YOUR-ACCOUNT/YOUR-REPOSITORY.git
   git push -u origin main
   ```

3. In Vercel, import the GitHub repository. Use build command `npm run build` and output directory `dist`.
4. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the Vercel environment settings for the deployment environments, then deploy.
5. After the import completes, reload the app. Open the HTTPS deployment, sign in with the allowlisted Supabase account, and verify that Settings reports the shared master as initialized before generating.

Do not add `DATABASE_URL`, a database password, or a service-role key to Vercel. The Vercel deployment serves the app; the bulk importer sends the master directly from the PC to Supabase.

## Install on iPhone

1. Open the deployed HTTPS URL in Safari.
2. Tap **Share → Add to Home Screen**, leave **Open as Web App** enabled if offered, and tap **Add**.
3. Open the Home Screen app and sign in. Generation and duplicate checks require internet access; the PWA shell may reopen offline.

The interface supports iPhone safe areas and touch-sized controls. Session data is per-browser: clearing Safari website data can remove local history and exports, but does not delete the shared Supabase master.

If a previous version left a partial master import in a browser's IndexedDB, Settings shows its local count and offers to clear that old copy only after the shared master is initialized. This cleanup does not remove session history or change Supabase.

## Project layout

```text
src/
  App.tsx               Dashboard, authentication, and generation workflows
  db.ts                 IndexedDB settings, sessions, and paged reads
  masterApi.ts          Authenticated Supabase master RPC calls
  supabase.ts           Public app client configuration
  generation.worker.ts  Batched synthetic-number generation
  exportFormat.ts       TXT and CSV formatting
  styles.css            Responsive themes and iPhone safe-area layout
supabase/migrations/    Private master schema and access-controlled RPCs
scripts/import-master.mjs
                       PC-side streaming import to Supabase
public/icons/           PWA and iOS icons
```
