
// --- TACTICAL TRACKER LOGIC ---
const trackerCoord = document.getElementById('tracker-coord');
const trackerGps = document.getElementById('tracker-gps');

function getGridCoordinate(mapLat, mapLng) {
    // Leaflet Lat crece de abajo arriba (0 a 2000). Canvas Y crece de arriba abajo.
    const canvasY = 2000 - mapLat;
    const canvasX = mapLng;

    // Calibración exacta (Los datos proporcionados eran Lat, Lng = Y, X)
    // Columnas (X) = Letras (AA, AB...), Filas (Y) = Números (01, 02...)
    const ORIGIN_X = 66.15; 
    const ORIGIN_Y = 59.5;  
    const GRID_SIZE_X = 31.71;
    const GRID_SIZE_Y = 29.9435;
    
    const colIdx = Math.floor((canvasX - ORIGIN_X) / GRID_SIZE_X) + 1; // Eje X -> Letras
    const rowIdx = Math.floor((canvasY - ORIGIN_Y) / GRID_SIZE_Y) + 1; // Eje Y -> Números
    
    if (colIdx < 1 || rowIdx < 1 || colIdx > 100 || rowIdx > 100) return "FUERA MAPA";

    const first_letter = String.fromCharCode(65 + Math.floor((colIdx - 1) / 26));
    const second_letter = String.fromCharCode(65 + ((colIdx - 1) % 26));
    const letters = first_letter + second_letter;
    
    const numbers = rowIdx.toString().padStart(2, '0');
    
    const fracX = ((canvasX - ORIGIN_X) % GRID_SIZE_X) / GRID_SIZE_X;
    const fracY = ((canvasY - ORIGIN_Y) % GRID_SIZE_Y) / GRID_SIZE_Y;
    
    let sub = "";
    if (fracX > 0.33 && fracX < 0.67 && fracY > 0.33 && fracY < 0.67) {
        sub = "C"; // Centro
    } else {
        sub = (fracY < 0.5 ? "N" : "S") + (fracX < 0.5 ? "O" : "E");
    }
    
    return `${letters}${numbers}-${sub}`;
}

let map;
let imageOverlay;
let groupMarkers = {};
let currentMode = 'pan'; // pan, draw_route, measure, add_marker
let tempPolyline = null;
let measureLine = null;
let isMeasuring = false;
let measurePopup = null;
let currentRoutePoints = [];
let currentZonePoints = [];
let drawnRoutes = [];
let drawnZonas = [];
let intelMarkers = [];
let bftMarkers = [];
let drawnPOIs = [];
let tempPolygon = null;

class GPSMapper {
    constructor(p1, p2, p3) {
        const u1 = p1.gps.lng, v1 = p1.gps.lat, x1 = p1.px.lng, y1 = p1.px.lat;
        const u2 = p2.gps.lng, v2 = p2.gps.lat, x2 = p2.px.lng, y2 = p2.px.lat;
        const u3 = p3.gps.lng, v3 = p3.gps.lat, x3 = p3.px.lng, y3 = p3.px.lat;

        const det = u1*(v2 - v3) - v1*(u2 - u3) + (u2*v3 - u3*v2);

        this.A = (x1*(v2 - v3) - v1*(x2 - x3) + (x2*v3 - x3*v2)) / det;
        this.B = (u1*(x2 - x3) - x1*(u2 - u3) + (u2*x3 - u3*x2)) / det;
        this.C = x1 - this.A * u1 - this.B * v1;

        this.D = (y1*(v2 - v3) - v1*(y2 - y3) + (y2*v3 - y3*v2)) / det;
        this.E = (u1*(y2 - y3) - y1*(u2 - u3) + (u2*y3 - u3*y2)) / det;
        this.F = y1 - this.D * u1 - this.E * v1;
        
        const detInv = this.A * this.E - this.B * this.D;
        this.invA = this.E / detInv;
        this.invB = -this.B / detInv;
        this.invC = (this.B * this.F - this.C * this.E) / detInv;
        
        this.invD = -this.D / detInv;
        this.invE = this.A / detInv;
        this.invF = (this.C * this.D - this.A * this.F) / detInv;
    }

    gpsToMap(lat, lng) {
        const x = this.A * lng + this.B * lat + this.C;
        const y = this.D * lng + this.E * lat + this.F;
        return { lat: y, lng: x };
    }

    mapToGps(pxLat, pxLng) {
        const u = this.invA * pxLng + this.invB * pxLat + this.invC;
        const v = this.invD * pxLng + this.invE * pxLat + this.invF;
        return { lat: v, lng: u };
    }
}

window.mapProjector = new GPSMapper(
    { gps: { lat: 41.95586014650798, lng: -6.256770847102261 }, px: { lat: 1139, lng: 1244.75 } },
    { gps: { lat: 41.95764427861231, lng: -6.2679631830511005 }, px: { lat: 1257.75, lng: 674 } },
    { gps: { lat: 41.96462525160695, lng: -6.2547713027579865 }, px: { lat: 1727.75, lng: 1343.75 } }
);

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatTiempoTranscurrido(seg) {
    if (seg === null || seg === undefined || isNaN(seg)) return "--";
    seg = Math.max(0, parseInt(seg, 10));
    if (seg < 60) return `${seg}s`;
    const min = Math.floor(seg / 60);
    if (min < 60) return `${min}m`;
    const hrs = Math.floor(min / 60);
    return `${hrs}h ${min % 60}m`;
}

function formatTiempoRestante(seg) {
    if (seg === null || seg === undefined || isNaN(seg)) return "Permanente";
    seg = parseInt(seg, 10);
    if (seg <= 0) return "Expirando...";
    if (seg < 60) return `${seg}s`;
    const min = Math.floor(seg / 60);
    if (min < 60) return `${min}m`;
    const hrs = Math.floor(min / 60);
    return `${hrs}h ${min % 60}m`;
}

window.eliminarMarcador = async function(id) {
    if (confirm('¿Eliminar este marcador táctico?')) {
        await fetch(`/api/mapa/marcadores/${id}`, { method: 'DELETE' });
        loadMapData();
    }
};

function toggleMapMobilePanel() {
    const panel = document.getElementById('map-sidebar-panel');
    const arrow = document.getElementById('map-drawer-arrow');
    if (!panel) return;
    panel.classList.toggle('panel-open');
    if (arrow) {
        arrow.textContent = panel.classList.contains('panel-open') ? 'keyboard_arrow_down' : 'keyboard_arrow_up';
    }
}
window.toggleMapMobilePanel = toggleMapMobilePanel;

