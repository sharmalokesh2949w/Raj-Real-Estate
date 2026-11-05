import {
    createPasswordRecord,
    getSession,
    hashToken,
    newSessionToken,
    readCookie,
    sameOriginMutationAllowed,
    SESSION_COOKIE,
    sessionCookie,
    verifyPassword
} from "./d1-auth.mjs";

const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_UPLOAD_REQUEST_BYTES = MAX_IMAGE_BYTES + 64 * 1024;
const CLOUDINARY_FOLDER = "raj-real-estate/cms";
const projectCategories = new Set(["jaipur", "ajmer", "mumbai", "villasinmumbai"]);
const allowedBudgets = new Set([
    "₹20–40 Lakh",
    "₹40–60 Lakh",
    "₹60–80 Lakh",
    "₹80 Lakh and Above"
]);
const settingsFields = {
    officeAddress: ["Office address", 500],
    phone: ["Phone number", 40],
    whatsapp: ["WhatsApp number", 40],
    email: ["Contact email", 160],
    businessHours: ["Business hours", 160]
};
const projectColumns = `
    slug, name, category, location_label, banner_label, location, summary, description,
    page_title, seo_description, card_image, gallery_json, layout_image,
    map_image, amenities_json, video_url, page_path, featured, sort_order,
    status, updated_at
`;

class ValidationError extends Error {}
class PayloadTooLargeError extends Error {}

function jsonResponse(body, status = 200, headers = {}) {
    return Response.json(body, {
        status,
        headers: { "Cache-Control": "no-store", ...headers }
    });
}

function errorResponse(message, status, headers = {}) {
    return jsonResponse({ error: message }, status, headers);
}

function resultRows(result) {
    return Array.isArray(result?.results) ? result.results : [];
}

async function readJson(request) {
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_JSON_BYTES) throw new ValidationError("Request body is too large.");
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
        throw new ValidationError("Request body is too large.");
    }
    let body;
    try {
        body = JSON.parse(text);
    } catch {
        throw new ValidationError("Request body must be valid JSON.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new ValidationError("Request body must be an object.");
    }
    return body;
}

function boundedString(value, label, maxLength, { required = false, defaultValue = "" } = {}) {
    if (value === undefined && !required) return defaultValue;
    if (typeof value !== "string") throw new ValidationError(`${label} must be text.`);
    const result = value.trim();
    if (required && !result) throw new ValidationError(`${label} is required.`);
    if (result.length > maxLength) {
        throw new ValidationError(`${label} must be ${maxLength} characters or fewer.`);
    }
    return result;
}

function isCloudinaryImageUrl(value, cloudName) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(cloudName || "")) return false;
    let url;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    return url.protocol === "https:" &&
        url.hostname === "res.cloudinary.com" &&
        !url.username &&
        !url.password &&
        !url.port &&
        !url.search &&
        !url.hash &&
        url.pathname.startsWith(`/${cloudName}/image/upload/`) &&
        /^\/[A-Za-z0-9._/-]+$/.test(url.pathname) &&
        !url.pathname.includes("..") &&
        !url.pathname.includes("//") &&
        /\.(?:png|jpe?g|webp)$/i.test(url.pathname);
}

function validateImagePath(value, label, required = false, cloudName = "") {
    const imagePath = boundedString(value, label, 500, { required });
    if (!imagePath) return "";
    const localPath = /^\/(?:images|uploads)\/[A-Za-z0-9._/-]+$/.test(imagePath) &&
        !imagePath.includes("..") && !imagePath.includes("//");
    if (!localPath && !isCloudinaryImageUrl(imagePath, cloudName)) {
        throw new ValidationError(`${label} must be a local site image or a valid Cloudinary HTTPS image URL.`);
    }
    const extension = imagePath.slice(imagePath.lastIndexOf(".")).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(extension)) {
        throw new ValidationError(`${label} must use PNG, JPEG, GIF, or WebP format.`);
    }
    return imagePath;
}

async function validateImageReferences(imagePaths, request, env) {
    const staticImages = [...new Set(imagePaths.filter(imagePath =>
        imagePath.startsWith("/images/")
    ))];
    if (!staticImages.length || typeof env.ASSETS?.fetch !== "function") return;

    await Promise.all(staticImages.map(async imagePath => {
        const response = await env.ASSETS.fetch(new Request(new URL(imagePath, request.url), {
            method: "HEAD"
        }));
        const contentType = response.headers.get("content-type") || "";
        if (!response.ok || !contentType.toLowerCase().startsWith("image/")) {
            throw new ValidationError("Image path must point to an existing site image.");
        }
    }));
}

function validateSlug(value, label, maximum) {
    const slug = boundedString(value, label, maximum, { required: true }).toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        throw new ValidationError(`${label} can contain lowercase letters, numbers, and hyphens.`);
    }
    return slug;
}

