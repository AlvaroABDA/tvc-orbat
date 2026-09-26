document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initTabs();
    loadFacciones();
    loadEquipos();
    loadORBAT();
    initModal();
    initCrudMision();
});

// --- NAVIGATION & TABS ---
function initNavigation() {
    const btns = document.querySelectorAll('.nav-icon-btn');
    const sections = document.querySelectorAll('.view-section');

    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            btns.forEach(b => b.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(btn.dataset.target).classList.add('active');
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
    
    const paxValueEl = document.getElementById('orbat-total-pax-value');
    if (paxValueEl) paxValueEl.innerText = totalFactionPax;

    if(grupos.length === 0) return;

    const mandoGroup = grupos.find(g => g.es_mando);
    const goeGroups = grupos.filter(g => g.tipo === 'GOE' && !g.es_mando);
    const gadGroups = grupos.filter(g => g.tipo === 'GAD' && !g.es_mando);

    let html = '';

    // 1. MANDO
    if(mandoGroup) {
        html += `
            <div class="mando-section">
                ${renderCard(mandoGroup, true)}
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

function renderCard(g, isMando) {
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
    
    if (assignedMission && !isMandoCard) {
        assignedMissionHtml = `
            <div class="mision-card" draggable="true" data-mision-id="${assignedMission.id}" data-obj='${JSON.stringify(assignedMission)}'>
                <strong style="text-transform: uppercase;">[MSN] ${assignedMission.tipo}</strong>
                <div style="font-size: 0.85em; font-weight: bold; margin-bottom: 2px;">${assignedMission.nombre}</div>
                <div>${assignedMission.etiquetas || ''}</div>
            </div>
        `;
    }

    const droppableHtml = isMandoCard ? '' : `
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
                            TOTAL EFECTIVOS: <span id="orbat-total-pax-value">0</span>
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
            }
        });
    });
}

// --- CRUD EQUIPOS ---
function renderEquiposTable(equipos) {
    const tbody = document.getElementById('equipos-tbody');
    tbody.innerHTML = '';

    equipos.forEach(eq => {
        tbody.innerHTML += `
            <tr>
                <td>${eq.nombre}</td>
                <td class="color-${eq.faccion_nombre}">${eq.faccion_nombre}</td>
                <td>${eq.jugadores}</td>
                <td>${eq.tipo}</td>
                <td>
                    <button class="btn secondary btn-edit" data-id="${eq.id}" data-obj='${JSON.stringify(eq)}'>Editar</button>
                    <button class="btn danger btn-del" data-id="${eq.id}">Borrar</button>
                </td>
            </tr>
        `;
    });

    document.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const eq = JSON.parse(e.target.dataset.obj);
            openModal(eq);
        });
    });

    document.querySelectorAll('.btn-del').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if(confirm('¿Eliminar equipo?')) {
                const id = e.target.dataset.id;
                await fetch(`/api/equipos/${id}`, { method: 'DELETE' });
                await loadEquipos();
                await loadORBAT();
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

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const id = document.getElementById('eq-id').value;
        const payload = {
            nombre: document.getElementById('eq-nombre').value,
            faccion_id: document.getElementById('eq-faccion').value,
            jugadores: document.getElementById('eq-jugadores').value,
            jugadores_manual: document.getElementById('eq-jugadores-manual').checked,
            tipo: document.getElementById('eq-tipo').value,
            valoracion: document.getElementById('eq-valoracion').value,
            miembros: [],
            historial: []
        };
        
        const historialContainer = document.getElementById('historial-container');
        const hRows = historialContainer.querySelectorAll('.historial-row');
        hRows.forEach(row => {
            const op = row.querySelector('.historial-op').value;
            const ms_id = row.querySelector('.historial-mision').value;
            const grp = row.querySelector('.historial-grupo').value;
            if (op.trim()) {
                payload.historial.push({ operacion: op, mision_id: ms_id || null, grupo_rol: grp });
            }
        });
        
        const miembrosContainer = document.getElementById('miembros-container');
        const rows = miembrosContainer.querySelectorAll('.miembro-row');
        rows.forEach(row => {
            const nombre = row.querySelector('.miembro-nombre').value;
            const rol = row.querySelector('.miembro-rol').value;
            if (nombre.trim()) {
                payload.miembros.push({ nombre_jugador: nombre, rol: rol });
            }
        });

        const url = id ? `/api/equipos/${id}` : '/api/equipos';
        const method = id ? 'PUT' : 'POST';

        await fetch(url, {
            method: method,
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });

        closeModal();
        await loadEquipos();
        await loadORBAT();
    });
}

