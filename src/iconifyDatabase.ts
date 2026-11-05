import type { FileHandle } from 'node:fs/promises';

import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { deflate, inflate } from 'node:zlib';

import type { Icon, ViewBox } from './common';

import {
  CatalogFormat,
  MaxIconBytes,
  PageBytes,
  PageSize,
  type CatalogCategory,
  type IconCursor,
  type IconPage,
  type IconQuery,
} from './iconifyCatalogTypes';

const compress = promisify(deflate);
const decompress = promisify(inflate);
interface RawIcon extends ViewBox {
  body: string;
}
interface Collection extends ViewBox {
  prefix: string;
  info: { name: string } & ViewBox;
  icons: Record<string, RawIcon>;
}
interface Row {
  id: number;
  prefix: string;
  name: string;
  offset: number;
  size: number;
  raw_size: number;
  score?: number;
  favoriteOffset?: number;
}
interface CollectionMetadata extends ViewBox {
  info: { name: string } & ViewBox;
}

// Each icon remains independently decodable. The last 32KiB form the shared Deflate window.
export function createDictionary(entries: [string, RawIcon][]): Buffer {
  const pieces: Buffer[] = [];
  const count = Math.min(256, entries.length);
  for (let i = 0; i < count; i++) {
    pieces.push(
      Buffer.from(JSON.stringify(entries[Math.floor((i * entries.length) / count)][1])).subarray(
        0,
        Math.floor(32768 / count),
      ),
    );
  }
  const frequencies = new Map<string, number>();
  const samples = Math.min(128, entries.length);
  for (let i = 0; i < samples; i++) {
    const text = JSON.stringify(entries[Math.floor((i * entries.length) / samples)][1]).slice(
      0,
      2048,
    );
    for (let j = 0; j + 16 <= text.length; j += 8) {
      const fragment = text.slice(j, j + 16);
      frequencies.set(fragment, (frequencies.get(fragment) ?? 0) + 1);
    }
  }
  const frequent = [...frequencies]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 1800)
    .reverse();
  pieces.push(Buffer.from(frequent.map(([text]) => text).join('')));
  return Buffer.concat(pieces).subarray(-32768);
}
async function concurrentMap<T, R>(
  values: T[],
  map: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const result = Array.from<R>({ length: values.length });
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, values.length) }, async () => {
      while (next < values.length) {
        const index = next++;
        result[index] = await map(values[index], index);
      }
    }),
  );
  return result;
}
async function writeAll(file: FileHandle, bytes: Uint8Array, offset: number) {
  let written = 0;
  while (written < bytes.length) {
    const result = await file.write(bytes, written, bytes.length - written, offset + written);
    if (!result.bytesWritten) throw new Error('Could not write icon data');
    written += result.bytesWritten;
  }
}
export async function buildCatalog(
  source: string,
  directory: string,
  version: string,
  report: (completed: number, total: number) => void = () => {},
) {
  await fs.mkdir(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'index.sqlite'));
  const file = await fs.open(path.join(directory, 'icons.bin'), 'wx');
  let offset = 0;
  let id = 0;
  try {
    db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-8192;
      CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE collections(prefix TEXT PRIMARY KEY,name TEXT NOT NULL,count INTEGER NOT NULL,data TEXT NOT NULL,dictionary BLOB NOT NULL);
      CREATE TABLE icons(id INTEGER PRIMARY KEY,prefix TEXT NOT NULL,name TEXT NOT NULL,offset INTEGER NOT NULL,size INTEGER NOT NULL,raw_size INTEGER NOT NULL);
      BEGIN;`);
    const insertCollection = db.prepare('INSERT INTO collections VALUES(?,?,?,?,?)');
    const insertIcon = db.prepare('INSERT INTO icons VALUES(?,?,?,?,?,?)');
    const files = (await fs.readdir(source)).filter((name) => name.endsWith('.json')).sort();
    for (let collectionIndex = 0; collectionIndex < files.length; collectionIndex++) {
      const data = JSON.parse(
        await fs.readFile(path.join(source, files[collectionIndex]), 'utf8'),
      ) as Collection;
      if (
        !data ||
        typeof data.prefix !== 'string' ||
        typeof data.info?.name !== 'string' ||
        !data.icons ||
        typeof data.icons !== 'object'
      )
        throw new Error('Invalid icon collection');
      const entries = Object.entries(data.icons);
      const dictionary = createDictionary(entries);
      const metadata: CollectionMetadata = {
        info: data.info,
        left: data.left,
        top: data.top,
        width: data.width,
        height: data.height,
      };
      insertCollection.run(
        data.prefix,
        data.info.name,
        entries.length,
        JSON.stringify(metadata),
        dictionary,
      );
      let index = 0;
      while (index < entries.length) {
        const batch: { name: string; bytes: Buffer }[] = [];
        let rawBytes = 0;
        while (index < entries.length && batch.length < PageSize && rawBytes < PageBytes) {
          const [name, icon] = entries[index++];
          if (!icon || typeof icon.body !== 'string') throw new Error('Invalid icon body');
          const bytes = Buffer.from(JSON.stringify(icon));
          if (bytes.length > MaxIconBytes) throw new Error('Icon exceeds the supported size');
          batch.push({ name, bytes });
          rawBytes += bytes.length;
        }
        const compressed = await concurrentMap(batch, (item) =>
          compress(item.bytes, { level: 6, dictionary }),
        );
        const packed = Buffer.concat(compressed);
        await writeAll(file, packed, offset);
        for (let i = 0; i < batch.length; i++) {
          insertIcon.run(
            ++id,
            data.prefix,
            batch[i].name,
            offset,
            compressed[i].length,
            batch[i].bytes.length,
          );
          offset += compressed[i].length;
        }
      }
      report(collectionIndex + 1, files.length);
    }
    if (!id) throw new Error('The package contains no icons');
    db.prepare('INSERT INTO metadata VALUES(?,?)').run('version', version);
    db.prepare('INSERT INTO metadata VALUES(?,?)').run('format', String(CatalogFormat));
    db.exec(`CREATE UNIQUE INDEX prefix_name ON icons(prefix,name);
      CREATE INDEX name_prefix ON icons(name,prefix);
      CREATE VIRTUAL TABLE icon_search USING fts5(name,content=icons,content_rowid=id,tokenize=trigram,detail=none,columnsize=0);
      INSERT INTO icon_search(icon_search) VALUES('rebuild');
      INSERT INTO icon_search(icon_search) VALUES('optimize'); COMMIT;`);
    if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok')
      throw new Error('Invalid generated icon index');
    await file.sync();
    return id;
  } finally {
    try {
      db.close();
    } finally {
      await file.close();
    }
  }
}
function globToken(token: string) {
  return (
    '*' +
    token.replace(
      /[[\]*?]/g,
      (char) => ({ '[': '[[]', ']': '[]]', '*': '[*]', '?': '[?]' })[char]!,
    ) +
    '*'
  );
}
function cursorFor(row: Row): IconCursor {
  return {
    name: row.name,
    prefix: row.prefix,
    score: row.score ?? 0,
    favoriteOffset: row.favoriteOffset,
  };
}
export class IconDatabase {
  private dictionaries = new Map<
    string,
    { dictionary: Uint8Array; metadata: CollectionMetadata }
  >();
  private dictionaryBytes = 0;
  private tokens: { text: string; boundary: RegExp }[] = [];
  private constructor(
    private db: DatabaseSync,
    private file: FileHandle,
    private size: number,
  ) {
    db.exec('PRAGMA cache_size=-4096; PRAGMA query_only=ON;');
    db.function('icon_score', (name) =>
      this.tokens.reduce(
        (score, token) =>
          score +
          (token.boundary.test(String(name)) ? 10 : String(name).includes(token.text) ? 1 : 0),
        0,
      ),
    );
  }
  static async open(directory: string) {
    const db = new DatabaseSync(path.join(directory, 'index.sqlite'), { readOnly: true });
    let file: FileHandle | undefined;
    try {
      if (
        db.prepare("SELECT value FROM metadata WHERE key='format'").get()?.value !==
        String(CatalogFormat)
      )
        throw new Error('Unsupported icon database format');
      file = await fs.open(path.join(directory, 'icons.bin'), 'r');
      const size = (await file.stat()).size;
      return new IconDatabase(db, file, size);
    } catch (error) {
      db.close();
      await file?.close();
      throw error;
    }
  }
  categories(): CatalogCategory[] {
    return this.db
      .prepare('SELECT prefix category,name,count FROM collections ORDER BY prefix')
      .all() as unknown as CatalogCategory[];
  }
  async close() {
    try {
      this.db.close();
    } finally {
      await this.file.close();
    }
    this.dictionaries.clear();
  }
  private select(query: IconQuery): Row[] {
    if (query.favorites) {
      const rows: Row[] = [];
      const find = this.db.prepare('SELECT * FROM icons WHERE prefix=? AND name=?');
      const ids = [...new Set(query.favorites)].slice(0, 10000);
      const start = query.cursor?.favoriteOffset ?? 0;
      for (let index = start; index < ids.length && rows.length <= PageSize; index++) {
        const [prefix, name] = ids[index].split(':');
        if (!prefix || !name) continue;
        const row = find.get(prefix, name) as unknown as Row | undefined;
        if (row) rows.push({ ...row, favoriteOffset: index + 1 });
      }
      return rows;
    }
    this.tokens = [...new Set((query.text ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean))]
      .slice(0, 16)
      .map((text) => ({
        text,
        boundary: new RegExp('\\b' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'),
      }));
    const args: (string | number)[] = [];
    const conditions: string[] = [];
    if (query.category) {
      conditions.push('i.prefix=?');
      args.push(query.category);
    }
    if (this.tokens.length) {
      const candidates = this.tokens.map(({ text }) => {
        if (text.length >= 3) {
          args.push(globToken(text));
          return 'SELECT rowid FROM icon_search WHERE name GLOB ?';
        }
        args.push(text);
        return 'SELECT id FROM icons WHERE instr(name,?)>0';
      });
      conditions.push(`i.id IN (${candidates.join(' UNION ')})`);
    }
    const cursor = query.cursor;
    if (cursor) {
      if (this.tokens.length) {
        conditions.push(
          '(icon_score(i.name) < ? OR (icon_score(i.name)=? AND (i.name,i.prefix)>(?,?)))',
        );
        args.push(cursor.score, cursor.score, cursor.name, cursor.prefix);
      } else {
        conditions.push('(i.prefix,i.name)>(?,?)');
        args.push(cursor.prefix, cursor.name);
      }
    }
    return this.db
      .prepare(`SELECT i.*${this.tokens.length ? ',icon_score(i.name) score' : ''} FROM icons i
      ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
      ORDER BY ${this.tokens.length ? 'score DESC,i.name,i.prefix' : 'i.prefix,i.name'} LIMIT ${PageSize + 1}`)
      .all(...args) as unknown as Row[];
  }
  async query(query: IconQuery): Promise<IconPage> {
    const rows = this.select(query);
    const selected: Row[] = [];
    let bytes = 0;
    for (const row of rows) {
      if (selected.length >= PageSize || (selected.length && bytes + row.raw_size > PageBytes))
        break;
      if (
        !Number.isSafeInteger(row.raw_size) ||
        row.raw_size <= 0 ||
        row.raw_size > MaxIconBytes ||
        !Number.isSafeInteger(row.offset) ||
        row.offset < 0 ||
        !Number.isSafeInteger(row.size) ||
        row.size <= 0 ||
        row.size > MaxIconBytes + 65536 ||
        row.offset + row.size > this.size
      )
        throw new Error('Invalid icon data range');
      selected.push(row);
      bytes += row.raw_size;
    }
    const icons = await concurrentMap(selected, async (row) => {
      let collection = this.dictionaries.get(row.prefix);
      if (!collection) {
        const value = this.db
          .prepare('SELECT dictionary,data FROM collections WHERE prefix=?')
          .get(row.prefix)!;
        collection = {
          dictionary: value.dictionary as Uint8Array,
          metadata: JSON.parse(String(value.data)),
        };
        if (collection.dictionary.length > 32768) throw new Error('Invalid icon dictionary');
        this.dictionaryBytes += collection.dictionary.length;
        this.dictionaries.set(row.prefix, collection);
        while (this.dictionaryBytes > 8 * 1024 * 1024) {
          const oldest = this.dictionaries.keys().next().value!;
          this.dictionaryBytes -= this.dictionaries.get(oldest)!.dictionary.length;
          this.dictionaries.delete(oldest);
        }
      }
      // Touch the entry after lookup so frequently used dictionaries stay resident.
      this.dictionaries.delete(row.prefix);
      this.dictionaries.set(row.prefix, collection);
      const compressed = Buffer.allocUnsafeSlow(row.size);
      let received = 0;
      while (received < compressed.length) {
        const result = await this.file.read(
          compressed,
          received,
          compressed.length - received,
          row.offset + received,
        );
        if (!result.bytesRead) throw new Error('Truncated icon data');
        received += result.bytesRead;
      }
      const decoded = await decompress(compressed, {
        dictionary: collection.dictionary,
        maxOutputLength: row.raw_size,
      });
      if (decoded.length !== row.raw_size) throw new Error('Invalid icon data size');
      const raw = JSON.parse(decoded.toString()) as RawIcon;
      const metadata = collection.metadata;
      const viewBox = [
        raw.left ?? metadata.left ?? metadata.info.left ?? 0,
        raw.top ?? metadata.top ?? metadata.info.top ?? 0,
        raw.width ?? metadata.width ?? metadata.info.width ?? 16,
        raw.height ?? metadata.height ?? metadata.info.height ?? 16,
      ].join(' ');
      return {
        id: `${row.prefix}:${row.name}`,
        category: row.prefix,
        name: row.name,
        body: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${viewBox}'>${raw.body}</svg>`,
      } satisfies Icon;
    });
    return {
      icons,
      nextCursor:
        selected.length < rows.length ? cursorFor(selected[selected.length - 1]) : undefined,
    };
  }
}
