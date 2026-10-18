import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import unittest
from app import app, get_db_connection

class TestRespawnRecharge(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_respawn_recharge_flow(self):
        with app.app_context():
            conn = get_db_connection()
            respawn_syl = conn.execute("SELECT * FROM puntos_interes WHERE tipo = 'RESPAWN' AND faccion_id = 1 LIMIT 1").fetchone()
            respawn_vol = conn.execute("SELECT * FROM puntos_interes WHERE tipo = 'RESPAWN' AND faccion_id = 2 LIMIT 1").fetchone()
            pc_poi = conn.execute("SELECT * FROM puntos_interes WHERE tipo = 'PC' LIMIT 1").fetchone()

            med_syl = conn.execute('''
                SELECT m.uid, m.nombre_jugador, e.faccion_id 
                FROM Miembro m 
                JOIN Equipo e ON m.equipo_id = e.id 
                WHERE e.faccion_id = 1 AND (LOWER(m.rol) LIKE '%medico%' OR LOWER(m.rol) LIKE '%sanitario%') 
                LIMIT 1
            ''').fetchone()
            if not med_syl:
                med_syl = conn.execute("SELECT m.uid, m.nombre_jugador, e.faccion_id FROM Miembro m JOIN Equipo e ON m.equipo_id = e.id WHERE e.faccion_id = 1 LIMIT 1").fetchone()

            token_syl = respawn_syl['token_qr']
            token_vol = respawn_vol['token_qr']
            med_uid = med_syl['uid']

            # 1. Test recarga y respawn exitoso con token directo
            res1 = self.client.post('/api/medic/respawn_recharge', json={
                'token_qr': token_syl,
                'sanitario_id': med_uid
            })
            self.assertEqual(res1.status_code, 200)
            data1 = res1.get_json()
            self.assertEqual(data1['status'], 'success')
            self.assertGreater(data1['reanimaciones_disponibles'], 0)
            print("Test 1 OK:", data1['message'])

            # 2. Verificar que se insertó en tabla respawn
            last_respawn = conn.execute("SELECT * FROM respawn ORDER BY id DESC LIMIT 1").fetchone()
            self.assertEqual(last_respawn['poi_id'], respawn_syl['id'])
            print("Test 2 OK: Respawn inserted into respawn table:", dict(last_respawn))

            # 3. Test con URL completa (/scan/token)
            res2 = self.client.post('/api/medic/respawn_recharge', json={
                'token_qr': f'https://tvc-orbat.com/scan/{token_syl}',
                'sanitario_id': med_uid
            })
            self.assertEqual(res2.status_code, 200)
            print("Test 3 OK: Full URL accepted and processed")

            # 4. Test con PC (rechazado porque no es respawn)
            if pc_poi:
                res3 = self.client.post('/api/medic/respawn_recharge', json={
                    'token_qr': pc_poi['token_qr'],
                    'sanitario_id': med_uid
                })
                self.assertEqual(res3.status_code, 400)
                print("Test 4 OK: PC rejected with 400")

            # 5. Test con token inexistente (404)
            res4 = self.client.post('/api/medic/respawn_recharge', json={
                'token_qr': 'FALSETKN999',
                'sanitario_id': med_uid
            })
            self.assertEqual(res4.status_code, 404)
            print("Test 5 OK: Fake token returns 404")

            # 6. Test con base enemiga (403)
            res5 = self.client.post('/api/medic/respawn_recharge', json={
                'token_qr': token_vol,
                'sanitario_id': med_uid
            })
            self.assertEqual(res5.status_code, 403)
            print("Test 6 OK: Enemy respawn rejected with 403")

if __name__ == '__main__':
    unittest.main()
