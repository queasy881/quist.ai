'use strict';
// The MCP tool manifest as the product shows it (MCP tab) and enforces it
// (projects.mcp_disabled). The MCP server itself lives in mcp/quist-mcp.js and
// checks this list before every call, so a toggle in the UI is real.
const TOOLS = [
  { name: 'read_file',      kind: 'read',  desc: 'Return the contents of a file node' },
  { name: 'read_files',     kind: 'read',  desc: 'Batched read of several files in one round trip' },
  { name: 'create_file',    kind: 'write', desc: 'Add a file node to the graph' },
  { name: 'edit_file',      kind: 'write', desc: 'Patch a file in place' },
  { name: 'delete_node',    kind: 'write', desc: 'Remove a file or folder and its links' },
  { name: 'create_folder',  kind: 'write', desc: 'Add a folder node to the graph' },
  { name: 'move_node',      kind: 'write', desc: 'Re-parent a node under another folder' },
  { name: 'list_tree',      kind: 'read',  desc: 'Walk the resolved ownership tree' },
  { name: 'search_files',   kind: 'read',  desc: 'Grep across every file in the graph' },
  { name: 'run_shell',      kind: 'exec',  desc: 'Execute a command in the container' },
  { name: 'build',          kind: 'exec',  desc: 'Compile with the selected toolchain' },
  { name: 'set_version',    kind: 'write', desc: 'Snapshot the graph under a label' },
  { name: 'revert_version', kind: 'write', desc: 'Restore all files to a snapshot' },
  { name: 'upload_file',    kind: 'write', desc: "Push a file or folder from the laptop's disk into the graph" },
  { name: 'download_file',  kind: 'read',  desc: "Save a file node or build artifact to the laptop's disk" },
  { name: 'list_projects',  kind: 'read',  desc: 'List your projects (to pick one)' }
];
const byName = n => TOOLS.find(t => t.name === n);
module.exports = { TOOLS, byName };
