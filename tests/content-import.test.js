const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const {
    buildImportSql,
    collectStaticContent,
    importSummary
} = require("../scripts/import-static-content-to-d1");

const root = path.resolve(__dirname, "..");

test("static content import is repeatable and preserves existing D1 records", () => {
    const content = collectStaticContent();
    assert.equal(content.pages.length, 7);
    assert.equal(content.projects.length, 11);
    assert.ok(content.settings.length > 0);

    const summary = importSummary(content, "dry-run");
    assert.equal(summary.blogPosts, 0);
    assert.equal(summary.inquiries, 0);
    assert.match(summary.note, /never updated or deleted/);

    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "raj-import-test-"));
    const database = new DatabaseSync(path.join(temporaryDirectory, "test.sqlite"));
    try {
        database.exec(fs.readFileSync(path.join(root, "migrations", "0001_cms_schema.sql"), "utf8"));
        const timestamp = new Date().toISOString();
        database.prepare(`
            INSERT INTO cms_pages
                (slug, path, label, title, seo_title, content_json, status, updated_at)
            VALUES ('index', '/', 'Home', 'Existing home', 'User-edited home', '{"custom":"keep"}', 'published', ?)
        `).run(timestamp);
        const existingProject = content.projects[0];
        database.prepare(`
            INSERT INTO cms_projects
                (slug, name, page_path, status, updated_at)
            VALUES (?, 'User-edited project', ?, 'draft', ?)
        `).run(existingProject.slug, existingProject.page_path, timestamp);
        database.prepare(`
            INSERT INTO cms_settings (key, value, updated_at)
            VALUES ('officeAddress', 'Existing local setting', ?)
        `).run(timestamp);
        database.prepare(`
            INSERT INTO cms_blog_posts
                (slug, title, excerpt, content, category, featured_image, published_at, status, created_at, updated_at)
            VALUES ('keep-this-post', 'Existing post', '', '', 'Existing', '/images/logo.png', ?, 'draft', ?, ?)
        `).run(timestamp, timestamp, timestamp);
        database.prepare(`
            INSERT INTO inquiries (name, phone, submitted_at)
            VALUES ('Existing enquiry', '0000000000', ?)
        `).run(timestamp);

        const importSql = buildImportSql(content);
        database.exec(importSql);
        database.exec(importSql);

        const home = database.prepare("SELECT seo_title, content_json FROM cms_pages WHERE slug = 'index'").get();
        assert.equal(home.seo_title, "User-edited home");
        assert.deepEqual(JSON.parse(home.content_json), { custom: "keep" });
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM cms_pages").get().count, 7);

        const project = database.prepare("SELECT name, status FROM cms_projects WHERE slug = ?")
            .get(existingProject.slug);
        assert.equal(project.name, "User-edited project");
        assert.equal(project.status, "draft");
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM cms_projects").get().count, 11);

        assert.equal(
            database.prepare("SELECT value FROM cms_settings WHERE key = 'officeAddress'").get().value,
            "Existing local setting"
        );
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM cms_blog_posts").get().count, 1);
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM inquiries").get().count, 1);
        assert.equal(
            database.prepare("SELECT COUNT(*) AS count FROM cms_pages WHERE slug = 'about' AND status = 'published'")
                .get().count,
            1
        );
        assert.ok(content.pages.find(page => page.slug === "index").content_json.includes("trustTitle"));
        assert.ok(content.projects.some(item => item.card_image.startsWith("/images/")));
    } finally {
        database.close();
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
});
