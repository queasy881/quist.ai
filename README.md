# Quist.ai — cloud coding unit

Your multi-gigabyte projects live on the server, not your laptop. Sign in from
any machine and the same workspace is there: a Railway-style dotted graph canvas
where **folders own folders and files**, a Monaco editor, a real terminal, a
server-side build pipeline with downloadable binaries — and an MCP server so
**Claude Code on your laptop codes into the cloud without ever touching your
local disk**.

```
your laptop                                   Railway
┌───────────────────────────┐                 ┌──────────────────────────────┐
│ Claude Code desktop        │                 │ quist.ai backend             │
│   the model + the coding   │  HTTPS + token  │   Postgres  =  the project    │
│   └─ stdio ─► quist-mcp.js ─┼────────────────┼─►  files / exec / build       │
│              (16 tools)    │                 │   ▲  same graph  ▼            │
│  local disk: NOT touched   │                 │   browser canvas + terminal  │
└───────────────────────────┘                 └──────────────────────────────┘
```

Claude Code is the agent. Quist is its filesystem, shell and compiler. The
backend never calls Anthropic — it holds no model key. The only secrets are
`DATABASE_URL` and the per-user API tokens (stored hashed).

## What's here

| | |
|---|---|
| `server/` | Express API + WebSocket terminal/build streams |
| `server/graph.js` | the node/edge model: folder-only ownership, one owner per node, no cycles — enforced in code **and** by a Postgres trigger |
| `server/workspace.js` | two-way sync between the Postgres graph and a real directory (chokidar) |
| `server/sandbox.js` | where shells/builds run: `local` driver (Railway) or `docker` driver (VPS) |
| `server/builds.js` | queued build jobs, streamed logs, artifacts |
| `server/storage.js` | storage seam: Postgres by default, R2/S3 when `R2_*` env is set |
| `mcp/quist-mcp.js` | the MCP server that runs on your laptop (zero deps, Node ≥ 18) |
| `public/` | the UI — a straight port of the design file, wired to the API |
| `sandbox/` | the per-project shell built-ins + the `quist-sandbox` Docker image |
| `test/` | integration tests against an embedded Postgres, incl. a full MCP round-trip |

## Run locally

```bash
npm install
# option A: use the bundled embedded Postgres (no external DB needed)
npm run dev          # if you wire dev-server.js, or:
node test/dev-server.js
# option B: point at your own Postgres
DATABASE_URL=postgres://user:pass@localhost:5432/quist npm start
```

Open http://localhost:3000, create an account, create a project.

```bash
npm test             # 25 integration tests (embedded Postgres, real MCP stdio)
```

## Connect Claude Code (the point of the product)

1. In the **MCP** tab, click **Connect Claude Code**. It mints a token (shown
   once) and prints a ready `.mcp.json`. Download `quist-mcp.js` from the link
   (or grab `mcp/quist-mcp.js` from this repo). It needs only Node ≥ 18.

2. In the folder where you'll run Claude Code, save `.mcp.json`:

   ```json
   {
     "mcpServers": {
       "quist": {
         "command": "node",
         "args": ["/absolute/path/to/quist-mcp.js"],
         "env": {
           "QUIST_URL": "https://your-app.up.railway.app",
           "QUIST_TOKEN": "qst_…",
           "QUIST_PROJECT": "<project id>"
         }
       }
     }
   }
   ```

3. **Make the MCP tools the only path to files.** Claude Code prefers its own
   `Read/Write/Edit/Bash` against the local disk; deny them so the two views
   can't diverge. In `.claude/settings.json` next to your `.mcp.json`:

   ```json
   {
     "permissions": {
       "deny": ["Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "Glob", "Grep"]
     },
     "enabledMcpjsonServers": ["quist"]
   }
   ```

   Now `read_file`, `create_file`, `edit_file`, `search_files`, `run_shell`,
   `build`, … all resolve to the cloud project. Start `claude` in that folder;
   it will list the `quist` tools.

