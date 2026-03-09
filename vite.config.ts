import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest.json';

export default defineConfig({
    root: 'src',
    plugins: [crx({ manifest })],
    build: {
        outDir: '../dist',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                // Đảm bảo các file này được đưa vào bundle
                options: 'src/options.html',
                popup: 'src/popup.html',
                privacy: 'src/privacy.html',
            },
        },
    },
    // Copy style.css vào dist
    publicDir: 'public',
});
