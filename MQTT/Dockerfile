# Versi di-pin (bukan tag bergerak "2"); naikkan sengaja dan uji dengan MQTT/scripts/verify-broker.sh.
FROM eclipse-mosquitto:2.0.22

# Konfigurasi + ACL di-bake ke image, dimiliki user mosquitto (uid 1883) mode 0600, sehingga Mosquitto tidak
# memperingatkan "world readable" (versi mendatang menolak file semacam itu). Mengubah ACL = build ulang image.
# password_file sengaja TIDAK di-bake: itu secret, dibuat dengan scripts/init-passwd.sh dan di-mount dari secrets/.
# (--chmod butuh BuildKit, default di Docker >= 23.)
COPY --chown=1883:1883 --chmod=0600 config/mosquitto.conf /mosquitto/config/mosquitto.conf
COPY --chown=1883:1883 --chmod=0600 config/acl_file /mosquitto/config/acl_file

EXPOSE 1883

# Cek TCP listener hidup (tanpa kredensial di image).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD nc -z 127.0.0.1 1883 || exit 1

CMD ["mosquitto", "-c", "/mosquitto/config/mosquitto.conf"]