### The 16 tools

`list_projects`, `use_project`, `list_tree`, `read_file`, `read_files`
(batched), `create_file`, `edit_file` (string-replace or full write),
`create_folder`, `move_node`, `delete_node`, `search_files` (grep),
`run_shell`, `build` (streams the log, waits), `set_version`, `revert_version`,
and the two disk bridges:

- **`upload_file`** — read a file *or folder* from the laptop's disk and push it
  into the graph (skips `node_modules`, `.git`, …). This is how a multi-GB
  project moves off the laptop once and never needs a USB drive again. The only
  tool that reads local disk.
- **`download_file`** — save a project file, or a finished build artifact, back
  to the laptop.

Latency note: a local read is microseconds, an MCP round trip 50–200ms. The
server returns whole directories in one call (`list_tree`), supports batched
reads (`read_files`), and inlines text so grep/search never round-trips per line.

## Deploy on Railway

1. New project → **Deploy from GitHub repo** (this repo). Railway builds the
   `Dockerfile` (Node + clang/gcc, Python, Go, Rust, Zig, JDK, MinGW-w64 — so
   `build` works out of the box with `SANDBOX_DRIVER=local`).
2. Add a **Postgres** plugin. `DATABASE_URL` is injected automatically;
   migrations run on boot.
3. Set a persistent **Volume** mounted at `/data` (workspaces are materialised
   there; Postgres remains the source of truth, so an ephemeral volume also
   works — it just re-materialises).
4. Optional env: see `.env.example`. To offload large blobs to Cloudflare R2 set
   `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
   (build artifacts and binary files then live in the bucket; text stays in
   Postgres so it's still greppable — set `STORAGE_TEXT_IN_R2=1` to push big text
   out too).

## Compilation & running

Builds are **queued jobs**, never run inside an HTTP request. Presets default to
`clang++` (best diagnostics for an agent to read; sanitizers via `clang++-asan`),
with `g++` as a retry. Also available on Linux: C/C++, Rust, Go, Zig, Java,
Kotlin, .NET, Node, Python, plus WASM (`emcc`, `wasm32`) and Windows `.exe`
cross-compiles (`mingw`, `zig c++`). Artifacts land in the **Builds** tab,
downloadable from any machine.

Not possible on Linux: MSVC (needs Windows; use MinGW/`zig cc`/`clang-cl`),
macOS/iOS + codesigning (needs Apple hardware). Cross-built `.exe` files are
unsigned, so SmartScreen will warn. Running artifacts: CLI binaries pipe into
the terminal; Windows `.exe` can run under **Wine** in the sandbox image; WASM
runs in the browser tab.

## Sandboxing

- **local driver** (Railway default): processes run in the app container as the
  unprivileged `unit` user, with per-command timeouts, output caps, and a
  `ulimit` memory cap. Railway can't start sibling containers, so this is the
  available tier there.
- **docker driver** (VPS): one `quist-<project>` container per project from the
  `quist-sandbox` image, started `--network=none --read-only`, tmpfs `/tmp`,
  `--memory/--cpus/--pids-limit`, `--security-opt no-new-privileges`. Set
  `SANDBOX_DRIVER=docker`. For package managers, put the container on an
  `--internal` network with an egress proxy and set `SANDBOX_NETWORK` +
  `SANDBOX_HTTP_PROXY`.
- For untrusted code, run the docker driver under gVisor (`runsc`) or Firecracker.

## The rules, enforced server-side

Not just in the UI:

- `edges.from_node` must be a folder.
- `UNIQUE(to_node)` — every node has at most one owner.
- Cycles are rejected (a recursive check in the trigger).
- Deleting a folder orphans its children (they become roots) unless `cascade`.
- Every query is scoped by `user_id`; no cross-tenant read is possible.

See `test/graph.test.js` — each of these has a test.
