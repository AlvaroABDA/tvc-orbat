
// --- DOMINATION LOGIC ---
let dominationChart = null;

async function loadDomination() {
    try {
        const res = await fetch('/api/capturas/stats');
        const data = await res.json();
        
        // 1. Update PCS
        const pcsContainer = document.getElementById('dom-pcs-container');
        if (pcsContainer) {
            pcsContainer.innerHTML = '';
            for (const [poiId, stats] of Object.entries(data.stats_puntos)) {
                let ownerText = 'Neutral / Desocupado';
                let ownerColor = '#aaa';
                if (stats.owner_actual === 1) { ownerText = 'Syldavia'; ownerColor = 'var(--color-syldavia)'; }
                if (stats.owner_actual === 2) { ownerText = 'Volkovia'; ownerColor = 'var(--color-volkovia)'; }
                
                const syldaviaMins = Math.round(stats.tiempos[1] || 0);
                const volkoviaMins = Math.round(stats.tiempos[2] || 0);
                
                pcsContainer.innerHTML += `
                    <div style="padding: 10px; background: rgba(0,0,0,0.3); border-left: 4px solid ${ownerColor}; border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="font-weight: bold; color: #fff;">${stats.nombre}</div>
                            <div style="font-size: 0.8rem; color: ${ownerColor};">Control actual: ${ownerText}</div>
                        </div>
                        <div style="text-align: right; font-size: 0.8rem; font-family: var(--font-mono);">
                            <span style="color: var(--color-syldavia)">Syl: ${syldaviaMins}m</span><br>
                            <span style="color: var(--color-volkovia)">Vol: ${volkoviaMins}m</span>
                        </div>
                    </div>
                `;
            }
        }
        
        // 2. Update Total Times
        const sylTotal = Math.round(data.total_facciones[1] || 0);
        const volTotal = Math.round(data.total_facciones[2] || 0);
        const elSyl = document.getElementById('dom-syl-time');
        const elVol = document.getElementById('dom-vol-time');
        if(elSyl) elSyl.innerText = sylTotal;
        if(elVol) elVol.innerText = volTotal;
        
        // 3. Update Chart
        const ctx = document.getElementById('dominationChart');
        if (ctx) {
            if (dominationChart) {
                dominationChart.data.datasets[0].data = [sylTotal, volTotal];
                dominationChart.update();
            } else {
                dominationChart = new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels: ['Syldavia', 'Volkovia'],
                        datasets: [{
                            data: [sylTotal, volTotal],
                            backgroundColor: ['#e2b938', '#4388cc'], // Syldavia yellow, Volkovia blue
                            borderWidth: 0
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'bottom', labels: { color: '#ccc' } }
                        }
                    }
                });
            }
        }
        
        // 4. Update Admin Log
        const logTbody = document.getElementById('dom-log-tbody');
        if (logTbody) {
            logTbody.innerHTML = '';
            data.historial.forEach(h => {
                let facName = h.faccion_id === 1 ? 'Syldavia' : (h.faccion_id === 2 ? 'Volkovia' : (h.faccion_id === 3 ? 'Khemed' : (h.faccion_id === 0 || !h.faccion_id ? 'Neutral' : h.faccion_id)));
                let facColor = h.faccion_id === 1 ? 'var(--color-syldavia)' : (h.faccion_id === 2 ? 'var(--color-volkovia)' : (h.faccion_id === 3 ? 'var(--color-khemed)' : '#aaa'));
                let equipoStr = h.equipo_nombre && h.equipo_nombre !== 'Desconocido' ? `<br><span style="font-size: 0.8rem; color: #888;">${h.equipo_nombre}</span>` : '';
                logTbody.innerHTML += `
                    <tr>
                        <td style="font-family: var(--font-mono); font-size: 1rem; color: #aaa;">${h.timestamp.split(" ")[1]}</td>
                        <td>${h.poi_nombre}</td>
                        <td style="color: ${facColor}; font-weight: bold;">${facName} ${equipoStr}</td>
                    </tr>
                `;
            });
        }
        
        // 5. Update Respawn Log
        const respawnTbody = document.getElementById('dom-respawn-tbody');
        if (respawnTbody && data.historial_respawns) {
            respawnTbody.innerHTML = '';
            data.historial_respawns.forEach(r => {
                let facColor = r.faccion_id === 1 ? 'var(--color-syldavia)' : (r.faccion_id === 2 ? 'var(--color-volkovia)' : (r.faccion_id === 3 ? 'var(--color-khemed)' : '#aaa'));
                respawnTbody.innerHTML += `
                    <tr>
                        <td style="font-family: var(--font-mono); font-size: 0.8rem;">${r.timestamp}</td>
                        <td>${r.poi_nombre}</td>
                        <td style="color: ${facColor}; font-weight: bold;">${r.equipo_nombre}</td>
                    </tr>
                `;
            });
        }
        
    } catch(e) {
        console.error("Error loading domination stats", e);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    // Detect if we are in the dedicated Mortero app (no ORBAT view present)
    const isMorteroApp = document.getElementById('view-mortero') && !document.getElementById('view-orbat');
    
    if (isMorteroApp) {
        const appData = document.getElementById('app-data');
        if (appData) {
            window.userRole = appData.dataset.role;
            window.userFaction = appData.dataset.faction;
        }
        initMortero();
        return; // Skip all other SPA initializations
    }

    initNavigation();
    initTabs();
    initOrbatMobileFilters();
    await loadFacciones();
    await loadEquipos();
    if(window.userRole === "admin") await loadPOIs();
    await loadORBAT();
    initMortero();
    initModal();
    initCrudMision();
    initMinigameAuth();
});

// --- NAVIGATION & TABS ---
function initNavigation() {
    const btns = document.querySelectorAll('.nav-icon-btn');
    const sections = document.querySelectorAll('.view-section');

    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('minigame-locked')) {
                const targetId = btn.dataset.target; // Not used immediately, but identifies minigame
                const minigame = btn.dataset.minigame;
                document.getElementById('minigame-target').value = minigame;
                document.getElementById('minigame-password').value = '';
                document.getElementById('minigame-error').style.display = 'none';
                document.getElementById('minigame-auth-modal').style.display = 'flex';
                document.getElementById('minigame-password').focus();
                return;
            }

            btns.forEach(b => b.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));
            
            btn.classList.add('active');
            // Auto scroll active button into view on mobile bottom bar
            if (window.innerWidth <= 768) {
                btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
            const targetId = btn.dataset.target;
            if (targetId) {
                const targetElement = document.getElementById(targetId);
                if (targetElement) {
                    targetElement.classList.add('active');
                }
            }
            
            if (targetId === 'view-mapa') {
                setTimeout(() => {
                    if (typeof initMap === 'function') initMap();
                    if (typeof map !== 'undefined' && map) map.invalidateSize();
                    if (typeof loadMapData === 'function') loadMapData();
                }, 100);
            }
            if (targetId === 'view-mortero' && typeof morteroMap !== 'undefined' && morteroMap) {
                setTimeout(() => morteroMap.invalidateSize(), 100);
            }
        });
    });

    // Prevenir doble toque accidental que dispare el zoom de iOS Safari en botones e interfaz
    document.addEventListener('dblclick', (e) => {
        if (!e.target.closest('#tactical-map, .leaflet-container, .quill')) {
            e.preventDefault();
        }
    }, { passive: false });

    const sidebarBtns = document.querySelectorAll('.sidebar-tab');
    const sidebarPanels = document.querySelectorAll('.sidebar-content');
    sidebarBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            sidebarBtns.forEach(b => b.classList.remove('active'));
            sidebarPanels.forEach(p => p.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(btn.dataset.target).classList.add('active');

            // En móvil, al pulsar una pestaña abrir el drawer si estaba cerrado
            const drawer = document.getElementById('orbat-sidebar-panel');
            if (drawer && window.innerWidth <= 768 && !drawer.classList.contains('drawer-open')) {
                drawer.classList.add('drawer-open');
                const arrow = document.getElementById('mobile-drawer-arrow');
                if (arrow) arrow.textContent = 'keyboard_arrow_down';
            }
        });
    });
}

function toggleMobileOrbatDrawer() {
    const drawer = document.getElementById('orbat-sidebar-panel');
    const backdrop = document.getElementById('orbat-drawer-backdrop');
    const arrow = document.getElementById('mobile-drawer-arrow');
    const trayBtn = document.getElementById('btn-toggle-tray');
    if (!drawer) return;
    const isOpen = drawer.classList.toggle('drawer-open');
    if (backdrop) {
        backdrop.classList.toggle('active', isOpen);
    }
    if (arrow) {
        arrow.textContent = isOpen ? 'keyboard_arrow_down' : 'keyboard_arrow_up';
    }
    if (trayBtn) {
        trayBtn.classList.toggle('active', isOpen);
    }
}
window.toggleMobileOrbatDrawer = toggleMobileOrbatDrawer;

function initOrbatMobileFilters() {
    const filterBtns = document.querySelectorAll('.orbat-filter-btn');
    const container = document.getElementById('orbat-tree-container');
    if (!filterBtns.length || !container) return;
    filterBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetBtn = e.currentTarget;
            const filter = targetBtn.dataset.filter;
            filterBtns.forEach(b => b.classList.remove('active'));
            targetBtn.classList.add('active');
            container.classList.remove('filter-all', 'filter-mando', 'filter-goe', 'filter-gad');
            container.classList.add(`filter-${filter}`);
        });
    });
}

function initMinigameAuth() {
    const btn = document.getElementById('btn-auth-minigame');
    const input = document.getElementById('minigame-password');
    if (!btn || !input) return;
    
    const tryAuth = async () => {
        const password = input.value.trim();
        const minigame = document.getElementById('minigame-target').value;
        if (!password) return;
        
        try {
            const res = await fetch('/api/auth_minigame', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ minigame, password })
            });
            const data = await res.json();
            
            if (data.success) {
                // Remove lock class and switch to it
                document.getElementById('minigame-auth-modal').style.display = 'none';
                const navBtn = document.querySelector(`.nav-icon-btn[data-minigame="${minigame}"]`);
                if (navBtn) {
                    if (minigame === 'mortero') {
                        window.location.href = '/mortero_app';
                    } else {
                        navBtn.classList.remove('minigame-locked');
                        navBtn.click(); // switch to it
                    }
                }
            } else {
                document.getElementById('minigame-error').style.display = 'block';
                document.getElementById('minigame-error').innerText = data.message || 'CÓDIGO INCORRECTO';
            }
        } catch (err) {
            console.error(err);
        }
    };
    
    btn.addEventListener('click', tryAuth);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') tryAuth();
    });
}

let currentFaction = window.userFaction && window.userFaction !== 'All' ? window.userFaction : 'Syldavia';

function initTabs() {
    const tabs = document.querySelectorAll('.faction-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFaction = tab.dataset.faction;
            document.body.setAttribute('data-theme', currentFaction);
            renderTree();
            renderUnassigned();
            if (typeof loadMapData === 'function') {
                loadMapData();
            }
        });
    });
    // Set initial theme
    document.body.setAttribute('data-theme', currentFaction);
}

// --- DATA FETCHING ---
let facciones = [];
let todosGrupos = [];
let todasAsignaciones = [];
let todosEquipos = [];
let todasMisiones = [];

async function loadFacciones() {
    const res = await fetch('/api/facciones');
    facciones = await res.json();
    

    const selectPoi = document.getElementById('poi-faccion');
    const containerVisible = document.getElementById('poi-visible-container');
    if (selectPoi) {
        selectPoi.innerHTML = '<option value="">(Ninguna / Neutral)</option>';
        if (containerVisible) containerVisible.innerHTML = '';
        facciones.forEach(f => {
            selectPoi.innerHTML += `<option value="${f.id}">${f.nombre}</option>`;
            if (containerVisible) {
                containerVisible.innerHTML += `<label style="display:flex; align-items:center; gap:5px;"><input type="checkbox" class="poi-visible-cb" value="${f.id}" checked> ${f.nombre}</label>`;
            }
        });
    }

    const select = document.getElementById('eq-faccion');
    if (select) {
        select.innerHTML = '';
        facciones.forEach(f => {
            select.innerHTML += `<option value="${f.id}">${f.nombre}</option>`;
        });
    }
}

async function loadEquipos() {
    const res = await fetch('/api/equipos');
    todosEquipos = await res.json();
    renderEquiposTable(todosEquipos);
    renderUnassigned();
}

async function loadORBAT() {
    const res = await fetch('/api/orbat');
    const data = await res.json();
    todosGrupos = data.grupos;
    todasAsignaciones = data.asignaciones;
    
    // Load missions for the dropdown/dragdrop and table
    const resMis = await fetch('/api/misiones');
    todasMisiones = await resMis.json();
    
    renderTree();
    renderUnassigned();
    renderMisionesTable(todasMisiones);
    
    // Fill captura map select
    const capturaSelect = document.getElementById('captura-mision-id');
    if (capturaSelect) {
        const currentVal = capturaSelect.value;
        capturaSelect.innerHTML = '<option value="">Seleccionar Misión...</option>';
        todasMisiones.forEach(m => {
            capturaSelect.innerHTML += `<option value="${m.id}">${m.nombre}</option>`;
        });
        if (currentVal) capturaSelect.value = currentVal;
    }
    
    loadEsquemasAdmin();
}

async function loadEsquemasAdmin() {
    try {
        const res = await fetch('/api/mapa/esquemas');
        const esquemas = await res.json();
        const select = document.getElementById('mis-esquema');
        if(select) {
            const currentVal = select.value;
            select.innerHTML = '<option value="">(Sin mapa táctico)</option>';
            esquemas.forEach(e => {
                select.innerHTML += `<option value="${e.id}">${e.nombre}</option>`;
            });
            if (currentVal) select.value = currentVal;
        }
    } catch(e) {
        console.error("Error al cargar esquemas:", e);
    }
}

// --- RENDERING ORBAT TREE ---
function renderTree() {
    const container = document.getElementById('orbat-tree-container');
    container.innerHTML = '';

    // Filter data for current faction
    const grupos = todosGrupos.filter(g => g.faccion_nombre === currentFaction);
    
    let totalFactionPax = 0;
    grupos.forEach(g => {
        const teamsInGroup = todasAsignaciones.filter(a => a.grupo_batalla_id === g.id);
        totalFactionPax += teamsInGroup.reduce((sum, a) => sum + a.jugadores, 0);
    });
    
    

    if(grupos.length === 0) return;

    const mandoGroup = grupos.find(g => g.es_mando);
    const goeGroups = grupos.filter(g => g.tipo === 'GOE' && !g.es_mando);
    const gadGroups = grupos.filter(g => g.tipo === 'GAD' && !g.es_mando);

    // Actualizar conteos en selector táctico móvil
    const countMando = document.getElementById('count-filter-mando');
    const countGoe = document.getElementById('count-filter-goe');
    const countGad = document.getElementById('count-filter-gad');
    if (countMando) countMando.textContent = `(${mandoGroup ? 1 : 0})`;
    if (countGoe) countGoe.textContent = `(${goeGroups.length})`;
    if (countGad) countGad.textContent = `(${gadGroups.length})`;

    let html = '';

    // 1. MANDO
    if(mandoGroup) {
        html += `
            <div class="mando-section section-mando">
                ${renderCard(mandoGroup, true, totalFactionPax)}
            </div>
        `;
    }

    // 2. SPLIT GOE/GAD
    html += `
        <div class="tree-split">
            <div class="tree-column column-goe">
                <div class="tree-column-title">GOE</div>
                ${goeGroups.map(g => renderCard(g, false)).join('')}
            </div>
            <div class="tree-column column-gad">
                <div class="tree-column-title">GAD</div>
                ${gadGroups.map(g => renderCard(g, false)).join('')}
            </div>
        </div>
    `;

    container.innerHTML = html;
    initDragAndDrop();
    initInlineEditing();
}

function renderCard(g, isMando, totalFactionPax = 0) {
    const teamsInGroup = todasAsignaciones.filter(a => a.grupo_batalla_id === g.id);
    const totalJugadores = teamsInGroup.reduce((sum, a) => sum + a.jugadores, 0);

    // Map images dynamically based on group name
    let logoHtml = '';
    let imgSrc = null;
    
    if (isMando) {
        if (currentFaction === 'Syldavia') imgSrc = '/static/imgs/syldavia_blanco.png';
        if (currentFaction === 'Volkovia') imgSrc = '/static/imgs/vokovia_blanco.png';
        if (currentFaction === 'Khemed') imgSrc = '/static/imgs/khemed_blanco.png';
    } else {
        const nameParts = g.nombre.split(' '); // e.g. "Sierra Alfa" -> ["Sierra", "Alfa"]
        if (nameParts.length === 2) {
            const prefix = nameParts[0].toLowerCase();
            const letter = nameParts[1].toLowerCase().charAt(0);
            
            if (prefix === 'sierra') {
                imgSrc = `/static/imgs/s${letter}.png`;
            } else if (prefix === 'victor') {
                imgSrc = `/static/imgs/v${letter}.png`;
            } else if (prefix === 'kilo') {
                imgSrc = `/static/imgs/k${letter}.png`;
            }
        }
    }

    if (imgSrc) {
        logoHtml = `<div class="grupo-logo" style="background-image: url('${imgSrc}'); background-color: transparent; border: none;"></div>`;
    } else {
        let logoIcon = isMando ? 'shield' : (g.tipo === 'GOE' ? 'crisis_alert' : 'swords');
        logoHtml = `<div class="grupo-logo" style="display:flex; justify-content:center; align-items:center; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:6px;"><span class="material-symbols-outlined" style="font-size:1.4rem; color:var(--theme-color);">${logoIcon}</span></div>`;
    }
    
    const phoneLabel = isMando ? 'Línea Baja' : 'Contacto Mando';

    // For Mando, don't show droppable area, missions, or stats. Show 'nombre_jefe'.
    const isMandoCard = isMando; // just for clarity
    const statsHtml = isMandoCard ? '' : `<span class="grupo-pax ${currentFaction}"><span id="stats-${g.id}">${totalJugadores}</span> PAX</span>`;

    let extraFieldsHtml = '';
    if (isMandoCard) {
        const faccionData = facciones.find(f => f.id === g.faccion_id);
        let opordButtons = '';
        if (faccionData) {
            if (faccionData.opord_pdf) {
                opordButtons += `<a href="${faccionData.opord_pdf}" target="_blank" class="btn primary" style="padding: 4px 8px; font-size: 0.85em; text-decoration: none; display: inline-flex; align-items: center; gap: 5px;"><span class="material-symbols-outlined" style="font-size: 1.1em;">picture_as_pdf</span> Ver OPORD</a>`;
            }
            if (faccionData.opord_esquema_json) {
                const encodedEsquema = encodeURIComponent(faccionData.opord_esquema_json);
                opordButtons += `<button onclick="event.stopPropagation(); verEsquema(decodeURIComponent('${encodedEsquema}'))" class="btn primary" style="padding: 4px 8px; font-size: 0.85em; display: inline-flex; align-items: center; gap: 5px;"><span class="material-symbols-outlined" style="font-size: 1.1em;">map</span> Ver Mapa OPORD</button>`;
            }
            if (window.userRole === 'admin') {
                opordButtons += `<button onclick="event.stopPropagation(); openOpordModal(${g.faccion_id})" class="btn secondary" style="padding: 4px 8px; font-size: 0.85em; margin-left: auto; display: inline-flex; align-items: center; gap: 5px;"><span class="material-symbols-outlined" style="font-size: 1.1em;">edit</span> Gestionar OPORD</button>`;
            }
        }

        extraFieldsHtml = `
            <div class="editable-field" style="margin-top: 5px;">
                <label>Cmdt</label>
                <input type="text" class="input-inline update-grupo" data-id="${g.id}" data-field="nombre_jefe" value="${g.nombre_jefe || ''}" placeholder="Nombre del mando">
            </div>
            <div class="mando-opord-actions">
                ${opordButtons}
            </div>
        `;
    }

    // Missions logic is now Drag&Drop. If group has a mission, render it inside the droppable-area.
    const hasMission = g.mision_actual_id !== null;
    const assignedMission = todasMisiones.find(m => m.id === g.mision_actual_id);
    let assignedMissionHtml = '';
    
    if (assignedMission && !isMandoCard) {
        let snapshotHtml = '';
        if (assignedMission.esquema_json && (assignedMission.revelada || window.userRole === 'admin' || window.userRole === 'mando')) {
            const encodedEsquema = encodeURIComponent(assignedMission.esquema_json);
            snapshotHtml = `<button onclick="event.stopPropagation(); verEsquema(decodeURIComponent('${encodedEsquema}'))" style="display:inline-block; margin-top:5px; background:rgba(255,255,255,0.1); padding:2px 5px; border-radius:3px; font-size:0.75em; text-decoration:none; color:var(--theme-color); border:none; cursor:pointer;"><span class="material-symbols-outlined" style="font-size:1em; vertical-align:middle;">map</span> Ver Mapa</button>`;
        }
        const encodedMission = encodeURIComponent(JSON.stringify(assignedMission));
        assignedMissionHtml = `
            <div class="mision-card" draggable="true" onclick="verInformeMision(JSON.parse(decodeURIComponent('${encodedMission}')))" data-mision-id="${assignedMission.id}">
                <strong style="text-transform: uppercase;">[MSN] ${assignedMission.tipo}</strong>
                <div style="font-size: 0.85em; font-weight: bold; margin-bottom: 2px;">${assignedMission.nombre}</div>
                <div>${assignedMission.etiquetas || ''}</div>
                ${snapshotHtml}
            </div>
        `;
    }

    const droppableHtml = isMandoCard ? '' : `
        <div class="grupo-drop-zones">
            <div class="droppable-area-wrapper equipos-zone">
                <div class="zone-label">Equipos (${teamsInGroup.filter(t => t.estado === 'Aprobada').length})</div>
                <div class="droppable-area" style="cursor:pointer;" onclick="openAssignModal('${g.id}', 'equipo')" data-grupo-id="${g.id}" data-type="equipo">
                    ${teamsInGroup.map(t => {
                        if (t.estado === 'Pendiente') {
                            if (window.userRole === 'admin') {
                                return `
                                    <div class="equipo-card pendiente" data-equipo-id="${t.equipo_id}" style="border: 2px dashed #ffaa00; background: rgba(255,170,0,0.1);">
                                        <div>
                                            <strong>${t.equipo_nombre} (PENDIENTE)</strong>
                                            <div class="equipo-details">Solicita unirse.</div>
                                        </div>
                                        <div style="display: flex; gap: 5px;">
                                            <button onclick="event.stopPropagation(); resolverSolicitud(${t.id}, 'aprobar')" class="btn primary" style="padding: 2px 5px; font-size: 0.7em;">Aprobar</button>
                                            <button onclick="event.stopPropagation(); resolverSolicitud(${t.id}, 'rechazar')" class="btn danger" style="padding: 2px 5px; font-size: 0.7em;">Rechazar</button>
                                        </div>
                                    </div>
                                `;
                            } else {
                                return `
                                    <div class="equipo-card pendiente" data-equipo-id="${t.equipo_id}" style="border: 1px dashed #ffaa00; opacity: 0.8;">
                                        <div>
                                            <strong>${t.equipo_nombre} <span style="color:#ffaa00; font-size:0.8em;">(Pendiente...)</span></strong>
                                        </div>
                                    </div>
                                `;
                            }
                        } else {
                            return `
                                <div class="equipo-card" data-equipo-id="${t.equipo_id}" onclick="unassignItem(event, 'equipo', '${t.equipo_id}', '${g.id}')">
                                    <div>
                                        <strong>${t.equipo_nombre}</strong>
                                        <div class="equipo-details">Rol Preferido: ${todosEquipos.find(e => e.id === t.equipo_id)?.tipo || 'N/A'}</div>
                                        ${ (t.apoyos > 0 || t.snipers > 0) ? `<div style="font-size: 0.7em; margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px;">${t.apoyos > 0 ? `<span style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15); padding: 2px 6px; border-radius: 3px; display: inline-flex; align-items: center; gap: 3px;"><span class="material-symbols-outlined" style="font-size: 0.85rem; color: var(--theme-color);">shield</span> ${t.apoyos} Apoyo</span>` : ''}${t.snipers > 0 ? `<span style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15); padding: 2px 6px; border-radius: 3px; display: inline-flex; align-items: center; gap: 3px;"><span class="material-symbols-outlined" style="font-size: 0.85rem; color: var(--theme-color);">crisis_alert</span> ${t.snipers} Sniper</span>` : ''}</div>` : '' }
                                    </div>
                                    <span>${t.jugadores} px</span>
                                </div>
                            `;
                        }
                    }).join('')}
                    ${ (window.userRole === 'equipo' && !todasAsignaciones.find(a => a.equipo_id == window.equipoId && a.estado === 'Aprobada') && !todasAsignaciones.find(a => a.equipo_id == window.equipoId && a.grupo_batalla_id === g.id && a.estado === 'Pendiente')) ? 
                        `<div style="text-align: center; margin-top: 5px;"><button class="btn warning" style="width: 100%; font-size:0.8em; padding: 4px;" onclick="event.stopPropagation(); solicitarUnirse(${g.id})">Solicitar Integración</button></div>` 
                        : '' }
                </div>
            </div>
            
            <div class="droppable-area-wrapper misiones-zone">
                <div class="zone-label">Misión Activa</div>
                <div class="droppable-area" style="cursor:pointer;" onclick="openAssignModal('${g.id}', 'mision')" data-grupo-id="${g.id}" data-type="mision">
                    ${assignedMissionHtml}
                </div>
            </div>
        </div>
    `;

    if (isMandoCard) {
        let bigLogoHtml = '';
        if (imgSrc) {
            bigLogoHtml = `<div class="mando-logo-img" style="background-image: url('${imgSrc}');"></div>`;
        } else {
            bigLogoHtml = `<div class="mando-logo-symbol" style="display:flex; justify-content:center; align-items:center;"><span class="material-symbols-outlined" style="font-size:2.4rem; color:var(--theme-color);">shield</span></div>`;
        }

        return `
            <div class="grupo-card mando-card">
                <div class="mando-header-row">
                    <div class="mando-logo-container">
                        ${bigLogoHtml}
                    </div>
                    <div class="mando-title-pax">
                        <span class="mando-title">${g.nombre}</span>
                        <span class="mando-pax-badge"><span class="material-symbols-outlined" style="font-size:0.95rem; vertical-align:middle;">groups</span> <span id="orbat-total-pax-value">${totalFactionPax}</span> PAX</span>
                    </div>
                </div>
                <div class="mando-content">
                    <div class="grupo-info">
                        <div class="editable-field">
                            <label>CH</label>
                            <select class="input-inline update-grupo-radio" data-id="${g.id}" style="font-family: var(--font-ui); background: rgba(0,0,0,0.1); border: 1px dashed transparent; color: var(--text-main);">
                                ${Array.from({length: 16}, (_, i) => i + 1).map(ch => 
                                    `<option value="Ch.${ch.toString().padStart(2, '0')}" ${g.canal_radio === `Ch.${ch.toString().padStart(2, '0')}` ? 'selected' : ''}>Ch.${ch.toString().padStart(2, '0')}</option>`
                                ).join('')}
                            </select>
                            <span class="frecuencia-hint" id="freq-${g.id}">${g.frecuencia_radio || ''}</span>
                        </div>
                        <div class="editable-field">
                            <label>TEL</label>
                            <input type="text" class="input-inline update-grupo" data-id="${g.id}" data-field="telefono_contacto" value="${g.telefono_contacto || ''}" placeholder="${phoneLabel}">
                        </div>
                        ${extraFieldsHtml}
                    </div>
                    ${droppableHtml}
                </div>
            </div>
        `;
    }

    return `
        <div class="grupo-card">
            <div class="grupo-header">
                <span class="grupo-nombre">${g.nombre}</span>
                ${statsHtml}
            </div>
            <div class="grupo-body">
                ${logoHtml}
                <div class="grupo-info">
                    <div class="editable-field">
                        <label>CH</label>
                        <select class="input-inline update-grupo-radio" data-id="${g.id}" style="font-family: var(--font-ui); background: rgba(0,0,0,0.1); border: 1px dashed transparent; color: var(--text-main);">
                            ${Array.from({length: 16}, (_, i) => i + 1).map(ch => 
                                `<option value="Ch.${ch.toString().padStart(2, '0')}" ${g.canal_radio === `Ch.${ch.toString().padStart(2, '0')}` ? 'selected' : ''}>Ch.${ch.toString().padStart(2, '0')}</option>`
                            ).join('')}
                        </select>
                        <span class="frecuencia-hint" id="freq-${g.id}">${g.frecuencia_radio || ''}</span>
                    </div>
                    <div class="editable-field">
                        <label>TEL</label>
                        <input type="text" class="input-inline update-grupo" data-id="${g.id}" data-field="telefono_contacto" value="${g.telefono_contacto || ''}" placeholder="${phoneLabel}">
                    </div>
                    ${extraFieldsHtml}
                </div>
            </div>
            ${droppableHtml}
        </div>
    `;
}

