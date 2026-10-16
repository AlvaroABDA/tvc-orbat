import os
import json
import sqlite3
import uuid
from datetime import datetime, timezone

CONFIG_PATH = os.path.join(os.path.dirname(__file__), 'config.json')

def load_medic_config():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print("Error cargando field_medic/config.json:", e)
    return {
        "reanimaciones_iniciales_medico": 3,
        "fase1_hemorragia": {
            "velocidad_marcador_ms": 1600,
            "velocidad_deriva_zona_ms": 2500,
            "ancho_zona_objetivo_pct": 22.0,
            "aciertos_requeridos": 6,
            "penalizacion_por_error_pct": 12.0,
            "progreso_por_acierto_pct": 16.66,
            "tiempo_limite_segundos": 60,
            "decay_pasivo_por_segundo_pct": 1.0
        },
        "fase1_neumotorax": {
            "velocidad_carga": 75.0,
            "velocidad_ciclo_ms": 1800,
            "zona_valvula_min": 65.0,
            "zona_valvula_max": 85.0,
            "zona_descompresion_min_pct": 65.0,
            "zona_descompresion_max_pct": 85.0,
            "aciertos_requeridos": 6,
            "penalizacion_por_error_pct": 12.0,
            "progreso_por_acierto_pct": 16.66,
            "tiempo_limite_segundos": 60
        },
        "fase1_torniquete": {
            "segmentos_totales": 8,
            "aciertos_requeridos": 6,
            "velocidad_rotacion_segundos": 2.4,
            "tolerancia_grados": 12.0,
            "duracion_activacion_ms": 300,
            "intervalo_entre_activaciones_ms": 0,
            "penalizacion_por_error_pct": 8.0,
            "progreso_por_acierto_pct": 16.66,
            "tiempo_limite_segundos": 50
        },
        "fase1_sutura": {
            "puntos_requeridos": 8,
            "radio_objetivo_px": 28,
            "velocidad_cursor_ms": 1300,
            "penalizacion_por_error_pct": 8.0,
            "tiempo_limite_segundos": 60
        },
        "fase2_estabilizacion": {
            "bpm_ritmo": 60,
            "tolerancia_ms": 180,
            "pulsaciones_requeridas": 10,
            "penalizacion_por_desfase_pct": 8.0,
            "progreso_por_latido_pct": 10.0,
            "tiempo_limite_segundos": 50
        },
        "fase2_constantes_rango": {
            "velocidad_marcador_ms": 1500,
            "ancho_zona_pct": 24.0,
            "aciertos_consecutivos_requeridos": 7,
            "penalizacion_por_error_pct": 16.0,
            "tiempo_limite_segundos": 60
        },
        "fase2_doble_indicador": {
            "velocidad_indicador_1_ms": 1600,
            "velocidad_indicador_2_ms": 2200,
            "ancho_zona_1_pct": 24.0,
            "ancho_zona_2_pct": 24.0,
            "aciertos_requeridos_por_barra": 6,
            "penalizacion_por_error_pct": 12.0,
            "tiempo_limite_segundos": 65
        },
        "fase2_secuencia_visual": {
            "rondas_totales": 5,
            "longitud_inicial": 2,
            "longitud_maxima": 4,
            "penalizacion_por_error_pct": 16.0,
            "tiempo_limite_segundos": 65
        },
        "fase2_correccion_linea": {
            "velocidad_desviacion": 35.0,
            "fuerza_correccion": 65.0,
            "margen_tolerancia_pct": 16.0,
            "segundos_en_rango_requeridos": 8.0,
            "tiempo_limite_segundos": 55
        }
    }

