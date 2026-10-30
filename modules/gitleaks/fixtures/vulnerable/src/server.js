// 더미 쇼핑몰 API (실행하지 않음)
const express = require('express');
const config = require('./config');
const { chargeOrder } = require('./payments');

const app = express();
app.use(express.json());

app.post('/orders', async (req, res) => {
  const receipt = await chargeOrder(req.body);
  res.json(receipt);
});

app.listen(config.port);
