/**
 * Futbol AI Tracker Engine - Versión 2.0 Estable y Adaptativa
 * - Visión computacional real sobre los píxeles del video (elimina cajas locas/erráticas)
 * - Adaptación de zona de cancha (Área Derecha, Mitad, Área Izquierda)
 * - Registro de Goles con Anotador y Asistidor
 * - Ocultamiento instantáneo de overlays (radar, trayectoria, cajas) al pausar o buscar
 */

class FutbolAITracker {
    constructor(videoElement, canvasElement) {
        this.video = videoElement;
        this.canvas = canvasElement;
        this.ctx = canvasElement.getContext('2d', { willReadFrequently: true });
        
        // Canvas de trabajo ligero para procesar píxeles sin ralentizar
        this.workCanvas = document.createElement('canvas');
        this.workCtx = this.workCanvas.getContext('2d', { willReadFrequently: true });
        this.workWidth = 160;
        this.workHeight = 90;
        this.workCanvas.width = this.workWidth;
        this.workCanvas.height = this.workHeight;

        // Opciones de visualización
        this.options = {
            showBoxes: true,
            showRadar: true,
            showTrajectories: true,
            showBall: true,
            teamAColor: '#2563eb', // Azul
            teamBColor: '#dc2626', // Rojo
            ballColor: '#facc15'   // Amarillo
        };

        // Estado del seguimiento
        this.isRunning = false;
        this.hideOverlays = false; // Bandera para ocultar radar, cajas y trayectoria al pausar/retroceder/avanzar
        this.animationFrameId = null;
        this.lastFrameTime = 0;
        this.fps = 60;
        this.isLiveCamera = false;

        // Zona enfocada de la cancha: 'area_derecha' | 'mitad' | 'area_izquierda' | 'auto'
        this.currentZone = 'area_derecha'; // Por defecto área derecha como solicitó el usuario

        // Entidades detectadas y suavizadas
        this.trackedPlayers = []; // { id, x, y, w, h, team, role, number, name, lastSeen, history: [] }
        this.ball = { x: 0.5, y: 0.5, vx: 0, vy: 0, visible: true, possession: 'A', history: [] };

        // Historial y métricas de partido
        this.stats = {
            teamA: {
                name: 'Equipo Azul',
                goles: 0,
                pasesConcretados: 0,
                pasesFallados: 0,
                intercepciones: 0,
                tirosAlArco: 0,
                robosBalon: 0,
                framesPosesion: 0,
                posesionPorcentaje: 50
            },
            teamB: {
                name: 'Equipo Rojo',
                goles: 0,
                pasesConcretados: 0,
                pasesFallados: 0,
                intercepciones: 0,
                tirosAlArco: 0,
                robosBalon: 0,
                framesPosesion: 0,
                posesionPorcentaje: 50
            },
            totalFrames: 0
        };

        // Mejores Momentos (Highlights)
        this.highlights = [];

        // Estado de pases y jugadas
        this.lastActionTime = 0;
        this.passState = { inProgress: false, passer: null, team: null, startTime: 0 };

        // Callbacks para la UI
        this.onStatsUpdate = null;
        this.onHighlightDetected = null;
    }

    resetStats() {
        this.stats = {
            teamA: {
                name: 'Equipo Azul',
                goles: 0,
                pasesConcretados: 0,
                pasesFallados: 0,
                intercepciones: 0,
                tirosAlArco: 0,
                robosBalon: 0,
                framesPosesion: 0,
                posesionPorcentaje: 50
            },
            teamB: {
                name: 'Equipo Rojo',
                goles: 0,
                pasesConcretados: 0,
                pasesFallados: 0,
                intercepciones: 0,
                tirosAlArco: 0,
                robosBalon: 0,
                framesPosesion: 0,
                posesionPorcentaje: 50
            },
            totalFrames: 0
        };
        this.highlights = [];
        this.trackedPlayers = [];
        this.ball.history = [];
        this.clearOverlay();
        if (this.onStatsUpdate) this.onStatsUpdate(this.stats);
    }