function validDate(value) {
    const date = boundedString(value, "Publication date", 10, { required: true });
    const parsedDate = new Date(`${date}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        Number.isNaN(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== date) {
        throw new ValidationError("Publication date must be a valid calendar date.");
    }
    return date;
}

async function validateBlogPost(body, request, env) {
    const status = body.status || "draft";
    if (!["published", "draft"].includes(status)) {
        throw new ValidationError("Choose published or unpublished status.");
    }
    const post = {
        slug: validateSlug(body.slug, "Post URL", 100),
        title: boundedString(body.title, "Title", 180, { required: true }),
        excerpt: boundedString(body.excerpt, "Excerpt", 600, { required: true }),
        content: boundedString(body.content, "Article content", 30000, { required: true }),
        category: boundedString(body.category, "Category", 80, { required: true }),
        featuredImage: validateImagePath(body.featuredImage, "Featured image", true, env.CLOUDINARY_CLOUD_NAME),
        publishedAt: validDate(body.publishedAt),
        status
    };
    await validateImageReferences([post.featuredImage], request, env);
    return post;
}

async function validateProject(body, request, env, slug = body.slug) {
    const status = body.status || "draft";
    if (!["published", "draft"].includes(status)) {
        throw new ValidationError("Choose published or unpublished status.");
    }
    const category = boundedString(body.category || "jaipur", "Project category", 40, { required: true })
        .toLowerCase();
    if (!projectCategories.has(category)) {
        throw new ValidationError("Choose one of the available project listing categories.");
    }
    if (!Array.isArray(body.gallery) || body.gallery.length > 30) {
        throw new ValidationError("Gallery must contain no more than 30 image paths.");
    }
    if (!Array.isArray(body.amenities) || body.amenities.length > 50) {
        throw new ValidationError("Amenities must contain no more than 50 entries.");
    }
    const gallery = body.gallery.map((image, index) =>
        validateImagePath(image, `Gallery image ${index + 1}`, true, env.CLOUDINARY_CLOUD_NAME)
    );
    const amenities = body.amenities.map((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw new ValidationError(`Amenity ${index + 1} is invalid.`);
        }
        const label = boundedString(item.label, `Amenity ${index + 1}`, 100, { required: true });
        const icon = boundedString(item.icon || "bi-check-circle", `Amenity ${index + 1} icon`, 60);
        if (!/^bi-[a-z0-9-]+$/.test(icon)) {
            throw new ValidationError(`Amenity ${index + 1} icon is invalid.`);
        }
        return { label, icon };
    });

    const videoUrl = boundedString(body.videoUrl || "", "Video URL", 500);
    if (videoUrl) {
        let parsedVideo;
        try {
            parsedVideo = new URL(videoUrl);
        } catch {
            throw new ValidationError("Video URL must be a valid YouTube link.");
        }
        if (parsedVideo.protocol !== "https:" ||
            !["youtube.com", "www.youtube.com", "youtu.be", "www.youtube-nocookie.com"].includes(parsedVideo.hostname)) {
            throw new ValidationError("Video URL must be a valid YouTube link.");
        }
    }

    const sortOrder = Number(body.sortOrder ?? 0);
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000) {
        throw new ValidationError("Display order must be a whole number between 0 and 10000.");
    }

    const project = {
        slug: validateSlug(slug, "Project URL", 80),
        name: boundedString(body.name, "Project name", 120, { required: true }),
        category,
        locationLabel: boundedString(body.locationLabel || "", "Location label", 120),
        bannerLabel: boundedString(body.bannerLabel || "", "Banner location label", 160),
        location: boundedString(body.location || "", "Project location", 240),
        summary: boundedString(body.summary || "", "Card summary", 600),
        description: boundedString(body.description || "", "Project description", 10000),
        pageTitle: boundedString(body.pageTitle || "", "Page title", 200),
        seoDescription: boundedString(body.seoDescription || "", "SEO description", 320),
        cardImage: validateImagePath(body.cardImage || "", "Card image", false, env.CLOUDINARY_CLOUD_NAME),
        gallery,
        layoutImage: validateImagePath(body.layoutImage || "", "Layout image", false, env.CLOUDINARY_CLOUD_NAME),
        mapImage: validateImagePath(body.mapImage || "", "Map image", false, env.CLOUDINARY_CLOUD_NAME),
        amenities,
        videoUrl,
        featured: body.featured === true,
        sortOrder,
        status
    };
    await validateImageReferences([
        project.cardImage,
        ...project.gallery,
        project.layoutImage,
        project.mapImage
    ], request, env);
    return project;
}

function projectFromRow(row) {
    if (!row) return null;
    return {
        ...row,
        page_path: `/projects/${row.slug}`,
        gallery: JSON.parse(row.gallery_json),
        amenities: JSON.parse(row.amenities_json),
        featured: Boolean(row.featured)
    };
}

function pageFromRow(row) {
    if (!row) return null;
    const page = { ...row };
    if (typeof page.content_json === "string") {
        page.content = JSON.parse(page.content_json);
        delete page.content_json;
    }
    return page;
}

async function requireSameOrigin(request) {
    return sameOriginMutationAllowed(request)
        ? null
        : errorResponse("A same-origin request is required.", 403);
}

async function requireAdmin(request, env) {
    const admin = await getSession(request, env.DB);
    return admin || null;
}

async function rateLimitAddress(request) {
    const address = request.headers.get("cf-connecting-ip") || "unknown";
    return hashToken(address);
}

async function checkLoginRateLimit(request, db, now) {
    const address = await rateLimitAddress(request);
    await db.prepare("DELETE FROM cms_login_attempts WHERE updated_at < ?")
        .bind(new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()).run();
    const attempt = await db.prepare(
        "SELECT blocked_until FROM cms_login_attempts WHERE address = ?"
    ).bind(address).first();
    if (attempt?.blocked_until && Date.parse(attempt.blocked_until) > now.getTime()) {
        return { address, blocked: true };
    }
    return { address, blocked: false };
}

async function recordLoginFailure(db, address, now) {
    const nowText = now.toISOString();
    await db.prepare(`
        INSERT INTO cms_login_attempts (address, attempts, blocked_until, updated_at)
        VALUES (?, 1, NULL, ?)
        ON CONFLICT(address) DO UPDATE SET
            attempts = CASE
                WHEN cms_login_attempts.blocked_until IS NOT NULL
                    AND cms_login_attempts.blocked_until <= ?
                THEN 1
                ELSE cms_login_attempts.attempts + 1
            END,
            blocked_until = CASE
                WHEN (
                    CASE
                        WHEN cms_login_attempts.blocked_until IS NOT NULL
                            AND cms_login_attempts.blocked_until <= ?
                        THEN 1
                        ELSE cms_login_attempts.attempts + 1
                    END
                ) >= 5
                THEN ?
                ELSE NULL
            END,
            updated_at = excluded.updated_at
    `).bind(
        address,
        nowText,
        nowText,
        nowText,
        new Date(now.getTime() + 15 * 60 * 1000).toISOString()
    ).run();
}

async function handleLogin(request, env) {
    const originError = await requireSameOrigin(request);
    if (originError) return originError;

    const body = await readJson(request);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length > 256) {
        return errorResponse("Email or password is incorrect.", 401);
    }

    const now = new Date();
    const limit = await checkLoginRateLimit(request, env.DB, now);
    if (limit.blocked) {
        return errorResponse("Too many sign-in attempts. Try again later.", 429);
    }

    const admin = await env.DB.prepare(`
        SELECT id, email, password_salt, password_hash, password_algorithm, password_iterations
        FROM admins WHERE email = ? COLLATE NOCASE
    `).bind(email).first();
    const valid = await verifyPassword(password, admin);
    if (!valid) {
        await recordLoginFailure(env.DB, limit.address, now);
        return errorResponse("Email or password is incorrect.", 401);
    }

    await env.DB.prepare("DELETE FROM cms_login_attempts WHERE address = ?")
        .bind(limit.address).run();
    await env.DB.prepare("DELETE FROM cms_sessions WHERE expires_at <= ?")
        .bind(now.toISOString()).run();

    const token = newSessionToken();
    await env.DB.prepare(`
        INSERT INTO cms_sessions (token_hash, admin_id, expires_at, created_at)
        VALUES (?, ?, ?, ?)
    `).bind(
        await hashToken(token),
        admin.id,
        new Date(now.getTime() + SESSION_DURATION_MS).toISOString(),
        now.toISOString()
    ).run();

    return jsonResponse({
        admin: {
            email: admin.email,
            cloudinaryCloudName: env.CLOUDINARY_CLOUD_NAME || ""
        }
    }, 200, {
        "Set-Cookie": sessionCookie(token)
    });
}

function equalSecret(actual, expected) {
    if (typeof actual !== "string" || typeof expected !== "string") return false;
    const encoder = new TextEncoder();
    const actualBytes = encoder.encode(actual);
    const expectedBytes = encoder.encode(expected);
    let difference = actualBytes.length ^ expectedBytes.length;
    const length = Math.max(actualBytes.length, expectedBytes.length);
    for (let index = 0; index < length; index += 1) {
        difference |= (actualBytes[index] || 0) ^ (expectedBytes[index] || 0);
    }
    return difference === 0;
}

async function handleBootstrap(request, env) {
    const originError = await requireSameOrigin(request);
    if (originError) return originError;
    const bootstrapToken = env.ADMIN_BOOTSTRAP_TOKEN;
    const authorization = request.headers.get("authorization") || "";
    const suppliedToken = authorization.startsWith("Bearer ")
        ? authorization.slice(7)
        : "";
    if (typeof bootstrapToken !== "string" || bootstrapToken.length < 32 ||
        !equalSecret(suppliedToken, bootstrapToken)) {
        return errorResponse("Administrator bootstrap is unavailable or unauthorized.", 403);
    }

    const body = await readJson(request);
    const email = boundedString(body.email, "Email", 160, { required: true }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new ValidationError("Enter a valid administrator email address.");
    }
    const password = boundedString(body.password, "Password", 256, { required: true });
    const existing = await env.DB.prepare("SELECT 1 AS present FROM admins LIMIT 1").first();
    if (existing) return errorResponse("An administrator already exists.", 409);

    const record = await createPasswordRecord(password);
    const now = new Date().toISOString();
    const admin = await env.DB.prepare(`
        INSERT INTO admins (
            email, password_salt, password_hash, password_algorithm, password_iterations, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM admins)
        RETURNING id, email
    `).bind(
        email,
        record.salt,
        record.hash,
        record.algorithm,
        record.iterations,
        now
    ).first();
    if (!admin) return errorResponse("An administrator already exists.", 409);

    return jsonResponse({ admin: { id: admin.id, email: admin.email } }, 201);
}

async function handleLogout(request, env) {
    const originError = await requireSameOrigin(request);
    if (originError) return originError;
    const token = readCookie(request, SESSION_COOKIE);
    if (token) {
        await env.DB.prepare("DELETE FROM cms_sessions WHERE token_hash = ?")
            .bind(await hashToken(token)).run();
    }
    return new Response(null, {
        status: 204,
        headers: {
            "Cache-Control": "no-store",
            "Set-Cookie": sessionCookie("", 0)
        }
    });
}

async function publicCmsRoute(request, env, parts) {
    const [resource, ...rest] = parts;
    const db = env.DB;

    if (resource === "projects" && request.method === "GET") {
        if (!rest.length) {
            const result = await db.prepare(`
                SELECT ${projectColumns} FROM cms_projects
                WHERE status = 'published'
                ORDER BY sort_order ASC, name COLLATE NOCASE ASC
            `).all();
            return jsonResponse({
                projects: resultRows(result).map(projectFromRow),
                cloudinaryCloudName: env.CLOUDINARY_CLOUD_NAME || ""
            });
        }
        if (rest.length === 1) {
            const row = await db.prepare(`
                SELECT ${projectColumns} FROM cms_projects
                WHERE slug = ? AND status = 'published'
            `).bind(rest[0]).first();
            if (!row) return errorResponse("Project not found.", 404);
            return jsonResponse({
                project: projectFromRow(row),
                cloudinaryCloudName: env.CLOUDINARY_CLOUD_NAME || ""
            });
        }
    }

    if (resource === "pages" && request.method === "GET") {
        if (!rest.length) {
            const result = await db.prepare(`
                SELECT slug, path, label, title, seo_title, seo_description, content_json, status, updated_at
                FROM cms_pages WHERE status = 'published'
                ORDER BY label COLLATE NOCASE ASC
            `).all();
            return jsonResponse({
                pages: resultRows(result).map(pageFromRow),
                cloudinaryCloudName: env.CLOUDINARY_CLOUD_NAME || ""
            });
        }
        if (rest.length === 1) {
            const row = await db.prepare(`
                SELECT slug, path, label, title, seo_title, seo_description, content_json, status, updated_at
                FROM cms_pages WHERE slug = ? AND status = 'published'
            `).bind(rest[0]).first();
            if (!row) return errorResponse("Page not found.", 404);
            return jsonResponse({
                page: pageFromRow(row),
                cloudinaryCloudName: env.CLOUDINARY_CLOUD_NAME || ""
            });
        }
    }

    if (resource === "settings" && !rest.length && request.method === "GET") {
        const result = await db.prepare("SELECT key, value FROM cms_settings").all();
        return jsonResponse({
            settings: Object.fromEntries(resultRows(result).map(row => [row.key, row.value]))
        });
    }

    if (resource === "blog" && request.method === "GET") {
        if (!rest.length) {
            const result = await db.prepare(`
                SELECT slug, title, excerpt, content, category, featured_image, published_at
                FROM cms_blog_posts
                WHERE status = 'published'
                ORDER BY published_at DESC, title COLLATE NOCASE ASC
            `).all();
            return jsonResponse({
                posts: resultRows(result),
                cloudinaryCloudName: env.CLOUDINARY_CLOUD_NAME || ""
            });
        }
        if (rest.length === 1) {
            const post = await db.prepare(`
                SELECT slug, title, excerpt, content, category, featured_image, published_at
                FROM cms_blog_posts
                WHERE slug = ? AND status = 'published'
            `).bind(rest[0]).first();
            if (!post) return errorResponse("Blog post not found.", 404);
            return jsonResponse({
                post,
                cloudinaryCloudName: env.CLOUDINARY_CLOUD_NAME || ""
            });
        }
    }

    return null;
}

function imageFormat(bytes) {
    if (bytes.length >= 8 &&
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
        bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
        return { extension: "png", mimeType: "image/png" };
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return { extension: "jpg", mimeType: "image/jpeg" };
    }
    if (bytes.length >= 12 &&
        String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
        String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
        return { extension: "webp", mimeType: "image/webp" };
    }
    return null;
}

async function readUploadForm(request) {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
        throw new ValidationError("Upload must use a multipart image form.");
    }
    const declaredLength = request.headers.get("content-length");
    if (declaredLength && Number(declaredLength) > MAX_UPLOAD_REQUEST_BYTES) {
        throw new PayloadTooLargeError("Image must be 5 MB or smaller.");
    }

    const reader = request.body?.getReader();
    if (!reader) throw new ValidationError("Choose an image to upload.");
    const chunks = [];
    let totalBytes = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_UPLOAD_REQUEST_BYTES) {
            await reader.cancel();
            throw new PayloadTooLargeError("Image must be 5 MB or smaller.");
        }
        chunks.push(value);
    }

    const body = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    let form;
    try {
        form = await new Request(request.url, {
            method: "POST",
            headers: request.headers,
            body
        }).formData();
    } catch {
        throw new ValidationError("Upload must contain one valid image file.");
    }
    if ([...form.keys()].length !== 1 || form.getAll("image").length !== 1) {
        throw new ValidationError("Upload must contain exactly one image file.");
    }
    const file = form.get("image");
    if (!(file instanceof Blob) || typeof file.name !== "string" || !file.size) {
        throw new ValidationError("Choose an image to upload.");
    }
    if (file.size > MAX_IMAGE_BYTES) {
        throw new PayloadTooLargeError("Image must be 5 MB or smaller.");
    }
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const format = imageFormat(bytes);
    if (!format || (file.type && file.type.toLowerCase() !== format.mimeType)) {
        throw new ValidationError("Choose a valid JPEG, PNG, or WebP image.");
    }
    return { file, format };
}

async function cloudinarySignature(parameters, apiSecret) {
    const value = Object.entries(parameters)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${key}=${item}`)
        .join("&") + apiSecret;
    const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function uploadCloudinaryImage(request, env) {
    const cloudName = env.CLOUDINARY_CLOUD_NAME || "";
    const apiKey = env.CLOUDINARY_API_KEY || "";
    const apiSecret = env.CLOUDINARY_API_SECRET || "";
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(cloudName) || !apiKey || !apiSecret) {
        return errorResponse("Cloudinary image uploads are not configured.", 503);
    }

    const { file, format } = await readUploadForm(request);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const parameters = { folder: CLOUDINARY_FOLDER, timestamp };
    const signature = await cloudinarySignature(parameters, apiSecret);
    const upload = new FormData();
    upload.append("file", new Blob([file], { type: format.mimeType }),
        `upload-${crypto.randomUUID()}.${format.extension}`);
    upload.append("api_key", apiKey);
    upload.append("timestamp", timestamp);
    upload.append("folder", CLOUDINARY_FOLDER);
    upload.append("signature", signature);

    let response;
    try {
        response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
            method: "POST",
            body: upload
        });
    } catch {
        console.error("Cloudinary image upload request failed.");
        return errorResponse("The image could not be uploaded. Please try again.", 502);
    }
    if (!response.ok) {
        console.error("Cloudinary image upload returned an unsuccessful response.");
        return errorResponse("The image could not be uploaded. Please try again.", 502);
    }

    let result;
    try {
        result = await response.json();
    } catch {
        console.error("Cloudinary image upload returned an invalid response.");
        return errorResponse("The image could not be uploaded. Please try again.", 502);
    }
    if (!isCloudinaryImageUrl(result?.secure_url, cloudName)) {
        console.error("Cloudinary image upload returned an invalid image URL.");
        return errorResponse("The image could not be uploaded. Please try again.", 502);
    }
    return jsonResponse({
        image: {
            url: result.secure_url,
            format: format.extension,
            bytes: file.size
        }
    }, 201);
}

