/**
 * Browser Fingerprint Dump Test
 *
 * Playwright 브라우저가 어떤 핑거프린트 값들을 노출하는지 확인
 * Akamai Bot Manager가 탐지하는 값들을 파악하기 위한 테스트
 *
 * 실행: npx jest test/integration/browser-fingerprint-dump.spec.ts
 */

import { chromium, firefox, webkit, Browser, BrowserContext, Page } from 'playwright';

describe('Browser Fingerprint Dump', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  afterEach(async () => {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  });

  /**
   * Chromium 핑거프린트 덤프
   */
  it('should dump Chromium fingerprint values', async () => {
    console.log('\n=== Chromium Fingerprint Dump ===\n');

    browser = await chromium.launch({ headless: false });
    context = await browser.newContext();
    page = await context.newPage();

    await dumpFingerprint(page, 'Chromium');
  }, 60000);

  /**
   * Firefox 핑거프린트 덤프
   */
  it('should dump Firefox fingerprint values', async () => {
    console.log('\n=== Firefox Fingerprint Dump ===\n');

    browser = await firefox.launch({ headless: false });
    context = await browser.newContext();
    page = await context.newPage();

    await dumpFingerprint(page, 'Firefox');
  }, 60000);

  /**
   * Webkit 핑거프린트 덤프
   */
  it('should dump Webkit fingerprint values', async () => {
    console.log('\n=== Webkit Fingerprint Dump ===\n');

    browser = await webkit.launch({ headless: false });
    context = await browser.newContext();
    page = await context.newPage();

    await dumpFingerprint(page, 'Webkit');
  }, 60000);

  /**
   * Headless vs Headful 비교
   */
  it('should compare headless vs headful fingerprints', async () => {
    console.log('\n=== Headless vs Headful Comparison ===\n');

    // Headless
    console.log('--- HEADLESS MODE ---');
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    page = await context.newPage();
    const headlessFingerprint = await getFingerprint(page);
    await browser.close();

    // Headful
    console.log('\n--- HEADFUL MODE ---');
    browser = await chromium.launch({ headless: false });
    context = await browser.newContext();
    page = await context.newPage();
    const headfulFingerprint = await getFingerprint(page);

    // 비교
    console.log('\n--- DIFFERENCES ---');
    compareFingerprints(headlessFingerprint, headfulFingerprint);
  }, 120000);
});

/**
 * 핑거프린트 값들을 덤프
 */
