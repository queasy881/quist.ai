'use strict';
// Small HTTP error helper so route code reads as `throw httpError(404, 'no such node')`.
class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    if (extra) Object.assign(this, extra);
  }
}
const httpError = (status, message, extra) => new HttpError(status, message, extra);

// Wrap an async express handler so rejections reach the error middleware.
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Translate Postgres constraint errors raised by the edges trigger into 4xx.
function pgToHttp(e) {
  if (e instanceof HttpError) return e;
  if (e && e.code === '23505') return httpError(409, e.constraint === 'edges_to_node_key' ? 'node already has an owner' : 'already exists');
  if (e && (e.code === '23514' || e.code === '23503')) return httpError(400, e.message.replace(/^error:\s*/i, ''));
  if (e && e.code === '22P02') return httpError(400, 'malformed id');
  return e;
}

module.exports = { HttpError, httpError, wrap, pgToHttp };
