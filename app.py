from flask import Flask, render_template, request, jsonify, session, redirect, url_for, g
import sqlite3
import os
import secrets
import time
import dynamic_targets_engine
import imint_engine
import math

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

gps_mapper = GPSMapper()


app = Flask(__name__)
app.secret_key = 'tvc-milsim-secret-key-2026'

DB_PATH = os.path.join(os.path.dirname(__file__), 'data', 'orbat.db')

MINIGAME_PASSWORDS = {
    'mortero': {
        'Syldavia': 'fuego-syl',
        'Volkovia': 'fuego-vol'
    }
}

ADMIN_USERS = {
    'admin': {'password': '4747', 'role': 'admin', 'faction': 'All'}
}

def get_db_connection():
    if 'db' not in g:
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
        db.close()

@app.after_request
def add_header(response):
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
            
        # 3. Check Equipos (Teams)
        if usuario and password:
            conn = get_db_connection()
            eq = conn.execute('''
                SELECT e.id, e.password_hash, e.estado_sancion, f.nombre as faccion_nombre 
                FROM Equipo e 
                JOIN Faccion f ON e.faccion_id = f.id 
                WHERE LOWER(e.codigo) = LOWER(?) AND e.codigo != '' AND e.codigo IS NOT NULL
            ''', (usuario,)).fetchone()
            conn.close()
            
            if eq:
                # Support both plaintext and legacy hashed passwords
                from werkzeug.security import check_password_hash
                is_valid = False
                if eq['password_hash'] == password:
                    is_valid = True
                elif eq['password_hash'].startswith('pbkdf2:sha256:') and check_password_hash(eq['password_hash'], password):
                    is_valid = True
                if is_valid:
                    if eq['estado_sancion'] in ['Sancionado', 'Expulsado', 'Inactivo']:
                        return render_template('login.html', error=f"ACCESO DENEGADO: El equipo se encuentra {eq['estado_sancion'].upper()}")
                        
                    session.permanent = (request.form.get('remember_me') == 'yes')
                    session['faction'] = eq['faccion_nombre']
                    session['role'] = 'equipo'
                    session['equipo_id'] = eq['id']
                    return redirect(url_for('index'))
            
        return render_template('login.html', error='Credenciales incorrectas o no autorizadas')
    return render_template('login.html')

@app.route('/api/auth_minigame', methods=['POST'])
def auth_minigame():
    if 'role' not in session or 'faction' not in session:
        return jsonify({'success': False, 'message': 'No autorizado'}), 403
        
    data = request.json
    minigame = data.get('minigame')
    password = data.get('password', '').strip()
    faction = session['faction']
    
    if session['role'] == 'admin':
        return jsonify({'success': True})
        
    if minigame in MINIGAME_PASSWORDS and faction in MINIGAME_PASSWORDS[minigame]:
        if password.lower() == MINIGAME_PASSWORDS[minigame][faction].lower():
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
    conn = get_db_connection()
    config = conn.execute('SELECT alcance_base FROM Mortero_Config WHERE id=1').fetchone()
    alcance_base = config['alcance_base'] if config else 800
    
    return render_template('mortero_app.html', 
                           user_role=session['role'], 
                           user_faction=session['faction'],
                           equipo_id=session.get('equipo_id'),
                           alcance_base=alcance_base)

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
            
            if not is_admin:
                for h in eq['historial']:
                    h.pop('valoracion', None)
            
        conn.close()
        return jsonify(equipos_list)
    
    elif request.method == 'POST':
        data = request.json
        cursor = conn.cursor()
        
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
                cursor.execute(
                    'INSERT INTO Miembro (equipo_id, nombre_jugador, rol, armamento, uid, nombre_apellidos, dni, telefono, email, bando_original, activo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    (new_id, m.get('nombre_jugador', ''), m.get('rol', 'Operador'), m.get('armamento', 'Fusilero'), new_uid, m.get('nombre_apellidos', ''), m.get('dni', ''), m.get('telefono', ''), m.get('email', ''), m.get('bando_original', ''), m.get('activo', 1))
                )
        
        if 'historial' in data and isinstance(data['historial'], list):
            for h in data['historial']:
                cursor.execute(
                    'INSERT INTO Historial_Equipo (equipo_id, operacion, mision_id, grupo_rol, valoracion, faccion_id) VALUES (?, ?, ?, ?, ?, ?)',
                    (new_id, h.get('operacion', ''), h.get('mision_id', None), h.get('grupo_rol', ''), h.get('valoracion', ''), h.get('faccion_id', None))
                )
                
        conn.commit()
        conn.close()
        return jsonify({'id': new_id, 'status': 'success'}), 201

