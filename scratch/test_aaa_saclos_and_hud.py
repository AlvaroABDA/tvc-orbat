import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app, patch_db

class TestAAASaclosAndHUD(unittest.TestCase):
    def setUp(self):
        patch_db()
        app.config['TESTING'] = True
        self.client = app.test_client()

    def test_aaavolk_password_unlock(self):
        """Verifica que la contraseña 'aaavolk' desbloquee el simulador AAA correctamente."""
        with self.client.session_transaction() as sess:
            sess['role'] = 'player'
            sess['faction'] = 'Volkovia'
            sess['equipo_id'] = 2

        # Intento con contraseña errónea
        res_bad = self.client.post('/api/auth_minigame', json={'minigame': 'simulador_aaa', 'password': 'wrong'})
        self.assertEqual(res_bad.status_code, 401)

        # Intento con contraseña oficial 'aaavolk'
        res_ok = self.client.post('/api/auth_minigame', json={'minigame': 'simulador_aaa', 'password': 'aaavolk'})
        self.assertEqual(res_ok.status_code, 200)
        self.assertTrue(res_ok.get_json().get('success'))

        # Acceso tras desbloqueo
        res_view = self.client.get('/simulador_aaa')
        self.assertEqual(res_view.status_code, 200)

    def test_simulador_aaa_hud_and_saclos_guidance(self):
        with self.client.session_transaction() as sess:
            sess['role'] = 'admin'
            sess['faction'] = 'All'
            sess['unlocked_minigames'] = ['simulador_aaa']

        res = self.client.get('/simulador_aaa')
        self.assertEqual(res.status_code, 200)
        html = res.get_data(as_text=True)

        # 1. Cinta de Azimut / Rumbo Digital tipo prismáticos
        self.assertIn('compass-tape-container', html)
        self.assertIn('compass-tape-track', html)
        self.assertIn('telemetry-az', html)
        self.assertIn('telemetry-el', html)

        # 2. Pantalla Completa
        self.assertIn('btn-fullscreen-toggle', html)
        self.assertIn('toggleFullscreen()', html)

        # 3. Orientación y elevación matemática corregida en 3D
        self.assertIn('calculateCompassHeading', html)
        self.assertIn('c.elevation < 32', html)
        self.assertIn('hud-side-elevation', html)

        # 4. Controles táctiles y giroscópicos estables
        self.assertIn('setupDragControls', html)
        self.assertIn('btn-auto-center', html)

        # 5. Visión IR Térmica y HUD en negro
        self.assertIn('ir-mode', html)
        self.assertIn('btn-ir-toggle', html)
        self.assertIn('toggleIRMode()', html)

        # 6. Flechas perimétricas de detección
        self.assertIn('edge-indicators-layer', html)
        self.assertIn('edge-indicator', html)

        # 7. Botón de fuego con estilo táctico HUD CSS
        self.assertIn('fire-btn-badge', html)
        self.assertIn('btn-launch-missile', html)

        # 8. Mecánica SACLOS: Círculo de guiado óptico
        self.assertIn('GUIDANCE_RADIUS', html)
        self.assertIn('insideGuidanceCircle', html)
        self.assertIn('seeker-outer-ring guiding', html)
        self.assertIn('HAZ SACLOS CONECTADO', html)
        self.assertIn('¡HAZ PERDIDO!', html)

if __name__ == '__main__':
    unittest.main()
