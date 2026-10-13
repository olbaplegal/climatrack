require('dotenv').config();

const config = {
  port: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-troque-em-producao',

  databaseUrl: process.env.DATABASE_URL,
  databaseSsl: process.env.DATABASE_SSL === 'true',

  mqttUrl: process.env.MQTT_URL || 'mqtt://localhost:1883',
  mqttUser: process.env.MQTT_USER || undefined,
  mqttPassword: process.env.MQTT_PASSWORD || undefined,
  topicPrefix: process.env.MQTT_TOPIC_PREFIX || 'clima',

  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatPadrao: process.env.TELEGRAM_CHAT_ID_PADRAO || '',
  telegramPolling: process.env.TELEGRAM_POLLING !== 'false',

  histerese: Number(process.env.HISTERESE) || 0.5,
  minutosInativo: Number(process.env.MINUTOS_INATIVO) || 2,
  toleranciaOfflineS: Number(process.env.OFFLINE_TOLERANCIA_S ?? 60),
};

if (!config.databaseUrl) {
  console.error('DATABASE_URL não definida. Copie .env.example para .env e preencha.');
  process.exit(1);
}

module.exports = config;
