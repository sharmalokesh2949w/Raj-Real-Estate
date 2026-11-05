# CMS Setup and Operations

## Cloudflare Pages + D1 implementation (local/preview only)

The Pages Functions in `functions/` now contain a D1-backed CMS/API implementation. This is separate from the existing Express/SQLite implementation, which remains available as a fallback. The D1 migration has not been applied to any Cloudflare database, and this code has not been deployed.

The D1 schema supports the existing blog, project, page SEO/content, settings, admin, session, enquiry, and career application records. Pages form submissions are saved to D1 first and queued for optional Google Sheets delivery; if Sheets is not configured or is temporarily unavailable, the D1 record remains saved. Authenticated CMS users can upload JPEG, PNG, or WebP images through the Pages Function to the configured Cloudinary account. Uploads are limited to 5 MiB each; the existing Express/SQLite upload flow remains separate.

### Tools and local files

- Node.js `>=22.13.0` and npm.
- Wrangler CLI 4 is a local development dependency (`wrangler` in `devDependencies`), locked by `package-lock.json`. Run `npm install` after checkout to install the project dependencies.
- `wrangler.toml` defines a local `DB` binding and separate preview/production placeholders. The all-zero database IDs are intentionally unusable placeholders. Do not replace them with a real ID or run a remote command until production migration is separately approved.
- `migrations/0001_cms_schema.sql` is the versioned schema migration. It creates application tables only and does not modify Cloudflare's `_cf_KV` object.
- Use one ignored root `.env` for local Express and Pages development. `.env.example` contains variable names and placeholders only; copy it to `.env` and replace placeholders locally. `.env` is gitignored; never commit it.
- Current Wrangler documentation supports `.env` for local Worker bindings and the explicit `--env-file .env` option. Use that option in Pages preview commands so the intended file is unambiguous. Do not have a `.dev.vars` file alongside `.env`: when `.dev.vars` exists, Wrangler does not include `.env` values in the local Worker environment. The `.dev.vars*` ignore rule remains only as protection against accidentally committing an old local file.

### Local D1 migration and preview on Windows

From the repository root in PowerShell, install the locked project dependencies and create `.env` only if it does not already exist:

```powershell
npm install
if (-not (Test-Path -LiteralPath .\.env)) {
    Copy-Item -LiteralPath .\.env.example -Destination .\.env
} else {
    Write-Output ".env already exists; leaving it unchanged."
}
```

Edit only your ignored local `.env` file. Set a random `ADMIN_BOOTSTRAP_TOKEN` of at least 32 characters, and configure the Cloudinary cloud name, API key, and API secret as needed. `GOOGLE_SCRIPT_URL` belongs to the legacy Express career flow. For Pages Functions, leave `GOOGLE_SHEETS_WEB_APP_URL` and `GOOGLE_SHEETS_SHARED_SECRET` unset until a real Sheet and Apps Script deployment are configured. Do not put real values in `.env.example`, Git, or chat. The Express scripts already load this root `.env` through `dotenv`; Wrangler Pages commands below explicitly use it with `--env-file`.

Prepare the static site in a new temporary directory (this avoids replacing an existing `dist`) and apply the schema to Wrangler's local D1 database:

```powershell
$previewDir = Join-Path $PWD (".cloudinary-preview-" + [guid]::NewGuid().ToString("N"))
$env:PAGES_PREVIEW_DIR = $previewDir
node -e "require('./scripts/build-pages').buildPages({outputDirectory:process.env.PAGES_PREVIEW_DIR})"
Remove-Item Env:PAGES_PREVIEW_DIR
npx wrangler d1 migrations apply raj-real-estate-local --local --persist-to .\local-data\wrangler
npx wrangler pages dev $previewDir --env-file .env --persist-to .\local-data\wrangler
```

The local Pages server runs in the foreground. After testing, press **Ctrl+C** and remove only the temporary directory created in this PowerShell session:

