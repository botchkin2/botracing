// The account the functions run as (ops/iam/README.md, steps 1 to 3): it holds
// Firestore access, objects in the one bucket and nothing else, so a bug in a
// function or a leaked token cannot delete backups or change who has access.
// Deploying a function as it needs the deploy account to be allowed to act as
// it (runbook step 2).
export const RUNTIME_ACCOUNT =
  'lap-runtime@botracing-61.iam.gserviceaccount.com';
