// =====================================================
// CLIMATRACK - ESP32 + DHT ==> MQTT (TLS) ==> HIVEMQ
// =====================================================
//
// Baseado no "Programa Sensor de Temperatura e Umidade com Broker"
// da disciplina, com acréscimos para o Projeto Final:
//
//  - Processamento na borda (Edge Computing):
//      * várias amostras por ciclo + média móvel
//      * descarte de leituras inválidas / fora da faixa física
//      * cálculo do índice de calor (sensação térmica)
//      * "report by exception": publica antes do intervalo se a
//        variação for grande (zona morta / deadband)
//      * alarme LOCAL: aciona LED/buzzer mesmo sem internet
//  - Comunicação bidirecional (comandos vindos da nuvem)
//  - Status online/offline com Last Will (LWT)
//
// Bibliotecas (Arduino IDE > Tools > Manage Libraries):
//  - DHT sensor library (Adafruit) + Adafruit Unified Sensor
//  - PubSubClient (Nick O'Leary)
//  - ArduinoJson (Benoit Blanchon) versão 7.x
// =====================================================

#include <ArduinoJson.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <WiFiClientSecure.h>
#include <DHT.h>
#include <time.h>
#include "secrets.h"

// =====================================================
// CONFIGURAÇÕES  (ALTERE AQUI)
// =====================================================

// Wi-Fi e MQTT: as senhas ficam em "secrets.h" (fora do git).
// Primeira vez: copie "secrets.example.h" para "secrets.h" e preencha.
const char* WIFI_SSID     = SECRET_WIFI_SSID;
const char* WIFI_PASSWORD = SECRET_WIFI_PASSWORD;

// MQTT - HiveMQ Cloud (TLS)
const char* MQTT_SERVER   = SECRET_MQTT_SERVER;
const int   MQTT_PORT     = 8883;
const char* MQTT_USER     = SECRET_MQTT_USER;
const char* MQTT_PASSWORD = SECRET_MQTT_PASSWORD;

// Identificação do dispositivo (deve ser único)
const char* DEVICE_ID = "esp32-01";

// Sensor: DHT11 (azul) ou DHT22 (branco)
#define DHT_PIN  4
#define DHT_TYPE DHT11

// Atuadores
#define LED_PIN    2    // LED interno da placa
#define BUZZER_PIN 15   // buzzer ativo (opcional; deixe desconectado se não tiver)

// =====================================================
// PARÂMETROS DE BORDA (podem ser alterados via comando MQTT)
// =====================================================

unsigned long intervaloEnvio = 15000;  // publica a cada 15 s
const unsigned long INTERVALO_AMOSTRA = 2500; // DHT11 aceita ~1 leitura/s; 2,5 s é seguro
const int JANELA_MEDIA = 5;             // nº de amostras na média móvel

float limiteTempMax = 30.0;             // °C
float limiteUmidMin = 30.0;             // %
float deadbandTemp  = 1.0;              // °C de variação que força envio imediato
float deadbandUmid  = 5.0;              // %  de variação que força envio imediato

// =====================================================
// TÓPICOS MQTT
// =====================================================

String TOPIC_DADOS;    // clima/<device>/dados    (ESP32 -> nuvem)
String TOPIC_STATUS;   // clima/<device>/status   (ESP32 -> nuvem, retido)
String TOPIC_COMANDO;  // clima/<device>/comando  (nuvem -> ESP32)

// =====================================================
// OBJETOS
// =====================================================

DHT dht(DHT_PIN, DHT_TYPE);
WiFiClientSecure espClient;
PubSubClient mqttClient(espClient);

// Buffer circular da média móvel
float bufTemp[JANELA_MEDIA];
float bufUmid[JANELA_MEDIA];
int   bufIndice = 0;
int   bufQtd = 0;

unsigned long ultimaAmostra = 0;
unsigned long ultimoEnvio = 0;
float ultimaTempEnviada = NAN;
float ultimaUmidEnviada = NAN;
int   leiturasDescartadas = 0;

bool alarmeLocal = false;    // decidido na borda
bool ledManual = false;      // comando vindo da nuvem
bool buzzerHabilitado = true;

// =====================================================
// WI-FI
// =====================================================

void conectarWiFi() {
  Serial.print("Conectando ao Wi-Fi");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.print("Wi-Fi conectado! IP: ");
  Serial.println(WiFi.localIP());
}

// =====================================================
// DATA E HORA (NTP)
// =====================================================

String obterDataHora() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo, 100)) {
    return "";  // o back-end usa o horário de recebimento
  }
  char buffer[30];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%S-03:00", &timeinfo);
  return String(buffer);
}

