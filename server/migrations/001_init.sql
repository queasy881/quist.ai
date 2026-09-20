-- Quist.ai — initial schema.
-- Every table that holds user data hangs off users.id; every query in the
-- server is additionally scoped by user_id (see server/db.js helpers).

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

-- Per-user API tokens for programmatic / command-line access to the file API.
-- Only a sha256 of the token is stored; `prefix` is the first 12 chars for display.
CREATE TABLE IF NOT EXISTS api_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL DEFAULT 'claude-code',
  token_hash   text NOT NULL UNIQUE,
  prefix       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS api_tokens_user_idx ON api_tokens(user_id);

CREATE TABLE IF NOT EXISTS projects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  mcp_disabled text[] NOT NULL DEFAULT '{}',   -- tool names switched off in the MCP tab
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_user_idx ON projects(user_id);

-- Nodes are files and folders on the canvas. Text content lives in `content`;
-- binary uploads live in `blob` (content IS NULL). This is the storage seam:
-- server/storage.js is the only module that touches content/blob directly.
CREATE TABLE IF NOT EXISTS nodes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('file','folder')),
  name       text NOT NULL,
  x          double precision NOT NULL DEFAULT 0,
  y          double precision NOT NULL DEFAULT 0,
  content    text,
  blob       bytea,
  lang       text,
  size       bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nodes_project_idx ON nodes(project_id);

-- A folder owns a node. UNIQUE(to_node): every node has at most one owner.
CREATE TABLE IF NOT EXISTS edges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_node  uuid NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  to_node    uuid NOT NULL UNIQUE REFERENCES nodes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_node <> to_node)
);
CREATE INDEX IF NOT EXISTS edges_project_idx ON edges(project_id);
CREATE INDEX IF NOT EXISTS edges_from_idx ON edges(from_node);

-- Rules enforced in the database, independent of the UI or the API layer:
--   * from_node must be a folder
--   * both ends must belong to edges.project_id
--   * the edge must not create a cycle
CREATE OR REPLACE FUNCTION edges_guard() RETURNS trigger AS $$
DECLARE
  from_kind text;
  from_proj uuid;
  to_proj   uuid;
  cyc       int;
BEGIN
  SELECT kind, project_id INTO from_kind, from_proj FROM nodes WHERE id = NEW.from_node;
  SELECT project_id INTO to_proj FROM nodes WHERE id = NEW.to_node;
  IF from_kind IS NULL OR to_proj IS NULL THEN
    RAISE EXCEPTION 'edge references a missing node' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF from_kind <> 'folder' THEN
    RAISE EXCEPTION 'only folders can own nodes' USING ERRCODE = 'check_violation';
  END IF;
  IF from_proj <> NEW.project_id OR to_proj <> NEW.project_id THEN
    RAISE EXCEPTION 'edge crosses projects' USING ERRCODE = 'check_violation';
  END IF;
  -- walk up from the would-be owner; if we reach the child, it's a cycle
  WITH RECURSIVE up AS (
    SELECT e.from_node AS n FROM edges e WHERE e.to_node = NEW.from_node
    UNION
    SELECT e.from_node FROM edges e JOIN up ON e.to_node = up.n
  )
  SELECT count(*) INTO cyc FROM up WHERE n = NEW.to_node;
  IF cyc > 0 THEN
    RAISE EXCEPTION 'link would create a cycle' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS edges_guard_trg ON edges;
CREATE TRIGGER edges_guard_trg BEFORE INSERT OR UPDATE ON edges
  FOR EACH ROW EXECUTE FUNCTION edges_guard();

-- Full copy of nodes (without blobs — binary nodes are referenced by id) and edges.
CREATE TABLE IF NOT EXISTS versions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label      text NOT NULL,
  snapshot   jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS versions_project_idx ON versions(project_id, created_at DESC);

-- Terminal scrollback so the shell survives a page reload / server restart.
CREATE TABLE IF NOT EXISTS terminal_sessions (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  scrollback text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Build jobs are queued rows; a worker in the server process drains them.
CREATE TABLE IF NOT EXISTS builds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  toolchain     text NOT NULL,
  command       text NOT NULL,
  artifact_glob text NOT NULL DEFAULT '',
  label         text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  log           text NOT NULL DEFAULT '',
  exit_code     int,
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz
);
CREATE INDEX IF NOT EXISTS builds_project_idx ON builds(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS builds_queue_idx ON builds(status, created_at) WHERE status = 'queued';

-- Build outputs. `data` is the bytea store; `storage_key` is the seam for S3/R2.
CREATE TABLE IF NOT EXISTS artifacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  build_id    uuid NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  size        bigint NOT NULL,
  data        bytea,
  storage_key text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS artifacts_project_idx ON artifacts(project_id, created_at DESC);

-- Content-addressed store for binary file bytes referenced by version snapshots,
-- so a snapshot's jsonb stays small. Text content is inlined in the snapshot.
CREATE TABLE IF NOT EXISTS blobs (
  sha256     text PRIMARY KEY,
  data       bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
