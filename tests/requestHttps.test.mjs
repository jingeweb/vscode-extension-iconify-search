import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { requestHttps } from '../src/iconifyData.ts';

function connection(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const response = Object.assign(new PassThrough(), { statusCode: 200, headers: {} });
  response.on('error', () => {});
  let bytes = 0;
  let idleTimer;
  let resetIdle = () => {};
  response.on('data', (chunk) => {
    bytes += chunk.length;
    resetIdle();
  });
  const request = new EventEmitter();
  request.destroyed = false;
  request.destroy = (error) => {
    request.destroyed = true;
    clearTimeout(idleTimer);
    response.destroy(error);
    request.emit('error', error);
    request.emit('close');
    return request;
  };
  request.setTimeout = (milliseconds, callback) => {
    // Model ClientRequest.setTimeout's socket inactivity semantics.
    resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => callback(), milliseconds);
    };
    resetIdle();
    return request;
  };
  let respond;
  t.mock.method(https, 'get', (_url, callback) => {
    respond = () => callback(response);
    return request;
  });
  return { request, response, respond: () => respond(), bytes: () => bytes };
}

await test('a progressing download can continue beyond the response-header deadline', async (t) => {
  const f = connection(t);
  const opening = requestHttps('https://example.invalid/package.tgz');
  t.mock.timers.tick(119_000);
  f.respond();
  await opening;
  for (let i = 0; i < 5; i++) {
    t.mock.timers.tick(60_000);
    f.response.write(Buffer.alloc(1024));
    assert.equal(f.request.destroyed, false);
  }
  assert.equal(f.bytes(), 5120);
  t.mock.timers.tick(120_001);
  assert.equal(f.request.destroyed, true, 'a stalled body must still time out');
});
await test('DNS, connection and response-header stalls still have a deadline', async (t) => {
  const f = connection(t);
  const rejected = assert.rejects(requestHttps('https://example.invalid/package.tgz'), /timed out/);
  t.mock.timers.tick(120_001);
  await rejected;
  assert.equal(f.request.destroyed, true);
});