function renderUnassigned() {
    const unassignedContainer = document.getElementById('unassigned-teams');
    
    unassignedContainer.innerHTML = '';
    
    const assignedIds = todasAsignaciones.map(a => a.equipo_id);
    // Only show unassigned teams from the CURRENT faction for cleaner UI
    const unassigned = todosEquipos.filter(eq => !assignedIds.includes(eq.id) && eq.faccion_nombre === currentFaction);

    // Actualizar indicador de contador en cabecera del cajón móvil
    const drawerTitle = document.getElementById('mobile-drawer-title');
    if (drawerTitle) {
        drawerTitle.textContent = `BANDEJA SIN ASIGNAR (${unassigned.length})`;
    }
    const trayBtnCount = document.getElementById('tray-btn-count');
    if (trayBtnCount) {
        trayBtnCount.textContent = unassigned.length;
    }

    unassigned.forEach(eq => {
        unassignedContainer.innerHTML += `
            <div class="equipo-card" data-equipo-id="${eq.id}" onclick="unassignItem(event, 'equipo', '${eq.id}', null)">
                <div>
                    <strong>${eq.nombre}</strong>
                    <div class="equipo-details">Perfil: ${eq.tipo}</div>
                    ${ (eq.apoyos > 0 || eq.snipers > 0) ? `<div style="font-size: 0.7em; margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px;">${eq.apoyos > 0 ? `<span style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15); padding: 2px 6px; border-radius: 3px; display: inline-flex; align-items: center; gap: 3px;"><span class="material-symbols-outlined" style="font-size: 0.85rem; color: var(--theme-color);">shield</span> ${eq.apoyos} Apoyo</span>` : ''}${eq.snipers > 0 ? `<span style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15); padding: 2px 6px; border-radius: 3px; display: inline-flex; align-items: center; gap: 3px;"><span class="material-symbols-outlined" style="font-size: 0.85rem; color: var(--theme-color);">crisis_alert</span> ${eq.snipers} Sniper</span>` : ''}</div>` : '' }
                </div>
                <span>${eq.jugadores} px</span>
            </div>
        `;
    });

    const unassignedMissionsContainer = document.getElementById('unassigned-missions');
    if (unassignedMissionsContainer) {
        unassignedMissionsContainer.innerHTML = '';
    }
    
    // Find missions that are already assigned to ANY group
    const assignedMissionIds = todosGrupos.map(g => g.mision_actual_id).filter(id => id !== null);
    const unassignedMissions = todasMisiones.filter(m => m.persistente || !assignedMissionIds.includes(m.id));

    if (unassignedMissionsContainer) {
        unassignedMissions.forEach(m => {
            unassignedMissionsContainer.innerHTML += `
                <div class="mision-card" draggable="true" data-mision-id="${m.id}" data-obj='${JSON.stringify(m)}'>
                    <strong style="text-transform: uppercase;">[MSN] ${m.tipo}</strong>
                    <div style="font-size: 0.85em; font-weight: bold; margin-bottom: 2px;">${m.nombre}</div>
                    <div>${m.etiquetas || ''}</div>
                </div>
            `;
        });
    }

    initDragAndDrop(); // Re-bind since DOM changed
    initMisionModals();
}

// --- INLINE EDITING ---
function initInlineEditing() {
    const inputs = document.querySelectorAll('.update-grupo');
    inputs.forEach(input => {
        input.addEventListener('change', async (e) => {
            const id = e.target.dataset.id;
            const field = e.target.dataset.field;
            const val = e.target.value;
            
            const currentData = todosGrupos.find(g => g.id == id);
            const payload = {
                canal_radio: currentData.canal_radio,
                frecuencia_radio: currentData.frecuencia_radio,
                telefono_contacto: currentData.telefono_contacto,
                mision_actual_id: currentData.mision_actual_id,
                nombre_jefe: currentData.nombre_jefe
            };
            payload[field] = val;

            const res = await fetch(`/api/orbat/grupo/${id}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            
            if(field === 'canal_radio' && data.frecuencia_radio) {
                document.getElementById(`freq-${id}`).innerText = data.frecuencia_radio;
                currentData.frecuencia_radio = data.frecuencia_radio;
            }
            currentData[field] = val;
        });
    });

    const selects = document.querySelectorAll('.update-grupo-radio');
    selects.forEach(select => {
        select.addEventListener('change', async (e) => {
            const id = e.target.dataset.id;
            const ch = e.target.value;
            
            const chNum = parseInt(ch.replace('Ch.', ''), 10);
            const freq = (446.00625 + (chNum - 1) * 0.0125).toFixed(5) + ' MHz';
            
            document.getElementById(`freq-${id}`).innerText = freq;
            
            const currentData = todosGrupos.find(g => g.id == id);
            const payload = {
                canal_radio: ch,
                frecuencia_radio: freq,
                telefono_contacto: currentData.telefono_contacto,
                mision_actual_id: currentData.mision_actual_id,
                nombre_jefe: currentData.nombre_jefe
            };

            await fetch(`/api/orbat/grupo/${id}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
            
            currentData.canal_radio = ch;
            currentData.frecuencia_radio = freq;
        });
    });
}

// --- DRAG AND DROP ---
let draggedItem = null;


function openAssignModal(grupoId, type) {
    if (window.userRole !== 'admin') return;
    
    let optionsHTML = '<option value="">-- Seleccionar --</option>';
    if (type === 'equipo') {
        todosEquipos.forEach(eq => {
            if (eq.faccion_nombre !== currentFaction) return; // FIX: Only show teams for the current faction
            
            let isAssigned = todasAsignaciones.some(a => a.equipo_id === eq.id);
            if (!isAssigned) {
                optionsHTML += `<option value="${eq.id}">${eq.nombre}</option>`;
            }
        });
    } else {
        todasMisiones.forEach(m => {
            let isAssigned = todosGrupos.some(g => g.mision_actual_id === m.id);
            if (!isAssigned || m.persistente) {
                optionsHTML += `<option value="${m.id}">${m.tipo} - ${m.cuadricula}</option>`;
            }
        });
    }
    
    let assignOverlay = document.getElementById('assign-overlay-quick');
    if (!assignOverlay) {
        assignOverlay = document.createElement('div');
        assignOverlay.id = 'assign-overlay-quick';
        assignOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;';
        document.body.appendChild(assignOverlay);
    }
    
    assignOverlay.innerHTML = `
        <div style="background:#1e1e1e; padding: 20px; border-radius: 8px; border: 2px solid var(--theme-color); width: 90%; max-width: 400px; display:flex; flex-direction:column; gap: 15px;">
            <h3 style="margin:0; text-align:center; color: var(--theme-color);">Asignar ${type === 'equipo' ? 'Unidad' : 'Misión'}</h3>
            <select id="assign-select-quick" style="padding:10px; background:#000; color:#fff; border:1px solid var(--theme-color); font-size:1.1rem; border-radius: 4px;">
                ${optionsHTML}
            </select>
            <div style="display:flex; gap:10px; justify-content:flex-end; margin-top: 10px;">
                <button class="btn secondary" onclick="document.getElementById('assign-overlay-quick').style.display='none'">Cancelar</button>
                <button class="btn primary" id="btn-confirm-assign-quick">Confirmar</button>
            </div>
        </div>
    `;
    assignOverlay.style.display = 'flex';
    
    document.getElementById('btn-confirm-assign-quick').onclick = async () => {
        const val = document.getElementById('assign-select-quick').value;
        if (!val) return;
        
        assignOverlay.style.display = 'none';
        
        if (type === 'equipo') {
            await fetch('/api/orbat/assign', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ equipo_id: val, grupo_batalla_id: grupoId === 'null' ? null : grupoId })
            });
        } else {
            if (grupoId !== 'null') {
                await fetch(`/api/orbat/grupo/${grupoId}`, {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ mision_actual_id: val })
                });
            }
        }
        await loadORBAT();
        if (typeof initMortero === 'function') initMortero();
    };
}

function unassignItem(e, type, id, grupoId) {
    e.stopPropagation();
    if (window.userRole !== 'admin') return;
    if (confirm('¿Quitar asignación?')) {
        if (type === 'equipo') {
            fetch('/api/orbat/assign', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ equipo_id: id, grupo_batalla_id: null })
            }).then(() => {
                loadORBAT();
                if (typeof initMortero === 'function') initMortero();
            });
        } else {
            fetch(`/api/orbat/grupo/${grupoId}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ mision_actual_id: "" })
            }).then(() => {
                loadORBAT();
                if (typeof initMortero === 'function') initMortero();
            });
        }
    }
}

async function solicitarUnirse(grupo_batalla_id) {
    if (confirm('¿Quieres enviar una solicitud para unirte a este grupo? Puedes solicitar en varios a la vez.')) {
        try {
            const res = await fetch('/api/orbat/solicitar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ grupo_batalla_id: grupo_batalla_id })
            });
            if (res.ok) {
                alert('Solicitud enviada al mando.');
                loadORBAT();
            } else {
                const err = await res.json();
                alert(err.error || 'Error al enviar solicitud.');
            }
        } catch (e) {
            alert('Error de conexión.');
        }
    }
}

async function resolverSolicitud(asignacion_id, accion) {
    try {
        const res = await fetch('/api/orbat/solicitud/resolver', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ asignacion_id: asignacion_id, accion: accion })
        });
        if (res.ok) {
            loadORBAT();
        } else {
            alert('Error al resolver la solicitud.');
        }
    } catch (e) {
        alert('Error de conexión.');
    }
}

function initDragAndDrop() {

    if (window.userRole !== 'admin') {
        document.querySelectorAll('[draggable="true"]').forEach(el => el.removeAttribute('draggable'));
        return;
    }
    const draggables = document.querySelectorAll('.equipo-card, .mision-card');
    const droppables = document.querySelectorAll('.droppable-area');

    draggables.forEach(draggable => {
        if (draggable.dataset.dndInit) return;
        draggable.dataset.dndInit = "true";

        draggable.addEventListener('dragstart', () => {
            draggedItem = draggable;
            const dropArea = draggable.closest('.droppable-area');
            if (dropArea) {
                draggable.dataset.sourceGrupoId = dropArea.dataset.grupoId || "null";
            }
            setTimeout(() => draggable.style.opacity = '0.5', 0);
        });

        draggable.addEventListener('dragend', () => {
            setTimeout(() => {
                draggable.style.opacity = '1';
                draggedItem = null;
            }, 0);
        });

        if (draggable.classList.contains('equipo-card')) {
            draggable.addEventListener('dblclick', async () => {
                const dropArea = draggable.closest('.droppable-area');
                if (dropArea && dropArea.dataset.grupoId && dropArea.dataset.grupoId !== "null") {
                    const equipoId = draggable.dataset.equipoId;
                    await fetch('/api/orbat/assign', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ equipo_id: equipoId, grupo_batalla_id: null })
                    });
                    await loadORBAT();
    initMortero();
                }
            });
        }
    });

    droppables.forEach(droppable => {
        if (droppable.dataset.dndInit) return;
        droppable.dataset.dndInit = "true";

        droppable.addEventListener('dragover', e => {
            e.preventDefault();
            
            // Check if drop is allowed
            const isEquipo = draggedItem && draggedItem.classList.contains('equipo-card');
            const accept = droppable.dataset.type;
            if ((isEquipo && accept !== 'equipo') || (!isEquipo && accept !== 'mision')) {
                return; // Disallow drop
            }
            
            droppable.classList.add('drag-over');
        });

        droppable.addEventListener('dragleave', () => {
            droppable.classList.remove('drag-over');
        });

        droppable.addEventListener('drop', async e => {
            e.preventDefault();
            droppable.classList.remove('drag-over');
            
            if (draggedItem) {
                const isEquipo = draggedItem.classList.contains('equipo-card');
                const accept = droppable.dataset.type;
                
                // Enforce zone logic
                if ((isEquipo && accept !== 'equipo') || (!isEquipo && accept !== 'mision')) {
                    return;
                }
                let grupoId = droppable.dataset.grupoId;
                if (grupoId === "null") grupoId = null;

                droppable.appendChild(draggedItem); // Optimistic

                if (isEquipo) {
                    const equipoId = draggedItem.dataset.equipoId;
                    await fetch('/api/orbat/assign', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ equipo_id: equipoId, grupo_batalla_id: grupoId })
                    });
                } else {
                    const misionId = draggedItem.dataset.misionId;
                    const mision = JSON.parse(draggedItem.dataset.obj || '{}');
                    const sourceGrupoId = draggedItem.dataset.sourceGrupoId === "null" ? null : draggedItem.dataset.sourceGrupoId;
                    
                    if (sourceGrupoId && sourceGrupoId != grupoId) {
                        // Clear from the specific old group it was dragged from
                        await fetch(`/api/orbat/grupo/${sourceGrupoId}`, {
                            method: 'PUT',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({ mision_actual_id: "" }) 
                        });
                    } else if (!mision.persistente && !sourceGrupoId) {
                        // Not persistent and dragged from unassigned (meaning it should only be in one group)
                        const oldGroup = todosGrupos.find(g => g.mision_actual_id == misionId);
                        if (oldGroup && oldGroup.id != grupoId) {
                            await fetch(`/api/orbat/grupo/${oldGroup.id}`, {
                                method: 'PUT',
                                headers: {'Content-Type': 'application/json'},
                                body: JSON.stringify({ mision_actual_id: "" })
                            });
                        }
                    }

                    if (grupoId) {
                        // Assign to new group
                        await fetch(`/api/orbat/grupo/${grupoId}`, {
                            method: 'PUT',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({ mision_actual_id: misionId })
                        });
                    }
                }

                await loadORBAT();
    initMortero();
            }
        });
    });
}

// --- CRUD EQUIPOS ---
function renderEquiposTable(equipos) {
    const tbody = document.getElementById('equipos-tbody');
    tbody.innerHTML = '';

    equipos.forEach(eq => {
        const logoHtml = eq.logo_url ? `<img src="${eq.logo_url}" style="width:30px; height:30px; object-fit:contain; vertical-align:middle; margin-right:10px;">` : '';
        const userCode = eq.codigo ? `<span style="color:#ffcc00; font-family:var(--font-mono); font-weight:bold;">${eq.codigo}</span>` : `<span style="color:#888;">--</span>`;
        const docs = eq.documentos || [];
        const hasDoc = docs.some(d => d.tipo === 'SEGURO_EXENCION' || d.tipo === 'EXENCION' || d.tipo === 'SEGURO');
        const docsBadges = `
            <div style="font-size: 0.68rem; margin-top: 3px; display: flex; gap: 4px; flex-wrap: wrap;">
                ${hasDoc ? '<span style="color:#00f0ff; background:rgba(0,240,255,0.1); border:1px solid rgba(0,240,255,0.3); padding:1px 5px; border-radius:3px; display:inline-flex; align-items:center; gap:2px;" title="Seguro / Exención de responsabilidad subido"><span class="material-symbols-outlined" style="font-size:11px;">verified_user</span> Seguro/Exención OK</span>' : '<span style="color:#e2b938; background:rgba(226,185,56,0.08); border:1px solid rgba(226,185,56,0.25); padding:1px 5px; border-radius:3px;" title="Seguro / Exención pendiente de adjuntar">Sin Seguro/Exención</span>'}
            </div>
        `;
        tbody.innerHTML += `
            <tr>
                <td data-label="Unidad"><div style="display: flex; align-items: center;">${logoHtml}<div><span style="font-weight:bold;">${eq.nombre}</span>${docsBadges}</div></div></td>
                <td data-label="Usuario (Login)">${userCode}</td>
                <td data-label="Facción" class="color-${eq.faccion_nombre}">${eq.faccion_nombre}</td>
                <td data-label="Jugadores" style="text-align:center;">${eq.jugadores}</td>
                <td data-label="Perfil">${eq.tipo}</td>
                <td data-label="PIN / Contraseña">
                    <div style="display: flex; gap: 6px; align-items: center;">
                        <input type="text" id="eq-pwd-${eq.id}" placeholder="PIN" maxlength="4" style="width: 70px; padding: 4px 6px; font-family: var(--font-mono); font-size: 0.85rem; background: rgba(0,0,0,0.4); border: 1px solid #444; color: #fff; border-radius: 3px; text-align: center;">
                        <button class="btn btn-outline btn-sm" onclick="updateEquipoPwd(${eq.id})" style="padding: 4px 8px; font-size: 0.75rem;">Guardar</button>
                    </div>
                </td>
                <td data-label="Acciones" style="white-space: nowrap;">
                    <div style="display: inline-flex; gap: 4px; align-items: center;">
                        <button class="btn secondary btn-edit" data-id="${eq.id}">Editar</button>
                        <button class="btn danger btn-del" data-id="${eq.id}">Borrar</button>
                    </div>
                </td>
            </tr>
        `;
    });

    document.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const eqId = parseInt(e.target.dataset.id);
            const eq = todosEquipos.find(x => x.id === eqId);
            openModal(eq);
        });
    });

    document.querySelectorAll('.btn-del').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if(confirm('¿Eliminar equipo?')) {
                const id = e.target.dataset.id;
                await fetch(`/api/equipos/${id}`, { method: 'DELETE' });
                await loadEquipos();
    if(window.userRole === "admin") loadPOIs();
                await loadORBAT();
    initMortero();
            }
        });
    });
}

// --- MODAL ---
function initModal() {
    const modal = document.getElementById('modal-equipo');
    const btnNew = document.getElementById('btn-nuevo-equipo');
    const btnCancel = document.getElementById('btn-cancel-modal');
    const form = document.getElementById('form-equipo');

    if (btnNew) btnNew.addEventListener('click', () => openModal());
    if (btnCancel) btnCancel.addEventListener('click', closeModal);
    
    const btnMiExpediente = document.getElementById('btn-mi-expediente');
    if (btnMiExpediente) {
        btnMiExpediente.addEventListener('click', async () => {
            // Si es admin o no tiene equipoId asociado, navegar a la vista de Gestión de Unidades
            if (window.userRole === 'admin' || !window.equipoId) {
                const navEquiposBtn = document.querySelector('.nav-icon-btn[data-target="view-equipos"]');
                if (navEquiposBtn) {
                    navEquiposBtn.click();
                } else {
                    document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
                    document.querySelectorAll('.nav-icon-btn').forEach(b => b.classList.remove('active'));
                    const viewEquipos = document.getElementById('view-equipos');
                    if (viewEquipos) viewEquipos.classList.add('active');
                }
                return;
            }
            try {
                const res = await fetch('/api/equipos');
                const equipos = await res.json();
                const miEquipo = equipos.find(e => e.id == window.equipoId);
                if (miEquipo) {
                    openModal(miEquipo);
                } else {
                    alert('No se encontró la información de tu unidad.');
                }
            } catch (err) {
                console.error('Error al cargar expediente de unidad:', err);
                alert('Error al conectar con el servidor.');
            }
        });
    }

    const fileToDataURL = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    };

    const logoInputGlob = document.getElementById('eq-logo');
    if (logoInputGlob) {
        logoInputGlob.addEventListener('change', async (e) => {
            if (e.target.files && e.target.files[0]) {
                const url = await fileToDataURL(e.target.files[0]);
                const preview = document.getElementById('eq-logo-preview');
                preview.src = url;
                preview.style.display = 'block';
            }
        });
    }

    const fotoInputGlob = document.getElementById('eq-foto');
    if (fotoInputGlob) {
        fotoInputGlob.addEventListener('change', async (e) => {
            if (e.target.files && e.target.files[0]) {
                const url = await fileToDataURL(e.target.files[0]);
                const preview = document.getElementById('eq-foto-preview');
                preview.src = url;
                preview.style.display = 'block';
            }
        });
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const id = document.getElementById('eq-id').value;
        const newPassword = document.getElementById('eq-password') ? document.getElementById('eq-password').value.trim() : '';

        if (newPassword && !/^\d{4}$/.test(newPassword)) {
            alert('El nuevo PIN debe contener exactamente 4 dígitos numéricos.');
            return;
        }

        const payload = {
            nombre: document.getElementById('eq-nombre').value,
            faccion_id: document.getElementById('eq-faccion').value,
            jugadores: document.getElementById('eq-jugadores-manual').checked 
                ? parseInt(document.getElementById('eq-jugadores').value) || 0
                : (parseInt(document.getElementById('eq-jugadores').value.split(' / ')[0]) || 0),
            jugadores_manual: document.getElementById('eq-jugadores-manual').checked,
            tipo: document.getElementById('eq-tipo').value,
            codigo: document.getElementById('eq-codigo') ? document.getElementById('eq-codigo').value : '',
            password: newPassword,
            misiones_preferidas: document.getElementById('eq-misiones-preferidas').value,
            tags_comportamiento: document.getElementById('eq-tags') ? document.getElementById('eq-tags').value : '[]',
            estado_medalla: document.getElementById('eq-estado-medalla') ? document.getElementById('eq-estado-medalla').value : 'verde',
            estado_sancion: document.getElementById('eq-estado-sancion') ? document.getElementById('eq-estado-sancion').value : 'Autorizado',
            miembros: [],
            historial: []
        };
        
        const historialContainer = document.getElementById('historial-container');
        if (historialContainer) {
            const hRows = historialContainer.querySelectorAll('.historial-row');
            hRows.forEach(row => {
                const op = row.querySelector('.historial-op').value.trim();
                const ms_id = row.querySelector('.historial-mision').value;
                const grp = row.querySelector('.historial-grupo').value;
                const fac = row.querySelector('.historial-faccion') ? row.querySelector('.historial-faccion').value : null;
                const val = row.querySelector('.historial-val') ? row.querySelector('.historial-val').value.trim() : '';
                if (op) {
                    payload.historial.push({ operacion: op, mision_id: ms_id || null, grupo_rol: grp, valoracion: val, faccion_id: fac || null });
                }
            });
        }
        
        const miembrosContainer = document.getElementById('miembros-container');
        if (miembrosContainer) {
            const rows = miembrosContainer.querySelectorAll('.miembro-row');
            rows.forEach(row => {
                const mId = row.dataset.id || '';
                const activo = row.querySelector('.miembro-activo').checked ? 1 : 0;
                const nombre = row.querySelector('.miembro-nombre').value.trim();
                const fullname = row.querySelector('.miembro-fullname') ? row.querySelector('.miembro-fullname').value.trim() : '';
                const dni = row.querySelector('.miembro-dni') ? row.querySelector('.miembro-dni').value.trim() : '';
                const tel = row.querySelector('.miembro-telefono') ? row.querySelector('.miembro-telefono').value.trim() : '';
                const email = row.querySelector('.miembro-email') ? row.querySelector('.miembro-email').value.trim() : '';
                const rol = row.querySelector('.miembro-rol').value;
                const armamento = row.querySelector('.miembro-armamento').value;
                
                if (nombre) {
                    payload.miembros.push({ id: mId, activo: activo, nombre_jugador: nombre, nombre_apellidos: fullname, dni: dni, telefono: tel, email: email, rol: rol, armamento: armamento });
                }
            });
        }

        // Validación de nicks únicos dentro de la escuadra
        const nicksSeenInSquad = new Set();
        for (const m of payload.miembros) {
            const cleanNick = (m.nombre_jugador || '').trim().toLowerCase();
            if (!cleanNick) continue;
            if (nicksSeenInSquad.has(cleanNick)) {
                alert(`Nick duplicado en la escuadra: "${m.nombre_jugador}". Dos combatientes no pueden tener el mismo indicativo.`);
                return;
            }
            nicksSeenInSquad.add(cleanNick);
        }

        if (window.userRole !== 'admin') {
            const medCount = payload.miembros.filter(m => (m.rol || '').toLowerCase().includes('medico') || (m.rol || '').toLowerCase().includes('sanitario')).length;
            const totM = payload.miembros.length;
            let maxM = 1;
            if (totM >= 17) maxM = 3;
            else if (totM >= 9) maxM = 2;
            if (medCount > maxM) {
                alert(`Doctrina TVC: Una escuadra de ${totM} efectivos solo puede tener como máximo ${maxM} médico(s). Has asignado ${medCount}. Por favor ajusta los roles antes de guardar.`);
                return;
            }
        }

        const url = id ? `/api/equipos/${id}` : '/api/equipos';
        const method = id ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method: method,
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        
        const resJson = await res.json();
        if (!res.ok) {
            alert('Error al guardar el expediente: ' + (resJson.error || 'Error del servidor'));
            return;
        }

        if (resJson.alerta_medicos) {
            alert('⚠️ ' + resJson.alerta_medicos);
        }

        const finalId = id ? id : resJson.id;
        let uploadErrors = [];
        
        const logoInput = document.getElementById('eq-logo');
        if (logoInput && logoInput.files.length > 0) {
            const formData = new FormData();
            formData.append('logo', logoInput.files[0]);
            try {
                const rLogo = await fetch(`/api/equipos/${finalId}/logo`, {
                    method: 'POST',
                    body: formData
                });
                const dLogo = await rLogo.json();
                if (!rLogo.ok) uploadErrors.push(dLogo.error || 'Error subiendo logo');
            } catch (err) {
                uploadErrors.push('Error de red al subir logo');
            }
        }
        
        const fotoInput = document.getElementById('eq-foto');
        if (fotoInput && fotoInput.files.length > 0) {
            const formDataFoto = new FormData();
            formDataFoto.append('foto', fotoInput.files[0]);
            try {
                const rFoto = await fetch(`/api/equipos/${finalId}/foto`, {
                    method: 'POST',
                    body: formDataFoto
                });
                const dFoto = await rFoto.json();
                if (!rFoto.ok) uploadErrors.push(dFoto.error || 'Error subiendo foto de equipo');
            } catch (err) {
                uploadErrors.push('Error de red al subir foto de equipo');
            }
        }

        if (uploadErrors.length > 0) {
            alert('Unidad guardada, pero ocurrieron errores con las imágenes:\n- ' + uploadErrors.join('\n- '));
        } else {
            alert('Unidad guardada correctamente.');
        }

        closeModal();
        await loadEquipos();
        if(window.userRole === "admin") loadPOIs();
        await loadORBAT();
        initMortero();
    });
}

function openModal(equipo = null) {
    const modal = document.getElementById('modal-equipo');
    if (!modal) return;
    const titleEl = document.getElementById('modal-title');
    if (titleEl) titleEl.innerText = equipo ? 'Gestionar Unidad' : 'Registrar Unidad';
    
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    setVal('eq-id', equipo ? equipo.id : '');
    setVal('eq-nombre', equipo ? equipo.nombre : '');
    setVal('eq-jugadores', equipo ? equipo.jugadores : '0 / 0');
    const chkManual = document.getElementById('eq-jugadores-manual');
    if (chkManual) chkManual.checked = equipo ? equipo.jugadores_manual : false;
    setVal('eq-tipo', equipo ? equipo.tipo : 'GAD');
    setVal('eq-misiones-preferidas', equipo ? (equipo.misiones_preferidas || '') : '');
    setVal('eq-codigo', equipo ? (equipo.codigo || '') : '');
    setVal('eq-password', '');
    
    const logoPreview = document.getElementById('eq-logo-preview');
    const logoInput = document.getElementById('eq-logo');
    if (logoPreview && logoInput) {
        logoInput.value = '';
        if (equipo && equipo.logo_url) {
            logoPreview.src = equipo.logo_url;
            logoPreview.style.display = 'block';
        } else {
            logoPreview.src = '';
            logoPreview.style.display = 'none';
        }
    }
    
    const fotoPreview = document.getElementById('eq-foto-preview');
    const fotoInput = document.getElementById('eq-foto');
    if (fotoPreview && fotoInput) {
        fotoInput.value = '';
        if (equipo && equipo.foto_url) {
            fotoPreview.src = equipo.foto_url;
            fotoPreview.style.display = 'block';
        } else {
            fotoPreview.src = '';
            fotoPreview.style.display = 'none';
        }
    }
    
    // Admin features visibility
    const adminExpediente = document.getElementById('admin-expediente');
    const coreFields = ['eq-nombre', 'eq-faccion', 'eq-codigo'];
    
    if (adminExpediente) {
        if (window.userRole === 'admin') {
            adminExpediente.style.display = 'block';
            setVal('eq-tags', equipo ? (equipo.tags_comportamiento || '[]') : '[]');
            setVal('eq-estado-medalla', equipo ? (equipo.estado_medalla || 'verde') : 'verde');
            setVal('eq-estado-sancion', equipo ? (equipo.estado_sancion || 'Autorizado') : 'Autorizado');
            coreFields.forEach(f => {
                const el = document.getElementById(f);
                if(el) { el.disabled = false; el.readOnly = false; }
            });
            if (typeof renderTagsUI === 'function') renderTagsUI();
        } else {
            adminExpediente.style.display = 'none';
            coreFields.forEach(f => {
                const el = document.getElementById(f);
                if(el) { el.disabled = true; el.readOnly = true; }
            });
        }
    }
    
    // Update badge visual
    const badge = document.getElementById('badge-medalla');
    if (badge) {
        if (equipo && equipo.estado_medalla && window.userRole === 'admin') {
            badge.style.display = 'block';
            if (equipo.estado_medalla === 'verde') badge.innerHTML = '🟢 Excelente';
            else if (equipo.estado_medalla === 'amarillo') badge.innerHTML = '🟡 Advertencia';
            else badge.innerHTML = '🔴 Problemático';
        } else {
            badge.style.display = 'none';
        }
    }
    
    if (typeof updateJugadoresState === 'function') updateJugadoresState();
    
    if (equipo && equipo.faccion_id) {
        setVal('eq-faccion', equipo.faccion_id);
    }

    const miembrosContainer = document.getElementById('miembros-container');
    if (miembrosContainer) {
        miembrosContainer.innerHTML = '';
        if (equipo && equipo.miembros && equipo.miembros.length > 0) {
            equipo.miembros.forEach(m => addMiembroRow(m));
        } else {
            addMiembroRow();
        }
    }
    
    const historialContainer = document.getElementById('historial-container');
    if (historialContainer) {
        historialContainer.innerHTML = '';
        if (equipo && equipo.historial && equipo.historial.length > 0) {
            equipo.historial.forEach(h => addHistorialRow(h));
        } else {
            addHistorialRow();
        }
    }
    
    modal.classList.add('active');
    if (typeof cargarEquipoDocumentos === 'function') {
        cargarEquipoDocumentos(equipo ? equipo.id : null, equipo ? equipo.documentos : null);
    }
    if (equipo && equipo.id && typeof startEquipoReadinessPolling === 'function') {
        startEquipoReadinessPolling(equipo.id);
    }
}

window.openModal = openModal;
window.closeModal = closeModal;

window.equipoReadinessInterval = null;
function startEquipoReadinessPolling(equipoId) {
    stopEquipoReadinessPolling();
    if (!equipoId) return;

    const poll = async () => {
        const modal = document.getElementById('modal-equipo');
        if (!modal || !modal.classList.contains('active')) {
            stopEquipoReadinessPolling();
            return;
        }
        try {
            const res = await fetch(`/api/equipos/${equipoId}/readiness`);
            if (!res.ok) return;
            const data = await res.json();
            const readinessMap = {};
            data.forEach(item => {
                readinessMap[item.id] = (item.listo_combate == 1);
            });
            const rows = document.querySelectorAll('#miembros-container .miembro-row');
            rows.forEach(tr => {
                const mid = parseInt(tr.dataset.id);
                if (mid && readinessMap[mid] !== undefined) {
                    if (readinessMap[mid]) {
                        tr.style.background = 'rgba(0, 240, 255, 0.08)';
                        tr.style.boxShadow = 'inset 3px 0 0 #00f0ff';
                    } else {
                        tr.style.background = 'transparent';
                        tr.style.boxShadow = 'none';
                    }
                }
            });
        } catch (e) {}
    };

    window.equipoReadinessInterval = setInterval(poll, 3500);
}

function stopEquipoReadinessPolling() {
    if (window.equipoReadinessInterval) {
        clearInterval(window.equipoReadinessInterval);
        window.equipoReadinessInterval = null;
    }
}

function updateJugadoresState() {
    const isManual = document.getElementById('eq-jugadores-manual').checked;
    const input = document.getElementById('eq-jugadores');
    if (isManual) {
        input.removeAttribute('readonly');
        input.style.background = '';
    } else {
        input.setAttribute('readonly', 'readonly');
        input.style.background = 'rgba(0,0,0,0.1)';
        updateJugadoresCount();
    }
}

function updateJugadoresCount() {
    const isManual = document.getElementById('eq-jugadores-manual').checked;
    const container = document.getElementById('miembros-container');
    const validRows = Array.from(container.querySelectorAll('.miembro-row')).filter(r => r.querySelector('.miembro-nombre').value.trim() !== '');
    const total = validRows.length;
    const activos = validRows.filter(r => r.querySelector('.miembro-activo').checked).length;
    if (!isManual) {
        document.getElementById('eq-jugadores').value = `${activos} / ${total}`;
    }
    updateDoctrinaMedicosFeedback(total, validRows);
}
document.getElementById('eq-jugadores-manual')?.addEventListener('change', updateJugadoresState);

function updateDoctrinaMedicosFeedback(total, validRows) {
    let banner = document.getElementById('doctrina-medicos-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'doctrina-medicos-banner';
        banner.style.padding = '8px 12px';
        banner.style.marginTop = '10px';
        banner.style.marginBottom = '10px';
        banner.style.borderRadius = '3px';
        banner.style.fontSize = '0.84rem';
        banner.style.fontFamily = "'Share Tech Mono', monospace";
        const btnAdd = document.getElementById('btn-add-miembro');
        if (btnAdd && btnAdd.parentNode) {
            btnAdd.parentNode.insertBefore(banner, btnAdd.nextSibling);
        }
    }
    
    if (total === 0) {
        banner.style.display = 'none';
        return;
    }
    banner.style.display = 'block';
    
    const medCount = validRows.filter(r => {
        const rol = (r.querySelector('.miembro-rol')?.value || '').toLowerCase();
        return rol.includes('medico') || rol.includes('sanitario');
    }).length;
    
    let maxPermitidos = 1;
    if (total >= 17) maxPermitidos = 3;
    else if (total >= 9) maxPermitidos = 2;
    
    const curasDefecto = Math.floor(total / (medCount || 1));
    
    if (medCount > maxPermitidos) {
        banner.style.background = 'rgba(255, 51, 68, 0.15)';
        banner.style.border = '1px solid #ff3344';
        banner.style.color = '#ff9999';
        banner.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px; vertical-align:middle; color:#ff3344;">warning</span> <b>LÍMITE DOCTRINAL EXCEDIDO:</b> Con ${total} efectivos, el jefe de escuadra solo puede asignar máx <b>${maxPermitidos} médico(s)</b> (asignados: ${medCount}).`;
    } else {
        const cupoLlenoAviso = (medCount >= maxPermitidos) ? ' • <span style="color:#e2b938;">[Cupo completo]</span>' : '';
        banner.style.background = 'rgba(0, 240, 255, 0.08)';
        banner.style.border = '1px solid rgba(0, 240, 255, 0.3)';
        banner.style.color = '#c0f7ff';
        banner.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px; vertical-align:middle; color:#00f0ff;">verified_user</span> <b>Doctrina Médica:</b> ${medCount} de máx ${maxPermitidos} médicos permitidos${cupoLlenoAviso}. Curas normales al respawn: <b>${curasDefecto}</b> por médico.`;
    }

    syncMedicosRolesOptions(total, medCount, maxPermitidos);
}