async function handleAdminRoute(request, env, parts) {
    const admin = await requireAdmin(request, env);
    if (!admin) {
        return errorResponse("Authentication required.", 401);
    }
    const db = env.DB;
    const [resource, ...rest] = parts;
    const method = request.method;

    if (resource === "uploads" && !rest.length && method === "POST") {
        return uploadCloudinaryImage(request, env);
    }

    if (resource === "google-sheets" && !rest.length && method === "GET") {
        const counts = await db.prepare(`
            SELECT status, COUNT(*) AS count
            FROM google_sheets_outbox
            GROUP BY status
        `).all();
        const config = googleSheetsConfiguration(env);
        return jsonResponse({
            outbox: Object.fromEntries(
                resultRows(counts).map(row => [row.status, row.count])
            ),
            configured: config.configured && !config.invalid
        });
    }

    if (resource === "google-sheets" &&
        rest.length === 1 && rest[0] === "retry" && method === "POST") {
        const config = googleSheetsConfiguration(env);
        if (!config.configured || config.invalid) {
            return errorResponse("Google Sheets delivery is not configured.", 503);
        }
        const pending = await db.prepare(`
            SELECT id FROM google_sheets_outbox
            WHERE status = 'pending'
            ORDER BY created_at ASC, id ASC
            LIMIT 25
        `).all();
        let sent = 0;
        for (const row of resultRows(pending)) {
            if ((await deliverSheetsOutboxRecord(db, env, row.id, true)).status === "sent") {
                sent += 1;
            }
        }
        return jsonResponse({
            attempted: resultRows(pending).length,
            sent,
            pending: resultRows(pending).length - sent
        });
    }

    if (resource === "summary" && !rest.length && method === "GET") {
        const [projects, pages, blog, inquiries] = await Promise.all([
            db.prepare("SELECT status, COUNT(*) AS count FROM cms_projects GROUP BY status").all(),
            db.prepare("SELECT status, COUNT(*) AS count FROM cms_pages GROUP BY status").all(),
            db.prepare("SELECT status, COUNT(*) AS count FROM cms_blog_posts GROUP BY status").all(),
            db.prepare("SELECT status, COUNT(*) AS count FROM inquiries GROUP BY status").all()
        ]);
        const countByStatus = result => Object.fromEntries(
            resultRows(result).map(row => [row.status, row.count])
        );
        return jsonResponse({
            projects: countByStatus(projects),
            pages: countByStatus(pages),
            blog: countByStatus(blog),
            inquiries: countByStatus(inquiries)
        });
    }

    if (resource === "inquiries" && !rest.length && method === "GET") {
        const url = new URL(request.url);
        const rawPage = Number.parseInt(url.searchParams.get("page") || "1", 10);
        const page = Number.isSafeInteger(rawPage) ? Math.max(1, rawPage) : 1;
        const status = url.searchParams.get("status") || "all";
        const search = (url.searchParams.get("search") || "").trim().slice(0, 120);
        if (!["all", "new", "contacted", "closed"].includes(status)) {
            return errorResponse("Choose a valid enquiry status filter.", 400);
        }
        const conditions = [];
        const parameters = [];
        if (status !== "all") {
            conditions.push("status = ?");
            parameters.push(status);
        }
        if (search) {
            conditions.push("(name LIKE ? OR phone LIKE ? OR email LIKE ? OR project_name LIKE ?)");
            parameters.push(...Array(4).fill(`%${search}%`));
        }
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const totalRow = await db.prepare(`SELECT COUNT(*) AS count FROM inquiries ${where}`)
            .bind(...parameters).first();
        const total = totalRow?.count || 0;
        const pageSize = 50;
        const pages = Math.max(1, Math.ceil(total / pageSize));
        const currentPage = Math.min(page, pages);
        const result = await db.prepare(`
            SELECT id, name, phone, email, message, budget, project_name, source_form, source_page,
                   status, submitted_at
            FROM inquiries ${where}
            ORDER BY submitted_at DESC, id DESC
            LIMIT ? OFFSET ?
        `).bind(...parameters, pageSize, (currentPage - 1) * pageSize).all();
        return jsonResponse({ inquiries: resultRows(result), total, page: currentPage, pages });
    }

    if (resource === "inquiries" && rest.length === 2 && rest[1] === "status" && method === "PATCH") {
        const id = /^\d+$/.test(rest[0]) ? Number(rest[0]) : NaN;
        const body = await readJson(request);
        if (!Number.isSafeInteger(id) || id < 1 ||
            !["new", "contacted", "closed"].includes(body.status)) {
            return errorResponse("Choose a valid enquiry status.", 400);
        }
        const result = await db.prepare("UPDATE inquiries SET status = ? WHERE id = ?")
            .bind(body.status, id).run();
        if (!result.meta?.changes) return errorResponse("Enquiry not found.", 404);
        return jsonResponse({ success: true });
    }

    if (resource === "blog" && !rest.length && method === "GET") {
        const result = await db.prepare(`
            SELECT slug, title, excerpt, content, category, featured_image, published_at,
                   status, created_at, updated_at
            FROM cms_blog_posts
            ORDER BY updated_at DESC, title COLLATE NOCASE ASC
        `).all();
        return jsonResponse({ posts: resultRows(result) });
    }

    if (resource === "blog" && !rest.length && method === "POST") {
        const body = await readJson(request);
        const post = await validateBlogPost(body, request, env);
        const now = new Date().toISOString();
        const result = await db.prepare(`
            INSERT INTO cms_blog_posts
                (slug, title, excerpt, content, category, featured_image, published_at,
                 status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(slug) DO NOTHING
        `).bind(
            post.slug, post.title, post.excerpt, post.content, post.category,
            post.featuredImage, post.publishedAt, post.status, now, now
        ).run();
        if (!result.meta?.changes) return errorResponse("That post URL is already in use.", 409);
        const created = await db.prepare("SELECT * FROM cms_blog_posts WHERE slug = ?")
            .bind(post.slug).first();
        return jsonResponse({ post: created }, 201);
    }

    if (resource === "blog" && rest.length === 1 && method === "PUT") {
        const body = await readJson(request);
        const post = await validateBlogPost(body, request, env);
        const existing = await db.prepare("SELECT slug FROM cms_blog_posts WHERE slug = ?")
            .bind(rest[0]).first();
        if (!existing) return errorResponse("Blog post not found.", 404);
        const duplicate = post.slug === rest[0] ? null : await db.prepare(
            "SELECT slug FROM cms_blog_posts WHERE slug = ?"
        ).bind(post.slug).first();
        if (duplicate) return errorResponse("That post URL is already in use.", 409);
        await db.prepare(`
            UPDATE cms_blog_posts SET
                slug = ?, title = ?, excerpt = ?, content = ?, category = ?,
                featured_image = ?, published_at = ?, status = ?, updated_at = ?
            WHERE slug = ?
        `).bind(
            post.slug, post.title, post.excerpt, post.content, post.category,
            post.featuredImage, post.publishedAt, post.status,
            new Date().toISOString(), rest[0]
        ).run();
        const updated = await db.prepare("SELECT * FROM cms_blog_posts WHERE slug = ?")
            .bind(post.slug).first();
        return jsonResponse({ post: updated });
    }

    if (resource === "blog" && rest.length === 1 && method === "DELETE") {
        const result = await db.prepare("DELETE FROM cms_blog_posts WHERE slug = ?")
            .bind(rest[0]).run();
        if (!result.meta?.changes) return errorResponse("Blog post not found.", 404);
        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    }

    if (resource === "projects" && !rest.length && method === "GET") {
        const url = new URL(request.url);
        const pageValue = Number.parseInt(url.searchParams.get("page") || "1", 10);
        const page = Number.isSafeInteger(pageValue) ? Math.max(1, pageValue) : 1;
        const search = (url.searchParams.get("search") || "").trim().slice(0, 120);
        const requestedStatus = url.searchParams.get("status") || "all";
        const status = ["all", "published", "draft", "deleted"].includes(requestedStatus)
            ? requestedStatus
            : "all";
        const conditions = [];
        const parameters = [];
        if (status === "all") conditions.push("status != 'deleted'");
        else {
            conditions.push("status = ?");
            parameters.push(status);
        }
        if (search) {
            conditions.push("(name LIKE ? OR location LIKE ? OR slug LIKE ?)");
            parameters.push(...Array(3).fill(`%${search}%`));
        }
        const where = `WHERE ${conditions.join(" AND ")}`;
        const totalRow = await db.prepare(`SELECT COUNT(*) AS count FROM cms_projects ${where}`)
            .bind(...parameters).first();
        const total = totalRow?.count || 0;
        const pageSize = 10;
        const pages = Math.max(1, Math.ceil(total / pageSize));
        const currentPage = Math.min(page, pages);
        const result = await db.prepare(`
            SELECT ${projectColumns} FROM cms_projects ${where}
            ORDER BY sort_order ASC, name COLLATE NOCASE ASC
            LIMIT ? OFFSET ?
        `).bind(...parameters, pageSize, (currentPage - 1) * pageSize).all();
        return jsonResponse({
            projects: resultRows(result).map(projectFromRow),
            page: currentPage,
            pageSize,
            total,
            pages
        });
    }

    if (resource === "projects" && !rest.length && method === "POST") {
        const body = await readJson(request);
        const project = await validateProject(body, request, env);
        const now = new Date().toISOString();
        const result = await db.prepare(`
            INSERT INTO cms_projects (
                slug, name, category, location_label, banner_label, location, summary, description,
                page_title, seo_description, card_image, gallery_json, layout_image, map_image,
                amenities_json, video_url, page_path, featured, sort_order, status, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(slug) DO NOTHING
        `).bind(
            project.slug, project.name, project.category, project.locationLabel, project.bannerLabel,
            project.location, project.summary, project.description, project.pageTitle,
            project.seoDescription, project.cardImage, JSON.stringify(project.gallery),
            project.layoutImage, project.mapImage, JSON.stringify(project.amenities),
            project.videoUrl, `/projects/${project.slug}.html`, Number(project.featured),
            project.sortOrder, project.status, now
        ).run();
        if (!result.meta?.changes) return errorResponse("That project URL is already in use.", 409);
        const row = await db.prepare(`SELECT ${projectColumns} FROM cms_projects WHERE slug = ?`)
            .bind(project.slug).first();
        return jsonResponse({ project: projectFromRow(row) }, 201);
    }

    if (resource === "projects" && rest.length === 1 && method === "GET") {
        const row = await db.prepare(`SELECT ${projectColumns} FROM cms_projects WHERE slug = ?`)
            .bind(rest[0]).first();
        if (!row) return errorResponse("Project not found.", 404);
        return jsonResponse({ project: projectFromRow(row) });
    }

    if (resource === "projects" && rest.length === 1 && method === "PUT") {
        const body = await readJson(request);
        const project = await validateProject(body, request, env, rest[0]);
        const result = await db.prepare(`
            UPDATE cms_projects SET
                name = ?, category = ?, location_label = ?, banner_label = ?, location = ?, summary = ?,
                description = ?, page_title = ?, seo_description = ?, card_image = ?,
                gallery_json = ?, layout_image = ?, map_image = ?, amenities_json = ?,
                video_url = ?, featured = ?, sort_order = ?, status = ?, updated_at = ?
            WHERE slug = ?
        `).bind(
            project.name, project.category, project.locationLabel, project.bannerLabel,
            project.location, project.summary, project.description, project.pageTitle,
            project.seoDescription, project.cardImage, JSON.stringify(project.gallery),
            project.layoutImage, project.mapImage, JSON.stringify(project.amenities),
            project.videoUrl, Number(project.featured), project.sortOrder, project.status,
            new Date().toISOString(), project.slug
        ).run();
        if (!result.meta?.changes) return errorResponse("Project not found.", 404);
        const row = await db.prepare(`SELECT ${projectColumns} FROM cms_projects WHERE slug = ?`)
            .bind(project.slug).first();
        return jsonResponse({ project: projectFromRow(row) });
    }

    if (resource === "projects" && rest.length === 1 && method === "DELETE") {
        const result = await db.prepare(`
            UPDATE cms_projects SET status = 'deleted', updated_at = ?
            WHERE slug = ? AND status != 'deleted'
        `).bind(new Date().toISOString(), rest[0]).run();
        if (!result.meta?.changes) return errorResponse("Project not found.", 404);
        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    }

    if (resource === "pages" && !rest.length && method === "GET") {
        const result = await db.prepare(`
            SELECT slug, path, label, title, seo_title, seo_description, content_json, status, updated_at
            FROM cms_pages ORDER BY label COLLATE NOCASE ASC
        `).all();
        return jsonResponse({ pages: resultRows(result).map(pageFromRow) });
    }

    if (resource === "pages" && rest.length === 1 && method === "PUT") {
        const body = await readJson(request);
        const seoTitle = boundedString(body.seoTitle, "SEO title", 200, { required: true });
        const seoDescription = boundedString(body.seoDescription || "", "SEO description", 320);
        if (!["published", "draft"].includes(body.status)) {
            throw new ValidationError("Choose published or unpublished status.");
        }
        const existing = await db.prepare("SELECT content_json FROM cms_pages WHERE slug = ?")
            .bind(rest[0]).first();
        if (!existing) return errorResponse("Page not found.", 404);
        let content;
        try {
            content = JSON.parse(existing.content_json);
        } catch {
            throw new Error("Stored page content is invalid JSON.");
        }
        if (body.content !== undefined) {
            if (!body.content || typeof body.content !== "object" || Array.isArray(body.content)) {
                throw new ValidationError("Page content must be a set of text fields.");
            }
            const keys = Object.keys(body.content);
            if (keys.length > 80) throw new ValidationError("Too many editable page fields.");
            const imagePaths = [];
            for (const key of keys) {
                if (!Object.hasOwn(content, key)) {
                    throw new ValidationError("An unknown page content field was submitted.");
                }
                const value = boundedString(body.content[key], "Page content", 10000);
                if (key.toLowerCase().includes("image")) {
                    content[key] = validateImagePath(value, "Page image", false, env.CLOUDINARY_CLOUD_NAME);
                    imagePaths.push(content[key]);
                } else {
                    content[key] = value;
                }
            }
            await validateImageReferences(imagePaths, request, env);
            if (new TextEncoder().encode(JSON.stringify(content)).byteLength > 64000) {
                throw new ValidationError("Page content is too large to save.");
            }
        }
        const result = await db.prepare(`
            UPDATE cms_pages
            SET seo_title = ?, seo_description = ?, content_json = ?, status = ?, updated_at = ?
            WHERE slug = ?
        `).bind(
            seoTitle, seoDescription, JSON.stringify(content), body.status,
            new Date().toISOString(), rest[0]
        ).run();
        if (!result.meta?.changes) return errorResponse("Page not found.", 404);
        const updated = await db.prepare(`
            SELECT slug, path, label, title, seo_title, seo_description, content_json, status, updated_at
            FROM cms_pages WHERE slug = ?
        `).bind(rest[0]).first();
        return jsonResponse({ page: pageFromRow(updated) });
    }

    if (resource === "settings" && !rest.length && method === "GET") {
        const result = await db.prepare("SELECT key, value FROM cms_settings").all();
        return jsonResponse({
            settings: Object.fromEntries(resultRows(result).map(row => [row.key, row.value]))
        });
    }

    if (resource === "settings" && !rest.length && method === "PUT") {
        const body = await readJson(request);
        const settings = {};
        const now = new Date().toISOString();
        for (const [key, [label, maxLength]] of Object.entries(settingsFields)) {
            const value = boundedString(body[key] || "", label, maxLength);
            if (key === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                throw new ValidationError("Contact email must be valid.");
            }
            if (["phone", "whatsapp"].includes(key) && value && !/^[+0-9()\-\s]{6,40}$/.test(value)) {
                throw new ValidationError(`${label} contains unsupported characters.`);
            }
            settings[key] = value;
        }
        for (const [key, value] of Object.entries(settings)) {
            await db.prepare(`
                INSERT INTO cms_settings (key, value, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            `).bind(key, value, now).run();
        }
        return jsonResponse({ settings });
    }

    return errorResponse("CMS endpoint not found.", 404);
}

