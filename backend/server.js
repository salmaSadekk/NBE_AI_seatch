const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

// ============================================================
// CONFIGURATION
// ============================================================

const PORT = process.env.PORT || 4000;

const QDRANT_URL =
    process.env.QDRANT_URL || "http://localhost:6333";

const OLLAMA_URL =
    process.env.OLLAMA_URL || "http://localhost:11434";

const EMBEDDING_MODEL =
    process.env.EMBEDDING_MODEL || "nomic-embed-text";

const LLM_MODEL =
    process.env.LLM_MODEL || "qwen2.5:3b";

const COLLECTION_NAME = "nbe_chunks";

const DATA_FILE = path.join(
    __dirname,
    "data",
    "crawler-output.json"
);

// ============================================================
// GLOBAL DATA
// ============================================================

let crawlerData = null;
let allChunks = [];
let pageContentMap = new Map();

// ============================================================
// TEXT UTILITIES
// ============================================================

function cleanText(text) {
    return String(text || "")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeWords(text) {
    return cleanText(text)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter(Boolean);
}

// Generic stop words.
// Intentionally not domain-specific.
const STOP_WORDS = new Set([
    "a",
    "an",
    "the",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "do",
    "does",
    "did",
    "what",
    "which",
    "who",
    "whom",
    "where",
    "when",
    "why",
    "how",
    "can",
    "could",
    "would",
    "should",
    "may",
    "might",
    "will",
    "shall",
    "i",
    "we",
    "you",
    "he",
    "she",
    "they",
    "it",
    "this",
    "that",
    "these",
    "those",
    "of",
    "for",
    "to",
    "in",
    "on",
    "at",
    "by",
    "with",
    "from",
    "and",
    "or",
    "as",
    "about",
    "offer",
    "offers",
    "provide",
    "provides",
    "available"
]);

function getMeaningfulQueryWords(query) {
    return normalizeWords(query)
        .filter(word => !STOP_WORDS.has(word));
}

// ============================================================
// ARABIC / MIXED-LANGUAGE DETECTION
// ============================================================

function containsArabic(text) {
    return /[\u0600-\u06FF]/.test(text);
}

// ============================================================
// LIST QUESTION DETECTION
// ============================================================

function isListQuestion(query) {
    const text = cleanText(query).toLowerCase();

    const englishPatterns = [
        "what credit cards",
        "which credit cards",
        "what cards",
        "which cards",
        "what products",
        "which products",
        "what services",
        "which services",
        "what accounts",
        "which accounts",
        "what loans",
        "which loans",
        "list the",
        "list all",
        "what are the",
        "which are the",
        "what does nbe offer",
        "what does nbe provide"
    ];

    const arabicPatterns = [
        "ما هي",
        "ما هى",
        "ما هي البطاقات",
        "ما هى البطاقات",
        "ما هي المنتجات",
        "ما هى المنتجات",
        "ما هي الخدمات",
        "ما هى الخدمات",
        "ما هي الحسابات",
        "ما هى الحسابات",
        "ما هي القروض",
        "ما هى القروض",
        "اذكر",
        "قائمة"
    ];

    return (
        englishPatterns.some(pattern =>
            text.includes(pattern)
        ) ||
        arabicPatterns.some(pattern =>
            text.includes(pattern)
        )
    );
}

// ============================================================
// LOAD CRAWLER DATA
// ============================================================

function loadCrawlerData() {
    if (!fs.existsSync(DATA_FILE)) {
        throw new Error(
            `Crawler data file not found: ${DATA_FILE}`
        );
    }

    crawlerData = JSON.parse(
        fs.readFileSync(DATA_FILE, "utf8")
    );

    allChunks = createChunks(
        crawlerData.pages || []
    );

    pageContentMap = buildPageContentMap();

    console.log(
        `Loaded ${crawlerData.pages?.length || 0} crawler pages`
    );

    console.log(
        `Created ${allChunks.length} searchable chunks`
    );
}

// ============================================================
// SENTENCE-AWARE CHUNKING
// ============================================================

function splitIntoSentences(text) {
    const cleaned = cleanText(text);

    if (!cleaned) {
        return [];
    }

    return cleaned
        .split(/(?<=[.!?؟])\s+/)
        .map(sentence => sentence.trim())
        .filter(Boolean);
}

function createChunks(pages) {
    const chunks = [];

    const TARGET_CHUNK_SIZE = 1200;
    const OVERLAP_SIZE = 200;

    for (const page of pages) {
        const text = cleanText(page.text);

        if (!text) {
            continue;
        }

        const sentences = splitIntoSentences(text);

        if (sentences.length === 0) {
            continue;
        }

        let currentChunk = "";
        let chunkIndex = 0;

        for (const sentence of sentences) {
            const proposed =
                currentChunk
                    ? `${currentChunk} ${sentence}`
                    : sentence;

            if (
                proposed.length <= TARGET_CHUNK_SIZE ||
                !currentChunk
            ) {
                currentChunk = proposed;
            } else {
                chunks.push({
                    chunkId:
                        `${page.pageId}-chunk-${chunkIndex}`,
                    pageId: page.pageId,
                    url: page.url || "",
                    title:
                        page.title ||
                        "National Bank of Egypt",
                    text: currentChunk,
                    depth: page.depth,
                    container: page.container
                });

                chunkIndex++;

                const overlapText =
                    currentChunk.slice(
                        Math.max(
                            0,
                            currentChunk.length -
                                OVERLAP_SIZE
                        )
                    );

                currentChunk =
                    `${overlapText} ${sentence}`.trim();
            }
        }

        if (currentChunk) {
            chunks.push({
                chunkId:
                    `${page.pageId}-chunk-${chunkIndex}`,
                pageId: page.pageId,
                url: page.url || "",
                title:
                    page.title ||
                    "National Bank of Egypt",
                text: currentChunk,
                depth: page.depth,
                container: page.container
            });
        }
    }

    return chunks;
}

// ============================================================
// PAGE CONTENT MAP
// ============================================================

function buildPageContentMap() {
    const map = new Map();

    for (const chunk of allChunks) {
        if (!map.has(chunk.pageId)) {
            map.set(chunk.pageId, {
                pageId: chunk.pageId,
                title: chunk.title,
                url: chunk.url,
                chunks: []
            });
        }

        map.get(chunk.pageId).chunks.push(chunk);
    }

    return map;
}

// ============================================================
// OLLAMA EMBEDDINGS
// ============================================================

async function generateEmbedding(text) {
    const response = await fetch(
        `${OLLAMA_URL}/api/embed`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: EMBEDDING_MODEL,
                input: text
            })
        }
    );

    if (!response.ok) {
        throw new Error(
            `Ollama embedding failed: ${response.status}`
        );
    }

    const data = await response.json();

    if (
        !data.embeddings ||
        !Array.isArray(data.embeddings) ||
        !data.embeddings[0]
    ) {
        throw new Error(
            "Invalid embedding response from Ollama"
        );
    }

    return data.embeddings[0];
}

