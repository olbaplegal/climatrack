// Gera o Relatório Técnico do ClimaTrack seguindo o template da disciplina.
// Uso: npm i docx && node gerar_relatorio.js saida.docx  (lê as imagens de ./img; copie figuras/ para img/)
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, ShadingType,
  AlignmentType, HeadingLevel, PageBreak, Footer, PageNumber, LevelFormat, BorderStyle, VerticalAlign,
} = require('docx');

const IMG = path.join(__dirname, 'img');
const SAIDA = process.argv[2];
const FONTE = 'Arial';
const LARG = 9071; // largura útil (A4, margens 3 cm / 2 cm) em DXA

// ---------- helpers de texto ----------
// Marcação simples: **negrito**, _itálico_, `código`, [[pendência destacada]]
function runs(texto, base = {}) {
  const partes = texto.split(/(\*\*[^*]+\*\*|_[^_]+_|`[^`]+`|\[\[[^\]]+\]\])/g).filter(Boolean);
  return partes.map((p) => {
    if (p.startsWith('**')) return new TextRun({ text: p.slice(2, -2), bold: true, ...base });
    if (p.startsWith('`')) return new TextRun({ text: p.slice(1, -1), font: 'Courier New', size: (base.size || 24) - 2, ...base });
    if (p.startsWith('[[')) return new TextRun({ text: p.slice(2, -2), highlight: 'yellow', ...base });
    if (p.startsWith('_') && p.endsWith('_') && p.length > 2) return new TextRun({ text: p.slice(1, -1), italics: true, ...base });
    return new TextRun({ text: p, ...base });
  });
}
const P = (t, o = {}) => new Paragraph({ children: runs(t), alignment: AlignmentType.JUSTIFIED, indent: { firstLine: 709 }, spacing: { after: 120, line: 360 }, ...o });
const PS = (t, o = {}) => new Paragraph({ children: runs(t), alignment: AlignmentType.JUSTIFIED, spacing: { after: 120, line: 360 }, ...o });
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });
const B = (t, nivel = 0) => new Paragraph({ children: runs(t), numbering: { reference: 'bolinhas', level: nivel }, alignment: AlignmentType.JUSTIFIED, spacing: { after: 60, line: 360 } });
const N = (t) => new Paragraph({ children: runs(t), numbering: { reference: 'numeros', level: 0 }, alignment: AlignmentType.JUSTIFIED, spacing: { after: 60, line: 360 } });
const quebra = () => new Paragraph({ children: [new PageBreak()] });
const vazio = (n = 1) => Array.from({ length: n }, () => new Paragraph({ children: [] }));

let nFig = 0, nTab = 0;
const legenda = (t) => new Paragraph({ children: runs(t, { size: 20 }), alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, keepNext: true });
const fonte = (t = 'Fonte: os autores (2026).') => new Paragraph({ children: runs(t, { size: 20 }), alignment: AlignmentType.CENTER, spacing: { after: 240 } });

function tamanhoPng(arq) {
  const b = fs.readFileSync(arq);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
function figura(arquivo, titulo, larguraPx = 600, txtFonte) {
  const arq = path.join(IMG, arquivo);
  const { w, h } = tamanhoPng(arq);
  let lw = larguraPx, lh = Math.round((h / w) * larguraPx);
  if (lh > 820) { lh = 820; lw = Math.round((w / h) * 820); }
  nFig++;
  return [
    legenda(`**Figura ${nFig}** – ${titulo}`),
    new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, children: [new ImageRun({ type: 'png', data: fs.readFileSync(arq), transformation: { width: lw, height: lh } })] }),
    fonte(txtFonte),
  ];
}
function figuraPendente(titulo, instrucao) {
  nFig++;
  return [
    legenda(`**Figura ${nFig}** – ${titulo}`),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600, after: 600 }, border: { top: borda, bottom: borda, left: borda, right: borda }, children: runs(`[[${instrucao}]]`) }),
    fonte(),
  ];
}

// ---------- tabelas ----------
const borda = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
const bordas = { top: borda, bottom: borda, left: borda, right: borda };
function celula(texto, largura, cab = false) {
  return new TableCell({
    width: { size: largura, type: WidthType.DXA },
    borders: bordas,
    verticalAlign: VerticalAlign.CENTER,
    shading: cab ? { fill: 'D9E2F3', type: ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: String(texto).split('\n').map((linha) => new Paragraph({ children: runs(linha, cab ? { size: 20, bold: true } : { size: 20 }), spacing: { after: 0, line: 260 } })),
  });
}
function tabela(titulo, cabecalho, linhas, pesos, txtFonte) {
  const soma = pesos.reduce((a, b) => a + b, 0);
  const larguras = pesos.map((p) => Math.floor((p / soma) * LARG));
  larguras[larguras.length - 1] += LARG - larguras.reduce((a, b) => a + b, 0);
  nTab++;
  return [
    legenda(`**Tabela ${nTab}** – ${titulo}`),
    new Table({
      width: { size: LARG, type: WidthType.DXA },
      columnWidths: larguras,
      rows: [
        new TableRow({ tableHeader: true, children: cabecalho.map((c, i) => celula(c, larguras[i], true)) }),
        ...linhas.map((l) => new TableRow({ cantSplit: true, children: l.map((c, i) => celula(c, larguras[i])) })),
      ],
    }),
    fonte(txtFonte),
  ];
}

// =====================================================================
// CONTEÚDO
// =====================================================================
const capa = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [new TextRun({ text: 'UniSENAI PR', bold: true, size: 28 })] }),
  ...vazio(4),
  new Paragraph({ alignment: AlignmentType.CENTER, children: runs('[[Período/Turma]]', { size: 24 }) }),
  ...vazio(4),
  ...['[[Nome Completo]]', '[[Nome Completo]]', '[[Nome Completo]]', '[[Nome Completo]]', '[[Nome Completo]]'].map(
    (n) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: runs(n, { size: 24 }) }),
  ),
  ...vazio(5),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: 'ClimaTrack', bold: true, size: 40 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Plataforma IoT para monitoramento de temperatura e umidade com alertas em tempo real', size: 26 })] }),
  ...vazio(9),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [new TextRun({ text: 'São José dos Pinhais', size: 24 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '2026', size: 24 })] }),
  quebra(),
];

const identificacao = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 360 }, children: [new TextRun({ text: 'RELATÓRIO TÉCNICO DE PROJETO FINAL', bold: true, size: 28 })] }),
  PS('**Curso:** Engenharia de Software'),
  PS('**Disciplina:** Arquitetura de Sistemas IoT e Computação em Nuvem'),
  PS('**Professor:** Eduardo Tamanaha'),
  PS('**Coordenador:** Edgar de Oliveira Cabral Sobrinho'),
  PS('**Repositório do código-fonte:** github.com/olbaplegal/climatrack'),
  PS('**Aplicação publicada:** https://climatrack-y7ha.onrender.com'),
  ...vazio(1),
];

