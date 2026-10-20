import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Builder, By, until } from 'selenium-webdriver';
import type { WebDriver } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { consolidatedLines } from '../../src/testing/fixtures.js';
import { pdfFromLines } from '../../src/testing/pdf.js';
import { TestServer } from '../e2e/actual-server.js';
import type { Budget } from '../e2e/actual-server.js';

// The same checks as web/e2e/extension.e2e.ts, in a real Firefox. Playwright
// cannot load Firefox extensions, so this drives Firefox through geckodriver.
// FIREFOX_BIN and GECKODRIVER_PATH override what Selenium Manager would fetch.
const root = resolve(import.meta.dirname, '..', '..');
const extensionPath = join(root, 'dist-extension-firefox');
const UUID = '11111111-1111-4111-8111-111111111111';
const KEY = 'india2actual.signin.v1';

const CSV = [
  'Date,Narration,Withdrawal Amt.,Deposit Amt.,Closing Balance',
  '12/03/2025,UPI-ACME STORE PUNE-acmestore@ybl-412345678901-NA,725.00,,"9,275.00"',
  '13/03/2025,UPI/412345678903/9876543210@ybl/PAY,,430.00,"9,705.00"',
  '',
].join('\n');

let server: TestServer;
let folder: string;
let budget: Budget;
let driver: WebDriver;
let home: string;

function file(name: string, contents: string | Uint8Array): string {
  const path = join(folder, name);
  writeFileSync(path, contents);
  return path;
}

const text = (): Promise<string> => driver.executeScript('return document.body.innerText');

/** Waits until the page text matches, and returns it. */
async function waitForText(pattern: RegExp, timeout = 30_000): Promise<string> {
  let seen = '';
  await driver.wait(async () => {
    seen = await text();
    return pattern.test(seen);
  }, timeout, `waiting for ${pattern}`);
  return seen;
}

const button = (name: string) =>
  driver.findElement(By.xpath(`//button[starts-with(normalize-space(.), '${name}')]`));

const field = (label: string) =>
  driver.findElement(
    By.xpath(`//label[normalize-space(.)='${label}' or starts-with(normalize-space(.), '${label}')]//input`),
  );

/** Picks an account in the first "Import into" list, once the server has returned the accounts. */
async function chooseAccount(name: string): Promise<void> {
  const label = await driver.findElement(By.xpath("//label[normalize-space(.)='Import into']"));
  const select = await driver.findElement(By.id(await label.getAttribute('for')));
  const option = By.xpath(`.//option[normalize-space(.)='${name}']`);
  await driver.wait(async () => (await select.findElements(option)).length > 0, 15_000);
  await select.findElement(option).click();
}

/** The chosen value of the first "Import into" list, within the first element matching `scope`. */
async function chosenAccount(scope = 'body'): Promise<string> {
  const root = await driver.findElement(By.css(scope));
  const label = await root.findElement(By.xpath(".//label[normalize-space(.)='Import into']"));
  const select = await driver.findElement(By.id(await label.getAttribute('for')));
  return select.getAttribute('value');
}

// The server redirects a visitor who is not signed in to /login, so the tab
// moves to an account screen the way Actual's own router does.
async function showInActualTab(path: string): Promise<string> {
  const panelTab = await driver.getWindowHandle();
  await driver.switchTo().newWindow('tab');
  await driver.get(server.url);
  await driver.wait(async () => (await driver.getCurrentUrl()).endsWith('/login'), 30_000);
  const actualTab = await driver.getWindowHandle();
  await moveActualTab(actualTab, path);
  await driver.switchTo().window(panelTab);
  return actualTab;
}

async function moveActualTab(actualTab: string, path: string): Promise<void> {
  const current = await driver.getWindowHandle();
  await driver.switchTo().window(actualTab);
  await driver.executeScript('history.pushState({}, "", arguments[0])', path);
  await driver.switchTo().window(current);
}

async function upload(path: string): Promise<void> {
  await driver.findElement(By.css('.drop input[type=file]')).sendKeys(path);
}

