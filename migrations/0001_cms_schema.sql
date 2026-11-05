PRAGMA foreign_keys = ON;

CREATE TABLE admins (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_algorithm TEXT NOT NULL CHECK (password_algorithm = 'pbkdf2-sha256'),
    password_iterations INTEGER NOT NULL CHECK (password_iterations >= 600000),
    created_at TEXT NOT NULL
);

CREATE TABLE cms_sessions (
    token_hash TEXT PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX cms_sessions_expiry ON cms_sessions(expires_at);

CREATE TABLE cms_login_attempts (
    address TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    blocked_until TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE cms_pages (
    slug TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    title TEXT NOT NULL,
    seo_title TEXT NOT NULL,
    seo_description TEXT NOT NULL DEFAULT '',
    content_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'published'
        CHECK (status IN ('published', 'draft', 'deleted')),
    updated_at TEXT NOT NULL
);

CREATE TABLE cms_projects (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'jaipur',
    location_label TEXT NOT NULL DEFAULT '',
    banner_label TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    page_title TEXT NOT NULL DEFAULT '',
    seo_description TEXT NOT NULL DEFAULT '',
    card_image TEXT NOT NULL DEFAULT '',
    gallery_json TEXT NOT NULL DEFAULT '[]',
    layout_image TEXT NOT NULL DEFAULT '',
    map_image TEXT NOT NULL DEFAULT '',
    amenities_json TEXT NOT NULL DEFAULT '[]',
    video_url TEXT NOT NULL DEFAULT '',
    page_path TEXT NOT NULL,
    featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'published'
        CHECK (status IN ('published', 'draft', 'deleted')),
    updated_at TEXT NOT NULL
);
CREATE INDEX cms_projects_public_order
    ON cms_projects(status, sort_order, name);

CREATE TABLE cms_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE cms_blog_posts (
    slug TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    excerpt TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT NOT NULL,
    featured_image TEXT NOT NULL,
    published_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('published', 'draft')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX cms_blog_posts_public_order
    ON cms_blog_posts(status, published_at DESC);

CREATE TABLE inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    budget TEXT NOT NULL DEFAULT '',
    project_name TEXT NOT NULL DEFAULT '',
    source_form TEXT NOT NULL DEFAULT 'Website enquiry',
    source_page TEXT NOT NULL DEFAULT '/',
    status TEXT NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'contacted', 'closed')),
    submitted_at TEXT NOT NULL
);
CREATE INDEX inquiries_submitted_at ON inquiries(submitted_at DESC);

CREATE TABLE inquiry_rate_limits (
    address_hash TEXT PRIMARY KEY,
    window_start TEXT NOT NULL,
    attempts INTEGER NOT NULL CHECK (attempts >= 0)
);
