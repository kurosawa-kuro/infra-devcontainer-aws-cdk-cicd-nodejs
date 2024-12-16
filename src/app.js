const express = require('express');
const app = express();
const port = 3000;

// JSONボディのパース用ミドルウェア
app.use(express.json());

// GETエンドポイント
app.get('/hello', (req, res) => {
  res.json({ message: 'Hello, World!' });
});

// POSTエンドポイント
app.post('/hello', (req, res) => {
  const name = req.body.name || 'World';
  res.json({ message: `Hello, ${name}!` });
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
