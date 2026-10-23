from flask import Flask, render_template, request, jsonify, session, redirect, url_for, g, send_from_directory, make_response, has_app_context
import sqlite3
import os
import glob
from PIL import Image, ImageOps
import secrets
import time
from datetime import datetime, timedelta
import dynamic_targets_engine
import imint_engine
import op_dinamico_engine
from field_medic import medic_engine
import math
import json

def calculate_azimuth(lat_origin, lng_origin, lat_target, lng_target):
    dy = float(lat_target) - float(lat_origin)
    dx = float(lng_target) - float(lng_origin)
    azimut = math.degrees(math.atan2(dx, dy))
    if azimut < 0:
        azimut += 360
    return azimut

def haversine(lat1, lon1, lat2, lon2):
    R = 6371000 # Radio de la Tierra en metros
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def get_config():
    config_path = os.path.join(os.path.dirname(__file__), 'data', 'config.json')
    if os.path.exists(config_path):
        import json
        with open(config_path, 'r') as f:
            try:
                return json.load(f)
            except:
                pass
    return {"geo_validation_enabled": False}

def set_config(config_data):
    config_path = os.path.join(os.path.dirname(__file__), 'data', 'config.json')
    import json
    with open(config_path, 'w') as f:
        json.dump(config_data, f)

class GPSMapper:
    def __init__(self):
        u1, v1 = -6.256770847102261, 41.95586014650798
        x1, y1 = 1244.75, 1139
        
        u2, v2 = -6.2679631830511005, 41.95764427861231
        x2, y2 = 674, 1257.75
        
        u3, v3 = -6.2547713027579865, 41.96462525160695
        x3, y3 = 1343.75, 1727.75
        
        det = u1*(v2 - v3) - v1*(u2 - u3) + (u2*v3 - u3*v2)
        
        self.A = (x1*(v2 - v3) - v1*(x2 - x3) + (x2*v3 - x3*v2)) / det
        self.B = (u1*(x2 - x3) - x1*(u2 - u3) + (u2*x3 - u3*x2)) / det
        self.C = x1 - self.A * u1 - self.B * v1
        
        self.D = (y1*(v2 - v3) - v1*(y2 - y3) + (y2*v3 - y3*v2)) / det
        self.E = (u1*(y2 - y3) - y1*(u2 - u3) + (u2*y3 - u3*y2)) / det
        self.F = y1 - self.D * u1 - self.E * v1

    def gps_to_map(self, lat, lng):
        x = self.A * lng + self.B * lat + self.C
        y = self.D * lng + self.E * lat + self.F
        return y, x

    def get_grid_coordinate(self, map_lat, map_lng):
        canvas_y = 2000.0 - float(map_lat)
        canvas_x = float(map_lng)
        origin_x = 66.15
        origin_y = 59.5
        grid_size_x = 31.71
        grid_size_y = 29.9435

        col_idx = math.floor((canvas_x - origin_x) / grid_size_x) + 1
        row_idx = math.floor((canvas_y - origin_y) / grid_size_y) + 1

        if col_idx < 1 or row_idx < 1 or col_idx > 100 or row_idx > 100:
            return "FUERA MAPA"

        first_letter = chr(65 + math.floor((col_idx - 1) / 26))
        second_letter = chr(65 + ((col_idx - 1) % 26))
        letters = first_letter + second_letter
        numbers = str(row_idx).zfill(2)

        frac_x = ((canvas_x - origin_x) % grid_size_x) / grid_size_x
        frac_y = ((canvas_y - origin_y) % grid_size_y) / grid_size_y

        if 0.33 < frac_x < 0.67 and 0.33 < frac_y < 0.67:
            sub = "C"
        else:
            sub = ("N" if frac_y < 0.5 else "S") + ("O" if frac_x < 0.5 else "E")

        return f"{letters}{numbers}-{sub}"

gps_mapper = GPSMapper()


app = Flask(__name__)
app.secret_key = 'tvc-milsim-secret-key-2026'
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # Máximo 10 MB por subida

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'El archivo excede el tamaño máximo permitido de 10 MB'}), 413

def clean_old_files(directory, pattern):
    """Elimina archivos previos para asegurar que solo exista uno por entidad en disco."""
    try:
        for f in glob.glob(os.path.join(directory, pattern)):
            if os.path.isfile(f):
                os.remove(f)
    except Exception as e:
        print(f"Error limpiando archivos en {directory}: {e}")

def save_optimized_image(file_storage, target_filepath, max_dim=1200):
    """
    Normaliza la orientación EXIF de fotos móviles y redimensiona/comprime
    para evitar saturación de almacenamiento y consumo excesivo de ancho de banda.
    """
    img = Image.open(file_storage)
    img = ImageOps.exif_transpose(img)
    img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
    
    ext = os.path.splitext(target_filepath)[1].lower()
    if ext in ['.jpg', '.jpeg', '.jfif']:
        if img.mode in ('RGBA', 'LA', 'P'):
            bg = Image.new('RGB', img.size, (255, 255, 255))
            if img.mode == 'P':
                img = img.convert('RGBA')
            bg.paste(img, mask=img.split()[-1] if 'A' in img.getbands() else None)
            img = bg
        else:
            img = img.convert('RGB')
        img.save(target_filepath, 'JPEG', quality=85, optimize=True)
    elif ext == '.png':
        img.save(target_filepath, 'PNG', optimize=True)
    elif ext == '.webp':
        img.save(target_filepath, 'WEBP', quality=85)
    else:
        file_storage.seek(0)
        file_storage.save(target_filepath)

DB_PATH = os.path.join(os.path.dirname(__file__), 'data', 'orbat.db')

MINIGAME_PASSWORDS = {
    'mortero': {
        'Syldavia': 'fuego-syl',
        'Volkovia': 'fuego-vol',
        'Khemed': 'fuego-khd'
    },
    'telemetro_recon': {
        'Syldavia': 'recon-syl',
        'Volkovia': 'recon-vol',
        'Khemed': 'recon-khd'
    },
    'simulador_aaa': {
        'Syldavia': 'aaa-syl',
        'Volkovia': 'aaa-vol',
        'Khemed': 'aaa-khd'
    }
}

DEFAULT_JUEGOS_CONFIG = {
    'simulador_aaa': {
        'nombre': 'Defensa Antiaérea (AAA / Radar & Cañón)',
        'subtitulo': 'Binomio Radar PPI 360° + Lanzador AR FOX-1',
        'icono': 'radar',
        'color': '#ff4444',
        'activo': 1,
        'passwords': {
            'Syldavia': 'aaa-syl',
            'Volkovia': 'aaa-vol',
            'Khemed': 'aaa-khd'
        },
        'parametros': {
            'clutter_count': 5,
            'cooldown_disparo_sec': 4,
            'phosphor_decay_sec': 2.2,
            'sector_scan_angle': 30
        }
    },
    'mortero': {
        'nombre': 'Batería de Artillería (Mortero Balístico)',
        'subtitulo': 'Cálculo Balístico de Fuego Indirecto (45°-85°)',
        'icono': 'rocket_launch',
        'color': '#ff5566',
        'activo': 1,
        'passwords': {
            'Syldavia': 'fuego-syl',
            'Volkovia': 'fuego-vol',
            'Khemed': 'fuego-khd'
        },
        'parametros': {
            'alcance_base': 800,
            'radio_explosion': 15,
            'disparos_por_minuto': 5,
            'duracion_radar_minutos': 15
        }
    },
    'telemetro_recon': {
        'nombre': 'Telémetro Recon (Designación Láser)',
        'subtitulo': 'Exploración IMINT, Puntos OP y Marcación GPS',
        'icono': 'location_searching',
        'color': '#00f0ff',
        'activo': 1,
        'passwords': {
            'Syldavia': 'recon-syl',
            'Volkovia': 'recon-vol',
            'Khemed': 'recon-khd'
        },
        'parametros': {
            'tolerancia_metros': 25,
            'duracion_marca_minutos': 10,
            'alcance_max_metros': 1500
        }
    },
    'prismaticos_ar': {
        'nombre': 'Prismáticos Tácticos AR (Visor Realidad Aumentada)',
        'subtitulo': 'Visor Holográfico AR de Puntos de Interés (POI)',
        'icono': 'view_in_ar',
        'color': '#2ecc71',
        'activo': 1,
        'passwords': {
            'Syldavia': 'ar-syl',
            'Volkovia': 'ar-vol',
            'Khemed': 'ar-khd'
        },
        'parametros': {
            'radio_deteccion_metros': 50,
            'tolerancia_azimut_grados': 15,
            'fov_grados': 60
        }
    },
    'field_medic': {
        'nombre': 'Field Medic (Sanitario de Combate PWA)',
        'subtitulo': 'Suite Médica Offline, Triage QR y Reanimaciones',
        'icono': 'medical_services',
        'color': '#2ecc71',
        'activo': 1,
        'passwords': {
            'Syldavia': 'med-syl',
            'Volkovia': 'med-vol',
            'Khemed': 'med-khd'
        },
        'parametros': {
            'reanimaciones_iniciales': 3,
            'tiempo_minimo_cura_sec': 25,
            'permitir_autocuracion': 0,
            'pin_reset': '4747'
        }
    }
}

