import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app, patch_db, get_db_connection

class TestPrismaticosAndAAA(unittest.TestCase):
    def setUp(self):
        patch_db()
        app.config['TESTING'] = True
        self.client = app.test_client()
        with app.app_context():
            conn = get_db_connection()
            conn.execute("INSERT OR IGNORE INTO Faccion (id, nombre, color, prefijo) VALUES (1, 'Syldavia', 'Amarillo', 'Sierra')")
            conn.execute("INSERT OR IGNORE INTO Equipo (id, nombre, jugadores, faccion_id, codigo, password_hash) VALUES (99, 'Bravo Test', 4, 1, 'bravo99', '1234')")
            conn.execute('''
                INSERT OR REPLACE INTO Miembro (id, equipo_id, nombre_jugador, rol, armamento, uid, nombre_apellidos, dni, telefono, email, activo)
                VALUES (901, 99, 'GHOST_TEST', 'Fusilero', 'Fusilero', 'UID-GHOST-901', 'Juan Pérez', '12345678A', '600112233', 'ghost@test.com', 1)
            ''')
            conn.commit()
            conn.close()

    def test_prismaticos_ar_route(self):
        # 1. Sin autenticación redirige a login
        res_unauth = self.client.get('/prismaticos')
        self.assertEqual(res_unauth.status_code, 302)

        # 2. Con login accede correctamente
        with self.client.session_transaction() as sess:
            sess['role'] = 'player'
            sess['faction'] = 'Syldavia'
            sess['equipo_id'] = 1

        res = self.client.get('/prismaticos')
        self.assertEqual(res.status_code, 200)
        html = res.get_data(as_text=True)

        self.assertIn('Prismáticos Tácticos AR', html)
        self.assertIn('camera-video', html)
        self.assertIn('hud-canvas', html)
        self.assertIn('compass-tape-strip', html)
        self.assertIn('requestFullscreenMode', html)
        self.assertIn('toggleFullscreen', html)
        self.assertIn('hud-icon-btn', html)
        self.assertIn('distPx < 50', html)

        # AAA y Ámbar no deben estar presentes en el visor de prismáticos
        self.assertNotIn('BATERÍA AAA', html)
        self.assertNotIn('mode-amber', html)
        self.assertNotIn('amber', html)

    def test_simulador_aaa_pin_protection(self):
        # 1. Sin autenticación redirige a login
        res_unauth = self.client.get('/simulador_aaa')
        self.assertEqual(res_unauth.status_code, 302)

        # 2. Con login pero sin PIN desbloqueado redirige a /simulacion
        with self.client.session_transaction() as sess:
            sess['role'] = 'player'
            sess['faction'] = 'Volkovia'
            sess['equipo_id'] = 2

        res_locked = self.client.get('/simulador_aaa')
        self.assertEqual(res_locked.status_code, 302)
        self.assertIn('/simulacion', res_locked.headers.get('Location', ''))

        # 3. Con PIN desbloqueado en la sesión accede con éxito (200)
        with self.client.session_transaction() as sess:
            sess['role'] = 'player'
            sess['faction'] = 'Volkovia'
            sess['equipo_id'] = 2
            sess['unlocked_minigames'] = ['simulador_aaa']

        res_unlocked = self.client.get('/simulador_aaa')
        self.assertEqual(res_unlocked.status_code, 200)
        html = res_unlocked.get_data(as_text=True)

        self.assertIn('Simulador AAA // Batería SAM', html)
        self.assertIn('missile-canvas', html)
        self.assertIn('DISPARAR: FOX-1', html)
        self.assertIn('SQ-4021', html)
        self.assertIn('TABLA INTEL IFF', html)

    def test_operador_portal_has_prismaticos(self):
        with self.client.session_transaction() as sess:
            sess['role'] = 'player'
            sess['faction'] = 'Syldavia'
            sess['equipo_id'] = 99
            sess['miembro_id'] = 901

        # Probar ruta /portal y alias /perfil
        for route in ['/portal', '/perfil']:
            res = self.client.get(route)
            self.assertEqual(res.status_code, 200)
            html = res.get_data(as_text=True)
            self.assertIn('/prismaticos', html)
            self.assertIn('PRISMÁTICOS TÁCTICOS AR', html)
            self.assertIn('AR OPTICS', html)

    def test_simulacion_menu_contains_cards_and_pin_check(self):
        with self.client.session_transaction() as sess:
            sess['role'] = 'player'
            sess['faction'] = 'Syldavia'
            sess['equipo_id'] = 1

        res = self.client.get('/simulacion')
        self.assertEqual(res.status_code, 200)
        html = res.get_data(as_text=True)

        self.assertIn('Prismáticos Tácticos AR', html)
        self.assertIn('/prismaticos', html)
        self.assertIn('Defensa Antiaérea (AAA)', html)
        self.assertIn('simulador_aaa', html)

if __name__ == '__main__':
    unittest.main()
