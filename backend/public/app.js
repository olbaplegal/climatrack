// =====================================================
// ClimaTrack - painel (front-end sem framework)
// =====================================================

const estado = {
  dispositivos: [],
  selecionado: null,
  periodo: localStorageGet('periodo') || '24h',
  graficos: {},
};

const $ = (sel) => document.querySelector(sel);
const fmt = (v, casas = 1) => (v === null || v === undefined ? '–' : Number(v).toFixed(casas).replace('.', ','));
const fmtData = (d) =>
  new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function localStorageGet(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function localStorageSet(k, v) {
  try { localStorage.setItem(k, v); } catch {}
}

function cor(nome) {
  return getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 3500);
}

async function api(url, opcoes = {}) {
  const resp = await fetch(`/api${url}`, {
    ...opcoes,
    headers: { 'Content-Type': 'application/json', ...(opcoes.headers || {}) },
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });
  if (resp.status === 401) {
    location.href = '/login.html';
    throw new Error('não autenticado');
  }
  if (resp.status === 204) return null;
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.erro || 'Erro');
  return json;
}

// =====================================================
// DISPOSITIVOS
// =====================================================

function statusTexto(d) {
  if (d.status === 'online') return 'online';
  if (d.status === 'offline') return 'offline';
  return 'sem status';
}

function renderLista() {
  const lista = $('#lista-disp');
  lista.innerHTML = '';
  for (const d of estado.dispositivos) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'item-disp' + (d.id === estado.selecionado ? ' ativo' : '');
    b.innerHTML = `
      <div class="nome"></div>
      <span class="status ${d.status}">${statusTexto(d)}</span>
      <div class="valores">${d.temperatura != null ? `${fmt(d.temperatura)} °C · ${fmt(d.umidade, 0)} %` : 'sem leituras'}</div>`;
    b.querySelector('.nome').textContent = d.nome || d.id;
    b.addEventListener('click', () => selecionar(d.id));
    lista.appendChild(b);
  }
  $('#vazio').hidden = estado.dispositivos.length > 0;
  $('#painel').hidden = !estado.selecionado;
}

async function carregarDispositivos() {
  estado.dispositivos = await api('/dispositivos');
  if (!estado.dispositivos.some((d) => d.id === estado.selecionado)) {
    estado.selecionado = estado.dispositivos[0]?.id || null;
  }
  renderLista();
  if (estado.selecionado) await carregarPainel();
}

function selecionar(id) {
  estado.selecionado = id;
  renderLista();
  carregarPainel();
}

$('#form-novo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const dados = Object.fromEntries(new FormData(e.target));
  try {
    const d = await api('/dispositivos', { method: 'POST', body: dados });
    e.target.reset();
    $('#erro-novo').textContent = '';
    estado.selecionado = d.id;
    await carregarDispositivos();
  } catch (err) {
    $('#erro-novo').textContent = err.message;
  }
});

// =====================================================
// PAINEL DO DISPOSITIVO
// =====================================================

function dispositivoAtual() {
  return estado.dispositivos.find((d) => d.id === estado.selecionado);
}

