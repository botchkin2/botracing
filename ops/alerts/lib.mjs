// Alerting for the two functions (pit wall thread 3 #10). Pure planning, no
// gcloud and no network, so the tests run anywhere; enable.mjs does the calling.
//
//   Log-based metrics   count 5xx and 401 responses of lmuApi and uploadApi
//   Alert policies      email when either count spikes (5xx: any burst; 401: a flood)
//   Uptime checks       /api/upload/me and /api/lmu/tracks, from outside, every 5 min
//   Budget              the project's spend, mails billing admins at 50/90/100 %
//
// The functions are 2nd gen, so their logs are Cloud Run revision logs and the
// service name is the lower-cased function name.

export const CONFIG = {
  project: 'botracing-61',
  services: ['lmuapi', 'uploadapi'],
  host: 'botracing-61.web.app',
  // Uptime: a path is up when it answers 2xx, or 401 (up and refusing a caller
  // with no token, which is what a check from outside is).
  paths: ['/api/upload/me', '/api/lmu/tracks'],
  // Spikes, per 5-minute window, summed over both functions.
  errors5xxPerWindow: 5,
  unauthorized401PerWindow: 50,
  budgetUsd: 25,
  budgetThresholds: [0.5, 0.9, 1.0],
};

const serviceFilter = services =>
  `resource.type="cloud_run_revision" AND resource.labels.service_name=(${services
    .map(s => `"${s}"`)
    .join(' OR ')})`;

/** The two log-based metrics: one per status we watch. */
export function planMetrics(config = CONFIG) {
  const base = serviceFilter(config.services);
  return [
    {
      name: 'botracing_http_5xx',
      description: 'HTTP 5xx responses from lmuApi and uploadApi',
      filter: `${base} AND httpRequest.status>=500`,
    },
    {
      name: 'botracing_http_401',
      description: 'HTTP 401 responses from lmuApi and uploadApi',
      filter: `${base} AND httpRequest.status=401`,
    },
  ];
}

const policyFor = (displayName, metric, threshold, project, channels) => ({
  displayName,
  combiner: 'OR',
  conditions: [
    {
      displayName: `${metric} above ${threshold} in 5 min`,
      conditionThreshold: {
        filter: `metric.type="logging.googleapis.com/user/${metric}" AND resource.type="cloud_run_revision"`,
        comparison: 'COMPARISON_GT',
        thresholdValue: threshold,
        duration: '0s',
        aggregations: [
          {
            alignmentPeriod: '300s',
            perSeriesAligner: 'ALIGN_SUM',
            crossSeriesReducer: 'REDUCE_SUM',
          },
        ],
        trigger: {count: 1},
      },
    },
  ],
  notificationChannels: channels,
  alertStrategy: {autoClose: '3600s'},
  documentation: {
    mimeType: 'text/markdown',
    content: `See ops/alerts/README.md. Logs: https://console.cloud.google.com/logs/query?project=${project}`,
  },
  enabled: true,
});

/** Alert policies; `channels` are notification channel resource names. */
export function planPolicies(config = CONFIG, channels = []) {
  return [
    policyFor(
      'BotRacing: 5xx spike',
      'botracing_http_5xx',
      config.errors5xxPerWindow,
      config.project,
      channels,
    ),
    policyFor(
      'BotRacing: 401 flood',
      'botracing_http_401',
      config.unauthorized401PerWindow,
      config.project,
      channels,
    ),
  ];
}

/** One uptime check per path. */
export function planUptime(config = CONFIG) {
  return config.paths.map(path => ({
    displayName: `BotRacing uptime ${path}`,
    monitoredResource: {
      type: 'uptime_url',
      labels: {project_id: config.project, host: config.host},
    },
    httpCheck: {
      path,
      port: 443,
      useSsl: true,
      validateSsl: true,
      requestMethod: 'GET',
      acceptedResponseStatusCodes: [
        {statusClass: 'STATUS_CLASS_2XX'},
        {statusValue: 401},
      ],
    },
    period: '300s',
    timeout: '10s',
  }));
}

/** The budget as `gcloud billing budgets create` arguments. */
export function planBudget(config = CONFIG, billingAccount) {
  return [
    'billing',
    'budgets',
    'create',
    `--billing-account=${billingAccount}`,
    `--billing-project=${config.project}`,
    `--display-name=${config.project} monthly`,
    `--budget-amount=${config.budgetUsd}USD`,
    `--filter-projects=projects/${config.project}`,
    ...config.budgetThresholds.map(t => `--threshold-rule=percent=${t}`),
  ];
}

/** Entries of `wanted` that `existing` does not have, matched on `key`. */
export const missing = (wanted, existing, key) => {
  const have = new Set(existing.map(e => e[key]));
  return wanted.filter(w => !have.has(w[key]));
};

export const channelName = email => `BotRacing alerts ${email}`;