function syncMedicosRolesOptions(total, medCount, maxPermitidos) {
    const container = document.getElementById('miembros-container');
    if (!container) return;
    const isFull = medCount >= maxPermitidos;
    const rows = container.querySelectorAll('.miembro-row');
    rows.forEach(r => {
        const sel = r.querySelector('.miembro-rol');
        if (!sel) return;
        const currentIsMed = (sel.value || '').toLowerCase().includes('medico') || (sel.value || '').toLowerCase().includes('sanitario');
        const optMed = Array.from(sel.options).find(o => o.value === 'Medico');
        if (optMed) {
            if (isFull && !currentIsMed) {
                optMed.style.color = '#888888';
                optMed.style.backgroundColor = '#181818';
                optMed.textContent = 'Médico (Reasignar cupo)';
            } else {
                optMed.style.color = '';
                optMed.style.backgroundColor = '';
                optMed.textContent = 'Médico';
            }
        }
    });
}

function addMiembroRow(m = null) {
    const container = document.getElementById('miembros-container');
    const tr = document.createElement('tr');
    tr.className = 'miembro-row';
    tr.dataset.id = m ? m.id : '';
    
    // Check de combate personal: línea en verde turquesa cristal suave y sutil
    const isListo = m && (m.listo_combate == 1 || m.listo == 1);
    if (isListo) {
        tr.style.background = 'rgba(0, 240, 255, 0.08)';
        tr.style.boxShadow = 'inset 3px 0 0 #00f0ff';
    } else {
        tr.style.background = 'transparent';
        tr.style.boxShadow = 'none';
    }
    tr.style.transition = 'background 0.3s ease, box-shadow 0.3s ease';
    
    const activo = (m && m.activo !== undefined) ? (m.activo == 1) : true;
    const nombre = m ? m.nombre_jugador : '';
    const fullname = m ? (m.nombre_apellidos || '') : '';
    const dni = m ? (m.dni || '') : '';
    const rol = m ? (m.rol || 'Operador') : 'Operador';
    const armamento = m ? (m.armamento || 'Fusilero') : 'Fusilero';
    const tel = m ? (m.telefono || '') : '';
    const email = m ? (m.email || '') : '';
    
    const hasFoto = m && m.foto_url;
    // Si la foto está introducida que no salga un check, si no que el fondo se ponga en verde turquesa cristal
    const fotoBtn = (m && m.id) ? `<button type="button" class="btn-foto-miembro" title="${hasFoto ? 'Foto cargada (clic para cambiar)' : 'Subir fotografía'}" style="width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; padding: 0; border-radius: 4px; cursor: pointer; transition: all 0.2s; ${hasFoto ? 'background: rgba(0, 240, 255, 0.16); border: 1px solid rgba(0, 240, 255, 0.45); color: #00f0ff;' : 'background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.12); color: #64748b;'}" onclick="uploadFotoMiembro(${m.id})"><span class="material-symbols-outlined" style="font-size: 16px;">photo_camera</span></button>` : '';
    
    const carnetBtn = (m && m.id) ? `<a href="/carnet/${m.id}" target="_blank" title="Ver Carnet / QR" style="width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; padding: 0; border-radius: 4px; text-decoration: none; cursor: pointer; transition: all 0.2s; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.12); color: #94a3b8;"><span class="material-symbols-outlined" style="font-size: 16px;">badge</span></a>` : '';
    
    const iceBtn = (m && m.id) ? `<button type="button" title="Ficha Médica Real (I.C.E.)" style="width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; padding: 0; border-radius: 4px; cursor: pointer; transition: all 0.2s; background: rgba(231, 76, 60, 0.12); border: 1px solid rgba(231, 76, 60, 0.35); color: #ff6b7a;" onclick="verIceMiembro(${m.id})"><span class="material-symbols-outlined" style="font-size: 16px;">emergency</span></button>` : '';

    const isExistingMember = Boolean(m && m.id);
    const isAdmin = (window.userRole === 'admin');

    const isMedicRole = rol.toLowerCase().includes('medico') || rol.toLowerCase().includes('sanitario');
    const unbindMedicBtn = (isAdmin && isExistingMember && isMedicRole) ?
        `<button type="button" class="btn-unbind-medic" title="Desvincular terminal de este médico (Liberar teléfono)" style="width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; padding: 0; border-radius: 4px; cursor: pointer; transition: all 0.2s; background: rgba(255, 51, 68, 0.16); border: 1px solid rgba(255, 51, 68, 0.45); color: #ff5566;" onclick="desvincularRemotoDesdeMiembro('${m.uid || ''}', '${(m.nombre_jugador || '').replace(/'/g, "\\'")}', '${m.id}')"><span class="material-symbols-outlined" style="font-size: 16px;">lock_open</span></button>` : '';

    const placeholderGuardar = (!isExistingMember) ? `<span style="font-size: 0.68rem; color: #64748b; font-family: monospace;">(guardar)</span>` : '';

    const delBtn = (isExistingMember && !isAdmin) ?
        `<span title="Baja definitiva restringida a Administradores. Para este evento puedes desmarcar 'Activo'." style="width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; padding: 0; border-radius: 4px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.08); color: #64748b; cursor: not-allowed;"><span class="material-symbols-outlined" style="font-size: 15px;">lock</span></span>` :
        `<button type="button" class="btn-del-miembro" title="${isExistingMember ? 'Eliminar operador del censo militar' : 'Descartar fila'}" style="width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; padding: 0; border-radius: 4px; cursor: pointer; transition: all 0.2s; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.12); color: #888;" onmouseover="this.style.color='#ff5566'; this.style.borderColor='rgba(255,85,102,0.4)';" onmouseout="this.style.color='#888'; this.style.borderColor='rgba(255,255,255,0.12)';"><span class="material-symbols-outlined" style="font-size: 15px;">close</span></button>`;

    const nvgBadge = (m && m.tiene_nvg) ? `<span title="NVG: ${m.nvg_categoria || 'Visión Nocturna'}" style="font-size: 0.68rem; background: rgba(0, 240, 255, 0.1); border: 1px solid rgba(0, 240, 255, 0.35); color: #00f0ff; padding: 1px 5px; border-radius: 3px; font-weight: 600; cursor: help; white-space: nowrap; display: inline-flex; align-items: center; gap: 3px;"><span class="material-symbols-outlined" style="font-size: 11px;">visibility</span> NVG</span>` : '';
    const dronBadge = (m && m.tiene_dron) ? `<span title="Dron: ${m.dron_modelo || 'Reconocimiento'}" style="font-size: 0.68rem; background: rgba(0, 240, 255, 0.1); border: 1px solid rgba(0, 240, 255, 0.35); color: #00f0ff; padding: 1px 5px; border-radius: 3px; font-weight: 600; cursor: help; white-space: nowrap; display: inline-flex; align-items: center; gap: 3px;"><span class="material-symbols-outlined" style="font-size: 11px;">flight</span> Dron</span>` : '';

    tr.innerHTML = `
        <td style="padding: 0.25rem; text-align: center;"><input type="checkbox" class="miembro-activo" ${activo ? 'checked' : ''} style="transform: scale(1.3); cursor: pointer;" title="Marcar/desmarcar para activar o inactivar del despliegue"></td>
        <td style="padding: 0.25rem;">
            <div style="display: flex; align-items: center; gap: 4px;">
                <input type="text" class="miembro-nombre" placeholder="Nick" value="${nombre}" style="flex: 1; min-width: 80px; padding: 0.25rem;">
                ${nvgBadge}${dronBadge}
            </div>
        </td>
        <td style="padding: 0.25rem;"><input type="text" class="miembro-fullname" placeholder="Nombre completo" value="${fullname}" style="width: 100%; padding: 0.25rem;"></td>
        <td style="padding: 0.25rem;"><input type="text" class="miembro-dni" placeholder="DNI" value="${dni}" style="width: 100%; padding: 0.25rem;"></td>
        <td style="padding: 0.25rem;">
            <select class="miembro-rol" style="width: 100%; padding: 0.25rem;">
                <option value="Operador" ${rol === 'Operador' ? 'selected' : ''}>Operador</option>
                <option value="Jefe de equipo" ${rol === 'Jefe de equipo' ? 'selected' : ''}>Jefe de equipo</option>
                <option value="Enlace" ${rol === 'Enlace' ? 'selected' : ''}>Enlace</option>
                <option value="Medico" ${rol === 'Medico' ? 'selected' : ''}>Médico</option>
                <option value="Ingeniero" ${rol === 'Ingeniero' ? 'selected' : ''}>Ingeniero</option>
            </select>
        </td>
        <td style="padding: 0.25rem;">
            <select class="miembro-armamento" style="width: 100%; padding: 0.25rem;">
                <option value="Fusilero" ${armamento === 'Fusilero' ? 'selected' : ''}>Fusilero</option>
                <option value="Francotirador" ${armamento === 'Francotirador' ? 'selected' : ''}>Francotirador</option>
                <option value="Tirador" ${armamento === 'Tirador' ? 'selected' : ''}>Tirador</option>
                <option value="Apoyo" ${armamento === 'Apoyo' ? 'selected' : ''}>Apoyo</option>
            </select>
        </td>
        <td style="padding: 0.25rem;"><input type="text" class="miembro-telefono" placeholder="Teléfono" value="${tel}" style="width: 100%; padding: 0.25rem;"></td>
        <td style="padding: 0.25rem;"><input type="email" class="miembro-email" placeholder="Email" value="${email}" style="width: 100%; padding: 0.25rem;"></td>
        <td style="padding: 0.25rem; text-align: center; white-space: nowrap;"><div style="display: inline-flex; align-items: center; justify-content: center; gap: 4px;">${fotoBtn}${carnetBtn}${iceBtn}${unbindMedicBtn}${placeholderGuardar}</div></td>
        <td style="padding: 0.25rem; text-align: center;">${delBtn}</td>
    `;
    
    function applyActivoStyle(isAct) {
        if (isAct) {
            tr.style.opacity = '1';
            tr.style.filter = 'none';
            if (isListo) {
                tr.style.background = 'rgba(0, 240, 255, 0.08)';
                tr.style.boxShadow = 'inset 3px 0 0 #00f0ff';
            } else {
                tr.style.background = 'transparent';
                tr.style.boxShadow = 'none';
            }
        } else {
            tr.style.opacity = '0.52';
            tr.style.filter = 'grayscale(0.65)';
            tr.style.background = 'rgba(0, 0, 0, 0.22)';
            tr.style.boxShadow = 'none';
        }
    }
    applyActivoStyle(activo);

    const inputNombre = tr.querySelector('.miembro-nombre');
    inputNombre.addEventListener('input', updateJugadoresCount);
    
    async function checkNickUniqueness(inputEl) {
        const val = inputEl.value.trim();
        if (!val) {
            inputEl.style.borderColor = '';
            inputEl.style.boxShadow = '';
            inputEl.removeAttribute('title');
            return true;
        }

        // 1. Validar duplicado local dentro del formulario
        const otherRows = Array.from(container.querySelectorAll('.miembro-row')).filter(r => r !== tr);
        const localDup = otherRows.find(r => {
            const oVal = (r.querySelector('.miembro-nombre')?.value || '').trim();
            return oVal.toLowerCase() === val.toLowerCase();
        });
        if (localDup) {
            inputEl.style.borderColor = '#ff4444';
            inputEl.style.boxShadow = '0 0 6px rgba(255, 68, 68, 0.5)';
            inputEl.title = `Nick duplicado en la escuadra actual: "${val}"`;
            return false;
        }

        // 2. Validar disponibilidad global en el servidor
        try {
            const mId = tr.dataset.id;
            const url = `/api/miembros/check_nick?nick=${encodeURIComponent(val)}${mId ? `&exclude_id=${mId}` : ''}`;
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                if (!data.available) {
                    inputEl.style.borderColor = '#ff4444';
                    inputEl.style.boxShadow = '0 0 6px rgba(255, 68, 68, 0.5)';
                    inputEl.title = `El nick "${val}" ya está en uso por otro combatiente de la unidad "${data.equipo_nombre}".`;
                    return false;
                }
            }
        } catch (e) {
            console.error('Error al comprobar nick:', e);
        }

        inputEl.style.borderColor = '';
        inputEl.style.boxShadow = '';
        inputEl.removeAttribute('title');
        return true;
    }

    inputNombre.addEventListener('blur', () => checkNickUniqueness(inputNombre));

    const cbActivo = tr.querySelector('.miembro-activo');
    if (cbActivo) {
        cbActivo.addEventListener('change', () => {
            applyActivoStyle(cbActivo.checked);
            updateJugadoresCount();
        });
    }

    const selRol = tr.querySelector('.miembro-rol');
    if (selRol) {
        selRol.dataset.prevVal = rol;
        selRol.addEventListener('focus', function() {
            this.dataset.prevVal = this.value;
        });

        selRol.addEventListener('change', function() {
            const newVal = this.value;
            const oldVal = this.dataset.prevVal || 'Operador';
            
            if (newVal === 'Medico' && window.userRole !== 'admin') {
                const container = document.getElementById('miembros-container');
                const rows = Array.from(container.querySelectorAll('.miembro-row'));
                const validRows = rows.filter(r => (r.querySelector('.miembro-nombre')?.value || '').trim() !== '');
                const total = validRows.length;
                let maxPermitidos = 1;
                if (total >= 17) maxPermitidos = 3;
                else if (total >= 9) maxPermitidos = 2;
                
                // Buscar otros miembros que actualmente tengan rol de médico
                const otherMedicRows = rows.filter(r => {
                    if (r === tr) return false;
                    const v = (r.querySelector('.miembro-rol')?.value || '').toLowerCase();
                    return v.includes('medico') || v.includes('sanitario');
                });
                
                if (otherMedicRows.length >= maxPermitidos) {
                    const prevMedicRow = otherMedicRows[0];
                    const prevName = prevMedicRow.querySelector('.miembro-nombre')?.value.trim() || 'otro combatiente';
                    const currentName = tr.querySelector('.miembro-nombre')?.value.trim() || 'este miembro';
                    
                    const wantsReassign = confirm(
                        `LÍMITE DOCTRINAL DE ESCUADRA ALCANZADO (Máximo ${maxPermitidos} médico/s):\n\n` +
                        `Actualmente asignado a: ${prevName}.\n\n` +
                        `¿Deseas REASIGNAR el rol de Médico a "${currentName}" y pasar a "${prevName}" a Operador?`
                    );
                    
                    if (wantsReassign) {
                        const prevSel = prevMedicRow.querySelector('.miembro-rol');
                        if (prevSel) {
                            prevSel.value = 'Operador';
                            prevSel.dataset.prevVal = 'Operador';
                        }
                        this.dataset.prevVal = 'Medico';
                    } else {
                        // Revertir y no permitir asignar
                        this.value = oldVal;
                        updateJugadoresCount();
                        return;
                    }
                } else {
                    this.dataset.prevVal = newVal;
                }
            } else {
                this.dataset.prevVal = newVal;
            }
            updateJugadoresCount();
        });
    }
    
    const delBtnEl = tr.querySelector('.btn-del-miembro');
    if (delBtnEl) {
        delBtnEl.addEventListener('click', () => {
            if (isExistingMember) {
                const curNick = (tr.querySelector('.miembro-nombre')?.value || '').trim() || 'este operador';
                if (!confirm(`¿Eliminar definitivamente a "${curNick}" del censo militar? Esta acción borrará permanentemente sus credenciales y ficha médica.`)) {
                    return;
                }
            }
            tr.remove();
            updateJugadoresCount();
        });
    }
    
    container.appendChild(tr);
    updateJugadoresCount();
}

function addHistorialRow(h = null) {
    const container = document.getElementById('historial-container');
    const div = document.createElement('div');
    div.className = 'historial-row';
    div.style.display = 'flex';
    div.style.gap = '0.25rem';
    
    const operacion = h ? h.operacion : '';
    const mision_id = h ? h.mision_id : null;
    const grupo_rol = h ? h.grupo_rol : 'GOE';
    const val = h ? (h.valoracion || '') : '';
    const faccion_id = h ? h.faccion_id : null;
    
    const misionesOptions = todasMisiones.map(m => `<option value="${m.id}" ${m.id == mision_id ? 'selected' : ''}>${m.nombre}</option>`).join('');
    
    // Build facciones options
    const faccionesOptions = facciones.map(f => `<option value="${f.id}" data-color="var(--color-${f.nombre.toLowerCase()})" ${f.id == faccion_id ? 'selected' : ''}>${f.nombre}</option>`).join('');
    
    // Find initial color
    let initialColor = 'transparent';
    if (faccion_id) {
        const fObj = facciones.find(f => f.id == faccion_id);
        if (fObj) initialColor = `var(--color-${fObj.nombre.toLowerCase()})`;
    }

    div.style.borderLeft = `4px solid ${initialColor}`;
    div.style.paddingLeft = '0.25rem';
    
    div.innerHTML = `
        <input type="text" class="historial-op" placeholder="Operación" value="${operacion}" style="flex:1.5; padding: 0.25rem; font-family: var(--font-ui);">
        <select class="historial-mision" style="flex:1.5; padding: 0.25rem; font-family: var(--font-ui);">
            <option value="">-- Misión --</option>
            ${misionesOptions}
        </select>
        <select class="historial-faccion" style="flex:1; padding: 0.25rem; font-family: var(--font-ui);">
            <option value="" data-color="transparent">-- Facc --</option>
            ${faccionesOptions}
        </select>
        <select class="historial-grupo" style="flex:1; padding: 0.25rem; font-family: var(--font-ui);">
            <option value="GOE" ${grupo_rol === 'GOE' ? 'selected' : ''}>GOE</option>
            <option value="GAD" ${grupo_rol === 'GAD' ? 'selected' : ''}>GAD</option>
        </select>
        <input type="text" class="historial-val" placeholder="Valoración (Nota Admin)" value="${val}" style="flex:2; padding: 0.25rem; font-family: var(--font-ui);">
        <button type="button" class="btn danger btn-del-historial" style="padding: 0.25rem 0.5rem; font-size:0.8rem;">X</button>
    `;
    
    div.querySelector('.historial-faccion').addEventListener('change', (e) => {
        const option = e.target.options[e.target.selectedIndex];
        div.style.borderLeftColor = option.dataset.color || 'transparent';
    });
    
    div.querySelector('.btn-del-historial').addEventListener('click', () => {
        div.remove();
    });
    
    container.appendChild(div);
}

document.getElementById('btn-add-miembro')?.addEventListener('click', () => {
    addMiembroRow();
});

document.getElementById('btn-add-historial')?.addEventListener('click', () => {
    addHistorialRow();
});

function closeModal() {
    stopEquipoReadinessPolling();
    const modal = document.getElementById('modal-equipo');
    modal.classList.remove('active');
    document.getElementById('form-equipo').reset();
    document.getElementById('miembros-container').innerHTML = '';
}

// --- DOCUMENTACIÓN OFICIAL PDF DE UNIDAD ---
async function cargarEquipoDocumentos(equipoId, docsPreloaded = null) {
    const noticeEl = document.getElementById('docs-equipo-notice');
    if (!equipoId) {
        if (noticeEl) noticeEl.style.display = 'block';
        renderDocSlot('SEGURO_EXENCION', null, false);
        return;
    }

    if (noticeEl) noticeEl.style.display = 'none';

    let docs = docsPreloaded;
    if (!docs) {
        try {
            const res = await fetch(`/api/equipos/${equipoId}/documentos`);
            if (res.ok) {
                docs = await res.json();
            }
        } catch (e) {
            console.error("Error cargando documentos de unidad:", e);
        }
    }

    docs = docs || [];
    const docSeguroExencion = docs.find(d => d.tipo === 'SEGURO_EXENCION') || docs.find(d => d.tipo === 'EXENCION') || docs.find(d => d.tipo === 'SEGURO');

    renderDocSlot('SEGURO_EXENCION', docSeguroExencion, true, equipoId);
}