async function carregarPainel() {
  const id = estado.selecionado;
  if (!id) return;
  document.querySelectorAll('#periodos button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.p === estado.periodo));
  $('#btn-csv').href = `/api/dispositivos/${encodeURIComponent(id)}/exportar.csv?periodo=${estado.periodo}`;

  const [resumo, serie, alertas] = await Promise.all([
    api(`/dispositivos/${encodeURIComponent(id)}/resumo?periodo=${estado.periodo}`),
    api(`/dispositivos/${encodeURIComponent(id)}/leituras?periodo=${estado.periodo}`),
    api(`/dispositivos/${encodeURIComponent(id)}/alertas`),
  ]);
  if (id !== estado.selecionado) return; // usuário trocou de dispositivo no meio

  renderCabecalho(resumo.dispositivo);
  renderKpis(resumo);
  renderGraficos(serie, resumo.dispositivo);
  renderAlertas(alertas);
  preencherLimites(resumo.dispositivo);
}

function renderCabecalho(d) {
  $('#disp-nome').textContent = d.nome || d.id;
  const visto = d.ultimo_dado_em ? `último dado ${fmtData(d.ultimo_dado_em)}` : 'nenhum dado recebido';
  $('#disp-sub').textContent = [d.id, d.local, visto].filter(Boolean).join(' · ');
  const st = $('#disp-status');
  st.className = `status ${d.status}`;
  st.textContent = statusTexto(d);
}

function renderKpis({ estatisticas: e, alertas: a, ultima_leitura: u, dispositivo: d }) {
  $('#k-temp').innerHTML = u ? `${fmt(u.temperatura)}<small> °C</small>` : '–';
  $('#k-umid').innerHTML = u ? `${fmt(u.umidade, 0)}<small> %</small>` : '–';
  $('#k-ic').innerHTML = u?.indice_calor != null ? `${fmt(u.indice_calor)}<small> °C</small>` : '–';
  $('#k-temp-det').textContent = e.total_leituras
    ? `mín ${fmt(e.temp_min)} · méd ${fmt(e.temp_media)} · máx ${fmt(e.temp_max)} · σ ${fmt(e.temp_desvio, 2)}`
    : 'sem dados no período';
  $('#k-umid-det').textContent = e.total_leituras
    ? `mín ${fmt(e.umid_min, 0)} · méd ${fmt(e.umid_media, 0)} · máx ${fmt(e.umid_max, 0)}`
    : '';
  $('#k-conf').innerHTML = e.conformidade_pct != null ? `${fmt(e.conformidade_pct)}<small> %</small>` : '–';
  $('#k-conf-det').textContent = `${fmt(d.temp_min, 0)}–${fmt(d.temp_max, 0)} °C e ${fmt(d.umid_min, 0)}–${fmt(d.umid_max, 0)} % · ${e.total_leituras} leituras`;
  $('#k-disp').innerHTML = e.disponibilidade_pct != null ? `${fmt(e.disponibilidade_pct)}<small> %</small>` : '–';
  $('#k-alertas').textContent = a.total;
  $('#k-alertas-det').textContent = a.latencia_media_ms != null
    ? `latência média ${a.latencia_media_ms} ms · p95 ${a.latencia_p95_ms} ms · máx ${a.latencia_max_ms} ms`
    : 'nenhum alerta disparado';
}

// ---------- Gráficos ----------

// Plugin: desenha os limites configurados como linhas tracejadas com rótulo
const pluginLimites = {
  id: 'limites',
  afterDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea, scales } = chart;
    for (const lim of opts.linhas || []) {
      const y = scales.y.getPixelForValue(lim.valor);
      if (y < chartArea.top || y > chartArea.bottom) continue;
      ctx.save();
      ctx.strokeStyle = cor('--tinta-muda');
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(chartArea.left, y);
      ctx.lineTo(chartArea.right, y);
      ctx.stroke();
      ctx.fillStyle = cor('--tinta-2');
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(lim.rotulo, chartArea.right - 4, y - 4);
      ctx.restore();
    }
  },
};

function hexParaRgba(hex, a) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function criarGrafico(canvas, { rotulo, unidade, corSerie, casas }) {
  const grade = cor('--grade');
  const tintaMuda = cor('--tinta-muda');
  return new Chart(canvas, {
    type: 'line',
    data: {
      datasets: [
        { label: `${rotulo} (máx)`, data: [], borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: hexParaRgba(corSerie, 0.14) },
        { label: `${rotulo} (mín)`, data: [], borderWidth: 0, pointRadius: 0, fill: false },
        {
          label: rotulo, data: [], borderColor: corSerie, backgroundColor: corSerie,
          borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 2,
          pointHoverBorderColor: cor('--superficie'), tension: 0.25,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => item.datasetIndex === 2,
          callbacks: {
            label: (item) => {
              const p = item.raw;
              const faixa = p.min !== p.max ? ` (mín ${fmt(p.min, casas)} · máx ${fmt(p.max, casas)})` : '';
              return ` ${rotulo}: ${fmt(p.y, casas)} ${unidade}${faixa}`;
            },
          },
        },
        limites: { linhas: [] },
      },
      scales: {
        x: {
          type: 'time',
          bounds: 'data',
          time: { tooltipFormat: 'dd/MM HH:mm:ss', displayFormats: { minute: 'HH:mm', hour: 'HH:mm', day: 'dd/MM' } },
          grid: { display: false },
          border: { color: grade },
          ticks: { color: tintaMuda, maxRotation: 0, autoSkipPadding: 16 },
        },
        y: {
          grid: { color: grade },
          border: { display: false },
          ticks: { color: tintaMuda, callback: (v) => `${v}` },
          grace: '10%',
        },
      },
    },
    plugins: [pluginLimites],
  });
}

function garantirGraficos() {
  if (estado.graficos.temp) return;
  estado.graficos.temp = criarGrafico($('#graf-temp'), { rotulo: 'Temperatura', unidade: '°C', corSerie: cor('--serie-temp'), casas: 1 });
  estado.graficos.umid = criarGrafico($('#graf-umid'), { rotulo: 'Umidade', unidade: '%', corSerie: cor('--serie-umid'), casas: 0 });
}