// ============================================================
// QDRANT COLLECTION
// ============================================================

async function ensureCollection() {
    const response = await fetch(
        `${QDRANT_URL}/collections/${COLLECTION_NAME}`
    );

    if (response.ok) {
        console.log(
            `Qdrant collection "${COLLECTION_NAME}" already exists`
        );
        return;
    }

    console.log(
        `Creating Qdrant collection "${COLLECTION_NAME}"`
    );

    const createResponse = await fetch(
        `${QDRANT_URL}/collections/${COLLECTION_NAME}`,
        {
            method: "PUT",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                vectors: {
                    size: 768,
                    distance: "Cosine"
                }
            })
        }
    );

    if (!createResponse.ok) {
        const text = await createResponse.text();

        throw new Error(
            `Failed to create Qdrant collection: ${text}`
        );
    }
}

// ============================================================
// QDRANT INGESTION
// ============================================================

async function ingestChunks() {
    await ensureCollection();

    console.log(
        `Starting ingestion of ${allChunks.length} chunks...`
    );

    const BATCH_SIZE = 10;

    for (
        let start = 0;
        start < allChunks.length;
        start += BATCH_SIZE
    ) {
        const batch =
            allChunks.slice(
                start,
                start + BATCH_SIZE
            );

        const points = [];

        for (const chunk of batch) {
            const embedding =
                await generateEmbedding(
                    chunk.text
                );

            points.push({
                id: stringToNumericId(
                    chunk.chunkId
                ),
                vector: embedding,
                payload: {
                    chunkId: chunk.chunkId,
                    pageId: chunk.pageId,
                    title: chunk.title,
                    url: chunk.url,
                    text: chunk.text,
                    depth: chunk.depth,
                    container: chunk.container
                }
            });
        }

        const response = await fetch(
            `${QDRANT_URL}/collections/${COLLECTION_NAME}/points?wait=true`,
            {
                method: "PUT",
                headers: {
                    "Content-Type":
                        "application/json"
                },
                body: JSON.stringify({
                    points
                })
            }
        );

        if (!response.ok) {
            const text =
                await response.text();

            throw new Error(
                `Qdrant ingestion failed: ${text}`
            );
        }

        console.log(
            `Ingested ${Math.min(
                start + BATCH_SIZE,
                allChunks.length
            )}/${allChunks.length}`
        );
    }

    return {
        pageCount:
            crawlerData.pages?.length || 0,
        chunkCount:
            allChunks.length,
        storedInQdrant:
            allChunks.length,
        embeddingModel:
            EMBEDDING_MODEL,
        embeddingDimension:
            768,
        collection:
            COLLECTION_NAME
    };
}