```powershell
Remove-Item -LiteralPath $previewDir -Recurse
```

Keep the server running at the local URL Wrangler prints. The generated `.cloudinary-preview-*` directory is ignored by Git; do not store user data in it. The `local-data` directory and `.env` are also ignored. The D1 migration command must include `--local`; never use `--remote` for this setup. Do not pass an environment name such as `production` to these local commands.

### Import existing static content into local D1

The current checkout has no legacy SQLite database at the configured/default CMS database path. Its local D1 database already contains one administrator and two enquiries; the importer leaves both and all other existing D1 data untouched. Existing page/project source content is available in the website HTML. The legacy SQLite initializer has two entries marked as demo posts, so the static importer deliberately does not copy those into D1 as recovered historical content. No historical SQLite blog rows or enquiries can be recovered until the original SQLite file is located.

After applying the schema, preview the static import, then explicitly apply it to local D1:

```powershell
node .\scripts\import-static-content-to-d1.js --dry-run
node .\scripts\import-static-content-to-d1.js --apply
```

The import reuses the site's existing HTML-to-CMS extraction logic in a temporary SQLite database outside the project. It inserts only missing Pages, Projects, and Settings rows (including current image paths, page content, and published status); it never updates or deletes existing records and does not import admin credentials, sessions, demo blog posts, or enquiries. Re-running `--apply` is safe and idempotent. The command always invokes Wrangler with `--local` and the `local-data\wrangler` persistence directory; it has no remote mode.

Verify only row counts after import:

```powershell
npx wrangler d1 execute raj-real-estate-local --local --persist-to .\local-data\wrangler --command "SELECT (SELECT COUNT(*) FROM cms_pages) AS pages, (SELECT COUNT(*) FROM cms_projects) AS projects, (SELECT COUNT(*) FROM cms_blog_posts) AS blog_posts, (SELECT COUNT(*) FROM cms_settings) AS settings, (SELECT COUNT(*) FROM inquiries) AS inquiries;"
```

The separate `/Propertys/` township microsite has detailed brochure and marketing content not represented by the current D1 project fields. It remains a static page so importing or editing ordinary CMS projects cannot erase that content.

### Securely bootstrap the first D1 administrator

The first admin is created through `POST /api/cms/auth/bootstrap`, which is available only when:

1. The request is same-origin.
2. `ADMIN_BOOTSTRAP_TOKEN` is configured and the caller supplies the matching Bearer token.
3. There is no existing D1 admin.

The submitted password must be 12–256 characters. The code creates a random salt and PBKDF2-HMAC-SHA-256 hash; it never stores the plaintext password. After successful bootstrap, remove `ADMIN_BOOTSTRAP_TOKEN` from local `.env` and restart preview. Do not import the old SQLite scrypt hash into D1: it uses a different password-hashing scheme. Keep the existing Express/SQLite admin unchanged as the fallback; create a new D1 admin only after the content migration and environment are ready.

For local PowerShell testing, enter the bootstrap token from `.env` at the secure prompt and send the bootstrap request to the locally running Pages preview. The token and password prompts below do not echo their input:

```powershell
$email = Read-Host "Administrator email"
$secureToken = Read-Host "ADMIN_BOOTSTRAP_TOKEN from local .env" -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
$securePassword = Read-Host "Administrator password (12+ characters)" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $body = @{ email = $email; password = $password } | ConvertTo-Json
    $headers = @{ Authorization = "Bearer $token" }
    Invoke-RestMethod -Uri "http://localhost:8788/api/cms/auth/bootstrap" `
        -Method Post -Headers $headers -ContentType "application/json" -Body $body
}
finally {
    if ($tokenPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
    }
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    Remove-Variable secureToken, securePassword -ErrorAction SilentlyContinue
    Remove-Variable token -ErrorAction SilentlyContinue
    Remove-Variable password -ErrorAction SilentlyContinue
}
```

Use the local URL/port shown by Wrangler if it differs from `http://localhost:8788`. Enter the exact local token stored in `.env` at the secure prompt; do not hardcode it into the command or repository.

