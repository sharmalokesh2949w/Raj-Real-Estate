const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");
const { blogDrafts, buildImportSql: buildBlogDraftImportSql } =
    require("../scripts/import-blog-drafts-to-d1");
const { collectStaticContent } = require("../scripts/import-static-content-to-d1");

const root = path.resolve(__dirname, "..");
const migrationPath = path.join(root, "migrations", "0001_cms_schema.sql");
const sheetsMigrationPath = path.join(root, "migrations", "0002_google_sheets_outbox.sql");
const d1CmsPath = path.join(root, "functions", "_shared", "d1-cms.mjs");

class LocalD1Statement {
    constructor(statement, values = []) {
        this.statement = statement;
        this.values = values;
    }

    bind(...values) {
        return new LocalD1Statement(this.statement, values);
    }

    async first(column) {
        const row = this.statement.get(...this.values) || null;
        return column && row ? row[column] ?? null : row;
    }

    async all() {
        return { success: true, results: this.statement.all(...this.values) };
    }

    async run() {
        const result = this.statement.run(...this.values);
        return {
            success: true,
            meta: {
                changes: Number(result.changes),
                last_row_id: Number(result.lastInsertRowid)
            }
        };
    }
}

class LocalD1 {
    constructor(database) {
        this.database = database;
    }

    prepare(sql) {
        return new LocalD1Statement(this.database.prepare(sql));
    }
}

async function loadPagesFunction(relativePath) {
    const sharedModule = pathToFileURL(d1CmsPath).href;
    const source = fs.readFileSync(path.join(root, relativePath), "utf8")
        .replaceAll("../_shared/d1-cms.mjs", sharedModule);
    const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
    return import(dataUrl);
}

function request(pathname, { method = "GET", body, headers = {}, origin = true } = {}) {
    const requestHeaders = new Headers(headers);
    if (origin) requestHeaders.set("origin", "https://local.pages.test");
    if (body !== undefined) {
        if (body instanceof FormData) {
            requestHeaders.delete("content-type");
        } else {
            requestHeaders.set("content-type", "application/json");
            body = JSON.stringify(body);
        }
    }
    return new Request(`https://local.pages.test${pathname}`, { method, headers: requestHeaders, body });
}

function blogPayload(overrides = {}) {
    return {
        slug: "local-d1-article",
        title: "Local D1 Article",
        excerpt: "An article created by the local D1-compatible test.",
        content: "First paragraph.\n\nSecond paragraph.",
        category: "Testing",
        featuredImage: "/images/heritage/1.png",
        publishedAt: "2026-11-04",
        status: "draft",
        ...overrides
    };
}

function projectPayload(overrides = {}) {
    return {
        slug: "local-d1-project",
        name: "Local D1 Project",
        category: "jaipur",
        locationLabel: "Jaipur",
        bannerLabel: "Jaipur",
        location: "Test location",
        summary: "Project created by the local D1-compatible test.",
        description: "Test project description.",
        pageTitle: "Local D1 Project",
        seoDescription: "Local test",
        cardImage: "/images/heritage/1.png",
        gallery: ["/images/heritage/1.png"],
        layoutImage: "",
        mapImage: "",
        amenities: [{ label: "Test amenity", icon: "bi-check-circle" }],
        videoUrl: "",
        featured: true,
        sortOrder: 1,
        status: "draft",
        ...overrides
    };
}

