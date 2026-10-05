// Transcript usage sensor (#34): when the session last sent a request, how
// large its context was, and on which model. It reads a bounded slice of the
// transcript, never the whole file. The definitions are the report script's: a
// request is a main-thread assistant record with usage that reached the API,
// and its context is input + cache read + cache write tokens. The transcript
// format isn't a stable API, so anything unexpected reads as "no request".
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

export const SLICE_BYTES = 256 * 1024;

// The complete lines in the last (or, with fromEnd false, the first) `bytes`
// of the file. A transcript not written yet (a new session) has none.
export function readSlice(path, { fromEnd = true, bytes = SLICE_BYTES } = {}) {
  let fd;
  try {
    fd = openSync(path, 'r');
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
  try {
    const size = fstatSync(fd).size;
    const start = fromEnd ? Math.max(0, size - bytes) : 0;
    const buf = Buffer.alloc(Math.min(bytes, size - start));
    readSync(fd, buf, 0, buf.length, start);
    return completeLines(buf, start, size);
  } finally {
    closeSync(fd);
  }
}

// `buf` holds bytes [start, start + buf.length) of a file of `size` bytes. A
// line the slice cuts isn't a record, so it's left out.
export function completeLines(buf, start, size) {
  const from = start > 0 ? buf.indexOf(10) + 1 : 0;
  const to = start + buf.length < size ? buf.lastIndexOf(10) + 1 : buf.length;
  if (start > 0 && from === 0) return ''; // inside one line longer than the slice
  return buf.toString('utf8', from, Math.max(from, to));
}

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// The request in one transcript line, or null.
export function requestIn(line) {
  if (!line.includes('"usage"')) return null;
  let rec;
  try {
    rec = JSON.parse(line);
  } catch {
    return null;
  }
  const u = rec?.message?.usage;
  if (rec?.type !== 'assistant' || rec.isSidechain === true || !u || typeof u !== 'object') return null;
  const context = n(u.input_tokens) + n(u.cache_read_input_tokens) + n(u.cache_creation_input_tokens);
  const at = Date.parse(rec.timestamp);
  // Zero usage: a record Claude Code wrote itself (an API error, an
  // interrupt). It never reached the API or the cache.
  if ((context === 0 && n(u.output_tokens) === 0) || Number.isNaN(at)) return null;
  return { at, context, model: typeof rec.message.model === 'string' ? rec.message.model : null };
}

// The last request in `text` (from readSlice), or null. Most records near the
// end aren't requests (queue operations, titles, attachments...), so idle time
// comes from this request's timestamp, never from the file or its last record.
export function lastRequest(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const r = requestIn(lines[i]);
    if (r) return r;
  }
  return null;
}

// The session's first request: its context is the setup every request carries.
export function firstRequest(text) {
  for (const line of text.split('\n')) {
    const r = requestIn(line);
    if (r) return r;
  }
  return null;
}

// The attachments written before the session's first request, as their JSON
// characters by attachment type: the setup that request carried (skill
// listing, deferred tools, MCP instructions...). Null until a request is in
// `text`, since the transcript can lag the turn.
export function firstAttachments(text) {
  const chars = {};
  for (const line of text.split('\n')) {
    if (requestIn(line)) return chars;
    if (!line.includes('"attachment"')) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const type = rec?.attachment?.type;
    if (rec.type === 'attachment' && rec.isSidechain !== true && typeof type === 'string') chars[type] = (chars[type] || 0) + JSON.stringify(rec.attachment).length;
  }
  return null;
}
