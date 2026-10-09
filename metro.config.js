const path = require('path');
const {getDefaultConfig} = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

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
    .replace(/^([A-Za-z]):/, (_, d) => `[${d.toLowerCase()}${d.toUpperCase()}]:`);
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
