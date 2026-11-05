import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import test from 'node:test';
import { c } from 'tar';

import { IconifyDataCache } from '../src/iconifyData.ts';

async function cacheEntries(directory) {
  return (await fs.readdir(directory)).filter(
    (name) => !name.startsWith('.lease-') && name !== '.cache.lock',
  );
}

async function fixture(t, language = 'en') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iconify-cache-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'cache');
  const requests = [];
  const warnings = [];
  const progress = [];
  let info;
  let archive;
  let failure;
  const request = async (url) => {
    requests.push(url);
    if (failure) throw failure;
    const metadata = url.endsWith('/latest');
    return Object.assign(
      Readable.from(
        metadata
          ? [Buffer.from(JSON.stringify(info))]
          : [
              archive.subarray(0, Math.ceil(archive.length / 2)),
              archive.subarray(Math.ceil(archive.length / 2)),
            ],
      ),
      {
        headers: metadata ? {} : { 'content-length': String(archive.length) },
      },
    );
  };
  const cache = new IconifyDataCache(
    directory,
    language,
    (value) => progress.push(value),
    (error) => warnings.push(error),
    request,
  );
  async function publish(version) {
    const source = path.join(root, version);
    await fs.mkdir(path.join(source, 'package', 'json'), { recursive: true });
    await fs.writeFile(
      path.join(source, 'package', 'package.json'),
      JSON.stringify({ name: '@iconify/json', version }),
    );
    await fs.writeFile(
      path.join(source, 'package', 'json', 'test.json'),
      JSON.stringify({
        prefix: 'test',
        info: { name: 'Test' },
        icons: { star: { body: '<path />' } },
      }),
    );
    await fs.writeFile(
      path.join(source, 'package', 'ignored.js'),
      'throw new Error("must not run")',
    );
    await c({ cwd: source, gzip: true, file: path.join(source, 'package.tgz') }, ['package']);
    archive = await fs.readFile(path.join(source, 'package.tgz'));
    info = {
      name: '@iconify/json',
      version,
      dist: {
        tarball: `https://registry.npmjs.org/@iconify/json/-/json-${version}.tgz`,
        integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`,
      },
    };
  }
  return {
    cache,
    directory,
    requests,
    request,
    warnings,
    progress,
    publish,
    offline: () => {
      failure = new Error('offline');
    },
    corrupt: () => {
      archive = Buffer.from('broken archive');
    },
    info: () => info,
  };
}

await test('downloads from npm and reuses the global cache while checking npm on every open', async (t) => {
  const f = await fixture(t);
  await f.publish('2.2.553');
  const directory = await f.cache.ensure();
  assert.equal(directory, path.join(f.directory, '2.2.553', 'json'));
  assert.equal(
    JSON.parse(await fs.readFile(path.join(directory, 'test.json'), 'utf8')).prefix,
    'test',
  );
  assert.deepEqual(await fs.readdir(path.dirname(directory)), [
    '.cache-index.json',
    'json',
    'package.json',
  ]);
  const anotherProject = new IconifyDataCache(
    f.directory,
    'en',
    () => {},
    () => {},
    async (url) => {
      f.requests.push(url);
      assert.ok(url.endsWith('/latest'), 'a cached version must not be downloaded again');
      return Readable.from([JSON.stringify(f.info())]);
    },
  );
  assert.equal(await anotherProject.ensure(), directory);
  assert.equal(await f.cache.ensure(), directory);
  assert.equal(f.requests.filter((url) => url.endsWith('/latest')).length, 3);
  assert.equal(f.requests.filter((url) => url.endsWith('.tgz')).length, 1);
  assert.match(f.requests[1], /^https:\/\/registry\.npmjs\.org\//);
});

for (const language of ['zh-cn', 'zh-tw']) {
  await test(`selects the download source for ${language} and follows the latest version`, async (t) => {
    const f = await fixture(t, language);
    await f.publish('2.2.553');
    await f.cache.ensure();
    await f.publish('2.2.554');
    const directory = await f.cache.ensure();
    assert.equal(directory, path.join(f.directory, '2.2.554', 'json'));
    assert.equal(
      f.requests[3],
      language === 'zh-cn'
        ? 'https://cdn.npmmirror.com/packages/%40iconify/json/2.2.554/json-2.2.554.tgz'
        : f.info().dist.tarball,
    );
  });
}

await test('shares concurrent downloads', async (t) => {
  const f = await fixture(t);
  await f.publish('2.2.553');
  const directories = await Promise.all([f.cache.ensure(), f.cache.ensure(), f.cache.ensure()]);
  assert.equal(new Set(directories).size, 1);
  assert.equal(f.requests.length, 2);
});

await test('uses the newest completed cache when npm is unavailable', async (t) => {
  const f = await fixture(t);
  await f.publish('2.2.9');
  await f.cache.ensure();
  await f.publish('2.2.10');
  const directory = await f.cache.ensure();
  f.offline();
  assert.equal(await f.cache.ensure(), directory);
  assert.equal(f.warnings.length, 1);
});

await test('preserves cached icons and removes partial downloads after an integrity failure', async (t) => {
  const f = await fixture(t);
  await f.publish('2.2.553');
  const directory = await f.cache.ensure();
  await f.publish('2.2.554');
  f.corrupt();
  assert.equal(await f.cache.ensure(), directory);
  assert.equal(f.warnings.length, 1);
  assert.deepEqual(await cacheEntries(f.directory), ['2.2.553']);
});

await test('reports an initial download failure and can retry', async (t) => {
  const f = await fixture(t);
  await f.publish('2.2.553');
  f.corrupt();
  await assert.rejects(f.cache.ensure(), /integrity check/);
  assert.deepEqual(await cacheEntries(f.directory), []);
  await f.publish('2.2.553');
  await f.cache.ensure();
});

await test('allows separate VS Code windows to publish the same version', async (t) => {
  const f = await fixture(t);
  await f.publish('2.2.553');
  const anotherWindow = new IconifyDataCache(
    f.directory,
    'en',
    () => {},
    (error) => {
      throw error;
    },
    f.request,
  );
  const [first, second] = await Promise.all([f.cache.ensure(), anotherWindow.ensure()]);
  assert.equal(first, second);
  assert.deepEqual(await cacheEntries(f.directory), ['2.2.553']);
});

await test('reports a first-open network failure without creating a completed cache', async (t) => {
  const f = await fixture(t);
  f.offline();
  await assert.rejects(f.cache.ensure(), /offline/);
  assert.deepEqual(await cacheEntries(f.directory), []);
});

await test('local cache lookup returns immediately while an npm check is stalled', async (t) => {
  const f = await fixture(t);
  assert.equal(await f.cache.getCachedDirectory(), undefined);
  assert.equal(f.requests.length, 0);
  await f.publish('2.2.553');
  const directory = await f.cache.ensure();
  await fs.mkdir(path.join(f.directory, '999.0.0'), { recursive: true });
  await fs.mkdir(path.join(f.directory, '.download-partial'), { recursive: true });
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const delayed = new IconifyDataCache(
    f.directory,
    'en',
    () => {},
    () => {},
    async (url) => {
      await waiting;
      return f.request(url);
    },
  );
  const updating = delayed.ensure();
  try {
    assert.equal(await delayed.getCachedDirectory(), directory);
  } finally {
    release();
  }
  assert.equal(await updating, directory);
});

await test('download progress reports actual bytes and total size before extraction', async (t) => {
  const f = await fixture(t);
  await f.publish('2.2.553');
  await f.cache.ensure();
  const download = f.progress.filter((value) => value.stage === 'downloading' && value.totalBytes);
  assert.equal(download[0].downloadedBytes, 0);
  assert.ok(
    download.some((value) => value.downloadedBytes > 0 && value.downloadedBytes < value.totalBytes),
  );
  assert.equal(download.at(-1).downloadedBytes, download.at(-1).totalBytes);
  assert.ok(download.at(-1).downloadedBytes > 0);
  assert.ok(
    download.every(
      (value, index) => index === 0 || value.downloadedBytes >= download[index - 1].downloadedBytes,
    ),
  );
  assert.equal(f.progress[0].stage, 'checking');
  assert.equal(f.progress.at(-1).stage, 'extracting');
});

await test('downloads without Content-Length report bytes without inventing a total', async (t) => {
  const f = await fixture(t);
  await f.publish('2.2.553');
  const progress = [];
  const cache = new IconifyDataCache(
    f.directory,
    'en',
    (value) => progress.push(value),
    () => {},
    async (url) => {
      const response = await f.request(url);
      response.headers = {};
      return response;
    },
  );
  await cache.ensure();
  const download = progress.filter((value) => value.stage === 'downloading');
  assert.ok(download.at(-1).downloadedBytes > 0);
  assert.ok(download.every((value) => value.totalBytes === undefined));
});

await test('repairs an existing version directory whose json directory is missing', async (t) => {
  const f = await fixture(t);
  await f.publish('2.2.553');
  const broken = path.join(f.directory, '2.2.553');
  await fs.mkdir(broken, { recursive: true });
  await fs.writeFile(
    path.join(broken, 'package.json'),
    JSON.stringify({ name: '@iconify/json', version: '2.2.553' }),
  );
  const repaired = await f.cache.ensure();
  assert.notEqual(path.dirname(repaired), broken);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(repaired, 'test.json'), 'utf8')).prefix,
    'test',
  );
  assert.equal(await f.cache.ensure(), repaired, 'subsequent opens reuse the repaired generation');
  assert.equal(f.requests.filter((url) => url.endsWith('.tgz')).length, 1);
  await assert.rejects(fs.stat(broken), { code: 'ENOENT' });
});

await test('rejects malformed legacy JSON and repairs files modified after validation', async (t) => {
  const f = await fixture(t);
  await f.publish('2.2.553');
  const broken = path.join(f.directory, '2.2.553');
  await fs.mkdir(path.join(broken, 'json'), { recursive: true });
  await fs.writeFile(
    path.join(broken, 'package.json'),
    JSON.stringify({ name: '@iconify/json', version: '2.2.553' }),
  );
  await fs.writeFile(path.join(broken, 'json/test.json'), '{broken json');
  assert.equal(await f.cache.getCachedDirectory(), undefined);
  const first = await f.cache.ensure();
  await fs.writeFile(path.join(first, 'test.json'), '{broken again');
  assert.equal(await f.cache.getCachedDirectory(), undefined);
  const second = await f.cache.ensure();
  assert.notEqual(second, first);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(second, 'test.json'), 'utf8')).prefix,
    'test',
  );
  await f.cache.keepOnly(second);
  await assert.rejects(fs.stat(path.dirname(first)), { code: 'ENOENT' });
});

await test('detects missing files in an indexed collection directory', async (t) => {
  const f = await fixture(t);
  await f.publish('2.2.553');
  const directory = await f.cache.ensure();
  await fs.unlink(path.join(directory, 'test.json'));
  assert.equal(await f.cache.getCachedDirectory(), undefined);
  const repaired = await f.cache.ensure();
  assert.ok(await fs.readFile(path.join(repaired, 'test.json')));
});

await test('keeps two recent versions and protects active readers until they release their leases', async (t) => {
  const f = await fixture(t);
  await f.publish('2.2.551');
  const first = await f.cache.ensure();
  const release = await f.cache.acquireReader(first);
  let current;
  for (const version of ['2.2.552', '2.2.553']) {
    await f.publish(version);
    current = await f.cache.ensure();
    await f.cache.keepOnly(current);
  }
  assert.ok(await fs.stat(first), 'the active reader protects an otherwise obsolete version');
  await release();
  await f.cache.keepOnly(current);
  assert.deepEqual(await cacheEntries(f.directory), ['2.2.552', '2.2.553']);
});

await test(
  'an actual second process protects its version and dead leases are reclaimed',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t);
    await f.publish('2.2.551');
    const first = await f.cache.ensure();
    const child = spawn(
      process.execPath,
      [
        '--import',
        import.meta.resolve('tsx'),
        '--input-type=module',
        '-e',
        `
    import { IconifyCacheStorage } from ${JSON.stringify(new URL('../src/iconifyCacheStorage.ts', import.meta.url).href)};
    const storage = new IconifyCacheStorage(${JSON.stringify(f.directory)});
    await storage.find();
    console.log('ready');
    process.stdin.resume();
  `,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    });
    const lines = createInterface({ input: child.stdout });
    await Promise.race([
      once(lines, 'line'),
      once(child, 'exit').then(() => {
        throw new Error('cache reader exited before acquiring its lease');
      }),
    ]);
    let current;
    for (const version of ['2.2.552', '2.2.553']) {
      await f.publish(version);
      current = await f.cache.ensure();
      await f.cache.keepOnly(current);
    }
    assert.ok(await fs.stat(first), 'another process still owns the oldest version');
    const exited = once(child, 'exit');
    child.kill();
    await exited;
    lines.close();
    await f.cache.keepOnly(current);
    assert.deepEqual(await cacheEntries(f.directory), ['2.2.552', '2.2.553']);
    assert.ok(
      !(await fs.readdir(f.directory)).some((name) => name.startsWith(`.lease-${child.pid}-`)),
    );
  },
);

await test('reclaims dead downloads and old legacy temporary directories without deleting live downloads', async (t) => {
  const f = await fixture(t);
  await f.publish('2.2.553');
  const current = await f.cache.ensure();
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await once(child, 'exit');
  const dead = path.join(f.directory, `.download-${child.pid}-orphan`);
  const live = path.join(f.directory, `.download-${process.pid}-active`);
  const legacy = path.join(f.directory, '.download-legacy');
  const recent = path.join(f.directory, '.download-recent');
  for (const name of [dead, live, legacy, recent]) await fs.mkdir(name);
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
  await fs.utimes(legacy, old, old);
  await fs.utimes(live, old, old);
  await f.cache.keepOnly(current);
  await assert.rejects(fs.stat(dead), { code: 'ENOENT' });
  await assert.rejects(fs.stat(legacy), { code: 'ENOENT' });
  assert.ok(await fs.stat(live));
  assert.ok(await fs.stat(recent));
});
