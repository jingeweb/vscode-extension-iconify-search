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

<p align="left">
  <a href="./README.md">English</a>
</p>

# Iconify Search

在 VSCode 中直接搜索 [Iconify](https://icon-sets.iconify.design/) 图标，并可将图标插入到代码编辑器中。

## 使用方法

需要 VS Code 1.145 或更新版本。

1. 打开 VS Code 的**扩展**面板（Windows/Linux：`Ctrl+Shift+X`，macOS：`Cmd+Shift+X`）。
2. 搜索 **Iconify Search**，找到发布者为 **geekabe** 的插件，点击**安装**。也可以从 [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=geekabe.iconify-search) 安装。
3. 打开命令面板（Windows/Linux：`Ctrl+Shift+P`，macOS：`Cmd+Shift+P`），搜索 **Iconify**，选择查看全部图标、搜索图标或查看收藏图标。
4. 点击图标可复制代码，也可以在图标详情中点击**插入图标**，将代码插入当前编辑器。

安装后会自动准备图标数据，首次使用请等待下载和准备完成。无需在项目中安装依赖。

## 功能

- 查看和搜索所有 Iconify 图标。
- 收藏任何图标，并可以快捷查看所有收藏图标。
- 将图标的代码拷贝到剪切板。
- 直接将图标的代码插入到当前激活的文本编辑器。

## 录屏示例

#### 查看全部图标

<p align='center'>
  <img src="https://github.com/YuhangGe/vscode-extension-iconify-search/blob/main/resources/screenshots/view.gif?raw=true" alt='查看全部图标'>
</p>

#### 搜索图标

<p align='center'>
  <img src="https://github.com/YuhangGe/vscode-extension-iconify-search/blob/main/resources/screenshots/search.gif?raw=true" alt='搜索图标'>
</p>

#### 收藏图标

<p align='center'>
  <img src="https://github.com/YuhangGe/vscode-extension-iconify-search/blob/main/resources/screenshots/favor.gif?raw=true" alt="收藏图标">
</p>

#### 复制图标代码到剪贴板

<p align='center'>
  <img src="https://github.com/YuhangGe/vscode-extension-iconify-search/blob/main/resources/screenshots/copy.gif?raw=true" alt='复制图标代码到剪贴板'>
</p>

#### 插入图标代码到文本

<p align='center'>
  <img src="https://github.com/YuhangGe/vscode-extension-iconify-search/blob/main/resources/screenshots/insert.gif?raw=true" alt='插入图标代码到文本'>
</p>

#### 便捷配置

<p align='center'>
  <img src="https://github.com/YuhangGe/vscode-extension-iconify-search/blob/main/resources/screenshots/settings.gif?raw=true" alt='便捷配置'>
</p>

## 开发调试

运行 `pnpm install` 后，按 F5 选择 **Run Extension (Webview HMR)**。VS Code 会自动启动扩展编译监听和 Vite 服务（`http://127.0.0.1:5173`）。在扩展开发窗口打开 Iconify 后，修改 Jinge 组件和 CSS 即可热更新；修改扩展主进程代码后需要重启调试。后台开发任务会跨调试会话运行，结束开发时可通过 **Tasks: Terminate Task** 停止。

选择 **Run Extension (Production Build)** 可自动构建并调试打包资源。发布后的扩展始终加载打包资源。

Webview 使用 Jinge 4.2 和 `jinge-compiler`。必要的 UI 组件实现在 `src/iconifyWebView/components`，不依赖 React、Ant Design 组件库或 `jinge-antd`。列表使用 Jinge 的 `KEY_DATA`，兼容 Webview CSP，无需开启 `unsafe-eval`。

使用 Node.js 24 或更新版本运行 `pnpm test`，覆盖数据库、更新协调、缓存、资源加载和虚拟列表布局；`pnpm test:webview` 运行浏览器交互、HMR 和生产构建测试。浏览器测试使用独立的源码副本，不修改工作区，优先使用已安装的 Chrome，也支持 Playwright Chromium（`pnpm exec playwright install chromium`）或通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定浏览器。

### 数据存储与更新原理

需要 VS Code 1.145 或更新版本，以使用其内置的 `node:sqlite`。无需在项目中安装依赖，也无需单独安装 Node.js。

VS Code 启动完成后，插件会自动从 npm 检查版本并准备数据；首次下载未完成时，后续启动会重新尝试。已有缓存时立即可用。首次下载显示百分比和已下载/总 MB（服务器未提供大小时仅显示已下载量），随后显示数据库准备进度。简体中文环境从 npmmirror 下载，其它语言从 npm 下载。

数据保存在扩展全局存储中，跨项目复用。SQLite 存储图标名称、分类和搜索索引，图标逐个压缩后存入独立的 `icons.bin`，同一图标集共享压缩字典。数据库和压缩处理在 Worker 中执行，压缩解压使用有并发上限的 Node 原生异步 API。界面按游标分页，滚动接近底部时加载更多；图标页面缓存按内存大小淘汰，往回滚动时按需重读。

更新时完整生成新版本，准备好后自动刷新已打开的界面，保留搜索词和分类，重置滚动位置。各窗口释放旧版本后删除旧文件；更新失败继续使用已有数据。转换成功后清理原始 JSON。