function openModal(equipo = null) {
    const modal = document.getElementById('modal-equipo');
    document.getElementById('modal-title').innerText = equipo ? 'Editar Expediente de Equipo' : 'Registrar Equipo';
    
    document.getElementById('eq-id').value = equipo ? equipo.id : '';
    document.getElementById('eq-nombre').value = equipo ? equipo.nombre : '';
    document.getElementById('eq-jugadores').value = equipo ? equipo.jugadores : '';
    document.getElementById('eq-jugadores-manual').checked = equipo ? equipo.jugadores_manual : false;
    document.getElementById('eq-tipo').value = equipo ? equipo.tipo : 'GOE';
    document.getElementById('eq-valoracion').value = equipo ? (equipo.valoracion || 'C (Estándar)') : 'C (Estándar)';
    
    updateJugadoresState();
    
    if (equipo) {
        document.getElementById('eq-faccion').value = equipo.faccion_id;
    }

    const miembrosContainer = document.getElementById('miembros-container');
    miembrosContainer.innerHTML = '';
    
    if (equipo && equipo.miembros && equipo.miembros.length > 0) {
        equipo.miembros.forEach(m => addMiembroRow(m.nombre_jugador, m.rol));
    } else {
        addMiembroRow();
    }
    
    const historialContainer = document.getElementById('historial-container');
    historialContainer.innerHTML = '';
    
    if (equipo && equipo.historial && equipo.historial.length > 0) {
        equipo.historial.forEach(h => addHistorialRow(h.operacion, h.mision_id, h.grupo_rol));
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
    const validRows = Array.from(container.querySelectorAll('.miembro-nombre')).filter(input => input.value.trim() !== '');
    document.getElementById('eq-jugadores').value = validRows.length;
}

document.getElementById('eq-jugadores-manual').addEventListener('change', updateJugadoresState);



function addMiembroRow(nombre = '', rol = 'Asalto') {
    const container = document.getElementById('miembros-container');
    const div = document.createElement('div');
    div.className = 'miembro-row';
    div.style.display = 'flex';
    div.style.gap = '0.25rem';
    
    div.innerHTML = `
        <input type="text" class="miembro-nombre" placeholder="Nombre" value="${nombre}" style="flex:2; padding: 0.25rem; font-family: var(--font-ui);">
        <select class="miembro-rol" style="flex:1; padding: 0.25rem; font-family: var(--font-ui);">
            <option value="Mando" ${rol === 'Mando' ? 'selected' : ''}>Mando</option>
            <option value="Asalto" ${rol === 'Asalto' ? 'selected' : ''}>Asalto</option>
            <option value="Sanitario" ${rol === 'Sanitario' ? 'selected' : ''}>Sanitario</option>
            <option value="Apoyo" ${rol === 'Apoyo' ? 'selected' : ''}>Apoyo</option>
            <option value="Tirador" ${rol === 'Tirador' ? 'selected' : ''}>Tirador</option>
            <option value="Especialista" ${rol === 'Especialista' ? 'selected' : ''}>Especialista</option>
        </select>
        <button type="button" class="btn danger btn-del-miembro" style="padding: 0.25rem 0.5rem; font-size:0.8rem;">X</button>
    `;
    
    const inputNombre = div.querySelector('.miembro-nombre');
    inputNombre.addEventListener('input', updateJugadoresCount);
    
    div.querySelector('.btn-del-miembro').addEventListener('click', () => {
        div.remove();
        updateJugadoresCount();
    });
    
    container.appendChild(div);
    updateJugadoresCount();
}

function addHistorialRow(operacion = '', mision_id = null, grupo_rol = 'GOE') {
    const container = document.getElementById('historial-container');
    const div = document.createElement('div');
    div.className = 'historial-row';
    div.style.display = 'flex';
    div.style.gap = '0.25rem';
    
    const misionesOptions = todasMisiones.map(m => `<option value="${m.id}" ${m.id == mision_id ? 'selected' : ''}>${m.nombre}</option>`).join('');
    
    div.innerHTML = `
        <input type="text" class="historial-op" placeholder="Operación" value="${operacion}" style="flex:2; padding: 0.25rem; font-family: var(--font-ui);">
        <select class="historial-mision" style="flex:2; padding: 0.25rem; font-family: var(--font-ui);">
            <option value="">-- Misión --</option>
            ${misionesOptions}
        </select>
        <select class="historial-grupo" style="flex:1; padding: 0.25rem; font-family: var(--font-ui);">
            <option value="GOE" ${grupo_rol === 'GOE' ? 'selected' : ''}>GOE</option>
            <option value="GAD" ${grupo_rol === 'GAD' ? 'selected' : ''}>GAD</option>
        </select>
        <button type="button" class="btn danger btn-del-historial" style="padding: 0.25rem 0.5rem; font-size:0.8rem;">X</button>
    `;
    
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
            contexto: document.getElementById('mis-contexto').value,
            instrucciones: document.getElementById('mis-instrucciones').value,
            consideraciones: document.getElementById('mis-consideraciones').value,
            persistente: document.getElementById('mis-persistente').checked,
            revelada: document.getElementById('mis-revelada').checked
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
    document.getElementById('mis-contexto').value = mis ? mis.contexto : '';
    document.getElementById('mis-instrucciones').value = mis ? mis.instrucciones : '';
    document.getElementById('mis-consideraciones').value = mis && mis.consideraciones ? mis.consideraciones : '';
    document.getElementById('mis-persistente').checked = mis ? mis.persistente : false;
    document.getElementById('mis-revelada').checked = mis ? mis.revelada : false;
    
    modal.classList.add('active');
}

function closeModalMision() {
    const modal = document.getElementById('modal-crud-mision');
    modal.classList.remove('active');
    document.getElementById('form-mision').reset();
}

function initMisionModals() {
    const mcards = document.querySelectorAll('.mision-card');
    const mModal = document.getElementById('modal-mision');
    const btnCerrar = document.getElementById('btn-cerrar-mision');

    btnCerrar.addEventListener('click', () => {
        mModal.classList.remove('active');
    });

    mcards.forEach(card => {
        card.addEventListener('click', (e) => {
            const m = JSON.parse(card.dataset.obj);
            
            document.getElementById('rm-nombre').innerText = m.nombre;
            document.getElementById('rm-tipo').innerText = m.tipo;
            document.getElementById('rm-tags').innerText = m.etiquetas;
            document.getElementById('rm-oficial').innerText = m.oficial_responsable || 'CLASIFICADO';
            
            const ctxElem = document.getElementById('rm-contexto');
            const instElem = document.getElementById('rm-instrucciones');
            const consElem = document.getElementById('rm-consideraciones');
            const consSection = document.getElementById('rm-consideraciones-section');
            
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

            mModal.classList.add('active');
        });
    });
}
