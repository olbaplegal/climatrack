// Comandos aceitos pelo bot do Telegram (canal extra de comunicação bidirecional)
const db = require('./db');
const telegram = require('./telegram');
const mqtt = require('./mqtt');

const AJUDA = [
  '<b>ClimaTrack</b> - comandos:',
  '/id - mostra seu Chat ID (cole no painel)',
  '/status - última leitura dos seus dispositivos',
  '/led_on [id] - liga o LED do dispositivo',
  '/led_off [id] - desliga o LED do dispositivo',
].join('\n');

async function dispositivosDoChat(chatId) {
  const { rows } = await db.query(
    `SELECT d.*, l.temperatura, l.umidade, l.data_hora
       FROM dispositivos d
       JOIN usuarios u ON u.id = d.usuario_id
       LEFT JOIN LATERAL (
         SELECT temperatura, umidade, data_hora FROM leituras
          WHERE dispositivo_id = d.id ORDER BY data_hora DESC LIMIT 1
       ) l ON true
      WHERE u.telegram_chat_id = $1
      ORDER BY d.id`,
    [chatId],
  );
  return rows;
}

async function tratarMensagem(chatId, texto) {
  const [cmdBruto, argumento] = texto.split(/\s+/);
  const cmd = cmdBruto.toLowerCase().replace(/@.*$/, ''); // remove "@NomeDoBot" em grupos

  if (cmd === '/start' || cmd === '/id' || cmd === '/ajuda') {
    return telegram.enviar(chatId, `Seu Chat ID: <code>${chatId}</code>\n\n${AJUDA}`);
  }

  const dispositivos = await dispositivosDoChat(chatId);
  if (dispositivos.length === 0) {
    return telegram.enviar(chatId, 'Nenhum dispositivo vinculado a este chat. Cadastre seu Chat ID no painel.');
  }

  if (cmd === '/status') {
    const linhas = dispositivos.map((d) => {
      const leitura = d.data_hora
        ? `${d.temperatura} °C · ${d.umidade} % (${d.data_hora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })})`
        : 'sem leituras';
      return `${d.status === 'online' ? '🟢' : '🔴'} <b>${d.nome || d.id}</b>: ${leitura}`;
    });
    return telegram.enviar(chatId, linhas.join('\n'));
  }

  if (cmd === '/led_on' || cmd === '/led_off') {
    const alvo = argumento ? dispositivos.find((d) => d.id === argumento) : dispositivos[0];
    if (!alvo) return telegram.enviar(chatId, `Dispositivo "${argumento}" não encontrado.`);
    const valor = cmd === '/led_on' ? 1 : 0;
    await mqtt.publicarComando(alvo.id, { comando: 'led', valor }, 'telegram', alvo.usuario_id);
    return telegram.enviar(chatId, `💡 LED de <b>${alvo.nome || alvo.id}</b> ${valor ? 'ligado' : 'desligado'}.`);
  }

  return telegram.enviar(chatId, AJUDA);
}

function iniciar() {
  telegram.iniciarPolling(tratarMensagem);
}

module.exports = { iniciar };
