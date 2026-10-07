import sqlite3
import random
import math
import json
import os
from datetime import datetime, timedelta
from dynamic_targets_engine import get_grid_coordinate, calculate_distance, CENTER_LAT, CENTER_LNG, MAX_RADIUS_PX, TARGET_MIN_DISTANCE, TARGET_LIFETIME

def get_db_connection():
    conn = sqlite3.connect('data/orbat.db')
    conn.row_factory = sqlite3.Row
    return conn

def load_imint_data():
    with open('data/imint_data.json', 'r', encoding='utf-8') as f:
        return json.load(f)

def resolve_image_path(filtro, contexto, used_images):
    pass # No longer needed

def get_faction_validity(faccion_code):
    if faccion_code == 'vlk': return ['Syldavia', 'Khemed']
    if faccion_code == 'syl': return ['Volkovia', 'Khemed']
    if faccion_code == 'khd': return ['Syldavia', 'Volkovia']
    return [] # civil

def generate_imint_scenario(op_faccion_id=None):
    data = load_imint_data()
    img_dir = os.path.join(os.path.dirname(__file__), 'static', 'imgs', 'dynamic_targets_svg')
    
    if not os.path.exists(img_dir):
        os.makedirs(img_dir, exist_ok=True)
        
    all_files = [f for f in os.listdir(img_dir) if f.endswith(('.jpg', '.png'))]
    
    # Determine valid enemy faction
    enemy_faccion_code = None
    own_faccion_code = None
    if op_faccion_id == 1:
        enemy_faccion_code = 'vlk'
        own_faccion_code = 'syl'
    elif op_faccion_id == 2:
        enemy_faccion_code = 'syl'
        own_faccion_code = 'vlk'
        
    enemy_files = []
    decoy_files = []
    
    # Parse files
    parsed_files = []
    for f in all_files:
        name = os.path.splitext(f)[0]
        parts = name.split('-')
        if len(parts) >= 4:
            faccion = parts[0].lower()
            variante = parts[-1]
            contexto = parts[-2]
            tipo = " ".join(parts[1:-2])
            
            pf = {
                'filename': f,
                'faccion': faccion,
                'tipo': tipo.upper(),
                'contexto': contexto.lower(),
                'variante': variante
            }
            
            parsed_files.append(pf)
            if faccion == enemy_faccion_code:
                enemy_files.append(pf)
            elif faccion == 'civil' or faccion == own_faccion_code:
                decoy_files.append(pf)
                
    if len(parsed_files) < 3 or not enemy_files or len(decoy_files) < 2:
        # Fallback if there are not enough well-formatted images
        return {'titulo': 'DATOS INSUFICIENTES', 'opciones': []}
        
    # Group decoy files by context+variant to ensure distinct backgrounds if possible
    unique_decoy_groups = {}
    for pf in decoy_files:
        bg_key = f"{pf['contexto']}-{pf['variante']}"
        unique_decoy_groups.setdefault(bg_key, []).append(pf)
        
    chosen_files = []
    
    # 1. Pick exactly 1 valid enemy target
    chosen_enemy = random.choice(enemy_files)
    chosen_files.append(chosen_enemy)
    
    # 2. Pick 2 decoy targets with different backgrounds if possible, and different from enemy background
    enemy_bg = f"{chosen_enemy['contexto']}-{chosen_enemy['variante']}"
    available_decoy_bgs = [bg for bg in unique_decoy_groups.keys() if bg != enemy_bg]
    
    if len(available_decoy_bgs) >= 2:
        chosen_bgs = random.sample(available_decoy_bgs, 2)
        chosen_files.append(random.choice(unique_decoy_groups[chosen_bgs[0]]))
        chosen_files.append(random.choice(unique_decoy_groups[chosen_bgs[1]]))
    else:
        # Fallback: just pick any 2 random decoy files
        chosen_files.extend(random.sample(decoy_files, 2))
        
    # Shuffle so the valid target isn't always the first one
    random.shuffle(chosen_files)
        
    opciones = []
    for i, pf in enumerate(chosen_files):
        context_key = pf['contexto']
        if context_key not in data['contextos']:
            context_key = random.choice(list(data['contextos'].keys()))
            
        # Always generate collateral text so the environment is never empty
        genera_colateral = True
            
        if genera_colateral and context_key in data['contextos']:
            entorno_elemento = random.choice(data['contextos'][context_key])
            distancia = random.randint(20, 50)
            rumbo = random.choice(['Norte', 'Sur', 'Este', 'Oeste', 'Noreste', 'Noroeste', 'Sureste', 'Suroeste'])
            entorno_str = f"Entorno: {entorno_elemento} a {distancia}m al {rumbo}."
        else:
            entorno_str = "Entorno: Zona despejada."
            genera_colateral = False # In case it was true but context_key was missing
            
        confianza = "Baja - Posible uso civil" if pf['faccion'] == 'civil' else "Alta - Identificado"
        
        opciones.append({
            'imagen_url': f"/static/imgs/dynamic_targets_svg/{pf['filename']}",
            'es_objetivo_valido_para': get_faction_validity(pf['faccion']),
            'genera_colateral': genera_colateral,
            'informe': {
                'referencia': f"OBJ-{random.randint(100, 999)}-{chr(65+i)}",
                'contacto': f"Contacto visual. Tipo estimado: {pf['tipo']}.",
                'confianza': confianza,
                'entorno_dinamico': entorno_str
            }
        })
        
    return {
        'titulo': "MULTIPLES CONTACTOS",
        'opciones': opciones
    }

