# ClimaTrack — Monitoramento de Temperatura e Umidade (IoT + Nuvem)

Projeto Final Desafio — Arquitetura de Sistemas IoT e Computação em Nuvem (2026/2)

Plataforma **SaaS** em que cada cliente cadastra seus sensores ESP32 e acompanha, pelo navegador,
gráficos históricos e em tempo real de temperatura, umidade e sensação térmica. A plataforma também
envia alertas no Telegram e permite controlar o dispositivo remotamente.

```
ESP32 + DHT11 ──MQTT/TLS──► HiveMQ Cloud ──► Back-end Node.js ──► PostgreSQL (Supabase)
  (borda)      ◄──comandos──   (broker)    ◄──    │    │
                                                  │    └──► Telegram (alertas + bot)
                                                  └──► Painel web SaaS (gráficos, controles)
```

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `firmware/esp32_clima/` | Código do ESP32 (Arduino IDE) com processamento na borda |
| `firmware/wokwi/` | Diagrama e configuração para rodar o mesmo firmware no simulador Wokwi |
| `backend/src/` | Back-end Node.js: ingestão MQTT, regras/alertas, API REST, login, Telegram |
| `backend/public/` | Painel web (login, gráficos com Chart.js, controles) |
| `backend/sql/schema.sql` | Modelo de dados (criado automaticamente ao iniciar) |
| `backend/scripts/simulador.js` | Simulador de ESP32 (testes e plano B na demo) |
| `docker-compose.yml` | PostgreSQL + broker Mosquitto **locais**, só para desenvolvimento |
| `render.yaml` | Implantação do back-end no Render (infraestrutura como código) |
| `docs/ARQUITETURA.md` | Material para o relatório técnico (diagramas, fluxos, modelo de dados) |
| `docs/NUVEM_SLA.md` | Modelos de nuvem (IaaS/PaaS/SaaS), cotas dos planos gratuitos e proposta de SLA |

## Como cada requisito do enunciado é atendido

| Requisito | Onde está |
|---|---|
| Hardware e coleta | ESP32 + DHT11, `firmware/esp32_clima/esp32_clima.ino` |
| Processamento na borda | Média móvel, descarte de ruído, índice de calor, envio por variação (deadband), alarme local sem internet |
| MQTT + broker + segurança | HiveMQ Cloud, porta 8883 (TLS), usuário/senha separados para ESP32 e back-end |
| Bidirecional | `clima/<id>/dados` e `/status` (borda → nuvem); `clima/<id>/comando` (nuvem → borda): LED, buzzer, intervalo, limites |
| Ingestão e armazenamento | `backend/src/ingestao.js` → PostgreSQL (Supabase) |
| Dashboard / back-end | Painel SaaS multiusuário em `backend/public/` + API em `backend/src/api.js` |
| Notificações | Telegram: alerta disparado/normalizado, dispositivo offline, bot com `/status`, `/led_on`, `/led_off` |
| Modelos de nuvem / SLA | `docs/NUVEM_SLA.md`: Render, Supabase e HiveMQ (PaaS), Telegram e UptimeRobot (SaaS), o ClimaTrack como SaaS, comparação com IaaS, cotas dos planos gratuitos e proposta de SLA com métricas medidas pelo próprio sistema |

---

# Guia passo a passo

Faça as etapas **na ordem**. Cada uma termina com um teste: só avance quando o teste passar.

## Etapa 0 — Pré-requisitos no computador

- **Node.js 20+** (`node --version`). Se não tiver: https://nodejs.org/pt-br (versão LTS).
- **Docker** (opcional, só para rodar Postgres/MQTT locais). Sem Docker, pule direto para as Etapas 2 e 3 e use Supabase + HiveMQ desde o início.
- **Arduino IDE 2.x** com suporte ao ESP32 (você já configurou nas aulas).

## Etapa 1 — Rodar tudo localmente com o simulador (sem hardware, sem nuvem)

Serve para entender o sistema e validar o software antes de mexer no ESP32.

