const { chromium } = require("playwright");
const fs = require("fs");

const START_URL = "https://www.nbe.com.eg/NBE/E/";

const MAX_PAGES = 200;

const OUTPUT_FILE = "/tmp/crawl-results.json";
const FAILED_FILE = "/tmp/crawl-failed.json";

const BASE_DOMAIN = "www.nbe.com.eg";

/*
 * ------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------
 */

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);

    /*
     * Only crawl NBE.
     */
    if (parsed.hostname !== BASE_DOMAIN) {
      return null;
    }

    /*
     * Remove normal URL fragments only if they are not Angular
     * routes.
     *
     * NBE uses:
     *
     * #/EN/ProductCategory...
     *
     * so we MUST preserve those fragments.
     */

    return parsed.href;
  } catch {
    return null;
  }
}

function isPdf(url) {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

function shouldSkipUrl(url) {
  if (!url) {
    return true;
  }

  /*
   * Ignore PDFs.
   */
  if (isPdf(url)) {
    return true;
  }

  /*
   * Ignore obvious non-HTML files.
   */
  const lower = url.toLowerCase();

  const blockedExtensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".svg",
    ".webp",
    ".ico",
    ".css",
    ".js",
    ".xml",
    ".zip",
    ".rar",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".mp4",
    ".mp3",
  ];

  for (const extension of blockedExtensions) {
    if (lower.includes(extension)) {
      return true;
    }
  }

  return false;
}

/*
 * ------------------------------------------------------------
 * Extract content from rendered Angular page
 * ------------------------------------------------------------
 */

async function extractPage(page) {
  return await page.evaluate(() => {
    /*
     * ----------------------------------------------------------
     * Remove obvious website noise
     * ----------------------------------------------------------
     */

    const removeSelectors = [
      "script",
      "style",
      "noscript",
      "iframe",

      /*
       * Navigation
       */
      "header",
      "footer",
      "nav",
      "aside",

      /*
       * Chat / cookie / modal
       */
      ".chatbot",
      "#chatbot",
      ".cookie",
      ".cookies",
      ".modal",

      /*
       * Accessibility hidden elements
       */
      "[aria-hidden='true']",
    ];

    removeSelectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        el.remove();
      });
    });

    /*
     * ----------------------------------------------------------
     * Find the actual NBE content container
     * ----------------------------------------------------------
     */

    const selectors = [
      "#divProductCatalogCategory",
      "#CategoryMiddleContainer",
      "#CategoryShortLayoutContainer",
      "#CategoryContainer",

      ".catagory_landing",

      ".category-middle-container",
      ".category-short-layout-container",

      "main",
      '[role="main"]',
    ];

    let container = null;
    let matchedSelector = null;

    for (const selector of selectors) {
      const element = document.querySelector(selector);

      if (
        element &&
        element.innerText &&
        element.innerText.trim().length > 100
      ) {
        container = element;
        matchedSelector = selector;
        break;
      }
    }

    /*
     * ----------------------------------------------------------
     * Fallback
     * ----------------------------------------------------------
     */

    if (!container) {
      container = document.body;
      matchedSelector = "body";
    }

    /*
     * ----------------------------------------------------------
     * Remove noise inside content
     * ----------------------------------------------------------
     */

    const internalNoise = [
      "button",
      "input",
      "select",
      "textarea",

      /*
       * Comparison UI
       */
      ".compare",
      "[class*='compare']",

      /*
       * Login / account UI
       */
      "[class*='login']",
      "[class*='favorite']",
      "[class*='favourite']",

      /*
       * Floating UI
       */
      "[class*='popup']",
      "[class*='overlay']",
      "[class*='tooltip']",
    ];

    internalNoise.forEach((selector) => {
      container.querySelectorAll(selector).forEach((el) => {
        el.remove();
      });
    });

    /*
     * ----------------------------------------------------------
     * Extract visible text
     * ----------------------------------------------------------
     */

    let text = container.innerText || "";

    text = text
      .replace(/\r/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]+\n/g, "\n");

    /*
     * Remove excessive blank lines.
     */

    text = text
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();

    /*
     * ----------------------------------------------------------
     * Convert content into simple Markdown
     * ----------------------------------------------------------
     */

    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const output = [];

    /*
     * Avoid immediately duplicated lines.
     */

    for (const line of lines) {
      if (
        output.length > 0 &&
        output[output.length - 1] === line
      ) {
        continue;
      }

      output.push(line);
    }

    /*
     * ----------------------------------------------------------
     * Extract links
     * ----------------------------------------------------------
     */

    const links = [];

    document.querySelectorAll("a[href]").forEach((anchor) => {
      const href = anchor.getAttribute("href");

      if (!href) {
        return;
      }

      /*
       * Ignore javascript links.
       */

      if (
        href.startsWith("javascript:") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:")
      ) {
        return;
      }

      try {
        const absoluteUrl = new URL(
          href,
          window.location.href
        ).href;

        links.push({
          url: absoluteUrl,
          text: (anchor.innerText || "")
            .replace(/\s+/g, " ")
            .trim(),
        });
      } catch {
        // Ignore malformed URLs
      }
    });

    /*
     * Remove duplicate links.
     */

    const uniqueLinks = [];

    const seen = new Set();

    for (const link of links) {
      if (seen.has(link.url)) {
        continue;
      }

      seen.add(link.url);
      uniqueLinks.push(link);
    }

    return {
      title: document.title || "",

      selector: matchedSelector,

      text: output.join("\n"),

      textLength: output.join("\n").length,

      links: uniqueLinks,
    };
  });
}

