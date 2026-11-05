import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import test from 'node:test';
import { c } from 'tar';
import { build } from 'vite';

import { IconifyCatalog } from '../src/iconifyCatalog.ts';
import { IconifyCatalogStorage } from '../src/iconifyCatalogStorage.ts';
import { buildCatalog, IconDatabase } from '../src/iconifyDatabase.ts';

const buildRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'iconify-worker-test-'));
await build({
  configFile: false,
  logLevel: 'silent',
  build: {
    outDir: buildRoot,
    lib: {
      entry: new URL('../src/iconifyDatabaseWorker.ts', import.meta.url).pathname,
      fileName: () => 'worker.cjs',
      formats: ['cjs'],
    },
    rollupOptions: { external: [/^node:/] },
  },
});
const workerFile = path.join(buildRoot, 'worker.cjs');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iconify-db-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  await fs.mkdir(source);
  const icons = Object.fromEntries(
    [
      'home',
      'home-outline',
      'myhome',
      ...Array.from({ length: 300 }, (_, i) => `icon-${String(i).padStart(3, '0')}`),
    ].map((name) => [name, { body: '<path d="M1 1h10v10H1z" />' }]),
  );
  await fs.writeFile(
    path.join(source, 'alpha.json'),
    JSON.stringify({ prefix: 'alpha', width: 24, info: { name: 'Alpha' }, icons }),
  );
  await fs.writeFile(
    path.join(source, 'beta.json'),
    JSON.stringify({
      prefix: 'beta',
      info: { name: 'Beta' },
      icons: { home: { body: '<circle />' } },
    }),
  );
  const output = path.join(root, 'catalog');
  await buildCatalog(source, output, '2.2.553');
  const db = await IconDatabase.open(output);
  t.after(() => db.close());
  return { root, source, output, db };
}
await test('indexed name/category search preserves word-boundary ranking and literal punctuation', async (t) => {
  const { db } = await fixture(t);
  assert.deepEqual(
    (await db.query({ text: 'home', category: 'alpha' })).icons.map((icon) => icon.name),
    ['home', 'home-outline', 'myhome'],
  );
  for (const text of ['[', '*', '%', '?', 'foo[bar]', 'no-such-icon'])
    assert.equal((await db.query({ text })).icons.length, 0);
  assert.ok((await db.query({ text: 'ho' })).icons.length === 4);
  const icon = (await db.query({ text: 'home', category: 'alpha' })).icons[0];
  assert.match(icon.body, /viewBox='0 0 24 16'/);
  assert.equal(icon.id, 'alpha:home');
});
await test('cursor pagination and favorites produce no duplicates or missing icons', async (t) => {
  const { db } = await fixture(t);
  const ids = [];
  let cursor;
  do {
    const page = await db.query({ cursor });
    ids.push(...page.icons.map((icon) => icon.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(ids.length, 304);
  assert.equal(new Set(ids).size, 304);
  const page = await db.query({
    favorites: ['missing:icon', 'beta:home', 'alpha:home', 'alpha:home'],
  });
  assert.deepEqual(
    page.icons.map((icon) => icon.id),
    ['beta:home', 'alpha:home'],
  );
  const searched = [];
  cursor = undefined;
  do {
    const page = await db.query({ text: 'icon', cursor });
    searched.push(...page.icons.map((icon) => icon.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(searched.length, 300);
  assert.equal(new Set(searched).size, 300);
});
await test('page byte limits bound large results while cursors still advance', async (t) => {
  const { root, source } = await fixture(t);
  await fs.writeFile(
    path.join(source, 'large.json'),
    JSON.stringify({
      prefix: 'large',
      info: { name: 'Large' },
      icons: {
        a: { body: 'x'.repeat(700000) },
        b: { body: 'y'.repeat(700000) },
        c: { body: 'z'.repeat(700000) },
      },
    }),
  );
  const out = path.join(root, 'large-catalog');
  await buildCatalog(source, out, '2.2.554');
  const db = await IconDatabase.open(out);
  t.after(() => db.close());
  const one = await db.query({ category: 'large' });
  assert.equal(one.icons.length, 1);
  assert.ok(one.nextCursor);
  const two = await db.query({ category: 'large', cursor: one.nextCursor });
  assert.equal(two.icons[0].name, 'b');
  const three = await db.query({ category: 'large', cursor: two.nextCursor });
  assert.equal(three.icons[0].name, 'c');
  assert.equal(three.nextCursor, undefined);
});
async function serviceFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iconify-service-test-'));
  const storage = path.join(root, 'storage');
  const services = [];
  t.after(async () => {
    await Promise.all(services.map((service) => service.dispose()));
    await fs.rm(root, { recursive: true, force: true });
  });
  let metadata,
    archive,
    offline = false;
  const requests = [];
  async function publish(version, body = '<path />') {
    const source = path.join(root, version, 'package');
    await fs.mkdir(path.join(source, 'json'), { recursive: true });
    await fs.writeFile(
      path.join(source, 'package.json'),
      JSON.stringify({ name: '@iconify/json', version }),
    );
    await fs.writeFile(
      path.join(source, 'json', 'test.json'),
      JSON.stringify({ prefix: 'test', info: { name: 'Test' }, icons: { star: { body } } }),
    );
    const filename = path.join(root, version, 'package.tgz');
    await c({ cwd: path.dirname(source), file: filename, gzip: true }, ['package']);
    archive = await fs.readFile(filename);
    metadata = {
      name: '@iconify/json',
      version,
      dist: {
        tarball: `https://registry.npmjs.org/test-${version}.tgz`,
        integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`,
      },
    };
  }
  const request = async (url) => {
    requests.push(url);
    if (offline) throw Error('offline');
    return Object.assign(
      Readable.from([url.endsWith('/latest') ? Buffer.from(JSON.stringify(metadata)) : archive]),
      { headers: {} },
    );
  };
  const make = () => {
    const service = new IconifyCatalog(
      storage,
      workerFile,
      'en',
      () => {},
      () => {},
      request,
    );
    services.push(service);
    return service;
  };
  return {
    root,
    storage,
    make,
    publish,
    requests,
    offline: () => {
      offline = true;
    },
  };
}
await test('activation preparation builds files, deletes raw JSON and avoids downloading cached versions', async (t) => {
  const f = await serviceFixture(t);
  await f.publish('2.2.553');
  const service = f.make();
  await service.ensure();
  assert.equal(service.snapshot.categories[0].count, 1);
  assert.match((await service.query({}, service.snapshot.generation)).icons[0].body, /<path/);
  assert.equal(
    (await fs.readdir(path.join(f.storage, 'iconify-json'))).filter((name) => !name.startsWith('.'))
      .length,
    0,
  );
  await service.ensure();
  assert.equal(f.requests.filter((url) => url.endsWith('.tgz')).length, 1);
  const second = f.make();
  await second.start();
  assert.ok(second.snapshot);
  f.offline();
  await second.ensure();
  assert.equal((await second.query({}, second.snapshot.generation)).icons.length, 1);
});
await test('published updates refresh other windows, reject old generations and reclaim the old data', async (t) => {
  const f = await serviceFixture(t);
  await f.publish('2.2.553');
  const first = f.make();
  await first.ensure();
  const oldGeneration = first.snapshot.generation;
  const second = f.make();
  await second.start();
  const oldDirectory = (await fs.readdir(path.join(f.storage, 'iconify-data'))).find((name) =>
    name.startsWith('2.2.553-'),
  );
  await f.publish('2.2.554', '<circle />');
  await first.ensure();
  await assert.rejects(first.query({}, oldGeneration), /version changed/);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (second.snapshot.generation > 1) {
      try {
        await fs.stat(path.join(f.storage, 'iconify-data', oldDirectory));
      } catch (error) {
        if (error.code === 'ENOENT') break;
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(second.snapshot.generation > 1);
  await assert.rejects(fs.stat(path.join(f.storage, 'iconify-data', oldDirectory)), {
    code: 'ENOENT',
  });
  assert.match((await second.query({}, second.snapshot.generation)).icons[0].body, /<circle/);
});
await test('interrupted build directories never become completed catalogs and are reclaimed after process exit', async (t) => {
  const f = await serviceFixture(t);
  await fs.mkdir(path.join(f.storage, 'iconify-data'), { recursive: true });
  const orphan = path.join(f.storage, 'iconify-data', '.build-2147483647-orphan');
  await fs.mkdir(orphan);
  const storage = new IconifyCatalogStorage(path.join(f.storage, 'iconify-data'));
  assert.equal(await storage.find(), undefined);
  await storage.cleanup();
  await assert.rejects(fs.stat(orphan), { code: 'ENOENT' });
});

await test('simultaneous windows share a single download and build', async (t) => {
  const f = await serviceFixture(t);
  await f.publish('2.2.553');
  const first = f.make(),
    second = f.make();
  await Promise.all([first.ensure(), second.ensure()]);
  assert.equal(f.requests.filter((url) => url.endsWith('.tgz')).length, 1);
  assert.ok(first.snapshot);
  assert.ok(second.snapshot);
});
await test('a database that cannot be opened is rebuilt on startup', async (t) => {
  const f = await serviceFixture(t);
  await f.publish('2.2.553');
  const root = path.join(f.storage, 'iconify-data');
  await fs.mkdir(root, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(root, '.build-' + process.pid + '-'));
  const db = new DatabaseSync(path.join(temporary, 'index.sqlite'));
  db.exec("CREATE TABLE metadata(key TEXT,value TEXT); INSERT INTO metadata VALUES('format','-1')");
  db.close();
  await fs.writeFile(path.join(temporary, 'icons.bin'), 'invalid');
  const store = new IconifyCatalogStorage(root);
  await store.publish(temporary, '2.2.553', 1);
  await store.keepOnly();
  const service = f.make();
  await service.ensure();
  assert.equal((await service.query({}, service.snapshot.generation)).icons[0].id, 'test:star');
});

await test('an interrupted marker update does not hide a newer completed catalog', async (t) => {
  const f = await serviceFixture(t);
  const root = path.join(f.storage, 'iconify-data');
  const store = new IconifyCatalogStorage(root);
  await fs.mkdir(root, { recursive: true });
  async function publish(version) {
    const temporary = await fs.mkdtemp(path.join(root, '.build-' + process.pid + '-'));
    await fs.writeFile(path.join(temporary, 'index.sqlite'), 'index');
    await fs.writeFile(path.join(temporary, 'icons.bin'), 'icons');
    return store.publish(temporary, version, 1);
  }
  const first = await publish('2.2.553');
  const second = await publish('2.2.554');
  await fs.writeFile(
    path.join(root, 'current.json'),
    JSON.stringify({ name: path.basename(first) }),
  );
  assert.equal(await store.find(), second);
  await store.keepOnly(second);
  await assert.rejects(fs.stat(first), { code: 'ENOENT' });
  await store.keepOnly();
});

await fs.rm(buildRoot, { recursive: true, force: true });
