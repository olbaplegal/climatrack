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
  // ID fixo: o broker aceita só uma conexão com esse ID (evita dois back-ends gravando em dobro durante
  // um redeploy) e mantém a sessão: mensagens QoS 1 (status/LWT) ficam guardadas enquanto o back-end reinicia
  mqttClientId: process.env.MQTT_CLIENT_ID || '',

  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatPadrao: process.env.TELEGRAM_CHAT_ID_PADRAO || '',
  telegramPolling: process.env.TELEGRAM_POLLING !== 'false',

  histerese: Number(process.env.HISTERESE) || 0.5,
  minutosInativo: Number(process.env.MINUTOS_INATIVO) || 2,
  toleranciaOfflineS: Number(process.env.OFFLINE_TOLERANCIA_S ?? 60),
  // Leituras mais antigas que isso são apagadas (cota de 500 MB do Supabase Free). 0 = nunca apagar
  retencaoDias: Number(process.env.RETENCAO_DIAS ?? 90),
};

if (!config.databaseUrl) {
  console.error('DATABASE_URL não definida. Copie .env.example para .env e preencha.');
  process.exit(1);
}

module.exports = config;
