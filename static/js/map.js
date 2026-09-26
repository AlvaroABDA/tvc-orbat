let map;
let imageOverlay;
let groupMarkers = {};
let currentMode = 'pan'; // pan, draw_route, measure, add_marker
let tempPolyline = null;
let measureLine = null;
let measurePopup = null;
let currentRoutePoints = [];
let currentZonePoints = [];
let drawnRoutes = [];
let drawnZonas = [];
let intelMarkers = [];
let tempPolygon = null;

// Initialize map only when the tab is shown to prevent rendering issues
function initMap() {
    if (map) return; // Already initialized

    // Setup map
    map = L.map('tactical-map', {
        crs: L.CRS.Simple,
        minZoom: -2,
        maxZoom: 2,
        zoomControl: false,
        doubleClickZoom: false // Disable so we can use double click for drawing
    });
    L.control.zoom({ position: 'topright' }).addTo(map);

    const bounds = [[0, 0], [2000, 3000]]; 
    imageOverlay = L.imageOverlay('/static/map/Full_Mapa%20Oct24.png', bounds).addTo(map);
    map.fitBounds(bounds);

    // Interaction handling
    map.on('click', handleMapClick);
    map.on('mousemove', handleMapMouseMove);
    map.on('dblclick', handleMapDoubleClick); 
    map.on('contextmenu', handleMapRightClick); 

    // Buttons
    if (window.userRole === 'admin' || window.userRole === 'mando') {
        document.getElementById('btn-draw-route').addEventListener('click', () => setMode('draw_route'));
        document.getElementById('btn-draw-zone').addEventListener('click', () => setMode('draw_zone'));
        document.getElementById('btn-measure').addEventListener('click', () => setMode('measure'));
        document.getElementById('btn-add-marker').addEventListener('click', () => setMode('add_marker'));
        document.getElementById('btn-add-tl-marker').addEventListener('click', () => setMode('add_tl_marker'));
    }

    loadMapData();
}

function setMode(mode) {
    currentMode = mode;
    document.getElementById('btn-draw-route').classList.remove('active');
    const drawZoneBtn = document.getElementById('btn-draw-zone');
    if (drawZoneBtn) drawZoneBtn.classList.remove('active');
    document.getElementById('btn-measure').classList.remove('active');
    document.getElementById('btn-add-marker').classList.remove('active');

    if (mode === 'draw_route') document.getElementById('btn-draw-route').classList.add('active');
    if (mode === 'draw_zone' && drawZoneBtn) drawZoneBtn.classList.add('active');
    if (mode === 'measure') document.getElementById('btn-measure').classList.add('active');
    if (mode === 'add_marker') document.getElementById('btn-add-marker').classList.add('active');
    if (mode === 'add_tl_marker') document.getElementById('btn-add-tl-marker').classList.add('active');

    if (mode === 'pan') {
        document.getElementById('tactical-map').style.cursor = 'grab';
    } else {
        document.getElementById('tactical-map').style.cursor = 'crosshair';
    }

    // Cleanups on mode switch
    currentRoutePoints = [];
    currentZonePoints = [];
    if (tempPolyline) { map.removeLayer(tempPolyline); tempPolyline = null; }
    if (tempPolygon) { map.removeLayer(tempPolygon); tempPolygon = null; }
    if (measureLine) { map.removeLayer(measureLine); measureLine = null; }
    if (measurePopup) { map.removeLayer(measurePopup); measurePopup = null; }
}