function formatBytes(bytes, decimals = 1) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function renderDocSlot(tipo, doc, canUpload, equipoId = null) {
    const key = tipo.toLowerCase();
    const statusEl = document.getElementById(`${key}-doc-status`);
    const actionsEl = document.getElementById(`${key}-doc-actions`);
    if (!statusEl || !actionsEl) return;

    if (!canUpload) {
        statusEl.innerHTML = `<span style="color: #888;">(Guarda la unidad primero para adjuntar archivos)</span>`;
        actionsEl.innerHTML = `<span style="font-size: 0.72rem; color: #666;">No disponible</span>`;
        return;
    }

    if (doc) {
        const sizeStr = formatBytes(doc.tamano_bytes);
        const fecha = doc.subido_en ? doc.subido_en.split(' ')[0] : '';
        statusEl.innerHTML = `
            <div style="color: #2ecc71; font-weight: bold; display: flex; align-items: center; gap: 4px;">
                <span class="material-symbols-outlined" style="font-size: 15px;">check_circle</span>
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px;" title="${doc.nombre_original}">${doc.nombre_original}</span>
            </div>
            <div style="color: #94a3b8; font-size: 0.7rem; margin-top: 2px;">${sizeStr} ${fecha ? '• ' + fecha : ''}</div>
        `;

        actionsEl.innerHTML = `
            <a href="${doc.archivo_url}" target="_blank" class="btn outline btn-sm" style="text-decoration: none;" title="Abrir y visualizar documento PDF">
                <span class="material-symbols-outlined" style="font-size: 14px;">open_in_new</span> Ver PDF
            </a>
            <label class="btn secondary btn-sm" style="cursor: pointer; margin: 0;" title="Subir nuevo PDF para actualizar">
                <span class="material-symbols-outlined" style="font-size: 14px;">sync</span> Cambiar
                <input type="file" accept=".pdf,application/pdf" style="display: none;" onchange="uploadEquipoDoc('${tipo}', this)">
            </label>
            <button type="button" class="btn danger btn-sm" onclick="deleteEquipoDoc(${doc.id}, '${tipo}')" title="Eliminar archivo">
                <span class="material-symbols-outlined" style="font-size: 14px;">delete</span>
            </button>
        `;
    } else {
        statusEl.innerHTML = `<span style="color: #e2b938;">🟡 Pendiente de adjuntar</span>`;
        actionsEl.innerHTML = `
            <label class="btn outline btn-sm" style="cursor: pointer; margin: 0;">
                <span class="material-symbols-outlined" style="font-size: 14px;">upload_file</span> Subir Seguro / Exención (PDF)
                <input type="file" accept=".pdf,application/pdf" style="display: none;" onchange="uploadEquipoDoc('${tipo}', this)">
            </label>
        `;
    }
}

async function uploadEquipoDoc(tipo, inputEl) {
    const eqId = document.getElementById('eq-id').value;
    if (!eqId) {
        alert("Por favor, guarda la unidad antes de subir documentos.");
        inputEl.value = '';
        return;
    }

    if (!inputEl.files || !inputEl.files[0]) return;
    const file = inputEl.files[0];

    if (!file.name.toLowerCase().endsWith('.pdf')) {
        alert("El archivo debe ser un documento PDF (.pdf)");
        inputEl.value = '';
        return;
    }

    if (file.size > 10 * 1024 * 1024) {
        alert("El archivo excede el tamaño máximo permitido de 10 MB.");
        inputEl.value = '';
        return;
    }

    const key = tipo.toLowerCase();
    const statusEl = document.getElementById(`${key}-doc-status`);
    if (statusEl) statusEl.innerHTML = `<span style="color: #00f0ff;">⏳ Subiendo ${file.name}...</span>`;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('tipo', tipo);

    try {
        const res = await fetch(`/api/equipos/${eqId}/documentos`, {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (res.ok && data.status === 'success') {
            await cargarEquipoDocumentos(eqId);
            await loadEquipos();
        } else {
            alert("Error al subir documento: " + (data.error || "Error del servidor"));
            await cargarEquipoDocumentos(eqId);
        }
    } catch (e) {
        alert("Error de red al subir documento PDF.");
        await cargarEquipoDocumentos(eqId);
    } finally {
        inputEl.value = '';
    }
}

async function deleteEquipoDoc(docId, tipo) {
    const tipoLabel = 'el documento de Seguro / Exención';
    if (!confirm(`¿Eliminar ${tipoLabel} de esta unidad?`)) return;

    const eqId = document.getElementById('eq-id').value;
    try {
        const res = await fetch(`/api/documentos_equipo/${docId}`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok && data.status === 'success') {
            await cargarEquipoDocumentos(eqId);
            await loadEquipos();
        } else {
            alert("Error al eliminar documento: " + (data.error || "Error del servidor"));
        }
    } catch (e) {
        alert("Error de conexión al eliminar documento.");
    }
}

// --- CRUD MISIONES ---
function renderMisionesTable(misiones) {
    const tbody = document.getElementById('misiones-tbody');
    tbody.innerHTML = '';

    const btnToggleAll = document.getElementById('btn-toggle-all-misiones');
    if (btnToggleAll) {
        const allRevealed = misiones.length > 0 && misiones.every(m => m.revelada);
        btnToggleAll.innerText = allRevealed ? 'Censurar Todas (Global)' : 'Revelar Todas (Global)';
        btnToggleAll.className = allRevealed ? 'btn secondary' : 'btn warning';
    }

    misiones.forEach(mis => {
        tbody.innerHTML += `
            <tr>
                <td data-label="Misión">${mis.nombre}</td>
                <td data-label="Tipo">${mis.tipo}</td>
                <td data-label="Etiquetas">${mis.etiquetas || '-'}</td>
                <td data-label="Oficial Resp.">${mis.oficial_responsable || '-'}</td>
                <td data-label="Persistente">${mis.persistente ? '🔄 SÍ' : 'NO'}</td>
                <td data-label="Revelada">${mis.revelada ? '👁️ SÍ' : 'NO'}</td>
                <td data-label="Acciones" style="white-space: nowrap;">
                    <div style="display: inline-flex; gap: 4px; align-items: center;">
                        <button class="btn secondary btn-edit-mision" data-id="${mis.id}" data-obj='${JSON.stringify(mis)}'>Editar</button>
                        <button class="btn secondary btn-dup-mision" data-id="${mis.id}">Duplicar</button>
                        <button class="btn danger btn-del-mision" data-id="${mis.id}">Borrar</button>
                    </div>
                </td>
            </tr>
        `;
    });

    document.querySelectorAll('.btn-edit-mision').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const mis = JSON.parse(e.target.dataset.obj);
            openModalMision(mis);
        });
    });

    document.querySelectorAll('.btn-dup-mision').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if(confirm('¿Duplicar misión?')) {
                const id = e.target.dataset.id;
                await fetch(`/api/misiones/${id}/duplicate`, { method: 'POST' });
                await loadORBAT();
                initMortero();
            }
        });
    });

    document.querySelectorAll('.btn-del-mision').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if(confirm('¿Eliminar misión?')) {
                const id = e.target.dataset.id;
                await fetch(`/api/misiones/${id}`, { method: 'DELETE' });
                await loadORBAT();
    initMortero();
            }
        });
    });
}

function initCrudMision() {
    const modal = document.getElementById('modal-crud-mision');
    const btnNew = document.getElementById('btn-nueva-mision');
    const btnCancel = document.getElementById('btn-cancel-modal-mision');
    const form = document.getElementById('form-mision');

    const btnToggleAll = document.getElementById('btn-toggle-all-misiones');

    if (btnToggleAll && !btnToggleAll.dataset.init) {
        btnToggleAll.dataset.init = 'true';
        btnToggleAll.addEventListener('click', async () => {
            const allRevealed = todasMisiones.length > 0 && todasMisiones.every(m => m.revelada);
            const newState = !allRevealed;
            if (confirm(newState ? '¿Estás seguro de REVELAR y desclasificar TODAS las misiones para los jugadores?' : '¿Estás seguro de OCULTAR y censurar TODAS las misiones?')) {
                await fetch('/api/misiones/reveal_all', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ revelada: newState })
                });
                await loadORBAT();
    initMortero();
            }
        });
    }

    btnNew.addEventListener('click', () => openModalMision());
    btnCancel.addEventListener('click', closeModalMision);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const id = document.getElementById('mis-id').value;
        const payload = {
            nombre: document.getElementById('mis-nombre').value,
            tipo: document.getElementById('mis-tipo').value,
            etiquetas: document.getElementById('mis-etiquetas').value,
            oficial_responsable: document.getElementById('mis-oficial').value,
            resumen: document.getElementById('mis-resumen').value,
            contexto: document.getElementById('mis-contexto').value,
            instrucciones: document.getElementById('mis-instrucciones').value,
            consideraciones: document.getElementById('mis-consideraciones').value,
            persistente: document.getElementById('mis-persistente').checked,
            revelada: document.getElementById('mis-revelada').checked,
            esquema_id: document.getElementById('mis-esquema').value || null
        };

        const url = id ? `/api/misiones/${id}` : '/api/misiones';
        const method = id ? 'PUT' : 'POST';

        await fetch(url, {
            method: method,
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });

        closeModalMision();
        await loadORBAT();
    initMortero();
    });
}

function openModalMision(mis = null) {
    const modal = document.getElementById('modal-crud-mision');
    
    // We removed modal-title-mision in the new UI, but if it exists, update it:
    const titleEl = document.getElementById('modal-title-mision');
    if (titleEl) {
        titleEl.innerText = mis ? 'Editar Misión' : 'Registrar Misión';
    }
    
    // Tematizar el documento en base a la facción actual
    const docContainer = document.getElementById('mis-document-container');
    const headerEjercito = document.getElementById('mis-header-ejercito');
    const headerCapitania = document.getElementById('mis-header-capitania');
    const footerFirma = document.getElementById('mis-footer-firma');
    
    if (currentFaction === 'Syldavia') {
        docContainer.style.setProperty('--mission-bg', '#fdf8eb');
        docContainer.style.setProperty('--mission-dark', '#b08130');
        headerEjercito.innerText = 'EJÉRCITO DE SYLDAVIA';
        headerCapitania.innerText = 'CAPITANÍA GENERAL DE HERTZPLATZ • MANDO DE TEATRO';
        footerFirma.innerText = 'FDO: ALTO MANDO // HERTZPLATZ';
    } else if (currentFaction === 'Volkovia') {
        docContainer.style.setProperty('--mission-bg', '#f0f4f8');
        docContainer.style.setProperty('--mission-dark', '#5b7da6');
        headerEjercito.innerText = 'EJÉRCITO DE VOLKOVIA';
        headerCapitania.innerText = 'COMANDANCIA DE VILACERVOSK • MANDO TÁCTICO';
        footerFirma.innerText = 'FDO: MANDO OPERACIONAL // VILACERVOSK';
    } else if (currentFaction === 'Khemed') {
        docContainer.style.setProperty('--mission-bg', '#f0f6f2');
        docContainer.style.setProperty('--mission-dark', '#598a6a');
        headerEjercito.innerText = 'FUERZAS ARMADAS DE KHEMED';
        headerCapitania.innerText = 'MANDO CENTRAL DE WADESDAH • ESTADO MAYOR';
        footerFirma.innerText = 'FDO: ALTO MANDO // WADESDAH';
    }
    
    document.getElementById('mis-id').value = mis ? mis.id : '';
    document.getElementById('mis-nombre').value = mis ? mis.nombre : '';
    document.getElementById('mis-tipo').value = mis ? mis.tipo : '';
    document.getElementById('mis-etiquetas').value = mis ? mis.etiquetas : '';
    document.getElementById('mis-oficial').value = mis ? mis.oficial_responsable : '';
    document.getElementById('mis-resumen').value = mis ? mis.resumen : '';
    document.getElementById('mis-resumen').value = mis ? mis.resumen : '';
    document.getElementById('mis-contexto').value = mis ? mis.contexto : '';
    document.getElementById('mis-instrucciones').value = mis ? mis.instrucciones : '';
    document.getElementById('mis-consideraciones').value = mis && mis.consideraciones ? mis.consideraciones : '';
    document.getElementById('mis-persistente').checked = mis ? mis.persistente : false;
    document.getElementById('mis-revelada').checked = mis ? mis.revelada : false;
    
    const select = document.getElementById('mis-esquema');
    if (select && mis && mis.esquema_id) {
        select.value = mis.esquema_id;
    } else if (select) {
        select.value = '';
    }
    
    modal.classList.add('active');
}

function closeModalMision() {
    const modal = document.getElementById('modal-crud-mision');
    modal.classList.remove('active');
    document.getElementById('form-mision').reset();
}

function verInformeMision(m) {
    const mModal = document.getElementById('modal-mision');
    
    document.getElementById('rm-nombre').innerText = m.nombre;
    document.getElementById('rm-tipo').innerText = m.tipo;
    document.getElementById('rm-tags').innerText = m.etiquetas;
    document.getElementById('rm-oficial').innerText = m.oficial_responsable || 'CLASIFICADO';
    
    const resElem = document.getElementById('rm-resumen');
    const ctxElem = document.getElementById('rm-contexto');
    const instElem = document.getElementById('rm-instrucciones');
    const consElem = document.getElementById('rm-consideraciones');
    const consSection = document.getElementById('rm-consideraciones-section');
    
    if (resElem) resElem.innerText = m.resumen || 'Sin requisitos operacionales específicos.';
    ctxElem.innerText = m.contexto || 'Sin información.';
    instElem.innerText = m.instrucciones || 'Sin instrucciones.';
    
    if (m.consideraciones && m.consideraciones.trim() !== '') {
        consElem.innerText = m.consideraciones;
        consSection.style.display = 'block';
    } else {
        consSection.style.display = 'none';
    }
    
    ctxElem.classList.remove('revealed');
    instElem.classList.remove('revealed');
    consElem.classList.remove('revealed');

    if (!m.revelada) {
        ctxElem.classList.add('redacted-content');
        instElem.classList.add('redacted-content');
        consElem.classList.add('redacted-content');
    } else {
        ctxElem.classList.remove('redacted-content');
        instElem.classList.remove('redacted-content');
        consElem.classList.remove('redacted-content');
    }

    const actionsContainer = document.getElementById('rm-actions-container');
    if (actionsContainer) {
        actionsContainer.innerHTML = '';
        if (m.esquema_json && (m.revelada || window.userRole === 'admin' || window.userRole === 'mando')) {
            const btn = document.createElement('button');
            btn.className = 'btn primary';
            btn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 1.2rem; vertical-align: middle;">map</span> Ver Mapa Táctico';
            btn.onclick = () => verEsquema(m.esquema_json);
            actionsContainer.appendChild(btn);
        }
    }

    mModal.classList.add('active');
}

function initMisionModals() {
    const mcards = document.querySelectorAll('.mision-card');
    const mModal = document.getElementById('modal-mision');
    const btnCerrar = document.getElementById('btn-cerrar-mision');

    if (btnCerrar) {
        btnCerrar.addEventListener('click', () => {
            mModal.classList.remove('active');
        });
    }

    mcards.forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.tagName.toLowerCase() === 'button' || e.target.closest('button')) return;
            const m = JSON.parse(card.dataset.obj);
            verInformeMision(m);
        });
    });
}


// --- CRUD POIS ---
let todosPOIs = [];

async function loadPOIs() {
    const res = await fetch('/api/pois');
    todosPOIs = await res.json();
    renderPOIsTable();
}

function renderPOIsTable() {
    const tbody = document.getElementById('pois-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    todosPOIs.forEach(poi => {
        let faccionName = 'Neutral';
        if (poi.faccion_id) {
            const fac = facciones.find(f => f.id === poi.faccion_id);
            if(fac) faccionName = fac.nombre;
        }

        tbody.innerHTML += `
            <tr>
                <td data-label="Sector">${poi.nombre}</td>
                <td data-label="Tipo"><strong>${poi.tipo}</strong></td>
                <td data-label="Radio">${poi.tolerancia_metros}m</td>
                <td data-label="Facción">${faccionName}</td>
                <td data-label="QR" style="font-family: monospace; letter-spacing: 1px; white-space: nowrap;">
                    <span>${poi.token_qr}</span> 
                    <button class="btn outline btn-view-qr" style="padding: 2px 6px; font-size: 0.7rem; margin-left: 5px;" data-token="${poi.token_qr}">Ver QR</button>
                    <a href="/scan/${poi.token_qr}" target="_blank" class="btn outline" style="padding: 2px 6px; font-size: 0.7rem; margin-left: 3px; text-decoration: none;">Probar Scanner</a>
                </td>
                <td data-label="Acciones" style="white-space: nowrap;">
                    <div style="display: inline-flex; gap: 4px; align-items: center;">
                        <button class="btn secondary btn-edit-poi" data-id="${poi.id}" data-obj='${JSON.stringify(poi)}'>Editar</button>
                        <button class="btn danger btn-del-poi" data-id="${poi.id}">Borrar</button>
                    </div>
                </td>
            </tr>
        `;
    });


    document.querySelectorAll('.btn-edit-poi').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const poi = JSON.parse(e.target.dataset.obj);
            document.getElementById('poi-nombre').value = poi.nombre;
            document.getElementById('poi-tipo').value = poi.tipo;
            document.getElementById('poi-faccion').value = poi.faccion_id || '';
            
            let visArray = [];
            if (poi.visible_para && typeof poi.visible_para === 'string' && poi.visible_para.startsWith('[')) {
                try { visArray = JSON.parse(poi.visible_para); } catch(e) {}
            } else if (poi.visible_para && !isNaN(poi.visible_para) && poi.visible_para != 0) {
                visArray = [parseInt(poi.visible_para)];
            }
            
            document.querySelectorAll('.poi-visible-cb').forEach(cb => {
                if (poi.visible_para === 0 || poi.visible_para === '0' || !poi.visible_para || (visArray.length === 0 && (!poi.visible_para || poi.visible_para == 0))) {
                    cb.checked = true;
                } else {
                    cb.checked = visArray.includes(parseInt(cb.value));
                }
            });

            document.getElementById('poi-lat').value = poi.lat;
            document.getElementById('poi-lng').value = poi.lng;
            document.getElementById('poi-tolerancia').value = poi.tolerancia_metros;
            
            // Trigger auto-conversion and UI updates
            const evt1 = new Event('input');
            const evt2 = new Event('change');
            document.getElementById('poi-lat').dispatchEvent(evt1);
            document.getElementById('poi-tipo').dispatchEvent(evt2);
            
            // Pre-check advanced rules if applicable
            if (poi.tipo === 'RESPAWN' && poi.datos_extra) {
                try {
                    const extra = JSON.parse(poi.datos_extra);
                    if (extra.requisitos_captura) {
                        for (const [facId, pcIds] of Object.entries(extra.requisitos_captura)) {
                            pcIds.forEach(id => {
                                const cb = document.querySelector(`.adv-respawn-cb[data-faccion="${facId}"][value="${id}"]`);
                                if (cb) cb.checked = true;
                            });
                        }
                    }
                } catch(e) {}
            }
            
            formPoi.dataset.editId = poi.id;
            modalPoi.classList.add('active');
        });
    });

    
    document.querySelectorAll('.btn-view-qr').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const token = e.target.dataset.token;
            const fullUrl = `${window.location.origin}/scan/${token}`;
            const rawContentEl = document.getElementById('qr-raw-content');
            if (rawContentEl) rawContentEl.innerText = fullUrl;
            // Usamos un API publica para generar el QR con la URL completa de navegación
            document.getElementById('qr-image').src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(fullUrl)}`;
            document.getElementById('modal-qr').classList.add('active');
        });
    });

    document.querySelectorAll('.btn-del-poi').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if(confirm('¿Eliminar este POI?')) {
                const id = e.target.dataset.id;
                await fetch(`/api/pois/${id}`, { method: 'DELETE' });
                await loadPOIs();
                if(typeof loadMapData === 'function') loadMapData();
            }
        });
    });
}

const modalPoi = document.getElementById('modal-poi');
const btnNuevoPoi = document.getElementById('btn-nuevo-poi');
const btnCancelPoi = document.getElementById('btn-cancel-poi');
const formPoi = document.getElementById('form-poi');
const btnPoiGpsMapa = document.getElementById('btn-poi-gps-mapa');

if (btnNuevoPoi) {
    btnNuevoPoi.addEventListener('click', () => {
        delete formPoi.dataset.editId;
        formPoi.reset();
        document.getElementById('poi-tipo').dispatchEvent(new Event('change'));
        modalPoi.classList.add('active');
    });
}

if (btnCancelPoi) {
    btnCancelPoi.addEventListener('click', () => {
        modalPoi.classList.remove('active');
        formPoi.reset();
    });
}

if (formPoi) {
    formPoi.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const checkedVis = Array.from(document.querySelectorAll('.poi-visible-cb:checked')).map(cb => parseInt(cb.value));
        const totalFacs = document.querySelectorAll('.poi-visible-cb').length;
        const visibleParaValue = (checkedVis.length === totalFacs || checkedVis.length === 0) ? 0 : JSON.stringify(checkedVis);

        const payload = {
            nombre: document.getElementById('poi-nombre').value,
            tipo: document.getElementById('poi-tipo').value,
            faccion_id: document.getElementById('poi-faccion').value || null,
            visible_para: visibleParaValue,
            lat: parseFloat(document.getElementById('poi-lat').value.replace(',', '.')),
            lng: parseFloat(document.getElementById('poi-lng').value.replace(',', '.')),
            tolerancia_metros: parseFloat(document.getElementById('poi-tolerancia').value.replace(',', '.')),
            datos_extra: ''
        };

        if (payload.tipo === 'RESPAWN') {
            const reqs = {};
            facciones.forEach(fac => {
                const checked = Array.from(document.querySelectorAll(`.adv-respawn-cb[data-faccion="${fac.id}"]:checked`)).map(cb => parseInt(cb.value));
                if (checked.length > 0) {
                    reqs[fac.id] = checked;
                }
            });
            if (Object.keys(reqs).length > 0) {
                payload.datos_extra = JSON.stringify({ requisitos_captura: reqs });
            }
        }

        const isEdit = !!formPoi.dataset.editId;
        const url = isEdit ? `/api/pois/${formPoi.dataset.editId}` : '/api/pois';
        const method = isEdit ? 'PUT' : 'POST';

        await fetch(url, {
            method: method,
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        delete formPoi.dataset.editId;


        modalPoi.classList.remove('active');
        formPoi.reset();
        await loadPOIs();
        if(typeof loadMapData === 'function') loadMapData();
    });
}

if (btnPoiGpsMapa) {
    btnPoiGpsMapa.addEventListener('click', () => {
        alert("Haz clic en el Mapa Táctico para capturar el GPS.");
        modalPoi.classList.remove('active');
        
        // Wait for next map click
        const onMapClickForPoi = (e) => {
            if(window.mapProjector) {
                // e.latlng contains Leaflet pixels in CRS.Simple
                const realGps = window.mapProjector.mapToGps(e.latlng.lat, e.latlng.lng);
                document.getElementById('poi-lat').value = realGps.lat.toFixed(6);
                document.getElementById('poi-lng').value = realGps.lng.toFixed(6);
            } else {
                alert("GPSMapper no inicializado");
            }
            map.off('click', onMapClickForPoi);
            modalPoi.classList.add('active');
        };
        map.on('click', onMapClickForPoi);
    });
}


// --- AUTO-CONVERT COORDS EN FORMULARIO POI ---
const inputLat = document.getElementById('poi-lat');
const inputLng = document.getElementById('poi-lng');
const inputMapY = document.getElementById('poi-map-y');
const inputMapX = document.getElementById('poi-map-x');

function convertGpsToMap() {
    if (!window.mapProjector) return;
    const lat = parseFloat(inputLat.value.replace(',', '.'));
    const lng = parseFloat(inputLng.value.replace(',', '.'));
    if (!isNaN(lat) && !isNaN(lng)) {
        const px = window.mapProjector.gpsToMap(lat, lng);
        inputMapY.value = px.lat.toFixed(2);
        inputMapX.value = px.lng.toFixed(2);
    }
}

function convertMapToGps() {
    if (!window.mapProjector) return;
    const mapY = parseFloat(inputMapY.value.replace(',', '.'));
    const mapX = parseFloat(inputMapX.value.replace(',', '.'));
    if (!isNaN(mapY) && !isNaN(mapX)) {
        const gps = window.mapProjector.mapToGps(mapY, mapX);
        inputLat.value = gps.lat.toFixed(6);
        inputLng.value = gps.lng.toFixed(6);
    }
}

if (inputLat && inputLng) {
    inputLat.addEventListener('input', convertGpsToMap);
    inputLng.addEventListener('input', convertGpsToMap);
}
if (inputMapY && inputMapX) {
    inputMapY.addEventListener('input', convertMapToGps);
    inputMapX.addEventListener('input', convertMapToGps);
}

// Update the map click handler to fill all fields
if (btnPoiGpsMapa) {
    // Re-bind the click with updated logic
    const oldClone = btnPoiGpsMapa.cloneNode(true);
    btnPoiGpsMapa.parentNode.replaceChild(oldClone, btnPoiGpsMapa);
    
    oldClone.addEventListener('click', () => {
        alert("Haz clic en el Mapa Táctico para capturar la coordenada.");
        modalPoi.classList.remove('active');
        
        delete formPoi.dataset.editId;
        formPoi.reset();
        const onMapClickForPoi2 = (e) => {
            if(window.mapProjector) {
                // Rellenamos Mapa X e Y (Pixel coords de Leaflet)
                document.getElementById('poi-map-y').value = e.latlng.lat.toFixed(2);
                document.getElementById('poi-map-x').value = e.latlng.lng.toFixed(2);
                
                // Calculamos GPS Real
                const realGps = window.mapProjector.mapToGps(e.latlng.lat, e.latlng.lng);
                document.getElementById('poi-lat').value = realGps.lat.toFixed(6);
                document.getElementById('poi-lng').value = realGps.lng.toFixed(6);
            }
            map.off('click', onMapClickForPoi2);
            modalPoi.classList.add('active');
        };
        map.on('click', onMapClickForPoi2);
    });
}


// --- RESPONSIVE ADVANCED RULES UI ---
const poiTipoSelect = document.getElementById('poi-tipo');
const poiRespawnRules = document.getElementById('poi-respawn-rules');
const poiFactionsContainer = document.getElementById('poi-respawn-factions-container');

if (poiTipoSelect) {
    poiTipoSelect.addEventListener('change', (e) => {
        if (e.target.value === 'RESPAWN') {
            poiRespawnRules.style.display = 'block';
            // Render factions and available PCs
            const allPCs = todosPOIs.filter(p => p.tipo === 'PC');
            
            if (allPCs.length === 0) {
                poiFactionsContainer.innerHTML = '<span style="color:#aaa;">No hay Puntos de Control (PCs) creados todavía. Crea primero algunas banderas.</span>';
                return;
            }

            let html = '';
            facciones.forEach(fac => {
                html += `<div style="background: rgba(0,0,0,0.3); padding: 5px; border-radius: 4px;">`;
                html += `<strong style="color:var(--theme-color); display:block; margin-bottom:4px;">Facción ${fac.nombre}</strong>`;
                html += `<div style="display:flex; flex-wrap:wrap; gap:10px;">`;
                allPCs.forEach(pc => {
                    html += `
                        <label style="display:flex; align-items:center; gap:3px; font-size:0.8rem; cursor:pointer;">
                            <input type="checkbox" class="adv-respawn-cb" data-faccion="${fac.id}" value="${pc.id}">
                            ${pc.nombre}
                        </label>
                    `;
                });
                html += `</div></div>`;
            });
            poiFactionsContainer.innerHTML = html;
        } else {
            poiRespawnRules.style.display = 'none';
        }
    });
}

// Analytics Loader
async function loadAnalytics() {
    try {
        const res = await fetch('/api/analytics');
        const data = await res.json();
        
        let capHtml = '';
        data.top_capturas.forEach(c => {
            const color = c.faccion_nombre.toLowerCase() === 'syldavia' ? 'var(--color-syldavia)' : 'var(--color-volkovia)';
            capHtml += `<tr>
                <td style="font-weight: bold; color: #fff;">${c.equipo_nombre}</td>
                <td style="color: ${color};">${c.faccion_nombre}</td>
                <td style="text-align: center; font-size: 1.2rem; font-family: var(--font-mono);">${c.total}</td>
            </tr>`;
        });
        if(document.getElementById('stats-capturas-tbody')) document.getElementById('stats-capturas-tbody').innerHTML = capHtml;
        
        let resHtml = '';
        data.top_respawns.forEach(r => {
            const color = r.faccion_nombre.toLowerCase() === 'syldavia' ? 'var(--color-syldavia)' : 'var(--color-volkovia)';
            resHtml += `<tr>
                <td style="font-weight: bold; color: #fff;">${r.equipo_nombre}</td>
                <td style="color: ${color};">${r.faccion_nombre}</td>
                <td style="text-align: center; font-size: 1.2rem; font-family: var(--font-mono);">${r.total}</td>
            </tr>`;
        });
        if(document.getElementById('stats-respawns-tbody')) document.getElementById('stats-respawns-tbody').innerHTML = resHtml;
        
        let facHtml = '';
        data.respawns_faccion.forEach(f => {
            const color = f.faccion_nombre.toLowerCase() === 'syldavia' ? 'var(--color-syldavia)' : 'var(--color-volkovia)';
            facHtml += `<tr>
                <td style="color: ${color}; font-weight: bold; font-size: 1.1rem;">${f.faccion_nombre}</td>
                <td style="text-align: center; font-size: 1.5rem; font-family: var(--font-mono);">${f.total}</td>
            </tr>`;
        });
        if(document.getElementById('stats-faccion-tbody')) document.getElementById('stats-faccion-tbody').innerHTML = facHtml;
        
        let kHtml = '';
        let totalSylK = 0;
        let totalVolK = 0;
        if (data.hourly_koronnas) {
            data.hourly_koronnas.forEach(h => {
                totalSylK += h['1'];
                totalVolK += h['2'];
                
                kHtml += `<tr>
                    <td style="font-family: var(--font-mono); font-size: 1.1rem; color: #ddd;">${h.hora}</td>
                    <td style="font-family: var(--font-mono); font-size: 1.2rem; color: var(--color-syldavia);">${h['1'].toLocaleString()}</td>
                    <td style="font-family: var(--font-mono); font-size: 1.2rem; color: var(--color-volkovia);">${h['2'].toLocaleString()}</td>
                </tr>`;
            });
            if(document.getElementById('stats-koronnas-tbody')) document.getElementById('stats-koronnas-tbody').innerHTML = kHtml;
            if(document.getElementById('koronnas-syl-total')) document.getElementById('koronnas-syl-total').innerText = totalSylK.toLocaleString();
            if(document.getElementById('koronnas-vol-total')) document.getElementById('koronnas-vol-total').innerText = totalVolK.toLocaleString();
        }
        
    } catch (e) {
        console.error("Error loading analytics", e);
    }
}

// Intercept tab changes
document.querySelectorAll('.nav-icon-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const target = e.currentTarget.getAttribute('data-target');
        if (target === 'view-stats') {
            loadAnalytics();
        }
        if (target === 'view-seguridad') {
            loadSeguridad();
            if (typeof cargarArmasDashboard === 'function') {
                cargarArmasDashboard();
            }
        }
    });
});


// --- SEGURIDAD ---
async function loadSeguridad() {
    try {
        const res = await fetch('/api/equipos');
        const equipos = await res.json();
        
        const tbody = document.getElementById('seguridad-equipos-tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        
        equipos.forEach(eq => {
            const facColor = eq.faccion_id === 1 ? 'var(--color-syldavia)' : (eq.faccion_id === 2 ? 'var(--color-volkovia)' : '#888');
            
            tbody.innerHTML += `
                <tr>
                    <td data-label="Unidad" style="font-weight: bold; color: #fff;">
                        ${eq.nombre}
                        <div style="font-size: 0.75rem; color: #aaa; font-weight: normal; margin-top: 3px;">
                            User: <span style="color:#ffcc00">${eq.codigo || 'Sin código'}</span>
                        </div>
                    </td>
                    <td data-label="Facción" style="color: ${facColor};">${eq.faccion_nombre}</td>
                    <td data-label="PIN Acceso">
                        <input type="text" id="pwd-${eq.id}" value="" placeholder="*** (Nuevo PIN)" style="background: rgba(0,0,0,0.3); border: 1px solid #444; color: #fff; padding: 5px 10px; width: 100%; border-radius: 3px; font-family: var(--font-mono);">
                    </td>
                    <td data-label="Acciones" style="text-align: center;">
                        <button class="btn btn-outline" style="padding: 5px 10px; font-size: 0.8rem;" onclick="updateEquipoPwd(${eq.id})">GUARDAR</button>
                    </td>
                </tr>
            `;
        });
    } catch(e) {
        console.error("Error loading security tab", e);
    }
}

async function updateEquipoPwd(id) {
    const input = document.getElementById(`eq-pwd-${id}`) || document.getElementById(`pwd-${id}`);
    if (!input) return;
    const pwd = input.value.trim();
    if (!pwd) {
        alert("Introduce un nuevo PIN de acceso para la unidad.");
        return;
    }
    
    // To update only the password, we need to fetch the current equipo data and merge the new code
    const resGet = await fetch('/api/equipos');
    const equipos = await resGet.json();
    const eq = equipos.find(e => e.id == id);
    if (!eq) return;
    
    eq.password = pwd;
    
    const resPut = await fetch(`/api/equipos/${id}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(eq)
    });
    
    if (resPut.ok) {
        input.style.borderColor = '#2ecc71';
        input.value = '';
        input.placeholder = 'OK';
        setTimeout(() => input.style.borderColor = '#444', 2000);
    } else {
        alert("Error al actualizar la contraseña");
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const btnZafarrancho = document.getElementById('btn-zafarrancho');
    if (btnZafarrancho) {
        btnZafarrancho.addEventListener('click', async () => {
            if (confirm("¡ALERTA ROJA! ¿Estás absolutamente seguro de que quieres BORRAR todas las capturas, respawns, misiones y usos médicos actuales? ESTO NO SE PUEDE DESHACER.")) {
                if (prompt("Escribe 'PURGAR' para confirmar:") === 'PURGAR') {
                    const res = await fetch('/api/admin/reset', { method: 'POST' });
                    const data = await res.json();
                    if (data.status === 'success') {
                        alert(data.message);
                        window.location.reload();
                    } else {
                        alert("Error: " + data.message);
                    }
                }
            }
        });
    }
});