// ---------------- 1. CONTEXTUALIZAÇÃO ----------------
const sec1 = [
  H1('1. Contextualização'),
  P('Diversos setores dependem de manter temperatura e umidade dentro de faixas seguras: farmácias e unidades de saúde que armazenam vacinas e medicamentos termolábeis, estufas agrícolas, depósitos de alimentos, laboratórios e salas de servidores. Uma variação fora da faixa, quando não percebida a tempo, causa perda de estoque, quebra de equipamentos ou risco sanitário. O ClimaTrack é uma solução IoT e de computação em nuvem que monitora essas grandezas continuamente e avisa o responsável em segundos quando algo sai do esperado.'),
  H2('1.1. Descrição do Problema'),
  P('Em pequenos e médios estabelecimentos, o controle ambiental ainda é feito, em grande parte, com termômetros de leitura local e anotações manuais em planilhas, verificadas uma ou duas vezes por dia. Esse modelo apresenta três deficiências: (i) **não há aviso imediato** — uma geladeira que desliga de madrugada só é percebida na manhã seguinte; (ii) **não há histórico confiável** para auditoria, análise de tendência ou comprovação junto a órgãos fiscalizadores; e (iii) **não há visão centralizada** quando existem vários ambientes ou unidades.'),
  P('Os dataloggers comerciais resolvem parte do problema, mas costumam ser caros, exigem descarregar os dados manualmente e não enviam alertas. Há, portanto, uma oportunidade para uma solução de baixo custo, conectada e acessível pelo navegador e pelo celular, que é exatamente o cenário em que a combinação de sensores embarcados, mensageria leve (MQTT) e serviços de nuvem se destaca.'),
  H2('1.2. Proposta de Solução'),
  P('O ClimaTrack é oferecido como uma plataforma **SaaS (Software como Serviço)** multiusuário. No local monitorado, um **ESP32** com sensor **DHT11** coleta temperatura e umidade a cada 2,5 s e faz o **processamento na borda**: descarta leituras inválidas e picos de ruído, calcula a média móvel e o índice de calor, decide localmente se deve acionar o alarme (LED e buzzer) e só envia dados à nuvem no intervalo configurado ou quando há variação relevante.'),
  P('Os dados trafegam pelo protocolo **MQTT sobre TLS** até o broker **HiveMQ Cloud**. Um back-end em **Node.js**, hospedado no **Render**, consome as mensagens, grava a telemetria em **PostgreSQL** (Supabase), avalia regras de alerta e envia notificações ao **Telegram**. O usuário acessa um **painel web** com gráficos históricos e em tempo real, estatísticas, histórico de alertas e controles remotos, que enviam comandos de volta ao dispositivo (comunicação bidirecional).'),
  H2('1.3. Aplicação Prática e Justificativa'),
  P('Como cenário de referência adotou-se uma **rede de farmácias** que precisa manter geladeiras de vacinas entre 2 °C e 8 °C. Nesse contexto, os benefícios da solução são:'),
  B('**Prevenção de perdas:** o alerta chega ao celular do responsável em cerca de 1 segundo (valor medido), permitindo agir antes que o estoque seja comprometido.'),
  B('**Detecção de falha do próprio sensor:** se o dispositivo perder energia ou rede, a plataforma avisa que ele está _offline_, eliminando o "silêncio" perigoso de um monitor que parou de funcionar.'),
  B('**Histórico e conformidade:** todas as leituras ficam armazenadas, com gráficos, estatísticas (mínimo, média, máximo, desvio padrão), percentual de tempo dentro da faixa e exportação em CSV para auditoria.'),
  B('**Baixo custo:** o hardware do protótipo custa cerca de R$ 100 por ponto de medição, e a infraestrutura em nuvem do protótipo opera integralmente em planos gratuitos.'),
  B('**Autonomia local:** o alarme físico (LED/buzzer) é decidido no próprio ESP32 e continua funcionando mesmo sem internet.'),
  P('A mesma plataforma atende estufas agrícolas, adegas, salas de TI e laboratórios, bastando ajustar os limites de alerta de cada dispositivo pelo painel.'),
];