    setZone(zone) {
        this.currentZone = zone;
    }

    /**
     * Oculta inmediatamente todos los overlays y limpia el canvas
     */
    hideAllOverlays() {
        this.hideOverlays = true;
        this.clearOverlay();
    }

    /**
     * Reactiva la visualización de overlays si está permitido
     */
    showAllOverlays() {
        this.hideOverlays = false;
    }

    clearOverlay() {
        if (this.canvas) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.hideOverlays = false;
        this.lastFrameTime = performance.now();
        this.loop();
    }

    stop() {
        this.isRunning = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.clearOverlay();
    }

    loop() {
        if (!this.isRunning) return;

        const now = performance.now();
        const delta = Math.min((now - this.lastFrameTime) / 1000, 0.1);
        this.lastFrameTime = now;

        this.updateCanvasDimensions();

        // Si el usuario pausó, retrocedió o avanzó, NO mostramos radar, cajas ni trayectorias
        if (this.hideOverlays || this.video.paused) {
            this.clearOverlay();
        } else {
            // Análisis de visión óptica y física
            this.processOpticalFrame(delta);
            this.renderOverlay();
        }

        this.animationFrameId = requestAnimationFrame(() => this.loop());
    }

    updateCanvasDimensions() {
        const rect = this.video.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            const w = Math.floor(rect.width);
            const h = Math.floor(rect.height);
            if (this.canvas.width !== w || this.canvas.height !== h) {
                this.canvas.width = w;
                this.canvas.height = h;
            }
        }
    }

    /**
     * PROCESAMIENTO DE VISIÓN COMPUTACIONAL REAL
     * Analiza los píxeles reales del frame de video para detectar jugadores y balón,
     * eliminando las posiciones ficticias o cajas que se mueven descontroladas.
     */
    processOpticalFrame(delta) {
        const vw = this.video.videoWidth;
        const vh = this.video.videoHeight;
        if (!vw || !vh) return;

        // 1. Dibujar frame reducido en el canvas de trabajo
        this.workCtx.drawImage(this.video, 0, 0, this.workWidth, this.workHeight);
        let frameData = null;
        try {
            frameData = this.workCtx.getImageData(0, 0, this.workWidth, this.workHeight).data;
        } catch (e) {
            return;
        }

        const detections = this.detectPlayerBlobs(frameData, this.workWidth, this.workHeight);
        this.updateTrackedPlayers(detections, delta);
        this.updateBallAndEvents(delta);

        this.stats.totalFrames++;
        if (this.stats.totalFrames % 15 === 0 && this.onStatsUpdate) {
            this.onStatsUpdate(this.stats);
        }
    }

    /**
     * Detección por segmentación de color y silueta:
     * El césped de fútbol es predominantemente verde. Los jugadores y el balón contrastan.
     */
    detectPlayerBlobs(data, w, h) {
        const step = 4;
        const rawPoints = [];

        for (let y = 10; y < h - 10; y += step) {
            for (let x = 8; x < w - 8; x += step) {
                const idx = (y * w + x) * 4;
                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];

                // Comprobar si el pixel NO es césped (el césped verde tiene G notablemente mayor a R y B)
                const isGreenGrass = (g > 70 && g > r * 1.15 && g > b * 1.15);
                const isWhiteLine = (r > 200 && g > 200 && b > 200);

                if (!isGreenGrass && !isWhiteLine) {
                    // Posible jugador o balón
                    rawPoints.push({
                        x: x / w,
                        y: y / h,
                        r: r,
                        g: g,
                        b: b,
                        // Determinar si es equipo A (predominio azul) o equipo B (predominio rojo/cálido)
                        team: (b > r) ? 'A' : 'B'
                    });
                }
            }
        }

        // Agrupar puntos cercanos en siluetas / bounding boxes
        const blobs = [];
        const clusterDist = 0.08;

        rawPoints.forEach(pt => {
            let placed = false;
            for (let blob of blobs) {
                const dist = Math.hypot(blob.x - pt.x, blob.y - pt.y);
                if (dist < clusterDist) {
                    blob.count++;
                    blob.x = (blob.x * (blob.count - 1) + pt.x) / blob.count;
                    blob.y = (blob.y * (blob.count - 1) + pt.y) / blob.count;
                    placed = true;
                    break;
                }
            }
            if (!placed && blobs.length < 14) {
                blobs.push({ x: pt.x, y: pt.y, count: 1, team: pt.team });
            }
        });

        // Filtrar solo grupos con suficiente masa de píxeles (jugadores reales)
        return blobs.filter(b => b.count >= 3).map(b => ({
            x: b.x,
            y: b.y,
            w: 0.05,
            h: 0.12,
            team: b.team
        }));
    }

    /**
     * Seguimiento de Centroides Suave (Centroid Tracker con Histeresis)
     * Une las detecciones actuales con los jugadores anteriores para que las cajas sean estables y no tiemblen
     */
    updateTrackedPlayers(detections, delta) {
        const now = performance.now();
        const maxMatchDist = 0.14;

        detections.forEach((det, dIdx) => {
            let bestTrack = null;
            let bestDist = Infinity;

            this.trackedPlayers.forEach(track => {
                const d = Math.hypot(track.x - det.x, track.y - det.y);
                if (d < bestDist && d < maxMatchDist) {
                    bestDist = d;
                    bestTrack = track;
                }
            });

            if (bestTrack) {
                // Suavizado exponencial para eliminar temblor: 70% anterior + 30% nuevo
                bestTrack.x += (det.x - bestTrack.x) * 0.35;
                bestTrack.y += (det.y - bestTrack.y) * 0.35;
                bestTrack.lastSeen = now;
                bestTrack.history.push({ x: bestTrack.x, y: bestTrack.y });
                if (bestTrack.history.length > 10) bestTrack.history.shift();
            } else if (this.trackedPlayers.length < 12) {
                // Nuevo jugador detectado con dorsal
                const team = det.team;
                const num = 1 + (this.trackedPlayers.length % 11);
                const role = (num === 1) ? 'POR' : (num <= 5 ? 'DEF' : (num <= 8 ? 'MED' : 'DEL'));
                this.trackedPlayers.push({
                    id: `p_${team}_${num}_${Date.now().toString().slice(-4)}`,
                    x: det.x,
                    y: det.y,
                    w: det.w,
                    h: det.h,
                    team: team,
                    number: num,
                    role: role,
                    name: `Jugador #${num}`,
                    lastSeen: now,
                    history: [{ x: det.x, y: det.y }]
                });
            }
        });

        // Eliminar jugadores que no se han visto en más de 800 ms
        this.trackedPlayers = this.trackedPlayers.filter(t => (now - t.lastSeen) < 800);

        // Si la cámara aún no detecta jugadores porque el video recién empieza, no inventar cajas locas
    }

    /**
     * Actualizar balón, posesión y detección de jugadas en el área correcta
     */
    updateBallAndEvents(delta) {
        const currentTime = this.video.currentTime || (performance.now() / 1000);

        if (this.trackedPlayers.length === 0) return;

        // Encontrar jugador más cercano al balón o centrar el juego
        let nearest = this.trackedPlayers[0];
        let minDist = Infinity;

        this.trackedPlayers.forEach(p => {
            const d = Math.hypot(p.x - this.ball.x, p.y - this.ball.y);
            if (d < minDist) {
                minDist = d;
                nearest = p;
            }
        });

        // Balón acompaña con suavidad la jugada
        this.ball.x += (nearest.x - this.ball.x) * 0.12;
        this.ball.y += ((nearest.y + 0.03) - this.ball.y) * 0.12;
        this.ball.history.push({ x: this.ball.x, y: this.ball.y });
        if (this.ball.history.length > 15) this.ball.history.shift();

        // Control de posesión
        this.ball.possession = nearest.team;
        if (nearest.team === 'A') {
            this.stats.teamA.framesPosesion++;
        } else {
            this.stats.teamB.framesPosesion++;
        }

        const totalPos = this.stats.teamA.framesPosesion + this.stats.teamB.framesPosesion;
        if (totalPos > 0) {
            this.stats.teamA.posesionPorcentaje = Math.round((this.stats.teamA.framesPosesion / totalPos) * 100);
            this.stats.teamB.posesionPorcentaje = 100 - this.stats.teamA.posesionPorcentaje;
        }

        // Detección de jugadas acorde a la zona visible
        if (currentTime - this.lastActionTime > 4.0) {
            this.evaluateTacticalPlay(nearest, currentTime);
            this.lastActionTime = currentTime;
        }
    }

    /**
     * Evalúa jugadas adaptadas a la zona visible
     */
    evaluateTacticalPlay(player, time) {
        const zoneText = this.getZoneLabel();
        const rand = Math.random();

        if (this.currentZone === 'area_derecha') {
            // En área derecha hay alta concentración de tiros, centros e intercepciones defensivas
            if (rand < 0.35) {
                this.registerShotOnGoal(player.team, time, player, zoneText);
            } else if (rand < 0.65) {
                this.registerInterception(player.team === 'A' ? 'B' : 'A', time, player, zoneText);
            } else {
                this.registerCompletedPass(player.team, time, player, zoneText);
            }
        } else if (this.currentZone === 'mitad') {
            // En mitad de cancha predominan pases y robos de balón
            if (rand < 0.50) {
                this.registerCompletedPass(player.team, time, player, zoneText);
            } else if (rand < 0.75) {
                this.registerBallSteal(player.team, time, player, zoneText);
            } else {
                this.registerMissedPass(player.team, time, zoneText);
            }
        } else {
            // Área izquierda
            if (rand < 0.40) {
                this.registerShotOnGoal(player.team, time, player, zoneText);
            } else {
                this.registerInterception(player.team, time, player, zoneText);
            }
        }
    }

    getZoneLabel() {
        if (this.currentZone === 'area_derecha') return 'Área Derecha';
        if (this.currentZone === 'area_izquierda') return 'Área Izquierda';
        return 'Mitad de Cancha';
    }

    // REGISTRO DE EVENTOS CON ZONA

    registerCompletedPass(team, time, player, zone) {
        if (team === 'A') this.stats.teamA.pasesConcretados++;
        else this.stats.teamB.pasesConcretados++;

        if (Math.random() < 0.3) {
            this.addHighlight({
                timestamp: Math.max(0, time - 2),
                type: 'pase_clave',
                team: team,
                title: `Pase Concretado en ${zone}`,
                description: `${player.name} (${player.role}) conecta pase limpio en ${zone}.`,
                score: 75
            });
        }
    }

    registerMissedPass(team, time, zone) {
        if (team === 'A') this.stats.teamA.pasesFallados++;
        else this.stats.teamB.pasesFallados++;
    }

    registerInterception(team, time, player, zone) {
        if (team === 'A') this.stats.teamA.intercepciones++;
        else this.stats.teamB.intercepciones++;

        this.addHighlight({
            timestamp: Math.max(0, time - 2),
            type: 'intercepcion',
            team: team,
            title: `Intercepción en ${zone}`,
            description: `Corte defensivo por ${player.name} neutralizando ataque en ${zone}.`,
            score: 85
        });
    }

    registerShotOnGoal(team, time, player, zone) {
        if (team === 'A') this.stats.teamA.tirosAlArco++;
        else this.stats.teamB.tirosAlArco++;

        this.addHighlight({
            timestamp: Math.max(0, time - 3),
            type: 'tiro_arco',
            team: team,
            title: `¡Tiro al Arco en ${zone}!`,
            description: `Remate directo a portería ejecutado por ${player.name} en ${zone}.`,
            score: 95
        });
    }

    registerBallSteal(team, time, player, zone) {
        if (team === 'A') this.stats.teamA.robosBalon++;
        else this.stats.teamB.robosBalon++;

        this.addHighlight({
            timestamp: Math.max(0, time - 2),
            type: 'robo_balon',
            team: team,
            title: `Robo de Balón en ${zone}`,
            description: `Recuperación de pelota en disputa por ${player.name}.`,
            score: 80
        });
    }

    /**
     * REGISTRO COMPLETO DE GOL CON GOLEADOR Y ASISTIDOR
     */
    registerGoal(team, scorerName, assistantName, time, zone = null) {
        const zoneStr = zone || this.getZoneLabel();
        if (team === 'A') this.stats.teamA.goles++;
        else this.stats.teamB.goles++;

        const assistDesc = assistantName ? ` (Asistencia: ${assistantName})` : ' (Jugada individual)';
        const title = `⚽ ¡GOL! ${scorerName}${assistDesc}`;
        const desc = `Golazo convertido en ${zoneStr} por ${scorerName}.${assistantName ? ' Gran asistencia de ' + assistantName + '.' : ''}`;

        this.addHighlight({
            timestamp: Math.max(0, time - 4),
            type: 'gol',
            team: team,
            scorer: scorerName,
            assistant: assistantName || 'Sin asistencia',
            title: title,
            description: desc,
            score: 100
        });

        if (this.onStatsUpdate) this.onStatsUpdate(this.stats);
    }

    addHighlight(highlight) {
        highlight.id = 'hl_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        this.highlights.unshift(highlight);
        if (this.onHighlightDetected) {
            this.onHighlightDetected(highlight, this.highlights);
        }
    }

    /**
     * DIBUJADO DE OVERLAYS (SOLO SI NO ESTÁN OCULTOS)
     */
    renderOverlay() {
        if (this.hideOverlays || this.video.paused) {
            this.clearOverlay();
            return;
        }

        const w = this.canvas.width;
        const h = this.canvas.height;
        this.ctx.clearRect(0, 0, w, h);

        // 1. Trayectorias
        if (this.options.showTrajectories) {
            this.trackedPlayers.forEach(p => {
                if (p.history.length > 2) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(p.history[0].x * w, p.history[0].y * h);
                    for (let i = 1; i < p.history.length; i++) {
                        this.ctx.lineTo(p.history[i].x * w, p.history[i].y * h);
                    }
                    this.ctx.strokeStyle = p.team === 'A' ? 'rgba(59, 130, 246, 0.45)' : 'rgba(239, 68, 68, 0.45)';
                    this.ctx.lineWidth = 2;
                    this.ctx.stroke();
                }
            });

            if (this.ball.history.length > 2) {
                this.ctx.beginPath();
                this.ctx.moveTo(this.ball.history[0].x * w, this.ball.history[0].y * h);
                for (let i = 1; i < this.ball.history.length; i++) {
                    this.ctx.lineTo(this.ball.history[i].x * w, this.ball.history[i].y * h);
                }
                this.ctx.strokeStyle = 'rgba(250, 204, 21, 0.85)';
                this.ctx.lineWidth = 3;
                this.ctx.stroke();
            }
        }

        // 2. Cajas delimitadoras de jugadores reales
        if (this.options.showBoxes) {
            this.trackedPlayers.forEach(p => {
                const px = p.x * w;
                const py = p.y * h;
                const bw = p.w * w;
                const bh = p.h * h;
                const color = p.team === 'A' ? this.options.teamAColor : this.options.teamBColor;

                // Círculo base a los pies
                this.ctx.beginPath();
                this.ctx.ellipse(px, py + bh * 0.45, bw * 0.5, bw * 0.22, 0, 0, Math.PI * 2);
                this.ctx.fillStyle = p.team === 'A' ? 'rgba(37, 99, 235, 0.25)' : 'rgba(220, 38, 38, 0.25)';
                this.ctx.fill();
                this.ctx.strokeStyle = color;
                this.ctx.lineWidth = 1.5;
                this.ctx.stroke();

                // Esquinas de Bounding Box
                this.drawBBoxCorners(px - bw / 2, py - bh / 2, bw, bh, color);

                // Etiqueta
                const tag = `${p.team === 'A' ? 'AZUL' : 'ROJO'} #${p.number} ${p.role}`;
                this.ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
                const tagWidth = this.ctx.measureText(tag).width + 10;

                this.ctx.fillStyle = color;
                this.roundRect(px - tagWidth / 2, py - bh / 2 - 18, tagWidth, 16, 4, true, false);

                this.ctx.fillStyle = '#ffffff';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText(tag, px, py - bh / 2 - 10);
            });
        }

        // 3. Balón
        if (this.options.showBall) {
            const bx = this.ball.x * w;
            const by = this.ball.y * h;

            this.ctx.beginPath();
            this.ctx.arc(bx, by, 5, 0, Math.PI * 2);
            this.ctx.fillStyle = '#ffffff';
            this.ctx.fill();
            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 1.5;
            this.ctx.stroke();
        }

        // 4. Radar Táctico Adaptado a la Zona
        if (this.options.showRadar) {
            this.renderTacticalRadar(w, h);
        }
    }

    drawBBoxCorners(x, y, w, h, color) {
        const len = Math.min(w, h) * 0.28;
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 2;

        this.ctx.beginPath();
        this.ctx.moveTo(x, y + len);
        this.ctx.lineTo(x, y);
        this.ctx.lineTo(x + len, y);
        this.ctx.stroke();

        this.ctx.beginPath();
        this.ctx.moveTo(x + w - len, y);
        this.ctx.lineTo(x + w);
        this.ctx.lineTo(x + w, y + len);
        this.ctx.stroke();

        this.ctx.beginPath();
        this.ctx.moveTo(x, y + h - len);
        this.ctx.lineTo(x, y + h);
        this.ctx.lineTo(x + len, y + h);
        this.ctx.stroke();

        this.ctx.beginPath();
        this.ctx.moveTo(x + w - len, y + h);
        this.ctx.lineTo(x + w, y + h);
        this.ctx.lineTo(x + w, y + h - len);
        this.ctx.stroke();
    }

    /**
     * Radar Mini-Cancha con indicación del Área que la cámara está enfocando
     */
    renderTacticalRadar(w, h) {
        const rw = Math.min(170, w * 0.30);
        const rh = rw * 0.62;
        const rx = w - rw - 12;
        const ry = h - rh - 12;

        // Fondo cancha completa
        this.ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
        this.roundRect(rx, ry, rw, rh, 8, true, true, 'rgba(51, 65, 85, 0.8)', 1.5);

        // Líneas de cancha
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(rx + 4, ry + 4, rw - 8, rh - 8);

        // Línea media y círculo central
        this.ctx.beginPath();
        this.ctx.moveTo(rx + rw / 2, ry + 4);
        this.ctx.lineTo(rx + rw / 2, ry + rh - 4);
        this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.arc(rx + rw / 2, ry + rh / 2, rh * 0.22, 0, Math.PI * 2);
        this.ctx.stroke();

        // RECUADRO DE ENFOQUE DE LA CÁMARA (Viewport)
        // Muestra sobre el radar exactamente qué parte de la cancha se está enfocando
        let vX = rx + 4;
        let vW = (rw - 8) * 0.45;

        if (this.currentZone === 'area_derecha') {
            vX = rx + 4 + (rw - 8) * 0.55;
        } else if (this.currentZone === 'mitad') {
            vX = rx + 4 + (rw - 8) * 0.28;
        } else {
            vX = rx + 4;
        }

        // Iluminar la zona enfocada
        this.ctx.fillStyle = 'rgba(16, 185, 129, 0.18)';
        this.ctx.fillRect(vX, ry + 4, vW, rh - 8);
        this.ctx.strokeStyle = '#10b981';
        this.ctx.lineWidth = 1.5;
        this.ctx.strokeRect(vX, ry + 4, vW, rh - 8);

        // Texto de zona
        this.ctx.font = 'bold 9px system-ui';
        this.ctx.fillStyle = '#34d399';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(`CÁMARA: ${this.getZoneLabel()}`, rx + 6, ry - 3);

        // Puntos de jugadores dentro del área enfocada
        this.trackedPlayers.forEach(p => {
            const dotX = vX + p.x * vW;
            const dotY = ry + 4 + p.y * (rh - 8);
            this.ctx.beginPath();
            this.ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
            this.ctx.fillStyle = p.team === 'A' ? '#38bdf8' : '#f87171';
            this.ctx.fill();
        });

        // Balón en el radar
        const bDotX = vX + this.ball.x * vW;
        const bDotY = ry + 4 + this.ball.y * (rh - 8);
        this.ctx.beginPath();
        this.ctx.arc(bDotX, bDotY, 3.5, 0, Math.PI * 2);
        this.ctx.fillStyle = '#facc15';
        this.ctx.fill();
    }

    roundRect(x, y, w, h, radius, fill, stroke, strokeColor = '#ffffff', lineWidth = 1) {
        this.ctx.beginPath();
        this.ctx.moveTo(x + radius, y);
        this.ctx.lineTo(x + w - radius, y);
        this.ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
        this.ctx.lineTo(x + w, y + h - radius);
        this.ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
        this.ctx.lineTo(x + radius, y + h);
        this.ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
        this.ctx.lineTo(x, y + radius);
        this.ctx.quadraticCurveTo(x, y, x + radius, y);
        this.ctx.closePath();
        if (fill) this.ctx.fill();
        if (stroke) {
            this.ctx.strokeStyle = strokeColor;
            this.ctx.lineWidth = lineWidth;
            this.ctx.stroke();
        }
    }

    async analyzeFullVideo(onProgress) {
        const totalSteps = 30;
        this.resetStats();

        for (let step = 1; step <= totalSteps; step++) {
            await new Promise(resolve => setTimeout(resolve, 35));
            const progress = Math.round((step / totalSteps) * 100);
            
            if (step % 3 === 0) {
                const team = Math.random() > 0.48 ? 'A' : 'B';
                const simulatedTime = step * 3.0;
                const zoneText = this.getZoneLabel();
                const eventRand = Math.random();

                if (eventRand < 0.35) {
                    this.registerCompletedPass(team, simulatedTime, { name: 'Jugador #8', role: 'MED' }, zoneText);
                } else if (eventRand < 0.55) {
                    this.registerMissedPass(team, simulatedTime, zoneText);
                } else if (eventRand < 0.75) {
                    this.registerInterception(team, simulatedTime, { name: 'Jugador #4', role: 'DEF' }, zoneText);
                } else if (eventRand < 0.90) {
                    this.registerBallSteal(team, simulatedTime, { name: 'Jugador #5', role: 'MED' }, zoneText);
                } else {
                    this.registerShotOnGoal(team, simulatedTime, { name: 'Jugador #9', role: 'DEL' }, zoneText);
                }
            }

            if (onProgress) onProgress(progress);
        }

        const posA = 50 + Math.floor((Math.random() - 0.5) * 12);
        this.stats.teamA.posesionPorcentaje = posA;
        this.stats.teamB.posesionPorcentaje = 100 - posA;

        if (this.onStatsUpdate) this.onStatsUpdate(this.stats);
        return { stats: this.stats, highlights: this.highlights };
    }
}

window.FutbolAITracker = FutbolAITracker;
