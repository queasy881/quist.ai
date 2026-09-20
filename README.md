# Quist.ai — cloud storage unit

Your files live on the server, not on one laptop. Sign in from any machine and
the same workspace is there: a Railway-style dotted graph canvas where **folders
own folders and files**, a Monaco editor, a real terminal, versioned snapshots,
and a server-side build pipeline with downloadable binaries. Upload a project
from one PC, pick it up on another — no USB drives, no copying gigabytes around.

```
   PC A                         Railway                         PC B
┌──────────┐   upload files   ┌───────────────────────────┐   download / edit  ┌──────────┐
│ browser  │ ───────────────► │ quist.ai                  │ ◄───────────────── │ browser  │
│          │                  │  Postgres = your files    │                    │          │
└──────────┘                  │  canvas · editor · shell  │                    └──────────┘
                              │  versions · builds        │
                              └───────────────────────────┘
```

## What's here

| | |
|---|---|
| `server/` | Express API + WebSocket terminal/build streams |
| `server/graph.js` | the node/edge model: folder-only ownership, one owner per node, no cycles — enforced in code **and** by a Postgres trigger; plus a bulk-import path for large trees |
| `server/workspace.js` | two-way sync between the Postgres graph and a real directory (chokidar) |
| `server/sandbox.js` | where shells/builds run: `local` driver (Railway) or `docker` driver (VPS) |
| `server/builds.js` | queued build jobs, streamed logs, artifacts |
| `server/storage.js` | storage seam: Postgres by default, R2/S3 when `R2_*` env is set |
| `public/` | the UI — the design file, wired to the API + an xterm terminal |
| `sandbox/` | the per-project shell built-ins + the `quist-sandbox` Docker image |
| `test/` | integration tests against an embedded Postgres |

## Run locally

```bash
npm install
npm run dev          # boots an embedded Postgres + the app on :3000
# or point at your own Postgres:
DATABASE_URL=postgres://user:pass@localhost:5432/quist npm start
```

Open http://localhost:3000, create an account, create a project.

```bash
npm test             # integration tests (embedded Postgres)
```

## Using it

- **New project** → a fresh graph canvas.
- **Right-click the canvas** to create a file or folder, or **Upload from disk**
  (single files or a whole folder — the tree is preserved).
- **Drag a folder's right-hand port onto another node** to make the folder own
  it. Files have an input port only; a file can never own anything.
- **Double-click a file** to open it in the Monaco editor; edits autosave.
- **Terminal** (bottom pane) is a real shell in the project's server-side
  workspace; anything it writes shows up on the canvas, and vice versa.
- **Versions** tab: snapshot the whole project under a label and roll every file
  back to it later.
- **Builds** tab: compile server-side with a toolchain preset; finished binaries
  are downloadable from any machine you sign in from.
- **Download** any file (right-click → Download) or build artifact.

Everything is per-user and per-project; no one can read another user's files.

## Programmatic / command-line access (optional)

The same file API is reachable with a per-user bearer token for scripting uploads
and downloads from headless machines — e.g. `curl -H "Authorization: Bearer …"`.
Key endpoints: `POST /api/projects/:id/files` (write one file),
`POST /api/projects/:id/files/bulk` (many at once), `POST /api/projects/:id/upload`
(multipart), `GET /api/projects/:id/tree`, `GET /api/nodes/:id/download`.

## Deploy on Railway

1. New project → **Deploy from GitHub repo** (this repo). Railway builds the
   `Dockerfile` (Node + clang/gcc, Python, Go, Rust, Zig, JDK, MinGW-w64 — so
   the build feature works out of the box with `SANDBOX_DRIVER=local`).
2. Add a **Postgres** plugin. `DATABASE_URL` is injected automatically;
   migrations run on boot (and auto-clean any tables left by a previous app).
3. Optional: a persistent **Volume** at `/data`, and Cloudflare **R2** for large
   blobs (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
   `R2_BUCKET`). Full list in `.env.example`.

## The rules, enforced server-side

- `edges.from_node` must be a folder.
- `UNIQUE(to_node)` — every node has at most one owner.
- Cycles are rejected.
- Deleting a folder orphans its children (they become roots) unless `cascade`.
- Every query is scoped by `user_id`; no cross-tenant read is possible.

See `test/graph.test.js`.
