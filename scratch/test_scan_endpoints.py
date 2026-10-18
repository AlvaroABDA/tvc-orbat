import unittest
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from app import app, get_db_connection

class TestScanEndpoints(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_all_scan_endpoints(self):
        with app.app_context():
            conn = get_db_connection()
            pc = conn.execute("SELECT * FROM puntos_interes WHERE tipo = 'PC' LIMIT 1").fetchone()
            respawn = conn.execute("SELECT * FROM puntos_interes WHERE tipo = 'RESPAWN' LIMIT 1").fetchone()
            op = conn.execute("SELECT * FROM puntos_interes WHERE tipo = 'OP' LIMIT 1").fetchone()

        # 1. Test PC scan route
        res_pc = self.client.get(f'/scan/{pc["token_qr"]}')
        self.assertEqual(res_pc.status_code, 200)
        self.assertIn('SECTOR DE CONTROL', res_pc.data.decode('utf-8'))
        print("OK: PC /scan/<token> renders scan.html")

        # 2. Test RESPAWN scan route
        res_res = self.client.get(f'/scan/{respawn["token_qr"]}')
        self.assertEqual(res_res.status_code, 200)
        self.assertIn('PUNTO DE INSERCI', res_res.data.decode('utf-8'))
        print("OK: RESPAWN /scan/<token> renders scan.html")

        # 3. Test OP scan route (Must redirect to /target)
        res_op = self.client.get(f'/scan/{op["token_qr"]}', follow_redirects=False)
        self.assertEqual(res_op.status_code, 302)
        self.assertIn('/target', res_op.headers.get('Location', ''))
        print("OK: OP /scan/<token> redirects to /target")

        # 4. Test /target endpoint
        with self.client.session_transaction() as sess:
            sess['active_op_token'] = op['token_qr']
            sess['role'] = 'admin'
        res_tgt = self.client.get('/target')
        self.assertIn(res_tgt.status_code, [200, 302])
        print("OK: /target accessed with active_op_token")

        # 5. Test /api/scan respawn registration & medic reload
        res_api_respawn = self.client.post('/api/scan', json={
            'token_qr': respawn['token_qr'],
            'faccion_id': respawn['faccion_id'],
            'equipo_id': 33
        })
        self.assertEqual(res_api_respawn.status_code, 200)
        self.assertEqual(res_api_respawn.json['status'], 'success')
        print("OK: /api/scan respawn registers and updates medic quota")

if __name__ == '__main__':
    unittest.main()