// Initialize map only when the tab is shown to prevent rendering issues
function initMap() {
    if (map) return; // Already initialized

    const bounds = [[0, 0], [2000, 3000]]; 
    
    // Setup map
    map = L.map('tactical-map', {
        crs: L.CRS.Simple,
        minZoom: -2,
        maxZoom: 2,
        zoomControl: false,
        doubleClickZoom: false, // Disable so we can use double click for drawing
        maxBounds: bounds,      // Prevent panning outside map
        maxBoundsViscosity: 1.0 // Make bounds completely solid
    });
    L.control.zoom({ position: 'topright' }).addTo(map);

    imageOverlay = L.imageOverlay('/static/map/Full_Mapa%20Oct24.png?v=4', bounds).addTo(map);
    
    // Set higher initial zoom instead of fitBounds
    map.setView([1000, 1500], 0);

    // Add zoom percentage label
    setTimeout(() => {
        const zoomContainer = document.querySelector('.leaflet-control-zoom');
        if (zoomContainer) {
            const zoomLabel = document.createElement('div');
            zoomLabel.id = 'zoom-percentage-label';
            zoomLabel.style.background = 'rgba(0,0,0,0.8)';
            zoomLabel.style.color = 'white';
            zoomLabel.style.textAlign = 'center';
            zoomLabel.style.fontFamily = 'var(--font-mono)';
            zoomLabel.style.fontSize = '0.75rem';
            zoomLabel.style.padding = '4px 0';
            zoomLabel.style.borderTop = '1px solid #444';
            zoomLabel.style.borderBottom = '1px solid #444';
            zoomLabel.style.width = '30px';
            
            const zoomOutBtn = document.querySelector('.leaflet-control-zoom-out');
            zoomContainer.insertBefore(zoomLabel, zoomOutBtn);

            const updateZoomLabel = () => {
                const z = map.getZoom();
                // Map zoom levels to percentage (0 = 100%)
                const percentage = Math.round(Math.pow(2, z) * 100);
                zoomLabel.innerText = `${percentage}%`;
            };
            map.on('zoomend', updateZoomLabel);
            updateZoomLabel();
        }
    }, 100);

    // Interaction handling
    map.on('click', handleMapClick);
    
    map.on('mousemove', handleMapMouseMove);
    map.on('dblclick', handleMapDoubleClick); 
    map.on('contextmenu', handleMapRightClick); 

    if (['admin', 'mando', 'equipo'].includes(window.userRole) || window.location.pathname === '/mortero_app') {
        document.getElementById('btn-draw-route')?.addEventListener('click', () => setMode('draw_route'));
        document.getElementById('btn-draw-zone')?.addEventListener('click', () => setMode('draw_zone'));
        document.getElementById('btn-measure')?.addEventListener('click', () => {
            if (typeof currentMode !== 'undefined' && currentMode === 'measure') {
                setMode('pan');
            } else {
                setMode('measure');
            }
        });
        document.getElementById('btn-add-marker')?.addEventListener('click', () => setMode('add_marker'));
        document.getElementById('btn-add-tl-marker')?.addEventListener('click', () => setMode('add_tl_marker'));
        document.getElementById('btn-transmit-bft')?.addEventListener('click', transmitBFTBeacon);
        document.getElementById('btn-floating-bft')?.addEventListener('click', transmitBFTBeacon);
        const btnPoiMap = document.getElementById('btn-add-poi-map');
        if(btnPoiMap) btnPoiMap.addEventListener('click', () => setMode('add_poi_map'));
        
        const btnDrawOk = document.getElementById('btn-draw-ok');
        const btnDrawCancel = document.getElementById('btn-draw-cancel');
        if (btnDrawOk) {
            btnDrawOk.addEventListener('click', () => {
                if (currentMode === 'draw_route' && currentRoutePoints.length > 0) saveRoute(currentRoutePoints);
                else if (currentMode === 'draw_zone' && currentZonePoints.length > 0) saveZone(currentZonePoints);
                else setMode('pan');
            });
        }
        if (btnDrawCancel) {
            btnDrawCancel.addEventListener('click', () => setMode('pan'));
        }
    }

    loadMapData();
}

function setMode(mode) {
    currentMode = mode;
    document.getElementById('btn-draw-route')?.classList.remove('active');
    const drawZoneBtn = document.getElementById('btn-draw-zone');
    if (drawZoneBtn) drawZoneBtn.classList.remove('active');
    document.getElementById('btn-measure')?.classList.remove('active');
    document.getElementById('btn-add-marker')?.classList.remove('active');

    if (mode === 'draw_route') document.getElementById('btn-draw-route')?.classList.add('active');
    if (mode === 'draw_zone' && drawZoneBtn) drawZoneBtn.classList.add('active');
    if (mode === 'measure') document.getElementById('btn-measure')?.classList.add('active');
    if (mode === 'add_marker') document.getElementById('btn-add-marker')?.classList.add('active');
    if (mode === 'add_tl_marker') document.getElementById('btn-add-tl-marker')?.classList.add('active');
    const btnPoiMap = document.getElementById('btn-add-poi-map');
    if (btnPoiMap) btnPoiMap.classList.remove('active');
    if (mode === 'add_poi_map' && btnPoiMap) btnPoiMap.classList.add('active');

    // En móvil, al activar una herramienta cerrar el panel inferior para despejar el mapa
    if (window.innerWidth <= 768 && mode !== 'pan') {
        const panel = document.getElementById('map-sidebar-panel');
        if (panel && panel.classList.contains('panel-open')) {
            toggleMapMobilePanel();
        }
    }

    const mapEl = document.getElementById('tactical-map') || document.getElementById('mortero-leaflet-map');
    if (mapEl) {
        if (mode === 'pan') {
            mapEl.style.cursor = 'grab';
        } else {
            mapEl.style.cursor = 'crosshair';
        }
    }

    // Cleanups on mode switch
    currentRoutePoints = [];
    currentZonePoints = [];
    let actMap = (typeof morteroMap !== 'undefined' && morteroMap && window.location.pathname === '/mortero_app') ? morteroMap : map;
    if (actMap) {
        if (tempPolyline) { actMap.removeLayer(tempPolyline); tempPolyline = null; }
        if (tempPolygon) { actMap.removeLayer(tempPolygon); tempPolygon = null; }
    }
    
    // Floating Toolbar for Mobile/Tablets
    const drawingToolbar = document.getElementById('drawing-toolbar');
    const modeText = document.getElementById('drawing-mode-text');
    if (drawingToolbar && modeText) {
        if (mode === 'draw_route') {
            drawingToolbar.style.display = 'flex';
            modeText.innerText = 'Trazando Ruta...';
        } else if (mode === 'draw_zone') {
            drawingToolbar.style.display = 'flex';
            modeText.innerText = 'Trazando Zona...';
        } else {
            drawingToolbar.style.display = 'none';
        }
    }
    if (actMap) {
        if (measureLine) { actMap.removeLayer(measureLine); measureLine = null; }
        if (measurePopup) { actMap.removeLayer(measurePopup); measurePopup = null; }
    }
}

