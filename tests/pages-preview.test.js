const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { collectStaticContent } = require("../scripts/import-static-content-to-d1");

const root = path.resolve(__dirname, "..");
const helperUrl = pathToFileURL(path.join(root, "functions", "_shared", "backend-proxy.mjs")).href;

async function loadPagesFunction(relativePath) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8")
        .replaceAll("../_shared/backend-proxy.mjs", helperUrl)
        .replaceAll(
            "../_shared/d1-cms.mjs",
            pathToFileURL(path.join(root, "functions", "_shared", "d1-cms.mjs")).href
        );
    const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
    return import(dataUrl);
}

class FakeElement {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.attributes = {};
        this.listeners = {};
        this.style = {};
        this.dataset = {};
        this.classList = {
            values: new Set(),
            add: (...values) => values.forEach(value => this.classList.values.add(value)),
            remove: (...values) => values.forEach(value => this.classList.values.delete(value))
        };
        this._textContent = "";
    }

    set textContent(value) {
        this._textContent = value;
        this.children = [];
    }

    get textContent() {
        return this._textContent + this.children.map(child => child.textContent).join("");
    }

    append(...children) {
        this.children.push(...children);
    }

    replaceChildren(...children) {
        this._textContent = "";
        this.children = children;
    }

    addEventListener(name, callback) {
        this.listeners[name] = callback;
    }

    setAttribute(name, value) {
        this.attributes[name] = value;
    }
}

function runSiteScript() {
    const context = {
        window: { location: { origin: "https://83c08f8d.raj-real-estate.pages.dev" } },
        URL,
        document: {
            addEventListener() {},
            createElement: tagName => new FakeElement(tagName)
        }
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(root, "js", "site.js"), "utf8"), context);
    return expression => vm.runInContext(expression, context);
}

function blogContext(response) {
    const list = new FakeElement("div");
    const requests = [];
    const context = {
        document: {
            createElement: tagName => new FakeElement(tagName),
            getElementById: () => list,
            addEventListener() {}
        },
        window: { location: { pathname: "/blog", search: "" } },
        URL,
        fetch: async input => {
            requests.push(input);
            return response;
        }
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(root, "js", "blog.js"), "utf8"), context);
    return { context, list, requests };
}

test("Pages frontend API configuration keeps only local and Cloudinary image references", () => {
    const evaluate = runSiteScript();
    evaluate('cmsCloudinaryCloudName = "rajtest"');
    assert.equal(
        evaluate('cmsApiUrl("/public/blog")'),
        "https://83c08f8d.raj-real-estate.pages.dev/api/cms/public/blog"
    );
    assert.equal(evaluate('normalizeCmsImagePath("/images/heritage/1.png")'), "/images/heritage/1.png");
    assert.equal(evaluate('normalizeCmsImagePath("/uploads/photo.png")'), "/uploads/photo.png");
    assert.equal(
        evaluate('normalizeCmsImagePath("https://res.cloudinary.com/rajtest/image/upload/v123/photo.webp")'),
        "https://res.cloudinary.com/rajtest/image/upload/v123/photo.webp"
    );
    assert.equal(
        evaluate('normalizeCmsImagePath("https://res.cloudinary.com/other-cloud/image/upload/v123/photo.webp")'),
        ""
    );
    assert.equal(evaluate('normalizeCmsImagePath("//images/heritage/1.png")'), "");
    assert.equal(evaluate('normalizeCmsImagePath("https://external.example/image.png")'), "");

    const inquiryScript = fs.readFileSync(path.join(root, "js", "inquirypopup.js"), "utf8");
    const adminScript = fs.readFileSync(path.join(root, "admin", "admin.js"), "utf8");
    assert.match(inquiryScript, /const API_ROOT = window\.location\.origin/);
    assert.match(adminScript, /credentials: "same-origin"/);
    assert.doesNotMatch(adminScript, /served by Live Server/);

    const cloudCard = evaluate(`projectCard({
        name: "Cloud project",
        category: "jaipur",
        card_image: "https://res.cloudinary.com/rajtest/image/upload/v123/photo.webp",
        location_label: "Jaipur",
        location: "Test location",
        page_path: "/projects/cloud-project",
        summary: ""
    }, false)`);
    assert.equal(cloudCard.dataset.city, "jaipur");
    assert.equal(cloudCard.dataset.location, "Jaipur Test location");
    assert.equal(
        cloudCard.children[0].children[0].children[0].src,
        "https://res.cloudinary.com/rajtest/image/upload/v123/photo.webp"
    );
});

