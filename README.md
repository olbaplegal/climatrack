# ClimaTrack

Monitoramento de temperatura e umidade com ESP32, MQTT e nuvem.

O ClimaTrack é uma plataforma **SaaS multiusuário**: cada cliente cria sua conta, cadastra seus sensores ESP32 e
acompanha pelo navegador (computador ou celular) as leituras em tempo real e o histórico de temperatura, umidade
e sensação térmica. Quando um valor sai da faixa configurada, o sistema avisa no painel e no Telegram e pode
acionar o próprio dispositivo (LED/buzzer).

---

## Visão geral

### Funcionalidades

- **Telemetria em tempo real**: os gráficos e cartões do painel atualizam sozinhos (Server-Sent Events).
- **Histórico**: períodos de 1 h, 6 h, 24 h, 7 dias e 30 dias, com estatísticas (mín./méd./máx.), tempo dentro
  da faixa, disponibilidade do sensor e exportação em CSV.
- **Alertas**: limites de temperatura e umidade por dispositivo, com histerese para evitar alarmes repetidos.
  Avisa quando o alerta dispara, quando normaliza e quando o dispositivo fica offline.
- **Notificações no Telegram**: cada usuário cadastra o próprio Chat ID. O bot também aceita comandos
  (`/status`, `/led_on`, `/led_off`).
- **Controle remoto**: pelo painel ou pelo Telegram é possível ligar/desligar LED e buzzer, mudar o intervalo de
  envio e sincronizar os limites com o ESP32.
- **Processamento na borda**: o ESP32 faz média móvel, descarta leituras com ruído, calcula o índice de calor,
  só envia quando o valor muda o suficiente (*deadband*) e mantém um alarme local mesmo sem internet.
- **Detecção de queda**: o broker publica o *Last Will* do ESP32 quando ele desconecta sem avisar.

### Arquitetura

```
ESP32 + DHT11 ──MQTT/TLS──► HiveMQ Cloud ──► Back-end Node.js ──► PostgreSQL (Supabase)
  (borda)      ◄──comandos──   (broker)    ◄──    │    │
                                                  │    └──► Telegram (alertas + bot)
                                                  └──► Painel web (gráficos, controles)
```

| Camada | Tecnologia | Papel |
|---|---|---|
| Dispositivo | ESP32 + DHT11/DHT22 (Arduino), ou o simulador Wokwi | Coleta e processamento na borda |
| Mensageria | MQTT sobre TLS, HiveMQ Cloud (PaaS) | Comunicação nos dois sentidos entre o dispositivo e a nuvem |
| Back-end | Node.js, Express 5, mqtt.js, Render (PaaS) | Ingestão, regras de alerta, API REST, login, bot |
| Banco | PostgreSQL, Supabase (PaaS) | Usuários, dispositivos, leituras, alertas e comandos |
| Painel | HTML/JS + Chart.js, servido pelo back-end | Interface do cliente |
| Notificações e monitoramento | Telegram Bot API, UptimeRobot (SaaS) | Alertas e medição de disponibilidade |

Os detalhes estão em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) (diagramas, fluxos e modelo de dados) e em
[`docs/NUVEM_SLA.md`](docs/NUVEM_SLA.md) (modelos de nuvem, cotas dos planos gratuitos e proposta de SLA).

### Estrutura do repositório

| Caminho | Conteúdo |
|---|---|
| `firmware/esp32_clima/` | Firmware do ESP32 (Arduino IDE) |
| `firmware/wokwi/` | Diagrama e configuração para rodar o mesmo firmware no simulador Wokwi |
| `backend/src/` | Back-end: ingestão MQTT, regras e alertas, API REST, autenticação, Telegram |
| `backend/public/` | Painel web |
| `backend/sql/schema.sql` | Esquema do banco (criado automaticamente na inicialização) |
| `backend/scripts/simulador.js` | Simulador de ESP32 para testes sem hardware |
| `docker-compose.yml` | PostgreSQL e Mosquitto locais, para desenvolvimento |
| `render.yaml` | Blueprint de implantação no Render (infraestrutura como código) |
| `docs/` | Arquitetura, nuvem e SLA, relatório técnico e apresentação |

