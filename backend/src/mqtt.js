const mqtt = require('mqtt');
const config = require('./config');
const db = require('./db');

let client;
let handlerMensagem = async () => {};

// Erros de conexão em "localhost" (IPv4 + IPv6) chegam como AggregateError sem mensagem
function descreverErro(err) {
  const causa = err.message || err.errors?.map((e) => e.message).join(' | ') || err.code || String(err);
  if (err.code === 'ECONNREFUSED') return `${causa} — o broker está rodando? (local: docker compose up -d)`;
  return causa;
}

function conectar() {
  client = mqtt.connect(config.mqttUrl, {
    username: config.mqttUser,
    password: config.mqttPassword,
    clientId: config.mqttClientId || `climatrack-backend-${Math.random().toString(16).slice(2, 8)}`,
    clean: !config.mqttClientId,
    reconnectPeriod: 5000,
    keepalive: 60,
  });

  client.on('connect', () => {
    console.log(`[mqtt] conectado a ${config.mqttUrl}`);
    client.subscribe(
      [`${config.topicPrefix}/+/dados`, `${config.topicPrefix}/+/status`],
      { qos: 1 },
    );
  });
  client.on('reconnect', () => console.log('[mqtt] reconectando...'));
  client.on('error', (err) => console.error('[mqtt] erro:', descreverErro(err)));

  // tópico: clima/<deviceId>/<tipo>
  client.on('message', (topico, mensagem) => {
    const [, deviceId, tipo] = topico.split('/');
    handlerMensagem(deviceId, tipo, mensagem.toString()).catch((err) =>
      console.error(`[mqtt] erro ao processar ${topico}:`, err.message),
    );
  });
}

// Desconexão educada (o broker não publica nada e mantém a sessão persistente, se houver)
function encerrar() {
  return client ? client.endAsync() : Promise.resolve();
}

function aoReceber(handler) {
  handlerMensagem = handler;
}

function conectado() {
  return Boolean(client?.connected);
}

// Envia um comando da nuvem para o ESP32 e registra na auditoria
async function publicarComando(deviceId, payload, origem, usuarioId = null) {
  if (!conectado()) throw new Error('Broker MQTT desconectado');

  const topico = `${config.topicPrefix}/${deviceId}/comando`;
  await client.publishAsync(topico, JSON.stringify(payload), { qos: 1 });
  await db.query(
    'INSERT INTO comandos (dispositivo_id, usuario_id, origem, payload) VALUES ($1, $2, $3, $4)',
    [deviceId, usuarioId, origem, payload],
  );
  console.log(`[mqtt] comando -> ${topico}`, payload);
}

module.exports = { conectar, encerrar, aoReceber, conectado, publicarComando };
