const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { DatabaseSync, backup } = require("node:sqlite");
const { buildDryRunReport } = require("./dry-run-project-recovery");

const projectRoot = path.resolve(__dirname, "..");
const databaseName = "raj-real-estate-local";
const persistenceDirectory = path.join(projectRoot, "local-data", "wrangler");
const d1PersistenceDirectory = path.join(persistenceDirectory, "v3", "d1");
const backupDirectory = path.join(projectRoot, "local-data", "backups");
const wranglerPath = require.resolve("wrangler");
const supportedFields = new Set([
    "banner_label", "description", "page_title", "seo_description",
    "gallery_json", "layout_image", "map_image", "amenities_json", "video_url"
]);

function databaseFiles(directory) {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const entryPath = path.join(directory, entry.name);
        return entry.isDirectory() ? databaseFiles(entryPath) : entry.name.endsWith(".sqlite") ? [entryPath] : [];
    });
}

function localD1File() {
    const matches = [];
    for (const filePath of databaseFiles(d1PersistenceDirectory)) {
        let database;
        try {
            database = new DatabaseSync(filePath, { readOnly: true });
            const tables = new Set(database.prepare(`
                SELECT name FROM sqlite_master
                WHERE type = 'table' AND name IN ('cms_projects', 'inquiries')
            `).all().map(row => row.name));
            if (tables.has("cms_projects") && tables.has("inquiries")) matches.push(filePath);
        } catch {
            continue;
        } finally {
            database?.close();
        }
    }
    if (matches.length !== 1) {
        throw new Error(`Expected one local D1 database containing CMS projects and inquiries; found ${matches.length}.`);
    }
    return matches[0];
}

function projectCounts(database) {
    return {
        projects: database.prepare("SELECT COUNT(*) AS count FROM cms_projects").get().count,
        inquiries: database.prepare("SELECT COUNT(*) AS count FROM inquiries").get().count
    };
}

async function createLocalBackup() {
    const databasePath = localD1File();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDirectory, `raj-real-estate-local-before-project-recovery-${timestamp}.sqlite`);
    if (fs.existsSync(backupPath)) throw new Error("The requested local D1 backup path already exists.");
    fs.mkdirSync(backupDirectory, { recursive: true });

    const source = new DatabaseSync(databasePath, { readOnly: true });
    try {
        const sourceCounts = projectCounts(source);
        await backup(source, backupPath);
        const snapshot = new DatabaseSync(backupPath, { readOnly: true });
        try {
            const integrity = snapshot.prepare("PRAGMA integrity_check").get();
            const backupCounts = projectCounts(snapshot);
            if (integrity.integrity_check !== "ok" ||
                backupCounts.projects !== sourceCounts.projects ||
                backupCounts.inquiries !== sourceCounts.inquiries) {
                throw new Error("Local D1 backup verification failed; no recovery updates were applied.");
            }
        } finally {
            snapshot.close();
        }
    } finally {
        source.close();
    }
    return backupPath;
}

function sqlString(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

function buildRecoveryStatement(report) {
    if (report.mode !== "read-only-dry-run" ||
        report.database?.name !== databaseName ||
        report.database?.scope !== "local Wrangler D1 only" ||
        report.summary?.local_projects_missing !== 0 ||
        report.projects.length !== 11) {
        throw new Error("The fresh local recovery report does not match the approved 11-project scope.");
    }

    const assignments = new Map();
    const slugs = [];
    for (const project of report.projects) {
        slugs.push(project.slug);
        for (const field of project.fields) {
            if (field.action !== "fill_empty_after_approval") continue;
            if (!supportedFields.has(field.field) || !field.source_file || !field.proposed) {
                throw new Error(`A proposed recovery field is outside the approved CMS scope: ${field.field}.`);
            }
            if (field.asset_checks?.some(asset => !asset.exists)) {
                throw new Error(`An image reference is not verified locally for project ${project.slug}.`);
            }
            if (!assignments.has(field.field)) assignments.set(field.field, []);
            assignments.get(field.field).push({ slug: project.slug, value: field.proposed });
        }
    }

    if (!assignments.size) throw new Error("No empty supported project fields remain to recover.");
    const setClauses = [...assignments].map(([field, entries]) => {
        const cases = entries.map(({ slug, value }) =>
            `WHEN slug = ${sqlString(slug)} AND (${field} IS NULL OR trim(${field}) IN ('', '[]', '{}')) THEN ${sqlString(value)}`
        ).join("\n");
        return `${field} = CASE\n${cases}\nELSE ${field} END`;
    });
    return `UPDATE cms_projects\nSET ${setClauses.join(",\n")}\nWHERE slug IN (${slugs.map(sqlString).join(", ")});\n`;
}

function executeLocalSql(sqlPath) {
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
        "--json",
        "--yes"
    ], {
        cwd: projectRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 8 * 1024 * 1024
    });
}

function verifyRecovery(before, after) {
    const afterBySlug = new Map(after.projects.map(project => [project.slug, project]));
    let restoredFields = 0;
    for (const project of before.projects) {
        const recoveredProject = afterBySlug.get(project.slug);
        if (!recoveredProject) throw new Error(`Project ${project.slug} disappeared after local recovery.`);
        const afterFields = new Map(recoveredProject.fields.map(field => [field.field, field]));
        for (const field of project.fields) {
            const recoveredField = afterFields.get(field.field);
            if (field.action === "fill_empty_after_approval") {
                if (recoveredField.existing !== field.proposed) {
                    throw new Error(`Recovery verification failed for ${project.slug}.${field.field}.`);
                }
                restoredFields += 1;
            } else if (recoveredField.existing !== field.existing) {
                throw new Error(`An existing value changed unexpectedly for ${project.slug}.${field.field}.`);
            }
        }
    }
    return restoredFields;
}

async function apply() {
    const before = buildDryRunReport();
    const sql = buildRecoveryStatement(before);
    const backupPath = await createLocalBackup();
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "raj-project-recovery-"));
    const sqlPath = path.join(temporaryDirectory, "empty-fields-only.sql");

    try {
        fs.writeFileSync(sqlPath, sql, { encoding: "utf8", flag: "wx" });
        executeLocalSql(sqlPath);
    } catch (error) {
        throw new Error(`Local D1 recovery failed; the verified backup was retained at ${path.relative(projectRoot, backupPath)}.`, {
            cause: error
        });
    } finally {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }

    const after = buildDryRunReport();
    const fields = verifyRecovery(before, after);
    console.log(JSON.stringify({
        mode: "applied-locally",
        database: databaseName,
        projects: after.projects.length,
        fields_restored: fields,
        conflicts_overwritten: 0,
        unsupported_facts_written: 0,
        migrations_applied: 0,
        backup_file: path.relative(projectRoot, backupPath)
    }));
}

if (require.main === module) {
    if (process.argv.length !== 3 || process.argv[2] !== "--apply") {
        console.error("Use node scripts/apply-project-recovery.js --apply.");
        process.exitCode = 1;
    } else {
        apply().catch(error => {
            console.error(`Project data recovery failed: ${error.message}`);
            process.exitCode = 1;
        });
    }
}

module.exports = { buildRecoveryStatement };
