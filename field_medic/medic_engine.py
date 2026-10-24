import os
import json
import sqlite3
import uuid
from datetime import datetime, timezone

CONFIG_PATH = os.path.join(os.path.dirname(__file__), 'config.json')

def get_max_medicos_permitidos(miembros_count: int) -> int:
    """
    Doctrina táctica de unidades:
    - Hasta 8 miembros: máximo 1 médico
    - De 9 a 16 miembros: máximo 2 médicos
    - De 17 o más miembros: máximo 3 médicos
    """
    miembros = max(0, int(miembros_count or 0))
    if miembros <= 8:
        return 1
    elif miembros <= 16:
        return 2
    else:
        return 3

def calcular_curas_por_medico(miembros_count: int, medicos_count: int) -> int:
    """
    Metodología TVC para la cantidad de curas por médico:
    número de miembros de la escuadra // número de médicos asignados (redondeado a la baja).
    Ejemplos:
    - Escuadra de 14 miembros con 2 médicos -> 7 curas cada uno (14 // 2)
    - Escuadra de 14 miembros con 1 médico -> 14 curas (14 // 1)
    - Escuadra de 8 miembros con 1 médico -> 8 curas (8 // 1)
    """
    miembros = max(0, int(miembros_count or 0))
    medicos = max(0, int(medicos_count or 0))
    if medicos <= 0:
        return 0
    return max(1, miembros // medicos)

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
            detalles_json TEXT,                 -- Métricas opcionales y telemetría de juego
            es_buddy_aid BOOLEAN DEFAULT 0,    -- 1 si fue reanimación de médico por compañero
            asistente_uid TEXT,                -- UID del compañero socorrista
            asistente_nombre TEXT              -- Nombre del compañero socorrista
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
            ('discrepancias_flags', 'TEXT'),
            ('es_buddy_aid', 'BOOLEAN DEFAULT 0'),
            ('asistente_uid', 'TEXT'),
            ('asistente_nombre', 'TEXT')
        ]
        for col_name, col_type in migraciones:
            if col_name not in cols:
                cursor.execute(f"ALTER TABLE EpisodioMedico ADD COLUMN {col_name} {col_type}")
    except Exception as e:
        print("[Medic Engine] Info migración SQLite:", e)
        
    conn.commit()

def resolve_sanitario_id_and_aliases(conn, sanitario_id):
    """
    Resuelve el identificador canónico y la lista completa de alias (UID carnet, nombre, MED-nombre, equipo)
    para un sanitario dado, garantizando que el carnet QR de la PWA y el panel de administración
    accedan y descuenten exactamente el mismo recurso en MedicoRecursos.
    """
    ident = str(sanitario_id or '').strip()
    if not ident:
        return 'MED-GENERIC', ['MED-GENERIC']
    
    u = ident.upper()
    if u in ('ADMIN', 'MED-ADMIN'):
        return 'ADMIN', ['ADMIN', 'admin', 'MED-ADMIN', 'med-admin']
    
    cursor = conn.cursor()
    clean_name = ident[4:] if ident.upper().startswith('MED-') else ident
    m = None
    try:
        m = cursor.execute('''
            SELECT m.uid, m.nombre_jugador, e.id as equipo_id
            FROM Miembro m
            JOIN Equipo e ON m.equipo_id = e.id
            WHERE UPPER(m.uid) = ? 
               OR UPPER(m.nombre_jugador) = ? 
               OR UPPER('MED-' || m.nombre_jugador) = ?
               OR UPPER(m.nombre_jugador) = ?
               OR UPPER('MED-' || e.id) = ?
        ''', (u, u, u, clean_name.upper(), u)).fetchone()
    except sqlite3.OperationalError:
        # La tabla Miembro / Equipo puede no existir en bases de datos aisladas de test
        m = None
    
    if m:
        canonical = (m['uid'] or '').strip().upper() or f"MED-{m['nombre_jugador'].upper()}"
        aliases = set([canonical, ident, ident.upper()])
        if m['uid']:
            aliases.add(m['uid'].strip().upper())
            aliases.add(m['uid'].strip())
        if m['nombre_jugador']:
            nom = m['nombre_jugador'].strip()
            aliases.add(nom)
            aliases.add(nom.upper())
            aliases.add(f"MED-{nom.upper()}")
            aliases.add(f"MED-{nom}")
        if m['equipo_id']:
            aliases.add(f"MED-{m['equipo_id']}")
        return canonical, list(aliases)
    
    return ident, [ident, ident.upper(), ident.lower()]

