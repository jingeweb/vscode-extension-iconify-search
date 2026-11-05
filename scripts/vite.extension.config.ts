import { builtinModules } from 'module';
import path from 'path';
import { defineConfig } from 'vite';

const __dirname = import.meta.dirname;
const watch = process.argv.includes('--watch');

// https://vitejs.dev/config/
export default defineConfig({
  plugins: watch
    ? [
        {
          name: 'iconify-extension-ready',
          writeBundle() {
            console.log('ICONIFY_EXTENSION_READY');
          },
        },
      ]
    : [],
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    watch: watch ? {} : undefined,
    minify: watch ? false : true,
    outDir: path.resolve(__dirname, '../out'),
    emptyOutDir: false,
    sourcemap: watch ? true : false,
    lib: {
      fileName: (_format, entryName) => `${entryName}.cjs`,
      entry: {
        extension: path.resolve(__dirname, '../src/extension.ts'),
        iconifyDatabaseWorker: path.resolve(__dirname, '../src/iconifyDatabaseWorker.ts'),
      },
      formats: ['cjs'],
    },
    rollupOptions: {
      external: ['vscode', /^node:/, ...builtinModules],
    },
  },
});
