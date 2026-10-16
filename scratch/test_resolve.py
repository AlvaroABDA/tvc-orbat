import sqlite3, os

conn = sqlite3.connect(os.path.join('data', 'orbat.db'))
conn.row_factory = sqlite3.Row

def resolve_sanitario(conn, identifier):
    ident = (identifier or '').strip()
    if not ident:
        return 'MED-GENERIC'
    u = ident.upper()
    if u in ('ADMIN', 'MED-ADMIN'):
        return 'ADMIN'
    
    # Try match in Miembro
    m = conn.execute('''
        SELECT m.uid, m.nombre_jugador, e.id as equipo_id
        FROM Miembro m
        JOIN Equipo e ON m.equipo_id = e.id
        WHERE UPPER(m.uid) = ? 
           OR UPPER(m.nombre_jugador) = ? 
           OR UPPER('MED-' || m.nombre_jugador) = ?
           OR UPPER('MED-' || e.id) = ?
    ''', (u, u, u, u)).fetchone()
    
    if m:
        # Use uid if available, else MED-{nombre}
        return m['uid'] if m['uid'] else f"MED-{m['nombre_jugador'].upper()}"
    return u

print('Resolve 009D01C0:', resolve_sanitario(conn, '009D01C0'))
print('Resolve Beto:', resolve_sanitario(conn, 'Beto'))
print('Resolve MED-BETO:', resolve_sanitario(conn, 'MED-BETO'))
print('Resolve admin:', resolve_sanitario(conn, 'admin'))
