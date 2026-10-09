const fs = require('fs');
const path = require('path');
const {getDefaultConfig} = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The transform cache is shared by every checkout on this PC, and its key does
// not hold the project root, yet expo-router inlines the app folder's path
// relative to that root (EXPO_ROUTER_APP_ROOT in its _ctx module). One
// checkout's cached _ctx then points another at a folder that is not its own:
// a worktree served "Welcome to Expo" with paddock-compare's app path baked in
// (pit-wall thread 1 #3256). Each root keys its own cache.
config.cacheVersion = `${config.cacheVersion ?? ''}:${__dirname}`;

// Seats work in worktrees under <repo>/.claude/worktrees. From the main
// checkout, Metro would crawl every one of them (a full copy of src each), and
// `live-N` never finishes starting. Only a worktrees folder inside this
// project root is blocked, so a slot served from a worktree sees its own files.
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const worktrees = path
  .join(__dirname, '.claude', 'worktrees')
  .split(/[\\/]/)
  .map(escapeRe)
  .join('[\\\\/]')
  // A drive letter comes in either case. No `i` flag: Metro refuses to combine
  // ignore patterns whose flags differ.
  .replace(/^([A-Za-z]):/, (_, d) => `[${d.toLowerCase()}${d.toUpperCase()}]:`);
const blocked = new RegExp(`^${worktrees}[\\\\/].*`);
const current = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(current) ? current : current ? [current] : []),
  blocked,
];

// In a worktree, packages come from the main checkout's node_modules: the
// worktree has none (tools/dev/liveSlots.mjs checks the lockfile first).
// Metro needs main in watchFolders and its node_modules on the resolver path.
// Main's other worktrees stay blocked; this one stays open.
const worktreesDir = path.dirname(__dirname);
const mainRoot =
  path.basename(worktreesDir) === 'worktrees' &&
  path.basename(path.dirname(worktreesDir)) === '.claude'
    ? path.dirname(path.dirname(worktreesDir))
    : null;
if (mainRoot) {
  const mainWorktrees = path
    .join(mainRoot, '.claude', 'worktrees')
    .split(/[\\/]/)
    .map(escapeRe)
    .join('[\\\\/]')
    .replace(
      /^([A-Za-z]):/,
      (_, d) => `[${d.toLowerCase()}${d.toUpperCase()}]:`,
    );
  const own = escapeRe(path.basename(__dirname));
  config.resolver.blockList = [
    ...config.resolver.blockList,
    new RegExp(`^${mainWorktrees}[\\\\/](?!${own}(?:[\\\\/]|$)).*`),
  ];
  config.watchFolders = [...(config.watchFolders ?? []), mainRoot];
  config.resolver.nodeModulesPaths = [
    ...(config.resolver.nodeModulesPaths ?? []),
    path.join(mainRoot, 'node_modules'),
  ];
  // The bundle's entry is asked for as a path under this root
  // ('./node_modules/expo-router/entry', from package.json's "main"), not as a
  // package, so nodeModulesPaths never sees it and the page's script 404s
  // (pit-wall thread 1 #3256). Without a node_modules of its own, such a path
  // is answered from the main checkout's.
  const ownModules = path.join(__dirname, 'node_modules');
  if (!fs.existsSync(ownModules)) {
    const mainModules = path.join(mainRoot, 'node_modules');
    const upstream = config.resolver.resolveRequest;
    config.resolver.resolveRequest = (context, moduleName, platform) => {
      const under = moduleName.match(/^\.[\\/]node_modules[\\/](.+)$/);
      const name = under ? path.join(mainModules, under[1]) : moduleName;
      return upstream
        ? upstream(context, name, platform)
        : context.resolveRequest(context, name, platform);
    };
  }
}

// Only live.mjs sets this: a live slot signs its pane in as seat-test
// (tools/dev/seatToken.mjs). A plain `expo start` or an export has no endpoint.
const seatPort = process.env.LIVE_SEAT_SIGNIN_PORT;
if (seatPort) {
  const {seatTokenMiddleware} = require('./tools/dev/seatToken.mjs');
  const handler = seatTokenMiddleware({port: seatPort});
  const enhance = config.server.enhanceMiddleware;
  config.server.enhanceMiddleware = (middleware, server) => {
    const inner = enhance ? enhance(middleware, server) : middleware;
    return (req, res, next) => handler(req, res, () => inner(req, res, next));
  };
}

module.exports = config;
