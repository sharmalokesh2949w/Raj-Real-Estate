# CMS Content Inventory

Inventory of the public site, its assets, and the existing submission integrations. It defines the content scope for the CMS; it does not imply that form delivery, external services, or persistence have been runtime-verified.

## Existing site structure and shared content

- The public site consists of eight existing root HTML pages, Blog listing/article routes, and eleven project pages under `projects/`. The markup is static HTML; Bootstrap, `css/custom.css`, and `js/site.js` supply the layout, styling, and interactive behavior.
- The repeated header contains the logo and links to Home, About Us, Projects, Why Us, Career, Contact, Blog, and Privacy Policy. The repeated footer contains project links, contact/office details, a quick-inquiry form, and copyright text. Floating telephone and WhatsApp links also recur. Example: `contact.html` lines 40–63 and 176–224.
- These repeated business details should be modeled once and rendered consistently. Keep navigation structure, responsive layout, visual styling, icons, animation behavior, and form mechanics fixed unless a specific content field is exposed below.
- Project detail pages retain their existing URLs. Existing project-card links and navigation should continue to point to those paths.

## Root pages

| Page / URL | Meaningful content to manage | Existing form / notable relationships |
|---|---|---|
| `index.html` (`/`) | Hero headline, subtitle, and calls to action; four statistics; founder/trust copy and four trust points; three featured project cards (Neelkanth Nagar, Paradise II, Ecopark); three testimonials; title, description, and existing Open Graph/Twitter fields. | Callback form: name, phone, email, hidden form type. Featured cards link to project detail pages. Content examples: lines 118–192, 208–249, 266–349. |
| `about.html` (`/about.html`) | Company introduction and history (since 2022), vision, mission, founder profile/quote and portrait, expertise/service locations, and four values (Transparency, High Growth, Best Investment, Customer Support); page title. | Repeated footer quick inquiry. |
| `why-us.html` (`/why-us.html`) | Hero copy, eight reason cards (title and description each), certificate preview image and caption; page title. | Repeated footer quick inquiry. |
| `projects.html` (`/projects.html`) | Portfolio intro and each project card's name, location label, short description, image, and existing detail-page URL; upcoming-in-Bhiwadi announcement; page title. | Repeated footer quick inquiry. Cards represent the eleven detail pages listed below. |
| `contact.html` (`/contact.html`) | Office address, phone, email, business hours, map embed/location, and page title. | Main contact form: name, phone, email, message; hidden `formType=Contact Us`. Also repeated footer quick inquiry. |
| `career.html` (`/career.html`) | Recruitment intro and four perk cards; page title. | Application fields: name, phone, email, address, qualification, experience, applied position; hidden `formType=Career Applications`. Resume upload and cover letter fields are commented out and are not active controls. Repeated footer quick inquiry. |
| `privacypolicy.html` (`/privacypolicy.html`) | Sixteen policy sections and the existing title, description, Open Graph/Twitter metadata, and robots directive. Policy wording should be editable as policy content, not split into arbitrary markup fields. | Repeated footer quick inquiry. |
| `404.html` (`/404.html`) | Existing title and route/fallback behavior only. | No substantive authored page content to manage. Keep fallback behavior fixed. |

## Blog pages

The Blog listing is served at `/blog`; published article pages use `/blog/<slug>`. Their content is stored in the additive `cms_blog_posts` table in the existing SQLite database and managed from the authenticated CMS Blog section. Fields include title, slug, excerpt, plain-text article content, category, featured image path, publication date, and published/draft status. Only published posts are exposed to the public API and article routes. The two initial demo posts use existing images under `images/neelkanth/` and `images/heritage/`.

## Project detail pages

Ten detail pages share a layout: project heading, eight-image gallery, description, site-layout image, amenities, map, and project inquiry form. Most include a YouTube tour link. The existing layout, gallery controls, icon styling, and responsive presentation are fixed; project data, asset choices/order, labels, and external media URL are content.

Project fields to manage: name, location, card summary, full description, existing URL/slug, project/listing status as evidenced on the page, gallery image order, site-layout image, map image, amenity labels/icons, tour URL when present, and page title/description/social metadata. Each project's inquiry form carries its existing project name.

