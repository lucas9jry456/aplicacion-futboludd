"""
Futbol AI Tracker - Servidor Web Local y Móvil
Inicia un servidor HTTP local optimizado para servir la aplicación
en PC y en dispositivos móviles conectados a la misma red Wi-Fi.
"""

import http.server
import socket
import socketserver
import os
import sys
import webbrowser

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

def get_local_ip():
    """Obtiene la dirección IP local de la computadora en la red Wi-Fi/LAN"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # No requiere conexión a internet real, solo resuelve la interfaz primaria
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

class CustomHTTPHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Habilitar CORS y headers para rendimiento
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

def run_server():
    os.chdir(DIRECTORY)
    local_ip = get_local_ip()

    print("=" * 65)
    print("   ⚽  FUTBOL AI TRACKER - SERVIDOR ACTIVO")
    print("=" * 65)
    print(f"\n💻 En tu PC:          http://localhost:{PORT}")
    print(f"📱 En tu CELULAR:     http://{local_ip}:{PORT}")
    print("\n(Asegúrate de que tu celular esté conectado al mismo Wi-Fi)")
    print("=" * 65)
    print("Presiona Ctrl + C en esta ventana para detener el servidor.\n")

    # Intentar abrir automáticamente en el navegador de la PC
    try:
        webbrowser.open(f"http://localhost:{PORT}")
    except Exception:
        pass

    with socketserver.TCPServer(("0.0.0.0", PORT), CustomHTTPHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServidor detenido.")
            sys.exit(0)

if __name__ == '__main__':
    run_server()
