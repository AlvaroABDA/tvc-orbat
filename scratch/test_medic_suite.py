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
        with self.client.session_transaction() as sess:
            sess.clear()

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
        self.assertIn('tvc-medic-v', sw_text)

        # 5. Root PWA endpoints
        sw_root = self.client.get('/sw_medic.js')
        self.assertEqual(sw_root.status_code, 200)
        self.assertEqual(sw_root.headers.get('Service-Worker-Allowed'), '/')
        manifest_root = self.client.get('/manifest_medic.json')
        self.assertEqual(manifest_root.status_code, 200)

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

    def test_17_simulacion_menu_cards_and_instructions(self):
        with self.client.session_transaction() as sess:
            sess['role'] = 'player'
            sess['faction'] = 'Syldavia'
            sess['unlocked_minigames'] = ['telemetro_recon']

        res = self.client.get('/simulacion')
        self.assertEqual(res.status_code, 200)
        html = res.data.decode('utf-8')

        # 1. Verification of the 3 cards
        self.assertIn('Telémetro Recon', html)
        self.assertIn('Artillería / Mortero', html)
        self.assertIn('Field Medic PWA', html)

        # 2. Verification of inline instruction drawers on the cards (seen from outside)
        self.assertIn('card-instructions-panel', html)
        self.assertIn('card-drawer-recon', html)
        self.assertIn('card-drawer-mortero', html)
        self.assertIn('card-drawer-medic', html)
        self.assertIn('toggleCardInstructions', html)
        self.assertIn('MANUAL TÁCTICO DE RECON', html)
        self.assertIn('MANUAL DE TIRO DE ARTILLERÍA', html)
        self.assertIn('MANUAL DE PROTOCOLOS SANITARIOS', html)

        # 3. Verification of Field Medic PWA guide and assets
        self.assertIn('MANUAL DE PROTOCOLOS SANITARIOS', html)
        self.assertIn('ENTRAR / INSTALAR (PWA)', html)
        self.assertIn('medic_icon.png', html)

        # 4. Verify index.html does NOT have any medic link in navbar
        index_res = self.client.get('/')
        # Even if redirected to login if unauthed, let's test with admin session
        with self.client.session_transaction() as sess:
            sess['role'] = 'admin'
            sess['faction'] = 'Syldavia'
            sess['user'] = 'admin'
        index_res = self.client.get('/')
        self.assertEqual(index_res.status_code, 200)
        index_html = index_res.data.decode('utf-8')
        # Navbar should have /simulacion but NOT /medic in sidebar
        self.assertIn('/simulacion', index_html)
        self.assertNotIn('href="/medic"', index_html)
        self.assertNotIn("onclick=\"window.location.href='/medic'\"", index_html)

    def test_18_early_notification_no_kits_and_menu_inventory_display(self):
        with self.client.session_transaction() as sess:
            sess['role'] = 'player'
            sess['faction'] = 'Syldavia'
            sess['user'] = 'MEDIC_01'
            sess['sanitario_id'] = 'MEDIC_01'

        # 1. Test Field Medic app interface
        medic_res = self.client.get('/medic')
        self.assertEqual(medic_res.status_code, 200)
        medic_html = medic_res.data.decode('utf-8')

        # Panel de inventario en el menú
        self.assertIn('medic-inventory-panel', medic_html)
        self.assertIn('menu-reanim-val', medic_html)
        self.assertIn('medic-slots-container', medic_html)
        self.assertIn('INVENTARIO DE BOTIQUINES', medic_html)

        # Notificación de consumo en el menú
        self.assertIn('menu-consumption-notice', medic_html)
        self.assertIn('CONSUMO DE BOTIQUÍN REGISTRADO', medic_html)
        self.assertIn('checkAndRenderConsumptionNotice', medic_html)
        self.assertIn('dismissConsumptionNotice', medic_html)

        # Alerta y bloqueo temprano de inicio de tratamiento si no hay kits
        self.assertIn('modal-no-kits', medic_html)
        self.assertIn('alert-no-kits-banner', medic_html)
        self.assertIn('showNoKitsModal', medic_html)
        self.assertIn('ATENCIÓN MÉDICA DENEGADA', medic_html)
        self.assertIn('SIN BOTIQUINES DISPONIBLES', medic_html)

        # Verificación en openQRScanner y startNewEpisodeWithToken de bloqueo temprano
        self.assertIn('currentKits <= 0', medic_html)
        self.assertIn("openQRScanner('PATIENT')", medic_html)
        self.assertIn("openQRScanner('RESPAWN')", medic_html)

        # 2. Test Simulación Menu con tag de botiquines y aviso de consumo
        sim_res = self.client.get('/simulacion')
        self.assertEqual(sim_res.status_code, 200)
        sim_html = sim_res.data.decode('utf-8')
        self.assertIn('sim-menu-kits-tag', sim_html)
        self.assertIn('sim-menu-kits-text', sim_html)
        self.assertIn('sim-menu-consumption-alert', sim_html)
        self.assertIn('BOTIQUINES RESTANTES', sim_html)

    def test_19_tvc_doctrine_units_curas_methodology(self):
        # 1. Reglas doctrinales de médicos permitidos:
        # Hasta 8 miembros -> 1 médico
        self.assertEqual(medic_engine.get_max_medicos_permitidos(1), 1)
        self.assertEqual(medic_engine.get_max_medicos_permitidos(5), 1)
        self.assertEqual(medic_engine.get_max_medicos_permitidos(8), 1)
        # De 9 a 16 miembros -> 2 médicos
        self.assertEqual(medic_engine.get_max_medicos_permitidos(9), 2)
        self.assertEqual(medic_engine.get_max_medicos_permitidos(12), 2)
        self.assertEqual(medic_engine.get_max_medicos_permitidos(16), 2)
        # De 17 o más miembros -> 3 médicos
        self.assertEqual(medic_engine.get_max_medicos_permitidos(17), 3)
        self.assertEqual(medic_engine.get_max_medicos_permitidos(24), 3)
        self.assertEqual(medic_engine.get_max_medicos_permitidos(50), 3)

        # 2. Fórmula de curas por médico: miembros // medicos (a la baja)
        # Escuadra de 14 con 2 médicos -> 7 curas cada uno
        self.assertEqual(medic_engine.calcular_curas_por_medico(14, 2), 7)
        # Escuadra de 14 con 1 médico -> 14 curas
        self.assertEqual(medic_engine.calcular_curas_por_medico(14, 1), 14)
        # Escuadra de 8 con 1 médico -> 8 curas
        self.assertEqual(medic_engine.calcular_curas_por_medico(8, 1), 8)
        # Escuadra de 9 con 2 médicos -> 4 curas (división a la baja: 9 // 2 = 4)
        self.assertEqual(medic_engine.calcular_curas_por_medico(9, 2), 4)
        # Escuadra de 17 con 3 médicos -> 5 curas (17 // 3 = 5)
        self.assertEqual(medic_engine.calcular_curas_por_medico(17, 3), 5)

        # 3. Snapshot de Roster calcula squad_stats y cupo_nominal
        self.conn.execute("CREATE TABLE IF NOT EXISTS Faccion (id INTEGER PRIMARY KEY, nombre TEXT)")
        self.conn.execute("CREATE TABLE IF NOT EXISTS Equipo (id INTEGER PRIMARY KEY, nombre TEXT, faccion_id INTEGER)")
        self.conn.execute("CREATE TABLE IF NOT EXISTS Miembro (id INTEGER PRIMARY KEY, uid TEXT, nombre_jugador TEXT, rol TEXT, equipo_id INTEGER)")
        
        self.conn.execute("INSERT OR REPLACE INTO Faccion (id, nombre) VALUES (1, 'Syldavia')")
        self.conn.execute("INSERT OR REPLACE INTO Equipo (id, nombre, faccion_id) VALUES (10, 'Delta 14', 1)")
        # 14 miembros: 2 médicos y 12 fusileros
        for i in range(1, 13):
            self.conn.execute("INSERT OR REPLACE INTO Miembro (id, uid, nombre_jugador, rol, equipo_id) VALUES (?, ?, ?, ?, ?)",
                              (100 + i, f"SYL-FUS-{i}", f"Fusilero {i}", "Fusilero", 10))
        self.conn.execute("INSERT OR REPLACE INTO Miembro (id, uid, nombre_jugador, rol, equipo_id) VALUES (201, 'MED-SYL-A', 'Doc Uno', 'Medico de Combate', 10)")
        self.conn.execute("INSERT OR REPLACE INTO Miembro (id, uid, nombre_jugador, rol, equipo_id) VALUES (202, 'MED-SYL-B', 'Doc Dos', 'Sanitario', 10)")
        self.conn.commit()

        snapshot = medic_engine.get_medic_roster_snapshot(self.conn)
        self.assertIn("squad_stats", snapshot)
        self.assertIn("doctrina", snapshot)
        self.assertIn("10", snapshot["squad_stats"])
        s_stat = snapshot["squad_stats"]["10"]
        self.assertEqual(s_stat["miembros_count"], 14)
        self.assertEqual(s_stat["medicos_count"], 2)
        self.assertEqual(s_stat["max_medicos_permitidos"], 2)
        self.assertEqual(s_stat["excede_limite"], False)
        self.assertEqual(s_stat["curas_por_medico"], 7)

        # Verificar cupo nominal asignado a cada médico de la escuadra
        med_a = snapshot["roster"]["MED-SYL-A"]
        self.assertEqual(med_a["cupo_nominal"], 7)

        # 4. Bloqueo al jefe de unidad al intentar exceder el límite doctrinal de médicos
        # Escuadra de 6 miembros con 2 médicos (el límite para <= 8 miembros es 1 médico)
        payload_abuso = {
            'nombre': 'Escuadra Abuso Medicos',
            'jugadores': '6 / 6',
            'faccion_id': 1,
            'miembros': [
                {'nombre_jugador': 'Líder', 'rol': 'Jefe de equipo'},
                {'nombre_jugador': 'Fusilero 1', 'rol': 'Fusilero'},
                {'nombre_jugador': 'Fusilero 2', 'rol': 'Fusilero'},
                {'nombre_jugador': 'Fusilero 3', 'rol': 'Fusilero'},
                {'nombre_jugador': 'Médico 1', 'rol': 'Medico'},
                {'nombre_jugador': 'Médico 2', 'rol': 'Medico'}
            ]
        }
        with self.client.session_transaction() as sess:
            sess['role'] = 'equipo'
            sess['equipo_id'] = 9999
        res_bloqueo = self.client.post('/api/equipos',
                                       data=json.dumps(payload_abuso),
                                       content_type='application/json')
        self.assertEqual(res_bloqueo.status_code, 400)
        self.assertIn("Doctrina TVC", res_bloqueo.get_json()['error'])

        # 5. Dirección (admin) puede asignar cualquier cantidad de curas libremente
        with self.client.session_transaction() as sess:
            sess['role'] = 'admin'
        res_admin_update = self.client.post('/api/admin/medicos/update',
                                            data=json.dumps({'sanitario_id': 'MED-SYL-A', 'reanimaciones': 25}),
                                            content_type='application/json')
        self.assertEqual(res_admin_update.status_code, 200)
        self.assertEqual(res_admin_update.get_json()['reanimaciones'], 25)

    def test_20_terminal_binding_and_strict_direction_authorization(self):
        # 1. Endpoint /api/medic/admin_unlock
        # PIN incorrecto -> 403
        bad_unlock = self.client.post('/api/medic/admin_unlock', 
                                      data=json.dumps({'pin': '1234'}),
                                      content_type='application/json')
        self.assertEqual(bad_unlock.status_code, 403)
        self.assertEqual(bad_unlock.get_json()['status'], 'error')

        # PIN correcto de Dirección (4747) -> 200
        ok_unlock = self.client.post('/api/medic/admin_unlock', 
                                     data=json.dumps({'pin': '4747'}),
                                     content_type='application/json')
        self.assertEqual(ok_unlock.status_code, 200)
        self.assertTrue(ok_unlock.get_json()['success'])

        # Sesión de rol admin activa sin PIN -> 200
        with self.client.session_transaction() as sess:
            sess['role'] = 'admin'
        admin_unlock = self.client.post('/api/medic/admin_unlock',
                                        data=json.dumps({}),
                                        content_type='application/json')
        self.assertEqual(admin_unlock.status_code, 200)
        self.assertTrue(admin_unlock.get_json()['success'])

        # 2. Verificaciones en la plantilla medic_app.html
        res = self.client.get('/medic')
        self.assertEqual(res.status_code, 200)
        html = res.data.decode('utf-8')

        # Pantalla de vinculación inicial obligatoria
        self.assertIn('view-terminal-binding', html)
        self.assertIn('CHECK-IN TÁCTICO', html)
        self.assertIn('VINCULACIÓN DE TERMINAL', html)
        self.assertIn('AUTORIZACIÓN DE DIRECCIÓN', html)
        self.assertIn('header-bound-badge', html)

        # Modal de desbloqueo exclusivo de Dirección
        self.assertIn('modal-admin-unlock', html)
        self.assertIn('DESVINCULACIÓN RESTRINGIDA', html)
        self.assertIn('input-admin-unlock-pin', html)
        self.assertIn('submitAdminUnlock()', html)

        # Validación 1-tap de sellado mediante médico vinculado
        self.assertIn('completeEpisodeWithBoundMedic()', html)

        # Bloqueo estricto de auto-cura en inicio de episodio
        self.assertIn('upperToken === boundUid', html)
        self.assertIn('AUTO-ATENCIÓN DENEGADA', html)

    def test_21_zafarrancho_purges_medical_uses(self):
        # 1. Test unitario directo en self.conn
        payload = {
            "episode_id": "EP-ZAFARRANCHO-TEST",
            "medico_uid": "MED-ZAF-01",
            "medico_nombre": "Dr. Zafarrancho",
            "medico_faccion": "Syldavia",
            "paciente_uid": "PAC-ZAF-99",
            "paciente_nombre": "Herido Zaf",
            "paciente_faccion": "Syldavia",
            "hora_inicio": "2026-10-17T15:00:00Z",
            "hora_cierre": "2026-10-17T15:02:30Z",
            "fase_actual": "completed",
            "hemorragia_controlada": True,
            "estabilizacion_completada": True,
            "resultado_final": "EXITO",
            "duracion_total_segundos": 45.0
        }
        medic_engine.sync_episodio_medico(self.conn, payload)
        medic_engine.update_sanitario_recursos(self.conn, "MED-ZAF-01", 1, 4)
        
        ep_count = self.conn.execute("SELECT COUNT(*) FROM EpisodioMedico").fetchone()[0]
        self.assertGreater(ep_count, 0)
        rec = medic_engine.get_or_create_sanitario_recursos(self.conn, "MED-ZAF-01")
        self.assertEqual(rec['reanimaciones_usadas'], 4)
        
        # Ejecutar reseteo directo en self.conn
        res_unit = medic_engine.reset_all_medic_data(self.conn)
        self.assertEqual(res_unit['status'], 'success')
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM EpisodioMedico").fetchone()[0], 0)
        rec_after_unit = self.conn.execute("SELECT * FROM MedicoRecursos WHERE sanitario_id = 'MED-ZAF-01'").fetchone()
        if rec_after_unit:
            self.assertEqual(rec_after_unit['reanimaciones_usadas'], 0)
            
        # 2. Test integración vía endpoint Flask /api/admin/reset en la base de datos de la app
        with flask_module.app.app_context():
            app_conn = flask_module.get_db_connection()
            medic_engine.sync_episodio_medico(app_conn, payload)
            medic_engine.update_sanitario_recursos(app_conn, "MED-ZAF-01", 1, 4)
            app_conn.commit()
            
        with self.client.session_transaction() as sess:
            sess['role'] = 'admin'
        res_reset = self.client.post('/api/admin/reset')
        self.assertEqual(res_reset.status_code, 200)
        data = res_reset.get_json()
        self.assertEqual(data['status'], 'success')
        self.assertIn('usos médicos purgados', data['message'])
        
        with flask_module.app.app_context():
            app_conn = flask_module.get_db_connection()
            ep_after = app_conn.execute("SELECT COUNT(*) FROM EpisodioMedico").fetchone()[0]
            self.assertEqual(ep_after, 0)
            rec_after = app_conn.execute("SELECT * FROM MedicoRecursos WHERE sanitario_id = 'MED-ZAF-01'").fetchone()
            if rec_after:
                self.assertEqual(rec_after['reanimaciones_usadas'], 0)

    def test_22_medic_respawn_recharge_flow(self):
        """
        Prueba la recarga de botiquines y el registro en la tabla de respawn
        al escanear una baliza QR de base autorizada.
        """
        with flask_module.app.app_context():
            app_conn = flask_module.get_db_connection()
            respawn_syl = app_conn.execute("SELECT * FROM puntos_interes WHERE tipo = 'RESPAWN' AND faccion_id = 1 LIMIT 1").fetchone()
            if not respawn_syl:
                return
            
            med = app_conn.execute('''
                SELECT m.uid, m.nombre_jugador 
                FROM Miembro m 
                JOIN Equipo e ON m.equipo_id = e.id 
                WHERE e.faccion_id = 1 
                LIMIT 1
            ''').fetchone()
            if not med:
                return
                
            res = self.client.post('/api/medic/respawn_recharge', json={
                'token_qr': respawn_syl['token_qr'],
                'sanitario_id': med['uid']
            })
            self.assertEqual(res.status_code, 200)
            data = res.get_json()
            self.assertEqual(data['status'], 'success')
            self.assertGreater(data['reanimaciones_disponibles'], 0)
            
            # Verificar inserción en respawn
            last_r = app_conn.execute("SELECT * FROM respawn ORDER BY id DESC LIMIT 1").fetchone()
            self.assertEqual(last_r['poi_id'], respawn_syl['id'])

if __name__ == '__main__':
    unittest.main()




