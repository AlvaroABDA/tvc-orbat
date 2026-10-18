import io
import os
import sys
import unittest
from io import BytesIO

# Asegurar path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app, get_db_connection, patch_db

class TestCarnetButtonsDocs(unittest.TestCase):
    def setUp(self):
        patch_db()
        app.config['TESTING'] = True
        self.client = app.test_client()

    def test_carnet_has_back_cover_without_weapons_emergencies(self):
        """Verifica que el carnet tenga contraportada/reverso y no muestre armas ni emergencias."""
        with self.client.session_transaction() as sess:
            sess['role'] = 'admin'
            sess['faction'] = 'All'

        # Obtener un miembro existente
        with app.app_context():
            conn = get_db_connection()
            m = conn.execute('SELECT id FROM Miembro LIMIT 1').fetchone()
            miembro_id = m['id'] if m else 1

        res = self.client.get(f'/carnet/{miembro_id}')
        self.assertEqual(res.status_code, 200)
        html = res.get_data(as_text=True)

        self.assertIn('back-cover', html, "El carnet debe contener la clase 'back-cover'")
        self.assertIn('CONTRAPORTADA', html, "El carnet debe contener la sección de contraportada")
        self.assertNotIn('CONTROL CRONO & EQUIPAMIENTO', html, "No debe mostrar lista de réplicas en el carnet")
        self.assertNotIn('🚨 I.C.E. EMERGENCIA REAL', html, "No debe mostrar bloque de emergencias en el carnet")
        self.assertNotIn('role-dossier-box', html, "No debe contener el cuadro de rol en el reverso")
        self.assertNotIn('ROL // PAPEL EN PARTIDA', html, "No debe mostrar el cuadro ROL // PAPEL EN PARTIDA")
        self.assertIn('print-wrapper', html)
        self.assertIn('carnet-container', html)
        self.assertIn('qrcode', html)

    def test_documentos_pdf_lifecycle(self):
        """Prueba completa del ciclo de vida de documentos PDF para unidades."""
        # Obtener un equipo
        with app.app_context():
            conn = get_db_connection()
            eq = conn.execute('SELECT id FROM Equipo LIMIT 1').fetchone()
            self.assertIsNotNone(eq, "Debe existir al menos un equipo en la base de datos")
            equipo_id = eq['id']

        # 1. Login como admin
        with self.client.session_transaction() as sess:
            sess['role'] = 'admin'
            sess['faction'] = 'All'
            sess['usuario'] = 'admin'

        # 2. Intentar subir un archivo que no sea PDF (debe fallar)
        txt_data = {
            'tipo': 'SEGURO',
            'file': (BytesIO(b'texto de prueba'), 'documento.txt')
        }
        res_fail = self.client.post(f'/api/equipos/{equipo_id}/documentos', data=txt_data, content_type='multipart/form-data')
        self.assertEqual(res_fail.status_code, 400)
        self.assertIn('PDF', res_fail.get_json().get('error', ''))

        # 3. Subir PDF válido de Seguro
        pdf_seguro_content = b"%PDF-1.4 Mock Insurance Policy Content"
        pdf_data = {
            'tipo': 'SEGURO',
            'file': (BytesIO(pdf_seguro_content), 'Poliza_Seguro_2026.pdf')
        }
        res_upload = self.client.post(f'/api/equipos/{equipo_id}/documentos', data=pdf_data, content_type='multipart/form-data')
        self.assertEqual(res_upload.status_code, 200)
        data_upload = res_upload.get_json()
        self.assertEqual(data_upload.get('status'), 'success')
        doc_seguro = data_upload.get('documento')
        self.assertEqual(doc_seguro['tipo'], 'SEGURO')
        self.assertEqual(doc_seguro['nombre_original'], 'Poliza_Seguro_2026.pdf')
        self.assertTrue(os.path.isfile(doc_seguro['archivo_path']), "El archivo debe guardarse físicamente en disco")

        # 4. Subir PDF válido de Exención
        pdf_exencion_content = b"%PDF-1.4 Mock Safety Waiver Content"
        pdf_ex_data = {
            'tipo': 'EXENCION',
            'file': (BytesIO(pdf_exencion_content), 'Exencion_Seguridad_Firmada.pdf')
        }
        res_ex = self.client.post(f'/api/equipos/{equipo_id}/documentos', data=pdf_ex_data, content_type='multipart/form-data')
        self.assertEqual(res_ex.status_code, 200)

        # 5. Consultar GET /api/equipos/<id>/documentos
        res_list = self.client.get(f'/api/equipos/{equipo_id}/documentos')
        self.assertEqual(res_list.status_code, 200)
        docs_list = res_list.get_json()
        self.assertEqual(len(docs_list), 2)
        tipos = [d['tipo'] for d in docs_list]
        self.assertIn('SEGURO', tipos)
        self.assertIn('EXENCION', tipos)

        # 6. Consultar GET /api/equipos y verificar que incluya el listado de documentos
        res_equipos = self.client.get('/api/equipos')
        self.assertEqual(res_equipos.status_code, 200)
        eq_found = next((e for e in res_equipos.get_json() if e['id'] == equipo_id), None)
        self.assertIsNotNone(eq_found)
        self.assertIn('documentos', eq_found)
        self.assertEqual(len(eq_found['documentos']), 2)

        # 7. Eliminar un documento vía DELETE /api/documentos_equipo/<doc_id>
        doc_id_to_del = doc_seguro['id']
        path_to_del = doc_seguro['archivo_path']
        res_del = self.client.delete(f'/api/documentos_equipo/{doc_id_to_del}')
        self.assertEqual(res_del.status_code, 200)
        self.assertFalse(os.path.isfile(path_to_del), "El archivo en disco debe haberse eliminado")

        # 8. Verificar que ahora solo queda 1 documento
        res_list_after = self.client.get(f'/api/equipos/{equipo_id}/documentos')
        self.assertEqual(len(res_list_after.get_json()), 1)

if __name__ == '__main__':
    unittest.main()
