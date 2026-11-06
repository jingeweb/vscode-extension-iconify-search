import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build, createServer } from 'vite';

import { replaceTpl } from '../../src/util.ts';
import { getWebviewResources } from '../../src/webviewResources.ts';

const project = fileURLToPath(new URL('../..', import.meta.url));
const origin = 'https://iconify-test.vscode-cdn.net';
const nonce = 'webview-browser-test';
const groups = [
  {
    prefix: 'alpha',
    info: { name: 'Alpha' },
    icons: Object.fromEntries(
      ['heart', ...Array.from({ length: 320 }, (_, i) => `icon-${String(i).padStart(3, '0')}`)].map(
        (name) => [name, { body: '<path d="M1 1h10v10H1z" />' }],
      ),
    ),
  },
  {
    prefix: 'beta',
    info: { name: 'Beta' },
    icons: { circle: { body: '<circle cx="8" cy="8" r="7" />' } },
  },
];
const init = {
  locale: 'en',
  mode: 'view.all',
  searchText: '',
  favorTabs: [],
  favorIcons: [],
  favorGroup: '',
  codeType: 'svg',
};
const mockApi = `<script nonce="${nonce}">
window.__documentId = Math.random(); window.__acquisitions = 0; window.__messages = []; window.__violations = [];
window.__groups = ${JSON.stringify(groups)}; window.__generation = 1; window.__favorites = []; window.__responses = [];
window.__sendCatalog = () => window.dispatchEvent(new MessageEvent('message', {data: {type:'catalog:ready',generation:window.__generation,categories:window.__groups.map(g=>({category:g.prefix,name:g.info.name,count:Object.keys(g.icons).length}))}}));
document.addEventListener('securitypolicyviolation', e => window.__violations.push(e.violatedDirective + ': ' + e.blockedURI));
Object.defineProperty(navigator, 'clipboard', {value: {writeText: async text => { window.__copied = text; }}});
window.acquireVsCodeApi = () => {
  if (++window.__acquisitions > 1) throw new Error('VS Code API acquired twice');
  let state;
  return { getState: () => state, setState: value => { state = JSON.parse(JSON.stringify(value)); window.__savedState = state; }, postMessage: message => {
    window.__messages.push(message);
    if (message.type === 'load') setTimeout(window.__sendCatalog, 0);
    if (message.type === 'add-favor-icon') window.__favorites.push(message.id);
    if (message.type === 'rm-favor-icon') window.__favorites = window.__favorites.filter(id=>id!==message.id);
    if (message.type === 'icons:query') {
      let icons = window.__groups.flatMap(group=>Object.entries(group.icons).map(([name,icon])=>({id:group.prefix+':'+name,category:group.prefix,name,body:'<svg viewBox="0 0 16 16">'+icon.body+'</svg>'})));
      if(message.category) icons=icons.filter(icon=>icon.category===message.category);
      if(message.favorites) icons=icons.filter(icon=>window.__favorites.includes(icon.id));
      if(message.text) icons=icons.filter(icon=>icon.name.includes(message.text.toLowerCase()));
      const offset=message.cursor?.score||0; const page=icons.slice(offset,offset+128);
      const data={type:'icons:page',requestId:message.requestId,generation:message.generation,icons:page,nextCursor:offset+128<icons.length?{name:'',prefix:'',score:offset+128}:undefined};
      setTimeout(()=>{window.dispatchEvent(new MessageEvent('message',{data}));window.__responses.push({generation:data.generation,first:data.icons[0]?.name});},0);
    }
  }};
};
</script>`;