// Marionette refuses to navigate content to moz-extension:// URLs, so the tab
// is opened from chrome context with the system principal instead.
async function openExtensionTab(path: string): Promise<void> {
  const before = await driver.getAllWindowHandles();
  await driver.setContext(firefox.Context.CHROME);
  await driver.executeScript(
    `gBrowser.selectedTab = gBrowser.addTab(arguments[0], {
       triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
     });`,
    `moz-extension://${UUID}/${path}`,
  );
  await driver.setContext(firefox.Context.CONTENT);
  const fresh = (await driver.getAllWindowHandles()).find(handle => !before.includes(handle));
  await driver.switchTo().window(fresh ?? before[0]!);
}

async function closeExtraTabs(): Promise<void> {
  for (const handle of await driver.getAllWindowHandles()) {
    if (handle !== home) {
      await driver.switchTo().window(handle);
      await driver.close();
    }
  }
  await driver.switchTo().window(home);
}

async function openPanel(): Promise<void> {
  await openExtensionTab('panel.html');
  await driver.wait(until.elementLocated(By.css('h1')), 15_000);
  await driver.executeScript(
    `window.__violations = [];
     document.addEventListener('securitypolicyviolation', e => window.__violations.push(e.violatedDirective + ' ' + e.blockedURI));`,
  );
}

async function signIn(stay: boolean): Promise<void> {
  await field('Server address').then(input => input.sendKeys(server.url));
  await field('Server password').then(input => input.sendKeys(server.password));
  await field('Sync ID').then(input => input.sendKeys(budget.syncId));
  if (stay) {
    await field('Stay connected on this device').then(input => input.click());
  }
  await button('Connect').click();
  await waitForText(/Connected to/);
}

const stored = (): Promise<string | null> =>
  driver.executeScript('return window.localStorage.getItem(arguments[0])', KEY);

beforeAll(async () => {
  execFileSync(process.execPath, [join(root, 'scripts', 'build-extension.mjs'), '--firefox'], {
    cwd: root,
    stdio: 'ignore',
  });
  const manifest = JSON.parse(readFileSync(join(extensionPath, 'manifest.json'), 'utf8'));
  const id = manifest.browser_specific_settings.gecko.id as string;

  folder = mkdtempSync(join(tmpdir(), 'india2actual-firefox-'));
  server = await TestServer.start();

  const options = new firefox.Options()
    .addArguments('-headless')
    .setPreference('extensions.webextensions.uuids', JSON.stringify({ [id]: UUID }));
  if (process.env.FIREFOX_BIN) {
    options.setBinary(process.env.FIREFOX_BIN);
  }
  const service = new firefox.ServiceBuilder(process.env.GECKODRIVER_PATH).addArguments(
    '--allow-system-access',
  );
  driver = await new Builder()
    .forBrowser('firefox')
    .setFirefoxOptions(options)
    .setFirefoxService(service)
    .build();
  await driver.installAddon(extensionPath, true);
  home = await driver.getWindowHandle();
}, 300_000);

afterAll(async () => {
  await driver?.quit();
  server?.stop();
});

beforeEach(async () => {
  budget = await server.newBudget();
  // Clear what an earlier test saved, then start from a fresh page.
  await closeExtraTabs();
  await openExtensionTab('panel.html');
  await driver.wait(until.elementLocated(By.css('h1')), 15_000);
  await driver.executeScript('window.localStorage.clear()');
  await openPanel();
});