async function loadMapData() {
    // Render the groups sidebar
    const unplacedGroups = todosGrupos.filter(g => g.faccion_nombre === currentFaction && (g.pos_x == null || g.pos_y == null));
    const container = document.getElementById('map-units-container');
    const fichasBadge = document.getElementById('map-fichas-count');
    if (fichasBadge) {
        fichasBadge.innerText = unplacedGroups.length;
    }
    if (container) {
        container.innerHTML = '';
        
        unplacedGroups.forEach(g => {
            const btn = document.createElement('button');
            btn.className = 'btn outline';
            btn.style.width = '100%';
            btn.style.textAlign = 'left';
            btn.innerText = g.nombre;
            btn.onclick = () => {
                const center = map.getCenter();
                placeGroupOnMap(g, center.lat, center.lng);
                if (window.innerWidth <= 768) {
                    const panel = document.getElementById('map-sidebar-panel');
                    if (panel && panel.classList.contains('panel-open')) {
                        toggleMapMobilePanel();
                    }
                }
            };
            container.appendChild(btn);
        });
    }

    // Place existing groups on map
    const placedGroups = todosGrupos.filter(g => g.faccion_nombre === currentFaction && g.pos_x != null && g.pos_y != null);
    
    Object.values(groupMarkers).forEach(m => map.removeLayer(m));
    groupMarkers = {};

    placedGroups.forEach(g => {
        createGroupMarker(g);
    });

    // Wait until facciones is loaded
    while (typeof facciones === 'undefined' || facciones.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    const faccionObj = facciones.find(f => f.nombre === currentFaction);
    if (!faccionObj) return; // Silent return if faction not set (e.g. admin on page load)

    // Load Routes and Markers from API
    const resR = await fetch(`/api/mapa/rutas?faccion_id=${faccionObj.id}`);
    const rutas = await resR.json();
    drawnRoutes.forEach(r => { map.removeLayer(r.line); if(r.decorator) map.removeLayer(r.decorator); if(r.labelMarker) map.removeLayer(r.labelMarker); });
    drawnRoutes = [];
    rutas.forEach(r => {
        const pts = JSON.parse(r.puntos_json);
        renderRouteOnMap(pts, r.color, r.id, r.nombre);
    });

    const resM = await fetch(`/api/mapa/marcadores?faccion_id=${faccionObj.id}`);
    const marcadores = await resM.json();
    intelMarkers.forEach(m => map.removeLayer(m));
    intelMarkers = [];
    marcadores.forEach(m => {
        const isTL = m.tipo === 'tl_pos';
        const tipo = m.tipo || 'intel';
        
        let tipoIcon = 'warning';
        let tipoColor = '#ef4444';
        let tipoLabel = 'Amenaza / Contacto';
        let htmlIcon = '';

        if (tipo === 'tl_pos') {
            tipoIcon = 'my_location';
            tipoColor = getFactionColor();
            tipoLabel = 'Posición Aliada (TL)';
            htmlIcon = `<div style="display:flex; justify-content:center; align-items:center; width: 28px; height: 28px; border-radius: 50%; background-color: ${tipoColor}; border: 2px solid white; box-shadow: 0 0 8px black; color: white; margin: auto;"><span class="material-symbols-outlined" style="font-size: 18px;">my_location</span></div>`;
        } else if (tipo === 'observacion') {
            tipoIcon = 'visibility';
            tipoColor = '#eab308';
            tipoLabel = 'Observación';
            htmlIcon = `<div style="display:flex; justify-content:center; align-items:center; width: 26px; height: 26px; background: rgba(234, 179, 8, 0.95); border: 2px solid white; box-shadow: 0 0 6px black; color: black; border-radius: 5px;"><span class="material-symbols-outlined" style="font-size: 17px; font-weight: bold;">visibility</span></div>`;
        } else if (tipo === 'objetivo') {
            tipoIcon = 'adjust';
            tipoColor = '#06b6d4';
            tipoLabel = 'Objetivo Táctico';
            htmlIcon = `<div style="display:flex; justify-content:center; align-items:center; width: 26px; height: 26px; background: rgba(6, 182, 212, 0.95); border: 2px solid white; box-shadow: 0 0 6px black; color: white; border-radius: 50%;"><span class="material-symbols-outlined" style="font-size: 18px;">adjust</span></div>`;
        } else if (tipo === 'aviso') {
            tipoIcon = 'campaign';
            tipoColor = '#a855f7';
            tipoLabel = 'Aviso / Peligro';
            htmlIcon = `<div style="display:flex; justify-content:center; align-items:center; width: 26px; height: 26px; background: rgba(168, 85, 247, 0.95); border: 2px solid white; box-shadow: 0 0 6px black; color: white; border-radius: 4px;"><span class="material-symbols-outlined" style="font-size: 17px;">campaign</span></div>`;
        } else {
            tipoIcon = 'warning';
            tipoColor = '#ef4444';
            tipoLabel = 'Amenaza Enemiga';
            htmlIcon = `<div style="display:flex; justify-content:center; align-items:center; width: 26px; height: 26px; background: rgba(220, 38, 38, 0.95); border: 2px solid white; box-shadow: 0 0 6px black; color: white; border-radius: 4px; transform: rotate(45deg);"><span class="material-symbols-outlined" style="transform: rotate(-45deg); font-size: 17px;">warning</span></div>`;
        }

        const isExpiringSoon = m.caduca_en && m.segundos_restantes !== null && m.segundos_restantes <= 120;
        const className = (isTL ? 'tl-marker' : 'intel-marker') + (isExpiringSoon ? ' intel-expiring' : '');

        const intel = L.marker([m.lat, m.lng], {
            icon: L.divIcon({
                className: className,
                html: htmlIcon,
                iconSize: [26, 26],
                iconAnchor: [13, 13]
            }),
            draggable: ['admin', 'mando', 'equipo'].includes(window.userRole)
        }).addTo(map);

        const gridStr = getGridCoordinate(m.lat, m.lng);
        const elapsedStr = formatTiempoTranscurrido(m.segundos_transcurridos);
        const remainingStr = m.caduca_en ? formatTiempoRestante(m.segundos_restantes) : "Permanente";

        intel.bindTooltip(`<b>[${gridStr}]</b> ${escapeHtml(m.descripcion || tipoLabel)}`, { permanent: false, direction: 'right', className: isTL ? 'tl-tooltip' : '' });

        // Tactical Click Popup (ATAK-lite)
        let popupHtml = `
            <div class="tactical-card-header">
                <span class="tactical-card-title" style="color: ${tipoColor};">
                    <span class="material-symbols-outlined" style="font-size: 16px;">${tipoIcon}</span>
                    ${tipoLabel}
                </span>
                <span class="tactical-badge" style="background: rgba(255,255,255,0.08); color: var(--theme-color); border: 1px solid var(--theme-color);">${gridStr}</span>
            </div>
            <div class="tactical-card-body">
                <div class="tactical-desc">${escapeHtml(m.descripcion || 'Sin mensaje adicional')}</div>
                <div class="tactical-meta-row">
                    <span>👤 <strong>${escapeHtml(m.autor_nombre || 'Mando')}</strong></span>
                    <span>⏱️ Hace ${elapsedStr}</span>
                </div>
                <div class="tactical-timer-box" style="${isExpiringSoon ? 'border-color: #ff4444; color: #ff6666;' : ''}">
                    <span style="display:flex; align-items:center; gap:4px;">
                        <span class="material-symbols-outlined" style="font-size: 14px;">hourglass_top</span>
                        ${m.caduca_en ? 'Caducidad:' : 'Vigencia:'}
                    </span>
                    <strong style="${isExpiringSoon ? 'animation: blink 1s infinite;' : ''}">${remainingStr}</strong>
                </div>
            </div>
        `;
        if (['admin', 'mando', 'equipo'].includes(window.userRole) || window.location.pathname === '/mortero_app') {
            popupHtml += `
                <div class="tactical-card-footer">
                    <button class="btn danger" style="padding: 2px 8px; font-size: 0.72rem; display: flex; align-items: center; gap: 4px;" onclick="eliminarMarcador(${m.id})">
                        <span class="material-symbols-outlined" style="font-size: 14px;">delete</span> Eliminar
                    </button>
                </div>
            `;
        }
        intel.bindPopup(popupHtml, { className: 'tactical-popup', maxWidth: 290 });

        if (['admin', 'mando', 'equipo'].includes(window.userRole) || window.location.pathname === '/mortero_app') {
            intel.on('dragend', async (e) => {
                const pos = e.target.getLatLng();
                await fetch(`/api/mapa/marcadores/${m.id}`, {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ lat: pos.lat, lng: pos.lng })
                });
            });

            const deleteMarker = async () => {
                if(confirm(`¿Borrar marcador ${isTL ? 'de posición (TL)' : 'Intel'}?`)) {
                    await fetch(`/api/mapa/marcadores/${m.id}`, { method: 'DELETE' });
                    loadMapData();
                }
            };
            intel.on('contextmenu', deleteMarker);
            intel.on('dblclick', deleteMarker);
        }
        intelMarkers.push(intel);
    });

    const resZ = await fetch(`/api/mapa/zonas?faccion_id=${faccionObj.id}`);
    const zonas = await resZ.json();

    // Render POIs
    const resPOI = await fetch('/api/pois');
    const pois = await resPOI.json();
    drawnPOIs.forEach(m => map.removeLayer(m));
    drawnPOIs = [];
    
    pois.forEach(poi => {
        const currentFaccionId = facciones.find(f => f.nombre === currentFaction)?.id;
        
        // Fog of War: If not Admin, hide enemy POIs (keep neutral and own)
        if (window.userRole !== 'admin') {
            if (poi.tipo === 'OP') {
                if (poi.faccion_id !== currentFaccionId) {
                    return; // Hide OP if not assigned strictly to my faction
                }
            } else {
                if (poi.faccion_id !== null && poi.faccion_id !== currentFaccionId) {
                    return; // Hide enemy POI
                }
            }
        }
        
        let iconHtml = '';
        let color = '#777'; // Neutral
        if (poi.faccion_id) {
            const fac = facciones.find(f => f.id === poi.faccion_id);
            if (fac) {
                if(fac.nombre === 'Syldavia') color = '#DAA520';
                if(fac.nombre === 'Volkovia') color = '#1E90FF';
                if(fac.nombre === 'Khemed') color = '#2E7D32';
            }
        }

        if (poi.tipo === 'RESPAWN') {
            iconHtml = `<div style="background-color: ${color}; width: 32px; height: 32px; border-radius: 5px; border: 2px solid white; display: flex; justify-content: center; align-items: center; box-shadow: 0 0 10px ${color};"><span class="material-symbols-outlined" style="color:white; font-size: 20px;">home</span></div>`;
        } else if (poi.tipo === 'PC') {
            iconHtml = `<div style="background-color: ${color}; width: 28px; height: 28px; border-radius: 50%; border: 2px solid white; display: flex; justify-content: center; align-items: center; box-shadow: 0 0 10px ${color};"><span class="material-symbols-outlined" style="color:white; font-size: 16px;">tour</span></div>`;
        } else if (poi.tipo === 'MISION') {
            iconHtml = `<div style="background-color: #ff9800; width: 28px; height: 28px; transform: rotate(45deg); border: 2px solid white; display: flex; justify-content: center; align-items: center; box-shadow: 0 0 10px #ff9800;"><span class="material-symbols-outlined" style="color:white; font-size: 16px; transform: rotate(-45deg);">star</span></div>`;
        } else if (poi.tipo === 'OP') {
            iconHtml = `<div style="background-color: ${color}; width: 28px; height: 28px; border-radius: 5px; border: 2px solid white; display: flex; justify-content: center; align-items: center; box-shadow: 0 0 10px ${color};"><span class="material-symbols-outlined" style="color:white; font-size: 18px;">visibility</span></div>`;
        }

        // Project Real GPS to Leaflet CRS.Simple
        let mapPx = {lat: 0, lng: 0};
        if(window.mapProjector) {
            mapPx = window.mapProjector.gpsToMap(poi.lat, poi.lng);
        }
        
        const m = L.marker([mapPx.lat, mapPx.lng], {
            icon: L.divIcon({
                className: 'poi-marker',
                html: iconHtml,
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            })
        }).addTo(map);

        m.bindTooltip(`<b>[${poi.tipo}]</b> ${poi.nombre}`, {direction: 'top', offset: [0, -15], permanent: false});
        drawnPOIs.push(m);
        
        // Add Tolerance Circle if Admin
        if (window.userRole === 'admin') {
            // Very roughly convert meters to pixels. 
            // The map is approx 2000x3000. Depending on scale, 1 pixel = ~X meters.
            // For now, let's just use a visual radius.
            const circle = L.circle([mapPx.lat, mapPx.lng], {
                color: color,
                fillColor: color,
                fillOpacity: 0.1,
                radius: poi.tolerancia_metros * 0.62 // approx 0.62 px per meter based on triangulation
            }).addTo(map);
            drawnPOIs.push(circle);
        }
    });

    drawnZonas.forEach(z => {
        map.removeLayer(z.polygon);
        if(z.labelMarker) map.removeLayer(z.labelMarker);
    });
    drawnZonas = [];
    zonas.forEach(z => {
        const pts = JSON.parse(z.puntos_json);
        renderZoneOnMap(pts, z.color, z.nombre, z.id);
    });

    await loadBFTBeacons();
}

