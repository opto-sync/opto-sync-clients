/**
 * Shared headless-Chromium launcher for the browser E2E suites.
 *
 * Both suites degrade to a SKIP when Chromium cannot be launched. Locally that
 * is the right call — a contributor without a downloaded browser still gets a
 * useful run, and the jsdom + fake-indexeddb suites stand in.
 *
 * In CI that same skip is dangerous. A skipped test is not a failing test, so
 * the run stays green while the only coverage of this package's core claim —
 * optimistic writes to *real* IndexedDB in a *real* browser — quietly stops
 * executing. That is not hypothetical: `playwright` ships no postinstall
 * browser download, so `npm ci` alone never provides Chromium, and a workflow
 * that forgets `npx playwright install chromium` skips every browser test
 * without any signal.
 *
 * Set `OPTO_SYNC_REQUIRE_BROWSER=1` to turn "no browser" into a hard failure.
 * CI sets it, so these suites cannot silently stop running again.
 */
import assert from 'node:assert';
import test from 'node:test';

/** Truthy when the environment demands that a real browser actually run. */
export const requireBrowser = ['1', 'true', 'yes'].includes(
  String(process.env.OPTO_SYNC_REQUIRE_BROWSER ?? '').toLowerCase(),
);

/** Why the launch failed, for the diagnostic in `reportBrowserUsage`. */
let launchFailure = null;

/**
 * Launch headless Chromium, or return `null` when it is unavailable.
 *
 * @returns {Promise<import('playwright').Browser|null>}
 */
export async function launchChromium() {
  try {
    const { chromium } = await import('playwright');
    return await chromium.launch({ headless: true });
  } catch (error) {
    launchFailure = error.message.split('\n')[0];
    console.log(`      chromium unavailable: ${launchFailure}`);
    return null;
  }
}

/**
 * Register the guard test that makes a skipped browser run visible, and — when
 * `OPTO_SYNC_REQUIRE_BROWSER` is set — fatal.
 *
 * Call this once per suite, passing the browser returned by `launchChromium`.
 *
 * @param {import('playwright').Browser|null} browser
 * @param {string} suite Human-readable suite name, used in the failure message.
 */
export function reportBrowserUsage(browser, suite) {
  test(`report whether a real browser was exercised (${suite})`, () => {
    if (browser) {
      console.log(`      real browser exercised: Chromium ${browser.version()}`);
      return;
    }
    console.log('      real browser NOT exercised (Chromium unavailable)');
    assert.ok(
      !requireBrowser,
      `OPTO_SYNC_REQUIRE_BROWSER is set, but headless Chromium could not be ` +
        `launched, so the "${suite}" suite skipped instead of running.\n` +
        `Reason: ${launchFailure ?? 'unknown'}\n` +
        `Install the browser before running the tests:\n` +
        `  npx playwright install --with-deps chromium`,
    );
  });
}
