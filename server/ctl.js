'use strict';
// Control channel for the shell built-ins in sandbox/bin (open, link, build,
// deploy). The shell holds a per-project QUIST_CTL_TOKEN in its env and calls
// these over loopback (local driver) or a unix socket (docker driver, where the
// container has no network).
const express = require('express');
const { httpError, wrap } = require('./errors');
const sandbox = require('./sandbox');
const graph = require('./graph');
const terminal = require('./terminal');
const builds = require('./builds');

const router = express.Router();

router.use((req, res, next) => {
  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const ctx = sandbox.resolveCtl(tok);
  if (!ctx) return next(httpError(401, 'bad control token'));
  req.ctl = ctx;
  next();
});

router.post('/open', wrap(async (req, res) => {
  const out = await terminal.requestOpen(req.ctl.projectId, String(req.body.path || ''));
  if (!out.ok) throw httpError(404, out.error);
  res.json(out);
}));

router.get('/tree', wrap(async (req, res) => {
  const g = await graph.loadGraph(req.ctl.projectId);
  res.type('text/plain').send(graph.treeText(g.nodes, g.edges) + '\n');
}));

router.get('/toolchains', (req, res) => {
  res.type('text/plain').send(builds.TOOLCHAINS.map(t => t.id.padEnd(16) + t.label).join('\n') + '\n');
});

router.post('/build', wrap(async (req, res) => {
  const b = await builds.enqueue(req.ctl.userId, req.ctl.projectId, { toolchain: req.body.toolchain, command: req.body.command, artifact_glob: req.body.artifact_glob, label: req.body.label });
  res.json({ build: b });
}));

router.get('/build/:id', wrap(async (req, res) => {
  const b = await builds.get(req.ctl.userId, req.params.id, { withLog: true, logFrom: Number(req.query.from) || 0 });
  res.json({ build: b });
}));

module.exports = router;
