# Especificación Técnica: Sistema de Mensajería C2 / Radio Táctica (ATAK-Lite)

**Proyecto:** TVC-ORBAT  
**Entorno de Despliegue:** PythonAnywhere (`VolkovianConflict.pythonanywhere.com`) con HTTPS activo  
**Fecha:** Octubre 2026  

---

## 1. Visión y Objetivos
Incorporar un subsistema de comunicaciones tácticas dentro del visor ORBAT y Mapa Táctico, orientado a coordinar unidades durante la milsim con mecánicas inspiradas en **ATAK (Android Tactical Assault Kit)**:
* **Canales estructurados** por facción y punto a punto con el Mando.
* **Mensajes rápidos (Quick SITREP)** accionables con un toque para operadores en campo.
* **Georreferenciación directa:** salto del mapa a la cuadrícula o punto mencionado en el mensaje.
* **Emisión Flash/Prioritaria:** avisos de alta prioridad desde el Cuartel General (HQ).

---

## 2. Arquitectura de Red (Restricción PythonAnywhere)
* **Entorno:** PythonAnywhere opera sobre WSGI estándar y **no admite WebSockets persistentes**.
* **Estrategia Técnica:** **Polling Diferencial HTTP Ultraligero**.
  * El frontend consulta cada `3-4 segundos`: `GET /api/mensajes?since_id=<ULTIMO_ID_RECIBIDO>&faccion_id=<FACCION_ID>`
  * La consulta solo devuelve registros nuevos (`WHERE id > since_id`), resultando en respuestas JSON vacías `[]` o minúsculas de unos pocos bytes cuando hay actividad.
  * Consumo mínimo de batería, ancho de banda y CPU en terminales móviles.

---

## 3. Canales de Comunicación

| Canal | Emisor | Destinatario | Propósito |
| :--- | :--- | :--- | :--- |
| **Red General de Facción (*Faction Net*)** | Cualquier TL / Mando | Toda la Facción | Coordinación de sector, avisos generales y apoyos. |
| **Enlace Directo HQ (*Direct Line*)** | TL de Equipo | Mando (Admin) | Reportes confidenciales, dudas de arbitraje o misiones sin saturar la red general. |
| **Difusión FLASH (*Priority Broadcast*)** | Solo Mando (Admin) | Toda la Facción | Órdenes críticas inmediatas (*ALTO EL FUEGO*, *ALERTA ARTILLERÍA*, *REPLIEGUE GENERAL*). |

---

## 4. Mecánicas Tácticas ATAK-Lite

### 4.1. Mensajes Georreferenciados (*Jump to Grid*)
* El emisor puede marcar el botón *"Adjuntar mi posición"* o seleccionar un punto del mapa.
* El mensaje almacena `map_lat`, `map_lng` y la cuadrícula militar calculada (ej. `BL27-SO`).
* En el chat, el mensaje muestra una insignia clicable `[📍 BL27-SO]`.
* **Al pulsar sobre la insignia:** el mapa táctico navega y centra automáticamente la cámara en dichas coordenadas con un resaltado visual momentáneo.

### 4.2. Mensajes Rápidos de 1 Toque (*Quick SITREP*)
Diseñado para operadores con guantes o en movimiento sin necesidad de teclear:
* 🟢 **SITREP:** *«En posición y a la espera de órdenes»*
* 🔴 **CONTACTO:** *«Contacto hostil entablado en nuestra posición»*
* 🟡 **AMMO:** *«Munición baja, solicitamos reabastecimiento»*
* 🚑 **MEDEVAC / RESPAWN:** *«Bajas en la unidad, solicitando asistencia médica»*
* ⚪ **STATUS:** *«Reagrupando escuadra»*

### 4.3. Banners de Alerta Flash
* Si un mensaje entrante tiene `tipo = 'flash'`:
  * Muestra un banner rojo translúcido en la parte superior del mapa.
  * Sonido táctico sutil o vibración móvil.
  * Requiere confirmación de lectura o desaparece tras 15 segundos.

---

## 5. Modelo de Datos (Base de Datos SQLite)

```sql
CREATE TABLE IF NOT EXISTS MensajeTactico (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    faccion_id INTEGER NOT NULL,
    emisor_id INTEGER,               -- NULL si es el Mando/Admin
    emisor_nombre TEXT NOT NULL,      -- Ej: "MANDO", "Black Sheep", "Ghost"
    destinatario_id INTEGER,         -- NULL para toda la facción, o equipo_id para chat privado
    tipo TEXT DEFAULT 'chat',        -- 'chat', 'flash', 'sitrep', 'geo'
    texto TEXT NOT NULL,
    map_lat REAL,                    -- Coordenadas vinculadas (opcional)
    map_lng REAL,
    grid_coord TEXT,                 -- Cuadrícula militar (ej: "BL27-SO")
    creado_en DATETIME DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mensaje_faccion_id ON MensajeTactico(faccion_id, id);
CREATE INDEX IF NOT EXISTS idx_mensaje_destinatario ON MensajeTactico(destinatario_id, id);
```

---

## 6. Endpoints de la API Backend

1. **`GET /api/mensajes`**
   * Parámetros: `faccion_id`, `since_id` (opcional), `equipo_id` (para filtrar privados).
   * Devuelve los mensajes no recibidos aún por el cliente, aplicando niebla de guerra entre facciones contrarias.

2. **`POST /api/mensajes`**
   * Payload:
     ```json
     {
       "faccion_id": 1,
       "destinatario_id": null,
       "tipo": "chat",
       "texto": "Avistada patrulla en cruce sur",
       "map_lat": 1138.99,
       "map_lng": 1244.79,
       "grid_coord": "BL27-SO"
     }
     ```
   * Asigna automáticamente el `emisor_nombre` y `emisor_id` desde la sesión activa.

3. **`GET /api/mensajes/no_leidos`**
   * Devuelve el recuento de mensajes nuevos para alimentar el contador badge del botón flotante.

---

## 7. Interfaz de Usuario (UI/UX)

* **Botón de Radio C2:**
  * Icono flotante con temática militar (`radio` o `forum`) con un contador numérico de mensajes no leídos (`Badge: 3`).
  * Ubicado en la esquina superior derecha o integrado en la barra de herramientas.
* **Drawer / Ventana Flotante:**
  * En escritorio: panel lateral colapsable translúcido sobre el mapa.
  * En móvil: modal inferior / drawer deslizable que permite cerrarlo rápidamente con un gesto sin perder la vista del mapa.
* **Pestañas Internas del Chat:**
  * `[ Red de Facción ]`
  * `[ Mando Directo ]`
  * `[ Quick SITREPs ]`

---

## 8. Pasos para Implementación Futura

1. **Paso 1 (BD & Migración):** Añadir la tabla `MensajeTactico` a `init_db.py` y parche automático en `app.py`.
2. **Paso 2 (Rutas Flask):** Implementar `GET /api/mensajes` y `POST /api/mensajes` con control de permisos y roles.
3. **Paso 3 (UI / Plantillas):** Insertar el widget flotante `#chat-c2-container` y botón `#btn-toggle-chat` en `templates/index.html`.
4. **Paso 4 (Estilos CSS):** Reglas para el drawer táctico, burbujas de mensaje, badges de cuadrícula y banner FLASH en `static/css/style.css`.
5. **Paso 5 (Lógica JS):** Implementar polling periódico en `static/js/main.js` / `map.js`, interactividad con el mapa y botones SITREP.
