import assert from 'node:assert/strict';
import {test} from 'node:test';
import {enableAlerts, gcloudRunner, googleApi, parseArgs} from './enable.mjs';
import {
  CONFIG,
  missing,
  planBudget,
  planMetrics,
  planPolicies,
  planUptime,
  planUptimePolicies,
} from './lib.mjs';

test('metrics watch both services and the two statuses', () => {
  const [m5, m4] = planMetrics();
  assert.match(m5.filter, /"lmuapi" OR "uploadapi"/);
  assert.match(m5.filter, /status>=500/);
  assert.match(m4.filter, /status=401/);
});

test('policies point at the metrics and the channel', () => {
  const [p] = planPolicies(CONFIG, ['channels/1']);
  assert.deepEqual(p.notificationChannels, ['channels/1']);
  assert.match(p.conditions[0].conditionThreshold.filter, /botracing_http_5xx/);
});

test('uptime checks accept only a 401 with an error body', () => {
  const [u] = planUptime();
  assert.deepEqual(u.httpCheck.acceptedResponseStatusCodes, [
    {statusValue: 401},
  ]);
  assert.equal(u.contentMatchers[0].content, 'error');
  assert.deepEqual(
    planUptime().map(x => x.httpCheck.path),
    ['/api/upload/me', '/api/lmu/tracks'],
  );
});

test('budget args', () => {
  const a = planBudget(CONFIG, 'ABC');
  assert.ok(a.includes('--billing-account=ABC'));
  assert.equal(a.filter(x => x.startsWith('--threshold-rule')).length, 3);
});

test('missing matches by key', () => {
  assert.deepEqual(missing([{n: 1}, {n: 2}], [{n: 1}], 'n'), [{n: 2}]);
});

test('parseArgs', () => {
  assert.throws(() => parseArgs([]), /--email/);
  assert.throws(() => parseArgs(['--email', 'a@b', '--x']), /unknown/);
  assert.throws(
    () => parseArgs(['--email', 'a@b', '--budget', '0']),
    /positive/,
  );
  assert.equal(parseArgs(['--email', 'a@b', '--apply']).apply, true);
});

function fakes({existing = false, billing = true, channelFails = false} = {}) {
  const ran = [];
  const created = [];
  const patched = [];
  const run = args => {
    ran.push(args.join(' '));
    const k = args.slice(0, 3).join(' ');
    if (k === 'billing projects describe')
      return billing ? {billingAccountName: 'billingAccounts/ABC'} : {};
    if (k === 'billing budgets list')
      return existing ? [{displayName: 'botracing-61 monthly'}] : [];
    return '';
  };
  const checks = planUptime().map((u, i) => ({
    displayName: u.displayName,
    name: `projects/p/uptimeCheckConfigs/check${i}`,
  }));
  const policies = (channels = ['channels/1']) =>
    [
      ...planPolicies(CONFIG, channels),
      ...planUptimePolicies(CONFIG, {}, channels),
    ].map((p, i) => ({...p, name: `projects/p/alertPolicies/${i}`}));
  const state = {policiesChannels: ['channels/1']};
  const api = {
    list: async (_api, path) => {
      if (!existing) return [];
      if (path === 'metrics') return planMetrics();
      if (path === 'notificationChannels')
        return [{displayName: 'BotRacing alerts a@b', name: 'channels/1'}];
      if (path === 'alertPolicies') return policies(state.policiesChannels);
      return checks;
    },
    create: async (_api, path, body) => {
      if (channelFails && path === 'notificationChannels')
        throw new Error('403 no permission');
      created.push(path);
      return {name: `projects/p/${path}/new${created.length}`, ...body};
    },
    patch: async (_api, name, mask, body) => patched.push([name, mask, body]),
  };
  return {run, api, ran, created, patched, state};
}

