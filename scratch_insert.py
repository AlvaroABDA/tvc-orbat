import sqlite3
import json
import os

data = {
    'GAR Airsoft Galicia': [('HULKY', 'Sniper'), ('VASILY', 'Fusilero'), ('HACHE', 'Apoyo'), ('TENGU', 'Sanitario'), ('YISUS', 'Mando'), ('MISTERS', 'Fusilero'), ('TOXO', 'Fusilero')],
    'Pus Army': [('Pitufo', 'Fusilero'), ('Michael', 'Tirador'), ('Óscar', 'Sniper'), ('Villy', 'Fusilero'), ('Sergio', 'Mando')],
    'Red91': [('Sr. Alpha', 'Fusilero'), ('Costel', 'Sanitario'), ('Mihail', 'Sniper'), ('Sr. Aldo', 'Apoyo'), ('Sr. Bacterio', 'Fusilero'), ('Sr. Rojo', 'Fusilero'), ('Srta. Fara', 'Fusilero'), ('Sr. Karra', 'Fusilero'), ('Sr. Sarp', 'Sanitario'), ('Sr Lotero', 'Tirador'), ('Sr Taxi', 'Fusilero'), ('Mariam', 'Fusilero'), ('Teniente ONeil', 'Fusilero'), ('Sr. Hechicero', 'Tirador'), ('Sr. Pamela', 'Tirador'), ('Sr. Sad', 'Fusilero'), ('Sr Trebol', 'Fusilero')],
    'Ronin Vigo': [('Corvo', 'Fusilero'), ('Lobo', 'Sniper'), ('GSR', 'Tirador'), ('Dario', 'Apoyo'), ('Cuervo', 'Sanitario'), ('Fox', 'Fusilero'), ('Vidovic', 'Fusilero'), ('Malki', 'Mando'), ('Kowalski', 'Fusilero'), ('Su', 'Fusilero')],
    'SCA': [('Barny', 'Mando'), ('Castro', 'Tirador'), ('Aceña', 'Fusilero')],
    'Sector 49': [('Zero', 'Fusilero'), ('Wikyrin', 'Fusilero'), ('Huesy', 'Fusilero'), ('Martinez', 'Mando'), ('Jorge', 'Fusilero'), ('Metal', 'Fusilero'), ('Saurio', 'Fusilero'), ('Oterino', 'Fusilero'), ('Hop', 'Fusilero'), ('Polino', 'Fusilero')],
    'Clan Cerbero': [('Dolfo', 'Fusilero'), ('Beto', 'Fusilero'), ('Vilches', 'Fusilero'), ('Mr. Pool', 'Fusilero'), ('Stumbrick', 'Fusilero'), ('Oberon', 'Fusilero'), ('Arik', 'Fusilero'), ('Teno', 'Fusilero'), ('Chuy', 'Apoyo'), ('Campo', 'Fusilero'), ('Guismo', 'Fusilero'), ('Spetsnaz', 'Fusilero'), ('URO', 'Fusilero'), ('Tengu', 'Fusilero')],
    'Leones del Norte': [('Sulaco', 'Mando'), ('Monty', 'Fusilero'), ('Meroveo', 'Fusilero'), ('Cabo Hicks', 'Fusilero'), ('Zero', 'Fusilero')],
    'Metal Militia': [('Crazy', 'Fusilero'), ('Petras', 'Mando')],
    'UAK': [('Bender', 'Fusilero'), ('Caronte', 'Fusilero')],
    'Black sheep operators': [('ALEXIN', 'Fusilero'), ('HARRY', 'Sniper'), ('BEAR', 'Mando'), ('ELOYS', 'Fusilero'), ('RIVI', 'Fusilero'), ('RAVEN', 'Fusilero')],
    'Black vikings': [('Doky', 'Fusilero'), ('Komarca', 'Fusilero'), ('Chavez', 'Sanitario'), ('Boris', 'Fusilero'), ('Guify', 'Fusilero'), ('Biko', 'Fusilero'), ('Jabalí', 'Sniper'), ('Eddy', 'Fusilero'), ('Goyo', 'Fusilero'), ('Gero', 'Mando'), ('Motta', 'Fusilero'), ('Pokki', 'Tirador'), ('Viper', 'Fusilero')],
    'Cia Easy 101': [('ICE', 'Apoyo'), ('VALKIRIA', 'Fusilero'), ('Dayron', 'Fusilero'), ('WOLF', 'Tirador'), ('KITOS', 'Sniper'), ('Pyro', 'Fusilero'), ('PIPO', 'Fusilero')],
    'La Vikinga': [('LACAYO', 'Fusilero'), ('Moises', 'Fusilero'), ('Vitto', 'Fusilero'), ('Oviwan', 'Fusilero')],
    'Dragones de Belgia': [('Alpharius', 'Fusilero'), ('Valkyria', 'Fusilero'), ('Mec200330', 'Fusilero'), ('Yuzico', 'Fusilero'), ('Corvus', 'Fusilero'), ('Javichu', 'Fusilero'), ('Panch', 'Mando'), ('Niko', 'Fusilero')],
    'FEAR': [('Karpin', 'Fusilero'), ('Berserkir', 'Fusilero'), ('Athal', 'Mando'), ('Lakis', 'Fusilero'), ('Sherpa', 'Apoyo'), ('Pingüino', 'Tirador'), ('Kubi', 'Fusilero'), ('Buck', 'Fusilero'), ('Lesmes', 'Fusilero'), ('Pedrosa', 'Fusilero'), ('Berci', 'Sniper'), ('Karen', 'Fusilero'), ('ManAntt', 'Fusilero'), ('Panda', 'Fusilero'), ('Niko', 'Sniper'), ('Brohker', 'Sniper'), ('Enano', 'Apoyo'), ('Wolf', 'Fusilero')],
    'Tercios': [('Mr. Plow', 'Fusilero'), ('Tanke', 'Fusilero'), ('Miul', 'Fusilero')],
    'SRB-H44': [('Pater', 'Fusilero'), ('Chispas', 'Apoyo'), ('Ramsy', 'Mando'), ('Hightower', 'Fusilero'), ('Crazy', 'Fusilero')],
    'Task Force Cerberus': [('Mkvenner', 'Fusilero'), ('Delvira', 'Fusilero'), ('Guille', 'Tirador'), ('Vi', 'Fusilero'), ('Iñaki', 'Fusilero'), ('Iago', 'Tirador')]
}

DB_PATH = os.path.join('data', 'orbat.db')
conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

# Clear existing Miembro
cursor.execute('DELETE FROM Miembro')

for team, members in data.items():
    res = cursor.execute('SELECT id FROM Equipo WHERE nombre LIKE ?', (f'%{team}%',)).fetchone()
    if res:
        team_id = res[0]
        # Update team count
        cursor.execute('UPDATE Equipo SET jugadores = ? WHERE id = ?', (len(members), team_id))
        for name, role in members:
            # Map 'Selecto' to 'Tirador' since frontend has 'Tirador' or 'Especialista'
            # Team Leader -> Mando
            cursor.execute('INSERT INTO Miembro (equipo_id, nombre_jugador, rol) VALUES (?, ?, ?)', (team_id, name, role))
    else:
        print(f'Equipo not found: {team}')

conn.commit()
conn.close()
print('Jugadores insertados')
