// Ingestão da telemetria + motor de regras (alertas e acionamento remoto).
//
// Fluxo: ESP32 --MQTT--> broker --> processarMensagem()
//          -> grava no PostgreSQL
//          -> empurra para o painel (SSE)
//          -> avalia limites -> Telegram + comando de volta ao ESP32

const config = require('./config');
const db = require('./db');
const eventos = require('./eventos');
const telegram = require('./telegram');
const mqtt = require('./mqtt');

// Último estado conhecido de cada alerta: "<device>:<tipo>" -> 'disparado' | 'normalizado'
const estadoAlertas = new Map();
const dispositivosCarregados = new Set();
// Alertas de offline aguardando a tolerância: deviceId -> timeout
const offlinePendente = new Map();

const REGRAS = [
  {
    tipo: 'temp_alta',
    campo: 'temperatura',
    disparar: (v, d) => v > d.temp_max,
    normalizar: (v, d, h) => v <= d.temp_max - h,
    texto: (v, d) => `🌡️ Temperatura ALTA: <b>${v} °C</b> (limite ${d.temp_max} °C)`,
    acao: { comando: 'led', valor: 1 },
    acaoNormal: { comando: 'led', valor: 0 },
  },
  {
    tipo: 'temp_baixa',
    campo: 'temperatura',
    disparar: (v, d) => v < d.temp_min,
    normalizar: (v, d, h) => v >= d.temp_min + h,
    texto: (v, d) => `❄️ Temperatura BAIXA: <b>${v} °C</b> (limite ${d.temp_min} °C)`,
  },
  {
    tipo: 'umid_alta',
    campo: 'umidade',
    disparar: (v, d) => v > d.umid_max,
    normalizar: (v, d, h) => v <= d.umid_max - h,
    texto: (v, d) => `💧 Umidade ALTA: <b>${v} %</b> (limite ${d.umid_max} %)`,
  },
  {
    tipo: 'umid_baixa',
    campo: 'umidade',
    disparar: (v, d) => v < d.umid_min,
    normalizar: (v, d, h) => v >= d.umid_min + h,
    texto: (v, d) => `🏜️ Umidade BAIXA: <b>${v} %</b> (limite ${d.umid_min} %)`,
  },
];

function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Usa o horário do ESP32 se for plausível; senão, o horário de chegada.
function resolverDataHora(valor) {
  const agora = Date.now();
  const t = valor ? Date.parse(valor) : NaN;
  if (Number.isNaN(t) || Math.abs(agora - t) > 5 * 60 * 1000) return new Date(agora);
  return new Date(t);
}

async function carregarEstadoAlertas(deviceId) {
  if (dispositivosCarregados.has(deviceId)) return;
  const { rows } = await db.query(
    `SELECT DISTINCT ON (tipo) tipo, estado FROM alertas
      WHERE dispositivo_id = $1 ORDER BY tipo, criado_em DESC`,
    [deviceId],
  );
  for (const r of rows) estadoAlertas.set(`${deviceId}:${r.tipo}`, r.estado);
  dispositivosCarregados.add(deviceId);
}

function nomeDispositivo(d) {
  return d.nome ? `${d.nome} (${d.id})` : d.id;
}

