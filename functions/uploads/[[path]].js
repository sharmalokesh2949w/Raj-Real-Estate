import { proxyToBackend } from "../_shared/backend-proxy.mjs";

export async function onRequest({ request }) {
    if (!["GET", "HEAD"].includes(request.method)) {
        return new Response("Method not allowed.", {
            status: 405,
            headers: { Allow: "GET, HEAD" }
        });
    }

    return proxyToBackend(request);
}