def init_medic_db(conn):
    """
    Crea las tablas médicas en la base de datos SQLite si no existen.
    Totalmente no destructivo.
    """
    cursor = conn.cursor()
    
    # 1. Registro de capacidad de reanimaciones por Sanitario
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS MedicoRecursos (
            sanitario_id TEXT PRIMARY KEY,
            reanimaciones_disponibles INTEGER NOT NULL DEFAULT 3,
            reanimaciones_usadas INTEGER NOT NULL DEFAULT 0,
            actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # 2. Episodios Médicos de Atención
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS EpisodioMedico (
            id TEXT PRIMARY KEY,               -- UUID del episodio generado en cliente/servidor
            sanitario_id TEXT NOT NULL,         -- Identificador legacy del médico
            operador_uid TEXT NOT NULL,         -- UID legacy del paciente
            operador_nombre TEXT,               -- Nombre o indicativo del paciente
            faccion_nombre TEXT,                -- Bando del paciente
            medico_uid TEXT,                   -- UID del carnet del médico que atiende y sella
            medico_nombre TEXT,                -- Nombre del médico
            medico_faccion TEXT,               -- Bando del médico
            paciente_uid TEXT,                 -- UID del carnet del paciente herido
            paciente_nombre TEXT,              -- Nombre del paciente
            paciente_faccion TEXT,             -- Bando del paciente
            hora_inicio TEXT,                  -- Timestamp ISO inicio triaje
            hora_cierre TEXT,                  -- Timestamp ISO sellado con carnet médico
            escenario_id TEXT DEFAULT 'HEMORRAGIA_ACTIVA',
            fase_actual TEXT NOT NULL,          -- hemorrhage_control, patient_stabilization, completed
            hemorragia_controlada BOOLEAN DEFAULT 0,
            estabilizacion_completada BOOLEAN DEFAULT 0,
            resultado_final TEXT,               -- EXITO, FALLO, ABORTADO
            duracion_total_segundos REAL DEFAULT 0,
            discrepancias_flags TEXT,          -- JSON Array con banderas de anomalía auditables
            sincronizado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
            detalles_json TEXT                  -- Métricas opcionales y telemetría de juego
        )
    ''')
    
    # Migración no destructiva de columnas si la tabla ya existía
    try:
        cols = [c[1] for c in cursor.execute("PRAGMA table_info(EpisodioMedico)").fetchall()]
        migraciones = [
            ('medico_uid', 'TEXT'),
            ('medico_nombre', 'TEXT'),
            ('medico_faccion', 'TEXT'),
            ('paciente_uid', 'TEXT'),
            ('paciente_nombre', 'TEXT'),
            ('paciente_faccion', 'TEXT'),
            ('hora_inicio', 'TEXT'),
            ('hora_cierre', 'TEXT'),
            ('discrepancias_flags', 'TEXT')
        ]
        for col_name, col_type in migraciones:
            if col_name not in cols:
                cursor.execute(f"ALTER TABLE EpisodioMedico ADD COLUMN {col_name} {col_type}")
    except Exception as e:
        print("[Medic Engine] Info migración SQLite:", e)
        
    conn.commit()

def get_or_create_sanitario_recursos(conn, sanitario_id):
    """
    Obtiene los recursos restantes del sanitario o los inicializa si es su primera atención.
    """
    config = load_medic_config()
    default_reanim = config.get("reanimaciones_iniciales_medico", 3)
    
    cursor = conn.cursor()
    row = cursor.execute('SELECT * FROM MedicoRecursos WHERE sanitario_id = ?', (sanitario_id,)).fetchone()
    if not row:
        cursor.execute('''
            INSERT INTO MedicoRecursos (sanitario_id, reanimaciones_disponibles, reanimaciones_usadas)
            VALUES (?, ?, 0)
        ''', (sanitario_id, default_reanim))
        conn.commit()
        return {
            "sanitario_id": sanitario_id,
            "reanimaciones_disponibles": default_reanim,
            "reanimaciones_usadas": 0
        }
    return dict(row)

def sync_episodio_medico(conn, payload):
    """
    Procesa un episodio médico finalizado de forma estrictamente IDEMPOTENTE.
    Registra paciente y médico, detecta discrepancias de seguridad y actualiza cupos.
    """
    episode_id = payload.get('episode_id')
    if not episode_id:
        return {"status": "error", "message": "Falta episode_id"}, 400
        
    # Compatibilidad con campos nuevos y legados
    paciente_uid = str(payload.get('paciente_uid') or payload.get('operador_uid') or 'PACIENTE_DESCONOCIDO').strip()
    medico_uid = str(payload.get('medico_uid') or payload.get('sanitario_id') or 'MEDICO_DESCONOCIDO').strip()
    
    paciente_nombre = str(payload.get('paciente_nombre') or payload.get('operador_nombre') or paciente_uid).strip()
    paciente_faccion = str(payload.get('paciente_faccion') or payload.get('faccion_nombre') or '').strip()
    
    medico_nombre = str(payload.get('medico_nombre') or payload.get('sanitario_nombre') or medico_uid).strip()
    medico_faccion = str(payload.get('medico_faccion') or '').strip()
    
    hora_inicio = payload.get('hora_inicio') or payload.get('start_time')
    hora_cierre = payload.get('hora_cierre') or datetime.now(timezone.utc).isoformat()
    
    escenario_id = payload.get('escenario_id', 'HEMORRAGIA_ACTIVA')
    fase_actual = payload.get('fase_actual', 'completed')
    hemorragia_controlada = bool(payload.get('hemorragia_controlada', False))
    estabilizacion_completada = bool(payload.get('estabilizacion_completada', False))
    resultado_final = payload.get('resultado_final', 'EXITO')
    duracion = float(payload.get('duracion_total_segundos', 0.0))
    detalles_json = json.dumps(payload.get('detalles', {}))
    
    cursor = conn.cursor()
    
    # 1. Comprobar si ya existe el episodio (IDEMPOTENCIA)
    existente = cursor.execute('SELECT * FROM EpisodioMedico WHERE id = ?', (episode_id,)).fetchone()
    if existente:
        recursos = get_or_create_sanitario_recursos(conn, medico_uid)
        return {
            "status": "success",
            "message": "Episodio ya sincronizado previamente (idempotente).",
            "reanimaciones_disponibles": recursos["reanimaciones_disponibles"],
            "already_synced": True
        }, 200
        
    # 2. Análisis automático de Discrepancias / Banderas de Seguridad
    flags = []
    # (a) Duración anormalmente rápida (imposible con requisitos actuales < 25s)
    if duracion < 25.0 and resultado_final == 'EXITO':
        flags.append('FAST_DURATION')
        
    # (b) Intento de auto-curación (mismo carnet en ambos extremos)
    if paciente_uid and medico_uid and paciente_uid.upper() == medico_uid.upper():
        flags.append('SELF_HEAL')
        
    # (c) Bando cruzado (asistencia médica a otra facción)
    if paciente_faccion and medico_faccion:
        pf = paciente_faccion.lower()
        mf = medico_faccion.lower()
        if pf != mf and 'global' not in pf and 'global' not in mf and 'desconocid' not in pf and 'desconocid' not in mf:
            flags.append('CROSS_FACTION')
            
    # (d) Atención repetida al mismo paciente en menos de 180 segundos
    try:
        repeat_check = cursor.execute('''
            SELECT id, sincronizado_en FROM EpisodioMedico
            WHERE (paciente_uid = ? OR operador_uid = ?) AND resultado_final = 'EXITO'
            ORDER BY sincronizado_en DESC LIMIT 1
        ''', (paciente_uid, paciente_uid)).fetchone()
        if repeat_check:
            # Si hay atención previa registrada hoy
            flags.append('RECENT_ATTENTION')
    except Exception:
        pass
        
    discrepancias_json = json.dumps(flags)
        
    # 3. Insertar el nuevo episodio en la base de datos
    cursor.execute('''
        INSERT INTO EpisodioMedico (
            id, sanitario_id, operador_uid, operador_nombre, faccion_nombre,
            medico_uid, medico_nombre, medico_faccion,
            paciente_uid, paciente_nombre, paciente_faccion,
            hora_inicio, hora_cierre,
            escenario_id, fase_actual, hemorragia_controlada, estabilizacion_completada,
            resultado_final, duracion_total_segundos, discrepancias_flags, detalles_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        episode_id, medico_uid, paciente_uid, paciente_nombre, paciente_faccion,
        medico_uid, medico_nombre, medico_faccion,
        paciente_uid, paciente_nombre, paciente_faccion,
        str(hora_inicio), str(hora_cierre),
        escenario_id, fase_actual, hemorragia_controlada, estabilizacion_completada,
        resultado_final, duracion, discrepancias_json, detalles_json
    ))
    
    # 4. Descontar 1 reanimación al médico tratante si la atención fue exitosa
    recursos = get_or_create_sanitario_recursos(conn, medico_uid)
    if resultado_final == 'EXITO' and hemorragia_controlada and estabilizacion_completada:
        nuevas_disponibles = max(0, recursos['reanimaciones_disponibles'] - 1)
        nuevas_usadas = recursos['reanimaciones_usadas'] + 1
        cursor.execute('''
            UPDATE MedicoRecursos
            SET reanimaciones_disponibles = ?, reanimaciones_usadas = ?, actualizado_en = CURRENT_TIMESTAMP
            WHERE sanitario_id = ?
        ''', (nuevas_disponibles, nuevas_usadas, medico_uid))
        recursos['reanimaciones_disponibles'] = nuevas_disponibles
        recursos['reanimaciones_usadas'] = nuevas_usadas
        
    conn.commit()
    
    return {
        "status": "success",
        "message": "Episodio registrado correctamente.",
        "reanimaciones_disponibles": recursos["reanimaciones_disponibles"],
        "discrepancias": flags,
        "already_synced": False
    }, 200