function renderGraficos(serie, d) {
  garantirGraficos();
  const pts = serie.pontos;
  const temp = estado.graficos.temp;
  const umid = estado.graficos.umid;

  temp.data.datasets[0].data = pts.map((p) => ({ x: Date.parse(p.t), y: p.temp_max }));
  temp.data.datasets[1].data = pts.map((p) => ({ x: Date.parse(p.t), y: p.temp_min }));
  temp.data.datasets[2].data = pts.map((p) => ({ x: Date.parse(p.t), y: p.temperatura, min: p.temp_min, max: p.temp_max }));
  temp.options.plugins.limites.linhas = [
    { valor: d.temp_max, rotulo: `máx ${fmt(d.temp_max)} °C` },
    { valor: d.temp_min, rotulo: `mín ${fmt(d.temp_min)} °C` },
  ];

  umid.data.datasets[0].data = pts.map((p) => ({ x: Date.parse(p.t), y: p.umid_max }));
  umid.data.datasets[1].data = pts.map((p) => ({ x: Date.parse(p.t), y: p.umid_min }));
  umid.data.datasets[2].data = pts.map((p) => ({ x: Date.parse(p.t), y: p.umidade, min: p.umid_min, max: p.umid_max }));
  umid.options.plugins.limites.linhas = [
    { valor: d.umid_max, rotulo: `máx ${fmt(d.umid_max, 0)} %` },
    { valor: d.umid_min, rotulo: `mín ${fmt(d.umid_min, 0)} %` },
  ];

  temp.update();
  umid.update();

  const sub = serie.agregacao
    ? `Média a cada ${serie.agregacao.replace(/minutes?/, 'min').replace(/hours?/, 'h')}; a faixa sombreada mostra mínimo–máximo de cada intervalo. Linhas tracejadas = limites de alerta.`
    : 'Leituras individuais. Linhas tracejadas = limites de alerta.';
  $('#sub-temp').textContent = sub;
  $('#sub-umid').textContent = sub;

  renderTabelaDados(pts);
}

function renderTabelaDados(pts) {
  const linhas = pts.slice(-50).reverse().map(
    (p) => `<tr><td>${fmtData(p.t)}</td><td class="num">${fmt(p.temperatura)}</td><td class="num">${fmt(p.umidade, 0)}</td><td class="num">${fmt(p.indice_calor)}</td></tr>`,
  );
  $('#tab-temp').innerHTML = `<table><thead><tr><th>Data/hora</th><th>Temp. (°C)</th><th>Umid. (%)</th><th>Sensação (°C)</th></tr></thead><tbody>${linhas.join('') || '<tr><td colspan="4" class="muted">Sem dados</td></tr>'}</tbody></table>`;
}

// Acrescenta uma leitura nova (tempo real) quando o período é de leituras individuais
function adicionarPontoAoVivo(l) {
  if (estado.periodo !== '1h' || !estado.graficos.temp) return carregarPainelAgendado();
  const x = Date.parse(l.data_hora);
  const add = (graf, v) => {
    graf.data.datasets[0].data.push({ x, y: v });
    graf.data.datasets[1].data.push({ x, y: v });
    graf.data.datasets[2].data.push({ x, y: v, min: v, max: v });
    graf.update();
  };
  add(estado.graficos.temp, l.temperatura);
  add(estado.graficos.umid, l.umidade);
  carregarPainelAgendado(); // atualiza KPIs
}

// Evita recarregar o painel várias vezes seguidas quando chegam muitos eventos
function carregarPainelAgendado() {
  clearTimeout(carregarPainelAgendado.t);
  carregarPainelAgendado.t = setTimeout(carregarPainel, 1500);
}

function renderAlertas(alertas) {
  $('#tab-alertas').innerHTML = alertas.length
    ? alertas.map((a) => `
        <tr>
          <td class="num">${fmtData(a.criado_em)}</td>
          <td><span class="selo ${a.estado}">${a.estado === 'disparado' ? '⚠ Disparado' : '✓ Normalizado'}</span></td>
          <td>${escapar(a.mensagem)}</td>
          <td>${a.enviado_telegram ? `enviado${a.latencia_ms != null ? ` (${a.latencia_ms} ms)` : ''}` : '<span class="muted">não</span>'}</td>
        </tr>`).join('')
    : '<tr><td colspan="4" class="muted">Nenhum alerta</td></tr>';
}