@app.route('/api/equipos/<int:id>/logo', methods=['POST'])
def upload_equipo_logo(id):
    if session.get('role') != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
    if 'logo' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['logo']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
        
    # Get extension
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ['.jpg', '.jpeg', '.png', '.webp', '.gif']:
        return jsonify({'error': 'Invalid image format'}), 400
        
    # Obtener nombre del equipo para el archivo
    conn = get_db_connection()
    equipo = conn.execute('SELECT nombre FROM Equipo WHERE id = ?', (id,)).fetchone()
    if not equipo:
        conn.close()
        return jsonify({'error': 'Equipo no encontrado'}), 404
        
    safe_name = "".join([c for c in equipo['nombre'] if c.isalnum() or c in (' ', '_', '-')]).replace(' ', '_')
    filename = f"{safe_name}{ext}"
    filepath = os.path.join(app.root_path, 'static', 'imgs', 'logos_equipos', filename)
    file.save(filepath)
    
    # Update db
    conn.execute('UPDATE Equipo SET logo_url = ? WHERE id = ?', (f"/static/imgs/logos_equipos/{filename}", id))
    conn.commit()
    conn.close()
    
    return jsonify({'status': 'success', 'logo_url': f"/static/imgs/logos_equipos/{filename}"})

@app.route('/api/equipos/<int:id>/foto', methods=['POST'])
def upload_equipo_foto(id):
    if session.get('role') != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
    if 'foto' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['foto']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
        
    # Get extension
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ['.jpg', '.jpeg', '.png', '.webp', '.gif']:
        return jsonify({'error': 'Invalid image format'}), 400
        
    # Obtener nombre del equipo
    conn = get_db_connection()
    equipo = conn.execute('SELECT nombre FROM Equipo WHERE id = ?', (id,)).fetchone()
    if not equipo:
        conn.close()
        return jsonify({'error': 'Equipo no encontrado'}), 404
        
    safe_name = "".join([c for c in equipo['nombre'] if c.isalnum() or c in (' ', '_', '-')]).replace(' ', '_')
    filename = f"{safe_name}{ext}"
    filepath = os.path.join(app.root_path, 'static', 'imgs', 'fotos_equipos', filename)
    file.save(filepath)
    
    # Update db
    conn.execute('UPDATE Equipo SET foto_url = ? WHERE id = ?', (f"/static/imgs/fotos_equipos/{filename}", id))
    conn.commit()
    conn.close()
    
    return jsonify({'status': 'success', 'foto_url': f"/static/imgs/fotos_equipos/{filename}"})

