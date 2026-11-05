import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { lock } from 'proper-lockfile';

import { CatalogFiles, CatalogFormat, type CatalogManifest } from './iconifyCatalogTypes';

const Entry = /^(\d+\.\d+\.\d+)-[a-f0-9-]+$/;
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}
export class IconifyCatalogStorage {
  private selected = new Set<string>();
  private lease = `.lease-${process.pid}-${randomUUID()}.json`;
  constructor(readonly directory: string) {}
  async locked<T>(run: () => Promise<T>): Promise<T> {
    await fs.mkdir(this.directory, { recursive: true });
    const release = await lock(this.directory, {
      realpath: false,
      stale: 15000,
      update: 5000,
      lockfilePath: path.join(this.directory, '.catalog.lock'),
      retries: { retries: 600, factor: 1, minTimeout: 50, maxTimeout: 50 },
    });
    try {
      return await run();
    } finally {
      await release();
    }
  }
  private async entries() {
    return (await fs.readdir(this.directory))
      .filter((name) => Entry.test(name))
      .sort(
        (a, b) =>
          Entry.exec(b)![1].localeCompare(Entry.exec(a)![1], 'en', { numeric: true }) ||
          b.localeCompare(a),
      );
  }
  async validate(directory: string, version?: string) {
    try {
      const manifest = JSON.parse(
        await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'),
      ) as CatalogManifest;
      if (
        manifest.format !== CatalogFormat ||
        !/^\d+\.\d+\.\d+$/.test(manifest.version) ||
        (version && manifest.version !== version) ||
        !Number.isSafeInteger(manifest.icons) ||
        manifest.icons < 1 ||
        !Array.isArray(manifest.files) ||
        manifest.files.length !== CatalogFiles.length
      )
        return false;
      for (const name of CatalogFiles) {
        const expected = manifest.files.find((file) => file.name === name);
        const actual = await fs.lstat(path.join(directory, name));
        if (
          !expected ||
          !actual.isFile() ||
          actual.size <= 0 ||
          actual.size !== expected.size ||
          actual.mtimeMs !== expected.mtimeMs
        )
          return false;
      }
      return true;
    } catch {
      return false;
    }
  }
  private async writeLease() {
    const filename = path.join(this.directory, this.lease);
    if (this.selected.size) await fs.writeFile(filename, JSON.stringify([...this.selected]));
    else await fs.rm(filename, { force: true });
  }
  private async orderedEntries() {
    const entries = await this.entries();
    try {
      const current = JSON.parse(
        await fs.readFile(path.join(this.directory, 'current.json'), 'utf8'),
      ).name as string;
      if (entries.includes(current)) {
        // A stale marker must not hide a newer completed generation after an interrupted publication.
        const version = Entry.exec(current)![1];
        const newer = entries.filter(
          (name) => Entry.exec(name)![1].localeCompare(version, 'en', { numeric: true }) > 0,
        );
        return [
          ...newer,
          current,
          ...entries.filter((name) => name !== current && !newer.includes(name)),
        ];
      }
    } catch {
      /* Scan completed generations after an interrupted publication. */
    }
    return entries;
  }
  async find(version?: string): Promise<string | undefined> {
    return this.locked(async () => {
      for (const name of await this.orderedEntries()) {
        if (version && Entry.exec(name)![1] !== version) continue;
        const directory = path.join(this.directory, name);
        if (await this.validate(directory, version)) {
          this.selected.add(name);
          await this.writeLease();
          return directory;
        }
      }
      return undefined;
    });
  }
  async publish(temporary: string, version: string, icons: number) {
    const files = await Promise.all(
      CatalogFiles.map(async (name) => {
        const stat = await fs.stat(path.join(temporary, name));
        return { name, size: stat.size, mtimeMs: stat.mtimeMs };
      }),
    );
    await fs.writeFile(
      path.join(temporary, 'manifest.json'),
      JSON.stringify({ format: CatalogFormat, version, icons, files } satisfies CatalogManifest),
    );
    return this.locked(async () => {
      const name = `${version}-${randomUUID()}`;
      const directory = path.join(this.directory, name);
      await fs.rename(temporary, directory);
      this.selected.add(name);
      await this.writeLease();
      const marker = path.join(this.directory, `.current-${randomUUID()}.json`);
      await fs.writeFile(marker, JSON.stringify({ name }));
      await fs.rename(marker, path.join(this.directory, 'current.json'));
      return directory;
    });
  }
  async invalidate(directory: string) {
    await this.locked(async () => {
      if (path.dirname(directory) !== this.directory || !Entry.test(path.basename(directory)))
        throw new Error('Invalid catalog directory');
      await fs
        .rename(
          path.join(directory, 'manifest.json'),
          path.join(directory, '.invalid-manifest.json'),
        )
        .catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        });
    });
  }
  async keepOnly(directory?: string) {
    await this.locked(async () => {
      this.selected.clear();
      if (directory) this.selected.add(path.basename(directory));
      await this.writeLease();
      await this.cleanupUnlocked();
    });
  }
  async cleanup() {
    await this.locked(() => this.cleanupUnlocked());
  }
  private async cleanupUnlocked() {
    const protectedNames = new Set<string>();
    let unknownLease = false;
    for (const name of await fs.readdir(this.directory)) {
      const match = /^\.lease-(\d+)-[a-f0-9-]+\.json$/.exec(name);
      if (match) {
        if (!alive(Number(match[1]))) {
          await fs.rm(path.join(this.directory, name), { force: true });
          continue;
        }
        try {
          const selected: unknown = JSON.parse(
            await fs.readFile(path.join(this.directory, name), 'utf8'),
          );
          if (
            !Array.isArray(selected) ||
            !selected.every((value) => typeof value === 'string' && Entry.test(value))
          )
            throw new Error('Invalid lease');
          for (const value of selected) protectedNames.add(value);
        } catch {
          unknownLease = true;
        }
      }
      const build = /^\.build-(\d+)-/.exec(name);
      if (build && !alive(Number(build[1])))
        await fs.rm(path.join(this.directory, name), { recursive: true, force: true });
    }
    if (unknownLease) return;
    let latest: string | undefined;
    for (const name of await this.orderedEntries()) {
      const directory = path.join(this.directory, name);
      if (!latest && (await this.validate(directory))) {
        latest = name;
        continue;
      }
      if (!protectedNames.has(name)) await fs.rm(directory, { recursive: true, force: true });
    }
  }
}