test("blog listing renders the published API response and normalizes its image path", async () => {
    const { context, list, requests } = blogContext(new Response(JSON.stringify({
        posts: [{
            slug: "verified-test-post",
            title: "Verified test article",
            excerpt: "Rendered from the published API response.",
            category: "Testing",
            published_at: "2026-11-03",
            featured_image: "/images/heritage/1.png"
        }]
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await vm.runInContext("loadBlogListing()", context);

    assert.deepEqual(requests, ["/api/cms/public/blog"]);
    assert.equal(list.children.length, 1);
    assert.match(list.textContent, /Verified test article/);
    assert.match(list.textContent, /Rendered from the published API response/);
    assert.equal(list.children[0].children[0].children[0].children[0].src, "/images/heritage/1.png");
});

test("blog listing renders Cloudinary images and admin forms expose upload previews", async () => {
    const cloudinaryUrl = "https://res.cloudinary.com/rajtest/image/upload/v123/photo.webp";
    const { context, list } = blogContext(new Response(JSON.stringify({
        posts: [{
            slug: "cloud-image-post",
            title: "Cloud image post",
            excerpt: "Cloudinary image.",
            category: "Testing",
            published_at: "2026-11-03",
            featured_image: cloudinaryUrl
        }],
        cloudinaryCloudName: "rajtest"
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await vm.runInContext("loadBlogListing()", context);
    assert.equal(list.children[0].children[0].children[0].children[0].src, cloudinaryUrl);
    const article = vm.runInContext(`createArticle({
        title: "Cloud image post",
        category: "Testing",
        published_at: "2026-11-03",
        featured_image: "${cloudinaryUrl}",
        content: "Article body."
    })`, context);
    assert.equal(article.children[3].src, cloudinaryUrl);

    const adminScript = fs.readFileSync(path.join(root, "admin", "admin.js"), "utf8");
    const adminHtml = fs.readFileSync(path.join(root, "admin", "index.html"), "utf8");
    assert.match(adminHtml, /id="blogImagePreview"/);
    assert.match(adminHtml, /id="projectImagePreview"/);
    assert.match(adminHtml, /id="blogUpload" type="file" class="form-control" accept="image\/png,image\/jpeg,image\/webp"/);
    assert.match(adminHtml, /id="projectUpload" type="file" class="form-control mt-2" accept="image\/png,image\/jpeg,image\/webp"/);
    assert.match(adminScript, /setImagePreview\("blogImagePreview", image\.url\)/);
    assert.match(adminScript, /setImagePreview\("projectImagePreview", image\.url\)/);
    assert.match(adminScript, /request\("\/admin\/uploads", \{ method: "POST", body: formData \}\)/);
});

test("dynamic project details render Cloudinary cover and gallery images", async () => {
    const cloudinaryUrl = "https://res.cloudinary.com/rajtest/image/upload/v123/photo.webp";
    const project = {
        name: "Cloud project",
        page_title: "Cloud project",
        seo_description: "Project with a Cloudinary image.",
        banner_label: "Jaipur",
        location_label: "Jaipur",
        summary: "Project summary",
        location: "Jaipur",
        description: "Project description",
        card_image: cloudinaryUrl,
        gallery: [cloudinaryUrl],
        layout_image: "",
        map_image: "",
        amenities: [],
        video_url: ""
    };
    const container = new FakeElement("main");
    const context = {
        document: {
            body: { dataset: { cmsDynamicProject: "true" } },
            createElement: tagName => new FakeElement(tagName),
            getElementById: () => container,
            addEventListener() {},
            querySelector: () => null,
            querySelectorAll: () => []
        },
        window: { location: { origin: "https://local.pages.test", pathname: "/projects/cloud-project" } },
        URL,
        fetch: async () => ({
            ok: true,
            json: async () => ({ project, cloudinaryCloudName: "rajtest" })
        })
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(root, "js", "site.js"), "utf8"), context);
    await vm.runInContext("initializeCmsPublicContent()", context);

    const projectContent = container.children[1].children[0];
    assert.equal(projectContent.children[2].src, cloudinaryUrl);
    assert.equal(projectContent.children[4].children[0].children[0].src, cloudinaryUrl);
    const enquiryForm = container.children[2].children[0].children[0].children[2];
    assert.equal(enquiryForm.tagName, "FORM");
    assert.equal(enquiryForm.dataset.sourceForm, "Cloud project Enquiries");
    assert.equal(enquiryForm.children[0].value, "Cloud project Enquiries");
    assert.equal(enquiryForm.children[1].value, "Cloud project");
});

test("all recovered projects render their detail page content and verified site images", async () => {
    const projects = collectStaticContent().projects;
    assert.equal(projects.length, 11);

    for (const source of projects) {
        const project = {
            ...source,
            gallery: JSON.parse(source.gallery_json),
            amenities: JSON.parse(source.amenities_json),
            featured: Boolean(source.featured)
        };
        const container = new FakeElement("main");
        const requests = [];
        const context = {
            document: {
                body: { dataset: { cmsDynamicProject: "true" } },
                createElement: tagName => new FakeElement(tagName),
                getElementById: () => container,
                addEventListener() {},
                querySelector: () => null,
                querySelectorAll: () => []
            },
            window: {
                location: { origin: "https://local.pages.test", pathname: `/projects/${project.slug}` }
            },
            URL,
            fetch: async input => {
                requests.push(input);
                return {
                    ok: true,
                    json: async () => ({ project, cloudinaryCloudName: "" })
                };
            }
        };
        vm.createContext(context);
        vm.runInContext(fs.readFileSync(path.join(root, "js", "site.js"), "utf8"), context);
        await vm.runInContext("initializeCmsPublicContent()", context);

        assert.deepEqual(requests, [
            `https://local.pages.test/api/cms/public/projects/${encodeURIComponent(project.slug)}`
        ]);
        assert.ok(container.textContent.includes(project.description), project.slug);
        const images = [];
        const visit = element => {
            if (element.tagName === "IMG") images.push(element.src);
            element.children.forEach(visit);
        };
        visit(container);
        assert.ok(images.includes(project.card_image), `${project.slug} cover`);
        for (const imagePath of project.gallery) {
            assert.ok(images.includes(imagePath), `${project.slug} gallery ${imagePath}`);
        }
        const mapPath = project.layout_image || project.map_image;
        if (mapPath) assert.ok(images.includes(mapPath), `${project.slug} map ${mapPath}`);
    }
});

test("blog listing shows empty and backend error states", async () => {
    const empty = blogContext(new Response(JSON.stringify({ posts: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
    }));
    await vm.runInContext("loadBlogListing()", empty.context);
    assert.match(empty.list.textContent, /No articles have been published yet/);

    const failure = blogContext(new Response("Unavailable", { status: 503 }));
    await vm.runInContext("loadBlogListing()", failure.context);
    assert.match(failure.list.textContent, /Articles could not be loaded/);
});

test("Navi Mumbai and Jaipur filter buttons show their intended project categories", () => {
    const source = fs.readFileSync(path.join(root, "projects.html"), "utf8");
    const marker = 'document.addEventListener("DOMContentLoaded", () => {';
    const start = source.indexOf(marker);
    assert.notEqual(start, -1);
    const end = source.indexOf("</script>", start);
    assert.notEqual(end, -1);

    const buttons = ["all", "jaipur", "ajmer", "navi-mumbai", "villasinmumbai"]
        .map(filter => {
            const button = new FakeElement("button");
            button.filter = filter;
            button.getAttribute = name => name === "data-filter" ? filter : null;
            return button;
        });
    const cards = [
        { city: "  JaIpUr  " },
        { city: "ajmer" },
        { city: " Mumbai " },
        { city: "Villas In Mumbai" },
        { city: "", location: " Mumbai, Maharashtra " }
    ].map(({ city, location = "" }) => {
            const card = new FakeElement("div");
            card.city = city;
            card.getAttribute = name => name === "data-city"
                ? city
                : name === "data-location"
                    ? location
                    : null;
            return card;
        });
    const windowListeners = {};
    const documentListeners = {};
    const historyCalls = [];
    const context = {
        document: {
            addEventListener: (name, callback) => { documentListeners[name] = callback; },
            querySelectorAll: selector => selector === "#filterContainer [data-filter]" ? buttons : cards,
            querySelector: selector => {
                const match = selector.match(/data-filter="([^"]+)"/);
                return buttons.find(button => button.filter === match?.[1]) || null;
            }
        },
        window: {
            location: { pathname: "/projects/navi-mumbai", search: "" },
            addEventListener: (name, callback) => { windowListeners[name] = callback; }
        },
        history: { pushState: (...args) => historyCalls.push(args) },
        URLSearchParams
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);
    documentListeners.DOMContentLoaded();

    const isVisible = city => cards.find(card => card.city === city).style.display !== "none";
    assert.equal(isVisible(" Mumbai "), true);
    assert.equal(isVisible("Villas In Mumbai"), true);
    assert.equal(isVisible(""), true);
    assert.equal(isVisible("  JaIpUr  "), false);
    assert.equal(buttons.find(button => button.filter === "navi-mumbai").classList.values.has("active"), true);

    buttons.find(button => button.filter === "jaipur").listeners.click();
    assert.equal(isVisible("  JaIpUr  "), true);
    assert.equal(isVisible(" Mumbai "), false);
    assert.equal(historyCalls.at(-1)[2], "/projects/jaipur");

    buttons.find(button => button.filter === "navi-mumbai").listeners.click();
    assert.equal(isVisible(" Mumbai "), true);
    assert.equal(isVisible("Villas In Mumbai"), true);
    assert.equal(isVisible(""), true);
    assert.equal(isVisible("  JaIpUr  "), false);
    assert.equal(historyCalls.at(-1)[2], "/projects/navi-mumbai");

    buttons.find(button => button.filter === "villasinmumbai").listeners.click();
    assert.equal(isVisible("Villas In Mumbai"), true);
    assert.equal(isVisible(" Mumbai "), false);
    assert.equal(isVisible(""), false);

    buttons.find(button => button.filter === "all").listeners.click();
    assert.equal(cards.filter(card => card.style.display !== "none").length, 5);
    assert.equal(historyCalls.at(-1)[2], "/projects");
});

test("Pages API uses D1 handlers and rejects cross-origin CMS mutations without a Render proxy", async () => {
    const pagesApi = await loadPagesFunction("functions/api/[[path]].js");
    const originalFetch = global.fetch;
    let fetchCalled = false;
    global.fetch = async () => {
        fetchCalled = true;
        throw new Error("The D1 API must not proxy to an external backend.");
    };

    try {
        const missingBinding = await pagesApi.onRequest({
            request: new Request("https://preview.pages.dev/api/cms/public/blog"),
            env: {}
        });
        assert.equal(missingBinding.status, 503);

        const crossOrigin = await pagesApi.onRequest({
            request: new Request("https://preview.pages.dev/api/cms/auth/logout", {
                method: "POST",
                headers: { origin: "https://attacker.example" }
            }),
            env: { DB: {} }
        });
        assert.equal(crossOrigin.status, 403);
        assert.equal(fetchCalled, false);

        const missingOrigin = await pagesApi.onRequest({
            request: new Request("https://preview.pages.dev/api/cms/auth/logout", {
                method: "POST"
            }),
            env: { DB: {} }
        });
        assert.equal(missingOrigin.status, 403);
    } finally {
        global.fetch = originalFetch;
    }
});

test("Pages blog and project routes query D1 without routing articles to project pages", async () => {
    const blogFunction = await loadPagesFunction("functions/blog/[slug].js");
    const projectFunction = await loadPagesFunction("functions/projects/[slug].js");
    const uploadsFunction = await loadPagesFunction("functions/uploads/[[path]].js");
    const originalFetch = global.fetch;
    const forwarded = [];
    global.fetch = async request => {
        forwarded.push(request.url);
        return new Response("legacy uploaded image", { status: 200 });
    };

    try {
        const db = {
            prepare(sql) {
                return {
                    bind(slug) {
                        return {
                            async first() {
                                if (sql.includes("cms_blog_posts") && slug === "verified-post") {
                                    return { slug };
                                }
                                if (sql.includes("cms_projects") && slug === "verified-project") {
                                    return { slug, page_path: "/projects/verified-project.html" };
                                }
                                return null;
                            }
                        };
                    }
                };
            }
        };
        const assetPaths = [];
        const dynamicContext = pathName => ({
            request: new Request(`https://preview.pages.dev${pathName}`),
            env: {
                DB: db,
                ASSETS: {
                    async fetch(request) {
                        const pathname = new URL(request.url).pathname;
                        assetPaths.push(pathname);
                        if (pathname === "/blog-post" ||
                            pathname === "/cms/project-template" ||
                            pathname === "/projects") {
                            return new Response(`static:${pathname}`);
                        }
                        return new Response("not found", { status: 404 });
                    }
                }
            }
        });
        const blog = await blogFunction.onRequestGet(dynamicContext("/blog/verified-post"));
        assert.equal(await blog.text(), "static:/blog-post");

        const missingBlog = await blogFunction.onRequestGet(dynamicContext("/blog/verified-project"));
        assert.equal(missingBlog.status, 404);

        const location = await projectFunction.onRequestGet(dynamicContext("/projects/navi-mumbai"));
        assert.equal(await location.text(), "static:/projects");

        const project = await projectFunction.onRequestGet(dynamicContext("/projects/verified-project"));
        assert.equal(await project.text(), "static:/cms/project-template");
        assert.ok(assetPaths.includes("/blog-post"));
        assert.ok(assetPaths.includes("/cms/project-template"));

        const knownProject = await projectFunction.onRequestGet({
            request: new Request("https://preview.pages.dev/projects/heritage"),
            env: {
                DB: {
                    prepare() {
                        return {
                            bind(slug) {
                                return {
                                    async first() {
                                        return slug === "heritage"
                                            ? { slug, page_path: "/projects/heritage.html" }
                                            : null;
                                    }
                                };
                            }
                        }
                    }
                },
                ASSETS: {
                    fetch: async request => new URL(request.url).pathname === "/cms/project-template"
                        ? new Response("known project template")
                        : new Response("not found", { status: 404 })
                }
            }
        });
        assert.equal(knownProject.status, 200);
        assert.equal(await knownProject.text(), "known project template");

        const upload = await uploadsFunction.onRequest({
            request: new Request("https://preview.pages.dev/uploads/cms/featured.png"),
            env: {}
        });
        assert.equal(await upload.text(), "legacy uploaded image");
        assert.equal(forwarded.at(-1), "https://raj-real-estate.onrender.com/uploads/cms/featured.png");

        const rejectedUpload = await uploadsFunction.onRequest({
            request: new Request("https://preview.pages.dev/uploads/cms/featured.png", {
                method: "POST"
            }),
            env: {}
        });
        assert.equal(rejectedUpload.status, 405);
    } finally {
        global.fetch = originalFetch;
    }
});
