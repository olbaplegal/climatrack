const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const config = require('./config');
const db = require('./db');
const mqtt = require('./mqtt');
const ingestao = require('./ingestao');
const bot = require('./bot');
const api = require('./api');

async function iniciar() {
  await db.migrar();

  mqtt.aoReceber(ingestao.processarMensagem);
  mqtt.conectar();
  bot.iniciar();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', api);
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.listen(config.port, () => {
    console.log(`[http] painel em http://localhost:${config.port}`);
  });
}

iniciar().catch((err) => {
  console.error('Falha ao iniciar:', err);
  process.exit(1);
});
