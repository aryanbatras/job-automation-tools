// Shared browser harness for the LinkedIn engine tests.
//
// Every test runs the real bundle in a real Chromium page. Nothing about the
// page is faked except the network: the fixture HTML is served for every
// request, so the engine meets exactly the DOM a test describes.
//
// Usage:
//   const { withPage, withEngine, loadHelpers } = require('./harness.cjs');
//   await withPage(html, async (page) => { ... });

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { chromium } = require('playwright');

const engineDirectory = path.join(__dirname, '..', '..', 'linkedin', 'automation');
const applyBundlePath = path.join(engineDirectory, 'dist', 'linkedin-apply.js');
const inPageBundlePath = path.join(engineDirectory, 'dist', 'linkedin-inpage.js');

let built = false;
let browser = null;

const build = () => {
  if (built) return;
  childProcess.execFileSync('node', [path.join(engineDirectory, 'build.js')], {
    stdio: 'ignore',
  });
  built = true;
};

const readBundle = (file) => {
  build();
  return fs.readFileSync(file, 'utf8');
};

// The engine as the MCP runs it: a function that takes the page.
const loadEngine = () => {
  const source = readBundle(applyBundlePath);
  const engine = vm.runInNewContext(source, {
    URL,
    Set,
    Map,
    Array,
    Object,
    String,
    RegExp,
    JSON,
    Boolean,
    Number,
    Date,
  });
  if (typeof engine !== 'function') throw new Error('the bundle is not a function');
  return engine;
};

const startBrowser = async () => {
  if (!browser) browser = await chromium.launch();
  return browser;
};

const closeBrowser = async () => {
  if (!browser) return;
  await browser.close();
  browser = null;
};

const serve = async (page, html) => {
  await page.route('**/*', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: html }),
  );
};

const withPage = async (html, run) => {
  const instance = await startBrowser();
  const page = await instance.newPage();
  try {
    await serve(page, html);
    await page.goto('https://www.linkedin.com/jobs/search-results/?keywords=java');
    return await run(page);
  } finally {
    await page.close();
  }
};

// Installs the page runtime without running the engine.
const loadHelpers = async (page) => {
  const source = readBundle(inPageBundlePath);
  const installed = await page.evaluate(`(${source})({ install: true })`);
  if (!installed || !installed.installed) throw new Error('page runtime not installed');
  return installed;
};

// Serves a different document per URL, the way a job board does.
const withRoutes = async (resolveHtml, run) => {
  const instance = await startBrowser();
  const page = await instance.newPage();
  try {
    await page.route('**/*', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: resolveHtml(route.request().url()) }),
    );
    await page.goto('https://www.linkedin.com/jobs/search-results/?keywords=java');
    return await run(page);
  } finally {
    await page.close();
  }
};

// Runs the whole engine against a fixture page.
const withEngine = async (html, config, run) => {
  const engine = loadEngine();
  return withPage(html, async (page) => {
    const result = await engine(page, config);
    if (run) return run(page, result);
    return result;
  });
};

module.exports = {
  engineDirectory,
  loadEngine,
  loadHelpers,
  withPage,
  withRoutes,
  withEngine,
  closeBrowser,
  build,
};
