import { Worker } from 'node:worker_threads';

import type { CatalogWorkerRequest } from './iconifyCatalogTypes';

export class IconifyWorkerClient {
  private worker: Worker;
  private nextId = 0;
  private stopped = false;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  constructor(
    filename: string,
    private progress?: (completed: number, total: number) => void,
  ) {
    this.worker = new Worker(filename, { execArgv: [] });
    this.worker.on(
      'message',
      (message: {
        id: number;
        data?: Uint8Array;
        error?: string;
        progress?: { completed: number; total: number };
      }) => {
        if (message.progress) {
          this.progress?.(message.progress.completed, message.progress.total);
          return;
        }
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error));
        else {
          try {
            request.resolve(JSON.parse(new TextDecoder().decode(message.data)));
          } catch (error) {
            request.reject(error as Error);
          }
        }
      },
    );
    this.worker.on('error', (error) => this.fail(error as Error));
    this.worker.on('exit', (code) => this.fail(new Error(`Icon database Worker exited (${code})`)));
  }
  private fail(error: Error) {
    this.stopped = true;
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
  request<T>(request: CatalogWorkerRequest): Promise<T> {
    if (this.stopped) return Promise.reject(new Error('Icon database Worker is closed'));
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker.postMessage({ ...request, id });
    });
  }
  get alive() {
    return !this.stopped && !this.closing;
  }
  private closing?: Promise<void>;
  dispose(): Promise<void> {
    if (!this.closing)
      this.closing = (async () => {
        try {
          if (!this.stopped) await this.request({ type: 'close' });
        } finally {
          this.fail(new Error('Icon database version changed'));
          await this.worker.terminate();
        }
      })();
    return this.closing;
  }
}
