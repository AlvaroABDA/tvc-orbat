import unittest
import os
import sys
import json
import sqlite3

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import app, get_db_connection

class TestOperadorIceSuite(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app.config['TESTING'] = True
        app.config['SECRET_KEY'] = 'test-secret-key-123'
        cls.client = app.test_client()

    def setUp(self):
        # Asegurar un miembro de prueba
        with app.app_context():
            conn = get_db_connection()
            # Verificar o crear faccion y equipo
            conn.execute("INSERT OR IGNORE INTO Faccion (id, nombre, color, prefijo) VALUES (1, 'Syldavia', 'Amarillo', 'Sierra')")
            conn.execute("INSERT OR IGNORE INTO Equipo (id, nombre, jugadores, faccion_id, codigo, password_hash) VALUES (99, 'Bravo Test', 4, 1, 'bravo99', '1234')")
            
            # Miembro Operador Estándar
            conn.execute('''
                INSERT OR REPLACE INTO Miembro (id, equipo_id, nombre_jugador, rol, armamento, uid, nombre_apellidos, dni, telefono, email, activo)
                VALUES (901, 99, 'GHOST_TEST', 'Fusilero', 'Fusilero', 'UID-GHOST-901', 'Juan Pérez', '12345678A', '600112233', 'ghost@test.com', 1)
            ''')
            
            # Miembro Médico Designado
            conn.execute('''
                INSERT OR REPLACE INTO Miembro (id, equipo_id, nombre_jugador, rol, armamento, uid, nombre_apellidos, dni, telefono, email, activo)
                VALUES (902, 99, 'DOC_TEST', 'Sanitario de Campo', 'Fusilero', 'UID-DOC-902', 'Dra. Elena Ruiz', '87654321B', '600445566', 'doc@test.com', 1)
            ''')
            conn.commit()

    def test_01_operador_login_with_nick_and_dni_pin(self):
        # Nick: GHOST_TEST (probamos con minúsculas), DNI: 12345678A -> PIN: 1234
        res = self.client.post('/login', data={'usuario': 'ghost_test', 'password': '1234'}, follow_redirects=False)
        self.assertEqual(res.status_code, 302)
        self.assertIn('/operador', res.headers.get('Location', ''))

        # Verificamos sesión
        with self.client.session_transaction() as sess:
            self.assertEqual(sess.get('role'), 'operador')
            self.assertEqual(sess.get('miembro_id'), 901)
            self.assertEqual(sess.get('miembro_nick'), 'GHOST_TEST')
            self.assertFalse(sess.get('is_medic'))

    def test_02_operador_login_wrong_pin(self):
        res = self.client.post('/login', data={'usuario': 'ghost_test', 'password': '9999'}, follow_redirects=True)
        self.assertIn(b'ACCESO DENEGADO', res.data)

    def test_03_operador_portal_view(self):
        # Login como operador
        self.client.post('/login', data={'usuario': 'ghost_test', 'password': '1234'})
        res = self.client.get('/operador')
        self.assertEqual(res.status_code, 200)
        self.assertIn(b'PORTAL OPERADOR', res.data)
        self.assertIn(b'GHOST_TEST', res.data)
        self.assertIn(b'MI CARNET', res.data)
        self.assertIn(b'MAPA', res.data)

    def test_04_ice_data_create_and_query(self):
        # Login como operador
        self.client.post('/login', data={'usuario': 'ghost_test', 'password': '1234'})
        
        # Guardar ficha médica ICE (Punto B)
        payload = {
            'grupo_sanguineo': 'O+',
            'alergias': 'Penicilina, AINEs',
            'condiciones_medicas': 'Ninguna',
            'medicacion_actual': 'Ninguna',
            'contacto_nombre': 'María Pérez',
            'contacto_telefono': '611998877',
            'contacto_parentesco': 'Hermana',
            'observaciones': 'Lentes de contacto'
        }
        res_post = self.client.post('/api/operador/ice', json=payload)
        self.assertEqual(res_post.status_code, 200)
        self.assertEqual(res_post.json.get('status'), 'success')

        # Consultar ICE propio
        res_get = self.client.get('/api/operador/ice')
        self.assertEqual(res_get.status_code, 200)
        data = res_get.json
        self.assertEqual(data.get('grupo_sanguineo'), 'O+')
        self.assertEqual(data.get('contacto_telefono'), '611998877')
        self.assertIn('Penicilina', data.get('alergias', ''))

        # TL consulta ICE de su miembro
        with self.client.session_transaction() as sess:
            sess.clear()
            sess['role'] = 'equipo'
            sess['equipo_id'] = 99
            sess['faction'] = 'Syldavia'

        res_tl = self.client.get('/api/miembros/901/ice')
        self.assertEqual(res_tl.status_code, 200)
        self.assertEqual(res_tl.json.get('grupo_sanguineo'), 'O+')

    def test_05_carnet_shows_ice(self):
        res = self.client.get('/carnet/901')
        self.assertEqual(res.status_code, 200)
        self.assertIn(b'I.C.E. EMERGENCIA REAL', res.data)
        self.assertIn(b'O+', res.data)
        self.assertIn(b'611998877', res.data)

    def test_06_ready_check_lifecycle(self):
        # 1. TL inicia Ready Check (Punto C)
        with self.client.session_transaction() as sess:
            sess.clear()
            sess['role'] = 'equipo'
            sess['equipo_id'] = 99
            sess['faction'] = 'Syldavia'

        res_start = self.client.post('/api/ready_check/start', json={'equipo_id': 99, 'titulo': 'Inserción Asalto Alfa'})
        self.assertEqual(res_start.status_code, 200)
        self.assertEqual(res_start.json.get('status'), 'success')

        # 2. Operador verifica Ready Check activo
        with self.client.session_transaction() as sess:
            sess.clear()
            sess['role'] = 'operador'
            sess['miembro_id'] = 901
            sess['equipo_id'] = 99
            sess['faction'] = 'Syldavia'

        res_active = self.client.get('/api/ready_check/active')
        self.assertEqual(res_active.status_code, 200)
        self.assertTrue(res_active.json.get('active'))
        self.assertEqual(res_active.json.get('titulo'), 'Inserción Asalto Alfa')
        self.assertEqual(res_active.json.get('mi_estado'), 'PENDIENTE')

        # 3. Operador responde LISTO
        res_resp = self.client.post('/api/ready_check/respond', json={'estado': 'LISTO', 'nota': ''})
        self.assertEqual(res_resp.status_code, 200)
        self.assertEqual(res_resp.json.get('estado'), 'LISTO')

        # 4. TL consulta el estado de la escuadra
        with self.client.session_transaction() as sess:
            sess.clear()
            sess['role'] = 'equipo'
            sess['equipo_id'] = 99
            sess['faction'] = 'Syldavia'

        res_status = self.client.get('/api/ready_check/status?equipo_id=99')
        self.assertEqual(res_status.status_code, 200)
        miembros_rc = res_status.json.get('miembros', [])
        ghost_rc = next((m for m in miembros_rc if m['miembro_id'] == 901), None)
        self.assertIsNotNone(ghost_rc)
        self.assertEqual(ghost_rc['estado'], 'LISTO')

        # 5. TL finaliza el Ready Check
        res_stop = self.client.post('/api/ready_check/stop', json={'equipo_id': 99})
        self.assertEqual(res_stop.status_code, 200)

        res_status2 = self.client.get('/api/ready_check/status?equipo_id=99')
        self.assertFalse(res_status2.json.get('active'))

    def test_07_medico_designado_access(self):
        # Login de DOC_TEST (DNI: 87654321B -> PIN: 8765)
        res = self.client.post('/login', data={'usuario': 'doc_test', 'password': '8765'}, follow_redirects=False)
        self.assertEqual(res.status_code, 302)

        with self.client.session_transaction() as sess:
            self.assertEqual(sess.get('role'), 'operador')
            self.assertEqual(sess.get('miembro_id'), 902)
            self.assertTrue(sess.get('is_medic'))

        # Acceso directo a /medic (Punto E) sin clave de TL requerida
        res_medic = self.client.get('/medic')
        self.assertEqual(res_medic.status_code, 200)
        self.assertIn(b'Field Medic', res_medic.data)

    def test_08_operador_mapa_read_only(self):
        # Login de GHOST_TEST
        self.client.post('/login', data={'usuario': 'ghost_test', 'password': '1234'})
        res_map = self.client.get('/operador/mapa')
        self.assertEqual(res_map.status_code, 200)
        self.assertIn(b'MAPA T\xc3\x81CTICO DE CAMPO', res_map.data)

        # Intento de crear marcador (debe denegarse para operadores)
        res_marker = self.client.post('/api/mapa/marcadores', json={'faccion_id': 1, 'lat': 1000, 'lng': 1000, 'tipo': 'TEST', 'descripcion': 'Fail'})
        self.assertEqual(res_marker.status_code, 403)

    def test_09_operador_perfil_update(self):
        # Login de GHOST_TEST
        self.client.post('/login', data={'usuario': 'ghost_test', 'password': '1234'})
        res = self.client.post('/api/operador/perfil', json={
            'nombre_apellidos': 'Juan Pérez Ramos',
            'dni': '12349999Z',
            'telefono': '655443322',
            'email': 'juan.nuevo@test.com',
            'armamento': 'Tirador'
        })
        self.assertEqual(res.status_code, 200)

        # Comprobar en DB
        with app.app_context():
            conn = get_db_connection()
            row = conn.execute('SELECT nombre_apellidos, dni, armamento FROM Miembro WHERE id = 901').fetchone()
        self.assertEqual(row['nombre_apellidos'], 'Juan Pérez Ramos')
        self.assertEqual(row['dni'], '12349999Z')
        self.assertEqual(row['armamento'], 'Tirador')

if __name__ == '__main__':
    unittest.main()