async function loadMapData() {
    // Render the groups sidebar
    const unplacedGroups = todosGrupos.filter(g => g.faccion_nombre === currentFaction && (g.pos_x == null || g.pos_y == null));
    const container = document.getElementById('map-units-container');
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

    // Load Routes and Markers from API
    const resR = await fetch(`/api/mapa/rutas?faccion_id=${facciones.find(f => f.nombre === currentFaction).id}`);
    const rutas = await resR.json();
    drawnRoutes.forEach(r => { map.removeLayer(r.line); if(r.decorator) map.removeLayer(r.decorator); });
    drawnRoutes = [];
    rutas.forEach(r => {
        const pts = JSON.parse(r.puntos_json);
        renderRouteOnMap(pts, r.color, r.id);
    });

    const resM = await fetch(`/api/mapa/marcadores?faccion_id=${facciones.find(f => f.nombre === currentFaction).id}`);
    const marcadores = await resM.json();
    intelMarkers.forEach(m => map.removeLayer(m));
    intelMarkers = [];
    marcadores.forEach(m => {
        const isTL = m.tipo === 'tl_pos';
        const className = isTL ? 'tl-marker' : 'intel-marker';
        const htmlIcon = isTL 
            ? `<div style="width: 14px; height: 14px; border-radius: 50%; background-color: ${getFactionColor()}; border: 2px solid white; box-shadow: 0 0 5px black; margin: auto;"></div>` 
            : `<div style="font-size: 24px;">📍</div>`;

        const intel = L.marker([m.lat, m.lng], {
            icon: L.divIcon({
                className: className,
                html: htmlIcon,
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            }),
            draggable: window.userRole === 'admin' || window.userRole === 'mando'
        }).addTo(map);

        intel.bindTooltip(m.descripcion, { permanent: true, direction: 'right', className: isTL ? 'tl-tooltip' : '' });

        if (window.userRole === 'admin' || window.userRole === 'mando') {
            intel.on('dragend', async (e) => {
                const pos = e.target.getLatLng();
                await fetch(`/api/mapa/marcadores/${m.id}`, {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ lat: pos.lat, lng: pos.lng })
                });
            });

            intel.on('contextmenu', async () => {
                if(confirm(`¿Borrar marcador ${isTL ? 'de posición (TL)' : 'Intel'}?`)) {
                    await fetch(`/api/mapa/marcadores/${m.id}`, { method: 'DELETE' });
                    loadMapData();
                }
            });
        }
        intelMarkers.push(intel);
    });

    const resZ = await fetch(`/api/mapa/zonas?faccion_id=${facciones.find(f => f.nombre === currentFaction).id}`);
    const zonas = await resZ.json();
    drawnZonas.forEach(z => {
        map.removeLayer(z.polygon);
        if(z.labelMarker) map.removeLayer(z.labelMarker);
    });
    drawnZonas = [];
    zonas.forEach(z => {
        const pts = JSON.parse(z.puntos_json);
        renderZoneOnMap(pts, z.color, z.nombre, z.id);
    });
}