// ---------------- 2. ARQUITETURA ----------------
const sec2 = [
  H1('2. Arquitetura do Sistema'),
  P('A arquitetura segue o modelo em camadas típico de sistemas IoT: **borda** (sensor e microcontrolador), **comunicação** (broker MQTT), **nuvem** (back-end, regras e banco de dados) e **aplicação** (painel web e notificações). O fluxo é bidirecional: a telemetria sobe da borda para a nuvem e os comandos descem da nuvem para a borda.'),
  H2('2.1. Visão Geral e Diagrama de Componentes'),
  ...figura('arq.png', 'Diagrama de componentes do ClimaTrack', 600),
  P('A Figura 1 mostra os componentes e suas ligações. O **ESP32** publica telemetria e status no **HiveMQ Cloud** e assina o tópico de comandos. O **back-end Node.js** (Render) mantém uma conexão permanente com o broker: o módulo de **ingestão** valida e grava cada leitura no **PostgreSQL** (Supabase) e repassa os dados ao **motor de regras**, que dispara alertas no **Telegram** e, quando configurado, envia comandos de volta ao dispositivo (por exemplo, acender o LED). A **API REST** atende o **painel web**, que recebe atualizações em tempo real por _Server-Sent Events_ (SSE). O **UptimeRobot** consulta periodicamente a rota de saúde da API para medir a disponibilidade.'),
  H2('2.2. Especificação do Hardware e Sensores'),
  P('A Tabela 1 detalha os componentes físicos do protótipo e a Tabela 2, as ligações elétricas.'),
  ...tabela('Componentes de hardware do protótipo', ['Componente / Hardware', 'Modelo', 'Função no Sistema', 'Custo Estimado (R$)'], [
    ['Microcontrolador principal', 'ESP32 DevKit V1 (Xtensa dual-core 240 MHz, 520 KB SRAM, Wi-Fi 2,4 GHz)', 'Leitura do sensor, processamento na borda, conexão Wi-Fi/MQTT com TLS', 'R$ 45,00'],
    ['Sensor de coleta', 'DHT11 (módulo 3 pinos): 0–50 °C (±2 °C), 20–90 % UR (±5 %)', 'Captura de temperatura e umidade relativa do ambiente', 'R$ 15,00'],
    ['Atuador visual', 'LED interno da placa (GPIO 2)', 'Alarme local e acionamento remoto pela nuvem/Telegram', 'R$ 0,00 (incluso)'],
    ['Atuador sonoro (opcional)', 'Buzzer ativo 5 V (GPIO 15)', 'Alarme sonoro local; pode ser silenciado remotamente', 'R$ 5,00'],
    ['Montagem', 'Protoboard, jumpers e cabo micro-USB', 'Interligação e alimentação', 'R$ 35,00'],
    ['**Total**', '', '', '**R$ 100,00**'],
  ], [2.2, 3.2, 3.2, 1.6], 'Fonte: os autores (2026), com preços médios de varejo nacional em outubro de 2026.'),
  ...tabela('Ligações elétricas', ['Pino do componente', 'Pino do ESP32', 'Observação'], [
    ['DHT11 VCC (+)', '3V3', 'Alimentação 3,3 V'],
    ['DHT11 GND (−)', 'GND', 'Referência'],
    ['DHT11 DATA (S/OUT)', 'GPIO 4', 'Sensor "puro" de 4 pinos exige resistor de 10 kΩ entre DATA e 3V3'],
    ['Buzzer (+) / (−)', 'GPIO 15 / GND', 'Opcional'],
  ], [3, 2, 5]),
  P('O firmware também foi validado no simulador **Wokwi** com um sensor DHT22 (faixa −40 a 80 °C, ±0,5 °C), configurável sem alterar o código, apenas pelo arquivo `secrets.h`. Isso permitiu testar o fluxo completo antes da montagem física.'),
  ...figuraPendente('Protótipo físico montado (ESP32 + DHT11)', 'INSERIR AQUI A FOTO DO PROTÓTIPO FÍSICO MONTADO'),
  H2('2.3. Processamento na Borda (Edge Computing)'),
  P('O firmware foi escrito em C++ (Arduino) e implementa as rotinas da Tabela 3 antes de qualquer envio pela rede. O objetivo é entregar à nuvem dados já limpos, economizar banda e manter uma função de segurança que não depende da internet.'),
  ...tabela('Rotinas de processamento na borda', ['Rotina', 'Como funciona', 'Benefício'], [
    ['Amostragem e envio desacoplados', 'Lê o sensor a cada 2,5 s, mas publica a cada 15 s (intervalo ajustável remotamente de 5 s a 1 h)', 'Mais amostras para filtrar e 6 vezes menos mensagens na rede'],
    ['Validação de faixa física', 'Descarta leituras `NaN` (falha de comunicação do DHT) e valores fora de −40 a 80 °C / 0 a 100 %', 'Dados inválidos não chegam à nuvem'],
    ['Filtro de picos com confirmação', 'Leitura que difere mais de 10 °C da média é tratada como ruído; se o salto se repetir em 3 leituras seguidas, é aceito como mudança real e a média é reiniciada', 'Remove ruído elétrico sem "travar" diante de uma mudança verdadeira'],
    ['Média móvel', 'Média das 5 últimas amostras válidas', 'Suaviza o sinal'],
    ['Índice de calor', 'Sensação térmica calculada no dispositivo (fórmula de Rothfusz, biblioteca DHT)', 'Dado derivado sem custo para a nuvem'],
    ['Envio por exceção (deadband)', 'Publica imediatamente se a média variar ≥ 1 °C ou ≥ 5 % UR, ou se o estado do alarme local mudar', 'Mudanças importantes não esperam o próximo ciclo'],
    ['Alarme local', 'Acende o LED e aciona o buzzer se a temperatura passar do limite máximo ou a umidade ficar abaixo do mínimo', 'Atua mesmo sem Wi-Fi ou com a nuvem fora do ar'],
    ['Configuração remota', 'Limites e intervalo são recebidos por comando MQTT e aplicados sem regravar o firmware', 'A nuvem ajusta a borda em tempo real'],
  ], [2.3, 4.6, 3.1]),
  P('Cada mensagem informa o **motivo** do envio (`periodico`, `variacao` ou `alarme`). No protótipo físico, das 597 leituras recebidas, 572 foram periódicas, 11 por variação e 14 por mudança de estado do alarme, o que mostra o envio por exceção funcionando em uso real.'),
  H2('2.4. Comunicação e Mensageria (MQTT e Segurança)'),
  P('Adotou-se o protocolo **MQTT 3.1.1**, no modelo _publish/subscribe_, com o broker gerenciado **HiveMQ Cloud** (plano _Serverless_). A estrutura de tópicos segue o padrão `clima/<device_id>/<tipo>`, apresentado na Tabela 4.'),
  ...tabela('Estrutura de tópicos MQTT', ['Tópico', 'Sentido', 'QoS / Retido', 'Conteúdo'], [
    ['`clima/<id>/dados`', 'ESP32 → nuvem', 'QoS 0', 'Telemetria: temperatura, umidade, índice de calor, nº de amostras, descartes, alarme local, motivo, RSSI, data/hora (NTP)'],
    ['`clima/<id>/status`', 'ESP32 → nuvem', 'QoS 1, retido', '"online" com a configuração atual (confirma cada comando); "offline" publicado pelo broker como _Last Will_'],
    ['`clima/<id>/comando`', 'Nuvem → ESP32', 'QoS 1', 'Comandos JSON: `led`, `buzzer`, `intervalo`, `limites`, `status`'],
  ], [2.6, 1.7, 1.7, 4]),
  P('Exemplo de mensagem de telemetria publicada pelo ESP32:'),
  new Paragraph({ spacing: { after: 160 }, shading: { fill: 'F2F2F2', type: ShadingType.CLEAR, color: 'auto' }, children: [new TextRun({ text: '{"device_id":"esp32-01","data_hora":"2026-10-21T21:14:07-03:00","temperatura":25.1,"umidade":54,"indice_calor":25.2,"amostras":5,"descartadas":0,"alarme_local":true,"motivo":"alarme","rssi":-61}', font: 'Courier New', size: 18 })] }),
  P('**Segurança.** As medidas adotadas foram:'),
  B('**TLS** em todas as conexões com o broker (porta 8883) e **HTTPS** no painel (certificado gerenciado pelo Render).'),
  B('**Autenticação por usuário e senha** no broker, com **credenciais separadas por função** (`backend`, `esp32_dev` e `wokwi`), de modo que uma credencial vazada pode ser revogada sem afetar as demais.'),
  B('**Last Will and Testament (LWT):** ao conectar, o ESP32 registra no broker a mensagem "offline"; se ele cair sem se despedir, o broker a publica automaticamente.'),
  B('**Validação na entrada:** o back-end aceita apenas IDs de dispositivo com formato válido, descarta valores fisicamente impossíveis e só envia comandos de uma lista permitida.'),
  B('**Segredos fora do código:** senhas e tokens ficam em variáveis de ambiente (`.env`) e no arquivo `secrets.h` do firmware, ambos excluídos do controle de versão.'),
  B('**Contas de usuário:** senhas armazenadas com _hash_ bcrypt; sessão por JWT em cookie `httpOnly` e `secure`; cada usuário só acessa os próprios dispositivos (multi-tenant).'),
  B('**Banco de dados:** _Row Level Security_ (RLS) ativado em todas as tabelas, bloqueando a API REST pública que o Supabase expõe por padrão.'),
  P('Limitação conhecida: o firmware usa `setInsecure()`, ou seja, cifra a conexão mas não valida o certificado do broker. A evolução natural é gravar o certificado raiz da autoridade certificadora no ESP32.'),
  H2('2.5. Comunicação Bidirecional (Fluxo de Mensagens)'),
  PS('**Client/Edge → Cloud Back-end (telemetria).** A Figura 3 mostra o ciclo: o ESP32 amostra, filtra e calcula a média localmente; publica no broker; o back-end valida, grava no banco e notifica o painel em tempo real.'),
  ...figura('seq1.png', 'Fluxo de telemetria (borda → nuvem)', 600),
  PS('**Cloud Back-end → Client/Edge (comandos).** Os comandos partem de três origens: (i) do **usuário**, pelos botões do painel; (ii) do **Telegram**, pelos comandos `/led_on` e `/led_off` do bot; e (iii) do **motor de regras**, que acende o LED automaticamente quando um alerta é disparado e o apaga na normalização. Ao salvar novos limites no painel, o back-end também envia o comando `limites`, sincronizando o alarme local. Após executar qualquer comando, o ESP32 publica seu status atualizado, que funciona como confirmação (ACK). Todos os comandos são registrados para auditoria (Figura 4).'),
  ...figura('seq2.png', 'Fluxo de alerta e de comando (nuvem → borda)', 600),
  ...tabela('Comandos aceitos pelo dispositivo', ['Comando (JSON)', 'Efeito no ESP32'], [
    ['`{"comando":"led","valor":1}`', 'Liga (1) ou desliga (0) o LED'],
    ['`{"comando":"buzzer","valor":0}`', 'Silencia (0) ou reativa (1) o buzzer'],
    ['`{"comando":"intervalo","valor":30}`', 'Altera o intervalo de envio (5 a 3600 s)'],
    ['`{"comando":"limites","temp_max":28,"umid_min":35}`', 'Atualiza os limites do alarme local'],
    ['`{"comando":"status"}`', 'Solicita a publicação imediata do status'],
  ], [5, 5]),
  H2('2.6. Ingestão, Armazenamento e Modelo de Dados'),
  P('A persistência usa **PostgreSQL** (banco relacional SQL) gerenciado pelo **Supabase**, na região de São Paulo (`sa-east-1`). Optou-se por SQL porque, além da série temporal de leituras, o sistema tem entidades relacionais (usuários, dispositivos, alertas, comandos) e consultas analíticas que o PostgreSQL resolve nativamente. O esquema é criado automaticamente pelo back-end na inicialização. O modelo está na Figura 5.'),
  ...figura('er.png', 'Modelo entidade-relacionamento', 380),
  ...tabela('Tabelas do banco de dados', ['Tabela', 'Conteúdo'], [
    ['`usuarios`', 'Clientes da plataforma (nome, e-mail único, hash da senha, chat do Telegram)'],
    ['`dispositivos`', 'ESP32 cadastrados: dono, nome, local, limites de alerta (mín./máx. de temperatura e umidade), status e horário do último dado'],
    ['`leituras`', 'Série temporal da telemetria (data/hora, temperatura, umidade, índice de calor, RSSI, motivo do envio)'],
    ['`alertas`', 'Histórico de alertas: tipo, estado (disparado/normalizado), valor, se foi enviado ao Telegram e **latência medida em ms**'],
    ['`comandos`', 'Auditoria dos comandos enviados à borda: origem (usuário, regra ou Telegram) e conteúdo JSON'],
  ], [2, 8]),
  P('Decisões relevantes: (i) índice composto `(dispositivo_id, data_hora DESC)` para acelerar as consultas de séries temporais; (ii) **agregação no banco** com `date_bin` — períodos longos retornam média, mínimo e máximo por intervalo (2 min a 4 h, conforme o período), de modo que o navegador recebe no máximo cerca de 180 pontos; (iii) **retenção automática**: leituras com mais de 90 dias são apagadas a cada 6 h, respeitando a cota de 500 MB do plano gratuito; alertas e comandos são mantidos. Medição feita no projeto: cada leitura ocupa **164 bytes** no banco (tabela e índices).'),
  H2('2.7. Back-End, Dashboard e Notificações Automáticas'),
  P('O back-end foi desenvolvido em **Node.js 24** com **Express 5**. Embora as aulas tenham usado o Node-RED, optou-se por código próprio para suportar **login com várias contas (SaaS)**, **regras com estado** (histerese, tolerância de queda, medição de latência) e testes automatizáveis, difíceis de manter em fluxos visuais. A Tabela 7 resume os módulos.'),
  ...tabela('Módulos do back-end', ['Módulo', 'Responsabilidade'], [
    ['Ingestão MQTT (`mqtt.js`, `ingestao.js`)', 'Assina `clima/+/dados` e `clima/+/status`, valida e grava as mensagens; cadastra automaticamente dispositivos novos'],
    ['Motor de regras', 'Avalia os limites de cada dispositivo; alerta apenas na **mudança de estado**, com histerese de 0,5 unidade para evitar repetição; trata queda do dispositivo com tolerância de 60 s'],
    ['API REST (`api.js`)', 'Cadastro e login, dispositivos, séries agregadas, estatísticas, alertas, comandos, exportação CSV e rota de saúde `/api/saude`'],
    ['Tempo real (SSE)', 'Envia ao navegador cada nova leitura, alerta e mudança de status, sem recarregar a página'],
    ['Telegram (`telegram.js`, `bot.js`)', 'Envio de alertas e bot com os comandos `/start`, `/id`, `/status`, `/led_on`, `/led_off` e `/ajuda`'],
  ], [3.2, 6.8]),
  PS('**Dashboard.** O painel web (HTML, CSS e JavaScript com Chart.js) apresenta, para o dispositivo e período selecionados (1 h, 6 h, 24 h, 7 dias ou 30 dias):'),
  B('cartões com temperatura, umidade e sensação térmica atuais; estatísticas (mínimo, média, máximo e desvio padrão); percentual de **tempo dentro da faixa**; **disponibilidade do sensor**; e número de alertas com **latência média, p95 e máxima**;'),
  B('gráficos de temperatura e de umidade com a média, a faixa mínimo–máximo de cada intervalo e as linhas tracejadas dos limites; períodos sem dados aparecem como interrupção da linha;'),
  B('controle remoto (LED, buzzer, intervalo de envio), edição dos limites com sincronização imediata na borda, histórico de alertas e exportação CSV.'),
  ...figura('painel_topo.png', 'Painel web do ClimaTrack com os dados reais do protótipo físico (período de 30 dias)', 600),
  ...figura('sessao.png', 'Sessão de testes do ESP32 físico em 21/10/2026 (446 leituras); os pontos destacados são alertas enviados ao Telegram', 600),
  PS('**Notificações automáticas.** O motor de regras monitora quatro condições por dispositivo (temperatura alta, temperatura baixa, umidade alta e umidade baixa), além da **queda do dispositivo**. A mensagem é enviada ao chat do Telegram cadastrado pelo usuário no painel e, ao voltar à faixa normal, uma segunda mensagem informa a normalização. O tempo entre a leitura no ESP32 e o envio ao Telegram é medido e gravado em cada alerta, alimentando diretamente as métricas de SLA.'),
  ...figuraPendente('Alertas e comandos do bot no Telegram', 'INSERIR AQUI O PRINT DO TELEGRAM (alertas recebidos e resposta ao /status)'),
];

