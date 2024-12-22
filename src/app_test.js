const express = require('express');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();
const port = 8080;

app.get('/', (req, res) => {
  res.send('Hello World from Fargate!');
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

app.get('/env', (req, res) => {
  res.json({
    NODE_ENV: process.env.NODE_ENV || 'not set',
    APP_ENV: process.env.APP_ENV || 'not set',
    APP_PORT: process.env.APP_PORT || 'not set',
    DATABASE_URL: process.env.DATABASE_URL ? 'set (hidden)' : 'not set'
  });
});

app.get('/db-check', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ 
      status: 'connected',
      message: 'Successfully connected to the database'
    });
  } catch (error) {
    console.error('Database connection error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Failed to connect to the database',
      error: error.message
    });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on port ${port}`);
  console.log('Environment:', {
    NODE_ENV: process.env.NODE_ENV || 'not set',
    APP_ENV: process.env.APP_ENV || 'not set'
  });
});