def get_or_create_sanitario_recursos(conn, sanitario_id, default_reanim=None):
    """
    Obtiene los recursos restantes del sanitario o los inicializa si es su primera atención,
    sincronizando todos los alias vinculados (carnet QR, nombre táctico, ID de equipo).
    """
    if default_reanim is None:
        config = load_medic_config()
        default_reanim = config.get("reanimaciones_iniciales_medico", 3)
    
    canonical, aliases = resolve_sanitario_id_and_aliases(conn, sanitario_id)
    cursor = conn.cursor()
    
    # Buscar si existe ya algún registro para cualquiera de los alias
    placeholders = ', '.join(['?'] * len(aliases))
    row = cursor.execute(f'''
        SELECT sanitario_id, reanimaciones_disponibles, reanimaciones_usadas
        FROM MedicoRecursos
        WHERE UPPER(sanitario_id) IN ({placeholders})
        ORDER BY reanimaciones_usadas DESC, reanimaciones_disponibles DESC
        LIMIT 1
    ''', [a.upper() for a in aliases]).fetchone()
    
    if row:
        disponibles = row['reanimaciones_disponibles']
        usadas = row['reanimaciones_usadas']
    else:
        disponibles = 99 if canonical == 'ADMIN' else default_reanim
        usadas = 0
        
    # Sincronizar canonical y todos sus alias en MedicoRecursos para coherencia absoluta
    for a in aliases:
        cursor.execute('''
            INSERT INTO MedicoRecursos (sanitario_id, reanimaciones_disponibles, reanimaciones_usadas, actualizado_en)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(sanitario_id) DO UPDATE SET
                reanimaciones_disponibles = excluded.reanimaciones_disponibles,
                reanimaciones_usadas = excluded.reanimaciones_usadas,
                actualizado_en = CURRENT_TIMESTAMP
        ''', (a, disponibles, usadas))
    conn.commit()
    
    return {
        "sanitario_id": canonical,
        "reanimaciones_disponibles": disponibles,
        "reanimaciones_usadas": usadas
    }