// ---------------- 3. NUVEM ----------------
const sec3 = [
  H1('3. Análise dos Modelos de Nuvem (IaaS, PaaS e SaaS)'),
  P('Segundo o NIST (SP 800-145), a computação em nuvem é composta por cinco características essenciais, três modelos de serviço e quatro modelos de implantação. O ClimaTrack utiliza **nuvem pública** de vários provedores (multinuvem), combinada à **borda** instalada no local do cliente. As cinco características essenciais aparecem na solução da seguinte forma:'),
  B('**Autoatendimento sob demanda:** broker, banco e servidor foram provisionados pelos painéis web dos provedores, sem interação humana; o cliente do ClimaTrack também cria a conta e cadastra seus sensores sozinho.'),
  B('**Amplo acesso à rede:** o painel funciona em qualquer navegador (computador ou celular) e os alertas chegam pelo Telegram.'),
  B('**Agrupamento de recursos (multi-tenant):** um único back-end e um único banco atendem todos os clientes, isolados por `usuario_id`; os provedores fazem o mesmo conosco.'),
  B('**Elasticidade rápida:** a troca de plano (por exemplo, Render Free para Starter) aumenta a capacidade sem reinstalar nada.'),
  B('**Serviço mensurado:** cada provedor mede o consumo, e o próprio ClimaTrack mede latência de alertas, disponibilidade dos sensores e saúde do back-end, base do SLA da Seção 4.'),
  H2('3.1. Mapeamento de Componentes por Modelo de Nuvem'),
  ...figura('nuvem.png', 'Componentes do ClimaTrack agrupados por modelo de serviço', 600),
  ...tabela('Mapeamento dos componentes aos modelos de nuvem', ['Modelo', 'Serviço / Ferramenta', 'Papel na Arquitetura', 'Cotas / Limitações (plano gratuito)'], [
    ['**PaaS**', 'Render (Free)', 'Executa o back-end Node.js a partir do GitHub; fornece runtime, HTTPS, health check e reinício automático', '750 h de instância/mês; 512 MB RAM; dorme após 15 min sem requisições HTTP (~1 min para acordar); 1 instância; sem disco persistente; sem região na América do Sul'],
    ['**PaaS**', 'Supabase (Free) – PostgreSQL gerenciado (DBaaS)', 'Persistência de telemetria, alertas, comandos e contas', '500 MB de banco; 5 GB de tráfego de saída/mês; pausa após 7 dias sem atividade; sem backup automático; 2 projetos'],
    ['**PaaS** (middleware gerenciado)', 'HiveMQ Cloud (Serverless)', 'Broker MQTT com TLS entre a borda e o back-end', '100 conexões simultâneas; 10 GB de tráfego/mês; sem SLA contratual'],
    ['**SaaS**', 'Telegram Bot API', 'Envio de alertas e bot de comandos', 'Gratuito; recomendação de até ~1 mensagem/s por conversa'],
    ['**SaaS**', 'UptimeRobot (Free)', 'Monitor externo de disponibilidade; mantém o Render acordado', '50 monitores; verificação a cada 5 min; histórico de 3 meses; uso não comercial'],
    ['**SaaS**', 'GitHub', 'Versionamento; cada _push_ dispara novo deploy', 'Repositórios privados ilimitados'],
    ['**SaaS** (oferecido)', 'ClimaTrack', 'Produto final: o cliente usa navegador e Telegram, sem gerenciar infraestrutura', '—'],
    ['IaaS (alternativa, não adotada)', 'VM (AWS EC2, Oracle Cloud Always Free etc.) + Docker Compose', 'Hospedaria broker Mosquitto, PostgreSQL e back-end numa única máquina', 'Ex.: AWS Free Tier 750 h/mês de instância micro por 12 meses; SO, backup, TLS e firewall ficam a cargo da equipe'],
  ], [1.6, 2.2, 3, 3.6], 'Fonte: os autores (2026), com cotas consultadas nas páginas oficiais dos provedores em outubro de 2026.'),
  P('Os serviços do HiveMQ foram classificados como PaaS porque o broker é a camada de _middleware_ entre a borda e a aplicação — exatamente o que o SLA de PaaS cobre (runtime, middleware e banco gerenciado). Há margem para classificá-lo como SaaS, pois não implantamos código nele; apenas configuramos usuários e permissões.'),
  P('**Dimensionamento com base em medições do projeto.** Cada leitura ocupa 164 bytes no banco e cada mensagem MQTT tem cerca de 220 bytes. Com envio a cada 15 s, um sensor gera 5.760 leituras por dia. A Tabela 9 mostra a capacidade resultante.'),
  ...tabela('Capacidade dos planos gratuitos por sensor', ['Serviço', 'Consumo por sensor', 'Capacidade estimada'], [
    ['HiveMQ Serverless', '~0,08 GB/mês de tráfego', '~99 sensores (o limite é o número de conexões; uma é do back-end)'],
    ['Supabase Free', '0,94 MB/dia → 85 MB em 90 dias', '**~5 sensores** com retenção de 90 dias; ~15 com 30 dias (gargalo)'],
    ['Render Free', '1 serviço ligado 24 h ≈ 744 h/mês', '1 back-end, que atende todos os sensores'],
  ], [2.4, 3.4, 4.2]),
  P('As limitações dos planos gratuitos foram contornadas no próprio projeto: (i) o **UptimeRobot** acessa `/api/saude` a cada 5 min, impedindo que o Render "durma" e, ao mesmo tempo, medindo a disponibilidade; (ii) o back-end usa um **ID de cliente MQTT fixo**, de modo que o broker aceita uma única instância — durante um redeploy, a instância antiga é desconectada, evitando gravação em dobro; (iii) **desligamento educado** ao receber `SIGTERM`; (iv) **retenção automática** de 90 dias para respeitar os 500 MB do banco; (v) gravação contínua, que impede a pausa por inatividade do Supabase.'),
  H2('3.2. Análise Crítica e Escolha das Ferramentas Open-Source'),
  P('As escolhas priorizaram **custo zero no protótipo**, **baixa carga operacional** e **tecnologias abertas e portáveis**. O modelo PaaS foi preferido ao IaaS porque elimina a administração de sistema operacional, certificados, backups e firewall, deixando a equipe focada no produto. Como contrapartida, há dependência dos limites de cada provedor e menor controle sobre a infraestrutura.'),
  P('Ferramentas open-source utilizadas: **Node.js**, **Express**, **mqtt.js**, **node-postgres**, **bcryptjs** e **jsonwebtoken** no back-end; **PostgreSQL** como banco; **Chart.js** no painel; **Eclipse Mosquitto** e **Docker Compose** para o ambiente de desenvolvimento local; e, no firmware, o núcleo **Arduino-ESP32** com as bibliotecas **DHT sensor library**, **PubSubClient** e **ArduinoJson**. Como todo o stack é aberto, a solução pode migrar de provedor sem reescrita: o mesmo `docker-compose.yml` usado no desenvolvimento é, na prática, o pacote de implantação em uma VM (IaaS).'),
  P('**Estimativa de custos em escala comercial.** Considerou-se um cenário de **50 sensores** com retenção de **1 ano** de leituras (50 × 0,94 MB × 365 ≈ 17 GB de dados), usando planos pagos com SLA. Os valores da Tabela 10 são de referência e devem ser confirmados na data da contratação.'),
  ...tabela('Custo mensal estimado em produção (50 sensores)', ['Item', 'Plano pago de referência', 'Custo mensal (US$)'], [
    ['Broker MQTT', 'HiveMQ Cloud Starter (SLA 99,95 %): ~US$ 0,34/h + US$ 0,80 por milhão de mensagens (~17 milhões/mês)', '≈ 262'],
    ['Banco de dados', 'Supabase Pro (8 GB incluídos + armazenamento adicional, backups diários)', '≈ 27'],
    ['Back-end', 'Render Starter (instância sempre ligada)', '≈ 7'],
    ['Monitoramento', 'UptimeRobot, plano pago de entrada (uso comercial, intervalo de 1 min)', '≈ 8'],
    ['Notificações', 'Telegram Bot API', '0'],
    ['**Total PaaS/SaaS**', '', '**≈ 304 (≈ R$ 1.670)**'],
    ['Alternativa IaaS', 'VM de 2 vCPU/2 GB com Mosquitto + PostgreSQL + back-end, disco de 30 GB e backup', '≈ 20–30 (+ horas de operação da equipe)'],
  ], [2.2, 5.6, 2.2], 'Fonte: os autores (2026), com base nas páginas de preços dos provedores; câmbio de referência US$ 1 = R$ 5,50.'),
  P('A análise mostra que o **broker gerenciado é o item dominante** (cerca de 86 % do custo). O custo por sensor é de aproximadamente US$ 6/mês, o que sustentaria uma assinatura na faixa de R$ 50 por ponto de medição. À medida que o número de sensores cresce, a alternativa IaaS — ou um broker _open-source_ autogerenciado (Mosquitto/EMQX) — reduz o custo de forma expressiva, em troca de maior responsabilidade operacional. Essa decisão é típica da evolução de um SaaS: começa em PaaS para ganhar velocidade e migra componentes para IaaS quando a escala justifica.'),
];

