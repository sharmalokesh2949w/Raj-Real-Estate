const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const inquiryRoute = require("./routes/inquiry");
const careerRoute = require("./routes/career");
const popupInquiryRoute = require("./routes/popupinquiry");
const cms = require("./cms/router");
const { db, databasePath, seedInitialContent } = require("./cms/database");

const app = express();
const rootDirectory = __dirname;
const inquiryRateLimits = new Map();
const inquiryRateLimitWindowMs = 15 * 60 * 1000;
const inquiryRateLimitMaximum = 15;
const pageFiles = new Map([
    ["/", { slug: "index", file: "index.html" }],
    ["/about", { slug: "about", file: "about.html" }],
    ["/career", { slug: "career", file: "career.html" }],
    ["/contact", { slug: "contact", file: "contact.html" }],
    ["/projects", { slug: "projects", file: "projects.html" }],
    ["/blog", { slug: "blog", file: "blog.html" }],
    ["/why-us", { slug: "why-us", file: "why-us.html" }],
    ["/privacypolicy", { slug: "privacypolicy", file: "privacypolicy.html" }]
]);
const projectFilterPaths = new Map([
    ["/projects/jaipur", "jaipur"],
    ["/projects/navi-mumbai", "mumbai"]
]);
const legacyPagePaths = new Map([
    ["/index.html", "/"],
    ["/about.html", "/about"],
    ["/career.html", "/career"],
    ["/contact.html", "/contact"],
    ["/projects.html", "/projects"],
    ["/blog.html", "/blog"],
    ["/privacypolicy.html", "/privacypolicy"],
    ["/why-us.html", "/why-us"]
]);
const legacyProjectFilters = new Map([
    ["/projects/ajmer", "/projects?city=ajmer"],
    ["/projects/mumbai", "/projects/navi-mumbai"],
    ["/projects/villasinmumbai", "/projects/navi-mumbai?city=villasinmumbai"]
]);

function redirectLegacyUrl(req, res, destination) {
    const queryIndex = req.originalUrl.indexOf("?");
    const query = queryIndex < 0 ? "" : req.originalUrl.slice(queryIndex);
    const querySeparator = destination.includes("?") ? "&" : "?";
    return res.redirect(301, `${destination}${query ? `${querySeparator}${query.slice(1)}` : ""}`);
}

seedInitialContent(rootDirectory);

const configuredTrustProxy = process.env.TRUST_PROXY?.trim();
if (configuredTrustProxy) {
    app.set(
        "trust proxy",
        /^\d+$/.test(configuredTrustProxy) ? Number(configuredTrustProxy) : configuredTrustProxy
    );
}
app.use(cors());
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true, limit: "64kb" }));

function limitPublicInquiries(req, res, next) {
    if (req.method !== "POST") return next();

    const now = Date.now();
    const address = req.ip || req.socket.remoteAddress || "unknown";
    const recent = (inquiryRateLimits.get(address) || [])
        .filter(timestamp => timestamp > now - inquiryRateLimitWindowMs);

    if (recent.length >= inquiryRateLimitMaximum) {
        const retryAfterSeconds = Math.ceil(
            (recent[0] + inquiryRateLimitWindowMs - now) / 1000
        );
        res.set("Retry-After", String(retryAfterSeconds));
        return res.status(429).json({
            success: false,
            error: "Too many enquiries. Please try again later."
        });
    }

    recent.push(now);
    inquiryRateLimits.set(address, recent);
    if (inquiryRateLimits.size > 10000) {
        for (const [key, timestamps] of inquiryRateLimits) {
            if (!timestamps.some(timestamp => timestamp > now - inquiryRateLimitWindowMs)) {
                inquiryRateLimits.delete(key);
            }
        }
    }
    return next();
}

app.use(["/api/inquiry", "/api/popupinquiry"], limitPublicInquiries);
app.use("/api/inquiry", inquiryRoute);
app.use("/api/popupinquiry", popupInquiryRoute);
app.use("/api/career", careerRoute);
app.use("/api/cms", cms.router);

app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
});

app.get(["/admin", "/admin/"], (req, res) => {
    res.sendFile(path.join(rootDirectory, "admin", "index.html"));
});
app.use("/admin", express.static(path.join(rootDirectory, "admin"), {
    dotfiles: "deny",
    index: false
}));
app.use("/uploads", express.static(cms.uploadDirectory, {
    dotfiles: "deny",
    fallthrough: false,
    index: false
}));

