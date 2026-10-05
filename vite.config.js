import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Empty prefix = also read plain process.env values (used by the GitHub Actions build).
  const env = loadEnv(mode, process.cwd(), '');

  return {
    // GitHub Pages project sites live under /<repo-name>/ (must end with a slash).
    base: env.VITE_BASE_PATH || '/',
    plugins: [react()],
    base: '/raihan/'
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
  };
});
)