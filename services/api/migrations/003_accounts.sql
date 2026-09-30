ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;
CREATE UNIQUE INDEX users_phone ON users(phone) WHERE phone IS NOT NULL;
CREATE TABLE auth_attempts(key TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER NOT NULL);