### D1 API coverage and image handling

- Public CMS reads: `/api/cms/public/blog`, `/api/cms/public/blog/:slug`, `/api/cms/public/projects`, `/api/cms/public/projects/:slug`, `/api/cms/public/pages`, `/api/cms/public/pages/:slug`, and `/api/cms/public/settings`.
- Authenticated CMS: login/logout/session, one-time bootstrap, dashboard summary, enquiries and status updates, blog CRUD, project CRUD/soft-delete, page SEO/content updates, and settings updates.
- Public forms: `/api/inquiry` and `/api/popupinquiry` save inquiries to D1; `/api/career` saves career applications to D1. Both can queue optional Sheets delivery when configured.
- Blog detail routes query the published blog record and serve the existing `blog-post.html` template. Project detail routes query the published project, use its existing static page when available, or serve the CMS project template. Project filter routes (for example `/projects/navi-mumbai`) still serve `projects.html`; blog paths do not route to the project handler.
- Blog and project image fields accept existing local `/images/...` and legacy `/uploads/...` paths, plus HTTPS delivery URLs under the configured Cloudinary account. Other hosts, protocol-relative URLs, `javascript:`, and `data:` URLs are rejected. `/images/...` references are checked against the Pages static asset binding when one is available; legacy `/uploads/...` references remain dependent on the Express backend.
- `POST /api/cms/admin/uploads` requires an active D1 admin session and a same-origin request. The function checks the file's JPEG, PNG, or WebP signature, enforces a 5 MiB limit, signs the upload server-side, and sends it to the fixed `raj-real-estate/cms` Cloudinary folder. It never accepts a remote source URL and never returns the API secret. Assets are not automatically deleted when CMS records are edited or deleted.
- The admin upload picker previews the selected file, uploads it through the API, and fills the blog featured-image or project listing-image field with the returned HTTPS URL. Save the post/project after uploading; project uploads are also added to its gallery by default.

### Environment variables and D1 binding

| Name | Where | Purpose |
|---|---|---|
| `DB` | Wrangler D1 binding | Database handle used by Pages Functions. Local uses Wrangler's local D1 state. |
| `ADMIN_BOOTSTRAP_TOKEN` | Local `.env`; later a Cloudflare secret | One-time first-admin creation. Remove it after bootstrap. |
| `GOOGLE_SHEETS_WEB_APP_URL` | Optional Pages server-side variable | HTTPS Google Apps Script `/exec` endpoint for the D1 outbox. |
| `GOOGLE_SHEETS_SHARED_SECRET` | Optional Pages secret | Shared authentication value between Pages Functions and the Apps Script receiver. |
| `APP_ENV` | Wrangler non-secret variable | Labels local, preview, or production runtime. |
| `CLOUDINARY_CLOUD_NAME` | Local `.env`; later a server-side Pages variable/secret | Cloud name used by the server to choose the upload API and validate delivery URLs. |
| `CLOUDINARY_API_KEY` | Local `.env`; later a Pages secret | Cloudinary upload API key, sent only in the server-to-server upload request. |
| `CLOUDINARY_API_SECRET` | Local `.env`; later a Pages secret | Signs the Cloudinary upload request; never sent to the browser or returned by the API. |

### Cloudinary account setup and local upload test

