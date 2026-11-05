ALTER TABLE inquiries ADD COLUMN submission_key TEXT;
CREATE UNIQUE INDEX inquiries_submission_key ON inquiries(submission_key);

CREATE TABLE career_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    address TEXT NOT NULL,
    qualification TEXT NOT NULL,
    experience TEXT NOT NULL,
    applied_position TEXT NOT NULL,
    resume_url TEXT NOT NULL DEFAULT '',
    cover_letter TEXT NOT NULL DEFAULT '',
    submission_key TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'contacted', 'closed')),
    submitted_at TEXT NOT NULL,
    source_page TEXT NOT NULL DEFAULT '/career'
);
CREATE INDEX career_applications_submitted_at
    ON career_applications(submitted_at DESC);

CREATE TABLE google_sheets_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_type TEXT NOT NULL CHECK (record_type IN ('inquiry', 'career')),
    record_id INTEGER NOT NULL,
    submission_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sending', 'sent')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TEXT NOT NULL,
    locked_until TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    sent_at TEXT
);
CREATE INDEX google_sheets_outbox_pending
    ON google_sheets_outbox(status, next_attempt_at, created_at);

CREATE TRIGGER inquiries_google_sheets_outbox_insert
AFTER INSERT ON inquiries
BEGIN
    INSERT INTO google_sheets_outbox
        (record_type, record_id, submission_id, next_attempt_at, created_at)
    VALUES (
        'inquiry',
        NEW.id,
        COALESCE(NEW.submission_key, 'inquiry:' || NEW.id),
        NEW.submitted_at,
        NEW.submitted_at
    );
END;

CREATE TRIGGER career_applications_google_sheets_outbox_insert
AFTER INSERT ON career_applications
BEGIN
    INSERT INTO google_sheets_outbox
        (record_type, record_id, submission_id, next_attempt_at, created_at)
    VALUES (
        'career',
        NEW.id,
        COALESCE(NEW.submission_key, 'career:' || NEW.id),
        NEW.submitted_at,
        NEW.submitted_at
    );
END;
