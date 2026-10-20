import { defineConfig } from 'vite';

const overpassProxy = {
  '/api/osm': {
    target: 'https://api.openstreetmap.org',
    changeOrigin: true,
    rewrite: (path) => path.replace('/api/osm', '/api/0.6'),
    proxyTimeout: 20000
  },
  '^/api/overpass$': {
    target: 'https://overpass-api.de',
    changeOrigin: true,
    rewrite: () => '/api/interpreter',
    configure: (proxy) => proxy.on('proxyReq', (request) => {
      request.setHeader('User-Agent', 'BMW-Earth-Drive/1.0 (local prototype)');
    })
  },
  '^/api/overpass/private$': {
    target: 'https://overpass.private.coffee',
    changeOrigin: true,
    rewrite: () => '/api/interpreter',
    configure: (proxy) => proxy.on('proxyReq', (request) => {
      request.setHeader('User-Agent', 'BMW-Earth-Drive/1.0 (local prototype)');
    })
  },
  '^/api/overpass/vk$': {
    target: 'https://maps.mail.ru',
    changeOrigin: true,
    rewrite: () => '/osm/tools/overpass/api/interpreter',
    configure: (proxy) => proxy.on('proxyReq', (request) => {
      request.setHeader('User-Agent', 'BMW-Earth-Drive/1.0 (local prototype)');
    })
  }
};

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: overpassProxy
  },
  preview: {
    proxy: overpassProxy
  }
});
