// For tests that read or write real parquet through the DuckDB CLI.
//
// On a PC without the CLI they are skipped. On CI (CI=true) they are not: the
// workflow installs the CLI, and a missing one must fail the run, or the
// parquet paths that ship in the tray would be tested nowhere but on one PC.
import {run} from './duck.mjs';

function duckdbWorks() {
  try {
    run(':memory:', 'SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/** Test options: `test('...', needsDuckdb, () => {...})`. */
export const needsDuckdb = {
  skip: process.env.CI === 'true' ? false : !duckdbWorks(),
};
