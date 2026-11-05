import { onUnmount, vm, vmIgnore, watch } from 'jinge';

import type { Icon } from '../common';
import type { IconCursor, IconQuery } from '../iconifyCatalogTypes';

import { GROUP_ALL_KEY, globalStore, queryIcons } from './store';

const CacheBytes = 16 * 1024 * 1024;
interface Page {
  start: number;
  count: number;
  cursor?: IconCursor;
  nextCursor?: IconCursor;
  icons?: Icon[];
  bytes: number;
  used: number;
}
// Keep cursor metadata for scroll-back, but evict SVG bodies by bytes rather than icon count.
export function createIconResults(favorites = false) {
  const state = vm({ count: 0, revision: 0, resetKey: 0, loading: false, error: '' });
  let pages: Page[] = [];
  let epoch = 0;
  let active = false;
  let disposed = false;
  let range = { start: 0, end: 128 };
  let hasMore = true;
  let used = 0;
  let query: IconQuery = {};
  function evict() {
    let bytes = pages.reduce((sum, page) => sum + (page.icons ? page.bytes : 0), 0);
    for (const page of [...pages].sort((a, b) => a.used - b.used)) {
      if (bytes <= CacheBytes) break;
      if (page.start < range.end && page.start + page.count > range.start) continue;
      if (page.icons) {
        page.icons = undefined;
        bytes -= page.bytes;
      }
    }
  }
  async function pump() {
    if (active || disposed || !globalStore.generation || state.error) return;
    const missing = pages.find(
      (page) => !page.icons && page.start < range.end && page.start + page.count > range.start,
    );
    const append = !missing && hasMore && (pages.length === 0 || range.end >= state.count - 64);
    if (!missing && !append) return;
    const currentEpoch = epoch;
    const cursor = missing ? missing.cursor : pages[pages.length - 1]?.nextCursor;
    active = true;
    state.loading = true;
    try {
      const result = await queryIcons({ ...query, cursor }, favorites);
      if (disposed || epoch !== currentEpoch) return;
      const icons = vmIgnore(result.icons.map((icon) => vmIgnore(icon)));
      const page: Page = missing ?? {
        start: state.count,
        count: icons.length,
        cursor,
        bytes: 0,
        used: 0,
      };
      page.icons = icons;
      page.count = icons.length;
      page.nextCursor = result.nextCursor;
      page.bytes = icons.reduce(
        (sum, icon) => sum + 2 * (icon.body.length + icon.name.length + icon.id.length) + 128,
        0,
      );
      page.used = ++used;
      if (!missing) {
        pages.push(page);
        state.count += icons.length;
        hasMore = Boolean(result.nextCursor);
      }
      evict();
      state.revision++;
    } catch (error) {
      if (!disposed && epoch === currentEpoch) state.error = String(error);
    } finally {
      active = false;
      if (!disposed) {
        state.loading = false;
        if (epoch !== currentEpoch || !state.error) void pump();
      }
    }
  }
  function reset() {
    epoch++;
    pages = [];
    hasMore = true;
    range = { start: 0, end: 128 };
    state.count = 0;
    state.error = '';
    state.resetKey++;
    state.revision++;
    query = favorites
      ? {}
      : {
          text: globalStore.searchText,
          category: globalStore.groupTab === GROUP_ALL_KEY ? undefined : globalStore.groupTab,
        };
    void pump();
  }
  watch(globalStore, 'generation', reset);
  if (favorites) watch(globalStore, 'favorIcons', reset, { deep: true });
  else {
    watch(globalStore, 'searchText', reset);
    watch(globalStore, 'groupTab', reset);
  }
  reset();
  onUnmount(() => {
    disposed = true;
    epoch++;
    pages = [];
  });
  return {
    state,
    retry() {
      state.error = '';
      void pump();
    },
    getIcon(this: void, index: number) {
      // Binary search the variable-size pages: the byte budget can end a page before 128 icons.
      let left = 0,
        right = pages.length - 1;
      while (left <= right) {
        const middle = (left + right) >>> 1;
        const page = pages[middle];
        if (index < page.start) right = middle - 1;
        else if (index >= page.start + page.count) left = middle + 1;
        else {
          page.used = ++used;
          return page.icons?.[index - page.start];
        }
      }
      return undefined;
    },
    range(this: void, start: number, end: number) {
      const changed = range.start !== start || range.end !== end;
      range = { start, end };
      if (changed) evict();
      void pump();
    },
  };
}
