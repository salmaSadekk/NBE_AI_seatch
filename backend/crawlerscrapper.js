const { chromium } = require("playwright");
const fs = require("fs");

const START_URL = "https://www.nbe.com.eg/NBE/E/";

const MAX_PAGES = 500;
const MAX_DEPTH = 10;

const OUTPUT_FILE = "/tmp/crawl-results.json";

const WAIT_AFTER_LOAD = 5000;
const MAX_RETRIES = 3;

const visited = new Set();
const queued = new Set();

const queue = [];

const results = [];
const ragChunks = [];

/*
|--------------------------------------------------------------------------
| URL helpers
|--------------------------------------------------------------------------
*/

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);

    /*
     * Remove fragments that don't matter.
     *
     * IMPORTANT:
     * NBE uses Angular routing inside the # fragment.
     * Therefore we CANNOT simply remove the hash.
     */

    let normalized = parsed.toString();

    /*
     * Remove trailing slash only for the normal root URL.
     */

    if (
      parsed.pathname === "/NBE/E/" &&
      !parsed.hash
    ) {
      normalized = "https://www.nbe.com.eg/NBE/E/";
    }

    return normalized;
  } catch {
    return null;
  }
}

function isNbeUrl(url) {
  try {
    const parsed = new URL(url);

    return (
      parsed.hostname === "www.nbe.com.eg" ||
      parsed.hostname === "nbe.com.eg"
    );
  } catch {
    return false;
  }
}

function isPdf(url) {
  try {
    const parsed = new URL(url);

    return (
      parsed.pathname.toLowerCase().endsWith(".pdf") ||
      parsed.href.toLowerCase().includes(".pdf?")
    );
  } catch {
    return false;
  }
}

/*
|--------------------------------------------------------------------------
| Angular route detection
|--------------------------------------------------------------------------
*/

function isAngularPage(url) {
  return url.includes("/NBE/E/#/");
}

/*
|--------------------------------------------------------------------------
| Add URL to crawler queue
|--------------------------------------------------------------------------
*/

function addToQueue(url, depth) {
  const normalized = normalizeUrl(url);

  if (!normalized) {
    return;
  }

  if (!isNbeUrl(normalized)) {
    return;
  }

  /*
   * We intentionally skip PDFs.
   */

  if (isPdf(normalized)) {
    return;
  }

  if (visited.has(normalized)) {
    return;
  }

  if (queued.has(normalized)) {
    return;
  }

  if (depth > MAX_DEPTH) {
    return;
  }

  queued.add(normalized);

  queue.push({
    url: normalized,
    depth,
  });
}

/*
|--------------------------------------------------------------------------
| Create RAG chunks
|--------------------------------------------------------------------------
*/

function createChunks(text, metadata) {
  const cleaned = text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!cleaned) {
    return [];
  }

  /*
   * We don't want microscopic chunks.
   */

  const MIN_CHUNK_LENGTH = 200;

  /*
   * Rough chunk size.
   *
   * This is deliberately character based for now.
   * Later we can replace this with token-aware chunking.
   */

  const MAX_CHUNK_LENGTH = 1200;

  /*
   * First try to split naturally by paragraphs.
   */

  const paragraphs = cleaned
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks = [];

  let current = "";

  for (const paragraph of paragraphs) {
    /*
     * If adding this paragraph doesn't exceed our target,
     * keep it with the current chunk.
     */

    if (
      current.length > 0 &&
      current.length + paragraph.length + 2 <= MAX_CHUNK_LENGTH
    ) {
      current += "\n\n" + paragraph;
      continue;
    }

    /*
     * Save current chunk.
     */

    if (current.length >= MIN_CHUNK_LENGTH) {
      chunks.push(current);
    }

    /*
     * Paragraph itself is larger than our target.
     * Split it further.
     */

    if (paragraph.length > MAX_CHUNK_LENGTH) {
      let start = 0;

      while (start < paragraph.length) {
        const part = paragraph.slice(
          start,
          start + MAX_CHUNK_LENGTH
        );

        if (part.trim().length >= MIN_CHUNK_LENGTH) {
          chunks.push(part.trim());
        }

        start += MAX_CHUNK_LENGTH;
      }

      current = "";
    } else {
      current = paragraph;
    }
  }

  /*
   * Save final chunk.
   */

  if (current.length >= MIN_CHUNK_LENGTH) {
    chunks.push(current);
  }

  /*
   * If the entire page is shorter than MIN_CHUNK_LENGTH,
   * don't throw it away.
   */

  if (chunks.length === 0 && cleaned.length > 0) {
    chunks.push(cleaned);
  }

  return chunks.map((chunk, index) => ({
    id: `${metadata.pageId}-chunk-${index + 1}`,

    pageId: metadata.pageId,

    url: metadata.url,

    title: metadata.title,

    chunkIndex: index,

    text: chunk,

    metadata: {
      source: "nbe",
      type: "webpage",
      depth: metadata.depth,
    },
  }));
}

