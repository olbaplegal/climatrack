const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');
const mqtt = require('./mqtt');
const eventos = require('./eventos');
const telegram = require('./telegram');
const { emitirSessao, encerrarSessao, exigirLogin } = require('./auth');

const router = express.Router();
const inicioProcesso = Date.now();

// Período pedido no painel -> [janela de tempo, tamanho do balde de agregação]
const PERIODOS = {
  '1h': ['1 hour', null],
  '6h': ['6 hours', '2 minutes'],
  '24h': ['24 hours', '10 minutes'],
  '7d': ['7 days', '1 hour'],
  '30d': ['30 days', '4 hours'],
};

function periodo(req) {
  return PERIODOS[req.query.periodo] ? req.query.periodo : '24h';
}

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

// =====================================================
// SAÚDE (público) - usado para monitorar disponibilidade (SLA)
// =====================================================

router.get('/saude', async (req, res) => {
  let banco = false;
  const t0 = Date.now();
  try {
    await db.query('SELECT 1');
    banco = true;
  } catch {}
  const ok = banco && mqtt.conectado();
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degradado',
    banco,
    banco_latencia_ms: Date.now() - t0,
    mqtt: mqtt.conectado(),
    telegram: telegram.habilitado(),
    uptime_s: Math.round((Date.now() - inicioProcesso) / 1000),
  });
});

// =====================================================
// AUTENTICAÇÃO
// =====================================================

router.post('/auth/registrar', async (req, res) => {
  const nome = String(req.body.nome || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const senha = String(req.body.senha || '');

  if (!nome || !/^\S+@\S+\.\S+$/.test(email) || senha.length < 6) {
    throw new ErroHttp(400, 'Informe nome, e-mail válido e senha com pelo menos 6 caracteres');
  }

  const hash = await bcrypt.hash(senha, 10);
  try {
    const { rows } = await db.query(
      'INSERT INTO usuarios (nome, email, senha_hash) VALUES ($1, $2, $3) RETURNING id, nome, email',
      [nome, email, hash],
    );
    emitirSessao(res, rows[0]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw new ErroHttp(409, 'E-mail já cadastrado');
    throw err;
  }
});

router.post('/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const { rows } = await db.query('SELECT * FROM usuarios WHERE email = $1', [email]);
  const usuario = rows[0];

  if (!usuario || !(await bcrypt.compare(String(req.body.senha || ''), usuario.senha_hash))) {
    throw new ErroHttp(401, 'E-mail ou senha inválidos');
  }
  emitirSessao(res, usuario);
  res.json({ id: usuario.id, nome: usuario.nome, email: usuario.email });
});

router.post('/auth/logout', (req, res) => {
  encerrarSessao(res);
  res.status(204).end();
});

// Daqui para baixo, tudo exige login
router.use(exigirLogin);

router.get('/eu', async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, nome, email, telegram_chat_id FROM usuarios WHERE id = $1',
    [req.usuario.id],
  );
  if (!rows[0]) throw new ErroHttp(401, 'Usuário não existe mais');
  res.json({ ...rows[0], telegram_bot: telegram.habilitado() });
});

router.put('/eu', async (req, res) => {
  const chat = String(req.body.telegram_chat_id || '').trim() || null;
  if (chat && !/^-?\d+$/.test(chat)) throw new ErroHttp(400, 'Chat ID do Telegram deve ser numérico');
  const { rows } = await db.query(
    'UPDATE usuarios SET telegram_chat_id = $2 WHERE id = $1 RETURNING id, nome, email, telegram_chat_id',
    [req.usuario.id, chat],
  );
  res.json(rows[0]);
});

router.post('/eu/telegram-teste', async (req, res) => {
  const { rows } = await db.query('SELECT telegram_chat_id FROM usuarios WHERE id = $1', [req.usuario.id]);
  const chat = rows[0]?.telegram_chat_id;
  if (!chat) throw new ErroHttp(400, 'Cadastre seu Chat ID primeiro');
  const ok = await telegram.enviar(chat, '✅ <b>ClimaTrack</b>: notificações configuradas com sucesso!');
  if (!ok) throw new ErroHttp(502, 'Não foi possível enviar. Verifique o token do bot e o Chat ID.');
  res.json({ ok });
});

// Eventos em tempo real (SSE)
router.get('/eventos', (req, res) => {
  eventos.inscrever(req.usuario.id, res);
});

// =====================================================
// DISPOSITIVOS
// =====================================================