// ---------------- 4. SLA ----------------
const sec4 = [
  H1('4. Proposta Teórica de SLA (Service Level Agreement)'),
  P('O SLA a seguir foi proposto para o cenário hipotético da **rede de farmácias** que monitora geladeiras de vacinas (2 °C a 8 °C). Nesse cenário, o que mais importa é que **o alerta chegue rápido** e que **a queda de um sensor também seja avisada**. Seguindo a característica de _serviço mensurado_ do NIST, cada métrica proposta é efetivamente medida pelo protótipo, e os valores observados aparecem na última coluna da Tabela 11.'),
  H2('4.1. Definindo Métricas de Nível de Serviço'),
  ...tabela('Métricas de nível de serviço propostas e valores medidos no protótipo', ['Métrica de SLA', 'Meta proposta (produção)', 'Justificativa / forma de medição', 'Medido no protótipo'], [
    ['Disponibilidade do sistema (uptime)', '≥ 99,5 % ao mês', 'No máximo ~3 h 36 min de indisponibilidade não planejada por mês. Medida pelo UptimeRobot em `/api/saude`, que só responde "ok" com banco **e** broker conectados', '[[preencher com o % do UptimeRobot]]'],
    ['Latência de notificação de alerta', 'p95 < 3,0 s; máximo 10 s', 'Tempo entre a leitura no ESP32 e o envio ao Telegram, gravado em cada alerta', 'média 0,83 s; p95 1,39 s; máx. 1,65 s (48 alertas)'],
    ['Detecção de sensor fora do ar', '≤ 3 min', 'Keep-alive MQTT de 60 s (broker detecta em até 90 s) + 60 s de tolerância contra quedas rápidas de Wi-Fi', '~150 s'],
    ['Latência de ingestão', 'p95 < 2 s', 'Publicação no ESP32 até gravação no banco', 'mediana 0,71 s; p95 1,21 s'],
    ['Disponibilidade dos dados do sensor', '≥ 99 % dos minutos com leitura', 'Indicador "Disponibilidade do sensor" do painel', 'calculada em tempo real no painel'],
    ['Latência de comando', 'p95 < 2 s', 'Clique no painel até a confirmação (status) publicada pelo ESP32', 'imediato na demonstração (< 1 s)'],
    ['Tempo de recuperação de falhas (RTO) – back-end', '< 15 minutos', 'Reinício automático pelo health check do Render ou novo deploy a partir do GitHub', '2–4 s fora do ar em reinício (16/10/2026)'],
    ['RTO – reconexão do sensor', '≤ 1 min após a volta da rede', 'Firmware tenta reconectar Wi-Fi e MQTT a cada 5 s', '~15 s'],
    ['Perda máxima de dados (RPO)', '≤ 24 h', 'Backup diário do banco (plano pago)', 'sem backup automático no plano gratuito'],
  ], [2.4, 1.9, 3.6, 2.1]),
  P('**Por que 99,5 % e não 99,9 %?** Serviços em série têm disponibilidade igual ao produto das disponibilidades. Supondo planos pagos com 99,95 % (broker), 99,9 % (banco) e 99,9 % (hospedagem), tem-se 0,9995 × 0,999 × 0,999 ≈ **99,75 %**. Prometer mais ao cliente seria prometer mais do que os próprios fornecedores garantem; 99,5 % deixa margem para falhas do back-end.'),
  ...tabela('Indisponibilidade máxima por nível de disponibilidade (mês de 30 dias)', ['Disponibilidade', 'Indisponibilidade máxima'], [
    ['99 %', '7 h 12 min'], ['**99,5 % (proposto)**', '**3 h 36 min**'], ['99,9 %', '43 min'], ['99,99 %', '4 min 19 s'],
  ], [5, 5]),
  PS('**Demais cláusulas propostas:**'),
  B('**Janela de manutenção:** domingos, das 2 h às 4 h (horário de Brasília), com aviso de 48 h; não conta como indisponibilidade. O alarme local do ESP32 continua ativo durante a manutenção.'),
  B('**Exclusões:** falta de energia ou internet no local do cliente, sensor danificado ou desligado pelo cliente, indisponibilidade do Telegram (serviço de terceiro sem SLA) e força maior.'),
  B('**Créditos por descumprimento** (sobre a mensalidade): disponibilidade entre 99,0 % e 99,5 % → 10 %; entre 95 % e 99 % → 25 %; abaixo de 95 % → 50 %.'),
  B('**Suporte:** P1 – crítica (alertas não estão sendo enviados): resposta em 1 h, 24×7, solução ou contorno em 4 h; P2 – alta (painel fora do ar, alertas funcionando): 4 h / 1 dia útil; P3 – baixa (dúvidas e ajustes): 1 dia útil / 5 dias úteis.'),
  B('**Segurança e dados:** tráfego sempre criptografado; incidentes de segurança comunicados em até 24 h; leituras mantidas por 90 dias e alertas indefinidamente, com exportação CSV a qualquer momento.'),
  B('**Localização dos dados (LGPD):** o banco fica em São Paulo; no protótipo o broker está na Europa e o back-end nos EUA, ou seja, os dados trafegam fora do Brasil. Em produção, devem-se escolher regiões nacionais para todos os serviços ou declarar a transferência internacional no contrato.'),
  B('**Responsabilidades do cliente:** manter Wi-Fi e energia no local do sensor, proteger a senha da conta e manter o Telegram cadastrado. Conforme o modelo de responsabilidade compartilhada, dados, permissões e senhas são sempre responsabilidade do cliente.'),
  H2('4.2. Plano de Contingência e Mitigação de Riscos'),
  ...tabela('Falhas previstas e reação da arquitetura', ['Falha', 'Reação do sistema'], [
    ['Perda de Wi-Fi ou do broker no local', 'O **alarme local continua funcionando** (decisão na borda). O ESP32 tenta reconectar a cada 5 s; ao voltar, publica "online" e reenvia a configuração atual'],
    ['ESP32 desligado ou travado', 'O broker publica o _Last Will_ "offline"; após 60 s de tolerância o back-end envia alerta de dispositivo offline ao Telegram e, na volta, um aviso de normalização'],
    ['Queda ou reinício do back-end', 'O Render reinicia o serviço automaticamente (health check). O status dos dispositivos é publicado como mensagem retida, então o back-end recupera o último estado ao reconectar. O UptimeRobot avisa a equipe por e-mail'],
    ['Redeploy da aplicação', 'A nova instância só entra no ar quando banco e broker respondem; o ID MQTT fixo impede duas instâncias processando ao mesmo tempo (indisponibilidade medida: 2–4 s)'],
    ['Banco indisponível na partida', 'O back-end tenta conectar novamente a cada 3 s, por até 30 s, antes de desistir'],
    ['Leitura defeituosa do sensor', 'Descartada na borda (validação e filtro de picos); nunca gera alerta falso'],
    ['Perda de dados no banco', 'Protótipo: exportação CSV manual. Produção: backup diário automático do Supabase Pro (RPO ≤ 24 h), com opção de _point-in-time recovery_ e cópia semanal com `pg_dump` em outro provedor'],
  ], [3, 7]),
  P('**Limitação reconhecida:** quando a conexão cai, o firmware atual não armazena as leituras para reenvio, de modo que os dados do período desconectado se perdem (a função de alarme local, porém, é mantida). A mitigação proposta é um _buffer_ circular em memória ou na flash do ESP32 (SPIFFS/LittleFS) que guarde as leituras com sua data e hora e as publique ao reconectar.'),
];