function getSubmissionKey(request) {
    const key = request.headers.get("idempotency-key");
    if (key === null) return null;
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) {
        throw new ValidationError("Submission key is invalid.");
    }
    return key;
}

async function checkPublicSubmissionRateLimit(request, db, now) {
    const addressHash = await rateLimitAddress(request);
    await db.prepare(`
        INSERT INTO inquiry_rate_limits (address_hash, window_start, attempts)
        VALUES (?, ?, 1)
        ON CONFLICT(address_hash) DO UPDATE SET
            attempts = CASE
                WHEN julianday(excluded.window_start) <
                    julianday(inquiry_rate_limits.window_start, '+15 minutes')
                THEN inquiry_rate_limits.attempts + 1
                ELSE 1
            END,
            window_start = CASE
                WHEN julianday(excluded.window_start) <
                    julianday(inquiry_rate_limits.window_start, '+15 minutes')
                THEN inquiry_rate_limits.window_start
                ELSE excluded.window_start
            END
    `).bind(addressHash, now.toISOString()).run();
    const rate = await db.prepare(
        "SELECT attempts FROM inquiry_rate_limits WHERE address_hash = ?"
    ).bind(addressHash).first();
    await db.prepare("DELETE FROM inquiry_rate_limits WHERE window_start < ?")
        .bind(new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()).run();
    return Number(rate?.attempts) > 15
        ? jsonResponse(
            { success: false, error: "Too many inquiries. Please try again later." },
            429
        )
        : null;
}