async function meuDispositivo(req) {
  const { rows } = await db.query('SELECT * FROM dispositivos WHERE id = $1 AND usuario_id = $2', [
    req.params.id,
    req.usuario.id,
  ]);
  if (!rows[0]) throw new ErroHttp(404, 'Dispositivo não encontrado');
  return rows[0];
}

router.get('/dispositivos', async (req, res) => {
  const { rows } = await db.query(
    `SELECT d.*, l.temperatura, l.umidade, l.indice_calor, l.data_hora AS ultima_leitura
       FROM dispositivos d
       LEFT JOIN LATERAL (
         SELECT temperatura, umidade, indice_calor, data_hora FROM leituras
          WHERE dispositivo_id = d.id ORDER BY data_hora DESC LIMIT 1
       ) l ON true
      WHERE d.usuario_id = $1
      ORDER BY d.criado_em`,
    [req.usuario.id],
  );
  res.json(rows);
});

// "Reivindicar" um dispositivo pelo DEVICE_ID gravado no firmware
router.post('/dispositivos', async (req, res) => {
  const id = String(req.body.id || '').trim();
  if (!/^[\w-]{1,40}$/.test(id)) throw new ErroHttp(400, 'ID inválido (use letras, números, - ou _)');

  const { rows } = await db.query(
    `INSERT INTO dispositivos (id, usuario_id, nome, local) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET usuario_id = EXCLUDED.usuario_id,
       nome = COALESCE(EXCLUDED.nome, dispositivos.nome), local = COALESCE(EXCLUDED.local, dispositivos.local)
     WHERE dispositivos.usuario_id IS NULL OR dispositivos.usuario_id = EXCLUDED.usuario_id
     RETURNING *`,
    [id, req.usuario.id, req.body.nome || null, req.body.local || null],
  );
  if (!rows[0]) throw new ErroHttp(409, 'Este dispositivo já pertence a outra conta');
  res.status(201).json(rows[0]);
});

router.put('/dispositivos/:id', async (req, res) => {
  const atual = await meuDispositivo(req);
  const campo = (nome) => (req.body[nome] === undefined || req.body[nome] === '' ? atual[nome] : req.body[nome]);
  const lim = {
    temp_max: Number(campo('temp_max')),
    temp_min: Number(campo('temp_min')),
    umid_max: Number(campo('umid_max')),
    umid_min: Number(campo('umid_min')),
  };
  if (Object.values(lim).some((v) => !Number.isFinite(v))) throw new ErroHttp(400, 'Limites devem ser numéricos');
  if (lim.temp_min >= lim.temp_max || lim.umid_min >= lim.umid_max) {
    throw new ErroHttp(400, 'O limite mínimo deve ser menor que o máximo');
  }

  const { rows } = await db.query(
    `UPDATE dispositivos SET nome = $2, local = $3, temp_max = $4, temp_min = $5, umid_max = $6, umid_min = $7
      WHERE id = $1 RETURNING *`,
    [atual.id, campo('nome'), campo('local'), lim.temp_max, lim.temp_min, lim.umid_max, lim.umid_min],
  );

  // Sincroniza os limites usados pelo alarme local da borda
  let sincronizado = true;
  await mqtt
    .publicarComando(atual.id, { comando: 'limites', temp_max: lim.temp_max, umid_min: lim.umid_min }, 'usuario', req.usuario.id)
    .catch(() => (sincronizado = false));

  res.json({ ...rows[0], sincronizado });
});