async function dumpFingerprint(page: Page, browserName: string) {
  // 빈 페이지에서 테스트
  await page.goto('about:blank');

  const fingerprint = await getFingerprint(page);

  console.log(`\n[${browserName}] Navigator Properties:`);
  console.log(`  webdriver: ${fingerprint.webdriver}`);
  console.log(`  webdriver descriptor: ${JSON.stringify(fingerprint.webdriverDescriptor)}`);
  console.log(`  userAgent: ${fingerprint.userAgent}`);
  console.log(`  platform: ${fingerprint.platform}`);
  console.log(`  languages: ${JSON.stringify(fingerprint.languages)}`);
  console.log(`  hardwareConcurrency: ${fingerprint.hardwareConcurrency}`);
  console.log(`  deviceMemory: ${fingerprint.deviceMemory}`);
  console.log(`  maxTouchPoints: ${fingerprint.maxTouchPoints}`);
  console.log(`  vendor: ${fingerprint.vendor}`);
  console.log(`  plugins count: ${fingerprint.pluginsCount}`);
  console.log(`  plugins: ${JSON.stringify(fingerprint.plugins)}`);
  console.log(`  mimeTypes count: ${fingerprint.mimeTypesCount}`);

  console.log(`\n[${browserName}] Automation Detection:`);
  console.log(`  navigator.webdriver: ${fingerprint.webdriver}`);
  console.log(`  window.chrome: ${fingerprint.hasChrome}`);
  console.log(`  window.chrome.runtime: ${fingerprint.hasChromeRuntime}`);
  console.log(`  Notification.permission: ${fingerprint.notificationPermission}`);
  console.log(`  navigator.permissions: ${fingerprint.hasPermissions}`);

  console.log(`\n[${browserName}] Automation-Related Window Properties:`);
  console.log(`  __nightmare: ${fingerprint.hasNightmare}`);
  console.log(`  _phantom: ${fingerprint.hasPhantom}`);
  console.log(`  __selenium_unwrapped: ${fingerprint.hasSelenium}`);
  console.log(`  _Selenium_IDE_Recorder: ${fingerprint.hasSeleniumIDE}`);
  console.log(`  callSelenium: ${fingerprint.hasCallSelenium}`);
  console.log(`  __webdriver_script_fn: ${fingerprint.hasWebdriverScript}`);
  console.log(`  __driver_evaluate: ${fingerprint.hasDriverEvaluate}`);
  console.log(`  __webdriver_evaluate: ${fingerprint.hasWebdriverEvaluate}`);
  console.log(`  __fxdriver_evaluate: ${fingerprint.hasFxdriverEvaluate}`);
  console.log(`  __driver_unwrapped: ${fingerprint.hasDriverUnwrapped}`);
  console.log(`  __webdriver_unwrapped: ${fingerprint.hasWebdriverUnwrapped}`);
  console.log(`  __fxdriver_unwrapped: ${fingerprint.hasFxdriverUnwrapped}`);
  console.log(`  _webdriver_unwrapped: ${fingerprint.hasWebdriverUnwrapped2}`);
  console.log(`  cdc_: ${fingerprint.hasCdc}`);
  console.log(`  $cdc_: ${fingerprint.hasCdc2}`);

  console.log(`\n[${browserName}] WebGL:`);
  console.log(`  vendor: ${fingerprint.webglVendor}`);
  console.log(`  renderer: ${fingerprint.webglRenderer}`);

  console.log(`\n[${browserName}] Screen:`);
  console.log(`  width: ${fingerprint.screenWidth}`);
  console.log(`  height: ${fingerprint.screenHeight}`);
  console.log(`  availWidth: ${fingerprint.screenAvailWidth}`);
  console.log(`  availHeight: ${fingerprint.screenAvailHeight}`);
  console.log(`  colorDepth: ${fingerprint.colorDepth}`);
  console.log(`  pixelDepth: ${fingerprint.pixelDepth}`);

  console.log(`\n[${browserName}] Canvas Fingerprint:`);
  console.log(`  hash: ${fingerprint.canvasHash}`);

  console.log(`\n[${browserName}] Function toString Detection:`);
  console.log(`  Function.prototype.toString: ${fingerprint.functionToString}`);
  console.log(`  navigator.webdriver.toString(): ${fingerprint.webdriverToString}`);

  return fingerprint;
}

/**
 * 핑거프린트 값들을 수집
 */
