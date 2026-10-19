import unittest
import json
import sqlite3
import os
import sys
import uuid

# Ensure tvc-orbat root is in path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app

class MemberDeletionAndNicksTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app.app.config['TESTING'] = True
        app.app.config['SECRET_KEY'] = 'test-secret-key'
        cls.client = app.app.test_client()
        # Clean up any leftover test data
        with app.app.app_context():
            app.patch_db()
            conn = app.get_db_connection()
            rows = conn.execute("SELECT id FROM Equipo WHERE nombre LIKE 'TEST_%' OR nombre LIKE 'Eq Test%' OR nombre LIKE 'Eq %Shadow%' OR nombre LIKE 'Eq Toggle%' OR nombre LIKE 'Eq Dup%'").fetchall()
            for r in rows:
                conn.execute('DELETE FROM Miembro WHERE equipo_id = ?', (r['id'],))
                conn.execute('DELETE FROM Equipo WHERE id = ?', (r['id'],))
            conn.execute("DELETE FROM Miembro WHERE nombre_jugador LIKE 'TEST_%' OR nombre_jugador LIKE 'TempDel%' OR nombre_jugador LIKE 'GhostOriginal%'")
            conn.commit()

    def setUp(self):
        self.created_equipos = []
        self.created_miembros = []

    def tearDown(self):
        with app.app.app_context():
            conn = app.get_db_connection()
            for mid in self.created_miembros:
                conn.execute('DELETE FROM Miembro WHERE id = ?', (mid,))
            for eid in self.created_equipos:
                conn.execute('DELETE FROM Miembro WHERE equipo_id = ?', (eid,))
                conn.execute('DELETE FROM Equipo WHERE id = ?', (eid,))
            conn.commit()

    def test_01_no_historical_duplicate_nicks(self):
        """Verifica que la migración ha eliminado cualquier nick duplicado histórico"""
        with app.app.app_context():
            conn = app.get_db_connection()
            dups = conn.execute('''
                SELECT LOWER(TRIM(nombre_jugador)) as nick, COUNT(*) as cnt
                FROM Miembro
                WHERE nombre_jugador IS NOT NULL AND TRIM(nombre_jugador) != ''
                GROUP BY LOWER(TRIM(nombre_jugador))
                HAVING cnt > 1
            ''').fetchall()
            self.assertEqual(len(dups), 0, f"Aún existen nicks duplicados en la base de datos: {[dict(d) for d in dups]}")

    def test_02_check_nick_endpoint(self):
        """Verifica el endpoint GET /api/miembros/check_nick"""
        with app.app.app_context():
            conn = app.get_db_connection()
            m = conn.execute('SELECT id, nombre_jugador, equipo_id FROM Miembro WHERE activo = 1 LIMIT 1').fetchone()
            if not m:
                self.skipTest("No hay miembros en la BD para probar")

            existing_nick = m['nombre_jugador']
            m_id = m['id']

            # Test checking existing nick without exclude -> not available
            res = self.client.get(f'/api/miembros/check_nick?nick={existing_nick}')
            self.assertEqual(res.status_code, 200)
            data = res.get_json()
            self.assertFalse(data['available'])

            # Test checking existing nick with its own id excluded -> available
            res = self.client.get(f'/api/miembros/check_nick?nick={existing_nick}&exclude_id={m_id}')
            self.assertEqual(res.status_code, 200)
            data = res.get_json()
            self.assertTrue(data['available'])

            # Test checking completely unique nick -> available
            rand_nick = f"Unique_{uuid.uuid4().hex[:8]}"
            res = self.client.get(f'/api/miembros/check_nick?nick={rand_nick}')
            self.assertEqual(res.status_code, 200)
            data = res.get_json()
            self.assertTrue(data['available'])

    def test_03_non_admin_cannot_delete_miembro_endpoint(self):
        """Un gestor de equipo o usuario no admin recibe 403 al intentar borrar un miembro directamente"""
        with app.app.app_context():
            conn = app.get_db_connection()
            m = conn.execute('SELECT id FROM Miembro LIMIT 1').fetchone()
            if not m:
                self.skipTest("No hay miembros")

        # Test as non-admin
        with self.client.session_transaction() as sess:
            sess['role'] = 'equipo'
            sess['equipo_id'] = 1

        res = self.client.delete(f'/api/miembros/{m["id"]}')
        self.assertEqual(res.status_code, 403)
        data = res.get_json()
        self.assertIn('Solo los administradores', data['error'])

    def test_04_admin_can_delete_miembro_endpoint(self):
        """Un admin puede borrar un miembro por su endpoint DELETE"""
        u_nick = f"TEST_Del_{uuid.uuid4().hex[:6]}"
        with app.app.app_context():
            conn = app.get_db_connection()
            cursor = conn.cursor()
            cursor.execute('INSERT INTO Miembro (equipo_id, nombre_jugador, rol, armamento, uid, activo) VALUES (1, ?, "Operador", "Fusilero", "DEL999", 1)', (u_nick,))
            temp_id = cursor.lastrowid
            conn.commit()

        with self.client.session_transaction() as sess:
            sess['role'] = 'admin'

        res = self.client.delete(f'/api/miembros/{temp_id}')
        self.assertEqual(res.status_code, 200)

        with app.app.app_context():
            conn = app.get_db_connection()
            check = conn.execute('SELECT id FROM Miembro WHERE id = ?', (temp_id,)).fetchone()
            self.assertIsNone(check)

    def test_05_non_admin_put_does_not_delete_missing_members(self):
        """Cuando un gestor de unidad hace PUT sin enviar a un miembro existente, este NO se borra"""
        tag = uuid.uuid4().hex[:6]
        nick1 = f"TEST_Preserved_{tag}"
        nick2 = f"TEST_Kept_{tag}"

        with app.app.app_context():
            conn = app.get_db_connection()
            cursor = conn.cursor()
            cursor.execute('INSERT INTO Equipo (nombre, jugadores, faccion_id, password_hash) VALUES (?, 2, 1, "1234")', (f"TEST_Team_{tag}",))
            eq_id = cursor.lastrowid
            self.created_equipos.append(eq_id)
            cursor.execute('INSERT INTO Miembro (equipo_id, nombre_jugador, rol, uid, activo) VALUES (?, ?, "Operador", "UIDP1", 1)', (eq_id, nick1))
            m1_id = cursor.lastrowid
            cursor.execute('INSERT INTO Miembro (equipo_id, nombre_jugador, rol, uid, activo) VALUES (?, ?, "Operador", "UIDP2", 1)', (eq_id, nick2))
            m2_id = cursor.lastrowid
            conn.commit()

        # Simular sesión de equipo (gestor de unidad)
        with self.client.session_transaction() as sess:
            sess['role'] = 'equipo'
            sess['equipo_id'] = eq_id

        # El payload solo incluye a m2, omitiendo a m1
        payload = {
            'nombre': f"TEST_Team_{tag}",
            'jugadores': '1 / 2',
            'faccion_id': 1,
            'miembros': [
                {'id': m2_id, 'nombre_jugador': nick2, 'rol': 'Operador', 'armamento': 'Fusilero', 'activo': 1}
            ]
        }
        res = self.client.put(f'/api/equipos/{eq_id}', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(res.status_code, 200, f"Error inesperado: {res.get_json()}")

        with app.app.app_context():
            conn = app.get_db_connection()
            preserved = conn.execute('SELECT id, nombre_jugador FROM Miembro WHERE id = ?', (m1_id,)).fetchone()
            # Debe seguir existiendo en la base de datos
            self.assertIsNotNone(preserved, "El miembro omitido por el gestor de unidad no debe ser eliminado de la BD")

    def test_06_non_admin_can_toggle_activo(self):
        """Un gestor de unidad puede activar o desactivar miembros"""
        tag = uuid.uuid4().hex[:6]
        nick = f"TEST_Toggle_{tag}"

        with app.app.app_context():
            conn = app.get_db_connection()
            cursor = conn.cursor()
            cursor.execute('INSERT INTO Equipo (nombre, jugadores, faccion_id, password_hash) VALUES (?, 1, 1, "1234")', (f"TEST_Toggle_{tag}",))
            eq_id = cursor.lastrowid
            self.created_equipos.append(eq_id)
            cursor.execute('INSERT INTO Miembro (equipo_id, nombre_jugador, rol, uid, activo) VALUES (?, ?, "Operador", "UIDTOG", 1)', (eq_id, nick))
            m_id = cursor.lastrowid
            conn.commit()

        with self.client.session_transaction() as sess:
            sess['role'] = 'equipo'
            sess['equipo_id'] = eq_id

        # Desactivar miembro
        payload = {
            'nombre': f"TEST_Toggle_{tag}",
            'jugadores': '0 / 1',
            'faccion_id': 1,
            'miembros': [
                {'id': m_id, 'nombre_jugador': nick, 'rol': 'Operador', 'armamento': 'Fusilero', 'activo': 0}
            ]
        }
        res = self.client.put(f'/api/equipos/{eq_id}', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(res.status_code, 200, f"Error desactivando: {res.get_json()}")

        with app.app.app_context():
            conn = app.get_db_connection()
            m = conn.execute('SELECT activo FROM Miembro WHERE id = ?', (m_id,)).fetchone()
            self.assertEqual(m['activo'], 0, "El miembro debería estar inactivo (0)")

        # Reactivar miembro
        payload['miembros'][0]['activo'] = 1
        res = self.client.put(f'/api/equipos/{eq_id}', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(res.status_code, 200, f"Error activando: {res.get_json()}")

        with app.app.app_context():
            conn = app.get_db_connection()
            m = conn.execute('SELECT activo FROM Miembro WHERE id = ?', (m_id,)).fetchone()
            self.assertEqual(m['activo'], 1, "El miembro debería estar activo (1)")

    def test_07_prevent_duplicate_nicks_on_post_and_put(self):
        """Previene duplicados de nicks en la misma escuadra o entre escuadras diferentes"""
        tag = uuid.uuid4().hex[:6]
        nick_base = f"TEST_Shadow_{tag}"

        with self.client.session_transaction() as sess:
            sess['role'] = 'admin'

        # 1. Duplicado en el mismo payload (misma escuadra)
        payload_dup_internal = {
            'nombre': f"TEST_Dup_Int_{tag}",
            'jugadores': 2,
            'faccion_id': 1,
            'miembros': [
                {'nombre_jugador': nick_base, 'rol': 'Operador', 'armamento': 'Fusilero'},
                {'nombre_jugador': f"  {nick_base.lower()}  ", 'rol': 'Operador', 'armamento': 'Fusilero'}
            ]
        }
        res = self.client.post('/api/equipos', data=json.dumps(payload_dup_internal), content_type='application/json')
        self.assertEqual(res.status_code, 400)
        data = res.get_json()
        self.assertIn('duplicado', data['error'].lower())

        # 2. Crear miembro único en un equipo
        payload_ok = {
            'nombre': f"TEST_Ok_{tag}",
            'jugadores': 1,
            'faccion_id': 1,
            'miembros': [
                {'nombre_jugador': nick_base, 'rol': 'Operador', 'armamento': 'Fusilero'}
            ]
        }
        res = self.client.post('/api/equipos', data=json.dumps(payload_ok), content_type='application/json')
        self.assertEqual(res.status_code, 201, f"Error creando equipo: {res.get_json()}")
        eq1_id = res.get_json()['id']
        self.created_equipos.append(eq1_id)

        # 3. Intentar crear en otro equipo con el mismo nick (con espacios/minúsculas)
        payload_dup_cross = {
            'nombre': f"TEST_Second_{tag}",
            'jugadores': 1,
            'faccion_id': 1,
            'miembros': [
                {'nombre_jugador': f"  {nick_base.upper()}  ", 'rol': 'Operador', 'armamento': 'Fusilero'}
            ]
        }
        res = self.client.post('/api/equipos', data=json.dumps(payload_dup_cross), content_type='application/json')
        self.assertEqual(res.status_code, 400)
        data = res.get_json()
        self.assertIn('ya está en uso', data['error'])

if __name__ == '__main__':
    unittest.main()
