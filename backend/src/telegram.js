const config = require('./config');

const API = () => `https://api.telegram.org/bot${config.telegramToken}`;

function habilitado() {
  return Boolean(config.telegramToken);
}

async function enviar(chatId, texto) {
  if (!habilitado() || !chatId) return false;
  try {
    const resp = await fetch(`${API()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'HTML' }),
    });
    if (!resp.ok) {
      console.error('[telegram] falha ao enviar:', resp.status, await resp.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('[telegram] erro:', err.message);
    return false;
  }
}

// Long polling: recebe mensagens enviadas ao bot e repassa ao handler.
async function iniciarPolling(handler) {
  if (!habilitado() || !config.telegramPolling) return;
  console.log('[telegram] bot escutando comandos');
  let offset = 0;

  for (;;) {
    try {
      const resp = await fetch(`${API()}/getUpdates?timeout=30&offset=${offset}`);
      const json = await resp.json();
      if (!json.ok) throw new Error(json.description);

      for (const update of json.result) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (msg?.text) {
          handler(String(msg.chat.id), msg.text.trim()).catch((err) =>
            console.error('[telegram] erro no comando:', err.message),
          );
        }
      }
    } catch (err) {
      console.error('[telegram] polling:', err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

module.exports = { habilitado, enviar, iniciarPolling };
