ALTER TABLE users ADD COLUMN last_active_at TEXT;

UPDATE users
SET last_active_at = last_login_at
WHERE last_login_at IS NOT NULL;
