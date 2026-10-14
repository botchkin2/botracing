// What the live-lap analysis needs (functions/src/liveAnalyze.ts, roadmap row 1,
// pit wall #5259/#5260): Eventarc delivers each session-doc write to the
// liveAnalyze function as the runtime account, so that account must receive
// events and may invoke that one Run service. Pure: state in, steps out;
// liveAnalyze.mjs reads the state and runs the steps.
//
// Why each role, and no wider:
// - roles/eventarc.eventReceiver: Eventarc grants it only at project level; it
//   lets the account receive events and nothing else.
// - roles/run.invoker on the liveanalyze service only, not the project: a
//   project grant would let the runtime account call every Run service
//   (uploadApi, dataApi, ...). The service exists only after the first deploy,
//   so this step waits for it; until then a lap is analysed on open, as today.

export const LIVE = {
  project: 'botracing-61',
  region: 'us-central1',
  service: 'liveanalyze',
  runtime: 'lap-runtime@botracing-61.iam.gserviceaccount.com',
};

export const RECEIVER = 'roles/eventarc.eventReceiver';
export const INVOKER = 'roles/run.invoker';

const member = (l = LIVE) => `serviceAccount:${l.runtime}`;

/** Whether a policy (gcloud JSON) gives the runtime account `role`, unconditioned. */
export function grants(policyJson, role, l = LIVE) {
  return (policyJson?.bindings ?? []).some(
    b => b.role === role && !b.condition && (b.members ?? []).includes(member(l)),
  );
}

/**
 * The steps still to take. state: {receiver, serviceExists, invoker}. Only
 * adds: it never removes a role.
 */
export function planLiveAnalyze(state, l = LIVE) {
  const steps = [];
  if (!state.receiver)
    steps.push({
      what: `${l.runtime}: ${RECEIVER} on ${l.project}`,
      run: ['projects', 'add-iam-policy-binding', l.project, `--member=${member(l)}`,
        `--role=${RECEIVER}`, '--condition=None'],
    });
  if (!state.serviceExists)
    steps.push({
      what: `${l.runtime}: ${INVOKER} on the ${l.service} service: after the functions deploy creates it; run this again then`,
    });
  else if (!state.invoker)
    steps.push({
      what: `${l.runtime}: ${INVOKER} on the ${l.service} service only`,
      run: ['run', 'services', 'add-iam-policy-binding', l.service,
        `--region=${l.region}`, `--member=${member(l)}`, `--role=${INVOKER}`,
        `--project=${l.project}`],
    });
  return steps;
}
