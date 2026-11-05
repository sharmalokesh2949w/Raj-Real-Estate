export const BACKEND_ORIGIN = "https://raj-real-estate.onrender.com";

export function sameOriginMutationAllowed(request) {
    const origin = request.headers.get("origin");
    if (!origin) return false;

    try {
        return new URL(origin).origin === new URL(request.url).origin;
    } catch {
        return false;
    }
}

export async function proxyToBackend(request, { rewriteOrigin = false } = {}) {
    const requestUrl = new URL(request.url);
    const backendUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, BACKEND_ORIGIN);
    const headers = new Headers(request.headers);
    for (const name of [
        "host",
        "connection",
        "keep-alive",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
        "cf-connecting-ip",
        "cf-ray",
        "x-forwarded-for",
        "x-forwarded-host",
        "x-forwarded-proto",
        "x-real-ip"
    ]) {
        headers.delete(name);
    }
    if (rewriteOrigin) headers.set("origin", BACKEND_ORIGIN);

    const init = {
        method: request.method,
        headers,
        redirect: "manual"
    };
    if (!["GET", "HEAD"].includes(request.method)) {
        init.body = await request.arrayBuffer();
    }

    try {
        return await fetch(new Request(backendUrl, init));
    } catch (error) {
        console.error(
            "Pages backend proxy failed:",
            error instanceof Error ? error.message : "unknown error"
        );
        return Response.json(
            { error: "The website backend is temporarily unavailable." },
            { status: 502 }
        );
    }
}