1. Sign in to Cloudinary and open the account dashboard. Copy the **Cloud name** and **API Key** shown in the account details. The **API Secret** is available in the same account area; treat it as a password. Do not paste credentials into chat or source files.
2. Copy `.env.example` to `.env` only if `.env` does not already exist. In the local ignored `.env` file, set the three `CLOUDINARY_*` values from your Cloudinary account. Keep `.env` out of Git; `.gitignore` already excludes it.
3. Run only local Wrangler commands (`--local` for D1) and open the local Pages URL. Sign in to `/admin/`, open **Blog** or **Projects**, choose a JPEG, PNG, or WebP file no larger than 5 MiB, and select **Upload image**. The browser displays a preview before upload; after success, the Cloudinary URL fills the relevant image field. Save the record.
4. For a blog test, publish a test post and open `/blog` and `/blog/<slug>`. For a project test, publish the project and open its listing and detail page. Confirm the image survives a page reload. Delete the CMS test records manually when finished if desired; their Cloudinary assets are intentionally not deleted automatically.
5. To configure a later Cloudflare Pages deployment, open the Pages project’s **Settings → Variables and Secrets** and add all three `CLOUDINARY_*` values separately for **Preview** and **Production**. Treat all three as server-side values and never place them in frontend build variables. This phase did not change dashboard settings or deploy the code.

