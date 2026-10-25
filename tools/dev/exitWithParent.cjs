// Preloaded into Metro and every worker it starts (live.mjs adds `--require` to NODE_OPTIONS): the process ends when
// the launcher that started the slot is gone, however that happened (a hard kill runs no handler). So a stopped slot
// never leaves a Metro behind holding its port (pit-wall ticket 58). Plain CommonJS: `--require` reads no ES modules.
const launcher = Number(process.env.LIVE_LAUNCHER_PID);
if (launcher > 0) {
  const watch = setInterval(() => {
    try {
      process.kill(launcher, 0);
    } catch (err) {
      // EPERM is a live process we may not signal; only "no such process" means it is gone.
      if (err.code === 'ESRCH') process.exit(0);
    }
  }, 2000);
  // Never the reason Metro stays alive.
  watch.unref();
}