---

## Configuração e uso

Existem duas formas de rodar o ClimaTrack:

- **Local**: Postgres e broker no Docker e um dispositivo simulado. Não depende de nenhum serviço externo e é
  o melhor jeito de conhecer o sistema ou desenvolver.
- **Nuvem**: HiveMQ Cloud, Supabase, Telegram e Render. Todos têm plano gratuito.

### Pré-requisitos

- **Node.js 20 ou mais recente**
- **Docker** (só para o ambiente local)
- **Arduino IDE 2.x** com suporte ao ESP32 (só para o dispositivo físico)

### 1. Rodar localmente

```bash
docker compose up -d --wait       # Postgres (5432) e Mosquitto (1883)

cd backend
npm install
cp .env.example .env              # o .env padrão já aponta para o ambiente local
npm start                         # espere por: [db] esquema verificado / [mqtt] conectado
```

Em outro terminal, inicie um dispositivo simulado:

```bash
cd backend
npm run simulador -- esp32-sim 5  # ID do dispositivo e intervalo de envio em segundos
```

Abra http://localhost:3000, **crie uma conta** e adicione o dispositivo `esp32-sim` na lateral do painel.

O simulador aceita comandos no terminal (digite a letra e Enter):

| Tecla | Efeito |
|---|---|
| `q` | Aquece 3 °C (três vezes dispara o alerta de temperatura máxima) |
| `f` | Esfria 3 °C (volta ao normal) |
| `s` | Simula uma queda sem aviso: o broker publica o *Last Will* e o painel mostra *offline* |

Os comandos enviados pelo painel aparecem no terminal do simulador (`<- comando {...}`).

Para parar: `Ctrl+C` nos terminais e `docker compose down` (os dados ficam guardados no volume `pgdata`).

### 2. Configurar os serviços de nuvem

Toda a configuração do back-end fica em `backend/.env`. Para usar a nuvem, troque os valores locais pelos dos
serviços abaixo.

#### Broker MQTT: HiveMQ Cloud

1. Em https://console.hivemq.cloud crie um cluster **Serverless (Free)** e copie a URL na aba *Overview*
   (ex.: `abc123.s1.eu.hivemq.cloud`). A porta TLS é **8883**.
2. Em *Access Management*, crie uma credencial para cada componente, todas com *Publish and Subscribe*:
   `backend`, `esp32_dev` e, se for usar o simulador Wokwi, `wokwi`.
3. No `.env`:

   ```env
   MQTT_URL=mqtts://abc123.s1.eu.hivemq.cloud:8883
   MQTT_USER=backend
   MQTT_PASSWORD=SenhaDoBackend
   ```

O *Web Client* do cluster, assinando `clima/#`, mostra todas as mensagens trocadas e é útil para diagnóstico.

#### Banco de dados: Supabase

1. Em https://supabase.com crie um projeto (região sugerida: **South America (São Paulo)**) e anote a senha do banco.
2. Em **Connect → Connection String**, escolha **Session pooler**, que funciona em redes só IPv4.
3. No `.env`, troque `[YOUR-PASSWORD]` pela senha:

   ```env
   DATABASE_URL=postgresql://postgres.xxxxxxxx:SENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
   DATABASE_SSL=true
   ```

As tabelas são criadas na primeira inicialização. Se a senha tiver caracteres especiais, codifique-os
(`@` → `%40`, `#` → `%23`).

> O `schema.sql` ativa o RLS (*Row Level Security*) sem regras em todas as tabelas. Isso bloqueia a API REST
> pública que o Supabase gera automaticamente. O back-end continua funcionando porque conecta como dono das tabelas.

#### Notificações: bot do Telegram

1. No Telegram, fale com o **@BotFather**, envie `/newbot` e copie o **token**.
2. No `.env`: `TELEGRAM_BOT_TOKEN=123456:ABC-seu-token`
3. Reinicie o back-end. Deve aparecer `[telegram] bot escutando comandos`.
4. Envie `/start` ao bot. Ele responde com o seu **Chat ID**.
5. No painel, em **Notificações**, cole o Chat ID e clique em **Enviar teste**.