function escapar(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function preencherLimites(d) {
  const f = $('#form-limites');
  for (const campo of ['nome', 'local', 'temp_min', 'temp_max', 'umid_min', 'umid_max']) {
    if (document.activeElement !== f[campo]) f[campo].value = d[campo] ?? '';
  }
  const intervalo = d.status_info?.intervalo_ms;
  if (intervalo && document.activeElement !== $('#form-intervalo').valor) {
    $('#form-intervalo').valor.value = Math.round(intervalo / 1000);
  }
}

// =====================================================
// AÇÕES
// =====================================================

document.querySelectorAll('#periodos button').forEach((b) =>
  b.addEventListener('click', () => {
    estado.periodo = b.dataset.p;
    localStorageSet('periodo', estado.periodo);
    carregarPainel();
  }),
);

async function enviarComando(comando, valor) {
  try {
    await api(`/dispositivos/${encodeURIComponent(estado.selecionado)}/comandos`, {
      method: 'POST',
      body: valor === undefined ? { comando } : { comando, valor },
    });
    toast(`Comando "${comando}" enviado ao dispositivo`);
  } catch (err) {
    toast(`Falha: ${err.message}`);
  }
}

document.querySelectorAll('[data-cmd]').forEach((b) =>
  b.addEventListener('click', () => enviarComando(b.dataset.cmd, b.dataset.valor)),
);

$('#form-intervalo').addEventListener('submit', (e) => {
  e.preventDefault();
  enviarComando('intervalo', e.target.valor.value);
});

$('#form-limites').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api(`/dispositivos/${encodeURIComponent(estado.selecionado)}`, {
      method: 'PUT',
      body: Object.fromEntries(new FormData(e.target)),
    });
    $('#erro-limites').textContent = '';
    toast(r.sincronizado ? 'Limites salvos e enviados ao ESP32' : 'Limites salvos (broker offline: ESP32 não sincronizado)');
    await carregarDispositivos();
  } catch (err) {
    $('#erro-limites').textContent = err.message;
  }
});

$('#btn-remover').addEventListener('click', async () => {
  if (!confirm('Remover este dispositivo da sua conta? O histórico é mantido.')) return;
  await api(`/dispositivos/${encodeURIComponent(estado.selecionado)}`, { method: 'DELETE' });
  estado.selecionado = null;
  await carregarDispositivos();
});

$('#btn-sair').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  location.href = '/login.html';
});

// ---------- Configurações do Telegram ----------

$('#btn-config').addEventListener('click', () => $('#dlg-config').showModal());
$('#btn-fechar').addEventListener('click', () => $('#dlg-config').close());

$('#form-config').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/eu', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
    $('#erro-config').textContent = '';
    toast('Chat ID salvo');
    $('#dlg-config').close();
  } catch (err) {
    $('#erro-config').textContent = err.message;
  }
});

$('#btn-teste').addEventListener('click', async () => {
  try {
    await api('/eu', { method: 'PUT', body: Object.fromEntries(new FormData($('#form-config'))) });
    await api('/eu/telegram-teste', { method: 'POST' });
    $('#erro-config').textContent = '';
    toast('Mensagem de teste enviada! Confira o Telegram.');
  } catch (err) {
    $('#erro-config').textContent = err.message;
  }
});

// =====================================================
// TEMPO REAL (Server-Sent Events)
// =====================================================

function conectarEventos() {
  const es = new EventSource('/api/eventos');

  es.addEventListener('leitura', (ev) => {
    const l = JSON.parse(ev.data);
    const d = estado.dispositivos.find((x) => x.id === l.dispositivo_id);
    if (d) {
      Object.assign(d, { temperatura: l.temperatura, umidade: l.umidade, status: 'online' });
      renderLista();
    }
    if (l.dispositivo_id === estado.selecionado) adicionarPontoAoVivo(l);
  });

  es.addEventListener('status', (ev) => {
    const s = JSON.parse(ev.data);
    const d = estado.dispositivos.find((x) => x.id === s.dispositivo_id);
    if (d) {
      d.status = s.status;
      d.status_info = s.info;
      renderLista();
    }
    if (s.dispositivo_id === estado.selecionado) carregarPainelAgendado();
  });

  es.addEventListener('alerta', (ev) => {
    const a = JSON.parse(ev.data);
    toast(`${a.estado === 'disparado' ? '⚠' : '✓'} ${a.dispositivo_id}: ${a.mensagem}`);
    if (a.dispositivo_id === estado.selecionado) carregarPainelAgendado();
  });
}

// =====================================================
// INÍCIO
// =====================================================

(async function iniciar() {
  const eu = await api('/eu');
  $('#usuario-nome').textContent = eu.nome;
  $('#form-config').telegram_chat_id.value = eu.telegram_chat_id || '';
  await carregarDispositivos();
  conectarEventos();
})();