// ============================================================
// STRING → NUMERIC QDRANT ID
// ============================================================

function stringToNumericId(value) {
    let hash = 0;

    for (let i = 0; i < value.length; i++) {
        hash =
            (hash << 5) -
            hash +
            value.charCodeAt(i);

        hash |= 0;
    }

    return Math.abs(hash);
}

// ============================================================
// LOAD STORED QDRANT VECTORS
// ============================================================

async function loadQdrantVectors() {
    const vectors = new Map();

    let offset = null;

    while (true) {
        const body = {
            limit: 100,
            with_payload: true,
            with_vector: true
        };

        if (offset !== null) {
            body.offset = offset;
        }

        const response = await fetch(
            `${QDRANT_URL}/collections/${COLLECTION_NAME}/points/scroll`,
            {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/json"
                },
                body: JSON.stringify(body)
            }
        );

        if (!response.ok) {
            const text =
                await response.text();

            throw new Error(
                `Qdrant vector loading failed: ${text}`
            );
        }

        const data =
            await response.json();

        const points =
            data.result?.points || [];

        for (const point of points) {
            const chunkId =
                point.payload?.chunkId;

            if (
                chunkId &&
                Array.isArray(point.vector)
            ) {
                vectors.set(
                    chunkId,
                    point.vector
                );
            }
        }

        const nextOffset =
            data.result?.next_page_offset;

        if (
            nextOffset === null ||
            nextOffset === undefined
        ) {
            break;
        }

        offset = nextOffset;
    }

    console.log(
        `Loaded ${vectors.size} vectors from Qdrant`
    );

    return vectors;
}

// ============================================================
// COSINE SIMILARITY
// ============================================================

