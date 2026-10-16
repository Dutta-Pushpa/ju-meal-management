/**
 * Global test setup.
 *
 * Configuration is pinned here so a test run never depends on the developer's
 * shell environment, and so logging is silent by default. A failing assertion
 * prints but never stops the run, since a missing optional file is not a
 * reason to fail every suite.
 */
import 'dotenv/config';

process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] = 'silent';
process.env['LOG_PRETTY'] = 'false';
process.env['BUDGET_ROLLOVER'] = 'false';
