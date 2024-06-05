const express = require('express');
const dotenv = require('dotenv');
const pool = require('../database/db'); // Importa a configuração da conexão

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
    console.error('Database error:', err.message);
    res.status(500).send('Database error: ' + err.message);
  }
});

app.get('/login', async (req, res) => {
  const { usuario, senha } = req.query;
  console.log('Login attempt with:', { usuario, senha });
  try {
    const [rows] = await pool.query(`
      SELECT * FROM USUARIO WHERE USUARIO_EMAIL = ? AND USUARIO_SENHA = ?
    `, [usuario, senha]);
    if (rows.length === 0) {
      res.status(401).send('Invalid email or password');
    } else {
      res.json(rows[0]);
    }
  } catch (err) {
    console.error('Database error:', err.message);
    res.status(500).send('Database error: ' + err.message);
  }
});

app.post('/cart', async (req, res) => {
  const { USUARIO_ID, PRODUTO_ID, ITEM_QTD } = req.body;
  if (USUARIO_ID == null || PRODUTO_ID == null || ITEM_QTD == null) {
    return res.status(400).send('USUARIO_ID, PRODUTO_ID, and ITEM_QTD must not be null');
  }
  try {
    const [rows] = await pool.query(`
      INSERT INTO CARRINHO_ITEM (USUARIO_ID, PRODUTO_ID, ITEM_QTD)
      VALUES (?, ?, ?)
    `, [USUARIO_ID, PRODUTO_ID, ITEM_QTD]);
    res.send('Item added to cart.');
  } catch (err) {
    console.error('Database error:', err.message);
    res.status(500).send('Database error: ' + err.message);
  }
});

app.get('/cart', async (req, res) => {
  const userId = req.query.userId;
  try {
    const [rows] = await pool.query(`
      SELECT
        CI.PRODUTO_ID,
        CI.ITEM_QTD AS QUANTIDADE_DISPONIVEL,
        P.PRODUTO_NOME,
        P.PRODUTO_PRECO,
        PI.IMAGEM_URL
      FROM
        CARRINHO_ITEM CI
      JOIN
        PRODUTO P ON CI.PRODUTO_ID = P.PRODUTO_ID
      JOIN
        PRODUTO_IMAGEM PI ON P.PRODUTO_ID = PI.PRODUTO_ID
      JOIN
        (SELECT
          PRODUTO_ID,
          MIN(IMAGEM_ORDEM) AS MIN_IMAGEM_ORDEM
        FROM
          PRODUTO_IMAGEM
        GROUP BY
          PRODUTO_ID) AS PI2 ON PI.PRODUTO_ID = PI2.PRODUTO_ID AND PI.IMAGEM_ORDEM = PI2.MIN_IMAGEM_ORDEM
      WHERE
        CI.USUARIO_ID = ?
      GROUP BY
        CI.PRODUTO_ID, CI.ITEM_QTD, P.PRODUTO_NOME, P.PRODUTO_PRECO, PI.IMAGEM_URL
    `, [userId]);
    res.json(rows);
  } catch (err) {
    console.error('Database error:', err.message);
    res.status(500).send('Database error: ' + err.message);
  }
});

app.put('/cart', async (req, res) => {
  const { userId, productId } = req.body;

  console.log(`Received PUT request with userId: ${userId} and productId: ${productId}`);

  try {
    const [rows] = await pool.query(`
      UPDATE CARRINHO_ITEM SET ITEM_QTD = 0 WHERE USUARIO_ID = ? AND PRODUTO_ID = ?
    `, [userId, productId]);

    if (rows.affectedRows === 0) {
      console.log(`No item found with userId: ${userId} and productId: ${productId}`);
      return res.status(404).send('Item not found');
    }

    console.log(`Item with userId: ${userId} and productId: ${productId} updated successfully`);
    res.send('Item quantity updated to 0.');
  } catch (err) {
    console.error('Database error:', err.message);
    res.status(500).send('Database error: ' + err.message);
  }
});

app.get('/getUserAddresses', async (req, res) => {
  const userId = req.query.userId;
  try {
    const [rows] = await pool.query(`
      SELECT * FROM ENDERECO WHERE USUARIO_ID = ? AND ENDERECO_APAGADO = 0
    `, [userId]);
    res.json(rows);
  } catch (err) {
    console.error('Database error:', err.message);
    res.status(500).send('Database error: ' + err.message);
  }
});

app.post('/createOrder', async (req, res) => {
  const { userId, total, products, addressId } = req.body;

  console.log(`Received POST request to create order with userId: ${userId}, total: ${total}, products: ${JSON.stringify(products)}, addressId: ${addressId}`);

  try {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    const [pedidoResult] = await connection.query(`
      INSERT INTO PEDIDO (USUARIO_ID, STATUS_ID, PEDIDO_DATA, ENDERECO_ID) 
      VALUES (?, ?, ?, ?)
    `, [userId, 1, new Date(), addressId]);

    const pedidoId = pedidoResult.insertId;

    for (const produto of products) {
      const { produtoId, quantidade } = produto;

      const [estoqueRows] = await connection.query(`
        SELECT PRODUTO_QTD FROM PRODUTO_ESTOQUE WHERE PRODUTO_ID = ?
      `, [produtoId]);

      if (estoqueRows.length === 0) {
        throw new Error(`Produto ID: ${produtoId} não encontrado no estoque`);
      }

      if (estoqueRows[0].PRODUTO_QTD < quantidade) {
        throw new Error(`Quantidade insuficiente no estoque para o produto ID: ${produtoId}`);
      }

      await connection.query(`
        INSERT INTO PEDIDO_ITEM (PRODUTO_ID, PEDIDO_ID, ITEM_QTD, ITEM_PRECO)
        VALUES (?, ?, ?, (SELECT PRODUTO_PRECO FROM PRODUTO WHERE PRODUTO_ID = ?))
      `, [produtoId, pedidoId, quantidade, produtoId]);

      await connection.query(`
        UPDATE PRODUTO_ESTOQUE SET PRODUTO_QTD = PRODUTO_QTD - ?
        WHERE PRODUTO_ID = ?
      `, [quantidade, produtoId]);

      await connection.query(`
        UPDATE CARRINHO_ITEM SET ITEM_QTD = 0 WHERE PRODUTO_ID = ? AND USUARIO_ID = ?
      `, [produtoId, userId]);
    }

    await connection.commit();
    connection.release();

    res.json({ status: 'success', code: 200, message: 'Pedido criado com sucesso', pedidoId });
  } catch (err) {
    console.error('Database error:', err.message);
    res.status(500).send('Database error: ' + err.message);
  }
});

app.post('/register', async (req, res) => {
  const { nome, email, senha, cpf } = req.body;

  if (!nome || !email || !senha || !cpf) {
    return res.status(400).send('Name, email, password, and CPF are required');
  }

  try {
    const [existingUser] = await pool.query(`
      SELECT * FROM USUARIO WHERE USUARIO_EMAIL = ?
    `, [email]);

    if (existingUser.length > 0) {
      return res.status(400).send('User already exists with this email');
    }

    const [result] = await pool.query(`
      INSERT INTO USUARIO (USUARIO_NOME, USUARIO_EMAIL, USUARIO_SENHA, USUARIO_CPF)
      VALUES (?, ?, ?, ?)
    `, [nome, email, senha, cpf]);

    const userId = result.insertId;
    res.json({ id: userId, message: 'User created successfully' });
  } catch (err) {
    console.error('Database error:', err.message);
    res.status(500).send('Database error: ' + err.message);
  }
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});

module.exports = app;
