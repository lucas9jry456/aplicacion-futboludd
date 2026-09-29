import os
import io
import time
import socket
import base64
import threading
import cv2
import numpy as np
import qrcode
from flask import Flask, render_template, Response, request, jsonify, send_from_directory
from flask_cors import CORS
from core.football_engine import FootballEngine

app = Flask(__name__, template_folder="templates", static_folder="static")
CORS(app)

# Directorios de trabajo
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE_DIR, "output")
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
for d in [OUTPUT_DIR, UPLOADS_DIR]:
    os.makedirs(d, exist_ok=True)

# Motor de fútbol
engine = FootballEngine()

# Estado global de la captura
class StreamState:
    def __init__(self):
        self.lock = threading.Lock()
        self.cap = None
        self.source_type = "camera" # 'camera', 'video_file', 'client_upload'
        self.camera_index = 0
        self.video_path = None
        self.latest_frame = None
        self.latest_annotated = None
        self.is_streaming = False
        self.thread = None
        self.target_fps = 45.0

stream_state = StreamState()


def get_local_ip():
    """Detecta la dirección IP de red local para acceso desde el celular."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

LOCAL_IP = get_local_ip()
PORT = 5000

def video_capture_loop():
    """Hilo continuo de lectura y procesamiento de video con control de FPS."""
    global stream_state
    while stream_state.is_streaming:
        loop_start = time.time()
        if stream_state.cap is not None and stream_state.cap.isOpened():
            ret, frame = stream_state.cap.read()
            if not ret:
                # Si es un archivo de video y llegó al final, reiniciar en bucle
                if stream_state.source_type == "video_file":
                    stream_state.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                else:
                    time.sleep(0.05)
                    continue

            # Redimensionar para fluidez óptima si es muy grande
            h, w = frame.shape[:2]
            if w > 1280:
                scale = 1280.0 / w
                frame = cv2.resize(frame, (1280, int(h * scale)))

            # Procesar frame con el motor de IA
            annotated = engine.process_frame(frame)

            with stream_state.lock:
                stream_state.latest_frame = frame
                stream_state.latest_annotated = annotated

            # Control de velocidad FPS (especialmente para la demo a 15 fps)
            if stream_state.source_type == "video_file":
                elapsed = time.time() - loop_start
                target_interval = 1.0 / stream_state.target_fps
                if elapsed < target_interval:
                    time.sleep(target_interval - elapsed)
        else:
            time.sleep(0.05)

def start_stream_source(source_type="camera", camera_idx=0, file_path=None, target_fps=45.0):
    global stream_state
    stream_state.is_streaming = False
    if stream_state.thread and stream_state.thread.is_alive():
        stream_state.thread.join(timeout=1.0)

    if stream_state.cap is not None:
        stream_state.cap.release()
        stream_state.cap = None

    stream_state.source_type = source_type
    stream_state.target_fps = target_fps
    if source_type == "camera":
        stream_state.camera_index = camera_idx
        # Abrir cámara local con DirectShow en Windows para arranque rápido
        stream_state.cap = cv2.VideoCapture(camera_idx, cv2.CAP_DSHOW)
        if not stream_state.cap.isOpened():
            stream_state.cap = cv2.VideoCapture(camera_idx)
    elif source_type == "video_file" and file_path:
        stream_state.video_path = file_path
        stream_state.cap = cv2.VideoCapture(file_path)

    stream_state.is_streaming = True
    stream_state.thread = threading.Thread(target=video_capture_loop, daemon=True)
    stream_state.thread.start()

# Iniciar streaming por defecto con cámara 0 a 45 FPS
try:
    start_stream_source("camera", 0, target_fps=45.0)
except Exception as e:
    print(f"[!] No se pudo abrir cámara local por defecto: {e}")

# Rutas web
@app.route("/")
def index():
    return render_template("index.html", local_ip=LOCAL_IP, port=PORT)

@app.route("/api/qr")
def get_qr():
    """Genera imagen QR en base64 para abrir la web en el celular."""
    use_https = os.path.exists("cert.pem") and os.path.exists("key.pem")
    scheme = "https" if use_https else "http"
    url = f"{scheme}://{LOCAL_IP}:{PORT}"
    qr = qrcode.QRCode(version=1, box_size=8, border=2)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#00ff88", back_color="#121620")
    
    buffered = io.BytesIO()
    img.save(buffered, format="PNG")
    img_str = base64.b64encode(buffered.getvalue()).decode()
    return jsonify({
        "url": url,
        "is_https": use_https,
        "qr_base64": f"data:image/png;base64,{img_str}"
    })

def generate_frames():
    """Generador MJPEG para streaming continuo a 45 FPS."""
    global stream_state
    while True:
        frame_to_send = None
        with stream_state.lock:
            if stream_state.latest_annotated is not None:
                frame_to_send = stream_state.latest_annotated.copy()

        if frame_to_send is not None:
            ret, buffer = cv2.imencode('.jpg', frame_to_send, [cv2.IMWRITE_JPEG_QUALITY, 78])
            if ret:
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
        time.sleep(0.012) # Intervalo para fluidez de 45+ FPS


@app.route("/video_feed")
def video_feed():
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route("/api/process_mobile_frame", methods=["POST"])
def process_mobile_frame():
    """
    Recibe fotogramas transmitidos en tiempo real desde la cámara del celular.
    Permite usar el smartphone como cámara principal sin instalar apps nativas.
    """
    global stream_state
    try:
        file = request.files.get("frame")
        if not file:
            return jsonify({"error": "No frame received"}), 400

        np_arr = np.frombuffer(file.read(), np.uint8)
        frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        if frame is None:
            return jsonify({"error": "Decode error"}), 400

        # Procesar con el motor
        annotated = engine.process_frame(frame)
        with stream_state.lock:
            stream_state.latest_frame = frame
            stream_state.latest_annotated = annotated

        # Retornar stats actuales
        return jsonify({
            "status": "ok",
            "stats": engine.stats.to_dict()
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/stats")
def get_stats():
    """Retorna las estadísticas del partido en tiempo real."""
    return jsonify(engine.stats.to_dict())

@app.route("/api/start_match", methods=["POST"])
def start_match():
    """Inicia la grabación y el cronómetro del partido."""
    data = request.json or {}
    team_a = data.get("team_a", "Equipo Azul")
    team_b = data.get("team_b", "Equipo Rojo")
    
    engine.stats.team_a = team_a
    engine.stats.team_b = team_b

    # Dimensiones del video
    w, h = 1280, 720
    with stream_state.lock:
        if stream_state.latest_frame is not None:
            h, w = stream_state.latest_frame.shape[:2]

    engine.start_match(frame_size=(w, h))
    return jsonify({"status": "started", "team_a": team_a, "team_b": team_b})

@app.route("/api/stop_match", methods=["POST"])
def stop_match():
    """
    Detiene la grabación del partido, compila el video de mejores momentos
    y genera el reporte final descargable.
    """
    result = engine.stop_match()
    
    # Preparar URLs de descarga relativas
    full_vid_url = f"/output/full_matches/{os.path.basename(result['full_video'])}" if result['full_video'] else None
    highlights_url = f"/output/highlights/{os.path.basename(result['highlights_video'])}" if result['highlights_video'] else None
    report_url = f"/output/reports/{os.path.basename(result['report_json'])}" if result['report_json'] else None

    return jsonify({
        "status": "stopped",
        "full_video_url": full_vid_url,
        "highlights_url": highlights_url,
        "report_url": report_url,
        "stats": result["stats"],
        "highlights_count": len(result["stats"].get("events", []))
    })

@app.route("/api/change_source", methods=["POST"])
def change_source():
    """Cambia la fuente de video (cámara 0, 1, video cargado)."""
    data = request.json or {}
    source_type = data.get("type", "camera")
    camera_idx = int(data.get("camera_idx", 0))
    video_path = data.get("video_path")

    start_stream_source(source_type=source_type, camera_idx=camera_idx, file_path=video_path)
    return jsonify({"status": "source_changed", "type": source_type})

@app.route("/api/upload_video", methods=["POST"])
def upload_video():
    """Permite subir un video de partido grabado para analizarlo."""
    if 'video' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    file = request.files['video']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    filename = f"partido_subido_{int(time.time())}.mp4"
    filepath = os.path.join(UPLOADS_DIR, filename)
    file.save(filepath)

    # Iniciar streaming desde este video
    start_stream_source(source_type="video_file", file_path=filepath)
    return jsonify({"status": "uploaded", "file_path": filepath, "filename": filename})

@app.route("/api/generate_demo_match", methods=["POST"])
def generate_demo_match():
    """
    Genera un clip de demostración sintético de fútbol a 45 FPS con árbitro,
    pases acertados y erróneos, tiros y gol.
    """
    from test_demo_generator import generate_demo_match_video
    demo_path = os.path.join(UPLOADS_DIR, "partido_demostracion.mp4")
    generate_demo_match_video(demo_path, duration_seconds=16, fps=45)
    start_stream_source(source_type="video_file", file_path=demo_path, target_fps=45.0)
    return jsonify({"status": "demo_created", "file_path": demo_path, "fps": 45})

@app.route("/output/<folder>/<filename>")
def serve_output_file(folder, filename):
    """Sirve los videos grabados y los resúmenes de highlights."""
    folder_path = os.path.join(OUTPUT_DIR, folder)
    return send_from_directory(folder_path, filename, as_attachment=False)

if __name__ == "__main__":
    ssl_ctx = ("cert.pem", "key.pem") if (os.path.exists("cert.pem") and os.path.exists("key.pem")) else None
    scheme = "https" if ssl_ctx else "http"
    
    print("=" * 68)
    print("   ⚽ FUTBOL IA - SISTEMA DE SEGUIMIENTO Y ANALISIS A 45 FPS ⚽")
    print("=" * 68)
    print(f"[*] Acceso desde esta PC:        {scheme}://localhost:{PORT}")
    print(f"[*] Acceso desde tu CELULAR:     {scheme}://{LOCAL_IP}:{PORT}")
    if ssl_ctx:
        print("[*] Modo HTTPS activo: Permite acceso a cámara trasera en celulares.")
    print("=" * 68)
    app.run(host="0.0.0.0", port=PORT, threaded=True, ssl_context=ssl_ctx)

