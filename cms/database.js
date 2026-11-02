const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const projectDirectory = path.resolve(__dirname, "..");
const dataDirectory = path.resolve(
    projectDirectory,
    process.env.CMS_DATA_DIR || "data"
);
const databasePath = path.resolve(
    projectDirectory,
    process.env.CMS_DATABASE_PATH || path.join(dataDirectory, "cms.sqlite")
);

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new DatabaseSync(databasePath);
db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cms_sessions (
        token_hash TEXT PRIMARY KEY,
        admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cms_sessions_expiry ON cms_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS cms_login_attempts (
        address TEXT PRIMARY KEY,
        attempts INTEGER NOT NULL DEFAULT 0,
        blocked_until TEXT,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cms_pages (
        slug TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        title TEXT NOT NULL,
        seo_title TEXT NOT NULL,
        seo_description TEXT NOT NULL DEFAULT '',
        content_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'published'
            CHECK (status IN ('published', 'draft', 'deleted')),
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cms_projects (
        slug TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'jaipur',
        location_label TEXT NOT NULL DEFAULT '',
        banner_label TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        page_title TEXT NOT NULL DEFAULT '',
        seo_description TEXT NOT NULL DEFAULT '',
        card_image TEXT NOT NULL DEFAULT '',
        gallery_json TEXT NOT NULL DEFAULT '[]',
        layout_image TEXT NOT NULL DEFAULT '',
        map_image TEXT NOT NULL DEFAULT '',
        amenities_json TEXT NOT NULL DEFAULT '[]',
        video_url TEXT NOT NULL DEFAULT '',
        page_path TEXT NOT NULL,
        featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
        sort_order INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'published'
            CHECK (status IN ('published', 'draft', 'deleted')),
        updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cms_projects_public_order
        ON cms_projects(status, sort_order, name);

    CREATE TABLE IF NOT EXISTS cms_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cms_blog_posts (
        slug TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        excerpt TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT NOT NULL,
        featured_image TEXT NOT NULL,
        published_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft'
            CHECK (status IN ('published', 'draft')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cms_blog_posts_public_order
        ON cms_blog_posts(status, published_at DESC);

    CREATE TABLE IF NOT EXISTS inquiries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        budget TEXT NOT NULL DEFAULT '',
        project_name TEXT NOT NULL DEFAULT '',
        source_form TEXT NOT NULL DEFAULT 'Website enquiry',
        source_page TEXT NOT NULL DEFAULT '/',
        status TEXT NOT NULL DEFAULT 'new'
            CHECK (status IN ('new', 'contacted', 'closed')),
        submitted_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS inquiries_submitted_at
        ON inquiries(submitted_at DESC);
`);

if (!db.prepare("PRAGMA table_info(cms_pages)").all().some(column => column.name === "content_json")) {
    db.exec("ALTER TABLE cms_pages ADD COLUMN content_json TEXT NOT NULL DEFAULT '{}'");
}
if (!db.prepare("PRAGMA table_info(cms_projects)").all().some(column => column.name === "banner_label")) {
    db.exec("ALTER TABLE cms_projects ADD COLUMN banner_label TEXT NOT NULL DEFAULT ''");
}
if (!db.prepare("PRAGMA table_info(inquiries)").all().some(column => column.name === "budget")) {
    db.exec("ALTER TABLE inquiries ADD COLUMN budget TEXT NOT NULL DEFAULT ''");
}

function decodeHtml(value) {
    return value
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
            String.fromCodePoint(Number.parseInt(code, 16))
        )
        .replace(/&#(\d+);/g, (_, code) =>
            String.fromCodePoint(Number.parseInt(code, 10))
        );
}

function textContent(value) {
    return decodeHtml(value.replace(/<[^>]*>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
}

function attribute(tag, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])(.*?)\\1`, "i"));
    return match ? decodeHtml(match[2]) : "";
}

function getDivBlock(source, start) {
    const divTags = /<\/?div\b[^>]*>/gi;
    divTags.lastIndex = start;
    let depth = 0;
    let match;

    while ((match = divTags.exec(source))) {
        if (/^<\//.test(match[0])) {
            depth -= 1;
        } else if (!/\/>$/.test(match[0])) {
            depth += 1;
        }

        if (depth === 0) {
            return source.slice(start, divTags.lastIndex);
        }
    }

    return "";
}

function parseProjectCards(source) {
    const cards = [];
    const openings = /<div\b[^>]*class=(["'])[^"']*\bproject-card\b[^"']*\1[^>]*>/gi;
    let match;

    while ((match = openings.exec(source))) {
        const block = getDivBlock(source, match.index);
        if (!block) continue;

        const imageTag = block.match(/<img\b[^>]*>/i)?.[0] || "";
        const heading = block.match(/<h4\b[^>]*>([\s\S]*?)<\/h4>/i)?.[1] || "";
        const summary = block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "";
        const link = block.match(/<a\b[^>]*href=(["'])(.*?)\1[^>]*>/i)?.[0] || "";
        const spans = [...block.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)];
        const category = attribute(match[0], "data-city") || "jaipur";
        const pagePath = attribute(link, "href").replace(/^\/+/, "/");
        const slug = path.posix.basename(pagePath).replace(/\.html$/i, "");

        if (!slug || !heading) continue;

        cards.push({
            slug,
            name: textContent(heading),
            category,
            location_label: spans[0] ? textContent(spans[0][1]) : "",
            location: spans[1] ? textContent(spans[1][1]) : "",
            summary: textContent(summary),
            card_image: attribute(imageTag, "src").replace(/^(?:\.\.\/)?/, "/"),
            page_path: pagePath,
            sort_order: cards.length
        });
    }

    return cards;
}

function parseProjectDetail(project, rootDirectory) {
    const filePath = path.join(rootDirectory, project.page_path.replace(/^\//, ""));
    if (!fs.existsSync(filePath)) return {};

    const source = fs.readFileSync(filePath, "utf8");
    const title = textContent(source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
    const seoDescription = attribute(
        source.match(/<meta\b[^>]*name=(["'])description\1[^>]*>/i)?.[0] || "",
        "content"
    );
    const description = textContent(
        source.match(/<h3\b[^>]*>\s*Project Description\s*<\/h3>\s*<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ||
        source.match(/<div\b[^>]*id=(["'])villa\1[^>]*>[\s\S]*?<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[2] ||
        ""
    );
    const imagePaths = [...source.matchAll(/<img\b[^>]*src=(["'])(.*?)\1[^>]*>/gi)]
        .map(match => match[2])
        .filter(image => image.includes("../images/") && !/\/map\./i.test(image))
        .map(image => image.replace(/^\.\.\//, "/"));
    const layoutImage = [...source.matchAll(/<img\b[^>]*>/gi)]
        .map(match => match[0])
        .find(tag => /alt=(["'])Layout Map\1/i.test(tag));
    const mapImage = layoutImage ? attribute(layoutImage, "src").replace(/^\.\.\//, "/") : "";
    const amenities = [...source.matchAll(/<div\b[^>]*class=(["'])[^"']*\bamenity-card\b[^"']*\1[^>]*>([\s\S]*?)<\/div>/gi)]
        .map(match => {
            const iconTag = match[2].match(/<i\b[^>]*>/i)?.[0] || "";
            const label = textContent(match[2].match(/<h6\b[^>]*>([\s\S]*?)<\/h6>/i)?.[1] || "");
            const iconClass = attribute(iconTag, "class")
                .split(/\s+/)
                .find(className => className.startsWith("bi-")) || "bi-check-circle";
            return label ? { label, icon: iconClass } : null;
        })
        .filter(Boolean);
    const videoUrl = source.match(/<a\b[^>]*href=(["'])(https?:\/\/(?:www\.)?youtube\.com\/[^"']+)\1/i)?.[2] || "";
    const firstSection = source.slice(
        source.indexOf("<section"),
        source.indexOf("</section>", source.indexOf("<section")) + "</section>".length
    );
    const bannerLabel = textContent(firstSection.match(/<span\b[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");

    return {
        banner_label: bannerLabel,
        page_title: title,
        seo_description: seoDescription,
        description,
        gallery_json: JSON.stringify(imagePaths.slice(0, project.slug === "riyasatsankalpvilla" ? 6 : 8)),
        layout_image: mapImage,
        map_image: mapImage,
        amenities_json: JSON.stringify(amenities),
        video_url: videoUrl
    };
}

function seedInitialContent(rootDirectory = process.cwd()) {
    const now = new Date().toISOString();
    const insertBlogPost = db.prepare(`
        INSERT OR IGNORE INTO cms_blog_posts
            (slug, title, excerpt, content, category, featured_image, published_at,
             status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)
    `);
    const demoPosts = [
        [
            "modern-real-estate-investment",
            "A Guide to Modern Real Estate Investment",
            "Explore how location, long-term planning, and careful due diligence can help shape a thoughtful real estate investment.",
            [
                "Real estate can be a meaningful part of a long-term financial plan. The strongest decisions begin with clear goals: understand your time horizon, the level of involvement you want, and how a property fits your wider plans.",
                "Location remains central. Look beyond a headline price and consider access to employment, transport, education, everyday services, and planned infrastructure. A growing neighbourhood can be promising, but future development is never guaranteed.",
                "Before committing, review ownership documents, approvals, taxes, maintenance costs, and the practical demand for the property. Compare similar options and allow room in your budget for unexpected expenses.",
                "A measured approach, independent advice, and careful verification can help investors make decisions with greater confidence. Every investment carries risk, so assess each opportunity against your own circumstances."
            ].join("\n\n"),
            "Investment Guide",
            "/images/neelkanth/1.png",
            "2026-10-25"
        ],
        [
            "buying-your-dream-home",
            "What to Look for Before Buying Your Dream Home",
            "A practical checklist for comparing homes, understanding the paperwork, and choosing a property that suits everyday life.",
            [
                "Buying a home is both a financial decision and a personal one. Start by listing what matters most to your household, including location, commute, room to grow, and access to essential services.",
                "Inspect the property in person and look carefully at construction quality, natural light, ventilation, water supply, drainage, and ongoing maintenance. Ask about community rules and recurring charges before making a decision.",
                "Take time to verify the title, approvals, plans, tax records, and any outstanding dues with qualified professionals. Make sure the terms, payment schedule, and possession details are clear in writing.",
                "Compare homes within a realistic budget and avoid rushing because of pressure. A well-informed choice is one that works for your needs today while remaining practical for the years ahead."
            ].join("\n\n"),
            "Home Buying",
            "/images/heritage/1.png",
            "2026-10-20"
        ]
    ];
    for (const post of demoPosts) {
        insertBlogPost.run(...post, now, now);
    }

    const pageFiles = [
        ["index", "/", "Home", "index.html"],
        ["about", "/about.html", "About Us", "about.html"],
        ["career", "/career.html", "Career", "career.html"],
        ["contact", "/contact.html", "Contact", "contact.html"],
        ["projects", "/projects.html", "Projects", "projects.html"],
        ["privacypolicy", "/privacypolicy.html", "Privacy Policy", "privacypolicy.html"],
        ["why-us", "/why-us.html", "Why Us", "why-us.html"]
    ];
    const insertPage = db.prepare(`
        INSERT OR IGNORE INTO cms_pages
            (slug, path, label, title, seo_title, seo_description, content_json, status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?)
    `);

    for (const [slug, publicPath, label, filename] of pageFiles) {
        const filePath = path.join(rootDirectory, filename);
        if (!fs.existsSync(filePath)) continue;
        const source = fs.readFileSync(filePath, "utf8");
        const title = textContent(source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || label);
        const descriptionTag = source.match(/<meta\b[^>]*name=(["'])description\1[^>]*>/i)?.[0] || "";
        insertPage.run(
            slug,
            publicPath,
            label,
            title,
            title,
            attribute(descriptionTag, "content"),
            JSON.stringify(extractPageFields(source)),
            now
        );
        const existingPage = db.prepare("SELECT content_json FROM cms_pages WHERE slug = ?").get(slug);
        const content = JSON.parse(existingPage.content_json);
        const defaults = extractPageFields(source);
        let changed = false;
        for (const [key, value] of Object.entries(defaults)) {
            if (!Object.hasOwn(content, key)) {
                content[key] = value;
                changed = true;
            }
        }
        if (changed) {
            db.prepare("UPDATE cms_pages SET content_json = ? WHERE slug = ?")
                .run(JSON.stringify(content), slug);
        }
    }

    const listingPath = path.join(rootDirectory, "projects.html");
    if (!fs.existsSync(listingPath)) return;
    const cards = parseProjectCards(fs.readFileSync(listingPath, "utf8"));
    const featuredSource = fs.readFileSync(path.join(rootDirectory, "index.html"), "utf8");
    const insertProject = db.prepare(`
        INSERT OR IGNORE INTO cms_projects
            (slug, name, category, location_label, banner_label, location, summary, description,
             page_title, seo_description, card_image, gallery_json, layout_image,
             map_image, amenities_json, video_url, page_path, featured, sort_order,
             status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)
    `);

    for (const card of cards) {
        const detail = parseProjectDetail(card, rootDirectory);
        const featured = new RegExp(`(?:/|\\b)${card.slug}\\.html`, "i").test(featuredSource);
        insertProject.run(
            card.slug,
            card.name,
            card.category,
            card.location_label,
            detail.banner_label || card.location_label,
            card.location,
            card.summary,
            detail.description || "",
            detail.page_title || card.name,
            detail.seo_description || "",
            card.card_image,
            detail.gallery_json || "[]",
            detail.layout_image || "",
            detail.map_image || "",
            detail.amenities_json || "[]",
            detail.video_url || "",
            card.page_path,
            featured ? 1 : 0,
            card.sort_order,
            now
        );
    }

    const footer = fs.readFileSync(listingPath, "utf8").match(/<footer\b[\s\S]*?<\/footer>/i)?.[0] || "";
    const settingValues = {};
    for (const [, paragraph] of footer.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
        const iconClass = paragraph.match(/<i\b[^>]*class=(["'])(.*?)\1/i)?.[2] || "";
        const value = textContent(paragraph.replace(/<i\b[^>]*>[\s\S]*?<\/i>/i, ""))
            .replace(/^(?:Phone|WhatsApp|Email):\s*/i, "");
        if (iconClass.includes("bi-geo-alt")) settingValues.officeAddress = value;
        if (iconClass.includes("bi-telephone")) settingValues.phone = value;
        if (iconClass.includes("bi-whatsapp")) settingValues.whatsapp = value;
        if (iconClass.includes("bi-envelope")) settingValues.email = value;
    }

    const insertSetting = db.prepare(`
        INSERT OR IGNORE INTO cms_settings (key, value, updated_at) VALUES (?, ?, ?)
    `);
    for (const [key, value] of Object.entries(settingValues)) {
        if (value) insertSetting.run(key, value, now);
    }

    const contactPath = path.join(rootDirectory, "contact.html");
    if (fs.existsSync(contactPath)) {
        const contactSource = fs.readFileSync(contactPath, "utf8");
        const businessHours = textContent(
            contactSource.match(/<h5>\s*Business Hours\s*<\/h5>\s*<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || ""
        );
        if (businessHours) insertSetting.run("businessHours", businessHours, now);
    }
}

function projectFromRow(row) {
    if (!row) return null;
    return {
        ...row,
        page_path: `/projects/${row.slug}`,
        gallery: JSON.parse(row.gallery_json),
        amenities: JSON.parse(row.amenities_json),
        featured: Boolean(row.featured)
    };
}

function pageFromRow(row) {
    if (!row) return null;
    const page = { ...row };
    if (typeof page.content_json === "string") {
        page.content = JSON.parse(page.content_json);
        delete page.content_json;
    }
    return page;
}

function extractPageFields(source) {
    const fields = {};
    for (const match of source.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bdata-cms-field=(["'])(.*?)\3[^>]*)>([\s\S]*?)<\/\1>/gi)) {
        fields[match[4]] = textContent(match[5]);
    }
    for (const match of source.matchAll(/<img\b[^>]*\bdata-cms-image=(["'])(.*?)\1[^>]*>/gi)) {
        const key = match[2];
        fields[key] = attribute(match[0], "src").replace(/^(?:\.\.\/)?/, "/");
    }
    return fields;
}

module.exports = {
    db,
    dataDirectory,
    databasePath,
    projectFromRow,
    pageFromRow,
    extractPageFields,
    seedInitialContent
};