app.use((req, res, next) => {
    if (!["GET", "HEAD"].includes(req.method)) return next();

    if (req.path === "/index.html" || legacyPagePaths.has(req.path)) {
        return redirectLegacyUrl(req, res, legacyPagePaths.get(req.path));
    }

    if (req.path === "/blog-post.html") {
        const slug = typeof req.query.slug === "string" ? req.query.slug : "";
        const post = slug && db.prepare(`
            SELECT 1 FROM cms_blog_posts WHERE slug = ? AND status = 'published'
        `).get(slug);
        if (!post) return res.status(404).sendFile(path.join(rootDirectory, "404.html"));
        return redirectLegacyUrl(req, res, `/blog/${encodeURIComponent(slug)}`);
    }

    if (legacyProjectFilters.has(req.path)) {
        return redirectLegacyUrl(req, res, legacyProjectFilters.get(req.path));
    }

    const legacyProjectSlug = req.path.match(/^\/projects\/([a-z0-9-]+)\.html$/i)?.[1];
    if (legacyProjectSlug) {
        return redirectLegacyUrl(req, res, `/projects/${legacyProjectSlug}`);
    }

    const blogSlug = req.path.match(/^\/blog\/([a-z0-9-]+)$/i)?.[1];
    if (blogSlug) {
        const post = db.prepare(`
            SELECT 1 FROM cms_blog_posts WHERE slug = ? AND status = 'published'
        `).get(blogSlug);
        if (!post) return res.status(404).sendFile(path.join(rootDirectory, "404.html"));
        return res.sendFile(path.join(rootDirectory, "blog-post.html"));
    }

    const slug = req.path.match(/^\/projects\/([a-z0-9-]+)$/i)?.[1];
    if (slug) {
        const project = db.prepare(`
            SELECT slug, status, page_path FROM cms_projects WHERE slug = ?
        `).get(slug);
        if (project) {
            if (project.status !== "published") {
                return res.status(404).sendFile(path.join(rootDirectory, "404.html"));
            }
            const existingPage = path.join(rootDirectory, project.page_path.replace(/^\//, ""));
            if (fs.existsSync(existingPage)) return res.sendFile(existingPage);
            return res.sendFile(path.join(rootDirectory, "cms", "project-template.html"));
        }
    }

    const page = pageFiles.get(req.path);
    const pageSlug = page?.slug || (projectFilterPaths.has(req.path) ? "projects" : undefined);
    if (pageSlug) {
        const pageRecord = db.prepare("SELECT status FROM cms_pages WHERE slug = ?").get(pageSlug);
        if (pageRecord && pageRecord.status !== "published") {
            return res.status(404).sendFile(path.join(rootDirectory, "404.html"));
        }
    }

    if (projectFilterPaths.has(req.path)) {
        return res.sendFile(path.join(rootDirectory, "projects.html"));
    }
    if (page) {
        return res.sendFile(path.join(rootDirectory, page.file));
    }
    const assetMatch = req.path.match(/^\/(css|js|images)\/([A-Za-z0-9._/-]+)$/);
    if (assetMatch && !assetMatch[2].split("/").some(part => part === "." || part === "..")) {
        return res.sendFile(path.join(rootDirectory, assetMatch[1], assetMatch[2]));
    }
    return next();
});

app.use((req, res) => {
    res.status(404).sendFile(path.join(rootDirectory, "404.html"));
});

app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error?.type === "entity.parse.failed") {
        return res.status(400).json({ error: "Request body must be valid JSON." });
    }
    if (error?.type === "entity.too.large") {
        return res.status(413).json({ error: "Request body is too large." });
    }
    if (error instanceof multer.MulterError) {
        return res.status(400).json({ error: "The image upload is invalid or exceeds the 5 MB limit." });
    }
    console.error("Request failed:", error);
    return res.status(500).json({ error: "The request could not be completed." });
});

if (require.main === module) {
    const port = Number(process.env.PORT) || 5000;
    app.listen(port, "0.0.0.0", () => {
        console.log(`Raj Real Estate site and CMS listening on port ${port}`);
        console.log(`CMS SQLite database: ${databasePath}`);
    });
}

module.exports = { app, db };
