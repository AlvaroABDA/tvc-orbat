import sqlite3
import random
import math
from datetime import datetime, timedelta

TARGET_MIN_DISTANCE = 150 # meters
TARGET_HISTORY_SIZE = 5
TARGET_LIFETIME = 60 # minutes
OBSERVATION_POINT_COOLDOWN = 10 # minutes

# Coordenadas centrales y radio máximo (1km)
# 1000m / 50m * 32px = 640px de radio
CENTER_LAT = 1136.5
CENTER_LNG = 1247.0
MAX_RADIUS_PX = 640

def get_grid_coordinate(map_lat, map_lng):
    canvas_y = 2000 - map_lat
    canvas_x = map_lng

    origin_x = 66.15
    origin_y = 59.5
    grid_size_x = 31.71
    grid_size_y = 29.9435

    col_idx = math.floor((canvas_x - origin_x) / grid_size_x) + 1
    row_idx = math.floor((canvas_y - origin_y) / grid_size_y) + 1

    if col_idx < 1 or row_idx < 1 or col_idx > 100 or row_idx > 100:
        return "FUERA MAPA", "CENTER"

    first_letter = chr(65 + math.floor((col_idx - 1) / 26))
    second_letter = chr(65 + ((col_idx - 1) % 26))
    letters = first_letter + second_letter

    numbers = str(row_idx).zfill(2)

    frac_x = ((canvas_x - origin_x) % grid_size_x) / grid_size_x
    frac_y = ((canvas_y - origin_y) % grid_size_y) / grid_size_y

    bearing = "CENTER"
    if frac_y < 0.33:
        bearing = "NORTH"
    elif frac_y > 0.67:
        bearing = "SOUTH"
    
    if frac_x < 0.33:
        if bearing == "CENTER": bearing = "WEST"
        else: bearing += " WEST"
    elif frac_x > 0.67:
        if bearing == "CENTER": bearing = "EAST"
        else: bearing += " EAST"

    grid_ref = f"{letters}-{numbers}"
    return grid_ref, bearing

def calculate_distance(lat1, lng1, lat2, lng2):
    # En nuestro mapa, 1 grid (32 px) = 50m.
    # Así que metros = (px_dist / 32) * 50
    px_dist = math.sqrt(math.pow(lat2 - lat1, 2) + math.pow(lng2 - lng1, 2))
    return (px_dist / 32.0) * 50.0

def get_db_connection():
    conn = sqlite3.connect('data/orbat.db')
    conn.row_factory = sqlite3.Row
    return conn

def expire_old_targets():
    conn = get_db_connection()
    try:
        conn.execute("UPDATE dynamic_targets SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND expires_at < CURRENT_TIMESTAMP")
        conn.commit()
    finally:
        conn.close()

