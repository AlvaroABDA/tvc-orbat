import unittest
import json
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app as flask_app

class TestPostMortemAnalytics(unittest.TestCase):
    def setUp(self):
        self.app = flask_app.app
        self.client = self.app.test_client()

    def test_post_mortem_endpoint(self):
        res = self.client.get('/api/analytics/medics_respawn')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data.get('status'), 'success')
        self.assertIn('facciones', data)
        self.assertIn('equipos', data)
        self.assertIn('alertas', data)
        self.assertIn('diagnostico', data)
        self.assertIn('stats_resumen', data)

        print("\n=== TEST PASSED ===")
        print(f"Facciones analizadas: {len(data['facciones'])}")
        print(f"Equipos analizados: {len(data['equipos'])}")
        print(f"Alertas de anomalía: {len(data['alertas'])}")
        print("Diagnósticos:", data['diagnostico'])

if __name__ == '__main__':
    unittest.main()
