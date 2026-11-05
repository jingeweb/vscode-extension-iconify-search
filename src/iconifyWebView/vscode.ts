// VS Code permits acquiring its API only once per Webview document.
export const vscode =
  (import.meta.hot?.data.vscode as ReturnType<typeof acquireVsCodeApi> | undefined) ??
  acquireVsCodeApi();

if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    data.vscode = vscode;
  });
}
