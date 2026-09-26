from flask import Flask, render_template, request, jsonify, session, redirect, url_for
import sqlite3
import os

app = Flask(__name__)
app.secret_key = 'tvc-milsim-secret-key-2026'

DB_PATH = os.path.join(os.path.dirname(__file__), 'data', 'orbat.db')

USERS = {
    'admin123': {'role': 'admin', 'faction': 'All'},
    'syldavia2026': {'role': 'faction', 'faction': 'Syldavia'},
    'volkovia2026': {'role': 'faction', 'faction': 'Volkovia'},
    'khemed2026': {'role': 'faction', 'faction': 'Khemed'},
    'syldaviamando': {'role': 'mando', 'faction': 'Syldavia'},
    'volkoviamando': {'role': 'mando', 'faction': 'Volkovia'},
    'khemedmando': {'role': 'mando', 'faction': 'Khemed'}
}

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

@app.after_request
def add_header(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, post-check=0, pre-check=0, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '-1'
    return response

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        codigo = request.form.get('codigo', '').lower()
        if codigo in USERS:
            session['role'] = USERS[codigo]['role']
            session['faction'] = USERS[codigo]['faction']
            return redirect(url_for('index'))
        else:
            return render_template('login.html', error='Código incorrecto o no autorizado')
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

@app.route('/')
def index():
    if 'role' not in session:
        return redirect(url_for('login'))
    return render_template('index.html', user_role=session['role'], user_faction=session['faction'])

@app.route('/api/facciones', methods=['GET'])
def get_facciones():
    conn = get_db_connection()
    facciones = conn.execute('SELECT * FROM Faccion').fetchall()
    conn.close()
    return jsonify([dict(row) for row in facciones])

@app.route('/api/equipos', methods=['GET', 'POST'])
def manage_equipos():
    conn = get_db_connection()
    if request.method == 'GET':
        equipos = conn.execute('''
            SELECT Equipo.*, Faccion.nombre as faccion_nombre, Faccion.color as faccion_color,
                   (SELECT COUNT(*) FROM Miembro m WHERE m.equipo_id = Equipo.id AND m.rol LIKE '%Apoyo%') as apoyos,
                   (SELECT COUNT(*) FROM Miembro m WHERE m.equipo_id = Equipo.id AND m.rol LIKE '%Sniper%') as snipers
            FROM Equipo
            LEFT JOIN Faccion ON Equipo.faccion_id = Faccion.id
        ''').fetchall()
        
        equipos_list = [dict(row) for row in equipos]
        for eq in equipos_list:
            miembros = conn.execute('SELECT * FROM Miembro WHERE equipo_id = ?', (eq['id'],)).fetchall()
            eq['miembros'] = [dict(m) for m in miembros]
            
            historial = conn.execute('SELECT * FROM Historial_Equipo WHERE equipo_id = ?', (eq['id'],)).fetchall()
            eq['historial'] = [dict(h) for h in historial]
            
        conn.close()
        return jsonify(equipos_list)
    
    elif request.method == 'POST':
        data = request.json
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO Equipo (nombre, jugadores, jugadores_manual, faccion_id, tipo, valoracion) VALUES (?, ?, ?, ?, ?, ?)',
            (data['nombre'], data['jugadores'], data.get('jugadores_manual', False), data['faccion_id'], data.get('tipo', ''), data.get('valoracion', ''))
        )
        new_id = cursor.lastrowid
        
        if 'miembros' in data and isinstance(data['miembros'], list):
            for m in data['miembros']:
                cursor.execute(
                    'INSERT INTO Miembro (equipo_id, nombre_jugador, rol) VALUES (?, ?, ?)',
                    (new_id, m.get('nombre_jugador', ''), m.get('rol', ''))
                )
        
        if 'historial' in data and isinstance(data['historial'], list):
            for h in data['historial']:
                cursor.execute(
                    'INSERT INTO Historial_Equipo (equipo_id, operacion, mision_id, grupo_rol) VALUES (?, ?, ?, ?)',
                    (new_id, h.get('operacion', ''), h.get('mision_id', None), h.get('grupo_rol', ''))
                )
                
        conn.commit()
        conn.close()
        return jsonify({'id': new_id, 'status': 'success'}), 201

