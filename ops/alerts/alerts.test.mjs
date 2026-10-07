import assert from 'node:assert/strict';
import {test} from 'node:test';
import {enableAlerts, gcloudRunner, parseArgs} from './enable.mjs';
import {
  CONFIG,
  missing,
  planBudget,
  planMetrics,
  planPolicies,
  planUptime,
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

test('uptime checks cover both paths and accept 2xx or 401', () => {
  const u = planUptime();
  assert.deepEqual(
    u.map(x => x.httpCheck.path),
    ['/api/upload/me', '/api/lmu/tracks'],
  );
  assert.ok(
    u[0].httpCheck.acceptedResponseStatusCodes.some(c => c.statusValue === 401),
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

function fakes({existing = false, billing = true} = {}) {
  const ran = [];
  const created = [];
  const run = args => {
    ran.push(args.join(' '));
    const k = args.slice(0, 3).join(' ');
    if (k === 'logging metrics list') return existing ? planMetrics() : [];
    if (k === 'billing projects describe')
      return billing ? {billingAccountName: 'billingAccounts/ABC'} : {};
    if (k === 'billing budgets list')
      return existing ? [{displayName: 'botracing-61 monthly'}] : [];
    return '';
  };
  const api = {
    list: async path =>
      !existing
        ? []
        : path === 'notificationChannels'
        ? [{displayName: 'BotRacing alerts a@b', name: 'channels/1'}]
        : path === 'alertPolicies'
        ? planPolicies()
        : planUptime(),
    create: async (path, body) => {
      created.push(path);
      return {name: 'channels/new', ...body};
    },
  };
  return {run, api, ran, created};
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
  await enableAlerts({...f, email: 'a@b', apply: true, log: () => {}});
  assert.equal(f.created.length, 1 + 2 + 2);
  assert.equal(
    f.ran.filter(r => r.startsWith('logging metrics create')).length,
    2,
  );
  assert.equal(
    f.ran.filter(r => r.startsWith('billing budgets create')).length,
    1,
  );
  const g = fakes({existing: true});
  await enableAlerts({...g, email: 'a@b', apply: true, log: () => {}});
  assert.deepEqual(g.created, []);
  assert.ok(!g.ran.some(r => r.includes(' create')));
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

test('windows runner quotes through a shell', () => {
  let seen;
  gcloudRunner({
    exec: (c, a) => ((seen = [c, a]), '[]'),
    platform: 'win32',
  })(['x', '--log-filter=a (b)', '--format=json']);
  assert.equal(seen[0], 'gcloud.cmd');
  assert.equal(seen[1][1], '"--log-filter=a (b)"');
});