/*
 * ------------------------------------------------------------
 * Main crawler
 * ------------------------------------------------------------
 */

async function crawl() {
  console.log("=================================");
  console.log("NBE HTML CRAWLER");
  console.log("=================================\n");

  console.log(`Starting URL: ${START_URL}`);
  console.log(`Maximum pages: ${MAX_PAGES}\n`);

  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    viewport: {
      width: 1440,
      height: 900,
    },

    /*
     * Normal browser headers.
     */
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",
  });

  /*
   * One page is enough for sequential crawling.
   */

  const page = await context.newPage();

  /*
   * ----------------------------------------------------------
   * Queue
   * ----------------------------------------------------------
   */

  const queue = [
    {
      url: START_URL,
      depth: 0,
    },
  ];

  /*
   * URLs already processed.
   */

  const visited = new Set();

  /*
   * Pages successfully scraped.
   */

  const documents = [];

  /*
   * Failed pages.
   */

  const failed = [];

  /*
   * ----------------------------------------------------------
   * Crawl loop
   * ----------------------------------------------------------
   */

  while (
    queue.length > 0 &&
    documents.length < MAX_PAGES
  ) {
    const current = queue.shift();

    const url = normalizeUrl(current.url);

    if (!url) {
      continue;
    }

    /*
     * Skip duplicates.
     */

    if (visited.has(url)) {
      continue;
    }

    /*
     * Skip PDFs and other files.
     */

    if (shouldSkipUrl(url)) {
      console.log(`Skipping non-HTML: ${url}`);
      continue;
    }

    visited.add(url);

    console.log("\n#################################");
    console.log("CRAWLER STATUS");
    console.log("#################################");

    console.log(`Visited: ${visited.size}`);
    console.log(`Queue: ${queue.length}`);
    console.log(`Pages: ${documents.length}`);

    console.log("\n=================================");
    console.log("CRAWLING");
    console.log("=================================");

    console.log(url);
    console.log(`Depth: ${current.depth}`);

    try {
      /*
       * --------------------------------------------------------
       * Open page
       * --------------------------------------------------------
       */

      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      /*
       * HTTP status can be null for Angular navigation.
       */

      const status = response
        ? response.status()
        : null;

      console.log(`HTTP STATUS: ${status}`);

      /*
       * --------------------------------------------------------
       * Wait for Angular
       * --------------------------------------------------------
       */

      await page.waitForTimeout(5000);

      /*
       * Wait until body contains meaningful content.
       */

      await page
        .waitForFunction(
          () =>
            document.body &&
            document.body.innerText &&
            document.body.innerText.trim().length > 100,
          null,
          {
            timeout: 30000,
          }
        )
        .catch(() => {
          console.log(
            "Warning: expected content was not detected."
          );
        });

      /*
       * Give Angular a little extra time.
       */

      await page.waitForTimeout(1000);

      /*
       * --------------------------------------------------------
       * Extract
       * --------------------------------------------------------
       */

      const result = await extractPage(page);

      console.log("\n=================================");
      console.log("SCRAPE INFORMATION");
      console.log("=================================");

      console.log(`Title: ${result.title}`);
      console.log(`Container: ${result.selector}`);
      console.log(`Text length: ${result.textLength}`);
      console.log(`Links found: ${result.links.length}`);

      /*
       * --------------------------------------------------------
       * Don't save empty pages.
       * --------------------------------------------------------
       */

      if (result.textLength < 50) {
        console.log(
          "Skipping page because extracted content is too short."
        );

        failed.push({
          url,
          depth: current.depth,
          reason: "Content too short",
          title: result.title,
        });

        continue;
      }

      /*
       * --------------------------------------------------------
       * Save document
       * --------------------------------------------------------
       */

      const document = {
        id: documents.length + 1,

        url,

        title: result.title,

        depth: current.depth,

        type: "html",

        content: result.text,

        textLength: result.textLength,

        crawledAt: new Date().toISOString(),
      };

      documents.push(document);

      /*
       * --------------------------------------------------------
       * Show a preview
       * --------------------------------------------------------
       */

      console.log("\nCONTENT PREVIEW:");

      console.log(
        result.text.substring(0, 500)
      );

      if (result.text.length > 500) {
        console.log("...");
      }

      /*
       * --------------------------------------------------------
       * Discover links
       * --------------------------------------------------------
       */

      let discovered = 0;

      for (const link of result.links) {
        const normalized = normalizeUrl(link.url);

        /*
         * Not NBE.
         */

        if (!normalized) {
          continue;
        }

        /*
         * Ignore PDFs.
         */

        if (isPdf(normalized)) {
          continue;
        }

        /*
         * Ignore non-HTML files.
         */

        if (shouldSkipUrl(normalized)) {
          continue;
        }

        /*
         * Already visited.
         */

        if (visited.has(normalized)) {
          continue;
        }

        /*
         * Already in queue.
         */

        const alreadyQueued = queue.some(
          (item) => item.url === normalized
        );

        if (alreadyQueued) {
          continue;
        }

        queue.push({
          url: normalized,
          depth: current.depth + 1,
        });

        discovered++;
      }

      console.log(`New links queued: ${discovered}`);

      /*
       * --------------------------------------------------------
       * Save progress after every page.
       *
       * This is useful if the crawler crashes.
       * --------------------------------------------------------
       */

      fs.writeFileSync(
        OUTPUT_FILE,
        JSON.stringify(
          {
            startUrl: START_URL,

            crawledAt: new Date().toISOString(),

            pagesCrawled: documents.length,

            documents,
          },
          null,
          2
        ),
        "utf8"
      );

      fs.writeFileSync(
        FAILED_FILE,
        JSON.stringify(
          failed,
          null,
          2
        ),
        "utf8"
      );

    } catch (error) {
      /*
       * --------------------------------------------------------
       * Page failure
       * --------------------------------------------------------
       */

      console.error("\nFAILED TO CRAWL:");
      console.error(error.message);

      failed.push({
        url,

        depth: current.depth,

        reason: error.message,

        timestamp: new Date().toISOString(),
      });

      /*
       * Continue with the next URL.
       */

      continue;
    }
  }

  /*
   * ------------------------------------------------------------
   * Final save
   * ------------------------------------------------------------
   */

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      {
        startUrl: START_URL,

        completedAt: new Date().toISOString(),

        pagesCrawled: documents.length,

        uniqueUrlsVisited: visited.size,

        documents,
      },
      null,
      2
    ),
    "utf8"
  );

  fs.writeFileSync(
    FAILED_FILE,
    JSON.stringify(
      failed,
      null,
      2
    ),
    "utf8"
  );

  /*
   * ------------------------------------------------------------
   * Close browser
   * ------------------------------------------------------------
   */

  await browser.close();

  /*
   * ------------------------------------------------------------
   * Final output
   * ------------------------------------------------------------
   */

  console.log("\n\n=================================");
  console.log("CRAWL COMPLETE");
  console.log("=================================\n");

  console.log(`Pages crawled: ${documents.length}`);
  console.log(`URLs visited: ${visited.size}`);
  console.log(`Failed pages: ${failed.length}`);
  console.log(`Remaining queue: ${queue.length}`);

  console.log("\nResults:");
  console.log(OUTPUT_FILE);

  console.log("\nFailed pages:");
  console.log(FAILED_FILE);
}

/*
 * ------------------------------------------------------------
 * Start crawler
 * ------------------------------------------------------------
 */

crawl().catch((error) => {
  console.error("\nFATAL CRAWLER ERROR:");
  console.error(error);

  process.exit(1);
});