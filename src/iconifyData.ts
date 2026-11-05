import type { IncomingMessage } from 'http';

import { createHash } from 'crypto';
import { createWriteStream } from 'fs';
import fs from 'fs/promises';
import https from 'https';
import path from 'path';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { x } from 'tar';

import { IconifyCacheStorage } from './iconifyCacheStorage';

const LatestPackageUrl = 'https://registry.npmjs.org/@iconify%2fjson/latest';
const VersionPattern = /^\d+\.\d+\.\d+$/;

// Use streaming HTTPS so progress and integrity checks work without buffering the package.
export function requestHttps(url: string, redirects = 0): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (new URL(url).protocol !== 'https:') {
      reject(new Error('Only HTTPS package URLs are supported'));
      return;
    }
    const request = https.get(url, (response) => {
      clearTimeout(timer);
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location && redirects < 5) {
        response.resume();
        resolve(requestHttps(new URL(response.headers.location, url).href, redirects + 1));
      } else if (status !== 200) {
        response.resume();
        reject(new Error(`HTTP ${status}: ${url}`));
      } else {
        // Socket inactivity resets on incoming data; a large but progressing download may
        // take longer than two minutes. Keep a separate deadline for DNS/headers.
        request.setTimeout(120_000, () => request.destroy(new Error(`Download stalled: ${url}`)));
        resolve(response);
      }
    });
    const timer = setTimeout(
      () => request.destroy(new Error(`Request timed out: ${url}`)),
      120_000,
    );
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
  });
}

interface PackageInfo {
  name: string;
  version: string;
  dist: { tarball: string; integrity: string };
}

export interface IconifyDataProgress {
  stage: 'checking' | 'downloading' | 'extracting';
  version?: string;
  downloadedBytes?: number;
  totalBytes?: number;
}

export class IconifyDataCache {
  private pending?: Promise<string>;
  private readonly storage: IconifyCacheStorage;

  constructor(
    private readonly directory: string,
    private readonly language: string,
    private readonly report: (progress: IconifyDataProgress) => void,
    private readonly warn: (error: unknown) => void,
    private readonly request = requestHttps,
    retainedVersions = 2,
    private readonly resolveVersion?: (version: string) => Promise<string | undefined>,
    validateContents = true,
  ) {
    this.storage = new IconifyCacheStorage(directory, retainedVersions, validateContents);
  }

  // This local-only lookup must never wait for npm or an in-flight download.
  public async getCachedDirectory(): Promise<string | undefined> {
    return this.storage.find();
  }

  public acquireReader(directory: string) {
    return this.storage.acquireReader(directory);
  }
  public keepOnly(directory?: string) {
    return this.storage.keepOnly(directory);
  }

  // Share an in-flight update when several commands open the panel together.
  public ensure(): Promise<string> {
    if (!this.pending) {
      this.pending = this.update().finally(() => {
        this.pending = undefined;
      });
    }
    return this.pending;
  }

  private async update(): Promise<string> {
    await fs.mkdir(this.directory, { recursive: true });
    try {
      this.report({ stage: 'checking' });
      const response = await this.request(LatestPackageUrl);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response) {
        const buffer = Buffer.from(chunk);
        size += buffer.length;
        if (size > 1024 * 1024) throw new Error('npm package metadata is too large');
        chunks.push(buffer);
      }
      const info = JSON.parse(Buffer.concat(chunks).toString('utf8')) as PackageInfo;
      if (
        info.name !== '@iconify/json' ||
        !VersionPattern.test(info.version) ||
        typeof info.dist?.tarball !== 'string' ||
        !info.dist.integrity?.startsWith('sha512-')
      ) {
        throw new Error('Invalid @iconify/json package metadata from npm');
      }
      const cached =
        (await this.resolveVersion?.(info.version)) ?? (await this.storage.find(info.version));
      const directory = cached ?? (await this.download(info));
      await this.storage.cleanup();
      return directory;
    } catch (error) {
      // Only completed version directories can be used as an offline fallback.
      const cached = await this.getCachedDirectory();
      await this.storage.cleanup();
      if (cached) {
        this.warn(error);
        return cached;
      }
      throw error;
    }
  }

  private async download(info: PackageInfo) {
    this.report({ stage: 'downloading', version: info.version, downloadedBytes: 0 });
    const url =
      this.language.toLowerCase() === 'zh-cn'
        ? `https://cdn.npmmirror.com/packages/%40iconify/json/${info.version}/json-${info.version}.tgz`
        : info.dist.tarball;
    const temporary = await fs.mkdtemp(path.join(this.directory, `.download-${process.pid}-`));
    try {
      const archive = path.join(temporary, 'package.tgz');
      const extracted = path.join(temporary, 'package');
      await fs.mkdir(extracted);
      const response = await this.request(url);
      const length = Number(response.headers?.['content-length']);
      const totalBytes = Number.isSafeInteger(length) && length > 0 ? length : undefined;
      let downloadedBytes = 0;
      let lastReport = 0;
      const reportDownload = () => {
        this.report({ stage: 'downloading', version: info.version, downloadedBytes, totalBytes });
      };
      reportDownload();
      const hash = createHash('sha512');
      const tracker = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          downloadedBytes += chunk.length;
          if (Date.now() - lastReport >= 100) {
            lastReport = Date.now();
            reportDownload();
          }
          callback(null, chunk);
        },
      });
      await pipeline(response, tracker, createWriteStream(archive));
      reportDownload();
      this.report({ stage: 'extracting', version: info.version });
      if (`sha512-${hash.digest('base64')}` !== info.dist.integrity) {
        throw new Error('The downloaded @iconify/json package failed its integrity check');
      }
      await x({
        file: archive,
        cwd: extracted,
        strip: 1,
        strict: true,
        filter: (entryPath, entry) =>
          'type' in entry &&
          entry.type === 'File' &&
          (entryPath === 'package/package.json' || /^package\/json\/[^/]+\.json$/.test(entryPath)),
      });
      if (!(await this.storage.validate(extracted, info.version))) {
        throw new Error('The downloaded @iconify/json package contains no valid icon data');
      }
      return await this.storage.publish(extracted, info.version);
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
}
