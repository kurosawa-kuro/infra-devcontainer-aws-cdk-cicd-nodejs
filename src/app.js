const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

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

// テスト環境ではサーバーを起動しない
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
  });
}

module.exports = app; // テスト用にアプリケーションをエクスポート