// ---------------- 5. CONSIDERAÇÕES ----------------
const sec5 = [
  H1('5. Considerações Finais'),
  H2('5.1. Análise Crítica dos Resultados'),
  P('O protótipo operou de ponta a ponta com o ESP32 físico, o back-end publicado na nuvem e as notificações no Telegram. Até a data deste relatório, a plataforma registrou **774 leituras** (597 do protótipo físico, em três sessões de testes), **54 alertas** e **104 comandos** enviados da nuvem para a borda (67 pelo painel, 28 automáticos pelas regras e 9 pelo Telegram). Todos os 48 alertas gerados após a configuração do bot foram entregues no Telegram, com **latência média de 0,83 s** e **p95 de 1,39 s**, bem abaixo da meta de 3 s. O banco ocupava 11 MB, cerca de 2 % da cota gratuita.'),
  ...tabela('Atendimento aos requisitos do projeto', ['Requisito do escopo', 'Como foi atendido', 'Situação'], [
    ['Hardware e coleta de dados', 'ESP32 + DHT11 (e DHT22 no simulador Wokwi)', 'Atendido'],
    ['Processamento na borda', 'Validação, filtro de picos, média móvel, índice de calor, envio por exceção, alarme local', 'Atendido'],
    ['MQTT, broker e segurança', 'HiveMQ Cloud com TLS, usuário/senha por função, LWT', 'Atendido'],
    ['Comunicação bidirecional', 'Telemetria/status (borda → nuvem) e comandos LED, buzzer, intervalo, limites (nuvem → borda)', 'Atendido'],
    ['Ingestão e armazenamento', 'PostgreSQL (Supabase) com modelo relacional e agregação temporal', 'Atendido'],
    ['Visualização / back-end', 'Painel SaaS multiusuário publicado no Render, com gráficos em tempo real', 'Atendido'],
    ['Notificações', 'Alertas automáticos e bot de comandos no Telegram', 'Atendido'],
    ['Modelos de nuvem', 'Mapeamento PaaS/SaaS, comparação com IaaS, cotas e custos', 'Atendido'],
    ['SLA', 'Métricas propostas e medidas pelo próprio sistema', 'Atendido'],
    ['Demonstração End-to-End', 'Testada com o protótipo físico e com o simulador Wokwi', 'Atendido'],
  ], [2.8, 5.4, 1.8]),
  H2('5.2. Lições Aprendidas e Limitações do Protótipo'),
  PS('**Principais desafios e aprendizados:**'),
  B('**Ruído e transitórios do sensor:** o filtro de picos inicial descartava qualquer mudança brusca e chegava a "travar" o valor; a solução foi exigir 3 leituras consecutivas para confirmar uma mudança real.'),
  B('**Falsos alertas de queda:** oscilações rápidas de Wi-Fi geravam alertas de _offline_ desnecessários; foi introduzida uma tolerância de 60 s antes de alertar.'),
  B('**Alertas repetitivos:** um valor oscilando sobre o limite disparava várias mensagens; resolvido com histerese e alerta apenas na mudança de estado.'),
  B('**Concorrência na nuvem:** ao reimplantar o back-end, duas instâncias podiam processar as mesmas mensagens; resolvido com ID MQTT fixo e desligamento educado.'),
  B('**Limites dos planos gratuitos:** o Render "dorme" sem tráfego HTTP, o que interromperia a ingestão MQTT; o monitor externo resolveu o problema e ainda passou a medir a disponibilidade.'),
  B('**Gestão de segredos:** credenciais nunca podem ir para o repositório; o uso de arquivos de configuração ignorados pelo Git e de credenciais separadas por dispositivo permitiu revogar uma credencial exposta sem afetar o restante do sistema.'),
  PS('**Limitações do protótipo:**'),
  B('O DHT11 tem precisão limitada (±2 °C, ±5 % UR) e não cobre temperaturas abaixo de 0 °C; para câmaras frias seria necessário DHT22, SHT31 ou DS18B20.'),
  B('O firmware não valida o certificado TLS do broker e não armazena leituras durante a desconexão.'),
  B('Os planos gratuitos não oferecem SLA contratual nem backup automático, e os serviços estão em regiões fora do Brasil (exceto o banco).'),
  B('A capacidade do banco gratuito limita o protótipo a cerca de 5 sensores com 90 dias de histórico.'),
  H2('5.3. Propostas de Evolução e Trabalhos Futuros'),
  B('**Buffer offline no ESP32** (memória flash) para reenvio das leituras após reconexão, levando o RPO da borda a zero.'),
  B('**Validação do certificado TLS** no firmware e atualização remota de firmware (OTA).'),
  B('**Novos sensores:** DS18B20 à prova d\'água para geladeiras, sensor de porta aberta, CO₂ e qualidade do ar.'),
  B('**Análise preditiva:** detecção de tendência (por exemplo, compressor perdendo eficiência) e modelos de _machine learning_ embarcados (TinyML) para antecipar falhas.'),
  B('**Banco de séries temporais** (TimescaleDB) com agregados contínuos e retenção por camadas, reduzindo o custo de armazenamento de longo prazo.'),
  B('**Relatórios automáticos** em PDF para auditoria sanitária e níveis de acesso por perfil (gestor, operador).'),
  B('**Infraestrutura nacional e alta disponibilidade:** migrar broker e back-end para regiões no Brasil (LGPD) e operar com réplicas, buscando 99,9 % de disponibilidade.'),
];