Os alertas vão para o Chat ID do dono do dispositivo. Para receber num grupo, adicione o bot ao grupo, envie `/id`
lá e use o ID retornado (que é negativo).

#### Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta HTTP do painel e da API |
| `JWT_SECRET` | | Segredo que assina o login. Use um texto longo e aleatório |
| `DATABASE_URL` / `DATABASE_SSL` | local | Conexão com o PostgreSQL |
| `MQTT_URL` / `MQTT_USER` / `MQTT_PASSWORD` | local | Conexão com o broker |
| `MQTT_CLIENT_ID` | vazio | ID fixo do cliente MQTT. Na nuvem, garante uma só instância do back-end |
| `MQTT_TOPIC_PREFIX` | `clima` | Prefixo dos tópicos |
| `TELEGRAM_BOT_TOKEN` | vazio | Token do bot. Vazio desativa o Telegram |
| `TELEGRAM_CHAT_ID_PADRAO` | vazio | Destino dos alertas de dispositivos cujo dono não tem Chat ID |
| `TELEGRAM_POLLING` | `true` | Faz o bot responder a comandos |
| `HISTERESE` | `0.5` | Quanto o valor precisa voltar para dentro do limite para o alerta normalizar |
| `MINUTOS_INATIVO` | `2` | Minutos sem dados para o painel marcar o dispositivo como inativo |
| `OFFLINE_TOLERANCIA_S` | `60` | Segundos offline antes de gerar alerta (evita alarme em quedas rápidas de Wi-Fi) |
| `RETENCAO_DIAS` | `90` | Apaga leituras mais antigas que isso. `0` mantém tudo |

### 3. Conectar um dispositivo

#### ESP32 físico

**Montagem**

| DHT11 (módulo de 3 pinos) | ESP32 |
|---|---|
| VCC / + | 3V3 |
| GND / − | GND |
| DATA / S / OUT | GPIO 4 |

- No DHT11 "puro" de 4 pinos, coloque um resistor de **10 kΩ** entre DATA e 3V3.
- O LED de alerta é o LED interno da placa (GPIO 2).
- O buzzer ativo é opcional: `+` no GPIO 15 e `−` no GND.

**Firmware**

