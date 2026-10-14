import sqlite3
import random
import math
import json
import os
import secrets
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(__file__), 'data', 'orbat.db')
CONFIG_PATH = os.path.join(os.path.dirname(__file__), 'data', 'config.json')

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def get_op_dinamico_config():
    config = {
        "distancia_nominal_metros": 50.0,
        "radio_activacion_metros": 10.0,
        "tolerancia_angular_grados": 15.0,
        "tiempo_adquisicion_segundos": 1.5,
        "duracion_sesion_minutos": 45
    }
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if 'op_dinamico' in data:
                    config.update(data['op_dinamico'])
        except Exception:
            pass
    return config

def haversine_distance(lat1, lon1, lat2, lon2):
    R = 6371000.0  # Radio de la Tierra en metros
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def calculate_destination_point(lat, lng, distance_m, bearing_deg):
    R = 6371000.0
    d_div_r = distance_m / R
    theta = math.radians(bearing_deg)
    phi1 = math.radians(lat)
    lambda1 = math.radians(lng)

    phi2 = math.asin(
        math.sin(phi1) * math.cos(d_div_r) +
        math.cos(phi1) * math.sin(d_div_r) * math.cos(theta)
    )
    lambda2 = lambda1 + math.atan2(
        math.sin(theta) * math.sin(d_div_r) * math.cos(phi1),
        math.cos(d_div_r) - math.sin(phi1) * math.sin(phi2)
    )
    return math.degrees(phi2), math.degrees(lambda2)