function googleSheetsConfiguration(env) {
    const endpoint = env.GOOGLE_SHEETS_WEB_APP_URL;
    const sharedSecret = env.GOOGLE_SHEETS_SHARED_SECRET;
    if (!endpoint || !sharedSecret) return { configured: false };

    try {
        const url = new URL(endpoint);
        if (url.protocol !== "https:" || url.hostname !== "script.google.com" ||
            url.username || url.password || url.search || url.hash ||
            !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) ||
            typeof sharedSecret !== "string" || sharedSecret.length < 32) {
            return { configured: true, invalid: true };
        }
        return { configured: true, url: url.href, sharedSecret };
    } catch {
        return { configured: true, invalid: true };
    }
}

function sheetsStatusResponse(status) {
    return { status: status === "sent" ? "sent" : "pending" };
}

function sheetsRecord(type, row) {
    if (type === "inquiry") {
        return {
            date: row.submitted_at,
            name: row.name,
            phone: row.phone,
            email: row.email,
            budget: row.budget,
            subject: "",
            message: row.message,
            enquiryType: row.source_form,
            projectName: row.project_name,
            source: row.source_page,
            status: row.status,
            address: "",
            qualification: "",
            experience: "",
            appliedPosition: "",
            resumeUrl: "",
            coverLetter: ""
        };
    }
    return {
        date: row.submitted_at,
        name: row.name,
        phone: row.phone,
        email: row.email,
        subject: row.applied_position,
        message: row.cover_letter,
        enquiryType: "Career application",
        projectName: "",
        source: row.source_page,
        status: row.status,
        address: row.address,
        qualification: row.qualification,
        experience: row.experience,
        appliedPosition: row.applied_position,
        resumeUrl: row.resume_url,
        coverLetter: row.cover_letter
    };
}

