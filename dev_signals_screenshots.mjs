#!/usr/bin/env node
// DEV-ONLY: screenshots of both Signals views against dev data, for the PR.
// Run dev_signals_e2e.mjs first (it writes the test users' sessions), then:
//   npx vite --mode development --port 8091 &   (VITE_* from .env.development → dev project)
//   SIGNALS_SESSIONS_FILE=... OUT_DIR=... node dev_signals_screenshots.mjs
import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.APP_URL ?? 'http://localhost:8091';
const OUT = process.env.OUT_DIR ?? 'signals_screenshots';
const sessions = JSON.parse(fs.readFileSync(process.env.SIGNALS_SESSIONS_FILE ?? 'signals_dev_sessions.json', 'utf8'));
const STORAGE_KEY = 'sb-iqxzetwuxykplzdjysiu-auth-token';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
async function pageAs(who) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(sessions[who])]);
  return ctx.newPage();
}
const shot = async (page, name) => { await page.waitForTimeout(1200); await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); console.log(`${OUT}/${name}.png`); };

// ---- admin: Admin → Inference Insights → Signals -----------------------------
const a = await pageAs('admin');
await a.goto(`${BASE}/admin/inference`);
await a.getByRole('tab', { name: 'Signals', exact: true }).click();
await a.getByText('Source health').waitFor();
await a.getByRole('tab', { name: /Medical devices/ }).click();
await a.locator('table').nth(1).locator('tbody tr').first().waitFor();
await shot(a, '01-admin-signals-health-runlog-510k');
await a.getByRole('tab', { name: /Private equity/ }).click();
await a.getByText('replied interested').first().waitFor();
await shot(a, '02-admin-private-equity');
await a.getByText('replied interested').first().click();
await a.getByText('Payload').waitFor();
await shot(a, '03-admin-pe-evidence-drawer');
await a.keyboard.press('Escape');
await a.getByRole('tab', { name: /SaaS hiring/ }).click();
await a.getByRole('button', { name: /Watchlist/ }).click();
await shot(a, '04-admin-saas-hiring-watchlist');
await a.getByRole('tab', { name: /Website visitors/ }).click();
await shot(a, '05-admin-website-visitors-sites');

// ---- client: Agent → Signals -------------------------------------------------
const c = await pageAs('client');
await c.goto(`${BASE}/agent`);
await c.getByRole('button', { name: 'Signals' }).click();
await c.getByRole('tab', { name: /Medical devices/ }).waitFor();
await c.locator('tbody tr').first().waitFor();
await shot(c, '06-client-signals-510k');
await c.locator('tbody tr').first().click();
await c.getByText('Payload').waitFor();
await shot(c, '07-client-510k-evidence-drawer');
await c.keyboard.press('Escape');
await c.getByRole('tab', { name: /Website visitors/ }).click();
await c.getByText('Website visitor pixel').waitFor();
await shot(c, '08-client-website-visitors-snippet');
const tabs = await c.getByRole('tab').allInnerTexts();
console.log('client sub-tabs:', tabs.join(' | '));

await browser.close();