test('dry run changes nothing', async () => {
  const f = fakes();
  const lines = [];
  await enableAlerts({...f, email: 'a@b', log: l => lines.push(l)});
  assert.deepEqual(f.created, []);
  assert.ok(!f.ran.some(r => r.includes(' create')));
  assert.ok(lines.some(l => l.startsWith('would create')));
});

test('apply creates everything once, and nothing when it all exists', async () => {
  const f = fakes();
  const {problems} = await enableAlerts({
    ...f,
    email: 'a@b',
    apply: true,
    log: () => {},
  });
  assert.equal(problems, 0);
  const count = p => f.created.filter(c => c === p).length;
  assert.equal(count('metrics'), 2);
  assert.equal(count('notificationChannels'), 1);
  assert.equal(count('uptimeCheckConfigs'), 2);
  assert.equal(count('alertPolicies'), 4);
  assert.equal(
    f.ran.filter(r => r.startsWith('billing budgets create')).length,
    1,
  );
  const g = fakes({existing: true});
  await enableAlerts({...g, email: 'a@b', apply: true, log: () => {}});
  assert.deepEqual(g.created, []);
  assert.deepEqual(g.patched, []);
  assert.ok(!g.ran.some(r => r.includes(' create')));
});

test('uptime policies point at the created checks', async () => {
  const sent = [];
  const f = fakes();
  const create = f.api.create;
  f.api.create = async (a, p, b) => (sent.push([p, b]), create(a, p, b));
  await enableAlerts({...f, email: 'a@b', apply: true, log: () => {}});
  const down = sent.filter(
    ([p, b]) =>
      p === 'alertPolicies' && b.displayName.startsWith('BotRacing down'),
  );
  assert.equal(down.length, 2);
  for (const [, b] of down)
    assert.match(
      b.conditions[0].conditionThreshold.filter,
      /check_id="new\d+"/,
    );
});

test('a failed channel create creates no policies', async () => {
  const f = fakes({channelFails: true});
  const lines = [];
  const {problems} = await enableAlerts({
    ...f,
    email: 'a@b',
    apply: true,
    skipBudget: true,
    log: l => lines.push(l),
  });
  assert.ok(problems >= 2);
  assert.ok(!f.created.includes('alertPolicies'));
  assert.ok(lines.some(l => l.includes('no notification channel')));
});

test('a policy that exists without the channel gets it added', async () => {
  const f = fakes({existing: true});
  f.state.policiesChannels = [];
  await enableAlerts({...f, email: 'a@b', apply: true, log: () => {}});
  assert.equal(f.patched.length, 4);
  assert.deepEqual(f.patched[0][2], {notificationChannels: ['channels/1']});
});

test('a failed read is reported, not created over', async () => {
  const f = fakes({billing: false});
  const lines = [];
  const {problems} = await enableAlerts({
    ...f,
    email: 'a@b',
    apply: true,
    log: l => lines.push(l),
  });
  assert.equal(problems, 1);
  assert.ok(lines.some(l => l.includes('no billing account')));
  assert.ok(!f.ran.some(r => r.startsWith('billing budgets create')));
});

test('list follows nextPageToken', async () => {
  const urls = [];
  const api = googleApi({
    project: 'p',
    token: () => 't',
    fetchImpl: async url => {
      urls.push(url);
      return {
        ok: true,
        json: async () =>
          url.includes('pageToken')
            ? {items: [2]}
            : {items: [1], nextPageToken: 'n'},
      };
    },
  });
  assert.deepEqual(await api.list('monitoring', 'x', 'items'), [1, 2]);
  assert.match(urls[1], /pageToken=n/);
});

test('windows runner quotes through a shell', () => {
  let seen;
  gcloudRunner({
    exec: (c, a) => ((seen = [c, a]), '[]'),
    platform: 'win32',
  })(['x', '--log-filter=a (b)', '--format=json']);
  assert.equal(seen[0], 'gcloud.cmd');
  assert.equal(seen[1][1], '"--log-filter=a (b)"');
});