def confirm_imint_target(source_op_id, faccion_id, equipo_id, is_fake, genera_colateral, image_url=None, intel_text=None, entorno_text=None):
    conn = get_db_connection()
    try:
        # Generate primary target coords
        enemy_faccion = 2 if faccion_id == 1 else 1
        
        if is_fake:
            pcs = conn.execute("SELECT id FROM puntos_interes WHERE tipo = 'PC' AND faccion_id = ?", (faccion_id,)).fetchall()
        else:
            pcs = conn.execute("SELECT id FROM puntos_interes WHERE tipo = 'PC' AND faccion_id = ?", (enemy_faccion,)).fetchall()
            
        linked_pc_id = random.choice(pcs)['id'] if pcs else None
        if not pcs and not is_fake: 
            is_fake = True
            # No enemy PCs left, fallback to fake but we don't link a penalty PC unless we want to? Let's leave it None.
            
        valid_coords = False
        attempts = 0
        lat, lng = 0, 0
        history = conn.execute("SELECT lat, lng FROM dynamic_targets ORDER BY created_at DESC LIMIT 5").fetchall()
        
        while not valid_coords and attempts < 100:
            attempts += 1
            r = MAX_RADIUS_PX * math.sqrt(random.uniform(0, 1))
            theta = random.uniform(0, 2 * math.pi)
            lat = CENTER_LAT + r * math.sin(theta)
            lng = CENTER_LNG + r * math.cos(theta)
            
            too_close = any(calculate_distance(lat, lng, h['lat'], h['lng']) < TARGET_MIN_DISTANCE for h in history)
            if not too_close: valid_coords = True

        grid_ref, bearing = get_grid_coordinate(lat, lng)
        count = conn.execute("SELECT COUNT(*) FROM dynamic_targets").fetchone()[0]
        target_id = f"TGT-{str(count + 1).zfill(3)}"
        expires_at = (datetime.utcnow() + timedelta(minutes=TARGET_LIFETIME)).strftime('%Y-%m-%d %H:%M:%S')
        
        conn.execute('''
            INSERT INTO dynamic_targets 
            (id, faccion_id, lat, lng, grid_reference, bearing, linked_pc_id, source_op_id, status, is_fake, expires_at, image_url, intel_text, entorno_text)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)
        ''', (target_id, faccion_id, lat, lng, grid_ref, bearing, linked_pc_id, source_op_id, is_fake, expires_at, image_url, intel_text, entorno_text))
        
        if genera_colateral:
            col_theta = random.uniform(0, 2 * math.pi)
            col_r = random.uniform(78, 125) # 50 to 80 meters (multiplied by PIXELS_PER_METER 1.56)
            col_lat = lat + col_r * math.sin(col_theta)
            col_lng = lng + col_r * math.cos(col_theta)
            col_grid, col_bearing = get_grid_coordinate(col_lat, col_lng)
            
            friendly_pcs = conn.execute("SELECT id FROM puntos_interes WHERE tipo = 'PC' AND faccion_id = ?", (faccion_id,)).fetchall()
            col_linked_pc = random.choice(friendly_pcs)['id'] if friendly_pcs else None
            
            col_id = f"{target_id}-COL"
            # Collateral target belongs to opposing faction so it gets hit if enemy hits it?
            # Actually if we shoot it, we lose a PC. The check in dynamic_targets_engine destroys the linked PC regardless of who shot it.
            conn.execute('''
                INSERT INTO dynamic_targets 
                (id, faccion_id, lat, lng, grid_reference, bearing, linked_pc_id, source_op_id, status, is_fake, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 0, ?)
            ''', (col_id, enemy_faccion, col_lat, col_lng, col_grid, col_bearing, col_linked_pc, source_op_id, expires_at))

        if equipo_id:
            conn.execute("UPDATE Equipo SET ultimo_op_usado_id = ? WHERE id = ?", (source_op_id, equipo_id))
            
        conn.commit()
        return conn.execute("SELECT * FROM dynamic_targets WHERE id = ?", (target_id,)).fetchone()
    finally:
        conn.close()

def abort_imint_mission(source_op_id, equipo_id, target_id=None):
    conn = get_db_connection()
    try:
        if equipo_id:
            conn.execute("UPDATE Equipo SET ultimo_op_usado_id = ? WHERE id = ?", (source_op_id, equipo_id))
        
        if target_id:
            conn.execute("UPDATE dynamic_targets SET status = 'EXPIRED' WHERE id = ? OR id = ?", (target_id, f"{target_id}-COL"))
            
        conn.commit()
    finally:
        conn.close()