```bash
cd projeto-final
docker compose up -d --wait       # sobe Postgres (5432) e Mosquitto (1883) e espera ficarem prontos

cd backend
npm install
cp .env.example .env              # o .env padrão já aponta para o ambiente local
npm start                         # deve mostrar: [db] esquema verificado / [mqtt] conectado
```

Em **outro terminal**:

```bash
cd projeto-final/backend
npm run simulador -- esp32-sim 5  # publica uma leitura a cada 5 s
```

No navegador, abra http://localhost:3000:

1. **Criar conta** (qualquer e-mail/senha, é local).
2. Na lateral, em *ID do dispositivo*, digite `esp32-sim` → **Adicionar**.
3. Os gráficos e cartões começam a se mover. Selecione **1 h** para ver as leituras individuais chegando ao vivo.
4. No terminal do simulador, digite `q` + Enter três vezes (sobe 9 °C) → em poucos segundos aparece o alerta no
   painel e o simulador mostra `<- comando { comando: 'led', valor: 1 }` (**fluxo nuvem → borda funcionando**).
5. Digite `f` + Enter três vezes → alerta *normalizado* e LED desligado.
6. Clique nos botões de *Controle remoto* e veja os comandos chegando no simulador.
7. Digite `s` + Enter no simulador → ele “cai” sem avisar e o broker publica o **Last Will**: o painel mostra *offline*.

✅ **Teste**: tudo acima aconteceu. Pare tudo com `Ctrl+C` nos dois terminais.

## Etapa 2 — Broker na nuvem: HiveMQ Cloud

Você já criou um cluster na aula (Tarefa 01). Reaproveite-o ou crie outro:

1. Acesse https://console.hivemq.cloud → *Create new cluster* → plano **Serverless (Free)**.
2. Na página do cluster, aba **Overview**, copie a **URL** (ex.: `abc123.s1.eu.hivemq.cloud`). Porta TLS: **8883**.
3. Aba **Access Management** → crie **duas credenciais** (boa prática: cada componente com a sua):
   - `esp32_dev` / senha forte → usada no firmware
   - `backend` / outra senha forte → usada no Node.js
   Permissão: *Publish and Subscribe* para as duas.
4. Teste rápido no **Web Client** do próprio cluster (aba *Web Client*): conecte com a credencial `backend`,
   assine `clima/#`. Deixe aberto — você vai ver as mensagens aparecendo nas próximas etapas.

Agora aponte o back-end para o HiveMQ. Em `backend/.env`:

```env
MQTT_URL=mqtts://abc123.s1.eu.hivemq.cloud:8883
MQTT_USER=backend
MQTT_PASSWORD=SuaSenhaDoBackend
```

✅ **Teste**: `npm start` mostra `[mqtt] conectado a mqtts://...`. Rode o simulador (ele lê o mesmo `.env`)
e veja as mensagens chegarem no Web Client do HiveMQ e no painel.

> O simulador usará a credencial do back-end. Tudo bem para testes; o ESP32 real usará `esp32_dev`.

## Etapa 3 — Banco de dados na nuvem: Supabase (PostgreSQL)

1. Acesse https://supabase.com → *New project*. Anote a **senha do banco** que você definir.
   Região sugerida: **South America (São Paulo)**.
2. Quando o projeto estiver pronto, clique em **Connect** (topo da página) → aba *Connection String* →
   escolha **Session pooler** (funciona em redes só IPv4, como a maioria das redes domésticas/faculdade).
3. Copie a string e troque `[YOUR-PASSWORD]` pela senha. Em `backend/.env`:

```env
DATABASE_URL=postgresql://postgres.xxxxxxxx:SUA_SENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
DATABASE_SSL=true
```

> Se a senha tiver caracteres especiais (`@`, `#`, `/`...), troque-os pelo código URL (`@` → `%40`, `#` → `%23`)
> ou crie uma senha só com letras e números.

✅ **Teste**: `npm start` mostra `[db] esquema verificado`. No Supabase, menu **Table Editor**, devem aparecer
as tabelas `usuarios`, `dispositivos`, `leituras`, `alertas` e `comandos`.
Como o banco é novo, crie a conta de novo no painel.

