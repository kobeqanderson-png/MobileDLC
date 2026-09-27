const frames = new Map(PROJECT_DATA.project.frames.map(frame => [frame.key, frame]));
const parts = PROJECT_DATA.project.bodyparts;
const paradigmOf = frame => frame.paradigm || 'sp1dlc';
const encoder = new TextEncoder();
const sessionAge = 30 * 24 * 60 * 60;

function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++)
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  return difference === 0;
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function code(value) { return String(value || '').replace(/[\s-]/g, '').toUpperCase(); }
async function readText(request, maximum) {
  if (Number(request.headers.get('content-length') || 0) > maximum) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
function imageType(key) {
  const lower = key.toLowerCase();
  return lower.endsWith('.png') ? 'image/png' : lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'image/jpeg' : 'image/tiff';
}

async function session(request, env) {
  const cookie = request.headers.get('cookie')?.match(/(?:^|;\s*)dlc_session=([^;]+)/)?.[1];
  const match = cookie?.match(/^v1\.([a-f0-9]{32})\.(\d{10,13})\.([a-f0-9]{64})$/);
  if (!match) return null;
  const expires = Number(match[2]);
  if (!Number.isSafeInteger(expires) || expires <= Date.now() || expires > Date.now() + sessionAge * 1000) return null;
  const expected = await hmac(env.SESSION_SECRET, `v1.${match[1]}.${match[2]}`);
  return equal(match[3], expected) ? { id: match[1] } : null;
}

function page(content, type, status = 200) {
  const headers = { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' };
  if (type.startsWith('text/html')) headers['content-security-policy'] = "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
  return new Response(content, { status, headers });
}

async function login(request, env) {
  if (request.headers.get('origin') && new URL(request.headers.get('origin')).origin !== new URL(request.url).origin)
    return json({ error: 'Cross-site sign-in is not allowed' }, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Expected JSON' }, 415);
  const raw = await readText(request, 256);
  if (raw === null) return json({ error: 'Request too large' }, 413);
  let supplied;
  try { supplied = code(JSON.parse(raw).code); } catch { return json({ error: 'Invalid request' }, 400); }
  const db = await database(env);
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const fingerprint = await hmac(env.SESSION_SECRET, `login:${ip}`);
  const now = Date.now();
  const row = await db.prepare('SELECT attempts, reset_at FROM login_attempts WHERE fingerprint = ?').bind(fingerprint).first();
  if (row && row.reset_at > now && row.attempts >= 5) return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
  if (!equal(supplied, code(env.ACCESS_CODE))) {
    const attempts = row && row.reset_at > now ? row.attempts + 1 : 1;
    const reset = row && row.reset_at > now ? row.reset_at : now + 15 * 60 * 1000;
    await db.prepare('INSERT INTO login_attempts (fingerprint, attempts, reset_at) VALUES (?, ?, ?) ON CONFLICT(fingerprint) DO UPDATE SET attempts = excluded.attempts, reset_at = excluded.reset_at').bind(fingerprint, attempts, reset).run();
    return json({ error: 'That access code is not valid' }, 401);
  }
  await db.prepare('DELETE FROM login_attempts WHERE fingerprint = ?').bind(fingerprint).run();
  const id = [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const expires = now + sessionAge * 1000;
  const signed = `v1.${id}.${expires}`;
  const response = json({ ok: true });
  response.headers.set('set-cookie', `dlc_session=${signed}.${await hmac(env.SESSION_SECRET, signed)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${sessionAge}`);
  return response;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

async function database(env) {
  if (!env.DB) throw new Error('The hosted annotation database is unavailable');
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS edits (frame TEXT NOT NULL, part TEXT NOT NULL, x REAL, y REAL, updated_at TEXT NOT NULL, PRIMARY KEY(frame, part))').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS events (frame TEXT NOT NULL, revision INTEGER NOT NULL, changes TEXT NOT NULL, actor TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(frame, revision))').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS login_attempts (fingerprint TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL)').run();
  return env.DB;
}

async function frameState(db, key) {
  const points = { ...Object.fromEntries(parts.map(part => [part, null])), ...PROJECT_DATA.points[key] };
  const rows = await db.prepare('SELECT part, x, y FROM edits WHERE frame = ?').bind(key).all();
  for (const row of rows.results) if (parts.includes(row.part)) points[row.part] = row.x === null ? null : [row.x, row.y];
  const event = await db.prepare('SELECT MAX(revision) AS latest FROM events WHERE frame = ?').bind(key).first();
  return { points, revision: event?.latest == null ? 0 : event.latest + 1 };
}

function validChanges(frame, changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return false;
  const entries = Object.entries(changes);
  if (!entries.length || entries.length > parts.length) return false;
  return entries.every(([part, value]) => parts.includes(part) && (value === null ||
    (Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) &&
      value[0] >= 0 && value[0] < frame.width && value[1] >= 0 && value[1] < frame.height)));
}

async function edit(request, env, db, actor) {
  if (request.headers.get('origin') && new URL(request.headers.get('origin')).origin !== new URL(request.url).origin)
    return json({ error: 'Cross-site edits are not allowed' }, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Expected JSON' }, 415);
  const raw = await readText(request, 65536);
  if (raw === null) return json({ error: 'Request too large' }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const frame = frames.get(body?.key);
  if (!frame || !validChanges(frame, body.changes) || !Number.isSafeInteger(body.revision) || body.revision < 0)
    return json({ error: 'Invalid frame, revision, or coordinates' }, 400);
  const current = await frameState(db, frame.key);
  if (current.revision !== body.revision) return json({ error: 'This frame changed on another device. Reload it before editing.' }, 409);
  const now = new Date().toISOString();
  const statements = [db.prepare('INSERT INTO events (frame, revision, changes, actor, updated_at) VALUES (?, ?, ?, ?, ?)').bind(frame.key, body.revision, JSON.stringify(body.changes), actor, now)];
  for (const [part, value] of Object.entries(body.changes)) {
    statements.push(db.prepare('INSERT INTO edits (frame, part, x, y, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(frame, part) DO UPDATE SET x = excluded.x, y = excluded.y, updated_at = excluded.updated_at')
      .bind(frame.key, part, value?.[0] ?? null, value?.[1] ?? null, now));
  }
  try { await db.batch(statements); }
  catch (error) {
    if (/unique|constraint/i.test(String(error))) return json({ error: 'This frame changed on another device. Reload it before editing.' }, 409);
    throw error;
  }
  return json({ points: (await frameState(db, frame.key)).points, revision: body.revision + 1 });
}

async function exportSnapshot(db) {
  const overrides = await allOverrides(db);
  return json({ schema: PROJECT_DATA.project.schema, scorer: PROJECT_DATA.project.scorer,
    exported_at: new Date().toISOString(), frames: PROJECT_DATA.project.frames.map(frame => ({
      key: frame.key,
      points: { ...Object.fromEntries(parts.map(part => [part, null])), ...PROJECT_DATA.points[frame.key], ...overrides[frame.key] },
    })) });
}

async function allOverrides(db) {
  const rows = await db.prepare('SELECT frame, part, x, y FROM edits').all();
  const overrides = {};
  for (const row of rows.results) {
    (overrides[row.frame] ||= {})[row.part] = row.x === null ? null : [row.x, row.y];
  }
  return overrides;
}

async function nextIncomplete(db, after, paradigm) {
  const overrides = await allOverrides(db);
  const count = PROJECT_DATA.project.frames.length;
  for (let step = 1; step <= count; step++) {
    const index = (after + step) % count;
    const key = PROJECT_DATA.project.frames[index].key;
    if (paradigm && paradigmOf(PROJECT_DATA.project.frames[index]) !== paradigm) continue;
    const points = { ...PROJECT_DATA.points[key], ...overrides[key] };
    if (parts.some(part => !points[part])) return json({ index });
  }
  return json({ index: null });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (!env.ACCESS_CODE || !env.SESSION_SECRET)
        return json({ error: 'Site access is not configured' }, 503);
      if (url.pathname === '/api/login' && request.method === 'POST') return login(request, env);
      const visitor = await session(request, env);
      if (!visitor) {
        if (url.pathname === '/' && request.method === 'GET') return page(CLIENT.login, 'text/html; charset=utf-8');
        return json({ error: 'Access code required' }, 401);
      }
      if (url.pathname === '/api/logout' && request.method === 'POST') {
        if (request.headers.get('origin') && new URL(request.headers.get('origin')).origin !== url.origin)
          return json({ error: 'Cross-site sign-out is not allowed' }, 403);
        const response = json({ ok: true });
        response.headers.set('set-cookie', 'dlc_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
        return response;
      }
      if (url.pathname === '/api/project' && request.method === 'GET') return json(PROJECT_DATA.project);
      if (url.pathname === '/api/frame' && request.method === 'GET') {
        const key = url.searchParams.get('key');
        if (!frames.has(key)) return json({ error: 'Unknown frame' }, 404);
        return json(await frameState(await database(env), key));
      }
      if (url.pathname === '/api/image' && request.method === 'GET') {
        const key = url.searchParams.get('key');
        if (!frames.has(key)) return json({ error: 'Unknown image' }, 404);
        const path = '/frames/' + key.split('/').map(encodeURIComponent).join('/');
        const image = await env.ASSETS.fetch(new Request(new URL(path, url), { method: 'GET' }));
        if (!image.ok) return json({ error: 'Image is unavailable' }, 404);
        const type = imageType(key);
        return new Response(image.body, { headers: { 'content-type': type, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' } });
      }
      if (url.pathname === '/share-qr.png' && request.method === 'GET') {
        const qr = await env.ASSETS.fetch(new Request(new URL('/share-qr.png', url), { method: 'GET' }));
        if (!qr.ok) return json({ error: 'QR code is unavailable' }, 404);
        return new Response(qr.body, { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' } });
      }
      if (url.pathname === '/api/edit' && request.method === 'POST') return edit(request, env, await database(env), visitor.id);
      if (url.pathname === '/api/export' && request.method === 'GET') return exportSnapshot(await database(env));
      if (url.pathname === '/api/next-incomplete' && request.method === 'GET') {
        const after = Number(url.searchParams.get('after'));
        const paradigm = url.searchParams.get('paradigm');
        if (!Number.isSafeInteger(after) || after < 0 || after >= PROJECT_DATA.project.frames.length)
          return json({ error: 'Invalid frame index' }, 400);
        if (paradigm && !PROJECT_DATA.project.paradigms.some(item => item.id === paradigm))
          return json({ error: 'Invalid paradigm' }, 400);
        return nextIncomplete(await database(env), after, paradigm);
      }
      if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      if (url.pathname === '/') return page(CLIENT.html, 'text/html; charset=utf-8');
      if (url.pathname === '/app.js') return page(CLIENT.script, 'text/javascript; charset=utf-8');
      if (url.pathname === '/style.css') return page(CLIENT.style, 'text/css; charset=utf-8');
      return json({ error: 'Not found' }, 404);
    } catch (error) {
      console.error(error);
      return json({ error: 'The hosted labeler could not complete this request' }, 500);
    }
  },
};