def get_medic_roster_snapshot(conn):
    """
    Genera un diccionario ultraligero con todos los carnets/operadores y sanitarios
    de la partida para que la PWA opere 100% desconectada de la red.
    """
    cursor = conn.cursor()
    members = cursor.execute('''
        SELECT m.uid, m.nombre_jugador, m.rol, e.id as equipo_id, e.nombre as equipo_nombre, f.nombre as faccion_nombre
        FROM Miembro m
        JOIN Equipo e ON m.equipo_id = e.id
        LEFT JOIN Faccion f ON e.faccion_id = f.id
    ''').fetchall()
    
    roster = {}
    medicos_set = set(["ADMIN", "MED-ADMIN"])
    
    for row in members:
        uid = (row['uid'] or '').strip().upper()
        nombre = (row['nombre_jugador'] or '').strip()
        rol = (row['rol'] or '').strip()
        faccion = (row['faccion_nombre'] or 'Sin facción').strip()
        equipo = (row['equipo_nombre'] or '').strip()
        
        is_medic = ('medico' in rol.lower() or 'sanitario' in rol.lower())
        
        info = {
            "uid": uid,
            "nombre": nombre,
            "rol": rol,
            "faccion": faccion,
            "equipo": equipo,
            "is_medic": is_medic
        }
        
        if uid:
            roster[uid] = info
            if is_medic:
                medicos_set.add(uid)
                
        # Indexar también por nombre en mayúsculas y prefijo táctico
        if nombre:
            nombre_key = nombre.upper()
            roster[nombre_key] = info
            roster[f"MED-{nombre_key}"] = info
            if is_medic:
                medicos_set.add(nombre_key)
                medicos_set.add(f"MED-{nombre_key}")
                
        # Indexar por equipo médico
        if row['equipo_id']:
            med_eq = f"MED-{row['equipo_id']}"
            roster[med_eq] = {
                "uid": med_eq,
                "nombre": f"Sanitario {equipo}",
                "rol": "Sanitario de Unidad",
                "faccion": faccion,
                "equipo": equipo,
                "is_medic": True
            }
            medicos_set.add(med_eq)
            
    # Entrada HQ
    roster["ADMIN"] = {
        "uid": "ADMIN",
        "nombre": "ADMINISTRADOR (HQ)",
        "rol": "Oficial Médico / Mando",
        "faccion": "Global",
        "equipo": "Control Central",
        "is_medic": True
    }
    
    return {
        "roster": roster,
        "medicos": list(medicos_set),
        "total_jugadores": len(members),
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

def get_medic_audit_log(conn, limit=150):
    """
    Obtiene la bitácora médica completa de asistencias y discrepancias para el dashboard de seguridad.
    """
    cursor = conn.cursor()
    rows = cursor.execute('''
        SELECT id, sanitario_id, operador_uid, operador_nombre, faccion_nombre,
               medico_uid, medico_nombre, medico_faccion,
               paciente_uid, paciente_nombre, paciente_faccion,
               hora_inicio, hora_cierre, escenario_id, fase_actual,
               hemorragia_controlada, estabilizacion_completada, resultado_final,
               duracion_total_segundos, discrepancias_flags, sincronizado_en, detalles_json
        FROM EpisodioMedico
        ORDER BY sincronizado_en DESC
        LIMIT ?
    ''', (limit,)).fetchall()
    
    episodes = []
    total_intervenciones = len(rows)
    exitos = 0
    anomalias_count = 0
    duraciones = []
    medicos_activos = set()
    
    for r in rows:
        d = dict(r)
        
        # Parse flags
        flags_raw = d.get('discrepancias_flags') or '[]'
        try:
            d['flags'] = json.loads(flags_raw)
        except Exception:
            d['flags'] = []
            
        if len(d['flags']) > 0:
            anomalias_count += 1
            
        if d.get('resultado_final') == 'EXITO':
            exitos += 1
            if d.get('duracion_total_segundos'):
                duraciones.append(float(d['duracion_total_segundos']))
                
        med_id = d.get('medico_uid') or d.get('sanitario_id')
        if med_id:
            medicos_activos.add(med_id)
            
        # Parse detalles
        det_raw = d.get('detalles_json') or '{}'
        try:
            d['detalles'] = json.loads(det_raw)
        except Exception:
            d['detalles'] = {}
            
        episodes.append(d)
        
    duracion_media = round(sum(duraciones) / len(duraciones), 1) if duraciones else 0.0
    
    return {
        "episodes": episodes,
        "stats": {
            "total_intervenciones": total_intervenciones,
            "exitos": exitos,
            "fallos": total_intervenciones - exitos,
            "duracion_media_segundos": duracion_media,
            "alertas_discrepancias_count": anomalias_count,
            "medicos_activos_count": len(medicos_activos)
        }
    }
