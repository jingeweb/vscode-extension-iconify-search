import type { Disposable, Progress, Tab, Webview, WebviewPanel } from 'vscode';

import path from 'node:path';
import { Uri, ViewColumn, ProgressLocation, env, l10n, window, workspace } from 'vscode';

import type { SettingsData, WebviewInitData } from './common';
import type { IconCursor, IconQuery } from './iconifyCatalogTypes';

import { IconifyCatalog, type CatalogProgress } from './iconifyCatalog';
import _tpl from './iconifyPanel.html?raw';
import { getNonce, replaceTpl } from './util';
import { getWebviewResources } from './webviewResources';

const PanelTitle = l10n.t('Iconify Icons');
const ExtensionId = 'iconifySearch';
function getConf<T>(key: string, defaultValue: T) {
  return (workspace.getConfiguration(ExtensionId)?.get(key) ?? defaultValue) as T;
}
function setConf<T>(key: string, value: T) {
  return workspace.getConfiguration(ExtensionId)?.update(key, value);
}
const getConfFavorTabs = () => getConf<string[]>('favorTabs', []);
const getConfFavorIcons = () => getConf<string[]>('favorIcons', []);
type ShowOptions = { mode: WebviewInitData['mode']; searchText?: string };
function validCursor(value: unknown): value is IconCursor | undefined {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  const cursor = value as IconCursor;
  return (
    typeof cursor.name === 'string' &&
    cursor.name.length <= 256 &&
    typeof cursor.prefix === 'string' &&
    cursor.prefix.length <= 256 &&
    Number.isFinite(cursor.score) &&
    (cursor.favoriteOffset === undefined ||
      (Number.isSafeInteger(cursor.favoriteOffset) &&
        cursor.favoriteOffset >= 0 &&
        cursor.favoriteOffset <= 10000))
  );
}
export class IconifySearchPanel {
  public static readonly viewType = ExtensionId;
  private _panel?: WebviewPanel;
  private _panelDisposables: Disposable[] = [];
  private readonly _catalog: IconifyCatalog;
  private _progress?: Progress<{ message?: string; increment?: number }>;
  private _progressPercent = 0;
  private _updating?: Promise<void>;
  private _webviewReady = false;
  private _pendingOptions?: ShowOptions;
  private _disposed = false;
  private _settingsWrites: Promise<void> = Promise.resolve();

