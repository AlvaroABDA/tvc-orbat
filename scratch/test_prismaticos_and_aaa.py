import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app, patch_db

class TestPrismaticosAndAAA(unittest.TestCase):
    def setUp(self):
        patch_db()
        app.config['TESTING'] = True
        self.client = app.test_client()

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
        self.assertIn('DEMO LOCAL (300m)', html)
        self.assertIn('BATERÍA AAA', html)

    def test_simulador_aaa_route(self):
        # 1. Sin autenticación redirige a login
        res_unauth = self.client.get('/simulador_aaa')
        self.assertEqual(res_unauth.status_code, 302)

        # 2. Con login accede correctamente
        with self.client.session_transaction() as sess:
            sess['role'] = 'player'
            sess['faction'] = 'Volkovia'
            sess['equipo_id'] = 2

        res = self.client.get('/simulador_aaa')
        self.assertEqual(res.status_code, 200)
        html = res.get_data(as_text=True)

        self.assertIn('Simulador AAA // Batería SAM', html)
        self.assertIn('missile-canvas', html)
        self.assertIn('DISPARAR: FOX-1', html)
        self.assertIn('SQ-4021', html)
        self.assertIn('SQ-6612', html)
        self.assertIn('TABLA INTEL IFF', html)

    def test_simulacion_menu_contains_cards(self):
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
        self.assertIn('/simulador_aaa', html)

if __name__ == '__main__':
    unittest.main()