function getFactionColor() {
    if (currentFaction === 'Syldavia') return '#DAA520'; // Yellow/Gold
    if (currentFaction === 'Volkovia') return '#1E90FF'; // Blue
    if (currentFaction === 'Khemed') return '#2E7D32';   // Green
    return '#ff0000';
}

function createGroupMarker(g) {
    // Generate the correct PNG logo
    let prefix = '';
    if (currentFaction === 'Syldavia') prefix = 's';
    if (currentFaction === 'Volkovia') prefix = 'v';
    if (currentFaction === 'Khemed') prefix = 'k';

    let letter = '';
    const nameLow = g.nombre.toLowerCase();
    if (nameLow.includes('alfa')) letter = 'a';
    else if (nameLow.includes('bravo')) letter = 'b';
    else if (nameLow.includes('charlie')) letter = 'c';
    else if (nameLow.includes('delta')) letter = 'd';
    else if (nameLow.includes('echo')) letter = 'e';

    let imgSrc = '';
    if (letter) {
        imgSrc = `/static/imgs/${prefix}${letter}.png`;
    } else {
        if (currentFaction === 'Syldavia') imgSrc = '/static/imgs/syldavia_negro.png';
        if (currentFaction === 'Volkovia') imgSrc = '/static/imgs/vokovia_negro.png';
        if (currentFaction === 'Khemed') imgSrc = '/static/imgs/khemed_negro.png';
    }

    const teamsInGroup = typeof todasAsignaciones !== 'undefined' ? todasAsignaciones.filter(a => a.grupo_batalla_id === g.id) : [];
    const totalJugadores = teamsInGroup.reduce((sum, t) => sum + (t.jugadores || 0), 0);

    // Create marker with 70% opacity PNG. 1 grid = 32px = 50m.
    const html = `<div style="text-align: center; position: relative;">
        <img src="${imgSrc}" style="width: 32px; opacity: 0.7; filter: drop-shadow(0px 2px 3px rgba(0,0,0,0.8)); pointer-events: none;" />
        <div style="position: absolute; bottom: -12px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.7); color: white; border-radius: 4px; padding: 1px 4px; font-size: 10px; font-weight: bold; pointer-events: none; white-space: nowrap;">
            ${totalJugadores} px
        </div>
    </div>`;

    const icon = L.divIcon({
        className: 'custom-map-icon',
        html: html,
        iconSize: [32, 32], 
        iconAnchor: [16, 16] 
    });

    const marker = L.marker([g.pos_x, g.pos_y], { 
        icon: icon, 
        draggable: window.userRole === 'admin' 
    }).addTo(map);
    
    marker.bindTooltip(g.nombre, {direction: 'top', offset: [0, -30]});

    marker.on('dragend', async (e) => {
        const pos = e.target.getLatLng();
        g.pos_x = pos.lat;
        g.pos_y = pos.lng;
        // Save to DB
        await fetch(`/api/orbat/grupo/${g.id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ pos_x: pos.lat, pos_y: pos.lng })
        });
    });

    // Right click to remove from map (unplace)
    if (window.userRole === 'admin') {
        marker.on('contextmenu', async () => {
            if(confirm(`¿Devolver ${g.nombre} a fichas disponibles?`)) {
                g.pos_x = null;
                g.pos_y = null;
                await fetch(`/api/orbat/grupo/${g.id}`, {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ pos_x: '', pos_y: '' })
                });
                loadMapData();
            }
        });
    }

    groupMarkers[g.id] = marker;
}

async function placeGroupOnMap(g, lat, lng) {
    g.pos_x = lat;
    g.pos_y = lng;
    await fetch(`/api/orbat/grupo/${g.id}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ pos_x: lat, pos_y: lng })
    });
    loadMapData(); 
}

