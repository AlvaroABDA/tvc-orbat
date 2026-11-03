import sys
import os
import unittest
import json
from datetime import datetime

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import app
import op_dinamico_engine
import imint_engine

class TestReconRedesign(unittest.TestCase):
    def setUp(self):
        self.app = app.app
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()
        self.conn = app.get_db_connection()

        # Find or create a test OP
        op = self.conn.execute("SELECT * FROM puntos_interes WHERE tipo = 'OP' LIMIT 1").fetchone()
        self.assertIsNotNone(op, "Debe existir al menos un OP en la base de datos.")
        self.op_id = op['id']
        self.faccion_id = op['faccion_id'] or 1

        # Find or create a test Equipo
        eq = self.conn.execute("SELECT * FROM Equipo LIMIT 1").fetchone()
        self.equipo_id = eq['id'] if eq else 1

    def tearDown(self):
        self.conn.close()

    def test_01_op_session_candidates(self):
        """Verifica que la sesión de OP secundario genera 3 candidatos AR directos."""
        # Limpiar sesiones anteriores de este OP
        self.conn.execute("DELETE FROM op_secundario_sesion WHERE source_op_id = ?", (self.op_id,))
        self.conn.commit()

        ses = op_dinamico_engine.get_or_create_op_secundario(self.op_id, self.faccion_id, self.equipo_id, app.gps_mapper)
        self.assertIn('token_sesion', ses)
        self.assertIn('targets', ses)
        self.assertEqual(len(ses['targets']), 3, "Deben generarse exactamente 3 candidatos AR.")

        for i, c in enumerate(ses['targets']):
            self.assertIn('candidate_id', c)
            self.assertIn('azimut', c)
            self.assertIn('distancia_m', c)
            self.assertIn('imagen_url', c)
            self.assertIn('tipo', c)
            self.assertTrue(0 <= c['azimut'] < 360, f"Azimut de candidato {i} debe estar entre 0 y 360")
            print(f"[TEST 1] Candidato {c['cto_label']}: Azimut={c['azimut']}° Dist={c['distancia_m']}m Tipo={c['tipo']}")

    def test_02_direct_designation_and_current_target(self):
        """Verifica la designación directa sin dwell y el archivo en Current Target."""
        ses = op_dinamico_engine.get_active_session(self.op_id, self.conn)
        self.assertIsNotNone(ses, "Debe existir sesión activa creada en el test anterior.")

        token = ses['token_sesion']
        cands = ses['targets']
        cand_to_select = cands[0]

        # Designar candidato
        tgt = op_dinamico_engine.designate_target_candidate(
            token_sesion=token,
            candidate_id=cand_to_select['candidate_id'],
            equipo_id=self.equipo_id,
            faccion_id=self.faccion_id
        )
        self.assertIsNotNone(tgt)
        target_id = tgt['id']
        print(f"[TEST 2] Blanco designado con éxito: {target_id} | Az={tgt['azimut']}° Dist={tgt['distancia_m']}m")

        # Verificar que se creó en dynamic_targets con datos telemetricos
        row = self.conn.execute("SELECT * FROM dynamic_targets WHERE id = ?", (target_id,)).fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(row['equipo_id'], self.equipo_id)
        self.assertEqual(row['status'], 'ACTIVE')
        self.assertIsNotNone(row['azimut'])
        self.assertIsNotNone(row['distancia_m'])

        # Verificar get_squad_current_target
        ct = op_dinamico_engine.get_squad_current_target(self.equipo_id, self.faccion_id, self.conn)
        self.assertIsNotNone(ct)
        self.assertEqual(ct['id'], target_id)
        self.assertEqual(ct['status'], 'ACTIVE')
        self.assertTrue(ct['tiempo_restante_sec'] > 0)
        print(f"[TEST 2] Current Target validado: {ct['id']} | Tiempo restante: {ct['tiempo_restante_sec']}s")

    def test_03_cooldown_mechanic_replacing_lockout(self):
        """Verifica que el OP entra en cooldown táctico de 5 min en vez de bloqueo perpetuo de alternancia."""
        cd_rem = op_dinamico_engine.get_op_cooldown_remaining(self.op_id, self.equipo_id, self.conn)
        self.assertTrue(cd_rem > 0, f"Debe quedar cooldown restante tras designar un blanco (actual: {cd_rem}s).")
        self.assertTrue(cd_rem <= 300, f"Cooldown nominal debe ser <= 300s (5 min).")
        print(f"[TEST 3] Cooldown de OP #{self.op_id}: {cd_rem}s restantes.")

        # Intentar iniciar de nuevo la sesión en este OP con Flask test client
        with self.client.session_transaction() as sess:
            sess['role'] = 'player'
            sess['faction'] = 'Syldavia'
            sess['equipo_id'] = self.equipo_id

        res = self.client.post('/api/op-dinamico/iniciar', json={'op_id': self.op_id})
        self.assertEqual(res.status_code, 403)
        res_data = res.get_json()
        self.assertIn('enfriamiento táctico', res_data.get('error', '').lower())
        print(f"[TEST 3] Mensaje táctico de enfriamiento verificado: '{res_data.get('error')}'")

    def test_04_target_roster_and_artillery_hit(self):
        """Verifica el Roster de blancos y la actualización a DESTROYED al impactar mortero."""
        roster = op_dinamico_engine.get_targets_roster(self.equipo_id, self.faccion_id, self.conn)
        self.assertTrue(len(roster) > 0, "El roster debe listar los blancos registrados.")
        tgt_id = roster[0]['id']

        # Simular impacto de mortero / artillería
        self.conn.execute("UPDATE dynamic_targets SET status = 'DESTROYED' WHERE id = ?", (tgt_id,))
        self.conn.commit()

        # Verificar que Current Target se actualiza a DESTRUIDO
        ct = op_dinamico_engine.get_squad_current_target(self.equipo_id, self.faccion_id, self.conn)
        self.assertIsNotNone(ct)
        self.assertEqual(ct['id'], tgt_id)
        self.assertEqual(ct['status'], 'DESTROYED')
        print(f"[TEST 4] Impacto de mortero confirmado: Current Target {ct['id']} estado={ct['status']}.")

    def test_05_http_endpoints(self):
        """Verifica los endpoints HTTP /telemetro_recon, /api/recon/current-target y /api/recon/targets-roster."""
        with self.client.session_transaction() as sess:
            sess['role'] = 'admin'
            sess['faction'] = 'Syldavia'
            sess['equipo_id'] = self.equipo_id
            sess['unlocked_minigames'] = ['telemetro_recon']

        # 1. GET /telemetro_recon
        res_page = self.client.get('/telemetro_recon')
        self.assertEqual(res_page.status_code, 200)
        html = res_page.get_data(as_text=True)
        self.assertIn('CURRENT TARGET', html)
        self.assertIn('ESTACIONES DE OBSERVACIÓN', html)
        self.assertIn('ROSTER DE OBJETIVOS TELEMÉTRICOS', html)
        self.assertIn('ar-targets-layer', html)
        print("[TEST 5] Página /telemetro_recon cargada y verificada.")

        # 2. GET /api/recon/current-target
        res_ct = self.client.get('/api/recon/current-target')
        self.assertEqual(res_ct.status_code, 200)
        ct_json = res_ct.get_json()
        self.assertEqual(ct_json.get('status'), 'success')
        print(f"[TEST 5] Endpoint /api/recon/current-target OK: {ct_json.get('target', {}).get('id')}")

        # 3. GET /api/recon/targets-roster
        res_roster = self.client.get('/api/recon/targets-roster')
        self.assertEqual(res_roster.status_code, 200)
        roster_json = res_roster.get_json()
        self.assertEqual(roster_json.get('status'), 'success')
        self.assertTrue(len(roster_json.get('roster', [])) > 0)
        print(f"[TEST 5] Endpoint /api/recon/targets-roster OK: {len(roster_json.get('roster'))} blancos en roster.")

if __name__ == '__main__':
    unittest.main()
