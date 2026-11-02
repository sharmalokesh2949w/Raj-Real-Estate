const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const axios = require("axios");

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "raj-real-estate-cms-"));
process.env.CMS_DATA_DIR = dataDirectory;
process.env.CMS_DATABASE_PATH = path.join(dataDirectory, "cms.sqlite");
process.env.CMS_UPLOAD_DIR = path.join(dataDirectory, "uploads");

const { app, db } = require("../server");
const { databasePath } = require("../cms/database");
const { registerAdmin } = require("../cms/auth");

const adminEmail = "cms-test@example.com";
const adminPassword = "cms-test-password-2026";
let server;
let origin;
let sessionCookie;
let databaseClosed = false;

before(async () => {
    assert.equal(databasePath, path.join(dataDirectory, "cms.sqlite"));
    registerAdmin(adminEmail, adminPassword);
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (!databaseClosed) db.close();
    fs.rmSync(dataDirectory, { recursive: true, force: true });
});

async function request(pathname, {
    method = "GET",
    body,
    rawBody,
    authenticated = false,
    includeOrigin = false,
    redirect = "follow"
} = {}) {
    const headers = {};
    if (includeOrigin) headers.Origin = origin;
    if (authenticated && sessionCookie) headers.Cookie = sessionCookie;
    if (rawBody !== undefined) {
        headers["Content-Type"] = "application/json";
        body = rawBody;
    } else if (body !== undefined && !(body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(body);
    }

    return fetch(`${origin}${pathname}`, { method, headers, body, redirect });
}

function projectPayload(overrides = {}) {
    return {
        slug: "cms-integration-project",
        name: "CMS Integration Project",
        category: "jaipur",
        locationLabel: "Jaipur",
        bannerLabel: "Jaipur",
        location: "Test location",
        summary: "Integration-test project",
        description: "A project created to validate CMS persistence.",
        pageTitle: "CMS Integration Project",
        seoDescription: "CMS integration test",
        cardImage: "",
        gallery: [],
        layoutImage: "",
        mapImage: "",
        amenities: [],
        videoUrl: "",
        featured: false,
        sortOrder: 100,
        status: "draft",
        ...overrides
    };
}

function blogPayload(overrides = {}) {
    return {
        slug: "cms-integration-article",
        title: "CMS Integration Article",
        excerpt: "An article used to exercise blog management.",
        content: "First paragraph.\n\nSecond paragraph.",
        category: "Testing",
        featuredImage: "/images/heritage/1.png",
        publishedAt: "2026-10-29",
        status: "draft",
        ...overrides
    };
}

function inquiryPayload(overrides = {}) {
    return {
        name: "Test Enquiry - Integration",
        phone: "9876543210",
        email: "enquiry-test@example.invalid",
        message: "Automated test submission; no follow-up requested.",
        projectName: "CMS Integration Project",
        sourceForm: "Integration test form",
        sourcePage: "/projects/cms-integration-project",
        ...overrides
    };
}

test("seeds all existing pages and projects and serves public CMS content", async () => {
    const response = await request("/api/cms/public/projects");
    assert.equal(response.status, 200);
    const { projects } = await response.json();
    assert.equal(projects.length, 11);
    assert.ok(projects.every(project => project.status === "published"));

    const pagesResponse = await request("/api/cms/public/pages");
    assert.equal(pagesResponse.status, 200);
    assert.equal((await pagesResponse.json()).pages.length, 7);
    assert.equal((await request("/api/health")).status, 200);
    const adminPage = await request("/admin/");
    assert.equal(adminPage.status, 200);
    assert.match(await adminPage.text(), /src="\/admin\/admin\.js"/);
    const adminScript = await request("/admin/admin.js");
    assert.equal(adminScript.status, 200);
    assert.match(await adminScript.text(), /const API_ROOT = "\/api\/cms"/);
    const cityFilter = await request("/projects/jaipur");
    assert.equal(cityFilter.status, 200);
    assert.equal(new URL(cityFilter.url).pathname, "/projects/jaipur");
    const naviMumbai = await request("/projects/navi-mumbai");
    assert.equal(naviMumbai.status, 200);
    assert.match(await naviMumbai.text(), /data-filter="villasinmumbai"/);
    assert.equal((await request("/api/cms/admin/settings")).status, 401);
});

test("serves clean page routes and permanently redirects legacy HTML URLs", async () => {
    const cleanRoutes = [
        ["/", "index.html"],
        ["/about", "about.html"],
        ["/projects", "projects.html"],
        ["/why-us", "why-us.html"],
        ["/career", "career.html"],
        ["/contact", "contact.html"],
        ["/blog", "blog.html"],
        ["/privacypolicy", "privacypolicy.html"],
        ["/projects/navi-mumbai", "projects.html"],
        ["/projects/jaipur", "projects.html"]
    ];
    for (const [pathname, file] of cleanRoutes) {
        const response = await request(pathname);
        assert.equal(response.status, 200, pathname);
        const html = await response.text();
        assert.equal(html, fs.readFileSync(path.join(__dirname, "..", file), "utf8"), pathname);
        if (pathname.startsWith("/projects/")) {
            assert.match(html, /href="\/css\/custom\.css"/, pathname);
            assert.match(html, /src="\/js\/site\.js"/, pathname);
            assert.match(html, /src="\/images\/logo\.png"/, pathname);
        }
    }

    const redirects = [
        ["/index.html?source=legacy", "/?source=legacy"],
        ["/about.html?source=legacy", "/about?source=legacy"],
        ["/projects.html?city=ajmer", "/projects?city=ajmer"],
        ["/blog.html", "/blog"],
        ["/career.html", "/career"],
        ["/contact.html", "/contact"],
        ["/why-us.html", "/why-us"],
        ["/privacypolicy.html", "/privacypolicy"],
        ["/projects/mumbai", "/projects/navi-mumbai"],
        ["/projects/villasinmumbai", "/projects/navi-mumbai?city=villasinmumbai"],
        ["/projects/heritage.html?campaign=spring", "/projects/heritage?campaign=spring"]
    ];
    for (const [pathname, location] of redirects) {
        const response = await request(pathname, { redirect: "manual" });
        assert.equal(response.status, 301, pathname);
        assert.equal(response.headers.get("location"), location, pathname);
    }

    for (const pathname of ["/404.html", "/definitely-not-a-real-page", "/projects/not-a-real-project"]) {
        const response = await request(pathname, { redirect: "manual" });
        assert.equal(response.status, 404, pathname);
        assert.match(await response.text(), /Page not found/i, pathname);
        assert.equal(response.headers.get("location"), null, pathname);
    }

    for (const pathname of ["/", "/about", "/projects", "/why-us", "/blog"]) {
        const response = await request(pathname);
        const html = await response.text();
        const navStart = html.indexOf('<ul class="navbar-nav ms-auto">');
        assert.ok(navStart >= 0, `navbar exists on ${pathname}`);
        const navTags = /<\/?ul\b[^>]*>/g;
        navTags.lastIndex = navStart;
        let navDepth = 0;
        let navEnd = navStart;
        let navTag;
        while ((navTag = navTags.exec(html))) {
            navDepth += navTag[0].startsWith("</") ? -1 : 1;
            if (navDepth === 0) {
                navEnd = navTags.lastIndex;
                break;
            }
        }
        const nav = html.slice(navStart, navEnd);
        const labels = ["Home", "About Us", "Projects", "Navi Mumbai", "Jaipur", "Why Us", "Blog"];
        let previousIndex = -1;
        for (const label of labels) {
            const index = nav.indexOf(`>${label}</a>`);
            assert.ok(index > previousIndex, `${label} appears in order on ${pathname}`);
            previousIndex = index;
        }
        assert.doesNotMatch(nav, />Career<\/a>|>Contact<\/a>|>Privacy Policy<\/a>/);
        assert.match(html, /href="\/career">Career<\/a>/);
        assert.match(html, /href="\/contact">Contact<\/a>/);
        assert.match(html, /href="\/privacypolicy">Privacy Policy<\/a>/);
    }

    const naviProjects = (await request("/api/cms/public/projects")).json();
    const { projects } = await naviProjects;
    assert.ok(projects.some(project => project.category === "mumbai"));
    assert.ok(projects.some(project => project.category === "villasinmumbai"));
    assert.ok(projects.some(project => project.category === "jaipur"));
});

test("validates and forwards career applications through the backend integration", async () => {
    const previousScriptUrl = process.env.GOOGLE_SCRIPT_URL;
    delete process.env.GOOGLE_SCRIPT_URL;
    const application = {
        name: "Test Applicant",
        phone: "9876543210",
        email: "applicant@example.invalid",
        address: "Test City",
        qualification: "Graduate",
        experience: "Fresher",
        appliedPosition: "Sales Executive",
        resumeUrl: "https://example.invalid/resume.pdf",
        coverLetter: "Test cover letter."
    };

    try {
        const unavailable = await request("/api/career", { method: "POST", body: application });
        assert.equal(unavailable.status, 503);
        assert.equal((await unavailable.json()).success, false);

        const invalidResume = await request("/api/career", {
            method: "POST",
            body: { ...application, resumeUrl: "javascript:alert(1)" }
        });
        assert.equal(invalidResume.status, 400);

        const scriptUrl = "https://script.google.com/macros/s/test/exec";
        process.env.GOOGLE_SCRIPT_URL = scriptUrl;
        const originalPost = axios.post;
        let forwarded = false;
        axios.post = async (url, params) => {
            assert.equal(url, scriptUrl);
            assert.equal(params.get("name"), application.name);
            assert.equal(params.get("position"), application.appliedPosition);
            assert.equal(params.get("resumeUrl"), application.resumeUrl);
            assert.equal(params.get("coverLetter"), application.coverLetter);
            forwarded = true;
            return { data: { success: true } };
        };
        try {
            const success = await request("/api/career", { method: "POST", body: application });
            assert.equal(success.status, 200);
            assert.equal((await success.json()).success, true);
            assert.equal(forwarded, true);

            axios.post = async () => {
                throw new Error("simulated upstream failure");
            };
            const failure = await request("/api/career", { method: "POST", body: application });
            assert.equal(failure.status, 502);
            assert.equal((await failure.json()).success, false);
        } finally {
            axios.post = originalPost;
        }
    } finally {
        if (previousScriptUrl === undefined) delete process.env.GOOGLE_SCRIPT_URL;
        else process.env.GOOGLE_SCRIPT_URL = previousScriptUrl;
    }
});

test("maps malformed and oversized JSON request bodies to client errors", async () => {
    const malformed = await request("/api/inquiry", {
        method: "POST",
        rawBody: '{"name":'
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { error: "Request body must be valid JSON." });

    const oversized = await request("/api/inquiry", {
        method: "POST",
        rawBody: " ".repeat(256 * 1024 + 1)
    });
    assert.equal(oversized.status, 413);
    assert.deepEqual(await oversized.json(), { error: "Request body is too large." });
});

test("seeds exactly two public demo posts and serves listing and article routes", async () => {
    const seeded = db.prepare(`
        SELECT title FROM cms_blog_posts ORDER BY slug
    `).all().map(row => row.title);
    assert.deepEqual(seeded.sort(), [
        "A Guide to Modern Real Estate Investment",
        "What to Look for Before Buying Your Dream Home"
    ].sort());

    const response = await request("/api/cms/public/blog");
    assert.equal(response.status, 200);
    const { posts } = await response.json();
    assert.equal(posts.length, 2);
    assert.deepEqual(
        new Set(posts.map(post => post.title)),
        new Set(seeded)
    );

    const listing = await request("/blog");
    assert.equal(listing.status, 200);
    const listingHtml = await listing.text();
    assert.match(listingHtml, /data-cms-blog-list/);
    assert.match(listingHtml, /href="\/blog">Blog<\/a>/);
    assert.equal((await request("/js/blog.js")).status, 200);

    for (const pathname of ["/", "/about", "/projects", "/projects/heritage"]) {
        const page = await request(pathname);
        assert.equal(page.status, 200, pathname);
        assert.match(await page.text(), /href="\/blog">Blog<\/a>/, pathname);
    }

    const villaHtml = fs.readFileSync(
        path.join(__dirname, "..", "projects", "riyasatsankalpvilla.html"),
        "utf8"
    );
    assert.match(villaHtml, /riyasatsankalpvilla\/16\.png/);
    assert.doesNotMatch(villaHtml, /riyasatsankalpvilla\/16\.jpg/);
    assert.equal((await request("/images/riyasatsankalpvilla/16.png")).status, 200);

    assert.equal((await request("/projects")).status, 200);

    for (const post of posts) {
        const articlePage = await request(`/blog/${encodeURIComponent(post.slug)}`);
        assert.equal(articlePage.status, 200);
        assert.match(await articlePage.text(), /data-cms-blog-article/);
        const legacyArticle = await request(`/blog-post.html?slug=${encodeURIComponent(post.slug)}`, {
            redirect: "manual"
        });
        assert.equal(legacyArticle.status, 301);
        assert.equal(legacyArticle.headers.get("location"), `/blog/${post.slug}?slug=${post.slug}`);
        const article = await request(`/blog/${post.slug}`);
        assert.equal(article.status, 200);
        assert.match(await article.text(), /data-cms-blog-article/);
        assert.equal((await request(post.featured_image)).status, 200);
        const detail = await request(`/api/cms/public/blog/${post.slug}`);
        assert.equal(detail.status, 200);
        assert.equal((await detail.json()).post.title, post.title);
    }

    const renderer = fs.readFileSync(path.join(__dirname, "..", "js", "blog.js"), "utf8");
    assert.match(renderer, /element\.textContent = text/);
    assert.match(renderer, /link\.href = `\/blog\//);
    assert.doesNotMatch(renderer, /\.innerHTML\s*=/);
});

test("protects blog administration and validates, publishes, edits, unpublishes, and deletes posts", async () => {
    assert.equal((await request("/api/cms/admin/blog")).status, 401);

    const login = await request("/api/cms/auth/login", {
        method: "POST",
        includeOrigin: true,
        body: { email: adminEmail, password: adminPassword }
    });
    assert.equal(login.status, 200);
    sessionCookie = login.headers.get("set-cookie").split(";")[0];

    const invalidOrigin = await request("/api/cms/admin/blog", {
        method: "POST",
        authenticated: true,
        body: blogPayload()
    });
    assert.equal(invalidOrigin.status, 403);

    const invalid = await request("/api/cms/admin/blog", {
        method: "POST",
        authenticated: true,
        includeOrigin: true,
        body: blogPayload({ title: "" })
    });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /Title is required/);

    const missingImage = await request("/api/cms/admin/blog", {
        method: "POST",
        authenticated: true,
        includeOrigin: true,
        body: blogPayload({ featuredImage: "/images/missing-blog-image.png" })
    });
    assert.equal(missingImage.status, 400);
    assert.match((await missingImage.json()).error, /existing site image or CMS upload/i);

    const traversalImage = await request("/api/cms/admin/blog", {
        method: "POST",
        authenticated: true,
        includeOrigin: true,
        body: blogPayload({ featuredImage: "/images/../server.js" })
    });
    assert.equal(traversalImage.status, 400);

    const unsupportedImage = await request("/api/cms/admin/blog", {
        method: "POST",
        authenticated: true,
        includeOrigin: true,
        body: blogPayload({ featuredImage: "/images/logo.svg" })
    });
    assert.equal(unsupportedImage.status, 400);

    fs.mkdirSync(process.env.CMS_UPLOAD_DIR, { recursive: true });
    const invalidImagePath = path.join(process.env.CMS_UPLOAD_DIR, "invalid-content.png");
    fs.writeFileSync(invalidImagePath, "not an image");
    try {
        const invalidImage = await request("/api/cms/admin/blog", {
            method: "POST",
            authenticated: true,
            includeOrigin: true,
            body: blogPayload({ featuredImage: "/uploads/invalid-content.png" })
        });
        assert.equal(invalidImage.status, 400);
        assert.match((await invalidImage.json()).error, /valid PNG, JPEG, GIF, or WebP/i);
    } finally {
        fs.unlinkSync(invalidImagePath);
    }

    const invalidDate = await request("/api/cms/admin/blog", {
        method: "POST",
        authenticated: true,
        includeOrigin: true,
        body: blogPayload({ publishedAt: "2026-02-31" })
    });
    assert.equal(invalidDate.status, 400);

    const duplicate = await request("/api/cms/admin/blog", {
        method: "POST",
        authenticated: true,
        includeOrigin: true,
        body: blogPayload({ slug: "modern-real-estate-investment" })
    });
    assert.equal(duplicate.status, 409);

    const create = await request("/api/cms/admin/blog", {
        method: "POST",
        authenticated: true,
        includeOrigin: true,
        body: blogPayload({ content: "<script>window.injected = true</script>" })
    });
    assert.equal(create.status, 201);
    assert.equal((await create.json()).post.status, "draft");
    assert.equal((await request("/api/cms/public/blog/cms-integration-article")).status, 404);
    assert.equal((await request("/blog/cms-integration-article")).status, 404);

    const duplicateUpdate = await request("/api/cms/admin/blog/cms-integration-article", {
        method: "PUT",
        authenticated: true,
        includeOrigin: true,
        body: blogPayload({ slug: "buying-your-dream-home" })
    });
    assert.equal(duplicateUpdate.status, 409);

    const update = await request("/api/cms/admin/blog/cms-integration-article", {
        method: "PUT",
        authenticated: true,
        includeOrigin: true,
        body: blogPayload({
            slug: "updated-integration-article",
            title: "Updated Integration Article",
            content: "<script>window.injected = true</script>",
            status: "published"
        })
    });
    assert.equal(update.status, 200);
    assert.equal((await update.json()).post.slug, "updated-integration-article");
    const publicPost = await request("/api/cms/public/blog/updated-integration-article");
    assert.equal(publicPost.status, 200);
    assert.match((await publicPost.json()).post.content, /<script>/);
    const publicListing = await request("/api/cms/public/blog");
    assert.ok((await publicListing.json()).posts.some(post => post.title === "Updated Integration Article"));
    assert.equal((await request("/blog/updated-integration-article")).status, 200);

    const unpublish = await request("/api/cms/admin/blog/updated-integration-article", {
        method: "PUT",
        authenticated: true,
        includeOrigin: true,
        body: blogPayload({
            slug: "updated-integration-article",
            title: "Updated Integration Article",
            status: "draft"
        })
    });
    assert.equal(unpublish.status, 200);
    assert.equal((await request("/api/cms/public/blog/updated-integration-article")).status, 404);

    const deletion = await request("/api/cms/admin/blog/updated-integration-article", {
        method: "DELETE",
        authenticated: true,
        includeOrigin: true
    });
    assert.equal(deletion.status, 204);
    assert.equal((await request("/api/cms/admin/blog", { authenticated: true })).status, 200);
    assert.equal((await request("/api/cms/public/blog")).status, 200);
    assert.equal((await (await request("/api/cms/public/blog")).json()).posts.length, 2);
});

test("persists enquiries and exposes them only to authenticated CMS users", async () => {
    const allowedBudgets = [
        "₹20–40 Lakh",
        "₹40–60 Lakh",
        "₹60–80 Lakh",
        "₹80 Lakh and Above"
    ];
    assert.equal((await request("/api/cms/admin/inquiries")).status, 401);
    assert.equal((await request("/api/cms/public/inquiries")).status, 404);
    const adminPage = await request("/admin/");
    assert.match(await adminPage.text(), /data-view="inquiries"/);
    const homePage = await request("/");
    assert.match(await homePage.text(), /src="\/js\/inquirypopup\.js"/);

    const invalid = await request("/api/inquiry", {
        method: "POST",
        body: inquiryPayload({ name: " " })
    });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /Name is required/);

    const invalidEmail = await request("/api/inquiry", {
        method: "POST",
        body: inquiryPayload({ email: "not-an-email" })
    });
    assert.equal(invalidEmail.status, 400);

    for (const budget of ["", "₹30 Lakh", "₹80 Lakhs and Above"]) {
        const invalidBudget = await request("/api/inquiry", {
            method: "POST",
            body: inquiryPayload({ budget })
        });
        assert.equal(invalidBudget.status, 400, `budget ${JSON.stringify(budget)} must be rejected`);
        assert.equal((await invalidBudget.json()).success, false);
    }

    const created = await request("/api/inquiry", {
        method: "POST",
        body: inquiryPayload()
    });
    assert.equal(created.status, 201);
    const payload = await created.json();
    assert.equal(payload.success, true);
    assert.ok(payload.inquiry.id > 0);

    const stored = db.prepare("SELECT * FROM inquiries WHERE id = ?").get(payload.inquiry.id);
    assert.equal(stored.name, "Test Enquiry - Integration");
    assert.equal(stored.project_name, "CMS Integration Project");
    assert.equal(stored.source_page, "/projects/cms-integration-project");
    assert.equal(stored.status, "new");
    assert.equal(stored.budget, "");

    const list = await request("/api/cms/admin/inquiries?search=Test+Enquiry+-+Integration", {
        authenticated: true
    });
    assert.equal(list.status, 200);
    const results = await list.json();
    assert.equal(results.total, 1);
    assert.equal(results.inquiries[0].id, payload.inquiry.id);
    assert.equal(results.inquiries[0].email, "enquiry-test@example.invalid");
    assert.equal(results.inquiries[0].budget, "");
    const summary = await request("/api/cms/admin/summary", { authenticated: true });
    assert.equal(summary.status, 200);
    assert.equal((await summary.json()).inquiries.new, 1);

    const update = await request(`/api/cms/admin/inquiries/${payload.inquiry.id}/status`, {
        method: "PATCH",
        authenticated: true,
        includeOrigin: true,
        body: { status: "contacted" }
    });
    assert.equal(update.status, 200);
    assert.equal(db.prepare("SELECT status FROM inquiries WHERE id = ?").get(payload.inquiry.id).status, "contacted");

    const rejectedStatus = await request(`/api/cms/admin/inquiries/${payload.inquiry.id}/status`, {
        method: "PATCH",
        authenticated: true,
        includeOrigin: true,
        body: { status: "deleted" }
    });
    assert.equal(rejectedStatus.status, 400);

    const popup = await request("/api/popupinquiry", {
        method: "POST",
        body: inquiryPayload({
            name: "Test Popup Enquiry",
            email: "",
            sourceForm: "Homepage popup",
            budget: allowedBudgets[0]
        })
    });
    assert.equal(popup.status, 201);
    const popupId = (await popup.json()).inquiry.id;
    assert.equal(db.prepare("SELECT source_form FROM inquiries WHERE id = ?").get(popupId).source_form, "Homepage popup");

    const budgetIds = [];
    for (const [index, budget] of allowedBudgets.entries()) {
        const response = await request("/api/inquiry", {
            method: "POST",
            body: inquiryPayload({
                name: `TEST ONLY - Budget option ${index + 1}`,
                email: "",
                budget
            })
        });
        assert.equal(response.status, 201);
        const { inquiry } = await response.json();
        budgetIds.push(inquiry.id);
        assert.equal(db.prepare("SELECT budget FROM inquiries WHERE id = ?").get(inquiry.id).budget, budget);
    }
    const cmsBudgets = await request("/api/cms/admin/inquiries?search=TEST+ONLY+-+Budget+option", {
        authenticated: true
    });
    assert.equal(cmsBudgets.status, 200);
    const savedBudgets = (await cmsBudgets.json()).inquiries.map(inquiry => inquiry.budget);
    assert.deepEqual(new Set(savedBudgets), new Set(allowedBudgets));

    db.prepare(`
        DELETE FROM inquiries
        WHERE id IN (${[payload.inquiry.id, popupId, ...budgetIds].map(() => "?").join(",")})
    `).run(payload.inquiry.id, popupId, ...budgetIds);
});

test("reports database write failures without returning a success response", async () => {
    db.exec(`
        CREATE TRIGGER test_inquiry_write_failure
        BEFORE INSERT ON inquiries
        BEGIN
            SELECT RAISE(FAIL, 'simulated test database failure');
        END;
    `);
    try {
        const response = await request("/api/inquiry", {
            method: "POST",
            body: inquiryPayload({ name: "TEST ONLY - simulated database failure" })
        });
        assert.equal(response.status, 500);
        const result = await response.json();
        assert.equal(result.success, false);
        assert.match(result.error, /Unable to save/);
    } finally {
        db.exec("DROP TRIGGER IF EXISTS test_inquiry_write_failure");
    }
});

test("rate limits public enquiry aliases without blocking CMS reads", async () => {
    const createdIds = [];
    for (let index = 0; index < 3; index += 1) {
        const response = await request(index % 2 ? "/api/popupinquiry" : "/api/inquiry", {
            method: "POST",
            body: inquiryPayload({
                name: `TEST ONLY - Rate limit ${index + 1}`,
                email: ""
            })
        });
        assert.equal(response.status, 201);
        createdIds.push((await response.json()).inquiry.id);
    }

    const rateLimited = await request("/api/popupinquiry", {
        method: "POST",
        body: inquiryPayload({ name: "TEST ONLY - Rate limit blocked", email: "" })
    });
    assert.equal(rateLimited.status, 429);
    assert.ok(Number(rateLimited.headers.get("retry-after")) > 0);
    assert.equal((await request("/api/cms/admin/summary", { authenticated: true })).status, 200);
    db.prepare(`
        DELETE FROM inquiries WHERE id IN (${createdIds.map(() => "?").join(",")})
    `).run(...createdIds);
});

test("serves the company PNG favicon from root, project, and admin pages", async () => {
    for (const pathname of ["/", "/about.html", "/projects.html", "/projects/heritage.html", "/admin/"]) {
        const page = await request(pathname);
        assert.equal(page.status, 200, pathname);
        assert.match(await page.text(), /<link rel="icon" type="image\/png" href="\/images\/logo\.png"/, pathname);
    }

    const favicon = await request("/images/logo.png");
    assert.equal(favicon.status, 200);
    assert.match(favicon.headers.get("content-type"), /image\/png/);
    assert.deepEqual(
        Buffer.from(await favicon.arrayBuffer()).subarray(0, 8),
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    );

    for (const [file, description] of [
        ["about.html", "Learn about Raj Real Estate"],
        ["projects.html", "Explore Raj Real Estate residential projects"],
        ["why-us.html", "See how Raj Real Estate helps buyers"],
        ["career.html", "Explore career opportunities at Raj Real Estate"],
        ["contact.html", "Contact Raj Real Estate"]
    ]) {
        const html = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
        assert.match(html, new RegExp(`<meta name="description" content="${description}`), file);
    }
    const privacy = fs.readFileSync(path.join(__dirname, "..", "privacypolicy.html"), "utf8");
    assert.match(privacy, /<link rel="canonical" href="https:\/\/rajrealestate\.co\/privacypolicy"/);
    const articleTemplate = fs.readFileSync(path.join(__dirname, "..", "blog-post.html"), "utf8");
    assert.match(articleTemplate, /<title>Real Estate Article \| Raj Real Estate<\/title>/);
    assert.match(articleTemplate, /property buying, and home ownership/);
});

test("authenticates same-origin admins and protects admin routes", async () => {
    const rejected = await request("/api/cms/auth/login", {
        method: "POST",
        body: { email: adminEmail, password: adminPassword }
    });
    assert.equal(rejected.status, 403);

    const invalidCredentials = await request("/api/cms/auth/login", {
        method: "POST",
        includeOrigin: true,
        body: { email: adminEmail, password: "incorrect-test-password" }
    });
    assert.equal(invalidCredentials.status, 401);
    assert.deepEqual(await invalidCredentials.json(), { error: "Email or password is incorrect." });

    const login = await request("/api/cms/auth/login", {
        method: "POST",
        includeOrigin: true,
        body: { email: adminEmail, password: adminPassword }
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    sessionCookie = cookie.split(";")[0];

    const session = await request("/api/cms/auth/session", { authenticated: true });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).admin.email, adminEmail);
});

test("expired login lockouts reset their failure counter", async () => {
    const invalidCredentials = { email: adminEmail, password: "incorrect-test-password" };
    const firstFailure = await request("/api/cms/auth/login", {
        method: "POST",
        includeOrigin: true,
        body: invalidCredentials
    });
    assert.equal(firstFailure.status, 401);

    const attempt = db.prepare(`
        SELECT address FROM cms_login_attempts ORDER BY updated_at DESC LIMIT 1
    `).get();
    assert.ok(attempt);
    db.prepare(`
        UPDATE cms_login_attempts
        SET attempts = 5, blocked_until = ?
        WHERE address = ?
    `).run(new Date(Date.now() + 60_000).toISOString(), attempt.address);

    const locked = await request("/api/cms/auth/login", {
        method: "POST",
        includeOrigin: true,
        body: invalidCredentials
    });
    assert.equal(locked.status, 429);

    db.prepare(`
        UPDATE cms_login_attempts SET blocked_until = ? WHERE address = ?
    `).run(new Date(Date.now() - 60_000).toISOString(), attempt.address);
    const afterExpiry = await request("/api/cms/auth/login", {
        method: "POST",
        includeOrigin: true,
        body: invalidCredentials
    });
    assert.equal(afterExpiry.status, 401);
    const resetAttempt = db.prepare(`
        SELECT attempts, blocked_until FROM cms_login_attempts WHERE address = ?
    `).get(attempt.address);
    assert.equal(resetAttempt.attempts, 1);
    assert.equal(resetAttempt.blocked_until, null);
    db.prepare("DELETE FROM cms_login_attempts WHERE address = ?").run(attempt.address);
});

test("creates, publishes, updates, and soft-deletes projects", async () => {
    const invalidCategory = await request("/api/cms/admin/projects", {
        method: "POST",
        authenticated: true,
        includeOrigin: true,
        body: projectPayload({ slug: "invalid-category", category: "other-city" })
    });
    assert.equal(invalidCategory.status, 400);

    const create = await request("/api/cms/admin/projects", {
        method: "POST",
        authenticated: true,
        includeOrigin: true,
        body: projectPayload()
    });
    assert.equal(create.status, 201);
    const created = (await create.json()).project;
    assert.equal(created.page_path, "/projects/cms-integration-project");
    assert.equal(created.status, "draft");
    assert.equal((await request("/api/cms/public/projects/cms-integration-project")).status, 404);
    assert.equal((await request("/projects/cms-integration-project.html")).status, 404);

    const update = await request("/api/cms/admin/projects/cms-integration-project", {
        method: "PUT",
        authenticated: true,
        includeOrigin: true,
        body: projectPayload({ status: "published", name: "Published CMS Project" })
    });
    assert.equal(update.status, 200);
    assert.equal((await update.json()).project.name, "Published CMS Project");
    assert.equal((await request("/api/cms/public/projects/cms-integration-project")).status, 200);
    assert.equal((await request("/projects/cms-integration-project.html")).status, 200);

    const deletion = await request("/api/cms/admin/projects/cms-integration-project", {
        method: "DELETE",
        authenticated: true,
        includeOrigin: true
    });
    assert.equal(deletion.status, 204);
    assert.equal((await request("/api/cms/public/projects/cms-integration-project")).status, 404);
});

test("updates page content and contact settings, and blocks unpublished pages", async () => {
    const page = db.prepare("SELECT content_json FROM cms_pages WHERE slug = 'about'").get();
    const content = JSON.parse(page.content_json);
    const key = Object.keys(content)[0];
    assert.ok(key, "the seeded About page should have editable content");
    content[key] = "Updated by CMS integration test";

    const updatePage = await request("/api/cms/admin/pages/about", {
        method: "PUT",
        authenticated: true,
        includeOrigin: true,
        body: {
            seoTitle: "Updated About",
            seoDescription: "Updated description",
            status: "draft",
            content
        }
    });
    assert.equal(updatePage.status, 200);
    assert.equal((await request("/api/cms/public/pages/about")).status, 404);
    assert.equal((await request("/about.html")).status, 404);

    const saveSettings = await request("/api/cms/admin/settings", {
        method: "PUT",
        authenticated: true,
        includeOrigin: true,
        body: {
            officeAddress: "Test office",
            phone: "+1 555 0100",
            whatsapp: "+1 555 0101",
            email: "office@example.com",
            businessHours: "Weekdays"
        }
    });
    assert.equal(saveSettings.status, 200);
    const readSettings = await request("/api/cms/public/settings");
    assert.equal((await readSettings.json()).settings.officeAddress, "Test office");

    const invalidOrigin = await request("/api/cms/admin/settings", {
        method: "PUT",
        authenticated: true,
        body: { officeAddress: "Should not save" }
    });
    assert.equal(invalidOrigin.status, 403);
});

test("rejects invalid image uploads and persists content across database reopen", async () => {
    const login = await request("/api/cms/auth/login", {
        method: "POST",
        includeOrigin: true,
        body: { email: adminEmail, password: adminPassword }
    });
    assert.equal(login.status, 200);
    sessionCookie = login.headers.get("set-cookie").split(";")[0];

    const form = new FormData();
    form.append("image", new Blob(["not an image"], { type: "image/png" }), "invalid.png");
    const upload = await request("/api/cms/admin/uploads", {
        method: "POST",
        authenticated: true,
        includeOrigin: true,
        body: form
    });
    assert.equal(upload.status, 400);

    const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/rZsAAAAASUVORK5CYII=",
        "base64"
    );
    const validForm = new FormData();
    validForm.append("image", new Blob([png], { type: "image/png" }), "valid.png");
    const validUpload = await request("/api/cms/admin/uploads", {
        method: "POST",
        authenticated: true,
        includeOrigin: true,
        body: validForm
    });
    assert.equal(validUpload.status, 201);
    const { image } = await validUpload.json();
    const storedImage = fs.readFileSync(path.join(process.env.CMS_UPLOAD_DIR, path.basename(image.url)));
    assert.deepEqual(storedImage, png);

    const postWithUpload = await request("/api/cms/admin/blog", {
        method: "POST",
        authenticated: true,
        includeOrigin: true,
        body: blogPayload({
            slug: "cms-uploaded-image-article",
            featuredImage: image.url
        })
    });
    assert.equal(postWithUpload.status, 201);
    assert.equal((await postWithUpload.json()).post.featured_image, image.url);
    const deletePost = await request("/api/cms/admin/blog/cms-uploaded-image-article", {
        method: "DELETE",
        authenticated: true,
        includeOrigin: true
    });
    assert.equal(deletePost.status, 204);

    const logout = await request("/api/cms/auth/logout", {
        method: "POST",
        authenticated: true,
        includeOrigin: true
    });
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
    assert.equal((await request("/api/cms/auth/session", { authenticated: true })).status, 401);

    const persistedCount = db.prepare("SELECT COUNT(*) AS count FROM cms_projects").get().count;
    db.close();
    databaseClosed = true;
    const reopenedDb = new DatabaseSync(databasePath);
    try {
        const reopenedCount = reopenedDb.prepare(
            "SELECT COUNT(*) AS count FROM cms_projects"
        ).get().count;
        assert.equal(reopenedCount, persistedCount);
    } finally {
        reopenedDb.close();
    }
});