@app.route('/api/equipos/<int:id>', methods=['PUT', 'DELETE'])
def update_delete_equipo(id):
    conn = get_db_connection()
    cursor = conn.cursor()
    if request.method == 'PUT':
        data = request.json
        is_admin = session.get('role') == 'admin'
        
        if is_admin:
            cursor.execute(
                'UPDATE Equipo SET nombre = ?, jugadores = ?, jugadores_manual = ?, faccion_id = ?, tipo = ?, valoracion = ?, codigo = ?, misiones_preferidas = ?, tags_comportamiento = ?, estado_medalla = ?, estado_sancion = ? WHERE id = ?',
                (data['nombre'], data['jugadores'], data.get('jugadores_manual', False), data['faccion_id'], data.get('tipo', ''), data.get('valoracion', ''), data.get('codigo', ''), data.get('misiones_preferidas', ''), data.get('tags_comportamiento', '[]'), data.get('estado_medalla', 'verde'), data.get('estado_sancion', 'Autorizado'), id)
            )
            
            # Update password if provided
            raw_password = data.get('password', '').strip()
            if raw_password:
                pwd_hash = raw_password
                cursor.execute('UPDATE Equipo SET password_hash = ? WHERE id = ?', (pwd_hash, id))
        else:
            # Equips can only update their own safe fields
            cursor.execute(
                'UPDATE Equipo SET jugadores = ?, jugadores_manual = ?, tipo = ?, misiones_preferidas = ?, tags_comportamiento = ? WHERE id = ?',
                (data['jugadores'], data.get('jugadores_manual', False), data.get('tipo', ''), data.get('misiones_preferidas', ''), data.get('tags_comportamiento', '[]'), id)
            )
        
        # Update members (smart approach: update existing, delete missing, insert new)
        if 'miembros' in data and isinstance(data['miembros'], list):
            incoming_ids = [m['id'] for m in data['miembros'] if m.get('id')]
            if incoming_ids:
                placeholders = ','.join('?' * len(incoming_ids))
                cursor.execute(f'DELETE FROM Miembro WHERE equipo_id = ? AND id NOT IN ({placeholders})', [id] + incoming_ids)
            else:
                cursor.execute('DELETE FROM Miembro WHERE equipo_id = ?', (id,))
                
            import uuid
            for m in data['miembros']:
                if m.get('id'):
                    cursor.execute(
                        'UPDATE Miembro SET nombre_jugador = ?, rol = ?, armamento = ?, nombre_apellidos = ?, dni = ?, telefono = ?, email = ?, bando_original = ?, activo = ? WHERE id = ?',
                        (m.get('nombre_jugador', ''), m.get('rol', 'Operador'), m.get('armamento', 'Fusilero'), m.get('nombre_apellidos', ''), m.get('dni', ''), m.get('telefono', ''), m.get('email', ''), m.get('bando_original', ''), m.get('activo', 1), m['id'])
                    )
                else:
                    new_uid = str(uuid.uuid4()).split('-')[0].upper()
                    cursor.execute(
                        'INSERT INTO Miembro (equipo_id, nombre_jugador, rol, armamento, uid, nombre_apellidos, dni, telefono, email, bando_original, activo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        (id, m.get('nombre_jugador', ''), m.get('rol', 'Operador'), m.get('armamento', 'Fusilero'), new_uid, m.get('nombre_apellidos', ''), m.get('dni', ''), m.get('telefono', ''), m.get('email', ''), m.get('bando_original', ''), m.get('activo', 1))
                    )
                
        # Update historial
        if 'historial' in data and isinstance(data['historial'], list):
            cursor.execute('DELETE FROM Historial_Equipo WHERE equipo_id = ?', (id,))
            for h in data['historial']:
                cursor.execute(
                    'INSERT INTO Historial_Equipo (equipo_id, operacion, mision_id, grupo_rol, valoracion, faccion_id) VALUES (?, ?, ?, ?, ?, ?)',
                    (id, h.get('operacion', ''), h.get('mision_id', None), h.get('grupo_rol', ''), h.get('valoracion', ''), h.get('faccion_id', None))
                )
                
        conn.commit()
        conn.close()
        return jsonify({'status': 'success'})
    
    elif request.method == 'DELETE':
        cursor.execute('DELETE FROM Equipo WHERE id = ?', (id,))
        conn.commit()
        conn.close()
        return jsonify({'status': 'success'})

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
    
    existing = cursor.execute('SELECT id FROM Historial_Asignacion WHERE operacion_id = ? AND equipo_id = ?', (operacion_id, equipo_id)).fetchone()
    
    if grupo_batalla_id is None:
        if existing:
            cursor.execute('DELETE FROM Historial_Asignacion WHERE id = ?', (existing['id'],))
    else:
        if existing:
            cursor.execute("UPDATE Historial_Asignacion SET grupo_batalla_id = ?, estado = 'Aprobada' WHERE id = ?", (grupo_batalla_id, existing['id']))
        else:
            cursor.execute("INSERT INTO Historial_Asignacion (operacion_id, equipo_id, grupo_batalla_id, estado) VALUES (?, ?, ?, 'Aprobada')", (operacion_id, equipo_id, grupo_batalla_id))
            
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
    existing = cursor.execute('SELECT id FROM Historial_Asignacion WHERE operacion_id = ? AND equipo_id = ?', (operacion_id, equipo_id)).fetchone()
    if existing:
        cursor.execute("UPDATE Historial_Asignacion SET grupo_batalla_id = ?, estado = 'Pendiente' WHERE id = ?", (grupo_batalla_id, existing['id']))
    else:
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
        cursor.execute("UPDATE Historial_Asignacion SET estado = 'Aprobada' WHERE id = ?", (asignacion_id,))
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
        faccion_id = request.args.get('faccion_id')
        query = 'SELECT * FROM MarcadorMapa'
        params = ()
        if faccion_id:
            query += ' WHERE faccion_id = ?'
            params = (faccion_id,)
        marcadores = conn.execute(query, params).fetchall()
        conn.close()
        return jsonify([dict(row) for row in marcadores])
    
    elif request.method == 'POST':
        data = request.json
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO MarcadorMapa (faccion_id, tipo, lat, lng, descripcion) VALUES (?, ?, ?, ?, ?)',
            (data['faccion_id'], data['tipo'], data['lat'], data['lng'], data.get('descripcion', ''))
        )
        new_id = cursor.lastrowid
        conn.commit()
        conn.close()
        return jsonify({'id': new_id, 'status': 'success'}), 201
    
    elif request.method == 'DELETE':
        faccion_id = request.args.get('faccion_id')
        if faccion_id:
            conn.execute('DELETE FROM MarcadorMapa WHERE faccion_id = ?', (faccion_id,))
            conn.commit()
        conn.close()
        return jsonify({'status': 'success'})