def calculate_initial_bearing(lat1, lon1, lat2, lon2):
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_lambda = math.radians(lon2 - lon1)

    y = math.sin(delta_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(delta_lambda)
    initial_bearing = math.degrees(math.atan2(y, x))
    return (initial_bearing + 360) % 360

def point_in_polygon(x, y, polygon):
    # Ray-casting algorithm
    n = len(polygon)
    inside = False
    p1x = polygon[0].get('lng', polygon[0].get('x', 0))
    p1y = polygon[0].get('lat', polygon[0].get('y', 0))
    for i in range(n + 1):
        p2 = polygon[i % n]
        p2x = p2.get('lng', p2.get('x', 0))
        p2y = p2.get('lat', p2.get('y', 0))
        if y > min(p1y, p2y):
            if y <= max(p1y, p2y):
                if x <= max(p1x, p2x):
                    if p1y != p2y:
                        xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                    if p1x == p2x or x <= xinters:
                        inside = not inside
        p1x, p1y = p2x, p2y
    return inside

def is_position_valid(lat, lng, conn, gps_mapper):
    # 1. Project GPS coordinates to Canvas map coordinates
    map_lat, map_lng = gps_mapper.gps_to_map(lat, lng)
    
    # 2. Check bounds of operational area
    if not (0 <= map_lat <= 2000 and 0 <= map_lng <= 3000):
        return False, "Fuera de los límites del mapa operativo"
        
    grid_coord = gps_mapper.get_grid_coordinate(map_lat, map_lng)
    if grid_coord == "FUERA MAPA":
        return False, "Fuera de la cuadrícula operativa"
        
    # 3. Check forbidden zones if any are tagged in ZonaMapa
    zonas = conn.execute("SELECT id, nombre, puntos_json FROM ZonaMapa").fetchall()
    for z in zonas:
        name_lower = z['nombre'].lower() if z['nombre'] else ''
        if 'prohibid' in name_lower or 'restringid' in name_lower or 'exclusi' in name_lower:
            try:
                pts = json.loads(z['puntos_json'])
                if pts and point_in_polygon(map_lng, map_lat, pts):
                    return False, f"Cae dentro de zona excluida: {z['nombre']}"
            except Exception:
                pass
                
    return True, "Posición válida"

def get_active_session(source_op_id, conn=None):
    close_conn = False
    if conn is None:
        conn = get_db_connection()
        close_conn = True
    try:
        now_str = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
        # Limpiar expirados
        conn.execute("UPDATE op_secundario_sesion SET estado = 'EXPIRADO' WHERE estado IN ('GENERADO', 'EN_RADIO') AND expires_at < ?", (now_str,))
        conn.commit()

        row = conn.execute('''
            SELECT * FROM op_secundario_sesion 
            WHERE source_op_id = ? AND estado IN ('GENERADO', 'EN_RADIO', 'CONTACTO_ADQUIRIDO')
            ORDER BY created_at DESC LIMIT 1
        ''', (source_op_id,)).fetchone()
        return dict(row) if row else None
    finally:
        if close_conn:
            conn.close()

def get_or_create_op_secundario(source_op_id, faccion_id, equipo_id, gps_mapper):
    conn = get_db_connection()
    try:
        # 1. Verificar si ya existe una sesión activa para este OP permanente (Idempotencia)
        existing = get_active_session(source_op_id, conn)
        if existing:
            return existing

        # 2. Obtener datos del OP permanente
        op = conn.execute("SELECT * FROM puntos_interes WHERE id = ? AND tipo = 'OP'", (source_op_id,)).fetchone()
        if not op:
            raise ValueError(f"OP permanente con ID {source_op_id} no encontrado.")

        cfg = get_op_dinamico_config()
        distancia = float(cfg.get('distancia_nominal_metros', 50.0))
        duracion = int(cfg.get('duracion_sesion_minutos', 45))

        # 3. Intentar generar coordenadas candidatas a 50m dentro del terreno autorizado (máx 20 intentos)
        valid = False
        attempts = 0
        cand_lat, cand_lng = op['lat'], op['lng']
        cand_bearing = 0.0

        while not valid and attempts < 20:
            attempts += 1
            cand_bearing = random.uniform(0.0, 359.9)
            cand_lat, cand_lng = calculate_destination_point(op['lat'], op['lng'], distancia, cand_bearing)
            valid, reason = is_position_valid(cand_lat, cand_lng, conn, gps_mapper)

        if not valid:
            raise RuntimeError(f"No fue posible generar una posición válida a {distancia}m tras {attempts} intentos: {reason}")

        # 4. Generar azimut virtual secreto para búsqueda con cámara (0-359°)
        azimut_busqueda = round(random.uniform(0.0, 359.0), 1)

        token_sesion = secrets.token_hex(8)
        created_at = datetime.utcnow()
        expires_at = (created_at + timedelta(minutes=duracion)).strftime('%Y-%m-%d %H:%M:%S')

        conn.execute('''
            INSERT INTO op_secundario_sesion 
            (token_sesion, source_op_id, faccion_id, equipo_id, sec_lat, sec_lng, desplazamiento_bearing, azimut_busqueda, estado, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'GENERADO', ?)
        ''', (token_sesion, source_op_id, faccion_id, equipo_id, cand_lat, cand_lng, round(cand_bearing, 1), azimut_busqueda, expires_at))
        conn.commit()

        new_row = conn.execute("SELECT * FROM op_secundario_sesion WHERE token_sesion = ?", (token_sesion,)).fetchone()
        return dict(new_row)
    finally:
        conn.close()

def check_player_proximity(token_sesion, player_lat, player_lng):
    conn = get_db_connection()
    try:
        session_row = conn.execute("SELECT * FROM op_secundario_sesion WHERE token_sesion = ?", (token_sesion,)).fetchone()
        if not session_row:
            return {"error": "Sesión de OP secundario no encontrada", "status": "NOT_FOUND"}

        if session_row['estado'] in ('COMPLETADO', 'EXPIRADO'):
            return {"error": f"La sesión está en estado {session_row['estado']}", "status": session_row['estado']}

        dist = haversine_distance(player_lat, player_lng, session_row['sec_lat'], session_row['sec_lng'])
        bearing_to_op = calculate_initial_bearing(player_lat, player_lng, session_row['sec_lat'], session_row['sec_lng'])

        cfg = get_op_dinamico_config()
        radio = float(cfg.get('radio_activacion_metros', 10.0))

        en_radio = dist <= radio

        # Si entra en radio y estaba en GENERADO, transicionar a EN_RADIO
        if en_radio and session_row['estado'] == 'GENERADO':
            conn.execute("UPDATE op_secundario_sesion SET estado = 'EN_RADIO' WHERE token_sesion = ?", (token_sesion,))
            conn.commit()
            estado_actual = 'EN_RADIO'
        else:
            estado_actual = session_row['estado']

        return {
            "status": "success",
            "distancia_metros": round(dist, 1),
            "rumbo_hacia_op": round(bearing_to_op, 1),
            "en_radio": en_radio,
            "radio_activacion": radio,
            "estado": estado_actual,
            "azimut_busqueda": session_row['azimut_busqueda'] if (en_radio or estado_actual in ('EN_RADIO', 'CONTACTO_ADQUIRIDO')) else None
        }
    finally:
        conn.close()

def acquire_contact(token_sesion, player_lat=None, player_lng=None):
    conn = get_db_connection()
    try:
        session_row = conn.execute("SELECT * FROM op_secundario_sesion WHERE token_sesion = ?", (token_sesion,)).fetchone()
        if not session_row:
            return {"error": "Sesión no encontrada", "success": False}

        cfg = get_op_dinamico_config()
        radio = float(cfg.get('radio_activacion_metros', 10.0))

        # Validación server-side de distancia si se envían coordenadas
        if player_lat is not None and player_lng is not None:
            dist = haversine_distance(player_lat, player_lng, session_row['sec_lat'], session_row['sec_lng'])
            if dist > (radio + 5.0): # 5 metros de tolerancia adicional por dispersión GPS
                return {
                    "error": f"Posición GPS demasiado lejana del OP secundario ({round(dist, 1)}m > {radio}m).",
                    "success": False
                }

        conn.execute("UPDATE op_secundario_sesion SET estado = 'CONTACTO_ADQUIRIDO' WHERE token_sesion = ?", (token_sesion,))
        conn.commit()

        # Obtener token_qr del OP permanente para el enlace al reconocimiento visual
        op = conn.execute("SELECT token_qr FROM puntos_interes WHERE id = ?", (session_row['source_op_id'],)).fetchone()
        token_qr = op['token_qr'] if op else None

        return {
            "success": True,
            "token_qr": token_qr,
            "source_op_id": session_row['source_op_id'],
            "azimut_busqueda": session_row['azimut_busqueda']
        }
    finally:
        conn.close()

def destroy_op_secundario_by_source_op(source_op_id):
    conn = get_db_connection()
    try:
        conn.execute('''
            UPDATE op_secundario_sesion 
            SET estado = 'COMPLETADO' 
            WHERE source_op_id = ? AND estado IN ('GENERADO', 'EN_RADIO', 'CONTACTO_ADQUIRIDO')
        ''', (source_op_id,))
        conn.commit()
    finally:
        conn.close()