def ensure_juego_config_tables(conn):
    try:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS juego_config (
                juego_id TEXT PRIMARY KEY,
                nombre TEXT NOT NULL,
                subtitulo TEXT DEFAULT '',
                icono TEXT DEFAULT 'sports_esports',
                color TEXT DEFAULT '#00f0ff',
                activo INTEGER DEFAULT 1,
                passwords_json TEXT NOT NULL,
                parametros_json TEXT NOT NULL,
                actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        for jid, d_cfg in DEFAULT_JUEGOS_CONFIG.items():
            row = conn.execute('SELECT juego_id FROM juego_config WHERE juego_id = ?', (jid,)).fetchone()
            if not row:
                conn.execute('''
                    INSERT INTO juego_config (juego_id, nombre, subtitulo, icono, color, activo, passwords_json, parametros_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    jid,
                    d_cfg['nombre'],
                    d_cfg.get('subtitulo', ''),
                    d_cfg.get('icono', 'sports_esports'),
                    d_cfg.get('color', '#00f0ff'),
                    d_cfg['activo'],
                    json.dumps(d_cfg['passwords']),
                    json.dumps(d_cfg['parametros'])
                ))
        conn.commit()
    except Exception as e:
        print("Error en ensure_juego_config_tables:", e)

def get_all_juegos_config(conn=None):
    close_at_end = False
    if conn is None:
        conn = get_db_connection()
        close_at_end = not has_app_context()
    try:
        ensure_juego_config_tables(conn)
        rows = conn.execute('SELECT * FROM juego_config ORDER BY rowid ASC').fetchall()
        result = {}
        for r in rows:
            jid = r['juego_id']
            d_fallback = DEFAULT_JUEGOS_CONFIG.get(jid, {})
            try:
                pwds = json.loads(r['passwords_json']) if r['passwords_json'] else {}
            except Exception:
                pwds = d_fallback.get('passwords', {})
            try:
                params = json.loads(r['parametros_json']) if r['parametros_json'] else {}
            except Exception:
                params = d_fallback.get('parametros', {})
            result[jid] = {
                'juego_id': jid,
                'nombre': r['nombre'],
                'subtitulo': r['subtitulo'] or d_fallback.get('subtitulo', ''),
                'icono': r['icono'] or d_fallback.get('icono', 'sports_esports'),
                'color': r['color'] or d_fallback.get('color', '#00f0ff'),
                'activo': bool(r['activo']),
                'passwords': pwds,
                'parametros': params,
                'actualizado_en': r['actualizado_en']
            }
        return result
    finally:
        if close_at_end:
            conn.close()

def get_juego_config(juego_id, conn=None):
    all_cfg = get_all_juegos_config(conn)
    if juego_id in all_cfg:
        return all_cfg[juego_id]
    d = DEFAULT_JUEGOS_CONFIG.get(juego_id, {})
    return {
        'juego_id': juego_id,
        'nombre': d.get('nombre', juego_id),
        'subtitulo': d.get('subtitulo', ''),
        'icono': d.get('icono', 'sports_esports'),
        'color': d.get('color', '#00f0ff'),
        'activo': bool(d.get('activo', 1)),
        'passwords': d.get('passwords', {}),
        'parametros': d.get('parametros', {})
    }

def is_juego_activo(juego_id, conn=None):
    cfg = get_juego_config(juego_id, conn)
    return bool(cfg.get('activo', True))

def get_juego_param(juego_id, param_name, default=None):
    cfg = get_juego_config(juego_id)
    return cfg.get('parametros', {}).get(param_name, default)

def set_juego_status(juego_id, activo, conn=None):
    close_at_end = False
    if conn is None:
        conn = get_db_connection()
        close_at_end = not has_app_context()
    try:
        ensure_juego_config_tables(conn)
        val = 1 if activo else 0
        conn.execute('UPDATE juego_config SET activo = ?, actualizado_en = CURRENT_TIMESTAMP WHERE juego_id = ?', (val, juego_id))
        conn.commit()
        return val
    finally:
        if close_at_end:
            conn.close()

def save_juego_full_config(juego_id, data, conn=None):
    close_at_end = False
    if conn is None:
        conn = get_db_connection()
        close_at_end = not has_app_context()
    try:
        ensure_juego_config_tables(conn)
        cur = get_juego_config(juego_id, conn)
        nombre = data.get('nombre', cur['nombre'])
        activo = 1 if data.get('activo', cur['activo']) else 0
        passwords = data.get('passwords', cur['passwords'])
        parametros = data.get('parametros', cur['parametros'])

        conn.execute('''
            UPDATE juego_config
            SET nombre = ?, activo = ?, passwords_json = ?, parametros_json = ?, actualizado_en = CURRENT_TIMESTAMP
            WHERE juego_id = ?
        ''', (nombre, activo, json.dumps(passwords), json.dumps(parametros), juego_id))
        conn.commit()

        if juego_id == 'mortero':
            try:
                ensure_artilleria_tables(conn)
                conn.execute('''
                    UPDATE Mortero_Config
                    SET alcance_base = ?, radio_explosion = ?, disparos_por_minuto = ?, duracion_radar_minutos = ?
                    WHERE id = 1
                ''', (
                    int(parametros.get('alcance_base', 800)),
                    int(parametros.get('radio_explosion', 15)),
                    int(parametros.get('disparos_por_minuto', 5)),
                    int(parametros.get('duracion_radar_minutos', 15))
                ))
                conn.commit()
            except Exception as e:
                print("Error sincronizando Mortero_Config:", e)
        return True
    finally:
        if close_at_end:
            conn.close()

ADMIN_USERS = {
    'admin': {'password': '4747', 'role': 'admin', 'faction': 'All'}
}

def get_db_connection():
    if not has_app_context():
        conn = sqlite3.connect(DB_PATH, timeout=20)
        try:
            conn.execute('PRAGMA journal_mode=WAL;')
        except sqlite3.OperationalError:
            pass
        conn.row_factory = sqlite3.Row
        return conn

    db = getattr(g, 'db', None)
    if db is not None:
        try:
            db.total_changes
            return db
        except (sqlite3.ProgrammingError, sqlite3.OperationalError):
            g.pop('db', None)
            
    g.db = sqlite3.connect(DB_PATH, timeout=20)
    try:
        g.db.execute('PRAGMA journal_mode=WAL;')
    except sqlite3.OperationalError:
        pass # Ignore if locked during PRAGMA
    g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, 'db', None)
    if db is not None:
        try:
            db.close()
        except Exception:
            pass
        g.pop('db', None)

@app.after_request
def add_header(response):
    if not request.path.startswith('/static/'):
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, post-check=0, pre-check=0, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '-1'
    return response

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        usuario = request.form.get('usuario', '').strip().lower()
        password = request.form.get('password', '').strip()
        
        # 1. Check Admin Users
        if usuario in ADMIN_USERS and ADMIN_USERS[usuario]['password'] == password:
            session.permanent = (request.form.get('remember_me') == 'yes')
            session['faction'] = ADMIN_USERS[usuario]['faction']
            session['role'] = ADMIN_USERS[usuario]['role']
            return redirect(url_for('index'))
            
        # 2. Check Equipos (Teams) & 3. Check Operador Individual
        if usuario and password:
            conn = get_db_connection()
            eq = conn.execute('''
                SELECT e.id, e.nombre, e.password_hash, e.estado_sancion, e.faccion_id, f.nombre as faccion_nombre, f.color as faccion_color
                FROM Equipo e 
                JOIN Faccion f ON e.faccion_id = f.id 
                WHERE LOWER(e.codigo) = LOWER(?) AND e.codigo != '' AND e.codigo IS NOT NULL
            ''', (usuario,)).fetchone()
            
            if eq:
                # Support both plaintext and legacy hashed passwords
                from werkzeug.security import check_password_hash
                is_valid = False
                if eq['password_hash'] == password:
                    is_valid = True
                elif eq['password_hash'] and eq['password_hash'].startswith('pbkdf2:sha256:') and check_password_hash(eq['password_hash'], password):
                    is_valid = True
                if is_valid:
                    if eq['estado_sancion'] in ['Sancionado', 'Expulsado', 'Inactivo']:
                        conn.close()
                        return render_template('login.html', error=f"ACCESO DENEGADO: El equipo se encuentra {eq['estado_sancion'].upper()}")
                        
                    session.permanent = (request.form.get('remember_me') == 'yes')
                    session['faction'] = eq['faccion_nombre']
                    session['faccion_id'] = eq['faccion_id']
                    session['faccion_color'] = eq['faccion_color']
                    session['role'] = 'equipo'
                    session['equipo_id'] = eq['id']
                    session['equipo_nombre'] = eq['nombre']
                    conn.close()
                    return redirect(url_for('index'))

            # 3. Check Operador Individual (Nick + PIN = PIN personalizado o 4 primeros dígitos de su DNI)
            if len(password) >= 4:
                candidatos = conn.execute('''
                    SELECT m.*, e.nombre as equipo_nombre, e.estado_sancion, e.faccion_id,
                           f.nombre as faccion_nombre, f.color as faccion_color
                    FROM Miembro m
                    JOIN Equipo e ON m.equipo_id = e.id
                    JOIN Faccion f ON e.faccion_id = f.id
                    WHERE LOWER(TRIM(m.nombre_jugador)) = ? AND m.activo = 1
                ''', (usuario,)).fetchall()
                
                operador_valido = None
                for cand in candidatos:
                    custom_pin = str(cand['pin'] or '').strip()
                    dni_clean = ''.join(c for c in (cand['dni'] or '') if c.isdigit())
                    if custom_pin:
                        if custom_pin == password:
                            operador_valido = cand
                            break
                    elif len(dni_clean) >= 4 and dni_clean[:4] == password:
                        operador_valido = cand
                        break
                        
                if operador_valido:
                    if operador_valido['estado_sancion'] in ['Sancionado', 'Expulsado', 'Inactivo']:
                        conn.close()
                        return render_template('login.html', error=f"ACCESO DENEGADO: Tu equipo se encuentra {operador_valido['estado_sancion'].upper()}")
                        
                    session.permanent = (request.form.get('remember_me') == 'yes')
                    session['faction'] = operador_valido['faccion_nombre']
                    session['faccion_id'] = operador_valido['faccion_id']
                    session['faccion_color'] = operador_valido['faccion_color']
                    session['role'] = 'operador'
                    session['miembro_id'] = operador_valido['id']
                    session['miembro_uid'] = operador_valido['uid']
                    session['miembro_nick'] = operador_valido['nombre_jugador']
                    session['miembro_rol'] = operador_valido['rol'] or 'Operador'
                    session['equipo_id'] = operador_valido['equipo_id']
                    session['equipo_nombre'] = operador_valido['equipo_nombre']
                    session['sanitario_id'] = operador_valido['uid']
                    
                    rol_lower = (operador_valido['rol'] or '').lower()
                    if any(w in rol_lower for w in ['medico', 'médico', 'sanitario', 'medic']):
                        session['is_medic'] = True
                        if 'unlocked_minigames' not in session:
                            session['unlocked_minigames'] = []
                        if 'medic' not in session['unlocked_minigames']:
                            session['unlocked_minigames'].append('medic')
                    else:
                        session['is_medic'] = False
                        
                    conn.close()
                    return redirect(url_for('operador_portal'))
            
            conn.close()
            
        return render_template('login.html', error='Credenciales incorrectas o no autorizadas')
    return render_template('login.html')

@app.route('/api/auth_minigame', methods=['POST'])
def auth_minigame():
    if 'role' not in session or 'faction' not in session:
        return jsonify({'success': False, 'message': 'No autorizado'}), 403
        
    data = request.json or {}
    minigame = data.get('minigame')
    password = data.get('password', '').strip()
    faction = session['faction']
    
    if session.get('role') == 'admin':
        return jsonify({'success': True})
        
    if not is_juego_activo(minigame):
        return jsonify({'success': False, 'message': 'JUEGO DESACTIVADO: Este sistema táctico está temporalmente fuera de servicio por Dirección de Operaciones.'}), 403

    cfg = get_juego_config(minigame)
    dyn_passwords = cfg.get('passwords', {})
    expected_pwd = dyn_passwords.get(faction, '').strip().lower()
    
    is_valid = False
    if expected_pwd and password.lower() == expected_pwd:
        is_valid = True
    elif minigame == 'simulador_aaa' and password.lower() in [expected_pwd, 'aaavolk', 'aaa-syl', 'aaa-vol', 'aaa-khd', 'aaa']:
        is_valid = True
    elif minigame in MINIGAME_PASSWORDS and faction in MINIGAME_PASSWORDS[minigame]:
        if password.lower() == MINIGAME_PASSWORDS[minigame][faction].lower():
            is_valid = True

    if is_valid:
        if 'unlocked_minigames' not in session:
            session['unlocked_minigames'] = []
        if minigame not in session['unlocked_minigames']:
            session['unlocked_minigames'].append(minigame)
            session.modified = True
        return jsonify({'success': True})
            
    return jsonify({'success': False, 'message': 'Código incorrecto'}), 401

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

@app.route('/')
def index():
    if 'role' not in session:
        return redirect(url_for('login'))
        
    if session.get('role') == 'operador':
        return redirect(url_for('operador_portal'))
        
    conn = get_db_connection()
    op = conn.execute('SELECT nombre FROM Operacion WHERE id=1').fetchone()
    operacion_nombre = op['nombre'] if op else "Operación Desconocida"
    conn.close()
    
    return render_template('index.html', 
                           user_role=session['role'], 
                           user_faction=session['faction'],
                           operacion_nombre=operacion_nombre,
                           unlocked_minigames=session.get('unlocked_minigames', []))

@app.route('/api/admin/operacion', methods=['POST'])
def update_operacion():
    if session.get('role') != 'admin': return jsonify({'error': 'Unauthorized'}), 403
    data = request.json
    conn = get_db_connection()
    conn.execute('UPDATE Operacion SET nombre = ? WHERE id = 1', (data.get('nombre', ''),))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})

@app.route('/mortero_app')
def mortero_app():
    if 'role' not in session:
        return redirect(url_for('login'))
    if not is_juego_activo('mortero') and session.get('role') != 'admin':
        return redirect(url_for('simulacion_menu'))
    conn = get_db_connection()
    config = conn.execute('SELECT alcance_base FROM Mortero_Config WHERE id=1').fetchone()
    alcance_base = config['alcance_base'] if config else 800
    
    return render_template('mortero_app.html', 
                           user_role=session['role'], 
                           user_faction=session['faction'],
                           equipo_id=session.get('equipo_id'),
                           alcance_base=alcance_base)

@app.route('/simulacion')
def simulacion_menu():
    if 'role' not in session:
        return redirect(url_for('login'))
    conn = get_db_connection()
    try:
        user_role = session.get('role', 'player')
        user_faction = session.get('faction')
        equipo_id = session.get('equipo_id')
        sanitario_id = 'ADMIN' if user_role == 'admin' else (session.get('sanitario_id') or session.get('user') or (f"MED-{equipo_id}" if equipo_id else "MED-ALFA"))
        recursos = medic_engine.get_or_create_sanitario_recursos(conn, sanitario_id)
        reanim_disp = recursos.get('reanimaciones_disponibles', 3)
        unlocked = list(session.get('unlocked_minigames', []))
        if session.get('is_medic') and 'medic' not in unlocked:
            unlocked.append('medic')
        all_juegos = get_all_juegos_config(conn)
        juegos_estado = {jid: cfg['activo'] for jid, cfg in all_juegos.items()}
    finally:
        conn.close()
    return render_template('simulacion_menu.html',
                           user_role=user_role,
                           user_faction=user_faction,
                           unlocked_minigames=unlocked,
                           reanimaciones_disponibles=reanim_disp,
                           sanitario_id=sanitario_id,
                           is_medic=session.get('is_medic', False),
                           juegos_estado=juegos_estado)

@app.route('/prismaticos')
@app.route('/prismaticos_ar')
@app.route('/visor_ar')
def prismaticos_ar():
    if 'role' not in session:
        return redirect(url_for('login'))
    user_role = session.get('role', 'player')
    user_faction = session.get('faction')
    equipo_id = session.get('equipo_id')

    if not is_juego_activo('prismaticos_ar') and user_role != 'admin':
        return redirect(url_for('simulacion_menu'))

    conn = get_db_connection()
    f_row = conn.execute('SELECT id FROM Faccion WHERE nombre = ?', (user_faction,)).fetchone()
    fac_id = f_row['id'] if f_row else None

    if user_role == 'admin':
        pois_rows = conn.execute("SELECT id, nombre, descripcion, lat, lng, tolerancia_metros, tipo, faccion_id FROM puntos_interes ORDER BY nombre").fetchall()
    else:
        pois_rows = conn.execute("SELECT id, nombre, descripcion, lat, lng, tolerancia_metros, tipo, faccion_id FROM puntos_interes WHERE faccion_id = ? OR faccion_id IS NULL OR faccion_id = 0 ORDER BY nombre", (fac_id,)).fetchall()

    pois = [dict(r) for r in pois_rows]
    conn.close()

    return render_template('prismaticos_ar.html',
                           user_role=user_role,
                           user_faction=user_faction,
                           equipo_id=equipo_id,
                           initial_pois=pois)

@app.route('/simulador_aaa')
@app.route('/aaa_sim')
def simulador_aaa():
    if 'role' not in session:
        return redirect(url_for('login'))
    user_role = session.get('role', 'player')
    user_faction = session.get('faction')
    equipo_id = session.get('equipo_id')

    if not is_juego_activo('simulador_aaa') and user_role != 'admin':
        return redirect(url_for('simulacion_menu'))

    unlocked = ('simulador_aaa' in session.get('unlocked_minigames', [])) or (user_role == 'admin')
    if not unlocked:
        return redirect(url_for('simulacion_menu'))

    return render_template('simulador_aaa.html',
                           user_role=user_role,
                           user_faction=user_faction,
                           equipo_id=equipo_id)

# ==================== SISTEMA DE RADAR Y ESPACIO AÉREO COMPARTIDO AAA ====================
AAA_INTEL_DB = {
    # HOSTILES (Amenazas de ataque y drones de reconocimiento)
    'SQ-4021': {'name': 'Su-25 Frogfoot', 'type': 'HOSTILE', 'pts': 100, 'desc': 'Reactor de ataque a tierra con cañón 30mm', 'base_alt': 2200, 'base_dist': 2400, 'speed_kmh': 500, 'ang_spd': 0.85},
    'SQ-6612': {'name': 'Shahed-136 Drone', 'type': 'HOSTILE', 'pts': 150, 'desc': 'Drone kamikaze merodeador ala delta', 'base_alt': 1400, 'base_dist': 2000, 'speed_kmh': 185, 'ang_spd': 0.65},
    'SQ-8830': {'name': 'Mi-24 Hind', 'type': 'HOSTILE', 'pts': 100, 'desc': 'Helicóptero de asalto blindado y apoyo', 'base_alt': 1200, 'base_dist': 1800, 'speed_kmh': 220, 'ang_spd': 0.75},
    'SQ-5510': {'name': 'Orlan-10 UAV', 'type': 'HOSTILE', 'pts': 120, 'desc': 'Dron táctico de reconocimiento artillero', 'base_alt': 1600, 'base_dist': 2200, 'speed_kmh': 130, 'ang_spd': 0.55},

    # ALIADOS (Fuerzas amigas en tránsito - Alto el fuego)
    'SQ-1104': {'name': 'MQ-9 Reaper', 'type': 'FRIENDLY', 'pts': -500, 'desc': 'UCAV enlace de reconocimiento amigo', 'base_alt': 2800, 'base_dist': 2800, 'speed_kmh': 250, 'ang_spd': 0.70},
    'SQ-2240': {'name': 'C-130 Hercules', 'type': 'FRIENDLY', 'pts': -500, 'desc': 'Transporte logístico pesado aliado', 'base_alt': 2600, 'base_dist': 3100, 'speed_kmh': 420, 'ang_spd': 0.90},
    'SQ-2310': {'name': 'CH-47 Chinook', 'type': 'FRIENDLY', 'pts': -500, 'desc': 'Helicóptero de transporte táctico aliado', 'base_alt': 1800, 'base_dist': 2300, 'speed_kmh': 260, 'ang_spd': 0.75},

    # CIVILES (Vuelos comerciales y sanitarios protegidos - Prohibido disparar)
    'SQ-7000': {'name': 'Airbus A320 Comercial', 'type': 'CIVILIAN', 'pts': -1000, 'desc': 'Vuelo civil en aerovía internacional', 'base_alt': 3500, 'base_dist': 3300, 'speed_kmh': 650, 'ang_spd': 1.10},
    'SQ-7140': {'name': 'Boeing 737 Pasajeros', 'type': 'CIVILIAN', 'pts': -1000, 'desc': 'Vuelo regular comercial de pasajeros', 'base_alt': 3600, 'base_dist': 3500, 'speed_kmh': 680, 'ang_spd': 1.15},
    'SQ-7320': {'name': 'ATR-72 Regional', 'type': 'CIVILIAN', 'pts': -1000, 'desc': 'Vuelo turbohélice de enlace regional', 'base_alt': 2400, 'base_dist': 2600, 'speed_kmh': 440, 'ang_spd': 0.85},
    'SQ-7500': {'name': 'Cessna 172 Skyhawk', 'type': 'CIVILIAN', 'pts': -1000, 'desc': 'Avioneta civil de enlace y recreo privado', 'base_alt': 1100, 'base_dist': 1700, 'speed_kmh': 190, 'ang_spd': 0.50},
    'SQ-7700': {'name': 'Bell 412 Medevac', 'type': 'CIVILIAN', 'pts': -1000, 'desc': 'Evacuación médica sanitaria urgente', 'base_alt': 1500, 'base_dist': 2100, 'speed_kmh': 210, 'ang_spd': 0.60}
}

AAA_AIRSPACE = {
    'contacts': [],
    'splashes': [],
    'next_id': 1
}

def spawn_aaa_bogey(squawk, initial_azimuth=None, initial_elevation=None):
    now = time.time()
    intel = AAA_INTEL_DB.get(squawk, {'name': 'Desconocido', 'type': 'HOSTILE', 'pts': 100, 'desc': 'Contacto radar', 'base_alt': 2000, 'base_dist': 2500, 'speed_kmh': 300, 'ang_spd': 0.75})
    init_az = initial_azimuth if initial_azimuth is not None else float((AAA_AIRSPACE['next_id'] * 85 + 25) % 360)
    init_el = initial_elevation if initial_elevation is not None else float(38.0 + (AAA_AIRSPACE['next_id'] * 7) % 14)
    bogey_id = f"BOGEY_{AAA_AIRSPACE['next_id']}"
    AAA_AIRSPACE['next_id'] += 1
    return {
        'id': bogey_id,
        'squawk': squawk,
        'name': intel['name'],
        'type': intel['type'],
        'pts': intel['pts'],
        'desc': intel['desc'],
        'base_alt': intel['base_alt'],
        'base_dist': intel['base_dist'],
        'speed_kmh': intel['speed_kmh'],
        'ang_spd': intel['ang_spd'],
        'init_azimuth': float(init_az),
        'init_elevation': float(init_el),
        'spawn_time': now,
        'destroyed': False,
        'splash_time': None
    }

def get_current_aaa_airspace():
    now = time.time()
    AAA_AIRSPACE['splashes'] = [s for s in AAA_AIRSPACE['splashes'] if (now - s.get('timestamp', 0)) < 25.0]

    if not AAA_AIRSPACE['contacts']:
        # Distribución táctica inicial: 6 contactos en el sector (1-2 hostiles, 1-2 amigos, 2-3 civiles)
        initial_setup = [
            ('SQ-4021', 45.0, 42.0),   # Su-25 Hostil al NE
            ('SQ-7000', 135.0, 48.0),  # Airbus A320 Civil al SE
            ('SQ-2240', 220.0, 40.0),  # C-130 Aliado al SO
            ('SQ-6612', 315.0, 44.0),  # Shahed-136 Hostil al NO
            ('SQ-7700', 95.0, 36.0),   # Bell 412 Medevac al E
            ('SQ-7140', 275.0, 50.0),  # Boeing 737 Civil al O
        ]
        for sq, az, el in initial_setup:
            c = spawn_aaa_bogey(sq, initial_azimuth=az, initial_elevation=el)
            AAA_AIRSPACE['contacts'].append(c)

    active_contacts = []
    squawk_keys = list(AAA_INTEL_DB.keys())
    used_squawks = set()

    for idx, c in enumerate(AAA_AIRSPACE['contacts']):
        if c.get('destroyed'):
            if c.get('splash_time') and (now - c['splash_time']) >= 4.5:
                available = [k for k in squawk_keys if k not in used_squawks]
                next_sq = available[idx % len(available)] if available else squawk_keys[(idx + 2) % len(squawk_keys)]
                new_az = (c.get('init_azimuth', 0) + 140.0 + (idx * 25.0)) % 360.0
                new_c = spawn_aaa_bogey(next_sq, initial_azimuth=new_az)
                AAA_AIRSPACE['contacts'][idx] = new_c
                c = new_c

        used_squawks.add(c['squawk'])

        elapsed = max(0.0, now - c['spawn_time'])
        current_az = (c['init_azimuth'] + elapsed * c['ang_spd']) % 360.0
        current_el = c['init_elevation'] + 4.5 * math.sin(elapsed * 0.04 + math.radians(c['init_azimuth']))
        current_el = max(33.0, min(63.0, current_el))

        dist = c['base_dist'] + int(100 * math.sin(elapsed * 0.025))
        alt = c['base_alt'] + int(60 * math.cos(elapsed * 0.035))
        heading_flight = round((current_az + 90.0) % 360.0)

        active_contacts.append({
            'id': c['id'],
            'squawk': c['squawk'],
            'name': c['name'],
            'type': c['type'],
            'pts': c['pts'],
            'desc': c['desc'],
            'azimuth': round(current_az, 1),
            'elevation': round(current_el, 1),
            'distance': dist,
            'altitude': alt,
            'speed_kmh': c['speed_kmh'],
            'heading_flight': heading_flight,
            'destroyed': bool(c.get('destroyed')),
            'splash_time': c.get('splash_time')
        })

    # Generar ecos de ruido ambiental / clutter
    clutter_blips = []
    max_clutter = int(get_juego_param('simulador_aaa', 'clutter_count', 2) or 2)
    clutter_seeds = [
        (1, 70.0, 1500, 0.20, 0.04),
        (2, 220.0, 2600, 0.18, 0.03),
        (3, 140.0, 1900, 0.22, 0.05),
        (4, 310.0, 2800, 0.15, 0.02),
        (5, 45.0, 1200, 0.25, 0.06),
        (6, 180.0, 2400, 0.19, 0.03),
    ]
    for cid, base_az, base_dist, base_int, drift in clutter_seeds[:max(0, max_clutter)]:
        c_az = (base_az + math.sin(now * drift) * 15.0 + 360.0) % 360.0
        c_dist = base_dist + math.cos(now * drift * 1.4) * 150
        intensity = max(0.08, min(0.32, base_int + math.sin(now * 0.25 + cid) * 0.08))
        clutter_blips.append({
            'id': f'CLUTTER_{cid}',
            'azimuth': round(c_az, 1),
            'distance': round(c_dist),
            'intensity': round(intensity, 2)
        })

    return active_contacts, AAA_AIRSPACE['splashes'], clutter_blips

@app.route('/radar_aaa')
@app.route('/radar-aaa')
@app.route('/radar_director')
@app.route('/radar-director')
@app.route('/aaa_radar')
def radar_aaa():
    if 'role' not in session:
        return redirect(url_for('login'))
    user_role = session.get('role', 'player')
    user_faction = session.get('faction')
    equipo_id = session.get('equipo_id')

    if not is_juego_activo('simulador_aaa') and user_role != 'admin':
        return redirect(url_for('simulacion_menu'))

    unlocked = ('simulador_aaa' in session.get('unlocked_minigames', [])) or (user_role == 'admin')
    if not unlocked:
        return redirect(url_for('simulacion_menu'))

    return render_template('radar_aaa.html',
                           user_role=user_role,
                           user_faction=user_faction,
                           equipo_id=equipo_id,
                           intel_db=AAA_INTEL_DB)

@app.route('/api/aaa/intel')
def api_aaa_intel():
    if 'role' not in session:
        return jsonify({'success': False, 'message': 'No autenticado'}), 401
    return jsonify({
        'success': True,
        'intel': AAA_INTEL_DB
    })

@app.route('/api/aaa/airspace')
def api_aaa_airspace():
    if 'role' not in session:
        return jsonify({'success': False, 'message': 'No autenticado'}), 401
    user_role = session.get('role', 'player')
    unlocked = ('simulador_aaa' in session.get('unlocked_minigames', [])) or (user_role == 'admin')
    if not unlocked:
        return jsonify({'success': False, 'message': 'Acceso no desbloqueado'}), 403

    contacts, splashes, clutter = get_current_aaa_airspace()
    return jsonify({
        'success': True,
        'timestamp': time.time(),
        'contacts': contacts,
        'clutter': clutter,
        'splashes': splashes
    })

@app.route('/api/aaa/splash', methods=['POST'])
def api_aaa_splash():
    if 'role' not in session:
        return jsonify({'success': False, 'message': 'No autenticado'}), 401
    user_role = session.get('role', 'player')
    unlocked = ('simulador_aaa' in session.get('unlocked_minigames', [])) or (user_role == 'admin')
    if not unlocked:
        return jsonify({'success': False, 'message': 'Acceso no desbloqueado'}), 403

    data = request.get_json(silent=True) or {}
    target_id = data.get('id')
    squawk = data.get('squawk')

    now = time.time()
    found = None
    for c in AAA_AIRSPACE['contacts']:
        if (target_id and c.get('id') == target_id) or (squawk and c.get('squawk') == squawk):
            found = c
            break

    if not found:
        return jsonify({'success': False, 'message': 'Blanco no encontrado en espacio aéreo'}), 404

    if found.get('destroyed'):
        return jsonify({'success': False, 'message': 'Blanco ya destruido'}), 200

    found['destroyed'] = True
    found['splash_time'] = now

    splash_event = {
        'id': found['id'],
        'squawk': found['squawk'],
        'name': found['name'],
        'type': found['type'],
        'pts': found['pts'],
        'timestamp': now,
        'user': session.get('username', 'Tirador AAA'),
        'faction': session.get('faction')
    }
    AAA_AIRSPACE['splashes'].append(splash_event)

    return jsonify({
        'success': True,
        'splash': splash_event,
        'pts': found['pts'],
        'type': found['type']
    })

@app.route('/telemetro_recon')
def telemetro_recon():
    if 'role' not in session:
        return redirect(url_for('login'))
    user_role = session.get('role', 'player')
    user_faction = session.get('faction')
    equipo_id = session.get('equipo_id')

    if not is_juego_activo('telemetro_recon') and user_role != 'admin':
        return redirect(url_for('simulacion_menu'))

    unlocked = ('telemetro_recon' in session.get('unlocked_minigames', [])) or (user_role == 'admin')

    conn = get_db_connection()
    f_row = conn.execute('SELECT id FROM Faccion WHERE nombre = ?', (user_faction,)).fetchone()
    fac_id = f_row['id'] if f_row else None

    if user_role == 'admin':
        ops_rows = conn.execute("SELECT id, nombre, lat, lng, tolerancia_metros, token_qr, faccion_id FROM puntos_interes WHERE tipo = 'OP' ORDER BY faccion_id, nombre").fetchall()
    else:
        ops_rows = conn.execute("SELECT id, nombre, lat, lng, tolerancia_metros, token_qr, faccion_id FROM puntos_interes WHERE tipo = 'OP' AND (faccion_id = ? OR faccion_id IS NULL) ORDER BY nombre", (fac_id,)).fetchall()

    ultimo_op_usado_id = None
    if equipo_id and user_role != 'admin':
        eq = conn.execute("SELECT ultimo_op_usado_id FROM Equipo WHERE id = ?", (equipo_id,)).fetchone()
        if eq:
            ultimo_op_usado_id = eq['ultimo_op_usado_id']

    ops = []
    active_op_id = None
    active_sesion = None
    for r in ops_rows:
        item = dict(r)
        item['bloqueado'] = (item['id'] == ultimo_op_usado_id)
        ses = op_dinamico_engine.get_active_session(item['id'], conn)
        item['sesion_activa'] = ses is not None
        if ses:
            item['sesion'] = ses
            active_op_id = item['id']
            active_sesion = ses
        ops.append(item)
    conn.close()

    cfg = op_dinamico_engine.get_op_dinamico_config()

    return render_template('telemetro_recon.html',
                           user_role=user_role,
                           user_faction=user_faction,
                           equipo_id=equipo_id,
                           unlocked=unlocked,
                           ops=ops,
                           active_op_id=active_op_id,
                           active_sesion=active_sesion,
                           config=cfg)

@app.route('/api/facciones', methods=['GET'])
def get_facciones():
    conn = get_db_connection()
    facciones = conn.execute('''
        SELECT F.*, E.datos_json as opord_esquema_json 
        FROM Faccion F
        LEFT JOIN Esquema_Tactico E ON F.opord_esquema_id = E.id
    ''').fetchall()
    conn.close()
    return jsonify([dict(row) for row in facciones])

@app.route('/api/facciones/<int:id>/opord', methods=['POST'])
def upload_faccion_opord(id):
    if session.get('role') != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
    
    conn = get_db_connection()
    esquema_id = request.form.get('opord_esquema_id')
    if esquema_id == '': esquema_id = None
    
    # Handle PDF
    pdf_url = request.form.get('opord_pdf', '')
    if 'pdf' in request.files:
        file = request.files['pdf']
        if file.filename != '':
            ext = os.path.splitext(file.filename)[1].lower()
            if ext == '.pdf':
                filename = f"opord_faccion_{id}_{int(time.time())}{ext}"
                file_path = os.path.join('static', 'uploads', filename)
                file.save(file_path)
                pdf_url = f'/{file_path}'.replace('\\', '/')
                
    if pdf_url or esquema_id is not None:
        if pdf_url:
            conn.execute('UPDATE Faccion SET opord_pdf = ?, opord_esquema_id = ? WHERE id = ?', (pdf_url, esquema_id, id))
        else:
            conn.execute('UPDATE Faccion SET opord_esquema_id = ? WHERE id = ?', (esquema_id, id))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})

def check_nick_duplicado(conn, nick, exclude_id=None):
    """
    Comprueba si ya existe un combatiente en el censo con el mismo nick (insensible a mayúsculas/espacios).
    Retorna (existe: bool, info_duplicado: dict o None)
    """
    if not nick or not str(nick).strip():
        return False, None
    clean_nick = str(nick).strip().lower()
    query = '''
        SELECT m.id, m.nombre_jugador, m.equipo_id, e.nombre as equipo_nombre
        FROM Miembro m
        JOIN Equipo e ON m.equipo_id = e.id
        WHERE LOWER(TRIM(m.nombre_jugador)) = ?
    '''
    params = [clean_nick]
    if exclude_id:
        query += ' AND m.id != ?'
        params.append(exclude_id)
    row = conn.execute(query, params).fetchone()
    if row:
        return True, dict(row)
    return False, None

@app.route('/api/miembros/check_nick', methods=['GET'])
def api_check_miembro_nick():
    nick = request.args.get('nick', '').strip()
    exclude_id = request.args.get('exclude_id', type=int)
    if not nick:
        return jsonify({'available': True})
    conn = get_db_connection()
    is_dup, dup = check_nick_duplicado(conn, nick, exclude_id=exclude_id)
    conn.close()
    if is_dup:
        return jsonify({
            'available': False,
            'nombre_jugador': dup['nombre_jugador'],
            'equipo_nombre': dup['equipo_nombre']
        })
    return jsonify({'available': True})

@app.route('/api/equipos', methods=['GET', 'POST'])
def manage_equipos():
    conn = get_db_connection()
    if request.method == 'GET':
        equipos = conn.execute('''
            SELECT Equipo.*, Faccion.nombre as faccion_nombre, Faccion.color as faccion_color,
                   (SELECT COUNT(*) FROM Miembro m WHERE m.equipo_id = Equipo.id AND m.armamento LIKE '%Apoyo%') as apoyos,
                   (SELECT COUNT(*) FROM Miembro m WHERE m.equipo_id = Equipo.id AND (m.armamento LIKE '%Sniper%' OR m.armamento LIKE '%Francotirador%')) as snipers
            FROM Equipo
            LEFT JOIN Faccion ON Equipo.faccion_id = Faccion.id
        ''').fetchall()
        
        equipos_list = [dict(row) for row in equipos]
        is_admin = session.get('role') == 'admin'
        for eq in equipos_list:
            if not is_admin:
                eq.pop('valoracion', None)
            miembros = conn.execute('SELECT * FROM Miembro WHERE equipo_id = ?', (eq['id'],)).fetchall()
            eq['miembros'] = [dict(m) for m in miembros]
            
            historial = conn.execute('SELECT * FROM Historial_Equipo WHERE equipo_id = ?', (eq['id'],)).fetchall()
            eq['historial'] = [dict(h) for h in historial]
            
            docs = conn.execute('SELECT id, tipo, nombre_original, archivo_url, tamano_bytes, subido_en FROM Equipo_Documento WHERE equipo_id = ?', (eq['id'],)).fetchall()
            eq['documentos'] = [dict(d) for d in docs]
            
            if not is_admin:
                for h in eq['historial']:
                    h.pop('valoracion', None)
            
        conn.close()
        return jsonify(equipos_list)
    
    elif request.method == 'POST':
        data = request.json
        cursor = conn.cursor()
        
        is_admin = session.get('role') == 'admin'
        alerta_doctrina_medicos = None
        if 'miembros' in data and isinstance(data['miembros'], list):
            tot_m = len(data['miembros'])
            med_count = sum(1 for m in data['miembros'] if 'medico' in str(m.get('rol', '')).lower() or 'sanitario' in str(m.get('rol', '')).lower())
            max_permitidos = medic_engine.get_max_medicos_permitidos(tot_m)
            if med_count > max_permitidos:
                if not is_admin:
                    conn.close()
                    return jsonify({'error': f'Doctrina TVC: Una escuadra de {tot_m} efectivos solo puede tener como máximo {max_permitidos} médico(s). Has asignado {med_count}.'}), 400
                alerta_doctrina_medicos = f"Doctrina TVC: La escuadra tiene {tot_m} efectivos y {med_count} médicos. El máximo reglamentario para el jefe de unidad es de {max_permitidos} médico(s)."

            # Validar nicks únicos tanto dentro de la escuadra como a nivel global
            nicks_seen = {}
            for m in data['miembros']:
                nick = str(m.get('nombre_jugador', '')).strip()
                if not nick:
                    continue
                nick_key = nick.lower()
                if nick_key in nicks_seen:
                    conn.close()
                    return jsonify({'error': f'Nick duplicado dentro de la escuadra: "{nick}". Dos combatientes no pueden compartir el mismo indicativo.'}), 400
                nicks_seen[nick_key] = True

                is_dup, dup_info = check_nick_duplicado(conn, nick)
                if is_dup:
                    conn.close()
                    return jsonify({
                        'error': f'El nick "{nick}" ya está en uso por otro operador de la unidad "{dup_info["equipo_nombre"]}". Cada combatiente debe tener un indicativo único para el acceso.'
                    }), 400

        raw_password = data.get('password', '').strip()
        if not raw_password:
            raw_password = '1234'
        pwd_hash = raw_password
        
        cursor.execute(
            'INSERT INTO Equipo (nombre, jugadores, jugadores_manual, faccion_id, tipo, valoracion, codigo, password_hash, misiones_preferidas, tags_comportamiento, estado_medalla, estado_sancion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (data['nombre'], data['jugadores'], data.get('jugadores_manual', False), data['faccion_id'], data.get('tipo', ''), data.get('valoracion', ''), data.get('codigo', ''), pwd_hash, data.get('misiones_preferidas', ''), data.get('tags_comportamiento', '[]'), data.get('estado_medalla', 'verde'), data.get('estado_sancion', 'Autorizado'))
        )
        new_id = cursor.lastrowid
        
        if 'miembros' in data and isinstance(data['miembros'], list):
            import uuid
            for m in data['miembros']:
                new_uid = str(uuid.uuid4()).split('-')[0].upper()
                activo_val = 1 if m.get('activo', 1) in [1, '1', True] else 0
                cursor.execute(
                    'INSERT INTO Miembro (equipo_id, nombre_jugador, rol, armamento, uid, nombre_apellidos, dni, telefono, email, bando_original, activo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    (new_id, m.get('nombre_jugador', ''), m.get('rol', 'Operador'), m.get('armamento', 'Fusilero'), new_uid, m.get('nombre_apellidos', ''), m.get('dni', ''), m.get('telefono', ''), m.get('email', ''), m.get('bando_original', ''), activo_val)
                )
        
        if 'historial' in data and isinstance(data['historial'], list):
            for h in data['historial']:
                cursor.execute(
                    'INSERT INTO Historial_Equipo (equipo_id, operacion, mision_id, grupo_rol, valoracion, faccion_id) VALUES (?, ?, ?, ?, ?, ?)',
                    (new_id, h.get('operacion', ''), h.get('mision_id', None), h.get('grupo_rol', ''), h.get('valoracion', ''), h.get('faccion_id', None))
                )

        conn.commit()
        conn.close()
        return jsonify({'id': new_id, 'status': 'success', 'alerta_medicos': alerta_doctrina_medicos}), 201

@app.route('/api/equipos/<int:id>/logo', methods=['POST'])
def upload_equipo_logo(id):
    is_admin = session.get('role') == 'admin'
    is_owner = (session.get('role') == 'equipo' and session.get('equipo_id') == id)
    if not (is_admin or is_owner):
        return jsonify({'error': 'Unauthorized'}), 403
    if 'logo' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['logo']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
        
    # Get extension
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.jfif']:
        return jsonify({'error': 'Formato de imagen no válido'}), 400
        
    # Obtener nombre del equipo para el archivo
    conn = get_db_connection()
    equipo = conn.execute('SELECT nombre FROM Equipo WHERE id = ?', (id,)).fetchone()
    if not equipo:
        conn.close()
        return jsonify({'error': 'Equipo no encontrado'}), 404
        
    folder = os.path.join(app.root_path, 'static', 'imgs', 'logos_equipos')
    os.makedirs(folder, exist_ok=True)
    # 1 logo por equipo: limpiar cualquier archivo anterior en disco
    clean_old_files(folder, f"{id}_*.*")

    safe_name = "".join([c for c in equipo['nombre'] if c.isalnum() or c in (' ', '_', '-')]).replace(' ', '_').strip()
    if not safe_name:
        safe_name = f"equipo_{id}"
    filename = f"{id}_{safe_name}{ext}"
    filepath = os.path.join(folder, filename)
    
    # Procesar, redimensionar y optimizar (máx 600px para logos)
    save_optimized_image(file, filepath, max_dim=600)
    
    # Update db with cache-busting timestamp
    logo_url = f"/static/imgs/logos_equipos/{filename}?v={int(time.time())}"
    conn.execute('UPDATE Equipo SET logo_url = ? WHERE id = ?', (logo_url, id))
    conn.commit()
    conn.close()
    
    return jsonify({'status': 'success', 'logo_url': logo_url})

@app.route('/api/equipos/<int:id>/foto', methods=['POST'])
def upload_equipo_foto(id):
    is_admin = session.get('role') == 'admin'
    is_owner = (session.get('role') == 'equipo' and session.get('equipo_id') == id)
    if not (is_admin or is_owner):
        return jsonify({'error': 'Unauthorized'}), 403
    if 'foto' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['foto']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
        
    # Get extension
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.jfif']:
        return jsonify({'error': 'Formato de imagen no válido'}), 400
        
    # Obtener nombre del equipo
    conn = get_db_connection()
    equipo = conn.execute('SELECT nombre FROM Equipo WHERE id = ?', (id,)).fetchone()
    if not equipo:
        conn.close()
        return jsonify({'error': 'Equipo no encontrado'}), 404
        
    folder = os.path.join(app.root_path, 'static', 'imgs', 'fotos_equipos')
    os.makedirs(folder, exist_ok=True)
    # 1 foto por equipo: limpiar cualquier archivo anterior en disco
    clean_old_files(folder, f"{id}_*.*")

    safe_name = "".join([c for c in equipo['nombre'] if c.isalnum() or c in (' ', '_', '-')]).replace(' ', '_').strip()
    if not safe_name:
        safe_name = f"equipo_{id}"
    filename = f"{id}_{safe_name}{ext}"
    filepath = os.path.join(folder, filename)
    
    # Procesar, redimensionar y optimizar (máx 1200px para foto de equipo)
    save_optimized_image(file, filepath, max_dim=1200)
    
    # Update db with cache-busting timestamp
    foto_url = f"/static/imgs/fotos_equipos/{filename}?v={int(time.time())}"
    conn.execute('UPDATE Equipo SET foto_url = ? WHERE id = ?', (foto_url, id))
    conn.commit()
    conn.close()
    
    return jsonify({'status': 'success', 'foto_url': foto_url})

UPLOAD_DOCS_FOLDER = os.path.join(app.root_path, 'static', 'uploads', 'documentos_unidad')
os.makedirs(UPLOAD_DOCS_FOLDER, exist_ok=True)

UPLOAD_REGLAMENTOS_FOLDER = os.path.join(app.root_path, 'static', 'uploads', 'documentos_reglamentos')
os.makedirs(UPLOAD_REGLAMENTOS_FOLDER, exist_ok=True)

@app.route('/api/equipos/<int:id>/documentos', methods=['GET'])
def get_equipo_documentos(id):
    if 'role' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    is_admin = session.get('role') == 'admin'
    is_owner = (session.get('role') == 'equipo' and session.get('equipo_id') == id)
    is_operador = (session.get('role') == 'operador' and session.get('equipo_id') == id)
    if not (is_admin or is_owner or is_operador):
        return jsonify({'error': 'Unauthorized'}), 403

    conn = get_db_connection()
    docs = conn.execute('''
        SELECT id, equipo_id, tipo, nombre_original, archivo_url, tamano_bytes, subido_en, subido_por
        FROM Equipo_Documento
        WHERE equipo_id = ?
        ORDER BY id ASC
    ''', (id,)).fetchall()
    conn.close()
    return jsonify([dict(d) for d in docs])

@app.route('/api/equipos/<int:id>/documentos', methods=['POST'])
def upload_equipo_documento(id):
    is_admin = session.get('role') == 'admin'
    is_owner = (session.get('role') == 'equipo' and session.get('equipo_id') == id)
    if not (is_admin or is_owner):
        return jsonify({'error': 'Unauthorized'}), 403

    if 'file' not in request.files:
        return jsonify({'error': 'No se ha subido ningún archivo'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Ningún archivo seleccionado'}), 400

    tipo = request.form.get('tipo', 'SEGURO_EXENCION').strip().upper()
    if tipo not in ['SEGURO_EXENCION', 'SEGURO', 'EXENCION']:
        return jsonify({'error': 'Tipo de documento inválido. Debe ser SEGURO_EXENCION, SEGURO o EXENCION'}), 400

    ext = os.path.splitext(file.filename)[1].lower()
    if ext != '.pdf':
        return jsonify({'error': 'Solo se admiten documentos en formato PDF (.pdf)'}), 400

    conn = get_db_connection()
    equipo = conn.execute('SELECT nombre FROM Equipo WHERE id = ?', (id,)).fetchone()
    if not equipo:
        conn.close()
        return jsonify({'error': 'Equipo no encontrado'}), 404

    # Limpiar archivo anterior del mismo tipo o cualquier previo si se sube el documento unificado SEGURO_EXENCION
    if tipo == 'SEGURO_EXENCION':
        old_docs = conn.execute('SELECT id, archivo_path FROM Equipo_Documento WHERE equipo_id = ?', (id,)).fetchall()
    else:
        old_docs = conn.execute('SELECT id, archivo_path FROM Equipo_Documento WHERE equipo_id = ? AND (tipo = ? OR tipo = "SEGURO_EXENCION")', (id, tipo)).fetchall()
    for od in old_docs:
        try:
            if od['archivo_path'] and os.path.isfile(od['archivo_path']):
                os.remove(od['archivo_path'])
        except Exception as e:
            print(f"Error eliminando documento previo de disco: {e}")
        conn.execute('DELETE FROM Equipo_Documento WHERE id = ?', (od['id'],))

    import secrets
    safe_name = "".join([c for c in equipo['nombre'] if c.isalnum() or c in ('_', '-')]).strip()
    if not safe_name:
        safe_name = f"equipo_{id}"
    rand_token = secrets.token_hex(4)
    filename = f"eq_{id}_{tipo.lower()}_{safe_name}_{rand_token}.pdf"
    filepath = os.path.join(UPLOAD_DOCS_FOLDER, filename)
    file.save(filepath)

    tamano_bytes = os.path.getsize(filepath)
    archivo_url = f"/static/uploads/documentos_unidad/{filename}?v={int(time.time())}"
    uploader_name = session.get('usuario') or ('Dirección (Admin)' if is_admin else equipo['nombre'])

    cur = conn.cursor()
    cur.execute('''
        INSERT INTO Equipo_Documento (equipo_id, tipo, nombre_original, archivo_url, archivo_path, tamano_bytes, subido_por)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (id, tipo, file.filename, archivo_url, filepath, tamano_bytes, uploader_name))
    new_id = cur.lastrowid
    conn.commit()

    new_row = conn.execute('SELECT * FROM Equipo_Documento WHERE id = ?', (new_id,)).fetchone()
    conn.close()
    return jsonify({'status': 'success', 'documento': dict(new_row)})

@app.route('/api/documentos_equipo/<int:doc_id>', methods=['DELETE'])
def delete_equipo_documento(doc_id):
    if 'role' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    conn = get_db_connection()
    doc = conn.execute('SELECT * FROM Equipo_Documento WHERE id = ?', (doc_id,)).fetchone()
    if not doc:
        conn.close()
        return jsonify({'error': 'Documento no encontrado'}), 404

    is_admin = session.get('role') == 'admin'
    is_owner = (session.get('role') == 'equipo' and session.get('equipo_id') == doc['equipo_id'])
    if not (is_admin or is_owner):
        conn.close()
        return jsonify({'error': 'Unauthorized'}), 403

    try:
        if doc['archivo_path'] and os.path.isfile(doc['archivo_path']):
            os.remove(doc['archivo_path'])
    except Exception as e:
        print(f"Error eliminando archivo PDF de disco: {e}")

    conn.execute('DELETE FROM Equipo_Documento WHERE id = ?', (doc_id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success', 'message': 'Documento eliminado correctamente'})

@app.route('/api/equipos/<int:id>', methods=['PUT', 'DELETE'])
def update_delete_equipo(id):
    conn = get_db_connection()
    cursor = conn.cursor()
    is_admin = session.get('role') == 'admin'
    is_owner = (session.get('role') == 'equipo' and session.get('equipo_id') == id)

    if request.method == 'PUT':
        if not (is_admin or is_owner):
            conn.close()
            return jsonify({'error': 'Unauthorized'}), 403

        data = request.json
        alerta_doctrina_medicos = None
        if 'miembros' in data and isinstance(data['miembros'], list):
            tot_m = len(data['miembros'])
            med_count = sum(1 for m in data['miembros'] if 'medico' in str(m.get('rol', '')).lower() or 'sanitario' in str(m.get('rol', '')).lower())
            max_permitidos = medic_engine.get_max_medicos_permitidos(tot_m)
            if med_count > max_permitidos:
                if not is_admin:
                    conn.close()
                    return jsonify({'error': f'Doctrina TVC: Una escuadra de {tot_m} efectivos solo puede tener como máximo {max_permitidos} médico(s). Has asignado {med_count}.'}), 400
                alerta_doctrina_medicos = f"Doctrina TVC: La escuadra tiene {tot_m} efectivos y {med_count} médicos. El máximo reglamentario para el jefe de unidad es de {max_permitidos} médico(s)."

            # Validar nicks únicos tanto dentro de la escuadra como a nivel global
            nicks_seen = {}
            for m in data['miembros']:
                nick = str(m.get('nombre_jugador', '')).strip()
                if not nick:
                    continue
                nick_key = nick.lower()
                if nick_key in nicks_seen:
                    conn.close()
                    return jsonify({'error': f'Nick duplicado dentro de la escuadra: "{nick}". Dos combatientes no pueden compartir el mismo indicativo.'}), 400
                nicks_seen[nick_key] = m.get('id')

                m_id = m.get('id')
                is_dup, dup_info = check_nick_duplicado(conn, nick, exclude_id=m_id)
                if is_dup:
                    conn.close()
                    return jsonify({
                        'error': f'El nick "{nick}" ya está en uso por otro operador de la unidad "{dup_info["equipo_nombre"]}". Cada combatiente debe tener un indicativo único para el acceso.'
                    }), 400

        if is_admin:
            cursor.execute(
                'UPDATE Equipo SET nombre = ?, jugadores = ?, jugadores_manual = ?, faccion_id = ?, tipo = ?, valoracion = ?, codigo = ?, misiones_preferidas = ?, tags_comportamiento = ?, estado_medalla = ?, estado_sancion = ? WHERE id = ?',
                (data['nombre'], data['jugadores'], data.get('jugadores_manual', False), data['faccion_id'], data.get('tipo', ''), data.get('valoracion', ''), data.get('codigo', ''), data.get('misiones_preferidas', ''), data.get('tags_comportamiento', '[]'), data.get('estado_medalla', 'verde'), data.get('estado_sancion', 'Autorizado'), id)
            )
        else:
            # Equips can only update their own safe fields
            cursor.execute(
                'UPDATE Equipo SET jugadores = ?, jugadores_manual = ?, tipo = ?, misiones_preferidas = ?, tags_comportamiento = ? WHERE id = ?',
                (data['jugadores'], data.get('jugadores_manual', False), data.get('tipo', ''), data.get('misiones_preferidas', ''), data.get('tags_comportamiento', '[]'), id)
            )
            
        # Update password / PIN if provided (both admin and team owner)
        raw_password = str(data.get('password', '')).strip()
        if raw_password:
            if not is_admin and (len(raw_password) != 4 or not raw_password.isdigit()):
                conn.close()
                return jsonify({'error': 'El PIN debe tener exactamente 4 dígitos numéricos'}), 400
            cursor.execute('UPDATE Equipo SET password_hash = ? WHERE id = ?', (raw_password, id))
        
        # Update members (smart approach: update existing, delete missing, insert new)
        if 'miembros' in data and isinstance(data['miembros'], list):
            incoming_ids = [m['id'] for m in data['miembros'] if m.get('id')]
            jugadores_dir = os.path.join(app.root_path, 'static', 'imgs', 'fotos_jugadores')
            
            # Solo los administradores pueden eliminar operadores definitivamente del censo militar
            if is_admin:
                if incoming_ids:
                    placeholders = ','.join('?' * len(incoming_ids))
                    # Limpiar fotos en disco de los miembros eliminados
                    del_members = cursor.execute(f'SELECT id FROM Miembro WHERE equipo_id = ? AND id NOT IN ({placeholders})', [id] + incoming_ids).fetchall()
                    for dm in del_members:
                        clean_old_files(jugadores_dir, f"miembro_{dm['id']}.*")
                    cursor.execute(f'DELETE FROM Miembro WHERE equipo_id = ? AND id NOT IN ({placeholders})', [id] + incoming_ids)
                else:
                    del_members = cursor.execute('SELECT id FROM Miembro WHERE equipo_id = ?', (id,)).fetchall()
                    for dm in del_members:
                        clean_old_files(jugadores_dir, f"miembro_{dm['id']}.*")
                    cursor.execute('DELETE FROM Miembro WHERE equipo_id = ?', (id,))
            else:
                # El gestor de unidad NO puede eliminar miembros de la BD; se conservan intactos
                pass
                
            import uuid
            for m in data['miembros']:
                activo_val = 1 if m.get('activo', 1) in [1, '1', True] else 0
                if m.get('id'):
                    cursor.execute(
                        'UPDATE Miembro SET nombre_jugador = ?, rol = ?, armamento = ?, nombre_apellidos = ?, dni = ?, telefono = ?, email = ?, bando_original = ?, activo = ? WHERE id = ? AND equipo_id = ?',
                        (m.get('nombre_jugador', ''), m.get('rol', 'Operador'), m.get('armamento', 'Fusilero'), m.get('nombre_apellidos', ''), m.get('dni', ''), m.get('telefono', ''), m.get('email', ''), m.get('bando_original', ''), activo_val, m['id'], id)
                    )
                else:
                    new_uid = str(uuid.uuid4()).split('-')[0].upper()
                    cursor.execute(
                        'INSERT INTO Miembro (equipo_id, nombre_jugador, rol, armamento, uid, nombre_apellidos, dni, telefono, email, bando_original, activo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        (id, m.get('nombre_jugador', ''), m.get('rol', 'Operador'), m.get('armamento', 'Fusilero'), new_uid, m.get('nombre_apellidos', ''), m.get('dni', ''), m.get('telefono', ''), m.get('email', ''), m.get('bando_original', ''), activo_val)
                    )
                
        # Update historial (only admin can modify team history)
        if is_admin and 'historial' in data and isinstance(data['historial'], list):
            cursor.execute('DELETE FROM Historial_Equipo WHERE equipo_id = ?', (id,))
            for h in data['historial']:
                cursor.execute(
                    'INSERT INTO Historial_Equipo (equipo_id, operacion, mision_id, grupo_rol, valoracion, faccion_id) VALUES (?, ?, ?, ?, ?, ?)',
                    (id, h.get('operacion', ''), h.get('mision_id', None), h.get('grupo_rol', ''), h.get('valoracion', ''), h.get('faccion_id', None))
                )

        conn.commit()
        conn.close()
        return jsonify({'status': 'success', 'alerta_medicos': alerta_doctrina_medicos})
    
    elif request.method == 'DELETE':
        if not is_admin:
            conn.close()
            return jsonify({'error': 'Unauthorized'}), 403

        # Limpiar logo y foto del equipo en disco
        clean_old_files(os.path.join(app.root_path, 'static', 'imgs', 'logos_equipos'), f"{id}_*.*")
        clean_old_files(os.path.join(app.root_path, 'static', 'imgs', 'fotos_equipos'), f"{id}_*.*")
        # Limpiar fotos de sus miembros en disco
        m_rows = cursor.execute('SELECT id FROM Miembro WHERE equipo_id = ?', (id,)).fetchall()
        jugadores_dir = os.path.join(app.root_path, 'static', 'imgs', 'fotos_jugadores')
        for mr in m_rows:
            clean_old_files(jugadores_dir, f"miembro_{mr['id']}.*")

        cursor.execute('DELETE FROM Equipo WHERE id = ?', (id,))
        conn.commit()
        conn.close()
        return jsonify({'status': 'success'})

@app.route('/api/miembros/<int:id>', methods=['DELETE'])
def delete_miembro(id):
    if session.get('role') != 'admin':
        return jsonify({'error': 'Solo los administradores pueden eliminar operadores del censo militar. Los gestores de unidad pueden marcarlos como inactivos.'}), 403

    conn = get_db_connection()
    cursor = conn.cursor()
    m = cursor.execute('SELECT id, nombre_jugador FROM Miembro WHERE id = ?', (id,)).fetchone()
    if not m:
        conn.close()
        return jsonify({'error': 'Operador no encontrado'}), 404

    jugadores_dir = os.path.join(app.root_path, 'static', 'imgs', 'fotos_jugadores')
    clean_old_files(jugadores_dir, f"miembro_{id}.*")
    cursor.execute('DELETE FROM Miembro WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success', 'message': f'Operador "{m["nombre_jugador"]}" eliminado del censo militar.'})

@app.route('/api/equipos/<int:id>/readiness', methods=['GET'])
def get_equipo_readiness(id):
    conn = get_db_connection()
    members = conn.execute('SELECT id, nombre_jugador, listo_combate, listo_timestamp FROM Miembro WHERE equipo_id = ?', (id,)).fetchall()
    conn.close()
    return jsonify([dict(m) for m in members])

@app.route('/api/misiones', methods=['GET', 'POST'])
def manage_misiones():
    conn = get_db_connection()
    if request.method == 'GET':
        misiones = conn.execute('''
            SELECT M.*, E.nombre as esquema_nombre, E.datos_json as esquema_json
            FROM Mision M 
            LEFT JOIN Esquema_Tactico E ON M.esquema_id = E.id 
            WHERE M.operacion_id = 1
        ''').fetchall()
        conn.close()
        return jsonify([dict(row) for row in misiones])
    
    elif request.method == 'POST':
        data = request.json
        cursor = conn.cursor()
        cursor.execute(
            '''INSERT INTO Mision (operacion_id, nombre, tipo, etiquetas, oficial_responsable, resumen, contexto, instrucciones, consideraciones, persistente, revelada, esquema_id) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (1, data['nombre'], data.get('tipo', ''), data.get('etiquetas', ''), data.get('oficial_responsable', ''), data.get('resumen', ''), data.get('contexto', ''), data.get('instrucciones', ''), data.get('consideraciones', ''), data.get('persistente', False), data.get('revelada', False), data.get('esquema_id'))
        )
        conn.commit()
        new_id = cursor.lastrowid
        conn.close()
        return jsonify({'id': new_id, 'status': 'success'}), 201

@app.route('/api/misiones/<int:id>', methods=['PUT', 'DELETE'])
def update_delete_mision(id):
    conn = get_db_connection()
    cursor = conn.cursor()
    if request.method == 'PUT':
        data = request.json
        cursor.execute(
            '''UPDATE Mision 
               SET nombre = ?, tipo = ?, etiquetas = ?, oficial_responsable = ?, resumen = ?, contexto = ?, instrucciones = ?, consideraciones = ?, persistente = ?, revelada = ?, esquema_id = ?
               WHERE id = ?''',
            (data['nombre'], data.get('tipo', ''), data.get('etiquetas', ''), data.get('oficial_responsable', ''), data.get('resumen', ''), data.get('contexto', ''), data.get('instrucciones', ''), data.get('consideraciones', ''), data.get('persistente', False), data.get('revelada', False), data.get('esquema_id'), id)
        )
        conn.commit()
        conn.close()
        return jsonify({'status': 'success'})
    
    elif request.method == 'DELETE':
        cursor.execute('DELETE FROM Mision WHERE id = ?', (id,))
        # Also nullify it from any group using it
        cursor.execute('UPDATE Grupo_Batalla SET mision_actual_id = NULL WHERE mision_actual_id = ?', (id,))
        conn.commit()
        conn.close()
        return jsonify({'status': 'success'})

@app.route('/api/misiones/<int:id>/duplicate', methods=['POST'])
def duplicate_mision(id):
    if session.get('role') != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
    conn = get_db_connection()
    cursor = conn.cursor()
    mision = cursor.execute('SELECT * FROM Mision WHERE id = ?', (id,)).fetchone()
    if mision:
        cursor.execute(
            '''INSERT INTO Mision (operacion_id, nombre, tipo, etiquetas, oficial_responsable, resumen, contexto, instrucciones, consideraciones, persistente, revelada, esquema_id, map_snapshot) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (mision['operacion_id'], mision['nombre'] + ' (Copia)', mision['tipo'], mision['etiquetas'], mision['oficial_responsable'], mision['resumen'], mision['contexto'], mision['instrucciones'], mision['consideraciones'], mision['persistente'], mision['revelada'], mision['esquema_id'], mision['map_snapshot'])
        )
        new_id = cursor.lastrowid
        conn.commit()
        conn.close()
        return jsonify({'id': new_id, 'status': 'success'}), 201
    conn.close()
    return jsonify({'status': 'error', 'message': 'Misión no encontrada'}), 404

import base64
@app.route('/api/misiones/<int:id>/snapshot', methods=['POST'])
def save_mision_snapshot(id):
    data = request.json
    image_data = data.get('image')
    if not image_data:
        return jsonify({'error': 'No image provided'}), 400
    
    if ',' in image_data:
        image_data = image_data.split(',')[1]
        
    try:
        image_bytes = base64.b64decode(image_data)
        uploads_dir = os.path.join(app.root_path, 'static', 'uploads', 'snapshots')
        os.makedirs(uploads_dir, exist_ok=True)
        filename = f'mision_{id}.png'
        filepath = os.path.join(uploads_dir, filename)
        
        with open(filepath, 'wb') as f:
            f.write(image_bytes)
            
        snapshot_url = f'/static/uploads/snapshots/{filename}'
        
        conn = get_db_connection()
        conn.execute('UPDATE Mision SET map_snapshot = ? WHERE id = ?', (snapshot_url, id))
        conn.commit()
        conn.close()
        
        return jsonify({'status': 'success', 'url': snapshot_url})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/misiones/reveal_all', methods=['POST'])
def reveal_all_misiones():
    data = request.json
    revelada = data.get('revelada', True)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('UPDATE Mision SET revelada = ?', (revelada,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})

@app.route('/api/mapa/esquemas', methods=['GET', 'POST'])
def manage_esquemas():
    conn = get_db_connection()
    if request.method == 'GET':
        faccion_nombre = session.get('faction', 'All')
        
        if faccion_nombre == 'All':
            esquemas = conn.execute('SELECT * FROM Esquema_Tactico').fetchall()
        else:
            f = conn.execute('SELECT id FROM Faccion WHERE nombre = ?', (faccion_nombre,)).fetchone()
            faccion_id = f['id'] if f else None
            esquemas = conn.execute('SELECT * FROM Esquema_Tactico WHERE faccion_id = ?', (faccion_id,)).fetchall()
            
        conn.close()
        return jsonify([dict(row) for row in esquemas])
    elif request.method == 'POST':
        data = request.json
        faccion_nombre = session.get('faction', 'All')
        faccion_id = None
        if faccion_nombre != 'All':
            f = conn.execute('SELECT id FROM Faccion WHERE nombre = ?', (faccion_nombre,)).fetchone()
            if f:
                faccion_id = f['id']
                
        cursor = conn.cursor()
        cursor.execute('INSERT INTO Esquema_Tactico (nombre, faccion_id, datos_json) VALUES (?, ?, ?)',
                       (data.get('nombre', 'Esquema sin nombre'), faccion_id, data.get('datos_json', '{}')))
        conn.commit()
        new_id = cursor.lastrowid
        conn.close()
        conn.close()
        return jsonify({'id': new_id, 'status': 'success'})

@app.route('/api/mapa/esquemas/<int:id>', methods=['DELETE'])
def delete_esquema(id):
    conn = get_db_connection()
    conn.execute('UPDATE Mision SET esquema_id = NULL WHERE esquema_id = ?', (id,))
    conn.execute('DELETE FROM Esquema_Tactico WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})
@app.route('/api/misiones/<int:id>/esquema', methods=['POST'])
def set_mision_esquema(id):
    data = request.json
    esquema_id = data.get('esquema_id')
    conn = get_db_connection()
    conn.execute('UPDATE Mision SET esquema_id = ? WHERE id = ?', (esquema_id, id))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})

@app.route('/api/orbat', methods=['GET'])
def get_orbat():
    conn = get_db_connection()
    # Get all battle groups
    grupos = conn.execute('''
        SELECT Grupo_Batalla.*, Faccion.color as faccion_color, Faccion.nombre as faccion_nombre, Mision.nombre as mision_nombre
        FROM Grupo_Batalla
        JOIN Faccion ON Grupo_Batalla.faccion_id = Faccion.id
        LEFT JOIN Mision ON Grupo_Batalla.mision_actual_id = Mision.id
    ''').fetchall()
    
    # We will simulate the current active operation ORBAT.
    # For now, we will return the groups and we will manage the assignment purely in memory or via the Historial_Asignacion for the current operation.
    
    # In a real scenario, we would filter by current operation.
    asignaciones = conn.execute('''
        SELECT Historial_Asignacion.*, Equipo.nombre as equipo_nombre, Equipo.jugadores,
               (SELECT COUNT(*) FROM Miembro m WHERE m.equipo_id = Equipo.id AND m.armamento LIKE '%Apoyo%') as apoyos,
               (SELECT COUNT(*) FROM Miembro m WHERE m.equipo_id = Equipo.id AND (m.armamento LIKE '%Sniper%' OR m.armamento LIKE '%Francotirador%')) as snipers
        FROM Historial_Asignacion
        JOIN Equipo ON Historial_Asignacion.equipo_id = Equipo.id
        WHERE operacion_id = 1
    ''').fetchall()
    
    conn.close()
    
    return jsonify({
        'grupos': [dict(row) for row in grupos],
        'asignaciones': [dict(row) for row in asignaciones]
    })

@app.route('/api/orbat/assign', methods=['POST'])
def assign_orbat():
    if session.get('role') != 'admin': return jsonify({'error': 'Unauthorized'}), 403
    data = request.json
    equipo_id = data['equipo_id']
    grupo_batalla_id = data['grupo_batalla_id']
    operacion_id = 1 # Hardcoded for this demo
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # If the admin removes assignment, delete ALL assignments for this team
    if grupo_batalla_id is None:
        cursor.execute('DELETE FROM Historial_Asignacion WHERE operacion_id = ? AND equipo_id = ?', (operacion_id, equipo_id))
    else:
        # Check for an existing approved assignment
        existing = cursor.execute("SELECT id FROM Historial_Asignacion WHERE operacion_id = ? AND equipo_id = ? AND estado = 'Aprobada'", (operacion_id, equipo_id)).fetchone()
        if existing:
            cursor.execute("UPDATE Historial_Asignacion SET grupo_batalla_id = ? WHERE id = ?", (grupo_batalla_id, existing['id']))
        else:
            cursor.execute("INSERT INTO Historial_Asignacion (operacion_id, equipo_id, grupo_batalla_id, estado) VALUES (?, ?, ?, 'Aprobada')", (operacion_id, equipo_id, grupo_batalla_id))
        
        # Delete any pending requests
        cursor.execute("DELETE FROM Historial_Asignacion WHERE operacion_id = ? AND equipo_id = ? AND estado = 'Pendiente'", (operacion_id, equipo_id))
            
    conn.commit()
    conn.close()
    
    return jsonify({'status': 'success'})

@app.route('/api/orbat/solicitar', methods=['POST'])
def solicitar_orbat():
    if session.get('role') != 'equipo': return jsonify({'error': 'Solo los equipos pueden solicitar'}), 403
    data = request.json
    equipo_id = session.get('equipo_id')
    grupo_batalla_id = data.get('grupo_batalla_id')
    operacion_id = 1
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Check if already approved
    approved = cursor.execute("SELECT id FROM Historial_Asignacion WHERE operacion_id = ? AND equipo_id = ? AND estado = 'Aprobada'", (operacion_id, equipo_id)).fetchone()
    if approved:
        conn.close()
        return jsonify({'error': 'Ya tienes una asignación aprobada.'}), 400
        
    # Check if already requested this group
    existing = cursor.execute("SELECT id FROM Historial_Asignacion WHERE operacion_id = ? AND equipo_id = ? AND grupo_batalla_id = ? AND estado = 'Pendiente'", (operacion_id, equipo_id, grupo_batalla_id)).fetchone()
    if not existing:
        cursor.execute("INSERT INTO Historial_Asignacion (operacion_id, equipo_id, grupo_batalla_id, estado) VALUES (?, ?, ?, 'Pendiente')", (operacion_id, equipo_id, grupo_batalla_id))
    
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})

