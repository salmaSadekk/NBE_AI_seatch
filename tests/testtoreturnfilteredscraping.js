require("dotenv").config();

const fs = require("fs");
const { FirecrawlClient } = require("@mendable/firecrawl-js");

const firecrawl = new FirecrawlClient({
    apiKey: "fc-3fdcf2261fc64bea959b6eb856ee9c6f",
});

const BASE_URL = "https://www.nbe.com.eg/";

// Chunk settings
const CHUNK_SIZE = 700;
const CHUNK_OVERLAP = 100;

// Number of pages to test
const MAX_PAGES = 10;

/**
 * Remove navigation, images, URLs and other
 * website noise from Firecrawl Markdown.
 */
function cleanMarkdown(markdown) {
    let text = markdown;

    // --------------------------------------------------
    // 1. Remove Markdown images
    // Example:
    // ![image](https://example.com/image.png)
    // --------------------------------------------------
    text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");

    // --------------------------------------------------
    // 2. Remove URLs
    // --------------------------------------------------
    text = text.replace(/https?:\/\/\S+/g, "");

    // --------------------------------------------------
    // 3. Remove common NBE navigation/UI elements
    // --------------------------------------------------
    const navigationItems = [
        "Welcome",
        "View profile",
        "Notifications",
        "Favorite list",
        "Follow up",
        "Logout",
        "Retail",
        "Corporate",
        "SMEs",
        "Platinum",

        "About Us",
        "Sustainability",
        "Exchange Rate",
        "Become An NBE Customer",
        "Self Services",
        "Financing P.O.S merchants",
        "Mobile Bill Payments",

        "Facebook",
        "Instagram",
        "WhatsApp",
        "Youtube",

        "Al Ahly Net",
        "Al Ahly Points",
        "ATM",
        "Branch Locator",
        "Ahly Discount and Installment Offers",

        "Call Us Locally: 19623",
        "Internationally: 0020219623 / 0020225941200",

        "Cards Limits",
        "How to Activate Cards",
        "Consumer Protection",

        "Retail Segments",
        "Gold",
        "Titanium",

        "Accounts",
        "Current Accounts",
        "Saving Local Currency",
        "Saving Foreign Currency",
        "Accounts Services",

        "Foreign Currency Certificates",
        "Local Currency Certificates",

        "Belady Certificates",
        "Belady 1 Year Certificates",
        "Belady 3 Years Certificates",
        "Belady 5 Years Certificates",

        "Belady USD",
        "Belady Euro",
        "Belady Sterling Pound",
        "Belady Australian Dollar",

        "Investment Certificates",
        "Investment certificate group A",
        "Investment certificate Group B 1 year",
        "Investment certificate group B 3 years",
        "Investment certificate group C",

        "Time Deposits",
        "Time Deposits - Local Currency",
        "Time Deposits - Foreign Currencies",

        "Credit Cards",
        "MasterCard standard",
        "Visa classic",
        "MasterCard Egyptair",
        "Visa gold",
        "MasterCard titanium",
        "UEFA Champions League Mastercard",
        "Visa platinum",
        "MasterCard platinum",
        "Mastercard World",
        "Visa Signature",
        "Mastercard World Elite",
        "Visa Infinite",

        "Debit Cards",
        "USD Visa Platinum",
        "(Meeza) Debit Card",
        "Classic debit card",
        "Gold debit card",
        "Titanium debit card",
        "Platinum debit card",

        "Prepaid Cards",
        "NBE ' meeza' prepaid card",
        "NBE prepaid card",
        "Unified Meeza Prepaid Card for University Students",

        "Cash Loans With Salary Transfer",
        "Cash Loans Without Salary Transfer",
        "Cash Loans For Business Owners And Self-Employed",
        "Personal Cash Loan For Pensioners",
        "Personal Cash Loan For Egyptians Working Abroad",

        "Governmental & public sector employees",
        "Petroleum sector employees",
        "Private & multinational Co's employees listed in NBE",
        "For bankers",
        "Business owners and self-employed",
        "Pensioners",

        "Digital Banking",
        "Al Ahly Mobile",
        "Apple Pay",
        "NBE Phonecash",
        "Al Ahly E-Branch",
        "Al Ahly E-Shopping",
        "Bus Branch",
        "Al Ahly Whatsapp",
        "NBE Chatbot Service",
        "Al Ahly Phone",

        "Services",
        "Securities",
        "Investor trustees",
        "Expatriates Transfers",
        "Bancassurance",
        "Transfers",

        "Auto loan",
        "CBE Initiative Mortgage",
        "Fees And Charges",
    ];

    for (const item of navigationItems) {
        text = text.replaceAll(item, "");
    }

    // --------------------------------------------------
    // 4. Remove Markdown links but preserve their text
    //
    // [text](url)
    // becomes:
    // text
    // --------------------------------------------------
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

    // --------------------------------------------------
    // 5. Remove excessive Markdown characters
    // --------------------------------------------------
    text = text.replace(/[`*_~]/g, "");

    // Remove pipes and caret characters
    text = text.replace(/[|^]/g, " ");

    // --------------------------------------------------
    // 6. Remove excessive whitespace
    // --------------------------------------------------
    text = text.replace(/\s+/g, " ");

    return text.trim();
}

/**
 * Split text into overlapping chunks.
 */
function chunkText(text, chunkSize, overlap) {
    const words = text
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    const chunks = [];

    let start = 0;

    while (start < words.length) {
        const end = Math.min(start + chunkSize, words.length);

        const chunk = words
            .slice(start, end)
            .join(" ");

        chunks.push(chunk);

        // Move forward while keeping overlap
        start += chunkSize - overlap;
    }

    return chunks;
}

/**
 * Count words.
 */
function countWords(text) {
    return text
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .length;
}

/**
 * Main program.
 */
async function main() {
    try {
        console.log("======================================");
        console.log("       NBE RAG DATA PREPARATION");
        console.log("======================================");

        // --------------------------------------------------
        // 1. Map website
        // --------------------------------------------------

        console.log("\nMapping NBE website...");

        const mapResult = await firecrawl.mapUrl(BASE_URL);

        console.log(
            `Discovered ${mapResult.links.length} URLs`
        );

        // --------------------------------------------------
        // 2. Select pages to scrape
        // --------------------------------------------------

        const pagesToScrape = mapResult.links.slice(
            0,
            Math.min(MAX_PAGES, mapResult.links.length)
        );

        console.log(
            `Testing ${pagesToScrape.length} pages`
        );

        // --------------------------------------------------
        // 3. Store all chunks
        // --------------------------------------------------

        const allChunks = [];

        // --------------------------------------------------
        // 4. Scrape pages
        // --------------------------------------------------

        for (let i = 0; i < pagesToScrape.length; i++) {

            const url = pagesToScrape[i].url;

            console.log("\n--------------------------------------");
            console.log(
                `[${i + 1}/${pagesToScrape.length}] ${url}`
            );
            console.log("--------------------------------------");

            try {

                // Scrape page
                const result = await firecrawl.scrapeUrl(
                    url,
                    {
                        formats: ["markdown"],
                    }
                );

                const markdown = result.markdown || "";

                if (!markdown.trim()) {
                    console.log("⚠️ No content found");
                    continue;
                }

                const originalWordCount =
                    countWords(markdown);

                console.log(
                    `Original content: ${originalWordCount} words`
                );

                // --------------------------------------------------
                // Clean content
                // --------------------------------------------------

                const cleanedText =
                    cleanMarkdown(markdown);

                const cleanedWordCount =
                    countWords(cleanedText);

                console.log(
                    `Cleaned content: ${cleanedWordCount} words`
                );

                if (cleanedWordCount < 20) {
                    console.log(
                        "⚠️ Very little useful content after cleaning"
                    );

                    continue;
                }

                // --------------------------------------------------
                // Create chunks
                // --------------------------------------------------

                const chunks = chunkText(
                    cleanedText,
                    CHUNK_SIZE,
                    CHUNK_OVERLAP
                );

                console.log(
                    `Created ${chunks.length} chunks`
                );

                // --------------------------------------------------
                // Add metadata
                // --------------------------------------------------

                chunks.forEach((chunk, index) => {

                    allChunks.push({
                        id: `${i + 1}-${index + 1}`,

                        source: url,

                        chunkIndex: index + 1,

                        totalChunks: chunks.length,

                        content: chunk,
                    });

                });

            } catch (error) {

                console.log("❌ FAILED");

                console.log(
                    error.message
                );
            }
        }

        // --------------------------------------------------
        // 5. Save chunks
        // --------------------------------------------------

        fs.writeFileSync(
            "chunks.json",
            JSON.stringify(
                allChunks,
                null,
                2
            ),
            "utf8"
        );

        // --------------------------------------------------
        // 6. Summary
        // --------------------------------------------------

        console.log("\n======================================");
        console.log("          CHUNKING COMPLETE");
        console.log("======================================");

        console.log(
            `Pages processed: ${pagesToScrape.length}`
        );

        console.log(
            `Total chunks: ${allChunks.length}`
        );

        console.log(
            "\nSaved to: chunks.json"
        );

        // --------------------------------------------------
        // 7. Display first chunk
        // --------------------------------------------------

        if (allChunks.length > 0) {

            console.log("\n======================================");
            console.log("        FIRST RAG CHUNK");
            console.log("======================================");

            console.log(
                JSON.stringify(
                    allChunks[0],
                    null,
                    2
                )
            );
        }

    } catch (error) {

        console.error("\n❌ Firecrawl error:");

        console.error(
            error.message
        );
    }
}

main();