// --- LOGICA MORTERO ---

// --- MORTERO (LEAFLET REWRITE) ---
let morteroMap = null;
let morteroBatteryMarker = null;
let morteroCursorMarker = null;
let morteroAuth = false;
let pendingBatteryLat = null;
let pendingBatteryLng = null;
let serverLat = null;
let serverLng = null;
let isPendingLocation = false;
let cooldownInterval = null;

function initMortero() {
    morteroAuth = true;
    // We give it a slight delay to ensure it renders if it was selected
    setTimeout(initMorteroLeaflet, 200);

    const btnUbicar = document.getElementById('btn-ubicar-mortero');
    if (btnUbicar) {
        btnUbicar.addEventListener('click', async () => {
            const val = document.getElementById('mortero_coord_display').value;
            if (!val) {
                alert("Por favor, haz clic en el mapa o introduce una cuadrícula de despliegue.");
                return;
            }
            
            const coords = parseGrid(val);
            if (!coords) {
                alert("Formato de cuadrícula inválido. Utiliza letras y números, por ejemplo: AP 45 C");
                return;
            }
            
            pendingBatteryLat = coords.lat;
            pendingBatteryLng = coords.lng;
            
            const res = await fetch('/api/mortero/fijar', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ lat: pendingBatteryLat, lng: pendingBatteryLng, admin_faccion: document.getElementById('admin-sim-faccion')?.value })
            });
            
            if (res.ok) {
                isPendingLocation = false;
                alert("Batería desplegada en " + val.toUpperCase());
                document.getElementById('btn-ubicar-mortero').classList.remove('primary');
                document.getElementById('btn-ubicar-mortero').classList.add('outline');
                document.getElementById('btn-ubicar-mortero').innerText = "BATERÍA DESPLEGADA";
                refreshMorteroState();
            } else {
                const err = await res.json();
                alert(err.error || "Error al desplegar la batería");
            }
        });
    }

    const btnFuego = document.getElementById('btn-fuego-mortero');
    if (btnFuego) {
        btnFuego.addEventListener('click', async () => {
            if (isPendingLocation) {
                alert("¡CUIDADO! Has movido la batería en el mapa o escrito una nueva cuadrícula pero no la has desplegado.\n\nHaz clic en 'DESPLEGAR BATERÍA' antes de disparar, o el disparo saldrá desde la posición anterior.");
                return;
            }
            
            const az = parseFloat(document.getElementById('azimut').value);
            const ang = parseFloat(document.getElementById('angulo').value);
            
            if (isNaN(az) || isNaN(ang)) {
                alert("Faltan datos de disparo (Azimut o Ángulo).");
                return;
            }
            
            const res = await fetch('/api/mortero/pintar', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ azimut: az, angulo: ang, admin_faccion: document.getElementById('admin-sim-faccion')?.value })
            });
            
            if (!res.ok) {
                const data = await res.json();
                alert(data.error || "Error al disparar.");
                return;
            }
            
            const data = await res.json();
            if (data.error) {
                alert(data.error);
            } else {
                if(data.enemy_destroyed) {
                    alert("¡IMPACTO DIRECTO! Batería enemiga neutralizada.");
                }
                if(data.dynamic_targets_destroyed && data.dynamic_targets_destroyed.length > 0) {
                    alert("¡IMPACTO DIRECTO CONFIRMADO!\n\nSe ha neutralizado el objetivo dinámico en la zona del impacto.");
                }
                refreshMorteroState();
            }
        });
    }
}



const cursorIcon = L.divIcon({
    className: 'custom-cursor-icon',
    html: `
    <div style="position: relative; width: 24px; height: 24px;">
        <div style="position: absolute; width: 4px; height: 4px; background: red; top: 10px; left: 10px; border-radius: 50%;"></div>
        <div style="position: absolute; width: 2px; height: 8px; background: red; top: 0; left: 11px;"></div>
        <div style="position: absolute; width: 2px; height: 8px; background: red; bottom: 0; left: 11px;"></div>
        <div style="position: absolute; width: 8px; height: 2px; background: red; top: 11px; left: 0;"></div>
        <div style="position: absolute; width: 8px; height: 2px; background: red; top: 11px; right: 0;"></div>
    </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
});

const batteryIcon = L.divIcon({
    className: 'custom-battery-icon',
    html: `
    <div style="position: relative; width: 24px; height: 24px; display: flex; justify-content: center; align-items: center;">
        <div style="position: absolute; width: 100%; height: 100%; border: 2px solid #000; border-radius: 2px;"></div>
        <div style="position: absolute; width: 2px; height: 16px; background: #000;"></div>
        <div style="position: absolute; width: 16px; height: 2px; background: #000;"></div>
    </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
});

function initMorteroLeaflet() {
    const container = document.getElementById('mortero-leaflet-map');
    if (!container) return;
    
    if (morteroMap) {
        morteroMap.invalidateSize();
        return;
    }

    const bounds = [[0, 0], [2000, 3000]];
    morteroMap = L.map('mortero-leaflet-map', {
        crs: L.CRS.Simple,
        minZoom: -2,
        maxZoom: 2,
        zoomControl: false,
        maxBounds: bounds,
        maxBoundsViscosity: 1.0
    });
    L.control.zoom({ position: 'topright' }).addTo(morteroMap);
    L.imageOverlay('/static/map/Full_Mapa%20Oct24.png', bounds).addTo(morteroMap);
    morteroMap.setView([1000, 1500], 0);
    
    const btnMeasureMortero = document.getElementById('btn-measure');
    if (btnMeasureMortero) {
        btnMeasureMortero.addEventListener('click', () => {
            if (typeof setMode === 'function') {
                if (typeof currentMode !== 'undefined' && currentMode === 'measure') {
                    setMode('pan');
                } else {
                    setMode('measure');
                }
            }
        });
    }


    // Coordinate hover (Grid)
    morteroMap.on('mousemove', (e) => {
        const hoverCoord = document.getElementById('mortero-hover-coord');
        if (hoverCoord && typeof getGridCoordinate !== 'undefined') {
            hoverCoord.innerText = getGridCoordinate(e.latlng.lat, e.latlng.lng);
        }
        
        // Propagate to map.js for measuring
        if (typeof handleMapMouseMove !== 'undefined') {
            handleMapMouseMove(e);
        }
    });
    
    

    // Click to place battery
    morteroMap.on('click', (e) => {
        if (typeof showClickPing === 'function') {
            const gridCoord = typeof getGridCoordinate === 'function' ? getGridCoordinate(e.latlng.lat, e.latlng.lng) : '--';
            showClickPing(morteroMap, e.latlng, gridCoord);
        }
        if (typeof currentMode !== 'undefined' && currentMode === 'measure') {
            if (typeof handleMapClick === 'function') {
                handleMapClick(e);
            }
            return;
        }
        pendingBatteryLat = e.latlng.lat;
        pendingBatteryLng = e.latlng.lng;
        
        if (morteroCursorMarker) {
            morteroCursorMarker.setLatLng(e.latlng);
        } else {
            morteroCursorMarker = L.marker(e.latlng, { icon: cursorIcon }).addTo(morteroMap);
        }
        
        const display = document.getElementById('mortero_coord_display');
        if (display && typeof getGridCoordinate !== 'undefined') {
            display.value = getGridCoordinate(e.latlng.lat, e.latlng.lng);
        }
        
        document.getElementById('btn-ubicar-mortero').disabled = false;
    });

    refreshMorteroState();
    setInterval(refreshMorteroState, 3000);

    // Force layout recalculation after initialization to fix empty cartography on mobile
    setTimeout(() => {
        if (morteroMap) morteroMap.invalidateSize();
    }, 500);
}

let morteroShotsLayer = L.layerGroup();

async function refreshMorteroState() {
    if (!morteroAuth) return;
    
    const simFac = document.getElementById('admin-sim-faccion')?.value || '';
    const res = await fetch('/api/mortero/todos_json' + (simFac ? '?faccion='+simFac : ''));
    const data = await res.json();
    
    if (data.error) return;

    // Activo o Inhabilitado
    const statusEl = document.getElementById('mortero-status');
    const overlay = document.getElementById('overlay-mortero-inhabilitado');
    const btnFuego = document.getElementById('btn-fuego-mortero');
    
    if (data.activo) {
        statusEl.innerText = "OPERATIVO";
        statusEl.style.background = "#4CAF50";
        overlay.style.display = "none";
        btnFuego.disabled = false;
    } else {
        statusEl.innerText = "INHABILITADO";
        statusEl.style.background = "#F44336";
        overlay.style.display = "flex";
        btnFuego.disabled = true;
    }

    // Dibujar batería si viene de la DB y no hay pendiente sin confirmar
    if (data.lat && data.lng) {
        if (!morteroBatteryMarker) {
            morteroBatteryMarker = L.marker([data.lat, data.lng], { icon: batteryIcon }).addTo(morteroMap);
            if (typeof getGridCoordinate !== 'undefined') {
                document.getElementById('mortero_coord_display').value = getGridCoordinate(data.lat, data.lng);
            }
        } else {
            morteroBatteryMarker.setLatLng([data.lat, data.lng]);
        }
    }

    // Dibujar disparos
    morteroShotsLayer.clearLayers();
    data.disparos.forEach(d => {
        if(d.pixel_x && d.pixel_y) {
            const PIXELS_PER_METER = 31.71 / 50.0;
            const radiusPx = (data.radio_explosion || 15) * PIXELS_PER_METER;
            let shotFill = '#ff4444';
            if (d.faccion === 'Syldavia') { shotFill = '#e2b938'; }
            else if (d.faccion === 'Volkovia') { shotFill = '#0088ff'; }
            else if (d.faccion === 'Khemed') { shotFill = '#00cc00'; }

            // Círculo de impacto: Contorno rojo para ambas facciones y relleno con color de la facción
            L.circle([d.pixel_x, d.pixel_y], {
                color: '#ff2222',       // Contorno rojo
                weight: 2.5,            // Borde nítido y visible
                opacity: 0.9,           // Alta visibilidad del contorno
                fillColor: shotFill,    // Color de la facción
                fillOpacity: 0.35,      // Relleno visible sobre el terreno
                radius: radiusPx
            }).bindPopup(`
                <div style="font-family: sans-serif; font-size: 0.9rem;">
                    <b style="color: ${shotFill};">${d.faccion}</b><br>
                    <span style="color: #bbb; font-size: 0.8rem;">Impacto: ${d.timestamp}</span>
                </div>
            `).addTo(morteroShotsLayer);

            // Marcador de punto central del impacto
            L.circleMarker([d.pixel_x, d.pixel_y], {
                radius: 2.5,
                color: '#ff2222',
                fillColor: '#ff2222',
                fillOpacity: 1,
                interactive: false
            }).addTo(morteroShotsLayer);
        }
    });
    if(!morteroMap.hasLayer(morteroShotsLayer)) {
        morteroShotsLayer.addTo(morteroMap);
    }
    
    // Cooldown logic
    updateCooldownBar(data.cooldown_remaining);
}

let remainingCd = 0;
function updateCooldownBar(secondsLeft) {
    remainingCd = secondsLeft;
    
    if (cooldownInterval) clearInterval(cooldownInterval);
    
    const bar = document.getElementById('mortero-heat-bar');
    const txt = document.getElementById('mortero-heat-text');
    const btnFuego = document.getElementById('btn-fuego-mortero');
    
    // We need the max cooldown to calculate percentage. Let's assume 30s max for now, 
    // or just animate based on seconds left.
    // If it's > 0, it's heating.
    
    cooldownInterval = setInterval(() => {
        if (remainingCd > 0) {
            remainingCd -= 0.1;
            btnFuego.disabled = true;
            btnFuego.style.opacity = 0.5;
            bar.style.width = '100%';
            bar.style.background = '#F44336';
            txt.innerText = `ENFRIANDO (${Math.ceil(remainingCd)}s)`;
            txt.style.color = '#F44336';
        } else {
            remainingCd = 0;
            // Check if it's destroyed, if not enable
            if (document.getElementById('mortero-status').innerText === "OPERATIVO") {
                btnFuego.disabled = false;
            }
            btnFuego.style.opacity = 1;
            bar.style.width = '0%';
            txt.innerText = `LISTO`;
            txt.style.color = '#4CAF50';
            clearInterval(cooldownInterval);
        }
    }, 100);
}

// --- ADMIN ARTILLERIA ---
async function loadAdminArtilleria() {
    const panel = document.getElementById('admin-artilleria-panel');
    if (!panel) return;
    
    const res = await fetch('/api/admin/artilleria');
    const data = await res.json();
    
    if (data.config) {
        document.getElementById('admin-alcance-base').value = data.config.alcance_base;
        document.getElementById('admin-radio-explosion').value = data.config.radio_explosion;
        document.getElementById('admin-cadencia').value = data.config.disparos_por_minuto;
        if (document.getElementById('admin-duracion-radar')) {
            document.getElementById('admin-duracion-radar').value = data.config.duracion_radar_minutos || 15;
        }
    }
    
    if (data.estados) {
        data.estados.forEach(e => {
            const btnActiva = e.faccion_id === 1 ? document.getElementById('btn-syl-activa') : document.getElementById('btn-vol-activa');
            const btnInactiva = e.faccion_id === 1 ? document.getElementById('btn-syl-inactiva') : document.getElementById('btn-vol-inactiva');
            
            if (btnActiva && btnInactiva) {
                if (e.activo) {
                    btnActiva.className = "btn primary";
                    btnActiva.style.opacity = "1";
                    btnInactiva.className = "btn outline";
                    btnInactiva.style.opacity = "0.5";
                } else {
                    btnActiva.className = "btn outline";
                    btnActiva.style.opacity = "0.5";
                    btnInactiva.className = "btn danger";
                    btnInactiva.style.opacity = "1";
                }
                
                btnActiva.onclick = async () => {
                    await fetch(`/api/admin/artilleria/estado/${e.faccion_id}`, {
                        method: 'PUT',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ activo: true })
                    });
                    loadAdminArtilleria();
                };
                
                btnInactiva.onclick = async () => {
                    await fetch(`/api/admin/artilleria/estado/${e.faccion_id}`, {
                        method: 'PUT',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ activo: false })
                    });
                    loadAdminArtilleria();
                };
            }
        });
    }
}

document.getElementById('btn-admin-guardar-artilleria')?.addEventListener('click', async () => {
    const alcance = document.getElementById('admin-alcance-base').value;
    const radio = document.getElementById('admin-radio-explosion').value;
    const cadencia = document.getElementById('admin-cadencia').value;
    const duracion = document.getElementById('admin-duracion-radar')?.value || 15;
    
    await fetch('/api/admin/artilleria/config', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ 
            alcance_base: alcance, 
            radio_explosion: radio, 
            disparos_por_minuto: cadencia,
            duracion_radar_minutos: duracion 
        })
    });
    alert("Ajustes de artillería guardados.");
});


function parseGrid(text) {
    const cleanText = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const match = cleanText.match(/^([A-Z]{2})(\d{1,2})([A-Z]{1,2})?$/);
    if (!match) return null;
    
    const letters = match[1];
    const num = parseInt(match[2]);
    const sub = match[3] || 'C';
    
    const colIdx = (letters.charCodeAt(0) - 65) * 26 + (letters.charCodeAt(1) - 65) + 1;
    const rowIdx = num;
    
    if (colIdx < 1 || rowIdx < 1 || colIdx > 100 || rowIdx > 100) return null;
    
    const ORIGIN_X = 66.15; 
    const ORIGIN_Y = 59.5;  
    const GRID_SIZE_X = 31.71;
    const GRID_SIZE_Y = 29.9435;
    
    let fracX = 0.5; let fracY = 0.5;
    if (sub === 'NO') { fracX = 0.25; fracY = 0.25; }
    else if (sub === 'N') { fracX = 0.5; fracY = 0.25; }
    else if (sub === 'NE') { fracX = 0.75; fracY = 0.25; }
    else if (sub === 'O') { fracX = 0.25; fracY = 0.5; }
    else if (sub === 'E') { fracX = 0.75; fracY = 0.5; }
    else if (sub === 'SO') { fracX = 0.25; fracY = 0.75; }
    else if (sub === 'S') { fracX = 0.5; fracY = 0.75; }
    else if (sub === 'SE') { fracX = 0.75; fracY = 0.75; }
    
    const canvasX = ORIGIN_X + (colIdx - 1) * GRID_SIZE_X + (fracX * GRID_SIZE_X);
    const canvasY = ORIGIN_Y + (rowIdx - 1) * GRID_SIZE_Y + (fracY * GRID_SIZE_Y);
    
    return { lat: 2000 - canvasY, lng: canvasX };
}

setTimeout(() => { if (typeof loadAdminArtilleria === 'function') loadAdminArtilleria(); }, 1000);

document.getElementById('btn-admin-limpiar-impactos')?.addEventListener('click', async () => {
    if (confirm("¿Estás seguro de que quieres borrar todos los impactos del mapa?")) {
        const res = await fetch('/api/admin/artilleria/limpiar', { method: 'DELETE' });
        if (res.ok) {
            alert("Impactos borrados.");
            if (typeof refreshMorteroState === 'function') refreshMorteroState();
        }
    }
});

// --- D-PAD LOGIC FOR MOBILE MAP ---
const dpadStep = 200; // pixels to pan per click
document.getElementById('dpad-up')?.addEventListener('click', () => { if(morteroMap) morteroMap.panBy([0, -dpadStep]); });
document.getElementById('dpad-down')?.addEventListener('click', () => { if(morteroMap) morteroMap.panBy([0, dpadStep]); });
document.getElementById('dpad-left')?.addEventListener('click', () => { if(morteroMap) morteroMap.panBy([-dpadStep, 0]); });
document.getElementById('dpad-right')?.addEventListener('click', () => { if(morteroMap) morteroMap.panBy([dpadStep, 0]); });
document.getElementById('dpad-zoom-in')?.addEventListener('click', () => { if(morteroMap) morteroMap.zoomIn(); });
document.getElementById('dpad-zoom-out')?.addEventListener('click', () => { if(morteroMap) morteroMap.zoomOut(); });

async function guardarEsquema() {
    const nombre = prompt("Nombre para la Plantilla del Mapa (Ej: M01-Despliegue Inicial):");
    if (!nombre) return;
    
    // Obtenemos los datos actuales de la faccion desde la BD
    const currentFactionId = facciones.find(f => f.nombre === currentFaction)?.id;
    if(!currentFactionId) return;

    try {
        const resR = await fetch(`/api/mapa/rutas?faccion_id=${currentFactionId}`);
        const rutas = await resR.json();
        
        const resM = await fetch(`/api/mapa/marcadores?faccion_id=${currentFactionId}`);
        const marcadores = await resM.json();
        
        const resZ = await fetch(`/api/mapa/zonas?faccion_id=${currentFactionId}`);
        const zonas = await resZ.json();
        
        const datos_json = JSON.stringify({ rutas, marcadores, zonas });
        
        const res = await fetch('/api/mapa/esquemas', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ nombre, datos_json })
        });
        
        if (res.ok) {
            alert('¡Plantilla guardada correctamente! Ahora puedes ir a la vista de Misiones y asociarla.');
            loadEsquemasAdmin();
        } else {
            alert('Error guardando la plantilla.');
        }
    } catch(e) {
        console.error(e);
        alert('Error: ' + e.message);
    }
}

async function limpiarDibujosMapa() {
    if(!confirm("¿Borrar todos los dibujos, zonas y marcadores de esta facción en la base de datos de forma permanente?")) return;
    const currentFactionId = facciones.find(f => f.nombre === currentFaction)?.id;
    if(!currentFactionId) return;

    try {
        await fetch(`/api/mapa/rutas?faccion_id=${currentFactionId}`, { method: 'DELETE' });
        await fetch(`/api/mapa/zonas?faccion_id=${currentFactionId}`, { method: 'DELETE' });
        await fetch(`/api/mapa/marcadores?faccion_id=${currentFactionId}`, { method: 'DELETE' });
        
        if (typeof loadMapData === 'function') {
            loadMapData();
        }
        alert("Mapa limpiado correctamente.");
    } catch(e) {
        console.error("Error limpiando:", e);
        alert("Hubo un error al limpiar el mapa: " + e.message);
    }
}

