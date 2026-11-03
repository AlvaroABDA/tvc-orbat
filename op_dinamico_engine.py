import sqlite3
import random
import math
import json
import os
import secrets
from datetime import datetime, timedelta
import imint_engine

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
        "tolerancia_angular_grados": 45.0,
        "tiempo_adquisicion_segundos": 1.0,
        "duracion_sesion_minutos": 45,
        "cooldown_op_minutos": 5,
        "modo_alternancia": "cooldown",  # 'cooldown' (recomendado) | 'estricto' (legacy)
        "max_targets_activos_escuadra": 2
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
        if not row:
            return None
        res = dict(row)
        tgts = []
        if res.get('targets_json'):
            try:
                tgts = json.loads(res['targets_json'])
            except Exception:
                pass
        res['targets'] = tgts
        return res
    finally:
        if close_conn:
            conn.close()

def _build_ar_target_candidates(azimut_busqueda, faccion_id, conn):
    """
    Genera 3 contactos de inteligencia para situar en el espacio angular AR del OP.
    Cada contacto tiene su propio rumbo, etiqueta, imagen e informe de entorno.
    """
    scenario = imint_engine.generate_imint_scenario(faccion_id)
    f_row = conn.execute("SELECT nombre FROM Faccion WHERE id = ?", (faccion_id,)).fetchone()
    faccion_nombre = f_row['nombre'] if f_row else 'Syldavia'

    candidates = []
    offsets = [-26.0, 0.0, 26.0]

    for idx, opt in enumerate(scenario.get('opciones', [])):
        cand_az = round((azimut_busqueda + offsets[idx % len(offsets)] + 360) % 360, 1)
        dist_cand = random.randint(340, 560)
        tipo_raw = opt.get('informe', {}).get('contacto', '')
        tipo_clean = tipo_raw.replace('Contacto visual. Tipo estimado: ', '').replace('.', '').strip()
        if not tipo_clean:
            tipo_clean = 'OBJETIVO MILITAR'
        is_valid = faccion_nombre in opt.get('es_objetivo_valido_para', [])
        is_fake = not is_valid

        candidates.append({
            'candidate_id': idx,
            'cto_label': f"CTO-0{idx+1}",
            'referencia': opt.get('informe', {}).get('referencia', f'OBJ-{random.randint(100, 999)}'),
            'azimut': cand_az,
            'distancia_m': dist_cand,
            'tipo': tipo_clean,
            'confianza': opt.get('informe', {}).get('confianza', 'Media'),
            'entorno_dinamico': opt.get('informe', {}).get('entorno_dinamico', 'Entorno: Zona despejada.'),
            'imagen_url': opt.get('imagen_url', ''),
            'is_fake': is_fake,
            'genera_colateral': opt.get('genera_colateral', True)
        })

    return candidates