@app.route('/api/orbat/solicitud/resolver', methods=['POST'])
def resolver_solicitud():
    if session.get('role') != 'admin': return jsonify({'error': 'Unauthorized'}), 403
    data = request.json
    asignacion_id = data['asignacion_id']
    accion = data['accion']
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    if accion == 'aprobar':
        # Get team ID first
        row = cursor.execute("SELECT equipo_id, operacion_id FROM Historial_Asignacion WHERE id = ?", (asignacion_id,)).fetchone()
        if row:
            equipo_id = row['equipo_id']
            operacion_id = row['operacion_id']
            # Approve this one
            cursor.execute("UPDATE Historial_Asignacion SET estado = 'Aprobada' WHERE id = ?", (asignacion_id,))
            # Delete all OTHER pending requests for this team in this operation
            cursor.execute("DELETE FROM Historial_Asignacion WHERE equipo_id = ? AND operacion_id = ? AND id != ?", (equipo_id, operacion_id, asignacion_id))
    elif accion == 'rechazar':
        cursor.execute('DELETE FROM Historial_Asignacion WHERE id = ?', (asignacion_id,))
    
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})

@app.route('/api/orbat/grupo/<int:id>', methods=['PUT'])
def update_grupo(id):
    data = request.json
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # PMR446 Frequencies mapping
    pmr_freqs = {
        '1': '446.00625', '2': '446.01875', '3': '446.03125', '4': '446.04375',
        '5': '446.05625', '6': '446.06875', '7': '446.08125', '8': '446.09375',
        '9': '446.10625', '10': '446.11875', '11': '446.13125', '12': '446.14375',
        '13': '446.15625', '14': '446.16875', '15': '446.18125', '16': '446.19375'
    }
    
    canal = data.get('canal_radio')
    frecuencia = data.get('frecuencia_radio')
    
    if canal and canal.startswith('Ch.'):
        ch_num = canal.replace('Ch.', '').strip()
        # Remove leading zero for dict lookup if exists, but we formatted it with zero maybe
        ch_num = str(int(ch_num)) if ch_num.isdigit() else ch_num
        if ch_num in pmr_freqs:
            frecuencia = f"{pmr_freqs[ch_num]} MHz"
            
    mision_id = data.get('mision_actual_id')
    if mision_id == "": mision_id = None

    # Fetch current data to handle partial updates
    current = cursor.execute('SELECT * FROM Grupo_Batalla WHERE id = ?', (id,)).fetchone()
    if not current:
        return jsonify({'error': 'Not found'}), 404

    final_canal = canal if 'canal_radio' in data else current['canal_radio']
    final_freq = frecuencia if ('frecuencia_radio' in data or 'canal_radio' in data) else current['frecuencia_radio']
    final_tel = data.get('telefono_contacto', current['telefono_contacto']) if 'telefono_contacto' in data else current['telefono_contacto']
    final_mision = mision_id if 'mision_actual_id' in data else current['mision_actual_id']
    final_jefe = data.get('nombre_jefe', current['nombre_jefe']) if 'nombre_jefe' in data else current['nombre_jefe']
    final_pos_x = data.get('pos_x', current['pos_x']) if 'pos_x' in data else current['pos_x']
    final_pos_y = data.get('pos_y', current['pos_y']) if 'pos_y' in data else current['pos_y']

    cursor.execute('''
        UPDATE Grupo_Batalla 
        SET canal_radio = ?, frecuencia_radio = ?, telefono_contacto = ?, mision_actual_id = ?, nombre_jefe = ?, pos_x = ?, pos_y = ?
        WHERE id = ?
    ''', (final_canal, final_freq, final_tel, final_mision, final_jefe, final_pos_x, final_pos_y, id))
    
    conn.commit()
    conn.close()
    
    return jsonify({'status': 'success', 'frecuencia_radio': frecuencia})

