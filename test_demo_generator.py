import cv2
import numpy as np

def generate_demo_match_video(output_path, duration_seconds=16, fps=45):
    """
    Genera un video sintético de fútbol a 45 FPS con:
    - Campo reglamentario
    - Jugadores de Equipo Azul y Equipo Rojo
    - 1 ÁRBITRO con camiseta amarillo flúor distintiva
    - Pases acertados (línea verde) y un pase erróneo interceptado (línea roja)
    - Conducción, tiro a portería y gol.
    """
    w, h = 1280, 720
    total_frames = int(duration_seconds * fps)
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_path, fourcc, fps, (w, h))

    # Jugadores Equipo A (Azul)
    team_a = [
        {"id": 1, "pos": [180.0, 360.0]},
        {"id": 2, "pos": [360.0, 220.0]},
        {"id": 3, "pos": [380.0, 500.0]},
        {"id": 4, "pos": [520.0, 310.0]},
        {"id": 5, "pos": [680.0, 420.0]},
        {"id": 6, "pos": [720.0, 260.0]}, # Delantero
    ]

    # Jugadores Equipo B (Rojo)
    team_b = [
        {"id": 11, "pos": [1120.0, 360.0]},
        {"id": 12, "pos": [880.0, 290.0]}, # Defensor que interceptará
        {"id": 13, "pos": [900.0, 480.0]},
        {"id": 14, "pos": [760.0, 340.0]},
    ]

    # 1 ÁRBITRO (Camiseta Amarillo Flúor única en la cancha)
    referee = {"pos": [550.0, 440.0]}

    ball_pos = [360.0, 220.0]

    for f in range(total_frames):
        frame = np.zeros((h, w, 3), dtype=np.uint8)
        frame[:] = (35, 120, 45) # Césped

        # Patrón de césped
        for x in range(0, w, 160):
            cv2.rectangle(frame, (x, 0), (x + 80, h), (40, 135, 52), -1)

        # Líneas de campo
        border = 40
        cv2.rectangle(frame, (border, border), (w - border, h - border), (255, 255, 255), 3)
        cv2.line(frame, (w // 2, border), (w // 2, h - border), (255, 255, 255), 3)
        cv2.circle(frame, (w // 2, h // 2), 90, (255, 255, 255), 3)
        cv2.circle(frame, (w // 2, h // 2), 5, (255, 255, 255), -1)

        # Áreas
        area_h, area_w = 320, 180
        cv2.rectangle(frame, (border, (h - area_h) // 2), (border + area_w, (h + area_h) // 2), (255, 255, 255), 3)
        cv2.rectangle(frame, (w - border - area_w, (h - area_h) // 2), (w - border, (h + area_h) // 2), (255, 255, 255), 3)
        # Porterías
        goal_w, goal_h = 30, 160
        cv2.rectangle(frame, (border - goal_w, (h - goal_h) // 2), (border, (h + goal_h) // 2), (200, 200, 200), -1)
        cv2.rectangle(frame, (w - border, (h - goal_h) // 2), (w - border + goal_w, (h + goal_h) // 2), (200, 200, 200), -1)

        # Cinemática de las jugadas a 45 FPS (total_frames = 720)
        # 1. Movimiento del Árbitro (sigue la jugada a cierta distancia)
        referee["pos"][0] += 0.35 * np.cos(f * 0.02)
        referee["pos"][1] += 0.25 * np.sin(f * 0.03)

        # FASE 1 (frames 0-140): Pase Acertado (Jugador Azul 2 a Jugador Azul 4)
        if f < 140:
            a = f / 140.0
            ball_pos = [360.0 + (520 - 360) * a, 220.0 + (310 - 220) * a]

        # FASE 2 (frames 140-270): Pase Erróneo / Interceptado!
        # Jugador 4 intenta pasar hacia el delantero 6 pero el defensor Rojo 12 se cruza y lo intercepta
        elif f < 270:
            a = (f - 140) / 130.0
            # Balón viaja hacia el defensor rojo 12
            ball_pos = [520.0 + (880 - 520) * a, 310.0 + (290 - 310) * a]
            team_b[1]["pos"][0] -= 0.2 # Defensor 12 da un paso al frente

        # FASE 3 (frames 270-380): Conducción del defensor rojo y despeje
        elif f < 380:
            a = (f - 270) / 110.0
            # Defensor rojo sale jugando
            team_b[1]["pos"][0] -= 0.6
            ball_pos = [team_b[1]["pos"][0] - 15, team_b[1]["pos"][1]]

        # FASE 4 (frames 380-500): Recuperación del delantero azul 6 y remate
        elif f < 500:
            a = (f - 380) / 120.0
            # Balón va hacia delantero azul 6
            ball_pos = [team_b[1]["pos"][0] + (740 - team_b[1]["pos"][0]) * a,
                        team_b[1]["pos"][1] + (320 - team_b[1]["pos"][1]) * a]
            team_a[5]["pos"][0] = ball_pos[0] + 10
            team_a[5]["pos"][1] = ball_pos[1]

        # FASE 5 (frames 500-600): ¡TIRO PELIGROSO HACIA EL ARCO!
        elif f < 600:
            a = (f - 500) / 100.0
            target_goal = [w - border + 10, h // 2 - 25]
            ball_pos = [750.0 + (target_goal[0] - 750.0) * a,
                        320.0 + (target_goal[1] - 320.0) * a]
            team_b[0]["pos"][1] = 360.0 - a * 40 # Portero intenta atajar

        # FASE 6 (frames 600-720): ¡GOLAZO! Celebración
        else:
            ball_pos = [w - border + 10, h // 2 - 25] # Balón en la red
            for p in team_a:
                p["pos"][0] += 0.5
                p["pos"][1] += np.sin(f * 0.1 + p["id"]) * 1.5

        # Dibujar Equipo A (Azul)
        for p in team_a:
            px, py = int(p["pos"][0]), int(p["pos"][1])
            cv2.circle(frame, (px, py), 16, (220, 110, 20), -1) # Azul
            cv2.circle(frame, (px, py), 16, (255, 255, 255), 2)
            cv2.circle(frame, (px, py - 20), 8, (200, 220, 240), -1)

        # Dibujar Equipo B (Rojo)
        for p in team_b:
            px, py = int(p["pos"][0]), int(p["pos"][1])
            cv2.circle(frame, (px, py), 16, (25, 30, 220), -1) # Rojo
            cv2.circle(frame, (px, py), 16, (255, 255, 255), 2)
            cv2.circle(frame, (px, py - 20), 8, (200, 220, 240), -1)

        # Dibujar ÁRBITRO (Amarillo Flúor brillante)
        rx, ry = int(referee["pos"][0]), int(referee["pos"][1])
        cv2.circle(frame, (rx, ry), 16, (0, 240, 255), -1) # Amarillo flúor
        cv2.circle(frame, (rx, ry), 16, (0, 0, 0), 2)
        cv2.circle(frame, (rx, ry - 20), 8, (190, 200, 220), -1)

        # Dibujar Balón
        bx, by = int(ball_pos[0]), int(ball_pos[1])
        cv2.circle(frame, (bx, by), 9, (245, 245, 245), -1)
        cv2.circle(frame, (bx, by), 9, (10, 10, 10), 1)
        cv2.circle(frame, (bx, by), 3, (15, 15, 15), -1)

        out.write(frame)

    out.release()
    print(f"[*] Demo generado a 45 FPS con Árbitro y Pases en: {output_path}")

if __name__ == "__main__":
    generate_demo_match_video("uploads/partido_demostracion.mp4", duration_seconds=16, fps=45)
