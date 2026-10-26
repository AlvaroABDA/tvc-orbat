import unittest
import sqlite3
import json
import os
import sys

# Ensure tvc-orbat root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app import app, get_db_connection, patch_db
import crypto_vault

class TestGDPREncryptionSuite(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app.config['TESTING'] = True
        app.config['SECRET_KEY'] = 'test-secret-key-gdpr'
        with app.app_context():
            patch_db()

    def setUp(self):
        self.client = app.test_client()

    def test_01_crypto_vault_basic(self):
        """Test encryption, decryption and masking utilities."""
        plain_dni = "12345678Z"
        plain_phone = "612345678"
        plain_email = "operador@vollkovia.com"
        plain_name = "Alexei Romanov"

        enc_dni = crypto_vault.encrypt_val(plain_dni)
        self.assertTrue(enc_dni.startswith("ENC::"))
        self.assertEqual(crypto_vault.decrypt_val(enc_dni), plain_dni)

        # Check idempotency (no double-encryption)
        enc_again = crypto_vault.encrypt_val(enc_dni)
        self.assertEqual(enc_again, enc_dni)

        # Check masking
        masked_dni = crypto_vault.mask_dni(plain_dni)
        self.assertTrue(masked_dni.startswith("***"))
        self.assertTrue(masked_dni.endswith("*"))
        self.assertNotIn("12345678Z", masked_dni)

        # Masking from encrypted token directly
        masked_from_enc = crypto_vault.mask_dni(enc_dni)
        self.assertEqual(masked_from_enc, masked_dni)

    def test_02_migration_and_at_rest_encryption(self):
        """Verify that existing records in SQLite have their sensitive fields encrypted."""
        conn = get_db_connection()
        members = conn.execute("SELECT id, dni, telefono, email, nombre_apellidos, token_acceso FROM Miembro").fetchall()
        self.assertGreater(len(members), 0)

        for m in members:
            # Check token_acceso is populated
            self.assertTrue(bool(m['token_acceso']), f"Miembro {m['id']} missing token_acceso")
            
            # If dni was provided, it must be encrypted in raw SQLite
            if m['dni'] and m['dni'].strip() and m['dni'] != 'None':
                self.assertTrue(
                    crypto_vault.is_encrypted(m['dni']),
                    f"Miembro {m['id']} DNI is plain text: {m['dni']}"
                )

        conn.close()

    def test_03_api_equipos_public_vs_admin_minimization(self):
        """Verify that public API hides PII while admin session receives decrypted data."""
        # 1. First, insert a test team and member with real PII as admin
        import uuid
        uid_s = uuid.uuid4().hex[:6]
        team_name = f'GDPR Squad {uid_s}'
        nick_name = f'Ghost_{uid_s}'

        with self.client.session_transaction() as sess:
            sess['role'] = 'admin'
            sess['usuario'] = 'AdminTest'

        new_team_payload = {
            'nombre': team_name,
            'jugadores': 1,
            'faccion_id': 1,
            'miembros': [{
                'nombre_jugador': nick_name,
                'rol': 'Operador',
                'armamento': 'Fusilero',
                'nombre_apellidos': 'Johnathan Doe Real',
                'dni': '98765432B',
                'telefono': '699887766',
                'email': 'ghost@example.com',
                'activo': 1
            }]
        }

        res = self.client.post('/api/equipos', json=new_team_payload)
        self.assertEqual(res.status_code, 201)
        created_team_id = res.get_json()['id']

        # 2. Check directly in SQLite at-rest: must be encrypted
        conn = get_db_connection()
        raw_m = conn.execute(
            "SELECT dni, telefono, email, nombre_apellidos, token_acceso FROM Miembro WHERE equipo_id = ?",
            (created_team_id,)
        ).fetchone()
        self.assertIsNotNone(raw_m)
        self.assertTrue(crypto_vault.is_encrypted(raw_m['dni']))
        self.assertTrue(crypto_vault.is_encrypted(raw_m['telefono']))
        self.assertTrue(crypto_vault.is_encrypted(raw_m['email']))
        self.assertTrue(crypto_vault.is_encrypted(raw_m['nombre_apellidos']))
        self.assertTrue(bool(raw_m['token_acceso']))
        conn.close()

        # 3. GET as admin: must be cleanly decrypted
        res_admin = self.client.get('/api/equipos')
        self.assertEqual(res_admin.status_code, 200)
        teams_admin = res_admin.get_json()
        target_team_admin = next((t for t in teams_admin if t['id'] == created_team_id), None)
        self.assertIsNotNone(target_team_admin)
        admin_member = target_team_admin['miembros'][0]
        self.assertEqual(admin_member['dni'], '98765432B')
        self.assertEqual(admin_member['telefono'], '699887766')
        self.assertEqual(admin_member['email'], 'ghost@example.com')
        self.assertEqual(admin_member['nombre_apellidos'], 'Johnathan Doe Real')

        # 4. GET as public / unauthenticated visitor: must be SANITIZED
        public_client = app.test_client()
        res_public = public_client.get('/api/equipos')
        self.assertEqual(res_public.status_code, 200)
        teams_public = res_public.get_json()
        target_team_pub = next((t for t in teams_public if t['id'] == created_team_id), None)
        self.assertIsNotNone(target_team_pub)
        pub_member = target_team_pub['miembros'][0]
        # DNI must be masked
        self.assertTrue(pub_member['dni'].startswith("***"))
        self.assertNotIn('98765432B', pub_member['dni'])
        # Civilian data must be completely blanked
        self.assertEqual(pub_member['telefono'], '')
        self.assertEqual(pub_member['email'], '')
        self.assertEqual(pub_member['nombre_apellidos'], '')
        self.assertNotIn('pin', pub_member)

        # Cleanup test team
        with self.client.session_transaction() as sess:
            sess['role'] = 'admin'
        self.client.delete(f'/api/equipos/{created_team_id}')

    def test_04_carnet_anti_idor_and_break_the_glass(self):
        """Test token_acceso carnet routing and ICE Break-the-Glass audit."""
        conn = get_db_connection()
        m = conn.execute("SELECT id, token_acceso, nombre_jugador FROM Miembro WHERE activo = 1 LIMIT 1").fetchone()
        self.assertIsNotNone(m)
        m_id = m['id']
        token = m['token_acceso']
        conn.close()

        # 1. Public access via token_acceso
        public_client = app.test_client()
        res_token = public_client.get(f'/carnet/{token}')
        self.assertEqual(res_token.status_code, 200)
        html_token = res_token.get_data(as_text=True)
        self.assertIn('THE VOLLKOVIAN CONFLICT', html_token)

        # 2. Break-the-Glass ICE access as admin
        with self.client.session_transaction() as sess:
            sess['role'] = 'admin'
            sess['usuario'] = 'AdminAuditTest'

        # Set sample ICE
        with app.test_client() as op_client:
            with op_client.session_transaction() as sess:
                sess['role'] = 'operador'
                sess['miembro_id'] = m_id
            res_ice_post = op_client.post('/api/operador/ice', json={
                'grupo_sanguineo': 'O+',
                'alergias': 'Penicilina y polen',
                'condiciones_medicas': 'Asma leve',
                'contacto_nombre': 'Maria Gomez',
                'contacto_telefono': '655443322'
            })
            self.assertEqual(res_ice_post.status_code, 200)

        # Admin reads ICE with emergency motive
        res_ice = self.client.get(f'/api/miembros/{m_id}/ice?motivo=Atencion+herido+en+barranco')
        self.assertEqual(res_ice.status_code, 200)
        ice_data = res_ice.get_json()
        self.assertEqual(ice_data['alergias'], 'Penicilina y polen')
        self.assertEqual(ice_data['condiciones_medicas'], 'Asma leve')

        # 3. Check AuditoriaAccesoICE in database & admin endpoint
        res_audit = self.client.get('/api/admin/seguridad/auditoria_ice')
        self.assertEqual(res_audit.status_code, 200)
        audit_records = res_audit.get_json()['data']
        self.assertGreater(len(audit_records), 0)
        latest_audit = audit_records[0]
        self.assertEqual(latest_audit['miembro_id'], m_id)
        self.assertEqual(latest_audit['rol'], 'admin')
        self.assertIn('herido', latest_audit['motivo'].lower())

if __name__ == '__main__':
    unittest.main()
