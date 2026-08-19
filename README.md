# Lookup — Search App

A minimal full-stack search app: a React frontend with a single search bar,
and a Node.js/Express backend that searches an in-memory dataset.

```
search-app/
├── backend/          Express API (GET /api/search?q=...)
│   ├── server.js
│   ├── package.json
│   └── Dockerfile
├── frontend/         React (Vite) app, served by nginx in production
│   ├── src/
│   ├── package.json
│   ├── nginx.conf
│   └── Dockerfile
└── docker-compose.yml
```

## Run it with Docker Compose

From the `search-app` directory:

```bash
docker compose up -d --build

```

- Frontend: http://localhost:3000
- Backend (direct): http://localhost:4000/api/search?q=docker

The frontend container's nginx proxies any `/api/*` request to the backend
container over the internal Docker network, so the browser only ever talks
to port 3000.

To stop everything:

```bash
docker compose down
```

## Run the crawler/ scrapper code 
docker compose exec app node crawlerscrapper.js

## Store the output in current Directory
docker cp search-backend:/tmp/crawl-results.json .\crawl-results.json



## Run it locally without Docker (optional)

Backend:

```bash
cd backend
npm install
npm start        # listens on http://localhost:4000
```

Frontend (in a second terminal):

```bash
cd frontend
npm install
npm run dev       # listens on http://localhost:5173, proxies /api to :4000
```

## API

`GET /api/search?q=<term>`

```json
{
  "query": "docker",
  "count": 3,
  "results": [
    { "id": 1, "title": "Getting Started with Docker", "category": "DevOps", "description": "..." }
  ]
}
```

The dataset lives as a plain array in `backend/server.js` — swap it out for a
real database or search index whenever you're ready to go beyond the demo.
