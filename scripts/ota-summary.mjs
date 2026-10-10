// Markdown for the OTA workflow's job summary, from `eas update --json`:
// the update group id, the runtime version (the native fingerprint the update
// targets) and the message. Used by .github/workflows/ota-update.yml.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

/** @param {unknown} json parsed `eas update --json` output (one entry per platform) */
export function summary(json, commit) {
  const rows = Array.isArray(json) ? json : [json];
  const a = rows.find(r => r && r.platform === 'android') ?? rows[0];
  if (!a || !a.group || !a.runtimeVersion) {
    throw new Error('eas update --json: no group/runtimeVersion in the output');
  }
  return [
    '### OTA update',
    '',
    '| | |',
    '|---|---|',
    `| Group | ${a.group} |`,
    `| Runtime version | ${a.runtimeVersion} |`,
    `| Message | ${a.message ?? commit} |`,
    `| Branch | ${a.branch ?? 'production'} |`,
    `| Commit | ${commit} |`,
    '',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , file, commit] = process.argv;
  process.stdout.write(summary(JSON.parse(readFileSync(file, 'utf8')), commit));
}