function cosineSimilarity(a, b) {
    if (
        !Array.isArray(a) ||
        !Array.isArray(b) ||
        a.length !== b.length
    ) {
        return 0;
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    if (
        normA === 0 ||
        normB === 0
    ) {
        return 0;
    }

    return (
        dot /
        (
            Math.sqrt(normA) *
            Math.sqrt(normB)
        )
    );
}

// ============================================================
// URL TOKENIZATION
// ============================================================

function tokenizeUrl(url) {
    return cleanText(url)
        .replace(
            /([a-z])([A-Z])/g,
            "$1 $2"
        )
        .replace(
            /([A-Z])([A-Z][a-z])/g,
            "$1 $2"
        )
        .replace(
            /[^a-zA-Z0-9]+/g,
            " "
        )
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
}

// ============================================================
// LEXICAL SCORE
// ============================================================

function calculateLexicalScore(
    query,
    result
) {
    const queryWords =
        getMeaningfulQueryWords(query);

    if (queryWords.length === 0) {
        return 0;
    }

    const titleWords =
        new Set(
            normalizeWords(
                result.title || ""
            )
        );

    const textWords =
        new Set(
            normalizeWords(
                result.text || ""
            )
        );

    const urlWords =
        new Set(
            tokenizeUrl(
                result.url || ""
            )
        );

    let score = 0;

    let titleMatches = 0;
    let textMatches = 0;
    let urlMatches = 0;

    for (const word of queryWords) {
        if (titleWords.has(word)) {
            titleMatches++;
        }

        if (textWords.has(word)) {
            textMatches++;
        }

        if (urlWords.has(word)) {
            urlMatches++;
        }
    }

    score += titleMatches * 2;
    score += textMatches * 1;
    score += urlMatches * 0.5;

    const normalizedQuery =
        cleanText(query).toLowerCase();

    const normalizedTitle =
        cleanText(
            result.title || ""
        ).toLowerCase();

    const normalizedText =
        cleanText(
            result.text || ""
        ).toLowerCase();

    if (
        normalizedTitle.includes(
            normalizedQuery
        )
    ) {
        score += 4;
    }

    if (
        normalizedText.includes(
            normalizedQuery
        )
    ) {
        score += 4;
    }

    // Adjacent meaningful words
    for (
        let i = 0;
        i < queryWords.length - 1;
        i++
    ) {
        const phrase =
            `${queryWords[i]} ${queryWords[i + 1]}`;

        if (
            normalizedTitle.includes(
                phrase
            )
        ) {
            score += 3;
        }

        if (
            normalizedText.includes(
                phrase
            )
        ) {
            score += 2;
        }
    }

    return score;
}

// ============================================================
// TITLE SCORE
// ============================================================

function calculateTitleScore(
    query,
    result
) {
    const queryWords =
        getMeaningfulQueryWords(query);

    if (queryWords.length === 0) {
        return 0;
    }

    const titleWords =
        new Set(
            normalizeWords(
                result.title || ""
            )
        );

    let matches = 0;

    for (const word of queryWords) {
        if (titleWords.has(word)) {
            matches++;
        }
    }

    return (
        matches /
        queryWords.length
    );
}

// ============================================================
// URL SCORE
// ============================================================

function calculateUrlScore(
    query,
    result
) {
    const queryWords =
        getMeaningfulQueryWords(query);

    if (queryWords.length === 0) {
        return 0;
    }

    const urlWords =
        new Set(
            tokenizeUrl(
                result.url || ""
            )
        );

    let matches = 0;

    for (const word of queryWords) {
        if (urlWords.has(word)) {
            matches++;
        }
    }

    return (
        matches /
        queryWords.length
    );
}

// ============================================================
// REMOVE DUPLICATE CHUNKS
// ============================================================

function removeDuplicateChunks(results) {
    const seen = new Set();

    return results.filter(result => {
        const key =
            `${result.pageId}::${cleanText(
                result.text
            )}`;

        if (seen.has(key)) {
            return false;
        }

        seen.add(key);

        return true;
    });
}

// ============================================================
// REMOVE DUPLICATE PAGES
// ============================================================

function removeDuplicatePages(results) {
    const seen = new Set();

    return results.filter(result => {
        const normalizedText =
            cleanText(
                result.text
            ).toLowerCase();

        const key =
            `${result.title}::${normalizedText}`;

        if (seen.has(key)) {
            return false;
        }

        seen.add(key);

        return true;
    });
}

// ============================================================
// QUERY NORMALIZATION
// ============================================================

async function normalizeSearchQuery(query) {
    const cleanedQuery =
        cleanText(query);

    // English-only query:
    // No LLM call required.
    if (!containsArabic(cleanedQuery)) {
        return cleanedQuery;
    }

    console.log(
        `Arabic/mixed query detected: "${cleanedQuery}"`
    );

    const prompt = `
Convert the following user question into a concise English search query
for a National Bank of Egypt (NBE) website knowledge base.

Rules:

1. Return ONLY the English search query.
2. Do not explain anything.
3. Do not answer the question.
4. Preserve important NBE product names.
5. Preserve numbers, currencies, dates and entities.
6. Preserve English product names if they already appear.
7. Keep the exact meaning of the original question.
8. Make the result suitable for semantic search.
9. If the question is partly in English, keep useful English terms.
10. Do not invent product names.

User question:

${cleanedQuery}
`;

    try {
        const response =
            await fetch(
                `${OLLAMA_URL}/api/chat`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json"
                    },
                    body: JSON.stringify({
                        model:
                            LLM_MODEL,
                        stream:
                            false,
                        messages: [
                            {
                                role:
                                    "system",
                                content:
                                    "Convert Arabic or mixed-language questions into concise English search queries. Return only the search query."
                            },
                            {
                                role:
                                    "user",
                                content:
                                    prompt
                            }
                        ],
                        options: {
                            temperature:
                                0,
                            num_predict:
                                100
                        }
                    })
                }
            );

        if (!response.ok) {
            throw new Error(
                `Ollama query normalization failed: ${response.status}`
            );
        }

        const data =
            await response.json();

        const normalizedQuery =
            cleanText(
                data.message?.content ||
                ""
            );

        if (!normalizedQuery) {
            console.warn(
                "Query normalization returned empty result. Using original query."
            );

            return cleanedQuery;
        }

        console.log(
            `Normalized search query: "${normalizedQuery}"`
        );

        return normalizedQuery;

    } catch (error) {
        console.error(
            "Query normalization error:",
            error.message
        );

        return cleanedQuery;
    }
}

// ============================================================
// PAGE-AWARE SEARCH
// ============================================================