def generate_target(source_op_id, faccion_id):
    expire_old_targets()
    conn = get_db_connection()
    try:
        # 1. Check if OP is in cooldown or has ACTIVE target
        # Check active target
        active_target = conn.execute("SELECT * FROM dynamic_targets WHERE source_op_id = ? AND status = 'ACTIVE'", (source_op_id,)).fetchone()
        if active_target:
            return dict(active_target)

        # Check cooldown
        last_target = conn.execute("SELECT created_at FROM dynamic_targets WHERE source_op_id = ? ORDER BY created_at DESC LIMIT 1", (source_op_id,)).fetchone()
        if last_target:
            created_at = datetime.strptime(last_target['created_at'], '%Y-%m-%d %H:%M:%S')
            if datetime.utcnow() < created_at + timedelta(minutes=OBSERVATION_POINT_COOLDOWN):
                return {"error": "COOLDOWN", "remaining": (created_at + timedelta(minutes=OBSERVATION_POINT_COOLDOWN) - datetime.utcnow()).seconds // 60}

        # 2. Find enemy PCs
        enemy_faccion = 2 if faccion_id == 1 else 1
        pcs = conn.execute("SELECT id FROM puntos_interes WHERE tipo = 'PC' AND faccion_id = ?", (enemy_faccion,)).fetchall()
        
        is_fake = False
        linked_pc_id = None
        
        if len(pcs) > 0:
            linked_pc_id = random.choice(pcs)['id']
        else:
            is_fake = True
            
        # 3. Generate random coordinates
        valid_coords = False
        attempts = 0
        lat = 0
        lng = 0
        
        # Get history for distance checking
        history = conn.execute("SELECT lat, lng FROM dynamic_targets ORDER BY created_at DESC LIMIT ?", (TARGET_HISTORY_SIZE,)).fetchall()
        
        while not valid_coords and attempts < 100:
            attempts += 1
            # Distribución circular uniforme
            r = MAX_RADIUS_PX * math.sqrt(random.uniform(0, 1))
            theta = random.uniform(0, 2 * math.pi)
            lat = CENTER_LAT + r * math.sin(theta)
            lng = CENTER_LNG + r * math.cos(theta)
            
            too_close = False
            for h in history:
                dist = calculate_distance(lat, lng, h['lat'], h['lng'])
                if dist < TARGET_MIN_DISTANCE:
                    too_close = True
                    break
            if not too_close:
                valid_coords = True

        grid_ref, bearing = get_grid_coordinate(lat, lng)
        
        # Generate Target ID
        count = conn.execute("SELECT COUNT(*) FROM dynamic_targets").fetchone()[0]
        target_id = f"TGT-{str(count + 1).zfill(3)}"
        
        expires_at = (datetime.utcnow() + timedelta(minutes=TARGET_LIFETIME)).strftime('%Y-%m-%d %H:%M:%S')
        
        conn.execute('''
            INSERT INTO dynamic_targets 
            (id, faccion_id, lat, lng, grid_reference, bearing, linked_pc_id, source_op_id, status, is_fake, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
        ''', (target_id, faccion_id, lat, lng, grid_ref, bearing, linked_pc_id, source_op_id, is_fake, expires_at))
        conn.commit()
        
        new_target = conn.execute("SELECT * FROM dynamic_targets WHERE id = ?", (target_id,)).fetchone()
        return dict(new_target)
    finally:
        conn.close()

def check_artillery_impact(faccion_id, impact_lat, impact_lng, lethal_radius):
    expire_old_targets()
    conn = get_db_connection()
    try:
        # Find active targets for the OPPOSING faction (if I shoot, I want to destroy enemy targets)
        # Wait, artillery hits coordinates. If a target is there, it's destroyed regardless of who shot?
        # Typically, my faction shoots at targets generated for my faction.
        # But if the enemy shoots their own target by mistake? Let's just check ALL active targets.
        active_targets = conn.execute("SELECT * FROM dynamic_targets WHERE status = 'ACTIVE'").fetchall()
        
        destroyed_targets = []
        for tgt in active_targets:
            dist = calculate_distance(impact_lat, impact_lng, tgt['lat'], tgt['lng'])
            if dist <= lethal_radius:
                # HIT!
                conn.execute("UPDATE dynamic_targets SET status = 'DESTROYED' WHERE id = ?", (tgt['id'],))
                
                # Neutralize PC (applies to both valid targets and fake targets for penalties)
                if tgt['linked_pc_id']:
                    conn.execute("UPDATE puntos_interes SET faccion_id = NULL WHERE id = ?", (tgt['linked_pc_id'],))
                    # Wipe control points table to stop koronnas generation? 
                    # Yes, the points_control table manages this. The logic for that is usually an INSERT.
                    # For now, just setting faccion_id = NULL stops future generation but we must insert the change.
                    conn.execute("INSERT INTO puntos_control (poi_id, faccion_id) VALUES (?, NULL)", (tgt['linked_pc_id'],))
                
                destroyed_targets.append(dict(tgt))
        
        conn.commit()
        return destroyed_targets
    finally:
        conn.close()
