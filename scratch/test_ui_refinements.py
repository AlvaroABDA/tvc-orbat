import unittest
import os
import re

class TestUIRefinements(unittest.TestCase):

    def test_export_orbat_removed(self):
        with open('templates/index.html', 'r', encoding='utf-8') as f:
            idx_html = f.read()
        self.assertNotIn('btn-export-orbat', idx_html)
        self.assertNotIn('Exportar ORBAT', idx_html)

        with open('static/js/main.js', 'r', encoding='utf-8') as f:
            main_js = f.read()
        self.assertNotIn('btn-export-orbat', main_js)
        self.assertNotIn('// --- EXPORTAR ORBAT ---', main_js)

    def test_medic_kits_format(self):
        with open('field_medic/templates/medic_app.html', 'r', encoding='utf-8') as f:
            medic_html = f.read()
        # Verify CSS
        self.assertIn('.medic-digit-box', medic_html)
        self.assertIn('flex-wrap: nowrap;', medic_html)
        # Verify JS rendering logic
        self.assertIn('val <= 3 && nominal <= 3', medic_html)
        self.assertIn('medic-digit-box', medic_html)
        self.assertIn('padStart(2, \'0\')', medic_html)

    def test_prismaticos_admin_only_debug(self):
        with open('templates/prismaticos_ar.html', 'r', encoding='utf-8') as f:
            ar_html = f.read()
        
        # Verify btn-mode-toggle is inside admin check
        btn_match = re.search(r'\{%\s*if\s+user_role\s*==\s*[\'"]admin[\'"]\s*%\}\s*<button[^>]+id="btn-mode-toggle"', ar_html)
        self.assertIsNotNone(btn_match, "btn-mode-toggle must be wrapped in admin role check")

        # Verify modal-mode-select is inside admin check
        modal_match = re.search(r'\{%\s*if\s+user_role\s*==\s*[\'"]admin[\'"]\s*%\}\s*<!--[^\-]+-->\s*<div[^>]+id="modal-mode-select"', ar_html)
        self.assertIsNotNone(modal_match, "modal-mode-select must be wrapped in admin role check")

        # Verify operatingMode initialization
        self.assertIn('const isAdminUser =', ar_html)
        self.assertIn('let operatingMode = isAdminUser ? \'demo\' : \'real_gps\';', ar_html)

    def test_simulacion_menu_minimal_badges(self):
        with open('templates/simulacion_menu.html', 'r', encoding='utf-8') as f:
            sim_html = f.read()
        
        # Verify minimal badge texts
        self.assertIn('ACCESO LIBRE', sim_html)
        self.assertNotIn('DISPONIBLE PARA TODA LA TROPA', sim_html)
        self.assertIn('🩺 SANITARIO', sim_html)
        self.assertNotIn('🩺 SANITARIO ACREDITADO', sim_html)
        self.assertIn('📱 PWA', sim_html)
        self.assertNotIn('📱 INSTALABLE', sim_html)
        self.assertIn('🔒 PIN', sim_html)
        self.assertNotIn('🔒 REQUIERE PIN', sim_html)

        # Verify CSS nowrap
        self.assertIn('white-space: nowrap;', sim_html)
        self.assertIn('flex-shrink: 0;', sim_html)

if __name__ == '__main__':
    unittest.main()
