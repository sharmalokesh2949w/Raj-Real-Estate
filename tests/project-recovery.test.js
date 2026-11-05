const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const {
    assetCheck,
    buildProjectReport,
    supplementalImageAssets,
    supplementalProjectFacts
} = require("../scripts/dry-run-project-recovery");
const { buildRecoveryStatement } = require("../scripts/apply-project-recovery");
const { collectStaticContent } = require("../scripts/import-static-content-to-d1");

const root = path.resolve(__dirname, "..");

test("project detail parsing resolves listing routes to original .html pages", () => {
    const projects = collectStaticContent().projects;
    assert.equal(projects.length, 11);

    assert.ok(projects.every(project => project.source_file.startsWith("projects/")));
    assert.ok(projects.every(project => project.description.length > 0));
    assert.ok(projects.every(project => JSON.parse(project.gallery_json).length > 0));
    assert.ok(projects.every(project => JSON.parse(project.amenities_json).length > 0));

    for (const project of projects) {
        for (const imagePath of JSON.parse(project.gallery_json)) {
            assert.equal(assetCheck(imagePath, root).exists, true, `${project.source_file}: ${imagePath}`);
        }
        for (const imagePath of [project.layout_image, project.map_image].filter(Boolean)) {
            assert.equal(assetCheck(imagePath, root).exists, true, `${project.source_file}: ${imagePath}`);
        }
    }

    const heritage = projects.find(project => project.slug === "heritage");
    assert.deepEqual(heritage.source_facts.slice(0, 3), [
        { label: "Project Area", value: "10 hector" },
        { label: "Project RERA", value: "RAJ/P/2025/3524" },
        { label: "Location Status", value: "High Growth Potential" }
    ]);
    const villa = projects.find(project => project.slug === "riyasatsankalpvilla");
    assert.ok(villa.source_facts.some(fact =>
        fact.label === "RERA registration reference" &&
        fact.value === "Registration No. P52000054353"
    ));
});

test("supplemental source facts retain exact source without resolving conflicts", () => {
    const records = supplementalProjectFacts(root);
    assert.equal(records.length, 4);
    const sankalp = records.find(record => record.slug === "the-riyasat-sankalp");
    assert.ok(sankalp.facts.some(fact =>
        fact.label === "Infrastructure / roads" &&
        fact.value === "Roads of 9 m, 12 m and 30 m widths" &&
        fact.source_file === "Propertys/index.html"
    ));

    const bliss = records.find(record => record.slug === "riyasat-bliss");
    assert.ok(bliss.facts.some(fact => fact.label === "Project size" && fact.value === "23 acres"));
    assert.ok(bliss.facts.some(fact => fact.label === "Approvals and RERA" && fact.value === "MahaRERA No. P52000079379"));

    const mappedImages = supplementalImageAssets(root);
    assert.ok(mappedImages.length > 0);
    assert.ok(mappedImages.every(image => image.source_file === "Propertys/index.html"));
    assert.ok(mappedImages.some(image => image.exists));
    assert.ok(mappedImages.some(image => !image.exists));
});

test("dry-run comparison fills only empty values and flags source conflicts", () => {
    const local = [{
        slug: "heritage",
        name: "Heritage",
        location: "Existing location",
        description: "",
        gallery_json: "[]",
        map_image: ""
    }];
    const source = [{
        slug: "heritage",
        name: "Heritage",
        location: "Recovered location",
        description: "Recovered description",
        gallery_json: "[\"/images/heritage/1.png\"]",
        map_image: "/images/heritage/map.png",
        source_file: "projects/heritage.html",
        source_facts: [{ label: "Project Area", value: "10 hector" }]
    }];
    const supplemental = [{
        slug: "heritage",
        facts: [{ label: "Location", value: "A different source location", source_file: "Propertys/index.html" }]
    }];
    const [report] = buildProjectReport(local, source, supplemental);
    assert.equal(report.fields.find(field => field.field === "description").action, "fill_empty_after_approval");
    assert.equal(report.fields.find(field => field.field === "location").action, "keep_existing_review_conflict");
    assert.equal(report.fields.find(field => field.field === "gallery_json").action, "fill_empty_after_approval");
    assert.equal(report.source_facts[0].action, "review_required_schema_extension");
    assert.equal(report.source_facts[0].source_file, "projects/heritage.html");
    assert.equal(report.source_fact_conflicts[0].action, "review_required_no_value_selected");

    const [villa] = buildProjectReport([{
        slug: "riyasatsankalpvilla",
        name: "Riyasat Sankalp Villa",
        location: "Mumbai, Maharashtra"
    }], [{
        slug: "riyasatsankalpvilla",
        name: "Riyasat Sankalp Villa",
        source_file: "projects/riyasatsankalpvilla.html",
        source_facts: [{ label: "Location", value: "Panvel, Navi Mumbai" }]
    }], []);
    assert.equal(villa.source_fact_conflicts[0].existing, "Mumbai, Maharashtra");
    assert.equal(villa.source_fact_conflicts[0].values[1].value, "Panvel, Navi Mumbai");
});

test("local recovery SQL is empty-only and changes no non-empty project fields", () => {
    const projects = Array.from({ length: 11 }, (_, index) => ({
        slug: `project-${index}`,
        fields: [{
            field: "description",
            existing: "",
            proposed: `Recovered description ${index}`,
            source_file: `projects/project-${index}.html`,
            action: "fill_empty_after_approval"
        }]
    }));
    projects[1].fields[0].existing = "Existing description";
    projects[1].fields[0].action = "keep_existing";
    projects[0].fields.push({
        field: "gallery_json",
        existing: "[]",
        proposed: "[\"/images/project-0/1.png\"]",
        source_file: "projects/project-0.html",
        asset_checks: [{ exists: true }],
        action: "fill_empty_after_approval"
    });
    const report = {
        mode: "read-only-dry-run",
        database: { name: "raj-real-estate-local", scope: "local Wrangler D1 only" },
        summary: { local_projects_missing: 0 },
        projects
    };
    const sql = buildRecoveryStatement(report);
    const database = new DatabaseSync(":memory:");
    try {
        database.exec(`
            CREATE TABLE cms_projects (
                slug TEXT PRIMARY KEY,
                description TEXT NOT NULL DEFAULT '',
                gallery_json TEXT NOT NULL DEFAULT '[]',
                location TEXT NOT NULL DEFAULT ''
            );
        `);
        const insert = database.prepare("INSERT INTO cms_projects (slug, description, location) VALUES (?, ?, ?)");
        for (const project of projects) {
            insert.run(project.slug, project.slug === "project-1" ? "Existing description" : "", "Existing location");
        }
        database.exec(sql);
        assert.equal(
            database.prepare("SELECT description FROM cms_projects WHERE slug = 'project-0'").get().description,
            "Recovered description 0"
        );
        assert.equal(
            database.prepare("SELECT gallery_json FROM cms_projects WHERE slug = 'project-0'").get().gallery_json,
            "[\"/images/project-0/1.png\"]"
        );
        assert.equal(
            database.prepare("SELECT description FROM cms_projects WHERE slug = 'project-1'").get().description,
            "Existing description"
        );
        assert.equal(
            database.prepare("SELECT location FROM cms_projects WHERE slug = 'project-1'").get().location,
            "Existing location"
        );
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM cms_projects").get().count, 11);
        assert.throws(() => buildRecoveryStatement({
            ...report,
            projects: report.projects.map(project => ({
                ...project,
                fields: [{ ...project.fields[0], field: "status" }]
            }))
        }), /outside the approved CMS scope/);
    } finally {
        database.close();
    }
});
