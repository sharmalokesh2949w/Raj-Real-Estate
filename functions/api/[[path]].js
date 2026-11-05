import { handleApiRequest } from "../_shared/d1-cms.mjs";

export async function onRequest({ request, env }) {
    return handleApiRequest(request, env);
}
