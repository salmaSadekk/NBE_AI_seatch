const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

require("dotenv").config();


// Simple in-memory dataset to search against.
// Swap this out for a real database or search index later.
const ITEMS = [
  { id: 1, title: 'Getting Started with Docker', category: 'DevOps', description: 'Learn how to containerize applications with Docker and docker-compose.' },
  { id: 2, title: 'React Hooks Explained', category: 'Frontend', description: 'A deep dive into useState, useEffect, and custom hooks.' },
  { id: 3, title: 'Building REST APIs with Express', category: 'Backend', description: 'Design clean, RESTful endpoints using Node.js and Express.' },
  { id: 4, title: 'Introduction to Kubernetes', category: 'DevOps', description: 'Orchestrate containers at scale with Kubernetes pods and services.' },
  { id: 5, title: 'CSS Grid vs Flexbox', category: 'Frontend', description: 'When to use Grid layout versus Flexbox for responsive design.' },
  { id: 6, title: 'Node.js Event Loop', category: 'Backend', description: 'Understand how the event loop handles asynchronous operations.' },
  { id: 7, title: 'PostgreSQL Indexing Basics', category: 'Database', description: 'Speed up queries with the right indexing strategy.' },
  { id: 8, title: 'JWT Authentication', category: 'Security', description: 'Implement stateless authentication using JSON Web Tokens.' },
  { id: 9, title: 'Docker Compose for Multi-Container Apps', category: 'DevOps', description: 'Define and run multi-container Docker applications.' },
  { id: 10, title: 'React State Management', category: 'Frontend', description: 'Compare Context API, Redux, and Zustand for state management.' },
  { id: 11, title: 'Designing a Search API', category: 'Backend', description: 'Patterns for building fast, relevant search endpoints.' },
  { id: 12, title: 'MongoDB Aggregation Pipeline', category: 'Database', description: 'Transform and analyze documents with aggregation stages.' },
  { id: 13, title: 'HTTPS and TLS Basics', category: 'Security', description: 'How TLS handshakes secure data in transit.' },
  { id: 14, title: 'Vite vs Create React App', category: 'Frontend', description: 'Comparing build tools for modern React projects.' },
  { id: 15, title: 'Writing Dockerfiles the Right Way', category: 'DevOps', description: 'Best practices for small, secure, cacheable Docker images.' },
];

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/search', (req, res) => {
 // const query = (req.query.q || '').trim().toLowerCase();


testFirecrawl()

  console.log(result);

  if (!query) {
    return res.json({ query: '', count: 0, results: [] });
  }

  const results = ITEMS.filter((item) => {
    const haystack = `${item.title} ${item.category} ${item.description}`.toLowerCase();
    return haystack.includes(query);
  });

  res.json({ query, count: results.length, results }); 
});

app.listen(PORT, () => {
  console.log(`Search backend listening on port ${PORT}`);
});
