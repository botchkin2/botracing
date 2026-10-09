// The curator's command (pit wall thread 2 #204 to #210):
//
//   node tools/curate/curate.mjs sessions [--folder F] [--track <trackId>]
//   node tools/curate/curate.mjs show <trackId>
//   node tools/curate/curate.mjs history <trackId>
//   node tools/curate/curate.mjs plan-add <trackId> --session <id>
//   node tools/curate/curate.mjs plan-replace <trackId> --session <id> [--allow-renumber]
//   node tools/curate/curate.mjs plan-refold <trackId> --sessions <id,id,...>
//   node tools/curate/curate.mjs plan-undo <trackId> [--to-rev N]
//
// Every plan command is a dry run: it prints the plan and writes nothing. Add
// `--apply --reason "why"` to write it (needs Admin credentials today:
// `gcloud auth application-default login`). `--by <name>` (or LAP_CURATOR) is
// who is recorded. Reading local sessions needs `--owner <uid>` (or LAP_OWNER).
// Neither has a default.
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PlanRefused, applyPlan} from './apply.mjs';
import {describeMap} from './diff.mjs';
import {
  LoaderError,
  buildFromSession,
  buildRefold,
  describeSession,
  findSessions,
  pickSession,
} from './loader.mjs';
import {
  planAdd,
  planRefold,
  planReplace,
  planUndo,
  renderPlan,
} from './plan.mjs';

const PLANS = ['plan-add', 'plan-replace', 'plan-refold', 'plan-undo'];
const VALUED = new Set([
  '--session',
  '--sessions',
  '--folder',
  '--track',
  '--reason',
  '--by',
  '--to-rev',
  '--owner',
  '--work',
]);

/** {_: positional args, flags: {name: value | true}} */
export function parseArgs(argv) {
  const out = {_: [], flags: {}};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) out._.push(a);
    else if (VALUED.has(a)) {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      out.flags[a.slice(2)] = argv[++i];
    } else out.flags[a.slice(2)] = true;
  }
  return out;
}

/** The track id a session belongs to, as the uploader names it. */
const trackIdOf = (adapter, sim, layout) => `${sim}-${adapter.slug(layout)}`;

/**
 * Runs one command. deps: {backend, adapter, folder, ownerId, workDir, by, now,
 * loader (stand-ins for the tests)}. Returns {code, lines}; prints nothing.
 */