1. Abra `firmware/esp32_clima/esp32_clima.ino` na Arduino IDE.
2. Instale as bibliotecas **DHT sensor library** (Adafruit, junto com a *Adafruit Unified Sensor*),
   **PubSubClient** (Nick O'Leary) e **ArduinoJson** (versão 7).
3. Copie `secrets.example.h` para `secrets.h` na mesma pasta e preencha Wi-Fi, servidor MQTT (a URL do cluster,
   sem `mqtts://`), usuário `esp32_dev` e senha. Esse arquivo é ignorado pelo Git.
   O ID padrão é `esp32-01` com DHT11. Para mudar, use `CFG_DEVICE_ID` e `CFG_DHT_TYPE` no `secrets.h`.
4. Selecione a placa *ESP32 Dev Module* e faça o upload.
5. No Serial Monitor (115200), confira: Wi-Fi conectado → `Conectando ao HiveMQ... conectado!` → `Dados publicados`.
6. No painel, adicione o dispositivo `esp32-01`.

> O Wi-Fi precisa ser de **2,4 GHz**. Redes com página de login (portal cativo) não funcionam.

#### ESP32 simulado no Wokwi

O Wokwi roda o mesmo firmware. Os arquivos ficam em `firmware/wokwi/`.

1. Abra https://wokwi.com/projects/new/esp32.
2. Em **sketch.ino**, cole o conteúdo de `firmware/esp32_clima/esp32_clima.ino`.
3. Em **diagram.json**, cole `firmware/wokwi/diagram.json` (ESP32 + DHT22 no GPIO 4 + LED no GPIO 2).
4. Crie um arquivo `secrets.h` (**New file…**) com o conteúdo de `firmware/wokwi/secrets.wokwi.h`, preenchendo a
   URL do cluster e a senha da credencial `wokwi`.
5. No **Library Manager**, adicione as bibliotecas listadas em `firmware/wokwi/libraries.txt`.
6. Inicie a simulação (▶) e adicione o dispositivo **`esp32-wokwi`** no painel.

Para provocar um alerta, clique no DHT22 durante a simulação e aumente a temperatura.

> Projetos salvos no Wokwi gratuito são públicos. Por isso o Wokwi usa uma credencial própria, que pode ser
> apagada no HiveMQ se o link vazar.

### 4. Publicar o back-end (Render + UptimeRobot)

O back-end roda no **Render** e o painel fica disponível em `https://SEU-SERVICO.onrender.com`. Broker e banco
continuam os mesmos.

1. Envie o repositório para o GitHub, de preferência **privado**. Antes, confirme que nenhum segredo está
   versionado (o comando não deve listar nada):

   ```bash
   git ls-files | grep -E '(^|/)\.env$|secrets\.h$'
   ```

2. No Render, use **New → Blueprint** e escolha o repositório. O `render.yaml` já define plano, região, comandos
   de build/start e *health check*. Preencha os valores secretos:

   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | string do Supabase (Session pooler) |
   | `MQTT_URL` | `mqtts://SEU-CLUSTER.s1.eu.hivemq.cloud:8883` |
   | `MQTT_PASSWORD` | senha da credencial `backend` |
   | `TELEGRAM_BOT_TOKEN` | token do bot |
   | `TELEGRAM_CHAT_ID_PADRAO` | opcional |

   O `JWT_SECRET` é gerado pelo Render.

3. **Pare o back-end local antes de aplicar.** Dois back-ends no mesmo broker e no mesmo bot gravam leituras em
   dobro, duplicam alertas e fazem o Telegram recusar um deles.
4. O deploy termina quando o status fica **Live**. Confira em `https://SEU-SERVICO.onrender.com/api/saude`,
   que deve mostrar `"status":"ok"`, `"banco":true` e `"mqtt":true`.

> Se o Blueprint pedir cartão de crédito, crie um **Web Service** manualmente com *Root Directory* `backend`,
> *Build* `npm ci`, *Start* `npm start`, plano **Free**, *Health Check Path* `/api/saude` e todas as variáveis do
> `render.yaml`, incluindo um `JWT_SECRET` inventado por você.

**Manter o serviço acordado.** O plano gratuito do Render desliga o serviço após 15 minutos sem acessos HTTP
(mensagens MQTT não contam). Crie um monitor **HTTP(s)** gratuito no https://uptimerobot.com apontando para
`/api/saude` a cada **5 minutos**. Isso mantém o serviço ligado e mede a disponibilidade: o endpoint só
responde 200 quando banco e broker estão conectados (senão, 503).

**Atualizações.** Cada `git push` na `main` que altera `backend/` faz um novo deploy automático. Mudanças só em
documentação, firmware ou na raiz do repositório não fazem deploy.

**Desenvolver sem afetar a nuvem.** Use o ambiente local da seção 1. Guarde a versão de nuvem do `.env` como
`backend/.env.nuvem` (também ignorado pelo Git). Nunca rode o back-end local com as credenciais de nuvem
enquanto o Render estiver ligado.

### 5. Usar o painel

1. **Crie uma conta** e entre.
2. **Adicione um dispositivo** pelo ID dele (ex.: `esp32-01`). As leituras só aparecem nas contas que
   cadastraram o dispositivo.
3. **Acompanhe** os cartões (valor atual, mín./méd./máx., tempo dentro da faixa, disponibilidade) e os gráficos.
   Escolha o período no seletor. Em **1 h** cada leitura aparece individualmente, ao vivo.
4. **Configure os limites** de temperatura e umidade e clique em **Salvar e sincronizar**. Os limites também são
   enviados ao ESP32, que passa a usá-los no alarme local.
5. **Controle remoto**: liga/desliga LED e buzzer e muda o intervalo de envio.
6. **Notificações**: cadastre o Chat ID do Telegram.
7. **Alertas e exportação**: veja o histórico de alertas e baixe as leituras do período em CSV.

Comandos do bot no Telegram:

| Comando | Função |
|---|---|
| `/start`, `/id`, `/ajuda` | Mostra o Chat ID (para colar no painel) e a lista de comandos |
| `/status` | Última leitura dos seus dispositivos |
| `/led_on [id]`, `/led_off [id]` | Liga/desliga o LED do dispositivo |

---

## Referência

### Tópicos MQTT

| Tópico | Sentido | Exemplo de payload |
|---|---|---|
| `clima/<id>/dados` | ESP32 → nuvem | `{"device_id":"esp32-01","data_hora":"2026-10-13T14:00:00-03:00","temperatura":24.3,"umidade":58.0,"indice_calor":24.4,"amostras":5,"descartadas":0,"alarme_local":false,"motivo":"periodico","rssi":-61}` |
| `clima/<id>/status` (retido) | ESP32 → nuvem | `{"status":"online","ip":"192.168.0.10","intervalo_ms":15000,"limite_temp_max":30,...}`. *Last Will*: `{"status":"offline"}` |
| `clima/<id>/comando` | nuvem → ESP32 | `{"comando":"led","valor":1}` · `{"comando":"buzzer","valor":0}` · `{"comando":"intervalo","valor":30}` · `{"comando":"limites","temp_max":28,"umid_min":35}` · `{"comando":"status"}` |

### API REST (prefixo `/api`)

| Método e rota | Função |
|---|---|
| `GET /saude` | Saúde do serviço (banco, MQTT, uptime). Pública |
| `POST /auth/registrar`, `POST /auth/login`, `POST /auth/logout` | Conta e sessão (cookie JWT) |
| `GET /eu`, `PUT /eu`, `POST /eu/telegram-teste` | Perfil e Chat ID do Telegram |
| `GET /dispositivos`, `POST /dispositivos`, `PUT /dispositivos/:id`, `DELETE /dispositivos/:id` | Dispositivos e limites |
| `GET /dispositivos/:id/leituras?periodo=1h\|6h\|24h\|7d\|30d` | Série temporal (agregada por intervalo) |
| `GET /dispositivos/:id/resumo?periodo=...` | Estatísticas, conformidade e latência de alertas |
| `GET /dispositivos/:id/alertas` | Histórico de alertas |
| `GET /dispositivos/:id/exportar.csv?periodo=...` | Exportação CSV |
| `POST /dispositivos/:id/comandos` | Envia um comando ao dispositivo |
| `GET /eventos` | Eventos em tempo real (Server-Sent Events) |

### Problemas comuns

| Sintoma | Causa provável |
|---|---|
| ESP32: `Erro MQTT: -2` | URL do broker errada, sem internet ou Wi-Fi de 5 GHz |
| ESP32: `Erro MQTT: 4` ou `5` | Usuário ou senha do HiveMQ errados |
| ESP32: `Erro ao ler o DHT11` / leituras descartadas | Fio DATA solto, pino errado, falta do resistor de 10 kΩ (sensor puro) ou `CFG_DHT_TYPE` errado |
| Back-end: `getaddrinfo ENOTFOUND` / `ENETUNREACH` no banco | Use a string do **Session pooler** do Supabase, não a *Direct connection* |
| Back-end: `password authentication failed` | Senha do Supabase errada ou com caractere especial sem codificar |
| Dados chegam no HiveMQ mas não no painel | O dispositivo não foi adicionado à sua conta, ou o ID é diferente |
| Telegram não chega | Faltou enviar `/start` ao bot, o Chat ID não foi salvo ou o token está errado |
| Telegram: `Conflict: terminated by other getUpdates request` | Dois back-ends com o mesmo bot (ex.: local e Render). Durante um deploy, por alguns segundos, é normal |
| Painel na nuvem demora ~1 min para abrir | O Render "dormiu". Falta o monitor do UptimeRobot |
| Deploy no Render falha no *health check* | Variável errada ou faltando. Veja a aba *Logs* |