@app.route('/api/mapa/marcadores/<int:id>', methods=['DELETE'])
def delete_marcador(id):
    conn = get_db_connection()
    conn.execute('DELETE FROM MarcadorMapa WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})

@app.route('/api/mapa/marcadores/<int:id>', methods=['PUT'])
def update_marcador(id):
    data = request.json
    conn = get_db_connection()
    conn.execute('UPDATE MarcadorMapa SET lat = ?, lng = ? WHERE id = ?', (data['lat'], data['lng'], id))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})

@app.route('/api/mapa/rutas', methods=['GET', 'POST', 'DELETE'])
def manage_rutas():
    conn = get_db_connection()
    if request.method == 'GET':
        faccion_id = request.args.get('faccion_id')
        query = 'SELECT * FROM RutaMapa'
        params = ()
        if faccion_id:
            query += ' WHERE faccion_id = ?'
            params = (faccion_id,)
        rutas = conn.execute(query, params).fetchall()
        conn.close()
        return jsonify([dict(row) for row in rutas])
    
    elif request.method == 'POST':
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
        faccion_id = request.args.get('faccion_id')
        if faccion_id:
            conn.execute('DELETE FROM RutaMapa WHERE faccion_id = ?', (faccion_id,))
            conn.commit()
        conn.close()
        return jsonify({'status': 'success'})

@app.route('/api/mapa/rutas/<int:id>', methods=['DELETE'])
def delete_ruta(id):
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
        query = 'SELECT * FROM ZonaMapa'
        params = ()
        if faccion_id:
            query += ' WHERE faccion_id = ?'
            params = (faccion_id,)
        zonas = conn.execute(query, params).fetchall()
        conn.close()
        return jsonify([dict(row) for row in zonas])
    
    elif request.method == 'POST':
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
        faccion_id = request.args.get('faccion_id')
        if faccion_id:
            conn.execute('DELETE FROM ZonaMapa WHERE faccion_id = ?', (faccion_id,))
            conn.commit()
        conn.close()
        return jsonify({'status': 'success'})

