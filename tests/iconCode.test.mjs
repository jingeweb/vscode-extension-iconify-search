import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { getIconCode } from '../src/iconifyWebView/code.ts';

await test('copies the plain icon name', () => {
  const icon = {
    category: 'solar',
    id: 'solar:eye-broken-line-duotone',
    name: 'eye-broken-line-duotone',
    body: '<svg viewBox="0 0 24 24"></svg>',
  };
  assert.equal(getIconCode(icon, 'name'), 'solar:eye-broken-line-duotone');
});

await test('copies the Iconify React component', () => {
  const icon = {
    category: 'solar',
    id: 'solar:eye-broken-line-duotone',
    name: 'eye-broken-line-duotone',
    body: '<svg viewBox="0 0 24 24"></svg>',
  };
  assert.equal(getIconCode(icon, 'iconify-react'), '<Icon icon="solar:eye-broken-line-duotone" />');
});

await test('generated Vue components export a component with a literal name', () => {
  for (const name of ['arrow-left', '3d-cube', 'quote"mark']) {
    const svg = '<svg viewBox="0 0 16 16"><path d="M1 1h8v8H1z" /></svg>';
    const code = getIconCode({ category: 'test', id: `test:${name}`, name, body: svg }, 'vue');
    const script = code.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
    const context = { defineComponent: (options) => options };
    runInNewContext(
      script.replace(/import .*?;\n/, '').replace('export default ', 'globalThis.component = '),
      context,
    );
    assert.equal(typeof context.component.name, 'string');
    assert.ok(context.component.name.length > 0);
    assert.ok(code.includes(`<template>\n${svg}\n</template>`));
    assert.ok(!code.includes('script setup'));
  }
});