async function abrirLibreriaEsquemas() {
    const res = await fetch('/api/mapa/esquemas');
    const esquemas = await res.json();
    const tbody = document.getElementById('tbody-libreria-esquemas');
    if(!tbody) return;
    
    tbody.innerHTML = '';
    esquemas.forEach(e => {
        const tr = document.createElement('tr');
        // Usamos single quotes y codificamos el json para que no rompa el onclick
        const jsonStr = JSON.stringify(e.datos_json).replace(/'/g, "\\'");
        tr.innerHTML = `
            <td>${e.nombre}</td>
            <td style="display:flex; gap: 5px;">
                <button class="btn warning" style="padding: 2px 5px; font-size: 0.75rem;" onclick='verEsquema(${JSON.stringify(e.datos_json)})'>Ver</button>
                <button class="btn primary" style="padding: 2px 5px; font-size: 0.75rem;" onclick='cargarPlantillaEnMapa(${JSON.stringify(e.datos_json)})'>Al Mapa</button>
                <button class="btn danger" style="padding: 2px 5px; font-size: 0.75rem;" onclick="eliminarEsquema(${e.id})">Borrar</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    document.getElementById('modal-libreria-esquemas').classList.add('active');
}

async function eliminarEsquema(id) {
    if(!confirm("¿Borrar plantilla? Esto también quitará el mapa de las misiones que lo tengan asignado.")) return;
    await fetch(`/api/mapa/esquemas/${id}`, { method: 'DELETE' });
    abrirLibreriaEsquemas(); 
    loadEsquemasAdmin(); 
}

async function cargarPlantillaEnMapa(datos_json_str) {
    if(!confirm("Esto AÑADIRÁ los trazos de la plantilla al mapa Táctico ACTUAL de tu facción. Recomendamos usar el botón 'Limpiar Mapa' antes si quieres que quede idéntico a la plantilla. ¿Continuar?")) return;
    
    const currentFactionId = facciones.find(f => f.nombre === currentFaction)?.id;
    if(!currentFactionId) return;

    let datos = datos_json_str;
    if (typeof datos === 'string') {
        try { datos = JSON.parse(datos); } catch(e) {}
    }
    
    document.getElementById('modal-libreria-esquemas').classList.remove('active');
    
    try {
        if(datos.rutas) {
            for(const r of datos.rutas) {
                await fetch('/api/mapa/rutas', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ faccion_id: currentFactionId, nombre: r.nombre, color: r.color, puntos_json: r.puntos_json })
                });
            }
        }
        if(datos.zonas) {
            for(const z of datos.zonas) {
                await fetch('/api/mapa/zonas', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ faccion_id: currentFactionId, nombre: z.nombre, color: z.color, puntos_json: z.puntos_json })
                });
            }
        }
        if(datos.marcadores) {
            for(const m of datos.marcadores) {
                await fetch('/api/mapa/marcadores', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ faccion_id: currentFactionId, tipo: m.tipo, descripcion: m.descripcion, lat: m.lat, lng: m.lng })
                });
            }
        }
        
        if (typeof loadMapData === 'function') {
            loadMapData();
        }
        alert("Plantilla volcada en el mapa.");
    } catch(e) {
        console.error("Error cargando plantilla:", e);
        alert("Hubo un error al cargar la plantilla: " + e.message);
    }
}

let visorMap = null;
function verEsquema(esquemaJsonStr) {
    document.getElementById('modal-mapa-mision').classList.add('active');
    
    if(!visorMap) {
        visorMap = L.map('visor-leaflet-map', {
            crs: L.CRS.Simple,
            minZoom: -2,
            maxZoom: 2,
            zoomControl: true,
            attributionControl: false
        });
        const bounds = [[0, 0], [2000, 3000]];
        const imageOverlay = L.imageOverlay('/static/map/Full_Mapa%20Oct24.png?v=4', bounds).addTo(visorMap);
        visorMap.fitBounds(bounds);

        visorMap.on('click', (e) => {
            if (typeof showClickPing === 'function') {
                const gridCoord = typeof getGridCoordinate === 'function' ? getGridCoordinate(e.latlng.lat, e.latlng.lng) : '--';
                showClickPing(visorMap, e.latlng, gridCoord);
            }
        });
    }
    
    // Limpiar capas previas
    visorMap.eachLayer((layer) => {
        if(layer instanceof L.Polyline || layer instanceof L.Polygon || layer instanceof L.Marker) {
            visorMap.removeLayer(layer);
        }
    });
    
    try {
        const data = JSON.parse(esquemaJsonStr);
        
        // Cargar rutas
        if(data.rutas) {
            data.rutas.forEach(r => {
                const pts = JSON.parse(r.puntos_json);
                const polyline = L.polyline(pts, { color: r.color, weight: 3 }).addTo(visorMap);
                L.polylineDecorator(polyline, {
                    patterns: [
                        {offset: 25, repeat: 50, symbol: L.Symbol.arrowHead({pixelSize: 15, pathOptions: {fillOpacity: 1, weight: 0, color: r.color}})}
                    ]
                }).addTo(visorMap);
            });
        }
        
        // Cargar zonas
        if(data.zonas) {
            data.zonas.forEach(z => {
                const pts = JSON.parse(z.puntos_json);
                L.polygon(pts, { color: z.color, weight: 2, fillColor: z.color, fillOpacity: 0.2 }).addTo(visorMap);

                if (z.nombre) {
                    // Approximate center by using the first point or a bounding box center if preferred
                    // For simplicity, we can use the first point or calculate the average of points
                    let latSum = 0, lngSum = 0;
                    pts.forEach(p => { latSum += p.lat; lngSum += p.lng; });
                    const center = { lat: latSum / pts.length, lng: lngSum / pts.length };
                    
                    L.marker(center, {
                        icon: L.divIcon({
                            className: 'zone-label',
                            html: `<div style="color: white; font-weight: bold; text-shadow: 1px 1px 2px black; font-size: 1.1em; text-align: center; white-space: nowrap;">${z.nombre}</div>`,
                            iconSize: null,
                        }),
                        interactive: false
                    }).addTo(visorMap);
                }
            });
        }
        
        // Cargar marcadores
        if(data.marcadores) {
            data.marcadores.forEach(m => {
                const isTL = m.tipo === 'tl_pos';
                const className = isTL ? 'tl-marker' : 'intel-marker';
                
                const colorMap = {
                    'Syldavia': '#ffc107', 'Volkovia': '#2196F3', 'Khemed': '#4CAF50', 'Neutral': '#9e9e9e'
                };
                const color = colorMap[currentFaction] || '#ff0000';
                
                const htmlIcon = isTL 
                    ? `<div style="display:flex; justify-content:center; align-items:center; width: 28px; height: 28px; border-radius: 50%; background-color: ${color}; border: 2px solid white; box-shadow: 0 0 5px black; color: white; margin: auto;"><span class="material-symbols-outlined" style="font-size: 18px;">my_location</span></div>` 
                    : `<div style="display:flex; justify-content:center; align-items:center; width: 28px; height: 28px; background: rgba(220, 38, 38, 0.9); border: 2px solid white; box-shadow: 0 0 5px black; color: white; border-radius: 4px; transform: rotate(45deg);"><span class="material-symbols-outlined" style="transform: rotate(-45deg); font-size: 18px;">warning</span></div>`;

                const customIcon = L.divIcon({
                    className: className,
                    html: htmlIcon,
                    iconSize: [24, 24],
                    iconAnchor: [12, 12]
                });
                
                L.marker([m.lat, m.lng], { icon: customIcon }).addTo(visorMap)
                 .bindTooltip(m.descripcion || 'Intel', { permanent: false, direction: 'right' });
            });
        }
        
        // Cargar POIs vivos
        if(typeof todosPOIs !== 'undefined') {
            const currentFaccionData = facciones.find(f => f.nombre === currentFaction);
            const currentFid = currentFaccionData ? currentFaccionData.id : null;

            todosPOIs.forEach(poi => {
                if(poi.lat && poi.lng) {
                    if (currentFid) {
                        const vp = poi.visible_para;
                        if (vp !== null && vp !== 0 && vp !== '0' && vp !== '') {
                            try {
                                let arr = [];
                                if (typeof vp === 'string' && vp.startsWith('[')) {
                                    arr = JSON.parse(vp);
                                } else if (typeof vp === 'number' || !isNaN(vp)) {
                                    arr = [parseInt(vp)];
                                }
                                if (arr.length > 0 && !arr.includes(currentFid)) {
                                    return;
                                }
                            } catch(e) {}
                        }
                    }

                    let faccion_name = 'Neutral';
                    if(poi.faccion_id === 1) faccion_name = 'Syldavia';
                    if(poi.faccion_id === 2) faccion_name = 'Volkovia';
                    const color = {'Syldavia':'#ffc107', 'Volkovia':'#2196F3', 'Khemed':'#4CAF50', 'Neutral':'#9e9e9e'}[faccion_name] || '#9e9e9e';
                    const bg = faccion_name === 'Neutral' ? 'white' : color;
                    const fg = faccion_name === 'Neutral' ? '#9e9e9e' : 'white';
                    
                    let matIcon = 'flag';
                    if (poi.tipo === 'RESPAWN') matIcon = 'home';
                    if (poi.tipo === 'MISION') matIcon = 'star';
                    if (poi.tipo === 'OP') matIcon = 'visibility';
                    
                    const poiIcon = L.divIcon({
                        className: 'poi-icon',
                        html: `<div style="background-color: ${bg}; width: 30px; height: 30px; display: flex; justify-content: center; align-items: center; border-radius: 5px; border: 2px solid ${faccion_name === 'Neutral' ? '#9e9e9e' : 'white'}; box-shadow: 0 0 5px rgba(0,0,0,0.5);">
                                 <span class="material-symbols-outlined" style="color: ${fg}; font-size: 20px;">${matIcon}</span>
                               </div>`,
                        iconSize: [30, 30],
                        iconAnchor: [15, 15]
                    });
                    
                    let mapPx = {lat: poi.lat, lng: poi.lng};
                    if (window.mapProjector) {
                        mapPx = window.mapProjector.gpsToMap(poi.lat, poi.lng);
                    }
                    
                    L.marker([mapPx.lat, mapPx.lng], { icon: poiIcon }).addTo(visorMap)
                     .bindTooltip(`<b>${poi.nombre}</b>`, {direction: 'top'});
                }
            });
        }

        // Cargar Grupos de Batalla
        if(typeof todosGrupos !== 'undefined' && typeof facciones !== 'undefined') {
            todosGrupos.forEach(g => {
                if(g.pos_x && g.pos_y) {
                    const faccionDelGrupo = facciones.find(f => f.id === g.faccion_id);
                    // Solo mostrar los grupos de la faccion que estamos visualizando
                    if (faccionDelGrupo && faccionDelGrupo.nombre !== currentFaction) {
                        return;
                    }
                    
                    const faccionNombre = faccionDelGrupo ? faccionDelGrupo.nombre : '';
                    let prefix = '';
                    if (faccionNombre === 'Syldavia') prefix = 's';
                    if (faccionNombre === 'Volkovia') prefix = 'v';
                    if (faccionNombre === 'Khemed') prefix = 'k';

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
                        if (faccionNombre === 'Syldavia') imgSrc = '/static/imgs/syldavia_negro.png';
                        if (faccionNombre === 'Volkovia') imgSrc = '/static/imgs/vokovia_negro.png';
                        if (faccionNombre === 'Khemed') imgSrc = '/static/imgs/khemed_negro.png';
                    }

                    const teamsInGroup = typeof todasAsignaciones !== 'undefined' ? todasAsignaciones.filter(a => a.grupo_batalla_id === g.id) : [];
                    const totalJugadores = teamsInGroup.reduce((sum, t) => sum + (t.jugadores || 0), 0);

                    const html = `<div style="text-align: center; position: relative;">
                        <img src="${imgSrc}" style="width: 38px; filter: drop-shadow(0px 2px 3px rgba(0,0,0,0.8)); pointer-events: none;" />
                        <div style="position: absolute; bottom: -18px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.85); color: white; border-radius: 4px; padding: 2px 6px; font-size: 11px; font-weight: bold; pointer-events: none; white-space: nowrap; border: 1px solid rgba(255,255,255,0.2);">
                            ${g.nombre} <span style="color:#aaa;font-size:0.9em;">(${totalJugadores}px)</span>
                        </div>
                    </div>`;

                    const gIcon = L.divIcon({
                        className: 'custom-map-icon',
                        html: html,
                        iconSize: [38, 56],
                        iconAnchor: [19, 28]
                    });
                    L.marker([g.pos_x, g.pos_y], { icon: gIcon }).addTo(visorMap);
                }
            });
        }
        
    } catch(e) {
        console.error("Error parseando esquema", e);
    }
}




// --- LÓGICA DE TAGS DE EQUIPO ---
function renderTagsUI() {
    const inputTags = document.getElementById('eq-tags');
    if(!inputTags) return;
    const tagsArr = JSON.parse(inputTags.value || '[]');
    const container = document.getElementById('tags-asignados');
    container.innerHTML = '';
    
    let hasRed = false;
    let hasYellow = false;
    
    tagsArr.forEach(t => {
        if (t.type === 'red') hasRed = true;
        if (t.type === 'yellow') hasYellow = true;
        
        const badge = document.createElement('span');
        badge.style.padding = '0.25rem 0.5rem';
        badge.style.borderRadius = '4px';
        badge.style.fontSize = '0.85rem';
        badge.style.cursor = 'pointer';
        badge.style.color = 'white';
        badge.style.display = 'flex';
        badge.style.alignItems = 'center';
        badge.style.gap = '0.25rem';
        
        if (t.type === 'green') badge.style.background = '#153';
        if (t.type === 'yellow') badge.style.background = '#a80';
        if (t.type === 'red') badge.style.background = '#811';
        
        badge.innerText = t.name + (t.note ? `: ${t.note}` : '') + ' ✖';
        badge.title = "Click para borrar";
        badge.onclick = () => {
            const newArr = tagsArr.filter(x => x.name !== t.name);
            inputTags.value = JSON.stringify(newArr);
            renderTagsUI();
        };
        container.appendChild(badge);
    });
    
    let medalla = 'verde';
    if (hasYellow) medalla = 'amarillo';
    if (hasRed) medalla = 'rojo';
    
    document.getElementById('eq-estado-medalla').value = medalla;
    
    const badgeUi = document.getElementById('badge-medalla');
    const estadoSancionSelect = document.getElementById('eq-estado-sancion');
    
    if (badgeUi && window.userRole === 'admin') {
        badgeUi.style.display = 'block';
        const sancion = estadoSancionSelect ? estadoSancionSelect.value : 'Autorizado';
        if (sancion === 'Autorizado') {
            badgeUi.innerHTML = 'AUTORIZADO PARA DESPLIEGUE';
            badgeUi.style.color = '#2a5';
            badgeUi.style.border = '1px solid #2a5';
            badgeUi.style.background = 'rgba(17, 85, 51, 0.2)';
        } else if (sancion === 'Penalizado (1 evento)') {
            badgeUi.innerHTML = 'SANCIONADOS DISCIPLINARIAMENTE';
            badgeUi.style.color = '#ffaa00';
            badgeUi.style.border = '1px solid #da0';
            badgeUi.style.background = 'rgba(170, 136, 0, 0.2)';
        } else {
            badgeUi.innerHTML = 'APARTADOS DEL SERVICIO';
            badgeUi.style.color = '#ff5555';
            badgeUi.style.border = '1px solid #f33';
            badgeUi.style.background = 'rgba(136, 17, 17, 0.3)';
        }
    } else if (badgeUi) {
        badgeUi.style.display = 'none';
    }
}

if (document.getElementById('eq-estado-sancion')) {
    document.getElementById('eq-estado-sancion').addEventListener('change', renderTagsUI);
}

document.querySelectorAll('.btn-tag').forEach(btn => {
    btn.addEventListener('click', () => {
        const inputTags = document.getElementById('eq-tags');
        if(!inputTags) return;
        const tagsArr = JSON.parse(inputTags.value || '[]');
        const tag = btn.dataset.tag;
        
        if(tagsArr.find(t => t.name === tag)) return;
        
        let type = 'green';
        if (btn.style.background.includes('136, 17, 17') || btn.style.background.includes('129, 17') || btn.dataset.tag.includes('Trampas') || btn.dataset.tag.includes('Mala Actitud')) type = 'red';
        else if (btn.style.background.includes('170, 136, 0') || btn.style.background.includes('168, 128') || btn.dataset.tag.includes('Desorganizados') || btn.dataset.tag.includes('Radio')) type = 'yellow';
        
        let note = '';
        if (type === 'red') {
            note = prompt(`Por favor, indica un motivo breve para "${tag}" (ej: Se saltó un respawn):`);
            if(note === null) return;
        }
        
        tagsArr.push({ name: tag, type: type, note: note });
        inputTags.value = JSON.stringify(tagsArr);
        renderTagsUI();
    });
});

async function loadAdminArtilleriaLogs() {
    const list = document.getElementById('admin-artilleria-log-list');
    if (!list) return;
    try {
        const res = await fetch('/api/admin/artilleria/logs');
        if(!res.ok) {
            const err = await res.json().catch(() => ({}));
            list.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #ff6666; padding: 10px;">Error al cargar logs: ${err.error || res.statusText}</td></tr>`;
            return;
        }
        const logs = await res.json();
        list.innerHTML = '';
        if (!logs || logs.length === 0) {
            list.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #888; padding: 12px;">Sin impactos registrados</td></tr>';
            return;
        }
        logs.forEach(log => {
            const tr = document.createElement('tr');
            let dateStr = log.timestamp || '-';
            try {
                if (log.timestamp) {
                    const iso = (log.timestamp.includes('T') ? log.timestamp : log.timestamp.replace(' ', 'T')) + 'Z';
                    dateStr = new Date(iso).toLocaleString();
                }
            } catch(e) {}
            tr.innerHTML = `
                <td>${dateStr}</td>
                <td><span style="color: var(--color-${(log.faccion_nombre||'').toLowerCase()}); font-weight: bold;">${log.faccion_nombre || '-'}</span></td>
                <td>${log.tipo_objetivo || '-'}</td>
                <td>${log.objetivo_id || '-'}</td>
                <td>${log.descripcion || '-'}</td>
            `;
            list.appendChild(tr);
        });
    } catch (e) {
        console.error(e);
        list.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #ff6666; padding: 10px;">Error de conexión al cargar logs</td></tr>';
    }
}

document.getElementById('btn-admin-refresh-art-log')?.addEventListener('click', loadAdminArtilleriaLogs);
document.getElementById('btn-admin-clear-art-log')?.addEventListener('click', async () => {
    if (confirm("¿Estás seguro de que deseas vaciar el historial de impactos (Log)?")) {
        try {
            const res = await fetch('/api/admin/artilleria/logs', { method: 'DELETE' });
            if (res.ok) {
                loadAdminArtilleriaLogs();
            }
        } catch (e) {
            console.error(e);
        }
    }
});
setTimeout(() => { if(typeof loadAdminArtilleriaLogs === 'function') loadAdminArtilleriaLogs(); }, 1200);

// Geo-Validation Toggle Logic
async function loadGeoValidationConfig() {
    const btn = document.getElementById('btn-toggle-geo');
    if (!btn) return;
    try {
        const res = await fetch('/api/config/geo_validation');
        if (res.ok) {
            const data = await res.json();
            updateGeoToggleUI(data.geo_validation_enabled);
        }
    } catch (e) {
        console.error("Error loading geo config", e);
    }
}

function updateGeoToggleUI(isEnabled) {
    const btn = document.getElementById('btn-toggle-geo');
    if (!btn) return;
    if (isEnabled) {
        btn.textContent = "DESACTIVAR";
        btn.style.backgroundColor = "var(--danger-color)";
        btn.style.color = "#fff";
        btn.dataset.enabled = "true";
    } else {
        btn.textContent = "ACTIVAR";
        btn.style.backgroundColor = "var(--success-color, #4ade80)";
        btn.style.color = "#000";
        btn.dataset.enabled = "false";
    }
}

document.getElementById('btn-toggle-geo')?.addEventListener('click', async (e) => {
    const isEnabled = e.target.dataset.enabled === "true";
    try {
        const res = await fetch('/api/config/geo_validation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: !isEnabled })
        });
        if (res.ok) {
            const data = await res.json();
            updateGeoToggleUI(data.enabled);
        }
    } catch (err) {
        console.error("Error toggling geo config", err);
    }
});
setTimeout(() => { loadGeoValidationConfig(); }, 1200);


// OPFOR Intel Slideshow Logic
let opforSlides = [];
let opforCurrentSlide = 0;

function abrirOpfor() {
    const modal = document.getElementById('modal-opfor');
    if (!modal) return;
    
    if (!todosEquipos || todosEquipos.length === 0) {
        alert("Aún no se han cargado los equipos.");
        return;
    }

    // Determine OPFOR faction (any faction that is not currentFaction)
    // We try to find the actual opposite faction based on teams available
    let opforTeams = todosEquipos.filter(g => g.faccion_nombre && g.faccion_nombre !== currentFaction);
    
    // Some teams might not have foto_url, we only want ones with pictures
    opforSlides = opforTeams.filter(g => g.foto_url && g.foto_url.trim() !== '');

    let opforFactionName = "OPFOR";
    let opforLogoUrl = "";
    if (opforSlides.length > 0) {
        opforFactionName = opforSlides[0].faccion_nombre;
        opforLogoUrl = opforSlides[0].faccion_color || ''; // fallback if we don't have the logo easily
        // Try to get faccion object to find logo if exists
        if (typeof facciones !== 'undefined') {
            const fObj = facciones.find(f => f.nombre === opforFactionName);
            if (fObj && fObj.logo_url) opforLogoUrl = fObj.logo_url;
        }
    } else {
        // Find OPFOR name even if no photos
        const anyOpfor = opforTeams.find(g => g.faccion_nombre);
        if (anyOpfor) opforFactionName = anyOpfor.faccion_nombre;
    }

    document.getElementById('opfor-faction-name').innerText = "OPFOR: " + opforFactionName;
    const logoEl = document.getElementById('opfor-faction-logo');
    if (opforLogoUrl && opforLogoUrl.includes('.')) {
        logoEl.src = opforLogoUrl;
        logoEl.style.display = 'block';
    } else {
        logoEl.style.display = 'none';
    }

    opforCurrentSlide = 0;
    renderOpforSlide();
    modal.style.display = 'flex';
}

function renderOpforSlide() {
    const imgEl = document.getElementById('opfor-current-image');
    const nameEl = document.getElementById('opfor-team-name');
    const noIntelEl = document.getElementById('opfor-no-intel');

    if (opforSlides.length === 0) {
        imgEl.style.display = 'none';
        nameEl.style.display = 'none';
        noIntelEl.style.display = 'block';
        return;
    }

    imgEl.style.display = 'block';
    nameEl.style.display = 'block';
    noIntelEl.style.display = 'none';

    const slide = opforSlides[opforCurrentSlide];
    imgEl.src = slide.foto_url;
    nameEl.innerText = slide.nombre;
}

function opforPrevSlide() {
    if (opforSlides.length <= 1) return;
    opforCurrentSlide--;
    if (opforCurrentSlide < 0) opforCurrentSlide = opforSlides.length - 1;
    renderOpforSlide();
}

function opforNextSlide() {
    if (opforSlides.length <= 1) return;
    opforCurrentSlide++;
    if (opforCurrentSlide >= opforSlides.length) opforCurrentSlide = 0;
    renderOpforSlide();
}

window.uploadFotoMiembro = function(id) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('foto', file);
        fetch(`/api/miembros/${id}/foto`, {
            method: 'POST',
            body: formData
        })
        .then(res => res.json().then(data => ({ status: res.status, ok: res.ok, body: data })))
        .then(result => {
            if (result.ok && result.body.status === 'success') {
                alert('Foto de jugador subida correctamente.');
                const btn = document.querySelector(`button[onclick="uploadFotoMiembro(${id})"]`);
                if (btn) {
                    btn.style.background = 'rgba(0, 240, 255, 0.16)';
                    btn.style.borderColor = 'rgba(0, 240, 255, 0.45)';
                    btn.style.color = '#00f0ff';
                    btn.title = 'Foto cargada (clic para cambiar)';
                }
                if (typeof todosEquipos !== 'undefined' && Array.isArray(todosEquipos)) {
                    for (const eq of todosEquipos) {
                        if (eq.miembros) {
                            const found = eq.miembros.find(x => x.id === id);
                            if (found) {
                                found.foto_url = result.body.foto_url;
                                break;
                            }
                        }
                    }
                }
            } else {
                alert('Error al subir foto: ' + (result.body.error || 'Error del servidor'));
            }
        })
        .catch(err => {
            alert('Error al conectar con el servidor.');
        });
    };
    input.click();
};

