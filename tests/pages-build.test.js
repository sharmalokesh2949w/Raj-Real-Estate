const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildPages, isPrivateAssetPath, isPublicAssetPath } = require("../scripts/build-pages");

const root = path.resolve(__dirname, "..");

test("Pages asset allowlist excludes environment files and private server data", () => {
    for (const file of [
        ".env",
        ".env.production",
        "data/cms.sqlite",
        "data/uploads/image.png",
        "uploads/private.png",
        "functions/api/route.js",
        "cms/router.js",
        "node_modules/express/index.js",
        "private.key",
        "backup.sqlite-wal"
    ]) {
        assert.equal(isPrivateAssetPath(file), true, file);
        assert.equal(isPublicAssetPath(file), false, file);
    }
    assert.equal(isPublicAssetPath("server.js"), false);

    for (const file of [
        "index.html",
        "projects.html",
        "admin/index.html",
        "admin/admin.js",
        "css/custom.css",
        "images/heritage/1.png",
        "projects/heritage.html",
        "Propertys/index.html",
        "CNAME"
    ]) {
        assert.equal(isPublicAssetPath(file), true, file);
    }
});

test("Pages build emits website assets only and leaves local environment files untouched", () => {
    const localEnvPath = path.join(root, ".env");
    const envStatBefore = fs.existsSync(localEnvPath) ? fs.statSync(localEnvPath) : null;
    const temporaryRoot = fs.mkdtempSync(path.join(root, ".pages-build-test-"));
    const outputDirectory = path.join(temporaryRoot, "dist");

    try {
        const copiedFiles = buildPages({ rootDirectory: root, outputDirectory });

        assert.ok(copiedFiles.includes("index.html"));
        assert.ok(copiedFiles.includes("admin/admin.js"));
        assert.ok(copiedFiles.includes("js/site.js"));
        assert.ok(copiedFiles.includes("images/heritage/1.png"));
        assert.equal(fs.existsSync(path.join(outputDirectory, ".env")), false);
        assert.equal(fs.existsSync(path.join(outputDirectory, ".env.example")), false);
        assert.equal(fs.existsSync(path.join(outputDirectory, "server.js")), false);
        assert.equal(fs.existsSync(path.join(outputDirectory, "cms")), false);
        assert.equal(fs.existsSync(path.join(outputDirectory, "functions")), false);
        assert.equal(fs.existsSync(path.join(outputDirectory, "data")), false);
        assert.equal(fs.existsSync(path.join(outputDirectory, "uploads")), false);
        assert.equal(fs.existsSync(localEnvPath), Boolean(envStatBefore));
        if (envStatBefore) {
            assert.equal(fs.statSync(localEnvPath).size, envStatBefore.size);
        }
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
});