export async function run(argv, deps) {
  const {_, flags} = parseArgs(argv);
  const [cmd, trackId] = _;
  const lines = [];
  const say = line => lines.push(line);
  const {backend, adapter} = deps;
  const loader = {buildFromSession, buildRefold, findSessions, ...deps.loader};
  const sessionsHere = () => {
    const ownerId = flags.owner ?? deps.ownerId;
    if (!ownerId)
      throw new LoaderError(
        'an owner is required: --owner <uid> or LAP_OWNER. There is no default.',
      );
    return loader.findSessions({
      adapter,
      folder: flags.folder ?? deps.folder,
      ownerId,
      log: say,
    });
  };
  try {
    if (cmd === 'sessions') {
      for (const s of sessionsHere()) {
        const d = describeSession(s);
        const id = trackIdOf(adapter, d.sim, d.layout);
        if (flags.track && id !== flags.track) continue;
        say(
          `${d.id}  ${d.at.slice(0, 16)}  ${d.layout}  ${d.car}  ${
            d.sessionType
          }  ${d.recordings} file(s)  [${id}]`,
        );
      }
      return {code: 0, lines};
    }
    if (![...PLANS, 'show', 'history'].includes(cmd) || !trackId) {
      say(
        'usage: curate <sessions | show | history | plan-add | plan-replace | plan-refold | plan-undo> <trackId> [options]',
      );
      return {code: 2, lines};
    }
    const current = await backend.readCatalog(trackId);
    if (cmd === 'show') {
      const curated = Boolean(current.track?.corners?.length);
      say(
        `${trackId}: catalogRev ${current.catalogRev}, ${
          curated ? 'curated' : 'no map'
        }`,
      );
      for (const l of describeMap(curated ? current.track : null))
        say(`  ${l}`);
      say(
        `  ${await backend.sessionCount(trackId)} session(s) across all users`,
      );
      return {code: 0, lines};
    }
    if (cmd === 'history') {
      const history = await backend.readHistory(trackId);
      if (!history.size) say(`${trackId}: no history`);
      for (const rev of [...history.keys()].sort((a, b) => a - b)) {
        const h = history.get(rev);
        say(
          `rev ${rev} replaced ${h.at} by ${h.by} (${h.kind}): ${h.reason} | ${h.summary}`,
        );
      }
      return {code: 0, lines};
    }

    const blast = {sessions: await backend.sessionCount(trackId)};
    const samples = await backend.sessionLengths(trackId);
    const {workDir} = deps;
    const onThisTrack = built => {
      const id = trackIdOf(adapter, built.sim, built.track.variant);
      if (id !== trackId)
        throw new LoaderError(`that session is on ${id}, not ${trackId}`);
    };
    let plan;
    if (cmd === 'plan-add' || cmd === 'plan-replace') {
      if (!flags.session)
        throw new LoaderError(
          `${cmd} needs --session <id> (curate sessions lists them)`,
        );
      const session = pickSession(sessionsHere(), flags.session);
      const built = loader.buildFromSession({adapter, session, workDir});
      onThisTrack(built);
      plan =
        cmd === 'plan-add'
          ? planAdd({trackId, current, built, samples, blast})
          : planReplace({
              trackId,
              current,
              built,
              samples,
              blast,
              allowRenumber: Boolean(flags['allow-renumber']),
            });
    } else if (cmd === 'plan-refold') {
      if (!flags.sessions)
        throw new LoaderError('plan-refold needs --sessions <id,id,...>');
      const all = sessionsHere();
      const chosen = flags.sessions
        .split(',')
        .map(id => pickSession(all, id.trim()));
      const built = loader.buildRefold({
        adapter,
        sessions: chosen,
        current,
        workDir,
      });
      onThisTrack(built);
      plan = planRefold({trackId, current, built, blast});
    } else {
      const toRev =
        flags['to-rev'] === undefined ? undefined : Number(flags['to-rev']);
      if (toRev !== undefined && !Number.isInteger(toRev))
        throw new LoaderError('--to-rev must be a whole number');
      plan = planUndo({
        trackId,
        current,
        history: await backend.readHistory(trackId),
        toRev,
        blast,
      });
    }

    for (const l of renderPlan(plan)) say(l);
    if (!flags.apply) {
      say('');
      say(
        plan.refusals.length
          ? 'DRY RUN. Refused: nothing can be applied.'
          : 'DRY RUN: nothing written. Add --apply --reason "why" to write it.',
      );
      return {code: plan.refusals.length ? 1 : 0, lines};
    }
    const by = typeof flags.by === 'string' ? flags.by : deps.by;
    if (!by)
      throw new LoaderError(
        'a curator name is required: --by <name> or LAP_CURATOR.',
      );
    const out = await applyPlan(backend, plan, {
      reason: typeof flags.reason === 'string' ? flags.reason : '',
      by,
      now: deps.now,
    });
    say(
      `APPLIED: ${trackId} is now at catalogRev ${out.rev}.${
        out.regenerated
          ? ''
          : ' The catalog file was not regenerated (none is wired up yet).'
      }`,
    );
    return {code: 0, lines};
  } catch (error) {
    if (error instanceof PlanRefused || error instanceof LoaderError) {
      say(`REFUSED: ${error.message}`);
      return {code: 1, lines};
    }
    throw error;
  }
}

// -- as a command ----------------------------------------------------------------------

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const {connect} = await import('../sessions/store.mjs');
  const lmu = await import('../sessions/lmu.mjs');
  const {createRequire} = await import('node:module');
  const {adminBackend} = await import('./adminBackend.mjs');
  const here = fileURLToPath(new URL('.', import.meta.url));
  const admin = createRequire(resolve(here, '../../functions/package.json'))(
    'firebase-admin',
  );
  const argv = process.argv.slice(2);
  const {flags} = parseArgs(argv);
  const {db} = connect();
  const result = await run(argv, {
    backend: adminBackend({db, FieldValue: admin.firestore.FieldValue}),
    adapter: lmu,
    folder: process.env.LMU_TELEMETRY || lmu.defaultFolder,
    ownerId: process.env.LAP_OWNER,
    workDir:
      typeof flags.work === 'string'
        ? flags.work
        : resolve(tmpdir(), 'curate-work'),
    by: process.env.LAP_CURATOR,
    now: () => new Date().toISOString(),
  });
  console.log(result.lines.join('\n'));
  process.exit(result.code);
}