async function getFingerprint(page: Page): Promise<Record<string, any>> {
  return await page.evaluate(() => {
    // Canvas fingerprint
    const getCanvasFingerprint = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return 'no-context';

        canvas.width = 200;
        canvas.height = 50;

        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillStyle = '#f60';
        ctx.fillRect(125, 1, 62, 20);
        ctx.fillStyle = '#069';
        ctx.fillText('Playwright Test', 2, 15);
        ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
        ctx.fillText('Canvas FP', 4, 17);

        return canvas.toDataURL().slice(0, 100) + '...';
      } catch {
        return 'error';
      }
    };

    // WebGL info
    const getWebGLInfo = () => {
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) return { vendor: 'no-webgl', renderer: 'no-webgl' };

        const debugInfo = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
        if (!debugInfo) return { vendor: 'no-debug-info', renderer: 'no-debug-info' };

        return {
          vendor: (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
          renderer: (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL),
        };
      } catch {
        return { vendor: 'error', renderer: 'error' };
      }
    };

    // Check for cdc_ properties (ChromeDriver)
    const hasCdcProps = () => {
      for (const prop in window) {
        if (prop.startsWith('cdc_') || prop.startsWith('$cdc_')) {
          return true;
        }
      }
      return false;
    };

    const webglInfo = getWebGLInfo();

    // Property descriptor check
    let webdriverDescriptor: PropertyDescriptor | undefined;
    try {
      webdriverDescriptor = Object.getOwnPropertyDescriptor(navigator, 'webdriver');
    } catch {
      webdriverDescriptor = undefined;
    }

    // Function.prototype.toString detection
    let functionToString = '';
    try {
      functionToString = Function.prototype.toString.call(Function.prototype.toString).slice(0, 50);
    } catch {
      functionToString = 'error';
    }

    // navigator.webdriver toString
    let webdriverToString = '';
    try {
      // @ts-ignore
      webdriverToString = navigator.webdriver?.toString?.() || String(navigator.webdriver);
    } catch {
      webdriverToString = 'error';
    }

    return {
      // Navigator basic
      webdriver: navigator.webdriver,
      webdriverDescriptor: webdriverDescriptor ? {
        value: webdriverDescriptor.value,
        writable: webdriverDescriptor.writable,
        enumerable: webdriverDescriptor.enumerable,
        configurable: webdriverDescriptor.configurable,
        hasGetter: !!webdriverDescriptor.get,
        hasSetter: !!webdriverDescriptor.set,
      } : null,
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      languages: navigator.languages,
      hardwareConcurrency: navigator.hardwareConcurrency,
      // @ts-ignore
      deviceMemory: navigator.deviceMemory,
      maxTouchPoints: navigator.maxTouchPoints,
      vendor: navigator.vendor,

      // Plugins
      pluginsCount: navigator.plugins.length,
      plugins: Array.from(navigator.plugins).slice(0, 5).map(p => p.name),
      mimeTypesCount: navigator.mimeTypes.length,

      // Automation detection
      // @ts-ignore
      hasChrome: !!window.chrome,
      // @ts-ignore
      hasChromeRuntime: !!(window.chrome && window.chrome.runtime),
      notificationPermission: typeof Notification !== 'undefined' ? Notification.permission : 'unavailable',
      hasPermissions: !!navigator.permissions,

      // Automation-related window properties
      // @ts-ignore
      hasNightmare: !!window.__nightmare,
      // @ts-ignore
      hasPhantom: !!window._phantom,
      // @ts-ignore
      hasSelenium: !!window.__selenium_unwrapped,
      // @ts-ignore
      hasSeleniumIDE: !!window._Selenium_IDE_Recorder,
      // @ts-ignore
      hasCallSelenium: !!window.callSelenium,
      // @ts-ignore
      hasWebdriverScript: !!window.__webdriver_script_fn,
      // @ts-ignore
      hasDriverEvaluate: !!window.__driver_evaluate,
      // @ts-ignore
      hasWebdriverEvaluate: !!window.__webdriver_evaluate,
      // @ts-ignore
      hasFxdriverEvaluate: !!window.__fxdriver_evaluate,
      // @ts-ignore
      hasDriverUnwrapped: !!window.__driver_unwrapped,
      // @ts-ignore
      hasWebdriverUnwrapped: !!window.__webdriver_unwrapped,
      // @ts-ignore
      hasFxdriverUnwrapped: !!window.__fxdriver_unwrapped,
      // @ts-ignore
      hasWebdriverUnwrapped2: !!window._webdriver_unwrapped,
      hasCdc: hasCdcProps(),
      hasCdc2: hasCdcProps(),

      // WebGL
      webglVendor: webglInfo.vendor,
      webglRenderer: webglInfo.renderer,

      // Screen
      screenWidth: screen.width,
      screenHeight: screen.height,
      screenAvailWidth: screen.availWidth,
      screenAvailHeight: screen.availHeight,
      colorDepth: screen.colorDepth,
      pixelDepth: screen.pixelDepth,

      // Canvas
      canvasHash: getCanvasFingerprint(),

      // Function toString
      functionToString,
      webdriverToString,
    };
  });
}

/**
 * 두 핑거프린트 비교
 */
function compareFingerprints(headless: Record<string, any>, headful: Record<string, any>) {
  const keys = new Set([...Object.keys(headless), ...Object.keys(headful)]);

  for (const key of keys) {
    const h1 = JSON.stringify(headless[key]);
    const h2 = JSON.stringify(headful[key]);

    if (h1 !== h2) {
      console.log(`  ${key}:`);
      console.log(`    headless: ${h1}`);
      console.log(`    headful:  ${h2}`);
    }
  }
}
