<p align="right">
  <a href="./README_zh.md">简体中文</a>
</p>

<p align="center">
<a href="https://iconify.design">
<img src="https://github.com/YuhangGe/vscode-extension-iconify-search/blob/main/resources/logo.png?raw=true" alt="logo" width='128'/>
</a>
</p>

<p align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=geekabe.iconify-search" target="__blank"><img src="https://img.shields.io/visual-studio-marketplace/v/geekabe.iconify-search.svg?color=blue&amp;label=VS%20Code%20Marketplace&logo=visual-studio-code" alt="Visual Studio Marketplace Version" /></a>
<a href="https://marketplace.visualstudio.com/items?itemName=geekabe.iconify-search" target="__blank"><img src="https://img.shields.io/visual-studio-marketplace/d/geekabe.iconify-search.svg?color=4bdbe3" alt="Visual Studio Marketplace Downloads" /></a>
<a href="https://marketplace.visualstudio.com/items?itemName=geekabe.iconify-search" target="__blank"><img src="https://img.shields.io/visual-studio-marketplace/i/geekabe.iconify-search.svg?color=63ba83" alt="Visual Studio Marketplace Installs" /></a>
<br/>
<a href="https://github.com/YuhangGe/vscode-extension-iconify-search" target="__blank"><img src="https://img.shields.io/github/last-commit/YuhangGe/vscode-extension-iconify-search.svg?color=c977be" alt="GitHub last commit" /></a>
<a href="https://github.com/YuhangGe/vscode-extension-iconify-search/issues" target="__blank"><img src="https://img.shields.io/github/issues/YuhangGe/vscode-extension-iconify-search.svg?color=a38eed" alt="GitHub issues" /></a>
<a href="https://github.com/YuhangGe/vscode-extension-iconify-search" target="__blank"><img alt="GitHub stars" src="https://img.shields.io/github/stars/YuhangGe/vscode-extension-iconify-search?style=social"></a>
</p>

# Iconify Search

Search [Iconify](https://icon-sets.iconify.design/) icons directly in VSCode and insert the icons into the code editor.

## Usage

Requires VS Code 1.145 or newer for its built-in `node:sqlite`. No project dependency or separately installed Node.js is required.

After VS Code finishes starting, the extension checks npm and prepares icon data in the background, including on the next startup after an interrupted first download. Existing data is available immediately. The initial download notification shows percentage and downloaded/total MB when available, followed by database preparation progress. Simplified Chinese VS Code installations download from npmmirror; other languages download from npm.

Data is stored in global storage and reused across projects. SQLite indexes icon names and collections; independently compressed icons live in `icons.bin` and share a dictionary per collection. A Node Worker runs database queries and bounded concurrent compression/decompression. The gallery uses cursor pagination, loads more near the bottom, and evicts cached SVG pages by memory size while supporting scroll-back.

Updates are built as complete new generations. Once ready, open panels refresh against the new generation, preserving the search and selected category while resetting scrolling. Old files are removed after all extension windows release them. If an update fails, existing data remains available. Raw JSON is removed after successful conversion.

## Features

- View and search all Iconify icons.
- Favorite any icon and quickly view all favorite icons.
- Copy the icon's code to the clipboard.
- Insert the icon's code directly into the currently active text editor.

## Screenshots

#### View All Icons

<p align='center'>
  <img src="https://github.com/YuhangGe/vscode-extension-iconify-search/blob/main/resources/screenshots/view.gif?raw=true" alt='View All Icons'>
</p>

#### Search Icons

<p align='center'>
  <img src="https://github.com/YuhangGe/vscode-extension-iconify-search/blob/main/resources/screenshots/search.gif?raw=true" alt='Search Icons'>
</p>

#### Save to My Favorites

<p align='center'>
  <img src="https://github.com/YuhangGe/vscode-extension-iconify-search/blob/main/resources/screenshots/favor.gif?raw=true" alt="Favorite Icons">
</p>

#### Copy Icon Code to Clipboard

<p align='center'>
  <img src="https://github.com/YuhangGe/vscode-extension-iconify-search/blob/main/resources/screenshots/copy.gif?raw=true" alt='Copy Icon Code to Clipboard'>
</p>

#### Insert Icon Code to Text Editor

<p align='center'>
  <img src="https://github.com/YuhangGe/vscode-extension-iconify-search/blob/main/resources/screenshots/insert.gif?raw=true" alt='Insert Icon Code to Editor'>
</p>

#### User Friendly Settings

<p align='center'>
  <img src="https://github.com/YuhangGe/vscode-extension-iconify-search/blob/main/resources/screenshots/settings.gif?raw=true" alt='User Friendly Settings'>
</p>

## Development

Install dependencies with `pnpm install`, then press F5 and select **Run Extension (Webview HMR)**. VS Code automatically starts the extension build watcher and the Vite server at `http://127.0.0.1:5173`. Open Iconify in the Extension Development Host: Jinge component and CSS changes update through HMR. Changes to extension host code require restarting the debug session. Background development tasks keep running between sessions; stop them with **Tasks: Terminate Task** when finished.

Use **Run Extension (Production Build)** to build and debug the packaged assets without a development server. Published extensions always load the bundled assets.

The Webview uses Jinge 4.2 and `jinge-compiler`. UI components live in `src/iconifyWebView/components`; no React, Ant Design component library, or `jinge-antd` runtime dependency is required. Lists use Jinge's `KEY_DATA` keys to work with the Webview CSP without enabling `unsafe-eval`.

Run `pnpm test` with Node.js 24 or newer for database, update coordination, cache, resource loading and gallery layout tests. Run `pnpm test:webview` for browser tests covering search, favorites, copy/insert, settings, virtual scrolling, theme changes, HMR and production assets. Browser tests use an isolated source copy; they do not modify the working tree. They use installed Chrome when available, or Playwright Chromium (`pnpm exec playwright install chromium`). Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use a specific Chromium executable.