| Existing URL | Existing content / asset relationship |
|---|---|
| `/projects/heritage.html` | Heritage gated plots, Jagathpura, Jaipur; description and location; eight gallery images, 18 amenities, and project map. |
| `/projects/neelkanth-nagar.html` | Neelkanth Nagar township, Tonk Road, Jaipur; 133-bigha residential/commercial township; eight images, 18 amenities, and project map. |
| `/projects/riyasat-paradise-ii.html` | Riyasat Paradise II gated plots, Sanganer, Jaipur; 60-bigha township; eight images, nine amenities, and project map. No video link was found. |
| `/projects/riyasat-ecopark.html` | Riyasat Ecopark township, Sirsi Road, Jaipur; 10-hectare Gulabi Nagari-themed township; eight images, seven amenities, and project map. |
| `/projects/happy-aerocity.html` | Happy Aerocity airport-themed township, Ajmer; NH-8/Kishangarh location and connectivity; eight images, 18 amenities, and project map. |
| `/projects/aerocrystal.html` | Aerocrystal plotted township, Srinagar Road, Ajmer; residential, commercial, and informal-commercial plots; eight images, 18 amenities, and project map. |
| `/projects/riyasat-royalcrest.html` | Riyasat Royalcrest township, Kharghar Extension, Navi Mumbai; 15-acre European-inspired township; eight images, 18 amenities, and project map. |
| `/projects/riyasat-bliss.html` | Riyasat Bliss township, Panvel, Navi Mumbai; 23.82-acre residential township; eight images, 18 amenities, and project map. |
| `/projects/the-riyasat-sankalp.html` | The Riyasat Sankalp township, Taloja, Navi Mumbai; 37-acre royal-themed township, approvals, plots, and shopping area; eight images, 18 amenities, and project map. The description uses “Riyasat Royal Kingdom,” while the page/card name is “The Riyasat Sankalp”; preserve this distinction unless an administrator edits it. |
| `/projects/riyasat-montera.html` | Riyasat Montera township, Taloja/Ambivali, Navi Mumbai; 17-acre contemporary township; eight images, six amenities, and project map. |
| `/projects/riyasatsankalpvilla.html` | Standalone ready-to-shift villa listing: furnished 3.5 BHK, 1,192 sq. ft., ₹1.92 crore, Panvel; photo/caption set, room-detail cards, township overview/amenities, location copy, approvals, and MahaRERA registration. Manage these actual sale/listing fields as well as title and description. Inquiry fields are name, phone, email, purpose (Self-use, Investment, Exploring), and hidden project/form type. |

The standard project form fields are name, phone, email, hidden project name, and form type. Standard project content examples are in `projects/happy-aerocity.html` lines 96–175 and 287–310; the villa content and form are in `projects/riyasatsankalpvilla.html` lines 63–115, 160–216, and 261–326.

## Existing media inventory

- The repository has 130 tracked image files under `images/`: four root-level assets, nine project-card thumbnails under `images/projects/`, and project-specific folders.
- Gallery/map folders are `images/aerocity/`, `images/aerocrystal/`, `images/bliss/`, `images/ecopark/`, `images/heritage/`, `images/montera/`, `images/neelkanth/`, `images/paradise/`, `images/royalcrest/`, and `images/sankalp/`. These contain numbered gallery images and project `map.png` assets.
- `images/riyasatsankalpvilla/` contains the villa's existing photos. Root assets include the logo, favicon, founder portrait, and `16.jpg`.
- CMS media selection should retain the current assets and paths by default. New uploads need persistent storage appropriate to the deployment host; a local ephemeral deployment filesystem must not be assumed durable.

## SEO, fixed design, and content boundaries

- Most pages have a page-specific title and viewport metadata but no description or social metadata. The homepage has a description, Open Graph fields, and Twitter card (`index.html` lines 35–45); the privacy page has description, Open Graph/Twitter fields, and `robots=index, follow`; the villa has a tailored description.
- CMS SEO fields should include the existing title/description/social fields where present and make page title/description available for other authored pages. Preserve canonical paths and existing page URLs; `404.html` routing is not a content module.
- Do not expose Bootstrap structure, responsive classes, section ordering, fixed design/animation behavior, decorative icons, or form implementation as general-purpose editable content.
- Amenities, property facts, policy text, testimonials, office/contact details, and project-media relationships are real content fields; only create controls for fields evidenced by the site.

## Forms and current data destinations

- General inquiry/footer forms and the main contact form use `js/site.js` and post to the hard-coded Render API host at `/api/inquiry`. The intended backend route forwards selected fields to the configured Google Apps Script URL. Delivery and Sheets persistence have not been verified.
- The career form posts to the same Render host at `/api/career`; its backend route also forwards to Google Apps Script. The resume and cover-letter controls are currently commented out.
- `js/inquirypopup.js` defines another inquiry form, but no HTML page currently loads that script. It posts to `/api/inquiry`; the backend also mounts `/api/popupinquiry`, which appears unused. Do not treat either as a working CMS submission-management source without verifying and deliberately integrating it.
- The project inquiry forms post through the shared inquiry handler with their project name. The existing Google Apps Script integration must not be silently removed or replaced. No private inquiry/application records are available in the repository to seed into a CMS.

## Existing implementation constraints for CMS work

- `server.js` imports `./routes/popup-inquiry`, while the tracked route file is `routes/popupinquiry.js`; this mismatch is a likely backend startup blocker.
- The repository contains Express, CORS, dotenv, Axios, Multer, and mysql2 dependencies, but no implemented database connection or schema was found. `mysql2` being installed does not establish an available database.
- `.env` is tracked. Its values are excluded from this inventory. Do not add, copy, or print its values; deployment setup must use protected environment configuration.
- The website is static HTML and is not served by the Express app. CMS integration must preserve the existing public paths/design while providing a persistent, published-content source. External-service writes, existing deployment behavior, and production storage are not runtime-verified.