@app.route('/api/mapa/zonas/<int:id>', methods=['DELETE'])
def delete_zona(id):
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
            conn.commit()
            return jsonify({'status': 'success', 'message': "Despliegue autorizado."})
            
        else:
            return jsonify({'status': 'error', 'message': 'Este punto no admite esta acción.'}), 400
    finally:
        conn.close()



        
    if poi['tipo'] == 'PC':
        # Convert neutral (0) to None
        fac_id = None if str(faccion_id) == '0' else int(faccion_id)
        
        if fac_id not in [1, 2, None]:
            conn.close()
            return jsonify({'status': 'error', 'message': 'Facción inválida para banderas.'}), 400
            
        if fac_id not in [1, 2] and session.get('role') != 'admin':
            conn.close()
            return jsonify({'status': 'error', 'message': 'No tienes permisos para neutralizar este punto.'}), 403
            
        if poi['faccion_id'] == fac_id:
            conn.close()
            return jsonify({'status': 'success', 'message': 'Este punto ya está en ese estado.'})
            
        conn.execute('UPDATE puntos_interes SET faccion_id = ? WHERE id = ?', (fac_id, poi['id']))
        # Inserción en historial
        conn.execute('INSERT INTO puntos_control (poi_id, faccion_id) VALUES (?, ?)', (poi['id'], fac_id))
        conn.commit()
        conn.close()
        return jsonify({'status': 'success', 'message': "Punto capturado con éxito."})
        
    elif poi['tipo'] == 'RESPAWN':
        equipo_id = data.get('equipo_id')
        if not equipo_id:
            conn.close()
            return jsonify({'status': 'error', 'message': 'Debes seleccionar un equipo.'}), 400
            
        conn.execute('INSERT INTO respawn (poi_id, faccion_id, equipo_id) VALUES (?, ?, ?)', (poi['id'], faccion_id, equipo_id))
        conn.commit()
        conn.close()
        return jsonify({'status': 'success', 'message': "Respawn registrado correctamente."})
        
    else:
        conn.close()
        return jsonify({'status': 'error', 'message': 'Este punto no admite esta acción.'}), 400


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
        
    return render_template('scan.html', poi=poi, user_role=session.get('role', 'player'), equipos=equipos)

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
    return jsonify({'status': 'success'})


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
        conn.commit()
        return jsonify({'status': 'success', 'message': 'Zafarrancho de combate completado. Todo limpio.'})
    finally:
        conn.close()


import math
from datetime import datetime, timedelta



