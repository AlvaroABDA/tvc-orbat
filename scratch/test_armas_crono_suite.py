import unittest
import json
import sqlite3
import os
import sys

# Ensure tvc-orbat root is in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import app

class TestArmasCronoSuite(unittest.TestCase):
    def setUp(self):
        app.app.config['TESTING'] = True
        app.app.config['SECRET_KEY'] = 'testsecret'
        self.client = app.app.test_client()

        with app.app.app_context():
            conn = app.get_db_connection()
            app.ensure_operator_and_ice_tables(conn)

            # Ensure dummy test faction and team
            conn.execute("INSERT OR IGNORE INTO Faccion (id, nombre, color) VALUES (1, 'Syldavia', 'Azul')")
            conn.execute('''
                INSERT OR REPLACE INTO Equipo (id, nombre, faccion_id, codigo, password_hash, estado_sancion, jugadores)
                VALUES (888, 'Vanguard Squad', 1, 'vanguard', 'pass123', 'Autorizado', 1)
            ''')
            # Ensure dummy member
            conn.execute('''
                INSERT OR REPLACE INTO Miembro (id, equipo_id, nombre_jugador, rol, armamento, uid, nombre_apellidos, dni, pin, telefono, email, activo, tiene_dron, tiene_nvg)
                VALUES (8801, 888, 'Shadow88', 'Operador', 'Fusilero', 'UID-8801', 'Carlos Ruiz', '12345678X', '1234', '600112233', 'carlos@test.com', 1, 0, 0)
            ''')
            # Clean up weapons for this member
            conn.execute('DELETE FROM Miembro_Arma WHERE miembro_id = 8801')
            conn.commit()

    def test_01_operador_add_arma_and_security(self):
        """Test that operator can register weapon and CANNOT inject fps or julios."""
        with self.client.session_transaction() as sess:
            sess['role'] = 'operador'
            sess['miembro_id'] = 8801
            sess['equipo_id'] = 888
            sess['faction'] = 'Syldavia'

        # Attempt to inject 400 fps and APROBADO status as an operator
        res = self.client.post('/api/operador/armas', json={
            'modelo': 'Tokyo Marui M4 MWS',
            'tipo': 'Fusil / Asalto',
            'fps': 400.0,
            'julios': 1.8,
            'estado_crono': 'APROBADO',
            'precinto_num': 'FAKE-01'
        })
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data['status'], 'success')
        arma = data['arma']
        self.assertEqual(arma['modelo'], 'Tokyo Marui M4 MWS')
        self.assertEqual(arma['tipo'], 'Fusil / Asalto')
        # Security verification: FPS, Julios, and Precinto must remain null/pending!
        self.assertIsNone(arma['fps'])
        self.assertIsNone(arma['julios'])
        self.assertEqual(arma['estado_crono'], 'PENDIENTE')
        self.assertEqual(arma['precinto_num'], '')

    def test_02_operador_get_and_delete_arma(self):
        """Test operator listing and deleting own weapons."""
        with app.app.app_context():
            conn = app.get_db_connection()
            cur = conn.cursor()
            cur.execute("INSERT INTO Miembro_Arma (miembro_id, modelo, tipo, estado_crono) VALUES (8801, 'Glock 19', 'Secundaria / Pistola', 'PENDIENTE')")
            arma_id = cur.lastrowid
            conn.commit()

        with self.client.session_transaction() as sess:
            sess['role'] = 'operador'
            sess['miembro_id'] = 8801

        # List
        res = self.client.get('/api/operador/armas')
        self.assertEqual(res.status_code, 200)
        armas = res.get_json()
        self.assertTrue(any(a['id'] == arma_id for a in armas))

        # Delete
        del_res = self.client.delete(f'/api/operador/armas/{arma_id}')
        self.assertEqual(del_res.status_code, 200)
        self.assertEqual(del_res.get_json()['status'], 'success')

        # Verify deleted
        with app.app.app_context():
            conn = app.get_db_connection()
            row = conn.execute('SELECT * FROM Miembro_Arma WHERE id = ?', (arma_id,)).fetchone()
            self.assertIsNone(row)

    def test_03_operador_equipamiento_dron_and_nvg(self):
        """Test operator updating drone and nvg capabilities."""
        with self.client.session_transaction() as sess:
            sess['role'] = 'operador'
            sess['miembro_id'] = 8801

        res = self.client.post('/api/operador/equipamiento', json={
            'tiene_dron': True,
            'dron_modelo': 'DJI Mini 3 Pro - 4K',
            'tiene_nvg': True,
            'nvg_categoria': 'Gen 2+',
            'nvg_modelo': 'PVS-14 WP'
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json()['status'], 'success')

        # Query back
        get_res = self.client.get('/api/operador/equipamiento')
        self.assertEqual(get_res.status_code, 200)
        eq_data = get_res.get_json()
        self.assertEqual(eq_data['tiene_dron'], 1)
        self.assertEqual(eq_data['dron_modelo'], 'DJI Mini 3 Pro - 4K')
        self.assertEqual(eq_data['tiene_nvg'], 1)
        self.assertEqual(eq_data['nvg_categoria'], 'Gen 2+')
        self.assertEqual(eq_data['nvg_modelo'], 'PVS-14 WP')

    def test_04_admin_crono_validation(self):
        """Test that Admin can validate FPS, Joules, and seal number."""
        with app.app.app_context():
            conn = app.get_db_connection()
            cur = conn.cursor()
            cur.execute("INSERT INTO Miembro_Arma (miembro_id, modelo, tipo, estado_crono) VALUES (8801, 'VSR-10 Sniper', 'Francotirador (Cerrojo)', 'PENDIENTE')")
            arma_id = cur.lastrowid
            conn.commit()

        # Non-admin attempt should be rejected with 403
        with self.client.session_transaction() as sess:
            sess['role'] = 'operador'
            sess['miembro_id'] = 8801
        forbid_res = self.client.post(f'/api/crono/arma/{arma_id}', json={'fps': 520, 'julios': 2.5, 'estado_crono': 'APROBADO'})
        self.assertEqual(forbid_res.status_code, 403)

        # Admin login
        with self.client.session_transaction() as sess:
            sess['role'] = 'admin'
            sess['usuario'] = 'AdminJudge'

        # Admin validates
        admin_res = self.client.post(f'/api/crono/arma/{arma_id}', json={
            'fps': 525.4,
            'julios': 2.56,
            'peso_bb': '0.30g',
            'estado_crono': 'APROBADO',
            'precinto_num': 'CRONO-998'
        })
        self.assertEqual(admin_res.status_code, 200)
        updated = admin_res.get_json()['arma']
        self.assertEqual(updated['fps'], 525.4)
        self.assertEqual(updated['julios'], 2.56)
        self.assertEqual(updated['peso_bb'], '0.30g')
        self.assertEqual(updated['estado_crono'], 'APROBADO')
        self.assertEqual(updated['precinto_num'], 'CRONO-998')

    def test_05_carnet_and_portal_views(self):
        """Verify that carnet and operator portal render properly with weapons and special equipment."""
        with app.app.app_context():
            conn = app.get_db_connection()
            conn.execute('''
                UPDATE Miembro 
                SET tiene_dron = 1, dron_modelo = 'DJI Air 2S', tiene_nvg = 1, nvg_categoria = 'Gen 3'
                WHERE id = 8801
            ''')
            conn.execute('''
                INSERT INTO Miembro_Arma (miembro_id, modelo, tipo, fps, julios, estado_crono, precinto_num)
                VALUES (8801, 'HK416 A5', 'Fusil / Asalto', 329.5, 1.01, 'APROBADO', 'A-88')
            ''')
            conn.commit()

        # View Carnet
        res_carnet = self.client.get('/carnet/8801')
        self.assertEqual(res_carnet.status_code, 200)
        html_carnet = res_carnet.get_data(as_text=True)
        self.assertIn('CONTROL CRONO & EQUIPAMIENTO', html_carnet)
        self.assertIn('HK416 A5', html_carnet)
        self.assertIn('329.5 FPS', html_carnet)
        self.assertIn('NVG: Gen 3', html_carnet)

        # View Portal Operador
        with self.client.session_transaction() as sess:
            sess['role'] = 'operador'
            sess['miembro_id'] = 8801
            sess['equipo_id'] = 888
            sess['faction'] = 'Syldavia'

        res_portal = self.client.get('/operador')
        self.assertEqual(res_portal.status_code, 200)
        html_portal = res_portal.get_data(as_text=True)
        self.assertIn('MI ARMAMENTO & CRONO', html_portal)
        self.assertIn('EQUIPAMIENTO ESPECIAL // DRON & NVG', html_portal)
        self.assertIn('HK416 A5', html_portal)
        self.assertIn('329.5 FPS', html_portal)

if __name__ == '__main__':
    unittest.main()
