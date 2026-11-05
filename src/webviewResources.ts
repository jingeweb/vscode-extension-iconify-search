interface WebviewResourceOptions {
  cspSource: string;
  nonce: string;
  scriptUri: string;
  styleUri: string;
  devServerUrl?: string;
}

export function getWebviewResources(options: WebviewResourceOptions) {
  const { cspSource, nonce, scriptUri, styleUri, devServerUrl } = options;
  const basePolicy = `default-src 'none'; img-src ${cspSource} data:;`;
  if (!devServerUrl) {
    return {
      contentSecurityPolicy: `${basePolicy} style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`,
      styles: `<link href="${styleUri}" rel="stylesheet" />`,
      scripts: `<script nonce="${nonce}" src="${scriptUri}"></script>`,
    };
  }

  const server = new URL(devServerUrl);
  if (server.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(server.hostname)) {
    throw new Error('The Webview development server must use HTTP on localhost');
  }
  const origin = server.origin;
  const websocketOrigin = origin.replace(/^http:/, 'ws:');
  return {
    contentSecurityPolicy: `${basePolicy} style-src ${cspSource} 'unsafe-inline' ${origin}; script-src 'nonce-${nonce}' ${origin}; connect-src ${origin} ${websocketOrigin};`,
    styles: '',
    // VS Code serves the HTML, so initialize Jinge's HMR runtime explicitly.
    scripts: `<script nonce="${nonce}" type="module" src="${origin}/@jinge-hmr-runtime"></script>
    <script nonce="${nonce}" type="module" src="${origin}/@vite/client"></script>
    <script nonce="${nonce}" type="module" src="${origin}/main.tsx"></script>`,
  };
}
