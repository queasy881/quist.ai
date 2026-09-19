-- The Railway database was previously used by unrelated apps (a Python
-- "auto-migrate DB tables" portal, etc.) that created tables sharing our names
-- with different shapes — e.g. a `users` table whose `id` is not a uuid. That
-- makes `CREATE TABLE IF NOT EXISTS` in 001 a no-op and then our foreign keys
-- fail ("foreign key constraint ... cannot be implemented").
--
-- Detect that situation precisely and clear only foreign leftovers: if 001 has
-- never been applied yet AND any of our core tables already exist, they can only
-- be another app's — so drop our whole table set and let 001 build it fresh.
-- On a healthy Quist DB, 001 IS recorded, so this never runs. On a fresh DB,
-- none of our tables exist, so this never runs.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM migrations WHERE name = '001_init.sql')
     AND EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('users','sessions','api_tokens','projects','nodes','edges','versions','terminal_sessions','builds','artifacts','blobs')
     ) THEN
    DROP TABLE IF EXISTS
      artifacts, builds, versions, terminal_sessions, edges, nodes, projects, api_tokens, sessions, users, blobs
      CASCADE;
    RAISE NOTICE 'quist: dropped foreign leftover tables before init';
  END IF;
END $$;