@app.route('/api/equipos/<int:id>', methods=['PUT', 'DELETE'])
def update_delete_equipo(id):
    conn = get_db_connection()
    cursor = conn.cursor()
    if request.method == 'PUT':
        data = request.json
        cursor.execute(
            'UPDATE Equipo SET nombre = ?, jugadores = ?, jugadores_manual = ?, faccion_id = ?, tipo = ?, valoracion = ? WHERE id = ?',
            (data['nombre'], data['jugadores'], data.get('jugadores_manual', False), data['faccion_id'], data.get('tipo', ''), data.get('valoracion', ''), id)
        )
        
        # Update members (simple approach: delete all and recreate)
        if 'miembros' in data and isinstance(data['miembros'], list):
            cursor.execute('DELETE FROM Miembro WHERE equipo_id = ?', (id,))
            for m in data['miembros']:
                cursor.execute(
                    'INSERT INTO Miembro (equipo_id, nombre_jugador, rol) VALUES (?, ?, ?)',
                    (id, m.get('nombre_jugador', ''), m.get('rol', ''))
                )
                
        # Update historial
        if 'historial' in data and isinstance(data['historial'], list):
            cursor.execute('DELETE FROM Historial_Equipo WHERE equipo_id = ?', (id,))
            for h in data['historial']:
                cursor.execute(
                    'INSERT INTO Historial_Equipo (equipo_id, operacion, mision_id, grupo_rol) VALUES (?, ?, ?, ?)',
                    (id, h.get('operacion', ''), h.get('mision_id', None), h.get('grupo_rol', ''))
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
        misiones = conn.execute('SELECT * FROM Mision WHERE operacion_id = 1').fetchall()
        conn.close()
        return jsonify([dict(row) for row in misiones])
    
    elif request.method == 'POST':
        data = request.json
        cursor = conn.cursor()
        cursor.execute(
            '''INSERT INTO Mision (operacion_id, nombre, tipo, etiquetas, oficial_responsable, contexto, instrucciones, consideraciones, persistente, revelada) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (1, data['nombre'], data.get('tipo', ''), data.get('etiquetas', ''), data.get('oficial_responsable', ''), data.get('contexto', ''), data.get('instrucciones', ''), data.get('consideraciones', ''), data.get('persistente', False), data.get('revelada', False))
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
               SET nombre = ?, tipo = ?, etiquetas = ?, oficial_responsable = ?, contexto = ?, instrucciones = ?, consideraciones = ?, persistente = ?, revelada = ?
               WHERE id = ?''',
            (data['nombre'], data.get('tipo', ''), data.get('etiquetas', ''), data.get('oficial_responsable', ''), data.get('contexto', ''), data.get('instrucciones', ''), data.get('consideraciones', ''), data.get('persistente', False), data.get('revelada', False), id)
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
               (SELECT COUNT(*) FROM Miembro m WHERE m.equipo_id = Equipo.id AND m.rol LIKE '%Apoyo%') as apoyos,
               (SELECT COUNT(*) FROM Miembro m WHERE m.equipo_id = Equipo.id AND m.rol LIKE '%Sniper%') as snipers
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
    data = request.json
    equipo_id = data['equipo_id']
    grupo_batalla_id = data['grupo_batalla_id']
    operacion_id = 1 # Hardcoded for this demo
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Check if assignment already exists for this operation and team
    existing = cursor.execute('SELECT id FROM Historial_Asignacion WHERE operacion_id = ? AND equipo_id = ?', (operacion_id, equipo_id)).fetchone()
    
    if grupo_batalla_id is None:
        # Remove assignment
        if existing:
            cursor.execute('DELETE FROM Historial_Asignacion WHERE id = ?', (existing['id'],))
    else:
        if existing:
            # Update assignment
            cursor.execute('UPDATE Historial_Asignacion SET grupo_batalla_id = ? WHERE id = ?', (grupo_batalla_id, existing['id']))
        else:
            # Create assignment
            cursor.execute('INSERT INTO Historial_Asignacion (operacion_id, equipo_id, grupo_batalla_id) VALUES (?, ?, ?)', (operacion_id, equipo_id, grupo_batalla_id))
            
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

@app.route('/api/mapa/marcadores', methods=['GET', 'POST'])
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

@app.route('/api/mapa/rutas', methods=['GET', 'POST'])
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

@app.route('/api/mapa/rutas/<int:id>', methods=['DELETE'])
def delete_ruta(id):
    conn = get_db_connection()
    conn.execute('DELETE FROM RutaMapa WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})

@app.route('/api/mapa/zonas', methods=['GET', 'POST'])
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

@app.route('/api/mapa/zonas/<int:id>', methods=['DELETE'])
def delete_zona(id):
    conn = get_db_connection()
    conn.execute('DELETE FROM ZonaMapa WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})

if __name__ == '__main__':
    app.run(debug=True, port=5000)