> **Segurança:** o Supabase publica automaticamente as tabelas numa API REST. O `schema.sql` ativa o
> *RLS* (Row Level Security) em todas as tabelas sem nenhuma regra, o que bloqueia essa API pública. O back-end
> continua funcionando porque conecta como dono das tabelas. No Table Editor, as tabelas **não** devem
> aparecer com o selo vermelho *Unrestricted*.

## Etapa 4 — Notificações: bot do Telegram

1. No Telegram, abra o **@BotFather** → `/newbot` → escolha nome e usuário (precisa terminar em `bot`).
2. Ele responde com o **token** (`123456:ABC-...`). Em `backend/.env`:

```env
TELEGRAM_BOT_TOKEN=123456:ABC-seu-token
```

3. Reinicie o back-end (`npm start`) — deve aparecer `[telegram] bot escutando comandos`.
4. No Telegram, abra o seu bot e envie `/start`. Ele responde com seu **Chat ID**.
5. No painel, botão **Notificações** → cole o Chat ID → **Enviar teste**.

✅ **Teste**: chegou a mensagem de teste. Com o simulador rodando, `q` três vezes → alerta no Telegram.
Envie `/status` e `/led_on` ao bot para testar o caminho Telegram → nuvem → dispositivo.

> Cada integrante pode criar sua conta no painel e cadastrar o próprio Chat ID. O alerta vai para o dono do
> dispositivo. Para mandar para um **grupo**, adicione o bot ao grupo, envie `/id` lá e use esse ID (negativo).

## Etapa 5 — Hardware: ESP32 + DHT11

### Montagem

| DHT11 (módulo 3 pinos) | ESP32 |
|---|---|
| VCC / + | 3V3 |
| GND / − | GND |
| DATA / S / OUT | GPIO 4 (D4) |

- Se o seu DHT11 for o componente “puro” de 4 pinos (sem plaquinha), coloque um resistor de **10 kΩ** entre DATA e 3V3.
- **LED**: usa o LED interno da placa (GPIO 2). Nada a montar.
- **Buzzer ativo (opcional)**: `+` no GPIO 15, `−` no GND. Sem buzzer, o código funciona igual.

### Firmware

