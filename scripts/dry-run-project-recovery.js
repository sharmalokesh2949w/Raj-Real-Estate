const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { collectStaticContent } = require("./import-static-content-to-d1");

const projectRoot = path.resolve(__dirname, "..");
const databaseName = "raj-real-estate-local";
const persistenceDirectory = path.join(projectRoot, "local-data", "wrangler");
const wranglerPath = require.resolve("wrangler");
const localFields = [
    "slug", "name", "category", "location_label", "banner_label", "location", "summary",
    "description", "page_title", "seo_description", "card_image", "gallery_json",
    "layout_image", "map_image", "amenities_json", "video_url", "page_path", "status"
];
const detailFields = new Set([
    "banner_label", "description", "page_title", "seo_description", "gallery_json",
    "layout_image", "map_image", "amenities_json", "video_url"
]);
const cardFields = new Set([
    "name", "category", "location_label", "location", "summary", "card_image", "page_path"
]);
const supplementalSlugMap = {
    sankalp: "the-riyasat-sankalp",
    bliss: "riyasat-bliss",
    royalcrest: "riyasat-royalcrest",
    montera: "riyasat-montera"
};
const supplementalLabels = [
    ["location", "Location"],
    ["size", "Project size"],
    ["types", "Property types / configuration"],
    ["amenities", "Amenities"],
    ["infra", "Infrastructure / roads"],
    ["advantages", "Advantages"],
    ["landmarks", "Landmarks"],
    ["connectivity", "Connectivity"],
    ["approvals", "Approvals and RERA"],
    ["offer", "Offer"]
];

function readLocalProjects() {
    const query = `SELECT ${localFields.join(", ")} FROM cms_projects WHERE status != 'deleted' ORDER BY sort_order, slug`;
    const output = execFileSync(process.execPath, [
        wranglerPath,
        "d1",
        "execute",
        databaseName,
        "--local",
        "--persist-to",
        persistenceDirectory,
        "--command",
        query,
        "--json"
    ], {
        cwd: projectRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 8 * 1024 * 1024
    });
    const response = JSON.parse(output);
    const result = response.find(item => Array.isArray(item?.results));
    if (!result?.success) throw new Error("Wrangler did not return a successful local D1 query.");
    return result.results;
}

function extractScalar(block, key) {
    const match = block.match(new RegExp(`\\b${key}:\\s*(?:"([^"]*)"|'([^']*)'|null)`));
    if (!match) return null;
    return match[1] ?? match[2] ?? null;
}

function extractStringArray(block, key) {
    const match = block.match(new RegExp(`\\b${key}:\\s*\\[([\\s\\S]*?)\\]`));
    return match ? [...match[1].matchAll(/"([^"]*)"/g)].map(item => item[1]) : null;
}

function extractValue(block, key) {
    const scalar = extractScalar(block, key);
    if (scalar !== null) return scalar;
    return extractStringArray(block, key);
}