function renderRouteOnMap(pts, color, id, name) {
    // Thick line, 60% opacity
    const line = L.polyline(pts, {color: color, weight: 6, opacity: 0.6}).addTo(map);
    
    let decorator = null;
    // Add arrows using leaflet-polylinedecorator if available
    if (window.L.polylineDecorator) {
        decorator = L.polylineDecorator(line, {
            patterns: [
                {
                    offset: '25px', 
                    repeat: '50px', 
                    symbol: L.Symbol.arrowHead({pixelSize: 15, pathOptions: {fillOpacity: 1, weight: 0, color: color}})
                }
            ]
        }).addTo(map);
    }

    let labelMarker = null;

    // Right click or Double Click to delete route
    if (['admin', 'mando', 'equipo'].includes(window.userRole) || window.location.pathname === '/mortero_app') {
        const deleteRoute = async () => {
            if(confirm('¿Borrar esta ruta?')) {
                await fetch(`/api/mapa/rutas/${id}`, { method: 'DELETE' });
                loadMapData();
            }
        };
        line.on('contextmenu', deleteRoute);
        line.on('dblclick', deleteRoute);
        if(decorator) {
            decorator.on('contextmenu', deleteRoute);
            decorator.on('dblclick', deleteRoute);
        }
    }

    drawnRoutes.push({line, decorator, labelMarker, id});
}

