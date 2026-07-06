const cron = require('node-cron');
const { predictAllUsers } = require('./agents/predictor');

/**
 * Initializes background cron jobs.
 */
function initScheduler() {
  console.log('Background scheduler worker initialized.');

  // Run nightly cycle predictions at 00:00 (Midnight)
  cron.schedule('0 0 * * *', async () => {
    console.log('[Scheduler] Starting nightly Predictor Agent run...');
    try {
      const mongodb = require('./mongodb');
      const initRes = await mongodb.initMongo();
      if (!initRes) {
        console.error('[Scheduler] Mongo unavailable. Skipping nightly Predictor run.');
        return;
      }

      await predictAllUsers();
      console.log('[Scheduler] Nightly Predictor Agent run completed successfully.');
    } catch (err) {
      console.error('[Scheduler] Error running nightly Predictor Agent job:', err);
    }
  });

  // Optional: Trigger a run on startup for testing/seeding purposes
  setTimeout(async () => {
    console.log('[Scheduler] Running initial Predictor Agent warmup sync...');

    // Ensure Mongo is initialized before running db-backed jobs.
    try {
      const mongodb = require('./mongodb');
      const initRes = await mongodb.initMongo();
      if (!initRes) {
        console.error('[Scheduler] Mongo init returned null (unavailable). Skipping Predictor warmup.');
        return;
      }
    } catch (e) {
      console.error('[Scheduler] Mongo init failed, skipping Predictor warmup:', e);
      return;
    }

    try {
      await predictAllUsers();
    } catch (err) {
      console.error('[Scheduler] Startup prediction sync failed:', err);
    }
  }, 3000);
}

module.exports = {
  initScheduler
};