function supplementalProjectFacts(root = projectRoot) {
    const sourceFile = "Propertys/index.html";
    const source = fs.readFileSync(path.join(root, sourceFile), "utf8");
    const start = source.indexOf("var PROJECTS = [");
    const end = source.indexOf("\n  ];", start);
    if (start < 0 || end < 0) throw new Error(`Could not locate project data in ${sourceFile}.`);

    const records = [];
    const projectSource = source.slice(start, end);
    const projectBlocks = [...projectSource.matchAll(/\{\s*slug:\s*"([^"]+)"([\s\S]*?)(?=\n    \},?)/g)];
    for (const match of projectBlocks) {
        const slug = match[1];
        const body = match[2];
        const projectSlug = supplementalSlugMap[slug];
        if (!projectSlug) continue;

        const facts = [];
        for (const [key, label] of supplementalLabels) {
            const value = extractValue(body, key);
            if (value !== null && value !== undefined) {
                facts.push({ label, value, source_file: sourceFile });
            }
        }
        records.push({ slug: projectSlug, source_file: sourceFile, facts });
    }
    return records;
}

function supplementalImageAssets(root = projectRoot) {
    const sourceFile = "Propertys/index.html";
    const source = fs.readFileSync(path.join(root, sourceFile), "utf8");
    const start = source.indexOf("var IMGS = {");
    const end = source.indexOf("\n  };", start);
    if (start < 0 || end < 0) throw new Error(`Could not locate image mappings in ${sourceFile}.`);

    return [...source.slice(start, end).matchAll(/"([^"]+)":\s*"([^"]+)"/g)]
        .map(match => {
            const [projectKey, imageName] = match[1].split("/");
            const projectSlug = supplementalSlugMap[projectKey];
            if (!projectSlug) return null;
            const sourcePath = decodeURIComponent(match[2]).replace(/\\/g, "/");
            const exists = fs.existsSync(path.join(root, ...sourcePath.split("/")));
            return {
                slug: projectSlug,
                mapping_key: match[1],
                source_path: sourcePath,
                source_file: sourceFile,
                exists,
                status: exists ? "found_outside_cms_image_roots" : "missing_source_asset"
            };
        })
        .filter(Boolean);
}

function isEmpty(value) {
    if (value === null || value === undefined) return true;
    if (typeof value !== "string") return false;
    const trimmed = value.trim();
    return !trimmed || trimmed === "[]" || trimmed === "{}";
}

function normalize(value) {
    if (typeof value !== "string") return JSON.stringify(value);
    try {
        return JSON.stringify(JSON.parse(value));
    } catch {
        return value.trim();
    }
}

function assetCheck(imagePath, root = projectRoot) {
    const safePath = typeof imagePath === "string" &&
        /^\/images\/[A-Za-z0-9._/-]+$/.test(imagePath) &&
        !imagePath.includes("..") &&
        !imagePath.includes("//");
    const filePath = safePath ? path.resolve(root, `.${imagePath}`) : "";
    const exists = Boolean(filePath && fs.existsSync(filePath));
    return {
        path: imagePath,
        exists,
        status: exists ? "verified_local_asset" : "missing_or_unsupported_path"
    };
}

function sourceFileFor(field, source) {
    if (detailFields.has(field)) return source.source_file || "";
    if (cardFields.has(field)) return "projects.html";
    return "";
}

function fieldAction(current, candidate, validAssets = true) {
    if (isEmpty(current) && isEmpty(candidate)) return "no_source_value";
    if (!isEmpty(current)) {
        return !isEmpty(candidate) && normalize(current) !== normalize(candidate)
            ? "keep_existing_review_conflict"
            : "keep_existing";
    }
    return validAssets ? "fill_empty_after_approval" : "review_missing_asset";
}

function buildProjectReport(localProjects, sourceProjects, supplementalRecords) {
    const localBySlug = new Map(localProjects.map(project => [project.slug, project]));
    const supplementalBySlug = new Map(supplementalRecords.map(project => [project.slug, project]));
    const supplementalImages = supplementalImageAssets();
    const sourceColumns = [
        "name", "category", "location_label", "banner_label", "location", "summary",
        "description", "page_title", "seo_description", "card_image", "gallery_json",
        "layout_image", "map_image", "amenities_json", "video_url", "page_path"
    ];

    return sourceProjects.map(sourceProject => {
        const current = localBySlug.get(sourceProject.slug);
        const detail = sourceProject;
        if (!current) {
            return {
                slug: sourceProject.slug,
                project_name: sourceProject.name,
                status: "review_required_missing_local_record",
                fields: sourceColumns.map(field => ({
                    field,
                    existing: null,
                    proposed: sourceProject[field] ?? "",
                    source_file: sourceFileFor(field, detail),
                    action: "no_existing_record"
                })),
                source_facts: detail.source_facts || [],
                supplemental_facts: supplementalBySlug.get(sourceProject.slug)?.facts || []
            };
        }

        const sourceFile = detail.source_file;
        const fields = sourceColumns.map(field => {
            const proposed = sourceProject[field] ?? "";
            let assetChecks = [];
            if (field === "card_image" && proposed) assetChecks = [assetCheck(proposed)];
            if (field === "gallery_json" && proposed) {
                assetChecks = JSON.parse(proposed).map(imagePath => assetCheck(imagePath));
            }
            if (["layout_image", "map_image"].includes(field) && proposed) {
                assetChecks = [assetCheck(proposed)];
            }
            const validAssets = assetChecks.every(asset => asset.exists);
            return {
                field,
                existing: current[field] ?? "",
                proposed,
                source_file: sourceFileFor(field, detail),
                ...(assetChecks.length ? { asset_checks: assetChecks } : {}),
                action: fieldAction(current[field], proposed, validAssets)
            };
        });
        const extraFacts = (detail.source_facts || []).map(fact => ({
            ...fact,
            source_file: fact.source_file || detail.source_file,
            existing: null,
            schema_column_available: false,
            action: "review_required_schema_extension"
        }));
        const supplemental = supplementalBySlug.get(sourceProject.slug)?.facts || [];
        const sourceFactConflicts = [];
        const addSourceConflict = (field, entries, existing = null) => {
            const distinctValues = new Set(entries.map(entry => normalize(entry.value)));
            if (distinctValues.size < 2) return;
            sourceFactConflicts.push({
                field,
                existing,
                values: entries.map(entry => ({
                    value: entry.value,
                    source_file: entry.source_file
                })),
                action: "review_required_no_value_selected"
            });
        };
        const findFact = (facts, label) => facts.find(fact => fact.label === label);
        const projectArea = findFact(extraFacts, "Project Area");
        const projectSize = findFact(supplemental, "Project size");
        if (projectArea && projectSize) {
            addSourceConflict("Project area / project size", [projectArea, projectSize]);
        }
        const projectRera = findFact(extraFacts, "Project RERA");
        const supplementalRera = findFact(supplemental, "Approvals and RERA");
        if (projectRera && supplementalRera) {
            addSourceConflict("Project RERA / approvals", [projectRera, supplementalRera]);
        }
        const sourceLocation = findFact(supplemental, "Location") || findFact(extraFacts, "Location");
        if (sourceLocation && !isEmpty(current.location)) {
            addSourceConflict("Project location", [
                { value: current.location, source_file: "projects.html" },
                sourceLocation
            ], current.location);
        }
        const conflicts = fields.filter(field => field.action === "keep_existing_review_conflict")
            .map(field => ({
                field: field.field,
                existing: field.existing,
                source_value: field.proposed,
                source_file: field.source_file
            }));

        return {
            slug: sourceProject.slug,
            project_name: current.name,
            status: "review_required",
            fields,
            source_facts: extraFacts,
            supplemental_facts: supplemental.map(fact => ({
                ...fact,
                existing: null,
                schema_column_available: false,
                action: "review_required_schema_extension"
            })),
            supplemental_images: supplementalImages.filter(image => image.slug === sourceProject.slug),
            conflicts,
            source_fact_conflicts: sourceFactConflicts
        };
    });
}

function buildDryRunReport() {
    const content = collectStaticContent();
    const localProjects = readLocalProjects();
    const supplemental = supplementalProjectFacts();
    const supplementalImages = supplementalImageAssets();
    const projects = buildProjectReport(localProjects, content.projects, supplemental);
    const actions = projects.flatMap(project => project.fields.map(field => field.action));
    const localImageChecks = projects.flatMap(project => project.fields.flatMap(field => field.asset_checks || []));
    return {
        generated_at: new Date().toISOString(),
        mode: "read-only-dry-run",
        database: {
            name: databaseName,
            scope: "local Wrangler D1 only",
            project_records_read: localProjects.length,
            records_written: 0,
            migrations_applied: 0
        },
        source_files: [
            "projects.html",
            ...content.projects.map(project => project.source_file).filter(Boolean),
            ...supplemental.map(project => project.source_file)
        ].filter((value, index, list) => list.indexOf(value) === index),
        summary: {
            source_projects_found: content.projects.length,
            local_projects_matched: projects.filter(project => project.status !== "review_required_missing_local_record").length,
            local_projects_missing: projects.filter(project => project.status === "review_required_missing_local_record").length,
            fields_to_fill_after_approval: actions.filter(action => action === "fill_empty_after_approval").length,
            fields_preserved: actions.filter(action => action === "keep_existing").length,
            conflicts_requiring_review: projects.reduce((total, project) => total + (project.conflicts?.length || 0), 0),
            source_fact_conflicts_requiring_review: projects.reduce((total, project) =>
                total + (project.source_fact_conflicts?.length || 0), 0),
            unsupported_source_facts: projects.reduce((total, project) =>
                total + project.source_facts.length + project.supplemental_facts.length, 0),
            verified_local_project_images: localImageChecks.filter(image => image.exists).length,
            missing_local_project_images: localImageChecks.filter(image => !image.exists).length,
            supplemental_images_found_outside_cms_roots: supplementalImages.filter(image => image.exists).length,
            supplemental_images_missing: supplementalImages.filter(image => !image.exists).length
        },
        notes: [
            "This report reads only the local raj-real-estate-local D1 database and static project files.",
            "No D1 writes, migrations, backup creation, network requests, or production access occur in dry-run mode.",
            "Existing non-empty D1 values are never proposed for overwrite.",
            "Conflicting values are retained as separate source facts and require human review.",
            "Area, RERA, configuration, roads, and infrastructure are not represented by columns in the current CMS project schema; source facts are reported but not proposed for storage.",
            "Only image paths that resolve to an existing local /images asset are eligible for recovery.",
            "Propertys/index.html image mappings are reported separately because those source files are outside the CMS-supported /images and /uploads roots."
        ],
        projects
    };
}

function main(args = process.argv.slice(2)) {
    let outputPath = "";
    if (args.length) {
        if (args.length !== 2 || args[0] !== "--output") {
            throw new Error("Use node scripts/dry-run-project-recovery.js [--output <report.json>].");
        }
        outputPath = path.resolve(projectRoot, args[1]);
        if (outputPath === projectRoot || !outputPath.startsWith(`${projectRoot}${path.sep}`)) {
            throw new Error("The report output path must be inside the repository.");
        }
        if (fs.existsSync(outputPath)) throw new Error("The report output file already exists; choose a new path.");
    }

    const report = buildDryRunReport();
    const output = `${JSON.stringify(report, null, 2)}\n`;
    if (outputPath) {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, output, { encoding: "utf8", flag: "wx" });
        console.log(JSON.stringify({ mode: report.mode, report_file: path.relative(projectRoot, outputPath), ...report.summary }));
    } else {
        process.stdout.write(output);
    }
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(`Project data recovery dry run failed: ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = {
    assetCheck,
    buildDryRunReport,
    buildProjectReport,
    extractScalar,
    extractStringArray,
    extractValue,
    supplementalImageAssets,
    supplementalProjectFacts
};
