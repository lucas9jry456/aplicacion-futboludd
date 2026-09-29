import os
import sys
import time
import socket
import webbrowser
import threading

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

def print_banner(local_ip, port, scheme="http"):
    print("=" * 72)
    print("      ⚽ FUTBOL IA - SISTEMA DE ANALISIS Y SEGUIMIENTO A 45 FPS ⚽")
    print("=" * 72)
    print(f"  [PC / Navegador Local]:  {scheme}://localhost:{port}")
    print(f"  [CELULAR / Red Wi-Fi]:   {scheme}://{local_ip}:{port}")
    print("=" * 72)
    print("  * Para usar tu CELULAR como camara:")
    print(f"    1. Abre {scheme}://{local_ip}:{port} en el navegador de tu celular")
    print("    2. O escanea el codigo QR mostrado abajo")
    print("    3. En tu celular, si aparece 'La conexión no es privada', presiona:")
    print("       'Configuración avanzada' -> 'Continuar a sitio no seguro'.")
    print("       (Esto otorga permiso HTTPS seguro para activar la cámara trasera).")
    print("=" * 72)

    try:
        import qrcode
        qr = qrcode.QRCode(version=1, box_size=1, border=1)
        qr.add_data(f"{scheme}://{local_ip}:{port}")
        qr.make(fit=True)
        print("\n  [ CODIGO QR PARA ESCANEAR CON EL CELULAR ]:\n")
        qr.print_ascii(invert=True)
        print("\n" + "=" * 72)
    except Exception:
        pass

def open_browser(port, scheme="http"):
    time.sleep(1.5)
    try:
        webbrowser.open(f"{scheme}://localhost:{port}")
    except Exception:
        pass

if __name__ == "__main__":
    from app import app, PORT
    local_ip = get_local_ip()
    ssl_ctx = ("cert.pem", "key.pem") if (os.path.exists("cert.pem") and os.path.exists("key.pem")) else None
    scheme = "https" if ssl_ctx else "http"
    
    print_banner(local_ip, PORT, scheme)

    # Abrir navegador automaticamente
    threading.Thread(target=open_browser, args=(PORT, scheme), daemon=True).start()

    # Iniciar servidor Flask
    try:
        app.run(host="0.0.0.0", port=PORT, threaded=True, ssl_context=ssl_ctx)
    except KeyboardInterrupt:
        print("\n[*] Servidor detenido por el usuario.")