/*
|--------------------------------------------------------------------------
| Extract content from rendered Angular page
|--------------------------------------------------------------------------
*/

async function getContentFromPage(page) {
  return page.evaluate(() => {
    /*
     * ------------------------------------------------------------
     * Detect NBE request rejection
     * ------------------------------------------------------------
     */

    const bodyText = document.body
      ? document.body.innerText || ""
      : "";

    const title = document.title || "";

    const requestRejected =
      /request rejected/i.test(title) ||
      /request rejected/i.test(bodyText);

    if (requestRejected) {
      return {
        success: false,
        rejected: true,
        title,
        selector: null,
        text: bodyText.trim(),
        textLength: bodyText.trim().length,
        links: [],
      };
    }

    /*
     * ------------------------------------------------------------
     * Remove global noise
     * ------------------------------------------------------------
     */

    const removeSelectors = [
      "script",
      "style",
      "noscript",
      "iframe",

      "header",
      "footer",
      "nav",
      "aside",

      ".chatbot",
      "#chatbot",

      ".cookie",
      ".cookies",

      ".modal",
      ".popup",
      ".overlay",
      ".tooltip",

      "[aria-hidden='true']",
    ];

    for (const selector of removeSelectors) {
      try {
        document.querySelectorAll(selector).forEach((el) => {
          el.remove();
        });
      } catch (error) {
        console.log(
          `Could not remove selector: ${selector}`
        );
      }
    }

    /*
     * ------------------------------------------------------------
     * NBE content containers
     *
     * These are based on the DOM we inspected earlier.
     * ------------------------------------------------------------
     */

    const selectors = [
      "#divProductCatalogCategory",

      "#divProductCatalogCategoryShortLayoutContainer",

      "#divProductCatalogCategoryMiddleContainer",

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
      try {
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
      } catch {
        /*
         * Ignore invalid selectors.
         */
      }
    }

    /*
     * ------------------------------------------------------------
     * Fallback
     * ------------------------------------------------------------
     */

    if (!container) {
      container = document.body;
      matchedSelector = "body";
    }

    /*
     * ------------------------------------------------------------
     * Remove NBE-specific layout placeholders/noise
     * ------------------------------------------------------------
     */

    const internalNoiseSelectors = [
      "button",
      "input",
      "select",
      "textarea",

      ".compare",

      "[class*='compare']",

      "[class*='login']",

      "[class*='favorite']",

      "[class*='favourite']",

      "[class*='popup']",

      "[class*='overlay']",

      "[class*='tooltip']",

      ".oda-chat-widget",
    ];

    for (const selector of internalNoiseSelectors) {
      try {
        container.querySelectorAll(selector).forEach((el) => {
          el.remove();
        });
      } catch {
        /*
         * Ignore bad selectors.
         */
      }
    }

    /*
     * ------------------------------------------------------------
     * Remove literal placeholder text that appeared on NBE pages.
     *
     * IMPORTANT:
     * Do NOT use these strings as CSS selectors.
     * ------------------------------------------------------------
     */

    const allElements = Array.from(
      container.querySelectorAll("*")
    );

    for (const element of allElements) {
      if (
        element.children.length === 0 &&
        element.textContent
      ) {
        const text = element.textContent.trim();

        if (
          text === "#ProductShortLayoutContainer#" ||
          text === "#ProductMiddleLayoutContainer#" ||
          text === "#CategoryFooterContainer#" ||
          text === "#ProductFooterContainer#"
        ) {
          element.remove();
        }
      }
    }

    /*
     * ------------------------------------------------------------
     * Extract visible text
     * ------------------------------------------------------------
     */

    let text = container.innerText || "";

    text = text
      .replace(/\r/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();

    /*
     * ------------------------------------------------------------
     * Remove duplicate consecutive lines
     * ------------------------------------------------------------
     */

    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const cleanedLines = [];

    for (const line of lines) {
      if (
        cleanedLines.length > 0 &&
        cleanedLines[cleanedLines.length - 1] === line
      ) {
        continue;
      }

      cleanedLines.push(line);
    }

    text = cleanedLines.join("\n");

    /*
     * ------------------------------------------------------------
     * Add Markdown headings where useful
     * ------------------------------------------------------------
     */

    const headingPatterns = [
      /^multi frequencies time deposits$/i,
      /^time deposits interest rate paid at maturity$/i,
      /^minimum amount for deposit$/i,
      /^duration$/i,
      /^interest frequency$/i,
      /^find more$/i,

      /^about the /i,
      /^micromentor faqs:?$/i,
      /^frequently asked questions$/i,
    ];

    text = text
      .split("\n")
      .map((line) => {
        const alreadyHeading = line.startsWith("# ");

        if (alreadyHeading) {
          return line;
        }

        const isHeading = headingPatterns.some((pattern) =>
          pattern.test(line)
        );

        if (isHeading) {
          return `## ${line}`;
        }

        return line;
      })
      .join("\n");

    /*
     * ------------------------------------------------------------
     * Extract links AFTER Angular rendering
     * ------------------------------------------------------------
     */

    const links = [];

    const anchors = Array.from(
      container.querySelectorAll("a[href]")
    );

    for (const anchor of anchors) {
      const href = anchor.href;

      if (!href) {
        continue;
      }

      links.push({
        url: href,
        text: (anchor.innerText || "").trim(),
      });
    }

    /*
     * Also inspect the entire rendered document.
     *
     * Some Angular/NBE links may live outside the content
     * container.
     */

    const documentAnchors = Array.from(
      document.querySelectorAll("a[href]")
    );

    for (const anchor of documentAnchors) {
      const href = anchor.href;

      if (!href) {
        continue;
      }

      links.push({
        url: href,
        text: (anchor.innerText || "").trim(),
      });
    }

    /*
     * Deduplicate links.
     */

    const uniqueLinks = [];
    const linkSet = new Set();

    for (const link of links) {
      if (!linkSet.has(link.url)) {
        linkSet.add(link.url);
        uniqueLinks.push(link);
      }
    }

    /*
     * ------------------------------------------------------------
     * Return result
     * ------------------------------------------------------------
     */

    return {
      success: text.length > 0,
      rejected: false,

      title,

      selector: matchedSelector,

      text,

      textLength: text.length,

      links: uniqueLinks,
    };
  });
}

/*
|--------------------------------------------------------------------------
| Scrape one page
|--------------------------------------------------------------------------
*/

async function scrapePage(browser, url, depth) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let context = null;
    let page = null;

    try {
      console.log("");
      console.log("=================================");
      console.log("CRAWLING");
      console.log("=================================");
      console.log(url);
      console.log(`Depth: ${depth}`);
      console.log(`Attempt: ${attempt}/${MAX_RETRIES}`);

      /*
       * Fresh context for each page.
       *
       * This avoids one broken page killing the entire crawler.
       */

      context = await browser.newContext({
        viewport: {
          width: 1440,
          height: 900,
        },

        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/151.0.0.0 Safari/537.36",

        locale: "en-US",

        extraHTTPHeaders: {
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",

          "Accept-Language":
            "en-US,en;q=0.9",

          "Upgrade-Insecure-Requests": "1",
        },
      });

      page = await context.newPage();

      /*
       * Don't allow random website popups to break crawling.
       */

      page.on("dialog", async (dialog) => {
        try {
          await dialog.dismiss();
        } catch {}
      });

      let response = null;

      try {
        response = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
      } catch (error) {
        lastError = error;

        console.log(
          `page.goto failed: ${error.message}`
        );

        /*
         * Try again.
         */

        continue;
      }

      console.log(
        `HTTP STATUS: ${response ? response.status() : "null"}`
      );

      /*
       * ----------------------------------------------------------
       * Wait for Angular
       * ----------------------------------------------------------
       */

      await page.waitForTimeout(WAIT_AFTER_LOAD);

      /*
       * Wait until there is meaningful body text.
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
        .catch(() => {});

      /*
       * Give Angular a little extra time for lazy content.
       */

      await page.waitForTimeout(2000);

      /*
       * ----------------------------------------------------------
       * Extract rendered content
       * ----------------------------------------------------------
       */

      const content = await getContentFromPage(page);

      /*
       * Request Rejected is NOT a successful page.
       */

      if (content.rejected) {
        console.log("");
        console.log("REQUEST REJECTED BY NBE");
        console.log(
          `Title: ${content.title}`
        );

        if (attempt < MAX_RETRIES) {
          console.log("Retrying...");
          continue;
        }

        console.log(
          "Giving up on this URL after retries."
        );

        return null;
      }

      /*
       * ----------------------------------------------------------
       * Print information
       * ----------------------------------------------------------
       */

      console.log("");
      console.log("=================================");
      console.log("SCRAPE INFORMATION");
      console.log("=================================");

      console.log(`Title: ${content.title}`);
      console.log(`Container: ${content.selector}`);
      console.log(`Text length: ${content.textLength}`);

      /*
       * ----------------------------------------------------------
       * Discover links
       * ----------------------------------------------------------
       */

      let newUrls = 0;

      for (const link of content.links) {
        const normalized = normalizeUrl(link.url);

        if (!normalized) {
          continue;
        }

        if (!isNbeUrl(normalized)) {
          continue;
        }

        /*
         * Skip PDFs completely.
         */

        if (isPdf(normalized)) {
          continue;
        }

        const wasQueued =
          queued.has(normalized);

        const wasVisited =
          visited.has(normalized);

        addToQueue(
          normalized,
          depth + 1
        );

        if (
          !wasQueued &&
          !wasVisited &&
          queued.has(normalized)
        ) {
          newUrls++;
        }
      }

      /*
       * ----------------------------------------------------------
       * Create page ID
       * ----------------------------------------------------------
       */

      const pageId = `page-${results.length + 1}`;

      /*
       * ----------------------------------------------------------
       * Create RAG chunks
       * ----------------------------------------------------------
       */

      const chunks = createChunks(
        content.text,
        {
          pageId,
          url,
          title: content.title,
          depth,
        }
      );

      console.log(
        `HTML links: ${content.links.length}`
      );

      console.log(
        `PDF links skipped: ${content.links.filter((l) =>
          isPdf(l.url)
        ).length}`
      );

      console.log(
        `RAG chunks created: ${chunks.length}`
      );

      console.log(
        `New URLs discovered: ${newUrls}`
      );

      /*
       * ----------------------------------------------------------
       * Save page
       * ----------------------------------------------------------
       */

      const pageResult = {
        pageId,

        url,

        depth,

        title: content.title,

        container: content.selector,

        textLength: content.textLength,

        text: content.text,

        links: content.links
          .map((l) => l.url)
          .filter((u) => isNbeUrl(u))
          .filter((u) => !isPdf(u)),

        chunkCount: chunks.length,

        scrapedAt:
          new Date().toISOString(),
      };

      results.push(pageResult);

      /*
       * Add chunks globally.
       */

      for (const chunk of chunks) {
        ragChunks.push(chunk);
      }

      /*
       * Save after EVERY page.
       *
       * This means if the crawler crashes halfway through,
       * we don't lose everything.
       */

      saveResults();

      /*
       * ----------------------------------------------------------
       * Close page/context
       * ----------------------------------------------------------
       */

      await page.close().catch(() => {});
      await context.close().catch(() => {});

      return pageResult;
    } catch (error) {
      lastError = error;

      console.log("");
      console.log("PAGE FAILED:");
      console.log(error.message);

      /*
       * Don't allow one bad page to kill the crawler.
       */

      if (page) {
        await page.close().catch(() => {});
      }

      if (context) {
        await context.close().catch(() => {});
      }

      if (attempt < MAX_RETRIES) {
        console.log("Retrying...");
      }
    }
  }

  console.log("");
  console.log("FAILED TO CRAWL:");
  console.log(
    lastError ? lastError.message : "Unknown error"
  );

  return null;
}

