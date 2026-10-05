
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

document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initTabs();
    loadFacciones();
    loadEquipos();
    if(window.userRole === "admin") loadPOIs();
    loadORBAT();
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
            const targetId = btn.dataset.target;
            if (targetId) {
                const targetElement = document.getElementById(targetId);
                if (targetElement) {
                    targetElement.classList.add('active');
                }
            }
            
            if (targetId === 'view-mortero' && typeof morteroMap !== 'undefined' && morteroMap) {
                setTimeout(() => morteroMap.invalidateSize(), 100);
            }
        });
    });

    const sidebarBtns = document.querySelectorAll('.sidebar-tab');
    const sidebarPanels = document.querySelectorAll('.sidebar-content');
    sidebarBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            sidebarBtns.forEach(b => b.classList.remove('active'));
            sidebarPanels.forEach(p => p.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(btn.dataset.target).classList.add('active');
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
                    navBtn.classList.remove('minigame-locked');
                    navBtn.innerHTML = '<span class="material-symbols-outlined">rocket_launch</span>';
                    navBtn.title = 'Mortero/Artillería';
                    navBtn.click(); // switch to it
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
    if (selectPoi) {
        selectPoi.innerHTML = '<option value="">(Ninguna / Neutral)</option>';
        facciones.forEach(f => {
            selectPoi.innerHTML += `<option value="${f.id}">${f.nombre}</option>`;
        });
    }

    const select = document.getElementById('eq-faccion');
    select.innerHTML = '';
    facciones.forEach(f => {
        select.innerHTML += `<option value="${f.id}">${f.nombre}</option>`;
    });
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

    let html = '';

    // 1. MANDO
    if(mandoGroup) {
        html += `
            <div class="mando-section">
                ${renderCard(mandoGroup, true, totalFactionPax)}
            </div>
        `;
    }

    // 2. SPLIT GOE/GAD
    html += `
        <div class="tree-split">
            <div class="tree-column">
                <div class="tree-column-title">GOE</div>
                ${goeGroups.map(g => renderCard(g, false)).join('')}
            </div>
            <div class="tree-column">
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
        let logoSymbol = isMando ? '🛡️' : (g.tipo === 'GOE' ? '🎯' : '⚔️');
        logoHtml = `<div class="grupo-logo" style="display:flex; justify-content:center; align-items:center; font-size:2.5rem; background:rgba(0,0,0,0.2); border-radius:8px;">${logoSymbol}</div>`;
    }
    
    const phoneLabel = isMando ? 'Línea Baja' : 'Contacto Mando';

    // For Mando, don't show droppable area, missions, or stats. Show 'nombre_jefe'.
    const isMandoCard = isMando; // just for clarity
    const statsHtml = isMandoCard ? '' : `<span class="grupo-pax ${currentFaction}"><span id="stats-${g.id}">${totalJugadores}</span> PAX</span>`;

    let extraFieldsHtml = '';
    if (isMandoCard) {
        extraFieldsHtml = `
            <div class="editable-field" style="margin-top: 5px;">
                <label>Cmdt</label>
                <input type="text" class="input-inline update-grupo" data-id="${g.id}" data-field="nombre_jefe" value="${g.nombre_jefe || ''}" placeholder="Nombre del mando">
            </div>
        `;
    }

    // Missions logic is now Drag&Drop. If group has a mission, render it inside the droppable-area.
    const hasMission = g.mision_actual_id !== null;
    const assignedMission = todasMisiones.find(m => m.id === g.mision_actual_id);
    let assignedMissionHtml = '';
    
    if (assignedMission) {
        let snapshotHtml = '';
        if (assignedMission.esquema_json && (assignedMission.revelada || window.userRole === 'admin' || window.userRole === 'mando')) {
            snapshotHtml = `<button onclick='event.stopPropagation(); verEsquema(${JSON.stringify(assignedMission.esquema_json)})' style="display:inline-block; margin-top:5px; background:rgba(255,255,255,0.1); padding:2px 5px; border-radius:3px; font-size:0.75em; text-decoration:none; color:var(--theme-color); border:none; cursor:pointer;"><span class="material-symbols-outlined" style="font-size:1em; vertical-align:middle;">map</span> Ver Mapa</button>`;
        }
        assignedMissionHtml = `
            <div class="mision-card" draggable="true" onclick='verInformeMision(${JSON.stringify(assignedMission)})' data-mision-id="${assignedMission.id}" data-obj='${JSON.stringify(assignedMission)}'>
                <strong style="text-transform: uppercase;">[MSN] ${assignedMission.tipo}</strong>
                <div style="font-size: 0.85em; font-weight: bold; margin-bottom: 2px;">${assignedMission.nombre}</div>
                <div>${assignedMission.etiquetas || ''}</div>
                ${snapshotHtml}
            </div>
        `;
    }

    const droppableHtml = isMandoCard ? `
        <div class="grupo-drop-zones mando-mision-zone" style="margin-top: 1rem; width: 100%; grid-template-columns: 1fr;">
            <div class="droppable-area-wrapper misiones-zone" style="width: 100%;">
                <div class="zone-label">Contexto Operacional (Misión Global)</div>
                <div class="droppable-area" data-grupo-id="${g.id}" data-type="mision" style="min-height: 80px;">
                    ${assignedMissionHtml}
                </div>
            </div>
        </div>
    ` : `
        <div class="grupo-drop-zones">
            <div class="droppable-area-wrapper equipos-zone">
                <div class="zone-label">Equipos (${teamsInGroup.length})</div>
                <div class="droppable-area" data-grupo-id="${g.id}" data-type="equipo">
                    ${teamsInGroup.map(t => `
                        <div class="equipo-card" draggable="true" data-equipo-id="${t.equipo_id}">
                            <div>
                                <strong>${t.equipo_nombre}</strong>
                                <div class="equipo-details">Rol Preferido: ${todosEquipos.find(e => e.id === t.equipo_id)?.tipo || 'N/A'}</div>
                                ${ (t.apoyos > 0 || t.snipers > 0) ? `<div style="font-size: 0.7em; margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px;">${t.apoyos > 0 ? `<span style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); padding: 2px 5px; border-radius: 3px;">🛡️ ${t.apoyos} Apoyo</span>` : ''}${t.snipers > 0 ? `<span style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); padding: 2px 5px; border-radius: 3px;">🎯 ${t.snipers} Sniper</span>` : ''}</div>` : '' }
                            </div>
                            <span>${t.jugadores} px</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <div class="droppable-area-wrapper misiones-zone">
                <div class="zone-label">Misión Activa</div>
                <div class="droppable-area" data-grupo-id="${g.id}" data-type="mision">
                    ${assignedMissionHtml}
                </div>
            </div>
        </div>
    `;

    if (isMandoCard) {
        let bigLogoHtml = '';
        if (imgSrc) {
            bigLogoHtml = `<div class="mando-logo-large" style="background-image: url('${imgSrc}'); width: 120px; height: 120px; background-size: contain; background-repeat: no-repeat; background-position: center; border: none; background-color: transparent;"></div>`;
        } else {
            bigLogoHtml = `<div class="mando-logo-large" style="display:flex; justify-content:center; align-items:center; font-size:4rem; width:120px; height:120px; background:rgba(0,0,0,0.2); border-radius:8px;">🛡️</div>`;
        }

        return `
            <div class="grupo-card mando-card" style="display: flex; flex-direction: row; padding: 1rem; align-items: center; gap: 1.5rem;">
                <div class="mando-logo-container">
                    ${bigLogoHtml}
                </div>
                <div class="mando-content" style="flex: 1; display: flex; flex-direction: column; gap: 0.5rem; border-left: 1px solid var(--border-color); padding-left: 1.5rem;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
                        <div class="mando-title" style="font-size: 1.4rem; font-family: var(--font-mono); font-weight: bold; background: rgba(0,0,0,0.4); color: #fff; padding: 0.25rem 0.75rem; border-radius: 4px; display: inline-block; margin-bottom: 0.5rem;">
                            ${g.nombre}
                        </div>
                        <div style="font-family: var(--font-mono); font-size: 1.2rem; color: var(--theme-color); font-weight: bold; background: rgba(0,0,0,0.5); padding: 0.25rem 0.75rem; border: 1px solid var(--theme-color);">
                            TOTAL EFECTIVOS: <span id="orbat-total-pax-value">${totalFactionPax}</span>
                        </div>
                    </div>
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

    unassigned.forEach(eq => {
        unassignedContainer.innerHTML += `
            <div class="equipo-card" draggable="true" data-equipo-id="${eq.id}">
                <div>
                    <strong>${eq.nombre}</strong>
                    <div class="equipo-details">Perfil: ${eq.tipo}</div>
                    ${ (eq.apoyos > 0 || eq.snipers > 0) ? `<div style="font-size: 0.7em; margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px;">${eq.apoyos > 0 ? `<span style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); padding: 2px 5px; border-radius: 3px;">🛡️ ${eq.apoyos} Apoyo</span>` : ''}${eq.snipers > 0 ? `<span style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); padding: 2px 5px; border-radius: 3px;">🎯 ${eq.snipers} Sniper</span>` : ''}</div>` : '' }
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
        tbody.innerHTML += `
            <tr>
                <td style="display: flex; align-items: center;">${logoHtml}${eq.nombre}</td>
                <td class="color-${eq.faccion_nombre}">${eq.faccion_nombre}</td>
                <td>${eq.jugadores}</td>
                <td>${eq.tipo}</td>
                <td>
                    <button class="btn secondary btn-edit" data-id="${eq.id}">Editar</button>
                    <button class="btn danger btn-del" data-id="${eq.id}">Borrar</button>
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

    btnNew.addEventListener('click', () => openModal());
    btnCancel.addEventListener('click', closeModal);
    
    const btnMiExpediente = document.getElementById('btn-mi-expediente');
    if (btnMiExpediente) {
        btnMiExpediente.addEventListener('click', async () => {
            if (!window.equipoId) return;
            const res = await fetch('/api/equipos');
            const equipos = await res.json();
            const miEquipo = equipos.find(e => e.id == window.equipoId);
            if (miEquipo) {
                openModal(miEquipo);
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
        const payload = {
            nombre: document.getElementById('eq-nombre').value,
            faccion_id: document.getElementById('eq-faccion').value,
            jugadores: document.getElementById('eq-jugadores-manual').checked 
                ? parseInt(document.getElementById('eq-jugadores').value) || 0
                : (parseInt(document.getElementById('eq-jugadores').value.split(' / ')[0]) || 0),
            jugadores_manual: document.getElementById('eq-jugadores-manual').checked,
            tipo: document.getElementById('eq-tipo').value,
            codigo: document.getElementById('eq-codigo') ? document.getElementById('eq-codigo').value : '',
            password: document.getElementById('eq-password') ? document.getElementById('eq-password').value : '',
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
                
                if (nombre) {
                    payload.miembros.push({ id: mId, activo: activo, nombre_jugador: nombre, nombre_apellidos: fullname, dni: dni, telefono: tel, email: email, rol: rol });
                }
            });
        }

        const url = id ? `/api/equipos/${id}` : '/api/equipos';
        const method = id ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method: method,
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        
        const resJson = await res.json();
        const finalId = id ? id : resJson.id;
        
        const logoInput = document.getElementById('eq-logo');
        if (logoInput && logoInput.files.length > 0) {
            const formData = new FormData();
            formData.append('logo', logoInput.files[0]);
            await fetch(`/api/equipos/${finalId}/logo`, {
                method: 'POST',
                body: formData
            });
        }
        
        const fotoInput = document.getElementById('eq-foto');
        if (fotoInput && fotoInput.files.length > 0) {
            const formDataFoto = new FormData();
            formDataFoto.append('foto', fotoInput.files[0]);
            await fetch(`/api/equipos/${finalId}/foto`, {
                method: 'POST',
                body: formDataFoto
            });
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
    document.getElementById('modal-title').innerText = equipo ? 'Editar Expediente de Equipo' : 'Registrar Equipo';
    
    document.getElementById('eq-id').value = equipo ? equipo.id : '';
    document.getElementById('eq-nombre').value = equipo ? equipo.nombre : '';
    document.getElementById('eq-jugadores').value = equipo ? equipo.jugadores : '0 / 0';
    document.getElementById('eq-jugadores-manual').checked = equipo ? equipo.jugadores_manual : false;
    document.getElementById('eq-tipo').value = equipo ? equipo.tipo : 'Infantería';
    document.getElementById('eq-misiones-preferidas').value = equipo ? (equipo.misiones_preferidas || '') : '';
    
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
    if (document.getElementById('eq-codigo')) {
        document.getElementById('eq-codigo').value = equipo ? (equipo.codigo || '') : '';
    }
    if (document.getElementById('eq-password')) {
        document.getElementById('eq-password').value = ''; // Always empty on open
    }
    
    // Admin features visibility
    const adminExpediente = document.getElementById('admin-expediente');
    
    // Core fields restrictions
    const coreFields = ['eq-nombre', 'eq-faccion', 'eq-codigo'];
    
    if (window.userRole === 'admin') {
        adminExpediente.style.display = 'block';
        document.getElementById('eq-tags').value = equipo ? (equipo.tags_comportamiento || '[]') : '[]';
        document.getElementById('eq-estado-medalla').value = equipo ? (equipo.estado_medalla || 'verde') : 'verde';
        if (document.getElementById('eq-estado-sancion')) {
            document.getElementById('eq-estado-sancion').value = equipo ? (equipo.estado_sancion || 'Autorizado') : 'Autorizado';
        }
        coreFields.forEach(f => {
            const el = document.getElementById(f);
            if(el) { el.disabled = false; el.readOnly = false; }
        });
        renderTagsUI();
    } else {
        adminExpediente.style.display = 'none';
        coreFields.forEach(f => {
            const el = document.getElementById(f);
            if(el) { el.disabled = true; el.readOnly = true; }
        });
    }
    
    // Update badge visual
    const badge = document.getElementById('badge-medalla');
    if (equipo && equipo.estado_medalla && window.userRole === 'admin') {
        badge.style.display = 'block';
        if (equipo.estado_medalla === 'verde') badge.innerHTML = '🟢 Excelente';
        else if (equipo.estado_medalla === 'amarillo') badge.innerHTML = '🟡 Advertencia';
        else badge.innerHTML = '🔴 Problemático';
    } else {
        badge.style.display = 'none';
    }
    
    updateJugadoresState();
    
    if (equipo) {
        document.getElementById('eq-faccion').value = equipo.faccion_id;
    }

    const miembrosContainer = document.getElementById('miembros-container');
    miembrosContainer.innerHTML = '';
    
    if (equipo && equipo.miembros && equipo.miembros.length > 0) {
        equipo.miembros.forEach(m => addMiembroRow(m));
    } else {
        addMiembroRow();
    }
    
    const historialContainer = document.getElementById('historial-container');
    historialContainer.innerHTML = '';
    
    if (equipo && equipo.historial && equipo.historial.length > 0) {
        equipo.historial.forEach(h => addHistorialRow(h));
    } else {
        addHistorialRow();
    }
    
    modal.classList.add('active');
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
    if (isManual) return;
    const container = document.getElementById('miembros-container');
    const validRows = Array.from(container.querySelectorAll('.miembro-row')).filter(r => r.querySelector('.miembro-nombre').value.trim() !== '');
    const total = validRows.length;
    const activos = validRows.filter(r => r.querySelector('.miembro-activo').checked).length;
    document.getElementById('eq-jugadores').value = `${activos} / ${total}`;
}

document.getElementById('eq-jugadores-manual').addEventListener('change', updateJugadoresState);



function addMiembroRow(m = null) {
    const container = document.getElementById('miembros-container');
    const tr = document.createElement('tr');
    tr.className = 'miembro-row';
    tr.dataset.id = m ? m.id : '';
    
    const activo = (m && m.activo !== undefined) ? (m.activo == 1) : true;
    const nombre = m ? m.nombre_jugador : '';
    const fullname = m ? (m.nombre_apellidos || '') : '';
    const dni = m ? (m.dni || '') : '';
    const rol = m ? m.rol : 'Fusilero';
    const tel = m ? (m.telefono || '') : '';
    const email = m ? (m.email || '') : '';

    tr.innerHTML = `
        <td style="padding: 0.25rem; text-align: center;"><input type="checkbox" class="miembro-activo" ${activo ? 'checked' : ''} style="transform: scale(1.5);"></td>
        <td style="padding: 0.25rem;"><input type="text" class="miembro-nombre" placeholder="Nick" value="${nombre}" style="width: 100%; padding: 0.25rem;"></td>
        <td style="padding: 0.25rem;"><input type="text" class="miembro-fullname" placeholder="Nombre completo" value="${fullname}" style="width: 100%; padding: 0.25rem;"></td>
        <td style="padding: 0.25rem;"><input type="text" class="miembro-dni" placeholder="DNI" value="${dni}" style="width: 100%; padding: 0.25rem;"></td>
        <td style="padding: 0.25rem;">
            <select class="miembro-rol" style="width: 100%; padding: 0.25rem;">
                <option value="Lider" ${rol === 'Lider' ? 'selected' : ''}>Lider</option>
                <option value="Fusilero" ${rol === 'Fusilero' ? 'selected' : ''}>Fusilero</option>
                <option value="Sanitario" ${rol === 'Sanitario' ? 'selected' : ''}>Sanitario</option>
                <option value="Apoyo" ${rol === 'Apoyo' ? 'selected' : ''}>Apoyo</option>
                <option value="Sniper" ${rol === 'Sniper' ? 'selected' : ''}>Sniper</option>
                <option value="Selecto" ${rol === 'Selecto' ? 'selected' : ''}>Selecto</option>
            </select>
        </td>
        <td style="padding: 0.25rem;"><input type="text" class="miembro-telefono" placeholder="Teléfono" value="${tel}" style="width: 100%; padding: 0.25rem;"></td>
        <td style="padding: 0.25rem;"><input type="email" class="miembro-email" placeholder="Email" value="${email}" style="width: 100%; padding: 0.25rem;"></td>
        <td style="padding: 0.25rem; text-align: center;"><button type="button" class="btn danger btn-del-miembro" style="padding: 0.25rem 0.5rem;">X</button></td>
    `;
    
    const inputNombre = tr.querySelector('.miembro-nombre');
    inputNombre.addEventListener('input', updateJugadoresCount);
    
    const cbActivo = tr.querySelector('.miembro-activo');
    if (cbActivo) cbActivo.addEventListener('change', updateJugadoresCount);
    
    tr.querySelector('.btn-del-miembro').addEventListener('click', () => {
        tr.remove();
        updateJugadoresCount();
    });
    
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

document.getElementById('btn-add-miembro').addEventListener('click', () => {
    addMiembroRow();
});

document.getElementById('btn-add-historial').addEventListener('click', () => {
    addHistorialRow();
});

function closeModal() {
    const modal = document.getElementById('modal-equipo');
    modal.classList.remove('active');
    document.getElementById('form-equipo').reset();
    document.getElementById('miembros-container').innerHTML = '';
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
                <td>${mis.nombre}</td>
                <td>${mis.tipo}</td>
                <td>${mis.etiquetas || ''}</td>
                <td>${mis.oficial_responsable || ''}</td>
                <td>${mis.persistente ? '🔄 SÍ' : 'NO'}</td>
                <td>${mis.revelada ? '👁️ SÍ' : 'NO'}</td>
                <td>
                    <button class="btn secondary btn-edit-mision" data-id="${mis.id}" data-obj='${JSON.stringify(mis)}'>Editar</button>
                    <button class="btn danger btn-del-mision" data-id="${mis.id}">Borrar</button>
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
                <td>${poi.nombre}</td>
                <td><strong>${poi.tipo}</strong></td>
                <td>${poi.tolerancia_metros}m</td>
                <td>${faccionName}</td>
                <td style="font-family: monospace; letter-spacing: 2px;">
                    ${poi.token_qr} 
                    <button class="btn outline btn-view-qr" style="padding: 2px 5px; font-size: 0.7rem; margin-left: 5px;" data-token="${poi.token_qr}">Ver QR</button>
                    <a href="/scan/${poi.token_qr}" target="_blank" class="btn outline" style="padding: 2px 5px; font-size: 0.7rem; margin-left: 5px; text-decoration: none;">Probar Scanner</a>
                </td>
                <td>
                    <button class="btn secondary btn-edit-poi" data-id="${poi.id}" data-obj='${JSON.stringify(poi)}'>Editar</button>
                    <button class="btn danger btn-del-poi" data-id="${poi.id}">Borrar</button>
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
            document.getElementById('qr-raw-content').innerText = token;
            // Usamos un API publica gratuita para generar el QR on-the-fly
            document.getElementById('qr-image').src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(token)}`;
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
        
        const payload = {
            nombre: document.getElementById('poi-nombre').value,
            tipo: document.getElementById('poi-tipo').value,
            faccion_id: document.getElementById('poi-faccion').value || null,
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
                    <td style="font-weight: bold; color: #fff;">${eq.nombre}</td>
                    <td style="color: ${facColor};">${eq.faccion_nombre}</td>
                    <td>
                        <input type="text" id="pwd-${eq.id}" value="${eq.codigo || ''}" placeholder="Sin contraseña" style="background: rgba(0,0,0,0.3); border: 1px solid #444; color: #fff; padding: 5px 10px; width: 100%; border-radius: 3px; font-family: var(--font-mono);">
                    </td>
                    <td style="text-align: center;">
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
    const input = document.getElementById(`pwd-${id}`);
    const pwd = input.value;
    
    // To update only the password, we need to fetch the current equipo data and merge the new code
    const resGet = await fetch('/api/equipos');
    const equipos = await resGet.json();
    const eq = equipos.find(e => e.id == id);
    if (!eq) return;
    
    eq.codigo = pwd;
    
    const resPut = await fetch(`/api/equipos/${id}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(eq)
    });
    
    if (resPut.ok) {
        input.style.borderColor = 'green';
        setTimeout(() => input.style.borderColor = '#444', 2000);
    } else {
        alert("Error al actualizar la contraseña");
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const btnZafarrancho = document.getElementById('btn-zafarrancho');
    if (btnZafarrancho) {
        btnZafarrancho.addEventListener('click', async () => {
            if (confirm("¡ALERTA ROJA! ¿Estás absolutamente seguro de que quieres BORRAR todas las capturas, respawns y misiones actuales? ESTO NO SE PUEDE DESHACER.")) {
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

    // Coordinate hover (Grid)
    morteroMap.on('mousemove', (e) => {
        const hoverCoord = document.getElementById('mortero-hover-coord');
        if (hoverCoord && typeof getGridCoordinate !== 'undefined') {
            hoverCoord.innerText = getGridCoordinate(e.latlng.lat, e.latlng.lng);
        }
    });

    // Click to place battery
    morteroMap.on('click', (e) => {
        pendingBatteryLat = e.latlng.lat;
        pendingBatteryLng = e.latlng.lng;
        
        if (morteroBatteryMarker) {
            morteroBatteryMarker.setLatLng(e.latlng);
        } else {
            morteroBatteryMarker = L.marker(e.latlng, { icon: batteryIcon }).addTo(morteroMap);
        }
        
        const display = document.getElementById('mortero_coord_display');
        if (display && typeof getGridCoordinate !== 'undefined') {
            display.value = getGridCoordinate(e.latlng.lat, e.latlng.lng);
        }
        
        document.getElementById('btn-ubicar-mortero').disabled = false;
    });

    refreshMorteroState();
    setInterval(refreshMorteroState, 3000);
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
        }
    }

    // Dibujar disparos
    morteroShotsLayer.clearLayers();
    data.disparos.forEach(d => {
        if(d.pixel_x && d.pixel_y) {
            const PIXELS_PER_METER = 31.71 / 50.0;
            const radiusPx = (data.radio_explosion || 15) * PIXELS_PER_METER;
            L.circle([d.pixel_x, d.pixel_y], {
                color: 'red',
                opacity: 0.3,
                fillColor: '#f03',
                fillOpacity: 0.15,
                radius: radiusPx
            }).bindPopup(`Impacto: ${d.timestamp}`).addTo(morteroShotsLayer);
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
    
    await fetch('/api/admin/artilleria/config', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ alcance_base: alcance, radio_explosion: radio, disparos_por_minuto: cadencia })
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
        const bounds = [[0, 0], [2081, 3000]];
        const imageOverlay = L.imageOverlay('/static/map/Full_Mapa%20Oct24.png', bounds).addTo(visorMap);
        visorMap.fitBounds(bounds);
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
            todosPOIs.forEach(poi => {
                if(poi.lat && poi.lng) {
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

        // Cargar Grupos de Batalla de la Facción
        if(typeof facciones !== 'undefined') {
            const faccionMap = facciones.find(f => f.nombre === currentFaction);
            if (faccionMap && faccionMap.grupos) {
                faccionMap.grupos.forEach(g => {
                    if(g.pos_x && g.pos_y) {
                        const iconMap = {
                            'HQ': 'star', 'Infantería': 'group', 'Reconocimiento': 'visibility', 
                            'Sniper': 'my_location', 'Logística': 'local_shipping', 'Artillería': 'rocket_launch'
                        };
                        const iconName = iconMap[g.tipo] || 'group';
                        const color = faccionMap.color;
                        const gIcon = L.divIcon({
                            className: 'group-icon',
                            html: `<div style="background-color: ${color}; width: 34px; height: 34px; display: flex; justify-content: center; align-items: center; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 5px rgba(0,0,0,0.5);">
                                     <span class="material-symbols-outlined" style="color: white; font-size: 20px;">${iconName}</span>
                                   </div>
                                   <div style="background: rgba(0,0,0,0.7); color: white; font-size: 10px; text-align: center; margin-top: 2px; border-radius: 3px; padding: 1px 4px; white-space: nowrap;">${g.nombre}</div>`,
                            iconSize: [34, 50],
                            iconAnchor: [17, 25]
                        });
                        L.marker([g.pos_x, g.pos_y], { icon: gIcon }).addTo(visorMap);
                    }
                });
            }
        }
        
    } catch(e) {
        console.error("Error parseando esquema", e);
    }
}


// --- EXPORTAR ORBAT ---
document.addEventListener("DOMContentLoaded", () => {
    const btnExport = document.getElementById("btn-export-orbat");
    if (btnExport) {
        btnExport.addEventListener("click", async () => {
            const treeContainer = document.getElementById("orbat-tree-container");
            if (!treeContainer) return;
            
            btnExport.disabled = true;
            btnExport.innerHTML = '<span class="material-symbols-outlined">hourglass_empty</span> Generando...';

            try {
                // Get CSS
                const styleRes = await fetch('/static/css/style.css');
                const cssText = await styleRes.text();
                
                // Clone container to avoid modifying the DOM
                const clone = treeContainer.cloneNode(true);
                
                // Convert background images to Base64 so they work offline
                const elementsWithBg = clone.querySelectorAll('[style*="background-image"]');
                for (let el of elementsWithBg) {
                    let bgUrl = el.style.backgroundImage;
                    const urlMatch = bgUrl.match(/url\(['"]?(.*?)['"]?\)/);
                    if (urlMatch && urlMatch[1]) {
                        try {
                            let relUrl = urlMatch[1];
                            if (!relUrl.startsWith('http') && !relUrl.startsWith('data:')) {
                                const res = await fetch(relUrl);
                                const blob = await res.blob();
                                const reader = new FileReader();
                                const b64 = await new Promise((resolve) => {
                                    reader.onloadend = () => resolve(reader.result);
                                    reader.readAsDataURL(blob);
                                });
                                el.style.backgroundImage = `url('${b64}')`;
                            }
                        } catch (e) {
                            console.error("Error fetching image to b64:", e);
                        }
                    }
                }
                
                // Remove map buttons and onclick attributes to keep it static
                const mapButtons = clone.querySelectorAll('button[onclick*="verEsquema"]');
                mapButtons.forEach(btn => btn.remove());
                
                const misionCards = clone.querySelectorAll('.mision-card');
                misionCards.forEach(card => {
                    card.removeAttribute('onclick');
                    card.style.cursor = 'default';
                });
                
                // Create standalone HTML
                const standaloneHtml = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>ORBAT - ${currentFaction}</title>
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Rajdhani:wght@400;600;700&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0" rel="stylesheet" />
    
    <style>
        ${cssText}
        body { 
            background-color: #000; 
            padding: 20px;
            overflow-y: auto;
            min-height: 100vh;
        }
        
        .orbat-content-wrapper {
            margin: 0 auto;
            position: relative;
        }
    </style>
</head>
<body data-theme="default">
    <div class="orbat-content-wrapper">
        <div class="orbat-tree-container" id="standalone-tree">
            ${clone.innerHTML}
        </div>
    </div>
    <script>
        // Pannable/Zoomable standalone tree (simple approach)
        document.addEventListener('DOMContentLoaded', () => {
            const tree = document.getElementById('standalone-tree');
            let scale = 1;
            document.addEventListener('wheel', (e) => {
                if(e.ctrlKey) {
                    e.preventDefault();
                    scale += e.deltaY * -0.001;
                    scale = Math.min(Math.max(0.3, scale), 2);
                    tree.style.transform = \`scale(\${scale})\`;
                    tree.style.transformOrigin = "top center";
                }
            }, {passive: false});
        });
    </script>
</body>
</html>`;

                // Download HTML file
                const blob = new Blob([standaloneHtml], { type: 'text/html' });
                const link = document.createElement("a");
                link.download = `ORBAT_${currentFaction}_${new Date().getTime()}.html`;
                link.href = URL.createObjectURL(blob);
                link.click();
            } catch (error) {
                console.error("Error exportando ORBAT:", error);
                alert("Hubo un error al exportar el ORBAT.");
            } finally {
                btnExport.disabled = false;
                btnExport.innerHTML = '<span class="material-symbols-outlined">html</span> Exportar ORBAT (HTML)';
            }
        });
    }
});

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
        if(!res.ok) return;
        const logs = await res.json();
        list.innerHTML = '';
        logs.forEach(log => {
            const tr = document.createElement('tr');
            const date = new Date(log.timestamp + 'Z').toLocaleString();
            tr.innerHTML = `
                <td>${date}</td>
                <td><span style="color: var(--color-${(log.faccion_nombre||'').toLowerCase()});">${log.faccion_nombre}</span></td>
                <td>${log.tipo_objetivo}</td>
                <td>${log.objetivo_id}</td>
                <td>${log.descripcion}</td>
            `;
            list.appendChild(tr);
        });
    } catch (e) {
        console.error(e);
    }
}

document.getElementById('btn-admin-refresh-art-log')?.addEventListener('click', loadAdminArtilleriaLogs);
setTimeout(() => { if(typeof loadAdminArtilleriaLogs === 'function') loadAdminArtilleriaLogs(); }, 1200);