# --- RUTAS DEL MAPA TÁCTICO ---

@app.route('/api/mapa/marcadores', methods=['GET', 'POST', 'DELETE'])
def manage_marcadores():
    conn = get_db_connection()
    if request.method == 'GET':
        # Auto-purgar marcadores caducados
        try:
            conn.execute("DELETE FROM MarcadorMapa WHERE caduca_en IS NOT NULL AND caduca_en < datetime('now')")
            conn.commit()
        except Exception:
            pass

        faccion_id = request.args.get('faccion_id')
        user_role = session.get('role')
        if user_role != 'admin':
            f_id = session.get('faccion_id')
            if not f_id and session.get('equipo_id'):
                eq_row = conn.execute('SELECT faccion_id FROM Equipo WHERE id = ?', (session.get('equipo_id'),)).fetchone()
                if eq_row: f_id = eq_row['faccion_id']
            if not f_id and session.get('faction'):
                fac_row = conn.execute('SELECT id FROM Faccion WHERE nombre = ?', (session.get('faction'),)).fetchone()
                if fac_row: f_id = fac_row['id']
            faccion_id = f_id
            if not faccion_id:
                conn.close()
                return jsonify([])
        query = '''
            SELECT id, faccion_id, tipo, lat, lng, descripcion, autor_nombre, creado_en, caduca_en,
                   CAST((strftime('%s', 'now') - strftime('%s', COALESCE(creado_en, datetime('now')))) AS INTEGER) as segundos_transcurridos,
                   CASE WHEN caduca_en IS NOT NULL THEN
                       CAST((strftime('%s', caduca_en) - strftime('%s', 'now')) AS INTEGER)
                   ELSE NULL END as segundos_restantes
            FROM MarcadorMapa
        '''
        params = ()
        if faccion_id:
            query += ' WHERE faccion_id = ?'
            params = (faccion_id,)
        marcadores = conn.execute(query, params).fetchall()
        conn.close()
        return jsonify([dict(row) for row in marcadores])
    
    elif request.method == 'POST':
        if session.get('role') == 'operador':
            conn.close()
            return jsonify({'error': 'No autorizado para colocar marcadores tácticos'}), 403
        data = request.json or {}
        ttl_minutos = data.get('ttl_minutos')
        caduca_en = None
        if ttl_minutos is not None:
            try:
                ttl_val = int(ttl_minutos)
                if ttl_val > 0:
                    caduca_en = (datetime.utcnow() + timedelta(minutes=ttl_val)).strftime('%Y-%m-%d %H:%M:%S')
            except (ValueError, TypeError):
                pass

        autor_nombre = data.get('autor_nombre')
        if not autor_nombre:
            if session.get('role') == 'admin':
                autor_nombre = "MANDO"
            elif session.get('equipo_nombre'):
                autor_nombre = session.get('equipo_nombre')
            elif session.get('equipo_id'):
                eq_row = conn.execute('SELECT nombre FROM Equipo WHERE id = ?', (session.get('equipo_id'),)).fetchone()
                autor_nombre = eq_row['nombre'] if eq_row else "Equipo"
            else:
                autor_nombre = "Operador"

        cursor = conn.cursor()
        cursor.execute(
            '''INSERT INTO MarcadorMapa (faccion_id, tipo, lat, lng, descripcion, autor_nombre, creado_en, caduca_en)
               VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)''',
            (data['faccion_id'], data['tipo'], data['lat'], data['lng'], data.get('descripcion', ''), autor_nombre, caduca_en)
        )
        new_id = cursor.lastrowid
        conn.commit()
        conn.close()
        return jsonify({'id': new_id, 'status': 'success', 'caduca_en': caduca_en, 'autor_nombre': autor_nombre}), 201
    
    elif request.method == 'DELETE':
        if session.get('role') == 'operador':
            conn.close()
            return jsonify({'error': 'No autorizado para eliminar marcadores tácticos'}), 403
        faccion_id = request.args.get('faccion_id')
        if faccion_id:
            conn.execute('DELETE FROM MarcadorMapa WHERE faccion_id = ?', (faccion_id,))
            conn.commit()
        conn.close()
        return jsonify({'status': 'success'})

@app.route('/api/mapa/marcadores/<int:id>', methods=['DELETE'])
def delete_marcador(id):
    if session.get('role') == 'operador':
        return jsonify({'error': 'No autorizado para eliminar marcadores tácticos'}), 403
    conn = get_db_connection()
    conn.execute('DELETE FROM MarcadorMapa WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})

@app.route('/api/mapa/marcadores/<int:id>', methods=['PUT'])
def update_marcador(id):
    if session.get('role') == 'operador':
        return jsonify({'error': 'No autorizado para modificar marcadores tácticos'}), 403
    data = request.json or {}
    conn = get_db_connection()
    conn.execute('UPDATE MarcadorMapa SET lat = ?, lng = ? WHERE id = ?', (data['lat'], data['lng'], id))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})

# --- RUTAS BFT (BLUE FORCE TRACKING / BALIZAS EN TIEMPO REAL) ---

@app.route('/api/bft/beacon', methods=['POST'])
def post_bft_beacon():
    role = session.get('role')
    if role not in ['equipo', 'admin']:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.json or {}
    conn = get_db_connection()

    equipo_id = session.get('equipo_id')
    faccion_name = session.get('faction')
    faccion_id = None

    if role == 'admin':
        if data.get('equipo_id'):
            equipo_id = int(data.get('equipo_id'))
        if data.get('faccion_id'):
            faccion_id = int(data.get('faccion_id'))
        elif data.get('faccion'):
            f_row = conn.execute('SELECT id FROM Faccion WHERE nombre = ?', (data.get('faccion'),)).fetchone()
            faccion_id = f_row['id'] if f_row else 1
        else:
            faccion_id = 1
        if not equipo_id:
            eq_default = conn.execute('SELECT id FROM Equipo WHERE faccion_id = ? LIMIT 1', (faccion_id,)).fetchone()
            if not eq_default:
                eq_default = conn.execute('SELECT id FROM Equipo LIMIT 1').fetchone()
            if eq_default:
                equipo_id = eq_default['id']

    if not equipo_id:
        conn.close()
        return jsonify({'error': 'No equipo_id specified'}), 400

    if not faccion_id:
        eq_row = conn.execute('SELECT faccion_id FROM Equipo WHERE id = ?', (equipo_id,)).fetchone()
        if not eq_row:
            conn.close()
            return jsonify({'error': 'Equipo no encontrado'}), 404
        faccion_id = eq_row['faccion_id']

    gps_lat = data.get('gps_lat')
    gps_lng = data.get('gps_lng')

    if gps_lat is not None and gps_lng is not None:
        try:
            gps_lat = float(gps_lat)
            gps_lng = float(gps_lng)
        except (ValueError, TypeError):
            conn.close()
            return jsonify({'error': 'Coordenadas GPS no válidas'}), 400

        map_y, map_x = gps_mapper.gps_to_map(gps_lat, gps_lng)
        map_lat = round(map_y, 2)
        map_lng = round(map_x, 2)
        grid_coord = gps_mapper.get_grid_coordinate(map_lat, map_lng)
        en_zona = 1 if (0 <= map_lat <= 2000 and 0 <= map_lng <= 3000 and grid_coord != "FUERA MAPA") else 0
    elif data.get('map_lat') is not None and data.get('map_lng') is not None:
        try:
            map_lat = float(data.get('map_lat'))
            map_lng = float(data.get('map_lng'))
        except (ValueError, TypeError):
            conn.close()
            return jsonify({'error': 'Coordenadas de mapa no válidas'}), 400
        grid_coord = gps_mapper.get_grid_coordinate(map_lat, map_lng)
        en_zona = 1 if (0 <= map_lat <= 2000 and 0 <= map_lng <= 3000 and grid_coord != "FUERA MAPA") else 0
        gps_lat = float(data.get('gps_lat', 0.0))
        gps_lng = float(data.get('gps_lng', 0.0))
    else:
        conn.close()
        return jsonify({'error': 'Coordenadas requeridas'}), 400

    conn.execute('''
        INSERT INTO BalizaEquipo (equipo_id, faccion_id, gps_lat, gps_lng, map_lat, map_lng, grid_coord, en_zona, actualizado_en)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(equipo_id) DO UPDATE SET
            faccion_id=excluded.faccion_id,
            gps_lat=excluded.gps_lat,
            gps_lng=excluded.gps_lng,
            map_lat=excluded.map_lat,
            map_lng=excluded.map_lng,
            grid_coord=excluded.grid_coord,
            en_zona=excluded.en_zona,
            actualizado_en=excluded.actualizado_en
    ''', (equipo_id, faccion_id, gps_lat, gps_lng, map_lat, map_lng, grid_coord, en_zona))
    conn.commit()
    conn.close()

    return jsonify({
        'status': 'success',
        'en_zona': en_zona,
        'grid_coord': grid_coord,
        'map_lat': map_lat,
        'map_lng': map_lng,
        'gps_lat': gps_lat,
        'gps_lng': gps_lng
    })

@app.route('/api/bft/beacons', methods=['GET'])
def get_bft_beacons():
    conn = get_db_connection()
    user_role = session.get('role')
    user_faction = session.get('faction')

    faccion_id = request.args.get('faccion_id')

    forced_faccion_id = None
    if user_role != 'admin':
        f_row = conn.execute('SELECT id FROM Faccion WHERE nombre = ?', (user_faction,)).fetchone()
        if not f_row:
            conn.close()
            return jsonify([])
        forced_faccion_id = f_row['id']
    else:
        if faccion_id and faccion_id != 'All':
            try:
                forced_faccion_id = int(faccion_id)
            except ValueError:
                pass

    query = '''
        SELECT b.*, e.nombre as equipo_nombre, COALESCE(e.logo_url, e.foto_url) as logo_url,
               f.nombre as faccion_nombre, f.color as faccion_color,
               CAST((strftime('%s', 'now') - strftime('%s', b.actualizado_en)) AS INTEGER) as segundos_transcurridos
        FROM BalizaEquipo b
        JOIN Equipo e ON b.equipo_id = e.id
        JOIN Faccion f ON b.faccion_id = f.id
    '''
    params = ()
    if forced_faccion_id:
        query += ' WHERE b.faccion_id = ?'
        params = (forced_faccion_id,)

    query += ' ORDER BY b.actualizado_en DESC'
    rows = conn.execute(query, params).fetchall()
    conn.close()

    return jsonify([dict(r) for r in rows])

@app.route('/api/mapa/rutas', methods=['GET', 'POST', 'DELETE'])
def manage_rutas():
    conn = get_db_connection()
    if request.method == 'GET':
        faccion_id = request.args.get('faccion_id')
        user_role = session.get('role')
        if user_role != 'admin':
            f_id = session.get('faccion_id')
            if not f_id and session.get('equipo_id'):
                eq_row = conn.execute('SELECT faccion_id FROM Equipo WHERE id = ?', (session.get('equipo_id'),)).fetchone()
                if eq_row: f_id = eq_row['faccion_id']
            if not f_id and session.get('faction'):
                fac_row = conn.execute('SELECT id FROM Faccion WHERE nombre = ?', (session.get('faction'),)).fetchone()
                if fac_row: f_id = fac_row['id']
            faccion_id = f_id
            if not faccion_id:
                conn.close()
                return jsonify([])
            
        query = 'SELECT * FROM RutaMapa'
        params = ()
        if faccion_id:
            query += ' WHERE faccion_id = ?'
            params = (faccion_id,)
        rutas = conn.execute(query, params).fetchall()
        conn.close()
        return jsonify([dict(row) for row in rutas])
    
    elif request.method == 'POST':
        if session.get('role') == 'operador':
            conn.close()
            return jsonify({'error': 'No autorizado para trazar rutas'}), 403
        data = request.json
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO RutaMapa (faccion_id, nombre, puntos_json, color) VALUES (?, ?, ?, ?)',
            (data['faccion_id'], data.get('nombre', ''), data['puntos_json'], data.get('color', '#ff0000'))
        )
        new_id = cursor.lastrowid
        conn.commit()
        conn.close()
        return jsonify({'id': new_id, 'status': 'success'}), 201
    
    elif request.method == 'DELETE':
        if session.get('role') == 'operador':
            conn.close()
            return jsonify({'error': 'No autorizado'}), 403
        faccion_id = request.args.get('faccion_id')
        if faccion_id:
            conn.execute('DELETE FROM RutaMapa WHERE faccion_id = ?', (faccion_id,))
            conn.commit()
        conn.close()
        return jsonify({'status': 'success'})

@app.route('/api/mapa/rutas/<int:id>', methods=['DELETE'])
def delete_ruta(id):
    if session.get('role') == 'operador':
        return jsonify({'error': 'No autorizado'}), 403
    conn = get_db_connection()
    conn.execute('DELETE FROM RutaMapa WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})

@app.route('/api/mapa/zonas', methods=['GET', 'POST', 'DELETE'])
def manage_zonas():
    conn = get_db_connection()
    if request.method == 'GET':
        faccion_id = request.args.get('faccion_id')
        user_role = session.get('role')
        if user_role != 'admin':
            f_id = session.get('faccion_id')
            if not f_id and session.get('equipo_id'):
                eq_row = conn.execute('SELECT faccion_id FROM Equipo WHERE id = ?', (session.get('equipo_id'),)).fetchone()
                if eq_row: f_id = eq_row['faccion_id']
            if not f_id and session.get('faction'):
                fac_row = conn.execute('SELECT id FROM Faccion WHERE nombre = ?', (session.get('faction'),)).fetchone()
                if fac_row: f_id = fac_row['id']
            faccion_id = f_id
            if not faccion_id:
                conn.close()
                return jsonify([])
            
        query = 'SELECT * FROM ZonaMapa'
        params = ()
        if faccion_id:
            query += ' WHERE faccion_id = ?'
            params = (faccion_id,)
        zonas = conn.execute(query, params).fetchall()
        conn.close()
        return jsonify([dict(row) for row in zonas])
    
    elif request.method == 'POST':
        if session.get('role') == 'operador':
            conn.close()
            return jsonify({'error': 'No autorizado para trazar zonas'}), 403
        data = request.json
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO ZonaMapa (faccion_id, nombre, puntos_json, color) VALUES (?, ?, ?, ?)',
            (data['faccion_id'], data.get('nombre', ''), data['puntos_json'], data.get('color', '#0000ff'))
        )
        new_id = cursor.lastrowid
        conn.commit()
        conn.close()
        return jsonify({'id': new_id, 'status': 'success'}), 201
    
    elif request.method == 'DELETE':
        if session.get('role') == 'operador':
            conn.close()
            return jsonify({'error': 'No autorizado'}), 403
        faccion_id = request.args.get('faccion_id')
        if faccion_id:
            conn.execute('DELETE FROM ZonaMapa WHERE faccion_id = ?', (faccion_id,))
            conn.commit()
        conn.close()
        return jsonify({'status': 'success'})

@app.route('/api/mapa/zonas/<int:id>', methods=['DELETE'])
def delete_zona(id):
    if session.get('role') == 'operador':
        return jsonify({'error': 'No autorizado'}), 403
    conn = get_db_connection()
    conn.execute('DELETE FROM ZonaMapa WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})

@app.route('/api/pois', methods=['GET', 'POST'])
def manage_pois():
    conn = get_db_connection()
    if request.method == 'GET':
        pois_rows = conn.execute('SELECT * FROM puntos_interes').fetchall()
        pois = [dict(row) for row in pois_rows]
        
        # Filtro de visibilidad
        if session.get('role') != 'admin':
            faccion_nombre = session.get('faction')
            f = conn.execute('SELECT id FROM Faccion WHERE nombre = ?', (faccion_nombre,)).fetchone()
            fid = f['id'] if f else 0
            
            # Solo mostrar si es 0 (Todos) o si coincide con la faccion del usuario
            import json
            filtered = []
            for p in pois:
                vp = p.get('visible_para')
                if vp in (None, 0, '0', ''):
                    filtered.append(p)
                else:
                    try:
                        if isinstance(vp, str) and vp.startswith('['):
                            arr = json.loads(vp)
                            if fid in arr:
                                filtered.append(p)
                        elif str(vp) == str(fid):
                            filtered.append(p)
                    except:
                        pass
            pois = filtered
            
        conn.close()
        return jsonify(pois)
    
    elif request.method == 'POST':
        data = request.json
        cursor = conn.cursor()
        token = secrets.token_hex(4)
        cursor.execute(
            'INSERT INTO puntos_interes (nombre, descripcion, lat, lng, tolerancia_metros, tipo, token_qr, faccion_id, datos_extra, visible_para) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (data.get('nombre',''), data.get('descripcion', ''), data.get('lat', 0), data.get('lng', 0), data.get('tolerancia_metros', 15.0), data.get('tipo', 'PC'), token, data.get('faccion_id'), data.get('datos_extra', ''), data.get('visible_para', 0))
        )
        new_id = cursor.lastrowid
        conn.commit()
        conn.close()
        return jsonify({'id': new_id, 'token_qr': token, 'status': 'success'}), 201


@app.route('/api/pois/<int:id>', methods=['PUT', 'DELETE'])
def update_or_delete_poi(id):
    conn = get_db_connection()
    if request.method == 'DELETE':
        conn.execute('DELETE FROM puntos_interes WHERE id = ?', (id,))
    elif request.method == 'PUT':
        data = request.json
        old_poi = conn.execute('SELECT faccion_id FROM puntos_interes WHERE id=?', (id,)).fetchone()
        new_faccion = data.get('faccion_id')
        new_faccion = int(new_faccion) if new_faccion else None
        
        if old_poi and old_poi['faccion_id'] != new_faccion and new_faccion is not None:
            conn.execute('INSERT INTO puntos_control (poi_id, faccion_id) VALUES (?, ?)', (id, new_faccion))

        conn.execute(
            'UPDATE puntos_interes SET nombre=?, descripcion=?, lat=?, lng=?, tolerancia_metros=?, tipo=?, faccion_id=?, datos_extra=?, visible_para=? WHERE id=?',
            (data.get('nombre'), data.get('descripcion', ''), data.get('lat'), data.get('lng'), data.get('tolerancia_metros'), data.get('tipo'), new_faccion, data.get('datos_extra', ''), data.get('visible_para', 0), id)
        )
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})



from datetime import datetime, timedelta
@app.route('/api/scan', methods=['POST'])
def scan_qr():
    data = request.json
    token = data.get('token_qr')
    faccion_id = data.get('faccion_id')
    user_lat = data.get('user_lat')
    user_lng = data.get('user_lng')
    
    conn = get_db_connection()
    try:
        poi = conn.execute('SELECT * FROM puntos_interes WHERE token_qr = ?', (token,)).fetchone()
        
        if not poi:
            return jsonify({'status': 'error', 'message': 'QR Inválido o Punto no encontrado.'}), 404
            
        config = get_config()
        if config.get("geo_validation_enabled"):
            if user_lat is None or user_lng is None:
                return jsonify({'status': 'error', 'message': 'Se requiere ubicación GPS para escanear.'}), 400
            
            dist = haversine(float(user_lat), float(user_lng), float(poi['lat']), float(poi['lng']))
            tol = float(poi['tolerancia_metros']) if poi['tolerancia_metros'] else 15.0
            if dist > tol:
                return jsonify({'status': 'error', 'message': f'Estás demasiado lejos de la baliza ({int(dist)}m > {int(tol)}m). Acércate más.'}), 400
            
        if poi['tipo'] == 'PC':
            fac_id = None if str(faccion_id) == '0' else int(faccion_id)
            if fac_id not in [1, 2, None]:
                return jsonify({'status': 'error', 'message': 'Facción inválida para banderas.'}), 400
            if fac_id not in [1, 2] and session.get('role') != 'admin':
                return jsonify({'status': 'error', 'message': 'No tienes permisos para neutralizar este punto.'}), 403
            if poi['faccion_id'] == fac_id:
                return jsonify({'status': 'success', 'message': 'Este punto ya está en ese estado.'})
                
            conn.execute('UPDATE puntos_interes SET faccion_id = ? WHERE id = ?', (fac_id, poi['id']))
            equipo_id = data.get('equipo_id') if fac_id else None
            conn.execute('INSERT INTO puntos_control (poi_id, faccion_id, equipo_id) VALUES (?, ?, ?)', (poi['id'], fac_id, equipo_id))
            conn.commit()
            return jsonify({'status': 'success', 'message': "Punto capturado con éxito."})
            
        elif poi['tipo'] == 'RESPAWN':
            import json
            
            equipo_id = data.get('equipo_id')
            if not equipo_id:
                return jsonify({'status': 'error', 'message': 'Debes seleccionar un equipo.'}), 400
                
            # Verificar requisitos de captura si es Base Avanzada
            if poi['datos_extra']:
                try:
                    datos = json.loads(poi['datos_extra'])
                    reqs = datos.get('requisitos_captura', {})
                    # reqs format: {"1": [2, 3], "2": [4]}
                    
                    # La facción que intenta desplegar es poi['faccion_id']
                    fac_req = str(poi['faccion_id'])
                    if fac_req in reqs:
                        required_pc_ids = reqs[fac_req]
                        if required_pc_ids:
                            # Verify if these PCs are controlled by the faction
                            placeholders = ','.join('?' for _ in required_pc_ids)
                            pcs = conn.execute(f"SELECT id, nombre, faccion_id FROM puntos_interes WHERE id IN ({placeholders})", required_pc_ids).fetchall()
                            
                            faltan = []
                            for pc in pcs:
                                if pc['faccion_id'] != poi['faccion_id']:
                                    faltan.append(pc['nombre'])
                                    
                            if faltan:
                                msg = f"DENEGADO: Base comprometida. Requiere control de: {', '.join(faltan)}"
                                return jsonify({'status': 'error', 'message': msg}), 403
                except Exception as e:
                    print("Error parsing datos_extra:", e)
                    pass
                
            conn.execute('INSERT INTO respawn (poi_id, faccion_id, equipo_id) VALUES (?, ?, ?)', (poi['id'], poi['faccion_id'], equipo_id))
            
            # Recarga reglamentaria de botiquines al pasar por Respawn
            try:
                medicos = conn.execute("SELECT id, uid, rol FROM Miembro WHERE equipo_id = ? AND (LOWER(rol) LIKE '%medico%' OR LOWER(rol) LIKE '%médico%' OR LOWER(rol) LIKE '%sanitario%' OR LOWER(rol) LIKE '%medic%')", (equipo_id,)).fetchall()
                total_miembros = conn.execute("SELECT COUNT(*) as c FROM Miembro WHERE equipo_id = ? AND activo = 1", (equipo_id,)).fetchone()['c'] or 1
                cuota = medic_engine.calcular_curas_por_medico(total_miembros, len(medicos) if medicos else 1)
                
                targets = [m['uid'] for m in medicos if m['uid']]
                targets.append(f"MED-{equipo_id}")
                for target_med in set(targets):
                    medic_engine.update_sanitario_recursos(conn, target_med, disponibles=cuota, usadas=0)
            except Exception as e:
                print("Error recargando botiquines en /api/scan:", e)

            conn.commit()
            return jsonify({'status': 'success', 'message': "Despliegue autorizado y recursos médicos recargados."})
            
        else:
            return jsonify({'status': 'error', 'message': 'Este punto no admite esta acción.'}), 400
    finally:
        conn.close()


