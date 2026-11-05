import assert from 'node:assert/strict';
import test from 'node:test';

import { getWebviewResources } from '../src/webviewResources.ts';

const options = {
  cspSource: 'https://test.vscode-cdn.net',
  nonce: 'test-nonce',
  scriptUri: 'https://test.vscode-cdn.net/out/iconifyWebView.js',
  styleUri: 'https://test.vscode-cdn.net/out/iconifyWebView.css',
};

await test('packaged Webviews load bundled assets with a nonce and no development access', () => {
  const resources = getWebviewResources(options);
  assert.match(resources.styles, /out\/iconifyWebView\.css/);
  assert.match(resources.scripts, /nonce="test-nonce"/);
  assert.match(resources.scripts, /out\/iconifyWebView\.js/);
  assert.doesNotMatch(
    JSON.stringify(resources),
    /127\.0\.0\.1|@vite|@jinge-hmr-runtime|connect-src/,
  );
  assert.match(resources.contentSecurityPolicy, /script-src 'nonce-test-nonce';/);
});

await test('development Webviews initialize Jinge HMR before loading Vite and the entry module', () => {
  const resources = getWebviewResources({ ...options, devServerUrl: 'http://127.0.0.1:5173/' });
  assert.equal(resources.styles, '');
  const preamble = resources.scripts.indexOf('/@jinge-hmr-runtime');
  const client = resources.scripts.indexOf('/@vite/client');
  const entry = resources.scripts.indexOf('/main.tsx');
  assert.ok(preamble >= 0 && client > preamble && entry > client);
  assert.match(resources.scripts, /@jinge-hmr-runtime/);
  assert.equal((resources.scripts.match(/type="module"/g) ?? []).length, 3);
  assert.match(
    resources.contentSecurityPolicy,
    /connect-src http:\/\/127\.0\.0\.1:5173 ws:\/\/127\.0\.0\.1:5173;/,
  );
  assert.doesNotMatch(resources.contentSecurityPolicy, /unsafe-eval/);
});

await test('development URLs cannot enable remote origins or inject HTML', () => {
  for (const devServerUrl of ['https://example.com', 'http://example.com', 'file:///tmp/test']) {
    assert.throws(() => getWebviewResources({ ...options, devServerUrl }), /localhost/);
  }
  const resources = getWebviewResources({
    ...options,
    devServerUrl: 'http://localhost:5173/path?ignored=1',
  });
  assert.match(resources.scripts, /http:\/\/localhost:5173\/main.tsx/);
  assert.doesNotMatch(resources.scripts, /ignored/);
});