Cloudinary currently lists its Image and Video Free plan as **25 monthly credits**. One credit can be used as 1,000 transformations, 1 GB of managed storage, or 1 GB of image bandwidth (usage is combined across resources). Check the [official pricing page](https://cloudinary.com/pricing) and your account’s usage/credit dashboard before launch and regularly afterward; traffic, storage, and transformations all consume credits. Plan features and limits can change, so verify your account’s current plan and billing/upgrade settings rather than assuming usage beyond the free allocation stays free. Uploads are permanently retained unless manually removed, so avoid repeated test uploads and review unused assets.

The D1 binding name in the config must remain `DB` unless the Functions code is updated too. Do not copy a production database ID into the local config. Preview and production IDs/names in `wrangler.toml` are placeholders requiring explicit review.

### Production migration and deployment checklist (not performed)

The following steps require your separate, explicit approval. Do not execute them as part of local development.

1. Identify and confirm the exact existing Cloudflare D1 database name and ID in the Cloudflare dashboard. Confirm whether it is the intended preview or production database; do not infer this from a database name.
2. Back up the existing SQLite database and image files. Export only the necessary CMS records and review the export locally before importing. Keep enquiries private; exclude old session tokens and login-attempt records.
3. Map existing tables/columns to `migrations/0001_cms_schema.sql`. Do not migrate `admins.password_hash` / `password_salt` because existing values use scrypt. Create the first D1 admin with the one-time PBKDF2 bootstrap after data import; keep the old Express login unchanged until D1 is independently verified.
4. Review the migration SQL and chosen target. Apply only to the explicitly confirmed target after separate approval. This repository's implementation work has not run remote migrations.
5. Add the confirmed D1 binding in the correct Cloudflare Pages environment. If Sheets delivery is approved, add `GOOGLE_SHEETS_WEB_APP_URL` and `GOOGLE_SHEETS_SHARED_SECRET` as server-side secrets/variables there. Add `ADMIN_BOOTSTRAP_TOKEN` temporarily as a secret only for first-admin setup, then remove it.
6. Confirm the Pages Git project name, production/preview environments, build command (`npm run build:pages`), output (`dist`), Functions directory, custom domain, and HTTPS in the dashboard. Do not deploy until the Functions and D1 binding are confirmed.
7. Test a preview deployment end-to-end before considering production; retain the Express/SQLite fallback and a verified backup until rollback is no longer needed.

Cloudflare Free has a 10 ms Worker CPU limit per request and a daily request allowance. PBKDF2 is asynchronous Web Crypto using 600,000 iterations. Local Node timing does not prove that the hashing operation will stay within Cloudflare's CPU budget. Measure login CPU in a Cloudflare preview before production approval; if it exceeds the Free limit, do not reduce security parameters casually—reassess the auth architecture.

## What the CMS manages

The following operational details describe the existing Express/SQLite fallback. For the new Pages Functions + D1 setup, use the Cloudflare sections above.

- All eleven existing projects and newly created project pages: public status, listing details, SEO fields, gallery images, layout/map images, amenities, and YouTube link.
- SEO title/description and publish status for the seven managed root pages.
- Explicitly marked text/image fields on selected pages, plus shared business contact details.
- Blog posts, including drafts, publication dates, article text, and featured images.
- Admin sign-in, project/page/blog/settings APIs, and image uploads.

It does not manage every paragraph or layout on every page. Website property enquiries are saved in the shared SQLite database and can be reviewed in the authenticated **Enquiries** section. Career applications continue to use the existing external integration. New project pages use a common CMS template, while the existing project URLs and page layouts remain in place.

## Enquiry management

On the Pages + D1 site, contact, footer, project, and popup enquiry forms submit to `POST /api/inquiry`; `POST /api/popupinquiry` remains a compatibility alias. Valid records are stored in the `inquiries` table with source form/page and submission time. Career submissions use `POST /api/career` and are stored in `career_applications`. The Pages CMS Enquiries section reads and manages inquiry records; public APIs do not expose the inbox. The legacy Express/SQLite deployment has separate storage and handlers.

Pages endpoints apply a per-client rate limit of 15 submissions per 15 minutes using D1-backed rate-limit records. Browser submissions include an idempotency key where supported; duplicate keys do not create duplicate database rows. Do not treat the browser success message as proof of a Google Sheets write: D1 is the durable record, and the response reports the Sheets delivery state.

## Optional Google Sheets delivery for Pages

The local integration is prepared but intentionally inactive until a real Sheet and Apps Script deployment are configured. The Pages Functions write enquiries and career applications to D1 first; a D1 trigger creates one outbox item in the same database transaction. A successful Apps Script response marks that item sent. Network/API failures leave the record in D1 and the outbox pending for a later retry; delivery uses submission IDs to reduce duplicate rows.

The Apps Script receiver source is `scripts/google-sheets-web-app.gs`. It is prepared for the existing spreadsheet; no Google request has been made and no URL or secret is configured in this repository.

1. Open the existing spreadsheet and confirm its sharing remains **Restricted**. Do not rename or clear its existing `Inquiries` or `Careers` tabs.
2. Open **Extensions → Apps Script** and paste the receiver source into `Code.gs`. Save the project. The code targets `Inquiries` for enquiry records and `Careers` for career applications.
3. In Apps Script, open **Project Settings → Script Properties** and add:
   - `SPREADSHEET_ID`: the spreadsheet ID from the supplied Sheet URL. Keep it in Script Properties, not in source code.
   - `SHARED_SECRET`: a newly generated random value with at least 32 characters. Keep it private; do not send it in chat or commit it.
4. Deploy via **Deploy → New deployment → Web app**. Choose **Execute as: Me**. The access setting must allow Cloudflare to call the web app; the spreadsheet itself stays Restricted. The JSON endpoint requires the shared secret on every call. Authorize the requested Google permissions.
5. Copy the actual deployed HTTPS URL ending in `/exec`. Do not guess or construct this URL. Give it to the project maintainer; the secret should be entered only into local/Cloudflare server-side secret configuration when separately approved.
6. For a changed receiver, use **Deploy → Manage deployments → Edit** and create/select a new version. Existing deployments do not automatically update when `Code.gs` is edited.

The receiver preserves existing rows and header names. It recognizes common existing header variants (for example `Full Name`, `Phone Number`, `Timestamp`, and `Position`) and maps into those columns; it appends only columns that are not already represented by a recognized header. It never rewrites or removes old cells. If a sheet has records but no usable header row, it rejects the write rather than modifying that data. New enquiry rows go to `Inquiries`; new career rows go to `Careers`. A `Submission ID` column is used for idempotency; if absent, it is added at the end. Formula-like values are escaped before writing.

The Pages D1 outbox sends JSON containing `type`, `submissionId`, and a `record` object, plus `sharedSecret` in the same JSON body. Pages verifies the HTTPS Apps Script `/exec` URL and a 32-character minimum secret before attempting delivery. The receiver does not accept a missing/wrong secret for JSON requests.

Apps Script `ContentService` may redirect its response to a Google-hosted content URL. Pages explicitly follows standard HTTPS redirects and parses the final response. A delivery failure leaves the D1 outbox row pending and sets the next eligible attempt with exponential backoff (1, 2, 4, 8, 16, 32, then 60 minutes). There is no scheduled background retry: a later submission/retry attempt or an authenticated administrator retry can deliver pending rows. The outbox records only safe categories such as `http_503`, `unexpected_html_response`, `invalid_json_response`, or `receiver_spreadsheet_write_failed`; it does not store response bodies, customer data, or the shared secret. The Apps Script receiver returns stable `errorCode` values for configuration, authentication, validation, and spreadsheet-write failures.

When updating the Apps Script receiver source, deploy a new version of the existing Web App deployment (**Deploy → Manage deployments → Edit → Version → New version → Deploy**). Keep the same deployment and spreadsheet; the `/exec` URL normally remains the same. No new spreadsheet is needed. This receiver update is required for the new safe `errorCode` responses; older deployed code may still return the generic rejection response, which Pages categorizes as `receiver_rejected`.

Backward compatibility: the existing Express career handler still sends URL-encoded parameters (`sheet=Careers`, `name`, `phone`, `email`, `address`, `qualification`, `experience`, `position`, `resumeUrl`, and `coverLetter`). The receiver continues to accept this legacy form format when no secret is supplied so existing callers keep working; the compatibility path is unauthenticated in that mode and is not used by the new D1 JSON outbox. If `GOOGLE_SHEETS_SHARED_SECRET` is configured in the Express server environment, the handler includes it as `sharedSecret` and the receiver validates it. The handler also forwards a browser `Idempotency-Key` as `submissionId` when supplied. Legacy calls without either remain compatible but cannot be authenticated or deduplicated. For stronger protection, configure the secret for the Express caller or migrate it to authenticated JSON before removing the compatibility path.

Pending D1 outbox delivery can be retried by an authenticated CMS administrator with `POST /api/cms/admin/google-sheets/retry` (up to 25 pending records per request). `GET /api/cms/admin/google-sheets` reports configured state and outbox counts. No scheduled retry is configured; pending records remain safely in D1 until a retry is requested. This integration makes no changes to production resources and does not activate delivery by itself.

## Blog content

Open **Blog** in the authenticated admin sidebar to create and edit posts, change their publication status, or delete them. The public listing is available at `http://localhost:5000/blog`; published articles use `/blog/<slug>`. Only published posts are returned by `/api/cms/public/blog`. The CMS stores article content as plain text and displays it as text, with blank lines separating paragraphs; HTML is not rendered. Featured images may use existing `/images/...` files or uploads managed by the CMS.

The `cms_blog_posts` table is created additively in the existing SQLite database. Startup seeding inserts the two demo posts if their slugs are not already present and does not overwrite existing posts or edits. Blog management uses the existing CMS admin session and same-origin mutation checks.

## Requirements and local startup

Use Node.js `>=22.13.0` and npm. The CMS uses Node's built-in `node:sqlite`; the existing `mysql2` dependency is not the CMS database.

From the repository root in PowerShell:

```powershell
node --version
$env:CMS_DATA_DIR = ".\data"
npm start
```

The site and admin UI are served by the same Express application. Open `http://localhost:5000/` for the public site and `http://localhost:5000/admin/` for the CMS. The default port is 5000; set `PORT` to override it.

Do not open `admin/index.html` directly or use VS Code Live Server (commonly port 5500) for the CMS. The admin page and its login API must share the Express origin; a static server may return HTTP 405 for the login `POST`. If `PORT` is set to a custom value, open `/admin/` on that port instead.

If dependencies are not already present in a checkout, install the dependencies listed by the existing package manifest with `npm install`. This project does not require a separate frontend build command.

## Create the first administrator

Start the application once so the database schema and initial site content are created. In a second interactive PowerShell terminal, use the same storage directory:

```powershell
$env:CMS_DATA_DIR = ".\data"
npm run admin:create
```

Enter the administrator email and a password of at least 12 characters when prompted. The password input is masked and the password is not stored in plain text. The command creates another administrator if run again; there is no public registration form.

## Storage and configuration

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | Express listening port | `5000` |
| `NODE_ENV` | Enables the `Secure` session-cookie attribute in production | Not set by code |
| `CMS_DATA_DIR` | Default data directory | `./data` |
| `CMS_DATABASE_PATH` | SQLite database file override | `<CMS_DATA_DIR>/cms.sqlite` |
| `CMS_UPLOAD_DIR` | CMS upload directory override | `<CMS_DATA_DIR>/uploads` |
| `GOOGLE_SCRIPT_URL` | HTTPS Google Apps Script web-app URL for career application forwarding | Required for career form submissions |
| `TRUST_PROXY` | Exact trusted reverse-proxy IP/subnet or hop count for Express client IP detection | Unset (proxy headers are not trusted) |

The database schema and initial seed are created by `cms/database.js` when the server starts. Existing HTML content is imported with insert-if-missing behavior; later startup seeding does not overwrite existing CMS edits. There is no separate migration or seed CLI. Back up the SQLite database and uploaded files together. Keep the database on persistent storage and account for SQLite's write-ahead-log files when taking live backups.

Do not commit `.env` or paste secret values into reports. The tracked `.env` file has been removed from the current Git index; that does not erase historical copies. Rotate any credentials that may have been committed and decide with repository owners whether history remediation is required.

## Existing Express/SQLite fallback and Pages API

The existing local Express server and SQLite database remain unchanged as the fallback. The Pages `functions/api/[[path]].js` handler now serves the CMS, enquiry, career, and health APIs from Pages Functions/D1; it no longer proxies those API requests to Render. The legacy `functions/uploads/[[path]].js` route still reads existing uploaded image paths from the Express backend until a separately planned Cloudinary migration.

The admin UI and CMS API use the same origin. The D1 session cookie is `HttpOnly`, `Secure`, and `SameSite=Strict`, and all CMS mutations require a same-origin `Origin` header. Blog and project clean routes use their separate Functions and query the published D1 record before serving the correct existing HTML template. Project filter routes continue to serve the Projects page. Do not treat this local code change as a live deployment or proof that the Cloudflare dashboard bindings are configured.

For Cloudflare Pages Git deployments, use `npm run build:pages` as the build command and `dist` as the build output directory. The script copies only tracked website HTML and assets from the approved public directories; it excludes environment files, databases, uploads, backend code, and build/test tooling. The Pages Functions source remains in the repository-root `functions/` directory, outside the static output. Do not use the repository root (`.`) as the Pages build output directory. Update the Pages project build settings and publish a new deployment before considering the static asset exposure fixed; a local build or Git change does not change an existing preview deployment.

On Pages, career application submissions are sent by the browser to the same-origin `POST /api/career` endpoint. The server validates and saves the application in D1, then attempts optional outbox delivery to Google Sheets; a Sheets failure does not lose the saved application. The existing Express career handler still uses its separate `GOOGLE_SCRIPT_URL` forwarding configuration and does not use this D1 outbox.

The Pages D1 endpoints limit submissions to 15 per client IP per 15 minutes using D1-backed rate-limit records. The separate Express fallback limiter is in-memory and applies to one process; multi-instance Express deployments need a shared rate-limit store.

Express does not trust forwarded client-IP headers by default. If deployed behind a reverse proxy, set `TRUST_PROXY` to the actual trusted proxy IP/subnet or a known fixed hop count for that hosting topology. Do not use a broad trust setting when clients can connect through untrusted intermediaries; rate limits and audit IPs depend on this setting.

## Validation

Run the integration suite from the repository root:

```powershell
npm test
```

The tests use a temporary SQLite database and upload directory, then remove those temporary files.