async function openOpordModal(faccionId) {
    document.getElementById('opord-faccion-id').value = faccionId;
    const selectEsquema = document.getElementById('opord-esquema');
    selectEsquema.innerHTML = '<option value="">(Ninguno)</option>';
    try {
        const res = await fetch('/api/mapa/esquemas');
        const esquemas = await res.json();
        esquemas.forEach(e => {
            selectEsquema.innerHTML += `<option value="${e.id}">${e.nombre}</option>`;
        });
        const faccionData = facciones.find(f => f.id === faccionId);
        if (faccionData && faccionData.opord_esquema_id) {
            selectEsquema.value = faccionData.opord_esquema_id;
        }
    } catch(e) {}
    document.getElementById('opord-pdf').value = '';
    document.getElementById('modal-opord').classList.add('active');
}
document.addEventListener('DOMContentLoaded', () => {
    const formOpord = document.getElementById('form-opord');
    if (formOpord) {
        formOpord.addEventListener('submit', async (e) => {
            e.preventDefault();
            const faccionId = document.getElementById('opord-faccion-id').value;
            const esquemaId = document.getElementById('opord-esquema').value;
            const pdfInput = document.getElementById('opord-pdf');
            const formData = new FormData();
            formData.append('opord_esquema_id', esquemaId);
            const faccionData = facciones.find(f => f.id == faccionId);
            if (pdfInput.files.length > 0) {
                formData.append('pdf', pdfInput.files[0]);
            } else if (faccionData && faccionData.opord_pdf) {
                formData.append('opord_pdf', faccionData.opord_pdf);
            }
            try {
                const res = await fetch(`/api/facciones/${faccionId}/opord`, {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();
                if (data.status === 'success') {
                    document.getElementById('modal-opord').classList.remove('active');
                    const resFac = await fetch('/api/facciones');
                    facciones = await resFac.json();
                    loadORBAT();
                } else {
                    alert('Error: ' + data.error);
                }
            } catch(e) {
                alert('Error al guardar OPORD.');
            }
        });
    }
});



async function clearMorteroImpacts() {
    if(confirm('¿Limpiar todos tus impactos del mapa?')) {
        try {
            await fetch('/api/mortero/clear', {method: 'POST'});
            if(window.loadMorteroData) {
                window.loadMorteroData(); // Refresh impacts immediately
            }
        } catch(e) {
            console.error(e);
        }
    }
}
window.clearMorteroImpacts = clearMorteroImpacts;

// --- REPOSITORIO DOCUMENTAL ---
let quillDocEditor = null;

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Quill if the editor div exists
    const editorEl = document.getElementById('doc-editor');
    if (editorEl) {
        quillDocEditor = new Quill('#doc-editor', {
            theme: 'snow',
            placeholder: 'Escribe aquí el contenido del documento o normativas...',
            modules: {
                toolbar: [
                    [{ 'header': [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline', 'strike'],
                    [{ 'color': [] }, { 'background': [] }],
                    [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                    ['link', 'image', 'video'],
                    ['clean']
                ]
            }
        });
    }
    
    // Load docs on init
    cargarDocs();
});

async function cargarDocs() {
    try {
        const res = await fetch('/api/docs');
        const docs = await res.json();
        
        const container = document.getElementById('docs-container');
        if (!container) return;
        
        container.innerHTML = '';
        
        if (!docs || docs.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; color: #94a3b8; padding: 2.5rem 1rem; border: 1px dashed rgba(255,255,255,0.1); border-radius: 8px; font-family: var(--font-mono);">
                    <span class="material-symbols-outlined" style="font-size: 32px; display: block; margin-bottom: 8px; color: #64748b;">folder_open</span>
                    No hay reglamentos o normativas publicados actualmente.
                </div>
            `;
            return;
        }

        docs.forEach(doc => {
            const isPdf = doc.pdf_url && doc.pdf_url.trim() !== '';
            
            // Faction badge
            let faccionBadge = '<span style="font-size:0.7rem; padding: 2px 8px; border-radius: 4px; background: rgba(148,163,184,0.15); color: #94a3b8; border: 1px solid rgba(148,163,184,0.3); font-family: var(--font-mono); font-weight: 600;">GLOBAL / TODAS LAS FACCIONES</span>';
            if (doc.faccion_id === 1) {
                faccionBadge = '<span style="font-size:0.7rem; padding: 2px 8px; border-radius: 4px; background: rgba(0,240,255,0.12); color: #00f0ff; border: 1px solid rgba(0,240,255,0.4); font-family: var(--font-mono); font-weight: 600;">SYLDAVIA</span>';
            } else if (doc.faccion_id === 2) {
                faccionBadge = '<span style="font-size:0.7rem; padding: 2px 8px; border-radius: 4px; background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.4); font-family: var(--font-mono); font-weight: 600;">VOLKOVIA</span>';
            } else if (doc.faccion_id === 3) {
                faccionBadge = '<span style="font-size:0.7rem; padding: 2px 8px; border-radius: 4px; background: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid rgba(245,158,11,0.4); font-family: var(--font-mono); font-weight: 600;">KHEMED</span>';
            }

            let pdfBlock = '';
            if (isPdf) {
                pdfBlock = `
                    <div style="margin-top: 12px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; background: rgba(0,0,0,0.3); padding: 12px 16px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.06);">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span class="material-symbols-outlined" style="font-size: 30px; color: #ef4444;">picture_as_pdf</span>
                            <div>
                                <div style="font-size: 0.88rem; font-weight: 700; color: #f8fafc;">Documento PDF Adjunto</div>
                                <div style="font-size: 0.72rem; color: #94a3b8; font-family: var(--font-mono);">Formato Oficial TVC</div>
                            </div>
                        </div>
                        <a href="${doc.pdf_url}" target="_blank" rel="noopener noreferrer" class="btn primary" style="display: inline-flex; align-items: center; gap: 6px; font-size: 0.82rem; padding: 7px 16px; text-decoration: none; font-weight: 700; box-shadow: 0 0 10px rgba(0,240,255,0.25);">
                            <span class="material-symbols-outlined" style="font-size: 18px;">visibility</span>
                            VER / DESCARGAR PDF
                        </a>
                    </div>
                `;
            }

            let textBlock = '';
            if (doc.contenido && doc.contenido.trim() !== '' && doc.contenido !== '<p><br></p>') {
                textBlock = `<div class="ql-editor" style="padding: 10px 0 0 0; min-height: auto; color: #e2e8f0; font-size: 0.9rem; line-height: 1.6;">${doc.contenido}</div>`;
            }
            
            let adminControls = '';
            if (window.userRole === 'admin') {
                const encodedDoc = encodeURIComponent(JSON.stringify(doc));
                adminControls = `
                    <div style="margin-top: 15px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 10px; display: flex; gap: 10px; justify-content: flex-end;">
                        <button class="btn secondary" onclick="editarDoc(decodeURIComponent('${encodedDoc}'))" style="font-size: 0.8rem; padding: 5px 12px; display: inline-flex; align-items: center; gap: 4px;">
                            <span class="material-symbols-outlined" style="font-size: 15px;">edit</span> Editar
                        </button>
                        <button class="btn danger" onclick="borrarDoc(${doc.id})" style="font-size: 0.8rem; padding: 5px 12px; display: inline-flex; align-items: center; gap: 4px;">
                            <span class="material-symbols-outlined" style="font-size: 15px;">delete</span> Borrar
                        </button>
                    </div>
                `;
            }
            
            const card = document.createElement('div');
            card.className = 'mision-card';
            card.style = 'cursor: default; background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 18px; box-shadow: 0 4px 15px rgba(0,0,0,0.3);';
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 8px; flex-wrap: wrap;">
                    <h3 style="color: var(--theme-color); margin: 0; font-family: var(--font-mono); font-size: 1.15rem; display: flex; align-items: center; gap: 8px;">
                        <span class="material-symbols-outlined" style="font-size: 20px;">description</span>
                        <span>${doc.titulo}</span>
                    </h3>
                    <div>${faccionBadge}</div>
                </div>
                ${textBlock}
                ${pdfBlock}
                ${adminControls}
            `;
            container.appendChild(card);
        });
        
    } catch (e) {
        console.error("Error al cargar documentos", e);
    }
}

window.onDocPdfFileSelected = function(input) {
    const statusEl = document.getElementById('doc-pdf-upload-status');
    const tituloInput = document.getElementById('doc-titulo');
    const activeContainer = document.getElementById('doc-pdf-active-container');
    
    if (!input.files || input.files.length === 0) {
        if (statusEl) {
            statusEl.style.color = '#94a3b8';
            statusEl.textContent = 'Ningún archivo nuevo seleccionado.';
        }
        return;
    }
    const file = input.files[0];
    
    if (!file.name.toLowerCase().endsWith('.pdf')) {
        alert('Por favor selecciona un archivo con extensión .pdf');
        input.value = '';
        if (statusEl) {
            statusEl.style.color = '#ef4444';
            statusEl.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle;">error</span> Formato incorrecto. Debe ser .pdf';
        }
        return;
    }
    
    if (file.size > 10 * 1024 * 1024) {
        alert('El archivo excede el tamaño máximo permitido de 10 MB');
        input.value = '';
        if (statusEl) {
            statusEl.style.color = '#ef4444';
            statusEl.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle;">error</span> El archivo supera los 10 MB';
        }
        return;
    }

    // Proponer título limpio si el campo está vacío
    if (tituloInput && !tituloInput.value.trim()) {
        const cleanName = file.name.replace(/\.pdf$/i, '').replace(/[_-]/g, ' ').trim();
        tituloInput.value = cleanName;
    }

    if (activeContainer) activeContainer.style.display = 'none';

    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
    if (statusEl) {
        statusEl.style.color = '#10b981';
        statusEl.innerHTML = `<span class="material-symbols-outlined" style="font-size:15px; vertical-align:middle;">check_circle</span> Archivo preparado: <strong>${file.name}</strong> (${sizeMb} MB). Se adjuntará al pulsar Guardar Documento.`;
    }
};

window.subirPdfDocDirecto = window.onDocPdfFileSelected;

window.quitarPdfDoc = function() {
    const urlInput = document.getElementById('doc-pdf-url');
    if (urlInput) urlInput.value = '';
    const fileInput = document.getElementById('doc-pdf-file');
    if (fileInput) fileInput.value = '';
    const activeContainer = document.getElementById('doc-pdf-active-container');
    if (activeContainer) activeContainer.style.display = 'none';
    const statusEl = document.getElementById('doc-pdf-upload-status');
    if (statusEl) {
        statusEl.style.color = '#f59e0b';
        statusEl.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle;">info</span> PDF desvinculado. Pulsa "Guardar Documento" para consolidar los cambios.';
    }
};

window.toggleExternalDocUrl = function() {
    const el = document.getElementById('doc-pdf-external-wrapper');
    if (el) {
        el.style.display = (el.style.display === 'none' || el.style.display === '') ? 'block' : 'none';
    }
};

async function guardarDoc() {
    const id = document.getElementById('doc-id').value;
    const titulo = document.getElementById('doc-titulo').value.trim();
    const pdf_url = document.getElementById('doc-pdf-url').value.trim();
    const faccion_id = document.getElementById('doc-faccion').value;
    const orden = document.getElementById('doc-orden').value;
    const contenido = quillDocEditor ? quillDocEditor.root.innerHTML : '';
    const fileInput = document.getElementById('doc-pdf-file');
    
    if (!titulo) {
        alert('El título es obligatorio.');
        return;
    }
    
    const saveBtn = document.querySelector('button[onclick="guardarDoc()"]');
    const originalText = saveBtn ? saveBtn.innerHTML : '';
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px; animation: spin 1s linear infinite; vertical-align:middle;">sync</span> Guardando...';
    }

    try {
        const formData = new FormData();
        if (id) formData.append('id', id);
        formData.append('titulo', titulo);
        formData.append('contenido', contenido);
        formData.append('faccion_id', faccion_id || '');
        formData.append('orden', orden || '0');
        formData.append('pdf_url', pdf_url);

        if (fileInput && fileInput.files && fileInput.files.length > 0) {
            formData.append('file', fileInput.files[0]);
        }

        const res = await fetch('/api/docs', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        
        if (res.ok && data.status === 'success') {
            alert('Documento guardado con éxito');
            limpiarDocEditor();
            cargarDocs();
        } else {
            alert('Error al guardar documento: ' + (data.error || 'Error desconocido'));
        }
    } catch(e) {
        console.error('Error al guardar documento:', e);
        alert('Error de conexión al guardar el documento.');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalText || 'Guardar Documento';
        }
    }
}

function editarDoc(docJsonStr) {
    const doc = JSON.parse(docJsonStr);
    document.getElementById('doc-id').value = doc.id;
    document.getElementById('doc-titulo').value = doc.titulo;
    document.getElementById('doc-pdf-url').value = doc.pdf_url || '';
    document.getElementById('doc-faccion').value = doc.faccion_id || '';
    document.getElementById('doc-orden').value = doc.orden || 0;
    
    const fileInput = document.getElementById('doc-pdf-file');
    if (fileInput) fileInput.value = '';

    const statusEl = document.getElementById('doc-pdf-upload-status');
    const activeContainer = document.getElementById('doc-pdf-active-container');
    const activeLabel = document.getElementById('doc-pdf-active-label');
    
    if (doc.pdf_url) {
        if (activeContainer) activeContainer.style.display = 'inline-flex';
        if (activeLabel) {
            const rawFileName = doc.pdf_url.split('/').pop().split('?')[0];
            activeLabel.innerHTML = `PDF actual: <a href="${doc.pdf_url}" target="_blank" rel="noopener noreferrer" style="color:#00f0ff; text-decoration:underline; font-weight:600;">${rawFileName}</a>`;
        }
        if (statusEl) {
            statusEl.style.color = '#94a3b8';
            statusEl.textContent = 'Para reemplazar este PDF, selecciona un archivo nuevo en el explorador de arriba.';
        }
    } else {
        if (activeContainer) activeContainer.style.display = 'none';
        if (statusEl) {
            statusEl.style.color = '#94a3b8';
            statusEl.textContent = 'Haz clic en "Examinar..." o arrastra aquí tu archivo PDF.';
        }
    }

    const extWrapper = document.getElementById('doc-pdf-external-wrapper');
    if (extWrapper) extWrapper.style.display = 'none';
    const extInput = document.getElementById('doc-pdf-url-external');
    if (extInput) extInput.value = doc.pdf_url && !doc.pdf_url.startsWith('/static/uploads/') ? doc.pdf_url : '';

    if (quillDocEditor) {
        quillDocEditor.root.innerHTML = doc.contenido || '';
    }
    
    // Scroll up to editor
    const view = document.getElementById('view-docs');
    if (view) view.scrollTop = 0;
}

function limpiarDocEditor() {
    document.getElementById('doc-id').value = '';
    document.getElementById('doc-titulo').value = '';
    document.getElementById('doc-pdf-url').value = '';
    document.getElementById('doc-faccion').value = '';
    document.getElementById('doc-orden').value = '';
    const fileInput = document.getElementById('doc-pdf-file');
    if (fileInput) fileInput.value = '';
    const statusEl = document.getElementById('doc-pdf-upload-status');
    if (statusEl) {
        statusEl.style.color = '#94a3b8';
        statusEl.textContent = 'Haz clic en "Examinar..." o arrastra aquí tu archivo PDF.';
    }
    const activeContainer = document.getElementById('doc-pdf-active-container');
    if (activeContainer) activeContainer.style.display = 'none';
    const extWrapper = document.getElementById('doc-pdf-external-wrapper');
    if (extWrapper) extWrapper.style.display = 'none';
    const extInput = document.getElementById('doc-pdf-url-external');
    if (extInput) extInput.value = '';
    if (quillDocEditor) {
        quillDocEditor.root.innerHTML = '';
    }
}

async function borrarDoc(id) {
    if (confirm('¿Estás seguro de que quieres borrar este documento?')) {
        try {
            const res = await fetch('/api/docs/' + id, { method: 'DELETE' });
            if (res.ok) {
                cargarDocs();
            } else {
                alert('Error al borrar documento');
            }
        } catch(e) {
            alert('Error de conexión');
        }
    }
}

window.cargarDocs = cargarDocs;
window.guardarDoc = guardarDoc;
window.editarDoc = editarDoc;
window.limpiarDocEditor = limpiarDocEditor;
window.borrarDoc = borrarDoc;

// ==================== ICE VIEWER (Punto B) & READY CHECK TL (Punto C) ====================

window.verIceMiembro = async function(id) {
    try {
        const res = await fetch(`/api/miembros/${id}/ice`);
        if (!res.ok) {
            alert('No se pudo cargar la información médica ICE');
            return;
        }
        const ice = await res.json();
        const modal = document.getElementById('modal-ice-viewer');
        if (!modal) return;
        
        document.getElementById('ice-view-nick').innerText = `${ice.nombre_jugador || 'Operador'} (${ice.nombre_apellidos || 'Sin nombre'})`;
        document.getElementById('ice-view-grupo').innerText = ice.grupo_sanguineo || 'No especificado';
        document.getElementById('ice-view-alergias').innerText = ice.alergias || 'Ninguna declarada';
        document.getElementById('ice-view-condiciones').innerText = ice.condiciones_medicas || 'Ninguna';
        document.getElementById('ice-view-medicacion').innerText = ice.medicacion_actual || 'Ninguna';
        document.getElementById('ice-view-contacto').innerText = `${ice.contacto_nombre || '--'} (${ice.contacto_parentesco || 'ICE'})`;
        
        const telEl = document.getElementById('ice-view-tel');
        if (ice.contacto_telefono) {
            telEl.innerHTML = `<a href="tel:${ice.contacto_telefono}" style="color:#00d2ff; text-decoration:underline; font-weight:bold; font-size:1.1rem;">${ice.contacto_telefono}</a>`;
        } else {
            telEl.innerText = 'No especificado';
        }
        document.getElementById('ice-view-obs').innerText = ice.observaciones || 'Sin notas';
        modal.style.display = 'flex';
    } catch (e) {
        alert('Error al consultar datos ICE');
    }
};

window.desvincularRemotoDesdeMiembro = async function(uid, nombre, id) {
    const ident = nombre || uid || `Operador #${id}`;
    if (!confirm(`¿Confirmas la desvinculación remota del terminal médico de "${ident}"?\n\nEl dispositivo quedará liberado automáticamente para que el jugador pueda vincular su nuevo teléfono en el campo sin pedirle el PIN de Dirección.`)) {
        return;
    }
    try {
        const res = await fetch('/api/admin/medicos/unbind', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sanitario_id: uid || nombre, uid: uid, nombre_medico: nombre })
        });
        const data = await res.json();
        if (res.ok && data.status === 'success') {
            alert(`✅ ${data.message || 'Orden de desvinculación emitida con éxito.'}`);
        } else {
            alert(data.message || 'Error al emitir orden de desvinculación.');
        }
    } catch (e) {
        alert('Error de conexión al solicitar desvinculación.');
    }
};

// ==================== CRONO & ARMAS VIEWER / MANAGEMENT ====================

window.currentCronoMiembroId = null;
window.currentCronoMiembroNick = '';

window.verCronoMiembro = async function(id, nick) {
    window.currentCronoMiembroId = id;
    window.currentCronoMiembroNick = nick;
    const modal = document.getElementById('modal-crono-miembro');
    if (!modal) return;
    document.getElementById('crono-miembro-nick').innerText = nick || 'Operador';
    modal.style.display = 'flex';
    await reloadMiembroCronoBody();
};

async function reloadMiembroCronoBody() {
    const id = window.currentCronoMiembroId;
    const body = document.getElementById('crono-miembro-body');
    if (!id || !body) return;
    
    body.innerHTML = '<div style="padding: 15px; text-align: center; color: #888;">Cargando réplicas y mediciones...</div>';
    try {
        const res = await fetch(`/api/miembros/${id}/armas`);
        if (!res.ok) {
            body.innerHTML = '<div style="padding: 15px; color: #ff5566;">Error al cargar las réplicas del operador.</div>';
            return;
        }
        const armas = await res.json();
        const isAdmin = (window.userRole === 'admin');

        if (!armas || armas.length === 0) {
            body.innerHTML = '<div style="padding: 18px; text-align: center; color: #64748b; border: 1px dashed rgba(255,255,255,0.1); border-radius: 4px;">Este operador no tiene ninguna réplica registrada.</div>';
            return;
        }

        let html = `
            <div style="overflow-x: auto; max-height: 280px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.82rem;">
                    <thead>
                        <tr style="border-bottom: 1px solid rgba(0,240,255,0.3); color: #00f0ff;">
                            <th style="padding: 6px 8px;">RÉPLICA</th>
                            <th style="padding: 6px 8px;">TIPO</th>
                            <th style="padding: 6px 8px; width: 75px;">FPS</th>
                            <th style="padding: 6px 8px; width: 65px;">JULIOS</th>
                            <th style="padding: 6px 8px; width: 70px;">BOLA</th>
                            <th style="padding: 6px 8px; width: 80px;">PRECINTO</th>
                            <th style="padding: 6px 8px;">ESTADO</th>
                            ${isAdmin ? '<th style="padding: 6px 8px; text-align: center; width: 75px;">ACCIÓN</th>' : ''}
                        </tr>
                    </thead>
                    <tbody>
        `;

        armas.forEach(a => {
            const estadoColor = a.estado_crono === 'APROBADO' ? '#2ecc71' : (a.estado_crono === 'EXCEDIDO' || a.estado_crono === 'RECHAZADO' ? '#ff5566' : '#f1c40f');
            if (isAdmin) {
                html += `
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.08);">
                        <td style="padding: 6px 8px;">
                            <input type="text" id="m-arma-mod-${a.id}" value="${a.modelo || ''}" style="width: 100%; font-size: 0.8rem; background: #000; border: 1px solid #444; color: #fff; padding: 2px 4px;">
                        </td>
                        <td style="padding: 6px 8px;">
                            <select id="m-arma-tipo-${a.id}" style="width: 100%; font-size: 0.78rem; background: #000; border: 1px solid #444; color: #fff; padding: 2px;">
                                <option value="Fusil / Asalto" ${a.tipo === 'Fusil / Asalto' ? 'selected' : ''}>Fusil</option>
                                <option value="Tirador Selecto (DMR)" ${a.tipo === 'Tirador Selecto (DMR)' ? 'selected' : ''}>DMR</option>
                                <option value="Francotirador (Cerrojo)" ${a.tipo === 'Francotirador (Cerrojo)' ? 'selected' : ''}>Sniper</option>
                                <option value="Apoyo (LMG)" ${a.tipo === 'Apoyo (LMG)' ? 'selected' : ''}>Apoyo</option>
                                <option value="Secundaria / Pistola" ${a.tipo === 'Secundaria / Pistola' ? 'selected' : ''}>Pistola</option>
                                <option value="Escopeta" ${a.tipo === 'Escopeta' ? 'selected' : ''}>Escopeta</option>
                            </select>
                        </td>
                        <td style="padding: 6px 8px;">
                            <input type="number" step="0.1" id="m-arma-fps-${a.id}" value="${a.fps !== null ? a.fps : ''}" placeholder="FPS" style="width: 65px; font-size: 0.8rem; background: #000; border: 1px solid #444; color: #fff; padding: 2px 4px;">
                        </td>
                        <td style="padding: 6px 8px;">
                            <input type="number" step="0.01" id="m-arma-julios-${a.id}" value="${a.julios !== null ? a.julios : ''}" placeholder="J" style="width: 55px; font-size: 0.8rem; background: #000; border: 1px solid #444; color: #fff; padding: 2px 4px;">
                        </td>
                        <td style="padding: 6px 8px;">
                            <input type="text" id="m-arma-peso-${a.id}" value="${a.peso_bb || '0.20g'}" style="width: 60px; font-size: 0.8rem; background: #000; border: 1px solid #444; color: #fff; padding: 2px 4px;">
                        </td>
                        <td style="padding: 6px 8px;">
                            <input type="text" id="m-arma-precinto-${a.id}" value="${a.precinto_num || ''}" placeholder="#Precinto" style="width: 70px; font-size: 0.8rem; background: #000; border: 1px solid #444; color: #fff; padding: 2px 4px;">
                        </td>
                        <td style="padding: 6px 8px;">
                            <select id="m-arma-estado-${a.id}" style="font-size: 0.78rem; background: #000; border: 1px solid #444; color: ${estadoColor}; font-weight: bold; padding: 2px;">
                                <option value="APROBADO" ${a.estado_crono === 'APROBADO' ? 'selected' : ''} style="color:#2ecc71;">✓ APROBADO</option>
                                <option value="PENDIENTE" ${a.estado_crono === 'PENDIENTE' ? 'selected' : ''} style="color:#f1c40f;">⏳ PENDIENTE</option>
                                <option value="EXCEDIDO" ${a.estado_crono === 'EXCEDIDO' ? 'selected' : ''} style="color:#ff5566;">✕ EXCEDIDO</option>
                                <option value="RECHAZADO" ${a.estado_crono === 'RECHAZADO' ? 'selected' : ''} style="color:#ff5566;">✕ RECHAZADO</option>
                            </select>
                        </td>
                        <td style="padding: 6px 8px; text-align: center; white-space: nowrap;">
                            <button type="button" class="btn primary" title="Guardar validación crono" onclick="submitAdminSaveArma(${a.id})" style="padding: 3px 6px; font-size: 0.75rem;">💾</button>
                            <button type="button" class="btn danger" title="Eliminar" onclick="deleteAdminArma(${a.id})" style="padding: 3px 6px; font-size: 0.75rem; margin-left: 3px;">🗑</button>
                        </td>
                    </tr>
                `;
            } else {
                html += `
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.08);">
                        <td style="padding: 8px; font-weight: bold; color: #fff;">${a.modelo}</td>
                        <td style="padding: 8px; color: #cbd5e1;">${a.tipo}</td>
                        <td style="padding: 8px; font-family: monospace;">${a.fps !== null ? a.fps + ' fps' : '---'}</td>
                        <td style="padding: 8px; font-family: monospace;">${a.julios !== null ? a.julios + ' J' : '---'}</td>
                        <td style="padding: 8px;">${a.peso_bb || '0.20g'}</td>
                        <td style="padding: 8px; color: #00f0ff;">${a.precinto_num ? '#' + a.precinto_num : '---'}</td>
                        <td style="padding: 8px;">
                            <span style="color: ${estadoColor}; font-weight: bold; font-size: 0.75rem; border: 1px solid ${estadoColor}; padding: 2px 6px; border-radius: 3px;">
                                ${a.estado_crono || 'PENDIENTE'}
                            </span>
                        </td>
                    </tr>
                `;
            }
        });

        html += '</tbody></table></div>';
        if (!isAdmin) {
            html += '<div style="margin-top: 10px; font-size: 0.75rem; color: #888; font-style: italic;">* Los valores de FPS, Julios y Precinto solo pueden ser ingresados por la Organización / Jueces en el puesto de crono.</div>';
        }
        body.innerHTML = html;
    } catch (e) {
        body.innerHTML = '<div style="padding: 15px; color: #ff5566;">Error al procesar réplicas.</div>';
    }
}

window.submitAdminSaveArma = async function(armaId) {
    const modelo = document.getElementById(`m-arma-mod-${armaId}`)?.value;
    const tipo = document.getElementById(`m-arma-tipo-${armaId}`)?.value;
    const fps = document.getElementById(`m-arma-fps-${armaId}`)?.value;
    const julios = document.getElementById(`m-arma-julios-${armaId}`)?.value;
    const peso_bb = document.getElementById(`m-arma-peso-${armaId}`)?.value;
    const precinto_num = document.getElementById(`m-arma-precinto-${armaId}`)?.value;
    const estado_crono = document.getElementById(`m-arma-estado-${armaId}`)?.value;

    try {
        const res = await fetch(`/api/crono/arma/${armaId}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                modelo, tipo, fps: fps ? parseFloat(fps) : null,
                julios: julios ? parseFloat(julios) : null,
                peso_bb, precinto_num, estado_crono
            })
        });
        const data = await res.json();
        if (data.status === 'success') {
            alert('Crono guardado correctamente.');
            await reloadMiembroCronoBody();
        } else {
            alert(data.error || 'Error al guardar crono');
        }
    } catch (err) {
        alert('Error de conexión');
    }
};

window.submitAdminNewArma = async function() {
    const miembroId = window.currentCronoMiembroId;
    if (!miembroId) return;

    const modelo = document.getElementById('admin-new-arma-modelo')?.value.trim();
    const tipo = document.getElementById('admin-new-arma-tipo')?.value;
    const fps = document.getElementById('admin-new-arma-fps')?.value;
    const julios = document.getElementById('admin-new-arma-julios')?.value;
    const precinto = document.getElementById('admin-new-arma-precinto')?.value.trim();

    if (!modelo) {
        alert('Introduce el modelo de la réplica');
        return;
    }

    try {
        const res = await fetch('/api/crono/arma/nueva', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                miembro_id: miembroId,
                modelo, tipo,
                fps: fps ? parseFloat(fps) : null,
                julios: julios ? parseFloat(julios) : null,
                peso_bb: '0.20g',
                estado_crono: 'APROBADO',
                precinto_num: precinto
            })
        });
        const data = await res.json();
        if (data.status === 'success') {
            document.getElementById('admin-new-arma-modelo').value = '';
            document.getElementById('admin-new-arma-fps').value = '';
            document.getElementById('admin-new-arma-julios').value = '';
            document.getElementById('admin-new-arma-precinto').value = '';
            await reloadMiembroCronoBody();
        } else {
            alert(data.error || 'Error al registrar réplica');
        }
    } catch (e) {
        alert('Error de conexión');
    }
};

window.deleteAdminArma = async function(armaId) {
    if (!confirm('¿Deseas eliminar esta réplica del inventario?')) return;
    try {
        const res = await fetch(`/api/crono/arma/${armaId}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (data.status === 'success') {
            await reloadMiembroCronoBody();
        } else {
            alert(data.error || 'Error al eliminar');
        }
    } catch (e) {
        alert('Error de conexión');
    }
};

// ==================== PUESTO DE CRONAJE GLOBAL ====================

window.allCronoArmas = [];

window.openCronoStationModal = function() {
    const modal = document.getElementById('modal-crono-station');
    if (!modal) return;
    modal.style.display = 'flex';
    loadCronoStation();
};

window.loadCronoStation = async function() {
    const tbody = document.getElementById('crono-station-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" style="padding:20px; text-align:center; color:#888;">Cargando armas de todos los operadores...</td></tr>';
    try {
        const res = await fetch('/api/crono/armas');
        if (!res.ok) {
            tbody.innerHTML = '<tr><td colspan="8" style="padding:20px; text-align:center; color:#ff5566;">Error al cargar datos de cronaje.</td></tr>';
            return;
        }
        window.allCronoArmas = await res.json();
        filterCronoStation();
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="8" style="padding:20px; text-align:center; color:#ff5566;">Error de conexión.</td></tr>';
    }
};

window.filterCronoStation = function() {
    const q = (document.getElementById('crono-filter-search')?.value || '').toLowerCase().trim();
    const estado = (document.getElementById('crono-filter-estado')?.value || '').toUpperCase();
    
    let filtered = window.allCronoArmas || [];
    if (q) {
        filtered = filtered.filter(a => {
            const nick = (a.nombre_jugador || '').toLowerCase();
            const full = (a.nombre_apellidos || '').toLowerCase();
            const mod = (a.modelo || '').toLowerCase();
            const team = (a.equipo_nombre || '').toLowerCase();
            const prec = (a.precinto_num || '').toLowerCase();
            return nick.includes(q) || full.includes(q) || mod.includes(q) || team.includes(q) || prec.includes(q);
        });
    }
    if (estado) {
        filtered = filtered.filter(a => (a.estado_crono || 'PENDIENTE').toUpperCase() === estado);
    }
    renderCronoStationRows(filtered);
};

function renderCronoStationRows(list) {
    const tbody = document.getElementById('crono-station-tbody');
    if (!tbody) return;
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="padding:20px; text-align:center; color:#64748b;">No se encontraron réplicas con los filtros actuales.</td></tr>';
        return;
    }

    let rowsHtml = '';
    list.forEach(a => {
        const estadoColor = a.estado_crono === 'APROBADO' ? '#2ecc71' : (a.estado_crono === 'EXCEDIDO' || a.estado_crono === 'RECHAZADO' ? '#ff5566' : '#f1c40f');
        const facColor = a.faccion_color === 'Amarillo' ? '#f1c40f' : (a.faccion_color === 'Rojo' ? '#ff5566' : '#00d2ff');

        rowsHtml += `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
                <td style="padding: 6px 8px;">
                    <div style="font-weight: bold; color: #fff;">${a.nombre_jugador}</div>
                    <div style="font-size: 0.72rem; color: ${facColor};">${a.equipo_nombre} [${a.faccion_nombre}]</div>
                </td>
                <td style="padding: 6px 8px;">
                    <div style="color: #cbd5e1; font-weight: 600;">${a.modelo}</div>
                    <div style="font-size: 0.72rem; color: #888;">${a.tipo}</div>
                </td>
                <td style="padding: 6px 8px;">
                    <input type="number" step="0.1" id="st-fps-${a.id}" value="${a.fps !== null ? a.fps : ''}" placeholder="FPS" style="width: 70px; background: #050810; border: 1px solid #444; color: #fff; padding: 3px 5px; font-size: 0.8rem;">
                </td>
                <td style="padding: 6px 8px;">
                    <input type="number" step="0.01" id="st-julios-${a.id}" value="${a.julios !== null ? a.julios : ''}" placeholder="J" style="width: 60px; background: #050810; border: 1px solid #444; color: #fff; padding: 3px 5px; font-size: 0.8rem;">
                </td>
                <td style="padding: 6px 8px;">
                    <input type="text" id="st-peso-${a.id}" value="${a.peso_bb || '0.20g'}" style="width: 65px; background: #050810; border: 1px solid #444; color: #fff; padding: 3px 5px; font-size: 0.8rem;">
                </td>
                <td style="padding: 6px 8px;">
                    <input type="text" id="st-precinto-${a.id}" value="${a.precinto_num || ''}" placeholder="#Precinto" style="width: 75px; background: #050810; border: 1px solid #444; color: #fff; padding: 3px 5px; font-size: 0.8rem;">
                </td>
                <td style="padding: 6px 8px;">
                    <select id="st-estado-${a.id}" style="padding: 3px 5px; background: #050810; border: 1px solid #444; color: ${estadoColor}; font-weight: bold; font-size: 0.78rem;">
                        <option value="APROBADO" ${a.estado_crono === 'APROBADO' ? 'selected' : ''} style="color:#2ecc71;">✓ APROBADO</option>
                        <option value="PENDIENTE" ${a.estado_crono === 'PENDIENTE' ? 'selected' : ''} style="color:#f1c40f;">⏳ PENDIENTE</option>
                        <option value="EXCEDIDO" ${a.estado_crono === 'EXCEDIDO' ? 'selected' : ''} style="color:#ff5566;">✕ EXCEDIDO</option>
                        <option value="RECHAZADO" ${a.estado_crono === 'RECHAZADO' ? 'selected' : ''} style="color:#ff5566;">✕ RECHAZADO</option>
                    </select>
                </td>
                <td style="padding: 6px 8px; text-align: center;">
                    <button type="button" class="btn primary" onclick="saveCronoStationRow(${a.id})" style="padding: 4px 8px; font-size: 0.75rem;">
                        GUARDAR
                    </button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = rowsHtml;
}

window.saveCronoStationRow = async function(armaId) {
    const fps = document.getElementById(`st-fps-${armaId}`)?.value;
    const julios = document.getElementById(`st-julios-${armaId}`)?.value;
    const peso_bb = document.getElementById(`st-peso-${armaId}`)?.value;
    const precinto_num = document.getElementById(`st-precinto-${armaId}`)?.value;
    const estado_crono = document.getElementById(`st-estado-${armaId}`)?.value;

    try {
        const res = await fetch(`/api/crono/arma/${armaId}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                fps: fps ? parseFloat(fps) : null,
                julios: julios ? parseFloat(julios) : null,
                peso_bb, precinto_num, estado_crono
            })
        });
        const data = await res.json();
        if (data.status === 'success') {
            const found = window.allCronoArmas.find(x => x.id === armaId);
            if (found) {
                found.fps = data.arma.fps;
                found.julios = data.arma.julios;
                found.peso_bb = data.arma.peso_bb;
                found.precinto_num = data.arma.precinto_num;
                found.estado_crono = data.arma.estado_crono;
            }
            const sel = document.getElementById(`st-estado-${armaId}`);
            if (sel) {
                sel.style.color = (estado_crono === 'APROBADO' ? '#2ecc71' : (estado_crono === 'EXCEDIDO' || estado_crono === 'RECHAZADO' ? '#ff5566' : '#f1c40f'));
            }
            alert(`Réplica actualizada (${estado_crono})`);
        } else {
            alert(data.error || 'Error al guardar');
        }
    } catch (e) {
        alert('Error de conexión');
    }
};

