// Server-Sent Events: empurra leituras/alertas em tempo real para o navegador
// de cada usuário logado (sem precisar recarregar a página).

const conexoes = new Map(); // usuarioId -> Set<res>

function inscrever(usuarioId, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': conectado\n\n');

  if (!conexoes.has(usuarioId)) conexoes.set(usuarioId, new Set());
  conexoes.get(usuarioId).add(res);

  res.on('close', () => {
    const set = conexoes.get(usuarioId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) conexoes.delete(usuarioId);
  });
}

function emitir(usuarioId, evento, dados) {
  const set = conexoes.get(usuarioId);
  if (!set) return;
  const msg = `event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`;
  for (const res of set) res.write(msg);
}

// Comentário periódico evita que proxies (Render, Nginx) fechem a conexão ociosa
setInterval(() => {
  for (const set of conexoes.values()) for (const res of set) res.write(': ping\n\n');
}, 25000).unref();

module.exports = { inscrever, emitir };