@app.route('/api/capturas/stats', methods=['GET'])
def get_capturas_stats():
    conn = get_db_connection()
    try:
        pois = conn.execute("SELECT id, nombre, faccion_id FROM puntos_interes WHERE tipo = 'PC'").fetchall()
        
        stats = {}
        total_tiempos = {1: 0, 2: 0} # 1: Syldavia, 2: Volkovia
        historial = []
        
        for p in pois:
            poi_id = p['id']
            stats[poi_id] = {'nombre': p['nombre'], 'owner_actual': p['faccion_id'], 'tiempos': {1: 0, 2: 0}}
            
            # Get all captures for this POI ordered by time
            capturas = conn.execute('''
                SELECT c.faccion_id, c.timestamp, e.nombre as equipo_nombre 
                FROM puntos_control c
                LEFT JOIN Equipo e ON c.equipo_id = e.id
                WHERE c.poi_id = ? 
                ORDER BY c.timestamp ASC
            ''', (poi_id,)).fetchall()
            
            last_time = None
            last_faccion = None
            
            for c in capturas:
                c_time = datetime.strptime(c['timestamp'], '%Y-%m-%d %H:%M:%S')
                c_faccion = c['faccion_id']
                
                historial.append({
                    'poi_nombre': p['nombre'],
                    'faccion_id': c_faccion,
                    'equipo_nombre': c['equipo_nombre'] or 'Desconocido',
                    'timestamp': c['timestamp']
                })
                
                if last_time and last_faccion in [1, 2]:
                    diff = (c_time - last_time).total_seconds() / 60.0
                    stats[poi_id]['tiempos'][last_faccion] += diff
                    total_tiempos[last_faccion] += diff
                    
                last_time = c_time
                last_faccion = c_faccion
                
            # Add time from last capture to NOW
            if last_time and last_faccion in [1, 2]:
                now = datetime.utcnow()
                diff = (now - last_time).total_seconds() / 60.0
                stats[poi_id]['tiempos'][last_faccion] += diff
                total_tiempos[last_faccion] += diff
                
        # Fetch respawn history
        respawns_db = conn.execute('''
            SELECT r.timestamp, p.nombre as poi_nombre, r.faccion_id, e.nombre as equipo_nombre
            FROM respawn r
            JOIN puntos_interes p ON r.poi_id = p.id
            LEFT JOIN Equipo e ON r.equipo_id = e.id
            ORDER BY r.timestamp DESC
        ''').fetchall()
        
        historial_respawns = []
        for r in respawns_db:
            historial_respawns.append({
                'timestamp': r['timestamp'],
                'poi_nombre': r['poi_nombre'],
                'faccion_id': r['faccion_id'],
                'equipo_nombre': r['equipo_nombre'] or 'Desconocido'
            })
            
        def check_base_avanzada(faccion_id):
            base_avd = conn.execute("SELECT id, datos_extra FROM puntos_interes WHERE tipo = 'RESPAWN' AND faccion_id = ? AND datos_extra LIKE '%requisitos_captura%'", (faccion_id,)).fetchone()
            if not base_avd:
                return "NO APLICA"
            try:
                import json
                datos = json.loads(base_avd['datos_extra'])
                reqs = datos.get('requisitos_captura', {}).get(str(faccion_id), [])
                if reqs:
                    placeholders = ','.join('?' for _ in reqs)
                    pcs = conn.execute(f"SELECT faccion_id FROM puntos_interes WHERE id IN ({placeholders})", reqs).fetchall()
                    for pc in pcs:
                        if pc['faccion_id'] != faccion_id:
                            return "INACTIVA"
                return "ACTIVA"
            except Exception as e:
                print("Error evaluando base avanzada:", e)
                return "ERROR"

        bases_activas = {
            '1': check_base_avanzada(1),
            '2': check_base_avanzada(2)
        }
            
    finally:
        conn.close()
        
    # Sort history descending
    historial.sort(key=lambda x: x['timestamp'], reverse=True)
    
    return jsonify({
        'stats_puntos': stats,
        'total_facciones': total_tiempos,
        'historial': historial,
        'historial_respawns': historial_respawns,
        'bases_activas': bases_activas
    })

@app.route('/scan/<token>', methods=['GET'])
def view_scan(token):
    conn = get_db_connection()
    poi = conn.execute('SELECT * FROM puntos_interes WHERE token_qr = ?', (token,)).fetchone()
    
    if not poi:
        conn.close()
        return "Punto no encontrado o QR inválido.", 404
        
    if poi['tipo'] == 'OP':
        session['active_op_token'] = token
        conn.close()
        return redirect(url_for('view_target'))
        
    equipos_db = conn.execute('SELECT id, nombre, faccion_id FROM Equipo ORDER BY nombre').fetchall()
    conn.close()
    
    equipos = []
    for eq in equipos_db:
        equipos.append({'id': eq['id'], 'nombre': eq['nombre'], 'faccion_id': eq['faccion_id']})
        
    return render_template(
        'scan.html', 
        poi=poi, 
        user_role=session.get('role', 'player'), 
        equipos=equipos,
        user_equipo_id=session.get('equipo_id'),
        user_faccion_id=session.get('faccion_id')
    )

@app.route('/target', methods=['GET'])
def view_target():
    token = session.get('active_op_token')
    if not token:
        return "ACCESO DENEGADO. DEBES ESCANEAR EL CÓDIGO QR FÍSICAMENTE.", 403
        
    conn = get_db_connection()
    poi = conn.execute('SELECT * FROM puntos_interes WHERE token_qr = ?', (token,)).fetchone()
    
    if not poi or poi['tipo'] != 'OP':
        conn.close()
        return "ENLACE CORRUPTO O EXPIRADO.", 404
        
    equipo_id = session.get('equipo_id')
    user_role = session.get('role', 'player')
    
    active_targets = conn.execute("SELECT id, lat, lng, grid_reference, bearing, image_url, intel_text, entorno_text, linked_pc_id, is_fake FROM dynamic_targets WHERE source_op_id = ? AND status = 'ACTIVE' AND id NOT LIKE '%-COL'", (poi['id'],)).fetchall()
    if active_targets:
        active_targets_list = []
        for t in active_targets:
            tgt_dict = dict(t)
            poi_px_lat, poi_px_lng = gps_mapper.gps_to_map(poi['lat'], poi['lng'])
            tgt_dict['azimut'] = calculate_azimuth(poi_px_lat, poi_px_lng, tgt_dict['lat'], tgt_dict['lng'])
            tgt_dict['distancia'] = dynamic_targets_engine.calculate_distance(poi_px_lat, poi_px_lng, tgt_dict['lat'], tgt_dict['lng'])
            
            # Fetch PC name for admin visibility
            if tgt_dict.get('linked_pc_id'):
                pc = conn.execute('SELECT nombre FROM puntos_interes WHERE id = ?', (tgt_dict['linked_pc_id'],)).fetchone()
                pc_nombre = pc['nombre'] if pc else "DESCONOCIDO"
            else:
                pc_nombre = "NINGÚN PC (NO HAY PCs DISPONIBLES EN ESTA FACCIÓN)"
            tgt_dict['pc_nombre'] = pc_nombre
            
            active_targets_list.append(tgt_dict)
        conn.close()
        return render_template('op_locked.html', poi=poi, active_targets=active_targets_list, equipo_id=equipo_id, user_role=user_role)
        
    # Check Lockout (Only apply to equipos, admins skip lockout for testing)
    if equipo_id and user_role != 'admin':
        equipo = conn.execute('SELECT ultimo_op_usado_id FROM Equipo WHERE id = ?', (equipo_id,)).fetchone()
        if equipo and equipo['ultimo_op_usado_id'] == poi['id']:
            conn.close()
            return render_template('op_locked.html', poi=poi, active_targets=[], equipo_id=equipo_id)

    faccion_id = poi['faccion_id']
    conn.close()
    
    # Generate random IMINT scenario
    scenario = imint_engine.generate_imint_scenario(faccion_id)
    
    return render_template('imint_minigame.html', poi=poi, scenario=scenario, equipo_id=equipo_id, faccion_id=faccion_id)

@app.route('/api/imint/confirm', methods=['POST'])
def api_imint_confirm():
    data = request.json
    source_op_id = data.get('op_id')
    faccion_id = data.get('faccion_id')
    equipo_id = data.get('equipo_id')
    
    # Target rules based on what was selected
    is_fake = data.get('is_fake', False)
    genera_colateral = data.get('genera_colateral', False)
    image_url = data.get('image_url')
    intel_text = data.get('intel_text')
    entorno_text = data.get('entorno_text')
    
    target_info = imint_engine.confirm_imint_target(source_op_id, faccion_id, equipo_id, is_fake, genera_colateral, image_url, intel_text, entorno_text)
    
    # Destruir / completar la sesión del OP secundario dinámico una vez confirmado el objetivo
    op_dinamico_engine.destroy_op_secundario_by_source_op(source_op_id)
    
    target_dict = dict(target_info)
    
    # Calculate azimuth and distance from OP (Need to convert OP GPS to Map Pixels first)
    conn = get_db_connection()
    poi = conn.execute('SELECT lat, lng FROM puntos_interes WHERE id = ?', (source_op_id,)).fetchone()
    if poi:
        poi_px_lat, poi_px_lng = gps_mapper.gps_to_map(poi['lat'], poi['lng'])
        target_dict['azimut'] = calculate_azimuth(poi_px_lat, poi_px_lng, target_dict['lat'], target_dict['lng'])
        target_dict['distancia'] = dynamic_targets_engine.calculate_distance(poi_px_lat, poi_px_lng, target_dict['lat'], target_dict['lng'])
    
    # Re-fetch PC name to send back
    if target_dict.get('linked_pc_id'):
        pc = conn.execute('SELECT nombre FROM puntos_interes WHERE id = ?', (target_dict['linked_pc_id'],)).fetchone()
        pc_nombre = pc['nombre'] if pc else "DESCONOCIDO"
    else:
        pc_nombre = "NINGÚN PC (NO HAY PCs DISPONIBLES EN ESTA FACCIÓN)"
        
    conn.close()
    
    target_dict['pc_nombre'] = pc_nombre
    
    return jsonify({'status': 'success', 'target': target_dict})

@app.route('/api/imint/abort', methods=['POST'])
def api_imint_abort():
    data = request.json
    source_op_id = data.get('op_id')
    equipo_id = data.get('equipo_id')
    target_id = data.get('target_id')
    
    imint_engine.abort_imint_mission(source_op_id, equipo_id, target_id)
    op_dinamico_engine.destroy_op_secundario_by_source_op(source_op_id)
    return jsonify({'status': 'success'})

@app.route('/api/op-dinamico/iniciar', methods=['POST'])
def api_op_dinamico_iniciar():
    if 'role' not in session:
        return jsonify({'error': 'No autorizado'}), 401
    data = request.json or {}
    source_op_id = data.get('op_id')
    if not source_op_id:
        return jsonify({'error': 'op_id requerido'}), 400
    user_role = session.get('role', 'player')
    user_faction = session.get('faction')
    equipo_id = session.get('equipo_id')

    conn = get_db_connection()
    op = conn.execute("SELECT * FROM puntos_interes WHERE id = ? AND tipo = 'OP'", (source_op_id,)).fetchone()
    if not op:
        conn.close()
        return jsonify({'error': 'OP no encontrado'}), 404

    faccion_id = op['faccion_id']
    if not faccion_id:
        f_row = conn.execute('SELECT id FROM Faccion WHERE nombre = ?', (user_faction,)).fetchone()
        faccion_id = f_row['id'] if f_row else 1

    if equipo_id and user_role != 'admin':
        eq = conn.execute("SELECT ultimo_op_usado_id FROM Equipo WHERE id = ?", (equipo_id,)).fetchone()
        if eq and eq['ultimo_op_usado_id'] == int(source_op_id):
            conn.close()
            return jsonify({'error': 'Sector bloqueado. Mando exige alternar al siguiente Punto de Observación.'}), 403

    conn.close()
    try:
        ses = op_dinamico_engine.get_or_create_op_secundario(source_op_id, faccion_id, equipo_id, gps_mapper)
        return jsonify({'status': 'success', 'session': ses})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/op-dinamico/posicion', methods=['POST'])
def api_op_dinamico_posicion():
    if 'role' not in session:
        return jsonify({'error': 'No autorizado'}), 401
    data = request.json or {}
    token_sesion = data.get('token_sesion')
    try:
        lat = float(data.get('lat'))
        lng = float(data.get('lng'))
    except (TypeError, ValueError):
        return jsonify({'error': 'Coordenadas lat/lng requeridas'}), 400

    res = op_dinamico_engine.check_player_proximity(token_sesion, lat, lng)
    if 'error' in res:
        return jsonify(res), 400
    return jsonify(res)

@app.route('/api/op-dinamico/adquirir', methods=['POST'])
def api_op_dinamico_adquirir():
    if 'role' not in session:
        return jsonify({'error': 'No autorizado'}), 401
    data = request.json or {}
    token_sesion = data.get('token_sesion')
    lat = data.get('lat')
    lng = data.get('lng')
    player_lat = float(lat) if lat is not None else None
    player_lng = float(lng) if lng is not None else None

    res = op_dinamico_engine.acquire_contact(token_sesion, player_lat, player_lng)
    if not res.get('success'):
        return jsonify(res), 400

    if res.get('token_qr'):
        session['active_op_token'] = res['token_qr']
        session.modified = True

    return jsonify(res)


@app.route('/api/analytics')
def get_analytics():
    conn = get_db_connection()
    try:
        # Top equipos por capturas
        top_capturas = conn.execute('''
            SELECT e.nombre as equipo_nombre, f.nombre as faccion_nombre, COUNT(c.id) as total
            FROM puntos_control c
            JOIN Equipo e ON c.equipo_id = e.id
            JOIN Faccion f ON e.faccion_id = f.id
            GROUP BY e.id
            ORDER BY total DESC
            LIMIT 10
        ''').fetchall()
        
        # Top equipos por respawns
        top_respawns = conn.execute('''
            SELECT e.nombre as equipo_nombre, f.nombre as faccion_nombre, COUNT(r.id) as total
            FROM respawn r
            JOIN Equipo e ON r.equipo_id = e.id
            JOIN Faccion f ON e.faccion_id = f.id
            GROUP BY e.id
            ORDER BY total DESC
            LIMIT 10
        ''').fetchall()
        
        # Respawns por facción
        respawns_faccion = conn.execute('''
            SELECT f.nombre as faccion_nombre, COUNT(r.id) as total
            FROM respawn r
            JOIN Faccion f ON r.faccion_id = f.id
            GROUP BY f.id
        ''').fetchall()
        

        # --- Generacion Koronnas (Por Horas) ---
        pois = conn.execute("SELECT id FROM puntos_interes WHERE tipo='PC'").fetchall()
        
        hourly_koronnas = []
        for h in range(0, 24):
            hourly_koronnas.append({'hora': f"{h:02d}:00", '1': 0, '2': 0})
            
        now_utc = datetime.utcnow()
        now_local = datetime.now()
        offset = now_local - now_utc

        def distribute_time(start_t_utc, end_t_utc, faccion):
            start_local = start_t_utc + offset
            end_local = end_t_utc + offset
            
            curr = start_local
            while curr < end_local:
                bh = curr.hour
                if 0 <= bh <= 23:
                    next_h = curr.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
                    chunk_end = min(end_local, next_h)
                    mins = (chunk_end - curr).total_seconds() / 60.0
                    # Find the bucket in the array
                    for b in hourly_koronnas:
                        if b['hora'] == f"{bh:02d}:00":
                            b[str(faccion)] += (mins * 10)
                            break
                # advance
                next_step = curr.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
                curr = min(end_local, next_step)

        for poi in pois:
            capturas = conn.execute('''
                SELECT faccion_id, timestamp 
                FROM puntos_control 
                WHERE poi_id = ? 
                ORDER BY timestamp ASC
            ''', (poi['id'],)).fetchall()
            
            last_time = None
            last_faccion = None
            
            for c in capturas:
                c_time_utc = datetime.strptime(c['timestamp'], '%Y-%m-%d %H:%M:%S')
                c_faccion = c['faccion_id']
                
                if last_time and last_faccion in [1, 2]:
                    distribute_time(last_time, c_time_utc, last_faccion)
                
                last_time = c_time_utc
                last_faccion = c_faccion
                
            if last_time and last_faccion in [1, 2]:
                distribute_time(last_time, now_utc, last_faccion)
                
        # round up/down nicely
        for b in hourly_koronnas:
            b['1'] = int(round(b['1']))
            b['2'] = int(round(b['2']))
            

        return jsonify({
            'top_capturas': [dict(x) for x in top_capturas],
            'top_respawns': [dict(x) for x in top_respawns],
            'respawns_faccion': [dict(x) for x in respawns_faccion],
            'hourly_koronnas': hourly_koronnas
        })
    finally:
        conn.close()


@app.route('/api/admin/reset', methods=['POST'])
def admin_reset():
    if session.get('role') != 'admin':
        return jsonify({'status': 'error', 'message': 'No autorizado'}), 403
    conn = get_db_connection()
    try:
        conn.execute('DELETE FROM puntos_control')
        conn.execute('DELETE FROM respawn')
        conn.execute('UPDATE Grupo_Batalla SET mision_actual_id = NULL')
        conn.execute("UPDATE puntos_interes SET faccion_id = NULL WHERE tipo = 'PC'")
        
        # Purgar usos médicos e intervenciones clínicas, y recargar sanitarios según doctrina TVC
        try:
            medic_engine.reset_all_medic_data(conn)
        except Exception as e:
            print("Error reseteando datos médicos en Zafarrancho:", e)
            
        conn.commit()
        return jsonify({'status': 'success', 'message': 'Zafarrancho de combate completado. Redes, misiones y usos médicos purgados.'})
    finally:
        conn.close()


import math
from datetime import datetime, timedelta



@app.route('/api/mortero/fijar', methods=['POST'])
def api_mortero_fijar():
    if 'role' not in session: return jsonify({'error': 'Unauthorized'}), 401
    
    data = request.json or {}
    faccion_name = session.get('faction', '')
    if session.get('role') == 'admin' and data.get('admin_faccion'):
        faccion_name = data.get('admin_faccion')
        
    faccion_id = 1 if faccion_name == 'Syldavia' else (2 if faccion_name == 'Volkovia' else None)
    if not faccion_id: return jsonify({'error': 'Facción inválida para artillería.'}), 400
    
    gps_lat = data.get('gps_lat')
    gps_lng = data.get('gps_lng')
    grid_coord = None
    
    if gps_lat is not None and gps_lng is not None:
        try:
            gps_lat = float(gps_lat)
            gps_lng = float(gps_lng)
            map_y, map_x = gps_mapper.gps_to_map(gps_lat, gps_lng)
            lat = round(map_y, 2)
            lng = round(map_x, 2)
            grid_coord = gps_mapper.get_grid_coordinate(lat, lng)
            
            # Validar límites de la zona de operaciones
            if not (0 <= lat <= 2000 and 0 <= lng <= 3000) or grid_coord == "FUERA MAPA":
                return jsonify({
                    'error': 'Posición GPS fuera del área de operaciones.',
                    'fuera_de_zona': True,
                    'grid_coord': grid_coord
                }), 400
        except Exception as e:
            return jsonify({'error': f'Coordenadas GPS no válidas: {str(e)}'}), 400
    else:
        lat = data.get('lat')
        lng = data.get('lng')
        if lat is None or lng is None:
            return jsonify({'error': 'Faltan coordenadas de despliegue.'}), 400
        try:
            lat = float(lat)
            lng = float(lng)
            grid_coord = gps_mapper.get_grid_coordinate(lat, lng)
        except Exception:
            return jsonify({'error': 'Coordenadas de despliegue no válidas.'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('UPDATE Mortero_Estado SET lat=?, lng=? WHERE faccion_id=?', (lat, lng, faccion_id))
    conn.commit()
    conn.close()
    
    return jsonify({
        'status': 'success',
        'lat': lat,
        'lng': lng,
        'grid_coord': grid_coord
    })

def ensure_artilleria_tables(conn):
    try:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS Mortero_Config (
                id INTEGER PRIMARY KEY,
                alcance_base INTEGER DEFAULT 800,
                radio_explosion INTEGER DEFAULT 15,
                disparos_por_minuto INTEGER DEFAULT 5,
                duracion_radar_minutos INTEGER DEFAULT 15
            )
        ''')
        try:
            conn.execute('ALTER TABLE Mortero_Config ADD COLUMN duracion_radar_minutos INTEGER DEFAULT 15;')
        except Exception:
            pass
        conn.execute('''
            CREATE TABLE IF NOT EXISTS Mortero_Estado (
                faccion_id INTEGER PRIMARY KEY,
                activo BOOLEAN DEFAULT 1,
                lat REAL,
                lng REAL,
                ultimo_disparo DATETIME
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS Mortero_Disparo (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                faccion TEXT,
                origen_x TEXT,
                origen_y INTEGER,
                azimut REAL,
                angulo REAL,
                pixel_x REAL,
                pixel_y REAL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                borrado BOOLEAN DEFAULT 0
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS Mortero_Historial_Disparos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                faccion_id INTEGER,
                lat REAL,
                lng REAL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS Mortero_Radar (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                faccion_id_origen INTEGER,
                lat REAL,
                lng REAL,
                radio REAL,
                caduca_en DATETIME
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS Log_Artilleria (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                faccion_id INTEGER,
                tipo_objetivo TEXT,
                objetivo_id TEXT,
                descripcion TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (faccion_id) REFERENCES Faccion (id)
            )
        ''')
        conn.commit()
    except Exception as e:
        print("Error en ensure_artilleria_tables:", e)

def ensure_operator_and_ice_tables(conn):
    try:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS Miembro_ICE (
                miembro_id INTEGER PRIMARY KEY,
                grupo_sanguineo TEXT,
                alergias TEXT,
                condiciones_medicas TEXT,
                medicacion_actual TEXT,
                contacto_nombre TEXT,
                contacto_telefono TEXT,
                contacto_parentesco TEXT,
                observaciones TEXT,
                actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (miembro_id) REFERENCES Miembro (id) ON DELETE CASCADE
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS Equipo_ReadyCheck (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                equipo_id INTEGER NOT NULL,
                titulo TEXT DEFAULT 'Pase de Lista Táctico',
                activo BOOLEAN DEFAULT 1,
                iniciado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
                cerrado_en DATETIME,
                FOREIGN KEY (equipo_id) REFERENCES Equipo (id) ON DELETE CASCADE
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS Miembro_ReadyCheck (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ready_check_id INTEGER NOT NULL,
                miembro_id INTEGER NOT NULL,
                estado TEXT DEFAULT 'PENDIENTE',
                nota TEXT,
                respondido_en DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(ready_check_id, miembro_id),
                FOREIGN KEY (ready_check_id) REFERENCES Equipo_ReadyCheck (id) ON DELETE CASCADE,
                FOREIGN KEY (miembro_id) REFERENCES Miembro (id) ON DELETE CASCADE
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS Miembro_Arma (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                miembro_id INTEGER NOT NULL,
                modelo TEXT NOT NULL,
                tipo TEXT NOT NULL,
                fps REAL DEFAULT NULL,
                julios REAL DEFAULT NULL,
                peso_bb TEXT DEFAULT '0.20g',
                estado_crono TEXT DEFAULT 'PENDIENTE',
                precinto_num TEXT DEFAULT '',
                cronometrado_en DATETIME DEFAULT NULL,
                cronometrado_por TEXT DEFAULT '',
                FOREIGN KEY (miembro_id) REFERENCES Miembro (id) ON DELETE CASCADE
            )
        ''')
        cols_to_add = [
            ("pin", "TEXT"),
            ("tiene_dron", "BOOLEAN DEFAULT 0"),
            ("dron_modelo", "TEXT DEFAULT ''"),
            ("tiene_nvg", "BOOLEAN DEFAULT 0"),
            ("nvg_categoria", "TEXT DEFAULT ''"),
            ("nvg_modelo", "TEXT DEFAULT ''"),
            ("listo_combate", "BOOLEAN DEFAULT 0"),
            ("listo_timestamp", "DATETIME")
        ]
        existing_cols = {row[1] for row in conn.execute('PRAGMA table_info(Miembro)').fetchall()}
        for col_name, col_type in cols_to_add:
            if col_name not in existing_cols:
                try:
                    conn.execute(f'ALTER TABLE Miembro ADD COLUMN {col_name} {col_type};')
                except Exception:
                    pass
        conn.commit()
    except Exception as e:
        print("Error en ensure_operator_and_ice_tables:", e)

@app.route('/api/mortero/pintar', methods=['POST'])
def api_mortero_pintar():
    if 'role' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    conn = None
    try:
        data = request.json
        faccion_name = session.get('faction', '')
        if session.get('role') == 'admin' and data.get('admin_faccion'):
            faccion_name = data.get('admin_faccion')
            
        faccion_id = 1 if faccion_name == 'Syldavia' else (2 if faccion_name == 'Volkovia' else None)
        if not faccion_id: return jsonify({'error': 'Facción inválida para artillería.'}), 400

        azimut = float(data.get('azimut', 0))
        angulo = float(data.get('angulo', 45))
        
        conn = get_db_connection()
        ensure_artilleria_tables(conn)
        cursor = conn.cursor()
        
        # Obtener config
        config = cursor.execute('SELECT * FROM Mortero_Config WHERE id=1').fetchone()
        alcance_base = config['alcance_base'] if config else 180
        radio_explosion = config['radio_explosion'] if config else 50
        disparos_por_minuto = config['disparos_por_minuto'] if config else 2
        duracion_radar_minutos = 15
        if config:
            try:
                if 'duracion_radar_minutos' in config.keys() and config['duracion_radar_minutos']:
                    duracion_radar_minutos = int(config['duracion_radar_minutos'])
            except Exception:
                pass
        
        # Obtener estado de este mortero
        estado = cursor.execute('SELECT * FROM Mortero_Estado WHERE faccion_id=?', (faccion_id,)).fetchone()
        if not estado or not estado['activo']:
            return jsonify({'error': 'Mortero inhabilitado o destruido.'}), 403
            
        if not estado['lat'] or not estado['lng']:
            return jsonify({'error': 'Fija la posición de la batería primero.'}), 400
            
        # Validate elevation
        if angulo < 45 or angulo > 85:
            return jsonify({'error': 'La elevación debe estar entre 45 y 85 grados.'}), 400

        # Comprobar cooldown
        if estado['ultimo_disparo']:
            ultimo = datetime.strptime(estado['ultimo_disparo'], '%Y-%m-%d %H:%M:%S')
            segundos_cooldown = 60.0 / float(disparos_por_minuto)
            if (datetime.utcnow() - ultimo).total_seconds() < segundos_cooldown:
                return jsonify({'error': 'El cañón está sobrecalentado. Espera.'}), 429

        # Flat map calculations (L.CRS.Simple)
        # 1 grid sector = 50 meters = ~31.71 pixels (from GRID_SIZE_X)
        PIXELS_PER_METER = 31.71 / 50.0
        
        # Calculate range in meters (Max range at 45 deg, min at 85 deg)
        # using R is proportional to sin(2*theta)
        alcance_m = float(alcance_base) * math.sin(math.radians(2 * angulo))
        distancia_px = alcance_m * PIXELS_PER_METER
        
        # Azimuth calculation (0 = North/Up, 90 = East/Right)
        theta = math.radians(90 - azimut)
        impacto_lng = estado['lng'] + distancia_px * math.cos(theta)
        impacto_lat = estado['lat'] + distancia_px * math.sin(theta)
        
        # Store shot
        cursor.execute('''INSERT INTO Mortero_Disparo 
            (faccion, origen_x, origen_y, azimut, angulo, pixel_x, pixel_y) 
            VALUES (?, ?, ?, ?, ?, ?, ?)''',
            (faccion_name, str(estado['lat']), int(estado['lng']), azimut, angulo, impacto_lat, impacto_lng))
            
        # Log to Historial Disparos for Radar logic
        cursor.execute('''INSERT INTO Mortero_Historial_Disparos 
            (faccion_id, lat, lng, timestamp) VALUES (?, ?, ?, datetime('now'))''', 
            (faccion_id, estado['lat'], estado['lng']))
            
        # Cleanup old shots (older than 10 minutes)
        cursor.execute('''DELETE FROM Mortero_Historial_Disparos 
            WHERE timestamp < datetime('now', '-10 minutes')''')
            
        # Check Radar Condition
        # Get all shots from this faction in the last 10 minutes
        recent_shots = cursor.execute('''SELECT lat, lng FROM Mortero_Historial_Disparos 
            WHERE faccion_id = ?''', (faccion_id,)).fetchall()
            
        if len(recent_shots) >= 6:
            # Check how many are within 50 meters of the CURRENT shot
            close_shots_count = 0
            for rs in recent_shots:
                dist_px = math.sqrt((estado['lat'] - rs['lat'])**2 + (estado['lng'] - rs['lng'])**2)
                dist_m = dist_px / PIXELS_PER_METER
                if dist_m <= 50:
                    close_shots_count += 1
                    
            if close_shots_count >= 6:
                # Trigger radar!
                # Calculate average location
                avg_lat = sum([rs['lat'] for rs in recent_shots]) / len(recent_shots)
                avg_lng = sum([rs['lng'] for rs in recent_shots]) / len(recent_shots)
                
                # Cleanup any expired markers or previous marker for this faction
                cursor.execute("DELETE FROM Mortero_Radar WHERE faccion_id_origen = ? OR caduca_en < datetime('now')", (faccion_id,))
                
                # Insert a new radar marker valid for configured duration (e.g. 15 minutes)
                cursor.execute(f'''INSERT INTO Mortero_Radar 
                    (faccion_id_origen, lat, lng, radio, caduca_en) 
                    VALUES (?, ?, ?, ?, datetime('now', '+{int(duracion_radar_minutos)} minutes'))''',
                    (faccion_id, avg_lat, avg_lng, 50.0))
        
        # Update cooldown
        cursor.execute("UPDATE Mortero_Estado SET ultimo_disparo=datetime('now') WHERE faccion_id=?", (faccion_id,))
        
        # Contrabatería Check using Pythagorean theorem
        enemy_id = 2 if faccion_id == 1 else 1
        enemy_estado = cursor.execute('SELECT * FROM Mortero_Estado WHERE faccion_id=?', (enemy_id,)).fetchone()
        
        destruido = False
        if enemy_estado and enemy_estado['lat'] and enemy_estado['lng'] and enemy_estado['activo']:
            dist_px = math.sqrt((impacto_lat - enemy_estado['lat'])**2 + (impacto_lng - enemy_estado['lng'])**2)
            dist_m = dist_px / PIXELS_PER_METER
            if dist_m <= radio_explosion:
                cursor.execute('UPDATE Mortero_Estado SET activo=0 WHERE faccion_id=?', (enemy_id,))
                destruido = True
                
        # Commit the transaction so that dynamic_targets_engine (which opens a new connection) can acquire a write lock
        conn.commit()
                
        # Check Dynamic Targets destruction
        import dynamic_targets_engine
        destroyed_dynamic_targets = dynamic_targets_engine.check_artillery_impact(faccion_id, impacto_lat, impacto_lng, radio_explosion)
        
        # LOG ARTILLERIA (Safe logging block)
        try:
            if destruido:
                cursor.execute('INSERT INTO Log_Artilleria (faccion_id, tipo_objetivo, objetivo_id, descripcion) VALUES (?, ?, ?, ?)', 
                               (faccion_id, 'CONTRABATERIA', str(enemy_id), 'Mortero enemigo destruido'))
            if destroyed_dynamic_targets:
                for tgt in destroyed_dynamic_targets:
                    tgt_id = tgt.get('id', 'TGT')
                    tgt_id_str = str(tgt_id)
                    if tgt_id_str.startswith('COL-') or '-COL' in tgt_id_str:
                        tipo = 'DAÑO COLATERAL'
                        desc = f'Objetivo Civil {tgt_id_str} destruido (Pérdida de PC aliado)'
                    elif tgt.get('is_fake'):
                        tipo = 'OBJETIVO FALSO'
                        desc = f'Señuelo civil {tgt_id_str} impactado por error (Pérdida de PC aliado)'
                    elif tgt.get('faccion_id') != faccion_id:
                        tipo = 'FUEGO AMIGO'
                        desc = f'Fuego amigo sobre {tgt_id_str} (Pérdida de PC aliado)'
                    else:
                        tipo = 'BLANCO VALIDO'
                        desc = f'Blanco enemigo {tgt_id_str} impactado y destruido con éxito'
                        
                    cursor.execute('INSERT INTO Log_Artilleria (faccion_id, tipo_objetivo, objetivo_id, descripcion) VALUES (?, ?, ?, ?)', 
                                   (faccion_id, tipo, tgt_id_str, desc))
            conn.commit()
        except Exception as log_err:
            print("Error registrando Log_Artilleria:", log_err)
                
        return jsonify({'lat': impacto_lat, 'lng': impacto_lng, 'enemy_destroyed': destruido, 'dynamic_targets_destroyed': destroyed_dynamic_targets})
    except Exception as e:
        return jsonify({'error': str(e)}), 400
    finally:
        if conn:
            conn.close()

@app.route('/api/mortero/todos_json', methods=['GET'])
def api_mortero_todos():
    if 'role' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
        
    faccion_name = session.get('faction', '')
    if session.get('role') == 'admin' and request.args.get('faccion'):
        faccion_name = request.args.get('faccion')
        
    conn = get_db_connection()
    ensure_artilleria_tables(conn)
    if session.get('role') == 'admin' and faccion_name == 'All':
        disparos = conn.execute('SELECT * FROM Mortero_Disparo WHERE borrado = 0 ORDER BY timestamp DESC LIMIT 300').fetchall()
        faccion_id = None
    else:
        disparos = conn.execute("SELECT * FROM Mortero_Disparo WHERE faccion = ? AND borrado = 0 AND timestamp >= datetime('now', '-15 minutes') ORDER BY timestamp DESC LIMIT 50", (faccion_name,)).fetchall()
        faccion_id = 1 if faccion_name == 'Syldavia' else (2 if faccion_name == 'Volkovia' else None)
        
    estado = cursor = conn.execute('SELECT * FROM Mortero_Estado WHERE faccion_id=?', (faccion_id,)).fetchone() if faccion_id else None
    
    activo = True if faccion_id is None else (estado['activo'] if estado else False)
    lat = estado['lat'] if estado else None
    lng = estado['lng'] if estado else None
    
    # Cooldown remaining
    cooldown_remaining = 0
    config = conn.execute('SELECT disparos_por_minuto, radio_explosion FROM Mortero_Config WHERE id=1').fetchone()
    
    if estado and estado['ultimo_disparo']:
        dpm = config['disparos_por_minuto'] if config else 2
        ultimo = datetime.strptime(estado['ultimo_disparo'], '%Y-%m-%d %H:%M:%S')
        diff = (datetime.utcnow() - ultimo).total_seconds()
        segundos_cooldown = 60.0 / float(dpm)
        cooldown_remaining = max(0, segundos_cooldown - diff)
        
    conn.close()
    
    return jsonify({
        'disparos': [dict(row) for row in disparos],
        'activo': bool(activo),
        'lat': lat,
        'lng': lng,
        'cooldown_remaining': cooldown_remaining,
        'radio_explosion': config['radio_explosion'] if config else 15
    })

# Admin routes for Artillery
@app.route('/api/admin/artilleria', methods=['GET'])
def admin_get_artilleria():
    if session.get('role') != 'admin': return jsonify({'error': 'Unauthorized'}), 403
    conn = get_db_connection()
    row = conn.execute('SELECT * FROM Mortero_Config WHERE id=1').fetchone()
    config = dict(row) if row else {}
    estados = [dict(r) for r in conn.execute('SELECT * FROM Mortero_Estado').fetchall()]
    conn.close()
    return jsonify({'config': config, 'estados': estados})

@app.route('/api/admin/artilleria/config', methods=['PUT'])
def admin_put_artilleria_config():
    if session.get('role') != 'admin': return jsonify({'error': 'Unauthorized'}), 403
    data = request.json
    conn = get_db_connection()
    ensure_artilleria_tables(conn)
    duracion = int(data.get('duracion_radar_minutos', 15) or 15)
    conn.execute('''UPDATE Mortero_Config 
                    SET alcance_base=?, radio_explosion=?, disparos_por_minuto=?, duracion_radar_minutos=? 
                    WHERE id=1''', 
                (data.get('alcance_base'), data.get('radio_explosion'), data.get('disparos_por_minuto'), duracion))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})
    
@app.route('/api/admin/artilleria/estado/<int:faccion_id>', methods=['PUT'])
def admin_put_artilleria_estado(faccion_id):
    if session.get('role') != 'admin': return jsonify({'error': 'Unauthorized'}), 403
    data = request.json
    conn = get_db_connection()
    conn.execute('UPDATE Mortero_Estado SET activo=? WHERE faccion_id=?', (data.get('activo') and 1 or 0, faccion_id))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})