/*
|--------------------------------------------------------------------------
| Save crawler output
|--------------------------------------------------------------------------
*/

function saveResults() {
  const output = {
    crawler: {
      startUrl: START_URL,

      maxPages: MAX_PAGES,

      maxDepth: MAX_DEPTH,

      generatedAt:
        new Date().toISOString(),

      pagesCrawled:
        results.length,

      uniqueUrlsVisited:
        visited.size,

      remainingQueue:
        queue.length,

      totalChunks:
        ragChunks.length,
    },

    pages: results,

    ragChunks,
  };

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(output, null, 2),
    "utf8"
  );
}

/*
|--------------------------------------------------------------------------
| Crawl
|--------------------------------------------------------------------------
*/

async function crawl() {
  console.log("");
  console.log("#################################");
  console.log("NBE CRAWLER + RAG PREPROCESSOR");
  console.log("#################################");

  console.log("");
  console.log(`START URL: ${START_URL}`);
  console.log(`MAX PAGES: ${MAX_PAGES}`);
  console.log(`MAX DEPTH: ${MAX_DEPTH}`);

  /*
   * Initialize queue.
   */

  addToQueue(
    START_URL,
    0
  );

  const browser = await chromium.launch({
    headless: true,

    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  try {
    while (
      queue.length > 0 &&
      visited.size < MAX_PAGES
    ) {
      const item = queue.shift();

      if (!item) {
        break;
      }

      const {
        url,
        depth,
      } = item;

      /*
       * Remove from queued set.
       */

      queued.delete(url);

      /*
       * Don't crawl twice.
       */

      if (visited.has(url)) {
        continue;
      }

      /*
       * Don't exceed limits.
       */

      if (depth > MAX_DEPTH) {
        continue;
      }

      /*
       * Mark visited BEFORE crawling.
       */

      visited.add(url);

      /*
       * Status.
       */

      console.log("");
      console.log("#################################");
      console.log("CRAWLER STATUS");
      console.log("#################################");

      console.log(
        `Visited: ${visited.size}`
      );

      console.log(
        `Queue: ${queue.length}`
      );

      console.log(
        `Pages: ${results.length}`
      );

      console.log(
        `Depth: ${depth}`
      );

      /*
       * Crawl page.
       */

      await scrapePage(
        browser,
        url,
        depth
      );
    }
  } finally {
    await browser.close().catch(() => {});
  }

  /*
   * Final save.
   */

  saveResults();

  console.log("");
  console.log("#################################");
  console.log("CRAWL COMPLETE");
  console.log("#################################");

  console.log(
    `Pages crawled: ${results.length}`
  );

  console.log(
    `Unique URLs visited: ${visited.size}`
  );

  console.log(
    `Remaining queue: ${queue.length}`
  );

  console.log(
    `Total RAG chunks: ${ragChunks.length}`
  );

  console.log("");
  console.log(
    `Saved to: ${OUTPUT_FILE}`
  );
}

/*
|--------------------------------------------------------------------------
| Handle Ctrl+C gracefully
|--------------------------------------------------------------------------
*/

process.on("SIGINT", () => {
  console.log("");
  console.log("");
  console.log("#################################");
  console.log("CRAWLER INTERRUPTED");
  console.log("#################################");

  saveResults();

  console.log(
    `Pages saved: ${results.length}`
  );

  console.log(
    `Chunks saved: ${ragChunks.length}`
  );

  console.log(
    `Saved to: ${OUTPUT_FILE}`
  );

  process.exit(0);
});

/*
|--------------------------------------------------------------------------
| Start
|--------------------------------------------------------------------------
*/

crawl().catch((error) => {
  console.error("");
  console.error("#################################");
  console.error("FATAL CRAWLER ERROR");
  console.error("#################################");

  console.error(error);

  saveResults();

  process.exit(1);
});