  constructor(
    private readonly _extensionUri: Uri,
    globalStorageUri: Uri,
    private readonly _devServerUrl?: string,
  ) {
    this._catalog = new IconifyCatalog(
      globalStorageUri.fsPath,
      path.join(_extensionUri.fsPath, 'out', 'iconifyDatabaseWorker.cjs'),
      env.language,
      (progress) => this._reportDataProgress(progress),
      (error) => console.error(error),
    );
    this._catalog.onDidChange(() => {
      void this._sendCatalog().catch(console.error);
    });
  }
  // Activation starts preparation even when no Iconify panel has been opened.
  public async start() {
    try {
      await this._catalog.start();
      await this._ensureIcons(Boolean(this._catalog.snapshot));
    } catch (error) {
      console.error(error);
      if (!this._disposed)
        void window.showErrorMessage(l10n.t('Could not load Iconify icons: {0}', String(error)));
    }
  }
  private _reportDataProgress(data: CatalogProgress) {
    if (data.stage === 'checking') {
      this._progress?.report({ message: l10n.t('Checking the latest Iconify version on npm…') });
    } else if (data.stage === 'extracting') {
      this._progress?.report({
        message: l10n.t('Verifying and extracting Iconify {0}…', data.version ?? ''),
      });
    } else if (data.stage === 'building') {
      this._progress?.report({
        message: l10n.t(
          'Preparing Iconify database: {0}/{1} collections',
          data.completed,
          data.total,
        ),
      });
    } else {
      const downloaded = ((data.downloadedBytes ?? 0) / 1_000_000).toFixed(1);
      if (data.totalBytes) {
        const percent = Math.min(
          100,
          Math.floor(((data.downloadedBytes ?? 0) / data.totalBytes) * 100),
        );
        const increment = Math.max(0, percent - this._progressPercent);
        this._progressPercent = Math.max(this._progressPercent, percent);
        this._progress?.report({
          message: l10n.t(
            'Downloading Iconify {0}: {1}% ({2}/{3} MB)',
            data.version ?? '',
            percent,
            downloaded,
            (data.totalBytes / 1_000_000).toFixed(1),
          ),
          increment,
        });
      } else
        this._progress?.report({
          message: l10n.t(
            'Downloading Iconify {0}: {1} MB downloaded',
            data.version ?? '',
            downloaded,
          ),
        });
    }
  }
  private _ensureIcons(background: boolean): Promise<void> {
    if (!this._updating) {
      this._updating = Promise.resolve(
        window.withProgress(
          {
            location: background ? ProgressLocation.Window : ProgressLocation.Notification,
            title: background
              ? l10n.t('Updating Iconify icons')
              : l10n.t('Preparing Iconify icons'),
          },
          async (progress) => {
            this._progress = progress;
            this._progressPercent = 0;
            try {
              await this._catalog.ensure();
            } finally {
              this._progress = undefined;
            }
          },
        ),
      ).finally(() => {
        this._updating = undefined;
      });
    }
    return this._updating;
  }
  private async _sendCatalog() {
    const panel = this._panel;
    const snapshot = this._catalog.snapshot;
    if (panel && this._webviewReady && snapshot) {
      await panel.webview.postMessage({ type: 'catalog:ready', ...snapshot });
    }
  }
  private async _queryIcons(panel: WebviewPanel, message: Record<string, unknown>) {
    if (
      !Number.isSafeInteger(message.requestId) ||
      !Number.isSafeInteger(message.generation) ||
      typeof message.text !== 'string' ||
      message.text.length > 512 ||
      (message.category !== undefined &&
        (typeof message.category !== 'string' || message.category.length > 256)) ||
      !validCursor(message.cursor)
    )
      return;
    await this._settingsWrites;
    const generation = message.generation as number;
    const query: IconQuery = {
      text: message.text,
      category: message.category as string | undefined,
      cursor: message.cursor,
      favorites: message.favorites === true ? getConfFavorIcons() : undefined,
    };
    try {
      const page = await this._catalog.query(query, generation);
      if (
        this._panel === panel &&
        this._webviewReady &&
        generation === this._catalog.snapshot?.generation
      )
        await panel.webview.postMessage({
          type: 'icons:page',
          requestId: message.requestId,
          generation,
          ...page,
        });
    } catch (error) {
      if (this._panel === panel && this._webviewReady)
        await panel.webview.postMessage({
          type: 'icons:page',
          requestId: message.requestId,
          generation,
          error: String(error),
        });
    }
  }
  private async _saveSettings(data: Partial<SettingsData>) {
    for (const key of ['favorTabs', 'favorGroup', 'codeType'] as const) {
      if (data[key] !== undefined) await setConf(key, data[key]);
    }
  }
  private _getIconifyTab(): Tab | undefined {
    return window.tabGroups.all
      .flatMap((group) => group.tabs)
      .find((tab) => tab.label === PanelTitle);
  }
  private async _upFavorIcon(operation: 'add' | 'rm', id: string) {
    const favorites = new Set(getConfFavorIcons());
    if (operation === 'add') favorites.add(id);
    else favorites.delete(id);
    await setConf('favorIcons', [...favorites]);
  }
  public async show(options: ShowOptions) {
    try {
      await this._catalog.start();
      if (!this._catalog.snapshot) await this._ensureIcons(false);
    } catch (error) {
      console.error(error);
      void window.showErrorMessage(l10n.t('Could not load Iconify icons: {0}', String(error)));
      return;
    }
    if (this._disposed) return;
    if (this._panel) {
      this._pendingOptions = options;
      if (this._panel.visible && this._webviewReady) {
        if (await this._panel.webview.postMessage({ type: 'update:mode', ...options }))
          this._pendingOptions = undefined;
      }
      this._panel.reveal(this._panel.viewColumn);
    } else {
      const panel = window.createWebviewPanel(
        IconifySearchPanel.viewType,
        PanelTitle,
        window.activeTextEditor?.viewColumn || ViewColumn.One,
        { enableScripts: true },
      );
      this._panel = panel;
      this._webviewReady = false;
      panel.onDidDispose(
        () => {
          if (this._panel === panel) {
            this._panel = undefined;
            this._webviewReady = false;
            this._pendingOptions = undefined;
          }
          this._panelDisposables.splice(0).forEach((disposable) => disposable.dispose());
        },
        null,
        this._panelDisposables,
      );
      panel.iconPath = {
        dark: Uri.joinPath(this._extensionUri, 'resources', 'iconify.svg'),
        light: Uri.joinPath(this._extensionUri, 'resources', 'iconify.svg'),
      };
      panel.webview.html = this._getHtmlForWebview(panel.webview, options);
      panel.webview.onDidReceiveMessage(
        (message: Record<string, unknown>) => {
          if (!message || typeof message !== 'object') return;
          switch (message.type) {
            case 'load': {
              this._webviewReady = true;
              const pending = this._pendingOptions;
              this._pendingOptions = undefined;
              if (pending) void panel.webview.postMessage({ type: 'update:mode', ...pending });
              void this._sendCatalog().catch(console.error);
              break;
            }
            case 'icons:query':
              void this._queryIcons(panel, message);
              break;
            case 'insert':
              if (typeof message.code === 'string') void this._insertCode(message.code);
              break;
            case 'add-favor-icon':
            case 'rm-favor-icon':
              if (typeof message.id === 'string') {
                const id = message.id;
                const operation = message.type === 'add-favor-icon' ? 'add' : 'rm';
                this._settingsWrites = this._settingsWrites
                  .then(() => this._upFavorIcon(operation, id))
                  .catch(console.error);
              }
              break;
            case 'save:settings':
              if (message.data && typeof message.data === 'object') {
                const data = message.data;
                this._settingsWrites = this._settingsWrites
                  .then(() => this._saveSettings(data))
                  .catch(console.error);
              }
              break;
          }
        },
        null,
        this._panelDisposables,
      );
    }
    // The activation check may already be in flight; reuse it rather than download twice.
    void this._ensureIcons(true).catch(console.error);
  }
  private async _insertCode(code: string) {
    const tab = this._getIconifyTab();
    if (!tab) return;
    await window.tabGroups.close(tab);
    setTimeout(() => {
      const editor = window.activeTextEditor;
      if (editor) void editor.edit((builder) => builder.insert(editor.selection.start, code));
    }, 200);
  }
  public async dispose() {
    this._disposed = true;
    this._panel?.dispose();
    this._panel = undefined;
    this._panelDisposables.splice(0).forEach((disposable) => disposable.dispose());
    await this._catalog.dispose();
  }
  private _getHtmlForWebview(webview: Webview, options: ShowOptions) {
    const scriptUri = webview.asWebviewUri(
      Uri.joinPath(this._extensionUri, 'out', 'iconifyWebView.js'),
    );
    const styleUri = webview.asWebviewUri(
      Uri.joinPath(this._extensionUri, 'out', 'iconifyWebView.css'),
    );
    const nonce = getNonce();
    return replaceTpl(_tpl, {
      ...getWebviewResources({
        cspSource: webview.cspSource,
        nonce,
        scriptUri: scriptUri.toString(),
        styleUri: styleUri.toString(),
        devServerUrl: this._devServerUrl,
      }),
      initData: JSON.stringify({
        ...options,
        locale: env.language,
        favorTabs: getConfFavorTabs(),
        favorIcons: getConfFavorIcons(),
        favorGroup: getConf('favorGroup', ''),
        codeType: getConf('codeType', ''),
      }),
      nonce,
    });
  }
}