function getFactionColor() {
    if (currentFaction === 'Syldavia') return '#cc0000'; // Red
    if (currentFaction === 'Volkovia') return '#1E90FF'; // Blue
    if (currentFaction === 'Khemed') return '#DAA520';   // Sand/Gold
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
        if (currentFaction === 'Syldavia') imgSrc = '/static/imgs/syldavia.png';
        if (currentFaction === 'Volkovia') imgSrc = '/static/imgs/vokovia.png';
        if (currentFaction === 'Khemed') imgSrc = '/static/imgs/khemed.png';
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

function renderRouteOnMap(pts, color, id) {
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

    // Right click to delete route
    if (window.userRole === 'admin' || window.userRole === 'mando') {
        const deleteRoute = async () => {
            if(confirm('¿Borrar esta ruta?')) {
                await fetch(`/api/mapa/rutas/${id}`, { method: 'DELETE' });
                loadMapData();
            }
        };
        line.on('contextmenu', deleteRoute);
        if(decorator) decorator.on('contextmenu', deleteRoute);
    }

    drawnRoutes.push({line, decorator, id});
}

function handleMapClick(e) {
    if (currentMode === 'pan') return;

    if (currentMode === 'add_marker') {
        const desc = prompt("Descripción del marcador de Inteligencia (ej. 'Contacto enemigo'):");
        if (desc) {
            const faccion_id = facciones.find(f => f.nombre === currentFaction).id;
            fetch(`/api/mapa/marcadores`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    faccion_id: faccion_id,
                    tipo: 'intel',
                    lat: e.latlng.lat,
                    lng: e.latlng.lng,
                    descripcion: desc
                })
            }).then(() => {
                setMode('pan');
                loadMapData();
            });
        } else {
            setMode('pan');
        }
    }
    else if (currentMode === 'add_tl_marker') {
        const desc = prompt("Nombre/Identificativo de la Posición (ej. 'Equipo Alfa'):");
        if (desc) {
            const faccion_id = facciones.find(f => f.nombre === currentFaction).id;
            fetch(`/api/mapa/marcadores`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    faccion_id: faccion_id,
                    tipo: 'tl_pos',
                    lat: e.latlng.lat,
                    lng: e.latlng.lng,
                    descripcion: desc
                })
            }).then(() => {
                setMode('pan');
                loadMapData();
            });
        } else {
            setMode('pan');
        }
    }
    else if (currentMode === 'draw_route') {
        currentRoutePoints.push(e.latlng);
        if (tempPolyline) {
            map.removeLayer(tempPolyline);
        }
        tempPolyline = L.polyline(currentRoutePoints, {color: getFactionColor(), weight: 6, opacity: 0.6}).addTo(map);
    }
    else if (currentMode === 'draw_zone') {
        currentZonePoints.push(e.latlng);
        if (tempPolygon) {
            map.removeLayer(tempPolygon);
        }
        tempPolygon = L.polygon(currentZonePoints, {color: getFactionColor(), weight: 3, opacity: 0.8, fillColor: getFactionColor(), fillOpacity: 0.4}).addTo(map);
    } 
    else if (currentMode === 'measure') {
        if (currentRoutePoints.length === 0) {
            currentRoutePoints.push(e.latlng);
        } else {
            // End of measurement
            setMode('pan'); // Reset everything (clears lines)
        }
    }
}

function handleMapMouseMove(e) {
    if (currentMode === 'draw_route' && currentRoutePoints.length > 0) {
        if (tempPolyline) map.removeLayer(tempPolyline);
        tempPolyline = L.polyline([...currentRoutePoints, e.latlng], {color: getFactionColor(), weight: 6, opacity: 0.6}).addTo(map);
    }
    if (currentMode === 'draw_zone' && currentZonePoints.length > 0) {
        if (tempPolygon) map.removeLayer(tempPolygon);
        tempPolygon = L.polygon([...currentZonePoints, e.latlng], {color: getFactionColor(), weight: 3, opacity: 0.8, fillColor: getFactionColor(), fillOpacity: 0.4}).addTo(map);
    }
    if (currentMode === 'measure' && currentRoutePoints.length === 1) {
        if (measureLine) map.removeLayer(measureLine);
        
        const p1 = currentRoutePoints[0];
        const p2 = e.latlng;
        measureLine = L.polyline([p1, p2], {color: '#ffff00', weight: 4, dashArray: '5, 5'}).addTo(map);
        
        // Calibration: User noted 16m was actually 50m. 
        // Previously: pxDist = 32 pixels => 16m formula => pxDist/100 * 50 = 16 => pxDist = 32.
        // New correct formula: 1 grid (which is 32 px) = 50m.
        // So: meters = (pxDist / 32) * 50
        const pxDist = Math.sqrt(Math.pow(p2.lat - p1.lat, 2) + Math.pow(p2.lng - p1.lng, 2));
        const pixelsPerGrid = 32; 
        const meters = (pxDist / pixelsPerGrid) * 50;

        if (measurePopup) map.removeLayer(measurePopup);
        measurePopup = L.popup({closeButton: false, autoClose: false, className: 'measure-popup'})
            .setLatLng(p2)
            .setContent(`Distancia: ${meters.toFixed(0)}m`)
            .openOn(map);
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

    if (window.userRole === 'admin' || window.userRole === 'mando') {
        polygon.on('contextmenu', async (e) => {
            e.originalEvent.preventDefault();
            if(confirm(`¿Borrar zona ${name || 'sin nombre'}?`)) {
                await fetch(`/api/mapa/zonas/${id}`, { method: 'DELETE' });
                loadMapData();
            }
        });
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

document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        if (e.target.dataset.target === 'view-mapa') {
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
