require("dotenv").config();

const fs = require("fs");
const { FirecrawlClient } = require("@mendable/firecrawl-js");

const firecrawl = new FirecrawlClient({
    apiKey:  "fc-3fdcf2261fc64bea959b6eb856ee9c6f",
});

const BASE_URL = "https://www.nbe.com.eg/";

// How many words per chunk
const CHUNK_SIZE = 500;

// How many words overlap between chunks
const CHUNK_OVERLAP = 50;

function chunkText(text, chunkSize = 500, overlap = 50) {
    const words = text
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    const chunks = [];

    let start = 0;

    while (start < words.length) {
        const end = Math.min(start + chunkSize, words.length);

        const chunk = words.slice(start, end).join(" ");

        chunks.push(chunk);

        // Move forward but keep some overlap
        start += chunkSize - overlap;
    }

    return chunks;
}

async function main() {
    try {
        console.log("======================================");
        console.log("Mapping NBE website...");
        console.log("======================================");

        // 1. Discover URLs
        const mapResult = await firecrawl.mapUrl(BASE_URL);

        console.log(`\nDiscovered ${mapResult.links.length} URLs`);

        // For now, only test the first 10
        const sampleSize = Math.min(10, mapResult.links.length);

        const allChunks = [];

        console.log("\n======================================");
        console.log(`Scraping ${sampleSize} pages...`);
        console.log("======================================");

        for (let i = 0; i < sampleSize; i++) {
            const url = mapResult.links[i].url;

            try {
                console.log(`\n[${i + 1}/${sampleSize}] ${url}`);

                // 2. Scrape page
                const result = await firecrawl.scrapeUrl(url, {
                    formats: ["markdown"],
                });

                const markdown = result.markdown || "";

                if (!markdown.trim()) {
                    console.log("⚠️ No content found");
                    continue;
                }

                const wordCount = markdown
                    .trim()
                    .split(/\s+/)
                    .filter(Boolean)
                    .length;

                console.log(`✅ Scraped ${wordCount} words`);

                // 3. Create chunks
                const chunks = chunkText(
                    markdown,
                    CHUNK_SIZE,
                    CHUNK_OVERLAP
                );

                console.log(`📦 Created ${chunks.length} chunks`);

                // 4. Add metadata to every chunk
                chunks.forEach((chunk, index) => {
                    allChunks.push({
                        id: `${i + 1}-${index + 1}`,
                        source: url,
                        chunkIndex: index + 1,
                        content: chunk,
                    });
                });

            } catch (error) {
                console.log("❌ FAILED");
                console.log(error.message);
            }
        }

        // 5. Save chunks
        fs.writeFileSync(
            "chunks.json",
            JSON.stringify(allChunks, null, 2),
            "utf8"
        );

        console.log("\n======================================");
        console.log("CHUNKING COMPLETE");
        console.log("======================================");

        console.log(`Pages processed: ${sampleSize}`);
        console.log(`Total chunks: ${allChunks.length}`);

        console.log("\nChunks saved to:");
        console.log("chunks.json");

        // 6. Show an example
        if (allChunks.length > 0) {
            console.log("\n======================================");
            console.log("EXAMPLE CHUNK");
            console.log("======================================");

           // console.log(`ID: ${allChunks[0].id}`);
           // console.log(`Source: ${allChunks[0].source}`);
            //console.log(`Chunk: ${allChunks[0].chunkIndex}`);

           // console.log("\nContent:");
          //  console.log(allChunks[0].content);

          console.log(JSON.stringify(allChunks[0], null, 2));
        }

    } catch (error) {
        console.error("\n❌ Firecrawl error:");
        console.error(error);
    }
}

main();