async function search(
    query,
    topK = 8,
    retrievalQuery = null
) {
    const cleanedQuery =
        cleanText(query);

    const cleanedRetrievalQuery =
        cleanText(
            retrievalQuery ||
            cleanedQuery
        );

    console.log(
        `Search query: "${cleanedQuery}"`
    );

    if (
        cleanedRetrievalQuery !==
        cleanedQuery
    ) {
        console.log(
            `Retrieval query: "${cleanedRetrievalQuery}"`
        );
    }

    // --------------------------------------------------------
    // Generate query embedding
    // --------------------------------------------------------

    const queryEmbedding =
        await generateEmbedding(
            cleanedRetrievalQuery
        );

    // --------------------------------------------------------
    // Initial Qdrant search
    // --------------------------------------------------------

    const response =
        await fetch(
            `${QDRANT_URL}/collections/${COLLECTION_NAME}/points/search`,
            {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/json"
                },
                body: JSON.stringify({
                    vector:
                        queryEmbedding,
                    limit:
                        15,
                    with_payload:
                        true,
                    with_vector:
                        false
                })
            }
        );

    if (!response.ok) {
        const text =
            await response.text();

        throw new Error(
            `Qdrant search failed: ${text}`
        );
    }

    const data =
        await response.json();

    const qdrantResults =
        data.result || [];

    if (
        qdrantResults.length === 0
    ) {
        return [];
    }

    // --------------------------------------------------------
    // Calculate ranking signals
    // --------------------------------------------------------

    const ranked =
        qdrantResults.map(item => {
            const payload =
                item.payload || {};

            const result = {
                chunkId:
                    payload.chunkId,
                pageId:
                    payload.pageId,
                title:
                    payload.title || "",
                url:
                    payload.url || "",
                text:
                    payload.text || "",
                depth:
                    payload.depth,
                semanticScore:
                    item.score || 0
            };

            const lexicalScore =
                calculateLexicalScore(
                    cleanedRetrievalQuery,
                    result
                );

            const titleScore =
                calculateTitleScore(
                    cleanedRetrievalQuery,
                    result
                );

            const urlScore =
                calculateUrlScore(
                    cleanedRetrievalQuery,
                    result
                );

            const finalScore =
                result.semanticScore +
                lexicalScore * 0.02 +
                titleScore * 0.10 +
                urlScore * 0.03;

            return {
                ...result,
                lexicalScore,
                titleScore,
                urlScore,
                finalScore
            };
        });

    ranked.sort(
        (a, b) =>
            b.finalScore -
            a.finalScore
    );

    // --------------------------------------------------------
    // Identify strongest page
    // --------------------------------------------------------

    const strongestPage =
        ranked[0]?.pageId;

    if (!strongestPage) {
        return removeDuplicateChunks(
            ranked
        ).slice(0, topK);
    }

    console.log(
        `Strongest page: ${strongestPage}`
    );

    // --------------------------------------------------------
    // Load stored vectors.
    //
    // No re-embedding.
    // --------------------------------------------------------

    let storedVectors;

    try {
        storedVectors =
            await loadQdrantVectors();
    } catch (error) {
        console.warn(
            "Could not load stored vectors for page-aware reranking:",
            error.message
        );

        return removeDuplicateChunks(
            ranked
        ).slice(0, topK);
    }

    // --------------------------------------------------------
    // IMPORTANT:
    //
    // Keep retrieval focused on the strongest page.
    //
    // This prevents unrelated pages from polluting the
    // context for category/product questions.
    //
    // Example:
    //
    // "What credit cards does NBE offer?"
    //
    // The Credit Cards page contains the relevant list,
    // so weaker pages such as Phonecash or Al Ahly Net
    // should NOT be included.
    // --------------------------------------------------------

    const candidatePages =
        new Set();

    candidatePages.add(
        strongestPage
    );

    // --------------------------------------------------------
    // Rerank ALL chunks from the strongest page.
    // --------------------------------------------------------

    const pageAwareResults = [];

    const page =
        pageContentMap.get(
            strongestPage
        );

    if (!page) {
        return removeDuplicateChunks(
            ranked
        ).slice(0, topK);
    }

    for (const chunk of page.chunks) {
        const vector =
            storedVectors.get(
                chunk.chunkId
            );

        if (!vector) {
            continue;
        }

        const semanticScore =
            cosineSimilarity(
                queryEmbedding,
                vector
            );

        const lexicalScore =
            calculateLexicalScore(
                cleanedRetrievalQuery,
                chunk
            );

        const titleScore =
            calculateTitleScore(
                cleanedRetrievalQuery,
                chunk
            );

        const urlScore =
            calculateUrlScore(
                cleanedRetrievalQuery,
                chunk
            );

        // Strongest page receives a small generic boost.
        const pageBoost = 0.08;

        const finalScore =
            semanticScore +
            lexicalScore * 0.02 +
            titleScore * 0.10 +
            urlScore * 0.03 +
            pageBoost;

        pageAwareResults.push({
            ...chunk,
            semanticScore,
            lexicalScore,
            titleScore,
            urlScore,
            finalScore
        });
    }

    // --------------------------------------------------------
    // Sort
    // --------------------------------------------------------

    pageAwareResults.sort(
        (a, b) =>
            b.finalScore -
            a.finalScore
    );

    // --------------------------------------------------------
    // Remove duplicate chunks
    // --------------------------------------------------------

    let finalResults =
        removeDuplicateChunks(
            pageAwareResults
        );

    // --------------------------------------------------------
    // Remove exact duplicate page content
    // --------------------------------------------------------

    finalResults =
        removeDuplicatePages(
            finalResults
        );

    // --------------------------------------------------------
    // For list questions, keep the complete strongest page
    // content available to the LLM.
    //
    // For normal questions, return only topK.
    // --------------------------------------------------------

    if (isListQuestion(cleanedQuery)) {
        return finalResults;
    }

    return finalResults.slice(
        0,
        topK
    );
}

