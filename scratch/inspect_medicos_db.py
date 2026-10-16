import sqlite3, os

conn = sqlite3.connect(os.path.join('data', 'orbat.db'))
conn.row_factory = sqlite3.Row

print("=== MIEMBROS MEDICOS ===")
rows = conn.execute("SELECT id, uid, nombre_jugador, rol, equipo_id FROM Miembro WHERE LOWER(rol) LIKE '%medico%' OR LOWER(rol) LIKE '%sanitario%'").fetchall()
for r in rows:
    print(dict(r))

print("\n=== TODOS LOS MEDICO RECURSOS ===")
rows = conn.execute("SELECT * FROM MedicoRecursos").fetchall()
for r in rows:
    print(dict(r))

print("\n=== ULTIMOS 5 EPISODIOS ===")
rows = conn.execute("SELECT id, sanitario_id, medico_uid, paciente_uid, resultado_final, duracion_total_segundos, sincronizado_en FROM EpisodioMedico ORDER BY sincronizado_en DESC LIMIT 5").fetchall()
for r in rows:
    print(dict(r))
