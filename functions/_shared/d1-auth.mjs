export const SESSION_COOKIE = "raj_cms_session";
export const SESSION_DURATION_SECONDS = 8 * 60 * 60;
export const PBKDF2_ITERATIONS = 600_000;

const encoder = new TextEncoder();
const dummySalt = new Uint8Array(16);

function bytesToHex(bytes) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value) {
    if (typeof value !== "string" || !/^(?:[a-f0-9]{2})+$/i.test(value)) {
        return new Uint8Array();
    }
    return Uint8Array.from(value.match(/.{2}/g), byte => Number.parseInt(byte, 16));
}

export async function derivePasswordHash(password, salt, iterations = PBKDF2_ITERATIONS) {
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        "PBKDF2",
        false,
        ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits({
        name: "PBKDF2",
        hash: "SHA-256",
        salt,
        iterations
    }, key, 256);
    return bytesToHex(new Uint8Array(bits));
}

export async function createPasswordRecord(password) {
    if (typeof password !== "string" || password.length < 12 || password.length > 256) {
        throw new TypeError("Password must be 12 to 256 characters long.");
    }

    const salt = crypto.getRandomValues(new Uint8Array(16));
    return {
        salt: bytesToHex(salt),
        hash: await derivePasswordHash(password, salt),
        algorithm: "pbkdf2-sha256",
        iterations: PBKDF2_ITERATIONS
    };
}

export async function verifyPassword(password, admin) {
    const salt = hexToBytes(admin?.password_salt);
    const expectedHash = hexToBytes(admin?.password_hash);
    const iterations = Number(admin?.password_iterations);
    if (admin?.password_algorithm !== "pbkdf2-sha256" ||
        salt.length !== 16 || expectedHash.length !== 32 ||
        !Number.isInteger(iterations) || iterations < PBKDF2_ITERATIONS ||
        iterations > 2_000_000) {
        await derivePasswordHash(password, dummySalt);
        return false;
    }

    const actualHash = hexToBytes(await derivePasswordHash(password, salt, iterations));
    let difference = 0;
    for (let index = 0; index < expectedHash.length; index += 1) {
        difference |= expectedHash[index] ^ actualHash[index];
    }
    return difference === 0;
}

export async function hashToken(token) {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
    return bytesToHex(new Uint8Array(digest));
}

export function readCookie(request, name) {
    const cookieHeader = request.headers.get("cookie") || "";
    for (const part of cookieHeader.split(";")) {
        const separator = part.indexOf("=");
        if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
        try {
            return decodeURIComponent(part.slice(separator + 1).trim());
        } catch {
            return "";
        }
    }
    return "";
}

export function sessionCookie(token, maxAge = SESSION_DURATION_SECONDS) {
    return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export function newSessionToken() {
    return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function getSession(request, db) {
    const token = readCookie(request, SESSION_COOKIE);
    if (!token) return null;

    return db.prepare(`
        SELECT admins.id, admins.email
        FROM cms_sessions
        JOIN admins ON admins.id = cms_sessions.admin_id
        WHERE cms_sessions.token_hash = ? AND cms_sessions.expires_at > ?
    `).bind(await hashToken(token), new Date().toISOString()).first();
}

export function sameOriginMutationAllowed(request) {
    const origin = request.headers.get("origin");
    if (!origin) return false;

    try {
        return new URL(origin).origin === new URL(request.url).origin;
    } catch {
        return false;
    }
}
