# CMS Setup and Operations

## What the CMS manages

- All eleven existing projects and newly created project pages: public status, listing details, SEO fields, gallery images, layout/map images, amenities, and YouTube link.
- SEO title/description and publish status for the seven managed root pages.
- Explicitly marked text/image fields on selected pages, plus shared business contact details.
- Blog posts, including drafts, publication dates, article text, and featured images.
- Admin sign-in, project/page/blog/settings APIs, and image uploads.

It does not manage every paragraph or layout on every page. Website property enquiries are saved in the shared SQLite database and can be reviewed in the authenticated **Enquiries** section. Career applications continue to use the existing external integration. New project pages use a common CMS template, while the existing project URLs and page layouts remain in place.

## Enquiry management

Homepage, contact, project, blog, and shared footer enquiry forms submit to `POST /api/inquiry`. The homepage popup uses the same endpoint; `POST /api/popupinquiry` remains as a compatibility alias. Valid enquiries are stored in the additive `inquiries` table with their source form/page and submission time. Administrators can search and filter them, update their status, and view the matching total in the CMS **Enquiries** section. Enquiry records are not exposed through a public read API.

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

Do not commit `.env` or paste secret values into reports. `.gitignore` excludes environment files, but it does not remove prior history. The repository's `.env` has appeared in Git history and its removal is staged; that deletion will not erase historical copies. Rotate any credentials that may have been committed and decide with repository owners whether history remediation is required.

## Public API and deployment

The browser calls `/api/cms/public/...` for project, page, and contact content. On localhost it uses the current origin; for non-local hosts, `js/site.js` currently defaults to the existing Render host. `window.RAJ_API_BASE_URL` can override that API base when the script is configured by the host page.

The admin UI and CMS API must be served from the same origin: its session cookie and mutation-origin checks are intentionally same-origin. For production, deploy the Express app behind the intended public domain and mount persistent storage for both the SQLite database and uploads. The source contains a Render URL fallback, but there is no checked-in deployment manifest; actual hosting, domain routing, TLS, and persistent-disk configuration are not verified. A separate static copy of the site will not enforce CMS draft visibility.

Career application submissions are sent by the browser to the same-origin `POST /api/career` endpoint. The server validates the application and forwards name, phone, email, address, qualification, experience, position, optional HTTPS resume URL, and optional cover letter to the configured `GOOGLE_SCRIPT_URL`. Set that variable to the HTTPS URL of the deployed Google Apps Script web app before enabling the form. If it is absent or invalid, the endpoint responds with a service-unavailable error and the browser displays a failure instead of a success message. External delivery still needs verification in the deployment environment.

Public enquiry endpoints are limited to 15 submissions per client IP per 15 minutes. This limiter is in-memory and applies to the single Express process; multi-instance deployments need a shared rate-limit store to enforce one limit across instances.

Express does not trust forwarded client-IP headers by default. If deployed behind a reverse proxy, set `TRUST_PROXY` to the actual trusted proxy IP/subnet or a known fixed hop count for that hosting topology. Do not use a broad trust setting when clients can connect through untrusted intermediaries; rate limits and audit IPs depend on this setting.

## Validation

Run the integration suite from the repository root:

```powershell
npm test
```

The tests use a temporary SQLite database and upload directory, then remove those temporary files.
