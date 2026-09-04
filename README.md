# Lookup — NBE AI Search

An AI-powered search application for the **National Bank of Egypt (NBE)** knowledge base.

The system combines a web crawler, semantic search, vector storage, and a local Large Language Model (LLM) to answer user questions about NBE services and products in **English and Arabic**.

The application provides a simple search interface where users can ask questions such as:

* What credit cards does NBE offer?
* What are the benefits of Visa Platinum?
* What is Al Ahly Mobile?
* What services does PhoneCash provide?
* ما هي البطاقات الائتمانية التي يقدمها البنك الأهلي المصري؟
* ما هي الخدمات التي يقدمها الأهلي موبايل؟

---

## Architecture

The application consists of four main services:

```text
                         ┌──────────────────────┐
                         │      NBE Website     │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │   Web Crawler /      │
                         │     Scraper          │
                         └──────────┬───────────┘
                                    │
                             crawler-output.json
                                    │
                                    ▼
┌───────────────┐         ┌──────────────────────┐
│   React UI    │ ──────► │   Node.js Backend    │
│   Port 3000   │         │      Port 4000       │
└───────────────┘         └──────────┬───────────┘
                                     │
                       ┌─────────────┴─────────────┐
                       │                           │
                       ▼                           ▼
              ┌────────────────┐          ┌────────────────┐
              │     Qdrant     │          │     Ollama     │
              │ Vector Search  │          │ Local LLM      │
              │    Port 6333   │          │   Port 11434   │
              └────────────────┘          └────────────────┘
```

### Search Flow

```text
User Question
      │
      ▼
React Frontend
      │
      ▼
Node.js / Express API
      │
      ▼
Query Processing
      │
      ▼
Ollama Embeddings
      │
      ▼
Qdrant Semantic Search
      │
      ▼
Relevant NBE Content
      │
      ▼
Ollama LLM
      │
      ▼
AI-Generated Answer + Sources
      │
      ▼
React Frontend
```

---

## Project Structure

```text
NBE_AI_seatch/
│
├── backend/
│   ├── data/
│   │   └── crawler-output.json
│   │
│   ├── server.js
│   ├── package.json
│   └── Dockerfile
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   │
│   ├── package.json
│   ├── nginx.conf
│   └── Dockerfile
│
├── docker-compose.yml
└── .gitignore
```

---

# Main Components

## 1. NBE Web Crawler

The crawler collects content from the National Bank of Egypt website and produces structured JSON data.

The current crawler output contains:

* 33 crawled pages
* Page titles
* URLs
* Page depth
* Extracted text
* Links
* Chunk information
* Scraping timestamps

The crawler output is stored in:

```text
backend/data/crawler-output.json
```

The backend loads this data when it starts.

---

## 2. Node.js / Express Backend

The backend is responsible for the complete AI search pipeline.

It handles:

* Loading crawler data
* Text preprocessing
* Sentence-aware chunking
* Page mapping
* Embedding generation
* Qdrant vector storage
* Semantic search
* Lexical/title/URL ranking
* Arabic and mixed-language query handling
* Duplicate result removal
* AI answer generation
* Source extraction

The backend runs on:

```text
http://localhost:4000
```

### Main API Endpoints

#### Health Check

```http
GET /api/health
```

Checks the backend and service configuration.

#### Embedding Test

```http
GET /api/test-embedding
```

Tests communication with the Ollama embedding model.

#### LLM Test

```http
GET /api/test-llm
```

Tests communication with the local LLM.

#### Ingestion

```http
POST /api/ingest
```

Processes the crawler data, generates embeddings, and stores the vectors in Qdrant.

#### Search

```http
GET /api/search?q=<query>
```

Performs semantic search against the indexed NBE content.

#### AI Question Answering

```http
GET /api/ask?q=<question>
```

Retrieves the most relevant NBE content and uses the local LLM to generate an answer.

Example:

```text
GET /api/ask?q=What%20credit%20cards%20does%20NBE%20offer?
```

---

# 3. Embeddings

The project uses **Ollama** to generate local embeddings.

Current embedding model:

```text
nomic-embed-text
```

Embedding dimension:

```text
768
```

The embeddings represent NBE content as vectors so that semantically similar questions and documents can be matched even when they don't use exactly the same words.

For example:

```text
What credit cards does NBE offer?
```

can be matched with relevant NBE content even when the page uses different wording.

---

# 4. Qdrant Vector Database

**Qdrant** is used as the vector database for semantic search.

It stores the embeddings generated from the NBE content.

Qdrant runs on:

```text
http://localhost:6333
```

The project uses the collection:

```text
nbe_chunks
```

The Qdrant data is persisted through a Docker volume so that the vectors are not lost when the container is restarted.

---

# 5. Local AI Model

The project uses **Ollama** to run the AI models locally.

Current LLM:

```text
qwen2.5:3b
```

The LLM receives the most relevant NBE content retrieved from Qdrant and generates the final answer.

This provides a Retrieval-Augmented Generation (RAG)-style pipeline:

```text
Question
   ↓
Semantic Retrieval
   ↓
Relevant NBE Content
   ↓
LLM
   ↓
Answer
```

The model runs locally through:

```text
http://localhost:11434
```

No external LLM API is required for the current setup.

---

# 6. Arabic and English Support

The search pipeline supports both English and Arabic queries.

