import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@thortiq/client-core': path.resolve(__dirname, '../..', 'packages/client-core/src')
    }
  }
});
