import { defineConfig } from 'vite';

export default defineConfig({
    base: './', // Ensures relative paths in the build output
    build: {
        outDir: 'dist',
        assetsDir: 'assets',
    }
});
