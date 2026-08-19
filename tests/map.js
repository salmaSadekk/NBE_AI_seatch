require("dotenv").config();

const { FirecrawlClient } = require("@mendable/firecrawl-js");

const firecrawl = new FirecrawlClient({
    apiKey: "fc-3fdcf2261fc64bea959b6eb856ee9c6f",
});

const BASE_URL = "https://www.nbe.com.eg/";

async function main() {
    try {
        console.log("======================================");
        console.log("Mapping NBE website...");
        console.log("======================================");

        // Discover URLs
        const mapResult = await firecrawl.mapUrl(BASE_URL);

        console.log(`\nDiscovered ${mapResult.links.length} URLs:\n`);

        mapResult.links.forEach((link, index) => {
            console.log(`${index + 1}. ${link.url}`);
        });

        // Test first 10 discovered pages
        const sampleSize = Math.min(10, mapResult.links.length);

        console.log("\n======================================");
        console.log(`Testing ${sampleSize} discovered pages...`);
        console.log("======================================");

        for (let i = 0; i < sampleSize; i++) {
            const url = mapResult.links[i].url;

            try {
                console.log(`\n[${i + 1}/${sampleSize}] ${url}`);

                const result = await firecrawl.scrapeUrl(url, {
                    formats: ["markdown"],
                });

                const markdown = result.markdown || "";

                const wordCount = markdown
                    .trim()
                    .split(/\s+/)
                    .filter(Boolean)
                    .length;

                if (wordCount > 50) {
                    console.log(`✅ SUCCESS - ${wordCount} words`);
                } else {
                    console.log(`⚠️ LOW CONTENT - ${wordCount} words`);
                }
            } catch (error) {
                console.log("❌ FAILED");
                console.log(error.message);
            }
        }

        console.log("\n======================================");
        console.log("Test complete");
        console.log("======================================");
    } catch (error) {
        console.error("\n❌ Firecrawl error:");
        console.error(error.message);
    }
}

main();