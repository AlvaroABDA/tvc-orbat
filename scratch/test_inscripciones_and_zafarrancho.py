import unittest
import json
import sqlite3
import os
import sys

tvpath = r'c:\Users\Velha\PycharmProjects\tvc-orbat'
if tvpath not in sys.path:
    sys.path.insert(0, tvpath)

import app as flask_app

class TestInscripcionesAndZafarrancho(unittest.TestCase):
    def setUp(self):
        flask_app.app.config['TESTING'] = True
        self.client = flask_app.app.test_client()
        conn = flask_app.get_db_connection()
        conn.execute("UPDATE seguridad_servicio_config SET fase_inscripcion='ABIERTAS', bloqueado=0 WHERE id=1")
        conn.commit()

    def tearDown(self):
        conn = flask_app.get_db_connection()
        conn.execute("UPDATE seguridad_servicio_config SET fase_inscripcion='ABIERTAS', bloqueado=0 WHERE id=1")
        conn.commit()

    def test_01_tl_view_and_submit_inscription(self):
        # Pick squad 33 (GAR Airsoft Galicia)
        eq_id = 33

        # Clear any prior inscription for 33
        conn = flask_app.get_db_connection()
        conn.execute('DELETE FROM inscripciones_equipo WHERE equipo_id = ?', (eq_id,))
        conn.commit()

        # 1. TL queries mi-estado
        with self.client.session_transaction() as sess:
            sess['role'] = 'equipo'
            sess['equipo_id'] = eq_id
            sess['equipo_nombre'] = 'GAR Airsoft Galicia'

        res_estado = self.client.get(f'/api/inscripciones/mi-estado?equipo_id={eq_id}')
        self.assertEqual(res_estado.status_code, 200)
        d_estado = res_estado.get_json()
        self.assertEqual(d_estado['fase_inscripcion'], 'ABIERTAS')
        self.assertGreater(d_estado['num_activos_actuales'], 0)
        self.assertIsNone(d_estado['inscripcion'])

        # 2. TL submits inscription
        res_env = self.client.post('/api/inscripciones/enviar',
                                  data=json.dumps({
                                      'equipo_id': eq_id,
                                      'notas_tl': 'Solicitud oficial GAR Galicia'
                                  }),
                                  content_type='application/json')
        self.assertEqual(res_env.status_code, 200)
        d_env = res_env.get_json()
        self.assertEqual(d_env['status'], 'success')
        self.assertEqual(d_env['inscripcion']['estado_admision'], 'PENDIENTE')
        self.assertEqual(d_env['inscripcion']['estado_pago'], 'PENDIENTE')

        # 3. Admin lists inscriptions - squad 33 MUST appear
        with self.client.session_transaction() as sess:
            sess['role'] = 'admin'
            sess['username'] = 'admin'

        res_admin = self.client.get('/api/admin/inscripciones')
        self.assertEqual(res_admin.status_code, 200)
        d_admin = res_admin.get_json()
        found = next((i for i in d_admin['inscripciones'] if i['equipo_id'] == eq_id), None)
        self.assertIsNotNone(found, "Squad 33 must appear in admin inscriptions dashboard")
        self.assertEqual(found['equipo_nombre'], 'GAR Airsoft Galicia')
        self.assertEqual(found['estado_admision'], 'PENDIENTE')
        self.assertEqual(found['notas_tl'], 'Solicitud oficial GAR Galicia')
        print("Test 01 OK: TL envio de inscripcion y aparicion inmediata en dashboard de administracion.")

    def test_02_zafarrancho_in_bloqueo_template(self):
        # Verify templates/index.html has seccion-zafarrancho inside tab-bloqueo
        with open(os.path.join(tvpath, 'templates', 'index.html'), encoding='utf-8') as f:
            html = f.read()

        # tab-bloqueo contains seccion-zafarrancho
        self.assertIn('id="seccion-zafarrancho"', html)
        self.assertIn('id="btn-zafarrancho"', html)

        # seccion-zafarrancho appears before tab-inscripciones
        idx_zaf = html.find('id="seccion-zafarrancho"')
        idx_insc = html.find('id="tab-inscripciones"')
        self.assertLess(idx_zaf, idx_insc, "seccion-zafarrancho must be located inside tab-bloqueo, before tab-inscripciones")

        # No standalone duplicate tab-zafarrancho container
        self.assertNotIn('id="tab-zafarrancho" class="admin-tab-content"', html)
        print("Test 02 OK: Zafarrancho correctamente reubicado abajo del todo de bloqueo de servicio.")

if __name__ == '__main__':
    unittest.main()