function handleMapClick(e) {
    if (currentMode === 'pan') {
        return;
    }

    if (currentMode === 'add_poi_map') {
        setMode('pan');
        
        // Fill coordinates
        document.getElementById('poi-map-y').value = e.latlng.lat.toFixed(2);
        document.getElementById('poi-map-x').value = e.latlng.lng.toFixed(2);
        if(window.mapProjector) {
            const realGps = window.mapProjector.mapToGps(e.latlng.lat, e.latlng.lng);
            document.getElementById('poi-lat').value = realGps.lat.toFixed(6);
            document.getElementById('poi-lng').value = realGps.lng.toFixed(6);
        }
        
        // Open the modal
        const modalPoi = document.getElementById('modal-poi');
        if (modalPoi) modalPoi.classList.add('active');
        return;
    }

    if (currentMode === 'add_marker' || currentMode === 'add_tl_marker') {
        const faccionObj = facciones.find(f => f.nombre === currentFaction);
        if (!faccionObj) {
            alert("Selecciona una facción específica en las pestañas antes de añadir un marcador.");
            setMode('pan');
            return;
        }

        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        const grid = getGridCoordinate(lat, lng);

        const latInput = document.getElementById('intel-lat');
        const lngInput = document.getElementById('intel-lng');
        const gridPreview = document.getElementById('intel-grid-preview');
        const gpsPreview = document.getElementById('intel-gps-preview');
        const tipoInput = document.getElementById('intel-tipo');
        const ttlInput = document.getElementById('intel-ttl');
        const descInput = document.getElementById('intel-desc');

        if (latInput) latInput.value = lat;
        if (lngInput) lngInput.value = lng;
        if (gridPreview) gridPreview.innerText = grid;
        if (gpsPreview && window.mapProjector) {
            const gps = window.mapProjector.mapToGps(lat, lng);
            gpsPreview.innerText = `GPS: ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`;
        }
        if (tipoInput) tipoInput.value = currentMode === 'add_tl_marker' ? 'tl_pos' : 'intel';
        if (ttlInput) ttlInput.value = currentMode === 'add_tl_marker' ? '0' : '15';
        if (descInput) descInput.value = '';

        const modalIntel = document.getElementById('modal-intel');
        if (modalIntel) {
            modalIntel.classList.add('active');
            modalIntel.style.display = 'flex';
        }
        setMode('pan');
        return;
    }
    else if (currentMode === 'draw_route') {
        currentRoutePoints.push(e.latlng);
        if (tempPolyline) {
            map.removeLayer(tempPolyline);
        }
        tempPolyline = L.polyline(currentRoutePoints, {color: getFactionColor(), weight: 6, opacity: 0.6}).addTo(map);
    }

    else if (currentMode === 'measure') {
        if (currentRoutePoints.length === 0 || currentRoutePoints.length === 2) {
            // Start new measurement
            currentRoutePoints = [e.latlng];
            let targetMap = (typeof morteroMap !== 'undefined' && morteroMap && window.location.pathname === '/mortero_app') ? morteroMap : map;
            if (measureLine) targetMap.removeLayer(measureLine);
            if (measurePopup) targetMap.removeLayer(measurePopup);
            if (window.measureTimeout) clearTimeout(window.measureTimeout);
        } else if (currentRoutePoints.length === 1) {
            // Second point, finish measurement
            currentRoutePoints.push(e.latlng);
            let targetMap = (typeof morteroMap !== 'undefined' && morteroMap && window.location.pathname === '/mortero_app') ? morteroMap : map;
            
            if (measureLine) targetMap.removeLayer(measureLine);
            if (measurePopup) targetMap.removeLayer(measurePopup);

            const p1 = currentRoutePoints[0];
            const p2 = currentRoutePoints[1];
            measureLine = L.polyline([p1, p2], {color: '#ffff00', weight: 4, dashArray: '5, 5'}).addTo(targetMap);
            
            const pxDist = Math.sqrt(Math.pow(p2.lat - p1.lat, 2) + Math.pow(p2.lng - p1.lng, 2));
            const pixelsPerGrid = 32; 
            const meters = (pxDist / pixelsPerGrid) * 50;
            
            const flagHtml = `<div style="color: #000; font-family: var(--font-mono); font-weight: bold; font-size: 0.8rem; white-space: nowrap; text-shadow: 1px 1px 0px #fff, -1px -1px 0px #fff, 1px -1px 0px #fff, -1px 1px 0px #fff;">${meters.toFixed(0)}m</div>`;
            const flagIcon = L.divIcon({ className: 'measure-flag', html: flagHtml, iconSize: null, iconAnchor: [-10, 15] });
            measurePopup = L.marker(p2, { icon: flagIcon, interactive: false }).addTo(targetMap);
                
            
        }
    }
    else if (currentMode === 'draw_zone') {
        currentZonePoints.push(e.latlng);
        if (tempPolygon) {
            map.removeLayer(tempPolygon);
        }
        tempPolygon = L.polygon(currentZonePoints, {color: getFactionColor(), weight: 3, opacity: 0.8, fillColor: getFactionColor(), fillOpacity: 0.4}).addTo(map);
    }
}

function handleMapMouseMove(e) {
    if (trackerCoord && trackerGps) {
        trackerCoord.innerText = getGridCoordinate(e.latlng.lat, e.latlng.lng);
        if (window.mapProjector) {
            const gps = window.mapProjector.mapToGps(e.latlng.lat, e.latlng.lng);
            trackerGps.innerText = `GPS: ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`;
        }
    }

    if (currentMode === 'draw_route' && currentRoutePoints.length > 0) {
        if (tempPolyline) map.removeLayer(tempPolyline);
        tempPolyline = L.polyline([...currentRoutePoints, e.latlng], {color: getFactionColor(), weight: 6, opacity: 0.6}).addTo(map);
    }
    if (currentMode === 'draw_zone' && currentZonePoints.length > 0) {
        if (tempPolygon) map.removeLayer(tempPolygon);
        tempPolygon = L.polygon([...currentZonePoints, e.latlng], {color: getFactionColor(), weight: 3, opacity: 0.8, fillColor: getFactionColor(), fillOpacity: 0.4}).addTo(map);
    }
    if (currentMode === 'measure' && currentRoutePoints.length === 1) {
        let targetMap = (typeof morteroMap !== 'undefined' && morteroMap && window.location.pathname === '/mortero_app') ? morteroMap : map;
        if (measureLine) targetMap.removeLayer(measureLine);
        
        const p1 = currentRoutePoints[0];
        const p2 = e.latlng;
        measureLine = L.polyline([p1, p2], {color: '#ffff00', weight: 4, dashArray: '5, 5'}).addTo(targetMap);
        
        // Calibration: User noted 16m was actually 50m. 
        // Previously: pxDist = 32 pixels => 16m formula => pxDist/100 * 50 = 16 => pxDist = 32.
        // New correct formula: 1 grid (which is 32 px) = 50m.
        // So: meters = (pxDist / 32) * 50
        const pxDist = Math.sqrt(Math.pow(p2.lat - p1.lat, 2) + Math.pow(p2.lng - p1.lng, 2));
        const pixelsPerGrid = 32; 
        const meters = (pxDist / pixelsPerGrid) * 50;

        if (measurePopup) targetMap.removeLayer(measurePopup);
        
        const flagHtml = `<div style="color: #000; font-family: var(--font-mono); font-weight: bold; font-size: 0.8rem; white-space: nowrap; text-shadow: 1px 1px 0px #fff, -1px -1px 0px #fff, 1px -1px 0px #fff, -1px 1px 0px #fff;">${meters.toFixed(0)}m</div>`;
        const flagIcon = L.divIcon({ className: 'measure-flag', html: flagHtml, iconSize: null, iconAnchor: [-10, 15] });
        measurePopup = L.marker(p2, { icon: flagIcon, interactive: false }).addTo(targetMap);
    }
}


function handleMapDoubleClick(e) {
    if (currentMode === 'draw_route' && currentRoutePoints.length > 0) {
        currentRoutePoints.push(e.latlng); // add final point
        saveRoute(currentRoutePoints);
    }
    if (currentMode === 'draw_zone' && currentZonePoints.length > 0) {
        currentZonePoints.push(e.latlng); // add final point
        saveZone(currentZonePoints);
    }
}

function handleMapRightClick(e) {
    e.originalEvent.preventDefault();
    if (currentMode === 'draw_route' && currentRoutePoints.length > 0) {
        saveRoute(currentRoutePoints);
    } else if (currentMode === 'draw_zone' && currentZonePoints.length > 0) {
        saveZone(currentZonePoints);
    } else if (currentMode !== 'pan') {
        setMode('pan'); // Cancel current operation
    }
}

