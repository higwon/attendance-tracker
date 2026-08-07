ALTER TABLE attendance ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual', 'erp'));
ALTER TABLE attendance ADD COLUMN paid_work_hours REAL NOT NULL DEFAULT 0;
ALTER TABLE attendance ADD COLUMN imported_at TEXT;
ALTER TABLE attendance ADD COLUMN external_source TEXT;
ALTER TABLE attendance ADD COLUMN external_record_hash TEXT;
ALTER TABLE attendance ADD COLUMN erp_work_item_name TEXT;
ALTER TABLE attendance ADD COLUMN erp_status_name TEXT;
ALTER TABLE attendance ADD COLUMN erp_day_type_name TEXT;
ALTER TABLE attendance ADD COLUMN erp_is_holiday INTEGER;

CREATE INDEX idx_attendance_external_hash
  ON attendance(user_id, external_source, external_record_hash);