def get_or_create_op_secundario(source_op_id, faccion_id, equipo_id, gps_mapper):
    conn = get_db_connection()
    try:
        # 1. Verificar si ya existe una sesión activa para este OP permanente (Idempotencia)
        existing = get_active_session(source_op_id, conn)
        if existing:
            if not existing.get('targets') or len(existing['targets']) == 0:
                # Si existía de versión previa sin los 3 candidatos, generarlos y guardarlos
                cands = _build_ar_target_candidates(existing['azimut_busqueda'], faccion_id, conn)
                c_json = json.dumps(cands)
                conn.execute("UPDATE op_secundario_sesion SET targets_json = ? WHERE token_sesion = ?", (c_json, existing['token_sesion']))
                conn.commit()
                existing['targets'] = cands
                existing['targets_json'] = c_json
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

        # 5. Generar los 3 objetivos AR directos
        candidates = _build_ar_target_candidates(azimut_busqueda, faccion_id, conn)
        targets_json = json.dumps(candidates)

        token_sesion = secrets.token_hex(8)
        created_at = datetime.utcnow()
        expires_at = (created_at + timedelta(minutes=duracion)).strftime('%Y-%m-%d %H:%M:%S')

        conn.execute('''
            INSERT INTO op_secundario_sesion 
            (token_sesion, source_op_id, faccion_id, equipo_id, sec_lat, sec_lng, desplazamiento_bearing, azimut_busqueda, estado, expires_at, targets_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'GENERADO', ?, ?)
        ''', (token_sesion, source_op_id, faccion_id, equipo_id, cand_lat, cand_lng, round(cand_bearing, 1), azimut_busqueda, expires_at, targets_json))
        conn.commit()

        new_row = conn.execute("SELECT * FROM op_secundario_sesion WHERE token_sesion = ?", (token_sesion,)).fetchone()
        res_dict = dict(new_row)
        res_dict['targets'] = candidates
        return res_dict
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

        targets = []
        if session_row['targets_json']:
            try:
                targets = json.loads(session_row['targets_json'])
            except Exception:
                pass

        return {
            "status": "success",
            "distancia_metros": round(dist, 1),
            "rumbo_hacia_op": round(bearing_to_op, 1),
            "en_radio": en_radio,
            "radio_activacion": radio,
            "estado": estado_actual,
            "azimut_busqueda": session_row['azimut_busqueda'],
            "targets": targets
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
            if dist > (radio + 8.0): # 8 metros de tolerancia adicional por dispersión GPS en campo abierto
                return {
                    "error": f"Posición GPS demasiado lejana del OP secundario ({round(dist, 1)}m > {radio}m).",
                    "success": False
                }

        conn.execute("UPDATE op_secundario_sesion SET estado = 'CONTACTO_ADQUIRIDO' WHERE token_sesion = ?", (token_sesion,))
        conn.commit()

        # Obtener token_qr del OP permanente para compatibilidad QR
        op = conn.execute("SELECT token_qr FROM puntos_interes WHERE id = ?", (session_row['source_op_id'],)).fetchone()
        token_qr = op['token_qr'] if op else None

        targets = []
        if session_row['targets_json']:
            try:
                targets = json.loads(session_row['targets_json'])
            except Exception:
                pass

        return {
            "success": True,
            "token_qr": token_qr,
            "source_op_id": session_row['source_op_id'],
            "azimut_busqueda": session_row['azimut_busqueda'],
            "targets": targets
        }
    finally:
        conn.close()

def designate_target_candidate(token_sesion, candidate_id, equipo_id=None, faccion_id=None, conn=None):
    """
    Confirma y designa uno de los 3 objetivos AR detectados durante el barrido,
    creando el registro operativo en dynamic_targets para el mortero y fijándolo
    como CURRENT TARGET del observador / escuadra.
    """
    close_conn = False
    if conn is None:
        conn = get_db_connection()
        close_conn = True
    try:
        session_row = conn.execute("SELECT * FROM op_secundario_sesion WHERE token_sesion = ?", (token_sesion,)).fetchone()
        if not session_row:
            raise ValueError("Sesión de reconocimiento no encontrada o caducada.")

        source_op_id = session_row['source_op_id']
        s_faccion_id = faccion_id or session_row['faccion_id']
        s_equipo_id = equipo_id or session_row['equipo_id']

        candidates = []
        if session_row['targets_json']:
            try:
                candidates = json.loads(session_row['targets_json'])
            except Exception:
                pass

        selected = None
        for c in candidates:
            if str(c.get('candidate_id')) == str(candidate_id):
                selected = c
                break

        if not selected and candidates:
            selected = candidates[0]

        if not selected:
            raise ValueError("No se encontraron datos del objetivo seleccionado en la sesión.")

        # Confirmar e insertar en dynamic_targets
        tgt_row = imint_engine.confirm_imint_target(
            source_op_id=source_op_id,
            faccion_id=s_faccion_id,
            equipo_id=s_equipo_id,
            is_fake=selected.get('is_fake', False),
            genera_colateral=selected.get('genera_colateral', True),
            image_url=selected.get('imagen_url'),
            intel_text=f"Referencia: {selected.get('referencia')} | Tipo: {selected.get('tipo')} | Confianza: {selected.get('confianza')}",
            entorno_text=selected.get('entorno_dinamico'),
            azimut=selected.get('azimut'),
            distancia_m=selected.get('distancia_m')
        )

        # Cerrar sesión de OP secundario
        conn.execute("UPDATE op_secundario_sesion SET estado = 'COMPLETADO' WHERE token_sesion = ?", (token_sesion,))
        conn.commit()

        tgt_dict = dict(tgt_row) if tgt_row else {}
        return tgt_dict
    finally:
        if close_conn:
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

# -------------------------------------------------------------
# CONTROL DE CURRENT TARGET, ROSTER Y COOLDOWN DE OP
# -------------------------------------------------------------
def get_op_cooldown_remaining(source_op_id, equipo_id, conn=None):
    close_conn = False
    if conn is None:
        conn = get_db_connection()
        close_conn = True
    try:
        cfg = get_op_dinamico_config()
        cooldown_min = int(cfg.get('cooldown_op_minutos', 5))
        if cooldown_min <= 0 or not equipo_id:
            return 0

        row = conn.execute('''
            SELECT created_at FROM dynamic_targets 
            WHERE source_op_id = ? AND equipo_id = ?
            ORDER BY created_at DESC LIMIT 1
        ''', (source_op_id, equipo_id)).fetchone()

        if not row or not row['created_at']:
            return 0

        try:
            created_dt = datetime.strptime(str(row['created_at'])[:19], '%Y-%m-%d %H:%M:%S')
        except ValueError:
            return 0

        elapsed_sec = (datetime.utcnow() - created_dt).total_seconds()
        rem = int((cooldown_min * 60) - elapsed_sec)
        return max(0, rem)
    except Exception:
        return 0
    finally:
        if close_conn:
            conn.close()

def get_squad_active_targets_count(equipo_id, faccion_id, conn=None):
    close_conn = False
    if conn is None:
        conn = get_db_connection()
        close_conn = True
    try:
        now_str = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
        row = conn.execute('''
            SELECT COUNT(*) FROM dynamic_targets 
            WHERE status = 'ACTIVE' AND expires_at > ?
            AND (equipo_id = ? OR (equipo_id IS NULL AND faccion_id = ?))
            AND id NOT LIKE '%-COL'
        ''', (now_str, equipo_id, faccion_id)).fetchone()
        return row[0] if row else 0
    finally:
        if close_conn:
            conn.close()

def get_squad_current_target(equipo_id, faccion_id, conn=None):
    close_conn = False
    if conn is None:
        conn = get_db_connection()
        close_conn = True
    try:
        now_str = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
        conn.execute("UPDATE dynamic_targets SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND expires_at <= ?", (now_str,))
        conn.commit()

        target = None
        if equipo_id:
            target = conn.execute('''
                SELECT dt.*, poi.nombre as op_nombre, e.nombre as equipo_nombre
                FROM dynamic_targets dt
                LEFT JOIN puntos_interes poi ON dt.source_op_id = poi.id
                LEFT JOIN Equipo e ON dt.equipo_id = e.id
                WHERE dt.equipo_id = ? AND dt.id NOT LIKE '%-COL'
                ORDER BY dt.created_at DESC LIMIT 1
            ''', (equipo_id,)).fetchone()

        if not target and faccion_id:
            target = conn.execute('''
                SELECT dt.*, poi.nombre as op_nombre, e.nombre as equipo_nombre
                FROM dynamic_targets dt
                LEFT JOIN puntos_interes poi ON dt.source_op_id = poi.id
                LEFT JOIN Equipo e ON dt.equipo_id = e.id
                WHERE dt.faccion_id = ? AND dt.id NOT LIKE '%-COL'
                ORDER BY dt.created_at DESC LIMIT 1
            ''', (faccion_id,)).fetchone()

        if not target:
            return None

        t_dict = dict(target)
        if t_dict.get('expires_at'):
            try:
                exp_dt = datetime.strptime(str(t_dict['expires_at'])[:19], '%Y-%m-%d %H:%M:%S')
                rem_sec = int((exp_dt - datetime.utcnow()).total_seconds())
                t_dict['tiempo_restante_sec'] = max(0, rem_sec)
            except Exception:
                t_dict['tiempo_restante_sec'] = 0
        else:
            t_dict['tiempo_restante_sec'] = 0

        return t_dict
    finally:
        if close_conn:
            conn.close()

def get_targets_roster(equipo_id, faccion_id, conn=None):
    close_conn = False
    if conn is None:
        conn = get_db_connection()
        close_conn = True
    try:
        now_str = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
        conn.execute("UPDATE dynamic_targets SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND expires_at <= ?", (now_str,))
        conn.commit()

        rows = conn.execute('''
            SELECT dt.*, poi.nombre as op_nombre, e.nombre as equipo_nombre
            FROM dynamic_targets dt
            LEFT JOIN puntos_interes poi ON dt.source_op_id = poi.id
            LEFT JOIN Equipo e ON dt.equipo_id = e.id
            WHERE (dt.faccion_id = ? OR (dt.equipo_id IS NOT NULL AND dt.equipo_id = ?))
            AND dt.id NOT LIKE '%-COL'
            ORDER BY dt.created_at DESC LIMIT 40
        ''', (faccion_id, equipo_id)).fetchall()

        out = []
        for r in rows:
            d = dict(r)
            if d.get('expires_at'):
                try:
                    exp_dt = datetime.strptime(str(d['expires_at'])[:19], '%Y-%m-%d %H:%M:%S')
                    rem = int((exp_dt - datetime.utcnow()).total_seconds())
                    d['tiempo_restante_sec'] = max(0, rem)
                except Exception:
                    d['tiempo_restante_sec'] = 0
            else:
                d['tiempo_restante_sec'] = 0
            out.append(d)
        return out
    finally:
        if close_conn:
            conn.close()
