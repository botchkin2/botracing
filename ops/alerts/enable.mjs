// Turns on the alerting (see lib.mjs for what and why).
//
//   node ops/alerts/enable.mjs --email you@example.com            dry run
//   node ops/alerts/enable.mjs --email you@example.com --apply    creates what is missing
//   options: --budget <usd>  --host <hostname>  --skip-budget
//
// Safe to re-run: anything already there (matched by name) is left alone, and a
// policy that exists without the channel gets the channel added. Needs
// `gcloud auth login` as an owner of the project. A part whose current state
// cannot be read is reported and nothing is created for it.
//
// Metrics, channel, policies and uptime checks go through the REST APIs (no
// shell, so no quoting); only the token and the budget use gcloud.
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
  planUptimePolicies,
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
export const quote = a =>
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

const HOSTS = {
  monitoring: 'https://monitoring.googleapis.com/v3',
  logging: 'https://logging.googleapis.com/v2',
};

/** REST client for Monitoring and Logging; `token` and `fetchImpl` are injectable. */
export function googleApi({project, token, fetchImpl = fetch}) {
  async function call(method, url, body) {
    const res = await fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${token()}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok)
      throw new Error(
        `${method} ${url}: ${res.status} ${(await res.text()).slice(0, 200)}`,
      );
    return res.json();
  }
  const root = (api, path) => `${HOSTS[api]}/projects/${project}/${path}`;
  return {
    /** Every item of a collection, following nextPageToken. */
    async list(api, path, key) {
      const items = [];
      let page = '';
      do {
        const url = root(api, path) + (page ? `?pageToken=${page}` : '');
        const json = await call('GET', url);
        items.push(...(json[key] ?? []));
        page = json.nextPageToken ?? '';
      } while (page);
      return items;
    },
    create: (api, path, body) => call('POST', root(api, path), body),
    // `name` is a full resource name (projects/...), as the API returned it.
    patch: (api, name, mask, body) =>
      call('PATCH', `${HOSTS[api]}/${name}?updateMask=${mask}`, body),
  };
}

const lastPart = name => String(name).split('/').pop();

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
  const problem = (what, message) => {
    problems++;
    say('CANNOT TELL', `${what}: ${String(message).split('\n')[0]}`);
  };
  const guard = async (what, fn) => {
    try {
      await fn();
    } catch (error) {
      problem(what, error.message);
    }
  };

  await guard('log metrics', async () => {
    const have = await api.list('logging', 'metrics', 'metrics');
    for (const m of planMetrics(config)) {
      if (!missing([m], have, 'name').length) {
        say('already set', `metric ${m.name}`);
        continue;
      }
      say(act, `metric ${m.name}`);
      if (apply)
        await api.create('logging', 'metrics', {
          name: m.name,
          description: m.description,
          filter: m.filter,
        });
    }
  });

  let channel;
  await guard('notification channel', async () => {
    const name = channelName(email);
    const have = await api.list(
      'monitoring',
      'notificationChannels',
      'notificationChannels',
    );
    channel = have.find(c => c.displayName === name)?.name;
    if (channel) return say('already set', `channel ${name}`);
    say(act, `channel ${name}`);
    if (apply)
      channel = (
        await api.create('monitoring', 'notificationChannels', {
          type: 'email',
          displayName: name,
          labels: {email_address: email},
        })
      ).name;
  });

  // path -> check id, from the checks that exist or were just created.
  const checkIds = {};
  await guard('uptime checks', async () => {
    const have = await api.list(
      'monitoring',
      'uptimeCheckConfigs',
      'uptimeCheckConfigs',
    );
    for (const u of planUptime(config)) {
      const found = have.find(h => h.displayName === u.displayName);
      if (found) {
        checkIds[u.httpCheck.path] = lastPart(found.name);
        say('already set', `uptime ${u.displayName}`);
        continue;
      }
      say(act, `uptime ${u.displayName}`);
      if (apply)
        checkIds[u.httpCheck.path] = lastPart(
          (await api.create('monitoring', 'uptimeCheckConfigs', u)).name,
        );
    }
  });

  // Never create policies that would mail nobody: a re-run would see them as
  // "already set" and they would stay silent for good.
  await guard('alert policies', async () => {
    if (apply && !channel)
      throw new Error('no notification channel, so no policies were created');
    const have = await api.list('monitoring', 'alertPolicies', 'alertPolicies');
    const channels = channel ? [channel] : [];
    const wanted = [
      ...planPolicies(config, channels).map(policy => ({policy})),
      ...planUptimePolicies(config, checkIds, channels).map((policy, i) => ({
        policy,
        path: config.paths[i],
      })),
    ];
    for (const {policy, path} of wanted) {
      const name = policy.displayName;
      const there = have.find(h => h.displayName === name);
      if (there) {
        const mailed = there.notificationChannels ?? [];
        if (channel && !mailed.includes(channel)) {
          say(
            apply ? 'fixing' : 'would fix',
            `policy ${name}: add the channel`,
          );
          if (apply)
            await api.patch('monitoring', there.name, 'notificationChannels', {
              notificationChannels: [...mailed, channel],
            });
        } else say('already set', `policy ${name}`);
        continue;
      }
      if (apply && path && !checkIds[path]) {
        problem(`policy ${name}`, 'its uptime check does not exist');
        continue;
      }
      say(act, `policy ${name}`);
      if (apply) await api.create('monitoring', 'alertPolicies', policy);
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
    log(`${problems} part(s) could not be done; see CANNOT TELL above.`);
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
    const api = googleApi({
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