@app.route('/api/admin/artilleria/limpiar', methods=['DELETE'])
def admin_delete_artilleria():
    if session.get('role') != 'admin': return jsonify({'error': 'Unauthorized'}), 403
    conn = get_db_connection()
    conn.execute('DELETE FROM Mortero_Disparo')
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})

@app.route('/api/admin/artilleria/logs', methods=['GET', 'DELETE'])
def admin_get_artilleria_logs():
    if session.get('role') != 'admin': return jsonify({'error': 'Unauthorized'}), 403
    conn = get_db_connection()
    try:
        ensure_artilleria_tables(conn)
        if request.method == 'DELETE':
            conn.execute('DELETE FROM Log_Artilleria')
            conn.commit()
            return jsonify({'status': 'success'})
        logs = conn.execute('SELECT l.*, f.nombre as faccion_nombre FROM Log_Artilleria l LEFT JOIN Faccion f ON l.faccion_id = f.id ORDER BY timestamp DESC').fetchall()
        return jsonify([dict(r) for r in logs])
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/config/geo_validation', methods=['GET', 'POST'])
def geo_validation_config():
    if session.get('role') != 'admin':
        return jsonify({'status': 'error', 'message': 'No autorizado'}), 403
        
    if request.method == 'GET':
        return jsonify(get_config())
        
    if request.method == 'POST':
        data = request.json
        config = get_config()
        config['geo_validation_enabled'] = data.get('enabled', False)
        set_config(config)
        return jsonify({'status': 'success', 'enabled': config['geo_validation_enabled']})

@app.route('/carnet/<int:id>')
def view_carnet(id):
    conn = get_db_connection()
    miembro = conn.execute('''
        SELECT m.*, f.color as faccion_color, f.nombre as faccion_nombre, COALESCE(e.logo_url, e.foto_url) as equipo_logo, e.nombre as equipo_nombre
        FROM Miembro m 
        JOIN Equipo e ON m.equipo_id = e.id 
        JOIN Faccion f ON e.faccion_id = f.id 
        WHERE m.id = ?
    ''', (id,)).fetchone()
    if not miembro:
        conn.close()
        return "Jugador no encontrado", 404
        
    ice = conn.execute('SELECT * FROM Miembro_ICE WHERE miembro_id = ?', (id,)).fetchone()
    armas = conn.execute('SELECT * FROM Miembro_Arma WHERE miembro_id = ? ORDER BY id ASC', (id,)).fetchall()
    conn.close()
        
    color_map = {'Amarillo': '#f1c40f', 'Azul': '#3498db', 'Verde': '#2ecc71', 'Rojo': '#e74c3c'}
    hex_color = color_map.get(miembro['faccion_color'], '#00d2ff')
    
    return render_template(
        'carnet.html',
        miembro=dict(miembro),
        hex_color=hex_color,
        ice=dict(ice) if ice else None,
        armas=[dict(a) for a in armas]
    )

@app.route('/api/miembros/<int:id>/foto', methods=['POST'])
def upload_miembro_foto(id):
    if 'foto' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['foto']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
        
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.jfif']:
        return jsonify({'error': 'Formato de imagen no válido'}), 400
        
    conn = get_db_connection()
    miembro = conn.execute('SELECT equipo_id FROM Miembro WHERE id = ?', (id,)).fetchone()
    if not miembro:
        conn.close()
        return jsonify({'error': 'Miembro no encontrado'}), 404
        
    is_admin = session.get('role') == 'admin'
    is_owner = (session.get('role') == 'equipo' and session.get('equipo_id') == miembro['equipo_id'])
    is_self = (session.get('role') == 'operador' and session.get('miembro_id') == id)
    if not (is_admin or is_owner or is_self):
        conn.close()
        return jsonify({'error': 'Unauthorized'}), 403
        
    folder = os.path.join(app.root_path, 'static', 'imgs', 'fotos_jugadores')
    os.makedirs(folder, exist_ok=True)
    # 1 foto por jugador: limpiar cualquier archivo anterior en disco
    clean_old_files(folder, f"miembro_{id}.*")
    
    filename = f"miembro_{id}{ext}"
    filepath = os.path.join(folder, filename)
    
    # Procesar, orientar según EXIF y optimizar (máx 1000px)
    save_optimized_image(file, filepath, max_dim=1000)
    
    foto_url = f"/static/imgs/fotos_jugadores/{filename}?v={int(time.time())}"
    conn.execute('UPDATE Miembro SET foto_url = ? WHERE id = ?', (foto_url, id))
    conn.commit()
    conn.close()
    
    return jsonify({'status': 'success', 'foto_url': foto_url})

@app.route('/api/mapa/radar', methods=['GET'])
def api_mapa_radar():
    conn = get_db_connection()
    cursor = conn.cursor()
    # Cleanup expired markers
    cursor.execute("DELETE FROM Mortero_Radar WHERE caduca_en < datetime('now')")
    conn.commit()
    
    # Get active markers
    faccion_id = request.args.get('faccion_id')
    if faccion_id:
        markers = cursor.execute("SELECT * FROM Mortero_Radar WHERE faccion_id_origen != ?", (faccion_id,)).fetchall()
    else:
        markers = cursor.execute("SELECT * FROM Mortero_Radar").fetchall()
        
    conn.close()
    return jsonify([dict(m) for m in markers])

@app.route('/api/mortero/clear', methods=['POST'])
def api_mortero_clear():
    if 'role' not in session or session.get('faction') == 'All':
        return jsonify({'error': 'Unauthorized'}), 401
    
    faccion_name = session.get('faction')
    conn = get_db_connection()
    conn.execute('UPDATE Mortero_Disparo SET borrado = 1 WHERE faccion = ?', (faccion_name,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})

def patch_db():
    with app.app_context():
        conn = get_db_connection()
        try:
            conn.execute('ALTER TABLE puntos_control ADD COLUMN equipo_id INTEGER REFERENCES Equipo(id);')
            conn.commit()
        except Exception as e:
            pass # Column already exists or error
        try:
            conn.execute('ALTER TABLE Equipo ADD COLUMN ultimo_op_usado_id INTEGER;')
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute("ALTER TABLE Historial_Asignacion ADD COLUMN estado TEXT DEFAULT 'Aprobada';")
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute("ALTER TABLE Miembro ADD COLUMN foto_url TEXT;")
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS Documento (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    titulo TEXT NOT NULL,
                    contenido TEXT,
                    pdf_url TEXT,
                    faccion_id INTEGER,
                    orden INTEGER DEFAULT 0
                )
            ''')
            conn.commit()
        except Exception:
            pass

        # Migraciones para MarcadorMapa (autor_nombre, creado_en, caduca_en)
        try:
            conn.execute('ALTER TABLE MarcadorMapa ADD COLUMN autor_nombre TEXT;')
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute('ALTER TABLE MarcadorMapa ADD COLUMN creado_en DATETIME;')
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute('ALTER TABLE MarcadorMapa ADD COLUMN caduca_en DATETIME;')
            conn.commit()
        except Exception:
            pass

        # Migración para BalizaEquipo
        try:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS BalizaEquipo (
                    equipo_id INTEGER PRIMARY KEY,
                    faccion_id INTEGER NOT NULL,
                    gps_lat REAL NOT NULL,
                    gps_lng REAL NOT NULL,
                    map_lat REAL,
                    map_lng REAL,
                    grid_coord TEXT,
                    en_zona INTEGER DEFAULT 1,
                    actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (equipo_id) REFERENCES Equipo (id),
                    FOREIGN KEY (faccion_id) REFERENCES Faccion (id)
                )
            ''')
            conn.commit()
        except Exception:
            pass

        # Migración para Equipo_Documento (Seguro y Exención de Seguridad en PDF)
        try:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS Equipo_Documento (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    equipo_id INTEGER NOT NULL,
                    tipo TEXT NOT NULL,
                    nombre_original TEXT NOT NULL,
                    archivo_url TEXT NOT NULL,
                    archivo_path TEXT NOT NULL,
                    tamano_bytes INTEGER DEFAULT 0,
                    subido_en DATETIME DEFAULT CURRENT_TIMESTAMP,
                    subido_por TEXT DEFAULT '',
                    FOREIGN KEY (equipo_id) REFERENCES Equipo (id) ON DELETE CASCADE
                )
            ''')
            conn.commit()
        except Exception:
            pass

        # Migración para op_secundario_sesion
        try:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS op_secundario_sesion (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    token_sesion TEXT UNIQUE NOT NULL,
                    source_op_id INTEGER NOT NULL,
                    faccion_id INTEGER NOT NULL,
                    equipo_id INTEGER,
                    sec_lat REAL NOT NULL,
                    sec_lng REAL NOT NULL,
                    desplazamiento_bearing REAL NOT NULL,
                    azimut_busqueda REAL NOT NULL,
                    estado TEXT NOT NULL DEFAULT 'GENERADO',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    expires_at DATETIME NOT NULL,
                    FOREIGN KEY (source_op_id) REFERENCES puntos_interes (id),
                    FOREIGN KEY (equipo_id) REFERENCES Equipo (id),
                    FOREIGN KEY (faccion_id) REFERENCES Faccion (id)
                )
            ''')
            conn.commit()
        except Exception:
            pass

        # Inicializar tablas de Field Medic
        try:
            medic_engine.init_medic_db(conn)
        except Exception as e:
            print("Error inicializando tablas field_medic:", e)

        # Inicializar tablas de Mortero y Log Artilleria
        try:
            ensure_artilleria_tables(conn)
        except Exception as e:
            print("Error inicializando tablas de artilleria:", e)

        # Inicializar tablas de Operador, ICE y Ready Check
        try:
            ensure_operator_and_ice_tables(conn)
        except Exception as e:
            print("Error inicializando tablas de operador e ICE:", e)

        # Inicializar tablas y configuración global de juegos y minijuegos
        try:
            ensure_juego_config_tables(conn)
        except Exception as e:
            print("Error inicializando tablas juego_config:", e)

        # Migración: Resolver duplicados históricos de nicks para garantizar unicidad y evitar colisiones de login
        try:
            dup_rows = conn.execute('''
                SELECT LOWER(TRIM(nombre_jugador)) as nick_lower, COUNT(*) as cnt
                FROM Miembro
                WHERE nombre_jugador IS NOT NULL AND TRIM(nombre_jugador) != ''
                GROUP BY LOWER(TRIM(nombre_jugador))
                HAVING cnt > 1
            ''').fetchall()
            for d in dup_rows:
                m_list = conn.execute('''
                    SELECT m.id, m.nombre_jugador, e.codigo, e.nombre as eq_nombre
                    FROM Miembro m
                    JOIN Equipo e ON m.equipo_id = e.id
                    WHERE LOWER(TRIM(m.nombre_jugador)) = ?
                    ORDER BY m.id ASC
                ''', (d['nick_lower'],)).fetchall()
                for idx, m in enumerate(m_list[1:], start=2):
                    tag = (m['codigo'] or m['eq_nombre'][:8]).strip().upper()
                    new_nick = f"{m['nombre_jugador'].strip()} [{tag}]"
                    check_exist = conn.execute('SELECT id FROM Miembro WHERE LOWER(TRIM(nombre_jugador)) = ?', (new_nick.lower(),)).fetchone()
                    if check_exist:
                        new_nick = f"{m['nombre_jugador'].strip()}-{idx}"
                    conn.execute('UPDATE Miembro SET nombre_jugador = ? WHERE id = ?', (new_nick, m['id']))
            conn.commit()
        except Exception as e:
            print("Error resolviendo nicks duplicados históricos:", e)

        conn.close()

@app.route('/api/docs', methods=['GET'])
def get_docs():
    conn = get_db_connection()
    if session.get('role') == 'admin':
        docs = conn.execute('SELECT * FROM Documento ORDER BY orden ASC, id DESC').fetchall()
    else:
        # Faccion id for the current user
        faccion = conn.execute('SELECT id FROM Faccion WHERE nombre = ?', (session.get('faction'),)).fetchone()
        fac_id = faccion['id'] if faccion else None
        docs = conn.execute('SELECT * FROM Documento WHERE faccion_id IS NULL OR faccion_id = ? ORDER BY orden ASC, id DESC', (fac_id,)).fetchall()
    conn.close()
    return jsonify([dict(row) for row in docs])

@app.route('/api/docs', methods=['POST'])
def save_doc():
    if session.get('role') != 'admin': return jsonify({'error': 'Unauthorized'}), 403

    if request.content_type and 'multipart/form-data' in request.content_type:
        titulo = request.form.get('titulo', '').strip()
        contenido = request.form.get('contenido', '')
        pdf_url = request.form.get('pdf_url', '').strip()
        faccion_raw = request.form.get('faccion_id')
        faccion_id = int(faccion_raw) if faccion_raw and str(faccion_raw).strip() != '' else None
        orden_raw = request.form.get('orden', 0)
        try:
            orden = int(orden_raw) if orden_raw else 0
        except ValueError:
            orden = 0
        doc_id_raw = request.form.get('id')
        doc_id = int(doc_id_raw) if doc_id_raw and str(doc_id_raw).strip() != '' else None

        # Check if an uploaded file is included from the file explorer
        if 'file' in request.files:
            file = request.files['file']
            if file and file.filename != '':
                ext = os.path.splitext(file.filename)[1].lower()
                if ext != '.pdf':
                    return jsonify({'error': 'Solo se admiten documentos en formato PDF (.pdf)'}), 400

                import secrets
                raw_name = os.path.splitext(file.filename)[0]
                safe_name = "".join([c for c in raw_name if c.isalnum() or c in ('_', '-', ' ')]).replace(' ', '_').strip()
                if not safe_name:
                    safe_name = "reglamento"
                rand_token = secrets.token_hex(4)
                filename = f"{safe_name}_{rand_token}.pdf"
                filepath = os.path.join(UPLOAD_REGLAMENTOS_FOLDER, filename)
                file.save(filepath)
                pdf_url = f"/static/uploads/documentos_reglamentos/{filename}?v={int(time.time())}"
    else:
        data = request.json or {}
        titulo = data.get('titulo', '').strip()
        contenido = data.get('contenido', '')
        pdf_url = data.get('pdf_url', '').strip()
        faccion_id = data.get('faccion_id')
        orden = data.get('orden', 0)
        doc_id = data.get('id')

    if not titulo:
        return jsonify({'error': 'El título es obligatorio'}), 400

    conn = get_db_connection()
    if doc_id:
        conn.execute('UPDATE Documento SET titulo = ?, contenido = ?, pdf_url = ?, faccion_id = ?, orden = ? WHERE id = ?',
                     (titulo, contenido, pdf_url, faccion_id, orden, doc_id))
    else:
        conn.execute('INSERT INTO Documento (titulo, contenido, pdf_url, faccion_id, orden) VALUES (?, ?, ?, ?, ?)',
                     (titulo, contenido, pdf_url, faccion_id, orden))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success', 'pdf_url': pdf_url})

@app.route('/api/docs/upload_pdf', methods=['POST'])
def api_docs_upload_pdf():
    if session.get('role') != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403

    if 'file' not in request.files:
        return jsonify({'error': 'No se ha seleccionado ningún archivo'}), 400

    file = request.files['file']
    if not file or file.filename == '':
        return jsonify({'error': 'Ningún archivo seleccionado'}), 400

    ext = os.path.splitext(file.filename)[1].lower()
    if ext != '.pdf':
        return jsonify({'error': 'Solo se admiten documentos en formato PDF (.pdf)'}), 400

    import secrets
    raw_name = os.path.splitext(file.filename)[0]
    safe_name = "".join([c for c in raw_name if c.isalnum() or c in ('_', '-', ' ')]).replace(' ', '_').strip()
    if not safe_name:
        safe_name = "reglamento"
    rand_token = secrets.token_hex(4)
    filename = f"{safe_name}_{rand_token}.pdf"
    filepath = os.path.join(UPLOAD_REGLAMENTOS_FOLDER, filename)
    file.save(filepath)

    pdf_url = f"/static/uploads/documentos_reglamentos/{filename}?v={int(time.time())}"
    return jsonify({
        'status': 'success',
        'pdf_url': pdf_url,
        'filename': file.filename,
        'title_suggested': raw_name.replace('_', ' ').replace('-', ' ').strip()
    })

