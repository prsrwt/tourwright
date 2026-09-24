// Opens the player in Chromium with the wall clock frozen, and collects every error it reports.

import type { Browser, Page } from 'playwright';
import type { ReadyReport } from '../runtime/player.tsx';
import type { Timeline } from '../timing/timeline.ts';

/** Every render sees this date, so a component that shows "today" renders the same on every run. */
export const FROZEN_TIME = new Date('2026-01-15T10:00:00Z');

export interface PlayerPage {
  page: Page;
  ready: ReadyReport;
  /** Console errors, uncaught errors and failed requests, in order. */
  errors: string[];
  close(): Promise<void>;
}

export class BrowserMissingError extends Error {}

export async function openPlayer(url: string, timeline: Timeline): Promise<PlayerPage> {
  const { chromium } = await import('playwright');
  let browser: Browser;
  try {
    // Greyscale anti-aliasing (sub-pixel colour fringes look wrong once scaled and encoded), a
    // fixed colour profile and no scrollbars, so a frame depends only on what is rendered.
    browser = await chromium.launch({ args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars'] });
  } catch (error) {
    if (/Executable doesn't exist|playwright install/i.test((error as Error).message)) {
      throw new BrowserMissingError('Playwright\'s Chromium is not installed.\nFix: run "npx playwright install --only-shell chromium" (about 115 MB, once per machine).');
    }
    throw error;
  }
  try {
    const context = await browser.newContext({
      // Laid out at the layout size and scaled up to the video, like a high-resolution screen, so
      // screenshots come out at exactly the video's size.
      viewport: { width: timeline.layout.width, height: timeline.layout.height },
      deviceScaleFactor: timeline.layout.scale,
      colorScheme: 'light',
      // Not "reduce": apps that honour it would skip the transitions a demo should show. The
      // player drives every CSS animation by the frame, so they stay deterministic.
      locale: 'en-GB',
      timezoneId: 'UTC',
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`Console error: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`Uncaught error: ${error.message}`));
    page.on('requestfailed', (request) => errors.push(`Request failed: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`));

    // Freeze Date and timers before any app code runs. Timers never fire, so nothing can animate
    // on the wall clock; CSS animations are set by the player from the frame number instead.
    // Installed a minute early because the installed clock runs until it is paused: pausing at
    // the very time it was installed at fails ("Cannot fast-forward to the past") on a machine
    // slow enough for a millisecond to pass in between. No page has loaded yet, so no timer
    // fires on the way, and every render still sees exactly FROZEN_TIME.
    await page.clock.install({ time: FROZEN_TIME.getTime() - 60_000 });
    await page.clock.pauseAt(FROZEN_TIME);

    await page.goto(url, { waitUntil: 'load' });
    const deadline = Date.now() + 60_000;
    while (!(await page.evaluate(() => typeof window.__tour === 'object'))) {
      if (errors.length) throw new Error(`The player failed to load:\n${errors.join('\n')}`);
      if (Date.now() > deadline) throw new Error('The player did not start within 60 seconds.');
      await new Promise((done) => setTimeout(done, 50));
    }
    const ready = await page.evaluate((t) => window.__tour.start(t), timeline);
    return { page, ready, errors, close: () => browser.close() };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
