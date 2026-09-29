-- Big files (chunked uploads) are stored as ordered parts so they never have to fit in memory:
-- nodes.blob holds a small pointer `pgp:<id>`, the bytes live here in <= 8 MB rows.
CREATE TABLE IF NOT EXISTS blob_parts (
  id   uuid    NOT NULL,
  idx  integer NOT NULL,
  data bytea   NOT NULL,
  PRIMARY KEY (id, idx)
);
