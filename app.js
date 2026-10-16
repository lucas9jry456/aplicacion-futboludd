/**
 * Futbol AI Tracker - Aplicación Principal (app.js) v2.0
 * Manejo de UI, Controles de Video Avanzados (-5s, +5s, Scrubber),
 * Ocultamiento de IA al pausar/buscar, Registro de Goles y Google Sheets Directo
 */

// URL DIRECTA Y PERMANENTE DE GOOGLE SHEETS
const GOOGLE_SHEETS_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwr9DBtawR-LELn2FKnm2b3HYGk9uwyBeClewNruuhtCi7f4wZenec3ZWQbvVLgQEpnwA/exec';

// BASE DE DATOS INDEXEDDB
class FutbolDB {
    constructor() {
        this.dbName = 'FutbolAIDB';
        this.dbVersion = 1;
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('matches')) {
                    const matchStore = db.createObjectStore('matches', { keyPath: 'id' });
                    matchStore.createIndex('createdAt', 'createdAt', { unique: false });
                    matchStore.createIndex('title', 'title', { unique: false });
                }
                if (!db.objectStoreNames.contains('feedback')) {
                    const feedbackStore = db.createObjectStore('feedback', { keyPath: 'id' });
                    feedbackStore.createIndex('createdAt', 'createdAt', { unique: false });
                }
            };

            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve(this.db);
            };

            request.onerror = (e) => reject(e);
        });
    }

    async saveMatch(match) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['matches'], 'readwrite');
            const store = tx.objectStore('matches');
            const req = store.put(match);
            req.onsuccess = () => resolve(match.id);
            req.onerror = (e) => reject(e);
        });
    }

    async getAllMatches() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['matches'], 'readonly');
            const store = tx.objectStore('matches');
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result.sort((a, b) => b.createdAt - a.createdAt));
            req.onerror = (e) => reject(e);
        });
    }

    async deleteMatch(id) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['matches'], 'readwrite');
            const store = tx.objectStore('matches');
            const req = store.delete(id);
            req.onsuccess = () => resolve();
            req.onerror = (e) => reject(e);
        });
    }

    async saveFeedback(fb) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['feedback'], 'readwrite');
            const store = tx.objectStore('feedback');
            const req = store.put(fb);
            req.onsuccess = () => resolve(fb.id);
            req.onerror = (e) => reject(e);
        });
    }

    async getAllFeedback() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['feedback'], 'readonly');
            const store = tx.objectStore('feedback');
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result.sort((a, b) => b.createdAt - a.createdAt));
            req.onerror = (e) => reject(e);
        });
    }
}

