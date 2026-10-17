import unittest
import os
import sys
import re
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import app, get_db_connection

class TestMapAndPinSuite(unittest.TestCase):
    def setUp(self):
        self.app = app
        self.app.config['TESTING'] = True
        self.app.config['SECRET_KEY'] = 'test_secret'
        self.client = self.app.test_client()

        with self.app.app_context():
            conn = get_db_connection()
            cur = conn.cursor()

            # Ensure facciones 1 and 2 exist
            cur.execute("INSERT OR IGNORE INTO Faccion (id, nombre, color) VALUES (1, 'Syldavia', 'Amarillo')")
            cur.execute("INSERT OR IGNORE INTO Faccion (id, nombre, color) VALUES (2, 'Volkovia', 'Azul')")

            # Equipos for faccion 1 and 2
            cur.execute("INSERT OR REPLACE INTO Equipo (id, nombre, jugadores, faccion_id, password_hash) VALUES (8881, 'Equipo Alpha', 5, 1, 'pass8881')")
            cur.execute("INSERT OR REPLACE INTO Equipo (id, nombre, jugadores, faccion_id, password_hash) VALUES (8882, 'Equipo Beta', 5, 2, 'pass8882')")

            # Operador for faccion 1
            cur.execute('''
                INSERT OR REPLACE INTO Miembro (id, uid, nombre_jugador, nombre_apellidos, dni, pin, equipo_id, activo, rol)
                VALUES (7771, 'UID-7771', 'Ghost', 'Simon Riley', '12345678X', NULL, 8881, 1, 'Fusilero')
            ''')

            # Insert rutas and zonas for both factions
            cur.execute("DELETE FROM RutaMapa WHERE faccion_id IN (1, 2)")
            cur.execute("DELETE FROM ZonaMapa WHERE faccion_id IN (1, 2)")
            cur.execute("DELETE FROM MarcadorMapa WHERE faccion_id IN (1, 2)")

            cur.execute("INSERT INTO RutaMapa (id, faccion_id, nombre, puntos_json, color) VALUES (9001, 1, 'Ruta Syl 1', '[{\"lat\":100,\"lng\":100},{\"lat\":150,\"lng\":150}]', '#f1c40f')")
            cur.execute("INSERT INTO RutaMapa (id, faccion_id, nombre, puntos_json, color) VALUES (9002, 2, 'Ruta Volk 2', '[{\"lat\":200,\"lng\":200},{\"lat\":250,\"lng\":250}]', '#00d2ff')")

            cur.execute("INSERT INTO ZonaMapa (id, faccion_id, nombre, puntos_json, color) VALUES (9101, 1, 'Zona Syl 1', '[{\"lat\":100,\"lng\":100},{\"lat\":150,\"lng\":100},{\"lat\":150,\"lng\":150}]', '#f1c40f')")
            cur.execute("INSERT INTO ZonaMapa (id, faccion_id, nombre, puntos_json, color) VALUES (9102, 2, 'Zona Volk 2', '[{\"lat\":200,\"lng\":200},{\"lat\":250,\"lng\":200},{\"lat\":250,\"lng\":250}]', '#00d2ff')")

            cur.execute("INSERT INTO MarcadorMapa (id, faccion_id, tipo, lat, lng, descripcion, autor_nombre) VALUES (9201, 1, 'intel', 1200, 1400, 'Intel Syl', 'Mando')")
            cur.execute("INSERT INTO MarcadorMapa (id, faccion_id, tipo, lat, lng, descripcion, autor_nombre) VALUES (9202, 2, 'intel', 1600, 1800, 'Intel Volk', 'Mando 2')")

            conn.commit()

    def tearDown(self):
        with self.app.app_context():
            conn = get_db_connection()
            conn.execute("DELETE FROM Miembro WHERE id = 7771")
            conn.execute("DELETE FROM Equipo WHERE id IN (8881, 8882)")
            conn.execute("DELETE FROM RutaMapa WHERE id IN (9001, 9002)")
            conn.execute("DELETE FROM ZonaMapa WHERE id IN (9101, 9102)")
            conn.execute("DELETE FROM MarcadorMapa WHERE id IN (9201, 9202)")
            conn.commit()

    def login_operator(self, password='1234'):
        return self.client.post('/login', data={'usuario': 'Ghost', 'password': password}, follow_redirects=True)

    def test_pin_change_and_login_flow(self):
        # 1. Login with default DNI first 4 digits
        res = self.login_operator('1234')
        self.assertEqual(res.status_code, 200)

        # 2. Check profile GET returns pin as None or empty
        res = self.client.get('/api/operador/perfil')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIsNone(data.get('pin'))

        # 3. Try invalid PIN (non-digit or length != 4)
        res = self.client.post('/api/operador/perfil', json={
            'nombre_apellidos': 'Simon Riley',
            'dni': '12345678X',
            'pin': 'abc',
            'telefono': '',
            'email': '',
            'armamento': ''
        })
        self.assertEqual(res.status_code, 400)

        # 4. Set valid custom 4-digit PIN: '9876'
        res = self.client.post('/api/operador/perfil', json={
            'nombre_apellidos': 'Simon Riley',
            'dni': '12345678X',
            'pin': '9876',
            'telefono': '654321987',
            'email': 'ghost@tvc.com',
            'armamento': 'M4A1'
        })
        self.assertEqual(res.status_code, 200)

        # 5. Logout
        self.client.get('/logout')

        # 6. Login with old DNI pin ('1234') should fail now that custom PIN is set
        res = self.login_operator('1234')
        self.assertIn('ACCESO DENEGADO'.encode('utf-8'), res.data)

        # 7. Login with new custom PIN ('9876') succeeds!
        res = self.login_operator('9876')
        self.assertEqual(res.status_code, 200)

        # 8. Clear PIN to revert to DNI
        res = self.client.post('/api/operador/perfil', json={
            'nombre_apellidos': 'Simon Riley',
            'dni': '12345678X',
            'pin': '',
            'telefono': '',
            'email': '',
            'armamento': ''
        })
        self.assertEqual(res.status_code, 200)

        # 9. Logout and test login with DNI again
        self.client.get('/logout')
        res = self.login_operator('1234')
        self.assertEqual(res.status_code, 200)

    def test_strict_faction_isolation_for_operator(self):
        # Login operator of Faction 1
        self.login_operator('1234')

        # Request routes
        res_r = self.client.get('/api/mapa/rutas')
        self.assertEqual(res_r.status_code, 200)
        rutas = res_r.get_json()
        # Must only see Faction 1
        self.assertTrue(all(r['faccion_id'] == 1 for r in rutas))
        self.assertTrue(any(r['id'] == 9001 for r in rutas))
        self.assertFalse(any(r['id'] == 9002 for r in rutas))

        # Request zones
        res_z = self.client.get('/api/mapa/zonas')
        self.assertEqual(res_z.status_code, 200)
        zonas = res_z.get_json()
        self.assertTrue(all(z['faccion_id'] == 1 for z in zonas))
        self.assertTrue(any(z['id'] == 9101 for z in zonas))
        self.assertFalse(any(z['id'] == 9102 for z in zonas))

        # Request markers
        res_m = self.client.get('/api/mapa/marcadores')
        self.assertEqual(res_m.status_code, 200)
        marcadores = res_m.get_json()
        self.assertTrue(all(m['faccion_id'] == 1 for m in marcadores))
        self.assertTrue(any(m['id'] == 9201 for m in marcadores))
        self.assertFalse(any(m['id'] == 9202 for m in marcadores))

        # Even if passing enemy faction_id=2 in query, non-admin is forced to own faction
        res_forced = self.client.get('/api/mapa/rutas?faccion_id=2')
        rutas_forced = res_forced.get_json()
        self.assertTrue(all(r['faccion_id'] == 1 for r in rutas_forced))

        # Operator cannot POST routes or zones
        post_r = self.client.post('/api/mapa/rutas', json={'faccion_id': 1, 'nombre': 'Hack', 'puntos_json': '[]'})
        self.assertEqual(post_r.status_code, 403)

    def test_frontend_map_files_contain_features(self):
        # 1. map.js contains showClickPing and clearMeasurement
        map_js = open('static/js/map.js', encoding='utf-8').read()
        self.assertIn('showClickPing', map_js)
        self.assertIn('clearMeasurement', map_js)
        self.assertIn('measure-flag-container', map_js)
        self.assertIn("tipoIcon = 'radar'", map_js)

        # 2. operador_mapa.html contains showClickPing, clearMeasure, and ATAK icons
        operador_mapa = open('templates/operador_mapa.html', encoding='utf-8').read()
        self.assertIn('showClickPing', operador_mapa)
        self.assertIn('clearMeasure', operador_mapa)
        self.assertIn('updatePOIs', operador_mapa)
        self.assertIn('GPSMapper', operador_mapa)
        self.assertIn('tactical-click-ping', operador_mapa)
        self.assertIn('fetch(`/api/mapa/rutas?faccion_id=${FACCION_ID}`)', operador_mapa)

        # 3. main.js contains showClickPing for morteroMap and visorMap
        main_js = open('static/js/main.js', encoding='utf-8').read()
        self.assertIn('showClickPing(morteroMap', main_js)
        self.assertIn('showClickPing(visorMap', main_js)

if __name__ == '__main__':
    unittest.main()
