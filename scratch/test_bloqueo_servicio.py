import unittest
import json
import sqlite3
import os
import sys

# Ensure tvc-orbat root is in path
tvpath = r'c:\Users\Velha\PycharmProjects\tvc-orbat'
if tvpath not in sys.path:
    sys.path.insert(0, tvpath)

import app as flask_app

class TestBloqueoServicio(unittest.TestCase):
    def setUp(self):
        flask_app.app.config['TESTING'] = True
        self.client = flask_app.app.test_client()

    def test_01_get_and_post_bloqueo(self):
        # 1. Check GET endpoint
        res = self.client.get('/api/seguridad/servicio')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIn('bloqueado', data)
        self.assertIn('fase_inscripcion', data)
        print("Initial config:", data)

        # 2. Try POST as unauthorized (no admin session)
        res_unauth = self.client.post('/api/admin/seguridad/servicio', 
                                      data=json.dumps({'bloqueado': True}),
                                      content_type='application/json')
        self.assertEqual(res_unauth.status_code, 403)

        # 3. POST as admin
        with self.client.session_transaction() as sess:
            sess['role'] = 'admin'
            sess['username'] = 'admin_tester'

        res_admin = self.client.post('/api/admin/seguridad/servicio',
                                     data=json.dumps({
                                         'bloqueado': True,
                                         'motivo': 'Prueba de bloqueo post-evento',
                                         'fase_inscripcion': 'CERRADAS'
                                     }),
                                     content_type='application/json')
        self.assertEqual(res_admin.status_code, 200)
        data_admin = res_admin.get_json()
        self.assertEqual(data_admin['status'], 'success')
        self.assertEqual(data_admin['data']['bloqueado'], 1)
        self.assertEqual(data_admin['data']['fase_inscripcion'], 'CERRADAS')

    def test_02_enforce_service_block_for_tl(self):
        # Fetch an existing equipo
        eqs = self.client.get('/api/equipos').get_json()
        self.assertTrue(len(eqs) > 0)
        target_eq = eqs[0]
        eq_id = target_eq['id']

        # Ensure service is blocked
        with self.client.session_transaction() as sess:
            sess['role'] = 'admin'
            sess['username'] = 'admin'
        self.client.post('/api/admin/seguridad/servicio',
                         data=json.dumps({
                             'bloqueado': True,
                             'motivo': 'Servicio cerrado por prueba automatizada',
                             'fase_inscripcion': 'CERRADAS'
                         }),
                         content_type='application/json')

        # Now simulate a Team Leader of target_eq
        with self.client.session_transaction() as sess:
            sess['role'] = 'equipo'
            sess['equipo_id'] = eq_id
            sess['equipo_nombre'] = target_eq['nombre']

        # Attempt to edit unit
        res = self.client.put(f'/api/equipos/{eq_id}',
                             data=json.dumps({
                                 'nombre': target_eq['nombre'],
                                 'faccion_id': target_eq['faccion_id'],
                                 'jugadores': target_eq.get('jugadores', 5),
                                 'tipo': target_eq.get('tipo', 'GAD'),
                                 'miembros': []
                             }),
                             content_type='application/json')
        self.assertEqual(res.status_code, 403)
        err = res.get_json()
        self.assertIn('error', err)
        self.assertTrue('BLOQUEADO' in err['error'] or 'bloqueado' in err['error'])
        print("TL Blocked successfully with error:", err['error'])

        # Attempt to create new unit
        res_create = self.client.post('/api/equipos',
                                     data=json.dumps({
                                         'nombre': 'Nueva Unidad Prohibida',
                                         'faccion_id': 1,
                                         'jugadores': 5,
                                         'tipo': 'GAD',
                                         'miembros': []
                                     }),
                                     content_type='application/json')
        self.assertEqual(res_create.status_code, 403)

        # 4. Now verify Admin is NOT blocked
        with self.client.session_transaction() as sess:
            sess['role'] = 'admin'
            sess['username'] = 'admin'
        
        # Admin edits unit while blocked
        res_admin_put = self.client.put(f'/api/equipos/{eq_id}',
                                       data=json.dumps(target_eq),
                                       content_type='application/json')
        self.assertEqual(res_admin_put.status_code, 200)
        print("Admin successfully modified unit while service is blocked.")

        # 5. Restore unblocked service
        self.client.post('/api/admin/seguridad/servicio',
                         data=json.dumps({
                             'bloqueado': False,
                             'motivo': '',
                             'fase_inscripcion': 'ABIERTAS'
                         }),
                         content_type='application/json')
        
        # Verify TL can now edit again
        with self.client.session_transaction() as sess:
            sess['role'] = 'equipo'
            sess['equipo_id'] = eq_id
            sess['equipo_nombre'] = target_eq['nombre']

        res_tl_restored = self.client.put(f'/api/equipos/{eq_id}',
                                          data=json.dumps(target_eq),
                                          content_type='application/json')
        self.assertEqual(res_tl_restored.status_code, 200)
        print("TL restored and able to edit when unlocked.")

if __name__ == '__main__':
    unittest.main()
