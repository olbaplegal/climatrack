// Simulador de ESP32: publica telemetria no mesmo formato do firmware real
// e responde aos comandos da nuvem. Útil para testar sem hardware.
//
// Uso:  npm run simulador -- [device_id] [intervalo_segundos]
//   ex: npm run simulador -- esp32-sim 5
//
// Durante a execução, digite no terminal:
//   q + Enter  -> esquenta (soma 3 °C)
//   f + Enter  -> esfria   (subtrai 3 °C)
//   s + Enter  -> sai sem aviso (simula queda; o broker publica o LWT "offline")

require('dotenv').config();
const mqtt = require('mqtt');
const readline = require('readline');

const DEVICE_ID = process.argv[2] || 'esp32-sim';
let intervaloMs = (Number(process.argv[3]) || 5) * 1000;
const prefixo = process.env.MQTT_TOPIC_PREFIX || 'clima';
const T = {
  dados: `${prefixo}/${DEVICE_ID}/dados`,
  status: `${prefixo}/${DEVICE_ID}/status`,
  comando: `${prefixo}/${DEVICE_ID}/comando`,
};

let tempBase = 24;
let umidBase = 55;
let led = false;
let limiteTempMax = 30;
let limiteUmidMin = 30;

const client = mqtt.connect(process.env.MQTT_URL || 'mqtt://localhost:1883', {
  username: process.env.MQTT_USER || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
  clientId: DEVICE_ID,
  will: {
    topic: T.status,
    payload: JSON.stringify({ device_id: DEVICE_ID, status: 'offline' }),
    qos: 1,
    retain: true,
  },
});

function publicarStatus() {
  const payload = {
    device_id: DEVICE_ID,
    status: 'online',
    data_hora: new Date().toISOString(),
    intervalo_ms: intervaloMs,
    limite_temp_max: limiteTempMax,
    limite_umid_min: limiteUmidMin,
    led,
    simulador: true,
  };
  client.publish(T.status, JSON.stringify(payload), { qos: 1, retain: true });
}

// Índice de calor (fórmula de Rothfusz, a mesma usada pela biblioteca DHT)
function indiceCalor(t, u) {
  const f = t * 1.8 + 32;
  let hi = 0.5 * (f + 61 + (f - 68) * 1.2 + u * 0.094);
  if (hi > 79) {
    hi = -42.379 + 2.04901523 * f + 10.14333127 * u - 0.22475541 * f * u - 0.00683783 * f * f -
      0.05481717 * u * u + 0.00122874 * f * f * u + 0.00085282 * f * u * u - 0.00000199 * f * f * u * u;
  }
  return (hi - 32) / 1.8;
}

// Erros de conexão em "localhost" (IPv4 + IPv6) chegam como AggregateError sem mensagem
function descreverErro(err) {
  const causa = err.message || err.errors?.map((e) => e.message).join(' | ') || err.code || String(err);
  if (err.code === 'ECONNREFUSED') return `${causa} — o broker está rodando? (local: docker compose up -d)`;
  return causa;
}

let timer;
function agendar() {
  clearInterval(timer);
  timer = setInterval(publicarDados, intervaloMs);
}

function publicarDados() {
  // Variação lenta tipo "dia/noite" + ruído
  const minuto = Date.now() / 60000;
  const t = tempBase + 1.5 * Math.sin(minuto / 10) + (Math.random() - 0.5) * 0.6;
  const u = umidBase - 4 * Math.sin(minuto / 10) + (Math.random() - 0.5) * 2;

  const payload = {
    device_id: DEVICE_ID,
    data_hora: new Date().toISOString(),
    temperatura: Math.round(t * 10) / 10,
    umidade: Math.round(u * 10) / 10,
    indice_calor: Math.round(indiceCalor(t, u) * 10) / 10,
    amostras: 5,
    descartadas: 0,
    alarme_local: t > limiteTempMax || u < limiteUmidMin,
    motivo: 'periodico',
    rssi: -50 - Math.round(Math.random() * 20),
  };
  client.publish(T.dados, JSON.stringify(payload));
  console.log('-> dados', payload.temperatura, '°C', payload.umidade, '%', payload.alarme_local ? '(ALARME LOCAL)' : '');
}

client.on('connect', () => {
  console.log(`Simulador ${DEVICE_ID} conectado. Publicando a cada ${intervaloMs / 1000}s em ${T.dados}`);
  client.subscribe(T.comando, { qos: 1 });
  publicarStatus();
  publicarDados();
  agendar();
});

client.on('message', (_topico, msg) => {
  let cmd;
  try {
    cmd = JSON.parse(msg.toString());
  } catch {
    return console.log('<- comando inválido', msg.toString());
  }
  console.log('<- comando', cmd);

  if (cmd.comando === 'led') led = cmd.valor === 1;
  if (cmd.comando === 'intervalo') {
    intervaloMs = Math.min(Math.max(Number(cmd.valor) || 15, 5), 3600) * 1000;
    agendar();
  }
  if (cmd.comando === 'limites') {
    if (typeof cmd.temp_max === 'number') limiteTempMax = cmd.temp_max;
    if (typeof cmd.umid_min === 'number') limiteUmidMin = cmd.umid_min;
  }
  console.log(`   LED ${led ? 'LIGADO 💡' : 'desligado'}`);
  publicarStatus();
});

client.on('error', (err) => console.error('Erro MQTT:', descreverErro(err)));

readline.createInterface({ input: process.stdin }).on('line', (linha) => {
  const c = linha.trim().toLowerCase();
  if (c === 'q') tempBase += 3;
  if (c === 'f') tempBase -= 3;
  if (c === 's') {
    console.log('Simulando queda (sem desconectar educadamente)...');
    client.stream.destroy();
    process.exit(0);
  }
  console.log(`Temperatura base: ${tempBase} °C`);
});
