import { findPublishedBlogPost } from "../_shared/d1-cms.mjs";

async function handleBlogArticle({ request, env }) {
    if (!["GET", "HEAD"].includes(request.method)) {
        return new Response("Method not allowed.", {
            status: 405,
            headers: { Allow: "GET, HEAD" }
        });
    }

    const slug = new URL(request.url).pathname.match(/^\/blog\/([a-z0-9-]+)$/i)?.[1];
    if (!slug) return new Response("Not found.", { status: 404 });
    if (!env.DB) return Response.json({ error: "D1 is not configured." }, { status: 503 });

    const post = await findPublishedBlogPost(env.DB, slug);
    if (!post) return new Response("Not found.", { status: 404 });

    const asset = await env.ASSETS.fetch(new Request(
        new URL("/blog-post", request.url),
        request
    ));
    if (asset.status === 404) return new Response("Article template not found.", { status: 500 });
    return asset;
}

export async function onRequestGet(context) {
    return handleBlogArticle(context);
}

export async function onRequestHead(context) {
    return handleBlogArticle(context);
}