function sheetsReceiverErrorCode(result) {
    const knownCodes = new Set([
        "invalid_request",
        "configuration_missing",
        "unauthorized",
        "invalid_submission",
        "spreadsheet_write_failed"
    ]);
    if (knownCodes.has(result.errorCode)) return result.errorCode;

    const legacyCodes = {
        "Not configured.": "configuration_missing",
        "Unauthorized.": "unauthorized",
        "Invalid submission.": "invalid_submission",
        "Unable to write the spreadsheet row.": "spreadsheet_write_failed"
    };
    return legacyCodes[result.error] || "rejected";
}

async function deliverSheetsOutboxRecord(db, env, outboxId, force = false) {
    const config = googleSheetsConfiguration(env);
    if (!config.configured || config.invalid) return { status: "pending" };

    const now = new Date();
    const nowText = now.toISOString();
    const claimed = await db.prepare(`
        UPDATE google_sheets_outbox
        SET status = 'sending', attempts = attempts + 1, locked_until = ?
        WHERE id = ? AND (
            (status = 'pending' AND (? = 1 OR next_attempt_at <= ?))
            OR (status = 'sending' AND locked_until <= ?)
        )
        RETURNING id, record_type, record_id, submission_id, attempts
    `).bind(
        new Date(now.getTime() + 30_000).toISOString(),
        outboxId,
        force ? 1 : 0,
        nowText,
        nowText
    ).first();
    if (!claimed) {
        const existing = await db.prepare(
            "SELECT status FROM google_sheets_outbox WHERE id = ?"
        ).bind(outboxId).first();
        return { status: existing?.status === "sent" ? "sent" : "pending" };
    }

    const table = claimed.record_type === "career"
        ? "career_applications"
        : "inquiries";
    const record = await db.prepare(
        `SELECT * FROM ${table} WHERE id = ?`
    ).bind(claimed.record_id).first();
    let failureCode = record ? "" : "record_missing";

    if (record) {
        try {
            const response = await fetch(config.url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sharedSecret: config.sharedSecret,
                    submissionId: claimed.submission_id,
                    type: claimed.record_type,
                    record: sheetsRecord(claimed.record_type, record)
                }),
                signal: AbortSignal.timeout(8000),
                redirect: "follow"
            });
            if (!response.ok) {
                failureCode = `http_${response.status}`;
            } else {
                const contentType = response.headers.get("content-type") || "";
                if (/text\/html/i.test(contentType)) {
                    failureCode = "unexpected_html_response";
                } else {
                    let result;
                    try {
                        result = await response.json();
                    } catch {
                        failureCode = "invalid_json_response";
                    }
                    if (!failureCode && result?.success === false) {
                        failureCode = `receiver_${sheetsReceiverErrorCode(result)}`;
                    } else if (!failureCode && result?.success !== true) {
                        failureCode = "unexpected_json_shape";
                    } else if (!failureCode && !/application\/json/i.test(contentType)) {
                        failureCode = "unexpected_content_type";
                    }
                }
            }
        } catch (error) {
            failureCode = error?.name === "TimeoutError" || error?.name === "AbortError"
                ? "timeout"
                : "network_error";
        }
    }

    if (!failureCode) {
        await db.prepare(`
            UPDATE google_sheets_outbox
            SET status = 'sent', sent_at = ?, locked_until = NULL, last_error = NULL
            WHERE id = ?
        `).bind(new Date().toISOString(), outboxId).run();
        return { status: "sent" };
    }

    const retryMinutes = Math.min(60, 2 ** Math.min(claimed.attempts - 1, 6));
    await db.prepare(`
        UPDATE google_sheets_outbox
        SET status = 'pending', next_attempt_at = ?, locked_until = NULL, last_error = ?
        WHERE id = ?
    `).bind(
        new Date(Date.now() + retryMinutes * 60_000).toISOString(),
        failureCode,
        outboxId
    ).run();
    console.error("Google Sheets delivery failed:", failureCode);
    return { status: "pending" };
}