await test(
  'Jinge Webview interactions, CSP, virtualization, HMR and production assets',
  { timeout: 120_000 },
  async (t) => {
    // Use an isolated copy so the HMR test never edits a developer's source files.
    const directory = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'iconify-webview-test-')),
    );
    let server;
    let browser;
    t.after(async () => {
      await browser?.close();
      await server?.close();
      await fs.rm(directory, { recursive: true, force: true });
    });
    for (const name of ['src', 'l10n', 'tsconfig.json', 'package.json']) {
      await fs.cp(path.join(project, name), path.join(directory, name), { recursive: true });
    }
    await fs.symlink(
      path.join(project, 'node_modules'),
      path.join(directory, 'node_modules'),
      'junction',
    );
    const root = path.join(directory, 'src/iconifyWebView');
    const configFile = path.join(project, 'scripts/vite.webview.config.ts');
    server = await createServer({
      configFile,
      root,
      logLevel: 'error',
      server: { port: 0, fs: { allow: [directory, project] } },
    });
    await server.listen();
    const address = server.httpServer.address();
    const devServerUrl = `http://127.0.0.1:${address.port}`;
    server.config.server.origin = devServerUrl;
    const executablePath =
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
      [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
      ].find(existsSync);
    browser = await chromium.launch({ executablePath, headless: true });
    const context = await browser.newContext({
      permissions: ['local-network-access'],
      viewport: { width: 900, height: 600 },
    });
    context.setDefaultTimeout(8000);
    const errors = [];
    context.on('page', (page) => page.on('pageerror', (error) => errors.push(String(error))));
    const template = await fs.readFile(path.join(project, 'src/iconifyPanel.html'), 'utf8');
    async function open(dev = true) {
      const page = await context.newPage();
      const resources = getWebviewResources({
        cspSource: origin,
        nonce,
        scriptUri: `${origin}/out/iconifyWebView.js`,
        styleUri: `${origin}/out/iconifyWebView.css`,
        devServerUrl: dev ? devServerUrl : undefined,
      });
      const html = replaceTpl(template, {
        ...resources,
        nonce,
        initData: JSON.stringify(init),
      }).replace('</head>', mockApi + '</head>');
      await page.route(`${origin}/**`, async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
        const name = path.basename(url.pathname);
        if (!['iconifyWebView.js', 'iconifyWebView.css'].includes(name)) return route.abort();
        return route.fulfill({
          contentType: name.endsWith('.js') ? 'text/javascript' : 'text/css',
          body: await fs.readFile(path.join(directory, 'out', name)),
        });
      });
      await page.goto(origin);
      await page.getByRole('tab', { name: 'ALL ICONS', exact: true }).waitFor();
      try {
        await page.locator('.icon-card').first().waitFor();
      } catch (error) {
        console.error(
          'Browser diagnostics',
          errors,
          await page.evaluate(() => ({
            messages: window.__messages,
            text: document.body.innerText,
            html: document.querySelector('.icon-gallery')?.outerHTML,
          })),
        );
        throw error;
      }
      return page;
    }
    const page = await open();
    await t.test(
      'an open icon popover stays visible when its anchor receives keyboard focus',
      async () => {
        const heart = page.getByRole('button', { name: 'Copy icon: heart', exact: true });
        await heart.hover({ position: { x: 20, y: 74 } });
        const favorite = page.getByRole('button', { name: 'Add favorite', exact: true });
        await favorite.waitFor();
        await heart.focus();
        await page.waitForFunction(
          () => getComputedStyle(document.querySelector('.ui-popover')).visibility === 'visible',
        );
        await page.keyboard.press('Tab');
        await favorite.waitFor();
        await page.getByRole('tab', { name: 'ALL ICONS', exact: true }).click();
      },
    );
    await t.test('virtualizes icons, handles scrolling and resizes narrow viewports', async () => {
      const firstCount = await page.locator('.icon-card').count();
      assert.ok(firstCount > 0 && firstCount < 150);
      await page.evaluate(() => {
        window.__heartNode = document.querySelector('[aria-label="Copy icon: heart"]');
        document.querySelector('.icon-gallery').scrollTop = 5;
      });
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      assert.equal(
        await page.evaluate(
          () => window.__heartNode === document.querySelector('[aria-label="Copy icon: heart"]'),
        ),
        true,
      );

      await page.locator('.icon-gallery').evaluate((element) => {
        element.scrollTop = 2500;
      });
      await page.waitForFunction(() => !document.querySelector('[aria-label="Copy icon: heart"]'));
      await page.waitForFunction(() =>
        window.__messages.some(
          (message) => message.type === 'icons:query' && message.cursor?.score >= 256,
        ),
      );
      assert.ok(
        await page.locator('.icon-gallery').evaluate((element) => element.scrollTop > 0),
        'appending a page must preserve scroll position',
      );
      await page.setViewportSize({ width: 72, height: 300 });
      await page.waitForFunction(() => document.querySelectorAll('.icon-card').length < 12);
      await page.setViewportSize({ width: 900, height: 600 });
      await page.locator('.icon-gallery').evaluate((element) => {
        element.scrollTop = 0;
      });
      await page.getByRole('button', { name: 'Copy icon: heart', exact: true }).waitFor();
    });
    await t.test(
      'searches, clears, accepts literal punctuation and follows command messages',
      async () => {
        const search = page.getByRole('textbox', { name: 'Search Icons', exact: true });
        await search.fill('heart');
        await search.press('Enter');
        await page.waitForFunction(() => document.querySelectorAll('.icon-card').length === 1);
        await search.fill('[');
        await search.press('Enter');
        await page.getByText('No Icons', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Clear search', exact: true }).click();
        await page.getByRole('button', { name: 'Copy icon: heart', exact: true }).waitFor();
        await page.evaluate(() =>
          window.dispatchEvent(
            new MessageEvent('message', {
              data: { type: 'update:mode', mode: 'search', searchText: 'circle' },
            }),
          ),
        );
        await page.getByRole('button', { name: 'Copy icon: circle', exact: true }).waitFor();
        assert.equal(await search.inputValue(), 'circle');
        await page.getByRole('button', { name: 'Clear search', exact: true }).click();
      },
    );
    await t.test(
      'copies and inserts code, adds and removes favorites through the floating panel',
      async () => {
        const heart = page.getByRole('button', { name: 'Copy icon: heart', exact: true });
        await heart.click({ position: { x: 20, y: 74 } });
        await page.getByRole('status').filter({ hasText: 'Copied!' }).waitFor();
        assert.match(await page.evaluate(() => window.__copied), /<svg/);
        await page.mouse.move(850, 10);
        await heart.hover({ position: { x: 20, y: 74 } });
        await page.getByRole('button', { name: 'Add favorite', exact: true }).click();
        await page.getByRole('button', { name: 'Remove favorite', exact: true }).waitFor();
        await page.getByRole('tab', { name: 'MY FAVORITES', exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll('.icon-card').length === 1);
        await heart.hover({ position: { x: 20, y: 74 } });
        await page.getByRole('button', { name: 'Insert icon', exact: true }).click();
        assert.ok(
          (await page.evaluate(() => window.__messages)).some(
            (message) => message.type === 'insert' && message.code.includes('<svg'),
          ),
        );
        await page.mouse.move(850, 10);
        await heart.hover({ position: { x: 20, y: 74 } });
        await page.getByRole('button', { name: 'Remove favorite', exact: true }).click();
        await page.getByText('No Icons', { exact: true }).waitFor();
        await page.getByRole('tab', { name: 'ALL ICONS', exact: true }).click();
      },
    );
    await t.test(
      'select dropdowns float without resizing the modal and flip inside a short viewport',
      async () => {
        await page.evaluate((groups) => {
          window.__groups = [
            ...groups,
            ...Array.from({ length: 40 }, (_, index) => ({
              prefix: 'extra-' + index,
              info: { name: 'Extra ' + index },
              icons: {},
            })),
          ];
          window.__generation++;
          window.__sendCatalog();
        }, groups);
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
        await dialog.getByRole('heading', { name: 'Settings', exact: true }).click();
        const before = await dialog.boundingBox();
        const confirmBefore = await dialog
          .getByRole('button', { name: 'Confirm', exact: true })
          .boundingBox();
        const multi = dialog.getByLabel('Tabs Displyed First', { exact: true });
        await multi.click();
        const list = dialog.getByRole('listbox');
        await list.waitFor();
        const after = await dialog.boundingBox();
        const confirmAfter = await dialog
          .getByRole('button', { name: 'Confirm', exact: true })
          .boundingBox();
        assert.equal(
          after.height,
          before.height,
          'opening the dropdown must not resize the dialog',
        );
        assert.equal(after.y, before.y, 'opening the dropdown must not shift the dialog');
        assert.equal(
          confirmAfter.y,
          confirmBefore.y,
          'opening the dropdown must not move the footer',
        );
        const bounds = await list.boundingBox();
        assert.ok(
          bounds.y + bounds.height > after.y + after.height,
          'fixture should extend beyond the dialog',
        );
        assert.equal(
          await list.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return element.contains(
              document.elementFromPoint(rect.left + rect.width / 2, rect.bottom - 12),
            );
          }),
          true,
          'floating options must remain interactive outside the dialog bounds',
        );
        await multi.press('Escape');
        await page.setViewportSize({ width: 900, height: 260 });
        const shortBefore = await dialog.boundingBox();
        const single = dialog.getByLabel('Default Open Tab', { exact: true });
        await single.click();
        await list.waitFor();
        const control = await single.locator('..').locator('..').boundingBox();
        const flipped = await list.boundingBox();
        assert.equal((await dialog.boundingBox()).height, shortBefore.height);
        assert.ok(
          flipped.y >= 7 && flipped.y + flipped.height <= 253,
          'dropdown must stay within the viewport',
        );
        assert.ok(
          flipped.y + flipped.height <= control.y,
          'dropdown should flip above when there is insufficient space below',
        );
        await dialog.getByRole('option', { name: 'Alpha', exact: true }).click();
        assert.equal(await single.inputValue(), 'Alpha');
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).last().click();
        await dialog.waitFor({ state: 'detached' });
        await page.setViewportSize({ width: 900, height: 600 });
        await page.evaluate((groups) => {
          window.__groups = groups;
          window.__generation++;
          window.__sendCatalog();
        }, groups);
        await page.getByRole('button', { name: 'Copy icon: heart', exact: true }).waitFor();
      },
    );
    await t.test(
      'saves searchable multi-select settings, cancels drafts and restores dialog focus',
      async () => {
        const settingsButton = page.getByRole('button', { name: 'Settings', exact: true });
        await settingsButton.click();
        const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
        await dialog.getByLabel('Type of Code', { exact: true }).click();
        await dialog.getByRole('option', { name: 'Vue', exact: true }).click();
        assert.equal(await dialog.getByLabel('Type of Code', { exact: true }).inputValue(), 'Vue');
        await dialog.getByLabel('Tabs Displyed First', { exact: true }).fill('Beta');
        await dialog.getByRole('option', { name: 'Beta', exact: true }).click();
        const multiSelect = dialog.getByLabel('Tabs Displyed First', { exact: true });
        const tags = dialog.locator('.ui-select-tag-label');
        assert.deepEqual(
          await tags.allTextContents(),
          ['Beta'],
          'selected labels appear immediately',
        );
        assert.equal(await multiSelect.inputValue(), '', 'selection clears the search input');
        assert.equal(await multiSelect.getAttribute('aria-expanded'), 'true');
        await dialog.getByRole('option', { name: 'Alpha', exact: true }).click();
        assert.deepEqual(await tags.allTextContents(), ['Beta', 'Alpha']);
        await dialog.getByRole('button', { name: 'Remove selection: Alpha', exact: true }).click();
        assert.deepEqual(await tags.allTextContents(), ['Beta']);
        assert.equal(await multiSelect.getAttribute('aria-expanded'), 'true');
        assert.equal(
          await dialog
            .getByRole('option', { name: 'Alpha', exact: true })
            .getAttribute('aria-selected'),
          'false',
        );
        await multiSelect.press('a');
        assert.equal(
          await multiSelect.inputValue(),
          'a',
          'selected tags stay separate from the search',
        );
        assert.deepEqual(await tags.allTextContents(), ['Beta']);
        await dialog.getByRole('option', { name: 'Alpha', exact: true }).click();
        assert.deepEqual(await tags.allTextContents(), ['Beta', 'Alpha']);
        const removeAlpha = dialog.getByRole('button', {
          name: 'Remove selection: Alpha',
          exact: true,
        });
        await removeAlpha.focus();
        await removeAlpha.press('Enter');
        assert.equal(
          await multiSelect.evaluate((element) => document.activeElement === element),
          true,
        );
        assert.deepEqual(await tags.allTextContents(), ['Beta']);
        await dialog.getByLabel('Default Open Tab', { exact: true }).fill('Beta');
        await dialog.getByRole('option', { name: 'Beta', exact: true }).click();
        assert.equal(
          await dialog.getByLabel('Default Open Tab', { exact: true }).inputValue(),
          'Beta',
        );
        await dialog
          .locator('.settings-field')
          .nth(2)
          .getByRole('button', { name: 'Clear selection', exact: true })
          .click();
        assert.equal(await dialog.getByLabel('Default Open Tab', { exact: true }).inputValue(), '');
        await dialog.getByRole('button', { name: 'Remove selection: Beta', exact: true }).click();
        assert.equal(
          await tags.count(),
          0,
          'the last tag can also be removed while the dropdown is closed',
        );
        await multiSelect.fill('Beta');
        await dialog.getByRole('option', { name: 'Beta', exact: true }).click();
        assert.deepEqual(await tags.allTextContents(), ['Beta']);
        await multiSelect.press('Escape');
        await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
        await dialog.waitFor({ state: 'detached' });
        const messages = await page.evaluate(() =>
          window.__messages.filter((message) => message.type === 'save:settings'),
        );
        assert.deepEqual(messages[0].data, {
          codeType: 'vue',
          favorTabs: ['beta'],
          favorGroup: '',
        });
        await settingsButton.click();
        await dialog.getByLabel('Type of Code', { exact: true }).click();
        await dialog.getByRole('option', { name: 'SVG', exact: true }).click();
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        assert.equal(
          await settingsButton.evaluate((element) => document.activeElement === element),
          true,
        );
        assert.equal(
          await page.evaluate(
            () => window.__messages.filter((message) => message.type === 'save:settings').length,
          ),
          1,
        );
        assert.equal(await page.evaluate(() => window.__savedState.codeType), 'vue');
      },
    );
    await t.test('evicts old SVG pages by bytes and reloads them when scrolling back', async () => {
      const generation = await page.evaluate(() => {
        window.__groups = [
          {
            prefix: 'bulk',
            info: { name: 'Bulk' },
            icons: Object.fromEntries(
              Array.from({ length: 1024 }, (_, index) => [
                'bulk-' + String(index).padStart(4, '0'),
                { body: '<path /><!--' + 'x'.repeat(20000) + '-->' },
              ]),
            ),
          },
        ];
        window.__generation++;
        window.__sendCatalog();
        return window.__generation;
      });
      for (let offset = 0; offset < 1024; offset += 128) {
        await page.locator('.icon-gallery').evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        await page.waitForFunction(
          ({ generation, name }) =>
            window.__responses.some(
              (response) => response.generation === generation && response.first === name,
            ),
          { generation, name: 'bulk-' + String(offset).padStart(4, '0') },
        );
      }
      const before = await page.evaluate(
        (generation) =>
          window.__responses.filter(
            (response) => response.generation === generation && response.first === 'bulk-0000',
          ).length,
        generation,
      );
      await page.locator('.icon-gallery').evaluate((element) => {
        element.scrollTop = 0;
      });
      await page.waitForFunction(
        ({ generation, before }) =>
          window.__responses.filter(
            (response) => response.generation === generation && response.first === 'bulk-0000',
          ).length > before,
        { generation, before },
      );
      await page.getByRole('button', { name: 'Copy icon: bulk-0000', exact: true }).waitFor();
      await page.evaluate((groups) => {
        window.__groups = groups;
        window.__generation++;
        window.__sendCatalog();
      }, groups);
      await page.getByRole('button', { name: 'Copy icon: heart', exact: true }).waitFor();
    });
    await t.test(
      'tracks theme changes and preserves global state across component and CSS HMR',
      async () => {
        await page.evaluate(() =>
          document.body.setAttribute('data-vscode-theme-kind', 'vscode-dark'),
        );
        await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
        await page.evaluate(() =>
          document.body.setAttribute('data-vscode-theme-kind', 'vscode-light'),
        );
        await page.waitForFunction(() => !document.documentElement.classList.contains('dark'));
        await page.getByRole('tab', { name: 'MY FAVORITES', exact: true }).click();
        const id = await page.evaluate(() => window.__documentId);
        const app = path.join(root, 'App.tsx');
        const source = await fs.readFile(app, 'utf8');
        await fs.writeFile(app, source.replace("t('ALL ICONS')", "t('ALL ICONS HMR')"));
        await page.getByRole('tab', { name: 'ALL ICONS HMR', exact: true }).waitFor();
        assert.equal(
          await page
            .getByRole('tab', { name: 'MY FAVORITES', exact: true })
            .getAttribute('aria-selected'),
          'true',
        );
        await fs.appendFile(path.join(root, 'style.css'), '\nbody { --hmr-test: updated; }\n');
        await page.waitForFunction(
          () => getComputedStyle(document.body).getPropertyValue('--hmr-test').trim() === 'updated',
        );
        assert.equal(await page.evaluate(() => window.__documentId), id);
        assert.equal(await page.evaluate(() => window.__acquisitions), 1);
        assert.equal(
          await page.evaluate(
            () => window.__messages.filter((message) => message.type === 'load').length,
          ),
          1,
        );
        assert.deepEqual(await page.evaluate(() => window.__violations), []);
        await fs.writeFile(app, source);
      },
    );
    await t.test(
      'a version refresh preserves the search and resets pages and old results',
      async () => {
        await page.evaluate(() =>
          window.dispatchEvent(
            new MessageEvent('message', {
              data: { type: 'update:mode', mode: 'view.all', searchText: 'heart' },
            }),
          ),
        );
        const heart = page.getByRole('button', { name: 'Copy icon: heart', exact: true });
        await heart.locator('path').waitFor();
        await page.evaluate(() => {
          window.__groups = [
            {
              prefix: 'gamma',
              info: { name: 'Gamma' },
              icons: {
                heart: { body: '<circle cx="8" cy="8" r="7" />' },
                'new-icon': { body: '<path />' },
              },
            },
          ];
          window.__generation++;
          window.__sendCatalog();
        });
        await heart.locator('circle').waitFor();
        assert.equal(
          await page.getByRole('textbox', { name: 'Search Icons', exact: true }).inputValue(),
          'heart',
        );
        assert.equal(await page.getByRole('tab', { name: 'Alpha', exact: true }).count(), 0);
        assert.equal(await page.getByRole('tab', { name: 'Gamma', exact: true }).count(), 1);
        await page.getByRole('button', { name: 'Clear search', exact: true }).click();
        await page.getByRole('button', { name: 'Copy icon: new-icon', exact: true }).waitFor();
        assert.deepEqual(await page.evaluate(() => window.__violations), []);
      },
    );
    await t.test('builds and runs production assets with the strict Webview CSP', async () => {
      await build({
        configFile,
        root,
        logLevel: 'error',
        build: { outDir: path.join(directory, 'out') },
      });
      const production = await open(false);
      await production
        .getByRole('button', { name: 'Copy icon: heart', exact: true })
        .click({ position: { x: 20, y: 74 } });
      await production.getByText('Copied!', { exact: true }).waitFor();
      assert.match(await production.evaluate(() => window.__copied), /<svg/);
      assert.deepEqual(await production.evaluate(() => window.__violations), []);
      await production.close();
    });
    assert.deepEqual(errors, []);
  },
);