// =====================================================
// ATUADORES
// =====================================================

void atualizarAtuadores() {
  // LED acende se houver alarme local OU se a nuvem mandou ligar
  digitalWrite(LED_PIN, (alarmeLocal || ledManual) ? HIGH : LOW);
  digitalWrite(BUZZER_PIN, (alarmeLocal && buzzerHabilitado) ? HIGH : LOW);
}

// =====================================================
// PUBLICAR STATUS (retido)
// =====================================================

void publicarStatus(const char* status) {
  JsonDocument doc;
  doc["device_id"] = DEVICE_ID;
  doc["status"] = status;
  doc["data_hora"] = obterDataHora();
  doc["ip"] = WiFi.localIP().toString();
  doc["rssi"] = WiFi.RSSI();
  doc["intervalo_ms"] = intervaloEnvio;
  doc["limite_temp_max"] = limiteTempMax;
  doc["limite_umid_min"] = limiteUmidMin;
  doc["led"] = (alarmeLocal || ledManual);

  char json[320];
  serializeJson(doc, json);
  mqttClient.publish(TOPIC_STATUS.c_str(), json, true);

  Serial.print("Status publicado: ");
  Serial.println(json);
}

// =====================================================
// RECEBER COMANDO MQTT (nuvem -> borda)
// =====================================================
//
// Exemplos de comandos aceitos:
//  {"comando":"led","valor":1}
//  {"comando":"led","valor":0}
//  {"comando":"buzzer","valor":0}
//  {"comando":"intervalo","valor":30}           (segundos)
//  {"comando":"limites","temp_max":28,"umid_min":35}
//  {"comando":"status"}                          (pede status atual)

void callbackMQTT(char* topic, byte* payload, unsigned int length) {
  Serial.print("\nComando recebido em ");
  Serial.println(topic);

  JsonDocument doc;
  DeserializationError erro = deserializeJson(doc, payload, length);
  if (erro) {
    Serial.print("JSON inválido: ");
    Serial.println(erro.c_str());
    return;
  }

  const char* comando = doc["comando"] | "";
  Serial.print("Comando: ");
  Serial.println(comando);

  if (strcmp(comando, "led") == 0) {
    ledManual = (doc["valor"] | 0) == 1;
  }
  else if (strcmp(comando, "buzzer") == 0) {
    buzzerHabilitado = (doc["valor"] | 1) == 1;
  }
  else if (strcmp(comando, "intervalo") == 0) {
    int segundos = doc["valor"] | 15;
    intervaloEnvio = (unsigned long)constrain(segundos, 5, 3600) * 1000UL;
  }
  else if (strcmp(comando, "limites") == 0) {
    if (doc["temp_max"].is<float>()) limiteTempMax = doc["temp_max"];
    if (doc["umid_min"].is<float>()) limiteUmidMin = doc["umid_min"];
  }
  else if (strcmp(comando, "status") != 0) {
    Serial.println("Comando desconhecido");
    return;
  }

  atualizarAtuadores();
  publicarStatus("online");  // confirma (ACK) o novo estado para a nuvem
}

// =====================================================
// MQTT
// =====================================================

void conectarMQTT() {
  while (!mqttClient.connected()) {
    Serial.print("Conectando ao HiveMQ...");

    // Last Will: se o ESP32 cair, o broker publica "offline" sozinho
    String lwt = String("{\"device_id\":\"") + DEVICE_ID + "\",\"status\":\"offline\"}";

    if (mqttClient.connect(DEVICE_ID, MQTT_USER, MQTT_PASSWORD,
                           TOPIC_STATUS.c_str(), 1, true, lwt.c_str())) {
      Serial.println(" conectado!");
      mqttClient.subscribe(TOPIC_COMANDO.c_str(), 1);
      publicarStatus("online");
    } else {
      Serial.print(" falhou. Erro MQTT: ");
      Serial.println(mqttClient.state());
      delay(5000);
    }
  }
}

// =====================================================
// EDGE: COLETA E FILTRAGEM
// =====================================================

// Faixas físicas do sensor (DHT11: 0-50 °C, 20-90 %; DHT22: -40-80 °C, 0-100 %)
bool leituraValida(float t, float u) {
  if (isnan(t) || isnan(u)) return false;
  if (t < -40 || t > 80) return false;
  if (u < 0 || u > 100) return false;

  // Rejeita "picos" absurdos em relação à média atual (ruído do sensor)
  if (bufQtd >= 3) {
    float somaT = 0;
    for (int i = 0; i < bufQtd; i++) somaT += bufTemp[i];
    if (fabs(t - somaT / bufQtd) > 10.0) return false;
  }
  return true;
}

