import type { Stats } from 'fs';

import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { lock } from 'proper-lockfile';

const EntryPattern = /^(\d+\.\d+\.\d+)(?:-[a-f0-9-]+)?$/;
const IndexName = '.cache-index.json';
const Day = 24 * 60 * 60 * 1000;
interface Fingerprint {
  name: string;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}
interface CacheIndex {
  format: 1;
  files: Fingerprint[];
}

function fingerprint(name: string, stat: Stats): Fingerprint {
  return { name, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
}
function unchanged(a: Fingerprint, b: Fingerprint) {
  return (
    a.name === b.name && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs
  );
}
function isIconSet(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const data = value as {
    prefix?: unknown;
    info?: { name?: unknown };
    icons?: Record<string, { body?: unknown }>;
  };
  return (
    typeof data.prefix === 'string' &&
    typeof data.info?.name === 'string' &&
    !!data.icons &&
    typeof data.icons === 'object' &&
    !Array.isArray(data.icons) &&
    Object.values(data.icons).every((icon) => !!icon && typeof icon.body === 'string')
  );
}
function alive(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

// All directory selection, publication and eviction share one short filesystem lock.
// Downloads and extraction happen outside it, so they cannot delay a cached startup.
export class IconifyCacheStorage {
  private readonly selected = new Set<string>();
  private readonly readers = new Map<string, number>();
  private readonly leaseName = `.lease-${process.pid}-${randomUUID()}.json`;

  constructor(
    private readonly directory: string,
    private readonly retainedVersions = 2,
    private readonly validateContents = true,
  ) {}

  private async locked<T>(run: () => Promise<T>): Promise<T> {
    await fs.mkdir(this.directory, { recursive: true });
    const release = await lock(this.directory, {
      realpath: false,
      stale: 15_000,
      update: 5_000,
      lockfilePath: path.join(this.directory, '.cache.lock'),
      retries: { retries: 600, factor: 1, minTimeout: 50, maxTimeout: 50 },
    });
    try {
      return await run();
    } finally {
      await release();
    }
  }

  public async validate(directory: string, version: string): Promise<boolean> {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
      if (manifest.name !== '@iconify/json' || manifest.version !== version) return false;
      const jsonDirectory = path.join(directory, 'json');
      const files = (await fs.readdir(jsonDirectory))
        .filter((name) => name.endsWith('.json'))
        .sort();
      if (!files.length) return false;
      const actual = await Promise.all(
        files.map(async (name) => {
          const stat = await fs.lstat(path.join(jsonDirectory, name));
          if (!stat.isFile()) throw new Error('Invalid cached icon file');
          return fingerprint(name, stat);
        }),
      );
      let index: CacheIndex | undefined;
      try {
        index = JSON.parse(
          await fs.readFile(path.join(directory, IndexName), 'utf8'),
        ) as CacheIndex;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false;
      }
      if (index) {
        return (
          index.format === 1 &&
          Array.isArray(index.files) &&
          index.files.length === actual.length &&
          actual.every((file, i) => unchanged(file, index.files[i]))
        );
      }
      // Validate old caches once; later startups only need the file inventory and stat checks.
      // Read one collection at a time to avoid parsing the entire ~600 MB package in memory.
      for (const file of actual) {
        const filename = path.join(jsonDirectory, file.name);
        // Catalog conversion validates JSON in its Worker instead of parsing ~600MB in the extension host.
        if (this.validateContents && !isIconSet(JSON.parse(await fs.readFile(filename, 'utf8'))))
          return false;
        if (!unchanged(file, fingerprint(file.name, await fs.lstat(filename)))) return false;
      }
      await fs.writeFile(
        path.join(directory, IndexName),
        JSON.stringify({ format: 1, files: actual } satisfies CacheIndex),
      );
      return true;
    } catch {
      return false;
    }
  }

  private async entries() {
    const entries = await Promise.all(
      (await fs.readdir(this.directory)).map(async (name) => {
        const version = EntryPattern.exec(name)?.[1];
        if (!version) return undefined;
        const stat = await fs.lstat(path.join(this.directory, name));
        return stat.isDirectory() ? { name, version, mtime: stat.mtimeMs } : undefined;
      }),
    );
    return entries
      .filter((entry) => entry !== undefined)
      .sort(
        (a, b) => b.version.localeCompare(a.version, 'en', { numeric: true }) || b.mtime - a.mtime,
      );
  }

  private async writeLease() {
    const entries = [...new Set([...this.selected, ...this.readers.keys()])];
    const filename = path.join(this.directory, this.leaseName);
    if (entries.length) await fs.writeFile(filename, JSON.stringify(entries));
    else await fs.rm(filename, { force: true });
  }
  private async remember(name: string) {
    this.selected.add(name);
    await this.writeLease();
    return path.join(this.directory, name, 'json');
  }
  private async findUnlocked(version?: string) {
    for (const entry of await this.entries()) {
      if (
        (!version || version === entry.version) &&
        (await this.validate(path.join(this.directory, entry.name), entry.version))
      ) {
        return entry.name;
      }
    }
    return undefined;
  }
  public find(version?: string): Promise<string | undefined> {
    return this.locked(async () => {
      const name = await this.findUnlocked(version);
      return name ? this.remember(name) : undefined;
    });
  }

  public publish(extracted: string, version: string): Promise<string> {
    return this.locked(async () => {
      const existing = await this.findUnlocked(version);
      if (existing) return this.remember(existing);
      // Never overwrite a damaged directory another window may still be reading.
      // A repaired generation has its own path; maintenance evicts unused damaged generations.
      let name = version;
      try {
        await fs.lstat(path.join(this.directory, name));
        name = `${version}-${randomUUID()}`;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await fs.rename(extracted, path.join(this.directory, name));
      return this.remember(name);
    });
  }

  // Increment before awaiting the lock, so a concurrent keepOnly() cannot drop a queued reader.
  public async acquireReader(directory: string): Promise<() => Promise<void>> {
    const name = path.basename(path.dirname(directory));
    if (
      !EntryPattern.test(name) ||
      path.resolve(directory) !== path.join(path.resolve(this.directory), name, 'json')
    ) {
      throw new Error('Invalid Iconify cache directory');
    }
    this.readers.set(name, (this.readers.get(name) ?? 0) + 1);
    try {
      await this.locked(() => this.writeLease());
    } catch (error) {
      this.removeReader(name);
      throw error;
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      this.removeReader(name);
      await this.locked(() => this.writeLease());
    };
  }
  private removeReader(name: string) {
    const count = (this.readers.get(name) ?? 1) - 1;
    if (count) this.readers.set(name, count);
    else this.readers.delete(name);
  }
  public keepOnly(directory?: string): Promise<void> {
    return this.locked(async () => {
      this.selected.clear();
      if (directory) this.selected.add(path.basename(path.dirname(directory)));
      await this.writeLease();
      try {
        await this.cleanupUnlocked();
      } catch (error) {
        console.error(error);
      }
    });
  }
  public async cleanup(): Promise<void> {
    try {
      await this.locked(() => this.cleanupUnlocked());
    } catch (error) {
      console.error(error);
    }
  }

  private async cleanupUnlocked() {
    const protectedEntries = new Set<string>();
    let unknownActiveLease = false;
    for (const name of await fs.readdir(this.directory)) {
      const lease = /^\.lease-(\d+)-[a-f0-9-]+\.json$/.exec(name);
      if (lease) {
        if (!alive(Number(lease[1]))) {
          await fs.rm(path.join(this.directory, name), { force: true });
          continue;
        }
        try {
          const entries: unknown = JSON.parse(
            await fs.readFile(path.join(this.directory, name), 'utf8'),
          );
          if (
            !Array.isArray(entries) ||
            !entries.every((entry) => typeof entry === 'string' && EntryPattern.test(entry))
          )
            throw new Error('Invalid lease');
          for (const entry of entries) protectedEntries.add(entry);
        } catch {
          unknownActiveLease = true;
        }
        continue;
      }
      const temporary = /^\.download-(?:(\d+)-)?/.exec(name);
      if (temporary) {
        const filename = path.join(this.directory, name);
        const abandoned = temporary[1]
          ? !alive(Number(temporary[1]))
          : Date.now() - (await fs.lstat(filename)).mtimeMs > Day;
        if (abandoned) await fs.rm(filename, { recursive: true, force: true });
      }
    }
    if (unknownActiveLease) return;
    const retainedVersions = new Set<string>();
    for (const entry of await this.entries()) {
      const filename = path.join(this.directory, entry.name);
      const valid = await this.validate(filename, entry.version);
      if (
        valid &&
        !retainedVersions.has(entry.version) &&
        retainedVersions.size < this.retainedVersions
      ) {
        retainedVersions.add(entry.version);
        continue;
      }
      if (!protectedEntries.has(entry.name))
        await fs.rm(filename, { recursive: true, force: true });
    }
  }
}