async function saveRoute(points) {
    if (points.length < 2) {
        setMode('pan');
        return;
    }
    const faccion_id = facciones.find(f => f.nombre === currentFaction).id;
    await fetch(`/api/mapa/rutas`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            faccion_id: faccion_id,
            nombre: 'Ruta ' + (drawnRoutes.length + 1),
            puntos_json: JSON.stringify(points),
            color: getFactionColor()
        })
    });
    setMode('pan');
    loadMapData();
}

async function saveZone(points) {
    if (points.length < 3) {
        setMode('pan');
        return;
    }
    pendingZonePoints = points;
    document.getElementById('zona-nombre').value = '';
    document.getElementById('zona-color').value = getFactionColor();
    document.getElementById('modal-zona').style.display = 'flex';
}

function renderZoneOnMap(pts, color, name, id) {
    const polygon = L.polygon(pts, {
        color: color, 
        weight: 3, 
        opacity: 0.8, 
        fillColor: color, 
        fillOpacity: 0.4
    }).addTo(map);

    if (['admin', 'mando', 'equipo'].includes(window.userRole) || window.location.pathname === '/mortero_app') {
        const deleteZone = async (e) => {
            if (e && e.originalEvent) e.originalEvent.preventDefault();
            if(confirm(`¿Borrar zona ${name || 'sin nombre'}?`)) {
                await fetch(`/api/mapa/zonas/${id}`, { method: 'DELETE' });
                loadMapData();
            }
        };
        polygon.on('contextmenu', deleteZone);
        polygon.on('dblclick', deleteZone);
    }

    let labelMarker = null;
    if (name) {
        // Calculate centroid for placing label
        let sumLat = 0, sumLng = 0;
        pts.forEach(ll => { sumLat += ll.lat; sumLng += ll.lng; });
        const center = [sumLat / pts.length, sumLng / pts.length];

        labelMarker = L.marker(center, {
            icon: L.divIcon({
                className: 'zone-label',
                html: `<div style="color: white; font-weight: bold; text-shadow: 1px 1px 2px black; font-size: 1.1em; text-align: center; white-space: nowrap;">${name}</div>`,
                iconSize: null,
            }),
            interactive: false
        }).addTo(map);
    }

    drawnZonas.push({ polygon, labelMarker, id });
}

document.querySelectorAll('.nav-icon-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const target = e.target.closest('button').dataset.target;
        if (target === 'view-mapa') {
            setTimeout(() => {
                initMap();
                map.invalidateSize();
                loadMapData();
            }, 100);
        }
    });
});

// Modal handling for Zonas
let pendingZonePoints = null;

document.getElementById('form-zona')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pendingZonePoints) return;
    
    const color = document.getElementById('zona-color').value;
    const name = document.getElementById('zona-nombre').value;
    const faccion_id = facciones.find(f => f.nombre === currentFaction).id;
    
    await fetch(`/api/mapa/zonas`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            faccion_id: faccion_id,
            nombre: name || '',
            puntos_json: JSON.stringify(pendingZonePoints),
            color: color
        })
    });
    
    document.getElementById('modal-zona').style.display = 'none';
    pendingZonePoints = null;
    setMode('pan');
    loadMapData();
});

document.getElementById('btn-cancel-zona')?.addEventListener('click', () => {
    document.getElementById('modal-zona').style.display = 'none';
    pendingZonePoints = null;
    setMode('pan');
});

// Modal handling for Marcador Intel ATAK
document.getElementById('form-intel')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!facciones || facciones.length === 0) return;
    const faccionObj = facciones.find(f => f.nombre === currentFaction);
    if (!faccionObj) {
        alert("Selecciona una facción específica antes de registrar el marcador.");
        return;
    }

    const lat = parseFloat(document.getElementById('intel-lat').value);
    const lng = parseFloat(document.getElementById('intel-lng').value);
    const tipo = document.getElementById('intel-tipo').value;
    const ttl = parseInt(document.getElementById('intel-ttl').value, 10);
    const desc = document.getElementById('intel-desc').value.trim();

    try {
        await fetch('/api/mapa/marcadores', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                faccion_id: faccionObj.id,
                tipo: tipo,
                lat: lat,
                lng: lng,
                descripcion: desc,
                ttl_minutos: ttl
            })
        });
        const modalIntel = document.getElementById('modal-intel');
        if (modalIntel) {
            modalIntel.classList.remove('active');
            modalIntel.style.display = 'none';
        }
        loadMapData();
    } catch(err) {
        console.error("Error registrando marcador intel:", err);
        alert("Error al registrar el marcador táctico.");
    }
});

document.getElementById('btn-cancel-intel')?.addEventListener('click', () => {
    const modalIntel = document.getElementById('modal-intel');
    if (modalIntel) {
        modalIntel.classList.remove('active');
        modalIntel.style.display = 'none';
    }
});

// BFT (Blue Force Tracking) Logic
async function transmitBFTBeacon() {
    if (!navigator.geolocation) {
        alert("La geolocalización GPS no está soportada o no está disponible en este dispositivo/navegador.");
        return;
    }

    const btnSide = document.getElementById('btn-transmit-bft');
    const btnFloat = document.getElementById('btn-floating-bft');
    const floatLabel = document.querySelector('#btn-floating-bft .bft-btn-label');

    const setBusy = (busy) => {
        if (btnSide) btnSide.disabled = busy;
        if (btnFloat) btnFloat.disabled = busy;
        if (floatLabel) floatLabel.innerText = busy ? "ENVIANDO..." : "EMITIR BFT";
    };

    setBusy(true);

    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            const gpsLat = pos.coords.latitude;
            const gpsLng = pos.coords.longitude;

            let faccion_id = undefined;
            if (typeof facciones !== 'undefined' && facciones && facciones.length > 0) {
                const fObj = facciones.find(f => f.nombre === currentFaction);
                if (fObj) faccion_id = fObj.id;
            }

            try {
                const res = await fetch('/api/bft/beacon', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        gps_lat: gpsLat,
                        gps_lng: gpsLng,
                        equipo_id: window.equipoId ? parseInt(window.equipoId) : undefined,
                        faccion_id: faccion_id
                    })
                });
                const data = await res.json();
                setBusy(false);

                if (!res.ok) {
                    alert(`Error transmitiendo baliza: ${data.error || 'Respuesta no válida'}`);
                    return;
                }

                if (data.en_zona === 1) {
                    alert(`✅ Baliza BFT transmitida al Mando.\n📍 Cuadrícula: ${data.grid_coord}\n🌐 GPS: ${gpsLat.toFixed(5)}, ${gpsLng.toFixed(5)}`);
                } else {
                    alert(`⚠️ AVISO BFT: Tu posición GPS (${gpsLat.toFixed(5)}, ${gpsLng.toFixed(5)}) está FUERA DE LA ZONA DE MISIÓN.\nSe ha registrado en telemetría HQ, pero no se dibuja dentro del plano satelital.`);
                }

                await loadBFTBeacons();
            } catch (err) {
                setBusy(false);
                console.error("Error transmitiendo baliza BFT:", err);
                alert("Error de red al transmitir la baliza BFT.");
            }
        },
        (error) => {
            setBusy(false);
            console.warn("Geolocation error:", error);
            let msg = "No se pudo obtener la posición GPS.";
            if (error.code === error.PERMISSION_DENIED) {
                msg = "Permiso GPS denegado. Permite el acceso a tu ubicación en el navegador (requiere conexión segura HTTPS).";
            } else if (error.code === error.POSITION_UNAVAILABLE) {
                msg = "Señal GPS no disponible temporalmente.";
            } else if (error.code === error.TIMEOUT) {
                msg = "Tiempo de espera agotado al consultar GPS.";
            }
            alert(msg);
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
}

