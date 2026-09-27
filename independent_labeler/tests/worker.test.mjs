import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../dist/server/index.js';

class FakeDB {
  edits = new Map();
  events = new Map();
  attempts = new Map();

  prepare(sql) {
    const db = this;
    return {
      bind(...params) { this.params = params; return this; },
      async run() {
        if (sql.startsWith('INSERT INTO login_attempts')) db.attempts.set(this.params[0], { attempts: this.params[1], reset_at: this.params[2] });
        if (sql.startsWith('DELETE FROM login_attempts')) db.attempts.delete(this.params[0]);
        return {};
      },
      async all() {
        if (sql.includes('FROM edits WHERE')) {
          return { results: [...db.edits.entries()].filter(([key]) => key.startsWith(this.params[0] + '|'))
            .map(([key, value]) => ({ part: key.split('|')[1], ...value })) };
        }
        if (sql.includes('FROM edits')) return { results: [...db.edits.entries()].map(([key, value]) => ({ frame: key.split('|')[0], part: key.split('|')[1], ...value })) };
        return { results: [] };
      },
      async first() {
        if (sql.includes('FROM login_attempts')) return db.attempts.get(this.params[0]) || null;
        const revisions = db.events.get(this.params[0]) || [];
        return { latest: revisions.length ? Math.max(...revisions) : null };
      },
      sql,
    };
  }

  async batch(statements) {
    const [event, ...edits] = statements;
    const [frame, revision] = event.params;
    const revisions = this.events.get(frame) || [];
    if (revisions.includes(revision)) throw new Error('UNIQUE constraint failed');
    revisions.push(revision);
    this.events.set(frame, revisions);
    for (const statement of edits) {
      const [key, part, x, y] = statement.params;
      this.edits.set(`${key}|${part}`, { x, y });
    }
  }
}

class FakeAssets {
  objects = new Map();
  async fetch(request) {
    const path = decodeURIComponent(new URL(request.url).pathname);
    return this.objects.has(path) ? new Response(this.objects.get(path)) : new Response('', { status: 404 });
  }
}

const env = { DB: new FakeDB(), ASSETS: new FakeAssets(), ACCESS_CODE: 'TESTCODE1234', SESSION_SECRET: 'test-session-secret' };
const anonymousCall = (path, options) => worker.fetch(new Request('https://test.example' + path, options), env);
const login = await anonymousCall('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'test-code-1234' }) });
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie').split(';')[0];
const call = (path, options = {}) => anonymousCall(path, { ...options, headers: { ...options.headers, cookie } });
const project = await (await call('/api/project')).json();
const frame = project.frames[0];

test('anonymous visitors cannot read labels or images', async () => {
  assert.equal((await anonymousCall('/api/project')).status, 401);
  assert.equal((await anonymousCall('/api/image?key=' + encodeURIComponent(frame.key))).status, 401);
  assert.equal((await anonymousCall('/frames/' + frame.key)).status, 401);
  assert.equal((await anonymousCall('/share-qr.png')).status, 401);
  const page = await anonymousCall('/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Access code/);
});

test('wrong access code is rejected', async () => {
  const response = await anonymousCall('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'wrong' }) });
  assert.equal(response.status, 401);
});

test('the full project and original points load', async () => {
  assert.equal(project.frames.length, 3145);
  assert.equal(project.bodyparts.length, 7);
  assert.deepEqual(project.paradigms, [{ id: 'sp1dlc', name: 'sp1DLC' }, { id: 'epm', name: 'Elevated plus maze' }, { id: 'ofoe', name: 'OFOE' }]);
  assert.equal(project.frames.filter(item => item.paradigm === 'sp1dlc').length, 1865);
  assert.equal(project.frames.filter(item => item.paradigm === 'epm').length, 640);
  assert.equal(project.frames.filter(item => item.paradigm === 'ofoe').length, 640);
  const response = await call('/api/frame?key=' + encodeURIComponent(frame.key));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).revision, 0);
});

test('static frames are served only through the authenticated image route', async () => {
  const path = '/api/image?key=' + encodeURIComponent(frame.key);
  assert.equal((await call(path)).status, 404);
  env.ASSETS.objects.set('/frames/' + frame.key, 'image');
  assert.equal((await call(path)).status, 200);
  assert.equal((await anonymousCall('/frames/' + frame.key)).status, 401);
  assert.equal((await call('/frames/' + frame.key)).status, 404);
});

test('the in-app QR is available only after sign-in', async () => {
  env.ASSETS.objects.set('/share-qr.png', 'png');
  const response = await call('/share-qr.png');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
});

test('invalid coordinates and unknown images are rejected', async () => {
  const bad = await call('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: frame.key, revision: 0, changes: { nose: [frame.width, 0] } }) });
  assert.equal(bad.status, 400);
  assert.equal((await call('/api/image?key=unknown')).status, 404);
});

test('saving, stale revision detection, and export use durable edits', async () => {
  const payload = { key: frame.key, revision: 0, changes: { nose: [12, 24] } };
  const post = () => call('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const saved = await post();
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).points.nose, [12, 24]);
  assert.equal((await post()).status, 409);
  const snapshot = await (await call('/api/export')).json();
  assert.equal(snapshot.frames.length, 3125);
  assert.deepEqual(snapshot.frames[0].points.nose, [12, 24]);
  assert.ok(snapshot.frames.find(item => item.key.startsWith('labeled-data/EPM Test 1/')));
  assert.ok(snapshot.frames.find(item => item.key.startsWith('labeled-data/OFPO Test 1/')));
});

test('next incomplete frame uses one hosted lookup', async () => {
  const response = await call('/api/next-incomplete?after=0&paradigm=sp1dlc');
  assert.equal(response.status, 200);
  const { index } = await response.json();
  assert.ok(Number.isInteger(index) && index >= 0 && index < 1865);
  const epm = await call('/api/next-incomplete?after=1865&paradigm=epm');
  assert.equal(epm.status, 200);
  assert.equal((await epm.json()).index, 1866);
  const ofpo = await call('/api/next-incomplete?after=2505&paradigm=ofpo');
  assert.equal(ofpo.status, 200);
  assert.equal((await ofpo.json()).index, 2506);
  assert.equal((await call('/api/next-incomplete?after=0&paradigm=unknown')).status, 400);
});

test('sign-out clears the session', async () => {
  const response = await call('/api/logout', { method: 'POST' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
});