def update_sanitario_recursos(conn, sanitario_id, disponibles, usadas=None):
    """
    Actualiza el cupo de reanimaciones disponibles y usadas para un sanitario y todos sus alias vinculados.
    """
    canonical, aliases = resolve_sanitario_id_and_aliases(conn, sanitario_id)
    cursor = conn.cursor()
    if usadas is None:
        rec = get_or_create_sanitario_recursos(conn, canonical)
        usadas = rec.get('reanimaciones_usadas', 0)
        
    for a in aliases:
        cursor.execute('''
            INSERT INTO MedicoRecursos (sanitario_id, reanimaciones_disponibles, reanimaciones_usadas, actualizado_en)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(sanitario_id) DO UPDATE SET
                reanimaciones_disponibles = excluded.reanimaciones_disponibles,
                reanimaciones_usadas = excluded.reanimaciones_usadas,
                actualizado_en = CURRENT_TIMESTAMP
        ''', (a, int(disponibles), int(usadas)))
    conn.commit()
    return {
        "sanitario_id": canonical,
        "reanimaciones_disponibles": int(disponibles),
        "reanimaciones_usadas": int(usadas)
    }

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
    
    es_buddy_aid = bool(payload.get('es_buddy_aid', False))
    asistente_uid = str(payload.get('asistente_uid') or '').strip()
    asistente_nombre = str(payload.get('asistente_nombre') or '').strip()
    asistente_faccion = str(payload.get('asistente_faccion') or '').strip()

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
    duracion = float(payload.get('duracion_total_segundos') or payload.get('duration_total_segundos') or 0.0)

    detalles = payload.get('detalles', {}) or {}
    if es_buddy_aid:
        detalles['es_buddy_aid'] = True
        detalles['asistente_uid'] = asistente_uid
        detalles['asistente_nombre'] = asistente_nombre
        detalles['asistente_faccion'] = asistente_faccion
    detalles_json = json.dumps(detalles)
    
    cursor = conn.cursor()
    
    # 1. Comprobar si ya existe el episodio (IDEMPOTENCIA)
    existente = cursor.execute('SELECT * FROM EpisodioMedico WHERE id = ?', (episode_id,)).fetchone()
    if existente:
        recursos = get_or_create_sanitario_recursos(conn, medico_uid)
        return {
            "status": "success",
            "message": "Episodio ya sincronizado previamente (idempotente).",
            "reanimaciones_disponibles": recursos["reanimaciones_disponibles"],
            "reanimaciones_usadas": recursos.get("reanimaciones_usadas", 0),
            "already_synced": True
        }, 200
        
    # 2. Análisis automático de Discrepancias / Banderas de Seguridad
    flags = []
    # (a) Duración anormalmente rápida (imposible con requisitos actuales < 25s)
    if duracion < 25.0 and resultado_final == 'EXITO':
        flags.append('FAST_DURATION')
        
    # (b) Intento de auto-curación o Reanimación de Compañero (Buddy Aid)
    if paciente_uid and medico_uid and paciente_uid.upper() == medico_uid.upper():
        if es_buddy_aid and asistente_uid and asistente_uid.upper() != paciente_uid.upper():
            flags.append('BUDDY_AID')
        else:
            flags.append('SELF_HEAL')
        
    # (c) Bando cruzado (asistencia médica a otra facción)
    faccion_verificar = asistente_faccion if (es_buddy_aid and asistente_faccion) else medico_faccion
    if paciente_faccion and faccion_verificar:
        pf = paciente_faccion.lower()
        mf = faccion_verificar.lower()
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
            resultado_final, duracion_total_segundos, discrepancias_flags, detalles_json,
            es_buddy_aid, asistente_uid, asistente_nombre
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        episode_id, medico_uid, paciente_uid, paciente_nombre, paciente_faccion,
        medico_uid, medico_nombre, medico_faccion,
        paciente_uid, paciente_nombre, paciente_faccion,
        str(hora_inicio), str(hora_cierre),
        escenario_id, fase_actual, hemorragia_controlada, estabilizacion_completada,
        resultado_final, duracion, discrepancias_json, detalles_json,
        1 if es_buddy_aid else 0, asistente_uid or None, asistente_nombre or None
    ))
    
    # 4. Descontar 1 reanimación al médico tratante si la atención fue exitosa
    recursos = get_or_create_sanitario_recursos(conn, medico_uid)
    if resultado_final == 'EXITO' and hemorragia_controlada and estabilizacion_completada:
        nuevas_disponibles = max(0, recursos['reanimaciones_disponibles'] - 1)
        nuevas_usadas = recursos['reanimaciones_usadas'] + 1
        recursos = update_sanitario_recursos(conn, medico_uid, nuevas_disponibles, nuevas_usadas)
        
    conn.commit()
    
    return {
        "status": "success",
        "message": "Episodio registrado correctamente.",
        "reanimaciones_disponibles": recursos["reanimaciones_disponibles"],
        "reanimaciones_usadas": recursos["reanimaciones_usadas"],
        "discrepancias": flags,
        "already_synced": False
    }, 200