@app.route('/api/docs/<int:id>', methods=['DELETE'])
def delete_doc(id):
    if session.get('role') != 'admin': return jsonify({'error': 'Unauthorized'}), 403
    conn = get_db_connection()
    doc = conn.execute('SELECT pdf_url FROM Documento WHERE id = ?', (id,)).fetchone()
    if doc and doc['pdf_url']:
        url = doc['pdf_url'].split('?')[0]
        if '/static/uploads/documentos_reglamentos/' in url:
            fname = url.split('/')[-1]
            fpath = os.path.join(UPLOAD_REGLAMENTOS_FOLDER, fname)
            if os.path.isfile(fpath):
                try:
                    os.remove(fpath)
                except Exception as e:
                    print(f"Error borrando PDF de reglamento: {e}")
    conn.execute('DELETE FROM Documento WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})

# ==================== OPERADOR, ICE & READY CHECK ROUTES ====================

@app.route('/portal')
@app.route('/operador')
@app.route('/perfil')
def operador_portal():
    if 'role' not in session:
        return redirect(url_for('login'))
        
    user_role = session.get('role')
    conn = get_db_connection()
    
    miembro_id = session.get('miembro_id')
    if not miembro_id:
        if user_role == 'admin':
            m_first = conn.execute('SELECT id FROM Miembro WHERE activo = 1 LIMIT 1').fetchone()
            miembro_id = m_first['id'] if m_first else None
        elif user_role == 'equipo':
            eq_id = session.get('equipo_id')
            m_first = conn.execute('SELECT id FROM Miembro WHERE equipo_id = ? AND activo = 1 LIMIT 1', (eq_id,)).fetchone()
            miembro_id = m_first['id'] if m_first else None
            
    if not miembro_id:
        conn.close()
        return redirect(url_for('index'))
        
    miembro = conn.execute('''
        SELECT m.*, e.nombre as equipo_nombre, COALESCE(e.logo_url, e.foto_url) as equipo_logo,
               f.nombre as faccion_nombre, f.color as faccion_color
        FROM Miembro m
        JOIN Equipo e ON m.equipo_id = e.id
        JOIN Faccion f ON e.faccion_id = f.id
        WHERE m.id = ?
    ''', (miembro_id,)).fetchone()
    
    if not miembro:
        conn.close()
        return "Operador no encontrado", 404
        
    # Cargar ICE
    try:
        ice = conn.execute('SELECT * FROM Miembro_ICE WHERE miembro_id = ?', (miembro_id,)).fetchone()
    except Exception:
        ensure_operator_and_ice_tables(conn)
        try:
            ice = conn.execute('SELECT * FROM Miembro_ICE WHERE miembro_id = ?', (miembro_id,)).fetchone()
        except Exception:
            ice = None
    
    # Cargar Armas
    try:
        armas = conn.execute('SELECT * FROM Miembro_Arma WHERE miembro_id = ? ORDER BY id ASC', (miembro_id,)).fetchall()
    except Exception:
        armas = []
    
    # Cargar Ready Check activo para el equipo
    try:
        ready_check = conn.execute('''
            SELECT rc.*, mrc.estado as mi_estado, mrc.nota as mi_nota, mrc.respondido_en
            FROM Equipo_ReadyCheck rc
            LEFT JOIN Miembro_ReadyCheck mrc ON rc.id = mrc.ready_check_id AND mrc.miembro_id = ?
            WHERE rc.equipo_id = ? AND rc.activo = 1
            ORDER BY rc.id DESC LIMIT 1
        ''', (miembro_id, miembro['equipo_id'])).fetchone()
    except Exception:
        ready_check = None
    
    conn.close()
    
    rol_lower = (miembro['rol'] or '').lower()
    is_medic = any(w in rol_lower for w in ['medico', 'médico', 'sanitario', 'medic']) or session.get('is_medic', False)
    session['is_medic'] = is_medic
    if is_medic and miembro['uid']:
        session['sanitario_id'] = miembro['uid']
    
    color_map = {'Amarillo': '#f1c40f', 'Azul': '#3498db', 'Verde': '#2ecc71', 'Rojo': '#e74c3c'}
    hex_color = color_map.get(miembro['faccion_color'], '#00d2ff')
    
    return render_template(
        'operador_portal.html',
        miembro=dict(miembro),
        ice=dict(ice) if ice else None,
        armas=[dict(a) for a in armas],
        ready_check=dict(ready_check) if ready_check else None,
        is_medic=is_medic,
        hex_color=hex_color,
        unlocked_minigames=session.get('unlocked_minigames', [])
    )

@app.route('/operador/mapa')
def operador_mapa():
    if 'role' not in session:
        return redirect(url_for('login'))
        
    user_faction = session.get('faction', 'Syldavia')
    user_role = session.get('role')
    equipo_nombre = session.get('equipo_nombre', '')
    operador_nick = session.get('miembro_nick', '')
    
    conn = get_db_connection()
    f_row = conn.execute('SELECT id, color, nombre FROM Faccion WHERE nombre = ?', (user_faction,)).fetchone()
    conn.close()
    
    faccion_id = f_row['id'] if f_row else 1
    faccion_color = f_row['color'] if f_row else 'Azul'
    
    color_map = {'Amarillo': '#f1c40f', 'Azul': '#3498db', 'Verde': '#2ecc71', 'Rojo': '#e74c3c'}
    hex_color = color_map.get(faccion_color, '#00d2ff')
    
    return render_template(
        'operador_mapa.html',
        user_faction=user_faction,
        faccion_id=faccion_id,
        faccion_color=faccion_color,
        hex_color=hex_color,
        equipo_nombre=equipo_nombre,
        operador_nick=operador_nick
    )

@app.route('/api/operador/perfil', methods=['GET', 'POST'])
def api_operador_perfil():
    if 'role' not in session:
        return jsonify({'error': 'No autenticado'}), 401
    
    miembro_id = session.get('miembro_id')
    if not miembro_id:
        return jsonify({'error': 'No es un operador activo'}), 403
        
    conn = get_db_connection()
    if request.method == 'GET':
        m = conn.execute('''
            SELECT m.id, m.nombre_jugador, m.rol, m.armamento, m.uid, m.nombre_apellidos,
                   m.dni, m.pin, m.telefono, m.email, m.foto_url,
                   m.tiene_dron, m.dron_modelo, m.tiene_nvg, m.nvg_categoria, m.nvg_modelo,
                   e.nombre as equipo_nombre, f.nombre as faccion_nombre
            FROM Miembro m
            JOIN Equipo e ON m.equipo_id = e.id
            JOIN Faccion f ON e.faccion_id = f.id
            WHERE m.id = ?
        ''', (miembro_id,)).fetchone()
        conn.close()
        if not m:
            return jsonify({'error': 'No encontrado'}), 404
        return jsonify(dict(m))
        
    elif request.method == 'POST':
        data = request.json or {}
        nombre_apellidos = data.get('nombre_apellidos', '').strip()
        dni = data.get('dni', '').strip()
        telefono = data.get('telefono', '').strip()
        email = data.get('email', '').strip()
        armamento = data.get('armamento', '').strip()
        
        tiene_dron = 1 if data.get('tiene_dron') in [True, 1, '1', 'true', 'on'] else 0
        dron_modelo = data.get('dron_modelo', '').strip() if tiene_dron else ''
        tiene_nvg = 1 if data.get('tiene_nvg') in [True, 1, '1', 'true', 'on'] else 0
        nvg_categoria = data.get('nvg_categoria', '').strip() if tiene_nvg else ''
        nvg_modelo = data.get('nvg_modelo', '').strip() if tiene_nvg else ''
        
        pin = data.get('pin')
        pin_update_sql = ""
        params = [nombre_apellidos, dni, telefono, email, armamento, tiene_dron, dron_modelo, tiene_nvg, nvg_categoria, nvg_modelo]
        if pin is not None:
            pin_str = str(pin).strip()
            if pin_str:
                if len(pin_str) != 4 or not pin_str.isdigit():
                    conn.close()
                    return jsonify({'error': 'El PIN debe contener exactamente 4 dígitos numéricos'}), 400
                pin_update_sql = ", pin = ?"
                params.append(pin_str)
            else:
                pin_update_sql = ", pin = NULL"
        params.append(miembro_id)
        
        conn.execute(f'''
            UPDATE Miembro 
            SET nombre_apellidos = ?, dni = ?, telefono = ?, email = ?, armamento = ?,
                tiene_dron = ?, dron_modelo = ?, tiene_nvg = ?, nvg_categoria = ?, nvg_modelo = ?
                {pin_update_sql}
            WHERE id = ?
        ''', params)
        conn.commit()
        conn.close()
        return jsonify({'status': 'success', 'message': 'Expediente y PIN actualizados correctamente'})

# ==================== OPERATOR WEAPONS & EQUIPMENT API ====================
@app.route('/api/operador/armas', methods=['GET', 'POST'])
def api_operador_armas():
    if 'role' not in session:
        return jsonify({'error': 'No autenticado'}), 401
    miembro_id = session.get('miembro_id')
    if not miembro_id:
        return jsonify({'error': 'No es un operador activo'}), 403
        
    conn = get_db_connection()
    if request.method == 'GET':
        rows = conn.execute('SELECT * FROM Miembro_Arma WHERE miembro_id = ? ORDER BY id ASC', (miembro_id,)).fetchall()
        conn.close()
        return jsonify([dict(r) for r in rows])
        
    elif request.method == 'POST':
        data = request.json or {}
        modelo = data.get('modelo', '').strip()
        tipo = data.get('tipo', 'Fusil / Asalto').strip()
        if not modelo:
            conn.close()
            return jsonify({'error': 'El modelo o denominación de la réplica es obligatorio'}), 400
            
        cur = conn.cursor()
        # Security: the operator CANNOT set fps, julios, estado_crono, or precinto_num!
        cur.execute('''
            INSERT INTO Miembro_Arma (miembro_id, modelo, tipo, estado_crono, peso_bb)
            VALUES (?, ?, ?, 'PENDIENTE', '0.20g')
        ''', (miembro_id, modelo, tipo))
        new_id = cur.lastrowid
        conn.commit()
        
        row = conn.execute('SELECT * FROM Miembro_Arma WHERE id = ?', (new_id,)).fetchone()
        conn.close()
        return jsonify({'status': 'success', 'arma': dict(row)})

@app.route('/api/operador/armas/<int:arma_id>', methods=['DELETE'])
def api_operador_arma_delete(arma_id):
    if 'role' not in session:
        return jsonify({'error': 'No autenticado'}), 401
    miembro_id = session.get('miembro_id')
    if not miembro_id:
        return jsonify({'error': 'No es un operador activo'}), 403
        
    conn = get_db_connection()
    arma = conn.execute('SELECT * FROM Miembro_Arma WHERE id = ?', (arma_id,)).fetchone()
    if not arma:
        conn.close()
        return jsonify({'error': 'Arma no encontrada'}), 404
        
    if arma['miembro_id'] != miembro_id and session.get('role') != 'admin':
        conn.close()
        return jsonify({'error': 'No autorizado para eliminar esta réplica'}), 403
        
    conn.execute('DELETE FROM Miembro_Arma WHERE id = ?', (arma_id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success', 'message': 'Réplica eliminada correctamente'})

@app.route('/api/operador/equipamiento', methods=['GET', 'POST'])
def api_operador_equipamiento():
    if 'role' not in session:
        return jsonify({'error': 'No autenticado'}), 401
    miembro_id = session.get('miembro_id')
    if not miembro_id:
        return jsonify({'error': 'No es un operador activo'}), 403
        
    conn = get_db_connection()
    if request.method == 'GET':
        m = conn.execute('SELECT tiene_dron, dron_modelo, tiene_nvg, nvg_categoria, nvg_modelo FROM Miembro WHERE id = ?', (miembro_id,)).fetchone()
        conn.close()
        return jsonify(dict(m) if m else {})
        
    elif request.method == 'POST':
        data = request.json or {}
        tiene_dron = 1 if data.get('tiene_dron') in [True, 1, '1', 'true', 'on'] else 0
        dron_modelo = data.get('dron_modelo', '').strip() if tiene_dron else ''
        tiene_nvg = 1 if data.get('tiene_nvg') in [True, 1, '1', 'true', 'on'] else 0
        nvg_categoria = data.get('nvg_categoria', '').strip() if tiene_nvg else ''
        nvg_modelo = data.get('nvg_modelo', '').strip() if tiene_nvg else ''
        
        conn.execute('''
            UPDATE Miembro 
            SET tiene_dron = ?, dron_modelo = ?, tiene_nvg = ?, nvg_categoria = ?, nvg_modelo = ?
            WHERE id = ?
        ''', (tiene_dron, dron_modelo, tiene_nvg, nvg_categoria, nvg_modelo, miembro_id))
        conn.commit()
        conn.close()
        return jsonify({'status': 'success', 'message': 'Equipamiento táctico especial guardado'})

# ==================== ADMIN CHRONO & WEAPONS MANAGEMENT ====================
@app.route('/api/crono/armas', methods=['GET'])
def api_crono_armas():
    if session.get('role') not in ['admin', 'equipo']:
        return jsonify({'error': 'No autorizado'}), 403
        
    conn = get_db_connection()
    query = '''
        SELECT a.*, m.nombre_jugador, m.nombre_apellidos, m.rol as miembro_rol, m.uid as miembro_uid,
               m.foto_url as miembro_foto, m.tiene_nvg, m.nvg_categoria, m.tiene_dron, m.dron_modelo,
               e.id as equipo_id, e.nombre as equipo_nombre, f.nombre as faccion_nombre, f.color as faccion_color
        FROM Miembro_Arma a
        JOIN Miembro m ON a.miembro_id = m.id
        JOIN Equipo e ON m.equipo_id = e.id
        JOIN Faccion f ON e.faccion_id = f.id
        WHERE 1=1
    '''
    params = []
    
    if session.get('role') == 'equipo':
        query += ' AND e.id = ?'
        params.append(session.get('equipo_id'))
    else:
        equipo_id = request.args.get('equipo_id')
        if equipo_id:
            query += ' AND e.id = ?'
            params.append(equipo_id)
            
    miembro_id = request.args.get('miembro_id')
    if miembro_id:
        query += ' AND m.id = ?'
        params.append(miembro_id)
        
    estado = request.args.get('estado')
    if estado:
        query += ' AND a.estado_crono = ?'
        params.append(estado.upper())
        
    query += ' ORDER BY a.id DESC'
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route('/api/crono/arma/<int:arma_id>', methods=['POST', 'DELETE'])
def api_crono_arma_admin(arma_id):
    if session.get('role') != 'admin':
        return jsonify({'error': 'Solo la Dirección / Administración puede validar el crono'}), 403
        
    conn = get_db_connection()
    if request.method == 'DELETE':
        conn.execute('DELETE FROM Miembro_Arma WHERE id = ?', (arma_id,))
        conn.commit()
        conn.close()
        return jsonify({'status': 'success', 'message': 'Réplica eliminada'})
        
    data = request.json or {}
    fps = data.get('fps')
    julios = data.get('julios')
    peso_bb = data.get('peso_bb', '0.20g').strip() or '0.20g'
    estado_crono = data.get('estado_crono', 'APROBADO').strip().upper()
    precinto_num = data.get('precinto_num', '').strip()
    modelo = data.get('modelo')
    tipo = data.get('tipo')
    
    admin_name = session.get('usuario') or 'Dirección'
    
    updates = [
        "fps = ?",
        "julios = ?",
        "peso_bb = ?",
        "estado_crono = ?",
        "precinto_num = ?",
        "cronometrado_en = datetime('now')",
        "cronometrado_por = ?"
    ]
    params = [fps, julios, peso_bb, estado_crono, precinto_num, admin_name]
    
    if modelo:
        updates.append("modelo = ?")
        params.append(modelo.strip())
    if tipo:
        updates.append("tipo = ?")
        params.append(tipo.strip())
        
    params.append(arma_id)
    
    conn.execute(f"UPDATE Miembro_Arma SET {', '.join(updates)} WHERE id = ?", params)
    conn.commit()
    
    updated = conn.execute('SELECT * FROM Miembro_Arma WHERE id = ?', (arma_id,)).fetchone()
    conn.close()
    return jsonify({'status': 'success', 'arma': dict(updated)})

@app.route('/api/admin/armas_dashboard', methods=['GET'])
def api_admin_armas_dashboard():
    if session.get('role') not in ['admin', 'equipo']:
        return jsonify({'error': 'No autorizado'}), 403

    conn = get_db_connection()
    equipo_filter = ""
    params = []
    if session.get('role') == 'equipo':
        equipo_filter = " WHERE e.id = ?"
        params.append(session.get('equipo_id'))

    query = f'''
        SELECT m.id, m.nombre_jugador, m.nombre_apellidos, m.rol, m.uid, m.foto_url,
               m.tiene_dron, m.dron_modelo, m.tiene_nvg, m.nvg_categoria, m.nvg_modelo,
               e.id as equipo_id, e.nombre as equipo_nombre,
               f.id as faccion_id, f.nombre as faccion_nombre, f.color as faccion_color
        FROM Miembro m
        JOIN Equipo e ON m.equipo_id = e.id
        JOIN Faccion f ON e.faccion_id = f.id
        {equipo_filter}
        ORDER BY f.id ASC, e.nombre ASC, m.nombre_jugador ASC
    '''
    miembros = [dict(r) for r in conn.execute(query, params).fetchall()]
    
    armas_rows = conn.execute('SELECT * FROM Miembro_Arma ORDER BY id ASC').fetchall()
    armas_by_member = {}
    for a in armas_rows:
        ad = dict(a)
        armas_by_member.setdefault(ad['miembro_id'], []).append(ad)

    for m in miembros:
        m['armas'] = armas_by_member.get(m['id'], [])

    conn.close()
    return jsonify(miembros)

@app.route('/api/admin/miembro_por_uid/', defaults={'uid': ''}, methods=['GET'])
@app.route('/api/admin/miembro_por_uid/<path:uid>', methods=['GET'])
def api_admin_miembro_por_uid(uid=''):
    if session.get('role') not in ['admin', 'equipo']:
        return jsonify({'error': 'No autorizado'}), 403
    
    token_arg = request.args.get('token') or request.args.get('uid')
    raw_uid = token_arg if token_arg else uid
    clean_uid = (raw_uid or '').strip().upper()
    if 'TOKEN=' in clean_uid:
        import re
        m_token = re.search(r'[?&]TOKEN=([A-Z0-9_-]+)', clean_uid)
        if m_token:
            clean_uid = m_token.group(1)
    if '/' in clean_uid:
        clean_uid = clean_uid.split('/')[-1]

    conn = get_db_connection()
    query = '''
        SELECT m.id, m.nombre_jugador, m.nombre_apellidos, m.rol, m.uid, m.foto_url,
               m.tiene_dron, m.dron_modelo, m.tiene_nvg, m.nvg_categoria, m.nvg_modelo,
               e.id as equipo_id, e.nombre as equipo_nombre,
               f.id as faccion_id, f.nombre as faccion_nombre, f.color as faccion_color
        FROM Miembro m
        JOIN Equipo e ON m.equipo_id = e.id
        JOIN Faccion f ON e.faccion_id = f.id
        WHERE UPPER(TRIM(m.uid)) = ?
    '''
    m = conn.execute(query, (clean_uid,)).fetchone()
    if not m:
        conn.close()
        return jsonify({'error': 'Combatiente no encontrado', 'uid': clean_uid}), 404

    if session.get('role') == 'equipo' and session.get('equipo_id') != m['equipo_id']:
        conn.close()
        return jsonify({'error': 'No autorizado para ver combatientes de otra unidad'}), 403

    m_dict = dict(m)
    armas = [dict(a) for a in conn.execute('SELECT * FROM Miembro_Arma WHERE miembro_id = ? ORDER BY id ASC', (m_dict['id'],)).fetchall()]
    m_dict['armas'] = armas
    conn.close()
    return jsonify(m_dict)

@app.route('/api/admin/miembro/<int:id>/tactico', methods=['POST'])
def api_admin_miembro_tactico(id):
    if session.get('role') not in ['admin', 'equipo']:
        return jsonify({'error': 'No autorizado'}), 403
    data = request.json or {}
    tiene_dron = 1 if data.get('tiene_dron') else 0
    dron_modelo = (data.get('dron_modelo') or '').strip()
    tiene_nvg = 1 if data.get('tiene_nvg') else 0
    nvg_categoria = (data.get('nvg_categoria') or '').strip()
    nvg_modelo = (data.get('nvg_modelo') or '').strip()

    conn = get_db_connection()
    conn.execute('''
        UPDATE Miembro
        SET tiene_dron = ?, dron_modelo = ?, tiene_nvg = ?, nvg_categoria = ?, nvg_modelo = ?
        WHERE id = ?
    ''', (tiene_dron, dron_modelo, tiene_nvg, nvg_categoria, nvg_modelo, id))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})

@app.route('/api/crono/arma/nueva', methods=['POST'])
def api_crono_arma_nueva():
    if session.get('role') not in ['admin', 'equipo']:
        return jsonify({'error': 'No autorizado'}), 403
        
    data = request.json or {}
    miembro_id = data.get('miembro_id')
    modelo = data.get('modelo', '').strip()
    tipo = data.get('tipo', 'Fusil / Asalto').strip()
    fps = data.get('fps')
    julios = data.get('julios')
    peso_bb = data.get('peso_bb', '0.20g').strip() or '0.20g'
    estado_crono = data.get('estado_crono', 'APROBADO').strip().upper()
    precinto_num = data.get('precinto_num', '').strip()
    admin_name = session.get('usuario') or 'Dirección'
    
    if not miembro_id or not modelo:
        return jsonify({'error': 'Miembro y Modelo requeridos'}), 400
        
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute('''
        INSERT INTO Miembro_Arma (miembro_id, modelo, tipo, fps, julios, peso_bb, estado_crono, precinto_num, cronometrado_en, cronometrado_por)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    ''', (miembro_id, modelo, tipo, fps, julios, peso_bb, estado_crono, precinto_num, admin_name))
    new_id = cur.lastrowid
    conn.commit()
    
    row = conn.execute('SELECT * FROM Miembro_Arma WHERE id = ?', (new_id,)).fetchone()
    conn.close()
    return jsonify({'status': 'success', 'arma': dict(row)})

@app.route('/api/miembros/<int:id>/armas', methods=['GET', 'POST'])
def api_miembro_armas(id):
    if 'role' not in session:
        return jsonify({'error': 'No autenticado'}), 401
        
    conn = get_db_connection()
    miembro = conn.execute('SELECT equipo_id FROM Miembro WHERE id = ?', (id,)).fetchone()
    if not miembro:
        conn.close()
        return jsonify({'error': 'Miembro no encontrado'}), 404
        
    is_admin = session.get('role') == 'admin'
    is_owner = (session.get('role') == 'equipo' and session.get('equipo_id') == miembro['equipo_id'])
    is_self = (session.get('role') == 'operador' and session.get('miembro_id') == id)
    if not (is_admin or is_owner or is_self):
        conn.close()
        return jsonify({'error': 'No autorizado'}), 403
        
    if request.method == 'GET':
        rows = conn.execute('SELECT * FROM Miembro_Arma WHERE miembro_id = ? ORDER BY id ASC', (id,)).fetchall()
        conn.close()
        return jsonify([dict(r) for r in rows])
        
    elif request.method == 'POST':
        data = request.json or {}
        modelo = data.get('modelo', '').strip()
        tipo = data.get('tipo', 'Fusil / Asalto').strip()
        if not modelo:
            conn.close()
            return jsonify({'error': 'Modelo requerido'}), 400
            
        cur = conn.cursor()
        if is_admin:
            fps = data.get('fps')
            julios = data.get('julios')
            peso_bb = data.get('peso_bb', '0.20g')
            estado_crono = data.get('estado_crono', 'APROBADO')
            precinto_num = data.get('precinto_num', '')
            admin_name = session.get('usuario') or 'Dirección'
            cur.execute('''
                INSERT INTO Miembro_Arma (miembro_id, modelo, tipo, fps, julios, peso_bb, estado_crono, precinto_num, cronometrado_en, cronometrado_por)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
            ''', (id, modelo, tipo, fps, julios, peso_bb, estado_crono, precinto_num, admin_name))
        else:
            cur.execute('''
                INSERT INTO Miembro_Arma (miembro_id, modelo, tipo, estado_crono, peso_bb)
                VALUES (?, ?, ?, 'PENDIENTE', '0.20g')
            ''', (id, modelo, tipo))
        new_id = cur.lastrowid
        conn.commit()
        row = conn.execute('SELECT * FROM Miembro_Arma WHERE id = ?', (new_id,)).fetchone()
        conn.close()
        return jsonify({'status': 'success', 'arma': dict(row)})

@app.route('/api/operador/ice', methods=['GET', 'POST'])
def api_operador_ice():
    if 'role' not in session:
        return jsonify({'error': 'No autenticado'}), 401
        
    miembro_id = session.get('miembro_id')
    if not miembro_id:
        return jsonify({'error': 'No es un operador activo'}), 403
        
    conn = get_db_connection()
    if request.method == 'GET':
        ice = conn.execute('SELECT * FROM Miembro_ICE WHERE miembro_id = ?', (miembro_id,)).fetchone()
        conn.close()
        return jsonify(dict(ice) if ice else {})
        
    elif request.method == 'POST':
        data = request.json or {}
        grupo = data.get('grupo_sanguineo', '').strip()
        alergias = data.get('alergias', '').strip()
        condiciones = data.get('condiciones_medicas', '').strip()
        medicacion = data.get('medicacion_actual', '').strip()
        c_nombre = data.get('contacto_nombre', '').strip()
        c_tel = data.get('contacto_telefono', '').strip()
        c_parentesco = data.get('contacto_parentesco', '').strip()
        obs = data.get('observaciones', '').strip()
        
        conn.execute('''
            INSERT INTO Miembro_ICE (miembro_id, grupo_sanguineo, alergias, condiciones_medicas,
                                    medicacion_actual, contacto_nombre, contacto_telefono,
                                    contacto_parentesco, observaciones, actualizado_en)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(miembro_id) DO UPDATE SET
                grupo_sanguineo = excluded.grupo_sanguineo,
                alergias = excluded.alergias,
                condiciones_medicas = excluded.condiciones_medicas,
                medicacion_actual = excluded.medicacion_actual,
                contacto_nombre = excluded.contacto_nombre,
                contacto_telefono = excluded.contacto_telefono,
                contacto_parentesco = excluded.contacto_parentesco,
                observaciones = excluded.observaciones,
                actualizado_en = excluded.actualizado_en
        ''', (miembro_id, grupo, alergias, condiciones, medicacion, c_nombre, c_tel, c_parentesco, obs))
        conn.commit()
        conn.close()
        return jsonify({'status': 'success', 'message': 'Ficha médica ICE guardada'})

@app.route('/api/miembros/<int:id>/ice', methods=['GET'])
def api_miembro_ice(id):
    if 'role' not in session:
        return jsonify({'error': 'No autenticado'}), 401
        
    conn = get_db_connection()
    miembro = conn.execute('SELECT equipo_id, nombre_jugador, nombre_apellidos FROM Miembro WHERE id = ?', (id,)).fetchone()
    if not miembro:
        conn.close()
        return jsonify({'error': 'Miembro no encontrado'}), 404
        
    is_admin = session.get('role') == 'admin'
    is_tl = (session.get('role') == 'equipo' and session.get('equipo_id') == miembro['equipo_id'])
    is_self = (session.get('role') == 'operador' and session.get('miembro_id') == id)
    
    if not (is_admin or is_tl or is_self):
        conn.close()
        return jsonify({'error': 'No autorizado para consultar estos datos médicos'}), 403
        
    ice = conn.execute('SELECT * FROM Miembro_ICE WHERE miembro_id = ?', (id,)).fetchone()
    conn.close()
    
    res = dict(ice) if ice else {}
    res['nombre_jugador'] = miembro['nombre_jugador']
    res['nombre_apellidos'] = miembro['nombre_apellidos']
    return jsonify(res)

@app.route('/api/ready_check/start', methods=['POST'])
def api_ready_check_start():
    if session.get('role') not in ['admin', 'equipo']:
        return jsonify({'error': 'No autorizado'}), 403
    data = request.json or {}
    equipo_id = data.get('equipo_id') if session.get('role') == 'admin' else session.get('equipo_id')
    titulo = data.get('titulo', 'Pase de Lista Táctico').strip() or 'Pase de Lista Táctico'
    if not equipo_id:
        return jsonify({'error': 'Equipo requerido'}), 400
        
    conn = get_db_connection()
    conn.execute('UPDATE Equipo_ReadyCheck SET activo = 0, cerrado_en = datetime(\'now\') WHERE equipo_id = ? AND activo = 1', (equipo_id,))
    
    cur = conn.cursor()
    cur.execute('INSERT INTO Equipo_ReadyCheck (equipo_id, titulo, activo) VALUES (?, ?, 1)', (equipo_id, titulo))
    rc_id = cur.lastrowid
    
    miembros = conn.execute('SELECT id FROM Miembro WHERE equipo_id = ? AND activo = 1', (equipo_id,)).fetchall()
    for m in miembros:
        conn.execute('INSERT OR IGNORE INTO Miembro_ReadyCheck (ready_check_id, miembro_id, estado) VALUES (?, ?, ?)', (rc_id, m['id'], 'PENDIENTE'))
        
    conn.commit()
    conn.close()
    return jsonify({'status': 'success', 'ready_check_id': rc_id})

@app.route('/api/ready_check/stop', methods=['POST'])
def api_ready_check_stop():
    if session.get('role') not in ['admin', 'equipo']:
        return jsonify({'error': 'No autorizado'}), 403
    data = request.json or {}
    equipo_id = data.get('equipo_id') if session.get('role') == 'admin' else session.get('equipo_id')
    conn = get_db_connection()
    conn.execute('UPDATE Equipo_ReadyCheck SET activo = 0, cerrado_en = datetime(\'now\') WHERE equipo_id = ? AND activo = 1', (equipo_id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})

@app.route('/api/ready_check/status', methods=['GET'])
def api_ready_check_status():
    if 'role' not in session:
        return jsonify({'error': 'No autenticado'}), 401
    equipo_id = request.args.get('equipo_id') if session.get('role') == 'admin' else session.get('equipo_id')
    if not equipo_id:
        return jsonify({'active': False})
        
    conn = get_db_connection()
    rc = conn.execute('''
        SELECT * FROM Equipo_ReadyCheck WHERE equipo_id = ? AND activo = 1 ORDER BY id DESC LIMIT 1
    ''', (equipo_id,)).fetchone()
    
    if not rc:
        conn.close()
        return jsonify({'active': False})
        
    rows = conn.execute('''
        SELECT m.id as miembro_id, m.nombre_jugador, m.rol, m.foto_url,
               COALESCE(mrc.estado, 'PENDIENTE') as estado,
               mrc.nota, mrc.respondido_en
        FROM Miembro m
        LEFT JOIN Miembro_ReadyCheck mrc ON mrc.miembro_id = m.id AND mrc.ready_check_id = ?
        WHERE m.equipo_id = ? AND m.activo = 1
        ORDER BY m.id ASC
    ''', (rc['id'], equipo_id)).fetchall()
    conn.close()
    
    return jsonify({
        'active': True,
        'ready_check_id': rc['id'],
        'titulo': rc['titulo'],
        'iniciado_en': rc['iniciado_en'],
        'miembros': [dict(r) for r in rows]
    })

@app.route('/api/ready_check/active', methods=['GET'])
def api_ready_check_active():
    if 'role' not in session:
        return jsonify({'error': 'No autenticado'}), 401
    equipo_id = session.get('equipo_id')
    miembro_id = session.get('miembro_id')
    if not equipo_id:
        return jsonify({'active': False})
        
    conn = get_db_connection()
    rc = conn.execute('''
        SELECT rc.*, mrc.estado as mi_estado, mrc.nota as mi_nota, mrc.respondido_en
        FROM Equipo_ReadyCheck rc
        LEFT JOIN Miembro_ReadyCheck mrc ON rc.id = mrc.ready_check_id AND mrc.miembro_id = ?
        WHERE rc.equipo_id = ? AND rc.activo = 1
        ORDER BY rc.id DESC LIMIT 1
    ''', (miembro_id, equipo_id)).fetchone()
    conn.close()
    
    if not rc:
        return jsonify({'active': False})
        
    return jsonify({
        'active': True,
        'ready_check_id': rc['id'],
        'titulo': rc['titulo'],
        'iniciado_en': rc['iniciado_en'],
        'mi_estado': rc['mi_estado'] or 'PENDIENTE',
        'mi_nota': rc['mi_nota'] or '',
        'respondido_en': rc['respondido_en']
    })

@app.route('/api/operador/ready', methods=['POST'])
def api_operador_ready():
    role = session.get('role')
    if not role:
        return jsonify({'error': 'No autenticado'}), 401
        
    data = request.json or {}
    miembro_id = session.get('miembro_id')
    
    # Permitir miembro_id explícito si el usuario tiene rol autorizado
    requested_id = data.get('miembro_id')
    if requested_id and role in ('admin', 'equipo', 'operador'):
        miembro_id = requested_id
        
    if not miembro_id:
        if role == 'admin':
            conn = get_db_connection()
            m_first = conn.execute('SELECT id FROM Miembro WHERE activo = 1 LIMIT 1').fetchone()
            miembro_id = m_first['id'] if m_first else None
            conn.close()
        elif role == 'equipo':
            conn = get_db_connection()
            eq_id = session.get('equipo_id')
            m_first = conn.execute('SELECT id FROM Miembro WHERE equipo_id = ? AND activo = 1 LIMIT 1', (eq_id,)).fetchone()
            miembro_id = m_first['id'] if m_first else None
            conn.close()

    if not miembro_id:
        return jsonify({'error': 'No se identificó ningún operador activo'}), 403

    conn = get_db_connection()
    curr = conn.execute('SELECT listo_combate FROM Miembro WHERE id = ?', (miembro_id,)).fetchone()
    if not curr:
        conn.close()
        return jsonify({'error': 'Miembro no encontrado'}), 404
        
    curr_val = curr['listo_combate'] or 0
    if 'listo' in data:
        new_val = 1 if data['listo'] else 0
    else:
        new_val = 0 if curr_val == 1 else 1

    conn.execute('''
        UPDATE Miembro
        SET listo_combate = ?, listo_timestamp = datetime('now')
        WHERE id = ?
    ''', (new_val, miembro_id))
    conn.commit()
    conn.close()
    return jsonify({
        'status': 'success',
        'success': True,
        'listo': bool(new_val),
        'listo_combate': new_val
    })

@app.route('/api/ready_check/respond', methods=['POST'])
def api_ready_check_respond():
    if session.get('role') != 'operador':
        return jsonify({'error': 'Solo operadores pueden responder al pase de lista'}), 403
    miembro_id = session.get('miembro_id')
    equipo_id = session.get('equipo_id')
    data = request.json or {}
    estado = data.get('estado', 'LISTO').upper()
    nota = data.get('nota', '').strip()
    
    conn = get_db_connection()
    # Actualizar estado directo en el combatiente
    listo_val = 1 if estado == 'LISTO' else 0
    conn.execute('UPDATE Miembro SET listo_combate = ?, listo_timestamp = datetime(\'now\') WHERE id = ?', (listo_val, miembro_id))

    rc = conn.execute('SELECT id FROM Equipo_ReadyCheck WHERE equipo_id = ? AND activo = 1 ORDER BY id DESC LIMIT 1', (equipo_id,)).fetchone()
    if rc:
        conn.execute('''
            INSERT INTO Miembro_ReadyCheck (ready_check_id, miembro_id, estado, nota, respondido_en)
            VALUES (?, ?, ?, ?, datetime('now'))
            ON CONFLICT(ready_check_id, miembro_id) DO UPDATE SET
                estado = excluded.estado,
                nota = excluded.nota,
                respondido_en = excluded.respondido_en
        ''', (rc['id'], miembro_id, estado, nota))
        
    conn.commit()
    conn.close()
    return jsonify({'status': 'success', 'estado': estado, 'nota': nota, 'listo_combate': listo_val})

# ==================== FIELD MEDIC ROUTES ====================
@app.route('/sw_medic.js', methods=['GET'])
def serve_medic_sw():
    response = make_response(send_from_directory(os.path.join(app.root_path, 'static'), 'sw_medic.js'))
    response.headers['Content-Type'] = 'application/javascript'
    response.headers['Service-Worker-Allowed'] = '/'
    return response

@app.route('/manifest_medic.json', methods=['GET'])
def serve_medic_manifest():
    response = make_response(send_from_directory(os.path.join(app.root_path, 'static'), 'manifest_medic.json'))
    response.headers['Content-Type'] = 'application/manifest+json'
    return response

@app.route('/medic', methods=['GET'])
@app.route('/medico', methods=['GET'])
def view_medic():
    """
    Ruta PWA principal del módulo médico.
    Permite acceso directo vía QR de carnet (?token=UID) o desde la interfaz.
    """
    conn = get_db_connection()
    user_role = session.get('role', 'player')
    user_faction = session.get('faction', 'Syldavia')
    equipo_id = session.get('equipo_id')
    equipo_nombre = session.get('equipo_nombre') or session.get('user') or ''
    
    # Sincronizar dinámicamente si el operador es médico consultando la base de datos
    if user_role == 'operador' and session.get('miembro_id'):
        try:
            m_row = conn.execute('SELECT rol, uid FROM Miembro WHERE id = ?', (session['miembro_id'],)).fetchone()
            if m_row:
                rol_l = (m_row['rol'] or '').lower()
                is_med = any(w in rol_l for w in ['medico', 'médico', 'sanitario', 'medic'])
                session['is_medic'] = is_med
                if is_med:
                    session['sanitario_id'] = m_row['uid']
        except Exception:
            pass
    
    # Lista de sanitarios de la escuadra actual si la sesión pertenece a un equipo
    squad_medics = []
    if equipo_id:
        try:
            m_rows = conn.execute('''
                SELECT uid, nombre_jugador, rol 
                FROM Miembro 
                WHERE equipo_id = ? AND (LOWER(rol) LIKE '%medico%' OR LOWER(rol) LIKE '%sanitario%')
            ''', (equipo_id,)).fetchall()
            squad_medics = [dict(r) for r in m_rows]
        except Exception:
            squad_medics = []
            
    # Identificador del sanitario por defecto
    if user_role == 'admin':
        sanitario_id = 'ADMIN'
        recursos = medic_engine.get_or_create_sanitario_recursos(conn, 'ADMIN')
    else:
        sanitario_id = session.get('sanitario_id') or session.get('user') or (f"MED-{equipo_id}" if equipo_id else "MED-ALFA")
        recursos = medic_engine.get_or_create_sanitario_recursos(conn, sanitario_id)
    
    config = medic_engine.load_medic_config()
    
    # Si viene con token de operador directo vía QR
    preloaded_token = request.args.get('token', '')

    from jinja2 import ChoiceLoader, FileSystemLoader
    # Asegurar que Flask encuentre las plantillas de field_medic/templates
    custom_loader = ChoiceLoader([
        app.jinja_loader,
        FileSystemLoader(os.path.join(os.path.dirname(__file__), 'field_medic', 'templates'))
    ])
    app.jinja_loader = custom_loader

    return render_template(
        'medic_app.html',
        sanitario_id=sanitario_id,
        recursos=recursos,
        config=config,
        preloaded_token=preloaded_token,
        user_role=user_role,
        user_faction=user_faction,
        session_equipo_id=equipo_id,
        session_equipo_nombre=equipo_nombre,
        squad_medics=squad_medics
    )

@app.route('/api/medico/recursos', methods=['GET'])
def api_medico_recursos():
    conn = get_db_connection()
    sanitario_id = request.args.get('sanitario_id') or session.get('sanitario_id') or "MED-ALFA"
    recursos = medic_engine.get_or_create_sanitario_recursos(conn, sanitario_id)
    return jsonify(recursos)

@app.route('/api/medico/sync', methods=['POST'])
def api_medico_sync():
    """
    Endpoint de sincronización idempotente de episodios médicos.
    """
    payload = request.json or {}
    conn = get_db_connection()
    result, status_code = medic_engine.sync_episodio_medico(conn, payload)
    return jsonify(result), status_code

# Registro en memoria de órdenes de desvinculación remota emitidas por Dirección
MEDIC_REMOTE_UNBINDS = set()

@app.route('/api/medic/roster', methods=['GET'])
def api_medic_roster():
    """
    Snapshot de miembros y sanitarios para que la PWA médica funcione
    100% offline con validación presencial de carnets y doctrina de cupos.
    """
    conn = get_db_connection()
    roster_data = medic_engine.get_medic_roster_snapshot(conn)
    roster_data['unbound_medics'] = list(MEDIC_REMOTE_UNBINDS)
    return jsonify(roster_data)

@app.route('/api/admin/medicos/unbind', methods=['POST'])
def api_admin_medicos_unbind():
    """
    Permite al Administrador desvincular de forma remota el terminal de un médico sin
    necesidad de facilitarle el PIN maestro al jugador.
    """
    if session.get('role') != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
    data = request.json or {}
    sanitario_id = str(data.get('sanitario_id', '')).strip().upper()
    uid = str(data.get('uid', '')).strip().upper()
    nombre = str(data.get('nombre_medico', '')).strip().upper()

    for t in [sanitario_id, uid, nombre]:
        if t:
            MEDIC_REMOTE_UNBINDS.add(t)
            clean_t = t.replace('MED-', '').strip()
            if clean_t:
                MEDIC_REMOTE_UNBINDS.add(clean_t)

    target_label = nombre or uid or sanitario_id
    return jsonify({
        'status': 'success',
        'message': f'Orden de desvinculación remota emitida para {target_label}. El terminal se liberará automáticamente al sincronizar.'
    })

@app.route('/api/medic/admin_unlock', methods=['POST'])
def api_medic_admin_unlock():
    """
    Endpoint de autorización para desvincular un terminal de médico.
    Permite:
    1. Sesión activa de Administrador o PIN maestro (4747).
    2. PIN de contingencia de campo de Dirección (1974).
    3. Verificación de identidad: Primeros 4 dígitos del DNI o PIN propio del combatiente titular.
    """
    data = request.json or {}
    pin = str(data.get('pin', '')).strip()
    sanitario_id = str(data.get('sanitario_id', '')).strip()
    is_admin = session.get('role') == 'admin'

    # 1. Clave maestra de Dirección o sesión admin
    if is_admin or pin == '4747' or pin == '1974':
        return jsonify({
            'status': 'success',
            'authorized': True,
            'success': True,
            'message': 'Desvinculación del terminal autorizada por Dirección.'
        })

    # 2. Comprobar si coincide con el PIN personal o primeros 4 dígitos del DNI del combatiente asignado
    if pin and sanitario_id:
        conn = get_db_connection()
        clean_sid = sanitario_id.replace('MED-', '').strip().upper()
        m = conn.execute('''
            SELECT pin, dni, uid, nombre_jugador FROM Miembro 
            WHERE UPPER(uid) = ? OR UPPER(nombre_jugador) = ? OR UPPER(uid) = ? OR UPPER(nombre_jugador) = ?
        ''', (sanitario_id.upper(), sanitario_id.upper(), clean_sid, clean_sid)).fetchone()

        if m:
            dni_clean = ''.join(c for c in (m['dni'] or '') if c.isdigit())
            custom_pin = str(m['pin'] or '').strip()
            if (custom_pin and pin == custom_pin) or (len(dni_clean) >= 4 and pin == dni_clean[:4]):
                return jsonify({
                    'status': 'success',
                    'authorized': True,
                    'success': True,
                    'message': 'Desvinculación autorizada mediante credencial personal del operador titular.'
                })

    return jsonify({
        'status': 'error',
        'authorized': False,
        'success': False,
        'message': 'PIN incorrecto. Puede usar sus 4 dígitos de DNI/PIN personal o autorización de Dirección.'
    }), 403

@app.route('/api/medic/respawn_recharge', methods=['POST'])
def api_medic_respawn_recharge():
    """
    Endpoint táctico de recarga y registro de respawn para sanitarios de campo.
    """
    data = request.json or {}
    token_qr = data.get('token_qr')
    sanitario_id = data.get('sanitario_id') or session.get('sanitario_id') or session.get('usuario') or 'MED-ALFA'
    user_lat = data.get('user_lat')
    user_lng = data.get('user_lng')

    conn = get_db_connection()
    result, status_code = medic_engine.process_respawn_recharge(conn, token_qr, sanitario_id, user_lat, user_lng)
    return jsonify(result), status_code

# ==================== ADMIN MÉDICOS DASHBOARD ====================
@app.route('/api/admin/medicos/audit', methods=['GET'])
def api_admin_medicos_audit():
    """
    Bitácora táctica de atenciones médicas y control de discrepancias para el panel de seguridad.
    """
    if session.get('role') != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
    conn = get_db_connection()
    limit = int(request.args.get('limit', 150))
    audit_data = medic_engine.get_medic_audit_log(conn, limit=limit)
    audit_data['status'] = 'success'
    return jsonify(audit_data)

@app.route('/api/admin/medicos', methods=['GET'])
def api_admin_medicos():
    if session.get('role') != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
    conn = get_db_connection()
    
    config = medic_engine.load_medic_config()
    default_reanim = config.get("reanimaciones_iniciales_medico", 3)
    lista = []

    # 0. Cuenta de Administrador / HQ
    rec_admin = medic_engine.get_or_create_sanitario_recursos(conn, 'ADMIN')
    lista.append({
        'sanitario_id': 'admin',
        'nombre_medico': 'ADMINISTRADOR (HQ)',
        'rol': 'Oficial Médico / Mando General',
        'equipo_id': 0,
        'equipo_nombre': 'Control Central / HQ',
        'faccion': 'Global',
        'miembros_count': 99,
        'medicos_count': 1,
        'max_medicos_permitidos': 99,
        'excede_limite': False,
        'curas_doctrina': 99,
        'reanimaciones_disponibles': rec_admin['reanimaciones_disponibles'],
        'reanimaciones_usadas': rec_admin['reanimaciones_usadas'],
        'is_admin': True
    })

    # 1. Buscar miembros con rol médico o sanitario asignados en unidades
    medicos_db = conn.execute('''
        SELECT m.id as miembro_id, m.nombre_jugador, m.rol, m.uid,
               e.id as equipo_id, e.nombre as equipo_nombre, f.nombre as faccion,
               (SELECT COUNT(*) FROM Miembro m2 WHERE m2.equipo_id = e.id) as miembros_count,
               (SELECT COUNT(*) FROM Miembro m3 WHERE m3.equipo_id = e.id AND (LOWER(m3.rol) LIKE '%medico%' OR LOWER(m3.rol) LIKE '%sanitario%')) as medicos_count
        FROM Miembro m
        JOIN Equipo e ON m.equipo_id = e.id
        LEFT JOIN Faccion f ON e.faccion_id = f.id
        WHERE LOWER(m.rol) LIKE '%medico%' OR LOWER(m.rol) LIKE '%sanitario%'
        ORDER BY f.nombre, e.nombre, m.nombre_jugador
    ''').fetchall()

    if medicos_db:
        for med in medicos_db:
            canonical_lookup = med['uid'] or med['nombre_jugador']
            pax = med['miembros_count'] or 0
            meds_count = med['medicos_count'] or 1
            max_permitidos = medic_engine.get_max_medicos_permitidos(pax)
            curas_doctrina = medic_engine.calcular_curas_por_medico(pax, meds_count)
            rec = medic_engine.get_or_create_sanitario_recursos(conn, canonical_lookup, default_reanim=curas_doctrina)
            sanitario_id = f"MED-{med['nombre_jugador'].upper()}" if med['nombre_jugador'] else f"MED-{med['equipo_id']}"

            lista.append({
                'sanitario_id': sanitario_id,
                'uid': med['uid'],
                'nombre_medico': med['nombre_jugador'],
                'rol': med['rol'],
                'equipo_id': med['equipo_id'],
                'equipo_nombre': med['equipo_nombre'],
                'faccion': med['faccion'] or 'Sin facción',
                'miembros_count': pax,
                'medicos_count': meds_count,
                'max_medicos_permitidos': max_permitidos,
                'excede_limite': meds_count > max_permitidos,
                'curas_doctrina': curas_doctrina,
                'reanimaciones_disponibles': rec['reanimaciones_disponibles'],
                'reanimaciones_usadas': rec['reanimaciones_usadas'],
                'is_admin': False
            })
    else:
        # Fallback a equipos si no hay miembros con rol médico asignado todavía
        equipos = conn.execute('''
            SELECT e.id, e.nombre as equipo_nombre, f.nombre as faccion,
                   (SELECT COUNT(*) FROM Miembro m WHERE m.equipo_id = e.id) as miembros_count
            FROM Equipo e
            LEFT JOIN Faccion f ON e.faccion_id = f.id
            ORDER BY f.nombre, e.nombre
        ''').fetchall()
        for eq in equipos:
            sanitario_id = f"MED-{eq['id']}"
            pax = eq['miembros_count'] or 0
            max_permitidos = medic_engine.get_max_medicos_permitidos(pax)
            curas_doctrina = medic_engine.calcular_curas_por_medico(pax, 1)
            rec = medic_engine.get_or_create_sanitario_recursos(conn, sanitario_id, default_reanim=curas_doctrina)
            lista.append({
                'sanitario_id': sanitario_id,
                'nombre_medico': 'Sanitario de Unidad',
                'rol': 'Médico General',
                'equipo_id': eq['id'],
                'equipo_nombre': eq['equipo_nombre'],
                'faccion': eq['faccion'] or 'Sin facción',
                'miembros_count': pax,
                'medicos_count': 1,
                'max_medicos_permitidos': max_permitidos,
                'excede_limite': False,
                'curas_doctrina': curas_doctrina,
                'reanimaciones_disponibles': rec['reanimaciones_disponibles'],
                'reanimaciones_usadas': rec['reanimaciones_usadas'],
                'is_admin': False
            })

    return jsonify(lista)

@app.route('/api/admin/medicos/update', methods=['POST'])
def api_admin_medicos_update():
    if session.get('role') != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
    data = request.json or {}
    sanitario_id = data.get('sanitario_id')
    reanimaciones = data.get('reanimaciones')
    if not sanitario_id or reanimaciones is None:
        return jsonify({'status': 'error', 'message': 'Datos incompletos'}), 400

    conn = get_db_connection()
    rec = medic_engine.update_sanitario_recursos(conn, sanitario_id, int(reanimaciones))
    return jsonify({'status': 'success', 'message': f'Cupo fijado a {reanimaciones}', 'reanimaciones': rec['reanimaciones_disponibles'], 'reanimaciones_usadas': rec['reanimaciones_usadas']})

@app.route('/api/admin/medicos/refill-all', methods=['POST'])
def api_admin_medicos_refill_all():
    if session.get('role') != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
    conn = get_db_connection()
    config = medic_engine.load_medic_config()
    default_reanim = config.get("reanimaciones_iniciales_medico", 3)
    
    medicos_db = conn.execute('''
        SELECT m.nombre_jugador, m.uid, e.id as equipo_id,
               (SELECT COUNT(*) FROM Miembro m2 WHERE m2.equipo_id = e.id) as miembros_count,
               (SELECT COUNT(*) FROM Miembro m3 WHERE m3.equipo_id = e.id AND (LOWER(m3.rol) LIKE '%medico%' OR LOWER(m3.rol) LIKE '%sanitario%')) as medicos_count
        FROM Miembro m
        JOIN Equipo e ON m.equipo_id = e.id
        WHERE LOWER(m.rol) LIKE '%medico%' OR LOWER(m.rol) LIKE '%sanitario%'
    ''').fetchall()
    
    count = 0
    if medicos_db:
        for med in medicos_db:
            pax = med['miembros_count'] or 0
            meds_count = med['medicos_count'] or 1
            # Metodología TVC: miembros de escuadra // medicos asignados (a la baja)
            val = medic_engine.calcular_curas_por_medico(pax, meds_count)
            medic_engine.update_sanitario_recursos(conn, med['uid'] or med['nombre_jugador'], val)
            count += 1
    else:
        equipos = conn.execute('''
            SELECT e.id,
                   (SELECT COUNT(*) FROM Miembro m WHERE m.equipo_id = e.id) as miembros_count
            FROM Equipo e
        ''').fetchall()
        for eq in equipos:
            pax = eq['miembros_count'] or 0
            val = medic_engine.calcular_curas_por_medico(pax, 1)
            sanitario_id = f"MED-{eq['id']}"
            medic_engine.update_sanitario_recursos(conn, sanitario_id, val)
            count += 1
            
    medic_engine.update_sanitario_recursos(conn, 'ADMIN', 99)
    return jsonify({'status': 'success', 'message': f'Recargados {count} sanitarios según doctrina TVC (miembros // médicos).', 'total_actualizados': count})

# ==================== ADMIN GESTIÓN GLOBAL DE JUEGOS ====================
@app.route('/api/admin/juegos/config', methods=['GET'])
def api_admin_juegos_config_get():
    if session.get('role') != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
    conn = get_db_connection()
    try:
        ensure_juego_config_tables(conn)
        configs = get_all_juegos_config(conn)
        juegos_list = list(configs.values())
        return jsonify({
            'status': 'success',
            'juegos': juegos_list,
            'total': len(juegos_list),
            'activos': sum(1 for j in juegos_list if j['activo']),
            'inactivos': sum(1 for j in juegos_list if not j['activo'])
        })
    finally:
        conn.close()

@app.route('/api/admin/juegos/toggle', methods=['POST'])
def api_admin_juegos_toggle():
    if session.get('role') != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
    data = request.json or {}
    juego_id = data.get('juego_id')
    if not juego_id:
        return jsonify({'status': 'error', 'message': 'ID de juego requerido'}), 400
        
    conn = get_db_connection()
    try:
        cur_cfg = get_juego_config(juego_id, conn)
        if 'activo' in data:
            nuevo_estado = 1 if data['activo'] else 0
        else:
            nuevo_estado = 0 if cur_cfg['activo'] else 1
            
        set_juego_status(juego_id, nuevo_estado, conn)
        estado_label = "OPERATIVO" if nuevo_estado else "DESACTIVADO"
        return jsonify({
            'status': 'success',
            'juego_id': juego_id,
            'activo': bool(nuevo_estado),
            'message': f"{cur_cfg['nombre']}: {estado_label}"
        })
    finally:
        conn.close()

@app.route('/api/admin/juegos/config', methods=['POST'])
def api_admin_juegos_config_post():
    if session.get('role') != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
    data = request.json or {}
    juego_id = data.get('juego_id')
    if not juego_id:
        return jsonify({'status': 'error', 'message': 'ID de juego requerido'}), 400
        
    conn = get_db_connection()
    try:
        save_juego_full_config(juego_id, data, conn)
        return jsonify({
            'status': 'success',
            'message': f"Configuración y códigos de {juego_id} guardados correctamente."
        })
    finally:
        conn.close()

@app.route('/api/admin/juegos/reset', methods=['POST'])
def api_admin_juegos_reset():
    if session.get('role') != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
    data = request.json or {}
    juego_id = data.get('juego_id')
    if not juego_id or juego_id not in DEFAULT_JUEGOS_CONFIG:
        return jsonify({'status': 'error', 'message': 'ID de juego inválido'}), 400
        
    d_cfg = DEFAULT_JUEGOS_CONFIG[juego_id]
    conn = get_db_connection()
    try:
        save_juego_full_config(juego_id, d_cfg, conn)
        return jsonify({
            'status': 'success',
            'message': f"Parámetros de {d_cfg['nombre']} restablecidos por defecto."
        })
    finally:
        conn.close()

@app.route('/api/admin/juegos/toggle_all', methods=['POST'])
def api_admin_juegos_toggle_all():
    if session.get('role') != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
    data = request.json or {}
    activo = 1 if data.get('activo', True) else 0
    conn = get_db_connection()
    try:
        conn.execute('UPDATE juego_config SET activo = ?, actualizado_en = CURRENT_TIMESTAMP', (activo,))
        conn.commit()
        msg = "Todos los juegos ACTIVADOS" if activo else "Todos los juegos DESACTIVADOS"
        return jsonify({'status': 'success', 'message': msg, 'activo': bool(activo)})
    finally:
        conn.close()

patch_db()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5020))
    app.run(debug=True, port=port)



