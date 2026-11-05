import { vm, vmIgnore, vmWatch } from 'jinge';

import type { Icon, IconCategory, SettingsData, WebviewInitData } from '../common';
import type { IconPage, IconQuery } from '../iconifyCatalogTypes';

import { bodyHasDark } from './util';
import { vscode } from './vscode';

export const GROUP_ALL_KEY = '--all--';
export interface WebviewState {
  darkMode: boolean;
  topTab: 'all' | 'favor';
  groupTab: string;
}
export type GlobalStore = WebviewState &
  WebviewInitData & {
    all: Map<string, IconCategory>;
    generation: number;
    loading: boolean;
  };

const init = window.ICONIFY_INIT_DATA;
const saved = vscode.getState() as Partial<WebviewState & WebviewInitData> | undefined;
export const globalStore: GlobalStore =
  (import.meta.hot?.data.store as GlobalStore | undefined) ??
  vm({
    ...init,
    ...saved,
    searchText: saved?.searchText ?? init.searchText ?? '',
    darkMode: bodyHasDark(),
    topTab: saved?.topTab ?? (init.mode === 'view.favor' ? 'favor' : 'all'),
    groupTab: saved?.groupTab ?? (init.favorGroup || GROUP_ALL_KEY),
    all: vmIgnore(new Map<string, IconCategory>()),
    generation: 0,
    loading: true,
  });
let requested = Boolean(import.meta.hot?.data.requested);
let requestId = Number(import.meta.hot?.data.requestId) || 0;
const pending = new Map<
  number,
  { resolve: (page: IconPage) => void; reject: (error: Error) => void }
>();
export function queryIcons(query: IconQuery, favorites: boolean): Promise<IconPage> {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    vscode.postMessage({
      type: 'icons:query',
      requestId: id,
      generation: globalStore.generation,
      text: (query.text ?? '').slice(0, 512),
      category: query.category,
      cursor: query.cursor,
      favorites,
    });
  });
}
function clearRequests() {
  for (const request of pending.values())
    request.reject(new Error('Icon database version changed'));
  pending.clear();
}
export function requestIcons() {
  if (requested) return;
  requested = true;
  vscode.postMessage({ type: 'load' });
}

function persist() {
  const {
    mode,
    searchText,
    topTab,
    groupTab,
    darkMode,
    codeType,
    favorGroup,
    favorIcons,
    favorTabs,
    locale,
  } = globalStore;
  vscode.setState({
    mode,
    searchText,
    topTab,
    groupTab,
    darkMode,
    codeType,
    favorGroup,
    favorIcons,
    favorTabs,
    locale,
  });
}
const unwatch = (
  [
    'mode',
    'searchText',
    'topTab',
    'groupTab',
    'codeType',
    'favorGroup',
    'favorIcons',
    'favorTabs',
  ] as const
).map((key) => vmWatch(globalStore, key, persist, { deep: true }));
function syncTheme() {
  globalStore.darkMode = bodyHasDark();
  document.documentElement.classList.toggle('dark', globalStore.darkMode);
}
syncTheme();
const observer = new MutationObserver(syncTheme);
observer.observe(document.body, { attributes: true });

const onMessage = (event: MessageEvent) => {
  if (typeof event.data !== 'object' || !event.data) return;
  switch (event.data.type) {
    case 'catalog:ready': {
      if (event.data.generation === globalStore.generation && !globalStore.loading) break;
      clearRequests();
      globalStore.all = vmIgnore(
        new Map(
          (event.data.categories as IconCategory[]).map((group) => [
            group.category,
            vmIgnore(group),
          ]),
        ),
      );
      if (globalStore.groupTab !== GROUP_ALL_KEY && !globalStore.all.has(globalStore.groupTab))
        globalStore.groupTab = GROUP_ALL_KEY;
      globalStore.generation = event.data.generation;
      globalStore.loading = false;
      break;
    }
    case 'icons:page': {
      if (event.data.generation !== globalStore.generation) break;
      const request = pending.get(event.data.requestId);
      if (!request) break;
      pending.delete(event.data.requestId);
      if (event.data.error) request.reject(new Error(event.data.error));
      else request.resolve({ icons: event.data.icons, nextCursor: event.data.nextCursor });
      break;
    }
    case 'update:mode': {
      const options = event.data as WebviewInitData;
      globalStore.mode = options.mode;
      globalStore.searchText = options.searchText ?? '';
      globalStore.topTab = options.mode === 'view.favor' ? 'favor' : 'all';
      break;
    }
    case 'update:settings':
      Object.assign(globalStore, event.data.data ?? event.data);
      break;
  }
};
window.addEventListener('message', onMessage);

export function updateFavorIcon(operation: 'add' | 'rm', icon: Icon) {
  const favorites = new Set(globalStore.favorIcons);
  if (operation === 'add') favorites.add(icon.id);
  else favorites.delete(icon.id);
  globalStore.favorIcons = [...favorites];
  vscode.postMessage({
    type: operation === 'add' ? 'add-favor-icon' : 'rm-favor-icon',
    id: icon.id,
  });
}
export function saveSettings(data: Omit<SettingsData, 'favorIcons'>) {
  Object.assign(globalStore, data);
  vscode.postMessage({ type: 'save:settings', data });
}
if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    data.store = globalStore;
    data.requested = requested;
    data.requestId = requestId;
    clearRequests();
    window.removeEventListener('message', onMessage);
    observer.disconnect();
    unwatch.forEach((stop) => stop());
  });
}
