const {
    createHash,
    randomBytes,
    scryptSync,
    timingSafeEqual
} = require("node:crypto");
const { db } = require("./database");

const SESSION_COOKIE = "raj_cms_session";
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
    return {
        salt,
        hash: scryptSync(password, salt, 64).toString("hex")
    };
}

function verifyPassword(password, salt, expectedHash) {
    const actualHash = scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHash, "hex");
    return expected.length === actualHash.length && timingSafeEqual(actualHash, expected);
}

function hashToken(token) {
    return createHash("sha256").update(token).digest("hex");
}

function cookieValue(req, name) {
    const cookieHeader = req.headers.cookie || "";
    for (const part of cookieHeader.split(";")) {
        const separator = part.indexOf("=");
        if (separator < 0) continue;
        if (part.slice(0, separator).trim() === name) {
            return decodeURIComponent(part.slice(separator + 1).trim());
        }
    }
    return "";
}

function getSessionToken(req) {
    return cookieValue(req, SESSION_COOKIE);
}

function setSessionCookie(res, token) {
    const attributes = [
        `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Strict",
        `Max-Age=${Math.floor(SESSION_DURATION_MS / 1000)}`
    ];
    if (process.env.NODE_ENV === "production") attributes.push("Secure");
    res.setHeader("Set-Cookie", attributes.join("; "));
}

function clearSessionCookie(res) {
    const attributes = [
        `${SESSION_COOKIE}=`,
        "Path=/",
        "HttpOnly",
        "SameSite=Strict",
        "Max-Age=0"
    ];
    if (process.env.NODE_ENV === "production") attributes.push("Secure");
    res.setHeader("Set-Cookie", attributes.join("; "));
}

function createSession(adminId) {
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS).toISOString();
    db.prepare(`
        INSERT INTO cms_sessions (token_hash, admin_id, expires_at, created_at)
        VALUES (?, ?, ?, ?)
    `).run(hashToken(token), adminId, expiresAt, now.toISOString());
    db.prepare("DELETE FROM cms_sessions WHERE expires_at <= ?").run(now.toISOString());
    return token;
}

function authenticateRequest(req, res, next) {
    const token = cookieValue(req, SESSION_COOKIE);
    if (!token) {
        return res.status(401).json({ error: "Authentication required." });
    }

    const session = db.prepare(`
        SELECT admins.id, admins.email
        FROM cms_sessions
        JOIN admins ON admins.id = cms_sessions.admin_id
        WHERE cms_sessions.token_hash = ? AND cms_sessions.expires_at > ?
    `).get(hashToken(token), new Date().toISOString());

    if (!session) {
        clearSessionCookie(res);
        return res.status(401).json({ error: "Authentication required." });
    }

    req.cmsAdmin = { id: session.id, email: session.email };
    next();
}

function requireSameOrigin(req, res, next) {
    const origin = req.get("origin");
    if (!origin) {
        return res.status(403).json({ error: "A same-origin request is required." });
    }

    let originHost;
    try {
        originHost = new URL(origin).host;
    } catch {
        return res.status(403).json({ error: "A same-origin request is required." });
    }

    if (originHost !== req.get("host")) {
        return res.status(403).json({ error: "A same-origin request is required." });
    }

    next();
}

function registerAdmin(email, password) {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        throw new Error("Enter a valid administrator email address.");
    }
    if (password.length < 12 || password.length > 256) {
        throw new Error("Administrator passwords must be 12 to 256 characters long.");
    }

    const { salt, hash } = hashPassword(password);
    db.prepare(`
        INSERT INTO admins (email, password_salt, password_hash, created_at)
        VALUES (?, ?, ?, ?)
    `).run(normalizedEmail, salt, hash, new Date().toISOString());
}

module.exports = {
    SESSION_COOKIE,
    authenticateRequest,
    clearSessionCookie,
    createSession,
    getSessionToken,
    hashPassword,
    registerAdmin,
    requireSameOrigin,
    setSessionCookie,
    verifyPassword
};