void coletarAmostra() {
  float t = dht.readTemperature();
  float u = dht.readHumidity();

  if (!leituraValida(t, u)) {
    leiturasDescartadas++;
    Serial.println("Leitura descartada (inválida ou ruído)");
    return;
  }

  bufTemp[bufIndice] = t;
  bufUmid[bufIndice] = u;
  bufIndice = (bufIndice + 1) % JANELA_MEDIA;
  if (bufQtd < JANELA_MEDIA) bufQtd++;
}

float mediaBuffer(float* buf) {
  float soma = 0;
  for (int i = 0; i < bufQtd; i++) soma += buf[i];
  return soma / bufQtd;
}

// =====================================================
// PUBLICAR TELEMETRIA
// =====================================================

void publicarDados(float temperatura, float umidade, const char* motivo) {
  float indiceCalor = dht.computeHeatIndex(temperatura, umidade, false);

  JsonDocument doc;
  doc["device_id"] = DEVICE_ID;
  doc["data_hora"] = obterDataHora();
  doc["temperatura"] = round(temperatura * 10) / 10.0;
  doc["umidade"] = round(umidade * 10) / 10.0;
  doc["indice_calor"] = round(indiceCalor * 10) / 10.0;
  doc["amostras"] = bufQtd;
  doc["descartadas"] = leiturasDescartadas;
  doc["alarme_local"] = alarmeLocal;
  doc["motivo"] = motivo;            // "periodico" ou "variacao"
  doc["rssi"] = WiFi.RSSI();

  char json[320];
  serializeJson(doc, json);

  if (mqttClient.publish(TOPIC_DADOS.c_str(), json)) {
    Serial.print("Dados publicados: ");
    Serial.println(json);
  } else {
    Serial.println("Falha ao publicar dados");
  }

  ultimaTempEnviada = temperatura;
  ultimaUmidEnviada = umidade;
  leiturasDescartadas = 0;
}

// =====================================================
// SETUP
// =====================================================

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n================================");
  Serial.println("ClimaTrack - ESP32 + DHT");
  Serial.println("================================");

  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  atualizarAtuadores();

  TOPIC_DADOS   = String("clima/") + DEVICE_ID + "/dados";
  TOPIC_STATUS  = String("clima/") + DEVICE_ID + "/status";
  TOPIC_COMANDO = String("clima/") + DEVICE_ID + "/comando";

  dht.begin();
  conectarWiFi();

  // NTP - horário de Brasília (-03:00)
  configTime(-3 * 3600, 0, "pool.ntp.org", "time.nist.gov");

  espClient.setInsecure();  // TLS sem validar certificado (simplificação de PoC)
  mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
  mqttClient.setCallback(callbackMQTT);
  mqttClient.setBufferSize(512);
  mqttClient.setKeepAlive(60);
}

// =====================================================
// LOOP
// =====================================================

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    conectarWiFi();
  }
  if (!mqttClient.connected()) {
    conectarMQTT();
  }
  mqttClient.loop();

  unsigned long agora = millis();

  // 1) Coleta amostras com frequência maior que a de envio
  if (agora - ultimaAmostra >= INTERVALO_AMOSTRA) {
    ultimaAmostra = agora;
    coletarAmostra();

    if (bufQtd == 0) return;

    float t = mediaBuffer(bufTemp);
    float u = mediaBuffer(bufUmid);

    // 2) Decisão local (funciona mesmo sem nuvem)
    bool novoAlarme = (t > limiteTempMax) || (u < limiteUmidMin);
    if (novoAlarme != alarmeLocal) {
      alarmeLocal = novoAlarme;
      atualizarAtuadores();
      Serial.println(alarmeLocal ? "ALARME LOCAL ATIVADO" : "Alarme local desativado");
    }

    // 3) Envio: periódico ou por variação significativa (deadband)
    bool variacao = !isnan(ultimaTempEnviada) &&
                    (fabs(t - ultimaTempEnviada) >= deadbandTemp ||
                     fabs(u - ultimaUmidEnviada) >= deadbandUmid);

    if (agora - ultimoEnvio >= intervaloEnvio || isnan(ultimaTempEnviada)) {
      ultimoEnvio = agora;
      publicarDados(t, u, "periodico");
    } else if (variacao) {
      ultimoEnvio = agora;
      publicarDados(t, u, "variacao");
    }
  }
}