// ---------------- 6. REFERÊNCIAS ----------------
const refs = [
  'ADAFRUIT INDUSTRIES. **DHT sensor library**. GitHub, 2024. Disponível em: https://github.com/adafruit/DHT-sensor-library. Acesso em: out. 2026.',
  'BANKS, A.; GUPTA, R. (ed.). **MQTT Version 3.1.1**. OASIS Standard, 2014. Disponível em: https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/mqtt-v3.1.1.html. Acesso em: out. 2026.',
  'BLANCHON, B. **ArduinoJson 7**: documentação. Disponível em: https://arduinojson.org. Acesso em: out. 2026.',
  'CHART.JS. **Chart.js documentation**. Disponível em: https://www.chartjs.org/docs/. Acesso em: out. 2026.',
  'ESPRESSIF SYSTEMS. **Arduino-ESP32 documentation**. Disponível em: https://docs.espressif.com/projects/arduino-esp32/. Acesso em: out. 2026.',
  'HIVEMQ. **HiveMQ Cloud documentation** e **pricing**. Disponível em: https://docs.hivemq.com/hivemq-cloud/ e https://www.hivemq.com/pricing/. Acesso em: out. 2026.',
  'MELL, P.; GRANCE, T. **The NIST definition of cloud computing**. Gaithersburg: National Institute of Standards and Technology, 2011. (NIST Special Publication 800-145).',
  'O\'LEARY, N. **PubSubClient**: Arduino client for MQTT. GitHub. Disponível em: https://github.com/knolleary/pubsubclient. Acesso em: out. 2026.',
  'OPENJS FOUNDATION. **Node.js documentation** e **Express 5 API reference**. Disponível em: https://nodejs.org/docs/ e https://expressjs.com/. Acesso em: out. 2026.',
  'POSTGRESQL GLOBAL DEVELOPMENT GROUP. **PostgreSQL 16 documentation**. Disponível em: https://www.postgresql.org/docs/16/. Acesso em: out. 2026.',
  'RENDER. **Render documentation**: free instances, regions, blueprints. Disponível em: https://render.com/docs. Acesso em: out. 2026.',
  'ROTHFUSZ, L. P. **The heat index equation**. Fort Worth: National Weather Service, 1990. (Technical Attachment SR 90-23).',
  'SUPABASE. **Supabase documentation** e **pricing**. Disponível em: https://supabase.com/docs e https://supabase.com/pricing. Acesso em: out. 2026.',
  'TAMANAHA, E. **Arquitetura de Sistemas IoT e Computação em Nuvem**: material de aula (aulas 03 a 12). São José dos Pinhais: UniSENAI PR, 2026.',
  'TELEGRAM. **Telegram Bot API**. Disponível em: https://core.telegram.org/bots/api. Acesso em: out. 2026.',
  'UPTIMEROBOT. **Pricing and features**. Disponível em: https://uptimerobot.com/pricing/. Acesso em: out. 2026.',
];
const sec6 = [
  new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun('6. Referências Bibliográficas')] }),
  ...refs.map((r) => new Paragraph({ children: runs(r), alignment: AlignmentType.LEFT, spacing: { after: 200, line: 240 } })),
];

// =====================================================================
const doc = new Document({
  creator: 'ClimaTrack',
  title: 'Relatório Técnico – ClimaTrack',
  styles: {
    default: { document: { run: { font: FONTE, size: 24 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONTE, size: 28, bold: true }, paragraph: { spacing: { before: 240, after: 200 }, keepNext: true, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONTE, size: 24, bold: true }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONTE, size: 24, bold: true, italics: true }, paragraph: { spacing: { before: 180, after: 120 }, keepNext: true, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bolinhas', levels: [
        { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        { level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
      ] },
      { reference: 'numeros', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ],
  },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1701, left: 1701, bottom: 1134, right: 1134 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ children: [PageNumber.CURRENT], size: 20 })] })] }) },
    children: [...capa, ...identificacao, ...sec1, ...sec2, ...sec3, ...sec4, ...sec5, ...sec6],
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(SAIDA, buf);
  console.log('gerado:', SAIDA, `(${nFig} figuras, ${nTab} tabelas)`);
});
