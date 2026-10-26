import os
import sys
import unittest
import json
import sqlite3

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from field_medic import medic_engine
import app as main_app

class TestDoctrinaConfigurable(unittest.TestCase):
    def setUp(self):
        self.app = main_app.app
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()

    def test_01_formula_matematica_doctrina(self):
        # 1. Caso exacto solicitado por el usuario:
        # 10 jugadores, 2 médicos, ratio 2.0:
        # Tropa = 10 - 2 = 8. Total escuadra = 8 * 2.0 = 16 curaciones.
        # Cada médico = 16 // 2 = 8 curas individuales (no 4 de un total de 8).
        res_10_2 = medic_engine.calcular_resumen_doctrina_escuadra(10, 2, 2.0)
        self.assertEqual(res_10_2['tropa_count'], 8)
        self.assertEqual(res_10_2['total_curas_escuadra'], 16)
        self.assertEqual(res_10_2['curas_por_medico'], 8)
        self.assertEqual(medic_engine.calcular_curas_por_medico(10, 2, 2.0), 8)

        # 2. Ratio 1.5:
        # 10 pax, 2 med: Tropa = 8, total = 8 * 1.5 = 12 curaciones.
        # Cada médico = 12 // 2 = 6 curas.
        res_10_2_15 = medic_engine.calcular_resumen_doctrina_escuadra(10, 2, 1.5)
        self.assertEqual(res_10_2_15['total_curas_escuadra'], 12)
        self.assertEqual(res_10_2_15['curas_por_medico'], 6)

        # 3. Ratio 1.0 (antiguo fallo que daba 4 de 8):
        # 10 pax, 2 med: Tropa = 8, total = 8.
        # Cada médico = 8 // 2 = 4 curas.
        res_10_2_10 = medic_engine.calcular_resumen_doctrina_escuadra(10, 2, 1.0)
        self.assertEqual(res_10_2_10['total_curas_escuadra'], 8)
        self.assertEqual(res_10_2_10['curas_por_medico'], 4)

        # 4. Reds91 (16 pax, 2 med):
        # Tropa = 14. Con ratio 2.0 -> total 28 curas -> cada médico 14 curas.
        res_reds_20 = medic_engine.calcular_resumen_doctrina_escuadra(16, 2, 2.0)
        self.assertEqual(res_reds_20['total_curas_escuadra'], 28)
        self.assertEqual(res_reds_20['curas_por_medico'], 14)

    def test_02_independencia_botiquines_dos_medicos_misma_escuadra(self):
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        medic_engine.init_medic_db(conn)

        conn.execute("CREATE TABLE Equipo (id INTEGER PRIMARY KEY, nombre TEXT, faccion_id INTEGER)")
        conn.execute("CREATE TABLE Miembro (id INTEGER PRIMARY KEY, uid TEXT, nombre_jugador TEXT, rol TEXT, equipo_id INTEGER)")

        conn.execute("INSERT INTO Equipo (id, nombre, faccion_id) VALUES (39, 'Reds91', 1)")
        conn.execute("INSERT INTO Miembro (id, uid, nombre_jugador, rol, equipo_id) VALUES (1, 'UID-COSTEL', 'Costel', 'Sanitario', 39)")
        conn.execute("INSERT INTO Miembro (id, uid, nombre_jugador, rol, equipo_id) VALUES (2, 'UID-SARP', 'Sr. Sarp', 'Sanitario', 39)")
        conn.commit()

        # Comprobar que los alias de Costel NO incluyen MED-39 (evita compartir pool)
        _, aliases_costel = medic_engine.resolve_sanitario_id_and_aliases(conn, 'UID-COSTEL')
        _, aliases_sarp = medic_engine.resolve_sanitario_id_and_aliases(conn, 'UID-SARP')

        self.assertNotIn('MED-39', aliases_costel)
        self.assertNotIn('MED-39', aliases_sarp)

        # Inicializar ambos con 8 curas individuales
        medic_engine.update_sanitario_recursos(conn, 'UID-COSTEL', 8, 0)
        medic_engine.update_sanitario_recursos(conn, 'UID-SARP', 8, 0)

        # Costel gasta 3 curas
        medic_engine.update_sanitario_recursos(conn, 'UID-COSTEL', 5, 3)

        # Verificar saldo de Costel
        rec_costel = medic_engine.get_or_create_sanitario_recursos(conn, 'UID-COSTEL')
        self.assertEqual(rec_costel['reanimaciones_disponibles'], 5)
        self.assertEqual(rec_costel['reanimaciones_usadas'], 3)

        # Verificar saldo de Sr. Sarp: NO DEBE HABERSE TOCADO (sigue en 8 disponibles, 0 usadas)
        rec_sarp = medic_engine.get_or_create_sanitario_recursos(conn, 'UID-SARP')
        self.assertEqual(rec_sarp['reanimaciones_disponibles'], 8)
        self.assertEqual(rec_sarp['reanimaciones_usadas'], 0)

    def test_03_api_doctrina_endpoints(self):
        with self.client.session_transaction() as sess:
            sess['role'] = 'admin'
            sess['user'] = 'HQ'

        # GET doctrina
        res_get = self.client.get('/api/admin/medicos/doctrina')
        self.assertEqual(res_get.status_code, 200)
        data_get = res_get.get_json()
        self.assertEqual(data_get['status'], 'success')
        self.assertIn('ratio_doctrina_curas', data_get)

        # POST doctrina (cambiar a 2.0x)
        res_post = self.client.post('/api/admin/medicos/doctrina', json={
            'ratio_doctrina_curas': 2.0,
            'aplicar_recarga': False
        })
        self.assertEqual(res_post.status_code, 200)
        data_post = res_post.get_json()
        self.assertEqual(data_post['ratio_doctrina_curas'], 2.0)
        self.assertEqual(data_post['ejemplo_10_2']['curas_por_medico'], 8)
        self.assertEqual(data_post['ejemplo_10_2']['total_curas_escuadra'], 16)

        # GET medicos para ver que incluye campos de escuadra
        res_meds = self.client.get('/api/admin/medicos')
        self.assertEqual(res_meds.status_code, 200)
        meds_list = res_meds.get_json()
        self.assertIsInstance(meds_list, list)

if __name__ == '__main__':
    unittest.main()
