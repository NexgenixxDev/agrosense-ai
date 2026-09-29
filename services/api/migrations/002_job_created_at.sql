ALTER TABLE jobs ADD COLUMN created_at INTEGER;
UPDATE jobs SET created_at=available_at WHERE created_at IS NULL;
CREATE INDEX jobs_created ON jobs(created_at);
