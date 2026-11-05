import tailwindcss from '@tailwindcss/vite';
import { jingeVitePlugin } from 'jinge-compiler';
import path from 'path';
import { defineConfig } from 'vite';

const __dirname = import.meta.dirname;
const view = process.argv[6] ?? 'iconify';
const watch = process.argv.includes('--watch');
const devServerOrigin = 'http://127.0.0.1:5173';

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [jingeVitePlugin(), tailwindcss()],
  resolve: {
    tsconfigPaths: true,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(
      command === 'serve' || watch ? 'development' : 'production',
    ),
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    origin: devServerOrigin,
    cors: {
      origin: [
        /^vscode-webview:\/\//,
        /^https:\/\/[a-z0-9-]+\.vscode-(?:cdn|webview)\.net$/,
        devServerOrigin,
      ],
    },
    ws: { protocol: 'ws', host: '127.0.0.1' },
  },
  root: path.resolve(__dirname, '../src/iconifyWebView'),
  build: {
    watch: watch ? {} : undefined,
    minify: watch ? false : true,

    outDir: path.resolve(__dirname, '../out'),
    emptyOutDir: false,
    sourcemap: watch ? true : false,
    lib: {
      name: `${view}WebView`,
      entry: {
        [`${view}WebView`]: path.resolve(__dirname, `../src/${view}WebView/main.tsx`),
      },
      formats: ['iife'],
      fileName: () => `${view}WebView.js`,
    },
    rollupOptions: {
      output: {
        assetFileNames(chunkInfo) {
          const source = chunkInfo.originalFileNames?.[0] ?? chunkInfo.name;
          if (source.endsWith('.css')) return `${view}WebView.css`;
          return `${view}WebView${path.extname(source)}`;
        },
      },
    },
  },
}));
