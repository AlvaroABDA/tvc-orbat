import unittest
import json
import sqlite3
import os
import sys

tvpath = r'c:\Users\Velha\PycharmProjects\tvc-orbat'
if tvpath not in sys.path:
    sys.path.insert(0, tvpath)

import app as flask_app

class TestInscripcionesFlow(unittest.TestCase):
    def setUp(self):
        flask_app.app.config['TESTING'] = True
        self.client = flask_app.app.test_client()

    def test_01_full_lifecycle(self):
        # 1. Ensure registrations are open (ABIERTAS) and service unlocked
        with self.client.session_transaction() as sess:
            sess['role'] = 'admin'
            sess['username'] = 'admin'
        
        res = self.client.post('/api/admin/seguridad/servicio',
                               data=json.dumps({
                                   'bloqueado': False,
                                   'motivo': '',
                                   'fase_inscripcion': 'ABIERTAS'
                               }),
                               content_type='application/json')
        self.assertEqual(res.status_code, 200)

        # 2. Get an existing team with members
        eqs = self.client.get('/api/equipos').get_json()
        self.assertTrue(len(eqs) > 0)
        target_eq = eqs[0]
        eq_id = target_eq['id']
        eq_name = target_eq['nombre']

        # Ensure target_eq has active members in DB and clean previous test registration
        conn = flask_app.get_db_connection()
        conn.execute('DELETE FROM inscripciones_equipo WHERE equipo_id = ?', (eq_id,))
        conn.commit()
        m_count = conn.execute('SELECT COUNT(*) as c FROM Miembro WHERE equipo_id = ?', (eq_id,)).fetchone()['c']
        if m_count == 0:
            conn.execute('''
                INSERT INTO Miembro (equipo_id, nombre_jugador, rol, armamento, activo)
                VALUES (?, 'Operador-Alpha', 'Operador', 'Fusilero', 1)
            ''', (eq_id,))
            conn.commit()
        conn.close()

        # 3. Simulate Team Leader session
        with self.client.session_transaction() as sess:
            sess['role'] = 'equipo'
            sess['equipo_id'] = eq_id
            sess['equipo_nombre'] = eq_name

        # Check mi-estado before sending
        res_estado_pre = self.client.get('/api/inscripciones/mi-estado')
        self.assertEqual(res_estado_pre.status_code, 200)
        pre_data = res_estado_pre.get_json()
        self.assertEqual(pre_data['fase_inscripcion'], 'ABIERTAS')
        print(f"Pre-enviar estado de {eq_name}:", pre_data.get('num_activos_actuales'), "activos en censo.")

        # 4. Team Leader sends inscription
        res_env = self.client.post('/api/inscripciones/enviar',
                                  data=json.dumps({
                                      'notas_tl': 'Solicitamos confirmación de plaza para 1er turno.'
                                  }),
                                  content_type='application/json')
        self.assertEqual(res_env.status_code, 200)
        env_data = res_env.get_json()
        self.assertEqual(env_data['status'], 'success')
        self.assertEqual(env_data['inscripcion']['estado_admision'], 'PENDIENTE')
        self.assertEqual(env_data['inscripcion']['estado_pago'], 'PENDIENTE')
        insc_id = env_data['inscripcion']['id']
        print("Inscripción enviada con ID:", insc_id)

        # 5. Admin lists inscripciones
        with self.client.session_transaction() as sess:
            sess['role'] = 'admin'
            sess['username'] = 'admin'

        res_admin_list = self.client.get('/api/admin/inscripciones')
        self.assertEqual(res_admin_list.status_code, 200)
        admin_data = res_admin_list.get_json()
        self.assertTrue(admin_data['kpis']['total_inscripciones'] >= 1)
        self.assertTrue(admin_data['kpis']['total_solicitados_pax'] > 0)
        
        found = [i for i in admin_data['inscripciones'] if i['id'] == insc_id]
        self.assertEqual(len(found), 1)
        found_insc = found[0]
        self.assertEqual(found_insc['equipo_id'], eq_id)
        self.assertTrue(len(found_insc['miembros_snapshot']) > 0)
        print("Admin verificó inscripción en lista con snapshot de", len(found_insc['miembros_snapshot']), "combatientes.")

        # 6. Admin approves and marks paid
        res_update = self.client.post(f'/api/admin/inscripciones/{insc_id}/estado',
                                      data=json.dumps({
                                          'estado_admision': 'APROBADA',
                                          'estado_pago': 'PAGADO',
                                          'observaciones': 'Documentación y censo verificados. Plaza asignada.'
                                      }),
                                      content_type='application/json')
        self.assertEqual(res_update.status_code, 200)
        update_data = res_update.get_json()
        self.assertEqual(update_data['inscripcion']['estado_admision'], 'APROBADA')
        self.assertEqual(update_data['inscripcion']['estado_pago'], 'PAGADO')

        # 7. Team Leader checks updated state
        with self.client.session_transaction() as sess:
            sess['role'] = 'equipo'
            sess['equipo_id'] = eq_id

        res_estado_post = self.client.get('/api/inscripciones/mi-estado')
        post_data = res_estado_post.get_json()
        self.assertEqual(post_data['inscripcion']['estado_admision'], 'APROBADA')
        self.assertEqual(post_data['inscripcion']['estado_pago'], 'PAGADO')
        self.assertIn('Plaza asignada', post_data['inscripcion']['observaciones'])
        print("TL verificó estado aprobado y pagado:", post_data['inscripcion']['estado_admision'], post_data['inscripcion']['estado_pago'])

        # 8. Test de oficio registration
        with self.client.session_transaction() as sess:
            sess['role'] = 'admin'
            sess['username'] = 'admin'

        # Pick another team
        other_eq = [e for e in eqs if e['id'] != eq_id][0]
        res_oficio = self.client.post('/api/admin/inscripciones/inscribir_de_oficio',
                                      data=json.dumps({
                                          'equipo_id': other_eq['id'],
                                          'estado_admision': 'APROBADA',
                                          'estado_pago': 'PAGADO'
                                      }),
                                      content_type='application/json')
        self.assertEqual(res_oficio.status_code, 200)
        print(f"Inscrita de oficio escuadra {other_eq['nombre']}:", res_oficio.get_json()['message'])

        # 9. Test closure enforcement
        self.client.post('/api/admin/seguridad/servicio',
                         data=json.dumps({
                             'bloqueado': False,
                             'motivo': '',
                             'fase_inscripcion': 'CERRADAS'
                         }),
                         content_type='application/json')

        # TL attempts to send while closed
        with self.client.session_transaction() as sess:
            sess['role'] = 'equipo'
            sess['equipo_id'] = eq_id

        res_closed = self.client.post('/api/inscripciones/enviar',
                                      data=json.dumps({'notas_tl': 'Intento tardio'}),
                                      content_type='application/json')
        self.assertEqual(res_closed.status_code, 403)
        self.assertIn('CERRADAS', res_closed.get_json()['error'])
        print("Bloqueo de fase CERRADAS verificado correctamente para TL:", res_closed.get_json()['error'])

if __name__ == '__main__':
    unittest.main()
