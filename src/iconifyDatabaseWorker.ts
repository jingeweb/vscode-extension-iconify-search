import { parentPort } from 'node:worker_threads';

import type { CatalogWorkerRequest } from './iconifyCatalogTypes';

import { buildCatalog, IconDatabase } from './iconifyDatabase';

let database: IconDatabase | undefined;
let queue = Promise.resolve();
parentPort!.on('message', (request: CatalogWorkerRequest & { id: number }) => {
  queue = queue
    .catch(() => {})
    .then(async () => {
      try {
        let result: unknown;
        if (request.type === 'build') {
          result = await buildCatalog(
            request.source,
            request.directory,
            request.version,
            (completed, total) => {
              parentPort!.postMessage({ id: request.id, progress: { completed, total } });
            },
          );
        } else if (request.type === 'open') {
          await database?.close();
          database = await IconDatabase.open(request.directory);
          result = database.categories();
        } else if (request.type === 'close') {
          await database?.close();
          database = undefined;
          result = null;
        } else {
          if (!database) throw new Error('Icon database is not open');
          result = await database.query(request.query);
        }
        // TextEncoder owns its backing buffer; zlib's pooled output buffers cannot be transferred safely.
        const data = new TextEncoder().encode(JSON.stringify(result));
        parentPort!.postMessage({ id: request.id, data }, [data.buffer]);
      } catch (error) {
        parentPort!.postMessage({ id: request.id, error: String(error) });
      }
    });
});
