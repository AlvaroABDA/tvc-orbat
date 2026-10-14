import unittest
import sqlite3
import os
import sys
import json
import uuid

# Ensure root directory is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import app as flask_module
from field_medic import medic_engine

class TestFieldMedicSuite(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        flask_module.app.config['TESTING'] = True
        flask_module.app.config['WTF_CSRF_ENABLED'] = False
        cls.client = flask_module.app.test_client()

    def setUp(self):
        # Base de datos en memoria para pruebas aisladas
        self.conn = sqlite3.connect(':memory:')
        self.conn.row_factory = sqlite3.Row
        medic_engine.init_medic_db(self.conn)

    def tearDown(self):
        self.conn.close()

    def test_01_init_medic_db_creates_tables(self):
        cursor = self.conn.cursor()
        tables = [r[0] for r in cursor.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
        self.assertIn("MedicoRecursos", tables)
        self.assertIn("EpisodioMedico", tables)

    def test_02_get_or_create_sanitario_recursos(self):
        recursos = medic_engine.get_or_create_sanitario_recursos(self.conn, "MED-TEST-01")
        self.assertEqual(recursos["sanitario_id"], "MED-TEST-01")
        self.assertEqual(recursos["reanimaciones_disponibles"], 3)
        self.assertEqual(recursos["reanimaciones_usadas"], 0)

    def test_03_sync_episodio_success_decrements_reanimation(self):
        episode_uuid = "EP-" + str(uuid.uuid4())
        payload = {
            "episode_id": episode_uuid,
            "sanitario_id": "MED-TEST-01",
            "operador_uid": "SYL-042",
            "operador_nombre": "Kowalski",
            "faccion_nombre": "Syldavia",
            "escenario_id": "HEMORRAGIA_ACTIVA",
            "fase_actual": "completed",
            "hemorragia_controlada": True,
            "estabilizacion_completada": True,
            "resultado_final": "EXITO",
            "duracion_total_segundos": 24.5
        }
        res, status = medic_engine.sync_episodio_medico(self.conn, payload)
        self.assertEqual(status, 200)
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["reanimaciones_disponibles"], 2)
        self.assertFalse(res["already_synced"])

        # Verificar inserción en SQLite
        row = self.conn.execute("SELECT * FROM EpisodioMedico WHERE id = ?", (episode_uuid,)).fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(row["operador_nombre"], "Kowalski")
        self.assertEqual(row["hemorragia_controlada"], 1)
        self.assertEqual(row["estabilizacion_completada"], 1)

    def test_04_idempotency_prevents_duplicate_reanimation_loss(self):
        episode_uuid = "EP-IDEMPOTENT-001"
        payload = {
            "episode_id": episode_uuid,
            "sanitario_id": "MED-IDEM-01",
            "operador_uid": "VOLK-111",
            "operador_nombre": "Dmitri",
            "fase_actual": "completed",
            "hemorragia_controlada": True,
            "estabilizacion_completada": True,
            "resultado_final": "EXITO",
            "duracion_total_segundos": 30.0
        }
        # Primer envío
        res1, status1 = medic_engine.sync_episodio_medico(self.conn, payload)
        self.assertEqual(status1, 200)
        self.assertEqual(res1["reanimaciones_disponibles"], 2)
        self.assertFalse(res1["already_synced"])

        # Reintento con idéntico payload
        res2, status2 = medic_engine.sync_episodio_medico(self.conn, payload)
        self.assertEqual(status2, 200)
        self.assertTrue(res2["already_synced"])
        # No debe descontar otra vez
        self.assertEqual(res2["reanimaciones_disponibles"], 2)

    def test_05_http_endpoint_get_medic(self):
        with self.client.session_transaction() as sess:
            sess['role'] = 'player'
            sess['faction'] = 'Syldavia'
            sess['sanitario_id'] = 'MED-UNIT-TEST'

        res = self.client.get('/medic?token=SYL-999')
        self.assertEqual(res.status_code, 200)
        self.assertIn(b"FIELD MEDIC", res.data)
        self.assertIn(b"SYL-999", res.data)
        self.assertIn(b"hemorrhage-canvas", res.data)
        self.assertIn(b"stabilization-canvas", res.data)

    def test_06_http_endpoint_sync_api(self):
        episode_uuid = "EP-HTTP-" + str(uuid.uuid4())
        payload = {
            "episode_id": episode_uuid,
            "sanitario_id": "MED-HTTP-TEST",
            "operador_uid": "SYL-777",
            "operador_nombre": "Soldado 777",
            "fase_actual": "completed",
            "hemorragia_controlada": True,
            "estabilizacion_completada": True,
            "resultado_final": "EXITO",
            "duracion_total_segundos": 18.0
        }
        res = self.client.post('/api/medico/sync', json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data["status"], "success")

if __name__ == '__main__':
    unittest.main()