Arabic or mixed-language questions are detected and normalized when necessary before retrieval.

Example:

```text
English:
What credit cards does NBE offer?

Arabic:
ما هي البطاقات الائتمانية التي يقدمها البنك الأهلي المصري؟
```

Both queries can retrieve the relevant NBE Credit Cards content.

The frontend also detects Arabic input and adjusts the interface direction accordingly.

---

# 7. Retrieval and Ranking

The backend does more than simple keyword matching.

The retrieval process combines:

* Semantic similarity
* Text relevance
* Title relevance
* URL relevance
* Page-level relevance
* Duplicate removal
* Page-focused retrieval

This helps prevent unrelated NBE pages from being included in the final AI context.

For category/product questions, the system focuses on the strongest relevant NBE page before generating the answer.

---

# 8. React Frontend

The frontend is built with:

* React
* Vite
* JavaScript
* CSS

The interface intentionally uses a minimal design with:

* Single search bar
* English/Arabic query support
* Loading state
* AI answer section
* Source links
* Error handling
* Responsive layout

The frontend runs on:

```text
http://localhost:3000
```

In production, the React application is built and served by **Nginx**.

---

# 9. Nginx

Nginx serves the React frontend and proxies API requests to the backend.

```text
Browser
   │
   ▼
Nginx :80
   │
   ├── Frontend → React application
   │
   └── /api/* → backend:4000
```

The browser therefore communicates with the application through:

```text
http://localhost:3000
```

while Nginx communicates with the backend through the internal Docker network.

The Nginx configuration also includes an extended API read timeout because LLM generation can take longer than a normal API request.

---

# 10. Docker

The complete application runs using Docker Compose.

Services:

```text
backend
frontend
ollama
qdrant
```

All services communicate through the Docker network:

```text
search-net
```

Persistent volumes are used for:

```text
ollama-data
qdrant-data
```

---

# Running the Project

## Prerequisites

Install:

* Docker Desktop
* Git

Make sure Docker Desktop is running.

---

## Start the Application

From the project root:

```bash
docker compose up -d --build
```

Check the running containers:

```bash
docker compose ps
```

Expected services:

```text
search-backend
search-frontend
search-ollama
search-qdrant
```

---

## Access the Application

Frontend:

```text
http://localhost:3000
```

Backend:

```text
http://localhost:4000
```

Qdrant:

```text
http://localhost:6333
```

Ollama:

```text
http://localhost:11434
```

---

# AI Models

The required Ollama models must be available inside the Ollama container.

Embedding model:

```text
nomic-embed-text
```

LLM:

```text
qwen2.5:3b
```

For example:

```bash
docker exec search-ollama ollama pull nomic-embed-text
docker exec search-ollama ollama pull qwen2.5:3b
```

---

# Data Ingestion

After the crawler output is available, the backend can process and index the data using:

```http
POST /api/ingest
```

The ingestion pipeline:

```text
crawler-output.json
        ↓
Load pages
        ↓
Text processing
        ↓
Sentence-aware chunking
        ↓
Generate embeddings
        ↓
Store vectors in Qdrant
```

The indexed collection is:

```text
nbe_chunks
```

---

# Example Questions

### English

```text
What credit cards does NBE offer?
```

```text
What are the benefits of the Visa Platinum credit card?
```

```text
What is the grace period for NBE credit cards?
```

```text
What is Al Ahly Mobile?
```

```text
What services does PhoneCash provide?
```

### Arabic

```text
ما هي البطاقات الائتمانية التي يقدمها البنك الأهلي المصري؟
```

```text
ما هي مميزات بطاقات الائتمان من البنك الأهلي المصري؟
```

```text
ما هي فترة السماح للبطاقات الائتمانية؟
```

```text
ما هي خدمة الأهلي موبايل؟
```

```text
ما هي الخدمات التي يقدمها فون كاش؟
```

---

# Stopping the Application

To stop the containers:

```bash
docker compose down
```

To stop and remove the containers while keeping persistent volumes:

```bash
docker compose down
```

The Qdrant and Ollama data remain stored in their Docker volumes.

---

# Technology Stack

| Component       | Technology                | Purpose                      |
| --------------- | ------------------------- | ---------------------------- |
| Frontend        | React + Vite              | Search interface             |
| Backend         | Node.js + Express         | API and AI search pipeline   |
| Web Crawling    | Existing NBE crawler      | Collect NBE website content  |
| Embeddings      | Ollama + nomic-embed-text | Convert text into vectors    |
| Vector Database | Qdrant                    | Semantic vector search       |
| LLM             | Ollama + Qwen 2.5 3B      | Generate answers             |
| Web Server      | Nginx                     | Serve frontend and proxy API |
| Containers      | Docker                    | Isolated services            |
| Orchestration   | Docker Compose            | Run the complete application |

---

# Current System

The current implementation successfully provides:

* NBE website content ingestion
* Semantic vector search
* Local embedding generation
* Local LLM-based answers
* English queries
* Arabic queries
* Mixed-language query handling
* Page-focused retrieval
* Duplicate source removal
* Source links in the UI
* Dockerized backend
* Dockerized frontend
* Qdrant persistence
* Ollama persistence
* Nginx API proxying
* Responsive search interface

---

## Project Goal

The goal of **Lookup** is to provide a simple AI-powered interface for searching the National Bank of Egypt knowledge base using natural-language questions rather than traditional keyword-based search.