def get_medic_roster_snapshot(conn):
    """
    Genera un diccionario ultraligero con todos los carnets/operadores y sanitarios
    de la partida para que la PWA opere 100% desconectada de la red.
    Incluye los cupos de reanimaciones disponibles sincronizados con el servidor y la doctrina TVC.
    """
    config = load_medic_config()
    default_reanim = config.get("reanimaciones_iniciales_medico", 3)
    cursor = conn.cursor()

    # Precomputar estadísticas por escuadra según metodología TVC
    squad_stats = {}
    try:
        eq_rows = cursor.execute('SELECT id, nombre FROM Equipo').fetchall()
        for eq in eq_rows:
            eq_id = eq['id']
            tot_row = cursor.execute('SELECT COUNT(*) FROM Miembro WHERE equipo_id = ?', (eq_id,)).fetchone()
            total_m = tot_row[0] if tot_row else 0
            med_row = cursor.execute("SELECT COUNT(*) FROM Miembro WHERE equipo_id = ? AND (LOWER(rol) LIKE '%medico%' OR LOWER(rol) LIKE '%sanitario%')", (eq_id,)).fetchone()
            meds_m = med_row[0] if med_row else 0
            max_meds = get_max_medicos_permitidos(total_m)
            curas = calcular_curas_por_medico(total_m, meds_m)
            stat_item = {
                'equipo_id': eq_id,
                'equipo_nombre': eq['nombre'],
                'miembros_count': total_m,
                'medicos_count': meds_m,
                'max_medicos_permitidos': max_meds,
                'excede_limite': meds_m > max_meds,
                'curas_por_medico': curas
            }
            squad_stats[str(eq_id)] = stat_item
    except Exception as e:
        print("[Medic Engine] Info squad_stats roster:", e)

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
        eq_id = row['equipo_id']
        st = squad_stats.get(str(eq_id), {})
        cupo_nominal = st.get('curas_por_medico', default_reanim)
        
        is_medic = ('medico' in rol.lower() or 'sanitario' in rol.lower())
        
        reanim_disp = default_reanim
        reanim_usad = 0
        if is_medic:
            rec = get_or_create_sanitario_recursos(conn, uid or nombre, default_reanim=cupo_nominal)
            reanim_disp = rec.get('reanimaciones_disponibles', cupo_nominal)
            reanim_usad = rec.get('reanimaciones_usadas', 0)
        
        info = {
            "uid": uid,
            "nombre": nombre,
            "rol": rol,
            "faccion": faccion,
            "equipo": equipo,
            "equipo_id": eq_id,
            "is_medic": is_medic,
            "cupo_nominal": cupo_nominal,
            "miembros_escuadra": st.get('miembros_count', 0),
            "medicos_escuadra": st.get('medicos_count', 0),
            "max_medicos_permitidos": st.get('max_medicos_permitidos', 1),
            "excede_limite_medicos": st.get('excede_limite', False),
            "reanimaciones_disponibles": reanim_disp,
            "reanimaciones_usadas": reanim_usad
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
                "equipo_id": eq_id,
                "is_medic": True,
                "cupo_nominal": cupo_nominal,
                "miembros_escuadra": st.get('miembros_count', 0),
                "medicos_escuadra": st.get('medicos_count', 0),
                "max_medicos_permitidos": st.get('max_medicos_permitidos', 1),
                "reanimaciones_disponibles": reanim_disp,
                "reanimaciones_usadas": reanim_usad
            }
            medicos_set.add(med_eq)
            
    # Entrada HQ
    rec_admin = get_or_create_sanitario_recursos(conn, 'ADMIN')
    roster["ADMIN"] = {
        "uid": "ADMIN",
        "nombre": "ADMINISTRADOR (HQ)",
        "rol": "Oficial Médico / Mando",
        "faccion": "Global",
        "equipo": "Control Central",
        "is_medic": True,
        "cupo_nominal": 99,
        "reanimaciones_disponibles": rec_admin.get('reanimaciones_disponibles', 99),
        "reanimaciones_usadas": rec_admin.get('reanimaciones_usadas', 0)
    }
    
    return {
        "roster": roster,
        "medicos": list(medicos_set),
        "total_jugadores": len(members),
        "squad_stats": squad_stats,
        "doctrina": {
            "reglas": "Hasta 8 miembros: 1 médico | 9 a 16 miembros: 2 médicos | 17+ miembros: 3 médicos",
            "formula": "miembros // medicos (redondeado a la baja)"
        },
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
               duracion_total_segundos, discrepancias_flags, sincronizado_en, detalles_json,
               es_buddy_aid, asistente_uid, asistente_nombre
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
            
        alertas_reales = [f for f in d['flags'] if f != 'BUDDY_AID']
        if len(alertas_reales) > 0:
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

def reset_all_medic_data(conn):
    """
    Purga completamente todos los registros de episodios e intervenciones médicas (EpisodioMedico)
    y restablece los recursos de todos los sanitarios (MedicoRecursos) a 0 usadas y cupo completo
    según la doctrina táctica TVC (miembros de escuadra // médicos asignados).
    """
    cursor = conn.cursor()
    # 1. Purgar historial de episodios
    cursor.execute('DELETE FROM EpisodioMedico')
    
    # 2. Purgar tabla de recursos para reconstrucción limpia
    cursor.execute('DELETE FROM MedicoRecursos')
    
    # 3. Recalcular y reasignar cupos nominales según doctrina
    count = 0
    medicos_db = []
    try:
        medicos_db = cursor.execute('''
            SELECT m.nombre_jugador, m.uid, e.id as equipo_id,
                   (SELECT COUNT(*) FROM Miembro m2 WHERE m2.equipo_id = e.id) as miembros_count,
                   (SELECT COUNT(*) FROM Miembro m3 WHERE m3.equipo_id = e.id AND (LOWER(m3.rol) LIKE '%medico%' OR LOWER(m3.rol) LIKE '%sanitario%')) as medicos_count
            FROM Miembro m
            JOIN Equipo e ON m.equipo_id = e.id
            WHERE LOWER(m.rol) LIKE '%medico%' OR LOWER(m.rol) LIKE '%sanitario%'
        ''').fetchall()
    except sqlite3.OperationalError:
        pass
        
    if medicos_db:
        for med in medicos_db:
            pax = med['miembros_count'] or 0
            meds_count = med['medicos_count'] or 1
            val = calcular_curas_por_medico(pax, meds_count)
            update_sanitario_recursos(conn, med['uid'] or med['nombre_jugador'], val, 0)
            count += 1
    else:
        try:
            equipos = cursor.execute('''
                SELECT e.id,
                       (SELECT COUNT(*) FROM Miembro m WHERE m.equipo_id = e.id) as miembros_count
                FROM Equipo e
            ''').fetchall()
            for eq in equipos:
                pax = eq['miembros_count'] or 0
                val = calcular_curas_por_medico(pax, 1)
                sanitario_id = f"MED-{eq['id']}"
                update_sanitario_recursos(conn, sanitario_id, val, 0)
                count += 1
        except sqlite3.OperationalError:
            pass
            
    # Asignar cupo infinito al Administrador / HQ
    update_sanitario_recursos(conn, 'ADMIN', 99, 0)
    conn.commit()
    
    return {
        "status": "success",
        "medicos_recargados": count,
        "message": f"Historial médico purgado y {count} sanitarios reiniciados según doctrina."
    }

def process_respawn_recharge(conn, token_qr, sanitario_id, user_lat=None, user_lng=None):
    """
    Valida la baliza de RESPAWN física, registra la inserción táctica del combatiente/sanitario
    en la tabla de Respawn y recarga sus botiquines de reanimación según la doctrina reglamentaria TVC.
    """
    clean_token = (token_qr or '').strip()
    if '/scan/' in clean_token:
        clean_token = clean_token.split('/scan/')[-1].split('?')[0].split('#')[0].strip()
    elif 'token=' in clean_token:
        import re
        m = re.search(r'[?&]token=([a-zA-Z0-9_-]+)', clean_token)
        if m:
            clean_token = m.group(1).strip()
    elif '/' in clean_token:
        clean_token = clean_token.split('/')[-1].split('?')[0].split('#')[0].strip()

    poi = conn.execute('SELECT * FROM puntos_interes WHERE token_qr = ?', (clean_token,)).fetchone()
    if not poi:
        return {'status': 'error', 'message': f'Baliza de Respawn no encontrada para el código QR ({clean_token}).'}, 404

    if poi['tipo'] != 'RESPAWN':
        return {
            'status': 'error',
            'poi_tipo': poi['tipo'],
            'poi_nombre': poi['nombre'],
            'token_qr': clean_token,
            'redirect_url': f'/scan/{clean_token}',
            'message': f'La baliza "{poi["nombre"]}" es de tipo {poi["tipo"]}, no es un punto de RESPAWN autorizado.'
        }, 400

    # Validación GPS si está activa en la configuración general
    import math
    def haversine_m(lat1, lon1, lat2, lon2):
        R = 6371000
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        delta_phi = math.radians(lat2 - lat1)
        delta_lambda = math.radians(lon2 - lon1)
        a = math.sin(delta_phi / 2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2)**2
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'config.json')
    geo_enabled = False
    if os.path.exists(config_path):
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                cdata = json.load(f)
                geo_enabled = bool(cdata.get('geo_validation_enabled'))
        except Exception:
            pass

    if geo_enabled:
        if user_lat is None or user_lng is None:
            return {'status': 'error', 'message': 'Se requiere ubicación GPS activa para validar la presencia física en el Respawn.'}, 400
        dist = haversine_m(float(user_lat), float(user_lng), float(poi['lat']), float(poi['lng']))
        tol = float(poi['tolerancia_metros']) if poi['tolerancia_metros'] else 15.0
        if dist > tol:
            return {'status': 'error', 'message': f'Estás demasiado lejos de la baliza de Respawn ({int(dist)}m > {int(tol)}m). Acércate a la base.'}, 400

    # Comprobación de requisitos de bases avanzadas
    if poi['datos_extra']:
        try:
            datos = json.loads(poi['datos_extra'])
            reqs = datos.get('requisitos_captura', {})
            fac_req = str(poi['faccion_id'])
            if fac_req in reqs:
                required_pc_ids = reqs[fac_req]
                if required_pc_ids:
                    placeholders = ','.join('?' for _ in required_pc_ids)
                    pcs = conn.execute(f"SELECT id, nombre, faccion_id FROM puntos_interes WHERE id IN ({placeholders})", required_pc_ids).fetchall()
                    faltan = [pc['nombre'] for pc in pcs if pc['faccion_id'] != poi['faccion_id']]
                    if faltan:
                        return {'status': 'error', 'message': f'Base comprometida. Requiere control previo de: {", ".join(faltan)}'}, 403
        except Exception as e:
            print("[Respawn Recharge] Error en datos_extra:", e)

    # Resolución del sanitario y su dotación reglamentaria
    canonical, aliases = resolve_sanitario_id_and_aliases(conn, sanitario_id)
    
    cursor = conn.cursor()
    m = None
    try:
        m = cursor.execute('''
            SELECT m.id, m.uid, m.nombre_jugador, m.equipo_id, e.nombre as equipo_nombre, e.faccion_id,
                   (SELECT COUNT(*) FROM Miembro m2 WHERE m2.equipo_id = e.id) as miembros_count,
                   (SELECT COUNT(*) FROM Miembro m3 WHERE m3.equipo_id = e.id AND (LOWER(m3.rol) LIKE '%medico%' OR LOWER(m3.rol) LIKE '%sanitario%')) as medicos_count
            FROM Miembro m
            JOIN Equipo e ON m.equipo_id = e.id
            WHERE UPPER(m.uid) = ? OR UPPER(m.nombre_jugador) = ?
        ''', (canonical.upper(), canonical.upper())).fetchone()
    except sqlite3.OperationalError:
        m = None

    faccion_id = poi['faccion_id']
    equipo_id = None
    if m:
        equipo_id = m['equipo_id']
        # Comprobar bando: no se permite respawn en base enemiga
        if poi['faccion_id'] and m['faccion_id'] and poi['faccion_id'] != m['faccion_id']:
            return {'status': 'error', 'message': f'Baliza de RESPAWN enemiga ({poi["nombre"]}). Despliegue y recarga denegados para tu facción.'}, 403
        faccion_id = m['faccion_id'] or poi['faccion_id']
        quota = calcular_curas_por_medico(m['miembros_count'], m['medicos_count'])
    else:
        med_cfg = load_medic_config()
        quota = med_cfg.get('reanimaciones_iniciales_medico', 3)
        if canonical.upper() == 'ADMIN':
            quota = 99

    # 1. Registrar inserción en la tabla de respawn
    cursor.execute('INSERT INTO respawn (poi_id, faccion_id, equipo_id) VALUES (?, ?, ?)', (poi['id'], faccion_id, equipo_id))

    # 2. Recargar recursos de reanimación del sanitario
    update_sanitario_recursos(conn, canonical, disponibles=quota, usadas=0)
    conn.commit()

    return {
        'status': 'success',
        'message': f'Despliegue confirmado en {poi["nombre"]}. Botiquines restablecidos a {quota} curas reglamentarias.',
        'reanimaciones_disponibles': quota,
        'poi_id': poi['id'],
        'poi_nombre': poi['nombre'],
        'faccion_id': faccion_id,
        'equipo_id': equipo_id,
        'sanitario_id': canonical
    }, 200


