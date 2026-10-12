// After `npm run build`: the bundled engine loads and answers, as the deployed
// functions will call it (engine.ts). Prints what failed; CI runs it on Linux.
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
try {
  const {loadEngine, sessionStale} = require('../lib/engine.js');
  const e = loadEngine();
  if (!e.isStale(null, e.analysisVersion, e.blockVersions))
    throw new Error('an unstamped session should read stale');
  const stale = await sessionStale(
    {trackId: null, analysis: null},
    async () => null,
  );
  if (stale !== true)
    throw new Error(`sessionStale gave ${stale}, expected true`);
  console.log(
    `engine loads (analysis v${e.analysisVersion}); an unstamped session reads stale`,
  );
} catch (error) {
  console.error('engine smoke failed:', error);
  process.exit(1);
}