1. Abra `firmware/esp32_clima/esp32_clima.ino` na Arduino IDE.
2. Instale as bibliotecas (*Tools → Manage Libraries*): **DHT sensor library** (Adafruit, aceite instalar a
   *Adafruit Unified Sensor*), **PubSubClient** (Nick O'Leary), **ArduinoJson** (Benoit Blanchon, versão 7).
3. Na pasta `firmware/esp32_clima/`, copie `secrets.example.h` para **`secrets.h`** e preencha Wi-Fi,
   `SECRET_MQTT_SERVER` (URL do cluster, sem `mqtts://`), usuário `esp32_dev` e a senha. Esse arquivo fica
   fora do git, então as senhas não vão para o GitHub. Ele aparece como uma aba na Arduino IDE.
   O ID padrão é `esp32-01` com DHT11. Para mudar, descomente no `secrets.h` as linhas `CFG_DEVICE_ID` / `CFG_DHT_TYPE`.
4. Placa: *ESP32 Dev Module*. Selecione a porta e faça o **Upload**.
5. Abra o **Serial Monitor** em **115200**. Deve aparecer: Wi-Fi conectado → `Conectando ao HiveMQ... conectado!` →
   `Dados publicados: {...}`.
6. No painel, adicione o dispositivo `esp32-01`.

> A rede Wi-Fi precisa ser **2,4 GHz**. Redes da faculdade com página de login (portal cativo) não funcionam —
> use o roteador do celular.

✅ **Teste**: segure o sensor com a mão (ou sopre ar quente) → a temperatura sobe no gráfico. Ajuste o
*Temp. máxima* para 1 °C acima da temperatura atual e **Salvar e sincronizar** → ao aquecer o sensor:
LED acende (decisão local e da nuvem), Telegram recebe o alerta.

### Alternativa: ESP32 simulado no Wokwi (sem hardware)

O Wokwi executa o **mesmo firmware**; só muda o `secrets.h`. Os arquivos prontos estão em `firmware/wokwi/`.

1. No HiveMQ, crie mais uma credencial: `wokwi` / senha própria (*Publish and Subscribe*).
   Projetos salvos no Wokwi gratuito são **públicos**; com uma credencial separada, basta apagá-la se o link vazar.
2. Abra https://wokwi.com/projects/new/esp32.
3. Aba **sketch.ino**: apague o conteúdo e cole o `firmware/esp32_clima/esp32_clima.ino` inteiro.
4. Aba **diagram.json**: apague e cole `firmware/wokwi/diagram.json` (ESP32 + DHT22 no GPIO 4 + LED no GPIO 2).
5. Seta ao lado das abas → **New file…** → `secrets.h` → cole `firmware/wokwi/secrets.wokwi.h` e preencha a URL do
   cluster e a senha da credencial `wokwi`.
6. Aba **Library Manager** → **+** → adicione as 4 bibliotecas de `firmware/wokwi/libraries.txt`.
7. Clique em ▶ (Start). A primeira compilação demora. O Serial Monitor deve mostrar
   `Wi-Fi conectado` → `Conectando ao HiveMQ... conectado!` → `Dados publicados`.
8. No painel, adicione o dispositivo **`esp32-wokwi`**.
9. **Para testar alertas**: durante a simulação, clique no sensor DHT22 e arraste a temperatura acima do limite.
   O LED vermelho acende (pela decisão local e pelo comando da nuvem), e o alerta chega no Telegram.

> Se algum fio aparecer solto no diagrama, ligue-o arrastando: DHT22 VCC→3V3, GND→GND, SDA→GPIO 4;
> GPIO 2 → resistor → LED (perna longa, A) e LED (C) → GND.
> A simulação pode rodar mais devagar que o tempo real e a conexão TLS leva alguns segundos. É normal.

## Etapa 6 — Publicar o back-end na nuvem (Render + UptimeRobot)

Até aqui o back-end rodava no seu computador. Agora ele vai para o **Render** (PaaS): o painel ganha um endereço
público `https://...onrender.com` e funciona com o seu PC desligado. Broker (HiveMQ) e banco (Supabase) **não
mudam**. A análise completa (modelos de nuvem, cotas e SLA) está em `docs/NUVEM_SLA.md`.

### 6.1 Enviar o projeto para o GitHub (repositório privado)

O Render implanta direto de um repositório Git.

1. Confira que nenhum segredo está versionado. O comando abaixo **não deve listar nada**:
   ```bash
   git ls-files | grep -E '(^|/)\.env$|secrets\.h$'
   ```
2. Em https://github.com/new crie um repositório **privado** chamado `climatrack`, **sem** README nem `.gitignore`.
3. No terminal, na pasta `projeto-final`:
   ```bash
   git remote add origin https://github.com/SEU_USUARIO/climatrack.git
   git push -u origin main
   ```
   (O GitHub pede login; use um *Personal Access Token* como senha ou `gh auth login`.)

### 6.2 Criar o serviço no Render

1. Crie a conta em https://render.com usando **Sign in with GitHub** e autorize o acesso ao repositório `climatrack`.
2. **New → Blueprint** → escolha o repositório. O Render lê o arquivo `render.yaml` (infraestrutura como código)
   e já preenche plano gratuito, região, comandos de build/start e *health check*.
3. Ele pede os valores secretos (os marcados com `sync: false`). Copie do seu `backend/.env`:

   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | a mesma do Supabase (Session pooler) |
   | `MQTT_URL` | `mqtts://SEU-CLUSTER.s1.eu.hivemq.cloud:8883` |
   | `MQTT_PASSWORD` | senha do usuário `backend` do HiveMQ |
   | `TELEGRAM_BOT_TOKEN` | token do bot |
   | `TELEGRAM_CHAT_ID_PADRAO` | o seu chat ID (ou deixe vazio) |

   `JWT_SECRET` é gerado pelo próprio Render. Os demais valores já vêm do `render.yaml`.
4. **Antes de clicar em *Apply*: pare o back-end local** (Ctrl+C). Dois back-ends ligados ao mesmo broker e ao
   mesmo bot gravam leituras em dobro, duplicam alertas e o Telegram recusa o segundo
   (`Conflict: terminated by other getUpdates request`).
5. Clique em **Apply** e acompanhe a aba **Logs**. O deploy termina quando aparecerem `[db] esquema verificado`
   e `[mqtt] conectado a mqtts://...`, e o status ficar **Live** (leva de 2 a 5 minutos).

> Se o Blueprint pedir cartão de crédito, crie o serviço manualmente: **New → Web Service** → repositório →
> *Root Directory* `backend`, *Build* `npm ci`, *Start* `npm start`, *Instance type* **Free**,
> *Health Check Path* `/api/saude` (em *Advanced*), e cadastre **todas** as variáveis do `render.yaml`
> em *Environment*, incluindo um `JWT_SECRET` longo inventado por você.

**Teste:** abra `https://SEU-SERVICO.onrender.com/api/saude`. Deve mostrar `"status":"ok"`, `"banco":true` e
`"mqtt":true`. Entre no painel com a mesma conta de antes (o banco é o mesmo) e ligue o Wokwi ou o simulador:
os dados devem aparecer ao vivo. Teste um alerta e o `/status` no Telegram.

### 6.3 Manter o serviço acordado e medir a disponibilidade (UptimeRobot)

O plano gratuito do Render **desliga o serviço após 15 minutos sem acessos HTTP**. Mensagens MQTT não contam,
então o back-end pararia de receber dados e de gerar alertas. A solução também mede a disponibilidade para o SLA:

1. Crie a conta gratuita em https://uptimerobot.com.
2. **New monitor** → tipo **HTTP(s)** → URL `https://SEU-SERVICO.onrender.com/api/saude` → intervalo **5 minutos**.
3. (Opcional, bom para a apresentação) **Status pages → New** → adicione o monitor. Você ganha uma página
   pública de disponibilidade para mostrar na banca.

O `/api/saude` responde **200** só quando banco **e** broker estão conectados (caso contrário, **503**). Por isso o
UptimeRobot mede a disponibilidade real da ingestão, não apenas se o site abre.

**Teste de recuperação (RTO):** no Render, **Manual Deploy → Restart service**. Cronometre até o
`/api/saude` voltar a responder `ok` e anote o tempo para o relatório (métrica 7 do SLA).

### 6.4 Daqui em diante

- **Atualizar o sistema:** `git commit` + `git push`. O Render faz o deploy sozinho (`autoDeploy`).
- **Ver logs:** aba *Logs* do serviço no Render.
- **Desenvolver no PC sem atrapalhar a nuvem:** use o ambiente local da Etapa 1 (Docker). Guarde a versão de
  nuvem do `.env` como `backend/.env.nuvem` (também é ignorada pelo Git) e deixe o `backend/.env` com os valores
  locais do `.env.example`. **Nunca** rode o back-end local com as credenciais de nuvem enquanto o Render estiver ligado.

## Etapa 7 — Roteiro sugerido para a demonstração (pré-banca e banca)

1. Mostrar o ESP32 ligado e o Serial Monitor (leituras, média móvel, envios).
2. Painel **na nuvem** (`https://...onrender.com`), aberto no celular de alguém da banca: gráficos de 24 h /
   7 dias, cartões de estatística, tempo dentro da faixa, disponibilidade do sensor, exportar CSV.
3. **Telemetria ao vivo**: período 1 h, aquecer o sensor com a mão.
4. **Alerta**: limite máximo baixo → alerta no painel + Telegram (mostrar a latência medida) + LED aceso.
5. **Comando**: botões *Ligar/Desligar LED* no painel e `/led_on` no Telegram.
6. **Resiliência**: desligar o ESP32 da energia → em até ~90 s o broker publica o Last Will → alerta *offline*.
7. **Nuvem e SLA**: página de status do UptimeRobot e cartões de latência (média/p95) e disponibilidade.
8. Plano B: se a rede falhar, rode o `simulador` para mostrar o fluxo de nuvem.

> Deixe o ESP32 (ou o simulador) rodando algumas horas/dias antes da apresentação para os gráficos de
> 24 h e 7 dias terem histórico real.

---

## Referência rápida

### Tópicos MQTT

| Tópico | Sentido | Exemplo de payload |
|---|---|---|
| `clima/<id>/dados` | ESP32 → nuvem | `{"device_id":"esp32-01","data_hora":"2026-10-13T14:00:00-03:00","temperatura":24.3,"umidade":58.0,"indice_calor":24.4,"amostras":5,"descartadas":0,"alarme_local":false,"motivo":"periodico","rssi":-61}` |
| `clima/<id>/status` (retido) | ESP32 → nuvem | `{"status":"online","ip":"192.168.0.10","intervalo_ms":15000,"limite_temp_max":30,...}`; LWT: `{"status":"offline"}` |
| `clima/<id>/comando` | nuvem → ESP32 | `{"comando":"led","valor":1}` · `{"comando":"buzzer","valor":0}` · `{"comando":"intervalo","valor":30}` · `{"comando":"limites","temp_max":28,"umid_min":35}` · `{"comando":"status"}` |

### API REST (prefixo `/api`)

| Método e rota | Função |
|---|---|
| `GET /saude` | Saúde do serviço (banco, MQTT, uptime) — público, base para o SLA |
| `POST /auth/registrar`, `POST /auth/login`, `POST /auth/logout` | Conta e sessão (cookie JWT) |
| `GET /eu`, `PUT /eu`, `POST /eu/telegram-teste` | Perfil e Chat ID do Telegram |
| `GET /dispositivos`, `POST /dispositivos`, `PUT /dispositivos/:id`, `DELETE /dispositivos/:id` | Gerenciar dispositivos e limites |
| `GET /dispositivos/:id/leituras?periodo=1h\|6h\|24h\|7d\|30d` | Série temporal (agregada por intervalo) |
| `GET /dispositivos/:id/resumo?periodo=...` | Estatísticas, conformidade, latência de alertas |
| `GET /dispositivos/:id/alertas` | Histórico de alertas |
| `GET /dispositivos/:id/exportar.csv?periodo=...` | Exportação CSV |
| `POST /dispositivos/:id/comandos` | Enviar comando ao ESP32 |
| `GET /eventos` | Stream em tempo real (Server-Sent Events) |

### Problemas comuns

| Sintoma | Causa provável |
|---|---|
| ESP32: `Erro MQTT: -2` | URL do broker errada, sem internet, ou Wi-Fi 5 GHz |
| ESP32: `Erro MQTT: 4` ou `5` | Usuário/senha do HiveMQ errados |
| ESP32: `Erro ao ler o DHT11` / leituras descartadas | Fio DATA solto, pino errado, falta do resistor de 10 kΩ (sensor puro), `DHT_TYPE` errado |
| Back-end: `getaddrinfo ENOTFOUND` / `ENETUNREACH` no banco | Use a string do **Session pooler** do Supabase, não a *Direct connection* |
| Back-end: `password authentication failed` | Senha do Supabase errada ou com caractere especial sem codificar |
| Dados chegam no HiveMQ mas não no painel | Dispositivo não foi adicionado à sua conta, ou `DEVICE_ID` diferente |
| Telegram não chega | Não enviou `/start` ao bot, Chat ID não salvo, ou token errado |
| Telegram: `Conflict: terminated by other getUpdates request` | Dois back-ends ligados com o mesmo bot (ex.: local + Render). Pare o local. Por alguns segundos durante um deploy é normal |
| Painel na nuvem demora ~1 min para abrir | O Render "dormiu": falta o monitor do UptimeRobot (Etapa 6.3) |
| Deploy no Render falha no *health check* | Variável errada ou faltando; veja a aba *Logs* (`/api/saude` só responde 200 com banco e broker conectados) |

## Próximas etapas (pendentes)

- [x] Modelos de nuvem, cotas e proposta de SLA (`docs/NUVEM_SLA.md`).
- [ ] Publicar no Render + UptimeRobot (Etapa 6) e anotar os valores medidos na tabela de SLA.
- [ ] Teste com o ESP32 físico.
- [ ] Relatório técnico e slides (`docs/ARQUITETURA.md` + `docs/NUVEM_SLA.md`).
