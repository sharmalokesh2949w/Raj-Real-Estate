const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const express = require("express");
const multer = require("multer");
const { db, dataDirectory, pageFromRow, projectFromRow } = require("./database");
const {
    authenticateRequest,
    clearSessionCookie,
    createSession,
    getSessionToken,
    requireSameOrigin,
    setSessionCookie,
    verifyPassword
} = require("./auth");

const router = express.Router();
const projectDirectory = path.resolve(__dirname, "..");
const uploadDirectory = path.resolve(
    projectDirectory,
    process.env.CMS_UPLOAD_DIR || path.join(dataDirectory, "uploads")
);
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 }
});

const projectColumns = `
    slug, name, category, location_label, banner_label, location, summary, description,
    page_title, seo_description, card_image, gallery_json, layout_image,
    map_image, amenities_json, video_url, page_path, featured, sort_order,
    status, updated_at
`;
const projectCategories = new Set(["jaipur", "ajmer", "mumbai", "villasinmumbai"]);

class CmsValidationError extends Error {}

function boundedString(value, label, maxLength, { required = false } = {}) {
    if (typeof value !== "string") {
        throw new CmsValidationError(`${label} must be text.`);
    }
    const result = value.trim();
    if (required && !result) throw new CmsValidationError(`${label} is required.`);
    if (result.length > maxLength) {
        throw new CmsValidationError(`${label} must be ${maxLength} characters or fewer.`);
    }
    return result;
}

function validImagePath(value, label, required = false) {
    const imagePath = boundedString(value, label, 500, { required });
    if (!imagePath) return "";
    if (!/^\/(?:images|uploads)\/[A-Za-z0-9._/-]+$/.test(imagePath) ||
        imagePath.includes("..") || imagePath.includes("//")) {
        throw new CmsValidationError(`${label} must be a local site image or CMS upload.`);
    }

    const extension = path.extname(imagePath).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(extension)) {
        throw new CmsValidationError(`${label} must use PNG, JPEG, GIF, or WebP format.`);
    }

    const isUpload = imagePath.startsWith("/uploads/");
    const root = isUpload ? uploadDirectory : path.join(projectDirectory, "images");
    const relativePath = imagePath.slice(isUpload ? "/uploads/".length : "/images/".length);
    try {
        const realRoot = fsSync.realpathSync(root);
        const realFile = fsSync.realpathSync(path.resolve(realRoot, relativePath));
        const relativeFile = path.relative(realRoot, realFile);
        if (!relativeFile || relativeFile === ".." ||
            relativeFile.startsWith(`..${path.sep}`) || path.isAbsolute(relativeFile) ||
            !fsSync.statSync(realFile).isFile()) {
            throw new Error("not a file within the image directory");
        }

        const descriptor = fsSync.openSync(realFile, "r");
        const header = Buffer.alloc(12);
        let bytesRead;
        try {
            bytesRead = fsSync.readSync(descriptor, header, 0, header.length, 0);
        } finally {
            fsSync.closeSync(descriptor);
        }
        const supportedSignature =
            (bytesRead >= 8 &&
                header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
            (bytesRead >= 3 &&
                header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) ||
            ["GIF87a", "GIF89a"].includes(header.toString("ascii", 0, 6)) ||
            (bytesRead >= 12 &&
                header.toString("ascii", 0, 4) === "RIFF" &&
                header.toString("ascii", 8, 12) === "WEBP");
        if (!supportedSignature) {
            throw new CmsValidationError(`${label} must be a valid PNG, JPEG, GIF, or WebP image.`);
        }
    } catch (error) {
        if (error instanceof CmsValidationError) throw error;
        throw new CmsValidationError(`${label} must point to an existing site image or CMS upload.`);
    }
    return imagePath;
}