async function registrarAlerta(disp, tipo, estado, valor, mensagem, inicioMs) {
  const chatId = disp.telegram_chat_id || config.telegramChatPadrao;
  const local = disp.local ? `\n📍 ${disp.local}` : '';
  const texto = `<b>ClimaTrack</b> · ${nomeDispositivo(disp)}${local}\n${mensagem}`;

  const enviado = await telegram.enviar(chatId, texto);
  const latenciaMs = Date.now() - inicioMs;

  const { rows } = await db.query(
    `INSERT INTO alertas (dispositivo_id, tipo, estado, valor, mensagem, enviado_telegram, latencia_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [disp.id, tipo, estado, valor, mensagem.replace(/<[^>]+>/g, ''), enviado, latenciaMs],
  );
  estadoAlertas.set(`${disp.id}:${tipo}`, estado);

  if (disp.usuario_id) eventos.emitir(disp.usuario_id, 'alerta', rows[0]);
  console.log(`[regra] ${disp.id} ${tipo} ${estado} (telegram=${enviado}, ${latenciaMs} ms)`);
}

async function avaliarRegras(disp, leitura, inicioMs) {
  await carregarEstadoAlertas(disp.id);

  for (const regra of REGRAS) {
    const valor = leitura[regra.campo];
    const chave = `${disp.id}:${regra.tipo}`;
    const ativo = estadoAlertas.get(chave) === 'disparado';

    if (!ativo && regra.disparar(valor, disp)) {
      await registrarAlerta(disp, regra.tipo, 'disparado', valor, regra.texto(valor, disp), inicioMs);
      if (regra.acao) await mqtt.publicarComando(disp.id, regra.acao, 'regra').catch(() => {});
    } else if (ativo && regra.normalizar(valor, disp, config.histerese)) {
      const unidade = regra.campo === 'temperatura' ? '°C' : '%';
      await registrarAlerta(
        disp, regra.tipo, 'normalizado', valor,
        `✅ ${regra.campo === 'temperatura' ? 'Temperatura' : 'Umidade'} normalizada: <b>${valor} ${unidade}</b>`,
        inicioMs,
      );
      if (regra.acaoNormal) await mqtt.publicarComando(disp.id, regra.acaoNormal, 'regra').catch(() => {});
    }
  }
}

// Garante que o dispositivo existe (auto-registro sem dono) e devolve seus dados + chat do dono
async function obterOuCriarDispositivo(deviceId) {
  await db.query('INSERT INTO dispositivos (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [deviceId]);
  const { rows } = await db.query(
    `SELECT d.*, u.telegram_chat_id FROM dispositivos d
       LEFT JOIN usuarios u ON u.id = d.usuario_id WHERE d.id = $1`,
    [deviceId],
  );
  return rows[0];
}

async function processarDados(deviceId, texto) {
  const inicioMs = Date.now();
  let payload;
  try {
    payload = JSON.parse(texto);
  } catch {
    console.warn(`[ingestao] JSON inválido de ${deviceId}: ${texto}`);
    return;
  }

  const temperatura = numero(payload.temperatura);
  const umidade = numero(payload.umidade);
  if (temperatura === null || umidade === null ||
      temperatura < -40 || temperatura > 80 || umidade < 0 || umidade > 100) {
    console.warn(`[ingestao] leitura fora da faixa descartada de ${deviceId}: ${texto}`);
    return;
  }

  const dataHora = resolverDataHora(payload.data_hora);
  const leitura = {
    dispositivo_id: deviceId,
    data_hora: dataHora,
    temperatura,
    umidade,
    indice_calor: numero(payload.indice_calor),
    rssi: numero(payload.rssi),
    motivo: payload.motivo ? String(payload.motivo).slice(0, 20) : null,
  };

  const disp = await obterOuCriarDispositivo(deviceId);

  const { rows } = await db.query(
    `INSERT INTO leituras (dispositivo_id, data_hora, temperatura, umidade, indice_calor, rssi, motivo)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [deviceId, dataHora, temperatura, umidade, leitura.indice_calor, leitura.rssi, leitura.motivo],
  );
  await db.query(
    "UPDATE dispositivos SET ultimo_dado_em = now(), status = 'online' WHERE id = $1",
    [deviceId],
  );

  if (disp.usuario_id) eventos.emitir(disp.usuario_id, 'leitura', rows[0]);
  cancelarOfflinePendente(deviceId);

  await avaliarRegras(disp, leitura, inicioMs);
}

async function processarStatus(deviceId, texto) {
  let payload;
  try {
    payload = JSON.parse(texto);
  } catch {
    payload = { status: texto };
  }
  const status = payload.status === 'offline' ? 'offline' : 'online';

  const disp = await obterOuCriarDispositivo(deviceId);
  await db.query(
    `UPDATE dispositivos SET status = $2, status_info = $3, ultimo_status_em = now() WHERE id = $1`,
    [deviceId, status, payload],
  );
  if (disp.usuario_id) eventos.emitir(disp.usuario_id, 'status', { dispositivo_id: deviceId, status, info: payload });

  // Alerta de conectividade (só na mudança de estado). Quedas rápidas (reconexão de
  // Wi-Fi/MQTT) não geram alerta: o "offline" só é confirmado após a tolerância.
  await carregarEstadoAlertas(deviceId);
  const offlineAtivo = estadoAlertas.get(`${deviceId}:offline`) === 'disparado';

  if (status === 'online') {
    cancelarOfflinePendente(deviceId);
    if (offlineAtivo) {
      await registrarAlerta(disp, 'offline', 'normalizado', null, '🔌 Dispositivo voltou a ficar <b>ONLINE</b>', Date.now());
    }
  } else if (!offlineAtivo && !offlinePendente.has(deviceId)) {
    const inicioMs = Date.now();
    offlinePendente.set(deviceId, setTimeout(() => {
      confirmarOffline(deviceId, inicioMs).catch((err) => console.error('[regra] erro offline:', err.message));
    }, config.toleranciaOfflineS * 1000));
    console.log(`[regra] ${deviceId} offline; alerta em ${config.toleranciaOfflineS}s se não voltar`);
  }
}

function cancelarOfflinePendente(deviceId) {
  const timer = offlinePendente.get(deviceId);
  if (!timer) return;
  clearTimeout(timer);
  offlinePendente.delete(deviceId);
  console.log(`[regra] ${deviceId} voltou dentro da tolerância; alerta de offline cancelado`);
}

async function confirmarOffline(deviceId, inicioMs) {
  offlinePendente.delete(deviceId);
  const disp = await obterOuCriarDispositivo(deviceId);
  if (disp.status !== 'offline') return;
  const segundos = Math.round((Date.now() - inicioMs) / 1000);
  await registrarAlerta(disp, 'offline', 'disparado', null,
    `🔌 Dispositivo <b>OFFLINE</b> há ${segundos} s (sem conexão com o broker)`, Date.now());
}

async function processarMensagem(deviceId, tipo, texto) {
  if (!deviceId || !/^[\w-]{1,40}$/.test(deviceId)) return;
  if (tipo === 'dados') return processarDados(deviceId, texto);
  if (tipo === 'status') return processarStatus(deviceId, texto);
}

module.exports = { processarMensagem };
