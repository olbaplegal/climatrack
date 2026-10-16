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

  const servidor = app.listen(config.port, () => {
    console.log(`[http] painel em http://localhost:${config.port}`);
  });

  agendarRetencao();

  // A plataforma (Render, Docker...) envia SIGTERM antes de parar/reimplantar o serviço
  for (const sinal of ['SIGTERM', 'SIGINT']) {
    process.once(sinal, async () => {
      console.log(`[app] ${sinal} recebido, encerrando...`);
      servidor.close();
      await mqtt.encerrar().catch(() => {});
      await db.pool.end().catch(() => {});
      process.exit(0);
    });
  }
}

// Apaga leituras antigas para não estourar a cota do banco (alertas e comandos são mantidos)
function agendarRetencao() {
  if (!config.retencaoDias) return;
  const limpar = async () => {
    try {
      const { rowCount } = await db.query(
        "DELETE FROM leituras WHERE data_hora < now() - make_interval(days => $1)",
        [config.retencaoDias],
      );
      if (rowCount) console.log(`[db] retenção: ${rowCount} leituras com mais de ${config.retencaoDias} dias apagadas`);
    } catch (err) {
      console.error('[db] retenção:', err.message);
    }
  };
  limpar();
  setInterval(limpar, 6 * 60 * 60 * 1000).unref();
}

iniciar().catch((err) => {
  console.error('Falha ao iniciar:', err);
  process.exit(1);
});
