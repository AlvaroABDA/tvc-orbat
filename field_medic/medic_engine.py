import os
import json
import sqlite3
import uuid
from datetime import datetime

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
            "ancho_zona_objetivo_pct": 22.0,
            "aciertos_requeridos": 4,
            "penalizacion_por_error_pct": 15.0,
            "progreso_por_acierto_pct": 25.0,
            "tiempo_limite_segundos": 60,
            "decay_pasivo_por_segundo_pct": 1.0
        },
        "fase1_neumotorax": {
            "velocidad_carga": 75.0,
            "velocidad_ciclo_ms": 1800,
            "zona_valvula_min": 65.0,
            "zona_valvula_max": 85.0,
            "aciertos_requeridos": 4,
            "penalizacion_por_error_pct": 15.0,
            "progreso_por_acierto_pct": 25.0,
            "tiempo_limite_segundos": 60
        },
        "fase1_torniquete": {
            "segmentos_totales": 8,
            "aciertos_requeridos": 4,
            "duracion_activacion_ms": 220,
            "intervalo_entre_activaciones_ms": 30,
            "penalizacion_por_error_pct": 10.0,
            "progreso_por_acierto_pct": 25.0,
            "tiempo_limite_segundos": 45
        },
        "fase1_sutura": {
            "puntos_requeridos": 6,
            "radio_objetivo_px": 30,
            "penalizacion_por_error_pct": 10.0,
            "tiempo_limite_segundos": 60
        },
        "fase2_estabilizacion": {
            "bpm_ritmo": 60,
            "tolerancia_ms": 180,
            "pulsaciones_requeridas": 8,
            "penalizacion_por_desfase_pct": 10.0,
            "progreso_por_latido_pct": 12.5,
            "tiempo_limite_segundos": 45
        },
        "fase2_constantes_rango": {
            "velocidad_marcador_ms": 1500,
            "ancho_zona_pct": 25.0,
            "aciertos_consecutivos_requeridos": 5,
            "penalizacion_por_error_pct": 20.0,
            "tiempo_limite_segundos": 50
        },
        "fase2_doble_indicador": {
            "velocidad_indicador_1_ms": 1600,
            "velocidad_indicador_2_ms": 2200,
            "ancho_zona_1_pct": 24.0,
            "ancho_zona_2_pct": 24.0,
            "aciertos_requeridos_por_barra": 4,
            "penalizacion_por_error_pct": 15.0,
            "tiempo_limite_segundos": 60
        },
        "fase2_secuencia_visual": {
            "rondas_totales": 3,
            "longitud_inicial": 3,
            "penalizacion_por_error_pct": 20.0,
            "tiempo_limite_segundos": 60
        },
        "fase2_correccion_linea": {
            "velocidad_desviacion": 35.0,
            "fuerza_correccion": 65.0,
            "margen_tolerancia_pct": 25.0,
            "segundos_en_rango_requeridos": 6.0,
            "tiempo_limite_segundos": 50
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
            sanitario_id TEXT NOT NULL,         -- Identificador del médico (ej: UID o ID equipo)
            operador_uid TEXT NOT NULL,         -- UID del carnet del operador atendido
            operador_nombre TEXT,               -- Nombre o indicativo del operador
            faccion_nombre TEXT,                -- Bando del operador
            escenario_id TEXT DEFAULT 'HEMORRAGIA_ACTIVA',
            fase_actual TEXT NOT NULL,          -- hemorrhage_control, patient_stabilization, completed
            hemorragia_controlada BOOLEAN DEFAULT 0,
            estabilizacion_completada BOOLEAN DEFAULT 0,
            resultado_final TEXT,               -- EXITO, FALLO, ABORTADO
            duracion_total_segundos REAL DEFAULT 0,
            sincronizado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
            detalles_json TEXT                  -- Métricas opcionales y telemetría de juego
        )
    ''')
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
    Si el episodio ya fue procesado, no descuenta reanimaciones ni duplica datos.
    """
    episode_id = payload.get('episode_id')
    if not episode_id:
        return {"status": "error", "message": "Falta episode_id"}, 400
        
    sanitario_id = str(payload.get('sanitario_id', 'MEDICO_DESCONOCIDO'))
    operador_uid = str(payload.get('operador_uid', 'OPERADOR_DESCONOCIDO'))
    operador_nombre = payload.get('operador_nombre', 'DESCONOCIDO')
    faccion_nombre = payload.get('faccion_nombre', '')
    escenario_id = payload.get('escenario_id', 'HEMORRAGIA_ACTIVA')
    fase_actual = payload.get('fase_actual', 'completed')
    hemorragia_controlada = bool(payload.get('hemorragia_controlada', False))
    estabilizacion_completada = bool(payload.get('estabilizacion_completada', False))
    resultado_final = payload.get('resultado_final', 'EXITO')
    duracion = float(payload.get('duracion_total_segundos', 0.0))
    detalles_json = json.dumps(payload.get('detalles', {}))
    
    cursor = conn.cursor()
    
    # Comprobar si ya existe el episodio (IDEMPOTENCIA)
    existente = cursor.execute('SELECT * FROM EpisodioMedico WHERE id = ?', (episode_id,)).fetchone()
    if existente:
        recursos = get_or_create_sanitario_recursos(conn, sanitario_id)
        return {
            "status": "success",
            "message": "Episodio ya sincronizado previamente (idempotente).",
            "reanimaciones_disponibles": recursos["reanimaciones_disponibles"],
            "already_synced": True
        }, 200
        
    # Insertar el nuevo episodio
    cursor.execute('''
        INSERT INTO EpisodioMedico (
            id, sanitario_id, operador_uid, operador_nombre, faccion_nombre,
            escenario_id, fase_actual, hemorragia_controlada, estabilizacion_completada,
            resultado_final, duracion_total_segundos, detalles_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        episode_id, sanitario_id, operador_uid, operador_nombre, faccion_nombre,
        escenario_id, fase_actual, hemorragia_controlada, estabilizacion_completada,
        resultado_final, duracion, detalles_json
    ))
    
    # Descontar 1 reanimación solo si la atención fue exitosa (ambas fases completas)
    recursos = get_or_create_sanitario_recursos(conn, sanitario_id)
    if resultado_final == 'EXITO' and hemorragia_controlada and estabilizacion_completada:
        nuevas_disponibles = max(0, recursos['reanimaciones_disponibles'] - 1)
        nuevas_usadas = recursos['reanimaciones_usadas'] + 1
        cursor.execute('''
            UPDATE MedicoRecursos
            SET reanimaciones_disponibles = ?, reanimaciones_usadas = ?, actualizado_en = CURRENT_TIMESTAMP
            WHERE sanitario_id = ?
        ''', (nuevas_disponibles, nuevas_usadas, sanitario_id))
        recursos['reanimaciones_disponibles'] = nuevas_disponibles
        recursos['reanimaciones_usadas'] = nuevas_usadas
        
    conn.commit()
    
    return {
        "status": "success",
        "message": "Episodio registrado correctamente.",
        "reanimaciones_disponibles": recursos["reanimaciones_disponibles"],
        "already_synced": False
    }, 200
