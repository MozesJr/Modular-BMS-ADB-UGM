# mqtt/Dockerfile
FROM eclipse-mosquitto:2

# Bake config default ke image (bisa di-override lewat volume mount saat dev)
COPY config/mosquitto.conf /mosquitto/config/mosquitto.conf

EXPOSE 1883

CMD ["mosquitto", "-c", "/mosquitto/config/mosquitto.conf"]