// Bundles the app's stages file with the player, using Vite over the app's own node_modules,
// PostCSS config and tsconfig paths. There is no app dev server to start and no login to script.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, ViteDevServer } from 'vite';
import type { ResolvedConfig } from '../config/config.ts';

const ENTRY = 'virtual:tourwright/entry';
export const PLAYER_PATH = '/__tourwright/';

// When running from source the runtime is TypeScript that Vite compiles; when installed it is the
// compiled JavaScript in dist. Either way it is compiled by the app's Vite with the app's React.
const here = fileURLToPath(import.meta.url);
const fromSource = here.endsWith('.ts');
const runtimeDir = join(dirname(here), '..', 'runtime');
const packageRoot = join(dirname(here), '..', '..');

function runtimeFile(name: string, jsx = false): string {
  return join(runtimeDir, fromSource ? `${name}.${jsx ? 'tsx' : 'ts'}` : `${name}.js`);
}

const NEXT_SHIMS: Record<string, [file: string, jsx: boolean]> = {
  'next/link': ['shims/next/link', true],
  'next/image': ['shims/next/image', true],
  'next/navigation': ['shims/next/navigation', false],
  'next/router': ['shims/next/router', false],
  'next/head': ['shims/next/head', true],
  'next/dynamic': ['shims/next/dynamic', true],
};

export interface StageServer {
  url: string;
  vite: ViteDevServer;
  close(): Promise<void>;
}

export class StagesMissingError extends Error {}

export async function startStageServer(config: ResolvedConfig): Promise<StageServer> {
  if (!existsSync(config.stages)) {
    throw new StagesMissingError(`The stages file ${config.stages} does not exist.\nFix: run "npx tourwright init" to create one, or set "stages" in the tourwright config.`);
  }
  const vite = await import('vite');
  const posix = (path: string) => vite.normalizePath(path);

  const aliases = [{ find: /^tourwright\/stage$/, replacement: posix(runtimeFile('stage')) }];
  const define: Record<string, string> = {};
  if (config.preset === 'next') {
    for (const [module, [file, jsx]] of Object.entries(NEXT_SHIMS)) {
      aliases.push({ find: new RegExp(`^${module.replace('/', '\\/')}$`), replacement: posix(runtimeFile(file, jsx)) });
    }
    // Next inlines NEXT_PUBLIC_ variables into client code; do the same.
    for (const [key, value] of Object.entries(vite.loadEnv('development', config.root, 'NEXT_PUBLIC_'))) {
      define[`process.env.${key}`] = JSON.stringify(value);
    }
    define['process.env.NODE_ENV'] = JSON.stringify('development');
  }

  const plugin: Plugin = {
    name: 'tourwright',
    resolveId(id) {
      return id === ENTRY ? `\0${ENTRY}` : undefined;
    },
    load(id) {
      if (id !== `\0${ENTRY}`) return undefined;
      return [
        `import stages from ${JSON.stringify(posix(config.stages))};`,
        `import { mountPlayer } from ${JSON.stringify(posix(runtimeFile('player', true)))};`,
        `if (!stages || typeof stages !== 'object') throw new Error('The stages file must default-export defineStages({ ... }).');`,
        `mountPlayer(stages);`,
      ].join('\n');
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== PLAYER_PATH) return next();
        const html = await server.transformIndexHtml(
          PLAYER_PATH,
          `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Tourwright player</title>
    <style>html, body { margin: 0; padding: 0; overflow: hidden; background: #fff; } * { caret-color: transparent !important; }</style>
  </head>
  <body>
    <div id="tourwright-root"></div>
    <script type="module" src="/@id/__x00__${ENTRY}"></script>
  </body>
</html>`,
        );
        res.setHeader('Content-Type', 'text/html');
        res.end(html);
      });
    },
  };

  const server = await vite.createServer({
    root: config.root,
    // A plain Vite React app keeps its own config (plugins, aliases); a Next app has none to load.
    configFile: config.preset === 'vite-react' ? undefined : false,
    appType: 'custom',
    logLevel: 'error',
    clearScreen: false,
    cacheDir: join(config.out, '.cache', 'vite'),
    plugins: [plugin],
    define,
    resolve: { alias: aliases, dedupe: ['react', 'react-dom'], tsconfigPaths: true },
    oxc: { jsx: { runtime: 'automatic' } },
    optimizeDeps: {
      entries: [posix(config.stages)],
      include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client'],
    },
    server: {
      host: '127.0.0.1',
      port: 0,
      // The Vite client loads anyway (CSS is injected through it), so let its websocket connect
      // rather than log errors. With no file watcher it never reloads the page.
      watch: null,
      // Browser errors are collected and reported by verify and render, not echoed to the terminal.
      forwardConsole: false,
      fs: { allow: [vite.searchForWorkspaceRoot(config.root), packageRoot] },
    },
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) {
    await server.close();
    throw new Error('The stage server started but reported no address.');
  }
  return { url: new URL(PLAYER_PATH, url).href, vite: server, close: () => server.close() };
}
