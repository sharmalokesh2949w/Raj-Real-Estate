import { findPublishedProject } from "../_shared/d1-cms.mjs";

const projectFilters = new Set([
    "jaipur",
    "navi-mumbai"
]);
const legacyProjectFilters = new Map([
    ["ajmer", "/projects?city=ajmer"],
    ["mumbai", "/projects/navi-mumbai"],
    ["villasinmumbai", "/projects/navi-mumbai?city=villasinmumbai"]
]);

async function serveAsset(env, request, pathname) {
    return env.ASSETS.fetch(new Request(new URL(pathname, request.url), request));
}

async function handleProjectPath({ request, env }) {
    if (!["GET", "HEAD"].includes(request.method)) {
        return new Response("Method not allowed.", {
            status: 405,
            headers: { Allow: "GET, HEAD" }
        });
    }

    const url = new URL(request.url);
    const slug = url.pathname.match(/^\/projects\/([a-z0-9-]+(?:\.html)?)$/i)?.[1];
    if (!slug) return new Response("Not found.", { status: 404 });

    const legacyRedirect = legacyProjectFilters.get(slug.toLowerCase());
    if (legacyRedirect) {
        const destination = new URL(legacyRedirect, request.url);
        if (url.search) destination.search += `${destination.search ? "&" : "?"}${url.search.slice(1)}`;
        return Response.redirect(destination, 301);
    }

    if (projectFilters.has(slug.toLowerCase())) {
        return serveAsset(env, request, "/projects");
    }
    const legacyHtmlSlug = slug.match(/^([a-z0-9-]+)\.html$/i)?.[1];
    if (legacyHtmlSlug) {
        const destination = new URL(`/projects/${legacyHtmlSlug}${url.search}`, request.url);
        return Response.redirect(destination, 301);
    }
    if (!env.DB) return Response.json({ error: "D1 is not configured." }, { status: 503 });

    const project = await findPublishedProject(env.DB, slug);
    if (!project) return new Response("Not found.", { status: 404 });

    const template = await serveAsset(env, request, "/cms/project-template");
    if (template.status === 404) {
        return new Response("Project detail template not found.", { status: 500 });
    }
    return template;
}

export async function onRequestGet(context) {
    return handleProjectPath(context);
}

export async function onRequestHead(context) {
    return handleProjectPath(context);
}
