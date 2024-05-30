const express = require('express');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

app.get('/products', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.*, pi.IMAGEM_URL, e.PRODUTO_QTD AS QUANTIDADE_DISPONIVEL
      FROM PRODUTO p
      LEFT JOIN PRODUTO_IMAGEM pi ON p.PRODUTO_ID = pi.PRODUTO_ID
      LEFT JOIN PRODUTO_ESTOQUE e ON p.PRODUTO_ID = e.PRODUTO_ID
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).send('Database error: ' + err.message);
  }
});

app.get('/login', async (req, res) => {
  const { email, senha } = req.query;
  try {
    const [rows] = await pool.query(`
      SELECT * FROM USUARIO WHERE USUARIO_EMAIL = ? AND USUARIO_SENHA = ?
    `, [email, senha]);
    res.json(rows);
  } catch (err) {
    res.status(500).send('Database error: ' + err.message);
  }
});

app.get('/cart', async (req, res) => {
  const { userId } = req.query;
  try {
    const [rows] = await pool.query(`
      SELECT CI.PRODUTO_ID, CI.ITEM_QTD AS QUANTIDADE_DISPONIVEL, P.PRODUTO_NOME, P.PRODUTO_PRECO, PI.IMAGEM_URL
      FROM CARRINHO_ITEM CI
      JOIN PRODUTO P ON CI.PRODUTO_ID = P.PRODUTO_ID
      JOIN PRODUTO_IMAGEM PI ON P.PRODUTO_ID = PI.PRODUTO_ID
      JOIN (
          SELECT PRODUTO_ID, MIN(IMAGEM_ORDEM) AS MIN_IMAGEM_ORDEM
          FROM PRODUTO_IMAGEM
          GROUP BY PRODUTO_ID
      ) AS PI2 ON PI.PRODUTO_ID = PI2.PRODUTO_ID AND PI.IMAGEM_ORDEM = PI2.MIN_IMAGEM_ORDEM
      WHERE CI.USUARIO_ID = ?
      GROUP BY CI.PRODUTO_ID, CI.ITEM_QTD, P.PRODUTO_NOME, P.PRODUTO_PRECO, PI.IMAGEM_URL
    `, [userId]);
    res.json(rows);
  } catch (err) {
    res.status(500).send('Database error: ' + err.message);
  }
});

app.post('/cart', async (req, res) => {
  const { userId, productId, quantity } = req.body;
  try {
    const [rows] = await pool.query(`
      INSERT INTO CARRINHO_ITEM (USUARIO_ID, PRODUTO_ID, ITEM_QTD)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE ITEM_QTD = ITEM_QTD + VALUES(ITEM_QTD)
    `, [userId, productId, quantity]);
    res.send('Item added/updated in cart.');
  } catch (err) {
    res.status(500).send('Database error: ' + err.message);
  }
});

app.delete('/cart', async (req, res) => {
  const { userId, productId } = req.body;
  try {
    const [rows] = await pool.query(`
      DELETE FROM CARRINHO_ITEM WHERE USUARIO_ID = ? AND PRODUTO_ID = ?
    `, [userId, productId]);
    res.send('Item removed from cart.');
  } catch (err) {
    res.status(500).send('Database error: ' + err.message);
  }
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});

module.exports = app;