function validateBlogPost(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new CmsValidationError("Post details are required.");
    }
    const slug = boundedString(body.slug, "Post URL", 100, { required: true }).toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        throw new CmsValidationError("Post URL can contain lowercase letters, numbers, and hyphens.");
    }

    const status = body.status || "draft";
    if (!["published", "draft"].includes(status)) {
        throw new CmsValidationError("Choose published or unpublished status.");
    }

    const publishedAt = boundedString(body.publishedAt, "Publication date", 10, { required: true });
    const parsedDate = new Date(`${publishedAt}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(publishedAt) ||
        Number.isNaN(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== publishedAt) {
        throw new CmsValidationError("Publication date must be a valid calendar date.");
    }

    return {
        slug,
        title: boundedString(body.title, "Title", 180, { required: true }),
        excerpt: boundedString(body.excerpt, "Excerpt", 600, { required: true }),
        content: boundedString(body.content, "Article content", 30000, { required: true }),
        category: boundedString(body.category, "Category", 80, { required: true }),
        featuredImage: validImagePath(body.featuredImage, "Featured image", true),
        publishedAt,
        status
    };
}

function validateProject(body) {
    const slug = boundedString(body.slug, "Project URL", 80, { required: true }).toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        throw new CmsValidationError("Project URL can contain lowercase letters, numbers, and hyphens.");
    }

    const status = body.status || "draft";
    if (!["published", "draft"].includes(status)) {
        throw new CmsValidationError("Choose published or draft status.");
    }

    const category = boundedString(body.category || "jaipur", "Project category", 40, { required: true })
        .toLowerCase();
    if (!projectCategories.has(category)) {
        throw new CmsValidationError("Choose one of the available project listing categories.");
    }

    if (!Array.isArray(body.gallery) || body.gallery.length > 30) {
        throw new CmsValidationError("Gallery must contain no more than 30 image paths.");
    }
    const gallery = body.gallery.map((image, index) =>
        validImagePath(image, `Gallery image ${index + 1}`, true)
    );

    if (!Array.isArray(body.amenities) || body.amenities.length > 50) {
        throw new CmsValidationError("Amenities must contain no more than 50 entries.");
    }
    const amenities = body.amenities.map((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw new CmsValidationError(`Amenity ${index + 1} is invalid.`);
        }
        const label = boundedString(item.label, `Amenity ${index + 1}`, 100, { required: true });
        const icon = boundedString(item.icon || "bi-check-circle", `Amenity ${index + 1} icon`, 60);
        if (!/^bi-[a-z0-9-]+$/.test(icon)) throw new CmsValidationError(`Amenity ${index + 1} icon is invalid.`);
        return { label, icon };
    });

    const videoUrl = boundedString(body.videoUrl || "", "Video URL", 500);
    if (videoUrl) {
        let parsedVideo;
        try {
            parsedVideo = new URL(videoUrl);
        } catch {
            throw new CmsValidationError("Video URL must be a valid YouTube link.");
        }
        if (parsedVideo.protocol !== "https:" ||
            !["youtube.com", "www.youtube.com", "youtu.be", "www.youtube-nocookie.com"].includes(parsedVideo.hostname)) {
            throw new CmsValidationError("Video URL must be a valid YouTube link.");
        }
    }

    const sortOrder = Number(body.sortOrder ?? 0);
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000) {
        throw new CmsValidationError("Display order must be a whole number between 0 and 10000.");
    }

    return {
        slug,
        name: boundedString(body.name, "Project name", 120, { required: true }),
        category,
        locationLabel: boundedString(body.locationLabel || "", "Location label", 120),
        bannerLabel: boundedString(body.bannerLabel || "", "Banner location label", 160),
        location: boundedString(body.location || "", "Project location", 240),
        summary: boundedString(body.summary || "", "Card summary", 600),
        description: boundedString(body.description || "", "Project description", 10000),
        pageTitle: boundedString(body.pageTitle || "", "Page title", 200),
        seoDescription: boundedString(body.seoDescription || "", "SEO description", 320),
        cardImage: validImagePath(body.cardImage || "", "Card image"),
        gallery,
        layoutImage: validImagePath(body.layoutImage || "", "Layout image"),
        mapImage: validImagePath(body.mapImage || "", "Map image"),
        amenities,
        videoUrl,
        featured: body.featured === true,
        sortOrder,
        status
    };
}

function projectValues(project, existing = false) {
    const now = new Date().toISOString();
    const values = [
        project.name,
        project.category,
        project.locationLabel,
        project.bannerLabel,
        project.location,
        project.summary,
        project.description,
        project.pageTitle,
        project.seoDescription,
        project.cardImage,
        JSON.stringify(project.gallery),
        project.layoutImage,
        project.mapImage,
        JSON.stringify(project.amenities),
        project.videoUrl,
        project.featured ? 1 : 0,
        project.sortOrder,
        project.status,
        now
    ];
    if (existing) return [...values, project.slug];
    return [
        project.slug,
        ...values.slice(0, 15),
        `/projects/${project.slug}.html`,
        ...values.slice(15)
    ];
}

function publicPageForPath(pagePath) {
    return pageFromRow(db.prepare(`
        SELECT slug, path, label, title, seo_title, seo_description, status
        FROM cms_pages WHERE path = ?
    `).get(pagePath));
}

function safeResponseError(res, error) {
    if (error instanceof CmsValidationError) {
        return res.status(400).json({ error: error.message });
    }
    console.error("CMS request failed:", error);
    return res.status(500).json({ error: "The CMS request could not be completed." });
}

function recordLoginFailure(address) {
    const now = new Date();
    const current = db.prepare(`
        SELECT attempts, blocked_until FROM cms_login_attempts WHERE address = ?
    `).get(address);
    if (current?.blocked_until && Date.parse(current.blocked_until) > now.getTime()) {
        return false;
    }

    const lockoutExpired = Boolean(current?.blocked_until) &&
        !(Date.parse(current.blocked_until) > now.getTime());
    const attempts = lockoutExpired ? 1 : (current?.attempts || 0) + 1;
    const blockedUntil = attempts >= 5
        ? new Date(now.getTime() + 15 * 60 * 1000).toISOString()
        : null;
    db.prepare(`
        INSERT INTO cms_login_attempts (address, attempts, blocked_until, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(address) DO UPDATE SET
            attempts = excluded.attempts,
            blocked_until = excluded.blocked_until,
            updated_at = excluded.updated_at
    `).run(address, attempts, blockedUntil, now.toISOString());
    return true;
}

router.post("/auth/login", requireSameOrigin, (req, res) => {
    try {
        const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
        const password = typeof req.body.password === "string" ? req.body.password : "";
        const address = req.ip || "unknown";
        const attempt = db.prepare(`
            SELECT blocked_until FROM cms_login_attempts WHERE address = ?
        `).get(address);
        if (attempt?.blocked_until && Date.parse(attempt.blocked_until) > Date.now()) {
            return res.status(429).json({ error: "Too many sign-in attempts. Try again later." });
        }

        const admin = db.prepare(`
            SELECT id, email, password_salt, password_hash
            FROM admins WHERE email = ? COLLATE NOCASE
        `).get(email);
        const valid = admin
            ? verifyPassword(password, admin.password_salt, admin.password_hash)
            : (verifyPassword(password || "invalid-password", "cms-login-placeholder", "00".repeat(64)), false);

        if (!valid) {
            recordLoginFailure(address);
            return res.status(401).json({ error: "Email or password is incorrect." });
        }

        db.prepare("DELETE FROM cms_login_attempts WHERE address = ?").run(address);
        const token = createSession(admin.id);
        setSessionCookie(res, token);
        return res.json({ admin: { email: admin.email } });
    } catch (error) {
        console.error("CMS login failed:", {
            name: error instanceof Error ? error.name : "UnknownError",
            code: error && typeof error === "object" && "code" in error
                ? error.code
                : "CMS_LOGIN_ERROR"
        });
        return res.status(500).json({
            error: "Sign-in could not be completed. Try again; if the problem persists, check the server logs."
        });
    }
});

router.post("/auth/logout", requireSameOrigin, (req, res) => {
    const token = getSessionToken(req);
    if (token) {
        const { createHash } = require("node:crypto");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        db.prepare("DELETE FROM cms_sessions WHERE token_hash = ?").run(tokenHash);
    }
    clearSessionCookie(res);
    return res.status(204).end();
});

router.get("/auth/session", authenticateRequest, (req, res) => {
    res.json({ admin: req.cmsAdmin });
});

router.get("/public/projects", (req, res) => {
    const projects = db.prepare(`
        SELECT ${projectColumns} FROM cms_projects
        WHERE status = 'published'
        ORDER BY sort_order ASC, name COLLATE NOCASE ASC
    `).all().map(projectFromRow);
    res.json({ projects });
});

router.get("/public/projects/:slug", (req, res) => {
    const project = projectFromRow(db.prepare(`
        SELECT ${projectColumns} FROM cms_projects
        WHERE slug = ? AND status = 'published'
    `).get(req.params.slug));
    if (!project) return res.status(404).json({ error: "Project not found." });
    return res.json({ project });
});

router.get("/public/pages", (req, res) => {
    const pages = db.prepare(`
        SELECT slug, path, label, title, seo_title, seo_description
        FROM cms_pages WHERE status = 'published'
    `).all();
    res.json({ pages });
});

router.get("/public/pages/:slug", (req, res) => {
    const page = pageFromRow(db.prepare(`
        SELECT slug, path, label, title, seo_title, seo_description, content_json
        FROM cms_pages WHERE slug = ? AND status = 'published'
    `).get(req.params.slug));
    if (!page) return res.status(404).json({ error: "Page not found." });
    return res.json({ page });
});

router.get("/public/settings", (req, res) => {
    const settings = Object.fromEntries(
        db.prepare("SELECT key, value FROM cms_settings").all().map(row => [row.key, row.value])
    );
    res.json({ settings });
});

router.get("/public/blog", (req, res) => {
    const posts = db.prepare(`
        SELECT slug, title, excerpt, content, category, featured_image, published_at
        FROM cms_blog_posts
        WHERE status = 'published'
        ORDER BY published_at DESC, title COLLATE NOCASE ASC
    `).all();
    res.json({ posts });
});

router.get("/public/blog/:slug", (req, res) => {
    const post = db.prepare(`
        SELECT slug, title, excerpt, content, category, featured_image, published_at
        FROM cms_blog_posts
        WHERE slug = ? AND status = 'published'
    `).get(req.params.slug);
    if (!post) return res.status(404).json({ error: "Blog post not found." });
    return res.json({ post });
});

router.use("/admin", authenticateRequest);

router.get("/admin/summary", (req, res) => {
    const projects = db.prepare(`
        SELECT status, COUNT(*) AS count FROM cms_projects GROUP BY status
    `).all();
    const pages = db.prepare(`
        SELECT status, COUNT(*) AS count FROM cms_pages GROUP BY status
    `).all();
    const blog = db.prepare(`
        SELECT status, COUNT(*) AS count FROM cms_blog_posts GROUP BY status
    `).all();
    const inquiries = db.prepare(`
        SELECT status, COUNT(*) AS count FROM inquiries GROUP BY status
    `).all();
    res.json({
        projects: Object.fromEntries(projects.map(row => [row.status, row.count])),
        pages: Object.fromEntries(pages.map(row => [row.status, row.count])),
        blog: Object.fromEntries(blog.map(row => [row.status, row.count])),
        inquiries: Object.fromEntries(inquiries.map(row => [row.status, row.count]))
    });
});

router.get("/admin/inquiries", (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = 50;
    const status = typeof req.query.status === "string" ? req.query.status : "all";
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 120) : "";
    if (!["all", "new", "contacted", "closed"].includes(status)) {
        return res.status(400).json({ error: "Choose a valid enquiry status filter." });
    }

    const conditions = [];
    const values = [];
    if (status !== "all") {
        conditions.push("status = ?");
        values.push(status);
    }
    if (search) {
        conditions.push("(name LIKE ? OR phone LIKE ? OR email LIKE ? OR project_name LIKE ?)");
        values.push(...Array(4).fill(`%${search}%`));
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = db.prepare(`SELECT COUNT(*) AS count FROM inquiries ${where}`).get(...values).count;
    const pages = Math.max(1, Math.ceil(total / limit));
    const currentPage = Math.min(page, pages);
    const inquiries = db.prepare(`
        SELECT id, name, phone, email, message, budget, project_name, source_form, source_page,
               status, submitted_at
        FROM inquiries
        ${where}
        ORDER BY submitted_at DESC, id DESC
        LIMIT ? OFFSET ?
    `).all(...values, limit, (currentPage - 1) * limit);
    return res.json({ inquiries, total, page: currentPage, pages });
});

router.patch("/admin/inquiries/:id/status", requireSameOrigin, (req, res) => {
    const id = /^\d+$/.test(req.params.id) ? Number(req.params.id) : NaN;
    const { status } = req.body || {};
    if (!Number.isSafeInteger(id) || id < 1 ||
        !["new", "contacted", "closed"].includes(status)) {
        return res.status(400).json({ error: "Choose a valid enquiry status." });
    }
    const result = db.prepare("UPDATE inquiries SET status = ? WHERE id = ?").run(status, id);
    if (!result.changes) return res.status(404).json({ error: "Enquiry not found." });
    return res.json({ success: true });
});

router.get("/admin/blog", (req, res) => {
    const posts = db.prepare(`
        SELECT slug, title, excerpt, content, category, featured_image, published_at,
               status, created_at, updated_at
        FROM cms_blog_posts
        ORDER BY updated_at DESC, title COLLATE NOCASE ASC
    `).all();
    res.json({ posts });
});

router.post("/admin/blog", requireSameOrigin, (req, res) => {
    try {
        const post = validateBlogPost(req.body);
        if (db.prepare("SELECT 1 FROM cms_blog_posts WHERE slug = ?").get(post.slug)) {
            return res.status(409).json({ error: "That post URL is already in use." });
        }
        const now = new Date().toISOString();
        db.prepare(`
            INSERT INTO cms_blog_posts
                (slug, title, excerpt, content, category, featured_image, published_at,
                 status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            post.slug, post.title, post.excerpt, post.content, post.category,
            post.featuredImage, post.publishedAt, post.status, now, now
        );
        const created = db.prepare("SELECT * FROM cms_blog_posts WHERE slug = ?").get(post.slug);
        return res.status(201).json({ post: created });
    } catch (error) {
        return safeResponseError(res, error);
    }
});

