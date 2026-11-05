const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const databaseName = "raj-real-estate-local";
const persistenceDirectory = path.join(projectRoot, "local-data", "wrangler");
const databaseModule = path.join(projectRoot, "cms", "database.js");

function restoreEnvironment(name, value) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}

function collectStaticContent() {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "raj-static-content-"));
    const environment = Object.fromEntries(
        ["CMS_DATABASE_PATH", "CMS_DATA_DIR", "CMS_UPLOAD_DIR"]
            .map(name => [name, process.env[name]])
    );
    let database;

    try {
        process.env.CMS_DATABASE_PATH = path.join(temporaryDirectory, "source.sqlite");
        process.env.CMS_DATA_DIR = temporaryDirectory;
        process.env.CMS_UPLOAD_DIR = path.join(temporaryDirectory, "uploads");

        delete require.cache[databaseModule];
        const cmsDatabase = require(databaseModule);
        database = cmsDatabase.db;
        cmsDatabase.seedInitialContent(projectRoot);
        const detailSources = new Map(
            cmsDatabase.parseProjectCards(fs.readFileSync(path.join(projectRoot, "projects.html"), "utf8"))
                .map(card => [card.slug, cmsDatabase.parseProjectDetail(card, projectRoot)])
        );

        return {
            pages: database.prepare(`
                SELECT slug, path, label, title, seo_title, seo_description, content_json, status, updated_at
                FROM cms_pages ORDER BY slug
            `).all(),
            projects: database.prepare(`
                SELECT slug, name, category, location_label, banner_label, location, summary, description,
                       page_title, seo_description, card_image, gallery_json, layout_image, map_image,
                       amenities_json, video_url, page_path, featured, sort_order, status, updated_at
                FROM cms_projects ORDER BY sort_order, slug
            `).all().map(project => ({
                ...project,
                source_file: detailSources.get(project.slug)?.source_file || "",
                source_facts: detailSources.get(project.slug)?.source_facts || []
            })),
            settings: database.prepare(`
                SELECT key, value, updated_at FROM cms_settings ORDER BY key
            `).all()
        };
    } finally {
        database?.close();
        delete require.cache[databaseModule];
        for (const [name, value] of Object.entries(environment)) {
            restoreEnvironment(name, value);
        }
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
}

function sqlValue(value) {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "number") return String(value);
    if (typeof value !== "string") {
        throw new TypeError("Static content contains an unsupported SQL value.");
    }
    return `'${value.replace(/'/g, "''")}'`;
}

function insertStatement(table, columns, values, conflictColumn) {
    return `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${values.map(sqlValue).join(", ")}) ON CONFLICT(${conflictColumn}) DO NOTHING;`;
}

function buildImportSql(content) {
    const statements = [];
    for (const page of content.pages) {
        statements.push(insertStatement("cms_pages", [
            "slug", "path", "label", "title", "seo_title", "seo_description",
            "content_json", "status", "updated_at"
        ], [
            page.slug, page.path, page.label, page.title, page.seo_title, page.seo_description,
            page.content_json, page.status, page.updated_at
        ], "slug"));
    }
    for (const project of content.projects) {
        statements.push(insertStatement("cms_projects", [
            "slug", "name", "category", "location_label", "banner_label", "location", "summary",
            "description", "page_title", "seo_description", "card_image", "gallery_json",
            "layout_image", "map_image", "amenities_json", "video_url", "page_path", "featured",
            "sort_order", "status", "updated_at"
        ], [
            project.slug, project.name, project.category, project.location_label, project.banner_label,
            project.location, project.summary, project.description, project.page_title,
            project.seo_description, project.card_image, project.gallery_json, project.layout_image,
            project.map_image, project.amenities_json, project.video_url, project.page_path,
            project.featured, project.sort_order, project.status, project.updated_at
        ], "slug"));
    }
    for (const setting of content.settings) {
        statements.push(insertStatement("cms_settings", [
            "key", "value", "updated_at"
        ], [
            setting.key, setting.value, setting.updated_at
        ], "key"));
    }
    return `${statements.join("\n")}\n`;
}

function importSummary(content, mode) {
    return {
        mode,
        pages: content.pages.length,
        projects: content.projects.length,
        settings: content.settings.length,
        blogPosts: 0,
        inquiries: 0,
        note: "Only missing static-content records are inserted; existing D1 records are never updated or deleted."
    };
}

function applyToLocalD1(sql) {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "raj-d1-import-sql-"));
    const sqlPath = path.join(temporaryDirectory, "static-content.sql");
    const wranglerPath = require.resolve("wrangler");
    try {
        fs.writeFileSync(sqlPath, sql, { encoding: "utf8", flag: "wx" });
        execFileSync(process.execPath, [
            wranglerPath,
            "d1",
            "execute",
            databaseName,
            "--local",
            "--persist-to",
            persistenceDirectory,
            "--file",
            sqlPath,
            "--yes"
        ], {
            cwd: projectRoot,
            stdio: "inherit"
        });
    } finally {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
}

function main(args = process.argv.slice(2)) {
    const unsupported = args.filter(argument => !["--dry-run", "--apply"].includes(argument));
    if (unsupported.length || (args.includes("--dry-run") && args.includes("--apply"))) {
        throw new Error("Use either --dry-run or --apply.");
    }

    const content = collectStaticContent();
    if (!content.pages.some(page => page.slug === "index") || !content.projects.length) {
        throw new Error("Static homepage or project content was not found; no D1 changes were made.");
    }

    const applying = args.includes("--apply");
    if (applying) applyToLocalD1(buildImportSql(content));
    console.log(JSON.stringify(importSummary(content, applying ? "applied-locally" : "dry-run")));
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(`Static D1 content import failed: ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = { buildImportSql, collectStaticContent, importSummary };