@app.route('/api/mortero/fijar', methods=['POST'])
def api_mortero_fijar():
    if 'role' not in session: return jsonify({'error': 'Unauthorized'}), 401
    
    data = request.json
    faccion_name = session.get('faction', '')
    if session.get('role') == 'admin' and data.get('admin_faccion'):
        faccion_name = data.get('admin_faccion')
        
    faccion_id = 1 if faccion_name == 'Syldavia' else (2 if faccion_name == 'Volkovia' else None)
    if not faccion_id: return jsonify({'error': 'Facción inválida para artillería.'}), 400
    
    data = request.json
    lat = data.get('lat')
    lng = data.get('lng')
    
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('UPDATE Mortero_Estado SET lat=?, lng=? WHERE faccion_id=?', (lat, lng, faccion_id))
    conn.commit()
    conn.close()
    
    return jsonify({'status': 'success'})

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
        cursor = conn.cursor()
        
        # Obtener config
        config = cursor.execute('SELECT * FROM Mortero_Config WHERE id=1').fetchone()
        alcance_base = config['alcance_base'] if config else 180
        radio_explosion = config['radio_explosion'] if config else 50
        disparos_por_minuto = config['disparos_por_minuto'] if config else 2
        
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
            
        # Cleanup old shots (older than 5 minutes)
        cursor.execute('''DELETE FROM Mortero_Historial_Disparos 
            WHERE timestamp < datetime('now', '-5 minutes')''')
            
        # Check Radar Condition
        # Get all shots from this faction in the last 5 minutes
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
                
                # Cleanup any expired markers first
                cursor.execute("DELETE FROM Mortero_Radar WHERE caduca_en < datetime('now')")
                
                # Insert a new radar marker valid for 60 seconds (as requested for testing)
                cursor.execute('''INSERT INTO Mortero_Radar 
                    (faccion_id_origen, lat, lng, radio, caduca_en) 
                    VALUES (?, ?, ?, ?, datetime('now', '+60 seconds'))''',
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
        
        # LOG ARTILLERIA
        if destruido:
            cursor.execute('INSERT INTO Log_Artilleria (faccion_id, tipo_objetivo, objetivo_id, descripcion) VALUES (?, ?, ?, ?)', 
                           (faccion_id, 'CONTRABATERIA', str(enemy_id), 'Mortero enemigo destruido'))
        if destroyed_dynamic_targets:
            for tgt in destroyed_dynamic_targets:
                tgt_id = tgt['id']
                if tgt_id.startswith('COL-'):
                    tipo = 'DAÑO COLATERAL'
                    desc = f'Objetivo Civil {tgt_id} destruido (Pérdida de PC aliado)'
                elif tgt['is_fake']:
                    tipo = 'OBJETIVO FALSO'
                    desc = f'Señuelo civil {tgt_id} impactado por error (Pérdida de PC aliado)'
                elif tgt['faccion_id'] != faccion_id:
                    tipo = 'FUEGO AMIGO'
                    desc = f'Fuego amigo sobre {tgt_id} (Pérdida de PC aliado)'
                else:
                    tipo = 'BLANCO VALIDO'
                    desc = f'Blanco enemigo {tgt_id} impactado y destruido con éxito'
                    
                cursor.execute('INSERT INTO Log_Artilleria (faccion_id, tipo_objetivo, objetivo_id, descripcion) VALUES (?, ?, ?, ?)', 
                               (faccion_id, tipo, tgt_id, desc))
        
        conn.commit()
                
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
    if session.get('role') == 'admin' and faccion_name == 'All':
        disparos = conn.execute('SELECT * FROM Mortero_Disparo ORDER BY timestamp DESC LIMIT 300').fetchall()
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
    conn.execute('UPDATE Mortero_Config SET alcance_base=?, radio_explosion=?, disparos_por_minuto=? WHERE id=1', 
                (data.get('alcance_base'), data.get('radio_explosion'), data.get('disparos_por_minuto')))
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

@app.route('/api/admin/artilleria/logs', methods=['GET'])
def admin_get_artilleria_logs():
    if session.get('role') != 'admin': return jsonify({'error': 'Unauthorized'}), 403
    conn = get_db_connection()
    try:
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
    conn.close()
    if not miembro:
        return "Jugador no encontrado", 404
        
    color_map = {'Amarillo': '#f1c40f', 'Azul': '#3498db', 'Verde': '#2ecc71', 'Rojo': '#e74c3c'}
    hex_color = color_map.get(miembro['faccion_color'], '#00d2ff')
    
    return render_template('carnet.html', miembro=dict(miembro), hex_color=hex_color)

@app.route('/api/miembros/<int:id>/foto', methods=['POST'])
def upload_miembro_foto(id):
    if session.get('role') != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
    if 'foto' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['foto']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
        
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ['.jpg', '.jpeg', '.png', '.webp', '.gif']:
        return jsonify({'error': 'Invalid image format'}), 400
        
    filename = f"miembro_{id}{ext}"
    filepath = os.path.join(app.root_path, 'static', 'imgs', 'fotos_jugadores', filename)
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    file.save(filepath)
    
    conn = get_db_connection()
    foto_url = f"/static/imgs/fotos_jugadores/{filename}"
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
            conn.execute("ALTER TABLE Historial_Asignacion ADD COLUMN estado TEXT DEFAULT 'Aprobada';")
            conn.commit()
        except Exception:
            pass
        conn.close()

patch_db()

if __name__ == '__main__':
    app.run(debug=True, port=5000)