let readyCheckPollTimer = null;

window.openReadyCheckModal = function() {
    const modal = document.getElementById('modal-ready-check');
    if (!modal) return;
    modal.style.display = 'flex';
    pollReadyCheckStatusTL();
    if (readyCheckPollTimer) clearInterval(readyCheckPollTimer);
    readyCheckPollTimer = setInterval(pollReadyCheckStatusTL, 3000);
};

window.closeReadyCheckModal = function() {
    const modal = document.getElementById('modal-ready-check');
    if (modal) modal.style.display = 'none';
    if (readyCheckPollTimer) {
        clearInterval(readyCheckPollTimer);
        readyCheckPollTimer = null;
    }
};

window.pollReadyCheckStatusTL = async function() {
    try {
        const eqId = document.getElementById('eq-id')?.value || window.equipoId;
        const url = eqId ? `/api/ready_check/status?equipo_id=${eqId}` : '/api/ready_check/status';
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        
        const activeBlock = document.getElementById('rc-tl-active-block');
        const inactiveBlock = document.getElementById('rc-tl-inactive-block');
        if (!activeBlock || !inactiveBlock) return;
        
        if (data.active) {
            activeBlock.style.display = 'block';
            inactiveBlock.style.display = 'none';
            document.getElementById('rc-tl-title').innerText = data.titulo || 'PASE DE LISTA ACTIVO';
            
            const tbody = document.getElementById('rc-tl-members-tbody');
            tbody.innerHTML = '';
            
            let listosCount = 0;
            const miembros = data.miembros || [];
            
            miembros.forEach(m => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid rgba(255,255,255,0.06)';
                
                let pillColor = '#f1c40f';
                let pillBg = 'rgba(241,196,15,0.15)';
                let pillBorder = '#f1c40f';
                
                if (m.estado === 'LISTO') {
                    listosCount++;
                    pillColor = '#2ecc71';
                    pillBg = 'rgba(46,204,113,0.15)';
                    pillBorder = '#2ecc71';
                } else if (m.estado === 'INCIDENCIA') {
                    pillColor = '#ff5566';
                    pillBg = 'rgba(255,51,68,0.15)';
                    pillBorder = '#ff5566';
                }
                
                tr.innerHTML = `
                    <td style="padding: 6px 10px; font-weight: bold; color: #fff;">${m.nombre_jugador}</td>
                    <td style="padding: 6px 10px; color: #888;">${m.rol || 'Operador'}</td>
                    <td style="padding: 6px 10px; text-align: center;">
                        <span style="display: inline-block; padding: 2px 8px; border-radius: 3px; font-family: 'Orbitron', monospace; font-size: 0.72rem; font-weight: bold; color: ${pillColor}; background: ${pillBg}; border: 1px solid ${pillBorder};">
                            ${m.estado}
                        </span>
                    </td>
                    <td style="padding: 6px 10px; font-size: 0.8rem; color: ${m.nota ? '#ff8899' : '#555'}; font-style: ${m.nota ? 'italic' : 'normal'};">
                        ${m.nota || '--'}
                    </td>
                `;
                tbody.appendChild(tr);
            });
            
            document.getElementById('rc-tl-stats').innerText = `${listosCount} / ${miembros.length} LISTOS`;
        } else {
            activeBlock.style.display = 'none';
            inactiveBlock.style.display = 'block';
        }
    } catch(e) {}
};

window.startReadyCheckTL = async function() {
    const eqId = document.getElementById('eq-id')?.value || window.equipoId;
    const inputTitle = document.getElementById('rc-new-title');
    const titulo = inputTitle ? inputTitle.value.trim() : 'Pase de Lista Táctico';
    
    try {
        const res = await fetch('/api/ready_check/start', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ equipo_id: eqId, titulo })
        });
        const data = await res.json();
        if (data.status === 'success') {
            pollReadyCheckStatusTL();
        } else {
            alert(data.error || 'Error al iniciar pase de lista');
        }
    } catch(e) {
        alert('Error de red al iniciar pase de lista');
    }
};

window.stopReadyCheckTL = async function() {
    const eqId = document.getElementById('eq-id')?.value || window.equipoId;
    try {
        const res = await fetch('/api/ready_check/stop', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ equipo_id: eqId })
        });
        const data = await res.json();
        if (data.status === 'success') {
            pollReadyCheckStatusTL();
        } else {
            alert(data.error || 'Error al cerrar pase de lista');
        }
    } catch(e) {
        alert('Error de red al cerrar pase de lista');
    }
};

// ==========================================
// CONTROL DE RÉPLICAS Y CAPACIDADES TÁCTICAS
// ==========================================
window.armasDashboardData = [];
window.activeArmasMiembroId = null;

async function cargarArmasDashboard() {
    const tbody = document.getElementById('armas-dashboard-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:18px; color:#888;">Cargando combatientes y réplicas...</td></tr>';
    
    try {
        const res = await fetch('/api/admin/armas_dashboard');
        if (!res.ok) throw new Error('Error al cargar datos');
        const data = await res.json();
        window.armasDashboardData = data || [];

        // Auto-popular selector de equipos únicos
        const selEq = document.getElementById('filtro-armas-equipo');
        if (selEq) {
            const currentVal = selEq.value;
            const equiposSet = new Set();
            window.armasDashboardData.forEach(m => {
                if (m.equipo_nombre) equiposSet.add(m.equipo_nombre);
            });
            const sortedEquipos = Array.from(equiposSet).sort();
            selEq.innerHTML = '<option value="">Todas las unidades</option>' + sortedEquipos.map(eq => `<option value="${eq.toLowerCase()}">${eq}</option>`).join('');
            if (currentVal) selEq.value = currentVal;
        }

        filtrarArmasDashboard();
    } catch (e) {
        console.error("Error al cargar armas dashboard:", e);
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:18px; color:#ff5566;">Error al cargar el inventario de réplicas.</td></tr>';
    }
}

function filtrarArmasDashboard() {
    const texto = (document.getElementById('filtro-armas-texto')?.value || '').toLowerCase().trim();
    const faccion = (document.getElementById('filtro-armas-faccion')?.value || '').toLowerCase().trim();
    const equipo = (document.getElementById('filtro-armas-equipo')?.value || '').toLowerCase().trim();
    
    let lista = window.armasDashboardData || [];
    
    if (faccion) {
        lista = lista.filter(m => (m.faccion_nombre || '').toLowerCase().includes(faccion));
    }

    if (equipo) {
        lista = lista.filter(m => (m.equipo_nombre || '').toLowerCase() === equipo || (m.equipo_nombre || '').toLowerCase().includes(equipo));
    }
    
    if (texto) {
        lista = lista.filter(m => {
            const nom = (m.nombre_jugador || '').toLowerCase();
            const ape = (m.nombre_apellidos || '').toLowerCase();
            const uid = (m.uid || '').toLowerCase();
            const eq = (m.equipo_nombre || '').toLowerCase();
            const tieneArma = (m.armas || []).some(a => (a.modelo || '').toLowerCase().includes(texto) || (a.tipo || '').toLowerCase().includes(texto));
            const dron = (m.dron_modelo || '').toLowerCase();
            return nom.includes(texto) || ape.includes(texto) || uid.includes(texto) || eq.includes(texto) || tieneArma || dron.includes(texto);
        });
    }
    
    renderArmasDashboard(lista);
}

function renderArmasDashboard(lista) {
    const tbody = document.getElementById('armas-dashboard-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (!lista || lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:24px; color:#888;">No se encontraron combatientes con los filtros aplicados.</td></tr>';
        return;
    }
    
    lista.forEach(m => {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.title = 'Haz clic para gestionar réplicas y capacidades de este combatiente';
        tr.onclick = (e) => {
            if (e.target.tagName !== 'BUTTON' && !e.target.closest('button')) {
                abrirModalArmas(m.id);
            }
        };
        
        const fac = (m.faccion_nombre || '').toLowerCase();
        const facBadgeClass = fac.includes('syl') ? 'med-badge-syldavia' : (fac.includes('vol') ? 'med-badge-volkovia' : 'med-badge-neutral');
        const borderAccent = fac.includes('syl') ? '#f1c40f' : (fac.includes('vol') ? '#5dade2' : '#2ecc71');
        
        // Capacidades especiales
        let capHtml = [];
        if (m.tiene_dron) {
            capHtml.push(`<span style="background: rgba(0,240,255,0.15); color: #00f0ff; border: 1px solid rgba(0,240,255,0.4); padding: 2px 7px; border-radius: 3px; font-size: 0.72rem; font-weight: bold; display: inline-flex; align-items: center; gap: 4px;">🛸 Dron${m.dron_modelo ? ': ' + m.dron_modelo : ''}</span>`);
        }
        if (m.tiene_nvg) {
            capHtml.push(`<span style="background: rgba(46,204,113,0.15); color: #2ecc71; border: 1px solid rgba(46,204,113,0.4); padding: 2px 7px; border-radius: 3px; font-size: 0.72rem; font-weight: bold; display: inline-flex; align-items: center; gap: 4px;">👁️ NVG (${m.nvg_categoria || 'Gen 3'})</span>`);
        }
        const capacidadesFinal = capHtml.length > 0 
            ? `<div style="display:flex; flex-direction:column; gap:4px; align-items:flex-start;">${capHtml.join('')}</div>`
            : `<span style="color: #64748b; font-size: 0.76rem; font-style: italic;">Sin Dron ni NVG</span>`;
            
        // Réplicas
        let armasHtml = '';
        if (m.armas && m.armas.length > 0) {
            armasHtml = '<div style="display: flex; flex-wrap: wrap; gap: 6px;">' + m.armas.map(a => {
                const balistica = (a.fps ? `${a.fps} FPS` : '') + (a.julios ? ` · ${a.julios}J` : '');
                return `
                    <span style="background: rgba(226,185,56,0.1); border: 1px solid rgba(226,185,56,0.35); color: #fff; padding: 3px 8px; border-radius: 4px; font-size: 0.76rem; display: inline-flex; align-items: center; gap: 6px;">
                        <span style="color: #e2b938; font-weight: bold;">[${a.tipo || 'Fusil'}]</span>
                        <span>${a.modelo}</span>
                        ${balistica ? `<span style="color: #00f0ff; font-family: monospace; font-weight: bold; background: rgba(0,240,255,0.08); padding: 1px 4px; border-radius: 2px;">${balistica}</span>` : ''}
                    </span>
                `;
            }).join('') + '</div>';
        } else {
            armasHtml = `<span style="color: #64748b; font-size: 0.76rem; font-style: italic;">Sin réplicas registradas</span>`;
        }
        
        tr.innerHTML = `
            <td style="border-left: 3px solid ${borderAccent} !important;">
                <div style="color: #fff; font-size: 0.95rem; font-weight: 700; display: flex; align-items: center; gap: 6px;">
                    <span class="material-symbols-outlined" style="font-size: 1.15rem; color: #e2b938;">person</span>
                    <span>${m.nombre_jugador || 'Operador'}</span>
                </div>
                <div style="margin-top: 4px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center;">
                    <span class="med-uid-tag">${m.rol || 'Combatiente'}</span>
                    ${m.uid ? `<span class="med-uid-tag" style="color: #00f0ff; border-color: rgba(0,240,255,0.3);">QR: ${m.uid}</span>` : ''}
                </div>
            </td>
            <td>
                <div style="font-weight: 700; color: #fff; font-size: 0.92rem;">${m.equipo_nombre}</div>
                <div style="margin-top: 4px;"><span class="med-badge-faction ${facBadgeClass}">${m.faccion_nombre}</span></div>
            </td>
            <td>${capacidadesFinal}</td>
            <td>${armasHtml}</td>
            <td style="text-align: center;">
                <button type="button" class="btn btn-sm" onclick="event.stopPropagation(); abrirModalArmas(${m.id})" style="border-color: #e2b938; color: #e2b938; background: rgba(226,185,56,0.08); padding: 4px 8px; font-size: 0.74rem; font-weight: 600; border-radius: 3px; display: inline-flex; align-items: center; gap: 4px;">
                    <span class="material-symbols-outlined" style="font-size: 14px;">tune</span> GESTIONAR
                </button>
            </td>
        `;
        
        tbody.appendChild(tr);
    });
}

async function abrirModalArmas(miembroId) {
    let miembro = (window.armasDashboardData || []).find(x => x.id === miembroId);
    if (!miembro) {
        await cargarArmasDashboard();
        miembro = (window.armasDashboardData || []).find(x => x.id === miembroId);
    }
    if (!miembro) return;
    
    window.activeArmasMiembroId = miembroId;
    
    const nombreEl = document.getElementById('modal-armas-jugador-nombre');
    const subEl = document.getElementById('modal-armas-jugador-sub');
    if (nombreEl) nombreEl.textContent = miembro.nombre_jugador + (miembro.nombre_apellidos ? ` (${miembro.nombre_apellidos})` : '');
    if (subEl) subEl.textContent = `${miembro.equipo_nombre} • [${miembro.faccion_nombre}] • ${miembro.rol || 'Combatiente'} • QR: ${miembro.uid || '--'}`;
    
    // Checkboxes Dron & NVG
    const dronCheck = document.getElementById('modal-armas-dron-check');
    const dronModelo = document.getElementById('modal-armas-dron-modelo');
    if (dronCheck) dronCheck.checked = !!miembro.tiene_dron;
    if (dronModelo) {
        dronModelo.value = miembro.dron_modelo || '';
        dronModelo.style.display = miembro.tiene_dron ? 'block' : 'none';
    }
    
    const nvgCheck = document.getElementById('modal-armas-nvg-check');
    const nvgCat = document.getElementById('modal-armas-nvg-cat');
    if (nvgCheck) nvgCheck.checked = !!miembro.tiene_nvg;
    if (nvgCat) {
        nvgCat.value = miembro.nvg_categoria || 'Gen 3';
        nvgCat.style.display = miembro.tiene_nvg ? 'block' : 'none';
    }
    
    renderModalArmasExistentes(miembro.armas || []);
    
    // Limpiar formulario de nueva réplica
    const modInp = document.getElementById('modal-nueva-modelo');
    const fpsInp = document.getElementById('modal-nueva-fps');
    const julInp = document.getElementById('modal-nueva-julios');
    if (modInp) modInp.value = '';
    if (fpsInp) fpsInp.value = '';
    if (julInp) julInp.value = '';
    
    const modal = document.getElementById('modal-gestionar-armas');
    if (modal) modal.style.display = 'flex';
}

function cerrarModalArmas() {
    const modal = document.getElementById('modal-gestionar-armas');
    if (modal) modal.style.display = 'none';
    window.activeArmasMiembroId = null;
}

function toggleDronFields() {
    const chk = document.getElementById('modal-armas-dron-check');
    const inp = document.getElementById('modal-armas-dron-modelo');
    if (inp) inp.style.display = chk && chk.checked ? 'block' : 'none';
}

function toggleNvgFields() {
    const chk = document.getElementById('modal-armas-nvg-check');
    const sel = document.getElementById('modal-armas-nvg-cat');
    if (sel) sel.style.display = chk && chk.checked ? 'block' : 'none';
}

function renderModalArmasExistentes(armas) {
    const cont = document.getElementById('modal-armas-lista-existentes');
    const badge = document.getElementById('modal-armas-count-badge');
    if (!cont) return;
    cont.innerHTML = '';
    
    if (badge) badge.textContent = `${armas.length} réplica${armas.length === 1 ? '' : 's'}`;
    
    if (!armas || armas.length === 0) {
        cont.innerHTML = '<div style="color: #64748b; font-size: 0.8rem; font-style: italic; padding: 6px 0;">Este operador aún no tiene réplicas registradas. Añade una abajo.</div>';
        return;
    }
    
    armas.forEach(a => {
        const item = document.createElement('div');
        item.style.cssText = 'background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08); padding: 8px 12px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; gap: 10px;';
        
        const balistica = (a.fps ? `<b>${a.fps} FPS</b>` : '') + (a.julios ? ` · <b>${a.julios} Julios</b>` : '');
        
        item.innerHTML = `
            <div style="font-size: 0.85rem;">
                <span style="color: #e2b938; font-weight: bold; margin-right: 6px;">[${a.tipo || 'Fusil'}]</span>
                <span style="color: #fff; font-weight: 500;">${a.modelo}</span>
                ${balistica ? `<span style="margin-left: 8px; color: #00f0ff; font-family: monospace; font-size: 0.8rem; background: rgba(0,240,255,0.08); padding: 2px 6px; border-radius: 3px;">${balistica}</span>` : ''}
            </div>
            <button type="button" class="btn danger btn-sm" onclick="eliminarReplica(${a.id})" style="padding: 3px 8px; font-size: 0.72rem; line-height: 1; border-radius: 3px; display: inline-flex; align-items: center; gap: 4px;" title="Eliminar réplica"><span class="material-symbols-outlined" style="font-size: 14px;">delete</span> Borrar</button>
        `;
        cont.appendChild(item);
    });
}

async function guardarEquipamientoTactico() {
    if (!window.activeArmasMiembroId) return;
    
    const tieneDron = document.getElementById('modal-armas-dron-check')?.checked || false;
    const dronModelo = document.getElementById('modal-armas-dron-modelo')?.value || '';
    const tieneNvg = document.getElementById('modal-armas-nvg-check')?.checked || false;
    const nvgCategoria = document.getElementById('modal-armas-nvg-cat')?.value || 'Gen 3';
    
    try {
        const res = await fetch(`/api/admin/miembro/${window.activeArmasMiembroId}/tactico`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                tiene_dron: tieneDron,
                dron_modelo: dronModelo,
                tiene_nvg: tieneNvg,
                nvg_categoria: nvgCategoria
            })
        });
        
        if (res.ok) {
            await cargarArmasDashboard();
            const miembro = (window.armasDashboardData || []).find(x => x.id === window.activeArmasMiembroId);
            if (miembro) {
                renderModalArmasExistentes(miembro.armas || []);
            }
            alert("✅ Capacidades tácticas (Dron / NVG) actualizadas.");
        } else {
            alert("Error al guardar capacidades.");
        }
    } catch(e) {
        alert("Error de conexión al guardar capacidades.");
    }
}

async function guardarNuevaReplica() {
    if (!window.activeArmasMiembroId) return;
    
    const tipo = document.getElementById('modal-nueva-tipo')?.value || 'Fusilero / Asalto';
    const modelo = (document.getElementById('modal-nueva-modelo')?.value || '').trim();
    const fps = document.getElementById('modal-nueva-fps')?.value;
    const julios = document.getElementById('modal-nueva-julios')?.value;
    
    if (!modelo) {
        alert("Por favor, introduce el modelo o nombre específico de la réplica.");
        document.getElementById('modal-nueva-modelo')?.focus();
        return;
    }
    
    try {
        const res = await fetch('/api/crono/arma/nueva', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                miembro_id: window.activeArmasMiembroId,
                modelo: modelo,
                tipo: tipo,
                fps: fps ? parseFloat(fps) : null,
                julios: julios ? parseFloat(julios) : null,
                estado_crono: 'APROBADO'
            })
        });
        
        const data = await res.json();
        if (data.status === 'success') {
            await cargarArmasDashboard();
            const miembro = (window.armasDashboardData || []).find(x => x.id === window.activeArmasMiembroId);
            if (miembro) {
                renderModalArmasExistentes(miembro.armas || []);
            }
            // Limpiar inputs
            document.getElementById('modal-nueva-modelo').value = '';
            document.getElementById('modal-nueva-fps').value = '';
            document.getElementById('modal-nueva-julios').value = '';
            document.getElementById('modal-nueva-modelo').focus();
        } else {
            alert(data.error || "Error al añadir la réplica.");
        }
    } catch(e) {
        alert("Error de red al añadir réplica.");
    }
}

async function eliminarReplica(armaId) {
    if (!confirm("¿Eliminar esta réplica del combatiente?")) return;
    
    try {
        const res = await fetch(`/api/crono/arma/${armaId}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            await cargarArmasDashboard();
            const miembro = (window.armasDashboardData || []).find(x => x.id === window.activeArmasMiembroId);
            if (miembro) {
                renderModalArmasExistentes(miembro.armas || []);
            }
        } else {
            alert("Error al eliminar la réplica.");
        }
    } catch(e) {
        alert("Error de red al eliminar la réplica.");
    }
}

// ==================== ESCÁNER QR CARNET PARA RÉPLICAS ====================
let armasQrScanner = null;

function playScanSuccessBeep() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const audioCtx = new AudioCtx();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
        osc.frequency.exponentialRampToValueAtTime(1320, audioCtx.currentTime + 0.12); // E6
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.12);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.12);
    } catch (e) {
        // Ignorar si el navegador bloquea audio antes de interacción
    }
}

function extractUidFromQr(rawText) {
    if (!rawText) return '';
    let text = String(rawText).trim();
    // 1. URL con ?token= o &token= (formato estándar de carnet.html)
    if (text.includes('token=')) {
        try {
            const url = new URL(text.startsWith('http') ? text : 'http://dummy/' + text);
            const token = url.searchParams.get('token');
            if (token) return token.trim().toUpperCase();
        } catch (e) {
            const match = text.match(/[?&]token=([a-zA-Z0-9_-]+)/i);
            if (match) return match[1].trim().toUpperCase();
        }
    }
    // 2. URL terminada en /scan/UID o /UID
    if (text.includes('/')) {
        const parts = text.split(/[?#]/)[0].split('/');
        const last = parts[parts.length - 1];
        if (last && last.length >= 4) {
            return last.trim().toUpperCase();
        }
    }
    // 3. Raw UID directo
    return text.replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase();
}

async function abrirScannerQrArmas() {
    const modal = document.getElementById('modal-scanner-armas');
    if (!modal) return;
    
    // Limpiar input manual y estado
    const manualInput = document.getElementById('armas-scanner-manual-uid');
    if (manualInput) manualInput.value = '';
    const statusEl = document.getElementById('armas-scanner-status');
    if (statusEl) statusEl.textContent = 'Iniciando cámara...';
    
    modal.style.display = 'flex';
    
    const video = document.getElementById('armas-scanner-video');
    if (!video) return;

    if (typeof MedicQRScanner !== 'undefined') {
        if (armasQrScanner) {
            armasQrScanner.stop();
        }
        armasQrScanner = new MedicQRScanner(
            video,
            (rawText) => onArmasQrDetectado(rawText),
            (errMsg) => {
                if (statusEl) statusEl.textContent = errMsg || 'No se pudo acceder a la cámara. Usa entrada manual.';
            }
        );
        try {
            await armasQrScanner.start();
            if (statusEl) statusEl.textContent = 'Buscando código QR del carnet...';
        } catch (e) {
            if (statusEl) statusEl.textContent = 'Cámara no disponible. Introduce el UID manual.';
        }
    } else {
        if (statusEl) statusEl.textContent = 'Módulo QR no cargado. Introduce el UID manual.';
    }
    
    if (manualInput) manualInput.focus();
}

function cerrarScannerQrArmas() {
    if (armasQrScanner) {
        armasQrScanner.stop();
        armasQrScanner = null;
    }
    const modal = document.getElementById('modal-scanner-armas');
    if (modal) modal.style.display = 'none';
}

async function toggleArmasScannerCamera() {
    if (armasQrScanner) {
        const mode = await armasQrScanner.toggleCamera();
        const statusEl = document.getElementById('armas-scanner-status');
        if (statusEl) statusEl.textContent = `Cámara cambiada (${mode === 'environment' ? 'trasera' : 'frontal'}).`;
    }
}

async function toggleArmasScannerTorch() {
    if (armasQrScanner) {
        const isTorchOn = await armasQrScanner.toggleTorch();
        const btn = document.getElementById('btn-armas-scanner-torch');
        if (btn) {
            btn.style.background = isTorchOn ? 'rgba(226,185,56,0.3)' : 'transparent';
        }
    }
}

async function onArmasQrDetectado(rawText) {
    playScanSuccessBeep();
    cerrarScannerQrArmas();
    await abrirModalArmasPorUid(rawText);
}

async function buscarJugadorPorUidManual() {
    const input = document.getElementById('armas-scanner-manual-uid');
    const val = (input ? input.value : '').trim();
    if (!val) {
        alert('Por favor introduce un UID o código de carnet.');
        if (input) input.focus();
        return;
    }
    cerrarScannerQrArmas();
    await abrirModalArmasPorUid(val);
}

async function abrirModalArmasPorUid(rawUid) {
    const uid = extractUidFromQr(rawUid);
    if (!uid) {
        alert('Código de carnet no válido o vacío.');
        return;
    }
    
    // 1. Buscar en memoria local si el dashboard ya está cargado
    let miembro = (window.armasDashboardData || []).find(x => (x.uid || '').trim().toUpperCase() === uid);
    
    // 2. Si no se encuentra en memoria, consultar backend
    if (!miembro) {
        try {
            const res = await fetch(`/api/admin/miembro_por_uid/${encodeURIComponent(uid)}`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.id) {
                    await cargarArmasDashboard();
                    miembro = (window.armasDashboardData || []).find(x => x.id === data.id);
                }
            }
        } catch (e) {
            console.warn('Error consultando miembro por UID:', e);
        }
    }
    
    if (miembro) {
        await abrirModalArmas(miembro.id);
        setTimeout(() => {
            const modInp = document.getElementById('modal-nueva-modelo');
            if (modInp) modInp.focus();
        }, 150);
    } else {
        alert(`No se encontró ningún combatiente con UID / Carnet: ${uid}.\nVerifica que el jugador esté registrado en su unidad.`);
    }
}