describe('the Firefox extension', () => {
  it('loads with a sidebar and asks for little', async () => {
    const manifest = (await driver.executeScript(
      'return browser.runtime.getManifest()',
    )) as Record<string, unknown>;

    expect(manifest.sidebar_action).toBeDefined();
    expect(manifest.permissions ?? []).toEqual([]);
    expect(manifest.host_permissions).toEqual(['http://localhost/*', 'http://127.0.0.1/*']);
    expect(manifest.optional_host_permissions).toEqual(['https://*/*']);
    expect(await driver.findElement(By.css('h1')).getText()).toBe('india2actual');
  });

  it('reads a CSV and a PDF with two accounts under the extension policy', async () => {
    await upload(file('statement.csv', CSV));
    await driver.wait(until.elementLocated(By.css('.check-item.passed')), 15_000);

    await upload(file('all.pdf', pdfFromLines(consolidatedLines())));
    await waitForText(/Account ending 2222/);
    expect(await driver.findElements(By.css('article.card'))).toHaveLength(3);
  });

  it('cannot reach a plain http address that is not on this computer', async () => {
    const outcome = await driver.executeAsyncScript(
      `const done = arguments[arguments.length - 1];
       fetch('http://example.com/').then(() => done('sent'), () => done('blocked'));`,
    );

    expect(outcome).toBe('blocked');
  });

  it('connects and pushes into the account you choose, with no blocked scripts', async () => {
    await signIn(false);
    await upload(file('statement.csv', CSV));
    await chooseAccount('Acme Savings');
    await button('Push 2 rows').click();

    await waitForText(/Imported into Acme Savings: 2 new/);
    expect((await server.read(budget.syncId, budget.savings)).transactions).toHaveLength(2);
    expect(await driver.executeScript('return window.__violations')).toEqual([]);
  });

  it('follows the account open in the Actual tab', async () => {
    const actualTab = await showInActualTab(`/accounts/${budget.savings}`);

    await signIn(false);
    await upload(file('statement.csv', CSV));

    await waitForText(/Actual is showing Acme Savings\./);
    expect(await chosenAccount()).toBe(budget.savings);

    // Moving to another account in Actual updates the hint without replacing a choice.
    await moveActualTab(actualTab, `/accounts/${budget.card}`);
    await waitForText(/Actual is showing Acme Card\./);
    expect(await chosenAccount()).toBe(budget.savings);

    await button('Use it').click();
    await driver.wait(async () => (await chosenAccount()) === budget.card, 10_000);
  });

  it('does not guess an account for a statement with several', async () => {
    await showInActualTab(`/accounts/${budget.savings}`);

    await signIn(false);
    await upload(file('all.pdf', pdfFromLines(consolidatedLines())));
    await driver.wait(until.elementLocated(By.css('article.card')), 15_000);

    expect(await chosenAccount('article.card')).toBe('');
  });

  describe('staying connected', () => {
    it('pushes with the saved sign-in', async () => {
      await signIn(true);
      await driver.navigate().refresh();
      await waitForText(/Signed in earlier/);
      await button('Connect').click();
      await waitForText(/Connected to/);

      await upload(file('statement.csv', CSV));
      await chooseAccount('Acme Savings');
      await button('Push 2 rows').click();

      await waitForText(/Imported into Acme Savings: 2 new/);
    });

    it('keeps a token, never the password, and reconnects in one click', async () => {
      await signIn(true);

      const everything = (await driver.executeScript(
        'return JSON.stringify(Object.fromEntries(Object.entries(window.localStorage)))',
      )) as string;
      expect(await stored()).toContain('"token"');
      expect(everything).not.toContain(server.password);

      await driver.navigate().refresh();
      await waitForText(/Signed in earlier\. Press Connect to use that sign-in\./);
      await button('Connect').click();
      await waitForText(/Connected to/);
    });

    it('saves nothing unless asked', async () => {
      await signIn(false);

      expect(await stored()).toBeNull();
    });

    it('forgets the saved sign-in on request', async () => {
      await signIn(true);
      await driver.navigate().refresh();
      await waitForText(/Forget saved sign-in/);

      await button('Forget saved sign-in').click();

      await driver.wait(async () => (await stored()) === null, 10_000);
    });

    it('asks for the password again when the saved sign-in stops working', async () => {
      await signIn(true);
      await driver.executeScript(
        `const saved = JSON.parse(window.localStorage.getItem(arguments[0]) ?? '{}');
         window.localStorage.setItem(arguments[0], JSON.stringify({ ...saved, token: 'no-longer-valid' }));`,
        KEY,
      );
      await driver.navigate().refresh();
      await waitForText(/Signed in earlier/);

      await button('Connect').click();

      await waitForText(/no longer works/);
      expect(await stored()).toBeNull();
    });
  });
});
