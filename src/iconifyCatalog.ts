import { watch, type FSWatcher } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { lock } from 'proper-lockfile';

import type { CatalogCategory, IconPage, IconQuery } from './iconifyCatalogTypes';

import { IconifyCatalogStorage } from './iconifyCatalogStorage';
import { IconifyDataCache, type IconifyDataProgress } from './iconifyData';
import { IconifyWorkerClient } from './iconifyWorkerClient';

export type CatalogProgress =
  | IconifyDataProgress
  | { stage: 'building'; completed: number; total: number };
export class IconifyCatalog {
  private storage: IconifyCatalogStorage;
  private download: IconifyDataCache;
  private worker?: IconifyWorkerClient;
  private directory?: string;
  private categories: CatalogCategory[] = [];
  private updating?: Promise<void>;
  private switching = Promise.resolve();
  private watcher?: FSWatcher;
  private timer?: ReturnType<typeof setInterval>;
  private debounce?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private generation = 0;
  private change = new Set<() => void>();
  private initialize?: Promise<void>;
  constructor(
    globalStorage: string,
    private workerFile: string,
    language: string,
    private report: (progress: CatalogProgress) => void,
    private warn: (error: unknown) => void,
    request?: ConstructorParameters<typeof IconifyDataCache>[4],
  ) {
    this.storage = new IconifyCatalogStorage(path.join(globalStorage, 'iconify-data'));
    this.download = new IconifyDataCache(
      path.join(globalStorage, 'iconify-json'),
      language,
      report,
      warn,
      request,
      0,
      (version) => this.storage.find(version),
      false,
    );
  }
  get snapshot() {
    return this.worker ? { generation: this.generation, categories: this.categories } : undefined;
  }
  onDidChange(listener: () => void) {
    this.change.add(listener);
    return { dispose: () => this.change.delete(listener) };
  }
  async start() {
    if (!this.initialize)
      this.initialize = (async () => {
        await fs.mkdir(this.storage.directory, { recursive: true });
        this.watcher = watch(this.storage.directory, { persistent: false }, (_event, name) => {
          if (name?.toString() !== 'current.json') return;
          clearTimeout(this.debounce);
          this.debounce = setTimeout(() => {
            void this.adoptLatest().catch(this.warn);
          }, 100);
        });
        this.watcher.on('error', this.warn);
        // Filesystem notifications may be coalesced or missed, especially after sleep.
        this.timer = setInterval(() => {
          void this.adoptLatest().catch(this.warn);
        }, 30000);
        this.timer.unref();
        await this.adoptLatest().catch(this.warn);
        await this.storage.cleanup();
      })();
    await this.initialize;
  }
  async ensure() {
    await this.start();
    if (!this.updating) {
      this.updating = this.update().finally(() => {
        this.updating = undefined;
      });
    }
    return this.updating;
  }
  private async adoptLatest() {
    if (this.disposed) return;
    this.switching = this.switching
      .catch(() => {})
      .then(async () => {
        if (this.disposed) return;
        const directory = await this.storage.find();
        if (!directory || (directory === this.directory && this.worker?.alive)) return;
        const next = new IconifyWorkerClient(this.workerFile);
        let categories: CatalogCategory[];
        try {
          categories = await next.request<CatalogCategory[]>({ type: 'open', directory });
        } catch (error) {
          await next.dispose().catch(this.warn);
          await this.storage.invalidate(directory);
          await this.storage.keepOnly(this.directory);
          throw error;
        }
        if (this.disposed) {
          await next.dispose();
          return;
        }
        const previous = this.worker;
        this.worker = next;
        this.directory = directory;
        this.categories = categories;
        this.generation++;
        for (const listener of this.change) {
          try {
            listener();
          } catch (error) {
            this.warn(error);
          }
        }
        // A maintenance failure must not close an already published and functioning new reader.
        try {
          await previous?.dispose();
          await this.storage.keepOnly(directory);
        } catch (error) {
          this.warn(error);
        }
      });
    return this.switching;
  }
  private async update() {
    // One window downloads/builds while all other windows can keep using their existing readers.
    const release = await lock(path.join(this.storage.directory, '.builder'), {
      realpath: false,
      stale: 30000,
      update: 10000,
      lockfilePath: path.join(this.storage.directory, '.build.lock'),
      retries: { retries: 14400, factor: 1, minTimeout: 100, maxTimeout: 100 },
    });
    try {
      if (this.disposed) return;
      const source = await this.download.ensure();
      if (await this.storage.validate(source)) {
        await this.adoptLatest();
        return;
      }
      const version = JSON.parse(
        await fs.readFile(path.join(path.dirname(source), 'package.json'), 'utf8'),
      ).version as string;
      const existing = await this.storage.find(version);
      if (!existing) {
        const directory = await fs.mkdtemp(
          path.join(this.storage.directory, `.build-${process.pid}-`),
        );
        const builder = new IconifyWorkerClient(this.workerFile, (completed, total) =>
          this.report({ stage: 'building', completed, total }),
        );
        try {
          const icons = await builder.request<number>({
            type: 'build',
            source,
            directory,
            version,
          });
          await builder.dispose();
          if (!this.disposed) await this.storage.publish(directory, version, icons);
        } finally {
          try {
            await builder.dispose();
          } finally {
            await fs.rm(directory, { recursive: true, force: true });
          }
        }
      }
      await this.adoptLatest();
    } catch (error) {
      if (!this.worker) throw error;
      this.warn(error);
    } finally {
      try {
        await this.download.keepOnly();
      } finally {
        await release();
      }
    }
  }
  async query(query: IconQuery, generation: number) {
    const worker = this.worker;
    if (!worker || generation !== this.generation) throw new Error('Icon database version changed');
    const page = await worker.request<IconPage>({ type: 'query', query });
    if (worker !== this.worker) throw new Error('Icon database version changed');
    return page;
  }
  async dispose() {
    this.disposed = true;
    this.watcher?.close();
    clearInterval(this.timer);
    clearTimeout(this.debounce);
    this.change.clear();
    await this.switching.catch(() => {});
    await this.worker?.dispose();
    this.worker = undefined;
    await this.storage.keepOnly();
  }
}
