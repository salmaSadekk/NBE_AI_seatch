const { chromium } = require("playwright");
const fs = require("fs");

const URL =
  "https://www.nbe.com.eg/NBE/E/#/EN/ProductDetails?inParams=%7B%22CategoryID%22%3A%2250%22%2C%22ProductID%22%3A%2215514%22%7D";

async function testSinglePage() {
  console.log("=================================");
  console.log("SINGLE PAGE TEST");
  console.log("=================================");
  console.log(URL);

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  const context = await browser.newContext({
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

      "Accept-Language": "en-US,en;q=0.9",

      "Upgrade-Insecure-Requests": "1",
    },
  });

  const page = await context.newPage();

  // -----------------------------------------
  // Log requests
  // -----------------------------------------

  page.on("request", (request) => {
    const requestUrl = request.url();

    if (
      requestUrl.includes("api") ||
      requestUrl.toLowerCase().includes("product")
    ) {
      console.log("");
      console.log("REQUEST:");
      console.log(request.method(), requestUrl);
    }
  });

  // -----------------------------------------
  // Log responses
  // -----------------------------------------

  page.on("response", (response) => {
    const responseUrl = response.url();

    if (
      responseUrl.includes("api") ||
      responseUrl.toLowerCase().includes("product")
    ) {
      console.log("");
      console.log("RESPONSE:");
      console.log(response.status(), responseUrl);
    }
  });

  try {
    // -----------------------------------------
    // Load page
    // -----------------------------------------

    const response = await page.goto(URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    console.log("");
    console.log("HTTP STATUS:", response ? response.status() : "null");

    // Give Angular time to render
    console.log("Waiting for Angular...");
    await page.waitForTimeout(5000);

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

    // Extra time for lazy content
    await page.waitForTimeout(3000);

    // -----------------------------------------
    // Inspect the page
    // -----------------------------------------

    const information = await page.evaluate(() => {
      const bodyText = document.body?.innerText || "";

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
        "body",
      ];

      const containers = [];

      for (const selector of selectors) {
        const element = document.querySelector(selector);

        if (element) {
          const text = element.innerText || "";

          containers.push({
            selector,
            textLength: text.length,
            containsParameters: /parameters/i.test(text),
            textPreview: text.substring(0, 1000),
          });
        }
      }

      // Find every element containing "Parameters"
      const parameterElements = [];

      for (const element of document.querySelectorAll("*")) {
        const text = (element.innerText || "").trim();

        if (
          text.toLowerCase().includes("parameters") &&
          text.length < 3000
        ) {
          parameterElements.push({
            tag: element.tagName,
            id: element.id,
            className:
              typeof element.className === "string"
                ? element.className
                : "",
            text: text.substring(0, 2000),
          });
        }
      }

      return {
        title: document.title,

        url: window.location.href,

        hash: window.location.hash,

        bodyTextLength: bodyText.length,

        bodyContainsParameters:
          /parameters/i.test(bodyText),

        bodyText,

        containers,

        parameterElements,
      };
    });

    // -----------------------------------------
    // Print results
    // -----------------------------------------

    console.log("");
    console.log("=================================");
    console.log("PAGE INFORMATION");
    console.log("=================================");

    console.log("Title:", information.title);
    console.log("URL:", information.url);
    console.log("Hash:", information.hash);
    console.log("Body text length:", information.bodyTextLength);

    console.log(
      "Body contains 'Parameters':",
      information.bodyContainsParameters
    );

    console.log("");
    console.log("=================================");
    console.log("CONTAINERS");
    console.log("=================================");

    for (const container of information.containers) {
      console.log("");
      console.log("Selector:", container.selector);
      console.log("Text length:", container.textLength);
      console.log(
        "Contains Parameters:",
        container.containsParameters
      );
      console.log("Preview:");
      console.log(container.textPreview);
    }

    console.log("");
    console.log("=================================");
    console.log("PARAMETERS ELEMENTS");
    console.log("=================================");

    console.log(
      JSON.stringify(
        information.parameterElements,
        null,
        2
      )
    );

    // -----------------------------------------
    // Save complete body text
    // -----------------------------------------

    fs.writeFileSync(
      "/tmp/single-page-body.txt",
      information.bodyText,
      "utf8"
    );

    // -----------------------------------------
    // Save complete diagnostic JSON
    // -----------------------------------------

    fs.writeFileSync(
      "/tmp/single-page-result.json",
      JSON.stringify(information, null, 2),
      "utf8"
    );

    // -----------------------------------------
    // Save screenshot
    // -----------------------------------------

    await page.screenshot({
      path: "/tmp/single-page.png",
      fullPage: true,
    });

    console.log("");
    console.log("=================================");
    console.log("FILES");
    console.log("=================================");

    console.log("/tmp/single-page-body.txt");
    console.log("/tmp/single-page-result.json");
    console.log("/tmp/single-page.png");

    console.log("");
    console.log("TEST COMPLETE");
  } catch (error) {
    console.error("");
    console.error("=================================");
    console.error("TEST FAILED");
    console.error("=================================");
    console.error(error);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

testSinglePage();