router.delete('/dispositivos/:id', async (req, res) => {
  await meuDispositivo(req);
  await db.query('UPDATE dispositivos SET usuario_id = NULL WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

// =====================================================
// SÉRIES TEMPORAIS E ANÁLISE
// =====================================================

router.get('/dispositivos/:id/leituras', async (req, res) => {
  await meuDispositivo(req);
  const [janela, balde] = PERIODOS[periodo(req)];

  const sql = balde
    ? `SELECT date_bin($3::interval, data_hora, TIMESTAMPTZ '2000-01-01') AS t,
              round(avg(temperatura)::numeric, 1)::float8 AS temperatura,
              min(temperatura) AS temp_min, max(temperatura) AS temp_max,
              round(avg(umidade)::numeric, 1)::float8 AS umidade,
              min(umidade) AS umid_min, max(umidade) AS umid_max,
              round(avg(indice_calor)::numeric, 1)::float8 AS indice_calor,
              count(*)::int AS n
         FROM leituras
        WHERE dispositivo_id = $1 AND data_hora >= now() - $2::interval
        GROUP BY 1 ORDER BY 1`
    : `SELECT data_hora AS t, temperatura, temperatura AS temp_min, temperatura AS temp_max,
              umidade, umidade AS umid_min, umidade AS umid_max, indice_calor, 1 AS n
         FROM leituras
        WHERE dispositivo_id = $1 AND data_hora >= now() - $2::interval
        ORDER BY data_hora`;

  const { rows } = await db.query(sql, balde ? [req.params.id, janela, balde] : [req.params.id, janela]);
  res.json({ periodo: periodo(req), agregacao: balde, pontos: rows });
});

router.get('/dispositivos/:id/resumo', async (req, res) => {
  const disp = await meuDispositivo(req);
  const [janela] = PERIODOS[periodo(req)];

  const { rows } = await db.query(
    `SELECT count(*)::int AS total_leituras,
            min(temperatura) AS temp_min, max(temperatura) AS temp_max,
            round(avg(temperatura)::numeric, 1)::float8 AS temp_media,
            round(stddev_samp(temperatura)::numeric, 2)::float8 AS temp_desvio,
            min(umidade) AS umid_min, max(umidade) AS umid_max,
            round(avg(umidade)::numeric, 1)::float8 AS umid_media,
            round(100.0 * count(*) FILTER (
              WHERE temperatura BETWEEN $3 AND $4 AND umidade BETWEEN $5 AND $6
            ) / NULLIF(count(*), 0), 1)::float8 AS conformidade_pct
       FROM leituras
      WHERE dispositivo_id = $1 AND data_hora >= now() - $2::interval`,
    [disp.id, janela, disp.temp_min, disp.temp_max, disp.umid_min, disp.umid_max],
  );

  const alertas = await db.query(
    `SELECT count(*)::int AS total,
            round(avg(latencia_ms))::int AS latencia_media_ms,
            max(latencia_ms) AS latencia_max_ms
       FROM alertas
      WHERE dispositivo_id = $1 AND estado = 'disparado' AND criado_em >= now() - $2::interval`,
    [disp.id, janela],
  );

  const ultima = await db.query(
    'SELECT * FROM leituras WHERE dispositivo_id = $1 ORDER BY data_hora DESC LIMIT 1',
    [disp.id],
  );

  res.json({
    dispositivo: disp,
    periodo: periodo(req),
    estatisticas: rows[0],
    alertas: alertas.rows[0],
    ultima_leitura: ultima.rows[0] || null,
  });
});

router.get('/dispositivos/:id/alertas', async (req, res) => {
  await meuDispositivo(req);
  const { rows } = await db.query(
    'SELECT * FROM alertas WHERE dispositivo_id = $1 ORDER BY criado_em DESC LIMIT 50',
    [req.params.id],
  );
  res.json(rows);
});

router.get('/dispositivos/:id/exportar.csv', async (req, res) => {
  await meuDispositivo(req);
  const [janela] = PERIODOS[periodo(req)];
  const { rows } = await db.query(
    `SELECT data_hora, temperatura, umidade, indice_calor, rssi, motivo FROM leituras
      WHERE dispositivo_id = $1 AND data_hora >= now() - $2::interval ORDER BY data_hora`,
    [req.params.id, janela],
  );

  const linhas = ['data_hora;temperatura;umidade;indice_calor;rssi;motivo'];
  for (const r of rows) {
    linhas.push([r.data_hora.toISOString(), r.temperatura, r.umidade, r.indice_calor ?? '', r.rssi ?? '', r.motivo ?? ''].join(';'));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}-${periodo(req)}.csv"`);
  res.send(linhas.join('\n'));
});

// =====================================================
// COMANDOS (nuvem -> borda)
// =====================================================

const COMANDOS_PERMITIDOS = new Set(['led', 'buzzer', 'intervalo', 'status']);

router.post('/dispositivos/:id/comandos', async (req, res) => {
  const disp = await meuDispositivo(req);
  const { comando, valor } = req.body;
  if (!COMANDOS_PERMITIDOS.has(comando)) throw new ErroHttp(400, 'Comando não permitido');

  const payload = { comando };
  if (valor !== undefined) payload.valor = Number(valor);

  try {
    await mqtt.publicarComando(disp.id, payload, 'usuario', req.usuario.id);
  } catch (err) {
    throw new ErroHttp(503, err.message);
  }
  res.json({ enviado: payload });
});

// =====================================================
// TRATAMENTO DE ERROS
// =====================================================

router.use((err, req, res, next) => {
  if (err instanceof ErroHttp) return res.status(err.status).json({ erro: err.message });
  console.error('[api]', err);
  res.status(500).json({ erro: 'Erro interno' });
});

module.exports = router;
