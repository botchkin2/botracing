// Turns on the alerting (see lib.mjs for what and why).
//
//   node ops/alerts/enable.mjs --email you@example.com            dry run
//   node ops/alerts/enable.mjs --email you@example.com --apply    creates what is missing
//   options: --budget <usd>  --host <hostname>  --skip-budget
//
// Safe to re-run: anything already there (matched by name) is left alone.
// Needs `gcloud auth login` as an owner of the project. A part whose current
// state cannot be read is reported and nothing is created for it.
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {
  CONFIG,
  channelName,
  missing,
  planBudget,
  planMetrics,
  planPolicies,
  planUptime,
} from './lib.mjs';

export function parseArgs(argv) {
  const out = {apply: false, skipBudget: false};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--skip-budget') out.skipBudget = true;
    else if (a === '--email' || a === '--budget' || a === '--host') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a value`);
      out[a.slice(2)] = v;
    } else throw new Error(`unknown option: ${a}`);
  }
  if (!out.email) throw new Error('--email is required (where alerts go)');
  if (out.budget !== undefined && !(Number(out.budget) > 0))
    throw new Error('--budget must be a positive number of USD');
  return out;
}

// On Windows gcloud is gcloud.cmd, which Node runs only through a shell, and a
// shell reads ( ) & and friends: quote anything that is not plainly safe.
const quote = a =>
  /^[A-Za-z0-9_.\/:=@+,%-]+$/.test(a)
    ? a
    : `"${String(a).replace(/"/g, '\\"')}"`;

export function gcloudRunner({
  exec = execFileSync,
  platform = process.platform,
} = {}) {
  const win = platform === 'win32';
  return args => {
    const out = exec(
      win ? 'gcloud.cmd' : 'gcloud',
      win ? args.map(quote) : args,
      {encoding: 'utf8', shell: win, maxBuffer: 64 * 1024 * 1024},
    );
    return args.includes('--format=json') ? JSON.parse(out || 'null') : out;
  };
}

/** Monitoring REST client; `token` and `fetchImpl` are injectable. */
export function monitoringApi({project, token, fetchImpl = fetch}) {
  const base = `https://monitoring.googleapis.com/v3/projects/${project}`;
  async function call(method, path, body) {
    const res = await fetchImpl(`${base}/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token()}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok)
      throw new Error(
        `${method} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`,
      );
    return res.json();
  }
  return {
    list: async (path, key) => (await call('GET', path))[key] ?? [],
    create: (path, body) => call('POST', path, body),
  };
}

export async function enableAlerts({
  run,
  api,
  email,
  apply = false,
  skipBudget = false,
  config = CONFIG,
  log = console.log,
}) {
  const say = (state, what) => log(`${state.padEnd(13)} ${what}`);
  const act = apply ? 'creating' : 'would create';
  let problems = 0;
  const guard = async (what, fn) => {
    try {
      await fn();
    } catch (error) {
      problems++;
      say('CANNOT TELL', `${what}: ${String(error.message).split('\n')[0]}`);
    }
  };

  await guard('log metrics', async () => {
    const have =
      run([
        'logging',
        'metrics',
        'list',
        `--project=${config.project}`,
        '--format=json',
      ]) ?? [];
    for (const m of planMetrics(config)) {
      if (!missing([m], have, 'name').length) {
        say('already set', `metric ${m.name}`);
        continue;
      }
      say(act, `metric ${m.name}`);
      if (apply)
        run([
          'logging',
          'metrics',
          'create',
          m.name,
          `--description=${m.description}`,
          `--log-filter=${m.filter}`,
          `--project=${config.project}`,
        ]);
    }
  });

  let channel;
  await guard('notification channel', async () => {
    const name = channelName(email);
    const have = await api.list('notificationChannels', 'notificationChannels');
    channel = have.find(c => c.displayName === name)?.name;
    if (channel) return say('already set', `channel ${name}`);
    say(act, `channel ${name}`);
    if (apply)
      channel = (
        await api.create('notificationChannels', {
          type: 'email',
          displayName: name,
          labels: {email_address: email},
        })
      ).name;
  });

  await guard('alert policies', async () => {
    const have = await api.list('alertPolicies', 'alertPolicies');
    for (const p of planPolicies(config, channel ? [channel] : [])) {
      if (!missing([p], have, 'displayName').length) {
        say('already set', `policy ${p.displayName}`);
        continue;
      }
      say(act, `policy ${p.displayName}`);
      if (apply) await api.create('alertPolicies', p);
    }
  });

  await guard('uptime checks', async () => {
    const have = await api.list('uptimeCheckConfigs', 'uptimeCheckConfigs');
    for (const u of planUptime(config)) {
      if (!missing([u], have, 'displayName').length) {
        say('already set', `uptime ${u.displayName}`);
        continue;
      }
      say(act, `uptime ${u.displayName}`);
      if (apply) await api.create('uptimeCheckConfigs', u);
    }
  });

  if (!skipBudget)
    await guard('budget', async () => {
      const info = run([
        'billing',
        'projects',
        'describe',
        config.project,
        '--format=json',
      ]);
      const account = String(info?.billingAccountName ?? '').replace(
        'billingAccounts/',
        '',
      );
      if (!account) throw new Error('the project has no billing account');
      const have =
        run([
          'billing',
          'budgets',
          'list',
          `--billing-account=${account}`,
          `--billing-project=${config.project}`,
          '--format=json',
        ]) ?? [];
      const name = `${config.project} monthly`;
      if (have.some(b => b.displayName === name))
        return say('already set', `budget ${name}`);
      say(act, `budget ${name}: ${config.budgetUsd} USD, mail at 50/90/100 %`);
      if (apply) run(planBudget(config, account));
    });

  if (!apply)
    log(
      '\nDry run: nothing was changed. Add --apply to create what is missing.',
    );
  if (problems)
    log(`${problems} part(s) could not be read; see CANNOT TELL above.`);
  return {problems};
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const config = {
      ...CONFIG,
      ...(opts.host && {host: opts.host}),
      ...(opts.budget && {budgetUsd: Number(opts.budget)}),
    };
    const run = gcloudRunner();
    const api = monitoringApi({
      project: config.project,
      token: () => run(['auth', 'print-access-token']).trim(),
    });
    const {problems} = await enableAlerts({run, api, config, ...opts});
    process.exit(problems ? 1 : 0);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