test("Pages Functions use the migrated schema and preserve CMS API behavior locally", async t => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "raj-pages-d1-"));
    const database = new DatabaseSync(path.join(temporaryDirectory, "test.sqlite"));
    const db = new LocalD1(database);
    const pagesApi = await loadPagesFunction(path.join("functions", "api", "[[path]].js"));
    const d1 = await import(pathToFileURL(d1CmsPath).href);
    const migration = fs.readFileSync(migrationPath, "utf8");
    const sheetsMigration = fs.readFileSync(sheetsMigrationPath, "utf8");
    database.exec("PRAGMA foreign_keys = ON");
    database.exec(migration);
    database.exec(sheetsMigration);

    t.after(() => {
        database.close();
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    });

    await t.test("migration creates the required D1 tables and indexes without touching platform tables", () => {
        const objects = database.prepare(`
            SELECT name, type FROM sqlite_master
            WHERE type IN ('table', 'index', 'trigger') AND name NOT LIKE 'sqlite_%'
            ORDER BY type, name
        `).all();
        const tableNames = objects.filter(item => item.type === "table").map(item => item.name);
        for (const table of [
            "admins",
            "cms_sessions",
            "cms_login_attempts",
            "cms_pages",
            "cms_projects",
            "cms_settings",
            "cms_blog_posts",
            "inquiries",
            "inquiry_rate_limits",
            "career_applications",
            "google_sheets_outbox"
        ]) {
            assert.ok(tableNames.includes(table), `missing table ${table}`);
        }
        assert.equal(tableNames.includes("_cf_KV"), false);
        assert.ok(objects.some(item => item.name === "cms_blog_posts_public_order"));
        assert.ok(objects.some(item => item.name === "cms_projects_public_order"));
        assert.ok(objects.some(item => item.name === "inquiries_google_sheets_outbox_insert"));
        assert.ok(objects.some(item => item.name === "career_applications_google_sheets_outbox_insert"));
    });

    await t.test("public blog/project APIs return only their own published records", async () => {
        const now = new Date().toISOString();
        database.prepare(`
            INSERT INTO cms_blog_posts
                (slug, title, excerpt, content, category, featured_image, published_at, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)
        `).run(
            "verified-blog-post", "Verified Blog", "Blog excerpt", "Blog content", "Testing",
            "/images/heritage/1.png", "2026-11-04", now, now
        );
        database.prepare(`
            INSERT INTO cms_projects
                (slug, name, page_path, status, updated_at)
            VALUES (?, ?, ?, 'published', ?)
        `).run("verified-project", "Verified Project", "/projects/verified-project.html", now);

        const blogResponse = await pagesApi.onRequest({
            request: request("/api/cms/public/blog"),
            env: { DB: db, CLOUDINARY_CLOUD_NAME: "rajtest" }
        });
        const blog = await blogResponse.json();
        assert.equal(blogResponse.status, 200);
        assert.deepEqual(blog.posts.map(post => post.slug), ["verified-blog-post"]);
        assert.equal(blog.cloudinaryCloudName, "rajtest");

        const projectResponse = await pagesApi.onRequest({
            request: request("/api/cms/public/projects"),
            env: { DB: db, CLOUDINARY_CLOUD_NAME: "rajtest" }
        });
        const projects = await projectResponse.json();
        assert.equal(projectResponse.status, 200);
        assert.equal(projects.projects[0].slug, "verified-project");
        assert.equal(projects.cloudinaryCloudName, "rajtest");
        assert.deepEqual(projects.projects[0].gallery, []);
        assert.equal(projects.projects[0].page_path, "/projects/verified-project");

        const blogMissing = await pagesApi.onRequest({
            request: request("/api/cms/public/blog/not-a-project"),
            env: { DB: db }
        });
        const projectMissing = await pagesApi.onRequest({
            request: request("/api/cms/public/projects/not-a-blog"),
            env: { DB: db }
        });
        assert.equal(blogMissing.status, 404);
        assert.equal(projectMissing.status, 404);
    });

    await t.test("all recovered projects return complete published detail API responses", async () => {
        const projects = collectStaticContent().projects;
        const now = new Date().toISOString();
        const insert = database.prepare(`
            INSERT INTO cms_projects (
                slug, name, category, location_label, banner_label, location, summary, description,
                page_title, seo_description, card_image, gallery_json, layout_image, map_image,
                amenities_json, video_url, page_path, featured, sort_order, status, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)
        `);
        const remove = database.prepare("DELETE FROM cms_projects WHERE slug = ?");

        try {
            for (const project of projects) {
                insert.run(
                    project.slug, project.name, project.category, project.location_label, project.banner_label,
                    project.location, project.summary, project.description, project.page_title,
                    project.seo_description, project.card_image, project.gallery_json, project.layout_image,
                    project.map_image, project.amenities_json, project.video_url, project.page_path,
                    Number(project.featured), project.sort_order, now
                );
            }

            for (const source of projects) {
                const response = await pagesApi.onRequest({
                    request: request(`/api/cms/public/projects/${encodeURIComponent(source.slug)}`),
                    env: { DB: db }
                });
                assert.equal(response.status, 200, source.slug);
                const { project } = await response.json();
                assert.equal(project.slug, source.slug);
                assert.equal(project.description, source.description);
                assert.deepEqual(project.gallery, JSON.parse(source.gallery_json));
                assert.deepEqual(project.amenities, JSON.parse(source.amenities_json));
                assert.equal(project.map_image, source.map_image);
                assert.equal(project.page_path, `/projects/${source.slug}`);
            }
        } finally {
            for (const project of projects) remove.run(project.slug);
        }
    });

    await t.test("bootstrap creates a PBKDF2 admin once and protected APIs require a session", async () => {
        const bootstrapToken = "local-test-bootstrap-token-that-is-long-enough";
        const bootstrap = await pagesApi.onRequest({
            request: request("/api/cms/auth/bootstrap", {
                method: "POST",
                headers: { authorization: `Bearer ${bootstrapToken}` },
                body: { email: "local-admin@example.test", password: "local-test-password-2026" }
            }),
            env: { DB: db, ADMIN_BOOTSTRAP_TOKEN: bootstrapToken }
        });
        assert.equal(bootstrap.status, 201);

        const admin = database.prepare("SELECT * FROM admins WHERE email = ?")
            .get("local-admin@example.test");
        assert.equal(admin.password_algorithm, "pbkdf2-sha256");
        assert.ok(admin.password_iterations >= 600_000);
        assert.notEqual(admin.password_hash, "local-test-password-2026");
        assert.notEqual(admin.password_salt, "local-test-password-2026");

        const secondBootstrap = await pagesApi.onRequest({
            request: request("/api/cms/auth/bootstrap", {
                method: "POST",
                headers: { authorization: `Bearer ${bootstrapToken}` },
                body: { email: "another-admin@example.test", password: "another-test-password" }
            }),
            env: { DB: db, ADMIN_BOOTSTRAP_TOKEN: bootstrapToken }
        });
        assert.equal(secondBootstrap.status, 409);

        const missingOrigin = await pagesApi.onRequest({
            request: request("/api/cms/auth/bootstrap", {
                method: "POST",
                headers: { authorization: `Bearer ${bootstrapToken}` },
                body: { email: "bad-origin@example.test", password: "another-test-password" },
                origin: false
            }),
            env: { DB: db, ADMIN_BOOTSTRAP_TOKEN: bootstrapToken }
        });
        assert.equal(missingOrigin.status, 403);

        const login = await pagesApi.onRequest({
            request: request("/api/cms/auth/login", {
                method: "POST",
                body: { email: "local-admin@example.test", password: "local-test-password-2026" }
            }),
            env: { DB: db }
        });
        assert.equal(login.status, 200);
        const cookie = login.headers.get("set-cookie");
        assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
        const sessionCookie = cookie.split(";", 1)[0];

        const session = await pagesApi.onRequest({
            request: request("/api/cms/auth/session", { headers: { cookie: sessionCookie } }),
            env: { DB: db }
        });
        assert.equal(session.status, 200);
        assert.equal((await session.json()).admin.email, "local-admin@example.test");

        const unauthenticated = await pagesApi.onRequest({
            request: request("/api/cms/admin/summary"),
            env: { DB: db }
        });
        assert.equal(unauthenticated.status, 401);

        const badPassword = await pagesApi.onRequest({
            request: request("/api/cms/auth/login", {
                method: "POST",
                headers: { "cf-connecting-ip": "203.0.113.57" },
                body: { email: "local-admin@example.test", password: "incorrect-password" }
            }),
            env: { DB: db }
        });
        assert.equal(badPassword.status, 401);
        assert.equal(database.prepare("SELECT attempts FROM cms_login_attempts WHERE address = ?")
            .get(createHash("sha256").update("203.0.113.57").digest("hex")).attempts, 1);

        const blockedAddress = "203.0.113.56";
        database.prepare(`
            INSERT INTO cms_login_attempts (address, attempts, blocked_until, updated_at)
            VALUES (?, 5, ?, ?)
        `).run(
            createHash("sha256").update(blockedAddress).digest("hex"),
            new Date(Date.now() + 15 * 60 * 1000).toISOString(),
            new Date().toISOString()
        );
        const blockedLogin = await pagesApi.onRequest({
            request: request("/api/cms/auth/login", {
                method: "POST",
                headers: { "cf-connecting-ip": blockedAddress },
                body: { email: "local-admin@example.test", password: "local-test-password-2026" }
            }),
            env: { DB: db }
        });
        assert.equal(blockedLogin.status, 429);

        const logout = await pagesApi.onRequest({
            request: request("/api/cms/auth/logout", {
                method: "POST",
                headers: { cookie: sessionCookie }
            }),
            env: { DB: db }
        });
        assert.equal(logout.status, 204);
        const expiredSession = await pagesApi.onRequest({
            request: request("/api/cms/auth/session", { headers: { cookie: sessionCookie } }),
            env: { DB: db }
        });
        assert.equal(expiredSession.status, 401);

        return { sessionCookie };
    });

    const bootstrapToken = "local-test-bootstrap-token-that-is-long-enough";
    await pagesApi.onRequest({
        request: request("/api/cms/auth/bootstrap", {
            method: "POST",
            headers: { authorization: `Bearer ${bootstrapToken}` },
            body: { email: "local-admin@example.test", password: "local-test-password-2026" }
        }),
        env: { DB: db, ADMIN_BOOTSTRAP_TOKEN: bootstrapToken }
    });
    const login = await pagesApi.onRequest({
        request: request("/api/cms/auth/login", {
            method: "POST",
            body: { email: "local-admin@example.test", password: "local-test-password-2026" }
        }),
        env: { DB: db }
    });
    const cookie = login.headers.get("set-cookie").split(";", 1)[0];
    const authHeaders = { cookie };

    await t.test("CMS dashboard list endpoints return the shapes used by the admin UI", async () => {
        const cases = [
            ["/api/cms/admin/summary", body => {
                assert.ok(body.projects);
                assert.ok(body.pages);
                assert.ok(body.blog);
                assert.ok(body.inquiries);
            }],
            ["/api/cms/admin/inquiries?page=1&status=all", body => {
                assert.deepEqual(body.inquiries, []);
                assert.equal(body.total, 0);
                assert.equal(body.page, 1);
            }],
            ["/api/cms/admin/projects?page=1&status=all", body => {
                assert.ok(Array.isArray(body.projects));
                assert.equal(body.total, body.projects.length);
            }],
            ["/api/cms/admin/blog", body => assert.ok(Array.isArray(body.posts))],
            ["/api/cms/admin/pages", body => assert.deepEqual(body.pages, [])],
            ["/api/cms/admin/settings", body => assert.deepEqual(body.settings, {})]
        ];

        for (const [pathname, assertShape] of cases) {
            const response = await pagesApi.onRequest({
                request: request(pathname, { headers: authHeaders }),
                env: { DB: db }
            });
            assert.equal(response.status, 200, pathname);
            assertShape(await response.json());
        }
    });

    await t.test("CMS lists and reopens all recovered projects and safely saves original project content", async () => {
        const projects = collectStaticContent().projects;
        const now = new Date().toISOString();
        const existingProjectCount = database.prepare("SELECT COUNT(*) AS count FROM cms_projects").get().count;
        const insert = database.prepare(`
            INSERT INTO cms_projects (
                slug, name, category, location_label, banner_label, location, summary, description,
                page_title, seo_description, card_image, gallery_json, layout_image, map_image,
                amenities_json, video_url, page_path, featured, sort_order, status, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)
        `);
        const remove = database.prepare("DELETE FROM cms_projects WHERE slug = ?");

        try {
            for (const project of projects) {
                insert.run(
                    project.slug, project.name, project.category, project.location_label, project.banner_label,
                    project.location, project.summary, project.description, project.page_title,
                    project.seo_description, project.card_image, project.gallery_json, project.layout_image,
                    project.map_image, project.amenities_json, project.video_url, project.page_path,
                    Number(project.featured), project.sort_order, now
                );
            }

            const listResponse = await pagesApi.onRequest({
                request: request("/api/cms/admin/projects?page=1&status=all", { headers: authHeaders }),
                env: { DB: db }
            });
            assert.equal(listResponse.status, 200);
            const projectList = await listResponse.json();
            assert.equal(projectList.total, existingProjectCount + 11);
            const listedProjects = [...projectList.projects];
            for (let page = 2; page <= projectList.pages; page += 1) {
                const pageResponse = await pagesApi.onRequest({
                    request: request(`/api/cms/admin/projects?page=${page}&status=all`, { headers: authHeaders }),
                    env: { DB: db }
                });
                assert.equal(pageResponse.status, 200);
                listedProjects.push(...(await pageResponse.json()).projects);
            }
            assert.ok(projects.every(source => listedProjects.some(project => project.slug === source.slug)));

            const source = projects.find(project => project.slug === "heritage");
            const editResponse = await pagesApi.onRequest({
                request: request(`/api/cms/admin/projects/${source.slug}`, { headers: authHeaders }),
                env: { DB: db }
            });
            assert.equal(editResponse.status, 200);
            const { project: editableProject } = await editResponse.json();
            assert.equal(editableProject.description, source.description);
            assert.deepEqual(editableProject.gallery, JSON.parse(source.gallery_json));
            assert.deepEqual(editableProject.amenities, JSON.parse(source.amenities_json));
            assert.equal(editableProject.layout_image, source.layout_image);
            assert.equal(editableProject.map_image, source.map_image);

            const saveResponse = await pagesApi.onRequest({
                request: request(`/api/cms/admin/projects/${source.slug}`, {
                    method: "PUT",
                    headers: authHeaders,
                    body: {
                        slug: editableProject.slug,
                        name: editableProject.name,
                        category: editableProject.category,
                        locationLabel: editableProject.location_label,
                        bannerLabel: editableProject.banner_label,
                        location: editableProject.location,
                        summary: editableProject.summary,
                        description: editableProject.description,
                        pageTitle: editableProject.page_title,
                        seoDescription: editableProject.seo_description,
                        cardImage: editableProject.card_image,
                        gallery: editableProject.gallery,
                        layoutImage: editableProject.layout_image,
                        mapImage: editableProject.map_image,
                        amenities: editableProject.amenities,
                        videoUrl: editableProject.video_url,
                        featured: editableProject.featured,
                        sortOrder: editableProject.sort_order,
                        status: editableProject.status
                    }
                }),
                env: { DB: db }
            });
            assert.equal(saveResponse.status, 200);

            const refreshedResponse = await pagesApi.onRequest({
                request: request(`/api/cms/admin/projects/${source.slug}`, { headers: authHeaders }),
                env: { DB: db }
            });
            assert.equal(refreshedResponse.status, 200);
            const { project: refreshedProject } = await refreshedResponse.json();
            assert.equal(refreshedProject.description, source.description);
            assert.deepEqual(refreshedProject.gallery, JSON.parse(source.gallery_json));
            assert.deepEqual(refreshedProject.amenities, JSON.parse(source.amenities_json));
            assert.equal(refreshedProject.layout_image, source.layout_image);
            assert.equal(refreshedProject.map_image, source.map_image);
        } finally {
            for (const project of projects) remove.run(project.slug);
        }
    });

    await t.test("imported blog drafts load in CMS and become public only after publishing", async () => {
        database.exec(buildBlogDraftImportSql());

        const adminResponse = await pagesApi.onRequest({
            request: request("/api/cms/admin/blog", { headers: authHeaders }),
            env: { DB: db }
        });
        assert.equal(adminResponse.status, 200);
        const adminPosts = (await adminResponse.json()).posts;
        assert.deepEqual(
            adminPosts.filter(post => blogDrafts.some(draft => draft.slug === post.slug))
                .map(post => [post.slug, post.status])
                .sort((left, right) => left[0].localeCompare(right[0])),
            blogDrafts.map(post => [post.slug, "draft"])
                .sort((left, right) => left[0].localeCompare(right[0]))
        );

        const publicBeforePublish = await pagesApi.onRequest({
            request: request("/api/cms/public/blog"),
            env: { DB: db }
        });
        assert.deepEqual(
            (await publicBeforePublish.json()).posts.map(post => post.slug),
            ["verified-blog-post"]
        );

        const draft = blogDrafts[0];
        const publish = await pagesApi.onRequest({
            request: request(`/api/cms/admin/blog/${encodeURIComponent(draft.slug)}`, {
                method: "PUT",
                headers: authHeaders,
                body: {
                    slug: draft.slug,
                    title: draft.title,
                    excerpt: draft.excerpt,
                    content: draft.content,
                    category: draft.category,
                    featuredImage: draft.featuredImage,
                    publishedAt: draft.publishedAt,
                    status: "published"
                }
            }),
            env: { DB: db }
        });
        assert.equal(publish.status, 200);

        const publicAfterPublish = await pagesApi.onRequest({
            request: request("/api/cms/public/blog"),
            env: { DB: db }
        });
        const publicPosts = (await publicAfterPublish.json()).posts;
        assert.deepEqual(
            publicPosts.map(post => post.slug).sort(),
            ["verified-blog-post", draft.slug].sort()
        );
        assert.equal(publicPosts.find(post => post.slug === draft.slug).title, draft.title);

        const publicArticle = await pagesApi.onRequest({
            request: request(`/api/cms/public/blog/${encodeURIComponent(draft.slug)}`),
            env: { DB: db }
        });
        assert.equal(publicArticle.status, 200);
        assert.equal((await publicArticle.json()).post.content, draft.content);
    });

    await t.test("blog create, publish, update, validation and delete work", async () => {
        const create = await pagesApi.onRequest({
            request: request("/api/cms/admin/blog", {
                method: "POST", headers: authHeaders, body: blogPayload()
            }),
            env: { DB: db }
        });
        assert.equal(create.status, 201);
        assert.equal((await create.json()).post.status, "draft");

        const invalidImage = await pagesApi.onRequest({
            request: request("/api/cms/admin/blog", {
                method: "POST",
                headers: authHeaders,
                body: blogPayload({ slug: "invalid-image", featuredImage: "https://example.test/image.png" })
            }),
            env: { DB: db }
        });
        assert.equal(invalidImage.status, 400);
        for (const [index, featuredImage] of [
            "javascript:alert(1)",
            "data:image/png;base64,AAAA",
            "//res.cloudinary.com/rajtest/image/upload/photo.png",
            "https://res.cloudinary.com.evil.example/rajtest/image/upload/photo.png",
            "https://res.cloudinary.com/another-cloud/image/upload/photo.png"
        ].entries()) {
            const rejectedUrl = await pagesApi.onRequest({
                request: request("/api/cms/admin/blog", {
                    method: "POST",
                    headers: authHeaders,
                    body: blogPayload({ slug: `invalid-url-${index}`, featuredImage })
                }),
                env: { DB: db, CLOUDINARY_CLOUD_NAME: "rajtest" }
            });
            assert.equal(rejectedUrl.status, 400);
        }

        const cloudinaryUrl = "https://res.cloudinary.com/rajtest/image/upload/v1234/featured.png";
        const cloudinaryPost = await pagesApi.onRequest({
            request: request("/api/cms/admin/blog", {
                method: "POST",
                headers: authHeaders,
                body: blogPayload({ slug: "cloudinary-image-article", featuredImage: cloudinaryUrl })
            }),
            env: { DB: db, CLOUDINARY_CLOUD_NAME: "rajtest" }
        });
        assert.equal(cloudinaryPost.status, 201);
        assert.equal((await cloudinaryPost.json()).post.featured_image, cloudinaryUrl);

        const localImage = await pagesApi.onRequest({
            request: request("/api/cms/admin/blog", {
                method: "POST",
                headers: authHeaders,
                body: blogPayload({ slug: "existing-local-image", featuredImage: "/images/heritage/1.png" })
            }),
            env: {
                DB: db,
                ASSETS: { fetch: async () => new Response(null, {
                    status: 200,
                    headers: { "content-type": "image/png" }
                }) }
            }
        });
        assert.equal(localImage.status, 201);

        const missingSiteImage = await pagesApi.onRequest({
            request: request("/api/cms/admin/blog", {
                method: "POST",
                headers: authHeaders,
                body: blogPayload({ slug: "missing-image", featuredImage: "/images/not-found.png" })
            }),
            env: {
                DB: db,
                ASSETS: { fetch: async () => new Response(null, { status: 404 }) }
            }
        });
        assert.equal(missingSiteImage.status, 400);

        const duplicate = await pagesApi.onRequest({
            request: request("/api/cms/admin/blog", {
                method: "POST", headers: authHeaders, body: blogPayload()
            }),
            env: { DB: db }
        });
        assert.equal(duplicate.status, 409);

        const publish = await pagesApi.onRequest({
            request: request("/api/cms/admin/blog/local-d1-article", {
                method: "PUT",
                headers: authHeaders,
                body: blogPayload({ status: "published" })
            }),
            env: { DB: db }
        });
        assert.equal(publish.status, 200);
        const publicPost = await pagesApi.onRequest({
            request: request("/api/cms/public/blog/local-d1-article"),
            env: { DB: db }
        });
        assert.equal(publicPost.status, 200);
        assert.equal((await publicPost.json()).post.slug, "local-d1-article");

        const missing = await pagesApi.onRequest({
            request: request("/api/cms/admin/blog/not-found", {
                method: "PUT", headers: authHeaders, body: blogPayload()
            }),
            env: { DB: db }
        });
        assert.equal(missing.status, 404);

        const deletion = await pagesApi.onRequest({
            request: request("/api/cms/admin/blog/local-d1-article", {
                method: "DELETE", headers: authHeaders
            }),
            env: { DB: db }
        });
        assert.equal(deletion.status, 204);
    });

    await t.test("Cloudinary uploads enforce admin sessions, configuration, file limits, and signed upload behavior", async () => {
        const uploadPath = "/api/cms/admin/uploads";
        const uploadEnv = {
            DB: db,
            CLOUDINARY_CLOUD_NAME: "rajtest",
            CLOUDINARY_API_KEY: "test-api-key",
            CLOUDINARY_API_SECRET: "test-api-secret"
        };
        const invalidSession = await pagesApi.onRequest({
            request: request(uploadPath, {
                method: "POST",
                headers: { cookie: "raj_cms_session=not-a-valid-session" },
                body: new FormData()
            }),
            env: uploadEnv
        });
        assert.equal(invalidSession.status, 401);
        const crossOrigin = await pagesApi.onRequest({
            request: request(uploadPath, {
                method: "POST",
                headers: {
                    ...authHeaders,
                    origin: "https://attacker.example"
                },
                origin: false,
                body: new FormData()
            }),
            env: uploadEnv
        });
        assert.equal(crossOrigin.status, 403);

        const expiredToken = "expired-cloudinary-upload-session";
        const adminId = database.prepare("SELECT id FROM admins LIMIT 1").get().id;
        database.prepare(`
            INSERT INTO cms_sessions (token_hash, admin_id, expires_at, created_at)
            VALUES (?, ?, ?, ?)
        `).run(
            createHash("sha256").update(expiredToken).digest("hex"),
            adminId,
            new Date(Date.now() - 60_000).toISOString(),
            new Date().toISOString()
        );
        const expiredSession = await pagesApi.onRequest({
            request: request(uploadPath, {
                method: "POST",
                headers: { cookie: `raj_cms_session=${expiredToken}` },
                body: new FormData()
            }),
            env: uploadEnv
        });
        assert.equal(expiredSession.status, 401);

        const missingConfigForm = new FormData();
        missingConfigForm.append("image", new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], {
            type: "image/png"
        }), "image.png");
        const missingConfig = await pagesApi.onRequest({
            request: request(uploadPath, {
                method: "POST", headers: authHeaders, body: missingConfigForm
            }),
            env: { DB: db }
        });
        assert.equal(missingConfig.status, 503);

        const unsupportedForm = new FormData();
        unsupportedForm.append("image", new Blob([new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])], {
            type: "image/gif"
        }), "image.gif");
        const unsupported = await pagesApi.onRequest({
            request: request(uploadPath, {
                method: "POST", headers: authHeaders, body: unsupportedForm
            }),
            env: uploadEnv
        });
        assert.equal(unsupported.status, 400);

        const invalidForm = new FormData();
        invalidForm.append("image", new Blob(["not an image"], { type: "image/png" }), "fake.png");
        const invalidContent = await pagesApi.onRequest({
            request: request(uploadPath, {
                method: "POST", headers: authHeaders, body: invalidForm
            }),
            env: uploadEnv
        });
        assert.equal(invalidContent.status, 400);

        const oversizedForm = new FormData();
        oversizedForm.append("image", new Blob([
            new Uint8Array(5 * 1024 * 1024 + 1)
        ], { type: "image/png" }), "large.png");
        const oversized = await pagesApi.onRequest({
            request: request(uploadPath, {
                method: "POST", headers: authHeaders, body: oversizedForm
            }),
            env: uploadEnv
        });
        assert.equal(oversized.status, 413);

        const png = new Uint8Array([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            0x00, 0x00, 0x00, 0x00
        ]);
        const successForm = new FormData();
        successForm.append("image", new Blob([png], { type: "image/png" }), "test.png");
        const originalFetch = global.fetch;
        let capturedUpload;
        global.fetch = async (input, init) => {
            assert.equal(input, "https://api.cloudinary.com/v1_1/rajtest/image/upload");
            const body = await new Request(input, init).formData();
            capturedUpload = {
                apiKey: body.get("api_key"),
                signature: body.get("signature"),
                folder: body.get("folder"),
                timestamp: body.get("timestamp"),
                file: body.get("file"),
                secretIncluded: [...body.keys()].includes("api_secret")
            };
            return Response.json({
                secure_url: "https://res.cloudinary.com/rajtest/image/upload/v1234/upload-test.png"
            });
        };
        try {
            const uploaded = await pagesApi.onRequest({
                request: request(uploadPath, {
                    method: "POST", headers: authHeaders, body: successForm
                }),
                env: uploadEnv
            });
            assert.equal(uploaded.status, 201);
            assert.deepEqual(await uploaded.json(), {
                image: {
                    url: "https://res.cloudinary.com/rajtest/image/upload/v1234/upload-test.png",
                    format: "png",
                    bytes: png.byteLength
                }
            });
            assert.equal(capturedUpload.apiKey, "test-api-key");
            assert.equal(capturedUpload.signature, createHash("sha1")
                .update(`folder=raj-real-estate/cms&timestamp=${capturedUpload.timestamp}test-api-secret`)
                .digest("hex"));
            assert.equal(capturedUpload.folder, "raj-real-estate/cms");
            assert.ok(capturedUpload.timestamp);
            assert.equal(capturedUpload.file.type, "image/png");
            assert.equal(capturedUpload.secretIncluded, false);
        } finally {
            global.fetch = originalFetch;
        }

        const failedForm = new FormData();
        failedForm.append("image", new Blob([png], { type: "image/png" }), "failure.png");
        global.fetch = async () => new Response("unavailable", { status: 401 });
        try {
            const failedUpload = await pagesApi.onRequest({
                request: request(uploadPath, {
                    method: "POST", headers: authHeaders, body: failedForm
                }),
                env: uploadEnv
            });
            assert.equal(failedUpload.status, 502);
            assert.deepEqual(await failedUpload.json(), {
                error: "The image could not be uploaded. Please try again."
            });
        } finally {
            global.fetch = originalFetch;
        }
    });

    await t.test("project CRUD, soft deletion, page/settings and inquiries are persisted", async () => {
        const projectCreate = await pagesApi.onRequest({
            request: request("/api/cms/admin/projects", {
                method: "POST",
                headers: authHeaders,
                body: projectPayload({
                    cardImage: "https://res.cloudinary.com/rajtest/image/upload/v1234/project.png",
                    gallery: ["https://res.cloudinary.com/rajtest/image/upload/v1234/project.png"]
                })
            }),
            env: { DB: db, CLOUDINARY_CLOUD_NAME: "rajtest" }
        });
        assert.equal(projectCreate.status, 201);
        const createdProject = (await projectCreate.json()).project;
        assert.equal(createdProject.page_path, "/projects/local-d1-project");
        assert.equal(createdProject.featured, true);
        assert.equal(createdProject.card_image, "https://res.cloudinary.com/rajtest/image/upload/v1234/project.png");
        assert.deepEqual(createdProject.gallery, [
            "https://res.cloudinary.com/rajtest/image/upload/v1234/project.png"
        ]);

        const projectUpdate = await pagesApi.onRequest({
            request: request("/api/cms/admin/projects/local-d1-project", {
                method: "PUT",
                headers: authHeaders,
                body: projectPayload({ status: "published", name: "Updated Local Project" })
            }),
            env: { DB: db }
        });
        assert.equal((await projectUpdate.json()).project.name, "Updated Local Project");

        const projectDelete = await pagesApi.onRequest({
            request: request("/api/cms/admin/projects/local-d1-project", {
                method: "DELETE", headers: authHeaders
            }),
            env: { DB: db }
        });
        assert.equal(projectDelete.status, 204);
        const hiddenProject = await pagesApi.onRequest({
            request: request("/api/cms/public/projects/local-d1-project"),
            env: { DB: db }
        });
        assert.equal(hiddenProject.status, 404);

        database.prepare(`
            INSERT INTO cms_pages
                (slug, path, label, title, seo_title, content_json, status, updated_at)
            VALUES ('home', '/', 'Home', 'Home', 'Home SEO', '{"headline":"Welcome"}', 'published', ?)
        `).run(new Date().toISOString());
        const pageUpdate = await pagesApi.onRequest({
            request: request("/api/cms/admin/pages/home", {
                method: "PUT",
                headers: authHeaders,
                body: {
                    seoTitle: "Updated Home",
                    seoDescription: "Updated description",
                    status: "published",
                    content: { headline: "Updated welcome" }
                }
            }),
            env: { DB: db }
        });
        assert.equal(pageUpdate.status, 200);
        assert.equal((await pageUpdate.json()).page.content.headline, "Updated welcome");

        const settingsUpdate = await pagesApi.onRequest({
            request: request("/api/cms/admin/settings", {
                method: "PUT",
                headers: authHeaders,
                body: {
                    officeAddress: "Jaipur",
                    phone: "+91 1234567890",
                    whatsapp: "",
                    email: "office@example.test",
                    businessHours: "Mon-Fri"
                }
            }),
            env: { DB: db }
        });
        assert.equal(settingsUpdate.status, 200);
        const settings = await pagesApi.onRequest({
            request: request("/api/cms/public/settings"),
            env: { DB: db }
        });
        assert.equal((await settings.json()).settings.officeAddress, "Jaipur");

        const inquiry = await pagesApi.onRequest({
            request: request("/api/inquiry", {
                method: "POST",
                headers: { "cf-connecting-ip": "198.51.100.10" },
                body: {
                    name: "Local Test Enquiry",
                    phone: "9876543210",
                    email: "lead@example.test",
                    message: "Testing persistence",
                    budget: "₹40–60 Lakh",
                    sourceForm: "D1 test",
                    sourcePage: "/contact"
                }
            }),
            env: { DB: db }
        });
        assert.equal(inquiry.status, 201);
        const inquiryData = await inquiry.json();
        assert.equal(inquiryData.success, true);
        assert.equal(database.prepare("SELECT status FROM inquiries WHERE id = ?")
            .get(inquiryData.inquiry.id).status, "new");

        const badInquiry = await pagesApi.onRequest({
            request: request("/api/popupinquiry", {
                method: "POST",
                headers: { "cf-connecting-ip": "198.51.100.11" },
                body: { name: "", phone: "x" }
            }),
            env: { DB: db }
        });
        assert.equal(badInquiry.status, 400);

        let lastRateResponse;
        for (let attempt = 1; attempt <= 16; attempt += 1) {
            lastRateResponse = await pagesApi.onRequest({
                request: request("/api/inquiry", {
                    method: "POST",
                    headers: { "cf-connecting-ip": "198.51.100.15" },
                    body: {
                        name: `Rate Test ${attempt}`,
                        phone: "9876543210",
                        sourcePage: "/contact"
                    }
                }),
                env: { DB: db }
            });
            assert.equal(lastRateResponse.status, attempt <= 15 ? 201 : 429);
        }
    });

    await t.test("local project/blog URL Functions keep routes distinct", async () => {
        const now = new Date().toISOString();
        database.prepare(`
            INSERT INTO cms_blog_posts
                (slug, title, excerpt, content, category, featured_image, published_at, status, created_at, updated_at)
            VALUES ('route-blog-post', 'Route Blog', 'Excerpt', 'Content', 'Testing',
                    '/images/heritage/1.png', '2026-11-04', 'published', ?, ?)
        `).run(now, now);
        database.prepare(`
            INSERT INTO cms_projects (slug, name, page_path, status, updated_at)
            VALUES ('route-project', 'Route Project', '/projects/route-project.html', 'published', ?)
        `).run(now);
        database.prepare(`
            INSERT INTO cms_projects (slug, name, page_path, status, updated_at)
            VALUES ('cms-only-project', 'CMS Only Project', '/projects/cms-only-project', 'published', ?)
        `).run(now);
        database.prepare(`
            INSERT INTO cms_blog_posts
                (slug, title, excerpt, content, category, featured_image, published_at, status, created_at, updated_at)
            VALUES ('route-blog-draft', 'Private Draft', 'Draft excerpt', 'Draft content', 'Testing',
                    '/images/heritage/1.png', '2026-11-04', 'draft', ?, ?)
        `).run(now, now);
        assert.equal(fs.existsSync(path.join(root, "functions", "blog", "[[slug]].js")), false);
        assert.equal(fs.existsSync(path.join(root, "functions", "projects", "[[slug]].js")), false);
        const blogRoute = await loadPagesFunction(path.join("functions", "blog", "[slug].js"));
        const projectRoute = await loadPagesFunction(path.join("functions", "projects", "[slug].js"));
        const assetPaths = [];
        const env = {
            DB: db,
            ASSETS: {
                async fetch(assetRequest) {
                    const pathname = new URL(assetRequest.url).pathname;
                    assetPaths.push(pathname);
                    return pathname === "/blog-post" || pathname === "/cms/project-template"
                        ? new Response(`template:${pathname}`)
                        : new Response("Not found", { status: 404 });
                }
            }
        };

        const article = await blogRoute.onRequestGet({
            request: new Request("https://local.pages.test/blog/route-blog-post"),
            env
        });
        assert.equal(article.status, 200);
        assert.match(await article.text(), /blog-post/);
        const refreshedArticle = await blogRoute.onRequestGet({
            request: new Request("https://local.pages.test/blog/route-blog-post"),
            env
        });
        assert.equal(refreshedArticle.status, 200);

        const wrongBlog = await blogRoute.onRequestGet({
            request: new Request("https://local.pages.test/blog/route-project"),
            env
        });
        assert.equal(wrongBlog.status, 404);
        const privateBlog = await blogRoute.onRequestGet({
            request: new Request("https://local.pages.test/blog/route-blog-draft"),
            env
        });
        assert.equal(privateBlog.status, 404);

        const project = await projectRoute.onRequestGet({
            request: new Request("https://local.pages.test/projects/route-project"),
            env
        });
        assert.equal(project.status, 200);
        assert.match(await project.text(), /cms\/project-template/);
        assert.ok(assetPaths.includes("/cms/project-template"));
        assert.equal(assetPaths.includes("/projects/route-project.html"), false);

        const cmsOnlyProject = await projectRoute.onRequestGet({
            request: new Request("https://local.pages.test/projects/cms-only-project"),
            env
        });
        assert.equal(cmsOnlyProject.status, 200);
        assert.match(await cmsOnlyProject.text(), /cms\/project-template/);
        const refreshedProject = await projectRoute.onRequestGet({
            request: new Request("https://local.pages.test/projects/cms-only-project"),
            env
        });
        assert.equal(refreshedProject.status, 200);
        const unknownProject = await projectRoute.onRequestGet({
            request: new Request("https://local.pages.test/projects/not-in-d1"),
            env
        });
        assert.equal(unknownProject.status, 404);

        const projectFilter = await projectRoute.onRequestGet({
            request: new Request("https://local.pages.test/projects/navi-mumbai"),
            env: {
                ASSETS: {
                    async fetch(assetRequest) {
                        const pathname = new URL(assetRequest.url).pathname;
                        if (pathname === "/projects") return new Response("projects listing");
                        return new Response("Not found", { status: 404 });
                    }
                }
            }
        });
        assert.equal(await projectFilter.text(), "projects listing");
        const oldProjectFilter = await projectRoute.onRequestGet({
            request: new Request("https://local.pages.test/projects/mumbai"),
            env: {}
        });
        assert.equal(oldProjectFilter.status, 301);
        assert.equal(oldProjectFilter.headers.get("location"), "https://local.pages.test/projects/navi-mumbai");
        assert.ok(assetPaths.includes("/blog-post"));
        assert.ok(assetPaths.includes("/cms/project-template"));
    });

    await t.test("missing bindings, malformed requests and D1 failures have explicit responses", async () => {
        const missingBinding = await pagesApi.onRequest({
            request: request("/api/cms/public/blog"),
            env: {}
        });
        assert.equal(missingBinding.status, 503);

        const malformed = await pagesApi.onRequest({
            request: new Request("https://local.pages.test/api/inquiry", {
                method: "POST",
                headers: { origin: "https://local.pages.test", "content-type": "application/json" },
                body: "{invalid"
            }),
            env: { DB: db }
        });
        assert.equal(malformed.status, 400);

        const originalError = console.error;
        let failureLogged = false;
        console.error = () => { failureLogged = true; };
        let failed;
        try {
            failed = await d1.handleApiRequest(
                request("/api/cms/public/blog"),
                { DB: { prepare() { throw new Error("local test database failure"); } } }
            );
        } finally {
            console.error = originalError;
        }
        assert.equal(failed.status, 500);
        assert.equal(failureLogged, true);
        assert.deepEqual(await failed.json(), { error: "The request could not be completed." });
    });

    await t.test("inquiry requests report the missing additive migration in local diagnostics", async () => {
        const oldDatabase = new DatabaseSync(":memory:");
        const oldDb = new LocalD1(oldDatabase);
        oldDatabase.exec(migration);
        const originalError = console.error;
        const loggedErrors = [];
        console.error = (...values) => loggedErrors.push(values.join(" "));

        try {
            const response = await pagesApi.onRequest({
                request: request("/api/inquiry", {
                    method: "POST",
                    headers: {
                        "cf-connecting-ip": "198.51.100.80",
                        "idempotency-key": "old-schema-inquiry-0001"
                    },
                    body: {
                        name: "LOCAL_AUDIT_TEST",
                        phone: "0000000000",
                        sourcePage: "/local-test"
                    }
                }),
                env: { DB: oldDb }
            });
            assert.equal(response.status, 500);
            assert.match(loggedErrors.join("\n"), /no such column: submission_key/i);
            assert.doesNotMatch(loggedErrors.join("\n"), /LOCAL_AUDIT_TEST/);
        } finally {
            console.error = originalError;
            oldDatabase.close();
        }
    });

    await t.test("inquiry aliases persist once and retain pending Sheets delivery after failure", async () => {
        const payload = {
            name: "LOCAL_AUDIT_TEST",
            phone: "0000000000",
            email: "local-audit@example.test",
            budget: "₹40–60 Lakh",
            subject: "Project question",
            message: "Synthetic integration test only.",
            projectName: "Local Test Project",
            formType: "Project Enquiry",
            sourcePage: "/projects/local-test"
        };
        const key = "inquiry-local-audit-test-0001";
        const endpoint = "https://script.google.com/macros/s/test-deployment/exec";
        const sharedSecret = "local-test-google-sheets-shared-secret";
        const originalFetch = global.fetch;
        try {
            let callCount = 0;
            let forwardedBody;
            let forwardedOptions;
            global.fetch = async (url, init) => {
                callCount += 1;
                forwardedBody = JSON.parse(init.body);
                forwardedOptions = init;
                return Response.json({ success: true });
            };
            const first = await pagesApi.onRequest({
                request: request("/api/inquiry", {
                    method: "POST",
                    headers: {
                        "cf-connecting-ip": "198.51.100.81",
                        "idempotency-key": key
                    },
                    body: payload
                }),
                env: {
                    DB: db,
                    GOOGLE_SHEETS_WEB_APP_URL: endpoint,
                    GOOGLE_SHEETS_SHARED_SECRET: sharedSecret
                }
            });
            assert.equal(first.status, 201);
            assert.deepEqual((await first.json()).sheets, { status: "sent" });
            assert.equal(forwardedBody.type, "inquiry");
            assert.equal(forwardedBody.record.name, payload.name);
            assert.equal(forwardedBody.record.projectName, payload.projectName);
            assert.equal(forwardedBody.record.enquiryType, payload.formType);
            assert.equal(forwardedBody.record.source, payload.sourcePage);
            assert.equal(forwardedBody.record.budget, payload.budget);
            assert.equal(forwardedOptions.redirect, "follow");

            const duplicate = await pagesApi.onRequest({
                request: request("/api/popupinquiry", {
                    method: "POST",
                    headers: {
                        "cf-connecting-ip": "198.51.100.82",
                        "idempotency-key": key
                    },
                    body: payload
                }),
                env: {
                    DB: db,
                    GOOGLE_SHEETS_WEB_APP_URL: endpoint,
                    GOOGLE_SHEETS_SHARED_SECRET: sharedSecret
                }
            });
            assert.equal(duplicate.status, 200);
            assert.equal((await duplicate.json()).duplicate, true);
            assert.equal(callCount, 1);
            assert.equal(database.prepare(
                "SELECT COUNT(*) AS count FROM inquiries WHERE submission_key = ?"
            ).get(key).count, 1);
            assert.equal(database.prepare(
                "SELECT status FROM google_sheets_outbox WHERE submission_id = ?"
            ).get(key).status, "sent");

            const pendingKey = "inquiry-local-audit-test-0002";
            global.fetch = async () => new Response("unavailable", { status: 503 });
            const failedDelivery = await pagesApi.onRequest({
                request: request("/api/inquiry", {
                    method: "POST",
                    headers: {
                        "cf-connecting-ip": "198.51.100.83",
                        "idempotency-key": pendingKey
                    },
                    body: payload
                }),
                env: {
                    DB: db,
                    GOOGLE_SHEETS_WEB_APP_URL: endpoint,
                    GOOGLE_SHEETS_SHARED_SECRET: sharedSecret
                }
            });
            assert.equal(failedDelivery.status, 201);
            assert.deepEqual((await failedDelivery.json()).sheets, { status: "pending" });
            assert.equal(database.prepare(
                "SELECT COUNT(*) AS count FROM inquiries WHERE submission_key = ?"
            ).get(pendingKey).count, 1);
            assert.equal(database.prepare(
                "SELECT status, last_error FROM google_sheets_outbox WHERE submission_id = ?"
            ).get(pendingKey).status, "pending");

            const rejectedKey = "inquiry-local-audit-test-0003";
            global.fetch = async () => Response.json({
                success: false,
                error: "Unable to write the spreadsheet row."
            });
            const rejected = await pagesApi.onRequest({
                request: request("/api/inquiry", {
                    method: "POST",
                    headers: {
                        "cf-connecting-ip": "198.51.100.84",
                        "idempotency-key": rejectedKey
                    },
                    body: payload
                }),
                env: {
                    DB: db,
                    GOOGLE_SHEETS_WEB_APP_URL: endpoint,
                    GOOGLE_SHEETS_SHARED_SECRET: sharedSecret
                }
            });
            assert.equal(rejected.status, 201);
            const rejectedOutbox = database.prepare(
                "SELECT status, attempts, last_error FROM google_sheets_outbox WHERE submission_id = ?"
            ).get(rejectedKey);
            assert.equal(rejectedOutbox.status, "pending");
            assert.equal(rejectedOutbox.attempts, 1);
            assert.equal(rejectedOutbox.last_error, "receiver_spreadsheet_write_failed");

            const codedRejectionKey = "inquiry-local-audit-test-0004";
            global.fetch = async () => Response.json({
                success: false,
                errorCode: "unauthorized"
            });
            await pagesApi.onRequest({
                request: request("/api/inquiry", {
                    method: "POST",
                    headers: {
                        "cf-connecting-ip": "198.51.100.87",
                        "idempotency-key": codedRejectionKey
                    },
                    body: payload
                }),
                env: {
                    DB: db,
                    GOOGLE_SHEETS_WEB_APP_URL: endpoint,
                    GOOGLE_SHEETS_SHARED_SECRET: sharedSecret
                }
            });
            assert.equal(database.prepare(
                "SELECT last_error FROM google_sheets_outbox WHERE submission_id = ?"
            ).get(codedRejectionKey).last_error, "receiver_unauthorized");

            const htmlKey = "inquiry-local-audit-test-0005";
            global.fetch = async () => new Response("<html>sign in</html>", {
                status: 200,
                headers: { "content-type": "text/html; charset=utf-8" }
            });
            await pagesApi.onRequest({
                request: request("/api/inquiry", {
                    method: "POST",
                    headers: {
                        "cf-connecting-ip": "198.51.100.85",
                        "idempotency-key": htmlKey
                    },
                    body: payload
                }),
                env: {
                    DB: db,
                    GOOGLE_SHEETS_WEB_APP_URL: endpoint,
                    GOOGLE_SHEETS_SHARED_SECRET: sharedSecret
                }
            });
            assert.equal(database.prepare(
                "SELECT last_error FROM google_sheets_outbox WHERE submission_id = ?"
            ).get(htmlKey).last_error, "unexpected_html_response");

            const malformedJsonKey = "inquiry-local-audit-test-0006";
            global.fetch = async () => new Response("{invalid", {
                status: 200,
                headers: { "content-type": "application/json" }
            });
            await pagesApi.onRequest({
                request: request("/api/inquiry", {
                    method: "POST",
                    headers: {
                        "cf-connecting-ip": "198.51.100.86",
                        "idempotency-key": malformedJsonKey
                    },
                    body: payload
                }),
                env: {
                    DB: db,
                    GOOGLE_SHEETS_WEB_APP_URL: endpoint,
                    GOOGLE_SHEETS_SHARED_SECRET: sharedSecret
                }
            });
            assert.equal(database.prepare(
                "SELECT last_error FROM google_sheets_outbox WHERE submission_id = ?"
            ).get(malformedJsonKey).last_error, "invalid_json_response");

            const contentTypeKey = "inquiry-local-audit-test-0007";
            global.fetch = async () => new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { "content-type": "text/plain" }
            });
            await pagesApi.onRequest({
                request: request("/api/inquiry", {
                    method: "POST",
                    headers: {
                        "cf-connecting-ip": "198.51.100.88",
                        "idempotency-key": contentTypeKey
                    },
                    body: payload
                }),
                env: {
                    DB: db,
                    GOOGLE_SHEETS_WEB_APP_URL: endpoint,
                    GOOGLE_SHEETS_SHARED_SECRET: sharedSecret
                }
            });
            assert.equal(database.prepare(
                "SELECT last_error FROM google_sheets_outbox WHERE submission_id = ?"
            ).get(contentTypeKey).last_error, "unexpected_content_type");

            const redirectKey = "inquiry-local-audit-test-0008";
            global.fetch = async () => new Response(null, {
                status: 302,
                headers: { location: "https://script.googleusercontent.com/redirected-content" }
            });
            await pagesApi.onRequest({
                request: request("/api/inquiry", {
                    method: "POST",
                    headers: {
                        "cf-connecting-ip": "198.51.100.89",
                        "idempotency-key": redirectKey
                    },
                    body: payload
                }),
                env: {
                    DB: db,
                    GOOGLE_SHEETS_WEB_APP_URL: endpoint,
                    GOOGLE_SHEETS_SHARED_SECRET: sharedSecret
                }
            });
            assert.equal(database.prepare(
                "SELECT last_error FROM google_sheets_outbox WHERE submission_id = ?"
            ).get(redirectKey).last_error, "http_302");
        } finally {
            global.fetch = originalFetch;
        }
    });

    await t.test("career applications persist locally, queue Sheets delivery and retry safely", async () => {
        const invalid = await pagesApi.onRequest({
            request: request("/api/career", {
                method: "POST",
                body: { name: "", email: "not-an-email" }
            }),
            env: { DB: db }
        });
        assert.equal(invalid.status, 400);

        const application = {
            name: "Test Applicant",
            phone: "9876543210",
            email: "applicant@example.test",
            address: "Jaipur",
            qualification: "Graduate",
            experience: "Two years",
            appliedPosition: "Sales",
            resumeUrl: "https://example.test/resume.pdf",
            coverLetter: "Test application"
        };
        const unavailable = await pagesApi.onRequest({
            request: request("/api/career", { method: "POST", body: application }),
            env: {}
        });
        assert.equal(unavailable.status, 503);

        const invalidResume = await pagesApi.onRequest({
            request: request("/api/career", {
                method: "POST",
                body: { ...application, resumeUrl: "javascript:alert(1)" }
            }),
            env: { DB: db }
        });
        assert.equal(invalidResume.status, 400);

        const pendingKey = "career-pending-request-0001";
        const pendingRequest = () => request("/api/career", {
            method: "POST",
            headers: {
                "cf-connecting-ip": "198.51.100.71",
                "idempotency-key": pendingKey
            },
            body: application
        });
        const pending = await pagesApi.onRequest({
            request: pendingRequest(),
            env: { DB: db }
        });
        assert.equal(pending.status, 201);
        assert.deepEqual((await pending.json()).sheets, { status: "pending" });
        assert.equal(database.prepare(
            "SELECT COUNT(*) AS count FROM career_applications WHERE submission_key = ?"
        ).get(pendingKey).count, 1);
        assert.equal(database.prepare(
            "SELECT status FROM google_sheets_outbox WHERE submission_id = ?"
        ).get(pendingKey).status, "pending");

        const duplicate = await pagesApi.onRequest({
            request: pendingRequest(),
            env: { DB: db }
        });
        assert.equal(duplicate.status, 200);
        assert.equal((await duplicate.json()).duplicate, true);
        assert.equal(database.prepare(
            "SELECT COUNT(*) AS count FROM career_applications WHERE submission_key = ?"
        ).get(pendingKey).count, 1);

        const endpoint = "https://script.google.com/macros/s/test-deployment/exec";
        const sharedSecret = "local-test-google-sheets-shared-secret";
        const originalFetch = global.fetch;
        try {
            let forwardedUrl;
            let forwardedBody;
            global.fetch = async (url, init) => {
                forwardedUrl = url;
                forwardedBody = JSON.parse(init.body);
                return Response.json({ success: true });
            };
            const response = await pagesApi.onRequest({
                request: request("/api/career", {
                    method: "POST",
                    headers: {
                        "cf-connecting-ip": "198.51.100.72",
                        "idempotency-key": "career-success-request-0001"
                    },
                    body: application
                }),
                env: {
                    DB: db,
                    GOOGLE_SHEETS_WEB_APP_URL: endpoint,
                    GOOGLE_SHEETS_SHARED_SECRET: sharedSecret
                }
            });
            assert.equal(response.status, 201);
            assert.equal((await response.json()).sheets.status, "sent");
            assert.equal(forwardedUrl, endpoint);
            assert.equal(forwardedBody.sharedSecret, sharedSecret);
            assert.equal(forwardedBody.type, "career");
            assert.equal(forwardedBody.record.appliedPosition, "Sales");
            assert.equal(forwardedBody.record.email, "applicant@example.test");
            assert.equal(database.prepare(
                "SELECT status FROM google_sheets_outbox WHERE submission_id = ?"
            ).get("career-success-request-0001").status, "sent");

            global.fetch = async () => new Response(
                JSON.stringify({ success: false }),
                { status: 503, headers: { "content-type": "application/json" } }
            );
            const failedKey = "career-failure-request-0001";
            const failed = await pagesApi.onRequest({
                request: request("/api/career", {
                    method: "POST",
                    headers: {
                        "cf-connecting-ip": "198.51.100.73",
                        "idempotency-key": failedKey
                    },
                    body: application
                }),
                env: {
                    DB: db,
                    GOOGLE_SHEETS_WEB_APP_URL: endpoint,
                    GOOGLE_SHEETS_SHARED_SECRET: sharedSecret
                }
            });
            assert.equal(failed.status, 201);
            assert.equal((await failed.json()).success, true);
            const failedOutbox = database.prepare(
                "SELECT status, attempts, last_error FROM google_sheets_outbox WHERE submission_id = ?"
            ).get(failedKey);
            assert.equal(failedOutbox.status, "pending");
            assert.equal(failedOutbox.attempts, 1);
            assert.equal(failedOutbox.last_error, "http_503");

            const login = await pagesApi.onRequest({
                request: request("/api/cms/auth/login", {
                    method: "POST",
                    headers: { "cf-connecting-ip": "198.51.100.74" },
                    body: {
                        email: "local-admin@example.test",
                        password: "local-test-password-2026"
                    }
                }),
                env: { DB: db }
            });
            const sessionCookie = login.headers.get("set-cookie").split(";", 1)[0];
            const unauthenticatedStatus = await pagesApi.onRequest({
                request: request("/api/cms/admin/google-sheets"),
                env: { DB: db }
            });
            assert.equal(unauthenticatedStatus.status, 401);

            global.fetch = async () => Response.json({ success: true, duplicate: false });
            const retry = await pagesApi.onRequest({
                request: request("/api/cms/admin/google-sheets/retry", {
                    method: "POST",
                    headers: { cookie: sessionCookie }
                }),
                env: {
                    DB: db,
                    GOOGLE_SHEETS_WEB_APP_URL: endpoint,
                    GOOGLE_SHEETS_SHARED_SECRET: sharedSecret
                }
            });
            assert.equal(retry.status, 200);
            assert.ok((await retry.json()).sent >= 2);
            assert.equal(database.prepare(
                "SELECT status FROM google_sheets_outbox WHERE submission_id = ?"
            ).get(pendingKey).status, "sent");
            assert.equal(database.prepare(
                "SELECT status FROM google_sheets_outbox WHERE submission_id = ?"
            ).get(failedKey).status, "sent");
        } finally {
            global.fetch = originalFetch;
        }
    });
});