async function syncSubmissionToGoogleSheets(db, env, submissionId) {
    const outbox = await db.prepare(
        "SELECT id, status FROM google_sheets_outbox WHERE submission_id = ?"
    ).bind(submissionId).first();
    if (!outbox) return "pending";
    const result = await deliverSheetsOutboxRecord(db, env, outbox.id);
    return result.status;
}

async function submitInquiry(request, env) {
    const body = await readJson(request);
    const inquiry = {
        name: boundedString(body.name, "Name", 120, { required: true }),
        phone: boundedString(body.phone, "Phone number", 40, { required: true }),
        email: boundedString(body.email, "Email", 160),
        message: boundedString(body.message, "Message", 5000),
        budget: boundedString(body.budget, "Budget", 40),
        projectName: boundedString(body.projectName, "Project", 120),
        sourceForm: boundedString(body.sourceForm || body.formType || "Website enquiry", "Source form", 120, { required: true }),
        sourcePage: boundedString(body.sourcePage || "/", "Source page", 300, { required: true })
    };
    if (inquiry.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inquiry.email)) {
        throw new ValidationError("Enter a valid email address.");
    }
    if (inquiry.budget && !allowedBudgets.has(inquiry.budget)) {
        throw new ValidationError("Choose a valid budget.");
    }
    if (Object.hasOwn(body, "budget") && !inquiry.budget) {
        throw new ValidationError("Choose a budget.");
    }

    const submissionKey = getSubmissionKey(request);
    if (submissionKey) {
        const existing = await env.DB.prepare(
            "SELECT id, submitted_at FROM inquiries WHERE submission_key = ?"
        ).bind(submissionKey).first();
        if (existing) {
            const sheetsStatus = await syncSubmissionToGoogleSheets(
                env.DB, env, submissionKey
            );
            return jsonResponse({
                success: true,
                duplicate: true,
                inquiry: { id: existing.id, submittedAt: existing.submitted_at },
                sheets: sheetsStatusResponse(sheetsStatus)
            });
        }
    }

    const now = new Date();
    const rateLimitError = await checkPublicSubmissionRateLimit(request, env.DB, now);
    if (rateLimitError) return rateLimitError;
    const insert = await env.DB.prepare(`
        INSERT INTO inquiries
            (name, phone, email, message, budget, project_name, source_form, source_page,
             status, submitted_at, submission_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)
        ON CONFLICT(submission_key) DO NOTHING
        RETURNING id, submitted_at
    `).bind(
        inquiry.name, inquiry.phone, inquiry.email, inquiry.message, inquiry.budget,
        inquiry.projectName, inquiry.sourceForm, inquiry.sourcePage, now.toISOString(),
        submissionKey
    ).first();
    const saved = insert || (submissionKey
        ? await env.DB.prepare(
            "SELECT id, submitted_at FROM inquiries WHERE submission_key = ?"
        ).bind(submissionKey).first()
        : null);
    if (!saved) throw new Error("The inquiry could not be read after insert.");
    const sheetsStatus = await syncSubmissionToGoogleSheets(
        env.DB, env, submissionKey || `inquiry:${saved.id}`
    );
    return jsonResponse({
        success: true,
        inquiry: { id: saved.id, submittedAt: saved.submitted_at },
        sheets: sheetsStatusResponse(sheetsStatus)
    }, 201);
}