router.put("/admin/blog/:slug", requireSameOrigin, (req, res) => {
    try {
        const post = validateBlogPost(req.body);
        if (!db.prepare("SELECT 1 FROM cms_blog_posts WHERE slug = ?").get(req.params.slug)) {
            return res.status(404).json({ error: "Blog post not found." });
        }
        if (post.slug !== req.params.slug &&
            db.prepare("SELECT 1 FROM cms_blog_posts WHERE slug = ?").get(post.slug)) {
            return res.status(409).json({ error: "That post URL is already in use." });
        }
        db.prepare(`
            UPDATE cms_blog_posts SET
                slug = ?, title = ?, excerpt = ?, content = ?, category = ?,
                featured_image = ?, published_at = ?, status = ?, updated_at = ?
            WHERE slug = ?
        `).run(
            post.slug, post.title, post.excerpt, post.content, post.category,
            post.featuredImage, post.publishedAt, post.status,
            new Date().toISOString(), req.params.slug
        );
        return res.json({
            post: db.prepare("SELECT * FROM cms_blog_posts WHERE slug = ?").get(post.slug)
        });
    } catch (error) {
        return safeResponseError(res, error);
    }
});

router.delete("/admin/blog/:slug", requireSameOrigin, (req, res) => {
    const deletion = db.prepare("DELETE FROM cms_blog_posts WHERE slug = ?").run(req.params.slug);
    if (!deletion.changes) return res.status(404).json({ error: "Blog post not found." });
    return res.status(204).end();
});

