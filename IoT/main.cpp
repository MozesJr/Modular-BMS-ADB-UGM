#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET    -1
#define SCREEN_ADDRESS 0x3C

// Inisialisasi layar OLED
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

void setup() {
  Serial.begin(115200);

  // Inisialisasi bus I2C pada pin default ESP32 (SDA=21, SCL=22)
  Wire.begin(21, 22);

  // Jalankan layar OLED
  if (!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
    Serial.println(F("Gagal menginisialisasi SSD1306"));
    for (;;);
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
}

void loop() {
  // Simulasi string waktu (format YYMMDD-HH:mm)
  // Bisa diganti dengan library NTPClient jika terhubung WiFi
  char timeBuffer[20];
  snprintf(timeBuffer, sizeof(timeBuffer), "261103-11:23");

  display.clearDisplay();
  display.setTextSize(1);

  // Baris 1: Judul
  display.setCursor(0, 2);
  display.print("GAMA BMS");

  // Baris 2: IP Address
  display.setCursor(0, 18);
  display.print("192.168.4.1");

  // Baris 3: Tegangan Total
  display.setCursor(0, 34);
  display.print("V Total: 78V");

  // Baris 4: Waktu
  display.setCursor(0, 50);
  display.print("time : ");
  display.print(timeBuffer);

  // Perbarui tampilan di layar
  display.display();
  
  delay(1000);
}