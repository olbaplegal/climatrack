// =====================================================
// secrets.h PARA O WOKWI
// No Wokwi, crie um arquivo chamado "secrets.h" e cole isto.
// ATENÇÃO: projetos salvos no Wokwi gratuito são PÚBLICOS.
// Use uma credencial do HiveMQ só para o Wokwi (ex.: "wokwi")
// e apague-a no HiveMQ se o link do projeto for compartilhado.
// =====================================================
#pragma once

// Rede Wi-Fi virtual do Wokwi (com acesso à internet)
#define SECRET_WIFI_SSID     "Wokwi-GUEST"
#define SECRET_WIFI_PASSWORD ""

// HiveMQ Cloud (URL sem "mqtts://")
#define SECRET_MQTT_SERVER   "xxxxxxxx.s1.eu.hivemq.cloud"
#define SECRET_MQTT_USER     "wokwi"
#define SECRET_MQTT_PASSWORD "SenhaDaCredencialWokwi"

// O Wokwi tem o DHT22; e um ID próprio para não brigar com o ESP32 físico no broker
#define CFG_DEVICE_ID "esp32-wokwi"
#define CFG_DHT_TYPE  DHT22
