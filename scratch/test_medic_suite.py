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

    def test_07_medic_config_has_all_9_game_variants(self):
        config = medic_engine.load_medic_config()
        expected_keys = [
            "fase1_hemorragia",
            "fase1_neumotorax",
            "fase1_torniquete",
            "fase1_sutura",
            "fase2_estabilizacion",
            "fase2_constantes_rango",
            "fase2_doble_indicador",
            "fase2_secuencia_visual",
            "fase2_correccion_linea"
        ]
        for k in expected_keys:
            self.assertIn(k, config, f"Missing minigame configuration key: {k}")
            self.assertIsInstance(config[k], dict, f"Minigame config for {k} should be a dictionary")

    def test_08_medic_template_renders_all_canvases_and_scripts(self):
        with self.client.session_transaction() as sess:
            sess['role'] = 'player'
            sess['faction'] = 'Syldavia'
            sess['sanitario_id'] = 'MED-UNIT-TEST'

        res = self.client.get('/medic?token=SYL-999')
        self.assertEqual(res.status_code, 200)
        html = res.data.decode('utf-8')
        
        # Verify canvases
        canvases = [
            'hemorrhage-canvas',
            'pneumothorax-canvas',
            'tourniquet-canvas',
            'suture-canvas',
            'stabilization-canvas',
            'vitals-hold-canvas',
            'dual-vitals-canvas',
            'memory-sequence-canvas',
            'line-correction-canvas',
            'lifeline-canvas-hemorrhage',
            'lifeline-canvas-tourniquet',
            'lifeline-canvas-suture',
            'lifeline-canvas-pneumothorax'
        ]
        for canvas_id in canvases:
            self.assertIn(canvas_id, html, f"Canvas ID {canvas_id} not found in /medic template")

        # Verify scripts
        scripts = [
            'tactical_lifeline.js',
            'tourniquet_game.js',
            'suture_game.js',
            'vitals_hold_game.js',
            'dual_vitals_game.js',
            'memory_sequence_game.js',
            'line_correction_game.js'
        ]
        for script_name in scripts:
            self.assertIn(script_name, html, f"Script {script_name} not linked in /medic template")

    def test_09_static_assets_for_new_minigames_exist(self):
        scripts = [
            '/static/js/field_medic/tactical_lifeline.js',
            '/static/js/field_medic/tourniquet_game.js',
            '/static/js/field_medic/suture_game.js',
            '/static/js/field_medic/vitals_hold_game.js',
            '/static/js/field_medic/dual_vitals_game.js',
            '/static/js/field_medic/memory_sequence_game.js',
            '/static/js/field_medic/line_correction_game.js',
            '/static/sw_medic.js'
        ]
        for script_path in scripts:
            res = self.client.get(script_path)
            self.assertEqual(res.status_code, 200, f"Static asset {script_path} failed with {res.status_code}")

    def test_10_navigation_and_admin_controls_present_and_fast_tourniquet(self):
        config = medic_engine.load_medic_config()
        self.assertLessEqual(config["fase1_torniquete"]["duracion_activacion_ms"], 300)
        self.assertLessEqual(config["fase1_torniquete"]["intervalo_entre_activaciones_ms"], 50)
        self.assertEqual(config["fase1_torniquete"]["aciertos_requeridos"], 6)

        with self.client.session_transaction() as sess:
            sess['role'] = 'admin'
            sess['faction'] = 'Syldavia'
            sess['sanitario_id'] = 'MED-ADMIN-TEST'

        res = self.client.get('/medic')
        self.assertEqual(res.status_code, 200)
        html = res.data.decode('utf-8')
        self.assertIn('header-back-btn', html)
        self.assertIn('abortEpisodeToScan()', html)
        self.assertIn('adminAutoPassPhase()', html)

    def test_11_elongated_mechanics_and_requirements(self):
        config = medic_engine.load_medic_config()
        # +2 requirements on each game
        self.assertEqual(config["fase1_hemorragia"]["aciertos_requeridos"], 6)
        self.assertEqual(config["fase1_hemorragia"]["velocidad_deriva_zona_ms"], 2500)
        self.assertEqual(config["fase1_neumotorax"]["aciertos_requeridos"], 6)
        self.assertEqual(config["fase1_torniquete"]["aciertos_requeridos"], 6)
        self.assertEqual(config["fase1_sutura"]["puntos_requeridos"], 8)
        self.assertEqual(config["fase2_estabilizacion"]["pulsaciones_requeridas"], 10)
        self.assertEqual(config["fase2_constantes_rango"]["aciertos_consecutivos_requeridos"], 7)
        self.assertEqual(config["fase2_doble_indicador"]["aciertos_requeridos_por_barra"], 6)
        self.assertEqual(config["fase2_secuencia_visual"]["rondas_totales"], 5)
        self.assertLessEqual(config["fase2_secuencia_visual"]["longitud_maxima"], 4)
        # Línea de vida: 8 segundos y 16% de tolerancia
        self.assertEqual(config["fase2_correccion_linea"]["segundos_en_rango_requeridos"], 8.0)
        self.assertEqual(config["fase2_correccion_linea"]["margen_tolerancia_pct"], 16.0)

    def test_12_roster_snapshot_endpoint(self):
        res = self.client.get('/api/medic/roster')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIn("roster", data)
        self.assertIn("medicos", data)
        self.assertIn("ADMIN", data["medicos"])
        self.assertIn("ADMIN", data["roster"])
        self.assertTrue(data["roster"]["ADMIN"]["is_medic"])
        self.assertIn("reanimaciones_disponibles", data["roster"]["ADMIN"])

    def test_13_dual_qr_sync_and_discrepancy_detection(self):
        # 1. Successful normal attention (duration >= 25s, same faction, different UIDs)
        ep1 = "EP-NORM-" + str(uuid.uuid4())
        payload_normal = {
            "episode_id": ep1,
            "medico_uid": "MED-SYL-01",
            "medico_nombre": "Dr. House",
            "medico_faccion": "Syldavia",
            "paciente_uid": "SYL-SOLDIER-01",
            "paciente_nombre": "Private Ryan",
            "paciente_faccion": "Syldavia",
            "hora_inicio": "2026-10-16T10:00:00Z",
            "hora_cierre": "2026-10-16T10:00:35Z",
            "escenario_id": "HEMORRAGIA_ACTIVA",
            "fase_actual": "completed",
            "hemorragia_controlada": True,
            "estabilizacion_completada": True,
            "resultado_final": "EXITO",
            "duracion_total_segundos": 35.0
        }
        res1, s1 = medic_engine.sync_episodio_medico(self.conn, payload_normal)
        self.assertEqual(s1, 200)
        self.assertEqual(res1["status"], "success")
        self.assertEqual(len(res1["discrepancias"]), 0)

        # 2. Flag: FAST_DURATION (< 25s)
        ep2 = "EP-FAST-" + str(uuid.uuid4())
        payload_fast = dict(payload_normal, episode_id=ep2, duracion_total_segundos=12.0)
        res2, s2 = medic_engine.sync_episodio_medico(self.conn, payload_fast)
        self.assertEqual(s2, 200)
        self.assertIn("FAST_DURATION", res2["discrepancias"])

        # 3. Flag: SELF_HEAL (paciente_uid == medico_uid)
        ep3 = "EP-SELF-" + str(uuid.uuid4())
        payload_self = dict(payload_normal, episode_id=ep3, paciente_uid="MED-SYL-01")
        res3, s3 = medic_engine.sync_episodio_medico(self.conn, payload_self)
        self.assertEqual(s3, 200)
        self.assertIn("SELF_HEAL", res3["discrepancias"])

        # 4. Flag: CROSS_FACTION (Syldavia treating Volkovia)
        ep4 = "EP-CROSS-" + str(uuid.uuid4())
        payload_cross = dict(payload_normal, episode_id=ep4, paciente_faccion="Volkovia")
        res4, s4 = medic_engine.sync_episodio_medico(self.conn, payload_cross)
        self.assertEqual(s4, 200)
        self.assertIn("CROSS_FACTION", res4["discrepancias"])

    def test_14_admin_audit_log_endpoint(self):
        # Without admin session -> 403
        with self.client.session_transaction() as sess:
            sess['role'] = 'player'
        res_fail = self.client.get('/api/admin/medicos/audit')
        self.assertEqual(res_fail.status_code, 403)

        # With admin session -> 200 and KPI stats
        with self.client.session_transaction() as sess:
            sess['role'] = 'admin'
        res_ok = self.client.get('/api/admin/medicos/audit')
        self.assertEqual(res_ok.status_code, 200)
        data = res_ok.get_json()
        self.assertEqual(data["status"], "success")
        self.assertIn("episodes", data)
        self.assertIn("stats", data)
        self.assertIn("total_intervenciones", data["stats"])
        self.assertIn("alertas_discrepancias_count", data["stats"])

    def test_15_offline_pwa_and_no_manual_input_in_template(self):
        # 1. medic_app.html has no manual input elements
        res = self.client.get('/medic')
        self.assertEqual(res.status_code, 200)
        html = res.data.decode('utf-8')
        self.assertNotIn('input-patient-token', html)
        self.assertNotIn('type="text" id="manual', html)
        self.assertNotIn('manual-token', html)

        # 2. Camera flip and flashlight controls are present
        self.assertIn('toggleCamera()', html)
        self.assertIn('toggleTorch()', html)

        # 3. Medic seal prompt card exists
        self.assertIn('medic-seal-prompt-card', html)
        self.assertIn('openQRScannerForMedicSeal()', html)

        # 4. Service Worker caches offline roster and tactical lifeline
        sw_res = self.client.get('/static/sw_medic.js')
        self.assertEqual(sw_res.status_code, 200)
        sw_text = sw_res.data.decode('utf-8')
        self.assertIn('/api/medic/roster', sw_text)
        self.assertIn('/static/js/field_medic/tactical_lifeline.js', sw_text)
        self.assertIn('tvc-medic-v13', sw_text)

    def test_16_unified_sanitario_alias_and_quota_sync(self):
        # Crear tablas para la base de datos aislada en memoria
        self.conn.execute("CREATE TABLE IF NOT EXISTS Faccion (id INTEGER PRIMARY KEY, nombre TEXT)")
        self.conn.execute("CREATE TABLE IF NOT EXISTS Equipo (id INTEGER PRIMARY KEY, nombre TEXT, faccion_id INTEGER)")
        self.conn.execute("CREATE TABLE IF NOT EXISTS Miembro (id INTEGER PRIMARY KEY, uid TEXT, nombre_jugador TEXT, rol TEXT, equipo_id INTEGER)")
        self.conn.execute("INSERT OR IGNORE INTO Faccion (id, nombre) VALUES (99, 'TestFaction')")
        self.conn.execute("INSERT OR IGNORE INTO Equipo (id, nombre, faccion_id) VALUES (99, 'Alfa Squad', 99)")
        self.conn.execute("INSERT OR REPLACE INTO Miembro (id, uid, nombre_jugador, rol, equipo_id) VALUES (999, 'MEDIC-QR-999', 'Gregory', 'Medico de Combate', 99)")
        self.conn.commit()

        # 1. Verificar resolución canónica
        canonical, aliases = medic_engine.resolve_sanitario_id_and_aliases(self.conn, 'MEDIC-QR-999')
        self.assertEqual(canonical, 'MEDIC-QR-999')
        self.assertIn('MED-GREGORY', aliases)

        # 2. Obtener recursos usando UID físico
        rec = medic_engine.get_or_create_sanitario_recursos(self.conn, 'MEDIC-QR-999')
        self.assertEqual(rec['reanimaciones_disponibles'], 3)
        self.assertEqual(rec['reanimaciones_usadas'], 0)

        # 3. Sincronizar un episodio usando el UID del carnet escaneado
        ep_id = "EP-SYNC-" + str(uuid.uuid4())
        payload = {
            "episode_id": ep_id,
            "medico_uid": "MEDIC-QR-999",
            "paciente_uid": "PATIENT-001",
            "fase_actual": "completed",
            "hemorragia_controlada": True,
            "estabilizacion_completada": True,
            "resultado_final": "EXITO",
            "duracion_total_segundos": 30.0
        }
        res, status = medic_engine.sync_episodio_medico(self.conn, payload)
        self.assertEqual(status, 200)
        self.assertEqual(res["reanimaciones_disponibles"], 2)
        self.assertEqual(res["reanimaciones_usadas"], 1)

        # 4. Verificar que consultando por nombre 'MED-GREGORY' o carnet 'MEDIC-QR-999' refleja disponibles=2, usadas=1
        rec_named = medic_engine.get_or_create_sanitario_recursos(self.conn, 'MED-GREGORY')
        self.assertEqual(rec_named['reanimaciones_disponibles'], 2)
        self.assertEqual(rec_named['reanimaciones_usadas'], 1)

        # 5. Actualizar por nombre táctico 'MED-GREGORY' a 10 y verificar que el QR físico refleja 10
        medic_engine.update_sanitario_recursos(self.conn, 'MED-GREGORY', 10)
        rec_after = medic_engine.get_or_create_sanitario_recursos(self.conn, 'MEDIC-QR-999')
        self.assertEqual(rec_after['reanimaciones_disponibles'], 10)
        self.assertEqual(rec_after['reanimaciones_usadas'], 1)

if __name__ == '__main__':
    unittest.main()