// ============================================================
// PREPARE LLM CONTEXT
// ============================================================

function prepareContext(
    results,
    listQuestion = false
) {
    // List questions need enough context to cover
    // all products/items across the page.
    const MAX_CONTEXT_LENGTH =
        listQuestion
            ? 10000
            : 8000;

    let context = "";

    for (
        let i = 0;
        i < results.length;
        i++
    ) {
        const result =
            results[i];

        const section = `
--- Retrieved Source ${i + 1} ---

Title: ${result.title}

URL: ${result.url}

Content:

${result.text}
`;

        if (
            context.length +
                section.length >
            MAX_CONTEXT_LENGTH
        ) {
            break;
        }

        context += section;
    }

    return context.trim();
}

// ============================================================
// REMOVE REPEATED LINES
// ============================================================

function removeRepeatedLines(answer) {
    const lines =
        String(answer || "")
            .split("\n");

    const seen = new Set();
    const output = [];

    for (const line of lines) {
        const normalized =
            cleanText(line)
                .toLowerCase();

        if (!normalized) {
            output.push(line);
            continue;
        }

        if (seen.has(normalized)) {
            continue;
        }

        seen.add(normalized);
        output.push(line);
    }

    return output.join("\n");
}

// ============================================================
// CLEAN GENERATED ANSWER
// ============================================================

function cleanGeneratedAnswer(
    answer,
    listQuestion
) {
    let cleaned =
        String(answer || "")
            .trim();

    if (!cleaned) {
        return "";
    }

    cleaned =
        removeRepeatedLines(
            cleaned
        );

    if (listQuestion) {
        // Remove accidental repeated blank lines.
        cleaned =
            cleaned.replace(
                /\n{3,}/g,
                "\n\n"
            );
    }

    return cleaned.trim();
}

// ============================================================
// GENERATE ANSWER
// ============================================================

