import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

function excludeDevGalleryInProd(): Plugin {
  const virtualId = '\0virtual:empty-dev-gallery';
  return {
    name: 'harbouros-exclude-dev-gallery',
    enforce: 'pre',
    apply: 'build',
    resolveId(source) {
      if (source.includes('DesignSystemGalleryScreen')) {
        return virtualId;
      }
      return null;
    },
    load(id) {
      if (id === virtualId) {
        return 'export const DesignSystemGalleryScreen = () => null;';
      }
      return null;
    },
  };
}

export default defineConfig(({ command }) => {
  return {
    plugins: [excludeDevGalleryInProd(), react(), tailwindcss()],
    ...(command === 'build'
      ? {
          define: {
            'process.env.NODE_ENV': JSON.stringify('production'),
          },
        }
      : {}),
    resolve: {
      alias: {
        '@shared': path.resolve(import.meta.dirname, './src/shared'),
        '@server': path.resolve(import.meta.dirname, './src/server'),
        '@web': path.resolve(import.meta.dirname, './src/web'),
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      rolldownOptions: {
        output: {
          manualChunks(id: string) {
            if (
              id.includes('node_modules/d3-') ||
              id.includes('node_modules/victory-vendor') ||
              id.includes('node_modules/internmap') ||
              id.includes('node_modules/decimal.js-light')
            ) {
              return 'vendor-d3';
            }
            if (
              id.includes('node_modules/@reduxjs') ||
              id.includes('node_modules/react-redux') ||
              id.includes('node_modules/use-sync-external-store') ||
              id.includes('node_modules/immer') ||
              id.includes('node_modules/reselect') ||
              id.includes('node_modules/es-toolkit') ||
              id.includes('node_modules/react-smooth') ||
              id.includes('node_modules/react-transition-group') ||
              id.includes('node_modules/prop-types') ||
              id.includes('node_modules/react-is') ||
              id.includes('node_modules/eventemitter3') ||
              id.includes('node_modules/clsx') ||
              id.includes('node_modules/tiny-invariant')
            ) {
              return 'vendor-chart-support';
            }
            if (id.includes('node_modules/recharts')) {
              return 'vendor-recharts';
            }
            if (id.includes('node_modules/lucide-react')) {
              return 'vendor-icons';
            }
            if (id.includes('node_modules/zod')) {
              return 'vendor-zod';
            }
            if (
              id.includes('node_modules/react/') ||
              id.includes('node_modules/scheduler/')
            ) {
              return 'vendor-react-core';
            }
            if (id.includes('node_modules/react-dom/')) {
              return 'vendor-react-dom';
            }
            return undefined;
          },
        },
      },
    },
  };
});