function boundedCareerString(value, label, maxLength, required = true) {
    if (typeof value !== "string" || (required && !value.trim())) {
        throw new ValidationError("Complete all required application fields.");
    }
    const result = value.trim();
    if (result.length > maxLength) {
        throw new ValidationError("One or more application fields are too long.");
    }
    return result;
}

async function submitCareer(request, env) {
    const body = await readJson(request);
    const application = {
        name: boundedCareerString(body.name, "Name", 160),
        phone: boundedCareerString(body.phone, "Phone", 40),
        email: boundedCareerString(body.email, "Email", 160),
        address: boundedCareerString(body.address, "Address", 500),
        qualification: boundedCareerString(body.qualification, "Qualification", 160),
        experience: boundedCareerString(body.experience, "Experience", 160),
        appliedPosition: boundedCareerString(body.appliedPosition, "Position", 160),
        resumeUrl: boundedCareerString(body.resumeUrl || "", "Resume URL", 2048, false),
        coverLetter: boundedCareerString(body.coverLetter || "", "Cover letter", 5000, false)
    };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(application.email)) {
        throw new ValidationError("Enter a valid email address.");
    }
    if (application.resumeUrl) {
        let resume;
        try {
            resume = new URL(application.resumeUrl);
        } catch {
            throw new ValidationError("Resume URL must be a valid HTTPS address.");
        }
        if (resume.protocol !== "https:" || resume.username || resume.password) {
            throw new ValidationError("Resume URL must be a valid HTTPS address.");
        }
    }

    const submissionKey = getSubmissionKey(request);
    if (submissionKey) {
        const existing = await env.DB.prepare(
            "SELECT id, submitted_at FROM career_applications WHERE submission_key = ?"
        ).bind(submissionKey).first();
        if (existing) {
            const sheetsStatus = await syncSubmissionToGoogleSheets(
                env.DB, env, submissionKey
            );
            return jsonResponse({
                success: true,
                duplicate: true,
                application: { id: existing.id, submittedAt: existing.submitted_at },
                sheets: sheetsStatusResponse(sheetsStatus)
            });
        }
    }

    const now = new Date();
    const rateLimitError = await checkPublicSubmissionRateLimit(request, env.DB, now);
    if (rateLimitError) return rateLimitError;
    const insert = await env.DB.prepare(`
        INSERT INTO career_applications
            (name, phone, email, address, qualification, experience, applied_position,
             resume_url, cover_letter, submission_key, submitted_at, source_page)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '/career')
        ON CONFLICT(submission_key) DO NOTHING
        RETURNING id, submitted_at
    `).bind(
        application.name, application.phone, application.email, application.address,
        application.qualification, application.experience, application.appliedPosition,
        application.resumeUrl, application.coverLetter, submissionKey, now.toISOString()
    ).first();
    const saved = insert || (submissionKey
        ? await env.DB.prepare(
            "SELECT id, submitted_at FROM career_applications WHERE submission_key = ?"
        ).bind(submissionKey).first()
        : null);
    if (!saved) throw new Error("The career application could not be read after insert.");
    const sheetsStatus = await syncSubmissionToGoogleSheets(
        env.DB, env, submissionKey || `career:${saved.id}`
    );
    return jsonResponse({
        success: true,
        message: "Application saved.",
        application: { id: saved.id, submittedAt: saved.submitted_at },
        sheets: sheetsStatusResponse(sheetsStatus)
    }, 201);
}

function decodePath(pathname) {
    return pathname.split("/").filter(Boolean).map(part => {
        try {
            return decodeURIComponent(part);
        } catch {
            throw new ValidationError("Request path is invalid.");
        }
    });
}

async function handleCmsRequest(request, env) {
    const parts = decodePath(new URL(request.url).pathname.replace(/^\/api\/cms\/?/, ""));
    if (!parts.length) return errorResponse("CMS endpoint not found.", 404);
    if (parts[0] === "auth") {
        if (parts.length === 2 && parts[1] === "login" && request.method === "POST") {
            return handleLogin(request, env);
        }
        if (parts.length === 2 && parts[1] === "logout" && request.method === "POST") {
            return handleLogout(request, env);
        }
        if (parts.length === 2 && parts[1] === "bootstrap" && request.method === "POST") {
            return handleBootstrap(request, env);
        }
        if (parts.length === 2 && parts[1] === "session" && request.method === "GET") {
            const admin = await requireAdmin(request, env);
            if (!admin) {
                return errorResponse("Authentication required.", 401, {
                    "Set-Cookie": sessionCookie("", 0)
                });
            }
            return jsonResponse({
                admin: {
                    ...admin,
                    cloudinaryCloudName: env.CLOUDINARY_CLOUD_NAME || ""
                }
            });
        }
        return errorResponse("CMS endpoint not found.", 404);
    }

    if (parts[0] === "public") {
        const response = await publicCmsRoute(request, env, parts.slice(1));
        return response || errorResponse("CMS endpoint not found.", 404);
    }

    if (parts[0] === "admin") {
        if (!["GET", "HEAD"].includes(request.method)) {
            const originError = await requireSameOrigin(request);
            if (originError) return originError;
        }
        return handleAdminRoute(request, env, parts.slice(1));
    }

    return errorResponse("CMS endpoint not found.", 404);
}

export async function handleApiRequest(request, env) {
    const pathname = new URL(request.url).pathname;
    try {
        if (pathname === "/api/health" && request.method === "GET") {
            if (!env.DB) return errorResponse("D1 is not configured.", 503);
            await env.DB.prepare("SELECT 1 AS ok").first();
            return jsonResponse({ status: "ok", database: "connected" });
        }
        if (pathname === "/api/career") {
            if (request.method !== "POST") {
                return errorResponse("Method not allowed.", 405, { Allow: "POST" });
            }
            if (!env.DB) return errorResponse("D1 is not configured.", 503);
            return await submitCareer(request, env);
        }
        if (pathname === "/api/inquiry" || pathname === "/api/popupinquiry") {
            if (request.method !== "POST") {
                return errorResponse("Method not allowed.", 405, { Allow: "POST" });
            }
            if (!env.DB) return errorResponse("D1 is not configured.", 503);
            return await submitInquiry(request, env);
        }
        if (!pathname.startsWith("/api/cms/")) {
            return errorResponse("API endpoint not found.", 404);
        }
        if (!env.DB) return errorResponse("D1 is not configured.", 503);
        return await handleCmsRequest(request, env);
    } catch (error) {
        if (error instanceof PayloadTooLargeError) return errorResponse(error.message, 413);
        if (error instanceof ValidationError) return errorResponse(error.message, 400);
        console.error(
            "Pages D1 API request failed:",
            error instanceof Error
                ? `${error.name}: ${error.message.slice(0, 240)}`
                : "UnknownError"
        );
        return errorResponse("The request could not be completed.", 500);
    }
}

export async function findPublishedBlogPost(db, slug) {
    return db.prepare(`
        SELECT slug FROM cms_blog_posts WHERE slug = ? AND status = 'published'
    `).bind(slug).first();
}

export async function findPublishedProject(db, slug) {
    return db.prepare(`
        SELECT slug, page_path FROM cms_projects
        WHERE slug = ? AND status = 'published'
    `).bind(slug).first();
}
