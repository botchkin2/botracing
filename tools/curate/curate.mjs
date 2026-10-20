// The curator's command (pit wall thread 2 #204 to #210):
//
//   node tools/curate/curate.mjs sessions [--folder F] [--track <trackId>]
//   node tools/curate/curate.mjs show <trackId>
//   node tools/curate/curate.mjs history <trackId>
//   node tools/curate/curate.mjs plan-add <trackId> --session <id>
//   node tools/curate/curate.mjs plan-replace <trackId> --session <id> [--allow-renumber]
//   node tools/curate/curate.mjs plan-refold <trackId> --sessions <id,id,...>
//   node tools/curate/curate.mjs plan-undo <trackId> [--to-rev N]
//   node tools/curate/curate.mjs plan-elevation <trackId> --session <id> --capture <dir>
//   node tools/curate/curate.mjs plan-bank <trackId> --session <id> --capture <dir>
//
// Every plan command is a dry run: it prints the plan and writes nothing. Add
// `--apply --reason "why"` to write it (needs Admin credentials today:
// `gcloud auth application-default login`). `--by <name>` (or LAP_CURATOR) is
// who is recorded. Reading local sessions needs `--owner <uid>` (or LAP_OWNER).
// Neither has a default. `--sim iracing` reads iRacing's .ibt folder (default
// lmu); iRacing's Lat/Lon is real GPS, so the same fit makes its corner map.
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {adapter as simAdapter, telemetryFolder} from '../sessions/sims.mjs';
import {PlanRefused, applyPlan} from './apply.mjs';
import {describeMap} from './diff.mjs';
import {
  checkLapDurations,
  elevationFromLaps,
  keepMeasuredLaps,
  readCaptureLaps,
} from './elevation.mjs';
import {bankFromLaps, readCaptureAttitude} from './bank.mjs';
import {
  LoaderError,
  buildFromSession,
  buildRefold,
  describeSession,
  findSessions,
  measuredLapNumbers,
  pickSession,
} from './loader.mjs';
import {
  planAdd,
  planElevation,
  planBank,
  planRefold,
  planReplace,
  planUndo,
  renderPlan,
} from './plan.mjs';

const PLANS = [
  'plan-add',
  'plan-replace',
  'plan-refold',
  'plan-undo',
  'plan-elevation',
  'plan-bank',
];
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
  '--sim',
  '--capture',
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

/**
 * The sim's adapter and telemetry folder for `--sim` (default lmu): the
 * uploader's own table (sims.mjs), so the curator reads a folder exactly as the
 * sync does. `--folder` still wins over the default folder.
 */
export function simOf(flags, env = process.env) {
  const id = typeof flags.sim === 'string' ? flags.sim : 'lmu';
  return {adapter: simAdapter(id), folder: telemetryFolder(id, env)};
}

/** The track id a session belongs to, as the uploader names it. */
const trackIdOf = (adapter, sim, layout) => `${sim}-${adapter.slug(layout)}`;

/**
 * Runs one command. deps: {backend, adapter, folder, ownerId or ownerIds, workDir, by, now,
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
    const fromFlag =
      typeof flags.owners === 'string'
        ? flags.owners
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
        : [];
    const ownerIds = fromFlag.length
      ? fromFlag
      : flags.owner
      ? [flags.owner]
      : deps.ownerIds ?? (deps.ownerId ? [deps.ownerId] : []);
    return loader.findSessions({
      adapter,
      folder: flags.folder ?? deps.folder,
      ownerIds,
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
        'usage: curate <sessions | show | history | plan-add | plan-replace | plan-refold | plan-undo | plan-elevation | plan-bank> <trackId> [options]',
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
      if (current.track?.elevation?.heightM)
        say(
          `  elevation: ${current.track.elevation.heightM.length} heights, step ${current.track.elevation.stepM} m`,
        );
      if (current.track?.bank?.rollDeg)
        say(
          `  bank: ${current.track.bank.rollDeg.length} rolls, step ${current.track.bank.stepM} m`,
        );
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
    if (cmd === 'plan-elevation') {
      if (!flags.capture || !flags.session)
        throw new LoaderError(
          'plan-elevation needs --session <id> and --capture <dir>',
        );
      const session = pickSession(sessionsHere(), flags.session);
      const sessionLaps = measuredLapNumbers({adapter, session, workDir});
      const picked = keepMeasuredLaps(
        readCaptureLaps(flags.capture),
        sessionLaps,
      );
      const built = elevationFromLaps(picked.laps, current.track?.lengthM);
      const timing = checkLapDurations(picked.laps, sessionLaps);
      if (timing.refusals.length) {
        built.elevation = null;
        built.refusals.push(...timing.refusals);
      }
      built.stats = {
        ...built.stats,
        droppedInLaps: picked.dropped,
        matched: timing.matched,
        checked: timing.checked,
      };
      plan = planElevation({trackId, current, built, blast});
    } else if (cmd === 'plan-bank') {
      if (!flags.capture || !flags.session)
        throw new LoaderError('plan-bank needs --session <id> and --capture <dir>');
      const session = pickSession(sessionsHere(), flags.session);
      const sessionLaps = measuredLapNumbers({adapter, session, workDir});
      const picked = keepMeasuredLaps(
        readCaptureAttitude(flags.capture),
        sessionLaps,
      );
      const built = bankFromLaps(picked.laps, current.track?.lengthM);
      const timing = checkLapDurations(picked.laps, sessionLaps);
      if (timing.refusals.length) {
        built.bank = null;
        built.refusals.push(...timing.refusals);
      }
      built.stats = {
        ...built.stats,
        droppedInLaps: picked.dropped,
        matched: timing.matched,
        checked: timing.checked,
      };
      plan = planBank({trackId, current, built, blast});
    } else if (cmd === 'plan-add' || cmd === 'plan-replace') {
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
  const {createRequire} = await import('node:module');
  const {adminBackend} = await import('./adminBackend.mjs');
  const here = fileURLToPath(new URL('.', import.meta.url));
  const admin = createRequire(resolve(here, '../../functions/package.json'))(
    'firebase-admin',
  );
  const argv = process.argv.slice(2);
  const {flags} = parseArgs(argv);
  const {db} = connect();
  const {adapter, folder} = simOf(flags);
  const result = await run(argv, {
    backend: adminBackend({db, FieldValue: admin.firestore.FieldValue}),
    adapter,
    folder,
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