async function loadBFTBeacons() {
    if (!map) return;
    let url = '/api/bft/beacons';
    if (window.userRole === 'admin' && currentFaction !== 'All' && typeof facciones !== 'undefined' && facciones && facciones.length > 0) {
        const faccionObj = facciones.find(f => f.nombre === currentFaction);
        if (faccionObj) url += `?faccion_id=${faccionObj.id}`;
    }

    try {
        const res = await fetch(url);
        if (!res.ok) return;
        const beacons = await res.json();

        // Limpiar balizas anteriores del mapa
        bftMarkers.forEach(m => map.removeLayer(m));
        bftMarkers = [];

        const outOfBoundsContainer = document.getElementById('bft-out-of-bounds-container');
        const outOfBoundsList = document.getElementById('bft-out-of-bounds-list');
        const outOfBoundsCount = document.getElementById('bft-out-of-bounds-count');
        if (outOfBoundsList) outOfBoundsList.innerHTML = '';
        let outCount = 0;

        beacons.forEach(b => {
            const elapsedStr = formatTiempoTranscurrido(b.segundos_transcurridos);
            const isFresh = b.segundos_transcurridos !== null && b.segundos_transcurridos < 180;
            const faccionColor = b.faccion_color || '#1E90FF';

            if (b.en_zona === 1 && b.map_lat !== null && b.map_lng !== null) {
                const pulseHtml = `
                    <div class="bft-beacon-container">
                        ${isFresh ? `<div class="bft-pulse-ring" style="background: ${faccionColor};"></div>` : ''}
                        <div class="bft-beacon-core" style="background: ${faccionColor}; opacity: ${isFresh ? '1' : '0.65'};">
                            <span class="material-symbols-outlined" style="font-size: 16px;">satellite_alt</span>
                        </div>
                        <div class="bft-team-label">${escapeHtml(b.equipo_nombre || 'Equipo')}</div>
                    </div>
                `;
                const icon = L.divIcon({
                    className: 'bft-div-icon',
                    html: pulseHtml,
                    iconSize: [32, 32],
                    iconAnchor: [16, 16]
                });
                const marker = L.marker([b.map_lat, b.map_lng], { icon: icon }).addTo(map);

                const popupHtml = `
                    <div class="tactical-card-header">
                        <span class="tactical-card-title" style="color: ${faccionColor};">
                            <span class="material-symbols-outlined" style="font-size: 16px;">satellite_alt</span>
                            ${escapeHtml(b.equipo_nombre)}
                        </span>
                        <span class="tactical-badge" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid ${faccionColor};">${b.grid_coord || '--'}</span>
                    </div>
                    <div class="tactical-card-body">
                        <div class="tactical-meta-row">
                            <span>📡 Facción: <strong>${escapeHtml(b.faccion_nombre)}</strong></span>
                            <span>⏱️ ${elapsedStr}</span>
                        </div>
                        <div class="tactical-meta-row" style="font-family: var(--font-mono); font-size: 0.72rem; color: #cbd5e1;">
                            <span>GPS Lat: ${b.gps_lat ? b.gps_lat.toFixed(5) : '--'}</span>
                            <span>Lng: ${b.gps_lng ? b.gps_lng.toFixed(5) : '--'}</span>
                        </div>
                        <div class="tactical-timer-box" style="justify-content: center; color: ${isFresh ? '#4ade80' : '#94a3b8'};">
                            <span>${isFresh ? '🟢 Baliza Activa en Tiempo Real' : '🟡 Señal Latente / Histórica'}</span>
                        </div>
                    </div>
                `;
                marker.bindPopup(popupHtml, { className: 'tactical-popup', maxWidth: 280 });
                bftMarkers.push(marker);
            } else {
                outCount++;
                if (outOfBoundsList) {
                    const item = document.createElement('div');
                    item.className = 'bft-out-item';
                    item.innerHTML = `
                        <div class="bft-out-item-top">
                            <span>${escapeHtml(b.equipo_nombre)}</span>
                            <span style="font-size: 0.68rem; color: #aaa;">Hace ${elapsedStr}</span>
                        </div>
                        <div class="bft-out-item-gps">
                            GPS: ${b.gps_lat ? b.gps_lat.toFixed(5) : '--'}, ${b.gps_lng ? b.gps_lng.toFixed(5) : '--'}
                        </div>
                        <div style="font-size: 0.65rem; color: #ffaa00; text-transform: uppercase;">
                            ⚠️ FUERA DE LA CARTA DE MISIÓN
                        </div>
                    `;
                    outOfBoundsList.appendChild(item);
                }
            }
        });

        if (outOfBoundsContainer && outOfBoundsCount) {
            outOfBoundsCount.innerText = outCount;
            if (outCount > 0) {
                outOfBoundsContainer.style.display = 'block';
            } else {
                outOfBoundsContainer.style.display = 'none';
            }
        }
    } catch(err) {
        console.error("Error cargando balizas BFT:", err);
    }
}

let radarMarkers = [];
async function loadRadarMarkers() {
    if (!facciones || facciones.length === 0) return;
    
    let url = '/api/mapa/radar';
    if (currentFaction !== 'All') {
        const faccionObj = facciones.find(f => f.nombre === currentFaction);
        if (!faccionObj) return;
        url = `/api/mapa/radar?faccion_id=${faccionObj.id}`;
    }

    try {
        const res = await fetch(url);
        const radares = await res.json();

        // Remove old radar markers
        radarMarkers.forEach(m => map.removeLayer(m));
        radarMarkers = [];

        radares.forEach(r => {
            const circle = L.circle([r.lat, r.lng], {
                color: 'red',
                fillColor: '#f03',
                fillOpacity: 0.2,
                radius: r.radio,
                weight: 2,
                dashArray: '5, 10'
            }).addTo(map);
            
            circle.bindPopup('<b>RADAR: Posible artillería enemiga</b>');
            radarMarkers.push(circle);
        });
    } catch(e) {
        console.error('Error loading radar markers', e);
    }
}

// Polling táctico ATAK: radares cada 5s, balizas BFT cada 5s
setInterval(loadRadarMarkers, 5000);
setInterval(loadBFTBeacons, 5000);

