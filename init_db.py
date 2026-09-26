import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'data', 'orbat.db')

def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    
    # Remove existing db to start fresh for Phase 2
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS Faccion (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            color TEXT NOT NULL,
            prefijo TEXT NOT NULL
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS Equipo (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            jugadores INTEGER NOT NULL,
            jugadores_manual BOOLEAN NOT NULL DEFAULT 0,
            faccion_id INTEGER,
            tipo TEXT,
            valoracion TEXT,
            FOREIGN KEY (faccion_id) REFERENCES Faccion (id)
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS Miembro (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            equipo_id INTEGER,
            nombre_jugador TEXT,
            rol TEXT,
            FOREIGN KEY (equipo_id) REFERENCES Equipo (id) ON DELETE CASCADE
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS Historial_Equipo (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            equipo_id INTEGER,
            operacion TEXT,
            mision_id INTEGER,
            grupo_rol TEXT,
            FOREIGN KEY (equipo_id) REFERENCES Equipo (id) ON DELETE CASCADE,
            FOREIGN KEY (mision_id) REFERENCES Mision (id)
        )
    ''')
    
    # Updated Grupo_Batalla table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS Grupo_Batalla (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            faccion_id INTEGER,
            tipo TEXT,
            canal_radio TEXT,
            frecuencia_radio TEXT,
            telefono_contacto TEXT,
            es_mando BOOLEAN,
            mision_actual_id INTEGER,
            nombre_jefe TEXT,
            pos_x REAL,
            pos_y REAL,
            FOREIGN KEY (faccion_id) REFERENCES Faccion (id),
            FOREIGN KEY (mision_actual_id) REFERENCES Mision (id)
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS MarcadorMapa (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            faccion_id INTEGER,
            tipo TEXT,
            lat REAL,
            lng REAL,
            descripcion TEXT,
            FOREIGN KEY (faccion_id) REFERENCES Faccion (id)
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS RutaMapa (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            faccion_id INTEGER,
            nombre TEXT,
            puntos_json TEXT,
            color TEXT,
            FOREIGN KEY (faccion_id) REFERENCES Faccion (id)
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS ZonaMapa (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            faccion_id INTEGER,
            nombre TEXT,
            puntos_json TEXT,
            color TEXT,
            FOREIGN KEY (faccion_id) REFERENCES Faccion (id)
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS Operacion (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            fecha TEXT
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS Mision (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operacion_id INTEGER,
            nombre TEXT NOT NULL,
            tipo TEXT,
            etiquetas TEXT,
            oficial_responsable TEXT,
            contexto TEXT,
            instrucciones TEXT,
            consideraciones TEXT,
            persistente BOOLEAN,
            revelada BOOLEAN DEFAULT 0,
            FOREIGN KEY (operacion_id) REFERENCES Operacion (id)
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS Historial_Asignacion (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operacion_id INTEGER,
            equipo_id INTEGER,
            grupo_batalla_id INTEGER,
            FOREIGN KEY (operacion_id) REFERENCES Operacion (id),
            FOREIGN KEY (equipo_id) REFERENCES Equipo (id),
            FOREIGN KEY (grupo_batalla_id) REFERENCES Grupo_Batalla (id)
        )
    ''')
    
    # --- Seed Data ---
    facciones = [
        ('Syldavia', 'Amarillo', 'Sierra'),
        ('Volkovia', 'Azul', 'Victor'),
        ('Khemed', 'Verde', 'Kilo')
    ]
    cursor.executemany("INSERT INTO Faccion (nombre, color, prefijo) VALUES (?, ?, ?)", facciones)
    
    cursor.execute("INSERT INTO Operacion (nombre, fecha) VALUES ('Operación Tormenta Fase 3', '2026-11-15')")
    
    # Insertar Misiones
    misiones = [
        (1, 'GAD — CONTROL TERRITORIAL Y AVANCE', 'GAD', '[Control] [Avance]', 'MANDO', 
         'La situación en la zona de operaciones exige mantener una presencia permanente sobre las posiciones de interés y ampliar progresivamente el control de nuestras fuerzas.\n\nLas cinco posiciones señaladas en el mapa de operaciones constituyen puntos estratégicos para el desarrollo de la operación. Su control permite asegurar territorio y generar recursos para el sostenimiento de nuestras fuerzas.\n\nSe establecen tres posiciones como prioritarias:\nPC-01: [COORDENADAS]\nPC-02: [COORDENADAS]\nPC-03: [COORDENADAS]\n\nY dos posiciones como secundarias:\nPC-04: [COORDENADAS]\nPC-05: [COORDENADAS]\n\nLa situación podrá cambiar durante la operación. Las unidades deberán estar preparadas para reforzar, recuperar o abandonar posiciones según las necesidades del mando.', 
         'Desplegar y asegurar las posiciones indicadas en el mapa de operaciones.\n- Priorizar inicialmente el control de PC-01, PC-02 y PC-03.\n- Mantener presencia suficiente para garantizar la continuidad del control.\n- Avanzar sobre posiciones adicionales cuando la situación táctica lo permita.\n- Recuperar posiciones perdidas cuando su importancia para la operación lo justifique.\n- Coordinar los movimientos entre unidades para evitar concentraciones innecesarias.\n- Responder a las amenazas que comprometan nuestras posiciones o líneas de avance.\n- Mantener especial atención sobre las posiciones que generen recursos para nuestras fuerzas.', 
         'El control territorial no constituye únicamente un objetivo táctico. Las posiciones bajo nuestro control generan los recursos necesarios para mantener y ampliar nuestras operaciones.\nUna posición controlada durante más tiempo adquiere mayor importancia para el sostenimiento de la fuerza.\nNo es necesario ocupar todo el terreno. La prioridad es controlar el terreno que resulta útil para la operación.\nEl GAD dispone de libertad operativa para decidir rutas, distribución de efectivos, refuerzos y prioridades secundarias, siempre que se mantengan las directrices del mando.', True),
        
        (1, 'ORDNANCE — APOYO DE FUEGO', 'APOYO', '[Artillería] [Fuego]', 'MANDO',
         'Las fuerzas de reconocimiento proporcionarán información sobre objetivos identificados dentro de la zona de operaciones.\nLa capacidad de fuego indirecto constituye un elemento fundamental para alterar la situación sobre el terreno sin necesidad de comprometer fuerzas de maniobra.\nLos objetivos podrán incluir posiciones territoriales, recursos estratégicos, instalaciones y elementos de apoyo enemigos.\nLa localización de determinadas posiciones de fuego enemigas permitirá realizar operaciones de contrartillería.',
         'Recibir y verificar los objetivos proporcionados por SIERRA BRAVO.\n- Ejecutar las misiones de fuego asignadas.\n- Utilizar las coordenadas proporcionadas por reconocimiento para localizar los objetivos.\n- Confirmar el objetivo antes de efectuar el fuego.\n- Registrar el resultado de cada misión.\n- Priorizar los objetivos señalados como prioritarios por reconocimiento o mando.\n- Ejecutar misiones de contrartillería cuando se identifique la posición del mortero enemigo.\n\nLos impactos confirmados sobre determinados objetivos podrán:\n- Neutralizar temporalmente una posición de control.\n- Interrumpir la generación de recursos de una posición.\n- Desactivar temporalmente una pieza de mortero enemiga.\n\nEl mortero deberá ser operado desde zonas despejadas y con visibilidad suficiente, evitando obstáculos que puedan interferir con la trayectoria o impedir el correcto funcionamiento del sistema.',
         'La artillería depende directamente de la calidad de la información proporcionada por reconocimiento.\nUn objetivo no localizado no puede ser batido.\nLas coordenadas serán transmitidas siguiendo el formato:\nAA-00 + punto cardinal de la cuadrícula\nLos objetivos obtenidos mediante los puntos de observación habilitados podrán contener información adicional sobre el efecto previsto del fuego.\nUna misión de contrartillería exitosa sobre el mortero enemigo provocará su inutilización temporal. La duración y condiciones de recuperación serán determinadas por Dirección.\nLa artillería debe evitar revelar innecesariamente su posición.', True),
         
        (1, 'INTELIGENCIA — OPERACIÓN HIDRIA', 'INTELIGENCIA', '[Logística] [Negociación]', 'MANDO',
         'Las recientes inundaciones han afectado gravemente a las redes convencionales de abastecimiento.\nLa disponibilidad de agua constituye actualmente un factor crítico para mantener la capacidad operativa de nuestras fuerzas.\nKhemed dispone de medios propios de purificación, almacenamiento y transporte de agua, pero sus servicios están sujetos a disponibilidad y condiciones de contratación.\nLa capacidad de acceder a estos servicios permitirá mantener la autonomía de nuestras unidades y prolongar nuestras operaciones.',
         'Establecer y mantener comunicación con los representantes de Khemed.\n- Determinar las necesidades de abastecimiento de nuestras fuerzas.\n- Gestionar las solicitudes de suministro.\n- Negociar las condiciones necesarias para obtener el servicio.\n- Coordinar la preparación y seguridad de los movimientos de agua.\n- Mantener comunicación permanente con las unidades implicadas en el suministro.\n- Informar al mando de cualquier cambio en las condiciones del servicio.\n- Coordinar con las unidades de combate la protección de los movimientos logísticos cuando sea necesario.\n\nLa unidad será responsable de mantener una visión global de la situación logística, no únicamente de solicitar agua.',
         'Khemed constituye un actor independiente dentro de la zona de operaciones.\nSus servicios deberán ser negociados.\nLa relación con Khemed puede determinar la disponibilidad de recursos esenciales para nuestras fuerzas.\nLa seguridad de los movimientos logísticos deberá considerarse una prioridad.\nEl agua mantiene a la fuerza en combate.', True),
         
        (1, 'SIERRA BRAVO — RECONOCIMIENTO Y ADQUISICIÓN DE OBJETIVOS', 'RECONOCIMIENTO', '[Recce] [Intel]', 'MANDO',
         'La capacidad de nuestras fuerzas para actuar sobre objetivos situados fuera de la línea de contacto depende de la información obtenida sobre el terreno.\nSIERRA BRAVO proporcionará adquisición de objetivos, reconocimiento avanzado y localización de posiciones enemigas para facilitar las operaciones de fuego y maniobra.\nSe han establecido diversos puntos de observación dentro de la zona de operaciones.\nAlgunos de estos puntos contienen información operacional adicional que podrá ser obtenida mediante los sistemas habilitados.',
         'Reconocer la zona de operaciones.\n- Localizar posiciones, instalaciones y unidades de interés.\n- Transmitir las coordenadas de objetivos válidos a ORDNANCE.\n- Identificar y localizar la posición del mortero enemigo.\n- Facilitar información para operaciones de contrartillería.\n- Verificar los objetivos antes de solicitar una misión de fuego.\n- Explorar los puntos de observación señalados en el mapa.\n- Utilizar los puntos habilitados para obtener objetivos adicionales.\n\nLas coordenadas deberán transmitirse siguiendo el formato:\nAA-00 + punto cardinal de la cuadrícula\n\nLos puntos de observación habilitados mediante QR podrán proporcionar una carta de objetivo con:\n- Coordenadas del objetivo.\n- Tipo de objetivo.\n- Punto de control asociado.\n\nCuando ORDNANCE consiga un impacto válido sobre uno de estos objetivos, el PC asociado quedará neutralizado.\nUn PC neutralizado dejará temporalmente de generar recursos para cualquier fuerza.',
         'La información es un recurso operativo.\nLa misión de SIERRA BRAVO no consiste únicamente en localizar posiciones enemigas, sino en convertir información en oportunidades de acción para el resto de nuestras unidades.\nLos puntos de observación deberán ser utilizados con criterio. El acceso a ellos puede exponer a la unidad a fuerzas enemigas.\nLa localización del mortero enemigo tendrá especial prioridad: una posición de fuego localizada es una posición de fuego que puede ser neutralizada.\nLos objetivos proporcionados por los sistemas de observación deberán considerarse información operacional y comunicarse a ORDNANCE con la mayor rapidez posible.', True)
    ]
    cursor.executemany("INSERT INTO Mision (operacion_id, nombre, tipo, etiquetas, oficial_responsable, contexto, instrucciones, consideraciones, persistente) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", misiones)

    # Insertar Grupos de Batalla (Mando + GOE + GAD)
    grupos = []
    for i, (f_nombre, f_color, f_prefijo) in enumerate(facciones):
        faccion_id = i + 1
        
        # 1. Mando
        grupos.append((f"MANDO {f_prefijo.upper()}", faccion_id, 'MANDO', 'Ch.01', '446.00625 MHz', '', True, None, ''))
        
        # 2. GOE (Alfa, Bravo, Charlie)
        grupos.append((f"{f_prefijo} Alfa", faccion_id, 'GOE', 'Ch.02', '446.01875 MHz', '', False, None, ''))
        grupos.append((f"{f_prefijo} Bravo", faccion_id, 'GOE', 'Ch.03', '446.03125 MHz', '', False, None, ''))
        grupos.append((f"{f_prefijo} Charlie", faccion_id, 'GOE', 'Ch.04', '446.04375 MHz', '', False, None, ''))
        
        # 3. GAD (Delta, Echo)
        grupos.append((f"{f_prefijo} Delta", faccion_id, 'GAD', 'Ch.05', '446.05625 MHz', '', False, None, ''))
        grupos.append((f"{f_prefijo} Echo", faccion_id, 'GAD', 'Ch.06', '446.06875 MHz', '', False, None, ''))
            
    cursor.executemany('''
        INSERT INTO Grupo_Batalla 
        (nombre, faccion_id, tipo, canal_radio, frecuencia_radio, telefono_contacto, es_mando, mision_actual_id, nombre_jefe) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', grupos)

    # Insertar Equipos
    equipos_seed = [
        ('Pus Army', 5, 1, 1, 'GOE'),
        ('Tercios GRT', 10, 1, 1, 'GOE'),
        ('Ronin Vigo', 10, 1, 1, 'GOE'),
        ('SCA', 3, 1, 1, 'GOE'),
        ('Red91', 17, 1, 1, 'GOE'),
        ('Sector 49', 10, 1, 1, 'GOE'),
        ('GAR Airsoft Galicia', 7, 1, 1, 'GOE'),
        
        ('Black vikings', 13, 1, 2, 'GOE'),
        ('Black sheep operators', 6, 1, 2, 'GOE'),
        ('Cia Easy 101', 7, 1, 2, 'GOE'),
        ('Dragones de Belgia', 8, 1, 2, 'GOE'),
        ('Task Force Cerberus', 6, 1, 2, 'GOE'),
        ('SRB-H44', 5, 1, 2, 'GOE'),
        ('La Vikinga', 4, 1, 2, 'GOE'),
        ('Tercios', 3, 1, 2, 'GOE'),
        ('FEAR', 17, 1, 2, 'GOE'),
        
        ('Metal Militia', 2, 1, 3, 'GOE'),
        ('UAK', 2, 1, 3, 'GOE'),
        ('Clan Cerbero', 14, 1, 3, 'GOE'),
        ('Leones del Norte', 5, 1, 3, 'GOE')
    ]
    cursor.executemany("INSERT INTO Equipo (nombre, jugadores, jugadores_manual, faccion_id, tipo, valoracion) VALUES (?, ?, ?, ?, ?, 'C (Estándar)')", equipos_seed)

    # Insertar Miembros de Equipos
    miembros_data = {
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
    
    for team, members in miembros_data.items():
        res = cursor.execute('SELECT id FROM Equipo WHERE nombre LIKE ?', (f'%{team}%',)).fetchone()
        if res:
            team_id = res[0]
            cursor.execute('UPDATE Equipo SET jugadores = ? WHERE id = ?', (len(members), team_id))
            for name, role in members:
                cursor.execute('INSERT INTO Miembro (equipo_id, nombre_jugador, rol) VALUES (?, ?, ?)', (team_id, name, role))    conn.commit()
    conn.close()
    print("Base de datos recreada y poblada con éxito para la Fase 2.")

if __name__ == '__main__':
    init_db()
