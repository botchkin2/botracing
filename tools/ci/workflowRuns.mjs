// The `run:` commands of a GitHub workflow file, with the job and working
// directory each runs in. A line reader for the shape .github/workflows/test.yml
// uses (no anchors, no flow style), so the drift test (check.test.mjs) needs no
// YAML package. A shape it does not know throws, so a new one cannot slip past.

const indentOf = line => line.length - line.trimStart().length;

/**
 * [{job, name, cwd, run}] in file order: `cwd` is the step's working-directory,
 * else the job's `defaults.run.working-directory`, else null; `run` is the command
 * text (a block's lines joined with \n, trimmed); `name` is the step's name or null.
 */
export function workflowRuns(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const runs = [];
  let inJobs = false;
  let job = null;
  let jobCwd = null;
  let step = null; // {name, cwd}
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = indentOf(line);
    if (indent === 0) {
      inJobs = trimmed === 'jobs:';
      continue;
    }
    if (!inJobs) continue;
    if (indent === 2 && /^[A-Za-z0-9_-]+:\s*$/.test(trimmed)) {
      job = trimmed.slice(0, -1);
      jobCwd = null;
      step = null;
      continue;
    }
    if (job == null) continue;
    // defaults: run: working-directory: <dir>, before the steps
    const jobDefault = trimmed.match(/^working-directory:\s*(\S+)\s*$/);
    if (jobDefault && step == null) {
      jobCwd = jobDefault[1];
      continue;
    }
    const start = trimmed.match(/^- (name|uses|run|id|if):\s*(.*)$/);
    const key = start ? start[1] : null;
    if (start) {
      step = {name: null, cwd: null};
      if (key === 'name') step.name = start[2].trim();
    } else if (step) {
      const named = trimmed.match(/^name:\s*(.*)$/);
      if (named) step.name = named[1].trim();
      const wd = trimmed.match(/^working-directory:\s*(\S+)\s*$/);
      if (wd) step.cwd = wd[1];
    }
    const runLine = (start && key === 'run' ? `run: ${start[2]}` : trimmed).match(
      /^run:\s*(.*)$/,
    );
    if (!runLine) continue;
    const value = runLine[1].trim();
    // `defaults:` has a `run:` key with no command: a block of settings, not a step
    if (value === '') continue;
    if (value === '|' || value === '>' || value === '|-') {
      const body = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (lines[j].trim() === '') {
          body.push('');
          continue;
        }
        if (indentOf(lines[j]) <= indent) break;
        body.push(lines[j].trim());
      }
      i = j - 1;
      runs.push({
        job,
        name: step?.name ?? null,
        cwd: step?.cwd ?? jobCwd,
        run: body.join('\n').trim(),
      });
    } else {
      if (/^["'{[&*]/.test(value) && !/^"[^"]*"$/.test(value) && !/^'[^']*'$/.test(value))
        throw new Error(`workflowRuns: a run: shape this reader does not know: ${value}`);
      runs.push({
        job,
        name: step?.name ?? null,
        cwd: step?.cwd ?? jobCwd,
        run: value.replace(/^(["'])(.*)\1$/, '$2'),
      });
    }
  }
  return runs;
}