async function generateAnswer(
    query,
    results
) {
    const listQuestion =
        isListQuestion(query);

    const systemPrompt = `

You are an AI assistant for the National Bank of Egypt (NBE).

Your job is to answer the user's question using ONLY the retrieved
NBE information provided to you.

STRICT RULES:

1. Use only the provided context.

2. Do not use outside knowledge.

3. Do not invent information.

4. Do not guess missing information.

5. If the context does not contain enough information to answer,
   clearly say that the available NBE information does not provide
   the answer.

6. Combine information from the retrieved sections when needed.

7. Give a direct and useful answer.

8. Keep the answer concise unless the user asks for details.

9. Do not mention Qdrant, embeddings, vectors, chunks, retrieval,
   semantic search, or internal system details.

10. Do not create fake URLs or sources.

11. Do not claim something is offered by NBE unless it appears
    explicitly in the provided context.

12. Preserve important numbers, fees, limits, dates and names
    exactly as they appear in the context.

13. If the user asks for a list, provide a clear list.

14. If the user asks for a list of products, cards, services,
    programs, accounts, loans, or other items, include EVERY
    distinct item that is explicitly supported by the context.

15. When a list continues across multiple retrieved sections,
    combine the information from all relevant sections.

16. Do NOT stop a list after only a few examples.

17. Do NOT arbitrarily limit the number of items.

18. Do NOT replace an available complete list with a general
    category or summary.

19. Remove exact duplicate items.

20. If the same item appears more than once, mention it only once.

21. Inspect ALL provided retrieved sources before answering.

22. IMPORTANT:
    Do not treat a fragment such as "Titanium", "Platinum",
    "World", or "Standard" as a standalone product unless the
    context explicitly identifies it as a complete product name.

23. Do not reconstruct product names from fragments.

24. Do not invent missing words in product names.

25. Only output complete product names explicitly supported
    by the retrieved context.

26. Preserve official NBE product names exactly as written
    in the context.

27. Do not translate or transliterate official English NBE
    product names when answering in Arabic.

28. If the user asks in Arabic, explain the answer in Arabic,
    but preserve official English product names exactly.

29. If the user asks in English, answer in English.

30. For Arabic questions, use the retrieved NBE context even if
    that context is written in English.

31. For list questions, make one clean list without repeating
    products.

32. Do not produce multiple versions of the same product name.

33. If two names clearly refer to the same exact product,
    keep the official complete name from the context only.

34. Never add a product merely because its partial name appears.

35. The retrieved context is authoritative for this answer.

`;

    const context =
        prepareContext(
            results,
            listQuestion
        );

    const userPrompt = `

User question:

${query}

Retrieved NBE information:

${context}

Answer the user's question using ONLY the retrieved information.

${
    listQuestion
        ? `
This is a list question.

Before answering:

1. Inspect ALL retrieved sources.
2. Identify every complete product/item explicitly supported.
3. Remove exact duplicates.
4. Do not include incomplete fragments.
5. Do not invent or reconstruct names.
6. Return ONE clean list.
7. Do not repeat the same item.
`
        : ""
}

`;

    const response =
        await fetch(
            `${OLLAMA_URL}/api/chat`,
            {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/json"
                },
                body: JSON.stringify({
                    model:
                        LLM_MODEL,
                    stream:
                        false,
                    messages: [
                        {
                            role:
                                "system",
                            content:
                                systemPrompt
                        },
                        {
                            role:
                                "user",
                            content:
                                userPrompt
                        }
                    ],
                    options: {
                        temperature:
                            0,
                        num_predict:
                            listQuestion
                                ? 500
                                : 600
                    }
                })
            }
        );

    if (!response.ok) {
        const text =
            await response.text();

        throw new Error(
            `Ollama chat failed: ${response.status} ${text}`
        );
    }

    const data =
        await response.json();

    const rawAnswer =
        data.message?.content?.trim() ||
        "";

    const finalAnswer =
        cleanGeneratedAnswer(
            rawAnswer,
            listQuestion
        );

    return {
        answer:
            finalAnswer,
        model:
            LLM_MODEL
    };
}

// ============================================================
// HEALTH CHECK
// ============================================================

app.get(
    "/api/health",
    async (req, res) => {
        res.json({
            success: true,
            service:
                "NBE Search Backend",
            status:
                "healthy",
            embeddingModel:
                EMBEDDING_MODEL,
            llmModel:
                LLM_MODEL,
            collection:
                COLLECTION_NAME,
            chunks:
                allChunks.length
        });
    }
);

// ============================================================
// TEST EMBEDDING
// ============================================================

app.get(
    "/api/test-embedding",
    async (req, res) => {
        try {
            const text =
                req.query.text ||
                "What credit cards does NBE offer?";

            const embedding =
                await generateEmbedding(
                    text
                );

            res.json({
                success: true,
                model:
                    EMBEDDING_MODEL,
                dimension:
                    embedding.length,
                sample:
                    embedding.slice(
                        0,
                        10
                    )
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error:
                    error.message
            });
        }
    }
);

// ============================================================
// TEST LLM
// ============================================================

app.get(
    "/api/test-llm",
    async (req, res) => {
        try {
            const response =
                await fetch(
                    `${OLLAMA_URL}/api/chat`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type":
                                "application/json"
                        },
                        body: JSON.stringify({
                            model:
                                LLM_MODEL,
                            stream:
                                false,
                            messages: [
                                {
                                    role:
                                        "user",
                                    content:
                                        "In one short sentence, what is the National Bank of Egypt?"
                                }
                            ],
                            options: {
                                temperature:
                                    0.1
                            }
                        })
                    }
                );

            if (!response.ok) {
                const text =
                    await response.text();

                throw new Error(
                    `Ollama test failed: ${text}`
                );
            }

            const data =
                await response.json();

            res.json({
                success:
                    true,
                model:
                    LLM_MODEL,
                answer:
                    data.message?.content?.trim() ||
                    ""
            });

        } catch (error) {
            res.status(500).json({
                success:
                    false,
                error:
                    error.message
            });
        }
    }
);

