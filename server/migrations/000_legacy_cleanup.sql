-- Self-healing cleanup for databases that previously ran the old "quist-backend"
-- dev-portal app on this Railway service. That app created `builds`,
-- `admin_users`, and `download_log` with a different shape. Its `builds` table
-- collides with ours (same name, different columns), which would make our
-- CREATE TABLE IF NOT EXISTS a silent no-op and break every build query.
--
-- Runs once, before 001_init.sql. Every drop is guarded so it is a no-op on a
-- fresh database and can never remove OUR tables:
--   * the legacy `builds` is identified by its `filedata` column (ours has none)
--   * `admin_users` / `download_log` never exist in our schema at all
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'builds' AND column_name = 'filedata'
  ) THEN
    DROP TABLE IF EXISTS builds CASCADE;
    RAISE NOTICE 'quist: dropped legacy builds table';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admin_users') THEN
    DROP TABLE IF EXISTS admin_users CASCADE;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'download_log') THEN
    DROP TABLE IF EXISTS download_log CASCADE;
  END IF;
END $$;
