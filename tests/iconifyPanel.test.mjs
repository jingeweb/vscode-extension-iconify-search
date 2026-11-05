import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'vite';

const project = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const output = await build({
  configFile: path.join(project, 'scripts/vite.extension.config.ts'),
  logLevel: 'silent',
  plugins: [
    {
      name: 'mock-iconify-cache',
      enforce: 'pre',
      resolveId(id) {
        if (id === './iconifyCatalog') return { id: 'test:catalog', external: true };
      },
    },
  ],
  build: {
    write: false,
    minify: false,
    lib: { entry: path.join(project, 'src/iconifyPanel.ts'), formats: ['cjs'] },
  },
});
const chunks = Array.isArray(output) ? output.flatMap((result) => result.output) : output.output;
const code = chunks.find((entry) => entry.type === 'chunk').code;
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function fixture(t, cached = true) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'iconify-panel-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const oldDirectory = path.join(directory, 'old');
  const newDirectory = path.join(directory, 'new');
  for (const [name, target] of [
    ['old', oldDirectory],
    ['new', newDirectory],
  ]) {
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, `${name}.json`), JSON.stringify({ version: name }));
  }
  const update = deferred();
  const panels = [];
  const reveals = [];
  const operations = [];
  const warnings = [];
  const errors = [];
  const diagnostics = [];
  const messageWaiters = [];
  let report;
  let checks = 0;
  class Catalog {
    listeners = [];
    snapshot = cached
      ? { generation: 1, categories: [{ category: 'old', name: 'Old', count: 1 }] }
      : undefined;
    constructor(_directory, _worker, _language, onProgress) {
      report = onProgress;
    }
    async start() {}
    onDidChange(listener) {
      this.listeners.push(listener);
      return { dispose() {} };
    }
    async ensure() {
      checks++;
      try {
        await update.promise;
        this.snapshot = { generation: 2, categories: [{ category: 'new', name: 'New', count: 1 }] };
        this.listeners.forEach((listener) => listener());
      } catch (error) {
        if (!this.snapshot) throw error;
      }
    }
    async query(_query, generation) {
      if (generation !== this.snapshot.generation) throw new Error('version changed');
      return { icons: [{ id: 'test:star', category: 'test', name: 'star', body: '<svg />' }] };
    }
    async dispose() {}
  }
  const uri = (fsPath) => ({ fsPath, toString: () => `https://test.vscode-cdn.net${fsPath}` });
  const disposable = { dispose() {} };
  const vscode = {
    l10n: {
      t: (text, ...args) => text.replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)])),
    },
    env: { language: 'en' },
    ViewColumn: { One: 1 },
    ProgressLocation: { Window: 10, Notification: 15 },
    Uri: { joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
    workspace: { getConfiguration: () => ({ get: () => undefined }) },
    window: {
      tabGroups: { all: [{ tabs: [{ label: 'Iconify Icons', isActive: true }] }] },
      showWarningMessage: (message) => warnings.push(message),
      showErrorMessage: (message) => errors.push(message),
      async withProgress(options, task) {
        const operation = { options, progress: [] };
        operations.push(operation);
        return await task({ report: (value) => operation.progress.push(value) });
      },
      createWebviewPanel() {
        let receive;
        let onDispose;
        let disposed = false;
        const messages = [];
        const panel = {
          messages,
          receive: (message) => receive(message),
          onDidDispose: (callback) => {
            onDispose = callback;
            return disposable;
          },
          dispose: () => {
            if (!disposed) {
              disposed = true;
              onDispose();
            }
          },
          active: true,
          visible: true,
          viewColumn: 1,
          reveal: (...args) => {
            reveals.push(args);
            panel.visible = true;
          },
          webview: {
            cspSource: 'https://test.vscode-cdn.net',
            asWebviewUri: (value) => value,
            onDidReceiveMessage: (callback) => {
              receive = callback;
              return disposable;
            },
            async postMessage(message) {
              assert.ok(!disposed, 'must not send an update to a disposed panel');
              messages.push(message);
              for (const waiter of messageWaiters)
                if (waiter.matches(message)) waiter.resolve(message);
              return true;
            },
          },
        };
        panels.push(panel);
        return panel;
      },
    },
  };
  const exports = {};
  runInNewContext(code, {
    exports,
    require: (id) =>
      id === 'vscode' ? vscode : id === 'test:catalog' ? { IconifyCatalog: Catalog } : require(id),
    console: { ...console, error: (error) => diagnostics.push(error) },
    setTimeout,
    Buffer,
    URL,
  });
  const panel = new exports.IconifySearchPanel(uri(project), uri(directory));
  const waitFor = (matches) =>
    new Promise((resolve) => {
      messageWaiters.push({ matches, resolve });
    });
  return {
    panel,
    panels,
    reveals,
    operations,
    warnings,
    errors,
    update,
    oldDirectory,
    newDirectory,
    waitFor,
    report: (value) => report(value),
    checks: () => checks,
  };
}