// ============================================================
// INGEST
// ============================================================

app.post(
    "/api/ingest",
    async (req, res) => {
        try {
            const result =
                await ingestChunks();

            res.json({
                success:
                    true,
                ...result
            });

        } catch (error) {
            console.error(
                "Ingestion error:",
                error
            );

            res.status(500).json({
                success:
                    false,
                error:
                    error.message
            });
        }
    }
);

// ============================================================
// SEARCH API
//
// Direct search.
// No Arabic normalization.
// ============================================================

app.get(
    "/api/search",
    async (req, res) => {
        try {
            const query =
                cleanText(
                    req.query.q || ""
                );

            if (!query) {
                return res.status(400).json({
                    success:
                        false,
                    error:
                        "Query parameter 'q' is required"
                });
            }

            const results =
                await search(
                    query,
                    8
                );

            res.json({
                success:
                    true,
                query,
                results
            });

        } catch (error) {
            console.error(
                "Search error:",
                error
            );

            res.status(500).json({
                success:
                    false,
                error:
                    error.message
            });
        }
    }
);

// ============================================================
// AI ASK API
// ============================================================

app.get(
    "/api/ask",
    async (req, res) => {
        try {
            const query =
                cleanText(
                    req.query.q || ""
                );

            if (!query) {
                return res.status(400).json({
                    success:
                        false,
                    error:
                        "Query parameter 'q' is required"
                });
            }

            console.log(
                `AI question: "${query}"`
            );

            // ------------------------------------------------
            // STEP 1
            // Normalize Arabic/mixed query.
            // ------------------------------------------------

            const retrievalQuery =
                await normalizeSearchQuery(
                    query
                );

            // ------------------------------------------------
            // STEP 2
            // Search using normalized query.
            // ------------------------------------------------

            const results =
                await search(
                    query,
                    8,
                    retrievalQuery
                );

            console.log(
                `Retrieved ${results.length} results`
            );

            // ------------------------------------------------
            // STEP 3
            // Generate answer using ORIGINAL question.
            // ------------------------------------------------

            const generated =
                await generateAnswer(
                    query,
                    results
                );

            const sources =
                results.map(
                    result => ({
                        title:
                            result.title,
                        url:
                            result.url,
                        pageId:
                            result.pageId
                    })
                );

            res.json({
                success:
                    true,
                query,
                answer:
                    generated.answer,
                model:
                    generated.model,
                sources
            });

        } catch (error) {
            console.error(
                "AI answer error:",
                error
            );

            res.status(500).json({
                success:
                    false,
                error:
                    error.message
            });
        }
    }
);

// ============================================================
// START SERVER
// ============================================================

async function startServer() {
    try {
        loadCrawlerData();

        // ----------------------------------------------------
        // Qdrant connectivity
        // ----------------------------------------------------

        const qdrantResponse =
            await fetch(
                `${QDRANT_URL}/collections`
            );

        if (!qdrantResponse.ok) {
            throw new Error(
                `Qdrant is not reachable: ${qdrantResponse.status}`
            );
        }

        console.log(
            "Qdrant connection: OK"
        );

        // ----------------------------------------------------
        // Ollama connectivity
        // ----------------------------------------------------

        const ollamaResponse =
            await fetch(
                `${OLLAMA_URL}/api/tags`
            );

        if (!ollamaResponse.ok) {
            throw new Error(
                `Ollama is not reachable: ${ollamaResponse.status}`
            );
        }

        console.log(
            "Ollama connection: OK"
        );

        // ----------------------------------------------------
        // Start server
        // ----------------------------------------------------

        app.listen(
            PORT,
            "0.0.0.0",
            () => {
                console.log(
                    `NBE Search Backend running on port ${PORT}`
                );

                console.log(
                    `Embedding model: ${EMBEDDING_MODEL}`
                );

                console.log(
                    `LLM model: ${LLM_MODEL}`
                );

                console.log(
                    `Qdrant collection: ${COLLECTION_NAME}`
                );

                console.log(
                    `Loaded chunks: ${allChunks.length}`
                );
            }
        );

    } catch (error) {
        console.error(
            "Failed to start server:",
            error
        );

        process.exit(1);
    }
}

startServer();