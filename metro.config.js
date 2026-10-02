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

module.exports = config;