await test('opens cached metadata and queries pages without loading all icon JSON', async (t) => {
  const f = await fixture(t);
  await f.panel.show({ mode: 'view.all' });
  assert.equal(f.operations[0].options.location, 10);
  await f.panels[0].receive({ type: 'load' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.panels[0].messages[0].type, 'catalog:ready');
  assert.equal(f.panels[0].messages[0].generation, 1);
  const page = f.waitFor((message) => message.type === 'icons:page');
  f.panels[0].receive({ type: 'icons:query', requestId: 1, generation: 1, text: '' });
  assert.equal((await page).icons[0].id, 'test:star');
  await f.panel.show({ mode: 'view.favor' });
  assert.equal(f.reveals.length, 1);
  assert.equal(f.checks(), 1);
  const refreshed = f.waitFor(
    (message) => message.type === 'catalog:ready' && message.generation === 2,
  );
  f.update.resolve(f.newDirectory);
  await refreshed;
});

await test('a hidden Webview receives a pending search when its context reloads', async (t) => {
  const f = await fixture(t);
  await f.panel.show({ mode: 'view.all' });
  const panel = f.panels[0];
  panel.receive({ type: 'load' });
  await new Promise((resolve) => setImmediate(resolve));
  panel.visible = false;
  await f.panel.show({ mode: 'search', searchText: 'mdi-home' });
  assert.equal(panel.messages.filter((message) => message.type === 'update:mode').length, 0);
  panel.receive({ type: 'load' });
  assert.equal(
    panel.messages.find((message) => message.type === 'update:mode').searchText,
    'mdi-home',
  );
  f.update.resolve(f.newDirectory);
});

await test('activation prepares data before a panel is opened and reports download/build progress', async (t) => {
  const f = await fixture(t, false);
  const starting = f.panel.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.checks(), 1);
  assert.equal(f.panels.length, 0);
  assert.equal(f.operations[0].options.location, 15);
  for (const downloadedBytes of [0, 250000, 500000, 1000000])
    f.report({ stage: 'downloading', version: '2.2.553', downloadedBytes, totalBytes: 1000000 });
  f.report({ stage: 'building', completed: 12, total: 281 });
  assert.deepEqual(
    f.operations[0].progress
      .filter((value) => value.increment !== undefined)
      .map((value) => value.increment),
    [0, 25, 25, 50],
  );
  assert.match(f.operations[0].progress.at(-1).message, /12\/281/);
  f.update.resolve(f.newDirectory);
  await starting;
});

await test('failed background checks leave cached metadata usable', async (t) => {
  const f = await fixture(t);
  await f.panel.show({ mode: 'view.all' });
  f.update.reject(new Error('offline'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.errors.length, 0);
  f.panels[0].receive({ type: 'load' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(f.panels[0].messages.some((message) => message.type === 'catalog:ready'));
});

await test('updates completed before Webview readiness are included in its initial metadata', async (t) => {
  const f = await fixture(t);
  await f.panel.show({ mode: 'view.all' });
  f.update.resolve(f.newDirectory);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.panels[0].messages.length, 0);
  f.panels[0].receive({ type: 'load' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.panels[0].messages[0].generation, 2);
});

await test('closing a panel does not stop preparation or send messages to the destroyed Webview', async (t) => {
  const f = await fixture(t);
  await f.panel.show({ mode: 'view.all' });
  f.panels[0].dispose();
  f.update.resolve(f.newDirectory);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.panels[0].messages.length, 0);
  assert.equal(f.errors.length, 0);
});