router.get("/admin/projects", (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = 10;
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 120) : "";
    const status = ["all", "published", "draft", "deleted"].includes(req.query.status)
        ? req.query.status
        : "all";
    const where = [];
    const parameters = [];
    if (status !== "all") {
        where.push("status = ?");
        parameters.push(status);
    } else {
        where.push("status != 'deleted'");
    }
    if (search) {
        where.push("(name LIKE ? OR location LIKE ? OR slug LIKE ?)");
        parameters.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const clause = `WHERE ${where.join(" AND ")}`;
    const total = db.prepare(`SELECT COUNT(*) AS count FROM cms_projects ${clause}`).get(...parameters).count;
    const projects = db.prepare(`
        SELECT ${projectColumns} FROM cms_projects ${clause}
        ORDER BY sort_order ASC, name COLLATE NOCASE ASC LIMIT ? OFFSET ?
    `).all(...parameters, pageSize, (page - 1) * pageSize).map(projectFromRow);
    res.json({ projects, page, pageSize, total, pages: Math.ceil(total / pageSize) });
});

router.post("/admin/projects", requireSameOrigin, (req, res) => {
    try {
        const project = validateProject(req.body);
        const exists = db.prepare("SELECT 1 FROM cms_projects WHERE slug = ?").get(project.slug);
        if (exists) return res.status(409).json({ error: "That project URL is already in use." });
        const values = projectValues(project);
        db.prepare(`
            INSERT INTO cms_projects (
                    slug, name, category, location_label, banner_label, location, summary, description,
                page_title, seo_description, card_image, gallery_json, layout_image,
                map_image, amenities_json, video_url, page_path, featured, sort_order,
                status, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(...values);
        return res.status(201).json({
            project: projectFromRow(db.prepare(`SELECT ${projectColumns} FROM cms_projects WHERE slug = ?`).get(project.slug))
        });
    } catch (error) {
        return safeResponseError(res, error);
    }
});

router.get("/admin/projects/:slug", (req, res) => {
    const project = projectFromRow(db.prepare(`
        SELECT ${projectColumns} FROM cms_projects WHERE slug = ?
    `).get(req.params.slug));
    if (!project) return res.status(404).json({ error: "Project not found." });
    return res.json({ project });
});

router.put("/admin/projects/:slug", requireSameOrigin, (req, res) => {
    try {
        const project = validateProject({ ...req.body, slug: req.params.slug });
        const exists = db.prepare("SELECT 1 FROM cms_projects WHERE slug = ?").get(project.slug);
        if (!exists) return res.status(404).json({ error: "Project not found." });
        db.prepare(`
            UPDATE cms_projects SET
                name = ?, category = ?, location_label = ?, banner_label = ?, location = ?, summary = ?,
                description = ?, page_title = ?, seo_description = ?, card_image = ?,
                gallery_json = ?, layout_image = ?, map_image = ?, amenities_json = ?,
                video_url = ?, featured = ?, sort_order = ?, status = ?, updated_at = ?
            WHERE slug = ?
        `).run(...projectValues(project, true));
        return res.json({
            project: projectFromRow(db.prepare(`SELECT ${projectColumns} FROM cms_projects WHERE slug = ?`).get(project.slug))
        });
    } catch (error) {
        return safeResponseError(res, error);
    }
});

router.delete("/admin/projects/:slug", requireSameOrigin, (req, res) => {
    const result = db.prepare(`
        UPDATE cms_projects SET status = 'deleted', updated_at = ? WHERE slug = ? AND status != 'deleted'
    `).run(new Date().toISOString(), req.params.slug);
    if (!result.changes) return res.status(404).json({ error: "Project not found." });
    return res.status(204).end();
});

router.get("/admin/pages", (req, res) => {
    const pages = db.prepare(`
        SELECT slug, path, label, title, seo_title, seo_description, content_json, status, updated_at
        FROM cms_pages ORDER BY label COLLATE NOCASE ASC
    `).all().map(pageFromRow);
    res.json({ pages });
});

router.put("/admin/pages/:slug", requireSameOrigin, (req, res) => {
    try {
        const seoTitle = boundedString(req.body.seoTitle, "SEO title", 200, { required: true });
        const seoDescription = boundedString(req.body.seoDescription || "", "SEO description", 320);
        const status = req.body.status;
        if (!["published", "draft"].includes(status)) {
            throw new CmsValidationError("Choose published or draft status.");
        }
        const existingPage = db.prepare("SELECT content_json FROM cms_pages WHERE slug = ?")
            .get(req.params.slug);
        if (!existingPage) return res.status(404).json({ error: "Page not found." });
        const content = JSON.parse(existingPage.content_json);
        if (req.body.content !== undefined) {
            if (!req.body.content || typeof req.body.content !== "object" || Array.isArray(req.body.content)) {
                throw new CmsValidationError("Page content must be a set of text fields.");
            }
            const keys = Object.keys(req.body.content);
            if (keys.length > 80) throw new CmsValidationError("Too many editable page fields.");
            for (const key of keys) {
                if (!Object.hasOwn(content, key)) throw new CmsValidationError("An unknown page content field was submitted.");
                const value = boundedString(req.body.content[key], "Page content", 10000);
                content[key] = key.toLowerCase().includes("image")
                    ? validImagePath(value, "Page image")
                    : value;
            }
            if (Buffer.byteLength(JSON.stringify(content), "utf8") > 64000) {
                throw new CmsValidationError("Page content is too large to save.");
            }
        }
        const result = db.prepare(`
            UPDATE cms_pages SET seo_title = ?, seo_description = ?, content_json = ?, status = ?, updated_at = ?
            WHERE slug = ?
        `).run(seoTitle, seoDescription, JSON.stringify(content), status, new Date().toISOString(), req.params.slug);
        if (!result.changes) return res.status(404).json({ error: "Page not found." });
        return res.json({ page: pageFromRow(db.prepare(`
            SELECT slug, path, label, title, seo_title, seo_description, content_json, status, updated_at
            FROM cms_pages WHERE slug = ?
        `).get(req.params.slug)) });
    } catch (error) {
        return safeResponseError(res, error);
    }
});

router.get("/admin/settings", (req, res) => {
    const settings = Object.fromEntries(
        db.prepare("SELECT key, value FROM cms_settings").all().map(row => [row.key, row.value])
    );
    res.json({ settings });
});

router.put("/admin/settings", requireSameOrigin, (req, res) => {
    try {
        const fields = {
            officeAddress: ["Office address", 500],
            phone: ["Phone number", 40],
            whatsapp: ["WhatsApp number", 40],
            email: ["Contact email", 160],
            businessHours: ["Business hours", 160]
        };
        const set = db.prepare(`
            INSERT INTO cms_settings (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `);
        for (const [key, [label, maxLength]] of Object.entries(fields)) {
            const value = boundedString(req.body[key] || "", label, maxLength);
            if (key === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                throw new CmsValidationError("Contact email must be valid.");
            }
            if (["phone", "whatsapp"].includes(key) && value && !/^[+0-9()\-\s]{6,40}$/.test(value)) {
                throw new CmsValidationError(`${label} contains unsupported characters.`);
            }
            set.run(key, value, new Date().toISOString());
        }
        return res.json({ settings: req.body });
    } catch (error) {
        return safeResponseError(res, error);
    }
});

router.post("/admin/uploads", requireSameOrigin, upload.single("image"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Choose an image to upload." });

    const signatures = [
        { type: "image/png", extension: "png", valid: buffer => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
        { type: "image/jpeg", extension: "jpg", valid: buffer => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
        { type: "image/gif", extension: "gif", valid: buffer => ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6)) },
        { type: "image/webp", extension: "webp", valid: buffer => buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP" }
    ];
    const imageType = signatures.find(signature => signature.valid(req.file.buffer));
    if (!imageType) return res.status(400).json({ error: "Upload a valid PNG, JPEG, GIF, or WebP image." });

    await fs.mkdir(uploadDirectory, { recursive: true });
    const filename = `${randomUUID()}.${imageType.extension}`;
    await fs.writeFile(path.join(uploadDirectory, filename), req.file.buffer, { flag: "wx" });
    return res.status(201).json({
        image: {
            url: `/uploads/${filename}`,
            contentType: imageType.type,
            size: req.file.size
        }
    });
});

module.exports = {
    publicPageForPath,
    router,
    uploadDirectory
};