// ESTADO GLOBAL DE LA APLICACIÓN
const App = {
    db: new FutbolDB(),
    aiTracker: null,
    currentTab: 'video',
    mediaStream: null,
    mediaRecorder: null,
    recordedChunks: [],
    isRecording: false,
    recordStartTime: 0,
    recordTimerInterval: null,
    currentFacingMode: 'environment',
    currentMatchData: null,
    currentHighlightFilter: 'todos',
    selectedGoalTeam: 'A',

    async init() {
        await this.db.init();

        const videoEl = document.getElementById('main-video');
        const canvasEl = document.getElementById('ai-canvas');
        this.aiTracker = new FutbolAITracker(videoEl, canvasEl);

        // Callbacks de IA a UI
        this.aiTracker.onStatsUpdate = (stats) => this.renderStats(stats);
        this.aiTracker.onHighlightDetected = (hl, allHls) => this.renderHighlights(allHls);

        this.setupNavigation();
        this.setupVideoEvents();
        this.setupTimelineAndControls();
        this.setupGoalRegistration();
        this.setupZoneSelector();
        this.setupRecording();
        this.setupSavedVideosTab();
        this.setupFeedbackForm();
        this.setupHighlightFilters();

        // Iniciar con demo interactivo
        this.loadDemoMatch();
    },

    // 1. NAVEGACIÓN ENTRE PESTAÑAS
    setupNavigation() {
        const tabButtons = document.querySelectorAll('[data-tab-target]');
        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.getAttribute('data-tab-target');
                this.switchTab(target);
            });
        });
    },

    switchTab(tabName) {
        this.currentTab = tabName;
        document.querySelectorAll('.tab-content').forEach(section => section.classList.add('hidden'));

        const activeSection = document.getElementById(`tab-${tabName}`);
        if (activeSection) activeSection.classList.remove('hidden');

        document.querySelectorAll('[data-tab-target]').forEach(btn => {
            const target = btn.getAttribute('data-tab-target');
            if (target === tabName) {
                btn.classList.add('bg-emerald-600', 'text-white', 'shadow-md');
                btn.classList.remove('text-slate-300', 'hover:bg-slate-800');
            } else {
                btn.classList.remove('bg-emerald-600', 'text-white', 'shadow-md');
                btn.classList.add('text-slate-300', 'hover:bg-slate-800');
            }
        });

        if (tabName === 'saved') {
            this.loadSavedVideosList();
        } else if (tabName === 'feedback') {
            this.loadFeedbackHistory();
        }
    },

    // 2. CONTROLES MULTIMEDIA: TIMELINE (SCRUBBER), RETROCEDER, AVANZAR, PAUSA
    // Regla solicitada: "si pausa, retrocede o avanza el video que la IA deje de mostrar el radar, la trayectoria y las cajas"
    setupTimelineAndControls() {
        const video = document.getElementById('main-video');
        const scrubber = document.getElementById('video-scrubber');
        const currentTimeDisplay = document.getElementById('video-current-time');
        const durationTimeDisplay = document.getElementById('video-duration-time');
        const rewindBtn = document.getElementById('btn-rewind-5s');
        const forwardBtn = document.getElementById('btn-forward-5s');
        const playPauseBtn = document.getElementById('btn-play-pause');
        const playPauseText = document.getElementById('play-pause-text');
        const toggleIaBtn = document.getElementById('btn-toggle-ia-overlay');
        const noticeEl = document.getElementById('overlay-hidden-notice');

        // Actualizar barra de progreso con el tiempo del video
        video.addEventListener('timeupdate', () => {
            if (!video.duration || isNaN(video.duration)) {
                currentTimeDisplay.innerText = this.formatTime(video.currentTime || 0);
                durationTimeDisplay.innerText = 'En vivo';
                return;
            }
            const percent = (video.currentTime / video.duration) * 100;
            scrubber.value = percent;
            currentTimeDisplay.innerText = this.formatTime(video.currentTime);
            durationTimeDisplay.innerText = this.formatTime(video.duration);
        });

        // 1. CUANDO EL USUARIO MUEVE EL TIMELINE (AVANZAR O RETROCEDER LIBREMENTE)
        const onScrub = (e) => {
            if (video.duration && !isNaN(video.duration)) {
                const targetTime = (e.target.value / 100) * video.duration;
                video.currentTime = targetTime;
            }
            // OCULTAR INMEDIATAMENTE RADAR, TRAYECTORIAS Y CAJAS
            this.aiTracker.hideAllOverlays();
            if (noticeEl) noticeEl.classList.remove('hidden');
        };

        scrubber.addEventListener('input', onScrub);
        scrubber.addEventListener('change', onScrub);

        // 2. BOTÓN RETROCEDER 5 SEGUNDOS
        if (rewindBtn) {
            rewindBtn.addEventListener('click', () => {
                video.currentTime = Math.max(0, video.currentTime - 5);
                // OCULTAR INMEDIATAMENTE RADAR, TRAYECTORIAS Y CAJAS
                this.aiTracker.hideAllOverlays();
                if (noticeEl) noticeEl.classList.remove('hidden');
                this.showToast('Retrocedió 5s (IA oculta para vista limpia)');
            });
        }

        // 3. BOTÓN AVANZAR 5 SEGUNDOS
        if (forwardBtn) {
            forwardBtn.addEventListener('click', () => {
                const maxTime = video.duration || (video.currentTime + 10);
                video.currentTime = Math.min(maxTime, video.currentTime + 5);
                // OCULTAR INMEDIATAMENTE RADAR, TRAYECTORIAS Y CAJAS
                this.aiTracker.hideAllOverlays();
                if (noticeEl) noticeEl.classList.remove('hidden');
                this.showToast('Avanzó 5s (IA oculta para vista limpia)');
            });
        }

        // 4. BOTÓN PAUSA / PLAY
        if (playPauseBtn) {
            playPauseBtn.addEventListener('click', () => {
                if (video.paused) {
                    video.play();
                    this.aiTracker.showAllOverlays();
                    this.aiTracker.start();
                    playPauseBtn.innerHTML = '<i data-lucide="pause" class="w-4 h-4"></i><span>Pausar</span>';
                    if (noticeEl) noticeEl.classList.add('hidden');
                } else {
                    video.pause();
                    // OCULTAR INMEDIATAMENTE RADAR, TRAYECTORIAS Y CAJAS AL PAUSAR
                    this.aiTracker.hideAllOverlays();
                    playPauseBtn.innerHTML = '<i data-lucide="play" class="w-4 h-4"></i><span>Reproducir</span>';
                    if (noticeEl) noticeEl.classList.remove('hidden');
                }
                if (window.lucide) lucide.createIcons();
            });
        }

        // EVENTOS NATIVOS DE VIDEO (por si el usuario pausa con click en video o barra espaciadora)
        video.addEventListener('pause', () => {
            this.aiTracker.hideAllOverlays();
            if (playPauseBtn) playPauseBtn.innerHTML = '<i data-lucide="play" class="w-4 h-4"></i><span>Reproducir</span>';
            if (noticeEl) noticeEl.classList.remove('hidden');
            if (window.lucide) lucide.createIcons();
        });

        video.addEventListener('seeking', () => {
            this.aiTracker.hideAllOverlays();
            if (noticeEl) noticeEl.classList.remove('hidden');
        });

        // 5. BOTÓN MANUAL PARA MOSTRAR / OCULTAR IA
        if (toggleIaBtn) {
            toggleIaBtn.addEventListener('click', () => {
                if (this.aiTracker.hideOverlays) {
                    this.aiTracker.showAllOverlays();
                    if (noticeEl) noticeEl.classList.add('hidden');
                    this.showToast('IA reactivada: Radar y cajas visibles');
                } else {
                    this.aiTracker.hideAllOverlays();
                    if (noticeEl) noticeEl.classList.remove('hidden');
                    this.showToast('IA oculta: Video limpio');
                }
            });
        }
    },

    // 3. SELECTOR DE ZONA DE ENFOQUE (Área Derecha, Mitad, Área Izquierda)
    setupZoneSelector() {
        const zoneSelect = document.getElementById('select-camera-zone');
        const zoneDisplay = document.getElementById('zone-display-badge');

        if (zoneSelect) {
            zoneSelect.addEventListener('change', (e) => {
                const zone = e.target.value;
                this.aiTracker.setZone(zone);
                const label = this.aiTracker.getZoneLabel();
                if (zoneDisplay) zoneDisplay.innerText = `📍 Zona: ${label}`;
                this.showToast(`Cámara adaptada a: ${label}`);
            });
        }
    },

    // 4. REGISTRO DE GOLES CON ANOTADOR Y ASISTIDOR
    setupGoalRegistration() {
        const btnOpen = document.getElementById('btn-trigger-goal-modal');
        const modal = document.getElementById('goal-modal');
        const btnClose = document.getElementById('btn-close-goal-modal');
        const btnCancel = document.getElementById('btn-cancel-goal');
        const btnConfirm = document.getElementById('btn-confirm-goal');

        const btnTeamA = document.getElementById('btn-goal-team-a');
        const btnTeamB = document.getElementById('btn-goal-team-b');
        const scorerInput = document.getElementById('goal-scorer-input');
        const assistantInput = document.getElementById('goal-assistant-input');
        const zoneInput = document.getElementById('goal-zone-input');

        if (btnOpen) {
            btnOpen.addEventListener('click', () => {
                modal.classList.remove('hidden');
                scorerInput.value = '';
                assistantInput.value = '';
                zoneInput.value = this.aiTracker.getZoneLabel();
                scorerInput.focus();
            });
        }

        const closeModal = () => modal.classList.add('hidden');
        if (btnClose) btnClose.addEventListener('click', closeModal);
        if (btnCancel) btnCancel.addEventListener('click', closeModal);

        // Selección de equipo en el modal
        if (btnTeamA && btnTeamB) {
            btnTeamA.addEventListener('click', () => {
                this.selectedGoalTeam = 'A';
                btnTeamA.className = 'py-2.5 px-3 rounded-xl font-bold text-xs bg-blue-600 text-white border-2 border-blue-400 transition';
                btnTeamB.className = 'py-2.5 px-3 rounded-xl font-bold text-xs bg-slate-800 text-slate-300 border-2 border-transparent transition';
            });
            btnTeamB.addEventListener('click', () => {
                this.selectedGoalTeam = 'B';
                btnTeamB.className = 'py-2.5 px-3 rounded-xl font-bold text-xs bg-red-600 text-white border-2 border-red-400 transition';
                btnTeamA.className = 'py-2.5 px-3 rounded-xl font-bold text-xs bg-slate-800 text-slate-300 border-2 border-transparent transition';
            });
        }

        // Confirmar y guardar gol
        if (btnConfirm) {
            btnConfirm.addEventListener('click', () => {
                const scorer = scorerInput.value.trim() || 'Jugador Anónimo';
                const assistant = assistantInput.value.trim() || null;
                const zone = zoneInput.value;
                const video = document.getElementById('main-video');
                const currentTime = video.currentTime || (Date.now() / 1000);

                this.aiTracker.registerGoal(this.selectedGoalTeam, scorer, assistant, currentTime, zone);
                closeModal();

                this.showToast(`⚽ ¡GOL GUARDADO! Anotador: ${scorer}`);
                this.renderStats(this.aiTracker.stats);
                this.renderHighlights(this.aiTracker.highlights);

                // Si hay un partido guardado activo, actualizarlo
                if (this.currentMatchData) {
                    this.currentMatchData.stats = this.aiTracker.stats;
                    this.currentMatchData.highlights = this.aiTracker.highlights;
                    this.db.saveMatch(this.currentMatchData);
                }
            });
        }
    },

    // 5. CONFIGURACIÓN DE VIDEO, CÁMARA Y ARCHIVOS
    setupVideoEvents() {
        const cameraBtn = document.getElementById('btn-camera-toggle');
        const flipCamBtn = document.getElementById('btn-camera-flip');
        const uploadInput = document.getElementById('video-file-input');
        const demoBtn = document.getElementById('btn-demo-match');

        if (cameraBtn) cameraBtn.addEventListener('click', () => this.toggleCamera());
        if (flipCamBtn) {
            flipCamBtn.addEventListener('click', () => {
                this.currentFacingMode = (this.currentFacingMode === 'environment') ? 'user' : 'environment';
                if (this.mediaStream) {
                    this.stopCamera();
                    this.startCamera();
                }
            });
        }
        if (uploadInput) {
            uploadInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) this.loadVideoFile(file);
            });
        }
        if (demoBtn) demoBtn.addEventListener('click', () => this.loadDemoMatch());
    },

    async toggleCamera() {
        if (this.mediaStream) {
            this.stopCamera();
            document.getElementById('btn-camera-toggle').classList.remove('bg-red-600');
            document.getElementById('camera-status-indicator').classList.add('hidden');
        } else {
            await this.startCamera();
        }
    },

    async startCamera() {
        const video = document.getElementById('main-video');
        try {
            const constraints = {
                video: {
                    facingMode: this.currentFacingMode,
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 60 }
                },
                audio: false
            };

            this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            video.srcObject = this.mediaStream;
            video.play();
            this.aiTracker.isLiveCamera = true;
            this.aiTracker.showAllOverlays();
            this.aiTracker.start();

            document.getElementById('btn-camera-toggle').classList.add('bg-red-600');
            document.getElementById('camera-status-indicator').classList.remove('hidden');
            document.getElementById('video-source-badge').innerText = 'Cámara en Vivo';
            this.showToast('Cámara conectada');
        } catch (err) {
            this.showToast('No se pudo acceder a la cámara. Revisa los permisos.', 'error');
        }
    },

    stopCamera() {
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(t => t.stop());
            this.mediaStream = null;
        }
        const video = document.getElementById('main-video');
        video.srcObject = null;
        this.aiTracker.isLiveCamera = false;
        document.getElementById('btn-camera-toggle').classList.remove('bg-red-600');
        document.getElementById('camera-status-indicator').classList.add('hidden');
    },

    loadVideoFile(file) {
        this.stopCamera();
        const video = document.getElementById('main-video');
        const url = URL.createObjectURL(file);
        video.src = url;
        video.load();
        video.play();
        this.aiTracker.isLiveCamera = false;
        this.aiTracker.resetStats();
        this.aiTracker.showAllOverlays();
        this.aiTracker.start();

        document.getElementById('video-source-badge').innerText = file.name;
        this.showToast(`Cargado: ${file.name}`);
    },

    loadDemoMatch() {
        this.stopCamera();
        const video = document.getElementById('main-video');
        
        const synthCanvas = document.createElement('canvas');
        synthCanvas.width = 1280;
        synthCanvas.height = 720;
        const sCtx = synthCanvas.getContext('2d');

        const drawPitch = () => {
            // Césped verde realista con franjas
            for (let i = 0; i < 12; i++) {
                sCtx.fillStyle = (i % 2 === 0) ? '#15803d' : '#166534';
                sCtx.fillRect((i * 1280) / 12, 0, 1280 / 12, 720);
            }
            // Líneas de cancha
            sCtx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
            sCtx.lineWidth = 4;
            sCtx.strokeRect(60, 40, 1160, 640);

            sCtx.beginPath();
            sCtx.moveTo(640, 40);
            sCtx.lineTo(640, 680);
            sCtx.stroke();
            sCtx.beginPath();
            sCtx.arc(640, 360, 90, 0, Math.PI * 2);
            sCtx.stroke();

            // Áreas
            sCtx.strokeRect(60, 200, 180, 320);
            sCtx.strokeRect(1040, 200, 180, 320);

            // Arcos
            sCtx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            sCtx.fillRect(35, 280, 25, 160);
            sCtx.fillRect(1220, 280, 25, 160);
        };

        const stream = synthCanvas.captureStream(60);
        video.srcObject = stream;
        video.play();

        const renderSynth = () => {
            if (video.srcObject === stream) {
                drawPitch();
                requestAnimationFrame(renderSynth);
            }
        };
        renderSynth();

        this.aiTracker.isLiveCamera = true;
        this.aiTracker.resetStats();
        this.aiTracker.showAllOverlays();
        this.aiTracker.start();

        document.getElementById('video-source-badge').innerText = 'Simulación de Partido (Demo)';
    },

    // 6. GRABACIÓN DE PARTIDO Y POST-ANÁLISIS
    setupRecording() {
        const btnRecord = document.getElementById('btn-record-toggle');
        const btnStopAndAnalyze = document.getElementById('btn-stop-and-analyze');

        if (btnRecord) {
            btnRecord.addEventListener('click', () => {
                if (!this.isRecording) {
                    this.startRecording();
                } else {
                    this.stopRecording(false);
                }
            });
        }

        if (btnStopAndAnalyze) {
            btnStopAndAnalyze.addEventListener('click', () => {
                this.stopRecording(true);
            });
        }
    },

    startRecording() {
        const video = document.getElementById('main-video');
        let stream = null;

        if (video.srcObject) {
            stream = video.srcObject;
        } else if (video.captureStream) {
            stream = video.captureStream();
        } else {
            this.showToast('Inicia la cámara o reproduce un video antes de grabar', 'warning');
            return;
        }

        this.recordedChunks = [];
        try {
            const options = { mimeType: 'video/webm;codecs=vp9' };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) delete options.mimeType;
            this.mediaRecorder = new MediaRecorder(stream, options);
        } catch (e) {
            this.mediaRecorder = new MediaRecorder(stream);
        }

        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) this.recordedChunks.push(e.data);
        };

        this.mediaRecorder.start(1000);
        this.isRecording = true;
        this.recordStartTime = Date.now();

        document.getElementById('recording-badge').classList.remove('hidden');
        document.getElementById('btn-record-toggle').classList.add('bg-red-600', 'animate-pulse');

        this.recordTimerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.recordStartTime) / 1000);
            const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
            const secs = String(elapsed % 60).padStart(2, '0');
            document.getElementById('record-time-display').innerText = `${mins}:${secs}`;
        }, 1000);

        this.showToast('Grabación iniciada');
    },

    async stopRecording(andAnalyze = true) {
        if (!this.isRecording) {
            if (andAnalyze) this.runAIAnalysisModal();
            return;
        }

        this.isRecording = false;
        clearInterval(this.recordTimerInterval);
        document.getElementById('recording-badge').classList.add('hidden');
        document.getElementById('btn-record-toggle').classList.remove('bg-red-600', 'animate-pulse');

        this.mediaRecorder.stop();
        this.showToast('Grabación finalizada');

        await new Promise(resolve => setTimeout(resolve, 500));

        const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
        const matchTitle = prompt('Nombre para guardar esta grabación:', `Partido ${new Date().toLocaleDateString('es-ES')} - ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`) || 'Partido de Fútbol';

        const thumbnail = this.generateThumbnail();

        const matchRecord = {
            id: 'match_' + Date.now(),
            title: matchTitle,
            createdAt: Date.now(),
            duration: Math.floor((Date.now() - this.recordStartTime) / 1000),
            videoBlob: blob,
            thumbnail: thumbnail,
            stats: JSON.parse(JSON.stringify(this.aiTracker.stats)),
            highlights: JSON.parse(JSON.stringify(this.aiTracker.highlights))
        };

        await this.db.saveMatch(matchRecord);
        this.currentMatchData = matchRecord;
        this.showToast('Partido guardado en la biblioteca');

        if (andAnalyze) {
            await this.runAIAnalysisModal();
        }
    },

    generateThumbnail() {
        const video = document.getElementById('main-video');
        const c = document.createElement('canvas');
        c.width = 320;
        c.height = 180;
        const ctx = c.getContext('2d');
        try {
            ctx.drawImage(video, 0, 0, 320, 180);
            return c.toDataURL('image/jpeg', 0.7);
        } catch (e) {
            return '';
        }
    },

    async runAIAnalysisModal() {
        const modal = document.getElementById('analysis-modal');
        const progressBar = document.getElementById('analysis-progress-bar');
        const progressText = document.getElementById('analysis-progress-text');
        const statusMsg = document.getElementById('analysis-status-message');

        modal.classList.remove('hidden');
        progressBar.style.width = '0%';

        const messages = [
            'Rastreando jugadores y siluetas...',
            'Calculando trayectorias y pases...',
            'Filtrando intercepciones y quites...',
            'Identificando tiros al arco y ocasiones...',
            'Generando reporte táctico final...'
        ];

        let msgIdx = 0;
        const msgInterval = setInterval(() => {
            msgIdx = (msgIdx + 1) % messages.length;
            statusMsg.innerText = messages[msgIdx];
        }, 1200);

        const result = await this.aiTracker.analyzeFullVideo((progress) => {
            progressBar.style.width = `${progress}%`;
            progressText.innerText = `${progress}%`;
        });

        clearInterval(msgInterval);

        if (this.currentMatchData) {
            this.currentMatchData.stats = result.stats;
            this.currentMatchData.highlights = result.highlights;
            await this.db.saveMatch(this.currentMatchData);
        }

        setTimeout(() => {
            modal.classList.add('hidden');
            this.showToast('¡Análisis de IA completado!');
            this.renderStats(this.aiTracker.stats);
            this.renderHighlights(this.aiTracker.highlights);
        }, 400);
    },

    // 7. RENDERIZADO DE ESTADÍSTICAS Y MARCADOR DE GOLES
    renderStats(stats) {
        // Marcador de Goles
        const goalsA = document.getElementById('stat-a-goals');
        const goalsB = document.getElementById('stat-b-goals');
        if (goalsA) goalsA.innerText = stats.teamA.goles || 0;
        if (goalsB) goalsB.innerText = stats.teamB.goles || 0;

        // Pases y Jugadas
        document.getElementById('stat-a-passes-comp').innerText = stats.teamA.pasesConcretados;
        document.getElementById('stat-a-passes-miss').innerText = stats.teamA.pasesFallados;
        document.getElementById('stat-a-intercept').innerText = stats.teamA.intercepciones;
        document.getElementById('stat-a-shots').innerText = stats.teamA.tirosAlArco;
        document.getElementById('stat-a-steals').innerText = stats.teamA.robosBalon;
        document.getElementById('stat-a-pos').innerText = `${stats.teamA.posesionPorcentaje}%`;

        document.getElementById('stat-b-passes-comp').innerText = stats.teamB.pasesConcretados;
        document.getElementById('stat-b-passes-miss').innerText = stats.teamB.pasesFallados;
        document.getElementById('stat-b-intercept').innerText = stats.teamB.intercepciones;
        document.getElementById('stat-b-shots').innerText = stats.teamB.tirosAlArco;
        document.getElementById('stat-b-steals').innerText = stats.teamB.robosBalon;
        document.getElementById('stat-b-pos').innerText = `${stats.teamB.posesionPorcentaje}%`;

        const posBarA = document.getElementById('bar-pos-a');
        if (posBarA) posBarA.style.width = `${stats.teamA.posesionPorcentaje}%`;
    },

    // 8. MEJORES MOMENTOS CON GOLES Y ASISTENCIAS DESTACADAS
    setupHighlightFilters() {
        const filterBtns = document.querySelectorAll('[data-hl-filter]');
        filterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                filterBtns.forEach(b => b.classList.remove('bg-emerald-600', 'text-white'));
                btn.classList.add('bg-emerald-600', 'text-white');
                this.currentHighlightFilter = btn.getAttribute('data-hl-filter');
                this.renderHighlights(this.aiTracker.highlights);
            });
        });
    },

    renderHighlights(highlights) {
        const container = document.getElementById('highlights-container');
        if (!container) return;

        const filtered = highlights.filter(hl => {
            if (this.currentHighlightFilter === 'todos') return true;
            return hl.type === this.currentHighlightFilter;
        });

        if (filtered.length === 0) {
            container.innerHTML = `
                <div class="p-6 text-center text-slate-400">
                    <i data-lucide="sparkles" class="w-8 h-8 mx-auto mb-2 text-slate-500 opacity-60"></i>
                    <p class="text-sm">Analizando para registrar momentos destacados y goles...</p>
                </div>
            `;
            if (window.lucide) lucide.createIcons();
            return;
        }

        container.innerHTML = filtered.map(hl => {
            const timeStr = this.formatTime(hl.timestamp);
            const isGoal = hl.type === 'gol';
            const teamBadge = hl.team === 'A' ? '<span class="px-2 py-0.5 text-xs bg-blue-600 text-white rounded">Azul</span>' : '<span class="px-2 py-0.5 text-xs bg-red-600 text-white rounded">Rojo</span>';

            const bgClass = isGoal ? 'bg-amber-950/40 border-amber-500/60' : 'bg-slate-800/90 border-slate-700/60';
            const iconName = isGoal ? 'trophy' : (hl.type === 'tiro_arco' ? 'target' : (hl.type === 'intercepcion' ? 'shield' : 'activity'));

            return `
                <div class="p-3 ${bgClass} hover:border-emerald-500 border rounded-xl transition cursor-pointer flex items-center justify-between group" onclick="App.jumpToHighlight(${hl.timestamp}, '${hl.title.replace(/'/g, "\\'")}')">
                    <div class="flex items-center space-x-3">
                        <div class="w-10 h-10 rounded-lg flex items-center justify-center ${isGoal ? 'bg-amber-500 text-slate-950 font-black' : 'bg-emerald-500/20 text-emerald-400'}">
                            <i data-lucide="${iconName}" class="w-5 h-5"></i>
                        </div>
                        <div>
                            <div class="flex items-center space-x-2">
                                <h4 class="text-sm font-semibold text-white group-hover:text-emerald-400 transition">${hl.title}</h4>
                                ${teamBadge}
                            </div>
                            <p class="text-xs text-slate-400 mt-0.5">${hl.description}</p>
                        </div>
                    </div>
                    <div class="text-right flex-shrink-0 ml-3">
                        <span class="inline-flex items-center text-xs font-mono font-medium text-emerald-400 bg-emerald-950/60 px-2.5 py-1 rounded-md border border-emerald-800/40">
                            ▶ ${timeStr}
                        </span>
                    </div>
                </div>
            `;
        }).join('');

        if (window.lucide) lucide.createIcons();
    },

    jumpToHighlight(timestamp, title) {
        const video = document.getElementById('main-video');
        video.currentTime = Math.max(0, timestamp);
        video.play();
        this.aiTracker.showAllOverlays();

        const replayIndicator = document.getElementById('replay-indicator');
        const replayTitle = document.getElementById('replay-title');
        if (replayIndicator && replayTitle) {
            replayTitle.innerText = title;
            replayIndicator.classList.remove('hidden');
            setTimeout(() => replayIndicator.classList.add('hidden'), 3500);
        }
        this.showToast(`Momento: ${title}`);
    },

    // 9. PESTAÑA DE VIDEOS GUARDADOS (REPRODUCCIÓN COMPLETA A SU ANTOJO)
    setupSavedVideosTab() {
        const searchInput = document.getElementById('search-saved-videos');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => this.loadSavedVideosList(e.target.value));
        }
    },

    async loadSavedVideosList(query = '') {
        const container = document.getElementById('saved-videos-list');
        if (!container) return;

        const matches = await this.db.getAllMatches();
        const filtered = matches.filter(m => {
            if (!query) return true;
            return m.title.toLowerCase().includes(query.toLowerCase());
        });

        if (filtered.length === 0) {
            container.innerHTML = `
                <div class="col-span-full py-12 text-center text-slate-400">
                    <i data-lucide="video-off" class="w-12 h-12 mx-auto mb-3 text-slate-500 opacity-60"></i>
                    <p class="text-base font-medium">No se encontraron videos grabados</p>
                    <p class="text-xs text-slate-500 mt-1">Graba un partido o sube un video para analizarlo y guardarlo aquí.</p>
                </div>
            `;
            if (window.lucide) lucide.createIcons();
            return;
        }

        container.innerHTML = filtered.map(m => {
            const dateStr = new Date(m.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            const totalPasses = (m.stats.teamA.pasesConcretados || 0) + (m.stats.teamB.pasesConcretados || 0);
            const totalShots = (m.stats.teamA.tirosAlArco || 0) + (m.stats.teamB.tirosAlArco || 0);
            const scoreText = `${m.stats.teamA.goles || 0} - ${m.stats.teamB.goles || 0}`;

            return `
                <div class="bg-slate-800/90 border border-slate-700/70 rounded-2xl overflow-hidden hover:border-emerald-500/50 transition flex flex-col justify-between shadow-lg">
                    <div class="relative bg-slate-900 aspect-video flex items-center justify-center overflow-hidden">
                        ${m.thumbnail ? `<img src="${m.thumbnail}" class="w-full h-full object-cover" alt="Miniatura">` : `<i data-lucide="film" class="w-12 h-12 text-slate-600"></i>`}
                        <div class="absolute top-2 left-2 bg-black/80 px-2.5 py-1 rounded-md text-xs font-black text-amber-400 border border-amber-500/40">
                            ⚽ Goles: ${scoreText}
                        </div>
                        <div class="absolute bottom-2 right-2 bg-black/75 backdrop-blur px-2 py-0.5 rounded text-xs font-mono text-white">
                            ⏱ ${this.formatDuration(m.duration || 0)}
                        </div>
                    </div>

                    <div class="p-4 flex-1 flex flex-col justify-between">
                        <div>
                            <h3 class="font-bold text-white text-base leading-tight">${m.title}</h3>
                            <p class="text-xs text-slate-400 mt-1">${dateStr}</p>

                            <div class="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-700/60 text-center">
                                <div class="bg-slate-900/60 p-1.5 rounded-lg">
                                    <div class="text-[11px] text-slate-400">Pases Concretados</div>
                                    <div class="text-sm font-bold text-blue-400">${totalPasses}</div>
                                </div>
                                <div class="bg-slate-900/60 p-1.5 rounded-lg">
                                    <div class="text-[11px] text-slate-400">Tiros al Arco</div>
                                    <div class="text-sm font-bold text-amber-400">${totalShots}</div>
                                </div>
                            </div>
                        </div>

                        <!-- Acciones -->
                        <div class="mt-4 pt-3 border-t border-slate-700/60 flex items-center justify-between gap-2">
                            <button onclick="App.openSavedMatch('${m.id}')" class="flex-1 inline-flex items-center justify-center space-x-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition">
                                <i data-lucide="play" class="w-3.5 h-3.5"></i>
                                <span>Reproducir Video</span>
                            </button>
                            <button onclick="App.downloadMatchVideo('${m.id}')" title="Descargar Video" class="p-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition">
                                <i data-lucide="download" class="w-4 h-4"></i>
                            </button>
                            <button onclick="App.exportMatchReport('${m.id}')" title="Exportar Reporte JSON" class="p-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition">
                                <i data-lucide="file-text" class="w-4 h-4"></i>
                            </button>
                            <button onclick="App.deleteSavedMatch('${m.id}')" title="Eliminar" class="p-2 bg-red-950/60 hover:bg-red-800 text-red-300 rounded-lg transition">
                                <i data-lucide="trash-2" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        if (window.lucide) lucide.createIcons();
    },

    async openSavedMatch(matchId) {
        const matches = await this.db.getAllMatches();
        const match = matches.find(m => m.id === matchId);
        if (!match) return;

        this.currentMatchData = match;
        this.switchTab('video');

        const video = document.getElementById('main-video');
        if (match.videoBlob) {
            const url = URL.createObjectURL(match.videoBlob);
            video.srcObject = null;
            video.src = url;
            video.load();
            video.play();
        }

        this.aiTracker.stats = match.stats || this.aiTracker.stats;
        this.aiTracker.highlights = match.highlights || [];
        this.renderStats(this.aiTracker.stats);
        this.renderHighlights(this.aiTracker.highlights);

        document.getElementById('video-source-badge').innerText = `Guardado: ${match.title}`;
        this.showToast(`Cargado: ${match.title}. Puedes moverlo con el timeline, retroceder y avanzar libremente.`);
    },

    async downloadMatchVideo(matchId) {
        const matches = await this.db.getAllMatches();
        const match = matches.find(m => m.id === matchId);
        if (!match || !match.videoBlob) {
            this.showToast('No hay video disponible para descargar', 'warning');
            return;
        }

        const url = URL.createObjectURL(match.videoBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${match.title.replace(/[\s\W]+/g, '_')}.webm`;
        a.click();
        URL.revokeObjectURL(url);
    },

    async exportMatchReport(matchId) {
        const matches = await this.db.getAllMatches();
        const match = matches.find(m => m.id === matchId);
        if (!match) return;

        const reportData = {
            titulo: match.title,
            fecha: new Date(match.createdAt).toISOString(),
            duracionSegundos: match.duration,
            estadisticas: match.stats,
            mejoresMomentos: match.highlights
        };

        const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Reporte_${match.title.replace(/[\s\W]+/g, '_')}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('Reporte exportado en formato JSON');
    },

    async deleteSavedMatch(matchId) {
        if (!confirm('¿Seguro que deseas eliminar este partido guardado?')) return;
        await this.db.deleteMatch(matchId);
        this.showToast('Partido eliminado');
        this.loadSavedVideosList();
    },

    // 10. FORMULARIO DE EVALUACIÓN CONECTADO DIRECTAMENTE A GOOGLE SHEETS
    // Ya NO pide enlace de Google Sheet, envía directamente al Webhook configurado
    setupFeedbackForm() {
        const form = document.getElementById('feedback-form');

        // Manejo de estrellas
        document.querySelectorAll('.star-rating-group').forEach(group => {
            const stars = group.querySelectorAll('.star-btn');
            const hiddenInput = group.querySelector('input[type="hidden"]');

            stars.forEach((star, index) => {
                star.addEventListener('click', () => {
                    const rating = index + 1;
                    hiddenInput.value = rating;
                    stars.forEach((s, idx) => {
                        if (idx < rating) {
                            s.classList.add('text-amber-400', 'fill-amber-400');
                            s.classList.remove('text-slate-600');
                        } else {
                            s.classList.remove('text-amber-400', 'fill-amber-400');
                            s.classList.add('text-slate-600');
                        }
                    });
                });
            });
        });

        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.handleFeedbackSubmit(form);
            });
        }
    },

    async handleFeedbackSubmit(form) {
        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i data-lucide="loader" class="w-5 h-5 animate-spin"></i><span>Guardando en Google Sheet...</span>';
        if (window.lucide) lucide.createIcons();

        const formData = {
            id: 'fb_' + Date.now(),
            createdAt: Date.now(),
            fecha: new Date().toLocaleString('es-ES'),
            nombre: form.nombre.value.trim() || 'Anónimo',
            rol: form.rol.value,
            fluidezVideo: parseInt(form.rating_fluidez.value) || 5,
            precisionIA: parseInt(form.rating_ia.value) || 5,
            mejoresMomentos: parseInt(form.rating_highlights.value) || 5,
            experienciaMovilPC: parseInt(form.rating_usabilidad.value) || 5,
            comentarios: form.comentarios.value.trim()
        };

        // 1. Guardar en base de datos local
        await this.db.saveFeedback(formData);

        // 2. Enviar directamente al Google Sheet Webhook del usuario
        try {
            await fetch(GOOGLE_SHEETS_WEBHOOK_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            this.showToast('¡Evaluación guardada exitosamente en tu Google Sheet!');
        } catch (err) {
            console.error('Error enviando a Google Sheets:', err);
            this.showToast('Evaluación guardada en el historial local.');
        }

        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
        if (window.lucide) lucide.createIcons();

        form.reset();
        document.querySelectorAll('.star-btn').forEach(s => s.classList.replace('text-amber-400', 'text-slate-600'));
        this.loadFeedbackHistory();
    },

    async loadFeedbackHistory() {
        const container = document.getElementById('feedback-history-list');
        if (!container) return;

        const list = await this.db.getAllFeedback();
        if (list.length === 0) {
            container.innerHTML = `
                <div class="py-6 text-center text-slate-400 text-xs">
                    No hay evaluaciones registradas aún.
                </div>
            `;
            return;
        }

        container.innerHTML = list.map(item => `
            <div class="p-3 bg-slate-800/80 border border-slate-700/60 rounded-xl flex items-center justify-between">
                <div>
                    <div class="flex items-center space-x-2">
                        <span class="font-semibold text-white text-sm">${item.nombre}</span>
                        <span class="text-xs px-2 py-0.5 bg-slate-700 text-slate-300 rounded">${item.rol}</span>
                    </div>
                    <p class="text-xs text-slate-400 mt-1">"${item.comentarios || 'Sin comentarios'}"</p>
                </div>
                <div class="text-right">
                    <div class="text-amber-400 text-xs font-bold">★ ${Math.round((item.fluidezVideo + item.precisionIA + item.mejoresMomentos + item.experienciaMovilPC) / 4)}/5</div>
                    <div class="text-[10px] text-slate-500 mt-0.5">${item.fecha}</div>
                </div>
            </div>
        `).join('');
    },

    // UTILIDADES
    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '00:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    },

    formatDuration(seconds) {
        if (!seconds || isNaN(seconds)) return '0m 0s';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}m ${s}s`;
    },

    showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        const toastMsg = document.getElementById('toast-message');
        if (!toast || !toastMsg) return;

        toastMsg.innerText = message;
        toast.className = `fixed bottom-5 right-5 z-50 flex items-center space-x-2 px-4 py-3 rounded-xl shadow-2xl transition-all duration-300 text-sm font-medium ${
            type === 'error' ? 'bg-red-600 text-white' : (type === 'warning' ? 'bg-amber-600 text-white' : 'bg-emerald-600 text-white')
        }`;
        toast.classList.remove('translate-y-20', 'opacity-0');

        setTimeout(() => {
            toast.classList.add('translate-y-20', 'opacity-0');
        }, 3200);
    }
};

window.App = App;
window.addEventListener('DOMContentLoaded', () => App.init());
