import unittest
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app as flask_app
from field_medic import medic_engine

class TestPostMortemDetailedScenarios(unittest.TestCase):
    def setUp(self):
        self.app = flask_app.app
        self.client = self.app.test_client()

    def test_anomalies_and_metrics_calculation(self):
        with flask_app.app.app_context():
            conn = flask_app.get_db_connection()
            # Test getting post-mortem analytics directly
            data = medic_engine.get_post_mortem_analytics(conn)
            conn.close()

        self.assertIn('facciones', data)
        self.assertIn('equipos', data)
        self.assertIn('alertas', data)
        self.assertIn('diagnostico', data)
        self.assertIn('timeline', data)

        # Check structure of each team
        for t in data['equipos']:
            self.assertIn('bajas_estimadas', t)
            self.assertIn('tasa_retencion', t)
            self.assertIn('ratio_cr', t)
            self.assertIn('limite_teorico', t)
            self.assertIn('anomalias', t)

        # Check structure of each faction
        for f in data['facciones']:
            self.assertIn('tasa_retencion', f)
            self.assertIn('ratio_cr', f)
            self.assertIn('ratio_pax_medico', f)

if __name__ == '__main__':
    unittest.main()
