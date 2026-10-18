import sys, os
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__) + '/..'))
from app import app, get_db_connection

def test_endpoints():
    with app.test_client() as client:
        with client.session_transaction() as sess:
            sess['role'] = 'admin'
            sess['usuario'] = 'ADMIN'
            
        # Test 1: Armas dashboard
        res = client.get('/api/admin/armas_dashboard')
        assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.data}"
        data = res.get_json()
        print(f"✅ /api/admin/armas_dashboard OK: {len(data)} combatientes encontrados.")
        if data:
            first = data[0]
            print(f"   Ejemplo: {first['nombre_jugador']} (Equipo: {first['equipo_nombre']}, Facción: {first['faccion_nombre']}, Réplicas: {len(first['armas'])})")
            
            # Test 2: Añadir réplica
            res_add = client.post('/api/crono/arma/nueva', json={
                'miembro_id': first['id'],
                'modelo': 'Test Blaster MK1',
                'tipo': 'Fusilero / Asalto',
                'fps': 328,
                'julios': 0.99
            })
            assert res_add.status_code == 200, f"Expected 200, got {res_add.status_code}: {res_add.data}"
            arma_data = res_add.get_json().get('arma', {})
            arma_id = arma_data.get('id')
            print(f"✅ /api/crono/arma/nueva OK: Creada réplica #{arma_id}")
            
            # Test 3: Actualizar equipamiento táctico
            res_tac = client.post(f"/api/admin/miembro/{first['id']}/tactico", json={
                'tiene_dron': True,
                'dron_modelo': 'DJI Mini 3 Pro',
                'tiene_nvg': True,
                'nvg_categoria': 'Gen 3'
            })
            assert res_tac.status_code == 200
            print("✅ /api/admin/miembro/<id>/tactico OK: Dron y NVG actualizados.")
            
            # Test 4: Borrar réplica de test
            if arma_id:
                res_del = client.delete(f"/api/crono/arma/{arma_id}")
                assert res_del.status_code == 200
                print(f"✅ /api/crono/arma/{arma_id} DELETE OK.")
                
        # Test 5: Geo validation
        res_geo = client.get('/api/config/geo_validation')
        assert res_geo.status_code == 200
        print("✅ /api/config/geo_validation OK.")
        
    print("\n🎉 ¡TODAS LAS PRUEBAS COMPLETADAS CON ÉXITO!")

if __name__ == '__main__':
    test_endpoints()
